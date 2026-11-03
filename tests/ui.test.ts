import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';
import { baseEvent, createDocument, DateRange, LedgerDocument, LedgerEvent, putEvent } from '../src/domain';
import { encodeDocument } from '../src/codec';
import type { LedgerStore, StoragePort } from '../src/store';

/** In-memory DOM contract for exercising actual view/form handlers without Obsidian. */
class Target {
  listeners: Record<string, ((event: Event) => void)[]> = {};
  addEventListener(name: string, listener: (event: Event) => void): void { (this.listeners[name] ??= []).push(listener); }
  removeEventListener(name: string, listener: (event: Event) => void): void { this.listeners[name] = (this.listeners[name] ?? []).filter(value => value !== listener); }
  dispatch(name: string): void {
    const event = { target: this, preventDefault() {}, stopPropagation() {} } as unknown as Event;
    for (const listener of this.listeners[name] ?? []) listener(event);
  }
}
class Element extends Target {
  children: Element[] = [];
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  className = '';
  textContent = '';
  disabled = false;
  inert = false;
  hidden = false;
  style: Record<string, string> = {};
  private selectedValue = '';
  classList = { add() {}, remove() {}, toggle() {} };
  ownerDocument = document;
  constructor(readonly tag: string) { super(); }
  append(node: Element): void { this.children.push(node); }
  replaceChildren(...nodes: Element[]): void { this.children = nodes; this.selectedValue = ''; }
  setAttribute(name: string, value: string): void { this.attributes[name] = value; }
  removeAttribute(name: string): void { delete this.attributes[name]; }
  get options(): Element[] { return this.children.filter(node => node.tag === 'option'); }
  get value(): string {
    return this.tag === 'select' ? (this.options.find(node => node.value === this.selectedValue)?.value ?? this.options[0]?.value ?? '') : this.selectedValue;
  }
  set value(value: string) { this.selectedValue = value; }
  querySelector(): null { return null; }
  focus(): void {}
  scrollIntoView(): void {}
}
class TestWindow extends Target {
  intervals = new Map<number, () => void>();
  private nextInterval = 0;
  setInterval(callback: () => void, _delay: number): number { const id = ++this.nextInterval; this.intervals.set(id, callback); return id; }
  clearInterval(id: number): void { this.intervals.delete(id); }
}
const document = new class extends Target {
  defaultView = new TestWindow();
  createElement(tag: string): Element { return new Element(tag); }
}();
let clock: number | undefined;
const ClockDate = new Proxy(Date, {
  construct(target, args) { return Reflect.construct(target, args.length ? args : [clock ?? Date.now()]); },
  get(target, property, receiver) { return property === 'now' ? () => clock ?? Date.now() : Reflect.get(target, property, receiver); },
});
class Modal {
  contentEl = new Element('div');
  modalEl = new Element('div');
  static last?: Modal;
  constructor(readonly app: unknown) {}
  open(): void { Modal.last = this; (this as Modal & { onOpen?: () => void }).onOpen?.(); }
  close(): void { (this as Modal & { onClose?: () => void }).onClose?.(); }
}
class Notice {
  static messages: string[] = [];
  constructor(text: string) { Notice.messages.push(text); }
}
class ItemView {
  contentEl = new Element('div');
  app: unknown;
  private cleanups: (() => void)[] = [];
  constructor(leaf: { app: unknown }) { this.app = leaf.app; }
  registerDomEvent(target: Target, name: string, callback: (event: Event) => void): void {
    target.addEventListener(name, callback); this.cleanups.push(() => target.removeEventListener(name, callback));
  }
  registerInterval(id: number): void { this.cleanups.push(() => document.defaultView.clearInterval(id)); }
  unload(): void { for (const cleanup of this.cleanups.splice(0)) cleanup(); }
}
interface Draft { currency: import('../src/domain').Currency; amount: string; title: string; itemId: string; notes: string[]; error: string }
interface ViewProbe {
  root: Element; draft: Draft; demo: boolean; range: DateRange; quickSaving: boolean; period: string;
  render(): void; renderQuick(): void; renderTimeline(parent: Element): void; resetSelection(): void;
  refresh(): void; onOpen(): Promise<void>; onClose(): Promise<void>; unload(): void;
  renderStats(): void; renderSummary(parent: Element): void; renderDetails(parent: Element, doc: LedgerDocument): void;
}
interface StoreProbe {
  documents: LedgerDocument[]; folder: string;
  get(id: string): LedgerDocument | undefined;
  save(doc: LedgerDocument, expected?: LedgerDocument): Promise<void>;
  issues: { path: string; message: string }[]; ready: boolean;
  subscribe(callback: () => void): () => void;
  writeExport(name: string, content: string): Promise<string>;
}
const mockObsidian = { Modal, Notice, ItemView, FuzzySuggestModal: class extends Modal { setPlaceholder(): void {} }, setIcon() {}, TFile: class {}, TFolder: class {} };
const module = { exports: {} };
const require = createRequire(import.meta.url);
const bundle = buildSync({
  stdin: { contents: "export { LedgerView } from './src/view'; export { EventModal } from './src/forms'; export { LedgerStore } from './src/store'; export { setLocale, t } from './src/i18n';", resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, format: 'cjs', platform: 'node', external: ['obsidian'],
});
runInNewContext(bundle.outputFiles[0]!.text, {
  module, exports: module.exports, require: (id: string) => id === 'obsidian' ? mockObsidian : require(id),
  Date: ClockDate, crypto: globalThis.crypto, structuredClone, URL, console,
});
const ui = module.exports as {
  LedgerView: new (leaf: unknown, host: unknown) => ViewProbe;
  EventModal: new (ctx: unknown, type: string, doc?: LedgerDocument, event?: LedgerEvent) => Modal;
  LedgerStore: new (port: StoragePort, folder: string) => LedgerStore;
  setLocale(locale: 'en' | 'zh-CN'): void;
  t(source: string, ...values: unknown[]): string;
};
const app = { vault: { getAbstractFileByPath() { return null; } } };
const all = (node: Element): Element[] => [node, ...node.children.flatMap(all)];
function find(root: Element, predicate: (node: Element) => boolean): Element {
  const node = all(root).find(predicate); assert.ok(node, 'expected control exists'); return node;
}
function labelled(root: Element, label: string): Element { return find(root, node => node.attributes['aria-label'] === ui.t(label)); }
function field(root: Element, label: string): Element {
  const group = find(root, node => node.children.some(child => child.tag === 'label' && child.textContent === ui.t(label)));
  return find(group, node => ['input', 'select', 'textarea'].includes(node.tag));
}
function enter(node: Element, value: string): void { node.value = value; node.dispatch('input'); }
function press(root: Element, source: string): void {
  find(root, node => node.tag === 'button' && all(node).some(child => child.tag === 'span' && child.textContent === ui.t(source))).dispatch('click');
}
const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve));
function createStore(documents: LedgerDocument[] = []): StoreProbe {
  return { documents, folder: 'Ledger', get: id => documents.find(doc => doc.item.id === id), async save() {}, issues: [], ready: true, subscribe: () => () => {}, async writeExport(name) { return name; } };
}
afterEach(() => { clock = undefined; ui.setLocale('zh-CN'); document.defaultView.intervals.clear(); });
function createView(store: StoreProbe): ViewProbe {
  const view = new ui.LedgerView({ app }, { app, store, openPath: async () => {}, openSettings() {} });
  view.render = () => { view.root = new Element('div'); view.renderQuick(); };
  view.render(); return view;
}
function subscription(): LedgerDocument {
  let doc = createDocument('Subscription', '工具');
  for (const [title, date, amount] of [['September', '2026-09-01', 9900], ['October', '2026-10-01', 19900]] as const) {
    doc = putEvent(doc, { ...baseEvent(doc.item.id, title, date), type: 'expense', amount });
  }
  return doc;
}

