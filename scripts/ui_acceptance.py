"""Real Obsidian acceptance checks. Requires the isolated vault from setup-test-vault.mjs.
Usage: python scripts/ui_acceptance.py [--restart-check]
Never connects to a user's regular vault.
"""
from pathlib import Path
from datetime import date
import csv
import io
import json
import sys
from playwright.sync_api import sync_playwright, expect
from test_paths import TEST_VAULT

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output' / 'playwright'
OUT.mkdir(parents=True, exist_ok=True)
TODAY = date.today().isoformat()
PLUGIN = "app.plugins.plugins['learning-investment-ledger']"
checks = []

def passed(name):
    checks.append(name)
    print('PASS:', name, flush=True)

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp('http://127.0.0.1:9225')
    page = browser.contexts[0].pages[0]
    page.set_default_timeout(10000)
    assert Path(page.evaluate('app.vault.adapter.getBasePath()')).resolve() == TEST_VAULT, 'Refusing to modify a non-test vault'
    page.set_viewport_size({'width': 1440, 'height': 1050})
    errors = []
    page.on('pageerror', lambda err: errors.append(str(err)))
    page.keyboard.press('Escape')

    def open_ledger():
        page.wait_for_function(f'{PLUGIN}?.store?.ready === true')
        page.evaluate(f'async () => {{ await {PLUGIN}.openLedger(); }}')
        expect(page.locator('.ill-app:visible')).to_be_visible()

    def app():
        return page.locator('.ill-app:visible')

    def modal():
        return page.locator('.ill-modal:visible').last

    def save():
        modal().get_by_role('button', name='保存记录', exact=True).click()
        expect(page.locator('.ill-modal:visible')).to_have_count(0)

    def stat(index, value):
        expect(app().locator('.ill-stat-value').nth(index)).to_have_text(value)

    def choose_file(button_name='关联笔记'):
        modal().get_by_role('button', name=button_name, exact=True).click()
        search = page.locator('.prompt-input:visible').last
        search.fill('验收笔记')
        page.locator('.suggestion-item:visible').filter(has_text='验收笔记.md').first.click()

    def select_course():
        app().get_by_role('button', name='支出：购买课程', exact=True).click()

    if '--reset' in sys.argv:
        page.reload(); page.wait_for_load_state('domcontentloaded')
        page.wait_for_function(f'{PLUGIN}?.store?.ready === true')
        page.evaluate(f'''async () => {{
          for (const file of app.vault.getFiles()) await app.vault.trash(file, false);
          await app.vault.create('验收笔记.md', '# 验收笔记\\n\\n独立验收库的笔记。');
          await {PLUGIN}.store.load();
        }}''')
        page.reload(); page.wait_for_load_state('domcontentloaded')
        page.keyboard.press('Escape')
    open_ledger()
    page.evaluate("() => { app.vault.setConfig('theme', 'obsidian'); app.setTheme(); }")
    page.wait_for_function("document.body.classList.contains('theme-dark')")
    if '--restart-check' in sys.argv:
        # Demo is intentionally a view-local mode. On restart the real ledger is selected.
        stat(0, '¥428.00')
        page.evaluate(f'{PLUGIN}.openLedger().then(v => v.loadDemo())')
        expect(app().get_by_role('button', name='演示账本', exact=True)).to_be_visible()
        stat(0, '¥428.00')
        assert page.evaluate(f'{PLUGIN}.store.documents.filter(d => !d.demo).length') == 3
        assert page.evaluate(f'{PLUGIN}.store.documents.filter(d => !d.demo).reduce((n,d) => n+d.events.filter(e=>e.type==="review").length,0)') == 1
        app().get_by_role('button', name='期间复盘', exact=True).click()
        expect(app().locator('.ill-summary-log')).to_have_count(5)
        page.screenshot(path=str(OUT / 'summary-dark.png'))
        app().get_by_role('button', name='时间线', exact=True).click()
        passed('Full application restart restored real records, links, review history and independent demo data')
    else:
        expect(app().get_by_text('从一份值得的投入开始', exact=True)).to_be_visible()
        passed('First-use empty state and actual Obsidian plugin load')
        page.screenshot(path=str(OUT / 'empty-dark.png'))

        for name, kind, amount in [('课程', '课程', '299'), ('书籍', '书籍', '99'), ('工具', '工具', '129')]:
            app().get_by_role('button', name='记一笔', exact=True).click()
            modal().get_by_label('新投入项名称 *', exact=True).fill('验收' + name)
            modal().get_by_label('类型', exact=True).select_option(label=kind)
            modal().get_by_label('用途 *', exact=True).fill('购买' + name)
            modal().get_by_label('金额（元）*', exact=True).fill(amount)
            modal().get_by_label('发生日期 *', exact=True).fill(TODAY)
            modal().get_by_label('时间 *', exact=True).fill('10:00')
            modal().locator('input[type=date]').last.fill(TODAY if name == '课程' else '')
            save()
        stat(0, '¥527.00'); stat(3, '1')
        passed('Three real UI purchases total ¥527.00 and a due review is shown')

        app().get_by_role('button', name='为购买书籍退款', exact=True).click()
        modal().get_by_label('用途 *', exact=True).fill('书籍退款')
        modal().get_by_label('金额（元）*', exact=True).fill('99')
        modal().get_by_label('发生日期 *', exact=True).fill(TODAY)
        modal().get_by_label('时间 *', exact=True).fill('11:00')
        save(); stat(0, '¥428.00')
        passed('Linked ¥99 refund immediately changes total to ¥428.00')

        app().get_by_role('button', name='为购买书籍退款', exact=True).click()
        modal().get_by_label('用途 *', exact=True).fill('超额退款')
        modal().get_by_label('金额（元）*', exact=True).fill('0.01')
        modal().get_by_label('发生日期 *', exact=True).fill(TODAY)
        modal().get_by_label('时间 *', exact=True).fill('12:00')
        modal().get_by_role('button', name='保存记录', exact=True).click()
        expect(modal().get_by_role('alert')).to_contain_text('累计退款不能超过')
        expect(modal().get_by_label('金额（元）*', exact=True)).to_have_value('0.01')
        modal().get_by_role('button', name='取消', exact=True).click()
        passed('Over-refund rejected without losing form inputs')

        select_course()
        app().get_by_role('button', name='编辑投入项', exact=True).click()
        modal().get_by_label('购买原因', exact=True).fill('学会使用 pathlib 整理文件')
        choose_file('选择文件')
        modal().get_by_role('button', name='保存修改', exact=True).click()
        expect(page.locator('.ill-modal:visible')).to_have_count(0)
        stat(1, '1')

        app().get_by_role('button', name='记录学习', exact=True).click()
        modal().get_by_label('标题 *', exact=True).fill('第一次 pathlib 练习')
        modal().get_by_label('本次做了什么？*', exact=True).fill('实际遍历文件并输出分类日志。')
        modal().get_by_label('时长（分钟，可选）', exact=True).fill('45')
        choose_file(); save()
        expect(app().get_by_role('button', name='学习 / 使用：第一次 pathlib 练习', exact=True)).to_be_visible()

        app().get_by_role('button', name='关联成果', exact=True).click()
        modal().get_by_label('成果名称 *', exact=True).fill('文件整理结果')
        choose_file('选择文件'); save(); stat(2, '1')
        passed('Project linking, learning with minutes and explicit outcome association')

        app().get_by_role('button', name='做一次回访', exact=True).click()
        expect(modal().get_by_label('当初希望解决什么问题？', exact=True)).to_have_value('学会使用 pathlib 整理文件')
        modal().get_by_label('目前实际使用到了什么程度？*', exact=True).fill('完成整理脚本并实际使用一次。')
        modal().get_by_label('留下了哪些成果？', exact=True).fill('文件整理结果')
        modal().get_by_label('是否达到预期', exact=True).select_option(label='达到')
        modal().get_by_label('下一步计划 *', exact=True).fill('继续，每周整理一次。')
        save(); stat(3, '0')
        passed('Review submission clears pending count and retains editable history')

        titles = app().locator('.ill-event h3').all_text_contents()
        app().get_by_role('button', name='从旧到新', exact=True).click()
        assert app().locator('.ill-event h3').all_text_contents() == list(reversed(titles))
        app().get_by_label('事件类型', exact=True).select_option('learning')
        expect(app().locator('.ill-event')).to_have_count(1)
        app().get_by_label('搜索账本', exact=True).fill('不匹配的词')
        expect(app().locator('.ill-event')).to_have_count(0)
        app().get_by_label('搜索账本', exact=True).fill('pathlib')
        expect(app().locator('.ill-event')).to_have_count(1)
        app().get_by_label('搜索账本', exact=True).fill('')
        app().get_by_label('事件类型', exact=True).select_option('')
        app().get_by_role('button', name='从新到旧', exact=True).click()
        passed('Actual timeline order, event filter and keyword search')

        # Open an existing note through Obsidian, then return via the plugin command.
        app().get_by_role('button', name='成果：文件整理结果', exact=True).get_by_role('button', name='验收笔记', exact=True).click()
        assert page.evaluate('app.workspace.getActiveFile().path') == '验收笔记.md'
        open_ledger(); passed('Associated outcome opens the correct native Obsidian note')

        app().get_by_role('button', name='编辑购买工具', exact=True).click()
        modal().get_by_label('金额（元）*', exact=True).fill('130'); save(); stat(0, '¥429.00')
        app().get_by_role('button', name='编辑购买工具', exact=True).click()
        modal().get_by_label('金额（元）*', exact=True).fill('129'); save(); stat(0, '¥428.00')
        app().get_by_role('button', name='删除第一次 pathlib 练习', exact=True).click()
        modal().get_by_role('button', name='确认删除', exact=True).click()
        expect(app().get_by_role('button', name='学习 / 使用：第一次 pathlib 练习', exact=True)).to_have_count(0)
        passed('Editing financial events recalculates totals; confirmed event deletion updates timeline')

        page.evaluate("""async () => {
          app.vault.setConfig('alwaysUpdateLinks', true);
          if (!app.vault.getAbstractFileByPath('已移动')) await app.vault.createFolder('已移动');
          await app.fileManager.renameFile(app.vault.getAbstractFileByPath('验收笔记.md'), '已移动/验收笔记.md');
        }""")
        page.wait_for_function(f'{PLUGIN}.store.documents.some(d => d.item.project === "已移动/验收笔记.md")')
        assert page.evaluate(f'{PLUGIN}.store.documents.some(d => d.events.some(e => e.type === "outcome" && e.target === "已移动/验收笔记.md"))')
        page.evaluate("app.vault.trash(app.vault.getAbstractFileByPath('已移动/验收笔记.md'), false)")
        expect(app().get_by_text('验收笔记 · 链接失效', exact=True).first).to_be_visible()
        page.evaluate("async () => { await app.vault.create('已移动/验收笔记.md', '# 验收笔记\\n\\n重新关联的成果。'); }")
        page.evaluate(f'{PLUGIN}.store.load()')
        passed('Native file rename updates project and outcome links; deleted target retains a visible broken link')

        # Force a storage exception in the isolated test plugin, then restore the port.
        page.evaluate(f'() => {{ window.__ledgerWrite = {PLUGIN}.store.port.write; {PLUGIN}.store.port.write = async () => {{ throw Error("模拟磁盘写入失败"); }}; }}')
        app().get_by_label('快速记录金额', exact=True).fill('12.34')
        app().get_by_label('快速记录用途', exact=True).fill('不能丢失的输入')
        app().get_by_role('button', name='保存', exact=True).click()
        expect(app().get_by_role('alert')).to_contain_text('模拟磁盘写入失败')
        expect(app().get_by_label('快速记录金额', exact=True)).to_have_value('12.34')
        expect(app().get_by_label('快速记录用途', exact=True)).to_have_value('不能丢失的输入')
        page.evaluate(f'() => {{ {PLUGIN}.store.port.write = window.__ledgerWrite; }}')
        passed('Simulated disk failure clearly identifies source file and preserves quick-entry values')

        page.evaluate(f'''async () => {{
          const doc = {PLUGIN}.store.documents.find(d => d.item.name === '验收课程');
          const path = {PLUGIN}.store.pathFor(doc.item.id);
          window.__ledgerSourcePath = path;
          window.__ledgerSource = await app.vault.read(app.vault.getAbstractFileByPath(path));
          await app.vault.modify(app.vault.getAbstractFileByPath(path), '---\\nledger: learning-investment-ledger\\nitem: [\\n---\\n');
        }}''')
        expect(app().locator('.ill-issues')).to_contain_text('YAML')
        page.screenshot(path=str(OUT / 'corrupt-source-feedback.png'))
        page.evaluate('app.vault.modify(app.vault.getAbstractFileByPath(window.__ledgerSourcePath), window.__ledgerSource)')
        page.evaluate(f'{PLUGIN}.store.load()')
        expect(app().locator('.ill-issues')).to_have_count(0)
        passed('Corrupt source file is explicitly reported and repair rebuilds the index')

        app().get_by_role('button', name='导出 CSV', exact=True).click()
        page.wait_for_function("app.vault.getFiles().some(f => f.extension === 'csv')")
        csv_text = page.evaluate("async () => { const file = app.vault.getFiles().find(f=>f.extension==='csv'); return app.vault.read(file); }")
        rows = list(csv.DictReader(io.StringIO(csv_text.lstrip('\ufeff'))))
        assert len(rows) == 4
        assert [row['金额（元）'] for row in rows] == ['299.00', '99.00', '129.00', '99.00']
        assert all(row['日期'] == TODAY for row in rows)
        assert sum(round(float(row['净支出影响（元）']) * 100) for row in rows) == 42800
        app().get_by_role('button', name='生成复盘', exact=True).click()
        modal().get_by_label('我的评价', exact=True).fill('课程已经开始产生实际成果。')
        modal().get_by_role('button', name='生成复盘笔记', exact=True).click()
        expect(page.locator('.ill-modal:visible')).to_have_count(0)
        note = page.evaluate('app.workspace.getActiveFile().path')
        content = page.evaluate('(path) => app.vault.read(app.vault.getAbstractFileByPath(path))', note)
        assert '¥428.00' in content and '课程已经开始产生实际成果。' in content
        open_ledger(); passed('Native CSV export matches all source rows and Markdown reflection contains user evaluation')

        page.reload(); page.wait_for_load_state('domcontentloaded'); open_ledger(); stat(0, '¥428.00'); stat(3, '0')
        passed('Renderer restart restores source data and completed review state')

        # Demo is opt-in and remains independent from the three real investments.
        page.evaluate(f'{PLUGIN}.openLedger().then(v => v.loadDemo())')
        expect(app().get_by_role('button', name='演示账本', exact=True)).to_be_visible()
        stat(0, '¥428.00'); stat(1, '3'); stat(2, '2'); stat(3, '1')
        assert page.evaluate(f'{PLUGIN}.store.documents.filter(d => !d.demo).length') == 3
        app().get_by_role('button', name='支出：购买Python 实战课程', exact=True).click()
        page.screenshot(path=str(OUT / 'timeline-dark.png'))
        app().get_by_role('button', name='期间复盘', exact=True).click()
        page.screenshot(path=str(OUT / 'summary-dark.png'))
        app().get_by_role('button', name='时间线', exact=True).click()
        page.evaluate("() => { app.vault.setConfig('theme', 'moonstone'); app.setTheme(); }")
        page.wait_for_function("document.body.classList.contains('theme-light')")
        page.screenshot(path=str(OUT / 'timeline-light.png'))
        page.evaluate("() => { app.vault.setConfig('theme', 'obsidian'); app.setTheme(); }")
        page.wait_for_function("document.body.classList.contains('theme-dark')")
        page.set_viewport_size({'width': 720, 'height': 1000})
        if app().get_by_role('button', name='关闭投入详情', exact=True).is_visible():
            app().get_by_role('button', name='关闭投入详情', exact=True).click()
        app().get_by_role('button', name='支出：购买Python 实战课程', exact=True).click()
        expect(app().locator('.ill-details')).to_be_visible()
        page.screenshot(path=str(OUT / 'narrow-detail.png'))
        app().get_by_role('button', name='关闭投入详情', exact=True).click()
        expect(app().locator('.ill-details')).not_to_be_visible()
        assert page.evaluate('document.querySelector(".ill-app").scrollWidth <= document.querySelector(".ill-app").clientWidth')
        passed('Independent opt-in demo, native dark/light themes and narrow dismissible detail panel')
        page.set_viewport_size({'width': 1440, 'height': 1050})
        app().get_by_role('button', name='支出：购买Python 实战课程', exact=True).click()

    assert not errors, errors
    (OUT / ('restart-report.json' if '--restart-check' in sys.argv else 'ui-report.json')).write_text(json.dumps({'checks': checks, 'uncaughtErrors': errors}, ensure_ascii=False, indent=2))
    browser.close()
