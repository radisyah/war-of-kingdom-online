"""Tes UI timer: pemain tidak memilih → server memilihkan kartu acak setelah batas waktu."""
import subprocess, time, json, os, sys
from playwright.sync_api import sync_playwright
PORT = 3921; ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen(['node', 'dev-server.js'], cwd=ROOT, env=dict(os.environ, PORT=str(PORT)), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1.2)
FAST = json.dumps(json.dumps({'anim': False, 'countdown': 1, 'sound': False, 'music': False, 'volume': 0}))
ok = True
try:
    with sync_playwright() as p:
        br = p.chromium.launch(); errs = []
        pgs = []
        for _ in range(2):
            c = br.new_context(); c.add_init_script("localStorage.setItem('pnwok_settings_v2', %s)" % FAST)
            pg = c.new_page(); pg.on('pageerror', lambda e: errs.append(str(e))); pgs.append(pg)
        A, B = pgs
        A.goto('http://localhost:%d' % PORT); A.fill('#n1', 'Ayu'); A.locator('.mode input[type=number]').nth(2).fill('15'); A.click('text=Buat Ruangan >> nth=-1')
        A.wait_for_selector('.lobby-code'); code = A.inner_text('.lobby-code').strip()
        B.goto('http://localhost:%d/?room=%s' % (PORT, code)); B.fill('#n1', 'Budi'); B.click('text=Gabung >> nth=-1')
        for pg in pgs: pg.wait_for_selector('#timerNum', timeout=8000)
        t0 = A.inner_text('#timerNum'); print('timer tampil:', t0)
        A.locator('.cardgrid .card.pickable').nth(3).click(); A.click('text=Kunci Pilihan')   # A memilih, B diam
        A.wait_for_selector('text=Pilihanmu terkunci')
        t = time.time()
        for pg in pgs: pg.wait_for_selector('.verdict', timeout=40000)
        print('hasil muncul setelah %.0f dtk tanpa B memilih' % (time.time() - t))
        ok = 15 <= (time.time() - t) + 1 <= 30
        toast = B.inner_text('#toast') if B.locator('#toast:visible').count() else ''
        print('toast B:', toast)
        ok = ok and 'dipilihkan otomatis' in toast and not errs
        print('error JS:', errs)
        br.close()
finally:
    srv.terminate()
print('LOLOS' if ok else 'GAGAL'); sys.exit(0 if ok else 1)
