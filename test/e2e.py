"""Tes end-to-end: dua browser Chromium memainkan 30 ronde penuh lewat server lokal.
Jalankan: python3 test/e2e.py   (butuh playwright + chromium)"""
import subprocess, time, random, json, sys, os, re
from playwright.sync_api import sync_playwright

PORT = 3917
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'test', 'shots'); os.makedirs(SHOTS, exist_ok=True)
srv = subprocess.Popen(['node', 'dev-server.js'], cwd=ROOT, env=dict(os.environ, PORT=str(PORT)), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.2)
BASE = 'http://localhost:%d' % PORT
errors = []
fails = []
def check(name, cond, extra=''):
    print(('  ✔ ' if cond else '  ✘ ') + name + ((' — ' + str(extra)) if (extra and not cond) else ''))
    if not cond: fails.append(name)

def new_page(ctx, label, w=1200, h=900):
    pg = ctx.new_page(); pg.set_viewport_size({'width': w, 'height': h})
    pg.on('pageerror', lambda e: errors.append('[%s] pageerror: %s' % (label, e)))
    pg.on('console', lambda m: errors.append('[%s] console.error: %s' % (label, m.text)) if m.type == 'error' else None)
    return pg
FAST = {'anim': False, 'countdown': 1, 'sound': False, 'music': False, 'volume': 0, 'narrator': False}

try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        ca, cb = br.new_context(), br.new_context()
        for c in (ca, cb): c.add_init_script("localStorage.setItem('pnwok_settings_v2', %s)" % json.dumps(json.dumps(FAST)))
        A, B = new_page(ca, 'A'), new_page(cb, 'B', 420, 900)

        A.goto(BASE); A.wait_for_selector('#n1')
        A.screenshot(path=SHOTS + '/1-menu.png')
        A.fill('#n1', 'Ayu'); A.locator('.mode input[type=number]').nth(2).fill('0')   # timer: tanpa batas
        A.locator('.mode input[type=number]').nth(0).fill('100')                          # buff 100%
        A.click('text=Buat Ruangan >> nth=-1')
        A.wait_for_selector('.lobby-code'); code = A.inner_text('.lobby-code').strip()
        check('lobi menampilkan kode 5 karakter', re.fullmatch(r'[A-Z0-9]{5}', code) is not None, code)
        A.screenshot(path=SHOTS + '/2-lobby.png')

        B.goto(BASE + '/?room=' + code); B.wait_for_selector('#codein')
        check('tautan undangan mengisi kode otomatis', B.input_value('#codein') == code)
        B.fill('#n1', 'Budi'); B.click('text=Gabung >> nth=-1')
        A.wait_for_selector('.cardgrid', timeout=8000); B.wait_for_selector('.cardgrid', timeout=8000)
        check('kedua pemain masuk fase memilih', True)
        check('A memegang kartu positif, B negatif', A.locator('.cardgrid .card.pos').count() == 30 and B.locator('.cardgrid .card.neg').count() == 30)
        A.screenshot(path=SHOTS + '/3-select-A.png'); B.screenshot(path=SHOTS + '/3-select-B-mobile.png', full_page=False)

        def pick_and_lock(pg):
            n = pg.locator('.cardgrid .card.pickable').count(); pg.locator('.cardgrid .card.pickable').nth(random.randrange(n)).click()
            pg.click('text=Kunci Pilihan')

        chosen = {}
        for rnd in range(1, 31):
            for pg in (A, B):
                pg.wait_for_function('document.querySelector(".rnum b") && Number(document.querySelector(".rnum b").textContent)==%d' % rnd, timeout=15000)
                pg.wait_for_selector('.cardgrid', timeout=15000)
            pick_and_lock(A)
            if rnd == 1:
                B.wait_for_selector('.arena .slot.pos .flip', timeout=8000)
                check('B melihat kartu A TERTUTUP setelah A mengunci (punggung kartu)', B.locator('.arena .slot.pos .flip.flipped').count() == 0)
                leak = B.evaluate('JSON.stringify(V)')
                check('state di perangkat B tidak memuat pilihan A', '"selectedPositiveCard":null' in leak)
                A.wait_for_selector('text=Pilihanmu terkunci'); A.screenshot(path=SHOTS + '/4-waiting-A.png')
            pick_and_lock(B)
            for pg in (A, B): pg.wait_for_selector('.verdict', timeout=20000)
            if rnd in (1, 12, 20): A.screenshot(path=SHOTS + '/5-result-r%d-A.png' % rnd)
            ta, tb = A.inner_text('.verdict'), B.inner_text('.verdict')
            if ta != tb: check('hasil ronde %d sama di kedua layar' % rnd, False, (ta, tb))
            for pg in (A, B):
                pg.click('button:has-text("Ronde Berikutnya"), button:has-text("Lihat Hasil Akhir")')
            if rnd == 15:  # uji sambung ulang: A memuat ulang halaman di tengah game
                A.reload(); A.wait_for_selector('.cardgrid', timeout=10000)
                ok = A.inner_text('.rnum b').strip() == '16' and A.inner_text('.roomchip b').strip() == code
                check('muat ulang halaman → otomatis kembali ke ruangan & ronde yang sama', ok)
        for pg in (A, B): pg.wait_for_selector('.final', timeout=15000)
        check('kedua layar menampilkan hasil akhir', True)
        fa, fb = A.inner_text('.winner'), B.inner_text('.winner')
        check('hasil akhir identik di kedua layar', fa == fb, (fa, fb))
        check('verifikasi total pasukan lolos', A.locator('.verify:not(.bad)').count() == 1)
        A.screenshot(path=SHOTS + '/6-final-A.png', full_page=True)

        A.click('text=Main Lagi'); time.sleep(1.5)
        check('rematch butuh persetujuan lawan', A.locator('text=Menunggu Budi').count() == 1 and A.locator('.final').count() == 1)
        B.click('button:has-text("Setuju")')
        for pg in (A, B): pg.wait_for_selector('.cardgrid', timeout=8000)
        check('rematch: game baru mulai di ronde 1', A.inner_text('.rnum b').strip() == '1' and B.inner_text('.rnum b').strip() == '1')

        A.click('text=Keluar'); A.click('button:has-text("Ya, Keluar")')
        B.wait_for_selector('text=meninggalkan permainan', timeout=8000)
        check('lawan melihat pemberitahuan setelah pemain keluar', True)
        B.screenshot(path=SHOTS + '/7-abandoned-B.png')
        br.close()
finally:
    srv.terminate()

real = [e for e in errors if 'favicon' not in e]
check('tidak ada error JavaScript/console di kedua browser', not real, real[:5])
print('\nSELESAI —', 'ADA YANG GAGAL: %s' % fails if fails else 'semua lolos')
sys.exit(1 if fails else 0)
