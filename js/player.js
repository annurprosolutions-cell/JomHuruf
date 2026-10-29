// Aliran pemain (semua orang, termasuk hos): sambung -> karakter -> lobi -> pilih huruf -> jawab -> keputusan -> akhir.
// Pemain di peranti hos guna saluran dalaman (opts.makeLink) dan dapat butang kawalan hos (opts.host).
import { $, $$, el, clear, show, toast, sfx, store, randomId, confetti, keepAwake, fmt, ordinal, cleanName, qrSVG } from './ui.js';
import { ClientLink } from './net.js';
import { sanitizeAvatar, randomAvatar, DEFAULT_AVATAR } from './avatar-config.js';
import { mountCreator } from './creator.js';
import { REASONS } from './validate.js';
import { LANGS } from './categories.js';
import { track } from './stats.js';

const CROWD_MAX = 16; // had karakter 3D di lobi (telefon)

function buzz(pattern) {
  try {
    const ua = navigator.userActivation;
    if (navigator.vibrate && (!ua || ua.hasBeenActive)) navigator.vibrate(pattern);
  } catch (e) { /* abaikan */ }
}

function shareURL(pin) {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('pin', pin);
  const qs = new URLSearchParams(location.search);
  if (qs.get('peer')) u.searchParams.set('peer', qs.get('peer'));
  return u.toString();
}

// Huruf pertama selepas buang aksen/simbol, untuk amaran segera di kotak jawapan.
const firstLetter = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')[0] || '';

