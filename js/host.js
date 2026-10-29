// Hos: tetapan bilik, buka bilik PeerJS, dan enjin permainan (sumber kebenaran tunggal untuk markah).
// Hos juga seorang pemain: UI pemainnya bersambung ke enjin ini melalui LocalLink, bukan WebRTC.
import { $, el, clear, show, toast, store, keepAwake, download, cleanName, sfx } from './ui.js';
import { HostLink, LocalLink } from './net.js';
import { sanitizeAvatar } from './avatar-config.js';
import { CATEGORIES, DEFAULT_COLS, COLS_PER_GAME, LETTERS, LANGS, colLabel, categoryById } from './categories.js';
import { loadChecker } from './validate.js';
import { startPlayer } from './player.js';
import { track } from './stats.js';

const SESSION_KEY = 'jh.hostSession';
const SETTINGS_KEY = 'jh.hostSettings';
const HISTORY_KEY = 'jh.history';
const MAX_PLAYERS = 50;
const PICK_MS = 15000; // masa untuk pemain memilih huruf
const LETTER_INTRO_MS = 3200; // animasi huruf sebelum kotak jawapan dibuka
const HURRY_MS = 15000; // kira detik selepas orang pertama hantar
const RESULT_MS = 14000; // tempoh skrin keputusan sebelum giliran seterusnya
const GRACE_MS = 1500; // tempoh ihsan untuk jawapan dalam perjalanan

const DEFAULTS = { lang: 'ms', cols: [...DEFAULT_COLS], letters: 26, time: 90, hurry: true, late: true };

const randomPin = () => String(100000 + Math.floor(Math.random() * 900000));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();

export function joinURL(pin) {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('pin', pin);
  const qs = new URLSearchParams(location.search);
  if (qs.get('peer')) u.searchParams.set('peer', qs.get('peer'));
  return u.toString();
}

function loadSettings() {
  const s = { ...DEFAULTS, ...store.get(SETTINGS_KEY, {}) };
  if (!LANGS[s.lang]) s.lang = 'ms';
  s.cols = (Array.isArray(s.cols) ? s.cols : []).filter((id) => categoryById(id)).slice(0, COLS_PER_GAME);
  if (s.cols.length !== COLS_PER_GAME) s.cols = [...DEFAULT_COLS];
  if (![10, 15, 26].includes(s.letters)) s.letters = 26;
  if (![60, 90, 120].includes(s.time)) s.time = 90;
  return s;
}

