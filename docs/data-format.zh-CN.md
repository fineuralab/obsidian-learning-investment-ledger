# 数据格式 v1

[English](data-format.md) · **简体中文**

一个投入项占一篇 Markdown，默认文件名为 `投入-<item.id>.md`。同一投入项的所有事件放在该文件的 `events` 数组中，单次编辑只需保存一篇文件，原支出和退款不会分散在多个文件之间。

```yaml
---
ledger: learning-investment-ledger
schema: 1
demo: false
item:
  id: 6cc6d05c-f3af-4b38-b45f-80aac819457f
  name: Python 实战课程
  type: 课程
  reason: 学会整理文件
  project: 项目/文件整理.md
  notes:
    - 学习/Python.md
  status: 进行中
  nextReview: 2026-12-02
  createdAt: 2026-11-02T06:00:00.000Z
  updatedAt: 2026-11-02T06:00:00.001Z
events:
  - id: 715a67a5-c8cb-4a5e-ac64-642a9a354cf0
    itemId: 6cc6d05c-f3af-4b38-b45f-80aac819457f
    type: expense
    date: 2026-11-02
    time: "14:00"
    title: 购买 Python 课程
    notes:
      - 学习/Python.md
    createdAt: 2026-11-02T06:00:00.000Z
    amount: 29900
---
```

属性中的日期与 ISO 时间戳按字符串读取。`nextReview` 可为 `null`，不能写空字符串。所有记录的 ID 全局唯一，系统新增时使用 UUID，演示数据使用固定的 `demo-` ID。修改名称或源文件名不会改变 ID。请勿手动复制文件后保留同一 ID；插件会报告冲突并阻止对冲突文件写入。

事件共有字段为 `id`、`itemId`、`type`、`date`、`time`、`title`、`notes`、`createdAt`。时间线先按日期、时间排序，再以创建时间和 ID 排同一时刻的事件。金额只接受正整数分。

| type | 额外字段 |
| --- | --- |
| expense | `amount`：支出金额，整数分 |
| refund | `amount`；`expenseId`：同一投入项内原支出的 ID |
| learning | `content`：非空说明；`minutes`：正整数分钟或 `null` |
| outcome | `target`：库内成果文件路径；`content`：说明 |
| review | `expectation`、`usage`、`outcomes`、`rating`、`plan`、`nextReview` |

`rating` 为「达到」「部分达到」「未达到」「暂无法判断」。回访的 `usage`、`plan` 必填，下一次回访日期若填写，须晚于本次日期。投入项状态为「未开始」「进行中」「已完成」「已搁置」，类型为「课程」「书籍」「工具」「创作项目」「其他」。

正文是根据属性自动生成的阅读视图，修改正文的已生成时间线不会改变结构化记录。`<!-- ledger:appendix -->` 后的全部内容为用户所有，编辑保存和重建索引会保留。若标记不存在，插件会将原正文保留为补充内容。

源文件保存采用 Obsidian `Vault.process`，更新前比对上次读取的完整文本，同时验证表单使用的读取快照。外部或另一表单修改过内容时，不覆盖新文本，并保留表单输入；手动修改没有更新 `updatedAt` 时也会被识别。原记录已不存在或数据文件夹已改变时，旧表单不能将其重新创建。删除确认同样核对读取快照，再移到库内回收站。快照校验信息只保留在内存中，不新增 Markdown 字段。新增采用 create-only。

关联路径为库内相对路径，保留 `.md` 后缀。不保存设备绝对路径。用户关联的项目、笔记、成果不会因为投入项删除而被删除。文件或整个文件夹移动时，插件更新项目路径、投入笔记路径、事件笔记路径和成果 target；目标删除时仅标记失效，不删除关联记录。

本地索引只存在内存中，可从这些 Markdown 文件重建。无法解析的文件和不支持的 schema 会提供逐文件反馈，不静默改写或清空源文件。未识别为账本的普通 Markdown 会被忽略。

## 0.2.0 附件字段

`item` 和每个事件可选地带有 `attachments` 数组；不含该字段的 0.1.0 文件保持有效，`schema` 仍为 1。

```yaml
attachments:
  - id: c7126273-1098-4eac-9d29-cb3f8f063f62
    kind: file
    target: 投入账本/附件/练习截图.png
    label: 练习截图.png
  - id: 2bdd6c57-e0c7-47aa-8438-c4426632506c
    kind: url
    target: https://example.com/material.pdf
    label: 在线讲义
```

附件 `id` 在列表内唯一；`kind` 为 `file` 或 `url`，`target` 必填，`label` 可选。文件仅允许库内相对路径；网址仅允许不含登录凭据的 HTTP / HTTPS。链接不在保存时发起网络请求。

二进制附件独立保存在库内，Markdown 只保存路径，不把图片转为 base64。导入文件名添加 UUID 前缀避免同名覆盖。可读正文对库内图片生成 `![[路径]]`，其他文件生成 `[[路径]]`。附件不参与成果统计；文件和文件夹移动时，附件路径与其他关联一起更新。

## 0.3.0 中英文

界面及导出文案可选择中文或英文，`schema` 仍为 1。类型、状态、回访评价等 YAML 枚举保持原有中文值以兼容旧记录，界面显示对应译名。切换语言不会改写用户文本、ID、金额及路径；已有文件不会仅为切换语言而重写。后续保存时的可读正文与新导出使用当前选择的语言。数据目录内的固定子文件夹名也保持不变。

## 0.4.0 逐笔币种

支出和退款可带有 `currency`（ISO 代码）；缺省严格表示 `CNY`。`amount` 始终是该币种的整数最小单位：例如 USD 19.99 保存为 `amount: 1999, currency: USD`；JPY 1999 保存为 `amount: 1999, currency: JPY`；KWD 1.234 保存为 `amount: 1234, currency: KWD`。不按汇率转换。

纯人民币文件的 `schema: 1` 及原有缺省字段可保持原样；新增外币事件时，单个文件升级为 `schema: 2`，旧人民币事件不补写币种或改金额。0.4.0 兼容读取 schema 1 和 2；旧插件不支持 schema 2，无法误按人民币统计。schema 1 下显式非 CNY 币种会报错。未知币种、不匹配的退款币种及超出币种精度的输入均被拒绝。

退款必须与原支出币种一致；有退款时不能单独改支出币种。汇总按币种独立累计原币金额与退款，CSV 另列币种，Markdown 复盘为每个币种提供小节。

汇总采用精确整数运算；安全整数范围内的汇总仍为普通数字，更大金额以内存中的 BigInt 计算并直接格式化为十进制文本，不写入账本 YAML。逐笔金额及 schema 不变，只有图表百分比转换为有界的普通数字。
