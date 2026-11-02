import { LanguagePreference, resolveLocale, setLocale, t } from './i18n';
import { App, getLanguage, Notice, Plugin, PluginSettingTab, Setting, setTooltip, TFile, TFolder } from 'obsidian';
import { EventModal, InvestmentModal } from './forms';
import { LedgerError } from './domain';
import { errorMessage, LedgerStore, normalizeFolder, StoragePort } from './store';
import { LedgerView, VIEW_TYPE, ViewHost } from './view';

interface LedgerSettings { folder: string; language: LanguagePreference }
const DEFAULT_SETTINGS: LedgerSettings = { folder: '投入账本', language: 'auto' };

class VaultStorage implements StoragePort {
  constructor(private app: App) {}
  async listMarkdown(folder: string): Promise<string[]> {
    const target = this.app.vault.getAbstractFileByPath(folder);
    if (target instanceof TFile) throw new LedgerError(t("此路径是文件，请在设置中选择库内文件夹。"));
    return this.app.vault.getMarkdownFiles().filter(file => file.path.startsWith(`${folder}/`)).map(file => file.path);
  }
  exists(path: string): boolean { return !!this.app.vault.getAbstractFileByPath(path); }
  async read(path: string): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new LedgerError(t("文件不存在：{0}", path));
    return this.app.vault.read(file);
  }
  private async ensureParent(path: string): Promise<void> {
    const parts = path.split('/').slice(0, -1); let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const entry = this.app.vault.getAbstractFileByPath(current);
      if (entry instanceof TFile) throw new LedgerError(t("无法创建文件夹：{0} 已被同名文件占用。", current));
      if (!entry) { try { await this.app.vault.createFolder(current); } catch (error) { if (!(this.app.vault.getAbstractFileByPath(current) instanceof TFolder)) throw error; } }
    }
  }
  async write(path: string, content: string, expected: string | null): Promise<void> {
    if (expected === null) { await this.ensureParent(path); await this.app.vault.create(path, content); return; }
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new LedgerError(t("源文件已被删除或移动，请重建索引后重试。"));
    await this.app.vault.process(file, current => {
      if (current !== expected) throw new LedgerError(t("源文件被外部修改，请重建索引后重新打开表单，避免覆盖修改。"));
      return content;
    });
  }
  async trash(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path); if (!file) throw new LedgerError(t("文件已不存在。"));
    await this.app.vault.trash(file, false);
  }
}

