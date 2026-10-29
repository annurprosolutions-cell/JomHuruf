// Pembantu DOM, bunyi, konfeti, kod QR dan storan tempatan.
/* global qrcode */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// el('div', {class: 'x', onclick: fn}, 'teks', anakLain) - teks sentiasa dimasukkan sebagai textContent (selamat).
export function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(n.dataset, v);
      else if (v === true) n.setAttribute(k, '');
      else n.setAttribute(k, v);
    }
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

let currentScreen = null;
export function show(id) {
  for (const s of $$('.screen')) s.hidden = s.id !== id;
  currentScreen = id;
  document.body.dataset.screen = id;
  window.scrollTo(0, 0);
}
export function screen() { return currentScreen; }

export function toast(msg, kind = 'info', ms = 2600) {
  let box = $('#toasts');
  if (!box) { box = el('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
  const t = el('div', { class: `toast toast-${kind}` }, msg);
  box.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

export const fmt = (n) => Math.round(n || 0).toLocaleString('ms-MY');

// ------------------------------------------------------------------ storan tempatan
export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  },
  del(key) {
    try { localStorage.removeItem(key); } catch (e) { /* abaikan */ }
  },
  sget(key, fallback) {
    try {
      const v = sessionStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  },
  sset(key, value) {
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* abaikan */ }
  },
};

export function randomId(len = 16) {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
}

// ------------------------------------------------------------------ potret fallback (tanpa 3D)
const FALLBACK_COLORS = ['#e21b3c', '#1368ce', '#d89e00', '#26890c', '#864cbf', '#0aa3a3', '#e05a00'];
export function initialsAvatar(name, avatar) {
  const c = el('div', { class: 'avatar-fallback' }, (String(name || '?').trim()[0] || '?').toUpperCase());
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  c.style.background = avatar && avatar.outfitColor ? avatar.outfitColor : FALLBACK_COLORS[h % FALLBACK_COLORS.length];
  return c;
}

// ------------------------------------------------------------------ QR
export function qrSVG(text) {
  if (typeof qrcode !== 'function') return null;
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const wrap = el('div', { class: 'qr' });
  wrap.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  return wrap;
}

// ------------------------------------------------------------------ kunci skrin (supaya skrin tak gelap)
let wakeLock = null;
export async function keepAwake(on = true) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch (e) { /* tidak disokong / ditolak */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && document.body.dataset.awake === '1') keepAwake(true);
});

export function download(name, content, type = 'text/plain') {
  const blob = new Blob([content], { type });
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// ------------------------------------------------------------------ bunyi (WebAudio, tanpa fail audio)
let actx = null;
let muted = store.get('jh.muted', false);
function ctx() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    actx = new AC();
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
function tone(freq, start, dur, type = 'sine', vol = 0.18, slideTo) {
  const c = ctx();
  if (!c) return;
  const t0 = c.currentTime + start;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}
function noise(start, dur, vol = 0.12) {
  const c = ctx();
  if (!c) return;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = c.createBufferSource();
  s.buffer = buf;
  const g = c.createGain();
  g.gain.value = vol;
  const f = c.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = 900;
  s.connect(f).connect(g).connect(c.destination);
  s.start(c.currentTime + start);
}
export const sfx = {
  get muted() { return muted; },
  setMuted(m) { muted = !!m; store.set('jh.muted', muted); },
  unlock() { if (!muted) ctx(); },
  join() { if (!muted) { tone(660, 0, 0.12, 'sine', 0.12, 990); } },
  tick() { if (!muted) tone(1200, 0, 0.05, 'square', 0.05); },
  start() { if (!muted) { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.07, 0.22, 'triangle', 0.12)); } },
  timeup() { if (!muted) { tone(220, 0, 0.6, 'sine', 0.22, 110); tone(330, 0, 0.4, 'triangle', 0.08, 165); } },
  correct() { if (!muted) { tone(880, 0, 0.14, 'triangle', 0.16); tone(1318, 0.11, 0.3, 'triangle', 0.16); } },
  wrong() { if (!muted) { tone(196, 0, 0.32, 'sawtooth', 0.07, 130); } },
  sent() { if (!muted) tone(520, 0, 0.08, 'sine', 0.1, 700); },
  drum(seconds = 2) { if (!muted) { for (let t = 0; t < seconds; t += 0.06) noise(t, 0.05, 0.05 + (t / seconds) * 0.08); } },
  fanfare() { if (!muted) { [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.36], [784, 0.5], [1047, 0.62]].forEach(([f, t]) => tone(f, t, 0.3, 'triangle', 0.14)); } },
  pop() { if (!muted) tone(400 + Math.random() * 300, 0, 0.09, 'sine', 0.1, 900); },
};

// ------------------------------------------------------------------ konfeti 2D (ringan, untuk telefon)
export function confetti(duration = 2200) {
  const c = el('canvas', { class: 'confetti-canvas' });
  document.body.append(c);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = innerWidth * dpr; c.height = innerHeight * dpr;
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const colors = ['#ff5a7a', '#ffd23f', '#3ec7ff', '#7cf08d', '#b58cff', '#ffffff'];
  const parts = Array.from({ length: 140 }, () => ({
    x: Math.random() * innerWidth, y: -20 - Math.random() * innerHeight * 0.5,
    vx: (Math.random() - 0.5) * 2.4, vy: 2 + Math.random() * 3.5, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
    w: 6 + Math.random() * 6, h: 4 + Math.random() * 4, col: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  function frame(t) {
    const el2 = t - t0;
    g.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vy += 0.03;
      g.save(); g.translate(p.x, p.y); g.rotate(p.r);
      g.globalAlpha = Math.max(0, 1 - Math.max(0, el2 - duration + 600) / 600);
      g.fillStyle = p.col; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      g.restore();
    }
    if (el2 < duration) requestAnimationFrame(frame); else c.remove();
  }
  requestAnimationFrame(frame);
}

export function ordinal(n) {
  return n === 1 ? 'pertama' : n === 2 ? 'kedua' : n === 3 ? 'ketiga' : `ke-${n}`;
}

// Tapis nama (ringkas): buang aksara kawalan, had panjang, kata kesat asas.
const BAD_WORDS = ['babi', 'bodoh', 'sial', 'pukimak', 'puki', 'pantat', 'butoh', 'kote', 'lancau', 'bangang', 'fuck', 'shit', 'bitch', 'anjing', 'celaka', 'keparat', 'haram jadah', 'bahlul'];
export function cleanName(raw) {
  let n = String(raw || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  const low = n.toLowerCase().replace(/[^a-z ]/g, ' ');
  const tokens = low.split(/\s+/).filter(Boolean);
  const joined = tokens.join(' ');
  const bad = BAD_WORDS.some((w) => (w.includes(' ') ? joined.includes(w) : tokens.some((t) => t === w || (w.length >= 5 && t.includes(w)))));
  return bad ? '' : n;
}
