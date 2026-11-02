import { t } from './i18n';
import { App, Modal, Notice, TFile, TFolder } from 'obsidian';
import { Attachment, attachmentName, importedAttachmentPath, isImagePath, isSafeWebUrl, validateAttachments } from './attachments';
import { clone, LedgerError, uid } from './domain';
import { FilePicker } from './files';
import { errorMessage } from './store';
import { button, el, field, icon, iconButton } from './ui';

interface RenderOptions {
  limit?: number;
  previews?: Map<string, string>;
  pending?: Set<string>;
  remove?: (id: string) => void;
}
async function openFile(app: App, path: string): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) throw new LedgerError(t("附件已失效。请编辑记录后重新关联文件。"));
  await app.workspace.getLeaf('tab').openFile(file);
}
class ImagePreview extends Modal {
  constructor(app: App, private source: string, private name: string, private path?: string) { super(app); }
  onOpen(): void {
    this.modalEl.classList.add('ill-image-modal'); this.contentEl.replaceChildren();
    el(this.contentEl, 'h2', '', this.name);
    const image = el(this.contentEl, 'img', 'ill-full-image'); image.src = this.source; image.alt = this.name;
    image.addEventListener('error', () => { image.hidden = true; el(this.contentEl, 'p', 'ill-broken', t("图片暂无法预览，可以打开原文件检查。")); });
    if (this.path) button(this.contentEl, t("在 Obsidian 中打开"), () => { void openFile(this.app, this.path!).catch(error => new Notice(errorMessage(error))); }, '', 'external-link');
  }
}
/** Same attachment rendering in forms, timeline cards and item/event details. */
export function renderAttachments(parent: HTMLElement, app: App, values: Attachment[] = [], options: RenderOptions = {}): void {
  if (!values.length) return;
  const gallery = el(parent, 'div', 'ill-attachments'); gallery.setAttribute('aria-label', t("附件列表"));
  const visible = values.slice(0, options.limit ?? values.length);
  for (const attachment of visible) {
    const name = attachmentName(attachment);
    const file = attachment.kind === 'file' ? app.vault.getAbstractFileByPath(attachment.target) : null;
    const preview = options.previews?.get(attachment.id);
    const pending = options.pending?.has(attachment.id);
    const missing = attachment.kind === 'file' && !(file instanceof TFile) && !pending;
    const isImage = attachment.kind === 'file' && isImagePath(attachment.target) && !missing;
    const tile = el(gallery, 'div', `ill-attachment ${isImage ? 'ill-attachment-image' : ''} ${missing ? 'ill-attachment-missing' : ''}`);
    const open = el(tile, 'button', 'ill-attachment-open'); open.type = 'button'; open.title = attachment.target;
    open.setAttribute('aria-label', `${isImage ? t("预览图片") : t("打开附件")}：${name}${missing ? t("（链接失效）") : ''}`);
    if (isImage) {
      const image = el(open, 'img'); image.alt = name; image.loading = 'lazy';
      image.src = preview || app.vault.getResourcePath(file as TFile);
      image.addEventListener('error', () => { image.hidden = true; icon(open, 'image-off'); open.title = t("图片暂无法预览，点击打开原文件"); });
    } else icon(open, missing ? 'file-warning' : attachment.kind === 'url' ? 'external-link' : 'paperclip');
    el(open, 'span', '', `${name}${missing ? t(" · 链接失效") : ''}${pending ? t(" · 待保存") : ''}`);
    open.addEventListener('click', event => {
      event.stopPropagation();
      if (missing) { new Notice(t("附件链接失效。请编辑记录，移除旧附件并重新关联。"), 7000); return; }
      if (attachment.kind === 'url') { if (isSafeWebUrl(attachment.target)) window.open(attachment.target, '_blank', 'noopener,noreferrer'); return; }
      if (pending && !preview) { new Notice(t("保存记录后，可以打开这个文件。")); return; }
      if (isImage) new ImagePreview(app, preview || app.vault.getResourcePath(file as TFile), name, preview ? undefined : attachment.target).open();
      else void openFile(app, attachment.target).catch(error => new Notice(errorMessage(error), 7000));
    });
    if (options.remove) { const remove = iconButton(tile, 'x', t("移除附件 {0}", name), () => options.remove!(attachment.id)); remove.addEventListener('click', event => event.stopPropagation()); }
  }
  if (visible.length < values.length) el(gallery, 'span', 'ill-hint', t("另有 {0} 项附件，点击记录查看全部。", values.length - visible.length));
}

