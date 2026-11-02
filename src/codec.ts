import { t } from './i18n';
import { isMap, isScalar, parseDocument, stringify } from 'yaml';
import { EVENT_LABELS, LedgerDocument, LedgerError, money, validateDocument, wiki } from './domain';
import { attachmentMarkdown } from './attachments';

const APPENDIX = '<!-- ledger:appendix -->';
export function looksLikeLedger(path: string, source: string): boolean {
  if (/(?:^|\/)投入-[^/]+\.md$/.test(path)) return true;
  const opening = /^\uFEFF?---\r?\n/.exec(source);
  if (!opening) return false;
  const rest = source.slice(opening[0].length);
  const end = /^---(?:\r?\n|$)/m.exec(rest);
  // Inspect YAML nodes rather than source spelling. Incomplete frontmatter can
  // still identify a ledger so decodeDocument reports the affected file.
  const yaml = parseDocument(end ? rest.slice(0, end.index) : rest, { uniqueKeys: true });
  return isMap(yaml.contents) && yaml.contents.items.some(pair =>
    isScalar(pair.key) && pair.key.value === 'ledger' && isScalar(pair.value) && pair.value.value === 'learning-investment-ledger');
}
export function decodeDocument(source: string): LedgerDocument {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(source);
  if (!match) throw new LedgerError(t("缺少 YAML 属性区（文件开头的 ---）。"));
  const yaml = parseDocument(match[1]!, { uniqueKeys: true, maxAliasCount: 0 } as Parameters<typeof parseDocument>[1]);
  if (yaml.errors.length) throw new LedgerError(t("YAML 无法解析：{0}", yaml.errors.map(error => error.message).join('；')));
  const value = yaml.toJS({ maxAliasCount: 0 }) as LedgerDocument;
  if (!value || typeof value !== 'object') throw new LedgerError(t("YAML 属性区不是记录对象。"));
  const body = match[2]!;
  const marker = body.indexOf(APPENDIX);
  value.appendix = marker >= 0 ? body.slice(marker + APPENDIX.length).replace(/^\r?\n/, '') : body;
  validateDocument(value);
  return value;
}
export function encodeDocument(doc: LedgerDocument): string {
  validateDocument(doc);
  const { appendix, ...data } = doc;
  const yaml = stringify(data, { lineWidth: 0, aliasDuplicateObjects: false });
  const { item } = doc;
  const lines = [`# ${item.name}`, '', t("- 类型：{0}", t(item.type)), t("- 状态：{0}", t(item.status)), t("- 购买原因：{0}", item.reason || t("未填写")), t("- 下次回访：{0}", item.nextReview || t("未设置"))];
  if (item.project) lines.push(t("- 所属项目：{0}", wiki(item.project)));
  if (item.notes.length) lines.push(t("- 相关笔记：{0}", item.notes.map(wiki).join('、')));
  if (item.attachments?.length) lines.push('', t("## 投入项附件"), '', ...item.attachments.map(a => `- ${attachmentMarkdown(a)}`));
  lines.push('', t("## 投入时间线"), '');
  for (const event of [...doc.events].sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`))) {
    lines.push(`### ${event.date} ${event.time} · ${t(EVENT_LABELS[event.type])} · ${event.title}`, '', `<!-- event:${event.id} -->`);
    if (event.type === 'expense' || event.type === 'refund') lines.push(t("金额：{0}", money(event.amount)));
    if (event.type === 'refund') lines.push(t("原支出 ID：{0}", event.expenseId));
    if (event.type === 'learning') lines.push(event.content, ...(event.minutes ? [t("时长：{0} 分钟", event.minutes)] : []));
    if (event.type === 'outcome') lines.push(t("成果：{0}", wiki(event.target)), event.content);
    if (event.type === 'review') lines.push(t("最初期望：{0}", event.expectation), t("实际使用：{0}", event.usage), t("成果：{0}", event.outcomes), t("是否达到预期：{0}", t(event.rating)), t("下一步：{0}", event.plan), t("下次回访：{0}", event.nextReview || t("未设置")));
    if (event.notes.length) lines.push(t("相关笔记：{0}", event.notes.map(wiki).join('、')));
    if (event.attachments?.length) lines.push('', t("附件："), ...event.attachments.map(a => `- ${attachmentMarkdown(a)}`));
    lines.push('');
  }
  if (!doc.events.length) lines.push(t("还没有事件。"), '');
  lines.push('---', '', t("> 上方内容由插件根据 YAML 属性生成。可在下方保留自己的笔记；修改结构化记录请使用插件或编辑 YAML。"), '', APPENDIX, appendix);
  return `---\n${yaml}---\n\n${lines.join('\n')}`;
}
