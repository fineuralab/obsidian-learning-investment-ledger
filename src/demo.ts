import { addDays, baseEvent, createDocument, LedgerDocument, localDate, putEvent } from './domain';
import { getLocale, t } from './i18n';

/** Stable IDs make demo installation idempotent, even after a partial failed save. */
export function makeDemo(folder: string, today = localDate()): { docs: LedgerDocument[]; notes: Record<string, string> } {
  const note = (name: string): string => `${folder}/演示数据/笔记/${name}.md`;
  const spec = [
    ['python', 'Python 实战课程', '课程', 39900, '把重复的文件整理工作交给脚本，每周省出一点时间。', '文件整理自动化'],
    ['book', '设计数据密集型应用', '书籍', 19900, '理解数据系统的取舍，为自己的项目选一个合适的存储方案。', '个人知识工具'],
    ['tool', '创作工具月度订阅', '工具', 9900, '完成视频剪辑和封面，让本月的创作顺利交付。', '学习周记'],
    ['creative', '个人作品集计划', '创作项目', 29900, '把已完成的项目整理成可展示的作品集。', '个人作品集'],
  ] as const;
  const docs: LedgerDocument[] = [];
  for (const [key, name, type, amount, reason, project] of spec) {
    let doc = createDocument(name, type, true); doc.item.id = `demo-${key}`;
    doc.item.reason = reason; doc.item.project = note(project); doc.item.status = '进行中';
    doc.item.notes = [note({ python: 'Python 学习笔记', book: '数据系统阅读笔记', tool: '视频制作记录', creative: '作品集创作笔记' }[key])];
    const base = baseEvent(doc.item.id, key === 'tool' ? '工具月度订阅' : key === 'creative' ? '作品集素材与发布准备' : `购买${name}`, addDays(today, -35));
    base.id = `demo-${key}-expense`; base.time = '10:00';
    doc = putEvent(doc, { ...base, type: 'expense', amount, notes: doc.item.notes });
    docs.push(doc);
  }
  let python = docs[0]!;
  python = putEvent(python, { ...baseEvent(python.item.id, '完成文件与目录操作练习', addDays(today, -20)), id: 'demo-python-learning', time: '20:30', type: 'learning', content: '练习 pathlib 和文件遍历，把下载目录按文件类型分类。遇到了重名文件，增加了跳过与日志记录。', minutes: 75, notes: [note('Python 学习笔记')] });
  python = putEvent(python, { ...baseEvent(python.item.id, '第一个能用起来的整理脚本', addDays(today, -10)), id: 'demo-python-outcome', time: '21:00', type: 'outcome', target: note('文件整理脚本'), content: '已实际整理 240 个文件，并保留了操作日志。', notes: [] });
  python.item.nextReview = addDays(today, -1); docs[0] = python;
  let book = docs[1]!;
  book = putEvent(book, { ...baseEvent(book.item.id, '阅读复制与分区章节', addDays(today, -12)), id: 'demo-book-learning', time: '19:00', type: 'learning', content: '比较主从复制与多主复制，整理了冲突解决的例子。', minutes: 45, notes: [note('数据系统阅读笔记')] });
  book = putEvent(book, { ...baseEvent(book.item.id, '书籍退货', addDays(today, -3)), id: 'demo-book-refund', time: '11:00', type: 'refund', amount: 19900, expenseId: 'demo-book-expense', notes: [] });
  book.item.status = '已搁置'; book.item.nextReview = null; docs[1] = book;
  let tool = docs[2]!;
  tool = putEvent(tool, { ...baseEvent(tool.item.id, '完成学习周记的剪辑', addDays(today, -7)), id: 'demo-tool-learning', time: '16:00', type: 'learning', content: '剪出 5 分钟的学习周记，完成字幕和封面。', minutes: 90, notes: [note('视频制作记录')] });
  tool = putEvent(tool, { ...baseEvent(tool.item.id, '学习周记第一期', addDays(today, -5)), id: 'demo-tool-outcome', time: '18:00', type: 'outcome', target: note('学习周记第一期'), content: '本期记录了从学习到脚本落地的过程。', notes: [] });
  tool = putEvent(tool, { ...baseEvent(tool.item.id, '第一次工具回访', addDays(today, -2)), id: 'demo-tool-review', time: '20:00', type: 'review', expectation: tool.item.reason, usage: '本月完成了一次完整剪辑，字幕功能节省了整理时间。', outcomes: '完成并发布学习周记第一期。', rating: '部分达到', plan: '调整：下个月集中完成两期，再决定是否续订。', nextReview: addDays(today, 28), notes: [] }); docs[2] = tool;
  let creative = docs[3]!;
  creative = putEvent(creative, { ...baseEvent(creative.item.id, '整理作品集的两个项目案例', addDays(today, -9)), id: 'demo-creative-learning', time: '20:00', type: 'learning', content: '筛选项目截图，补写问题、实现过程和结果，整理成两个案例。', minutes: 60, notes: [note('作品集创作笔记')] });
  creative = putEvent(creative, { ...baseEvent(creative.item.id, '完成作品集首页草稿', addDays(today, -4)), id: 'demo-creative-outcome', time: '21:00', type: 'outcome', target: note('作品集首页草稿'), content: '两个项目案例和首页草稿已完成，可以在库内预览。', notes: [] });
  creative.item.nextReview = addDays(today, 7); docs[3] = creative;
  const notes: Record<string, string> = {
    '笔记/文件整理自动化.md': '# 文件整理自动化\n\n目标：把下载目录按文件类型整理，并保留操作日志。',
    '笔记/个人知识工具.md': '# 个人知识工具\n\n一个先服务自己的本地知识检索项目。',
    '笔记/学习周记.md': '# 学习周记\n\n用短视频记录本周真正完成的事情。',
    '笔记/Python 学习笔记.md': '# Python 学习笔记\n\n## 文件操作\n\n- 用 pathlib 处理路径。\n- 操作前检查文件是否存在。\n- 重命名时保留原始文件名的日志。',
    '笔记/数据系统阅读笔记.md': '# 数据系统阅读笔记\n\n主从复制：写入集中，读取可以分散；需要处理复制延迟。',
    '笔记/视频制作记录.md': '# 视频制作记录\n\n先整理叙事，再剪辑画面，最后处理字幕与封面。',
    '笔记/文件整理脚本.md': '# 文件整理脚本\n\n这是用户主动确认关联的演示成果。\n\n```python\nfrom pathlib import Path\n\nfor file in Path("Downloads").iterdir():\n    if file.is_file():\n        print(file.suffix, file.name)\n```',
    '笔记/学习周记第一期.md': '# 学习周记第一期\n\n主题：从课程练习到第一个实际使用的脚本。\n\n这是一篇演示成果笔记。',
    '笔记/个人作品集.md': '# 个人作品集\n\n目标：整理两个完整项目案例，完成可以展示的作品集。',
    '笔记/作品集创作笔记.md': '# 作品集创作笔记\n\n每个案例记录问题、实现过程、结果和下一步。',
    '笔记/作品集首页草稿.md': '# 作品集首页草稿\n\n已完成两个项目案例和首页的内容草稿，下一步调整排版。',
  };
  if (getLocale() === 'en') {
    const notePath = (path: string): string => path.replace(/\/([^/]+)\.md$/, (_match, title: string) => `/${t(title)}.md`);
    for (const doc of docs) {
      doc.item.name = t(doc.item.name); doc.item.reason = t(doc.item.reason);
      doc.item.project = notePath(doc.item.project); doc.item.notes = doc.item.notes.map(notePath);
      for (const event of doc.events) {
        event.title = t(event.title); event.notes = event.notes.map(notePath);
        if (event.type === 'learning' || event.type === 'outcome') event.content = t(event.content);
        if (event.type === 'outcome') event.target = notePath(event.target);
        if (event.type === 'review') {
          event.expectation = t(event.expectation); event.usage = t(event.usage);
          event.outcomes = t(event.outcomes); event.plan = t(event.plan);
        }
      }
    }
    return { docs, notes: Object.fromEntries(Object.entries(notes).map(([path, content]) => [notePath(path), t(content)])) };
  }
  return { docs, notes };
}