for (const locale of ['zh-CN', 'en'] as const) {
  test(`${locale}: large totals render exactly in statistics, category charts and details`, () => {
    ui.setLocale(locale); const doc = createDocument('Large KWD totals', '工具'); doc.schema = 2;
    for (let i = 0; i < 901; i++) doc.events.push({ ...baseEvent(doc.item.id, 'Large payment', '2026-11-01'), type: 'expense', currency: 'KWD', amount: 9_999_999_999_999 });
    const view = createView(createStore([doc])); view.period = 'custom'; view.range = { start: '2026-11-01', end: '2026-11-30' };
    view.renderStats();
    assert.ok(all(view.root).some(node => node.className === 'ill-stat-value' && node.textContent === '9,009,999,999,999.099'));
    const summary = new Element('div'); view.renderSummary(summary);
    assert.ok(all(summary).some(node => node.textContent === 'KWD 9,009,999,999,999.099'));
    const bars = all(summary).filter(node => node.className.startsWith('ill-bar-fill '));
    assert.deepEqual(bars.map(node => node.style.width), ['0%', '0%', '100%', '0%', '0%']);
    const details = new Element('div'); view.renderDetails(details, doc);
    assert.ok(all(details).some(node => node.className === 'ill-detail-amount' && node.textContent === 'KWD 9,009,999,999,999.099'));
  });

  test(`${locale}: quick entry saves its chosen currency and retains a newer currency during a pending save`, async () => {
    ui.setLocale(locale); const store = createStore(); let saved: LedgerDocument | undefined; let finish!: () => void;
    store.save = async doc => { saved = doc; await new Promise<void>(resolve => { finish = resolve; }); };
    const view = createView(store); const currency = labelled(view.root, '快速记录币种'); currency.value = 'JPY'; currency.dispatch('change');
    enter(labelled(view.root, '快速记录金额'), '1999'); enter(labelled(view.root, '快速记录用途'), 'Japan book');
    find(view.root, node => node.tag === 'form').dispatch('submit');
    currency.value = 'USD'; currency.dispatch('change'); enter(labelled(view.root, '快速记录金额'), '49.99');
    finish(); await flush(); const event = saved?.events[0]; assert.equal(event?.type, 'expense');
    if (event?.type !== 'expense') assert.fail('Expense missing');
    assert.equal(event.currency, 'JPY'); assert.equal(event.amount, 1999); assert.equal(saved!.schema, 2);
    assert.equal(view.draft.currency, 'USD'); assert.equal(view.draft.amount, '49.99');
  });

  test(`${locale}: refund currency follows original expense selection and saves original minor units`, async () => {
    ui.setLocale(locale); let doc = subscription();
    doc = putEvent(doc, { ...baseEvent(doc.item.id, 'Japanese payment', '2026-10-02'), type: 'expense', currency: 'JPY', amount: 1999 });
    const japanese = doc.events[2]!; const store = createStore([doc]); let saved: LedgerDocument | undefined;
    store.save = async value => { saved = value; };
    new ui.EventModal({ app, store, demo: false }, 'refund', doc).open(); const root = Modal.last!.contentEl;
    const original = field(root, '原支出 *'); original.value = japanese.id; original.dispatch('change');
    assert.equal(field(root, '币种 *').value, 'JPY'); assert.equal(field(root, '币种 *').disabled, true);
    enter(field(root, '用途 *'), 'JPY refund'); enter(field(root, '金额 *'), '999'); enter(field(root, '发生日期 *'), '2026-11-03');
    find(root, node => node.tag === 'form').dispatch('submit'); await flush();
    const refund = saved?.events.find(e => e.title === 'JPY refund'); assert.equal(refund?.type, 'refund');
    if (refund?.type !== 'refund') assert.fail('Refund missing');
    assert.equal(refund.currency, 'JPY'); assert.equal(refund.amount, 999); assert.equal(refund.expenseId, japanese.id);
  });

  test(`${locale}: fractional JPY form input fails without losing amount or currency`, async () => {
    ui.setLocale(locale); const store = createStore([subscription()]); let writes = 0; store.save = async () => { writes++; };
    new ui.EventModal({ app, store, demo: false }, 'expense', store.documents[0]).open(); const root = Modal.last!.contentEl;
    const currency = field(root, '币种 *'); currency.value = 'JPY'; currency.dispatch('change');
    enter(field(root, '用途 *'), 'Invalid fraction'); enter(field(root, '金额 *'), '1.23');
    find(root, node => node.tag === 'form').dispatch('submit'); await flush();
    assert.equal(writes, 0); assert.equal(currency.value, 'JPY'); assert.equal(field(root, '金额 *').value, '1.23');
    assert.ok(all(root).some(node => node.attributes.role === 'alert' && node.textContent.includes('JPY') && !node.hidden));
  });

  test(`${locale}: totals, category charts and details display separate currencies`, () => {
    ui.setLocale(locale); let doc = subscription();
    doc = putEvent(doc, { ...baseEvent(doc.item.id, 'US payment', '2026-11-02'), type: 'expense', currency: 'USD', amount: 4999 });
    doc = putEvent(doc, { ...baseEvent(doc.item.id, 'Japan payment', '2026-11-02'), type: 'expense', currency: 'JPY', amount: 1999 });
    const view = createView(createStore([doc])); view.period = 'custom'; view.range = { start: '2026-01-01', end: '2026-12-31' };
    view.renderStats(); const totals = all(view.root).filter(node => node.className === 'ill-currency-total');
    assert.deepEqual(totals.map(node => node.attributes['data-currency']), ['CNY', 'USD', 'JPY']);
    const summary = new Element('div'); view.renderSummary(summary);
    assert.deepEqual(all(summary).filter(node => node.className === 'ill-breakdown').map(node => node.attributes['data-currency']), ['CNY', 'USD', 'JPY']);
    const details = new Element('div'); view.renderDetails(details, doc);
    assert.deepEqual(all(details).filter(node => node.className === 'ill-detail-amount').map(node => node.textContent), ['CNY ¥298.00', 'USD 49.99', 'JPY 1,999']);
  });
}

