"""Capture actual Obsidian screenshots in the isolated acceptance vault."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from test_paths import TEST_VAULT

root = Path(__file__).resolve().parents[1]
out = root / 'output' / 'screenshots'
out.mkdir(parents=True, exist_ok=True)
plugin = "app.plugins.plugins['learning-investment-ledger']"
with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp('http://127.0.0.1:9225')
    page = browser.contexts[0].pages[0]
    assert Path(page.evaluate('app.vault.adapter.getBasePath()')).resolve() == TEST_VAULT
    page.set_viewport_size({'width': 1440, 'height': 1150})
    page.evaluate(f'async () => {{ await {plugin}.openLedger(); }}')
    app = page.locator('.ill-app:visible')
    # Existing demo records are displayed without duplicating them.
    page.evaluate(f'{plugin}.openLedger().then(v => v.loadDemo())')
    expect(app.get_by_role('button', name='演示账本', exact=True)).to_be_visible()
    app.get_by_role('button', name='成果：第一个能用起来的整理脚本', exact=True).click()
    page.evaluate("document.querySelector('.ill-primary-pane').scrollTop = 290")
    page.mouse.move(3, 3)
    if page.locator('.notice').count():
        page.locator('.notice').last.wait_for(state='hidden', timeout=10000)
    for name, theme, cls in [('dark', 'obsidian', 'theme-dark'), ('light', 'moonstone', 'theme-light')]:
        page.evaluate('(theme) => { app.vault.setConfig("theme", theme); app.setTheme(); }', theme)
        page.wait_for_function('(cls) => document.body.classList.contains(cls)', arg=cls)
        page.screenshot(path=str(out / f'timeline-{name}.png'))
    page.evaluate("() => { app.vault.setConfig('theme', 'obsidian'); app.setTheme(); }")
    app.get_by_role('button', name='期间复盘', exact=True).click()
    page.mouse.move(3, 3)
    expect(app.locator('.ill-summary-log')).to_have_count(5)
    page.screenshot(path=str(out / 'summary-dark.png'))
    app.get_by_role('button', name='时间线', exact=True).click()
    page.set_viewport_size({'width': 720, 'height': 1000})
    expect(app.locator('.ill-details')).to_be_visible()
    page.screenshot(path=str(out / 'narrow-detail.png'))
    scroll = app.locator('.ill-primary-pane').evaluate('(node) => node.scrollTop')
    app.get_by_role('button', name='关闭投入详情', exact=True).click()
    expect(app.locator('.ill-details')).not_to_be_visible()
    assert app.locator('.ill-primary-pane').evaluate('(node) => node.scrollTop') == scroll
    page.screenshot(path=str(out / 'narrow-timeline.png'))
    # Check the smallest supported layout without horizontal overflow.
    page.set_viewport_size({'width': 430, 'height': 960})
    assert app.evaluate('(node) => node.scrollWidth <= node.clientWidth')
    page.screenshot(path=str(out / 'compact-timeline.png'))
    page.set_viewport_size({'width': 1440, 'height': 1150})
    print('Captured native dark/light, summary, narrow and compact layouts.')
    browser.close()
