import { localizedOptions, t } from './i18n';
import { App, Modal, Notice } from 'obsidian';
import { addDays, baseEvent, clone, createDocument, decimal, EVENT_LABELS, EventType, Expense, Investment, ITEM_TYPES, LedgerDocument, LedgerError, LedgerEvent, localDate, localTime, money, parseMoney, putEvent, RATINGS, refunded, STATUSES, validateDocument } from './domain';
import { Attachment } from './attachments';
import { AttachmentEditor } from './attachment-ui';
import { FilePicker } from './files';
import { errorMessage, LedgerStore } from './store';
import { button, el, field, fillOptions, iconButton, input, select, shortPath, textarea } from './ui';

export interface FormContext {
  app: App; store: LedgerStore; demo: boolean;
  onSaved?: (id: string) => void;
}
export class LinkEditor {
  values: string[];
  private list: HTMLElement;
  constructor(parent: HTMLElement, label: string, private app: App, values: string[] = [], private single = false, private allFiles = false) {
    this.values = [...values];
    const group = field(parent, label); this.list = el(group, 'div', 'ill-link-editor');
    button(group, single ? t("选择文件") : t("关联笔记"), () => new FilePicker(app, path => { this.values = single ? [path] : [...new Set([...this.values, path])]; this.render(); }, allFiles).open(), 'ill-small', 'link');
    this.render();
  }
  private render(): void {
    this.list.replaceChildren();
    for (const path of this.values) {
      const row = el(this.list, 'div', 'ill-link-chip'); const missing = !this.app.vault.getAbstractFileByPath(path);
      el(row, 'span', missing ? 'ill-broken' : '', `${missing ? t("链接失效：") : ''}${shortPath(path)}`).title = path;
      iconButton(row, 'x', t("移除关联 {0}", shortPath(path)), () => { this.values = this.values.filter(p => p !== path); this.render(); });
    }
  }
}
/** Shared form behavior: keep controls and entered values mounted on a failed save. */
abstract class SaveModal extends Modal {
  protected form!: HTMLFormElement;
  protected error!: HTMLElement;
  protected submitButton!: HTMLButtonElement;
  private saving = false;
  private attachmentEditors: AttachmentEditor[] = [];
  protected attachments(ctx: FormContext, values: Attachment[] = []): AttachmentEditor {
    const editor = new AttachmentEditor(this.form, this.app, ctx.store.folder, ctx.demo, values); this.attachmentEditors.push(editor); return editor;
  }
  onClose(): void { for (const editor of this.attachmentEditors) editor.dispose(); this.attachmentEditors = []; }
  protected setup(title: string, description?: string): void {
    this.modalEl.classList.add('ill-modal'); this.contentEl.replaceChildren();
    el(this.contentEl, 'h2', '', title); if (description) el(this.contentEl, 'p', 'ill-form-intro', description);
    this.form = el(this.contentEl, 'form', 'ill-form');
  }
  protected footer(save: () => Promise<void>, text = t("保存记录")): void {
    this.error = el(this.form, 'div', 'ill-form-error'); this.error.setAttribute('role', 'alert'); this.error.hidden = true;
    const footer = el(this.form, 'div', 'ill-form-footer');
    button(footer, t("取消"), () => this.close()); this.submitButton = el(footer, 'button', 'ill-btn ill-primary', text); this.submitButton.type = 'submit';
    this.form.addEventListener('submit', event => {
      event.preventDefault(); if (this.saving) return;
      this.saving = true; this.submitButton.disabled = true; this.error.hidden = true;
      this.form.inert = true; this.form.setAttribute('aria-busy', 'true');
      void save().then(() => { this.close(); new Notice(t("已保存")); }).catch(error => {
        this.error.textContent = errorMessage(error); this.error.hidden = false; this.error.scrollIntoView({ block: 'nearest' });
      }).finally(() => { this.saving = false; this.submitButton.disabled = false; this.form.inert = false; this.form.removeAttribute('aria-busy'); });
    });
  }
}
export class InvestmentModal extends SaveModal {
  constructor(private ctx: FormContext, private original?: LedgerDocument) { super(ctx.app); }
  onOpen(): void {
    this.setup(this.original ? t("编辑投入项") : t("新建投入项"), t("给这项投入一个持续记录的位置。后续支出、练习和成果都可以记在这里。"));
    const doc = clone(this.original ?? createDocument('', '其他', this.ctx.demo));
    const name = input(this.form, t("名称 *"), doc.item.name, 'text', t("例如：Python 实战课程")); name.required = true;
    const row = el(this.form, 'div', 'ill-form-row');
    const type = select(row, t("类型"), localizedOptions(ITEM_TYPES), doc.item.type); const status = select(row, t("状态"), localizedOptions(STATUSES), doc.item.status);
    const reason = textarea(this.form, t("购买原因"), doc.item.reason, t("希望解决什么问题，或完成什么？"));
    const project = new LinkEditor(this.form, t("所属项目（可选，一篇项目笔记）"), this.app, doc.item.project ? [doc.item.project] : [], true);
    const notes = new LinkEditor(this.form, t("相关笔记"), this.app, doc.item.notes);
    const review = input(this.form, t("下次回访日期（可选）"), doc.item.nextReview || '', 'date');
    const attachments = this.attachments(this.ctx, doc.item.attachments);
    this.footer(async () => {
      doc.item.name = name.value.trim(); doc.item.type = type.value as Investment['type']; doc.item.status = status.value as Investment['status'];
      doc.item.reason = reason.value.trim(); doc.item.project = project.values[0] || ''; doc.item.notes = notes.values; doc.item.nextReview = review.value || null;
      doc.item.attachments = attachments.values; validateDocument(doc); await attachments.prepare();
      await this.ctx.store.save(doc, this.original); this.ctx.onSaved?.(doc.item.id);
    }, this.original ? t("保存修改") : t("创建投入项"));
  }
}
export interface EventSeed { amount?: string; title?: string; notes?: string[]; expenseId?: string }
export class EventModal extends SaveModal {
  constructor(private ctx: FormContext, private kind: EventType, private originalDoc?: LedgerDocument, private originalEvent?: LedgerEvent, private seed: EventSeed = {}) { super(ctx.app); }
  onOpen(): void {
    const editing = !!this.originalEvent;
    this.setup(`${editing ? t("编辑") : t("记录")}${t(EVENT_LABELS[this.kind])}`, this.kind === 'outcome' ? t("只关联你已经完成、并愿意确认的成果。") : undefined);
    const docs = this.ctx.store.documents.filter(doc => doc.demo === this.ctx.demo);
    const initial = this.originalDoc ?? docs[0]; const event = this.originalEvent;
    const options: [string, string][] = docs.map(doc => [doc.item.id, doc.item.name]);
    if (this.kind === 'expense') options.unshift(['', t("＋ 新建投入项")]);
    const itemSelect = select(this.form, t("所属投入项 *"), options, this.originalDoc?.item.id ?? (this.kind === 'expense' ? '' : initial?.item.id || ''));
    itemSelect.required = this.kind !== 'expense'; itemSelect.disabled = editing;
    if (!options.length) el(this.form, 'p', 'ill-hint', t("请先创建投入项，再添加这类记录。"));
    const newItem = el(this.form, 'div', 'ill-new-item');
    const newName = input(newItem, t("新投入项名称 *"), this.seed.title || '', 'text', t("例如：Python 实战课程"));
    const newType = select(newItem, t("类型"), localizedOptions(ITEM_TYPES), '其他');
    const title = input(this.form, this.kind === 'expense' || this.kind === 'refund' ? t("用途 *") : this.kind === 'outcome' ? t("成果名称 *") : t("标题 *"), event?.title || this.seed.title || (this.kind === 'review' ? t("投入回访") : ''), 'text', t("这一笔记录是什么？")); title.required = true;
    const dateRow = el(this.form, 'div', 'ill-form-row'); const date = input(dateRow, t("发生日期 *"), event?.date || localDate(), 'date'); date.required = true;
    const time = input(dateRow, t("时间 *"), event?.time || localTime(), 'time'); time.required = true;
    let amount: HTMLInputElement | undefined; let originalExpense: HTMLSelectElement | undefined;
    if (this.kind === 'expense' || this.kind === 'refund') { amount = input(this.form, t("金额（元）*"), event && (event.type === 'expense' || event.type === 'refund') ? decimal(event.amount) : this.seed.amount || '', 'text', '0.00'); amount.inputMode = 'decimal'; amount.required = true; }
    if (this.kind === 'refund') originalExpense = select(this.form, t("原支出 *"), [], event?.type === 'refund' ? event.expenseId : '');
    let content: HTMLTextAreaElement | undefined; let minutes: HTMLInputElement | undefined; let target: LinkEditor | undefined;
    if (this.kind === 'learning') {
      content = textarea(this.form, t("本次做了什么？*"), event?.type === 'learning' ? event.content : '', t("记下练习、使用过程和遇到的问题。")); content.required = true;
      minutes = input(this.form, t("时长（分钟，可选）"), event?.type === 'learning' && event.minutes ? String(event.minutes) : '', 'number'); minutes.min = '1'; minutes.step = '1';
    }
    if (this.kind === 'outcome') {
      target = new LinkEditor(this.form, t("成果文件 *（笔记或库内文件）"), this.app, event?.type === 'outcome' ? [event.target] : [], true, true);
      content = textarea(this.form, t("成果说明"), event?.type === 'outcome' ? event.content : '', t("完成了什么？实际用在了哪里？"));
    }
    let expectation: HTMLTextAreaElement | undefined; let usage: HTMLTextAreaElement | undefined; let outcomes: HTMLTextAreaElement | undefined; let rating: HTMLSelectElement | undefined; let plan: HTMLTextAreaElement | undefined;
    if (this.kind === 'review') {
      expectation = textarea(this.form, t("当初希望解决什么问题？"), event?.type === 'review' ? event.expectation : initial?.item.reason || '');
      usage = textarea(this.form, t("目前实际使用到了什么程度？*"), event?.type === 'review' ? event.usage : ''); usage.required = true;
      outcomes = textarea(this.form, t("留下了哪些成果？"), event?.type === 'review' ? event.outcomes : '');
      rating = select(this.form, t("是否达到预期"), localizedOptions(RATINGS), event?.type === 'review' ? event.rating : '暂无法判断');
      plan = textarea(this.form, t("下一步计划 *"), event?.type === 'review' ? event.plan : '', t("继续 / 调整 / 暂停，或写下自己的计划。")); plan.required = true;
    }
    const notes = new LinkEditor(this.form, this.kind === 'review' ? t("相关成果或笔记") : t("关联笔记"), this.app, event?.notes || this.seed.notes || []);
    const attachments = this.attachments(this.ctx, event?.attachments);
    let nextReview: HTMLInputElement | undefined;
    const schedule = el(this.form, 'div');
    if (this.kind === 'expense' || this.kind === 'review') {
      nextReview = input(schedule, this.kind === 'expense' ? t("首次支出的回访日期（可选，建议 30 天后）") : t("下次回访日期（可选，留空表示本次回访已结束）"), this.kind === 'expense' ? addDays(date.value, 30) : event?.type === 'review' ? event.nextReview || '' : '', 'date');
      let touched = false; nextReview.addEventListener('input', () => { touched = true; });
      date.addEventListener('change', () => { if (!touched && this.kind === 'expense' && date.value) nextReview!.value = addDays(date.value, 30); });
    }
    const updateSelection = (): void => {
      const selected = docs.find(doc => doc.item.id === itemSelect.value);
      newItem.hidden = this.kind !== 'expense' || !!selected; newName.required = !newItem.hidden;
      if (this.kind === 'expense') schedule.hidden = !!selected?.events.some(e => e.type === 'expense');
      if (originalExpense) {
        const previous = originalExpense.value || (event?.type === 'refund' ? event.expenseId : this.seed.expenseId || '');
        const expenses = selected?.events.filter((e): e is Expense => e.type === 'expense') || [];
        fillOptions(originalExpense, expenses.map(e => [e.id, t("{0} · {1}（可退 {2}）", e.date, e.title, money(e.amount - refunded(selected!, e.id, event?.id)))]), previous);
      }
      if (expectation && !editing) expectation.value = selected?.item.reason || '';
    };
    itemSelect.addEventListener('change', updateSelection); updateSelection();
    this.footer(async () => {
      const selected = docs.find(doc => doc.item.id === itemSelect.value);
      if (!selected && this.kind !== 'expense') throw new LedgerError(t("请先选择投入项。"));
      const doc = selected ? clone(selected) : createDocument(newName.value, newType.value as Investment['type'], this.ctx.demo);
      const base = { ...baseEvent(doc.item.id, title.value, date.value), ...(event ? { id: event.id, createdAt: event.createdAt } : {}), time: time.value, notes: notes.values, attachments: attachments.values };
      let next: LedgerEvent;
      switch (this.kind) {
        case 'expense': next = { ...base, type: 'expense', amount: parseMoney(amount!.value) }; break;
        case 'refund': next = { ...base, type: 'refund', amount: parseMoney(amount!.value), expenseId: originalExpense!.value }; break;
        case 'learning': next = { ...base, type: 'learning', content: content!.value.trim(), minutes: minutes!.value ? Number(minutes!.value) : null }; break;
        case 'outcome': next = { ...base, type: 'outcome', target: target!.values[0] || '', content: content!.value.trim() }; break;
        case 'review': next = { ...base, type: 'review', expectation: expectation!.value.trim(), usage: usage!.value.trim(), outcomes: outcomes!.value.trim(), rating: rating!.value as '达到', plan: plan!.value.trim(), nextReview: nextReview!.value || null }; break;
      }
      const updated = putEvent(doc, next, nextReview?.value || null);
      await attachments.prepare();
      await this.ctx.store.save(updated, selected); this.ctx.onSaved?.(doc.item.id);
    });
  }
}
export class ConfirmModal extends SaveModal {
  constructor(app: App, private heading: string, private message: string, private action: () => Promise<void>, private actionLabel = t("确认删除")) { super(app); }
  onOpen(): void { this.setup(this.heading, this.message); this.footer(this.action, this.actionLabel); this.submitButton.classList.add('ill-danger'); }
}
export class ReviewExportModal extends SaveModal {
  constructor(app: App, private saveReview: (evaluation: string) => Promise<void>) { super(app); }
  onOpen(): void {
    this.setup(t("生成 Markdown 复盘"), t("将期间净支出、投入项、学习与成果链接、待回访事项保存为库内笔记。"));
    const evaluation = textarea(this.form, t("我的评价"), '', t("哪些投入值得继续？哪些需要调整？")); evaluation.rows = 6;
    this.footer(() => this.saveReview(evaluation.value), t("生成复盘笔记"));
  }
}