// ====================================================================== SKRIN TETAPAN
export function startHost(app) {
  const settings = loadSettings();
  const saveSettings = () => store.set(SETTINGS_KEY, settings);

  function segmented(box, options, value, onPick) {
    clear(box);
    for (const [val, label] of options) {
      box.append(el('button', { type: 'button', class: 'seg' + (val === value ? ' on' : ''), onclick: () => onPick(val) }, label));
    }
  }

  function render() {
    show('scr-h-setup');
    segmented($('#set-lang'), Object.entries(LANGS).map(([k, v]) => [k, v.label]), settings.lang, (v) => { settings.lang = v; saveSettings(); render(); });
    segmented($('#set-letters'), [[10, '10 huruf'], [15, '15 huruf'], [26, 'Semua (26)']], settings.letters, (v) => { settings.letters = v; saveSettings(); render(); });
    segmented($('#set-time'), [[60, '60 saat'], [90, '90 saat'], [120, '120 saat']], settings.time, (v) => { settings.time = v; saveSettings(); render(); });

    const box = clear($('#set-cols'));
    for (const c of CATEGORIES) {
      const on = settings.cols.includes(c.id);
      const idx = settings.cols.indexOf(c.id);
      box.append(el('button', {
        type: 'button', class: 'cat-chip' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false',
        onclick: () => {
          if (on) settings.cols = settings.cols.filter((x) => x !== c.id);
          else if (settings.cols.length >= COLS_PER_GAME) { toast(`Maksimum ${COLS_PER_GAME} kolum. Buang satu dahulu.`, 'bad'); return; }
          else settings.cols.push(c.id);
          saveSettings();
          render();
        },
      }, on ? el('span', { class: 'num' }, String(idx + 1)) : el('span', { class: 'ico' }, c.icon), settings.lang === 'en' ? c.en : c.ms,
      c.mode === 'loose' ? el('small', null, 'bebas') : null));
    }
    const n = settings.cols.length;
    $('#cols-count').textContent = `${n}/${COLS_PER_GAME} dipilih`;
    $('#cols-count').classList.toggle('ok', n === COLS_PER_GAME);
    $('#btn-open-room').disabled = n !== COLS_PER_GAME;
    $('#set-hurry').checked = settings.hurry;
    $('#set-late').checked = settings.late;

    const snap = store.get(SESSION_KEY, null);
    const banner = $('#resume-banner');
    if (snap && Date.now() - snap.savedAt < 3 * 3600 * 1000 && snap.phase !== 'final') {
      banner.hidden = false;
      $('#resume-text').textContent = `Bilik PIN ${snap.pin} (${snap.players.length} pemain) tergendala. Sambung semula?`;
      $('#resume-yes').onclick = () => launch(snap.settings, snap);
      $('#resume-no').onclick = () => { store.del(SESSION_KEY); render(); };
    } else banner.hidden = true;
  }

  $('#set-hurry').onchange = (e) => { settings.hurry = e.target.checked; saveSettings(); };
  $('#set-late').onchange = (e) => { settings.late = e.target.checked; saveSettings(); };
  $('#setup-back').onclick = () => app.home();
  $('#btn-open-room').onclick = () => {
    if (settings.cols.length !== COLS_PER_GAME) { toast(`Pilih tepat ${COLS_PER_GAME} kolum.`, 'bad'); return; }
    launch({ ...settings, cols: [...settings.cols] });
  };

  async function launch(gameSettings, snap) {
    show('scr-loading');
    $('#loading-text').textContent = snap ? 'Menyambung semula bilik...' : 'Menyediakan bilik...';
    $('#loading-sub').textContent = 'Menyambung ke rangkaian PeerJS';
    const [checker] = await Promise.all([loadChecker(gameSettings.lang, gameSettings.cols), app.load3D()]);
    let pin = snap ? snap.pin : randomPin();
    let link = null;
    for (let attempt = 0; attempt < (snap ? 25 : 6); attempt++) {
      const candidate = new HostLink(pin, {});
      try {
        await candidate.open();
        link = candidate;
        break;
      } catch (err) {
        if (err && err.type === 'unavailable-id') {
          if (snap) { $('#loading-sub').textContent = 'Menunggu PIN lama dilepaskan...'; await sleep(3000); continue; }
          pin = randomPin();
          continue;
        }
        console.warn(err);
        $('#loading-sub').textContent = 'Gagal menyambung, mencuba lagi...';
        await sleep(2000);
      }
    }
    if (!link) {
      app.error('Tidak dapat membuka bilik', 'Pelayan PeerJS tidak dapat dihubungi. Semak sambungan internet dan cuba lagi.');
      return;
    }
    const game = new HostGame(app, link, pin, gameSettings, checker, snap);
    const hostSess = snap && snap.hostPid ? snap.players.find((p) => p.pid === snap.hostPid) : null;
    await startPlayer(app, pin, {
      makeLink: (handlers) => new LocalLink(link, handlers),
      host: game.api,
      sess: hostSess ? { pid: hostSess.pid, token: hostSess.token, name: hostSess.name, avatar: hostSess.avatar } : null,
    });
    const playerCleanup = app.cleanup;
    app.cleanup = () => {
      try { playerCleanup && playerCleanup(); } catch (e) { /* abaikan */ }
      game.destroy();
    };
  }

  render();
}

function toCSV(rows, rounds) {
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const head = ['Kedudukan', 'Nama', 'Markah', 'Kolum betul', 'Pusingan sempurna', 'Purata masa hantar (saat)'];
  const lines = [head.map(esc).join(',')];
  for (const r of rows) lines.push([r.rank, r.name, r.score, r.correct, r.perfect, r.avg].map(esc).join(','));
  if (rounds && rounds.length) {
    lines.push('');
    lines.push(['Huruf', 'Dipilih oleh', 'Nama', 'Jawapan', 'Mata'].map(esc).join(','));
    for (const rd of rounds) {
      for (const row of rd.rows) lines.push([rd.letter, rd.by, row.name, row.cells.map((c) => `${c.w || '-'}${c.ok ? ' (betul)' : ''}`).join(' | '), row.pts].map(esc).join(','));
    }
  }
  return '﻿' + lines.join('\n');
}

