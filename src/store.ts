import { t } from './i18n';
import { decodeDocument, encodeDocument, looksLikeLedger } from './codec';
import { clone, LedgerDocument, LedgerError, renameLinks, validateDocument } from './domain';

export interface StoragePort {
  listMarkdown(folder: string): Promise<string[]>;
  read(path: string): Promise<string>;
  /** expected=null means create only; otherwise compare content before replacing. */
  write(path: string, content: string, expected: string | null): Promise<void>;
  trash(path: string): Promise<void>;
  exists(path: string): boolean;
}
export interface DataIssue { path: string; message: string }
interface Entry { doc: LedgerDocument; path: string; source: string }
interface ReadSnapshot { source: string; folder: string }
interface RenameRepair { itemId: string; beforeRevision: string; oldPath: string; newPath: string }
export const DEMO_MARKER = '<!-- learning-investment-ledger-demo:v1 -->';
export function normalizeFolder(input: string): string {
  const folder = input.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (!folder || folder.startsWith('/') || folder.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.') || /[:*?"<>|]/.test(p))) throw new LedgerError(t("请选择库内文件夹，例如「投入账本」。不能使用绝对路径、隐藏目录或 ..。"));
  return folder;
}
export class LedgerStore {
  private entries = new Map<string, Entry>();
  private snapshots = new WeakMap<LedgerDocument, ReadSnapshot>();
  private listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  // Obsidian's automatic wiki-link updater can write a pre-rename snapshot later.
  // Repair only those old revisions, never a subsequent deliberate user edit.
  private renameRepairs: RenameRepair[] = [];
  issues: DataIssue[] = [];
  ready = false;
  constructor(readonly port: StoragePort, public folder: string) { this.folder = normalizeFolder(folder); }
  private snapshot(entry: Entry): LedgerDocument {
    const doc = clone(entry.doc); this.snapshots.set(doc, { source: entry.source, folder: this.folder }); return doc;
  }
  get documents(): LedgerDocument[] { return [...this.entries.values()].map(entry => this.snapshot(entry)); }
  get(id: string): LedgerDocument | undefined { const value = this.entries.get(id); return value ? this.snapshot(value) : undefined; }
  pathFor(id: string): string | undefined { return this.entries.get(id)?.path; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(): void { for (const listener of this.listeners) listener(); }
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work); this.queue = result.catch(() => undefined); return result;
  }
  async load(): Promise<void> { return this.enqueue(() => this.scan()); }
  private async scan(): Promise<void> {
    const issues: DataIssue[] = [];
    let files: string[];
    try { files = await this.port.listMarkdown(this.folder); }
    catch (error) { this.issues = [{ path: this.folder, message: t("读取文件夹失败：{0}", errorMessage(error)) }]; this.emit(); throw error; }
    const entries = new Map<string, Entry>();
    const duplicateIds = new Set<string>();
    for (const path of files.sort()) {
      try {
        const source = await this.port.read(path);
        if (!looksLikeLedger(path, source) && ![...this.entries.values()].some(entry => entry.path === path)) continue;
        const doc = decodeDocument(source);
        if (duplicateIds.has(doc.item.id) || entries.has(doc.item.id)) {
          const other = entries.get(doc.item.id);
          if (other) issues.push({ path: other.path, message: t("投入项 ID 与 {0} 重复。请修复后重建索引。", path) });
          duplicateIds.add(doc.item.id); entries.delete(doc.item.id);
          throw new LedgerError(t("投入项 ID 重复：{0}。请修复后重建索引。", doc.item.id));
        }
        entries.set(doc.item.id, { doc, path, source });
      } catch (error) {
        issues.push({ path, message: errorMessage(error) });
        // Preserve the last known good record, but prohibit writes until the source is repaired.
        const old = [...this.entries.values()].find(entry => entry.path === path);
        if (old && !duplicateIds.has(old.doc.item.id)) entries.set(old.doc.item.id, old);
      }
    }
    // IDs are globally stable, not merely unique within one file.
    const ids = new Map<string, string>();
    for (const entry of entries.values()) {
      for (const id of [entry.doc.item.id, ...entry.doc.events.map(e => e.id)]) {
        const other = ids.get(id);
        if (other) { issues.push({ path: entry.path, message: t("记录 ID {0} 与 {1} 重复。", id, other) }); issues.push({ path: other, message: t("记录 ID {0} 与 {1} 重复。", id, entry.path) }); }
        else ids.set(id, entry.path);
      }
    }
    for (const entry of entries.values()) {
      if (issues.some(issue => issue.path === entry.path)) continue;
      const repaired = this.applyRenameRepairs(entry.doc);
      if (JSON.stringify(repaired) === JSON.stringify(entry.doc)) continue;
      try {
        repaired.item.updatedAt = nextRevision(entry.doc.item.updatedAt);
        const content = encodeDocument(repaired);
        await this.port.write(entry.path, content, entry.source);
        entry.doc = repaired; entry.source = content;
      } catch (error) { issues.push({ path: entry.path, message: t("保存重命名后的关联失败：{0}", errorMessage(error)) }); }
    }
    this.entries = entries; this.issues = issues; this.ready = true; this.emit();
  }
  async save(doc: LedgerDocument, expected?: LedgerDocument): Promise<void> {
    const snapshot = clone(doc);
    const guard = expected ? { doc: clone(expected), read: this.snapshots.get(expected) } : undefined;
    return this.enqueue(async () => {
      validateDocument(snapshot);
      const old = this.entries.get(snapshot.item.id);
      if (guard) {
        if (!old || !old.path.startsWith(`${this.folder}/`) || (guard.read && guard.read.folder !== this.folder)) throw new LedgerError(t("该投入项已不存在或数据文件夹已切换。输入已保留，请复制输入后关闭并重新打开表单。"));
        if (guard.read ? guard.read.source !== old.source : JSON.stringify(old.doc) !== JSON.stringify(guard.doc)) throw new LedgerError(t("该投入项在表单打开后已更新。输入已保留，请复制输入后关闭并重新打开表单。"));
      }
      const path = old?.path ?? `${this.folder}/${snapshot.demo ? '演示数据/' : ''}投入-${snapshot.item.id}.md`;
      if (this.issues.some(issue => issue.path === path || issue.path === this.folder)) throw new LedgerError(t("源文件需要先修复：{0}。输入已保留，可打开文件修复后重建索引。", path));
      const allIds = new Set([snapshot.item.id, ...snapshot.events.map(e => e.id)]);
      for (const entry of this.entries.values()) {
        if (entry.doc.item.id !== snapshot.item.id && [entry.doc.item.id, ...entry.doc.events.map(e => e.id)].some(id => allIds.has(id))) throw new LedgerError(t("记录 ID 已被另一个投入项使用。"));
      }
      snapshot.item.updatedAt = nextRevision(old?.doc.item.updatedAt);
      const content = encodeDocument(snapshot);
      try { await this.port.write(path, content, old?.source ?? null); }
      catch (error) { throw new LedgerError(t("保存失败：{0}\n{1}\n输入已保留，请检查文件权限或修复冲突后重试。", path, errorMessage(error))); }
      this.entries.set(snapshot.item.id, { doc: snapshot, path, source: content }); this.emit();
    });
  }
  async delete(id: string, expected?: LedgerDocument): Promise<void> {
    const guard = expected ? { doc: clone(expected), read: this.snapshots.get(expected) } : undefined;
    return this.enqueue(async () => {
      const entry = this.entries.get(id);
      if (!entry) throw new LedgerError(t("投入项不存在。"));
      if (guard && (!entry.path.startsWith(`${this.folder}/`) || (guard.read ? guard.read.folder !== this.folder || guard.read.source !== entry.source : JSON.stringify(entry.doc) !== JSON.stringify(guard.doc)))) throw new LedgerError(t("该投入项在删除确认框打开后已更新。请关闭确认框，重新查看后再删除。"));
      if (this.issues.some(issue => issue.path === entry.path)) throw new LedgerError(t("请先修复源文件再删除。"));
      // Detect edits outside the plugin before moving the file to Obsidian's trash.
      if (await this.port.read(entry.path) !== entry.source) throw new LedgerError(t("源文件刚刚被修改，请重建索引后再删除。"));
      await this.port.trash(entry.path); this.entries.delete(id); this.emit();
    });
  }
  async handleRename(oldPath: string, newPath: string): Promise<void> {
    return this.enqueue(async () => {
      // Update source paths first, including renames of a containing folder.
      for (const entry of this.entries.values()) {
        if (entry.path === oldPath || entry.path.startsWith(`${oldPath}/`)) entry.path = newPath + entry.path.slice(oldPath.length);
        if (JSON.stringify(renameLinks(entry.doc, oldPath, newPath)) !== JSON.stringify(entry.doc)) this.renameRepairs.push({ itemId: entry.doc.item.id, beforeRevision: entry.doc.item.updatedAt, oldPath, newPath });
      }
      for (const entry of this.entries.values()) {
        if (!this.renameRepairs.some(repair => repair.itemId === entry.doc.item.id)) continue;
        try {
          if (this.issues.some(issue => issue.path === entry.path)) throw new LedgerError(t("源文件有解析问题。"));
          // Obsidian may have automatically updated wiki links in the readable body.
          // Re-read and validate the newest source, then transform its structured paths.
          const currentSource = await this.port.read(entry.path);
          const current = decodeDocument(currentSource);
          if (current.item.id !== entry.doc.item.id) throw new LedgerError(t("源文件 ID 已改变。"));
          const latest = this.applyRenameRepairs(current);
          if (JSON.stringify(latest) === JSON.stringify(current)) { entry.doc = current; entry.source = currentSource; continue; }
          latest.item.updatedAt = nextRevision(current.item.updatedAt);
          const content = encodeDocument(latest);
          await this.port.write(entry.path, content, currentSource);
          entry.doc = latest; entry.source = content;
        } catch (error) { this.issues.push({ path: entry.path, message: t("更新链接失败（{0} → {1}）：{2}", oldPath, newPath, errorMessage(error)) }); }
      }
      this.emit();
    });
  }
  private applyRenameRepairs(doc: LedgerDocument): LedgerDocument {
    let result = doc;
    for (const repair of this.renameRepairs) {
      if (repair.itemId === doc.item.id && doc.item.updatedAt <= repair.beforeRevision) result = renameLinks(result, repair.oldPath, repair.newPath);
    }
    return result;
  }
  async writeExport(name: string, content: string): Promise<string> {
    // A fresh file each time; never overwrite a user's reflection.
    const base = `${this.folder}/复盘/${name.replace(/[\\/:*?"<>|]/g, '-')}`;
    const dot = base.lastIndexOf('.'); let path = base; let suffix = 2;
    while (this.port.exists(path)) path = `${base.slice(0, dot)}-${suffix++}${base.slice(dot)}`;
    await this.port.write(path, content, null); return path;
  }
  async installDemo(docs: LedgerDocument[], notes: Record<string, string>): Promise<void> {
    for (const [relative, content] of Object.entries(notes)) {
      const path = `${this.folder}/演示数据/${relative}`;
      if (!this.port.exists(path)) await this.port.write(path, `${DEMO_MARKER}\n\n${content}`, null);
    }
    for (const doc of docs) { if (!this.entries.has(doc.item.id)) await this.save(doc); }
  }
  async clearDemo(): Promise<void> {
    for (const entry of [...this.entries.values()]) {
      if (entry.doc.demo && entry.path.startsWith(`${this.folder}/演示数据/`)) await this.delete(entry.doc.item.id, this.snapshot(entry));
    }
    for (const path of await this.port.listMarkdown(`${this.folder}/演示数据`)) {
      const source = await this.port.read(path);
      if (source.startsWith(DEMO_MARKER)) await this.port.trash(path);
    }
  }
}
function nextRevision(previous?: string): string { return new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString(); }
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
