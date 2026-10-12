'use strict';
/* Tes integrasi server: node test/api.test.js  (memakai penyimpanan memori, tanpa jaringan eksternal) */
const assert = require('assert');
const core = require('../public/game-core.js');
const { start } = require('../dev-server.js');
const { getStore } = require('../lib/store.js');

let base, pass = 0;
const api = async (method, body, q) => {
  const r = await fetch(base + '/api/room' + (q ? '?' + new URLSearchParams(q) : ''), { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined });
  return Object.assign({ http: r.status }, await r.json());
};
const post = (action, o) => api('POST', Object.assign({ action }, o));
const state = (c, t, v) => api('GET', null, { code: c, token: t, v: v || 0 });
const T = async (name, fn) => { try { await fn(); pass++; console.log('  ✔', name); } catch (e) { console.log('  ✘', name, '\n     ', e.message); process.exitCode = 1; } };
const pick = (view, side) => { const g = view.g, a = (side === 'pos' ? g.positiveCards : g.negativeCards), u = side === 'pos' ? g.usedPositiveCards : g.usedNegativeCards; const f = a.filter(v => !u.includes(v)); return f[Math.floor(Math.random() * f.length)]; };

(async () => {
  const srv = await start(0); base = 'http://localhost:' + srv.address().port;
  console.log('Tes API pada', base);
  let code, A, B;

  await T('buat room, pemain 2 bergabung, game dimulai', async () => {
    A = await post('create', { name: 'Ayu', cfg: { buffChance: 100, initialArmy: 5, timer: 30 } });
    assert(A.ok && A.code.length === 5 && A.side === 'pos' && A.view.status === 'lobby' && A.view.g === null);
    code = A.code;
    B = await post('join', { code, name: 'Budi' });
    assert(B.ok && B.side === 'neg' && B.view.status === 'playing' && B.view.phase === 'select');
    assert.strictEqual(B.view.g.positiveArmy, 5); assert.strictEqual(B.view.cfg.timer, 30);
    const full = await post('join', { code, name: 'Cici' }); assert(!full.ok && full.http === 409);
  });
  await T('sambung ulang dengan token yang sama', async () => {
    const r = await post('join', { code, token: A.token, name: 'x' }); assert(r.ok && r.side === 'pos');
  });
  await T('token salah ditolak, kode salah 404', async () => {
    assert.strictEqual((await state(code, 'salah')).http, 401);
    assert.strictEqual((await post('lock', { code, token: 'x', card: 1 })).http, 401);
    assert.strictEqual((await state('ZZZZZ', A.token)).http, 404);
    assert.strictEqual((await post('lock', { code: 'AB', token: A.token, card: 1 })).http, 400);
  });
  await T('validasi kartu: kartu kerajaan lawan / tidak ada ditolak', async () => {
    assert.strictEqual((await post('lock', { code, token: A.token, card: -5 })).http, 400);
    assert.strictEqual((await post('lock', { code, token: A.token, card: 31 })).http, 400);
    assert.strictEqual((await post('lock', { code, token: B.token, card: 5 })).http, 400);
    assert.strictEqual((await post('lock', { code, token: A.token, card: 1.5 })).http, 400);
  });
  await T('pilihan lawan TIDAK bocor sebelum kedua terkunci', async () => {
    const r = await post('lock', { code, token: A.token, card: 7 }); assert(r.ok && r.view.phase === 'select' && r.view.g.p1Locked);
    const vb = await state(code, B.token); const txt = JSON.stringify(vb.view);
    assert.strictEqual(vb.view.g.selectedPositiveCard, null); assert(vb.view.g.p1Locked === true);
    assert(!txt.includes('"selectedPositiveCard":7'));
    const va = await state(code, A.token); assert.strictEqual(va.view.g.selectedPositiveCard, 7);   // pemilik tetap melihat pilihannya
    assert.strictEqual((await post('lock', { code, token: A.token, card: 8 })).http, 409);          // tidak bisa kunci dua kali
  });
  await T('ronde selesai setelah pemain 2 mengunci; hasil publik & benar', async () => {
    const r = await post('lock', { code, token: B.token, card: -12 }); assert(r.ok && r.view.phase === 'resolved');
    const e = r.view.g.battleHistory[0]; assert(e.pCard === 7 && e.nCard === -12 && e.winner === 'negative' && e.remainder === 5);
    assert.strictEqual(r.view.g.negativeArmy, 10); assert.strictEqual(r.view.g.positiveArmy, 5);
    assert.strictEqual(r.view.g.selectedNegativeCard, null);
  });
  await T('ronde berikutnya butuh KEDUA pemain siap', async () => {
    let r = await post('ready', { code, token: A.token }); assert(r.ok && r.view.phase === 'resolved' && r.view.ready.pos && !r.view.ready.neg);
    r = await post('ready', { code, token: B.token }); assert(r.view.phase === 'select' && r.view.g.currentRound === 2);
  });
  await T('simulasi 30 ronde penuh, kunci serentak (uji balapan), hasil terverifikasi', async () => {
    let view = (await state(code, A.token)).view;
    for (let round = view.g.currentRound; round <= 30; round++) {
      view = (await state(code, A.token)).view; assert.strictEqual(view.g.currentRound, round);
      const [ra, rb] = await Promise.all([post('lock', { code, token: A.token, card: pick(view, 'pos') }), post('lock', { code, token: B.token, card: pick(view, 'neg') })]);
      assert(ra.ok && rb.ok, 'lock serentak gagal ronde ' + round + ': ' + JSON.stringify([ra.error, rb.error]));
      view = (await state(code, A.token)).view; assert.strictEqual(view.phase, 'resolved', 'ronde ' + round + ' tidak selesai');
      assert.strictEqual(view.g.battleHistory.length, round);
      if (round >= 11) assert(view.g.battleHistory[round - 1].buff, 'buff 100% harus muncul ronde ' + round);
      await Promise.all([post('ready', { code, token: A.token }), post('ready', { code, token: B.token })]);
    }
    view = (await state(code, A.token)).view;
    assert.strictEqual(view.phase, 'final'); assert(core.verifyState(view.g)); assert.strictEqual(view.g.battleHistory.length, 30);
    const t = new Set(view.g.battleHistory.map(e => e.pCard)); assert.strictEqual(t.size, 30);
  });
  await T('buff curse/blessing: target undian tidak terlihat sebelum ronde dibuka', async () => {
    const r = await post('create', { name: 'P', cfg: { buffChance: 100 } }); const j = await post('join', { code: r.code, name: 'Q' });
    let view = j.view; let seen = false;
    for (let round = 1; round <= 30; round++) {
      view = (await state(r.code, r.token)).view;
      const b = view.g.currentBuff; if (b && (b.type === 'curse' || b.type === 'blessing')) { assert(!b.target, 'target bocor sebelum buka'); seen = true; }
      await post('lock', { code: r.code, token: r.token, card: pick(view, 'pos') }); await post('lock', { code: r.code, token: j.token, card: pick(view, 'neg') });
      const after = (await state(r.code, r.token)).view; const e = after.g.battleHistory[round - 1];
      if (e.buff && (e.buff.type === 'curse' || e.buff.type === 'blessing')) assert(e.buff.target, 'target harus ada setelah buka');
      await post('ready', { code: r.code, token: r.token }); await post('ready', { code: r.code, token: j.token });
    }
    assert(seen, 'tidak ada curse/blessing di 20 ronde buff (sangat tidak mungkin)');
  });
  await T('polling hemat: v sama → unchanged; presence terbaca', async () => {
    const v = (await state(code, A.token)).view.v; const u = await state(code, A.token, v); assert(u.unchanged);
    await state(code, B.token); const ua = await state(code, A.token, v); assert(ua.oppOnline === true);
  });
  await T('rematch: butuh dua pemain, game direset', async () => {
    let r = await post('rematch', { code, token: A.token }); assert(r.view.phase === 'final' && r.view.rematch.pos);
    r = await post('rematch', { code, token: B.token });
    assert(r.view.phase === 'select' && r.view.g.currentRound === 1 && r.view.g.battleHistory.length === 0 && r.view.gameNo === 2 && r.view.g.positiveArmy === 5);
  });
  await T('timer: kartu dipilihkan otomatis setelah tenggat lewat', async () => {
    const store = getStore(), raw = JSON.parse(await store.cmd(['GET', 'room:' + code]));
    raw.roundStartedAt -= 60 * 1000; await store.cmd(['SET', 'room:' + code, JSON.stringify(raw)]);
    const s = await state(code, A.token, 0);
    assert(s.view.phase === 'resolved' && s.view.g.battleHistory.length === 1 && s.view.autoPicked === 1);
  });
  await T('siap otomatis: ronde lanjut bila lawan tak kunjung siap (30 dtk)', async () => {
    await post('ready', { code, token: A.token });
    const store = getStore(), raw = JSON.parse(await store.cmd(['GET', 'room:' + code]));
    raw.readyAt -= 40 * 1000; await store.cmd(['SET', 'room:' + code, JSON.stringify(raw)]);
    const s = await state(code, B.token, 0); assert(s.view.phase === 'select' && s.view.g.currentRound === 2);
  });
  await T('leave: lawan melihat ruangan ditutup', async () => {
    await post('leave', { code, token: B.token });
    const s = await state(code, A.token, 0); assert(s.view.phase === 'abandoned' && s.view.leftBy === 'neg');
  });
  await T('keluar di layar hasil akhir: lawan tetap melihat hasil, rematch ditolak', async () => {
    const r = await post('create', { name: 'P', cfg: { buffChance: 0 } }); const j = await post('join', { code: r.code, name: 'Q' });
    for (let round = 1; round <= 30; round++) {
      const v = (await state(r.code, r.token)).view;
      await post('lock', { code: r.code, token: r.token, card: pick(v, 'pos') }); await post('lock', { code: r.code, token: j.token, card: pick(v, 'neg') });
      await post('ready', { code: r.code, token: r.token }); await post('ready', { code: r.code, token: j.token });
    }
    await post('leave', { code: r.code, token: j.token });
    const s = await state(r.code, r.token, 0); assert(s.view.phase === 'final' && s.view.leftBy === 'neg' && core.verifyState(s.view.g));
    assert.strictEqual((await post('rematch', { code: r.code, token: r.token })).http, 409);
  });
  await T('input aneh: nama kosong, cfg di luar batas', async () => {
    assert.strictEqual((await post('create', { name: '   ' })).http, 400);
    const r = await post('create', { name: '<b>x</b>', cfg: { buffChance: 999, initialArmy: -4, timer: 3 } });
    assert(r.view.cfg.buffChance === 100 && r.view.cfg.initialArmy === 0 && r.view.cfg.timer === 15 && r.view.names.pos === 'bx/b');
    assert.strictEqual((await post('nope', {})).http, 400);
  });
  srv.close(); console.log('\n' + pass + ' tes lulus' + (process.exitCode ? ' — ADA YANG GAGAL' : '')); 
})();
