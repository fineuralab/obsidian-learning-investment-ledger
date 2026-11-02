import { t } from './i18n';
import { Attachment, attachmentMarkdown, validateAttachments } from './attachments';
/** Pure domain rules. Money is always an integer number of fen (CNY). */
export const ITEM_TYPES = ['课程', '书籍', '工具', '创作项目', '其他'] as const;
export const STATUSES = ['未开始', '进行中', '已完成', '已搁置'] as const;
export const EVENT_TYPES = ['expense', 'refund', 'learning', 'outcome', 'review'] as const;
export const EVENT_LABELS = { expense: '支出', refund: '退款', learning: '学习 / 使用', outcome: '成果', review: '回访' } as const;
export const RATINGS = ['达到', '部分达到', '未达到', '暂无法判断'] as const;
export type ItemType = typeof ITEM_TYPES[number];
export type Status = typeof STATUSES[number];
export type EventType = typeof EVENT_TYPES[number];
export type Rating = typeof RATINGS[number];

export interface Investment {
  id: string;
  name: string;
  type: ItemType;
  reason: string;
  project: string;
  notes: string[];
  attachments?: Attachment[];
  status: Status;
  nextReview: string | null;
  createdAt: string;
  updatedAt: string;
}
interface EventBase {
  id: string;
  itemId: string;
  type: EventType;
  date: string;
  time: string;
  title: string;
  notes: string[];
  attachments?: Attachment[];
  createdAt: string;
}
export interface Expense extends EventBase { type: 'expense'; amount: number }
export interface Refund extends EventBase { type: 'refund'; amount: number; expenseId: string }
export interface Learning extends EventBase { type: 'learning'; content: string; minutes: number | null }
export interface Outcome extends EventBase { type: 'outcome'; target: string; content: string }
export interface Review extends EventBase {
  type: 'review';
  expectation: string;
  usage: string;
  outcomes: string;
  rating: Rating;
  plan: string;
  nextReview: string | null;
}
export type LedgerEvent = Expense | Refund | Learning | Outcome | Review;
export interface LedgerDocument {
  ledger: 'learning-investment-ledger';
  schema: 1;
  demo: boolean;
  item: Investment;
  events: LedgerEvent[];
  /** User-owned Markdown below the generated section. */
  appendix: string;
}
export interface DateRange { start: string; end: string }
export interface EventFilter { range: DateRange; type?: EventType | ''; itemId?: string; keyword?: string; newest?: boolean }
export interface Stats {
  expense: number; refund: number; net: number;
  projects: number; outcomes: number; due: number;
  byType: Record<ItemType, { expense: number; refund: number; net: number }>;
}