for (const locale of ['zh-CN', 'en'] as const) {
  test(`${locale}: refund from the second expense saves the clicked expense reference`, async () => {
    ui.setLocale(locale);
    let doc = subscription(); const first = doc.events[0]!; const second = doc.events[1]!;
    doc = putEvent(doc, { ...baseEvent(doc.item.id, 'Already refunded', '2026-09-02'), type: 'refund', amount: 9900, expenseId: first.id });
    const store = createStore([doc]); let saved: LedgerDocument | undefined; store.save = async value => { saved = value; };
    const view = createView(store); view.period = 'custom'; view.range = { start: '2026-01-01', end: '2026-12-31' };
    const timeline = new Element('div'); view.renderTimeline(timeline);
    find(timeline, node => node.attributes['aria-label'] === ui.t('为{0}退款', second.title)).dispatch('click');
    assert.ok(Modal.last); const form = Modal.last.contentEl;
    assert.equal(field(form, '原支出 *').value, second.id);
    enter(field(form, '用途 *'), 'Partial refund'); enter(field(form, '金额 *'), '49');
    enter(field(form, '发生日期 *'), '2026-11-03'); enter(field(form, '时间 *'), '12:00');
    find(form, node => node.tag === 'form').dispatch('submit'); await flush();
    assert.ok(saved); const refund = saved.events.find(event => event.title === 'Partial refund');
    assert.equal(refund?.type, 'refund'); if (refund?.type !== 'refund') assert.fail('refund was not saved');
    assert.equal(refund.expenseId, second.id); assert.equal(refund.amount, 4900);
    assert.equal(doc.events.length, 3, 'original document stays unchanged');
  });

  test(`${locale}: typing the next quick entry during a save survives completion and rerender`, async () => {
    ui.setLocale(locale);
    const store = createStore(); let finish!: () => void; const saved: LedgerDocument[] = [];
    store.save = async doc => { saved.push(doc); await new Promise<void>(resolve => { finish = resolve; }); };
    const view = createView(store);
    enter(labelled(view.root, '快速记录金额'), '99'); enter(labelled(view.root, '快速记录用途'), 'First record');
    find(view.root, node => node.tag === 'form').dispatch('submit'); assert.equal(saved.length, 1);
    view.render(); // A store notification or language refresh while the write is pending.
    enter(labelled(view.root, '快速记录金额'), '199'); enter(labelled(view.root, '快速记录用途'), 'Next record');
    find(view.root, node => node.tag === 'form').dispatch('submit'); assert.equal(saved.length, 1, 'duplicate submits are blocked');
    finish(); await flush();
    assert.equal(labelled(view.root, '快速记录金额').value, '199'); assert.equal(labelled(view.root, '快速记录用途').value, 'Next record');
    assert.equal(saved[0]!.events[0]!.title, 'First record'); assert.equal(view.quickSaving, false);
  });
}

