import { mkdir, writeFile } from 'node:fs/promises';
import { makeDemo } from '../src/demo';
import { encodeDocument } from '../src/codec';
import { DEMO_MARKER } from '../src/store';
import { Locale, setLocale } from '../src/i18n';
import path from 'node:path';

for (const locale of ['zh-CN', 'en'] as Locale[]) {
  setLocale(locale);
  const folder = locale === 'en' ? 'Investment Ledger' : '投入账本';
  const destination = `${locale === 'en' ? 'demo/en' : 'demo'}/${folder}/演示数据`;
  const data = makeDemo(folder, process.argv[2] || '2026-11-02');
  await mkdir(destination, { recursive: true });
  for (const doc of data.docs) await writeFile(`${destination}/投入-${doc.item.id}.md`, encodeDocument(doc));
  for (const [relative, content] of Object.entries(data.notes)) {
    await mkdir(path.dirname(`${destination}/${relative}`), { recursive: true });
    await writeFile(`${destination}/${relative}`, `${DEMO_MARKER}\n\n${content}`);
  }
  console.log(`Generated ${locale}: ${data.docs.length} investments and ${Object.keys(data.notes).length} notes in ${destination}`);
}
