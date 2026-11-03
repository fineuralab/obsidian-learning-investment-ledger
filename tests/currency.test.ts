import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { baseEvent, createDocument, currencyDigits, currencyOf, decimal, exportCsv, exportReview, filterEvents, money, parseMoney, putEvent, removeEvent, summarize, validateDocument, type Currency, type Expense, type LedgerDocument } from '../src/domain';
import { decodeDocument, encodeDocument } from '../src/codec';
import { LedgerStore, type StoragePort } from '../src/store';
import { makeDemo } from '../src/demo';
import { setLocale } from '../src/i18n';

const range = { start: '2026-11-01', end: '2026-11-30' };
afterEach(() => setLocale('zh-CN'));
function payment(doc: LedgerDocument, currency: Currency, value: string, title: string = currency, date = '2026-11-01'): LedgerDocument {
  return putEvent(doc, { ...baseEvent(doc.item.id, title, date), type: 'expense', currency, amount: parseMoney(value, currency) });
}
function mixed(): LedgerDocument {
  let doc = createDocument('Mixed investment', '课程');
  for (const [currency, value] of [['CNY', '299'], ['USD', '49.99'], ['JPY', '1999'], ['KWD', '1.234']] as const) doc = payment(doc, currency, value);
  return doc;
}

const maxKwdPayment = 9_999_999_999_999;
function largePayments(count: number, itemType: '工具' | '课程' = '工具'): LedgerDocument {
  const doc = createDocument('Large totals', itemType); doc.schema = 2;
  for (let i = 0; i < count; i++) doc.events.push({ ...baseEvent(doc.item.id, 'Large payment', '2026-11-01'), time: '09:00', type: 'expense', currency: 'KWD', amount: maxKwdPayment });
  validateDocument(doc); return doc;
}

test('901 and 1000 valid large payments retain every minor unit in totals and category labels', () => {
  for (const [count, expected, label] of [[901, 9_009_999_999_999_099n, 'KWD 9,009,999,999,999.099'], [1000, 9_999_999_999_999_000n, 'KWD 9,999,999,999,999.000']] as const) {
    const doc = largePayments(count); const before = encodeDocument(doc); const row = summarize([doc], range).totals[0]!;
    assert.equal(row.expense, expected); assert.equal(row.net, expected); assert.equal(row.byType['工具'].net, expected);
    assert.equal(money(row.net, 'KWD'), label); assert.equal(row.refund, 0);
    assert.equal(encodeDocument(doc), before, 'Summaries never alter the stored transactions');
    assert.ok(exportReview([doc], range).includes(label));
    assert.ok(exportCsv([doc], range).includes('"KWD",9999999999.999,9999999999.999'));
  }
});

test('the safe integer boundary stays exact on both sides without changing normal totals', () => {
  for (const expected of [9_007_199_254_740_990n, 9_007_199_254_740_991n, 9_007_199_254_740_992n, 9_007_199_254_740_993n]) {
    const doc = largePayments(900); const remaining = expected - 900n * BigInt(maxKwdPayment);
    doc.events.push({ ...baseEvent(doc.item.id, 'Boundary payment', '2026-11-01'), type: 'expense', currency: 'KWD', amount: Number(remaining) });
    validateDocument(doc); const row = summarize([doc], range).totals[0]!;
    assert.equal(BigInt(row.net), expected);
    assert.equal(typeof row.net, expected <= BigInt(Number.MAX_SAFE_INTEGER) ? 'number' : 'bigint');
  }
});

test('large gross expenses and refunds can cancel to exactly one minor unit', () => {
  const doc = largePayments(901); const original = [...doc.events];
  for (const [index, expense] of original.entries()) {
    if (expense.type !== 'expense') assert.fail('Expected expense');
    doc.events.push({ ...baseEvent(doc.item.id, 'Large refund', '2026-11-02'), type: 'refund', currency: 'KWD', expenseId: expense.id, amount: expense.amount - (index === original.length - 1 ? 1 : 0) });
  }
  validateDocument(doc); const row = summarize([doc], range).totals[0]!;
  assert.equal(row.expense, 9_009_999_999_999_099n); assert.equal(row.refund, 9_009_999_999_999_098n);
  assert.equal(row.net, 1); assert.equal(row.byType['工具'].net, 1);
  assert.ok(exportReview([doc], range).includes('KWD 0.001'));
});

