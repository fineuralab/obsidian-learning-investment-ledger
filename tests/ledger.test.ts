import assert from 'node:assert/strict';
import { test } from 'node:test';
import { baseEvent, clone, createDocument, decimal, exportCsv, exportReview, filterEvents, isDue, last30Range, LedgerDocument, monthRange, parseMoney, putEvent, removeEvent, summarize, validateDocument } from '../src/domain';
import { decodeDocument, encodeDocument } from '../src/codec';
import { LedgerStore, normalizeFolder, StoragePort } from '../src/store';
import { makeDemo } from '../src/demo';
import { Attachment, importedAttachmentPath, isSafeWebUrl, validateAttachments } from '../src/attachments';

const RANGE = { start: '2026-11-01', end: '2026-11-30' };
class MemoryVault implements StoragePort {
  files = new Map<string, string>();
  trashBin = new Map<string, string>();
  failWrites = false;
  async listMarkdown(folder: string): Promise<string[]> { return [...this.files.keys()].filter(path => path.startsWith(`${folder}/`) && path.endsWith('.md')); }
  exists(path: string): boolean { return this.files.has(path); }
  async read(path: string): Promise<string> { const source = this.files.get(path); if (source === undefined) throw new Error('not found'); return source; }
  async write(path: string, content: string, expected: string | null): Promise<void> {
    if (this.failWrites) throw new Error('disk full');
    assert.equal(this.files.get(path) ?? null, expected, 'source changed'); this.files.set(path, content);
  }
  async trash(path: string): Promise<void> { this.trashBin.set(path, await this.read(path)); this.files.delete(path); }
}
function expense(name = '课程', amount = 29900, date = '2026-11-01'): LedgerDocument {
  const doc = createDocument(name, '课程');
  return putEvent(doc, { ...baseEvent(doc.item.id, `购买${name}`, date), time: '10:00', type: 'expense', amount });
}
test('acceptance: 299 + 99 + 129 = 527, refund 99 -> 428; edit and delete recalculate', () => {
  const course = expense(); let book = expense('书籍', 9900); const tool = expense('工具', 12900);
  assert.equal(summarize([course, book, tool], RANGE).totals[0]!.net, 52700);
  const refund = { ...baseEvent(book.item.id, '退书', '2026-11-02'), time: '11:00', type: 'refund' as const, amount: 9900, expenseId: book.events[0]!.id };
  book = putEvent(book, refund);
  assert.equal(summarize([course, book, tool], RANGE).totals[0]!.net, 42800);
  book = putEvent(book, { ...refund, amount: 5000 });
  assert.equal(summarize([course, book, tool], RANGE).totals[0]!.net, 47700);
  book = removeEvent(book, refund.id);
  assert.equal(summarize([course, book, tool], RANGE).totals[0]!.net, 52700);
  book = removeEvent(book, book.events[0]!.id);
  assert.equal(summarize([course, book, tool], RANGE).totals[0]!.net, 42800);
});
test('money rejects rounding, invalid values and scientific notation', () => {
  assert.equal(parseMoney('0.29'), 29); assert.equal(parseMoney('299.9'), 29990); assert.equal(parseMoney(' 99.00 '), 9900);
  for (const input of ['0', '-1', '1.001', '1e2', '', 'NaN', 'Infinity', '.5', '1,000', '10000000000']) assert.throws(() => parseMoney(input));
  assert.equal(decimal(-29), '-0.29');
});
test('refund cap applies across partial refunds and expense edits, protects references and chronology', () => {
  let doc = expense('工具', 10000);
  const original = doc.events[0]!;
  const refund = { ...baseEvent(doc.item.id, '部分退款', '2026-11-02'), type: 'refund' as const, amount: 6000, expenseId: original.id };
  doc = putEvent(doc, refund);
  assert.throws(() => putEvent(doc, { ...refund, id: 'second', amount: 4001 }), /累计退款/);
  doc = putEvent(doc, { ...refund, id: 'second', amount: 4000 });
  assert.equal(summarize([doc], RANGE).totals[0]!.net, 0);
  assert.throws(() => putEvent(doc, { ...original, type: 'expense', amount: 9999 }), /累计退款/);
  assert.throws(() => removeEvent(doc, original.id), /先删除/);
  assert.throws(() => putEvent(doc, { ...refund, expenseId: 'missing' }), /原支出不存在/);
  assert.throws(() => putEvent(doc, { ...refund, date: '2026-10-31' }), /早于/);
});
test('cross-period refunds reduce the refund period even when original expense is outside range', () => {
  let doc = expense('书籍', 9900, '2026-10-31');
  doc = putEvent(doc, { ...baseEvent(doc.item.id, '退款', '2026-11-01'), type: 'refund', amount: 9900, expenseId: doc.events[0]!.id });
  assert.deepEqual([summarize([doc], RANGE).totals[0]!.expense, summarize([doc], RANGE).totals[0]!.refund, summarize([doc], RANGE).totals[0]!.net], [0, 9900, -9900]);
});
test('timeline includes every event type; actual date/time sorting, combined filters and keyword', () => {
  const { docs } = makeDemo('投入账本', '2026-11-30');
  const all = { start: '2026-01-01', end: '2026-12-31' };
  const events = filterEvents(docs, { range: all });
  assert.equal(events.length, 13);
  assert.deepEqual(new Set(events.map(e => e.type)), new Set(['expense', 'refund', 'learning', 'outcome', 'review']));
  assert.deepEqual(filterEvents(docs, { range: all, newest: true }).map(e => e.id), events.map(e => e.id).reverse());
  assert.equal(filterEvents(docs, { range: all, type: 'learning', itemId: 'demo-python', keyword: 'pathlib' }).length, 1);
  assert.equal(filterEvents(docs, { range: all, type: 'expense', itemId: 'demo-python', keyword: '不匹配' }).length, 0);
});
test('project and outcome stats deduplicate on relevant events; due is global', () => {
  let a = expense('A'); let b = expense('B', 9900, '2026-10-01');
  for (const doc of [a, b]) { doc.item.project = '项目/同一个.md'; doc.item.nextReview = '2026-10-31'; }
  a = putEvent(a, { ...baseEvent(a.item.id, '成果 A', '2026-11-02'), type: 'outcome', target: '成果/同一文件.md', content: '' });
  b = putEvent(b, { ...baseEvent(b.item.id, '成果 B', '2026-11-03'), type: 'outcome', target: '成果/同一文件.md', content: '' });
  const stats = summarize([a, b], RANGE, '2026-11-02');
  assert.equal(stats.projects, 1); assert.equal(stats.outcomes, 1); assert.equal(stats.due, 2);
  assert.equal(summarize([a, b], { start: '2027-01-01', end: '2027-01-31' }, '2026-11-02').due, 2);
  b.item.status = '已完成'; assert.equal(summarize([a, b], RANGE, '2026-11-02').due, 1);
});
test('review clears pending, keeps history, reschedules; older edits do not change latest schedule', () => {
  let doc = expense(); doc.item.nextReview = '2026-11-02';
  assert.ok(isDue(doc, '2026-11-02'));
  const first = { ...baseEvent(doc.item.id, '回访', '2026-11-02'), time: '11:00', type: 'review' as const, expectation: '学习脚本', usage: '完成练习', outcomes: '脚本', rating: '部分达到' as const, plan: '继续', nextReview: null };
  doc = putEvent(doc, first); assert.equal(isDue(doc, '2026-11-02'), false);
  const second = { ...first, id: 'later-review', date: '2026-11-10', nextReview: '2026-12-10' };
  doc = putEvent(doc, second); doc = putEvent(doc, { ...first, usage: '修正历史描述' });
  assert.equal(doc.item.nextReview, '2026-12-10'); assert.equal(doc.events.filter(e => e.type === 'review').length, 2);
  assert.throws(() => removeEvent(doc, first.id), /不能删除/);
  assert.throws(() => putEvent(doc, { ...second, nextReview: '2026-11-10' }), /晚于/);
});
test('date boundaries and inclusive last 30 days', () => {
  assert.deepEqual(last30Range('2026-11-02'), { start: '2026-10-04', end: '2026-11-02' });
  assert.deepEqual(monthRange('2028-02-12'), { start: '2028-02-01', end: '2028-02-29' });
  assert.throws(() => putEvent(expense(), { ...baseEvent('wrong', '无效日期', '2026-02-30'), type: 'expense', amount: 1 }));
});
test('Markdown round-trip preserves full history, links, IDs and user appendix', () => {
  const { docs } = makeDemo('投入账本', '2026-11-30');
  for (const doc of docs) {
    doc.appendix = '## 我的补充\n\n手写内容和 [[手写链接]]。\n';
    assert.deepEqual(decodeDocument(encodeDocument(doc)), doc);
  }
  assert.throws(() => decodeDocument('---\nledger: [\n---\n'), /YAML/);
  const doc = expense(); const source = encodeDocument(doc).replace('schema: 1', 'schema: 99');
  assert.throws(() => decodeDocument(source), /版本/);
  assert.throws(() => decodeDocument(encodeDocument(doc).replace('schema: 1', 'schema: 1\nschema: 1')), /YAML/);
});
test('real restart rebuilds records from Markdown without any cache', async () => {
  const vault = new MemoryVault(); const first = new LedgerStore(vault, '投入账本'); await first.load();
  const { docs } = makeDemo('投入账本', '2026-11-30');
  for (const doc of docs) await first.save(doc);
  const second = new LedgerStore(vault, '投入账本'); await second.load();
  const byId = (docs: LedgerDocument[]) => docs.sort((a, b) => a.item.id.localeCompare(b.item.id));
  assert.deepEqual(byId(second.documents), byId(first.documents)); assert.equal(second.issues.length, 0);
});
test('failed writes do not mutate cache or source; retry succeeds and stale form cannot overwrite', async () => {
  const vault = new MemoryVault(); const store = new LedgerStore(vault, '投入账本'); const doc = expense(); await store.save(doc);
  const original = store.get(doc.item.id)!; const changed = clone(original); changed.item.reason = '新原因'; vault.failWrites = true;
  const before = [...vault.files.entries()];
  await assert.rejects(store.save(changed, original), /disk full/);
  assert.deepEqual(store.get(doc.item.id), original); assert.deepEqual([...vault.files.entries()], before);
  vault.failWrites = false; await store.save(changed, original);
  await assert.rejects(store.save(original, original), /表单打开后已更新/);
});
test('external edit conflicts are detected, corrupt file is named and last good record retained', async () => {
  const vault = new MemoryVault(); const store = new LedgerStore(vault, '投入账本'); const doc = expense(); await store.save(doc);
  const path = store.pathFor(doc.item.id)!; vault.files.set(path, '---\nledger: learning-investment-ledger\nitem: [\n---\n');
  await assert.rejects(store.save(doc), /source changed/);
  await store.load(); assert.equal(store.documents.length, 1); assert.equal(store.issues[0]!.path, path);
  await assert.rejects(store.save(doc), /源文件需要先修复/);
  const fresh = new LedgerStore(vault, '投入账本'); await fresh.load(); assert.equal(fresh.documents.length, 0); assert.equal(fresh.issues.length, 1);
});
test('duplicate IDs are reported, never silently replaced', async () => {
  const vault = new MemoryVault(); const doc = expense(); const source = encodeDocument(doc);
  vault.files.set('投入账本/投入-one.md', source); vault.files.set('投入账本/投入-two.md', source);
  const store = new LedgerStore(vault, '投入账本'); await store.load(); assert.equal(store.issues.length, 2); assert.equal(store.documents.length, 0);
});
test('a known source with a custom filename is reported if its ledger marker is removed', async () => {
  const vault = new MemoryVault(); const store = new LedgerStore(vault, '投入账本'); const doc = expense(); await store.save(doc);
  const original = store.pathFor(doc.item.id)!; const moved = '投入账本/自定义名称.md';
  vault.files.set(moved, vault.files.get(original)!); vault.files.delete(original); await store.handleRename(original, moved);
  vault.files.set(moved, '# 属性区被误删'); await store.load();
  assert.equal(store.documents.length, 1); assert.equal(store.issues[0]!.path, moved);
});
test('file and folder rename persist all structured links; deleted targets remain in records', async () => {
  const vault = new MemoryVault(); const store = new LedgerStore(vault, '投入账本'); let doc = expense();
  doc.item.project = '旧目录/项目.md'; doc.item.notes = ['旧目录/笔记.md']; doc.events[0]!.notes = ['旧目录/笔记.md'];
  doc = putEvent(doc, { ...baseEvent(doc.item.id, '成果', '2026-11-02'), type: 'outcome', target: '旧目录/脚本.py', content: '' });
  await store.save(doc); await store.handleRename('旧目录', '新目录');
  const fresh = new LedgerStore(vault, '投入账本'); await fresh.load(); const updated = fresh.get(doc.item.id)!;
  assert.equal(updated.item.project, '新目录/项目.md'); assert.equal(updated.events[0]!.notes[0], '新目录/笔记.md');
  assert.equal(updated.events[1]!.type === 'outcome' && updated.events[1]!.target, '新目录/脚本.py');
  assert.equal(vault.exists('新目录/笔记.md'), false); assert.equal(updated.item.notes[0], '新目录/笔记.md');
});
test('CSV exact values, period dates, record count and formula injection protection', () => {
  const { docs } = makeDemo('投入账本', '2026-11-30'); docs[0]!.item.name = '=WEBSERVICE("secret")';
  const all = { start: '2026-01-01', end: '2026-12-31' };
  const csv = exportCsv(docs, all); const rows = csv.trim().split('\r\n');
  assert.equal(rows.length, 6); assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.includes('399.00,399.00')); assert.ok(csv.includes('199.00,-199.00')); assert.ok(csv.includes('2026-11-27')); assert.ok(csv.includes("'=WEBSERVICE"));
  const review = exportReview(docs, all, '下个月继续实践', '2026-11-30'); assert.ok(review.includes('¥797.00')); assert.ok(review.includes('下个月继续实践')); assert.ok(review.includes('[[投入账本/演示数据/笔记/文件整理脚本.md]]'));
});
test('late Obsidian automatic wiki-link writes cannot undo a structured rename; newer user edits remain authoritative', async () => {
  const vault = new MemoryVault(); const store = new LedgerStore(vault, '投入账本'); const doc = expense();
  doc.item.project = '原笔记.md'; await store.save(doc);
  const path = store.pathFor(doc.item.id)!; const before = vault.files.get(path)!;
  await store.handleRename('原笔记.md', '移动/原笔记.md');
  // Obsidian fileManager updates body links from an older source snapshot after the rename event.
  vault.files.set(path, before.replace('[[原笔记.md]]', '[[原笔记]]'));
  await store.load(); assert.equal(store.get(doc.item.id)!.item.project, '移动/原笔记.md');
  assert.equal(decodeDocument(vault.files.get(path)!).item.project, '移动/原笔记.md');
  const deliberate = store.get(doc.item.id)!; deliberate.item.project = '原笔记.md';
  await store.save(deliberate, deliberate); await store.load();
  assert.equal(store.get(doc.item.id)!.item.project, '原笔记.md');
});
test('demo install is idempotent and clearing cannot delete real records or unrelated files', async () => {
  const vault = new MemoryVault(); const store = new LedgerStore(vault, '投入账本'); const data = makeDemo('投入账本', '2026-11-30');
  await store.installDemo(data.docs, data.notes); await store.installDemo(data.docs, data.notes);
  const real = expense('我的真实课程'); await store.save(real);
  vault.files.set('投入账本/演示数据/我自己写的.md', '不要删除');
  await store.clearDemo(); assert.equal(store.documents.length, 1); assert.equal(store.documents[0]!.item.id, real.item.id);
  assert.ok(vault.files.has('投入账本/演示数据/我自己写的.md')); assert.equal(vault.trashBin.size, 15);
});
test('safe folder and authoritative validation reject malformed financial data', () => {
  for (const path of ['', '/', '../资料', '.obsidian', 'A/../B', '/absolute/fixture', 'A//B']) assert.throws(() => normalizeFolder(path));
  assert.equal(normalizeFolder(' 学习/投入账本/ '), '学习/投入账本');
  const doc = expense(); const invalid = clone(doc); (invalid.events[0] as { amount: number }).amount = 0.1; assert.throws(() => validateDocument(invalid), /整数最小货币单位/);
});
test('attachments are optional for 0.1 records and round-trip on investments and all five event types', () => {
  const { docs } = makeDemo('投入账本', '2026-11-30');
  const attachments: Attachment[] = [
    { id: 'picture', kind: 'file', target: '附件/练习截图.png' },
    { id: 'pdf', kind: 'file', target: '资料/课程讲义.pdf' },
    { id: 'web', kind: 'url', target: 'https://example.com/notes.pdf', label: '在线讲义' },
  ];
  for (const doc of docs) {
    assert.deepEqual(decodeDocument(encodeDocument(doc)), doc);
    doc.item.attachments = clone(attachments);
    for (const event of doc.events) event.attachments = clone(attachments);
    assert.deepEqual(decodeDocument(encodeDocument(doc)), doc);
    const markdown = encodeDocument(doc);
    assert.ok(markdown.includes('![[附件/练习截图.png]]'));
    assert.ok(markdown.includes('[[资料/课程讲义.pdf]]'));
    assert.ok(markdown.includes('[在线讲义](<https://example.com/notes.pdf>)'));
  }
  const stats = summarize(docs, { start: '2026-01-01', end: '2026-12-31' });
  assert.equal(stats.totals[0]!.net, 79700); assert.equal(stats.outcomes, 3, 'attachments never count as confirmed outcomes');
});
test('attachment metadata rejects unsafe URLs, absolute files, traversal and malformed IDs', () => {
  validateAttachments(undefined); validateAttachments([]);
  for (const target of ['javascript:alert(1)', 'data:image/svg+xml,x', 'file:///etc/passwd', 'https://user:pass@example.com', 'https://example.com/\nfile', 'not a url']) {
    assert.equal(isSafeWebUrl(target), false);
    assert.throws(() => validateAttachments([{ id: 'web', kind: 'url', target }]));
  }
  for (const target of ['/etc/passwd', '../secret', 'A/../secret', 'C:\\file.png', 'A//file.pdf', 'a\n.md']) assert.throws(() => validateAttachments([{ id: 'file', kind: 'file', target }]));
  assert.throws(() => validateAttachments([{ id: 'same', kind: 'file', target: 'a.png' }, { id: 'same', kind: 'file', target: 'b.png' }]));
  assert.ok(isSafeWebUrl('https://example.com/file.pdf?download=1'));
  assert.ok(importedAttachmentPath('投入账本', false, 'id', '../截图#1.png').startsWith('投入账本/附件/id-'));
  assert.ok(importedAttachmentPath('投入账本', true, 'id', '图.png').startsWith('投入账本/演示数据/附件/'));
});
test('attachment file and folder moves persist after restart; external links do not change', async () => {
  const vault = new MemoryVault(); const store = new LedgerStore(vault, '投入账本'); const doc = expense();
  doc.item.attachments = [{ id: 'item-pdf', kind: 'file', target: '资料/讲义.pdf' }];
  doc.events[0]!.attachments = [{ id: 'image', kind: 'file', target: '资料/截图.png' }, { id: 'web', kind: 'url', target: 'https://example.com/资料/截图.png' }];
  await store.save(doc); await store.handleRename('资料', '已整理'); await store.handleRename('已整理/截图.png', '已整理/新截图.png');
  const fresh = new LedgerStore(vault, '投入账本'); await fresh.load(); const saved = fresh.get(doc.item.id)!;
  assert.equal(saved.item.attachments![0]!.target, '已整理/讲义.pdf');
  assert.equal(saved.events[0]!.attachments![0]!.target, '已整理/新截图.png');
  assert.equal(saved.events[0]!.attachments![1]!.target, 'https://example.com/资料/截图.png');
});
test('CSV and Markdown review retain per-event attachments without changing financial rows', () => {
  const doc = expense(); doc.events[0]!.attachments = [{ id: 'image', kind: 'file', target: '附件/截图.png' }];
  doc.item.attachments = [{ id: 'guide', kind: 'url', target: 'https://example.com/guide', label: '资料' }];
  const csv = exportCsv([doc], RANGE); assert.ok(csv.includes('附件链接')); assert.ok(csv.includes('附件/截图.png')); assert.equal(csv.trim().split('\r\n').length, 2);
  const markdown = exportReview([doc], RANGE); assert.ok(markdown.includes('## 记录附件')); assert.ok(markdown.includes('![[附件/截图.png]]')); assert.ok(markdown.includes('[资料](<https://example.com/guide>)')); assert.ok(markdown.includes('¥299.00'));
});