interface PendingFile { file: File; preview?: string; imported: boolean }
export class AttachmentEditor {
  private entries: Attachment[];
  private pending = new Map<string, PendingFile>();
  private list: HTMLElement;
  private container: HTMLElement;
  private disposed = false;
  get values(): Attachment[] { return clone(this.entries); }
  constructor(parent: HTMLElement, private app: App, private folder: string, private demo: boolean, values: Attachment[] = []) {
    this.entries = clone(values);
    this.container = field(parent, t("附件（文件、图片或网址）")); this.container.classList.add('ill-attachment-editor');
    this.list = el(this.container, 'div');
    const controls = el(this.container, 'div', 'ill-attachment-controls');
    button(controls, t("关联库内文件"), () => new FilePicker(app, path => {
      if (!this.entries.some(a => a.kind === 'file' && a.target === path)) this.entries.push({ id: uid(), kind: 'file', target: path }); this.render();
    }, true).open(), 'ill-small', 'link');
    const upload = el(controls, 'input'); upload.type = 'file'; upload.multiple = true; upload.hidden = true; upload.setAttribute('aria-label', t("从电脑选择附件"));
    button(controls, t("从电脑添加"), () => upload.click(), 'ill-small', 'upload');
    upload.addEventListener('change', () => { this.addFiles([...upload.files || []]); upload.value = ''; });
    const web = el(this.container, 'div', 'ill-attachment-url'); web.hidden = true;
    button(controls, t("添加网址"), () => { web.hidden = !web.hidden; if (!web.hidden) address.focus(); }, 'ill-small', 'external-link');
    const address = el(web, 'input', 'ill-input'); address.placeholder = 'https://…'; address.inputMode = 'url'; address.setAttribute('aria-label', t("附件网址"));
    const label = el(web, 'input', 'ill-input'); label.placeholder = t("链接名称（可选）"); label.setAttribute('aria-label', t("附件链接名称"));
    const error = el(web, 'span', 'ill-broken'); error.setAttribute('role', 'alert'); error.hidden = true;
    button(web, t("添加链接"), () => {
      const target = address.value.trim();
      if (!isSafeWebUrl(target)) { error.textContent = t("请输入有效的 http:// 或 https:// 网址，不能包含登录凭据。"); error.hidden = false; return; }
      if (!this.entries.some(a => a.kind === 'url' && a.target === target)) this.entries.push({ id: uid(), kind: 'url', target, ...(label.value.trim() ? { label: label.value.trim() } : {}) });
      address.value = ''; label.value = ''; error.hidden = true; web.hidden = true; this.render();
    }, 'ill-small');
    const drop = el(this.container, 'div', 'ill-attachment-drop', t("也可以把文件拖到这里，或在这里粘贴截图")); drop.tabIndex = 0;
    drop.setAttribute('aria-label', t("拖入文件或粘贴图片"));
    drop.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); drop.classList.add('is-dragging'); } });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-dragging'));
    drop.addEventListener('drop', event => { event.preventDefault(); event.stopPropagation(); drop.classList.remove('is-dragging'); this.addFiles([...event.dataTransfer?.files || []]); });
    drop.addEventListener('paste', event => { const files = [...event.clipboardData?.files || []]; if (files.length) { event.preventDefault(); event.stopPropagation(); this.addFiles(files); } });
    el(this.container, 'span', 'ill-hint', t("电脑文件在保存记录时复制到库内「附件」文件夹。首次保存前只暂存；已导入的文件在取消或移除关联后仍保留。单个导入文件上限 50 MB。"));
    this.render();
  }
  private addFiles(files: File[]): void {
    if (this.disposed) return;
    for (const file of files) {
      if (file.size > 50 * 1024 * 1024) { new Notice(t("「{0}」超过 50 MB；请先放入库中再关联。", file.name), 8000); continue; }
      const id = uid();
      const name = file.name || t("截图-{0}.png", id.slice(0, 8));
      const preview = isImagePath(name) ? URL.createObjectURL(file) : undefined;
      this.entries.push({ id, kind: 'file', target: importedAttachmentPath(this.folder, this.demo, id, name), label: name });
      this.pending.set(id, { file, preview, imported: false });
    }
    this.render();
  }
  private render(): void {
    this.list.replaceChildren();
    const previews = new Map([...this.pending].flatMap(([id, entry]) => entry.preview ? [[id, entry.preview] as [string, string]] : []));
    renderAttachments(this.list, this.app, this.entries, { previews, pending: new Set(this.pending.keys()), remove: id => {
      this.entries = this.entries.filter(a => a.id !== id); const pending = this.pending.get(id);
      if (pending?.preview) URL.revokeObjectURL(pending.preview); this.pending.delete(id); this.render();
    } });
  }
  async prepare(): Promise<void> {
    validateAttachments(this.entries);
    for (const attachment of this.entries) {
      const pending = this.pending.get(attachment.id); if (!pending) continue;
      if (pending.imported && this.app.vault.getAbstractFileByPath(attachment.target) instanceof TFile) continue;
      try {
        let current = '';
        for (const part of attachment.target.split('/').slice(0, -1)) {
          current = current ? `${current}/${part}` : part;
          const existing = this.app.vault.getAbstractFileByPath(current);
          if (existing instanceof TFile) throw new LedgerError(t("「{0}」是文件，无法创建附件文件夹。", current));
          if (!existing) { try { await this.app.vault.createFolder(current); } catch (error) { if (!(this.app.vault.getAbstractFileByPath(current) instanceof TFolder)) throw error; } }
        }
        await this.app.vault.createBinary(attachment.target, await pending.file.arrayBuffer()); pending.imported = true;
      } catch (error) { throw new LedgerError(t("附件保存失败：{0}\n目标：{1}\n{2}\n文件选择和表单输入已保留，可修复后重试。", attachmentName(attachment), attachment.target, errorMessage(error))); }
    }
  }
  dispose(): void { this.disposed = true; for (const pending of this.pending.values()) if (pending.preview) URL.revokeObjectURL(pending.preview); this.pending.clear(); }
}
