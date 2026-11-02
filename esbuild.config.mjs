import * as esbuild from 'esbuild';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('manifest.json', 'utf8'));

const options = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron'],
  format: 'cjs',
  target: 'es2020',
  platform: 'browser',
  outfile: 'main.js',
  banner: { js: `/* 学习与创作投入账本 v${version} | MIT License | bundled source: src/main.ts */` },
  minify: true,
  logLevel: 'info',
};
if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context({ ...options, sourcemap: 'inline', minify: false });
  await ctx.watch();
} else {
  await esbuild.build(options);
}