test('custom filenames load valid YAML comments, quoted keys, tags and flow maps after restart', async () => {
  const doc = expense(); const original = encodeDocument(doc);
  const variants = [
    original.replace('ledger: learning-investment-ledger', 'ledger: learning-investment-ledger # a comment'),
    original.replace('ledger: learning-investment-ledger', '"ledger": learning-investment-ledger'),
    original.replace('ledger: learning-investment-ledger', "'ledger': 'learning-investment-ledger' # a comment"),
    original.replace('ledger: learning-investment-ledger', 'ledger: !!str learning-investment-ledger'),
    `---\n${JSON.stringify(doc)}\n---\n`,
    '\uFEFF' + original.replace('ledger: learning-investment-ledger', '"ledger": learning-investment-ledger # a comment').replace(/\n/g, '\r\n'),
  ];
  for (const source of variants) {
    const vault = new MemoryVault(); const path = '投入账本/自定义名称.md'; vault.files.set(path, source);
    const store = new LedgerStore(vault, '投入账本'); await store.load();
    assert.equal(store.issues.length, 0); assert.equal(store.documents.length, 1);
    assert.equal(store.get(doc.item.id)?.events.length, 1); assert.equal(vault.files.get(path), source, 'indexing never rewrites a source');
    assert.equal(summarize(store.documents, RANGE).totals[0]!.net, 29900);
  }
});