test('quick save clears an unchanged submitted draft and preserves an existing investment selection', async () => {
  ui.setLocale('en'); const doc = subscription(); const store = createStore([doc]); let writes = 0;
  store.save = async (value, expected) => { writes++; assert.equal(value.item.id, doc.item.id); assert.equal(expected, doc); };
  const view = createView(store); const select = labelled(view.root, '快速记录投入项'); select.value = doc.item.id; select.dispatch('change');
  enter(labelled(view.root, '快速记录金额'), '99'); enter(labelled(view.root, '快速记录用途'), 'Renewal');
  find(view.root, node => node.tag === 'form').dispatch('submit'); await flush();
  assert.equal(writes, 1); assert.equal(view.draft.title, ''); assert.equal(view.draft.amount, ''); assert.equal(view.draft.itemId, doc.item.id);
});

test('quick save failure keeps the submitted inputs and supports retry', async () => {
  ui.setLocale('en'); const store = createStore(); let writes = 0;
  store.save = async () => { if (++writes === 1) throw new Error('disk full'); };
  const view = createView(store); enter(labelled(view.root, '快速记录金额'), '99'); enter(labelled(view.root, '快速记录用途'), 'Keep this input');
  find(view.root, node => node.tag === 'form').dispatch('submit'); await flush();
  assert.equal(view.draft.amount, '99'); assert.equal(view.draft.title, 'Keep this input'); assert.match(view.draft.error, /disk full/);
  assert.equal(view.quickSaving, false); find(view.root, node => node.tag === 'form').dispatch('submit'); await flush();
  assert.equal(writes, 2); assert.equal(view.draft.title, ''); assert.equal(view.draft.error, '');
});

