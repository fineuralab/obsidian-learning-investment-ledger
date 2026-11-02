"""Attachment UI checks against a strictly isolated Obsidian vault on port 9226."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from test_paths import TEST_VAULT, ATTACHMENT_FIXTURES
import base64
import hashlib
import json
import struct
import time
import zlib

root = Path(__file__).resolve().parents[1]
out = root / 'output/playwright'
out.mkdir(parents=True, exist_ok=True)
fixtures = ATTACHMENT_FIXTURES
fixtures.mkdir(parents=True, exist_ok=True)

def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)

width, height = 600, 320
raw = b''.join(b'\0' + b''.join(bytes((68, 92, 146) if (x // 40 + y // 40) % 2 else (146, 169, 221)) for x in range(width)) for y in range(height))
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
image = fixtures / '练习截图.png'; image.write_bytes(png)
text = fixtures / '练习脚本.txt'; text.write_text('print("附件验收")\n')
checks = []
plugin = "app.plugins.plugins['learning-investment-ledger']"
tag = str(int(time.time()))
title = f'附件支出-{tag}'

def passed(message):
    checks.append(message); print('PASS:', message, flush=True)

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp('http://127.0.0.1:9226')
    page = browser.contexts[0].pages[0]
    page.set_default_timeout(12000)
    page.wait_for_function(f'{plugin}?.store?.ready')
    assert Path(page.evaluate('app.vault.adapter.getBasePath()')).resolve() == TEST_VAULT
    errors = []; page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_viewport_size({'width': 1440, 'height': 1100})
    page.keyboard.press('Escape')
    page.evaluate(f'async () => {{ await {plugin}.openLedger(); }}')
    app = lambda: page.locator('.ill-app:visible')
    modal = lambda: page.locator('.ill-modal:visible').last
    if app().get_by_role('button', name='我的账本', exact=True).count(): app().get_by_role('button', name='我的账本', exact=True).click()
    original_ids = page.evaluate(f'{plugin}.store.documents.filter(d => !d.demo).map(d => d.item.id)')
    page.evaluate('''async (png) => {
      app.vault.setConfig('alwaysUpdateLinks', true);
      if (!app.vault.getAbstractFileByPath('验收附件')) await app.vault.createFolder('验收附件');
      const data = Uint8Array.from(atob(png), c => c.charCodeAt(0)).buffer;
      for (const [path, bytes] of [['验收附件/库内图片.png', data], ['验收附件/资料附件.pdf', new TextEncoder().encode('%PDF-1.1\\n% fixture\\n%%EOF').buffer]]) {
        const file = app.vault.getAbstractFileByPath(path);
        if (file) await app.vault.modifyBinary(file, bytes); else await app.vault.createBinary(path, bytes);
      }
      if (!app.vault.getAbstractFileByPath('验收附件/附件成果.md')) await app.vault.create('验收附件/附件成果.md', '# 附件成果\\n\\n独立验收笔记。');
    }''', base64.b64encode(png).decode())
    passed('0.1 records load unchanged after upgrading to 0.2')

    def upload_files(*files):
        modal().get_by_label('从电脑选择附件', exact=True).set_input_files([str(file) for file in files])

    def link_file(name):
        modal().get_by_role('button', name='关联库内文件', exact=True).click()
        page.locator('.prompt-input:visible').last.fill(name)
        page.locator('.suggestion-item:visible').filter(has_text=name).first.click()

    def save():
        modal().get_by_role('button', name='保存记录', exact=True).click()
        expect(page.locator('.ill-modal:visible')).to_have_count(0)

    def imported_count():
        return page.evaluate("app.vault.getFiles().filter(f => f.path.startsWith('投入账本/附件/')).length")

    before_imports = imported_count()
    app().get_by_role('button', name='记一笔', exact=True).click()
    modal().get_by_label('新投入项名称 *', exact=True).fill('附件验收-' + tag)
    modal().get_by_label('用途 *', exact=True).fill(title)
    modal().get_by_label('金额（元）*', exact=True).fill('10')
    modal().get_by_label('时间 *', exact=True).fill('10:00')
    link_file('资料附件.pdf')
    upload_files(image, text)
    expect(modal().locator('.ill-attachment-missing')).to_have_count(0)
    expect(modal().locator('.ill-attachments img')).to_have_count(1)
    assert imported_count() == before_imports, 'selection must not create files before saving'
    modal().get_by_role('button', name='添加网址', exact=True).click()
    modal().get_by_label('附件网址', exact=True).fill('javascript:alert(1)')
    modal().get_by_role('button', name='添加链接', exact=True).click()
    expect(modal().get_by_role('alert')).to_contain_text('http')
    modal().get_by_label('附件网址', exact=True).fill('https://example.com/material.pdf')
    modal().get_by_label('附件链接名称', exact=True).fill('课程资料网址')
    modal().get_by_role('button', name='添加链接', exact=True).click()
    save()
    card = lambda: app().get_by_role('button', name='支出：' + title, exact=True)
    expect(card().locator('.ill-attachment')).to_have_count(4)
    assert imported_count() == before_imports + 2
    doc = page.evaluate(f'{plugin}.store.documents.find(d => d.item.name === "附件验收-{tag}")')
    item_id = doc['item']['id']; expense_id = doc['events'][0]['id']
    attached = doc['events'][0]['attachments']
    path = next(a['target'] for a in attached if a.get('label') == image.name)
    stored = bytes(page.evaluate('(path) => app.vault.readBinary(app.vault.getAbstractFileByPath(path)).then(b => Array.from(new Uint8Array(b)))', path))
    assert hashlib.sha256(stored).digest() == hashlib.sha256(png).digest()
    passed('Expense supports library PDF, imported image/file and safe website links; imported bytes remain exact')

    card().get_by_role('button', name='预览图片：练习截图.png', exact=True).click()
    expect(page.locator('.ill-image-modal:visible')).to_be_visible()
    page.wait_for_function("document.querySelector('.ill-image-modal img').naturalWidth === 600")
    page.screenshot(path=str(out / 'attachment-image-preview.png'))
    page.keyboard.press('Escape')
    page.evaluate("() => { window.__openedAttachmentUrls=[]; window.__open=window.open; window.open=(url) => {window.__openedAttachmentUrls.push(url); return null;}; }")
    card().get_by_role('button', name='打开附件：课程资料网址', exact=True).click()
    assert page.evaluate('window.__openedAttachmentUrls') == ['https://example.com/material.pdf']
    page.evaluate('() => { window.open=window.__open; }')
    passed('Image opens a loaded full-size preview; website links open only on explicit click')

    # Failed binary writes retain the selected browser File, blob preview and other fields.
    app().get_by_role('button', name='编辑' + title, exact=True).click()
    upload_files(image)
    page.evaluate("() => {window.__binary=app.vault.createBinary; app.vault.createBinary=async()=>{throw Error('模拟附件写入失败');};}")
    modal().get_by_role('button', name='保存记录', exact=True).click()
    expect(modal().get_by_role('alert')).to_contain_text('模拟附件写入失败')
    expect(modal().get_by_label('用途 *', exact=True)).to_have_value(title)
    expect(modal().locator('.ill-attachments img')).to_have_count(2)
    page.evaluate('() => {app.vault.createBinary=window.__binary;}')
    save(); assert imported_count() == before_imports + 3
    passed('Failed attachment copy retains selected image and form; retry succeeds')

    # If record writing fails after a successful file copy, retry must reuse that copy.
    app().get_by_role('button', name='编辑' + title, exact=True).click(); upload_files(text)
    page.evaluate(f'() => {{window.__write={plugin}.store.port.write; {plugin}.store.port.write=async()=>{{throw Error("模拟记录保存失败");}};}}')
    modal().get_by_role('button', name='保存记录', exact=True).click()
    expect(modal().get_by_role('alert')).to_contain_text('模拟记录保存失败')
    assert imported_count() == before_imports + 4
    page.evaluate(f'() => {{{plugin}.store.port.write=window.__write;}}')
    save(); assert imported_count() == before_imports + 4
    passed('Record-write retry reuses already copied attachments without duplicate files')

    # Removing a reference never deletes the library target.
    app().get_by_role('button', name='编辑' + title, exact=True).click()
    modal().get_by_role('button', name='移除附件 资料附件.pdf', exact=True).click(); save()
    assert page.evaluate("!!app.vault.getAbstractFileByPath('验收附件/资料附件.pdf')")
    passed('Removing an attachment preserves the original library file')

    card().locator('h3').click()
    app().get_by_role('button', name='为' + title + '退款', exact=True).click()
    modal().get_by_label('用途 *', exact=True).fill('附件退款-' + tag)
    modal().get_by_label('金额（元）*', exact=True).fill('5')
    modal().get_by_label('时间 *', exact=True).fill('11:00')
    link_file('库内图片.png'); save()
    card().locator('h3').click(); app().get_by_role('button', name='记录学习', exact=True).click()
    modal().get_by_label('标题 *', exact=True).fill('附件学习-' + tag)
    modal().get_by_label('本次做了什么？*', exact=True).fill('练习并附上截图。')
    link_file('库内图片.png'); save()
    app().get_by_role('button', name='关联成果', exact=True).click()
    modal().get_by_label('成果名称 *', exact=True).fill('附件成果-' + tag)
    modal().get_by_role('button', name='选择文件', exact=True).click()
    page.locator('.prompt-input:visible').last.fill('附件成果.md')
    page.locator('.suggestion-item:visible').filter(has_text='附件成果.md').first.click()
    link_file('资料附件.pdf'); save()
    app().get_by_role('button', name='做一次回访', exact=True).click()
    modal().get_by_label('目前实际使用到了什么程度？*', exact=True).fill('已经使用，并附上回访截图。')
    modal().get_by_label('下一步计划 *', exact=True).fill('继续')
    link_file('库内图片.png'); save()
    saved = page.evaluate(f'{plugin}.store.get("{item_id}")')
    assert {e['type'] for e in saved['events'] if e.get('attachments')} == {'expense', 'refund', 'learning', 'outcome', 'review'}
    app().get_by_role('button', name='编辑投入项', exact=True).click(); link_file('资料附件.pdf')
    modal().get_by_role('button', name='保存修改', exact=True).click(); expect(page.locator('.ill-modal:visible')).to_have_count(0)
    assert page.evaluate(f'{plugin}.store.get("{item_id}").item.attachments.length') == 1
    passed('All five event types and the investment itself save attachments through their real forms')

    # Unsaved selections should not import anything.
    count = imported_count(); app().get_by_role('button', name='编辑' + title, exact=True).click(); upload_files(image)
    page.evaluate('''(png) => {
      const bytes = Uint8Array.from(atob(png), c=>c.charCodeAt(0));
      const target = document.querySelector('.ill-modal .ill-attachment-drop');
      const drag = new DataTransfer(); drag.items.add(new File([bytes], '拖入截图.png', {type:'image/png'}));
      target.dispatchEvent(new DragEvent('drop', {dataTransfer:drag, bubbles:true, cancelable:true}));
      const paste = new DataTransfer(); paste.items.add(new File([bytes], '粘贴截图.png', {type:'image/png'}));
      target.focus(); target.dispatchEvent(new ClipboardEvent('paste', {clipboardData:paste, bubbles:true, cancelable:true}));
    }''', base64.b64encode(png).decode())
    expect(modal().locator('.ill-attachments img')).to_have_count(5)
    modal().get_by_role('button', name='取消', exact=True).click(); assert imported_count() == count
    passed('Drag and paste stage image previews; cancel before saving imports no files')

    page.evaluate("async()=>{const f=app.vault.getAbstractFileByPath('验收附件/库内图片.png'); await app.fileManager.renameFile(f,'验收附件/图片已改名.png');}")
    page.wait_for_function(f'{plugin}.store.get("{item_id}").events.some(e=>e.type==="learning"&&e.attachments[0].target==="验收附件/图片已改名.png")')
    page.evaluate("app.vault.trash(app.vault.getAbstractFileByPath('验收附件/图片已改名.png'),false)")
    expect(app().locator('.ill-attachment-missing').first).to_be_visible()
    passed('Native image rename updates record paths; deleted image shows an actionable broken attachment')

    before = page.evaluate(f'{plugin}.store.get("{item_id}")')
    page.reload(); page.wait_for_function(f'{plugin}?.store?.ready')
    assert page.evaluate(f'{plugin}.store.get("{item_id}")') == before
    assert set(original_ids).issubset(page.evaluate(f'{plugin}.store.documents.map(d=>d.item.id)'))
    assert imported_count() == count
    page.evaluate(f'async()=>{{await {plugin}.openLedger();}}')
    app().get_by_role('button', name='支出：' + title, exact=True).locator('h3').click()
    page.mouse.move(3, 3)
    shots = out / 'screenshots'; shots.mkdir(exist_ok=True)
    page.screenshot(path=str(shots / 'record-attachments.png'))
    page.set_viewport_size({'width':720,'height':1000})
    if app().get_by_role('button', name='关闭投入详情', exact=True).is_visible(): app().get_by_role('button', name='关闭投入详情', exact=True).click()
    assert app().evaluate('(node)=>node.scrollWidth<=node.clientWidth')
    page.set_viewport_size({'width':1440,'height':1100})
    passed('Restart rebuilds all attachments and preserves pre-upgrade records')
    assert not errors, errors
    (out / 'attachment-report.json').write_text(json.dumps({'checks': checks, 'uncaughtErrors': errors}, ensure_ascii=False, indent=2))
    browser.close()
