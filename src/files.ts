import { t } from './i18n';
import { App, FuzzySuggestModal, TFile } from 'obsidian';

export class FilePicker extends FuzzySuggestModal<TFile> {
  constructor(app: App, private chosen: (path: string) => void, private allFiles = false) { super(app); this.setPlaceholder(allFiles ? t("搜索库内笔记或文件…") : t("搜索库内已有笔记…")); }
  getItems(): TFile[] { return this.allFiles ? this.app.vault.getFiles() : this.app.vault.getMarkdownFiles(); }
  getItemText(file: TFile): string { return file.path; }
  onChooseItem(file: TFile): void { this.chosen(file.path); }
}
