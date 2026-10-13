'use strict';
const crypto = require('crypto');
const core = require('../public/game-core.js');
const { getStore } = require('../lib/store.js');

const TTL = 6 * 3600;            // room hilang 6 jam setelah aktivitas terakhir
const PRES_TTL = 20;             // detik; pemain dianggap terputus bila tidak polling selama ini
const AUTO_PICK_GRACE = 6000;    // ms tambahan setelah batas waktu sebelum kartu dipilihkan otomatis
const READY_TIMEOUT = 30000;     // ms; ronde berikutnya jalan otomatis bila lawan tak kunjung siap
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const fail = (status, msg) => { const e = new Error(msg); e.status = status; return e; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rid = n => crypto.randomBytes(n).toString('hex');
const oppOf = side => side === 'pos' ? 'neg' : 'pos';
const clamp = (v, a, b, d) => { v = Math.round(Number(v)); return isNaN(v) ? d : Math.min(b, Math.max(a, v)); };
const cleanName = s => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
const roomKey = c => 'room:' + c, presKey = (c, s) => 'pres:' + c + ':' + s;

function parseCfg(c) {
  c = c || {};
  const timer = Math.round(Number(c.timer));
  return {
    buffChance: clamp(c.buffChance, 0, 100, 35),
    initialArmy: clamp(c.initialArmy, 0, 100, 0),
    timer: !timer || isNaN(timer) ? 0 : Math.min(180, Math.max(15, timer))
  };
}

/* ---------- logika room ---------- */
function phaseOf(room) {
  if (room.status === 'lobby') return 'lobby';
  if (room.status === 'abandoned') return 'abandoned';
  const g = room.game;
  if (g.gameStatus === 'finished') return 'final';
  return g.battleHistory.length >= g.currentRound ? 'resolved' : 'select';
}
function startGame(room, now) {
  room.game = core.newState(room.seats.pos.name, room.seats.neg.name, room.cfg.initialArmy, room.cfg.buffChance);
  room.status = 'playing';
  room.roundStartedAt = now; room.resolvedAt = null; room.readyAt = null;
  room.ready = { pos: false, neg: false }; room.rematch = { pos: false, neg: false };
  room.gameNo = (room.gameNo || 0) + 1;
}
function lockCard(room, side, card) {
  const g = room.game;
  if (side === 'pos') { g.selectedPositiveCard = card; g.p1Locked = true; }
  else { g.selectedNegativeCard = card; g.p2Locked = true; }
}
function maybeResolve(room, now) {
  const g = room.game;
  if (phaseOf(room) !== 'select' || !g.p1Locked || !g.p2Locked) return false;
  const e = core.resolveBattle(g);
  if (!e) throw fail(500, 'Gagal menghitung pertempuran.');
  room.resolvedAt = now; room.readyAt = null; room.ready = { pos: false, neg: false };
  return true;
}
function advance(room, now) {
  const r = core.advanceRound(room.game, room.cfg.buffChance);
  if (r === null) return false;
  room.roundStartedAt = now; room.readyAt = null; room.ready = { pos: false, neg: false };
  return true;
}
function randomFree(room, side) {
  const a = core.availableCards(room.game, side === 'pos' ? 1 : 2);
  return a[Math.floor(Math.random() * a.length)];
}
/* Penanganan tenggat secara "malas": dijalankan tiap request karena serverless tidak punya proses latar. */
function needsTick(room, now) {
  const ph = phaseOf(room);
  if (ph === 'select' && room.cfg.timer > 0) return now > room.roundStartedAt + room.cfg.timer * 1000 + AUTO_PICK_GRACE;
  if (ph === 'resolved' && room.readyAt) return now > room.readyAt + READY_TIMEOUT;
  return false;
}
function tick(room, now) {
  if (!needsTick(room, now)) return false;
  const ph = phaseOf(room), g = room.game;
  if (ph === 'select') {
    if (!g.p1Locked) lockCard(room, 'pos', randomFree(room, 'pos'));
    if (!g.p2Locked) lockCard(room, 'neg', randomFree(room, 'neg'));
    room.autoPicked = room.game.currentRound;
    maybeResolve(room, now);
  } else advance(room, now);
  return true;
}

function viewFor(room, side, now, oppOnline) {
  const g = JSON.parse(JSON.stringify(room.game || {}));
  if (room.game) {
    // pilihan yang belum terbuka TIDAK pernah dikirim ke lawan
    g.selectedPositiveCard = side === 'pos' ? room.game.selectedPositiveCard : null;
    g.selectedNegativeCard = side === 'neg' ? room.game.selectedNegativeCard : null;
    delete g.gamePhase; delete g.currentTurn; delete g.isResolvingBattle;
    delete g.buffPlan;   // rencana buff ronde mendatang bersifat rahasia
  }
  const phase = phaseOf(room);
  return {
    code: room.code, v: room.v, side, status: room.status, phase, gameNo: room.gameNo || 0,
    cfg: room.cfg, serverNow: now,
    names: { pos: room.seats.pos.name, neg: room.seats.neg ? room.seats.neg.name : null },
    oppOnline: !!oppOnline, leftBy: room.leftBy || null,
    deadline: phase === 'select' && room.cfg.timer > 0 ? room.roundStartedAt + room.cfg.timer * 1000 : null,
    autoPicked: room.autoPicked || 0,
    ready: room.ready, rematch: room.rematch,
    g: room.game ? g : null
  };
}

/* ---------- akses data ---------- */
async function withRoom(code, fn) {
  const store = getStore(), lk = 'lock:' + code, id = rid(6);
  let got = false;
  for (let i = 0; i < 60 && !got; i++) {
    got = (await store.cmd(['SET', lk, id, 'NX', 'PX', 4000])) === 'OK';
    if (!got) await sleep(30 + Math.random() * 40);
  }
  if (!got) throw fail(503, 'Server sedang sibuk. Coba lagi.');
  try {
    const raw = await store.cmd(['GET', roomKey(code)]);
    if (!raw) throw fail(404, 'Ruangan tidak ditemukan atau sudah kedaluwarsa.');
    const room = JSON.parse(raw);
    const out = await fn(room);
    room.v++;
    await store.cmd(['SET', roomKey(code), JSON.stringify(room), 'EX', TTL]);
    return out;
  } finally { await store.cmd(['DEL', lk]).catch(() => { }); }
}
function seatOf(room, token) {
  if (!token) throw fail(401, 'Sesi tidak valid.');
  if (room.seats.pos && room.seats.pos.token === token) return 'pos';
  if (room.seats.neg && room.seats.neg.token === token) return 'neg';
  throw fail(401, 'Sesi tidak valid. Gabung ulang ke ruangan.');
}
const normCode = c => { c = String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); if (c.length !== 5) throw fail(400, 'Kode ruangan harus 5 karakter.'); return c; };