test('large cross-period refunds preserve exact negative totals', () => {
  const doc = largePayments(901); const original = [...doc.events];
  for (const expense of original) {
    if (expense.type !== 'expense') assert.fail('Expected expense');
    expense.date = '2026-10-01';
    doc.events.push({ ...baseEvent(doc.item.id, 'Full refund', '2026-11-02'), type: 'refund', currency: 'KWD', expenseId: expense.id, amount: expense.amount });
  }
  validateDocument(doc); const row = summarize([doc], range).totals[0]!;
  assert.equal(row.expense, 0); assert.equal(row.refund, 9_009_999_999_999_099n); assert.equal(row.net, -9_009_999_999_999_099n);
  assert.equal(money(row.net, 'KWD'), 'KWD -9,009,999,999,999.099');
  assert.ok(exportReview([doc], range).includes('KWD -9,009,999,999,999.099'));
});

test('large currency and category totals remain independent while normal CNY and USD stay unchanged', () => {
  const tools = largePayments(901); const courses = largePayments(901, '课程');
  const cny = payment(createDocument('Legacy-compatible amount'), 'CNY', '299');
  const usd = payment(createDocument('Small USD amount'), 'USD', '49.99');
  const rows = summarize([tools, courses, cny, usd], range).totals;
  assert.equal(rows.find(row => row.currency === 'CNY')!.net, 29900);
  assert.equal(rows.find(row => row.currency === 'USD')!.net, 4999);
  const kwd = rows.find(row => row.currency === 'KWD')!;
  assert.equal(kwd.net, 18_019_999_999_998_198n);
  assert.equal(kwd.byType['工具'].net, 9_009_999_999_999_099n); assert.equal(kwd.byType['课程'].net, 9_009_999_999_999_099n);
});

test('large integer formatting is exact for zero, two and three decimal currencies and rejects unsafe Numbers', () => {
  assert.equal(decimal(9_007_199_254_740_993n, 'JPY'), '9007199254740993');
  assert.equal(money(9_007_199_254_740_993n, 'JPY'), 'JPY 9,007,199,254,740,993');
  assert.equal(decimal(9_007_199_254_740_993n, 'CNY'), '90071992547409.93');
  assert.equal(decimal(-9_007_199_254_740_993n, 'USD'), '-90071992547409.93');
  assert.equal(decimal(9_007_199_254_740_993n, 'BHD'), '9007199254740.993');
  assert.equal(decimal(0n, 'KWD'), '0.000');
  assert.throws(() => decimal(Number.MAX_SAFE_INTEGER + 1, 'KWD'));
});

test('minor units use each currency precision without rounding or conversion', () => {
  for (const [currency, value, integer] of [['CNY', '0.29', 29], ['USD', '49.99', 4999], ['JPY', '1999', 1999], ['KRW', '1000', 1000], ['KWD', '1.234', 1234], ['BHD', '0.001', 1]] as const) {
    assert.equal(parseMoney(value, currency), integer);
    assert.equal(decimal(integer, currency), value);
    assert.equal(decimal(-integer, currency), '-' + value);
  }
  assert.equal(currencyDigits('JPY'), 0); assert.equal(currencyDigits('USD'), 2); assert.equal(currencyDigits('KWD'), 3);
  assert.equal(money(1999, 'JPY'), 'JPY 1,999'); assert.equal(money(1234, 'KWD'), 'KWD 1.234');
  for (const [currency, value] of [['JPY', '1.01'], ['USD', '1.001'], ['KWD', '1.2345'], ['USD', '1e3'], ['JPY', '0'], ['KWD', '-1']] as const) assert.throws(() => parseMoney(value, currency));
});

test('mixed-currency totals and category breakdowns never add different units', () => {
  const stats = summarize([mixed()], range);
  assert.deepEqual(stats.totals.map(({ currency, expense, refund, net }) => [currency, expense, refund, net]), [['CNY', 29900, 0, 29900], ['USD', 4999, 0, 4999], ['JPY', 1999, 0, 1999], ['KWD', 1234, 0, 1234]]);
  assert.equal('net' in stats, false, 'There is no ambiguous cross-currency aggregate');
  for (const row of stats.totals) assert.equal(row.byType['课程'].net, row.net);
  const usd = payment(createDocument('USD only'), 'USD', '10.00');
  assert.deepEqual(summarize([usd], { start: '2027-01-01', end: '2027-01-31' }).totals.map(row => [row.currency, row.net]), [['USD', 0]]);
  assert.equal(filterEvents(makeDemo('Ledger', '2026-11-30').docs, { range: { start: '2026-01-01', end: '2026-12-31' }, keyword: 'CNY' }).length, 5);
});

