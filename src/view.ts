import { getLocale, t } from './i18n';
import { App, ItemView, Notice, WorkspaceLeaf } from 'obsidian';
import { CURRENCIES, Currency, currencyOf, Stats, netAmounts, decimal, addDays, baseEvent, createDocument, DateRange, EVENT_LABELS, EVENT_TYPES, EventType, exportCsv, exportReview, filterEvents, inRange, isDue, ITEM_TYPES, LedgerDocument, LedgerEvent, localDate, money, monthRange, last30Range, parseMoney, putEvent, removeEvent, summarize } from './domain';
import { makeDemo } from './demo';
import { ConfirmModal, EventModal, EventSeed, FormContext, InvestmentModal, ReviewExportModal } from './forms';
import { FilePicker } from './files';
import { renderAttachments } from './attachment-ui';
import { errorMessage, LedgerStore } from './store';
import { button, el, emptyState, fillOptions, icon, iconButton, shortPath } from './ui';

export const VIEW_TYPE = 'learning-investment-ledger';
export interface ViewHost {
  app: App;
  store: LedgerStore;
  openPath(path: string): Promise<void>;
  openSettings(): void;
}
type Tab = 'timeline' | 'items' | 'summary';
export class LedgerView extends ItemView {
  private root!: HTMLElement;
  private workspace!: HTMLElement;
  private tab: Tab = 'timeline';
  private customRange: DateRange = monthRange();
  private period = 'month';
  private get range(): DateRange { return this.period === 'month' ? monthRange() : this.period === '30' ? last30Range() : this.customRange; }
  private set range(value: DateRange) { this.customRange = value; }
  private renderedDate = localDate();
  private eventType: EventType | '' = '';
  private itemFilter = '';
  private keyword = '';
  private newest = false;
  private selected = '';
  private selectedEvent = '';
  private detailsOpen = false;
  private dueOnly = false;
  private demo = false;
  private draft = { amount: '', title: '', itemId: '', notes: [] as string[], error: '', currency: 'CNY' as Currency };
  private quickSaving = false;
  private unsubscribe?: () => void;
  constructor(leaf: WorkspaceLeaf, private host: ViewHost) { super(leaf); }
  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return t("投入账本"); }
  getIcon(): string { return 'notebook-pen'; }
  refresh(): void { this.render(); }
  async onOpen(): Promise<void> {
    this.contentEl.classList.add('ill-view');
    this.unsubscribe = this.host.store.subscribe(() => this.render()); this.render();
    this.registerDomEvent(this.contentEl, 'keydown', event => { if (event.key === 'Escape' && this.detailsOpen) { this.detailsOpen = false; this.renderWorkspace(true); } });
    const document = this.contentEl.ownerDocument; const win = document.defaultView;
    if (win) {
      this.registerInterval(win.setInterval(() => this.refreshDate(), 60_000));
      this.registerDomEvent(win, 'focus', () => this.refreshDate());
    }
    this.registerDomEvent(document, 'visibilitychange', () => this.refreshDate());
  }
  async onClose(): Promise<void> { this.unsubscribe?.(); }
  private refreshDate(): void { if (localDate() !== this.renderedDate) this.render(); }
  private get docs(): LedgerDocument[] { return this.host.store.documents.filter(doc => doc.demo === this.demo); }
  private context(): FormContext { return { app: this.app, store: this.host.store, demo: this.demo, onSaved: id => { this.selected = id; this.render(); } }; }
  private eventForm(kind: EventType, doc?: LedgerDocument, event?: LedgerEvent, seed: EventSeed = {}): void { new EventModal(this.context(), kind, doc, event, seed).open(); }
  private act(work: () => Promise<void>): void { void work().catch(error => new Notice(errorMessage(error), 10000)); }
  private render(resetScroll = false): void {
    if (!this.contentEl) return;
    this.renderedDate = localDate();
    const scroll = resetScroll ? 0 : this.workspace?.querySelector('.ill-scroll')?.scrollTop || 0;
    this.contentEl.replaceChildren(); this.root = el(this.contentEl, 'div', 'ill-app');
    this.root.lang = getLocale();
    this.renderHeader(); this.renderIssues(); this.renderStats(); this.renderNavigation();
    if (this.tab === 'timeline') this.renderQuick();
    this.renderFilters(); this.workspace = el(this.root, 'div', 'ill-workspace'); this.renderWorkspace();
    const mainScroll = this.workspace.querySelector('.ill-scroll'); if (mainScroll) mainScroll.scrollTop = scroll;
  }
  private renderHeader(): void {
    const header = el(this.root, 'header', 'ill-header');
    const brand = el(header, 'div', 'ill-brand'); icon(brand, 'notebook-pen', 'ill-brand-mark');
    const words = el(brand, 'div'); el(words, 'h1', '', t("投入账本")); el(words, 'p', '', t("让每一份投入，都有迹可循。"));
    const actions = el(header, 'div', 'ill-header-actions');
    const period = el(actions, 'select', 'ill-period'); period.setAttribute('aria-label', t("时间范围"));
    fillOptions(period, [['month', t("本月")], ['30', t("近 30 天")], ['custom', t("自定义日期")]], this.period);
    period.addEventListener('change', () => { const previous = this.range; this.period = period.value; if (this.period === 'custom') this.range = previous; this.render(); });
    button(actions, t("记一笔"), () => this.eventForm('expense'), 'ill-primary', 'plus');
    iconButton(actions, 'settings-2', t("账本设置"), () => this.host.openSettings());
    if (this.period === 'custom') {
      const dates = el(this.root, 'div', 'ill-custom-range');
      const start = el(dates, 'input', 'ill-input'); start.type = 'date'; start.value = this.range.start; start.setAttribute('aria-label', t("开始日期"));
      el(dates, 'span', '', t("至")); const end = el(dates, 'input', 'ill-input'); end.type = 'date'; end.value = this.range.end; end.setAttribute('aria-label', t("结束日期"));
      const error = el(dates, 'span', 'ill-broken');
      button(dates, t("应用"), () => { if (!start.value || !end.value || start.value > end.value) { error.textContent = t("开始日期不能晚于结束日期。"); return; } this.range = { start: start.value, end: end.value }; this.render(); }, 'ill-small');
    }
    const hasDemo = this.host.store.documents.some(doc => doc.demo);
    if (hasDemo || this.demo) {
      const bar = el(this.root, 'div', 'ill-demo-bar');
      button(bar, t("我的账本"), () => { this.demo = false; this.resetSelection(); this.render(); }, !this.demo ? 'is-active' : '');
      button(bar, t("演示账本"), () => { this.demo = true; this.resetSelection(); this.render(); }, this.demo ? 'is-active' : '');
      el(bar, 'span', 'ill-hint', this.demo ? t("演示数据单独统计，记录保存在「演示数据」文件夹。") : t("当前仅展示你的真实记录。"));
      button(bar, t("清除演示数据"), () => new ConfirmModal(this.app, t("清除演示数据"), t("只将演示投入项和带演示标记的笔记移到库内回收站。你的真实记录会保留。"), async () => { await this.host.store.clearDemo(); this.demo = false; this.resetSelection(); this.render(); }, t("清除演示数据")).open(), 'ill-small');
    }
  }
  private resetSelection(): void { this.selected = ''; this.selectedEvent = ''; this.itemFilter = ''; this.dueOnly = false; this.draft = { amount: '', title: '', itemId: '', notes: [], error: '', currency: 'CNY' }; }
  private renderIssues(): void {
    if (!this.host.store.issues.length) return;
    const box = el(this.root, 'div', 'ill-issues'); box.setAttribute('role', 'alert');
    const heading = el(box, 'div', 'ill-inline'); icon(heading, 'triangle-alert'); el(heading, 'strong', '', t("{0} 个数据问题需要处理", this.host.store.issues.length));
    el(box, 'p', '', t("可用记录继续显示；有问题的文件不会被覆盖。含保留记录的统计可能不是最新值。"));
    for (const issue of this.host.store.issues) {
      const row = el(box, 'div'); button(row, issue.path, () => this.act(() => this.host.openPath(issue.path)), 'ill-text'); el(row, 'span', '', `：${issue.message}`);
    }
    button(box, t("修复后重建索引"), () => this.act(() => this.host.store.load()), 'ill-small', 'refresh-cw');
  }
  private renderStats(): void {
    const stats = summarize(this.docs, this.range); const strip = el(this.root, 'div', 'ill-stats');
    const entries: [string, string, string, string][] = [
      [t("期间净支出"), '', t("按币种分别统计，不进行汇率换算。"), 'wallet'],
      [t("关联项目"), String(stats.projects), t("期间事件涉及的项目笔记"), 'folder-open'],
      [t("关联成果"), String(stats.outcomes), t("按成果文件去重"), 'sprout'],
      [t("到期待回访"), String(stats.due), t("截至今天，全部未完成投入项"), 'calendar-clock'],
    ];
    for (let index = 0; index < entries.length; index++) {
      const [label, value, hint, symbol] = entries[index]!;
      const stat = el(strip, index === 3 ? 'button' : 'div', `ill-stat ${index === 3 && stats.due ? 'ill-due-stat' : ''}`);
      const line = el(stat, 'div', 'ill-stat-label'); el(line, 'span', '', label); icon(line, symbol);
      if (index === 0) {
        const balances = el(stat, 'div', `ill-currency-balances${stats.totals.length > 1 ? ' is-multi' : ''}`);
        for (const row of stats.totals) {
          const total = el(balances, 'div', 'ill-currency-total'); total.setAttribute('data-currency', row.currency);
          el(total, 'span', 'ill-currency-code', row.currency);
          el(total, 'strong', 'ill-stat-value', money(row.net, row.currency).replace(`${row.currency} `, ''));
          el(total, 'span', 'ill-stat-hint', t("支出 {0} · 退款 {1}", money(row.expense, row.currency), money(row.refund, row.currency)));
        }
      } else el(stat, 'strong', 'ill-stat-value', value);
      el(stat, 'span', 'ill-stat-hint', hint);
      if (index === 3) { stat.setAttribute('aria-label', t("查看到期待回访")); stat.addEventListener('click', () => { this.tab = 'items'; this.dueOnly = true; this.itemFilter = ''; this.keyword = ''; this.render(); }); }
    }
  }
  private renderNavigation(): void {
    const row = el(this.root, 'div', 'ill-navigation'); const tabs = el(row, 'nav', 'ill-tabs'); tabs.setAttribute('aria-label', t("账本视图"));
    for (const [value, label, symbol] of [['timeline', t("时间线"), 'list-tree'], ['items', t("投入项"), 'library'], ['summary', t("期间复盘"), 'chart-no-axes-combined']] as const) {
      const tab = button(tabs, label, () => { this.tab = value; this.render(true); }, this.tab === value ? 'is-active' : '', symbol); tab.setAttribute('aria-current', this.tab === value ? 'page' : 'false');
    }
    const actions = el(row, 'div', 'ill-inline');
    button(actions, t("导出 CSV"), () => this.act(async () => { const path = await this.host.store.writeExport(t("投入流水-{0}-{1}.csv", this.range.start, this.range.end), exportCsv(this.docs, this.range)); new Notice(t("已导出到 {0}", path), 8000); }), 'ill-text', 'download');
    button(actions, t("生成复盘"), () => new ReviewExportModal(this.app, async evaluation => { const path = await this.host.store.writeExport(t("投入复盘-{0}-{1}.md", this.range.start, this.range.end), exportReview(this.docs, this.range, evaluation)); await this.host.openPath(path); }).open(), 'ill-text', 'file-pen-line');
  }
  private renderQuick(): void {
    const quick = el(this.root, 'form', 'ill-quick');
    const intro = el(quick, 'div', 'ill-quick-label'); icon(intro, 'zap'); el(intro, 'span', '', t("快速记一笔"));
    const currency = el(quick, 'select', 'ill-quick-currency'); currency.setAttribute('aria-label', t("快速记录币种")); fillOptions(currency, CURRENCIES, this.draft.currency);
    currency.addEventListener('change', () => { this.draft = { ...this.draft, currency: currency.value as Currency }; amount.placeholder = decimal(0, this.draft.currency); });
    const amountWrap = el(quick, 'div', 'ill-quick-amount');
    const amount = el(amountWrap, 'input'); amount.type = 'text'; amount.inputMode = 'decimal'; amount.placeholder = decimal(0, this.draft.currency); amount.value = this.draft.amount; amount.required = true; amount.setAttribute('aria-label', t("快速记录金额"));
    amount.addEventListener('input', () => { this.draft = { ...this.draft, amount: amount.value }; });
    const title = el(quick, 'input', 'ill-quick-title'); title.type = 'text'; title.placeholder = t("这次投入是为了什么？"); title.value = this.draft.title; title.required = true; title.setAttribute('aria-label', t("快速记录用途"));
    title.addEventListener('input', () => { this.draft = { ...this.draft, title: title.value }; });
    const item = el(quick, 'select', 'ill-quick-item'); item.setAttribute('aria-label', t("快速记录投入项"));
    fillOptions(item, [['', t("新建投入项")], ...this.docs.map(doc => [doc.item.id, doc.item.name] as [string, string])], this.draft.itemId); item.addEventListener('change', () => { this.draft = { ...this.draft, itemId: item.value }; });
    button(quick, this.draft.notes.length ? t("已关联 {0} 篇", this.draft.notes.length) : t("关联笔记"), () => new FilePicker(this.app, path => { this.draft = { ...this.draft, notes: [...new Set([...this.draft.notes, path])] }; this.render(); }).open(), 'ill-text ill-quick-link', 'link');
    const save = el(quick, 'button', 'ill-btn ill-quick-save', this.quickSaving ? t("保存中…") : t("保存")); save.type = 'submit'; save.disabled = this.quickSaving;
    quick.addEventListener('submit', event => { event.preventDefault(); if (this.quickSaving) return; this.quickSaving = true; save.disabled = true;
      const submitted = this.draft;
      const snapshot = { ...submitted, notes: [...submitted.notes], demo: this.demo };
      void (async () => {
        const current = snapshot.itemId ? this.host.store.get(snapshot.itemId) : undefined;
        if (snapshot.itemId && !current) throw new Error(t("投入项已不存在，请重新选择。"));
        const doc = current || createDocument(snapshot.title, '其他', snapshot.demo);
        const expense = { ...baseEvent(doc.item.id, snapshot.title), type: 'expense' as const, amount: parseMoney(snapshot.amount, snapshot.currency), currency: snapshot.currency, notes: snapshot.notes };
        await this.host.store.save(putEvent(doc, expense), current);
        // Edits and ledger switches replace the draft while the write is pending.
        if (this.draft === submitted) {
          this.selected = doc.item.id; this.draft = { amount: '', title: '', itemId: snapshot.itemId, notes: [], error: '', currency: snapshot.currency };
        }
        new Notice(t("已保存，可在投入详情中补充购买原因和类型。"));
      })().catch(error => {
        if (this.draft === submitted) this.draft = { ...this.draft, error: errorMessage(error) };
        else new Notice(errorMessage(error), 10000);
      }).finally(() => { this.quickSaving = false; this.render(); });
    });
    if (this.draft.error) { const error = el(this.root, 'div', 'ill-quick-error', this.draft.error); error.setAttribute('role', 'alert'); }
  }
  private renderFilters(): void {
    const filters = el(this.root, 'div', 'ill-filters');
    const searchBox = el(filters, 'div', 'ill-search'); icon(searchBox, 'search');
    const search = el(searchBox, 'input'); search.placeholder = this.tab === 'items' ? t("搜索投入项、原因或笔记…") : t("搜索记录、投入项或笔记…"); search.value = this.keyword; search.setAttribute('aria-label', t("搜索账本"));
    search.addEventListener('input', () => { this.keyword = search.value; this.renderWorkspace(); });
    if (this.tab === 'timeline') {
      const type = el(filters, 'select'); type.setAttribute('aria-label', t("事件类型")); fillOptions(type, [['', t("全部事件")], ...EVENT_TYPES.map(kind => [kind, t(EVENT_LABELS[kind])] as [string, string])], this.eventType);
      type.addEventListener('change', () => { this.eventType = type.value as EventType | ''; this.renderWorkspace(); });
    }
    if (this.tab !== 'items') {
      const item = el(filters, 'select'); item.setAttribute('aria-label', t("筛选投入项")); fillOptions(item, [['', t("全部投入项")], ...this.docs.map(doc => [doc.item.id, doc.item.name] as [string, string])], this.itemFilter);
      item.addEventListener('change', () => { this.itemFilter = item.value; this.renderWorkspace(); });
    }
    if (this.tab === 'items') {
      button(filters, this.dueOnly ? t("仅待回访") : t("全部状态"), () => { this.dueOnly = !this.dueOnly; this.render(); }, this.dueOnly ? 'ill-small is-active' : 'ill-small', 'calendar-clock');
      button(filters, t("新建投入项"), () => new InvestmentModal(this.context()).open(), 'ill-small', 'plus');
    }
    if (this.tab === 'timeline') button(filters, this.newest ? t("从新到旧") : t("从旧到新"), () => { this.newest = !this.newest; this.render(); }, 'ill-text ill-sort', this.newest ? 'arrow-down-wide-narrow' : 'arrow-down-narrow-wide');
  }
  private renderWorkspace(preserveScroll = false): void {
    if (!this.workspace) return;
    const scroll = preserveScroll ? this.workspace.querySelector('.ill-primary-pane')?.scrollTop || 0 : 0;
    this.workspace.replaceChildren(); this.root.classList.toggle('ill-detail-open', this.detailsOpen);
    const docs = this.docs;
    if (!this.host.store.ready) { emptyState(this.workspace, t("正在读取账本…"), t("从库内 Markdown 文件构建时间线。"), 'loader'); return; }
    if (!docs.length) {
      const empty = emptyState(this.workspace, this.demo ? t("演示账本已清空") : t("从一份值得的投入开始"), t("记下第一笔课程、书籍或工具支出，再慢慢补上实践、成果和你的评价。"));
      const actions = el(empty, 'div', 'ill-empty-actions'); button(actions, t("记录第一笔投入"), () => this.eventForm('expense'), 'ill-primary', 'plus');
      button(actions, t("载入演示数据"), () => this.loadDemo(), '', 'flask-conical');
      el(empty, 'p', 'ill-empty-footnote', t("数据保存在你的 Obsidian 库内。演示数据单独存放，可随时清除。")); return;
    }
    if (!docs.some(doc => doc.item.id === this.selected)) this.selected = docs[0]!.item.id;
    const primary = el(this.workspace, 'main', 'ill-primary-pane ill-scroll');
    if (this.tab === 'timeline') this.renderTimeline(primary);
    if (this.tab === 'items') this.renderItems(primary);
    if (this.tab === 'summary') this.renderSummary(primary);
    const scrim = el(this.workspace, 'button', 'ill-detail-scrim'); scrim.type = 'button'; scrim.setAttribute('aria-label', t("关闭详情")); scrim.addEventListener('click', () => { this.detailsOpen = false; this.renderWorkspace(true); });
    const aside = el(this.workspace, 'aside', 'ill-details ill-scroll'); aside.setAttribute('aria-label', t("投入项详情")); this.renderDetails(aside, docs.find(doc => doc.item.id === this.selected)!);
    primary.scrollTop = scroll;
  }
  loadDemo(): void {
    this.act(async () => { const data = makeDemo(this.host.store.folder); await this.host.store.installDemo(data.docs, data.notes); this.demo = true; this.resetSelection(); this.range = { start: addDays(localDate(), -40), end: localDate() }; this.period = 'custom'; this.render(); new Notice(t("已载入独立的演示账本。")); });
  }
  private choose(doc: LedgerDocument, event?: LedgerEvent): void { this.selected = doc.item.id; this.selectedEvent = event?.id || ''; this.detailsOpen = true; this.renderWorkspace(true); }
  private renderTimeline(parent: HTMLElement): void {
    const events = filterEvents(this.docs, { range: this.range, type: this.eventType, itemId: this.itemFilter, keyword: this.keyword, newest: this.newest });
    const heading = el(parent, 'div', 'ill-section-head'); el(heading, 'h2', '', t("投入的轨迹")); el(heading, 'span', 'ill-muted', t("{0} 条记录", events.length));
    if (!events.length) { const empty = emptyState(parent, t("这个范围内还没有记录"), t("试试其他日期、事件类型，或清空搜索。"), 'list-filter'); button(empty, t("重置筛选"), () => { this.eventType = ''; this.itemFilter = ''; this.keyword = ''; this.range = { start: '1900-01-01', end: localDate() }; this.period = 'custom'; this.render(); }, 'ill-small'); return; }
    let previousDate = ''; let day: HTMLElement;
    for (const event of events) {
      const doc = this.docs.find(doc => doc.item.id === event.itemId)!;
      if (event.date !== previousDate) {
        day = el(parent, 'section', 'ill-day'); const date = el(day, 'div', 'ill-day-date'); el(date, 'strong', '', event.date.slice(5).replace('-', ' / ')); el(date, 'span', '', event.date.slice(0, 4)); previousDate = event.date;
      }
      const row = el(day!, 'div', 'ill-event-row'); const marker = el(row, 'span', `ill-event-marker ill-kind-${event.type}`); icon(marker, this.eventIcon(event.type));
      const card = el(row, 'article', `ill-event ${this.selectedEvent === event.id ? 'is-selected' : ''}`); card.tabIndex = 0; card.setAttribute('role', 'button'); card.setAttribute('aria-label', `${t(EVENT_LABELS[event.type])}：${event.title}`);
      card.addEventListener('click', () => this.choose(doc, event)); card.addEventListener('keydown', key => { if (key.target === card && (key.key === 'Enter' || key.key === ' ')) { key.preventDefault(); this.choose(doc, event); } });
      const top = el(card, 'div', 'ill-event-top');
      const tags = el(top, 'div', 'ill-inline'); el(tags, 'span', `ill-event-tag ill-kind-${event.type}`, t(EVENT_LABELS[event.type])); el(tags, 'span', 'ill-event-item', doc.item.name); el(tags, 'span', 'ill-event-time', event.time);
      if (event.type === 'expense' || event.type === 'refund') el(top, 'strong', `ill-event-money ${event.type === 'refund' ? 'ill-refund' : ''}`, `${event.type === 'refund' ? '+' : '−'}${money(event.amount, currencyOf(event))}`);
      el(card, 'h3', '', event.title);
      if (event.type === 'learning') el(card, 'p', 'ill-event-description', event.content);
      if (event.type === 'outcome') el(card, 'p', 'ill-event-description', event.content || t("已确认的成果"));
      if (event.type === 'review') el(card, 'p', 'ill-event-description', `${t(event.rating)} · ${event.usage}`);
      renderAttachments(card, this.app, event.attachments, { limit: 4 });
      const bottom = el(card, 'div', 'ill-event-bottom'); const links = el(bottom, 'div', 'ill-event-links');
      for (const path of [...new Set([...(event.type === 'outcome' ? [event.target] : []), ...event.notes])].slice(0, 3)) this.link(links, path);
      if (event.type === 'learning' && event.minutes) el(links, 'span', 'ill-duration', t("{0} 分钟", event.minutes));
      const actions = el(bottom, 'div', 'ill-event-actions');
      const edit = iconButton(actions, 'pencil', t("编辑{0}", event.title), () => this.eventForm(event.type, doc, event)); edit.addEventListener('click', event => event.stopPropagation());
      if (event.type === 'expense') { const refund = iconButton(actions, 'undo-2', t("为{0}退款", event.title), () => this.eventForm('refund', doc, undefined, { expenseId: event.id })); refund.addEventListener('click', e => e.stopPropagation()); }
      if (event.type !== 'review') { const remove = iconButton(actions, event.type === 'outcome' ? 'unlink' : 'trash-2', event.type === 'outcome' ? t("解除关联{0}", event.title) : t("删除{0}", event.title), () => this.deleteEvent(doc, event)); remove.addEventListener('click', e => e.stopPropagation()); }
    }
    const end = el(parent, 'div', 'ill-timeline-end'); icon(end, 'check'); el(end, 'span', '', t("每一次实践，都让投入有了新的意义。"));
  }
  private eventIcon(kind: EventType): string { return { expense: 'credit-card', refund: 'undo-2', learning: 'book-open', outcome: 'sprout', review: 'message-square-text' }[kind]; }
  private link(parent: HTMLElement, path: string): void {
    const missing = !this.app.vault.getAbstractFileByPath(path);
    const link = button(parent, `${shortPath(path)}${missing ? t(" · 链接失效") : ''}`, () => this.act(async () => {
      if (missing) { new Notice(t("链接失效。请编辑这条记录，移除旧链接并重新选择库内文件。"), 8000); return; }
      await this.host.openPath(path);
    }), `ill-note-link ${missing ? 'ill-broken' : ''}`, missing ? 'file-warning' : 'file-text');
    link.title = path; link.addEventListener('click', event => event.stopPropagation());
  }
  private deleteEvent(doc: LedgerDocument, event: LedgerEvent): void {
    const unlink = event.type === 'outcome';
    new ConfirmModal(this.app, unlink ? t("解除成果关联") : t("删除{0}", t(EVENT_LABELS[event.type])), unlink ? t("解除「{0}」与此投入项的关联，成果文件会保留。", event.title) : t("删除「{0}」{1}后，统计会重新计算。", event.title, event.type === 'expense' || event.type === 'refund' ? `（${money(event.amount, currencyOf(event))}）` : ''), async () => { await this.host.store.save(removeEvent(doc, event.id), doc); }, unlink ? t("解除关联") : t("确认删除")).open();
  }
  private renderItems(parent: HTMLElement): void {
    const docs = this.docs.filter(doc => (!this.dueOnly || isDue(doc)) && (!this.keyword || JSON.stringify([doc.item, t(doc.item.type), t(doc.item.status)]).toLocaleLowerCase().includes(this.keyword.toLocaleLowerCase())));
    const heading = el(parent, 'div', 'ill-section-head'); el(heading, 'h2', '', this.dueOnly ? t("到期待回访") : t("我的投入项")); el(heading, 'span', 'ill-muted', t("{0} 项 · 不受日期范围限制", docs.length));
    if (!docs.length) { emptyState(parent, this.dueOnly ? t("没有到期待回访的投入项") : t("没有匹配的投入项"), t("可以调整筛选，或新建一项投入。"), 'library'); return; }
    for (const doc of docs) {
      const card = el(parent, 'article', `ill-item-card ${this.selected === doc.item.id ? 'is-selected' : ''}`); card.tabIndex = 0; card.setAttribute('role', 'button'); card.setAttribute('aria-label', t("查看{0}", doc.item.name)); card.addEventListener('click', () => this.choose(doc)); card.addEventListener('keydown', e => { if (e.target === card && e.key === 'Enter') this.choose(doc); });
      const top = el(card, 'div', 'ill-section-head'); el(top, 'span', 'ill-type-label', t(doc.item.type)); el(top, 'span', isDue(doc) ? 'ill-review-due' : 'ill-muted', isDue(doc) ? t("待回访 · {0}", doc.item.nextReview) : t(doc.item.status));
      el(card, 'h3', '', doc.item.name); el(card, 'p', 'ill-muted', doc.item.reason || t("还没有填写购买原因。"));
      const bottom = el(card, 'div', 'ill-section-head'); el(bottom, 'strong', '', netAmounts(summarize([doc], { start: '0001-01-01', end: '9999-12-31' }))); el(bottom, 'span', 'ill-muted', t("{0} 条记录", doc.events.length));
    }
  }
  private renderSummary(parent: HTMLElement): void {
    const docs = this.docs.filter(doc => (!this.itemFilter || doc.item.id === this.itemFilter) && (!this.keyword || JSON.stringify([doc, t(doc.item.type), t(doc.item.status)]).toLocaleLowerCase().includes(this.keyword.toLocaleLowerCase())));
    const stats = summarize(docs, this.range);
    const heading = el(parent, 'div', 'ill-section-head'); el(heading, 'h2', '', t("这段时间，投入去了哪里")); el(heading, 'span', 'ill-muted', `${this.range.start} — ${this.range.end}`);
    el(parent, 'p', 'ill-hint', t("按币种分别统计，不进行汇率换算。"));
    for (const balance of stats.totals) {
      const chart = el(parent, 'div', 'ill-breakdown'); chart.setAttribute('data-currency', balance.currency);
      el(chart, 'h3', '', balance.currency);
      const max = Object.values(balance.byType).reduce((largest, row) => BigInt(row.expense) > largest ? BigInt(row.expense) : largest, 1n);
      for (const type of ITEM_TYPES) {
        const row = el(chart, 'div', 'ill-breakdown-row'); el(row, 'span', '', t(type)); const bar = el(row, 'div', 'ill-bar-track'); const fill = el(bar, 'span', `ill-bar-fill ill-bar-${ITEM_TYPES.indexOf(type)}`);
        // Only the bounded visual percentage becomes a Number; amounts stay exact.
        fill.style.width = `${Number(BigInt(balance.byType[type].expense) * 100_000n / max) / 1000}%`;
        const amount = el(row, 'div', 'ill-breakdown-amount'); el(amount, 'strong', '', money(balance.byType[type].net, balance.currency)); if (balance.byType[type].refund) el(amount, 'small', '', t("含退款 {0}", money(balance.byType[type].refund, balance.currency)));
      }
      el(chart, 'p', 'ill-hint', t("条形长度表示支出总额；右侧金额为扣除期间退款后的净支出。"));
    }
    for (const type of ITEM_TYPES) {
      const group = docs.filter(doc => doc.item.type === type && doc.events.some(e => inRange(e, this.range))); if (!group.length) continue;
      el(parent, 'h3', 'ill-summary-type', t(type));
      for (const doc of group) {
        const section = el(parent, 'section', 'ill-summary-item'); const top = el(section, 'div', 'ill-section-head'); button(top, doc.item.name, () => this.choose(doc), 'ill-text'); el(top, 'strong', '', netAmounts(summarize([doc], this.range)));
        const entries = doc.events.filter(e => inRange(e, this.range));
        el(section, 'p', 'ill-muted', t("{0} 次学习 / 使用 · {1} 项成果关联", entries.filter(e => e.type === 'learning').length, entries.filter(e => e.type === 'outcome').length));
        for (const event of entries.filter(e => e.type === 'learning' || e.type === 'outcome')) {
          const log = el(section, 'div', 'ill-summary-log');
          button(log, `${event.date} · ${event.title}`, () => this.choose(doc, event), 'ill-text', this.eventIcon(event.type));
          if (event.type === 'learning' && event.minutes) el(log, 'span', 'ill-hint', t("{0} 分钟", event.minutes));
          if (event.type === 'outcome') this.link(log, event.target);
        }
        const links = el(section, 'div', 'ill-summary-links'); for (const path of [...new Set([doc.item.project, ...doc.item.notes, ...entries.flatMap(e => e.type === 'outcome' ? [e.target, ...e.notes] : e.notes)].filter(Boolean))]) this.link(links, path);
      }
    }
    if (!docs.some(doc => doc.events.some(e => inRange(e, this.range)))) emptyState(parent, t("本期还没有投入记录"), t("调整时间范围，或记录一笔新的投入。"), 'chart-no-axes-combined');
    el(parent, 'p', 'ill-summary-footnote', t("顶部统计与导出按完整期间计算；此处列表可按投入项和关键词进一步筛选。"));
  }
  private renderDetails(parent: HTMLElement, doc: LedgerDocument): void {
    const top = el(parent, 'div', 'ill-detail-top'); el(top, 'span', 'ill-muted', t("投入详情")); iconButton(top, 'x', t("关闭投入详情"), () => { this.detailsOpen = false; this.renderWorkspace(true); }).classList.add('ill-detail-close');
    const tags = el(parent, 'div', 'ill-detail-tags'); el(tags, 'span', 'ill-type-label', t(doc.item.type)); el(tags, 'span', 'ill-status', t(doc.item.status)); if (doc.demo) el(tags, 'span', 'ill-status', t("演示"));
    el(parent, 'h2', 'ill-detail-title', doc.item.name);
    const total = summarize([doc], { start: '0001-01-01', end: '9999-12-31' });
    for (const row of total.totals) el(parent, 'div', 'ill-detail-amount', `${row.currency === 'CNY' ? 'CNY ' : ''}${money(row.net, row.currency)}`);
    el(parent, 'p', 'ill-hint', t("累计净投入 · {0} 笔支出{1}", doc.events.filter(e => e.type === 'expense').length, total.totals.some(row => row.refund) ? t(" · 已退 {0}", total.totals.filter(row => row.refund).map(row => money(row.refund, row.currency)).join(' · ')) : ''));
    button(parent, t("编辑投入项"), () => new InvestmentModal(this.context(), doc).open(), 'ill-small', 'pencil');
    const reason = this.detailSection(parent, t("最初为什么投入")); el(reason, 'p', '', doc.item.reason || t("补充购买原因，给下次回访留一个参照。"));
    const actions = el(parent, 'div', 'ill-detail-actions');
    for (const [kind, label, symbol] of [['expense', t("追加支出"), 'plus'], ['learning', t("记录学习"), 'book-open'], ['outcome', t("关联成果"), 'sprout'], ['review', t("做一次回访"), 'message-square-text']] as const) button(actions, label, () => this.eventForm(kind, doc), 'ill-small', symbol);
    const notes = this.detailSection(parent, t("项目与相关笔记"));
    if (doc.item.project) { el(notes, 'span', 'ill-hint', t("所属项目")); this.link(notes, doc.item.project); }
    for (const path of doc.item.notes) this.link(notes, path);
    if (!doc.item.project && !doc.item.notes.length) el(notes, 'p', 'ill-muted', t("还没有关联笔记。"));
    button(notes, t("添加或重新关联"), () => new InvestmentModal(this.context(), doc).open(), 'ill-text', 'link');
    if (doc.item.attachments?.length) renderAttachments(this.detailSection(parent, t("投入项附件")), this.app, doc.item.attachments);
    const learning = doc.events.filter(e => e.type === 'learning');
    const activity = this.detailSection(parent, t("实际行动 · {0}", learning.length));
    for (const e of learning.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4)) {
      const row = el(activity, 'div', 'ill-detail-entry'); button(row, e.title, () => this.eventForm(e.type, doc, e), 'ill-text'); el(row, 'span', 'ill-hint', `${e.date}${e.type === 'learning' && e.minutes ? t(" · {0} 分钟", e.minutes) : ''}`);
    }
    if (!learning.length) el(activity, 'p', 'ill-muted', t("记下第一次练习或使用。"));
    const outcomes = doc.events.filter(e => e.type === 'outcome'); const results = this.detailSection(parent, t("留下的成果 · {0}", new Set(outcomes.map(e => e.type === 'outcome' ? e.target : '')).size));
    for (const e of outcomes) if (e.type === 'outcome') { const row = el(results, 'div', 'ill-detail-entry'); this.link(row, e.target); button(row, t("编辑关联"), () => this.eventForm('outcome', doc, e), 'ill-text ill-tiny'); }
    if (!outcomes.length) el(results, 'p', 'ill-muted', t("完成后，主动关联你的作品或文件。"));
    const review = this.detailSection(parent, t("回访"));
    const reminder = el(review, 'div', isDue(doc) ? 'ill-review-banner is-due' : 'ill-review-banner'); icon(reminder, 'calendar-clock');
    const label = el(reminder, 'div'); el(label, 'strong', '', isDue(doc) ? t("已到期，等你回访") : doc.item.nextReview ? t("下次回访") : t("暂未安排回访")); el(label, 'span', '', doc.item.nextReview || t("可以随时记录一次评价"));
    const reviews = doc.events.filter(e => e.type === 'review').sort((a, b) => b.date.localeCompare(a.date));
    for (const e of reviews) if (e.type === 'review') {
      const row = el(review, 'div', 'ill-detail-entry'); const title = el(row, 'div', 'ill-section-head'); el(title, 'span', 'ill-hint', e.date); el(title, 'span', 'ill-status', t(e.rating)); el(row, 'p', '', e.usage); el(row, 'p', 'ill-muted', t("下一步：{0}", e.plan)); button(row, t("查看 / 编辑回访"), () => this.eventForm('review', doc, e), 'ill-text ill-tiny');
    }
    if (this.selectedEvent) {
      const event = doc.events.find(e => e.id === this.selectedEvent);
      if (event) { const selected = this.detailSection(parent, t("选中事件 · {0}", t(EVENT_LABELS[event.type]))); el(selected, 'strong', '', event.title); el(selected, 'p', 'ill-hint', `${event.date} ${event.time}`); for (const path of event.notes) this.link(selected, path); renderAttachments(selected, this.app, event.attachments); button(selected, t("查看 / 编辑记录"), () => this.eventForm(event.type, doc, event), 'ill-small', 'pencil'); }
    }
    const footer = el(parent, 'div', 'ill-detail-footer'); button(footer, t("打开源文件"), () => this.act(async () => { const path = this.host.store.pathFor(doc.item.id); if (path) await this.host.openPath(path); }), 'ill-text', 'file-code');
    button(footer, t("删除投入项"), () => new ConfirmModal(this.app, t("删除整个投入项"), t("将「{0}」及其 {1} 条事件移到库内回收站。关联的项目、笔记和成果文件会保留。", doc.item.name, doc.events.length), async () => { await this.host.store.delete(doc.item.id, doc); this.selected = ''; this.detailsOpen = false; this.render(); }).open(), 'ill-text ill-danger-text');
  }
  private detailSection(parent: HTMLElement, title: string): HTMLElement { const section = el(parent, 'section', 'ill-detail-section'); el(section, 'h3', '', title); return section; }
}