test('a pending real-ledger save cannot clear a new demo draft', async () => {
  ui.setLocale('en'); const store = createStore(); let finish!: () => void; let saved: LedgerDocument | undefined;
  store.save = async value => { saved = value; await new Promise<void>(resolve => { finish = resolve; }); };
  const view = createView(store); enter(labelled(view.root, '快速记录金额'), '99'); enter(labelled(view.root, '快速记录用途'), 'Real record');
  find(view.root, node => node.tag === 'form').dispatch('submit');
  view.demo = true; view.resetSelection(); view.render();
  enter(labelled(view.root, '快速记录金额'), '199'); enter(labelled(view.root, '快速记录用途'), 'Demo draft');
  finish(); await flush(); assert.equal(saved?.demo, false); assert.equal(view.draft.title, 'Demo draft'); assert.equal(view.draft.amount, '199');
});

test('a failed pending write reports its error without replacing a newer quick draft', async () => {
  ui.setLocale('en'); const store = createStore(); let fail!: (error: Error) => void;
  store.save = async () => new Promise<void>((_resolve, reject) => { fail = reject; });
  const view = createView(store); enter(labelled(view.root, '快速记录金额'), '99'); enter(labelled(view.root, '快速记录用途'), 'First record');
  find(view.root, node => node.tag === 'form').dispatch('submit');
  enter(labelled(view.root, '快速记录金额'), '199'); enter(labelled(view.root, '快速记录用途'), 'Newer draft');
  const notices = Notice.messages.length; fail(new Error('disk full')); await flush();
  assert.equal(view.draft.title, 'Newer draft'); assert.equal(view.draft.amount, '199'); assert.equal(view.quickSaving, false);
  assert.ok(Notice.messages.slice(notices).some(message => message.includes('disk full')));
});

