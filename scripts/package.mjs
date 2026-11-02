import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const { id, version } = manifest;
if (!/^[a-z0-9-]+$/.test(id) || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Release identity or version is invalid');
const dist = path.join(root, 'dist');
const releaseName = `release-${version}`;
const auditScript = path.join(root, 'scripts/release_audit.py');
const audit = (...args) => execFileSync('python3', ['-B', auditScript, ...args], { stdio: 'inherit' });
const archive = (destination, source) => execFileSync('python3', ['-B', path.join(root, 'scripts/zip.py'), destination, source]);

async function copyAllowed(name, destination) {
  if (path.isAbsolute(name) || name.includes('\\') || name.split('/').some(part => !part || part.startsWith('.') || part === '__MACOSX')) throw new Error('Unsafe release file name');
  let current = root;
  for (const part of name.split('/')) {
    current = path.join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error('Release files cannot use symbolic links');
  }
  if (!lstatSync(current).isFile()) throw new Error('Release entry must be a regular file');
  const target = path.join(destination, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, readFileSync(current), { mode: 0o644 });
}

async function prepareRelease() {
  const allowed = JSON.parse(readFileSync('scripts/release-files.json', 'utf8'));
  audit('files', root, 'install');
  audit('files', root, 'source');
  const staging = path.join(dist, `release-staging-${version}`);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    const install = path.join(staging, id);
    const source = path.join(staging, `${id}-source`);
    const release = path.join(staging, releaseName);
    await mkdir(release, { recursive: true });
    for (const name of allowed.install) await copyAllowed(name, install);
    for (const name of allowed.source) await copyAllowed(name, source);
    const installZip = `${id}-${version}.zip`;
    const sourceZip = `${id}-${version}-source.zip`;
    archive(path.join(release, installZip), install);
    archive(path.join(release, sourceZip), source);
    for (const name of ['main.js', 'manifest.json', 'styles.css', 'RELEASE-NOTES.md', 'RELEASE-NOTES.zh-CN.md', 'PUBLISHING.md']) await copyAllowed(name, release);
    const report = `# Release checks / 发布文件检查

Version / 版本：${version}

- Installation archive: ${allowed.install.length} explicitly allowed files. Source archive: ${allowed.source.length} explicitly allowed files.
- 安装归档收录 ${allowed.install.length} 个明确允许的文件；源码归档收录 ${allowed.source.length} 个明确允许的文件。
- Hidden files, Git history, local configuration, dependency folders, real ledger folders and symbolic links are excluded.
- 不收录隐藏文件、Git 历史、本地配置、依赖目录、真实账本目录或符号链接。
- ZIP dates use a fixed format baseline. Host attributes, comments and extra fields are not copied from the source filesystem.
- ZIP 时间统一处理，不复制源文件系统的机器属性、注释或额外字段。
- Text is checked for local identity markers, machine paths, private keys, access tokens, personal email addresses and source maps. Required public dependency attribution is retained.
- 文本检查覆盖本机身份标记、机器路径、私钥、访问令牌、个人邮箱及源映射；第三方公开许可证署名保留。
- PNG checks reject text, profiles, timestamps, EXIF and trailing data. Screenshot pixels are unchanged.
- PNG 检查拒绝文本、配置、时间、EXIF 附加块及尾随数据，截图像素保持原样。
- The three runtime assets match the installation archive. SHA-256 values cover every other file in this release folder.
- 三个独立运行文件与安装包一致，SHA-256 清单覆盖发布目录中的其余全部文件。
- This report describes release-payload checks. Functional validation and known limits are documented in the included verification records.
- 本报告说明发布文件检查；功能验收与已知范围见随附验收记录。

Plugin IDs, versions, required manifest fields, license notices and synthetic demo dates remain part of the product data.
插件标识、版本、必需清单字段、许可证及虚构演示日期作为产品数据保留。
`;
    await writeFile(path.join(release, 'RELEASE-CHECKS.md'), report);
    const files = readdirSync(release).sort();
    const sums = files.map(name => `${createHash('sha256').update(readFileSync(path.join(release, name))).digest('hex')}  ${name}`).join('\n') + '\n';
    await writeFile(path.join(release, 'SHA256SUMS.txt'), sums);
    audit('directory', release);
    const materialsZip = `${id}-${version}-release-materials.zip`;
    archive(path.join(staging, materialsZip), release);
    audit('zip', path.join(staging, materialsZip));
    const destination = path.join(dist, releaseName);
    await rm(destination, { recursive: true, force: true });
    await rename(release, destination);
    for (const name of [installZip, sourceZip]) await writeFile(path.join(dist, name), readFileSync(path.join(destination, name)));
    await rename(path.join(staging, materialsZip), path.join(dist, materialsZip));
    console.log(path.join(dist, installZip));
    console.log(path.join(dist, sourceZip));
    console.log(path.join(dist, materialsZip));
    console.log(destination);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv.includes('--audit-only')) audit('directory', path.join(dist, releaseName));
else await prepareRelease();