test('a truncated custom-named ledger is reported on cold start while unrelated Markdown is ignored', async () => {
  const vault = new MemoryVault(); const source = encodeDocument(expense()); const path = '投入账本/自定义名称.md';
  vault.files.set(path, source.slice(0, source.indexOf('\n---', 4)));
  vault.files.set('投入账本/普通笔记.md', '# Example\n\nledger: learning-investment-ledger');
  vault.files.set('投入账本/其他属性.md', '---\nother: [\n');
  vault.files.set('投入账本/代码示例.md', '---\ntitle: Example\n---\nledger: learning-investment-ledger');
  const before = [...vault.files]; const store = new LedgerStore(vault, '投入账本'); await store.load();
  assert.equal(store.documents.length, 0); assert.equal(store.issues.length, 1); assert.equal(store.issues[0]?.path, path);
  assert.match(store.issues[0]!.message, /YAML/); assert.deepEqual([...vault.files], before);
});

test('a stale form cannot recreate an investment deleted before an index reload', async () => {
  const vault = new MemoryVault(); const store = new LedgerStore(vault, '投入账本'); const doc = expense(); await store.save(doc);
  const opened = store.get(doc.item.id)!; const edited = clone(opened); edited.item.reason = 'Unsaved input';
  const path = store.pathFor(doc.item.id)!; await vault.trash(path); await store.load();
  await assert.rejects(store.save(edited, opened), /已不存在|文件夹/);
  assert.equal(vault.exists(path), false); assert.equal(store.documents.length, 0); assert.equal(edited.item.reason, 'Unsaved input');
  await store.save(expense('New item')); assert.equal(store.documents.length, 1, 'new records are still allowed');
});