test('editing a refund preserves its original expense and a generic refund remains selectable', () => {
  ui.setLocale('en'); let doc = subscription(); const second = doc.events[1]!;
  const refund = { ...baseEvent(doc.item.id, 'Existing refund', '2026-11-01'), type: 'refund' as const, amount: 4900, expenseId: second.id };
  doc = putEvent(doc, refund); const ctx = { app, store: createStore([doc]), demo: false };
  const editing = new ui.EventModal(ctx, 'refund', doc, refund); editing.open(); assert.equal(field(editing.contentEl, '原支出 *').value, second.id);
  const generic = new ui.EventModal(ctx, 'refund', doc); generic.open(); const original = field(generic.contentEl, '原支出 *');
  assert.equal(original.options.length, 2); original.value = second.id; assert.equal(original.value, second.id);
});

for (const locale of ['zh-CN', 'en'] as const) {
  test(`${locale}: month and last-30-days ranges advance across midnight and refresh`, () => {
    ui.setLocale(locale);
    for (const period of ['month', '30']) {
      clock = new Date(2026, 10, 30, 12).getTime(); const store = createStore();
      const view = new ui.LedgerView({ app }, { app, store, openPath: async () => {}, openSettings() {} }); view.render();
      const control = labelled(view.root, '时间范围'); control.value = period; control.dispatch('change');
      assert.equal(view.range.start, '2026-11-01'); assert.equal(view.range.end, '2026-11-30');
      clock = new Date(2026, 11, 1, 12).getTime(); view.refresh();
      assert.equal(view.range.start, period === 'month' ? '2026-12-01' : '2026-11-02');
      assert.equal(view.range.end, period === 'month' ? '2026-12-31' : '2026-12-01');
    }
  });

  test(`${locale}: stale delete confirmation retains new events and a fresh confirmation can delete`, async () => {
    ui.setLocale(locale); const files = new Map<string, string>(); const trashed: string[] = [];
    const port: StoragePort = {
      async listMarkdown(folder) { return [...files.keys()].filter(path => path.startsWith(folder + '/')); },
      exists: path => files.has(path), async read(path) { return files.get(path)!; },
      async write(path, content, expected) { assert.equal(files.get(path) ?? null, expected); files.set(path, content); },
      async trash(path) { trashed.push(path); files.delete(path); },
    };
    const store = new ui.LedgerStore(port, 'Ledger'); let doc = createDocument('Synthetic course', '课程');
    doc = putEvent(doc, { ...baseEvent(doc.item.id, 'Purchase', '2026-11-01'), type: 'expense', amount: 39900 });
    await store.save(doc); await store.load();
    const view = new ui.LedgerView({ app }, { app, store, openPath: async () => {}, openSettings() {} }); await view.onOpen();
    try {
      press(view.root, '删除投入项'); assert.ok(Modal.last); const oldConfirmation = Modal.last;
      const original = store.get(doc.item.id)!; const path = store.pathFor(doc.item.id)!;
      const updated = putEvent(original, { ...baseEvent(doc.item.id, 'New work', '2026-11-02'), type: 'learning', content: 'New work', minutes: 30 });
      updated.item.updatedAt = original.item.updatedAt; const source = encodeDocument(updated); files.set(path, source); await store.load();
      find(oldConfirmation.contentEl, node => node.tag === 'form').dispatch('submit'); await flush();
      assert.equal(trashed.length, 0); assert.equal(files.get(path), source); assert.equal(store.get(doc.item.id)?.events.length, 2);
      const error = find(oldConfirmation.contentEl, node => node.className === 'ill-form-error'); assert.equal(error.hidden, false);
      assert.ok(error.textContent.includes(locale === 'en' ? 'updated' : '已更新'));
      oldConfirmation.close(); press(view.root, '删除投入项'); assert.ok(Modal.last);
      find(Modal.last.contentEl, node => node.tag === 'form').dispatch('submit'); await flush();
      assert.equal(trashed.length, 1); assert.equal(files.has(path), false); assert.equal(store.documents.length, 0);
    } finally { await view.onClose(); view.unload(); }
  });
}

