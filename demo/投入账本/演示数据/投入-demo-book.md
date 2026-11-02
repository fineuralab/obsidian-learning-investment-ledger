---
ledger: learning-investment-ledger
schema: 1
demo: true
item:
  id: demo-book
  name: 设计数据密集型应用
  type: 书籍
  reason: 理解数据系统的取舍，为自己的项目选一个合适的存储方案。
  project: 投入账本/演示数据/笔记/个人知识工具.md
  notes:
    - 投入账本/演示数据/笔记/数据系统阅读笔记.md
  status: 已搁置
  nextReview: null
  createdAt: 2026-11-02T09:00:05.663Z
  updatedAt: 2026-11-02T09:00:05.663Z
events:
  - id: demo-book-expense
    itemId: demo-book
    title: 购买设计数据密集型应用
    date: 2026-09-28
    time: 10:00
    notes:
      - 投入账本/演示数据/笔记/数据系统阅读笔记.md
    createdAt: 2026-11-02T09:00:05.663Z
    type: expense
    amount: 19900
  - id: demo-book-learning
    itemId: demo-book
    title: 阅读复制与分区章节
    date: 2026-10-21
    time: 19:00
    notes:
      - 投入账本/演示数据/笔记/数据系统阅读笔记.md
    createdAt: 2026-11-02T09:00:05.663Z
    type: learning
    content: 比较主从复制与多主复制，整理了冲突解决的例子。
    minutes: 45
  - id: demo-book-refund
    itemId: demo-book
    title: 书籍退货
    date: 2026-10-30
    time: 11:00
    notes: []
    createdAt: 2026-11-02T09:00:05.663Z
    type: refund
    amount: 19900
    expenseId: demo-book-expense
---

# 设计数据密集型应用

- 类型：书籍
- 状态：已搁置
- 购买原因：理解数据系统的取舍，为自己的项目选一个合适的存储方案。
- 下次回访：未设置
- 所属项目：[[投入账本/演示数据/笔记/个人知识工具.md]]
- 相关笔记：[[投入账本/演示数据/笔记/数据系统阅读笔记.md]]

## 投入时间线

### 2026-09-28 10:00 · 支出 · 购买设计数据密集型应用

<!-- event:demo-book-expense -->
金额：¥199.00
相关笔记：[[投入账本/演示数据/笔记/数据系统阅读笔记.md]]

### 2026-10-21 19:00 · 学习 / 使用 · 阅读复制与分区章节

<!-- event:demo-book-learning -->
比较主从复制与多主复制，整理了冲突解决的例子。
时长：45 分钟
相关笔记：[[投入账本/演示数据/笔记/数据系统阅读笔记.md]]

### 2026-10-30 11:00 · 退款 · 书籍退货

<!-- event:demo-book-refund -->
金额：¥199.00
原支出 ID：demo-book-expense

---

> 上方内容由插件根据 YAML 属性生成。可在下方保留自己的笔记；修改结构化记录请使用插件或编辑 YAML。

<!-- ledger:appendix -->