export default class InvestmentLedgerPlugin extends Plugin implements ViewHost {
  settings: LedgerSettings = { ...DEFAULT_SETTINGS };
  store!: LedgerStore;
  private reloadTimer?: ReturnType<typeof setTimeout>;
  private ribbon?: HTMLElement;
  private commandsRegistered = false;
  async onload(): Promise<void> {
    const saved = await this.loadData() as Partial<LedgerSettings> | null;
    this.settings.language = saved?.language === 'en' || saved?.language === 'zh-CN' ? saved.language : 'auto';
    setLocale(resolveLocale(this.settings.language, getLanguage()));
    // Updates must still find a legacy default folder, even in an English vault.
    const defaultFolder = this.app.vault.getAbstractFileByPath(DEFAULT_SETTINGS.folder) ? DEFAULT_SETTINGS.folder : t('投入账本');
    try { this.settings.folder = normalizeFolder(saved?.folder || defaultFolder); }
    catch { this.settings.folder = defaultFolder; new Notice(t("账本文件夹设置无效，已使用「投入账本」。请在设置中检查。"), 10000); }
    if (!saved?.folder) {
      try { await this.saveData(this.settings); }
      catch (error) { new Notice(t('设置保存失败：{0}', errorMessage(error)), 10000); }
    }
    this.store = new LedgerStore(new VaultStorage(this.app), this.settings.folder);
    this.registerView(VIEW_TYPE, leaf => new LedgerView(leaf, this));
    this.ribbon = this.addRibbonIcon('notebook-pen', t("打开学习与创作投入账本"), () => { void this.openLedger(); });
    this.registerLocalizedCommands();
    this.addSettingTab(new LedgerSettingsTab(this.app, this));
    this.app.workspace.onLayoutReady(() => { void this.store.load().catch(error => new Notice(t("读取账本失败：{0}", errorMessage(error)), 10000)); });
    const schedule = (path: string): void => {
      if (!path.startsWith(`${this.store.folder}/`)) return;
      if (this.reloadTimer) clearTimeout(this.reloadTimer);
      this.reloadTimer = setTimeout(() => { void this.store.load().catch(error => new Notice(t("更新账本失败：{0}", errorMessage(error)), 10000)); }, 350);
    };
    this.registerEvent(this.app.vault.on('create', file => schedule(file.path)));
    this.registerEvent(this.app.vault.on('modify', file => schedule(file.path)));
    this.registerEvent(this.app.vault.on('delete', file => { schedule(file.path); this.refreshLinks(); }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      void this.store.handleRename(oldPath, file.path).then(() => { schedule(file.path); schedule(oldPath); }).catch(error => new Notice(t("更新关联路径失败：{0}", errorMessage(error)), 10000));
    }));
    this.register(() => { if (this.reloadTimer) clearTimeout(this.reloadTimer); });
  }
  private registerLocalizedCommands(): void {
    if (this.commandsRegistered) for (const id of ['open-ledger', 'add-expense', 'add-investment', 'rebuild-index']) this.removeCommand(id);
    this.addCommand({ id: 'open-ledger', name: t("打开投入账本"), callback: () => { void this.openLedger(); } });
    this.addCommand({ id: 'add-expense', name: t("记一笔支出"), callback: () => { new EventModal({ app: this.app, store: this.store, demo: false }, 'expense').open(); } });
    this.addCommand({ id: 'add-investment', name: t("新建投入项"), callback: () => { new InvestmentModal({ app: this.app, store: this.store, demo: false }).open(); } });
    this.addCommand({ id: 'rebuild-index', name: t("从 Markdown 重建索引"), callback: () => { void this.store.load().then(() => new Notice(t("账本索引已重建"))).catch(error => new Notice(errorMessage(error), 10000)); } });
    this.commandsRegistered = true;
  }
  private refreshLinks(): void { for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) { if (leaf.view instanceof LedgerView) leaf.view.refresh(); } }
  async openLedger(): Promise<LedgerView | undefined> {
    try {
      let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
      if (!leaf) { leaf = this.app.workspace.getLeaf('tab'); await leaf.setViewState({ type: VIEW_TYPE, active: true }); }
      await this.app.workspace.revealLeaf(leaf); return leaf.view instanceof LedgerView ? leaf.view : undefined;
    } catch (error) { new Notice(t("打开账本失败：{0}", errorMessage(error)), 10000); return undefined; }
  }
  async openPath(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new LedgerError(t("链接失效：{0}。请编辑记录并重新关联。", path));
    await this.app.workspace.getLeaf('tab').openFile(file);
  }
  openSettings(): void {
    // Settings is not part of the published API; feature-detect for compatibility.
    const app = this.app as App & { setting?: { open(): void; openTabById(id: string): void } };
    if (app.setting) { app.setting.open(); app.setting.openTabById(this.manifest.id); }
    else new Notice(t("请打开 Obsidian 设置 → 学习与创作投入账本。"));
  }
  async setFolder(folder: string): Promise<void> {
    const normalized = normalizeFolder(folder);
    const old = this.settings.folder;
    this.settings.folder = normalized;
    try { await this.saveData(this.settings); }
    catch (error) { this.settings.folder = old; throw error; }
    this.store.folder = normalized; await this.store.load();
  }
  async setLanguage(language: LanguagePreference): Promise<void> {
    const previous = this.settings.language;
    this.settings.language = language;
    try { await this.saveData(this.settings); }
    catch (error) { this.settings.language = previous; throw error; }
    setLocale(resolveLocale(language, getLanguage()));
    if (this.ribbon) setTooltip(this.ribbon, t('打开学习与创作投入账本'), { placement: 'right' });
    this.registerLocalizedCommands();
    this.refreshLinks();
    // Refresh error messages from source without translating any user-owned data.
    await this.store.load();
  }
}
class LedgerSettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: InvestmentLedgerPlugin) { super(app, plugin); }
  display(folderDraft = this.plugin.settings.folder): void {
    const { containerEl } = this; containerEl.replaceChildren();
    let folder = folderDraft;
    new Setting(containerEl).setName(t("投入账本")).setHeading();
    new Setting(containerEl).setName(t('界面语言')).setDesc(t('默认跟随 Obsidian。切换语言不会修改已有记录内容、金额或文件路径。'))
      .addDropdown(dropdown => dropdown.addOptions({ auto: t('跟随 Obsidian'), 'zh-CN': '简体中文', en: 'English' }).setValue(this.plugin.settings.language).onChange(async value => {
        const previous = this.plugin.settings.language;
        dropdown.selectEl.disabled = true;
        try { await this.plugin.setLanguage(value as LanguagePreference); this.display(folder); }
        catch (error) { dropdown.setValue(this.plugin.settings.language || previous); new Notice(errorMessage(error), 10000); }
        finally { dropdown.selectEl.disabled = false; }
      }));
    new Setting(containerEl).setName(t("数据文件夹")).setDesc(t("库内相对路径，默认为「投入账本」。更改后读取新位置，原文件保留；如需迁移，请先在文件管理器中移动整个文件夹。"))
      .addText(text => text.setValue(folder).setPlaceholder(t("投入账本")).onChange(value => { folder = value; }))
      .addButton(btn => btn.setButtonText(t("保存文件夹")).setCta().onClick(async () => { try { await this.plugin.setFolder(folder); new Notice(t("数据文件夹已更新")); } catch (error) { new Notice(errorMessage(error), 10000); } }));
    new Setting(containerEl).setName(t("重建索引")).setDesc(t("从 Markdown 源文件重新读取记录。遇到解析问题会列出文件，不会清空源数据。"))
      .addButton(btn => btn.setButtonText(t("重建索引")).onClick(async () => { try { await this.plugin.store.load(); new Notice(t("索引已重建")); } catch (error) { new Notice(errorMessage(error), 10000); } }));
    new Setting(containerEl).setName(t("演示账本")).setDesc(t("演示记录与真实记录分别显示和统计，文件存放在数据文件夹的「演示数据」中。"))
      .addButton(btn => btn.setButtonText(t("载入并打开演示")).onClick(async () => { const view = await this.plugin.openLedger(); view?.loadDemo(); }));
    new Setting(containerEl).setName(t("数据与隐私")).setDesc(t("人民币单币种；所有金额以整数分存储。插件不联网，不采集打开次数或停留时长。卸载插件后，库内 Markdown 文件仍然保留。"));
  }
}