// ====================================================================== ENJIN PERMAINAN
class HostGame {
  constructor(app, link, pin, settings, checker, snap) {
    this.app = app;
    this.link = link;
    this.pin = pin;
    this.settings = settings;
    this.checker = checker;
    this.info = checker.letterInfo();
    this.players = new Map();
    this.byConn = new Map();
    this.banned = new Set();
    this.locked = false;
    this.phase = 'lobby';
    this.round = 0;
    this.used = [];
    this.order = [];
    this.turn = 0;
    this.letter = null;
    this.active = null;
    this.pickerPid = null;
    this.pickBy = null;
    this.answers = new Map();
    this.rounds = [];
    this.timers = [];
    this.closeTimer = null;
    this.joinSeq = 0;
    this.hostPid = null;
    this.lastEmote = new Map();
    if (snap) this.restore(snap);

    link.h.onConnect = () => {};
    link.h.onData = (c, m) => this.onData(c, m);
    link.h.onClose = (c) => this.onClose(c);
    link.h.onStatus = (s) => { this.netStatus = s; this.broadcast({ t: 'net', status: s }); };

    this.onBeforeUnload = (e) => {
      if (this.phase !== 'final' && this.players.size > 1) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', this.onBeforeUnload);
    document.body.dataset.awake = '1';
    keepAwake(true);

    // API untuk UI pemain di peranti hos (butang Mula, Teruskan, Main lagi, dll.)
    this.api = {
      pin,
      joinURL: () => joinURL(pin),
      start: () => this.startGame(),
      next: () => { if (this.phase === 'result') this.afterResult(); },
      kick: (pid) => this.kick(pid),
      toggleLock: () => { this.locked = !this.locked; this.pushRoster(); return this.locked; },
      isLocked: () => this.locked,
      again: () => this.playAgain(),
      csv: () => download(`jomhuruf-${this.pin}-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(this.resultRows(), this.rounds), 'text/csv'),
    };

    if (this.phase === 'resume') this.later(() => this.nextPick(), 6000);
    this.save();
  }

  destroy() {
    this.clearLater();
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    this.broadcast({ t: 'ended' }, (c) => !c.local);
    setTimeout(() => this.link.close(), 300);
    keepAwake(false);
  }

  later(fn, ms) {
    const t = setTimeout(fn, ms);
    this.timers.push(t);
    return t;
  }

  clearLater() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    clearTimeout(this.closeTimer);
  }

  // ------------------------------------------------------------ simpan & pulih (jika tab hos ter-refresh)
  save() {
    if (this.phase === 'final') { store.del(SESSION_KEY); return; }
    const players = [...this.players.values()].map((p) => ({
      pid: p.pid, token: p.token, name: p.name, avatar: p.avatar, score: p.score, streak: p.streak, maxStreak: p.maxStreak,
      correctCols: p.correctCols, perfect: p.perfect, totalMs: p.totalMs, submits: p.submits, joinSeq: p.joinSeq, rank: p.rank,
    }));
    store.set(SESSION_KEY, {
      pin: this.pin, settings: this.settings, phase: this.phase, round: this.round, used: this.used, order: this.order, turn: this.turn,
      letter: this.letter, hostPid: this.hostPid, banned: [...this.banned], players, rounds: this.rounds.slice(-30), savedAt: Date.now(),
    });
  }

  restore(snap) {
    for (const p of snap.players) this.players.set(p.pid, { ...p, conn: null, online: false, avatar: sanitizeAvatar(p.avatar), last: null, delta: 0 });
    this.joinSeq = snap.players.reduce((m, p) => Math.max(m, p.joinSeq || 0), 0);
    this.banned = new Set(snap.banned || []);
    this.hostPid = snap.hostPid || null;
    this.order = snap.order || [];
    this.turn = snap.turn || 0;
    this.rounds = snap.rounds || [];
    this.used = (snap.used || []).slice();
    this.round = snap.round || 0;
    if (snap.phase === 'lobby') { this.phase = 'lobby'; return; }
    // Pusingan yang belum dimarkah diulang; huruf yang dipilih dilepaskan semula.
    if (['letter', 'answer'].includes(snap.phase) && snap.letter && this.used[this.used.length - 1] === snap.letter) {
      this.used.pop();
      this.turn = Math.max(0, this.turn - 1);
    }
    if (snap.phase === 'result') this.round += 1;
    if (snap.phase === 'pick') this.turn = Math.max(0, this.turn - 1);
    this.phase = 'resume';
  }

  // ------------------------------------------------------------ rangkaian
  send(p, msg) { if (p && p.conn) this.link.send(p.conn, msg); }

  broadcast(msg, filter) {
    for (const p of this.players.values()) if (p.conn && (!filter || filter(p.conn))) this.link.send(p.conn, msg);
  }

  onlinePlayers() { return [...this.players.values()].filter((p) => p.online); }

  onClose(conn) {
    const pid = this.byConn.get(conn);
    if (!pid) return;
    this.byConn.delete(conn);
    const p = this.players.get(pid);
    if (!p || p.conn !== conn) return;
    p.conn = null;
    p.online = false;
    if (this.phase === 'lobby') {
      this.later(() => {
        if (!p.online && this.phase === 'lobby' && this.players.get(pid) === p && pid !== this.hostPid) {
          this.players.delete(pid);
          this.pushRoster();
          this.save();
        }
      }, 45000);
    }
    if (this.phase === 'pick' && this.pickerPid === pid) this.later(() => { if (this.phase === 'pick' && !p.online) this.autoPick(); }, 1500);
    if (this.phase === 'answer') this.checkAllAnswered();
    this.pushRoster();
  }

  onData(conn, m) {
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'hello') { this.link.send(conn, { t: 'hi', room: this.roomInfo(), phase: this.phase, count: this.players.size }); return; }
    if (m.t === 'join') { this.onJoin(conn, m); return; }
    const pid = this.byConn.get(conn);
    const p = pid && this.players.get(pid);
    if (!p) return;
    switch (m.t) {
      case 'pick': this.onPick(p, m); break;
      case 'ans': this.onAnswer(p, m); break;
      case 'emote': this.onEmote(p, m); break;
      case 'avatar':
        if (this.phase !== 'lobby') return;
        p.avatar = sanitizeAvatar(m.avatar);
        this.send(p, { t: 'avatar-ok', avatar: p.avatar });
        this.pushRoster();
        this.save();
        break;
      case 'leave':
        if (this.phase === 'lobby' && p.pid !== this.hostPid) {
          this.players.delete(p.pid);
          this.byConn.delete(conn);
          this.pushRoster();
          this.save();
        }
        break;
      default:
    }
  }

  roomInfo() {
    const host = this.hostPid && this.players.get(this.hostPid);
    return {
      pin: this.pin,
      lang: this.settings.lang,
      cols: this.settings.cols.map((id) => ({ id, label: colLabel(id, this.settings.lang), icon: (categoryById(id) || {}).icon || '' })),
      letters: this.totalRounds(),
      time: this.settings.time,
      hurry: this.settings.hurry,
      hostName: host ? host.name : '',
    };
  }

  totalRounds() { return Math.min(LETTERS.length, this.settings.letters); }

  onJoin(conn, m) {
    const pid = typeof m.pid === 'string' ? m.pid.slice(0, 40) : '';
    const token = typeof m.token === 'string' ? m.token.slice(0, 60) : '';
    if (!pid || !token) { this.link.send(conn, { t: 'reject', reason: 'token' }); return; }
    if (this.banned.has(pid)) { this.link.send(conn, { t: 'reject', reason: 'banned' }); return; }
    const existing = this.players.get(pid);
    if (existing) {
      if (existing.token !== token) { this.link.send(conn, { t: 'reject', reason: 'token' }); return; }
      if (existing.conn && existing.conn !== conn) { this.byConn.delete(existing.conn); try { existing.conn.close(); } catch (e) { /* abaikan */ } }
      existing.conn = conn;
      existing.online = true;
      this.byConn.set(conn, pid);
      if (conn.local) { existing.isHost = true; this.hostPid = pid; }
      this.welcome(existing);
      this.pushRoster();
      return;
    }
    if (!conn.local) {
      if (this.locked) { this.link.send(conn, { t: 'reject', reason: 'locked' }); return; }
      if (this.phase === 'final' || (this.phase !== 'lobby' && !this.settings.late)) { this.link.send(conn, { t: 'reject', reason: 'started' }); return; }
      if (this.players.size >= MAX_PLAYERS) { this.link.send(conn, { t: 'reject', reason: 'full' }); return; }
    }
    const name = cleanName(m.name);
    if (!name) { this.link.send(conn, { t: 'reject', reason: 'name' }); return; }
    const lower = name.toLowerCase();
    for (const o of this.players.values()) if (o.name.toLowerCase() === lower) { this.link.send(conn, { t: 'reject', reason: 'nametaken' }); return; }
    const p = {
      pid, token, name, avatar: sanitizeAvatar(m.avatar), score: 0, streak: 0, maxStreak: 0, correctCols: 0, perfect: 0, totalMs: 0, submits: 0,
      rank: this.players.size + 1, prevRank: this.players.size + 1, conn, online: true, joinSeq: ++this.joinSeq, last: null, delta: 0, isHost: !!conn.local,
    };
    if (conn.local) this.hostPid = pid;
    this.players.set(pid, p);
    this.byConn.set(conn, pid);
    if (this.phase !== 'lobby' && !this.order.includes(pid)) this.order.push(pid);
    this.welcome(p);
    if (!conn.local) sfx.join();
    this.pushRoster();
    this.save();
  }

  welcome(p) {
    this.send(p, { t: 'welcome', pid: p.pid, token: p.token, name: p.name, avatar: p.avatar, score: p.score, phase: this.phase, room: this.roomInfo(), isHost: p.pid === this.hostPid });
    this.sendRoster(p);
    if (this.phase === 'pick') this.send(p, this.pickMsg());
    else if (this.phase === 'letter') this.send(p, this.letterMsg(Math.max(400, this.letterEnds - now())));
    else if (this.phase === 'answer') this.send(p, this.openMsg(p));
    else if (this.phase === 'result') {
      if (p.last && p.last.r === this.round) this.send(p, { ...p.last, nextIn: Math.max(1000, this.nextAt - now()) });
      if (this.summary) this.send(p, this.summary);
    } else if (this.phase === 'final') this.send(p, this.finalMsg(p));
  }

  // ------------------------------------------------------------ senarai pemain (lobi & sepanjang permainan)
  rosterMsg() {
    const players = [...this.players.values()].sort((a, b) => a.joinSeq - b.joinSeq)
      .map((p) => ({ pid: p.pid, name: p.name, avatar: p.avatar, online: p.online, isHost: p.pid === this.hostPid, score: p.score }));
    return { t: 'roster', players, locked: this.locked };
  }

  sendRoster(p) { this.send(p, this.rosterMsg()); }

  pushRoster() {
    if (this.rosterPending) return;
    this.rosterPending = setTimeout(() => {
      this.rosterPending = null;
      this.broadcast(this.rosterMsg());
    }, 150);
  }

  onEmote(p, m) {
    if (this.phase !== 'lobby') return;
    if (!['jump', 'wave', 'dance', 'spin'].includes(m.e)) return;
    const t = Date.now();
    if (t - (this.lastEmote.get(p.pid) || 0) < 700) return;
    this.lastEmote.set(p.pid, t);
    this.broadcast({ t: 'emote', pid: p.pid, e: m.e }, (c) => c !== p.conn);
  }

  kick(pid) {
    const p = this.players.get(pid);
    if (!p || pid === this.hostPid) return;
    this.banned.add(pid);
    this.send(p, { t: 'kicked' });
    const c = p.conn;
    setTimeout(() => { try { c && c.close(); } catch (e) { /* abaikan */ } }, 400);
    this.players.delete(pid);
    if (c) this.byConn.delete(c);
    this.order = this.order.filter((x) => x !== pid);
    this.pushRoster();
    this.save();
  }

  // ------------------------------------------------------------ aliran permainan
  startGame() {
    if (this.phase !== 'lobby') return;
    if (!this.onlinePlayers().length) { toast('Belum ada pemain.', 'bad'); return; }
    track('games');
    track('users');
    this.round = 0;
    this.used = [];
    this.rounds = [];
    this.turn = 0;
    this.order = [...this.players.values()].sort((a, b) => a.joinSeq - b.joinSeq).map((p) => p.pid);
    this.nextPick();
  }

  choosePicker() {
    const n = this.order.length;
    for (let k = 0; k < n; k++) {
      const idx = (this.turn + k) % n;
      const p = this.players.get(this.order[idx]);
      if (p && p.online) { this.turn = idx + 1; return p; }
    }
    return null;
  }

  pickMsg() {
    const p = this.players.get(this.pickerPid);
    return {
      t: 'pick', r: this.round, n: this.totalRounds(), used: this.used, info: this.info,
      picker: p ? { pid: p.pid, name: p.name, avatar: p.avatar } : null,
      endsIn: Math.max(0, Math.round(this.pickEnds - now())), time: PICK_MS,
    };
  }

  nextPick() {
    this.clearLater();
    if (this.round >= this.totalRounds() || this.used.length >= LETTERS.length) { this.finish(); return; }
    const picker = this.choosePicker();
    if (!picker) { this.later(() => this.nextPick(), 3000); return; }
    this.phase = 'pick';
    this.letter = null;
    this.pickerPid = picker.pid;
    this.pickEnds = now() + PICK_MS;
    this.broadcast(this.pickMsg());
    this.later(() => this.autoPick(), PICK_MS + 300);
    this.save();
  }

  onPick(p, m) {
    if (this.phase !== 'pick' || p.pid !== this.pickerPid || m.r !== this.round) return;
    const L = String(m.l || '').toUpperCase();
    if (!LETTERS.includes(L) || this.used.includes(L)) return;
    this.chooseLetter(L, false);
  }

  autoPick() {
    if (this.phase !== 'pick') return;
    const left = LETTERS.filter((L) => !this.used.includes(L));
    const score = (L) => this.info[L].filter(Boolean).length;
    let pool = [];
    for (const min of [5, 4, 3, 0]) { pool = left.filter((L) => score(L) >= min); if (pool.length) break; }
    this.chooseLetter(pool[Math.floor(Math.random() * pool.length)], true);
  }

  letterMsg(introMs) {
    return { t: 'letter', r: this.round, n: this.totalRounds(), letter: this.letter, active: this.active, by: this.pickBy, auto: this.pickAuto, introMs: Math.round(introMs) };
  }

  chooseLetter(L, auto) {
    this.clearLater();
    const picker = this.players.get(this.pickerPid);
    this.used.push(L);
    this.letter = L;
    this.active = this.info[L].slice();
    this.pickBy = picker ? picker.name : '';
    this.pickAuto = auto;
    this.phase = 'letter';
    this.letterEnds = now() + LETTER_INTRO_MS;
    this.broadcast(this.letterMsg(LETTER_INTRO_MS));
    this.later(() => this.openAnswer(), LETTER_INTRO_MS);
    this.save();
  }

  openMsg(p) {
    const a = this.answers.get(p.pid);
    return {
      t: 'open', r: this.round, n: this.totalRounds(), letter: this.letter, active: this.active, time: this.settings.time,
      endsIn: Math.max(0, Math.round(this.deadline - now())), elapsed: Math.round(now() - this.openAt), submitted: !!a, mine: a ? a.a : null,
      done: this.answers.size, total: this.onlinePlayers().length, hurry: this.hurryBy || null,
    };
  }

  openAnswer() {
    this.phase = 'answer';
    this.answers = new Map();
    this.hurryBy = null;
    this.openAt = now();
    this.deadline = this.openAt + this.settings.time * 1000;
    for (const p of this.players.values()) this.send(p, this.openMsg(p));
    this.scheduleClose();
    this.save();
  }

  scheduleClose() {
    clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => this.closeAnswer(), Math.max(0, this.deadline - now()) + GRACE_MS);
  }

  onAnswer(p, m) {
    if (this.phase !== 'answer' || m.r !== this.round) return;
    if (this.answers.has(p.pid)) { this.send(p, { t: 'ack', r: this.round }); return; }
    const t = now();
    if (t > this.deadline + GRACE_MS) return;
    const T = this.settings.time * 1000;
    const hostMs = t - this.openAt;
    const a = this.settings.cols.map((_, i) => String((Array.isArray(m.a) && m.a[i]) || '').replace(/[\u0000-\u001f<>]/g, '').slice(0, 40));
    let ms = Number(m.ms);
    if (!Number.isFinite(ms)) ms = hostMs;
    // Masa pelanggan diterima tetapi dihadkan oleh masa yang dilihat hos (elak tipu, adil untuk rangkaian lambat).
    ms = Math.min(Math.max(ms, hostMs - 2500, 0), hostMs, T);
    const auto = !!m.auto;
    if (auto) ms = T;
    this.answers.set(p.pid, { a, ms, auto });
    this.send(p, { t: 'ack', r: this.round });
    // Orang pertama yang hantar (bukan auto) memulakan kira detik untuk yang lain.
    if (!auto && this.settings.hurry && !this.hurryBy && this.deadline - t > HURRY_MS) {
      this.hurryBy = p.name;
      this.deadline = t + HURRY_MS;
      this.broadcast({ t: 'hurry', r: this.round, by: p.name, endsIn: HURRY_MS });
      this.scheduleClose();
    }
    this.broadcast({ t: 'progress', r: this.round, done: this.answers.size, total: this.onlinePlayers().length });
    this.checkAllAnswered();
  }

  checkAllAnswered() {
    if (this.phase !== 'answer' || this.endingSoon) return;
    const online = this.onlinePlayers();
    if (online.length && online.every((p) => this.answers.has(p.pid))) {
      this.endingSoon = true;
      this.later(() => { this.endingSoon = false; this.closeAnswer(); }, 600);
    }
  }

  closeAnswer() {
    if (this.phase !== 'answer') return;
    clearTimeout(this.closeTimer);
    this.phase = 'result';
    const T = this.settings.time * 1000;
    const n = this.totalRounds();
    const activeCount = this.active.filter(Boolean).length;
    const players = [...this.players.values()];
    for (const p of players) p.prevRank = p.rank;
    for (const p of players) {
      const a = this.answers.get(p.pid);
      const checks = this.checker.checkRow(this.letter, a ? a.a : [], this.active);
      const okCount = checks.filter((c) => c.ok).length;
      const factor = a ? Math.max(0, 1 - a.ms / T) : 0;
      const base = okCount * 100;
      const speed = Math.round(okCount * 100 * factor);
      const perfect = activeCount > 0 && okCount === activeCount;
      if (perfect) { p.streak += 1; p.perfect += 1; } else p.streak = 0;
      p.maxStreak = Math.max(p.maxStreak || 0, p.streak);
      const allBonus = perfect ? 200 : 0;
      const streakBonus = perfect && p.streak >= 2 ? Math.min(500, (p.streak - 1) * 100) : 0;
      p.delta = base + speed + allBonus + streakBonus;
      p.score += p.delta;
      p.correctCols += okCount;
      if (a && !a.auto) { p.totalMs += a.ms; p.submits += 1; }
      p.last = {
        t: 'result', r: this.round, n, letter: this.letter, active: this.active,
        cells: checks.map((c, i) => ({ w: a ? a.a[i] : '', ok: c.ok, reason: c.reason || null, match: c.match || null })),
        okCount, activeCount, base, speed, allBonus, streakBonus, points: p.delta, streak: p.streak, total: p.score,
        submitted: !!a, auto: !!(a && a.auto), ms: a ? Math.round(a.ms) : null, last: this.round + 1 >= n,
      };
    }
    this.rank();
    const sorted = this.sorted();
    this.nextAt = now() + RESULT_MS;
    for (const p of sorted) {
      const above = sorted[p.rank - 2];
      Object.assign(p.last, { rank: p.rank, of: sorted.length, behind: above && above.score > p.score ? { name: above.name, gap: above.score - p.score } : null });
      this.send(p, { ...p.last, nextIn: RESULT_MS });
    }
    const rows = players.slice().sort((a, b) => b.delta - a.delta || a.joinSeq - b.joinSeq)
      .map((p) => ({ pid: p.pid, name: p.name, pts: p.delta, cells: p.last.cells.map((c) => ({ w: c.w, ok: c.ok })) }));
    this.rounds.push({ letter: this.letter, by: this.pickBy, rows });
    this.summary = { t: 'summary', r: this.round, letter: this.letter, rows, top: this.topList(5) };
    this.broadcast(this.summary);
    this.later(() => this.afterResult(), RESULT_MS);
    this.pushRoster();
    this.save();
  }

  afterResult() {
    if (this.phase !== 'result') return;
    this.clearLater();
    this.round += 1;
    this.nextPick();
  }

  rank() { this.sorted().forEach((p, i) => { p.rank = i + 1; }); }

  sorted() {
    return [...this.players.values()].sort((a, b) => b.score - a.score || b.correctCols - a.correctCols || a.totalMs - b.totalMs || a.joinSeq - b.joinSeq);
  }

  topList(k) { return this.sorted().slice(0, k).map((p) => ({ rank: p.rank, name: p.name, score: p.score, pid: p.pid })); }

  // ------------------------------------------------------------ penamat
  highlights() {
    const list = [...this.players.values()];
    const out = [];
    const fast = list.filter((p) => p.submits > 0).sort((a, b) => a.totalMs / a.submits - b.totalMs / b.submits)[0];
    if (fast) out.push({ label: 'Paling laju hantar', name: fast.name, value: `purata ${(fast.totalMs / fast.submits / 1000).toFixed(1)} saat` });
    const most = list.slice().sort((a, b) => b.correctCols - a.correctCols)[0];
    if (most && most.correctCols > 0) out.push({ label: 'Paling banyak jawapan betul', name: most.name, value: `${most.correctCols} kolum` });
    const streak = list.slice().sort((a, b) => (b.maxStreak || 0) - (a.maxStreak || 0))[0];
    if (streak && streak.maxStreak >= 2) out.push({ label: 'Rentetan sempurna terpanjang', name: streak.name, value: `${streak.maxStreak} huruf berturut-turut` });
    return out;
  }

  finalMsg(p) {
    const top3 = this.sorted().slice(0, 3).map((x) => ({ name: x.name, score: x.score, avatar: x.avatar }));
    return {
      t: 'final', rank: p.rank, of: this.players.size, total: p.score, correctCols: p.correctCols, perfect: p.perfect,
      rounds: this.rounds.length, letters: this.used.slice(), top: this.topList(10), podium: top3, highlights: this.highlights(),
    };
  }

  finish() {
    this.clearLater();
    this.phase = 'final';
    this.rank();
    for (const p of this.players.values()) this.send(p, this.finalMsg(p));
    store.del(SESSION_KEY);
    const hist = store.get(HISTORY_KEY, []);
    hist.push({ date: new Date().toISOString(), pin: this.pin, lang: this.settings.lang, cols: this.settings.cols, rows: this.resultRows() });
    store.set(HISTORY_KEY, hist.slice(-20));
  }

  resultRows() {
    return this.sorted().map((p) => ({
      rank: p.rank, name: p.name, score: p.score, correct: p.correctCols, perfect: p.perfect,
      avg: p.submits ? (p.totalMs / p.submits / 1000).toFixed(1) : '-',
    }));
  }

  playAgain() {
    if (this.phase !== 'final') return;
    this.clearLater();
    for (const [pid, p] of this.players) {
      if (!p.online) { this.players.delete(pid); continue; }
      Object.assign(p, { score: 0, streak: 0, maxStreak: 0, correctCols: 0, perfect: 0, totalMs: 0, submits: 0, delta: 0, last: null, rank: 1, prevRank: 1 });
    }
    this.phase = 'lobby';
    this.round = 0;
    this.used = [];
    this.rounds = [];
    this.summary = null;
    for (const p of this.players.values()) this.welcome(p);
    this.pushRoster();
    this.save();
  }
}
