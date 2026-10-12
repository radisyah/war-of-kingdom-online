/* War of Kingdoms: inti permainan (dipakai SERVER untuk menentukan hasil, dan KLIEN untuk menampilkan).
   Semua aturan (buff, undian, perhitungan pertempuran) dijalankan di server; klien hanya menampilkan. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GameCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';
const MAX_ROUNDS = 30;
const FIRST_BUFF_ROUND = 11, FIRST_BUFF_BONUS = 50;   // peluang buff di ronde 11 = peluang normal + 50% (maks 100%)
const BUFF_ICONS = { curse: '☠️', blessing: '✨', double: '⚡', weaken: '🔻', shield: '🛡️', mirror: '🔄', chaos: '🌀', seal: '🔱' };
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const fmt = v => (v < 0 ? '−' : '+') + Math.abs(v);
const fmtE = e => (e.sign < 0 ? '−' : '+') + e.power;
const tierOf = v => { const a = Math.abs(v); return a <= 10 ? 1 : a <= 20 ? 2 : 3; };
const tierName = v => { const t = tierOf(v); return t === 1 ? 'Prajurit' : t === 2 ? 'Kesatria' : (Math.abs(v) >= 28 ? 'Panglima Agung' : 'Panglima'); };
const pickRand = a => a[Math.floor(Math.random() * a.length)];
const KNAME = { positive: 'Kerajaan Positif', negative: 'Kerajaan Negatif' };
const SCENARIOS = [
  { icon: '🌙', title: 'Malam Tanpa Bulan', story: 'Kegelapan menelan perbatasan. Tak seorang pun tahu kartu siapa yang bergerak di balik kabut.' },
  { icon: '🕵️', title: 'Mata-mata di Kemah', story: 'Seorang pengintai dikabarkan menyusup ke tenda strategi. Siapa yang masih bisa dipercaya?' },
  { icon: '🐺', title: 'Lolongan di Kejauhan', story: 'Lolongan terdengar dari hutan terlarang. Para prajurit gelisah menunggu perintah.' },
  { icon: '🗡️', title: 'Pengkhianat di Dewan', story: 'Salah satu penasihat dikabarkan menjual rahasia. Mungkin pola pilihanmu sudah bisa ditebak.' },
  { icon: '🔥', title: 'Api Unggun Terakhir', story: 'Api hampir padam. Keputusan malam ini akan dikenang sepanjang perang.' },
  { icon: '🌫️', title: 'Kabut Pengelabu', story: 'Kabut tebal menyelimuti medan. Gertakan bisa lebih mematikan daripada pedang.' },
  { icon: '🔔', title: 'Lonceng Tengah Malam', story: 'Lonceng berdentang tiga kali. Seluruh pasukan menahan napas.' },
  { icon: '🩸', title: 'Bulan Merah', story: 'Bulan berubah merah darah. Para peramal berkata: yang berani akan menang, atau binasa.' },
  { icon: '📜', title: 'Surat Tanpa Nama', story: 'Sepucuk surat misterius menyebut serangan besar. Benarkah, atau hanya umpan?' },
  { icon: '🏰', title: 'Gerbang Diketuk', story: 'Seseorang mengetuk gerbang benteng tengah malam. Dibuka, atau diabaikan?' },
  { icon: '🦉', title: 'Burung Hantu Pengintai', story: 'Seekor burung hantu bertengger di menara, matanya tak berkedip menatap kedua kemah.' },
  { icon: '⚰️', title: 'Pemakaman Para Prajurit', story: 'Kuburan baru digali di bawah hujan. Berapa banyak lagi yang rela dikorbankan?' },
  { icon: '🌩️', title: 'Badai Mendekat', story: 'Petir menyambar bukit. Pasukan menunggu satu perintah yang menentukan.' },
  { icon: '🕯️', title: 'Lilin yang Berkedip', story: 'Lilin di meja perang bergoyang. Seseorang di ruangan ini sedang berbohong.' }
];
const OPENING = { icon: '⚔️', title: 'Perang Dimulai', story: 'Dua kerajaan saling mengintai di bawah langit tanpa bintang. Tak ada yang tahu siapa yang akan bertahan, dan siapa yang akan berkhianat.' };
const FINALE = { icon: '🌑', title: 'Pertempuran Penentuan', story: 'Kartu terakhir telah ditarik. Tak ada lagi pilihan, hanya konsekuensi dari semua keputusan sebelumnya.' };
function scenarioFor(round) {
  if (round <= 1) return OPENING;
  if (round >= 30) return FINALE;
  return SCENARIOS[((round - 1) * 5 + 2) % SCENARIOS.length];
}
function newState(p1, p2, initial) {
  const a = initial == null ? 0 : initial;
  return {
    currentRound: 1, maxRounds: MAX_ROUNDS,
    player1Name: p1, player2Name: p2,
    positiveCards: range(1, 30), negativeCards: range(1, 30).map(v => -v),
    usedPositiveCards: [], usedNegativeCards: [],
    selectedPositiveCard: null, selectedNegativeCard: null,
    p1Locked: false, p2Locked: false,
    initialArmy: { positive: a, negative: a },
    positiveArmy: a, negativeArmy: a, positiveGained: 0, negativeGained: 0,
    positiveRoundWins: 0, negativeRoundWins: 0, draws: 0,
    currentBuff: null, buffHistory: [null], battleHistory: [],
    armyTimeline: [{ round: 0, positive: a, negative: a }],
    currentTurn: 1, gamePhase: 'ready1', gameStatus: 'playing', isResolvingBattle: false
  };
}
function availableCards(st, side) {
  const all = side === 1 ? st.positiveCards : st.negativeCards;
  const used = side === 1 ? st.usedPositiveCards : st.usedNegativeCards;
  return all.filter(v => !used.includes(v));
}
function lotteryDesc(b) {
  const sum = ' Bila tanda kedua kartu jadi sama, kekuatannya dijumlahkan untuk kerajaan bertanda itu.';
  if (b.type === 'curse') {
    if (!b.target) return 'Kartu buff NEGATIF. Setelah kedua pemain memilih kartu, diundi kerajaan yang terkena: jatuh ke Kerajaan Negatif → kartunya menjadi positif; jatuh ke Kerajaan Positif → kartunya menjadi negatif.' + sum;
    return 'Kartu buff negatif jatuh pada ' + KNAME[b.target] + ': kartunya menjadi ' + (b.target === 'negative' ? 'POSITIF' : 'NEGATIF') + '.' + sum;
  }
  if (!b.target) return 'Kartu buff POSITIF. Setelah kedua pemain memilih kartu, diundi kerajaan yang terkena: jatuh ke Kerajaan Negatif → kartunya tetap negatif; jatuh ke Kerajaan Positif → kartunya tetap positif.';
  return 'Kartu buff positif jatuh pada ' + KNAME[b.target] + ': kartunya ' + (b.target === 'negative' ? 'tetap NEGATIF' : 'tetap POSITIF') + '.';
}
function drawLottery(buff, rng) {
  if (buff && (buff.type === 'curse' || buff.type === 'blessing') && !buff.target) {
    buff.target = (rng || Math.random)() < 0.5 ? 'positive' : 'negative';
    buff.desc = lotteryDesc(buff);
  }
  return buff;
}
function makeBuff(type, rng) {
  const pick = a => a[Math.floor(rng() * a.length)];
  const rnd = (a, b) => a + Math.floor(rng() * (b - a + 1));
  const side = t => t === 'positive' ? 'Positif' : 'Negatif';
  const b = { type, icon: BUFF_ICONS[type] };
  switch (type) {
    case 'curse': b.name = 'NEGATIVE CURSE'; b.desc = lotteryDesc(b); break;
    case 'blessing': b.name = 'POSITIVE BLESSING'; b.desc = lotteryDesc(b); break;
    case 'double': b.name = 'DOUBLE POWER'; b.target = pick(['positive', 'negative']); b.desc = 'Kekuatan efektif kartu ' + side(b.target) + ' digandakan (×2).'; break;
    case 'weaken': b.name = 'WEAKENING'; b.target = pick(['positive', 'negative']); b.value = rnd(2, 6); b.desc = 'Kekuatan efektif kartu ' + side(b.target) + ' dikurangi ' + b.value + '.'; break;
    case 'shield': b.name = 'KINGDOM SHIELD'; b.owner = pick(['positive', 'negative']); b.value = rnd(3, 7); b.desc = 'Perisai ' + KNAME[b.owner] + ': kekuatan kartu lawan dikurangi ' + b.value + '.'; break;
    case 'mirror': b.name = 'MIRROR CURSE'; b.desc = 'Tanda kedua kartu dibalik: Positif menjadi Negatif dan Negatif menjadi Positif.'; break;
    case 'chaos': {
      b.name = 'CHAOS CARD'; b.variant = pick(['swap', 'halve', 'invert']);
      b.desc = b.variant === 'swap' ? 'Kejadian Kacau: kekuatan kedua kartu saling ditukar.'
        : b.variant === 'halve' ? 'Kejadian Kacau: kekuatan kedua kartu dibagi dua (dibulatkan ke bawah).'
          : 'Kejadian Kacau: skala dibalik, kekuatan baru = 31 − kekuatan kartu.';
      break;
    }
    case 'seal': b.name = 'ABSOLUTE SEAL'; b.sealed = pick(['NEGATIVE CURSE', 'POSITIVE BLESSING', 'DOUBLE POWER', 'WEAKENING', 'KINGDOM SHIELD', 'MIRROR CURSE', 'CHAOS CARD']);
      b.desc = 'Segel Mutlak menonaktifkan efek ' + b.sealed + ' yang sedianya terjadi. Kartu bertarung dengan nilai aslinya.'; break;
  }
  return b;
}
function generateBuff(round, chance, rng) {
  round = round == null ? (S ? S.currentRound : 1) : round;
  chance = chance == null ? 35 : chance;
  rng = rng || Math.random;
  if (round <= 10) return null;                 // tidak ada buff pada ronde 1–10
  if (round === FIRST_BUFF_ROUND && chance > 0) chance = Math.min(100, chance + FIRST_BUFF_BONUS); // ronde 11 lebih berpeluang
  if (rng() * 100 >= chance) return null;
  const pool = [['curse', 30], ['blessing', 30], ['double', 9], ['weaken', 8], ['shield', 8], ['mirror', 6], ['chaos', 6], ['seal', 3]];   // curse + blessing = 60% dari semua buff
  const total = pool.reduce((s, p) => s + p[1], 0);
  let r = rng() * total, type = pool[0][0];
  for (const [t, w] of pool) { if (r < w) { type = t; break; } r -= w; }
  return makeBuff(type, rng);
}
function applyBuff(pv, nv, buff) {
  const p = { sign: 1, power: Math.abs(pv) }, n = { sign: -1, power: Math.abs(nv) };
  const steps = [];
  if (!buff) return { p, n, steps };
  const lbl = e => e === p ? 'Positif' : 'Negatif';
  switch (buff.type) {
    case 'curse': {
      const t = buff.target || 'positive', e = t === 'positive' ? p : n;
      const bf = fmtE(e); e.sign = t === 'negative' ? 1 : -1;
      steps.push('Kartu buff negatif jatuh ke ' + KNAME[t] + '. Kartu ' + lbl(e) + ' ' + bf + ' → ' + fmtE(e) + (t === 'negative' ? ' (negatif menjadi positif)' : ' (positif menjadi negatif)'));
      break;
    }
    case 'blessing': {
      const t = buff.target || 'positive', e = t === 'positive' ? p : n;
      const bf = fmtE(e); e.sign = t === 'negative' ? -1 : 1;
      steps.push('Kartu buff positif jatuh ke ' + KNAME[t] + '. Kartu ' + lbl(e) + ' ' + bf + ' → ' + fmtE(e) + (t === 'negative' ? ' (tetap negatif)' : ' (tetap positif)'));
      break;
    }
    case 'double': { const e = buff.target === 'positive' ? p : n; const b = fmtE(e); e.power *= 2; steps.push('Kartu ' + lbl(e) + ' ' + b + ' → ' + fmtE(e) + ' (×2)'); break; }
    case 'weaken': { const e = buff.target === 'positive' ? p : n; const b = fmtE(e); e.power = Math.max(0, e.power - buff.value); steps.push('Kartu ' + lbl(e) + ' ' + b + ' → ' + fmtE(e) + ' (kekuatan − ' + buff.value + ', minimum 0)'); break; }
    case 'shield': { const e = buff.owner === 'positive' ? n : p; const b = fmtE(e); e.power = Math.max(0, e.power - buff.value); steps.push('Perisai ' + KNAME[buff.owner] + ' melemahkan kartu ' + lbl(e) + ': ' + b + ' → ' + fmtE(e)); break; }
    case 'mirror': { const bp = fmtE(p), bn = fmtE(n); p.sign = -1; n.sign = 1; steps.push('Kartu Positif ' + bp + ' → ' + fmtE(p)); steps.push('Kartu Negatif ' + bn + ' → ' + fmtE(n)); break; }
    case 'chaos': {
      const bp = fmtE(p), bn = fmtE(n);
      if (buff.variant === 'swap') { const t = p.power; p.power = n.power; n.power = t; }
      else if (buff.variant === 'halve') { p.power = Math.floor(p.power / 2); n.power = Math.floor(n.power / 2); }
      else { p.power = 31 - p.power; n.power = 31 - n.power; }
      steps.push('Kartu Positif ' + bp + ' → ' + fmtE(p)); steps.push('Kartu Negatif ' + bn + ' → ' + fmtE(n)); break;
    }
    case 'seal': steps.push('Segel Mutlak menonaktifkan efek ' + buff.sealed + '. Tidak ada perubahan nilai.'); break;
  }
  return { p, n, steps };
}
function calculateBattle(p, n) {
  /* Tanda efektif sama (mis. −8 dan −7 setelah NEGATIVE CURSE): kekuatan DIJUMLAHKAN untuk kerajaan bertanda itu. */
  if (p.sign === n.sign) {
    const total = p.power + n.power;
    return total === 0 ? { winner: 'draw', remainder: 0 } : { winner: p.sign > 0 ? 'positive' : 'negative', remainder: total };
  }
  if (p.power === n.power) return { winner: 'draw', remainder: 0 };
  const w = p.power > n.power ? p : n;
  return { winner: w.sign > 0 ? 'positive' : 'negative', remainder: Math.abs(p.power - n.power) };
}
function updateArmy(st, winner, remainder) {
  if (winner === 'positive') { st.positiveArmy += remainder; st.positiveGained += remainder; st.positiveRoundWins++; }
  else if (winner === 'negative') { st.negativeArmy += remainder; st.negativeGained += remainder; st.negativeRoundWins++; }
  else st.draws++;
  st.armyTimeline.push({ round: st.battleHistory.length + 1, positive: st.positiveArmy, negative: st.negativeArmy });
}
function explainEntry(e) {
  const L = [];
  L.push({ k: 'Kartu asli', v: fmt(e.pCard) + ' (Positif) vs ' + fmt(e.nCard) + ' (Negatif)' });
  if (e.buff) {
    L.push({ k: 'Buff', v: e.buff.icon + ' ' + e.buff.name + ' — ' + e.buff.desc });
    e.steps.forEach(s => L.push({ k: 'Efek', v: s }));
  }
  L.push({ k: 'Nilai efektif', v: fmtE(e.pEff) + ' vs ' + fmtE(e.nEff) });
  const a = e.pEff.power, b = e.nEff.power, same = e.pEff.sign === e.nEff.sign;
  if (same) L.push({ k: 'Perbandingan', v: 'Kedua kartu sama-sama ' + (e.pEff.sign > 0 ? 'positif' : 'negatif') + ' → kekuatan dijumlahkan: ' + a + ' + ' + b + ' = ' + (a + b) });
  else L.push({ k: 'Perbandingan', v: '|' + a + '| vs |' + b + '| → ' + (a === b ? a + ' = ' + b + ' (sama kuat)' : Math.max(a, b) + ' > ' + Math.min(a, b)) });
  if (e.winner === 'draw') L.push({ k: 'Hasil', v: 'SERI — kedua pasukan gugur, sisa 0.', cls: 'draw' });
  else if (same) L.push({ k: 'Hasil', v: 'Kedua kartu bertanda ' + (e.pEff.sign > 0 ? 'positif' : 'negatif') + ' → seluruh ' + a + ' + ' + b + ' = ' + e.remainder + ' pasukan masuk ke ' + KNAME[e.winner] + '.', cls: e.winner === 'positive' ? 'pos' : 'neg' });
  else {
    const win = e.winner === 'positive' ? e.pEff : e.nEff;
    L.push({ k: 'Hasil', v: 'Kartu pemenang bertanda ' + (win.sign > 0 ? 'positif' : 'negatif') + ' → ' + KNAME[e.winner] + ' menang. Sisa = ' + Math.max(a, b) + ' − ' + Math.min(a, b) + ' = ' + e.remainder + ' pasukan masuk ke ' + KNAME[e.winner] + '.', cls: e.winner === 'positive' ? 'pos' : 'neg' });
  }
  return L;
}
function resolveBattle(st) {
  st = st || S;
  if (st.battleHistory.length >= st.currentRound) return null;
  const pv = st.selectedPositiveCard, nv = st.selectedNegativeCard;
  if (pv == null || nv == null) return null;
  if (!st.positiveCards.includes(pv) || st.usedPositiveCards.includes(pv)) return null;
  if (!st.negativeCards.includes(nv) || st.usedNegativeCards.includes(nv)) return null;
  const buff = st.currentBuff ? JSON.parse(JSON.stringify(st.currentBuff)) : null;
  drawLottery(buff);   // undian curse/blessing baru dilakukan sekarang, setelah kedua kartu terkunci
  const ap = applyBuff(pv, nv, buff);
  const res = calculateBattle(ap.p, ap.n);
  st.usedPositiveCards.push(pv); st.usedNegativeCards.push(nv);
  updateArmy(st, res.winner, res.remainder);
  const entry = {
    round: st.currentRound, pCard: pv, nCard: nv, buff, steps: ap.steps,
    pEff: ap.p, nEff: ap.n, winner: res.winner, remainder: res.remainder,
    positiveArmyAfter: st.positiveArmy, negativeArmyAfter: st.negativeArmy
  };
  st.battleHistory.push(entry);
  st.selectedPositiveCard = null; st.selectedNegativeCard = null; st.p1Locked = false; st.p2Locked = false;
  return entry;
}
function advanceRound(st, chance) {
  if (st.battleHistory.length < st.currentRound) return null;
  if (st.currentRound >= st.maxRounds) { st.gameStatus = 'finished'; st.gamePhase = 'final'; st.currentBuff = null; return false; }
  st.currentRound++;
  const b = generateBuff(st.currentRound, chance == null ? 35 : chance);
  st.currentBuff = b; st.buffHistory[st.currentRound - 1] = b;
  st.gamePhase = 'ready1'; st.currentTurn = 1;
  return true;
}
function verifyState(st) {
  let ps = 0, ns = 0, pw = 0, nw = 0, dr = 0;
  st.battleHistory.forEach(e => {
    if (e.winner === 'positive') { ps += e.remainder; pw++; }
    else if (e.winner === 'negative') { ns += e.remainder; nw++; }
    else dr++;
  });
  return st.positiveGained === ps && st.negativeGained === ns &&
    st.positiveArmy === st.initialArmy.positive + ps && st.negativeArmy === st.initialArmy.negative + ns &&
    st.positiveRoundWins === pw && st.negativeRoundWins === nw && st.draws === dr &&
    pw + nw + dr === st.battleHistory.length;
}
function summarize(st) {
  const used = st.usedPositiveCards.length;
  return {
    posTotal: st.positiveArmy, negTotal: st.negativeArmy,
    posGained: st.positiveGained, negGained: st.negativeGained,
    posWins: st.positiveRoundWins, negWins: st.negativeRoundWins, draws: st.draws,
    used, left: st.maxRounds - used,
    winner: st.positiveArmy > st.negativeArmy ? 'positive' : st.negativeArmy > st.positiveArmy ? 'negative' : 'draw'
  };
}
return { MAX_ROUNDS, FIRST_BUFF_ROUND, BUFF_ICONS, range, fmt, fmtE, tierOf, tierName, pickRand, KNAME, SCENARIOS, OPENING, FINALE, scenarioFor, newState, availableCards, lotteryDesc, drawLottery, makeBuff, generateBuff, applyBuff, calculateBattle, updateArmy, explainEntry, resolveBattle, advanceRound, verifyState, summarize };
});