test('old snapshots cannot write after a folder switch, including copied IDs and a queued reload', async () => {
  for (const mode of ['empty', 'before-reload', 'copied'] as const) {
    const vault = new MemoryVault(); const store = new LedgerStore(vault, '投入账本'); const doc = expense(); await store.save(doc);
    const opened = store.get(doc.item.id)!; const path = store.pathFor(doc.item.id)!;
    if (mode === 'copied') vault.files.set(`新账本/投入-${doc.item.id}.md`, vault.files.get(path)!);
    store.folder = '新账本'; if (mode !== 'before-reload') await store.load();
    const before = [...vault.files];
    await assert.rejects(store.save(opened, opened), /已不存在|文件夹/);
    assert.deepEqual([...vault.files], before);
  }
});

test('stale save and delete reject external changes even when YAML updatedAt was not changed', async () => {
  for (const change of ['event', 'comment'] as const) {
    const vault = new MemoryVault(); const store = new LedgerStore(vault, '投入账本'); const doc = expense(); await store.save(doc);
    const opened = store.get(doc.item.id)!; const path = store.pathFor(doc.item.id)!;
    let content: string;
    if (change === 'event') {
      const newer = putEvent(opened, { ...baseEvent(doc.item.id, 'New learning', '2026-11-02'), type: 'learning', content: 'New work', minutes: 30 });
      newer.item.updatedAt = opened.item.updatedAt; content = encodeDocument(newer);
    } else content = vault.files.get(path)!.replace('ledger: learning-investment-ledger', 'ledger: learning-investment-ledger # keep this comment');
    vault.files.set(path, content); await store.load();
    await assert.rejects(store.save(opened, opened), /已更新/);
    await assert.rejects(store.delete(doc.item.id, opened), /已更新/);
    assert.equal(vault.files.get(path), content); assert.equal(vault.trashBin.size, 0);
    const fresh = store.get(doc.item.id)!; await store.delete(doc.item.id, fresh);
    assert.equal(vault.exists(path), false); assert.equal(vault.trashBin.get(path), content);
  }
});

