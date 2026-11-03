# Release preparation / 发布准备

## English

Run `npm ci`, `npm test`, then `npm run package`. The package command checks types, builds production JavaScript and audits the allowed files and resulting archives. It writes a versioned release folder and a materials ZIP into `dist/`.

For version 0.4.0, use `dist/release-0.4.0/` as the upload folder. The outer `learning-investment-ledger-0.4.0-release-materials.zip` collects the materials for review; it is not an Obsidian installation package.

1. Synchronize the reviewed source changes before choosing the release target. The target and the attached source/build must describe the same version.
2. Create a draft GitHub release with tag **0.4.0**, matching `manifest.json` exactly, without a `v` prefix.
3. Use the title **0.4.0 · Early preview / 早期预览版** and mark it as a pre-release.
4. Copy the English and Chinese release-note sections into the release description. Omit their top-level language-navigation links when combining them.
5. Attach all files in the versioned upload folder: `main.js`, `manifest.json`, `styles.css`, the installation ZIP, the source ZIP, both release-note files, this guide, `RELEASE-CHECKS.md` and `SHA256SUMS.txt`. The checksum list covers the complete set.
6. Verify the asset names and download/install directions in the draft. The installation ZIP includes its own plugin folder; the source ZIP requires a build.
7. Publishing a release and changing the repository's visibility are separate actions. Preparing these files performs neither action.

The downloadable packages use an explicit file list. They exclude hidden files, Git history, editor configuration, real ledger data, temporary credentials, local output and dependency directories. ZIP dates and attributes are normalized; comments and extra fields are empty. PNG text, profile, time and EXIF chunks are rejected. Required plugin metadata and license attribution remain intact.

The repository's ignore rules prevent accidental additions; they are not included in the source ZIP. GitHub-generated source archives follow GitHub's own archive format and are separate from the curated source ZIP.

## 简体中文

执行 `npm ci`、`npm test`，然后运行 `npm run package`。打包命令会检查类型、构建生产版 JavaScript，并检查允许收录的文件和输出归档，在 `dist/` 生成按版本命名的发布目录及材料 ZIP。

0.4.0 的上传目录为 `dist/release-0.4.0/`。外层 `learning-investment-ledger-0.4.0-release-materials.zip` 用于集中审阅发布材料，不是 Obsidian 安装包。

1. 选择 Release 目标前，先同步已核对的源码修改，确保目标提交与随附源码及构建属于同一版本。
2. 创建 GitHub Release 草稿，标签使用 **0.4.0**，与 `manifest.json` 一致，不加 `v`。
3. 标题使用 **0.4.0 · Early preview / 早期预览版**，勾选预发布。
4. 将中英文发布说明复制到描述中；合并时省略文首的语言切换链接。
5. 附加版本上传目录中的全部文件：`main.js`、`manifest.json`、`styles.css`、安装 ZIP、源码 ZIP、两份发布说明、本指南、`RELEASE-CHECKS.md` 和 `SHA256SUMS.txt`。校验清单覆盖整套文件。
6. 在草稿中核对文件名及下载安装说明。安装 ZIP 内含插件目录，源码 ZIP 需要构建。
7. 发布 Release 和更改仓库可见性是两个操作；准备这些文件不会执行任意一项。

下载包使用明确的文件名单，不收录隐藏文件、Git 历史、编辑器配置、真实账本、临时密钥、本地输出或依赖目录。ZIP 时间与属性统一处理，不携带注释和额外字段；PNG 中的文本、色彩配置、时间及 EXIF 附加块会被拒绝。插件运行必需的清单字段和许可证署名保留。

仓库忽略规则用于防止误传，不放入源码 ZIP。GitHub 自动生成的源码归档采用 GitHub 自身格式，与这里准备的精选源码 ZIP 分开。
