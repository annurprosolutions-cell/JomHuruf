// Kaunter penggunaan tanpa nama: berapa kali dibuka, berapa orang dah cuba, berapa permainan dihoskan.
// Tiada pangkalan data sendiri. Setiap kejadian ialah satu "+1" ke servis kaunter awam percuma (Abacus).
// Tiada nama, PIN, markah atau karakter dihantar. Jika servis gagal, angka disembunyikan dan permainan tidak terjejas.
import { store, fmt } from './ui.js';

const API = 'https://abacus.jasoncameron.dev';
const NS = 'jomhuruf-ruzprompt';
const MIN_SHOW = 0; // sembunyikan satu kaunter selagi nilainya kurang daripada ini (contoh: 10)
const TIMEOUT_MS = 6000;
const VIEW_FLAG = 'jh.stat.view'; // sessionStorage: satu paparan dikira sekali setiap sesi tab
const USER_FLAG = 'jh.stat.user'; // localStorage: satu peranti dikira sekali sebagai "dah cuba"
const OPTOUT = 'jh.nocount'; // localStorage: pemilik tapak boleh matikan kiraan dari pelayarnya

// Tempatan (localhost, rangkaian rumah, fail) tidak dikira dan tidak menyentuh kaunter sebenar.
// Untuk ujian sahaja: tambah ?stats=http://localhost:PORT supaya guna pelayan kaunter tiruan.
function config() {
  const qs = new URLSearchParams(location.search);
  const h = location.hostname;
  const local = location.protocol === 'file:' || h === 'localhost' || h === '[::1]' || h.endsWith('.local') || /^(127|10|192\.168)\./.test(h);
  let api = API;
  let override = false;
  if (local && /^https?:\/\//.test(qs.get('stats') || '')) { api = qs.get('stats').replace(/\/+$/, ''); override = true; }
  if (qs.has('nocount')) { if (qs.get('nocount') === '0') store.del(OPTOUT); else store.set(OPTOUT, 1); }
  const optedOut = !!store.get(OPTOUT, false);
  const bot = !!navigator.webdriver && !override;
  return { api, read: override || !local, count: (override || !local) && !optedOut && !bot };
}

async function call(cfg, action, key) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${cfg.api}/${action}/${NS}/${key}`, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl.signal });
    if (res.status === 404 && action === 'get') return 0; // kunci belum wujud = belum ada kiraan
    if (!res.ok) return null;
    const j = await res.json();
    const v = Number(j && (j.value ?? j.count));
    return Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Kira satu paparan (sekali setiap sesi) dan ambil ketiga-tiga angka. Pulangkan null jika servis tak dapat dicapai.
export async function loadStats() {
  try {
    const cfg = config();
    if (!cfg.read) return null;
    const countView = cfg.count && !store.sget(VIEW_FLAG, false);
    const [hit, users, games] = await Promise.all([
      call(cfg, countView ? 'hit' : 'get', 'views'),
      call(cfg, 'get', 'users'),
      call(cfg, 'get', 'games'),
    ]);
    let views = hit;
    if (countView && hit !== null) store.sset(VIEW_FLAG, true);
    else if (countView) views = await call(cfg, 'get', 'views');
    return views === null ? null : { views, users, games };
  } catch (e) {
    return null;
  }
}

let userInflight = false;
// 'users': dikira sekali seumur peranti (bila pemain masuk bilik atau hos mula permainan).
// 'games': dikira setiap kali hos menekan Mula.
export async function track(kind) {
  try {
    const cfg = config();
    if (!cfg.count) return;
    if (kind === 'users') {
      if (userInflight || store.get(USER_FLAG, false)) return;
      userInflight = true;
      try { if ((await call(cfg, 'hit', 'users')) !== null) store.set(USER_FLAG, 1); } finally { userInflight = false; }
    } else if (kind === 'games') {
      await call(cfg, 'hit', 'games');
    }
  } catch (e) { /* abaikan: kaunter tidak boleh mengganggu permainan */ }
}

function countUp(node, to) {
  const calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (calm || to < 2) { node.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / 700);
    node.textContent = fmt(to * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Isi elemen [data-stat="views|users|games"] dalam root. Kaunter yang tiada data atau di bawah MIN_SHOW disembunyikan.
export function renderStats(root, stats) {
  if (!root || !stats) return;
  let any = false;
  for (const box of root.querySelectorAll('[data-stat]')) {
    const v = stats[box.dataset.stat];
    const ok = typeof v === 'number' && v >= MIN_SHOW;
    box.hidden = !ok;
    if (!ok) continue;
    any = true;
    countUp(box.querySelector('b'), v);
  }
  root.hidden = !any;
}
