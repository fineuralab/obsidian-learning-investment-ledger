import { t } from './i18n';
export interface Attachment {
  id: string;
  kind: 'file' | 'url';
  target: string;
  label?: string;
}
export function isImagePath(path: string): boolean { return /\.(?:png|jpe?g|gif|webp|avif|bmp)$/i.test(path); }
export function isSafeWebUrl(value: string): boolean {
  try { if (/[\x00-\x20]/.test(value)) return false; const url = new URL(value); return (url.protocol === 'https:' || url.protocol === 'http:') && !!url.hostname && !url.username && !url.password; }
  catch { return false; }
}
export function validateAttachments(value: unknown): asserts value is Attachment[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw new Error(t("附件必须是列表。"));
  const ids = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') throw new Error(t("附件信息无效。"));
    const a = entry as Attachment;
    if (typeof a.id !== 'string' || !a.id.trim() || ids.has(a.id)) throw new Error(t("附件 ID 为空或重复。"));
    ids.add(a.id);
    if (typeof a.target !== 'string' || !a.target.trim() || (a.label !== undefined && typeof a.label !== 'string')) throw new Error(t("附件链接或名称无效。"));
    if (a.kind === 'url') { if (!isSafeWebUrl(a.target)) throw new Error(t("附件网址须使用有效的 http:// 或 https:// 地址，且不能包含登录凭据。")); }
    else if (a.kind === 'file') {
      if (a.target.startsWith('/') || /^[a-z]:/i.test(a.target) || /[\\\x00-\x1f]/.test(a.target) || a.target.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(t("文件附件须使用库内相对路径。"));
    } else throw new Error(t("附件类型无效。"));
  }
}
export function attachmentMarkdown(a: Attachment): string {
  if (a.kind === 'url') {
    const label = (a.label || a.target).replace(/[\[\]\\]/g, '\\$&').replace(/[\r\n]/g, ' ');
    return `[${label}](<${a.target.replace(/</g, '%3C').replace(/>/g, '%3E').replace(/[\r\n]/g, '')}>)`;
  }
  return `${isImagePath(a.target) ? '!' : ''}[[${a.target.replace(/\]/g, '\\]').replace(/\[/g, '\\[')}]]`;
}
export function attachmentName(a: Attachment): string { return a.label || (a.kind === 'file' ? a.target.split('/').pop()! : a.target); }
export function importedAttachmentPath(folder: string, demo: boolean, id: string, name: string): string {
  const safe = name.replace(/[\\/:*?"<>|\[\]#^\x00-\x1f]/g, '-').replace(/^\.+/, '').trim().slice(-140) || '附件';
  return `${folder}/${demo ? '演示数据/' : ''}附件/${id}-${safe}`;
}
