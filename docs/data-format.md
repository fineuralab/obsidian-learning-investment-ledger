# Data format v1

**English** · [简体中文](data-format.zh-CN.md)

Each investment occupies one Markdown file, normally `投入-<item.id>.md`. All its events live in the same `events` array. A single-file save keeps original expenses and refunds together.

```yaml
---
ledger: learning-investment-ledger
schema: 1
demo: false
item:
  id: 6cc6d05c-f3af-4b38-b45f-80aac819457f
  name: Practical Python course
  type: 课程
  reason: Learn to organize files
  project: Projects/File organization.md
  notes:
    - Learning/Python.md
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
    title: Purchase Python course
    notes:
      - Learning/Python.md
    createdAt: 2026-11-02T06:00:00.000Z
    amount: 29900
---
```

Dates and ISO timestamps are read as strings. `nextReview` is a date or `null`, never an empty string. IDs are globally unique: new records use UUIDs and demo records have stable `demo-` IDs. Renaming an investment or its source file does not change its ID. Duplicated IDs are reported and writes to conflicting files are blocked.

Common event fields are `id`, `itemId`, `type`, `date`, `time`, `title`, `notes` and `createdAt`. Events sort by date and time, then creation timestamp and ID. Financial amounts must be positive integer fen (one hundredth of a CNY).

| Event type | Additional fields |
| --- | --- |
| `expense` | `amount`: expense in integer fen |
| `refund` | `amount`; `expenseId`: original expense ID within the same investment |
| `learning` | `content`: nonempty description; `minutes`: positive integer or `null` |
| `outcome` | `target`: vault-relative outcome path; `content`: description |
| `review` | `expectation`, `usage`, `outcomes`, `rating`, `plan`, `nextReview` |

## Language and stable enum values

Version 0.3 adds English and Simplified Chinese without changing `schema: 1`. These stored enum values remain unchanged in both languages; the interface and exports translate their labels.

| Field | Stored value → English label |
| --- | --- |
| `item.type` | `课程` → Course; `书籍` → Book; `工具` → Tool; `创作项目` → Creative project; `其他` → Other |
| `item.status` | `未开始` → Not started; `进行中` → In progress; `已完成` → Completed; `已搁置` → On hold |
| `review.rating` | `达到` → Met; `部分达到` → Partly met; `未达到` → Not met; `暂无法判断` → Too early to tell |

Review `usage` and `plan` are required. A next review date must be after the review's own date. Switching language preserves user text, paths, IDs, amounts and enum values. Existing source files are not rewritten merely to change language. Future saves and exports generate readable text in the selected language.

## Readable body and safe saving

The body is generated from frontmatter. Editing the generated timeline does not update structured events. Everything after `<!-- ledger:appendix -->` is user-owned and preserved on save and rebuild. If the marker is absent, the original body is preserved as an appendix.

Existing files are updated through Obsidian `Vault.process`, comparing the complete previously read source and the form's read snapshot. External edits or another form's changes prevent stale overwrites, including when a manual edit leaves `updatedAt` unchanged; input stays available for retry. A missing record or a changed data folder rejects an old update rather than creating a replacement. Delete confirmations also check their read snapshot before moving a file to the vault trash. Snapshot guards stay in memory and add no fields to the Markdown. New writes are create-only.

Links use vault-relative paths, including the `.md` extension. No device-absolute paths are stored. Deleting an investment does not delete its linked project, notes or outcome files. File and folder moves update projects, investment notes, event notes, outcome targets and attachment paths. Deleted targets leave an actionable missing-link record.

The index is in memory and rebuilds from Markdown. Parsing failures and unsupported schemas identify the affected files; the plugin never silently clears or rewrites them. Unrelated Markdown is ignored. The default subfolder names (`附件`, `演示数据`, `笔记`, `复盘`) remain stable across interface languages.

## Optional attachment fields (since 0.2)

Both `item` and each event can have an optional `attachments` array. Older files without this field remain valid.

```yaml
attachments:
  - id: c7126273-1098-4eac-9d29-cb3f8f063f62
    kind: file
    target: Investment Ledger/附件/practice.png
    label: Practice screenshot
  - id: 2bdd6c57-e0c7-47aa-8438-c4426632506c
    kind: url
    target: https://example.com/material.pdf
    label: Course handout
```

Attachment IDs are unique within their list. `kind` is `file` or `url`; `target` is required and `label` is optional. File targets must be safe vault-relative paths. URLs must be HTTP or HTTPS without embedded login credentials. Saving a link makes no network request.

Binary files stay separately in the vault, rather than being encoded as base64 in Markdown. Imported names receive UUID prefixes to avoid overwrites. The readable body uses `![[path]]` for supported images and `[[path]]` for other files. Attachments do not contribute to confirmed outcome statistics.