test('snapshot guards do not become serialized record fields and fresh updates still save', async () => {
  const vault = new MemoryVault(); const store = new LedgerStore(vault, '投入账本'); const doc = expense(); await store.save(doc);
  const opened = store.get(doc.item.id)!; const next = clone(opened); next.item.reason = 'Updated reason';
  await store.save(next, opened); const path = store.pathFor(doc.item.id)!;
  assert.deepEqual(decodeDocument(vault.files.get(path)!), store.get(doc.item.id));
  assert.deepEqual({ ...opened, item: { ...opened.item, updatedAt: doc.item.updatedAt } }, doc);
  const restarted = new LedgerStore(vault, '投入账本'); await restarted.load(); assert.equal(restarted.get(doc.item.id)?.item.reason, 'Updated reason');
});

test('moving the latest review before another review recalculates the next date or clears it', () => {
  for (const nextReview of ['2026-11-15', null]) {
    const doc = expense();
    const first = { ...baseEvent(doc.item.id, 'Earlier review', '2026-11-02'), time: '10:00', type: 'review' as const, expectation: '', usage: 'Used', outcomes: '', rating: '部分达到' as const, plan: 'Continue', nextReview };
    const second = { ...first, id: 'second-review', date: '2026-11-10', nextReview: '2026-12-10' };
    const reviewed = putEvent(putEvent(doc, first), second);
    const moved = putEvent(reviewed, { ...second, date: '2026-11-01', nextReview: '2026-12-20' });
    assert.equal(moved.item.nextReview, nextReview); assert.equal(isDue(moved, '2026-11-15'), nextReview !== null);
    assert.equal(moved.events.filter(event => event.type === 'review').length, 2);
    const sameDay = putEvent(putEvent(doc, first), { ...second, date: first.date, time: '16:00' });
    assert.equal(putEvent(sameDay, { ...second, date: first.date, time: '08:00' }).item.nextReview, nextReview);
  }
});

test('editing older review text or adding a backdated review preserves a manual schedule', () => {
  const doc = expense();
  const review = { ...baseEvent(doc.item.id, 'Review', '2026-11-10'), type: 'review' as const, expectation: '', usage: 'Used', outcomes: '', rating: '达到' as const, plan: 'Continue', nextReview: '2026-12-10' };
  const reviewed = putEvent(doc, review); reviewed.item.nextReview = '2027-01-15';
  const older = { ...review, id: 'older-review', date: '2026-11-02', nextReview: '2026-11-15' };
  const added = putEvent(reviewed, older); assert.equal(added.item.nextReview, '2027-01-15');
  assert.equal(putEvent(added, { ...older, usage: 'Corrected text' }).item.nextReview, '2027-01-15');
});
