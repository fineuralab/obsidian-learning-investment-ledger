---
ledger: learning-investment-ledger
schema: 1
demo: true
item:
  id: demo-book
  name: Designing Data-Intensive Applications
  type: 书籍
  reason: Understand data system trade-offs and choose storage for a personal project.
  project: Investment Ledger/演示数据/笔记/Personal knowledge tool.md
  notes:
    - Investment Ledger/演示数据/笔记/Data systems reading notes.md
  status: 已搁置
  nextReview: null
  createdAt: 2026-11-02T09:00:05.681Z
  updatedAt: 2026-11-02T09:00:05.681Z
events:
  - id: demo-book-expense
    itemId: demo-book
    title: Purchase Designing Data-Intensive Applications
    date: 2026-09-28
    time: 10:00
    notes:
      - Investment Ledger/演示数据/笔记/Data systems reading notes.md
    createdAt: 2026-11-02T09:00:05.681Z
    type: expense
    amount: 19900
  - id: demo-book-learning
    itemId: demo-book
    title: Read the replication and partitioning chapters
    date: 2026-10-21
    time: 19:00
    notes:
      - Investment Ledger/演示数据/笔记/Data systems reading notes.md
    createdAt: 2026-11-02T09:00:05.681Z
    type: learning
    content: Compared leader-follower and multi-leader replication, with examples of conflict resolution.
    minutes: 45
  - id: demo-book-refund
    itemId: demo-book
    title: Return the book
    date: 2026-10-30
    time: 11:00
    notes: []
    createdAt: 2026-11-02T09:00:05.681Z
    type: refund
    amount: 19900
    expenseId: demo-book-expense
---

# Designing Data-Intensive Applications

- Category: Book
- Status: On hold
- Reason for purchase: Understand data system trade-offs and choose storage for a personal project.
- Next review: Not set
- Project: [[Investment Ledger/演示数据/笔记/Personal knowledge tool.md]]
- Related notes: [[Investment Ledger/演示数据/笔记/Data systems reading notes.md]]

## Investment timeline

### 2026-09-28 10:00 · Expense · Purchase Designing Data-Intensive Applications

<!-- event:demo-book-expense -->
Amount: ¥199.00
Related notes: [[Investment Ledger/演示数据/笔记/Data systems reading notes.md]]

### 2026-10-21 19:00 · Learning / use · Read the replication and partitioning chapters

<!-- event:demo-book-learning -->
Compared leader-follower and multi-leader replication, with examples of conflict resolution.
Duration: 45 min
Related notes: [[Investment Ledger/演示数据/笔记/Data systems reading notes.md]]

### 2026-10-30 11:00 · Refund · Return the book

<!-- event:demo-book-refund -->
Amount: ¥199.00
Original expense ID: demo-book-expense

---

> The content above is generated from YAML frontmatter. Keep your own notes below; use the plugin or edit YAML to change structured records.

<!-- ledger:appendix -->