/* ---------- aksi ---------- */
async function actCreate(b) {
  const name = cleanName(b.name); if (!name) throw fail(400, 'Isi nama terlebih dahulu.');
  const store = getStore(), now = Date.now(), token = rid(12);
  for (let i = 0; i < 12; i++) {
    let code = ''; for (let k = 0; k < 5; k++) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
    const room = { code, v: 1, createdAt: now, cfg: parseCfg(b.cfg), seats: { pos: { token, name }, neg: null }, status: 'lobby', game: null, gameNo: 0, ready: { pos: false, neg: false }, rematch: { pos: false, neg: false } };
    const ok = await store.cmd(['SET', roomKey(code), JSON.stringify(room), 'NX', 'EX', TTL]);
    if (ok === 'OK') return { code, token, side: 'pos', view: viewFor(room, 'pos', now, false) };
  }
  throw fail(503, 'Gagal membuat ruangan. Coba lagi.');
}
async function actJoin(b) {
  const code = normCode(b.code), now = Date.now();
  return withRoom(code, room => {
    if (b.token) { // sambung ulang
      try { const side = seatOf(room, b.token); return { code, token: b.token, side, view: viewFor(room, side, now, true) }; } catch (e) { /* lanjut sebagai pemain baru */ }
    }
    if (room.status === 'abandoned') throw fail(409, 'Ruangan ini sudah ditutup.');
    if (room.seats.neg) throw fail(409, 'Ruangan sudah penuh.');
    const name = cleanName(b.name); if (!name) throw fail(400, 'Isi nama terlebih dahulu.');
    const token = rid(12);
    room.seats.neg = { token, name };
    startGame(room, now);
    return { code, token, side: 'neg', view: viewFor(room, 'neg', now, true) };
  });
}
async function actLock(b) {
  const code = normCode(b.code), now = Date.now();
  return withRoom(code, room => {
    const side = seatOf(room, b.token), g = room.game;
    if (phaseOf(room) !== 'select') throw fail(409, 'Belum waktunya memilih kartu.');
    if (side === 'pos' ? g.p1Locked : g.p2Locked) throw fail(409, 'Pilihanmu sudah terkunci.');
    const card = Number(b.card), pool = side === 'pos' ? g.positiveCards : g.negativeCards, used = side === 'pos' ? g.usedPositiveCards : g.usedNegativeCards;
    if (!Number.isInteger(card) || !pool.includes(card) || used.includes(card)) throw fail(400, 'Kartu tidak valid atau sudah terpakai.');
    lockCard(room, side, card);
    maybeResolve(room, now);
    return { view: viewFor(room, side, now, true) };
  });
}
async function actReady(b) {
  const code = normCode(b.code), now = Date.now();
  return withRoom(code, room => {
    const side = seatOf(room, b.token);
    if (phaseOf(room) !== 'resolved') throw fail(409, 'Ronde belum selesai.');
    if (!room.ready[side]) { room.ready[side] = true; if (!room.readyAt) room.readyAt = now; }
    if (room.ready.pos && room.ready.neg) advance(room, now);
    return { view: viewFor(room, side, now, true) };
  });
}
async function actRematch(b) {
  const code = normCode(b.code), now = Date.now();
  return withRoom(code, room => {
    const side = seatOf(room, b.token);
    if (phaseOf(room) !== 'final') throw fail(409, 'Permainan belum selesai.');
    if (room.leftBy) throw fail(409, 'Lawan sudah meninggalkan ruangan.');
    room.rematch[side] = true;
    if (room.rematch.pos && room.rematch.neg) startGame(room, now);
    return { view: viewFor(room, side, now, true) };
  });
}
async function actLeave(b) {
  const code = normCode(b.code), now = Date.now();
  return withRoom(code, room => {
    const side = seatOf(room, b.token);
    if (phaseOf(room) === 'final') room.leftBy = side;           // hasil akhir tetap bisa dilihat lawan
    else { room.status = 'abandoned'; room.leftBy = side; }
    return { view: viewFor(room, side, now, false) };
  });
}
/* Polling: satu round-trip ke Redis (GET room + tanda hadir + cek lawan). Menulis hanya bila ada tenggat yang lewat. */
async function actState(q) {
  const code = normCode(q.code), token = String(q.token || ''), have = Number(q.v) || 0, now = Date.now(), store = getStore();
  const first = await store.pipeline([['GET', roomKey(code)], ['EXISTS', presKey(code, 'pos')], ['EXISTS', presKey(code, 'neg')]]);
  if (!first[0]) throw fail(404, 'Ruangan tidak ditemukan atau sudah kedaluwarsa.');
  let room = JSON.parse(first[0]);
  const side = seatOf(room, token);
  await store.cmd(['SET', presKey(code, side), '1', 'EX', PRES_TTL]);
  const oppOnline = !!first[side === 'pos' ? 2 : 1];
  if (room.status === 'playing' && needsTick(room, now)) {
    await withRoom(code, r => { tick(r, now); });
    room = JSON.parse(await store.cmd(['GET', roomKey(code)]));
  }
  if (room.v === have) return { unchanged: true, v: room.v, oppOnline, serverNow: now };
  return { view: viewFor(room, side, now, oppOnline) };
}

/* ---------- handler HTTP (Vercel) ---------- */
function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { throw fail(400, 'Body tidak valid.'); } }
  return {};
}
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    let out;
    if (req.method === 'GET') out = await actState(req.query || {});
    else if (req.method === 'POST') {
      const b = readBody(req);
      const acts = { create: actCreate, join: actJoin, lock: actLock, ready: actReady, rematch: actRematch, leave: actLeave };
      if (!acts[b.action]) throw fail(400, 'Aksi tidak dikenal.');
      out = await acts[b.action](b);
    } else throw fail(405, 'Metode tidak didukung.');
    res.status(200).json(Object.assign({ ok: true }, out));
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(e);
    res.status(status).json({ ok: false, error: status >= 500 && !e.status ? 'Terjadi kesalahan di server.' : e.message });
  }
};
module.exports._internal = { phaseOf, needsTick, tick, viewFor, parseCfg };
