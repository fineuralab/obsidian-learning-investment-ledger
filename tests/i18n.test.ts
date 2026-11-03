import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import { decodeDocument, encodeDocument } from '../src/codec';
import { makeDemo } from '../src/demo';
import { baseEvent, createDocument, exportCsv, exportReview, filterEvents, parseMoney, putEvent, summarize } from '../src/domain';
import { englishMessages, getLocale, localizedOptions, resolveLocale, setLocale, t } from '../src/i18n';

afterEach(() => setLocale('zh-CN'));
const range = { start: '2026-01-01', end: '2026-12-31' };

test('language selection follows Obsidian with explicit overrides and safe fallback', () => {
  for (const language of ['zh', 'zh-CN', 'zh_TW', 'ZH-hans']) assert.equal(resolveLocale('auto', language), 'zh-CN');
  for (const language of ['en', 'en-US', 'fr', 'ja', '']) assert.equal(resolveLocale('auto', language), 'en');
  assert.equal(resolveLocale('en', 'zh'), 'en');
  assert.equal(resolveLocale('zh-CN', 'en'), 'zh-CN');
  setLocale('en'); assert.equal(getLocale(), 'en');
  assert.equal(t('保存记录'), 'Save record');
  assert.deepEqual(localizedOptions(['课程', '已完成', '部分达到']), [['课程', 'Course'], ['已完成', 'Completed'], ['部分达到', 'Partly met']]);
});

test('translations keep interpolation literal and every catalog entry preserves placeholders', () => {
  setLocale('en');
  assert.equal(t('删除{0}', 'User {0} $& 中文'), 'Delete User {0} $& 中文');
  const placeholders = (value: string): string[] => [...value.matchAll(/\{\d+\}/g)].map(m => m[0]).sort();
  for (const [source, english] of Object.entries(englishMessages)) {
    assert.ok(english.trim(), source);
    assert.deepEqual(placeholders(english), placeholders(source), source);
    assert.equal(/\p{Script=Han}/u.test(english), false, source);
  }
});

test('all literal translation calls have English catalog entries, including nested format arguments', () => {
  const used = new Set<string>();
  for (const name of readdirSync('src').filter(name => name.endsWith('.ts'))) {
    const file = ts.createSourceFile(name, readFileSync(`src/${name}`, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't') {
        const key = node.arguments[0];
        if (key && ts.isStringLiteral(key)) used.add(key.text);
      }
      node.forEachChild(visit);
    };
    visit(file);
  }
  for (const key of used) assert.ok(Object.prototype.hasOwnProperty.call(englishMessages, key), `Missing English translation: ${key}`);
  assert.ok(used.size > 350);
});

test('language changes preserve schema values, IDs, paths, user text, money and restart recovery', () => {
  const { docs } = makeDemo('投入账本', '2026-11-30');
  const original = structuredClone(docs);
  const chinese = docs.map(encodeDocument);
  setLocale('en');
  for (const [index, doc] of docs.entries()) {
    const english = encodeDocument(doc);
    assert.match(english, /## Investment timeline/);
    assert.deepEqual(decodeDocument(english), original[index]);
    assert.equal(english.split('\n---\n')[0], chinese[index]!.split('\n---\n')[0]);
  }
  assert.deepEqual(docs, original);
  assert.equal(summarize(docs, range).totals[0]!.net, 79700);
  assert.equal(docs[0]!.item.type, '课程');
  assert.equal(filterEvents(docs, { range, keyword: 'Course', type: 'expense' }).length, 1);
  setLocale('zh-CN');
  assert.equal(encodeDocument(docs[0]!), chinese[0]);
});

test('English exports localize labels and ratings while preserving numeric values and user content', () => {
  setLocale('en');
  let doc = createDocument('My course / 我的课程', '课程');
  doc = putEvent(doc, { ...baseEvent(doc.item.id, 'Purchase', '2026-11-01'), type: 'expense', amount: 29900 });
  doc = putEvent(doc, { ...baseEvent(doc.item.id, 'Refund', '2026-11-02'), type: 'refund', amount: 9900, expenseId: doc.events[0]!.id });
  doc = putEvent(doc, { ...baseEvent(doc.item.id, 'Review', '2026-11-03'), type: 'review', expectation: '', usage: 'Used it', outcomes: '', rating: '部分达到', plan: 'Continue', nextReview: null });
  const csv = exportCsv([doc], range);
  assert.match(csv, /"Record ID","Investment ID","Date"/);
  assert.match(csv, /"Time","Event type","Investments","Category"/);
  assert.equal(new Set(csv.split('\r\n')[0]!.split(',')).size, 15, 'CSV headings must identify each column unambiguously');
  assert.match(csv, /"Expense","My course \/ 我的课程","Course","Purchase","CNY",299.00,299.00/);
  assert.match(csv, /"Refund".*99.00,-99.00/);
  assert.equal(csv.trim().split('\r\n').length, 3);
  const review = exportReview([doc], range, 'Keep learning', '2026-11-03');
  assert.match(review, /# Investment review/);
  assert.match(review, /Net spending for the period: ¥200.00/);
  assert.match(review, /Expectations met: Partly met/);
  assert.match(review, /My course \/ 我的课程/);
  assert.match(review, /Keep learning/);
  assert.throws(() => parseMoney('0'), /Enter an amount greater than 0/);
});

test('English demo has matching notes and outcomes with stable IDs and equivalent accounting', () => {
  const chinese = makeDemo('Ledger', '2026-11-30');
  setLocale('en');
  const english = makeDemo('Ledger', '2026-11-30');
  assert.deepEqual(english.docs.map(d => d.item.type), ['课程', '书籍', '工具', '创作项目']);
  assert.deepEqual(english.docs.flatMap(d => d.events.filter(e => e.type === 'expense').map(e => e.amount)), [39900, 19900, 9900, 29900]);
  assert.equal(summarize(english.docs, range).totals[0]!.expense, 99600);
  assert.equal(summarize(english.docs, range).totals[0]!.refund, 19900);
  assert.equal(Object.keys(english.notes).length, 11);
  assert.deepEqual(english.docs.map(d => [d.item.id, ...d.events.map(e => e.id)]), chinese.docs.map(d => [d.item.id, ...d.events.map(e => e.id)]));
  assert.equal(summarize(english.docs, range).totals[0]!.net, 79700);
  assert.equal(english.docs[0]!.item.name, 'Practical Python course');
  const paths = new Set(Object.keys(english.notes).map(path => `Ledger/演示数据/${path}`));
  for (const doc of english.docs) {
    for (const path of [doc.item.project, ...doc.item.notes, ...doc.events.flatMap(e => [...e.notes, ...(e.type === 'outcome' ? [e.target] : [])])]) assert.ok(paths.has(path), path);
    for (const event of doc.events) assert.equal(/\p{Script=Han}/u.test(event.title), false, event.title);
    assert.deepEqual(decodeDocument(encodeDocument(doc)), doc);
  }
  for (const content of Object.values(english.notes)) assert.equal(/\p{Script=Han}/u.test(content), false);
});