test('refunds require the original currency, enforce caps and protect expense currency edits', () => {
  let doc = mixed(); const usd = doc.events.find(e => e.type === 'expense' && currencyOf(e) === 'USD') as Expense;
  const refund = { ...baseEvent(doc.item.id, 'Partial refund', '2026-11-02'), type: 'refund' as const, expenseId: usd.id, currency: 'USD' as const, amount: 999 };
  assert.throws(() => putEvent(doc, { ...refund, currency: 'CNY' }), /退款币种/);
  const missing = { ...refund }; delete (missing as { currency?: Currency }).currency;
  assert.throws(() => putEvent(doc, missing), /退款币种/);
  doc = putEvent(doc, refund);
  assert.equal(summarize([doc], range).totals.find(row => row.currency === 'USD')!.net, 4000);
  assert.throws(() => putEvent(doc, { ...refund, id: 'excess-refund', amount: 4001 }), /累计退款/);
  assert.throws(() => putEvent(doc, { ...usd, currency: 'CNY' }), /退款币种/);
  assert.equal(summarize([removeEvent(doc, refund.id)], range).totals.find(row => row.currency === 'USD')!.net, 4999);
});

test('cross-period refunds stay in their original currency and refund period', () => {
  let doc = payment(createDocument('Previous purchase'), 'USD', '10.00', 'Purchase', '2026-10-01');
  doc = putEvent(doc, { ...baseEvent(doc.item.id, 'Refund', '2026-11-02'), type: 'refund', currency: 'USD', expenseId: doc.events[0]!.id, amount: 300 });
  assert.deepEqual(summarize([doc], range).totals.map(row => [row.currency, row.expense, row.refund, row.net]), [['USD', 0, 300, -300]]);
});

test('legacy CNY records load without writes; a foreign expense upgrades only its own document', async () => {
  const { docs } = makeDemo('Ledger', '2026-11-30');
  const files = new Map(docs.map((doc, index) => [`Ledger/record-${index}.md`, encodeDocument(doc)])); const before = new Map(files); let writes = 0;
  const port: StoragePort = { listMarkdown: async () => [...files.keys()], read: async path => files.get(path)!, exists: path => files.has(path), write: async (path, content, expected) => { assert.equal(files.get(path) ?? null, expected); files.set(path, content); writes++; }, trash: async path => { files.delete(path); } };
  const store = new LedgerStore(port, 'Ledger'); await store.load(); assert.equal(writes, 0);
  assert.deepEqual(files, before); assert.equal(summarize(store.documents, { start: '2026-01-01', end: '2026-12-31' }).totals[0]!.net, 79700);
  const original = store.get(docs[0]!.item.id)!; const updated = payment(original, 'USD', '19.99');
  assert.equal(updated.schema, 2); assert.equal(original.schema, 1);
  assert.deepEqual(updated.events.slice(0, original.events.length), original.events);
  await store.save(updated, original); const restarted = new LedgerStore(port, 'Ledger'); await restarted.load();
  assert.deepEqual(restarted.get(original.item.id)!.events, updated.events);
  for (let i = 1; i < docs.length; i++) assert.equal(files.get(`Ledger/record-${i}.md`), before.get(`Ledger/record-${i}.md`));
  assert.deepEqual(docs.map(doc => doc.schema), [1, 1, 1, 1]);
});

test('new schemas protect foreign amounts from old readers and reject unsupported currencies', () => {
  const doc = mixed(); assert.equal(doc.schema, 2);
  const source = encodeDocument(doc); assert.deepEqual(decodeDocument(source), doc);
  assert.throws(() => decodeDocument(source.replace('schema: 2', 'schema: 1')), /schema 2/);
  const invalid = structuredClone(doc); (invalid.events[0] as unknown as { currency: string }).currency = 'XYZ';
  assert.throws(() => validateDocument(invalid), /不支持的币种/);
});

test('CSV and Markdown exports identify each original currency and use its precision in both languages', () => {
  for (const locale of ['zh-CN', 'en'] as const) {
    setLocale(locale); const doc = mixed(); const csv = exportCsv([doc], range);
    for (const row of ['"CNY",299.00,299.00', '"USD",49.99,49.99', '"JPY",1999,1999', '"KWD",1.234,1.234']) assert.ok(csv.includes(row), row);
    assert.equal(csv.trim().split('\r\n').length, 5);
    const review = exportReview([doc], range);
    for (const currency of ['CNY', 'USD', 'JPY', 'KWD']) assert.ok(review.includes(`### ${currency}`));
    assert.ok(review.includes('USD 49.99')); assert.ok(review.includes('JPY 1,999')); assert.ok(review.includes('KWD 1.234'));
    const reloaded = decodeDocument(encodeDocument(doc)); assert.deepEqual(reloaded, doc);
  }
});