export async function startPlayer(app, pin, opts = {}) {
  const host = opts.host || null;
  show('scr-loading');
  $('#loading-text').textContent = host ? 'Menyediakan bilik...' : 'Mencari bilik...';
  $('#loading-sub').textContent = `PIN ${pin}`;
  await app.load3D();

  const profile = store.get('jh.profile', null) || { name: '', avatar: randomAvatar() };
  const sessKey = 'jh.sess.' + pin;
  let sess = opts.sess || store.sget(sessKey, null); // {pid, token, name, avatar} untuk sambung semula
  let joined = false;
  let phase = 'connecting';
  let creatorOpen = false;
  let room = null;
  let roster = [];
  let locked = false;
  let score = 0;
  let summary = null;
  let lastResult = null;
  const cur = { r: -1, n: 0, letter: '', active: [], time: 90, openAt: 0, endsAt: 0, submitted: false, mine: null, drafts: {}, hurry: null };
  let tickInt = null;
  let ackTimer = null;
  let lastEmote = 0;
  const timers = [];

  const me = () => ({ name: (sess && sess.name) || profile.name, avatar: (sess && sess.avatar) || profile.avatar });
  const myPid = () => (sess && sess.pid) || '';
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const stopTimers = () => { clearInterval(tickInt); tickInt = null; for (const t of timers.splice(0)) clearTimeout(t); };
  const cols = () => (room ? room.cols : []);

  // ---------------------------------------------------------- 3D bantuan
  const stage = app.getStage();
  function soloInto(id, expr, anim) {
    const box = $('#' + id);
    if (!box) return null;
    if (!stage) {
      if (!box.firstChild) box.append(app.portrait(me().avatar, me().name, 'lg'));
      return null;
    }
    stage.mount(box);
    const av = stage.showSolo(me().avatar, { zoom: 'full', pedestal: true, pedestalColor: 0x2c63b8 });
    av.setBaseExpression(expr || 'normal');
    if (anim) av.play(anim, anim === 'celebrate' || anim === 'dance' ? Infinity : undefined);
    else av.stop();
    stage.onTap = () => { const a = stage.soloAvatar(); if (a) a.play('jump'); };
    return av;
  }
  const no3D = () => { if (stage) stage.unmount(); };

  // ---------------------------------------------------------- rangkaian
  const handlers = {
    onOpen() {
      if (sess && sess.pid) link.send({ t: 'join', pid: sess.pid, token: sess.token, name: sess.name, avatar: sess.avatar });
      else link.send({ t: 'hello' });
    },
    onData: handle,
    onStatus(s) {
      const ov = $('#reconnect');
      if (s === 'connected') { ov.hidden = true; return; }
      if (s === 'connecting') return;
      if (phase === 'final') { ov.hidden = true; return; }
      if (s === 'reconnecting') {
        if (joined || phase !== 'connecting') {
          ov.hidden = false;
          $('#reconnect-text').textContent = 'Menyambung semula...';
          $('#reconnect-sub').textContent = 'Jangan tutup halaman ini. Markah anda selamat.';
        }
        return;
      }
      ov.hidden = true;
      if (s === 'notfound') {
        if (joined) app.error('Permainan tamat', 'Peranti hos sudah menutup bilik atau terputus.');
        else app.home(`Tiada bilik dengan PIN ${pin}. Semak semula PIN.`);
      } else if (s === 'failed') {
        app.error('Tidak dapat bersambung', 'Semak sambungan internet anda dan cuba lagi. Jika guna WiFi sekolah/pejabat, cuba data telefon.');
      }
    },
  };
  const link = opts.makeLink ? opts.makeLink(handlers) : new ClientLink(pin, handlers);
  link.connect();
  document.body.dataset.awake = '1';
  keepAwake(true);

  app.cleanup = () => {
    stopTimers();
    clearTimeout(ackTimer);
    $('#reconnect').hidden = true;
    link.send({ t: 'leave' });
    link.close();
    keepAwake(false);
  };

  function handle(msg) {
    switch (msg.t) {
      case 'hi':
        room = msg.room;
        phase = 'create';
        if (!joined) openCreator();
        break;
      case 'welcome':
        joined = true;
        track('users');
        room = msg.room || room;
        sess = { pid: msg.pid, token: msg.token || (sess && sess.token), name: msg.name, avatar: sanitizeAvatar(msg.avatar) };
        store.sset(sessKey, sess);
        store.set('jh.profile', { name: msg.name, avatar: sess.avatar });
        score = msg.score || 0;
        link.markStable();
        creatorOpen = false;
        if (msg.phase === 'lobby') showLobby();
        else if (msg.phase !== 'final') showHold(msg.phase === 'resume' ? 'Bilik disambung semula. Permainan bersambung sebentar lagi...' : null);
        break;
      case 'reject': onReject(msg); break;
      case 'roster':
        roster = Array.isArray(msg.players) ? msg.players : [];
        locked = !!msg.locked;
        if (phase === 'lobby') renderLobby();
        break;
      case 'emote':
        if (phase === 'lobby' && stage && stage.mode === 'crowd') stage.crowdEmote(msg.pid, msg.e);
        break;
      case 'pick': showPick(msg); break;
      case 'letter': showLetter(msg); break;
      case 'open': showAnswer(msg); break;
      case 'hurry': onHurry(msg); break;
      case 'progress': onProgress(msg); break;
      case 'ack': clearTimeout(ackTimer); break;
      case 'result': showResult(msg); break;
      case 'summary':
        summary = msg;
        if (phase === 'result') renderSummary();
        break;
      case 'final': showFinal(msg); break;
      case 'avatar-ok':
        sess.avatar = sanitizeAvatar(msg.avatar);
        store.sset(sessKey, sess);
        store.set('jh.profile', { name: sess.name, avatar: sess.avatar });
        showLobby();
        break;
      case 'kicked':
        store.sset(sessKey, null);
        joined = false;
        app.error('Anda telah dikeluarkan', 'Hos telah mengeluarkan anda daripada bilik ini.');
        break;
      case 'ended':
        store.sset(sessKey, null);
        if (phase !== 'final') app.error('Bilik ditutup', 'Hos telah menutup bilik ini.');
        else link.close();
        break;
      default:
    }
  }

  function onReject(msg) {
    const reasons = {
      name: 'Nama tidak sesuai. Sila guna nama lain.',
      nametaken: 'Nama ini sudah digunakan. Cuba tambah huruf atau nombor.',
      full: 'Bilik sudah penuh.',
      started: 'Permainan sudah bermula dan hos tidak benarkan masuk lewat.',
      locked: 'Hos telah mengunci bilik.',
      token: 'Sesi lama tidak sah. Sila masuk semula.',
      banned: 'Anda tidak dibenarkan masuk semula ke bilik ini.',
    };
    const text = reasons[msg.reason] || 'Tidak dapat masuk.';
    if (msg.reason === 'token') { store.sset(sessKey, null); sess = null; link.send({ t: 'hello' }); return; }
    if (msg.reason === 'name' || msg.reason === 'nametaken') {
      if (!creatorOpen) openCreator();
      $('#create-error').textContent = text;
      $('#name-input').focus();
      $('#btn-join').disabled = false;
      return;
    }
    app.error('Tidak dapat masuk', text);
  }

  // ---------------------------------------------------------- pencipta karakter
  function openCreator(editing = false) {
    creatorOpen = true;
    show('scr-p-create');
    $('#create-pin').textContent = `PIN ${pin}`;
    $('#create-error').textContent = '';
    const nameIn = $('#name-input');
    nameIn.value = me().name || '';
    nameIn.disabled = editing;
    const joinBtn = $('#btn-join');
    joinBtn.textContent = editing ? 'Simpan karakter' : host ? 'Buka lobi' : 'Masuk bilik';
    joinBtn.disabled = false;
    let draft = sanitizeAvatar(me().avatar || DEFAULT_AVATAR);
    if (stage) {
      stage.mount($('#create-stage'));
      stage.showSolo(draft, { zoom: 'face', pedestalColor: 0x2c63b8 }).stop();
      stage.onTap = () => stage.soloAvatar() && stage.soloAvatar().play('jump');
    } else {
      clear($('#create-stage')).append(el('div', { class: 'empty-lobby' }, 'Pratonton 3D tidak disokong peranti ini, tetapi pilihan anda tetap disimpan.'));
    }
    const creator = mountCreator({
      tabsEl: $('#creator-tabs'),
      bodyEl: $('#creator-body'),
      initial: draft,
      onChange(a) {
        draft = a;
        if (stage) stage.showSolo(a).play('nod');
        store.set('jh.profile', { name: nameIn.value || profile.name, avatar: a });
      },
      onZoom(z) { stage && stage.setZoom(z); },
    });
    $('#btn-random').onclick = () => { creator.setValue(randomAvatar()); stage && stage.soloAvatar() && stage.soloAvatar().play('spin'); };
    joinBtn.onclick = () => {
      sfx.unlock();
      if (editing) {
        link.send({ t: 'avatar', avatar: draft });
        joinBtn.disabled = true;
        setTimeout(() => { joinBtn.disabled = false; }, 3000);
        return;
      }
      const name = cleanName(nameIn.value);
      if (!name) { $('#create-error').textContent = 'Sila masukkan nama yang sesuai (maksimum 16 huruf).'; nameIn.focus(); return; }
      profile.name = name;
      store.set('jh.profile', { name, avatar: draft });
      const pid = (sess && sess.pid) || randomId(12);
      const token = (sess && sess.token) || randomId(20);
      sess = { pid, token, name, avatar: draft };
      store.sset(sessKey, sess);
      joinBtn.disabled = true;
      $('#create-error').textContent = '';
      link.send({ t: 'join', pid, token, name, avatar: draft });
      setTimeout(() => { joinBtn.disabled = false; }, 4000);
    };
    nameIn.onkeydown = (e) => { if (e.key === 'Enter') joinBtn.click(); };
  }

  // ---------------------------------------------------------- lobi
  function showLobby() {
    phase = 'lobby';
    creatorOpen = false;
    stopTimers();
    show('scr-lobby');
    $('#lb-pin').textContent = `PIN ${pin}`;
    $('#lb-pin-big').textContent = pin.replace(/(\d{3})(\d{3})/, '$1 $2');
    const url = shareURL(pin);
    const qrBox = clear($('#lb-qr'));
    const qr = qrSVG(url);
    if (qr) qrBox.append(qr);
    $('#lb-share').onclick = async () => {
      const text = `Jom main JomHuruf! Masuk dengan PIN ${pin}`;
      try {
        if (navigator.share) { await navigator.share({ title: 'JomHuruf', text, url }); return; }
      } catch (e) { if (e && e.name === 'AbortError') return; }
      try { await navigator.clipboard.writeText(`${text}\n${url}`); toast('Pautan disalin. Tampal di WhatsApp atau Telegram.', 'ok', 3500); } catch (e) { prompt('Salin pautan ini:', url); }
    };
    const meta = clear($('#lb-meta'));
    if (room) {
      meta.append(
        el('div', { class: 'meta-line' }, el('span', { class: 'tag' }, LANGS[room.lang] ? LANGS[room.lang].label : room.lang), el('span', null, `${room.letters} huruf • ${room.time} saat setiap huruf`)),
        el('div', { class: 'col-tags' }, room.cols.map((c) => el('span', { class: 'col-tag' }, `${c.icon} ${c.label}`))),
      );
    }
    $('#lb-host').hidden = !host;
    $('#lb-wait').hidden = !!host;
    $('#lb-edit').onclick = () => openCreator(true);
    $('#lb-leave').onclick = () => {
      if (host && roster.length > 1 && !confirm('Tutup bilik? Semua pemain akan dikeluarkan.')) return;
      app.home();
    };
    if (host) {
      $('#lb-start').onclick = () => { sfx.start(); host.start(); };
      $('#lb-lock').onclick = () => {
        const on = host.toggleLock();
        toast(on ? 'Bilik dikunci. Pemain baru tidak boleh masuk.' : 'Bilik dibuka semula.');
      };
    }
    for (const b of $$('[data-emote]')) {
      b.onclick = () => {
        const e = b.dataset.emote;
        if (stage && stage.mode === 'crowd') stage.crowdEmote(myPid(), e);
        const t = Date.now();
        if (t - lastEmote < 900) return;
        lastEmote = t;
        link.send({ t: 'emote', e });
      };
    }
    if (stage) {
      stage.mount($('#lb-stage'));
      stage.showCrowd();
      stage.onTap = null;
    }
    renderLobby();
  }

  function renderLobby() {
    if (phase !== 'lobby') return;
    const online = roster.filter((p) => p.online);
    $('#lb-count').textContent = roster.length;
    $('#lb-hint').textContent = host ? 'Ketik nama untuk keluarkan' : '';
    if (host) {
      $('#lb-start').disabled = online.length < 1;
      $('#lb-start').textContent = online.length <= 1 ? 'Mula (main seorang)' : `Mula (${online.length} pemain)`;
      $('#lb-lock').textContent = locked ? 'Buka kunci bilik' : 'Kunci bilik';
    }
    const list = clear($('#lb-list'));
    for (const p of roster.slice().reverse()) {
      const self = p.pid === myPid();
      const canKick = host && !p.isHost;
      list.append(el(canKick ? 'button' : 'div', {
        class: 'player-chip' + (p.online ? '' : ' offline') + (self ? ' me' : ''), type: canKick ? 'button' : undefined,
        onclick: canKick ? () => { if (confirm(`Keluarkan ${p.name} daripada bilik?`)) host.kick(p.pid); } : undefined,
      }, app.portrait(p.avatar, p.name), el('span', null, p.name + (self ? ' (anda)' : '')),
      p.isHost ? el('span', { class: 'host-tag' }, 'HOS') : null,
      el('span', { class: 'x' }, p.online ? (canKick ? '✕' : '') : 'luar talian')));
    }
    const empty = $('#lb-empty');
    empty.hidden = online.length > 1;
    empty.textContent = host ? 'Kongsi PIN atau QR supaya kawan masuk' : '';
    if (!host) empty.hidden = true;
    if (stage && stage.mode === 'crowd') stage.syncCrowd(online.map((p) => ({ pid: p.pid, name: p.name, avatar: p.avatar })), CROWD_MAX);
  }

  // Permainan sedang berjalan (masuk lewat / sambung semula): tunggu mesej seterusnya.
  function showHold(sub) {
    phase = 'hold';
    stopTimers();
    show('scr-hold');
    $('#hd-pin').textContent = `PIN ${pin}`;
    $('#hd-name').textContent = me().name;
    $('#hd-sub').textContent = sub || 'Permainan sedang berjalan. Anda akan masuk pada pusingan seterusnya...';
    const av = soloInto('hd-stage', 'normal');
    if (av) av.play('wave');
  }

  // ---------------------------------------------------------- pilih huruf
  function runBar(bar, ms) {
    bar.style.transition = 'none';
    bar.style.transform = 'scaleX(1)';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      bar.style.transition = `transform ${Math.max(0.3, ms / 1000)}s linear`;
      bar.style.transform = 'scaleX(0)';
    }));
  }

  function showPick(m) {
    phase = 'pick';
    creatorOpen = false;
    stopTimers();
    no3D();
    show('scr-pick');
    const mine = m.picker && m.picker.pid === myPid();
    $('#pk-round').textContent = `Huruf ${m.r + 1}/${m.n}`;
    const port = clear($('#pk-portrait'));
    if (m.picker) port.append(app.portrait(m.picker.avatar, m.picker.name, 'lg'));
    $('#pk-title').textContent = mine ? 'Giliran anda!' : `${m.picker ? m.picker.name : 'Seseorang'} sedang memilih...`;
    $('#pk-sub').textContent = mine ? 'Pilih satu huruf untuk semua orang jawab.' : 'Huruf yang dipilih akan dijawab oleh semua pemain.';
    document.body.classList.toggle('my-turn', !!mine);
    const grid = clear($('#pk-grid'));
    const nCols = cols().length || 5;
    for (const L of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      const used = m.used.includes(L);
      const count = m.info && m.info[L] ? m.info[L].filter(Boolean).length : nCols;
      const b = el('button', {
        type: 'button', class: 'lt' + (used ? ' used' : '') + (count < nCols ? ' hard' : '') + (count <= 2 ? ' vhard' : ''),
        disabled: used || !mine, 'aria-label': `Huruf ${L}${used ? ', sudah dipilih' : `, ${count} kolum ada jawapan`}`,
        onclick: () => {
          for (const x of $$('#pk-grid .lt')) x.disabled = true;
          b.classList.add('chosen');
          sfx.pop();
          link.send({ t: 'pick', r: m.r, l: L });
        },
      }, el('b', null, L), used ? null : el('small', null, `${count}/${nCols}`));
      grid.append(b);
    }
    if (mine) buzz([40, 50, 40]);
    const endsAt = performance.now() + (m.endsIn || 0);
    runBar($('#pk-bar'), m.endsIn || 0);
    const tick = () => {
      const left = Math.max(0, (endsAt - performance.now()) / 1000);
      $('#pk-time').textContent = `⏱ ${Math.ceil(left)}`;
    };
    tick();
    tickInt = setInterval(tick, 250);
  }

  // ---------------------------------------------------------- huruf dipilih
  function showLetter(m) {
    phase = 'letter';
    stopTimers();
    no3D();
    document.body.classList.remove('my-turn');
    show('scr-letter');
    cur.letter = m.letter;
    cur.active = m.active || [];
    $('#lt-round').textContent = `Huruf ${m.r + 1}/${m.n}`;
    $('#lt-score').textContent = `${fmt(score)} mata`;
    $('#lt-by').textContent = m.auto ? 'Masa tamat, huruf dipilih secara rawak' : `Dipilih oleh ${m.by}`;
    const big = $('#lt-letter');
    big.textContent = m.letter;
    big.classList.remove('pop');
    void big.offsetWidth;
    big.classList.add('pop');
    const tags = clear($('#lt-cols'));
    cols().forEach((c, i) => tags.append(el('span', { class: 'col-tag' + (cur.active[i] ? '' : ' off') }, `${c.icon} ${c.label}${cur.active[i] ? '' : ' (tiada)'}`)));
    runBar($('#lt-bar'), m.introMs || 3000);
    sfx.start();
    buzz(60);
  }

  // ---------------------------------------------------------- jawab
  function startClock(pillSel) {
    clearInterval(tickInt);
    let lastSec = -1;
    const tick = () => {
      const left = Math.max(0, (cur.endsAt - performance.now()) / 1000);
      const sec = Math.ceil(left);
      const pill = $(pillSel);
      if (pill) {
        pill.textContent = `⏱ ${sec}`;
        pill.classList.toggle('low', sec <= 10);
      }
      if (sec !== lastSec && sec <= 5 && sec > 0 && phase === 'answer') sfx.tick();
      lastSec = sec;
      if (left <= 0 && phase === 'answer') submit(true);
    };
    tick();
    tickInt = setInterval(tick, 200);
  }

  function showAnswer(m) {
    stopTimers();
    no3D();
    document.body.classList.remove('my-turn');
    if (cur.r !== m.r) cur.hurry = null;
    Object.assign(cur, { r: m.r, n: m.n, letter: m.letter, active: m.active || [], time: m.time, submitted: !!m.submitted, mine: m.mine || null });
    cur.endsAt = performance.now() + (m.endsIn || 0);
    cur.openAt = performance.now() - (m.elapsed || 0);
    if (m.hurry) cur.hurry = m.hurry;
    if (m.submitted) { showWait(m); return; }
    phase = 'answer';
    show('scr-answer');
    $('#an-round').textContent = `Huruf ${m.r + 1}/${m.n}`;
    $('#an-letter').textContent = m.letter;
    renderHurry('#an-hurry');
    onProgress(m);
    const drafts = cur.drafts[m.r] || (cur.drafts[m.r] = cols().map(() => ''));
    const form = clear($('#an-form'));
    const inputs = [];
    cols().forEach((c, i) => {
      const active = cur.active[i] !== false;
      const warn = el('span', { class: 'ans-warn' });
      const input = el('input', {
        class: 'ans-input', type: 'text', maxlength: '40', value: drafts[i] || '', disabled: !active,
        placeholder: active ? `${c.label} bermula dengan ${m.letter}...` : `Tiada jawapan untuk huruf ${m.letter}`,
        autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'next', 'aria-label': c.label,
      });
      const check = () => {
        drafts[i] = input.value;
        const f = firstLetter(input.value);
        const bad = !!f && f !== m.letter.toLowerCase();
        input.classList.toggle('warn', bad);
        warn.textContent = bad ? `Mesti bermula dengan huruf ${m.letter}` : '';
        updateSubmit();
      };
      input.addEventListener('input', check);
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const next = inputs.slice(i + 1).find((x) => !x.disabled);
        if (next) next.focus(); else submit(false);
      });
      inputs.push(input);
      form.append(el('label', { class: 'ans-row' + (active ? '' : ' inactive') },
        el('span', { class: 'ans-lbl' }, el('span', { class: 'ico' }, c.icon), c.label), input, warn));
      if (input.value) setTimeout(check, 0);
    });
    const lastActive = inputs.filter((x) => !x.disabled).pop();
    if (lastActive) lastActive.setAttribute('enterkeyhint', 'send');
    form.onsubmit = (e) => { e.preventDefault(); submit(false); };
    function updateSubmit() {
      const filled = inputs.filter((x) => !x.disabled && x.value.trim()).length;
      const total = inputs.filter((x) => !x.disabled).length;
      $('#an-submit').textContent = `Hantar (${filled}/${total})`;
    }
    updateSubmit();
    $('#an-submit').onclick = () => submit(false);
    $('#an-submit').disabled = false;
    const first = inputs.find((x) => !x.disabled && !x.value);
    if (first) setTimeout(() => first.focus({ preventScroll: true }), 60);
    startClock('#an-time');
    buzz(30);
  }

  function submit(auto) {
    if (phase !== 'answer' || cur.submitted) return;
    cur.submitted = true;
    const a = cols().map((_, i) => String((cur.drafts[cur.r] || [])[i] || '').trim());
    cur.mine = a;
    const ms = Math.round(performance.now() - cur.openAt);
    const r = cur.r;
    const send = () => link.send({ t: 'ans', r, a, ms, auto });
    send();
    clearTimeout(ackTimer);
    let tries = 0;
    const retry = () => { if (tries++ < 4) { send(); ackTimer = setTimeout(retry, 2500); } };
    ackTimer = setTimeout(retry, 2500);
    if (auto) sfx.timeup(); else sfx.sent();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    showWait();
  }

  function showWait(m) {
    phase = 'answered';
    show('scr-wait');
    $('#wt-round').textContent = `Huruf ${cur.r + 1}/${cur.n} • ${cur.letter}`;
    if (m) onProgress(m);
    renderHurry('#wt-hurry');
    const echo = clear($('#wt-echo'));
    cols().forEach((c, i) => {
      const w = cur.mine ? cur.mine[i] : '';
      echo.append(el('div', { class: 'echo-row' + (cur.active[i] === false ? ' off' : '') }, el('span', null, `${c.icon} ${c.label}`), el('b', null, w || '—')));
    });
    startClock('#wt-time');
    const av = soloInto('wt-stage', 'normal');
    if (av) av.play('nod');
  }

  function renderHurry(sel) {
    const box = $(sel);
    if (!box) return;
    box.hidden = !cur.hurry;
    if (cur.hurry) box.textContent = cur.hurry === me().name ? '⚡ Anda yang pertama hantar! Yang lain kena cepat' : `⚡ ${cur.hurry} dah hantar! Kira detik bermula`;
  }

  function onHurry(m) {
    if (m.r !== cur.r) return;
    cur.hurry = m.by;
    cur.endsAt = Math.min(cur.endsAt, performance.now() + m.endsIn);
    renderHurry('#an-hurry');
    renderHurry('#wt-hurry');
    if (phase === 'answer') buzz([30, 40, 30]);
  }

  function onProgress(m) {
    if (typeof m.done !== 'number') return;
    const text = `${m.done}/${m.total} pemain dah hantar`;
    $('#an-progress').textContent = text;
    $('#wt-progress').textContent = text;
  }

  // ---------------------------------------------------------- keputusan pusingan
  function showResult(m) {
    phase = 'result';
    stopTimers();
    clearTimeout(ackTimer);
    lastResult = m;
    score = m.total;
    const scr = $('#scr-result');
    const perfect = m.activeCount > 0 && m.okCount === m.activeCount;
    scr.classList.remove('ok', 'bad', 'mid', 'late');
    scr.classList.add(!m.submitted ? 'late' : perfect ? 'ok' : m.okCount === 0 ? 'bad' : 'mid');
    show('scr-result');
    $('#rs-round').textContent = `Huruf ${m.r + 1}/${m.n} • ${m.letter}`;
    $('#rs-name').textContent = me().name;
    $('#rs-title').textContent = !m.submitted ? 'Tiada jawapan' : perfect ? `Sempurna! ${m.okCount}/${m.activeCount}` : `${m.okCount}/${m.activeCount} betul`;
    $('#rs-points').textContent = `+ ${fmt(m.points)}`;
    $('#rs-streak').textContent = m.streak >= 2 ? `🔥 ${m.streak} huruf sempurna berturut-turut` : m.auto ? 'Masa tamat, jawapan dihantar automatik' : '';
    const cells = clear($('#rs-cells'));
    cols().forEach((c, i) => {
      const x = m.cells[i] || {};
      const note = x.ok ? (x.match ? `✓ diterima sebagai "${x.match}"` : '✓') : `✗ ${REASONS[x.reason] || ''}`;
      cells.append(el('div', { class: 'cell-row ' + (x.ok ? 'ok' : x.reason === 'inactive' ? 'off' : 'no') },
        el('span', { class: 'c-lbl' }, `${c.icon} ${c.label}`), el('b', { class: 'c-word' }, x.w || '—'), el('span', { class: 'c-note' }, note)));
    });
    const parts = [`Betul ${fmt(m.base)}`];
    if (m.speed) parts.push(`Kelajuan +${fmt(m.speed)}`);
    if (m.allBonus) parts.push(`Bonus penuh +${fmt(m.allBonus)}`);
    if (m.streakBonus) parts.push(`Rentetan +${fmt(m.streakBonus)}`);
    $('#rs-detail').textContent = parts.join(' • ');
    const behind = m.behind ? ` • ${fmt(m.behind.gap)} mata di belakang ${m.behind.name}` : '';
    $('#rs-rank').textContent = `Tempat ${ordinal(m.rank)} daripada ${m.of} • ${fmt(m.total)} mata${behind}`;
    if (summary && summary.r === m.r) renderSummary(); else { clear($('#rs-board')); clear($('#rs-all')); }
    const nextAt = performance.now() + (m.nextIn || 12000);
    const tick = () => {
      const s = Math.max(0, Math.ceil((nextAt - performance.now()) / 1000));
      $('#rs-next').textContent = m.last ? `Keputusan akhir dalam ${s}s` : `Huruf seterusnya dalam ${s}s`;
    };
    tick();
    tickInt = setInterval(tick, 500);
    const cont = $('#rs-continue');
    cont.hidden = !host;
    cont.textContent = m.last ? 'Lihat pemenang' : 'Teruskan';
    if (host) cont.onclick = () => host.next();
    if (perfect) { sfx.correct(); confetti(1600); soloInto('rs-stage', 'happy', 'celebrate'); }
    else if (m.okCount > 0) { sfx.correct(); soloInto('rs-stage', 'happy', 'nod'); }
    else { sfx.wrong(); soloInto('rs-stage', 'sad', 'sad'); }
    buzz(perfect ? [40, 60, 40] : 120);
  }

  function renderMiniBoard(top, box) {
    if (!box || !Array.isArray(top)) return;
    clear(box);
    for (const r of top) box.append(el('div', { class: 'row' + (r.pid === myPid() ? ' me' : '') }, el('span', null, `${r.rank}. ${r.name}`), el('span', null, fmt(r.score))));
  }

  function renderSummary() {
    if (!summary || !lastResult || summary.r !== lastResult.r) return;
    renderMiniBoard(summary.top, $('#rs-board'));
    const box = clear($('#rs-all'));
    for (const row of summary.rows) {
      box.append(el('div', { class: 'all-row' + (row.pid === myPid() ? ' me' : '') },
        el('div', { class: 'all-head' }, el('b', null, row.name), el('span', null, `+${fmt(row.pts)}`)),
        el('div', { class: 'all-cells' }, row.cells.map((c) => el('span', { class: 'chip-w ' + (c.ok ? 'ok' : 'no') }, c.w || '—')))));
    }
  }

  // ---------------------------------------------------------- akhir
  function showFinal(m) {
    phase = 'final';
    stopTimers();
    store.sset(sessKey, null);
    show('scr-final');
    $('#fn-pin').textContent = `PIN ${pin}`;
    $('#fn-name').textContent = me().name;
    const medal = m.rank === 1 ? '🥇' : m.rank === 2 ? '🥈' : m.rank === 3 ? '🥉' : '';
    $('#fn-title').textContent = m.rank <= 3 ? `${medal} Tempat ${ordinal(m.rank)}!` : `Tempat ${ordinal(m.rank)} daripada ${m.of}`;
    $('#fn-score').textContent = `${fmt(m.total)} mata • ${m.correctCols} jawapan betul`;
    renderMiniBoard(m.top, $('#fn-board'));
    const hl = clear($('#fn-highlights'));
    for (const h of m.highlights || []) hl.append(el('div', { class: 'hl' }, el('span', { class: 'muted' }, h.label), el('b', null, h.name), el('span', { class: 'small' }, h.value)));
    const tags = clear($('#fn-tags'));
    const top3 = m.podium || [];
    if (stage) {
      stage.mount($('#fn-stage'));
      stage.showPodium(top3);
      const reveal = (rank) => {
        const p = top3[rank - 1];
        if (!p) return;
        stage.revealPodium(rank);
        const tag = el('div', { class: 'podium-tag' }, el('div', { class: 'nm' }, p.name), el('div', { class: 'sc' }, `${fmt(p.score)}`));
        tags.append(tag);
        stage.attachTag(tag, rank);
        if (rank === 1) sfx.fanfare(); else sfx.pop();
      };
      later(() => reveal(3), 700);
      later(() => reveal(2), 1900);
      later(() => sfx.drum(1.4), 2600);
      later(() => reveal(1), 4100);
    } else {
      const box = clear($('#fn-stage'));
      box.append(el('div', { class: 'podium-flat' }, [2, 1, 3].map((r) => {
        const p = top3[r - 1];
        return p ? el('div', { class: `pf pf${r}` }, app.portrait(p.avatar, p.name, 'lg'), el('b', null, p.name), el('div', { class: 'blk' }, String(r))) : null;
      })));
    }
    if (m.rank <= 3) later(() => confetti(3000), 4100);
    $('#fn-csv').hidden = !host;
    $('#fn-again').hidden = !host;
    $('#fn-home').textContent = host ? 'Tutup bilik' : 'Laman utama';
    if (host) {
      $('#fn-csv').onclick = () => host.csv();
      $('#fn-again').onclick = () => host.again();
    }
    $('#fn-home').onclick = () => app.home();
  }
}