export class LedgerError extends Error {}
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const uid = (): string => crypto.randomUUID();
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function localTime(date = new Date()): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
export function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && localDate(date) === value && value >= '0001-01-01';
}
export function addDays(value: string, days: number): string {
  if (!validDate(value)) throw new LedgerError(t("日期无效，请使用 YYYY-MM-DD。"));
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDate(date);
}
export function monthRange(today = localDate()): DateRange {
  return { start: `${today.slice(0, 7)}-01`, end: localDate(new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0, 12)) };
}
export function last30Range(today = localDate()): DateRange { return { start: addDays(today, -29), end: today }; }
export function validateRange(range: DateRange): void {
  if (!validDate(range.start) || !validDate(range.end) || range.start > range.end) throw new LedgerError(t("请选择有效的起止日期，开始日期不能晚于结束日期。"));
}
export function parseMoney(input: string): number {
  const text = input.trim();
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(text)) throw new LedgerError(t("金额须大于 0，最多保留两位小数。"));
  const [whole = '', fraction = ''] = text.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new LedgerError(t("金额须大于 0，最多保留两位小数。"));
  return amount;
}
export function decimal(amount: number): string {
  return `${amount < 0 ? '-' : ''}${Math.floor(Math.abs(amount) / 100)}.${String(Math.abs(amount) % 100).padStart(2, '0')}`;
}
export function money(amount: number): string {
  const [whole = '0', fraction = '00'] = decimal(amount).split('.');
  return `¥${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new LedgerError(message); }
function nonempty(value: unknown, label: string): asserts value is string { assert(typeof value === 'string' && value.trim().length > 0, t("{0}不能为空。", label)); }
function text(value: unknown, label: string): asserts value is string { assert(typeof value === 'string', t("{0}必须是文本。", label)); }
function paths(value: unknown, label: string): asserts value is string[] {
  assert(Array.isArray(value) && value.every(p => typeof p === 'string' && p.trim().length > 0), t("{0}必须是库内路径列表。", label));
}
function optionalDate(value: unknown, label: string): void { assert(value === null || validDate(value), t("{0}无效。", label)); }
function timestamp(value: unknown, label: string): void { assert(typeof value === 'string' && !Number.isNaN(Date.parse(value)), t("{0}无效。", label)); }
function positiveAmount(value: unknown): void { assert(typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 999999999999, t("金额必须是大于 0 的整数分，且不超过 99.99 亿元。")); }

/** Validate untrusted Markdown, including cross-event invariants before it enters the cache. */
export function validateDocument(input: unknown): asserts input is LedgerDocument {
  assert(input !== null && typeof input === 'object', t("记录不是有效对象。"));
  const doc = input as LedgerDocument;
  assert(doc.ledger === 'learning-investment-ledger', t("不是投入账本文件。"));
  assert(doc.schema === 1, t("文件版本不受支持，请使用兼容版本的插件。"));
  assert(typeof doc.demo === 'boolean', t("演示数据标记无效。"));
  assert(doc.item && typeof doc.item === 'object', t("缺少投入项。"));
  const item = doc.item;
  nonempty(item.id, t("投入项 ID")); nonempty(item.name, t("名称"));
  assert(ITEM_TYPES.includes(item.type), t("投入类型无效。"));
  assert(STATUSES.includes(item.status), t("投入状态无效。"));
  text(item.reason, t("购买原因")); text(item.project, t("所属项目")); paths(item.notes, t("相关笔记"));
  validateAttachments(item.attachments);
  optionalDate(item.nextReview, t("下次回访日期")); timestamp(item.createdAt, t("创建时间")); timestamp(item.updatedAt, t("更新时间"));
  assert(Array.isArray(doc.events), t("事件列表无效。"));
  const ids = new Set<string>([item.id]);
  for (const event of doc.events) {
    assert(event && typeof event === 'object', t("事件无效。"));
    nonempty(event.id, t("事件 ID"));
    assert(!ids.has(event.id), t("ID 重复：{0}", event.id)); ids.add(event.id);
    assert(event.itemId === item.id, t("事件所属投入项不一致。"));
    assert(EVENT_TYPES.includes(event.type), t("事件类型无效。"));
    assert(validDate(event.date), t("事件「{0}」日期无效。", event.title));
    assert(typeof event.time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(event.time), t("事件时间无效。"));
    nonempty(event.title, t("用途或标题")); paths(event.notes, t("事件笔记")); timestamp(event.createdAt, t("事件创建时间"));
    validateAttachments(event.attachments);
    if (event.type === 'expense' || event.type === 'refund') positiveAmount(event.amount);
    if (event.type === 'refund') nonempty(event.expenseId, t("原支出"));
    if (event.type === 'learning') {
      nonempty(event.content, t("学习或使用内容"));
      assert(event.minutes === null || (Number.isSafeInteger(event.minutes) && event.minutes > 0), t("时长须为正整数分钟，或留空。"));
    }
    if (event.type === 'outcome') { nonempty(event.target, t("成果链接")); text(event.content, t("成果说明")); }
    if (event.type === 'review') {
      text(event.expectation, t("最初期望")); nonempty(event.usage, t("实际使用情况")); text(event.outcomes, t("成果"));
      assert(RATINGS.includes(event.rating), t("回访评价无效。")); nonempty(event.plan, t("下一步计划")); optionalDate(event.nextReview, t("下次回访日期"));
      if (event.nextReview) assert(event.nextReview > event.date, t("下次回访日期须晚于本次回访日期。"));
    }
  }
  for (const refund of doc.events.filter((e): e is Refund => e.type === 'refund')) {
    const original = doc.events.find((e): e is Expense => e.id === refund.expenseId && e.type === 'expense');
    assert(original, t("退款「{0}」关联的原支出不存在。", refund.title));
    assert(`${refund.date}T${refund.time}` >= `${original.date}T${original.time}`, t("退款发生时间不能早于原支出。"));
    const total = doc.events.reduce((sum, e) => sum + (e.type === 'refund' && e.expenseId === original.id ? e.amount : 0), 0);
    assert(total <= original.amount, t("「{0}」累计退款不能超过 {1}。", original.title, money(original.amount)));
  }
  text(doc.appendix, t("补充笔记"));
}
export function createDocument(name: string, type: ItemType = '其他', demo = false): LedgerDocument {
  const now = new Date().toISOString();
  return { ledger: 'learning-investment-ledger', schema: 1, demo, item: { id: uid(), name: name.trim(), type, reason: '', project: '', notes: [], status: '未开始', nextReview: null, createdAt: now, updatedAt: now }, events: [], appendix: '' };
}
export function baseEvent(itemId: string, title: string, date = localDate()): Omit<EventBase, 'type'> {
  return { id: uid(), itemId, title: title.trim(), date, time: localTime(), notes: [], createdAt: new Date().toISOString() };
}
export function refunded(doc: LedgerDocument, expenseId: string, excluding = ''): number {
  return doc.events.reduce((sum, e) => sum + (e.type === 'refund' && e.expenseId === expenseId && e.id !== excluding ? e.amount : 0), 0);
}
export function putEvent(doc: LedgerDocument, event: LedgerEvent, suggestedReview?: string | null): LedgerDocument {
  const next = clone(doc);
  const index = next.events.findIndex(e => e.id === event.id);
  const firstExpense = !next.events.some(e => e.type === 'expense');
  if (index < 0) next.events.push(clone(event)); else next.events[index] = clone(event);
  if (event.type === 'expense' && firstExpense && !next.item.nextReview) next.item.nextReview = suggestedReview === undefined ? addDays(event.date, 30) : suggestedReview;
  // Editing older history must not overwrite the schedule created by a later review.
  if (event.type === 'review') {
    const previous = doc.events.filter((e): e is Review => e.type === 'review').sort(compareEvents).pop();
    const reviews = [...next.events].filter((e): e is Review => e.type === 'review').sort(compareEvents);
    const latest = reviews[reviews.length - 1];
    if (latest?.id === event.id || previous?.id === event.id) next.item.nextReview = latest?.nextReview ?? null;
  }
  next.item.updatedAt = new Date().toISOString();
  validateDocument(next);
  return next;
}
export function removeEvent(doc: LedgerDocument, eventId: string): LedgerDocument {
  const event = doc.events.find(e => e.id === eventId);
  assert(event, t("这条记录已不存在，请刷新后重试。"));
  assert(event.type !== 'review', t("回访历史应保留，可以编辑，不能删除。"));
  assert(!doc.events.some(e => e.type === 'refund' && e.expenseId === eventId), t("请先删除该笔支出关联的退款，再删除原支出。"));
  const next = clone(doc); next.events = next.events.filter(e => e.id !== eventId); next.item.updatedAt = new Date().toISOString();
  validateDocument(next); return next;
}
export function isDue(doc: LedgerDocument, today = localDate()): boolean {
  return doc.item.status !== '已完成' && doc.item.nextReview !== null && doc.item.nextReview <= today;
}
export function compareEvents(a: LedgerEvent, b: LedgerEvent): number {
  return `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}
