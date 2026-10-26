"""Offline smoke test for Wirohaeyo (run: python tests/e2e_smoke.py).
Uses an ephemeral localhost server and Playwright Chromium. No user data is sent anywhere.
Requires: pip install playwright; python -m playwright install chromium
In managed environments where browser navigation is blocked, this optional test cannot run.
"""
from __future__ import annotations

import json
import tempfile
import os
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PASSWORD = 'test-only-secret-very-long'

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{server.server_port}/'

try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, **({'executable_path':os.environ['CHROMIUM_EXECUTABLE']} if os.environ.get('CHROMIUM_EXECUTABLE') else {}))
        context = browser.new_context(viewport={'width': 390, 'height': 844}, accept_downloads=True)
        page = context.new_page()
        errors = []
        requests = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('request', lambda request: requests.append(request.url))
        page.goto(url, wait_until='load')
        page.get_by_text('처음 시작하는 공간').wait_for()
        page.locator('#passphrase').fill(PASSWORD)
        page.locator('#passphrase-confirm').fill(PASSWORD)
        page.locator('#gate-submit').click()
        page.locator('#view-home:not(.hidden)').wait_for()
        page.locator('#hero-record').click()
        page.locator('[data-type="achievement"]').click()
        page.locator('#record-title').fill('오늘 해낸 작은 도전')
        page.locator('#record-body').fill('고장난 자전거를 혼자 수리하고 정비했다.')
        page.locator('#record-form [type=submit]').click()
        page.locator('#view-home:not(.hidden)').wait_for()
        page.locator('[data-view="insight"]').first.click()
        page.locator('#theme-list').get_by_text('자전거', exact=False).wait_for()
        # Explicit opt-in: default imported files do not influence local insights.
        page.locator('[data-view="memories"]').first.click()
        file_1={'name': 'SNS-export.json', 'mimeType': 'application/json', 'buffer': json.dumps({'messages':[{'message':'복숭아 농사를 위해 수확 기록을 정리했다.'}]}, ensure_ascii=False).encode()}
        page.locator('#import-file').set_input_files(file_1)
        page.get_by_text('SNS-export.json', exact=True).wait_for()
        page.locator('[data-view="insight"]').first.click()
        assert page.locator('#theme-list').get_by_text('복숭아', exact=False).count()==0, 'private import unexpectedly indexed'
        page.locator('[data-view="memories"]').first.click()
        page.locator('#memory-items .consent-toggle').first.click()
        page.locator('[data-view="insight"]').first.click()
        page.locator('#theme-list').get_by_text('복숭아', exact=False).wait_for()
        page.locator('[data-view="memories"]').first.click()
        page.locator('#import-file').set_input_files(file_1)
        page.get_by_text('중복 1개 제외.', exact=False).wait_for()
        assert page.locator('#memory-items').get_by_text('SNS-export.json', exact=True).count()==1, 'imported file duplicate'
        # Ensure backup contains ciphertext, not plaintext.
        page.locator('[data-view="settings"]').first.click()
        with page.expect_download(timeout=15000) as download_info:
            page.locator('#export-backup').click()
        download=download_info.value
        save = Path(tempfile.mkdtemp())/'test-backup.json'
        download.save_as(save)
        backup=save.read_text()
        assert '자전거를 혼자 수리' not in backup
        assert '복숭아 농사' not in backup
        assert json.loads(backup)['format']=='wirohaeyo-encrypted-backup'
        page.locator('#settings-lock').click()
        page.locator('#gate-mode').get_by_text('돌아오셨군요', exact=False).wait_for()
        page.locator('#passphrase').fill('wrong-password')
        page.locator('#gate-submit').click()
        page.get_by_text('암호가 맞지 않아요.', exact=False).wait_for()
        page.locator('#passphrase').fill(PASSWORD)
        page.locator('#gate-submit').click()
        page.locator('#view-home:not(.hidden)').wait_for()
        assert page.locator('#home-recent').get_by_text('SNS-export.json').count()>0
        # Restore the sealed backup onto a fresh device browser context.
        context2=browser.new_context(accept_downloads=True)
        page2=context2.new_page()
        page2.on('pageerror', lambda e: errors.append(str(e)))
        page2.goto(url)
        page2.locator('#gate-backup-input').set_input_files(str(save))
        page2.locator('#restore-dialog').wait_for(state='visible')
        page2.locator('#restore-pass').fill(PASSWORD)
        page2.locator('#restore-submit').click()
        page2.locator('#dialog').wait_for(state='visible')
        page2.locator('#dialog-ok').click()
        page2.locator('#gate-mode').get_by_text('돌아오셨군요', exact=False).wait_for()
        page2.locator('#passphrase').fill(PASSWORD)
        page2.locator('#gate-submit').click()
        page2.locator('#view-home:not(.hidden)').wait_for()
        assert page2.locator('#home-recent').get_by_text('SNS-export.json').count()>0
        assert all(req.startswith(url) for req in requests), f'Unexpected external request {requests}'
        assert errors==[], f'JS runtime errors: {errors}'
        print('PASS: create/unlock, record, local themes, import consent, dedupe, encrypted backup, wrong password, restore, no outbound requests')
        page.screenshot(path=str(ROOT/'tests'/'mobile-preview.png'), full_page=True)
        context2.close()
        browser.close()
finally:
    server.shutdown()