test('CSV export uses the current rolling period even before the next view refresh', async () => {
  ui.setLocale('en'); clock = new Date(2026, 10, 30, 12).getTime();
  let doc = createDocument('Subscription', '工具');
  for (const [date, amount] of [['2026-11-30', 9900], ['2026-12-01', 19900]] as const) doc = putEvent(doc, { ...baseEvent(doc.item.id, date, date), type: 'expense', amount });
  const store = createStore([doc]); let exportedName = ''; let exportedContent = '';
  store.writeExport = async (name, content) => { exportedName = name; exportedContent = content; return name; };
  const view = new ui.LedgerView({ app }, { app, store, openPath: async () => {}, openSettings() {} }); view.render();
  clock = new Date(2026, 11, 1, 12).getTime(); press(view.root, '导出 CSV'); await flush();
  assert.ok(exportedName.includes('2026-12-01-2026-12-31')); assert.ok(exportedContent.includes('199.00,199.00'));
  assert.equal(exportedContent.includes('2026-11-30'), false); assert.equal(exportedContent.trim().split('\r\n').length, 2);
});

test('switching from rolling to custom dates preserves the visible range across later date changes', () => {
  clock = new Date(2026, 10, 30, 12).getTime(); const store = createStore();
  const view = new ui.LedgerView({ app }, { app, store, openPath: async () => {}, openSettings() {} }); view.render();
  let control = labelled(view.root, '时间范围'); control.value = '30'; control.dispatch('change');
  control = labelled(view.root, '时间范围'); control.value = 'custom'; control.dispatch('change');
  assert.equal(labelled(view.root, '开始日期').value, '2026-11-01'); assert.equal(labelled(view.root, '结束日期').value, '2026-11-30');
  enter(labelled(view.root, '开始日期'), '2026-10-15'); enter(labelled(view.root, '结束日期'), '2026-11-20'); press(view.root, '应用');
  clock = new Date(2027, 0, 1, 12).getTime(); view.refresh();
  assert.equal(view.range.start, '2026-10-15'); assert.equal(view.range.end, '2026-11-20');
});

test('day checks update due counts on timer, focus and visibility events and release resources', async () => {
  clock = new Date(2026, 10, 30, 12).getTime(); const doc = subscription(); doc.item.nextReview = '2026-12-01';
  const store = createStore([doc]); const view = new ui.LedgerView({ app }, { app, store, openPath: async () => {}, openSettings() {} }); await view.onOpen();
  const dueCount = (): string => {
    const button = labelled(view.root, '查看到期待回访'); return find(button, node => node.className === 'ill-stat-value').textContent;
  };
  assert.equal(dueCount(), '0'); assert.equal(document.defaultView.intervals.size, 1);
  clock = new Date(2026, 11, 1, 0, 1).getTime(); for (const callback of document.defaultView.intervals.values()) callback();
  assert.equal(dueCount(), '1'); assert.equal(view.range.start, '2026-12-01');
  clock = new Date(2027, 0, 1, 12).getTime(); document.defaultView.dispatch('focus'); assert.equal(view.range.start, '2027-01-01');
  const before = view.root; clock = new Date(2027, 0, 2, 12).getTime(); document.dispatch('visibilitychange'); assert.notEqual(view.root, before);
  await view.onClose(); view.unload(); assert.equal(document.defaultView.intervals.size, 0);
  const closed = view.root; clock = new Date(2027, 0, 3, 12).getTime(); document.defaultView.dispatch('focus'); document.dispatch('visibilitychange'); assert.equal(view.root, closed);
});
