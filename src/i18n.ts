import englishMessages from './locales/en.json';

export type Locale = 'zh-CN' | 'en';
export type LanguagePreference = 'auto' | Locale;

// Source messages are Simplified Chinese. Keep the domain usable without Obsidian.
let locale: Locale = 'zh-CN';
export function resolveLocale(preference: LanguagePreference, obsidianLanguage: string): Locale {
  if (preference === 'zh-CN' || preference === 'en') return preference;
  return /^zh(?:[-_]|$)/i.test(obsidianLanguage) ? 'zh-CN' : 'en';
}
export function setLocale(value: Locale): void { locale = value; }
export function getLocale(): Locale { return locale; }

/** Substitute once, so braces and replacement characters in user text stay literal. */
export function t(source: string, ...values: unknown[]): string {
  const template = locale === 'en' ? (englishMessages as Record<string, string>)[source] ?? source : source;
  return template.replace(/\{(\d+)\}/g, (placeholder, index: string) => Number(index) < values.length ? String(values[Number(index)] ?? '') : placeholder);
}
export function localizedOptions(values: readonly string[]): [string, string][] { return values.map(value => [value, t(value)]); }
export { englishMessages };