export function inRange(event: LedgerEvent, range: DateRange): boolean { return event.date >= range.start && event.date <= range.end; }
export function filterEvents(docs: LedgerDocument[], filter: EventFilter): LedgerEvent[] {
  const keyword = filter.keyword?.trim().toLocaleLowerCase() || '';
  const events = docs.flatMap(doc => doc.events.filter(event => {
    if (!inRange(event, filter.range) || (filter.type && event.type !== filter.type) || (filter.itemId && doc.item.id !== filter.itemId)) return false;
    return !keyword || JSON.stringify([doc.item.name, doc.item.reason, doc.item.type, t(doc.item.type), t(EVENT_LABELS[event.type]), doc.item.project, doc.item.notes, event]).toLocaleLowerCase().includes(keyword);
  }));
  return events.sort((a, b) => (filter.newest ? -1 : 1) * compareEvents(a, b));
}
export function summarize(docs: LedgerDocument[], range: DateRange, today = localDate()): Stats {
  const result: Stats = { expense: 0, refund: 0, net: 0, projects: 0, outcomes: 0, due: 0, byType: Object.fromEntries(ITEM_TYPES.map(type => [type, { expense: 0, refund: 0, net: 0 }])) as Stats['byType'] };
  const projects = new Set<string>(); const outcomes = new Set<string>();
  for (const doc of docs) {
    if (isDue(doc, today)) result.due++;
    for (const event of doc.events.filter(e => inRange(e, range))) {
      if (doc.item.project) projects.add(doc.item.project);
      if (event.type === 'outcome') outcomes.add(event.target);
      if (event.type === 'expense' || event.type === 'refund') {
        result[event.type] += event.amount;
        result.byType[doc.item.type][event.type] += event.amount;
      }
    }
  }
  result.net = result.expense - result.refund; result.projects = projects.size; result.outcomes = outcomes.size;
  for (const row of Object.values(result.byType)) row.net = row.expense - row.refund;
  return result;
}
export function renameLinks(doc: LedgerDocument, oldPath: string, newPath: string): LedgerDocument {
  const next = clone(doc);
  const rename = (p: string): string => p === oldPath ? newPath : p.startsWith(`${oldPath}/`) ? newPath + p.slice(oldPath.length) : p;
  next.item.project = rename(next.item.project); next.item.notes = next.item.notes.map(rename);
  const attachments = (values: Attachment[] | undefined): void => { for (const a of values || []) if (a.kind === 'file') a.target = rename(a.target); };
  attachments(next.item.attachments);
  for (const event of next.events) { event.notes = event.notes.map(rename); attachments(event.attachments); if (event.type === 'outcome') event.target = rename(event.target); }
  return next;
}
function csvCell(value: string): string {
  // Protect spreadsheet viewers from formula injection while keeping numeric amount columns numeric.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
export function exportCsv(docs: LedgerDocument[], range: DateRange): string {
  validateRange(range);
  const byId = new Map(docs.map(doc => [doc.item.id, doc]));
  const rows = [[t("记录ID"), t("投入项ID"), t("日期"), t("时间"), t("事件类型"), t("投入项"), t("分类"), t("用途"), t("金额（元）"), t("净支出影响（元）"), t("原支出ID"), t("关联笔记"), t("附件链接"), t("演示数据")].map(csvCell).join(',')];
  for (const event of filterEvents(docs, { range })) {
    if (event.type !== 'expense' && event.type !== 'refund') continue;
    const doc = byId.get(event.itemId)!;
    const fields = [event.id, event.itemId, event.date, event.time, t(EVENT_LABELS[event.type]), doc.item.name, t(doc.item.type), event.title];
    rows.push([...fields.map(csvCell), decimal(event.amount), decimal(event.type === 'refund' ? -event.amount : event.amount), ...[event.type === 'refund' ? event.expenseId : '', event.notes.join(' | '), (event.attachments || []).map(a => a.target).join(' | '), doc.demo ? t("是") : t("否")].map(csvCell)].join(','));
  }
  return '\uFEFF' + rows.join('\r\n') + '\r\n';
}
export function wiki(path: string): string { return `[[${path.replace(/\]/g, '\\]').replace(/\[/g, '\\[')}]]`; }
export function exportReview(docs: LedgerDocument[], range: DateRange, evaluation = '', today = localDate()): string {
  validateRange(range);
  const stats = summarize(docs, range, today);
  const events = filterEvents(docs, { range });
  const lines = [t("# 投入复盘 · {0} 至 {1}", range.start, range.end), '', t("- 期间净支出：{0}", money(stats.net)), t("- 支出：{0}；退款：{1}", money(stats.expense), money(stats.refund)), t("- 关联项目：{0}；关联成果：{1}", stats.projects, stats.outcomes), '', t("## 主要投入"), '', t("| 投入项 | 类型 | 期间净支出 | 项目与笔记 |"), '| --- | --- | ---: | --- |'];
  for (const doc of docs.filter(doc => events.some(e => e.itemId === doc.item.id))) {
    const net = summarize([doc], range, today).net;
    lines.push(`| ${doc.item.name.replace(/\|/g, '\\|').replace(/\n/g, ' ')} | ${t(doc.item.type)} | ${money(net)} | ${[doc.item.project, ...doc.item.notes].filter(Boolean).map(wiki).join('、')} |`);
  }
  lines.push('', t("## 学习与使用"), '');
  const learning = events.filter((e): e is Learning => e.type === 'learning');
  for (const e of learning) lines.push(`- ${e.date} ${e.title}${e.minutes ? t("（{0} 分钟）", e.minutes) : ''}：${e.content.replace(/\n/g, ' ')} ${e.notes.map(wiki).join('、')}`);
  if (!learning.length) lines.push(t("本期暂无学习或使用记录。"));
  lines.push('', t("## 关联成果"), '');
  const seen = new Set<string>();
  for (const e of events) { if (e.type === 'outcome' && !seen.has(e.target)) { lines.push(`- ${e.title}：${wiki(e.target)}`); seen.add(e.target); } }
  if (!seen.size) lines.push(t("本期暂无已确认的成果。"));
  lines.push('', t("## 待回访事项"), '');
  const due = docs.filter(doc => isDue(doc, today));
  for (const doc of due) lines.push(`- [ ] ${doc.item.name}（${doc.item.nextReview}）：${doc.item.reason || t("补充最初的购买原因。")}`);
  if (!due.length) lines.push(t("当前没有到期未完成的回访。"));
  lines.push('', t("## 回访记录"), '');
  const reviews = events.filter((e): e is Review => e.type === 'review');
  for (const e of reviews) lines.push(`### ${e.date} · ${docs.find(d => d.item.id === e.itemId)!.item.name}`, '', t("- 最初期望：{0}", e.expectation || t("未填写")), t("- 实际使用：{0}", e.usage), t("- 留下的成果：{0}", e.outcomes || t("未填写")), t("- 是否达到预期：{0}", t(e.rating)), t("- 下一步：{0}", e.plan), '');
  if (!reviews.length) lines.push(t("本期暂无回访记录。"));
  const related = docs.filter(doc => events.some(e => e.itemId === doc.item.id));
  if (related.some(doc => doc.item.attachments?.length) || events.some(e => e.attachments?.length)) {
    lines.push('', t("## 记录附件"), '');
    for (const doc of related) {
      if (doc.item.attachments?.length) lines.push(t("### {0} · 投入项附件", doc.item.name), '', ...doc.item.attachments.map(a => `- ${attachmentMarkdown(a)}`), '');
      for (const e of events.filter(e => e.itemId === doc.item.id && e.attachments?.length)) lines.push(`### ${e.date} · ${doc.item.name} · ${e.title}`, '', ...e.attachments!.map(a => `- ${attachmentMarkdown(a)}`), '');
    }
  }
  lines.push('', t("## 我的评价"), '', evaluation.trim() || t("（写下哪些投入值得继续，哪些需要调整。）"), '', t("> 统计范围为自然日，含起止日期。净支出按支出和退款各自的发生日期计算。待回访截至 {0}，不受期间筛选影响。", today), '');
  return lines.join('\n');
}
