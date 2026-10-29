// Semakan jawapan automatik. Dijalankan di peranti hos sahaja (hos ialah hakim).
// Kolum 'list'  : mesti ada dalam senarai (toleransi salah eja kecil + perkataan kepala).
// Kolum 'loose' : Nama/Benda - huruf betul, panjang minimum, bukan merapu, bukan kata kesat.
import { categoryById, LETTERS } from './categories.js';

export const REASONS = {
  empty: 'Kosong',
  letter: 'Huruf pertama salah',
  invalid: 'Tiada dalam senarai',
  gibberish: 'Nampak macam merapu',
  bad: 'Perkataan tidak sesuai',
  short: 'Terlalu pendek',
  dup: 'Sama dengan kolum lain',
  inactive: 'Tiada jawapan untuk huruf ini',
};

const MAX_LEN = 40;
const BAD_WORDS = ['bodoh', 'sial', 'pukimak', 'puki', 'pantat', 'butoh', 'kote', 'lancau', 'bangang', 'celaka', 'keparat', 'bahlul', 'babi', 'anjing', 'sundal', 'jalang', 'lahanat', 'bangsat', 'kimak', 'cibai', 'pundek', 'haram jadah', 'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'dick', 'pussy'];

// "Rama-Rama!" -> "rama rama". Buang aksen, simbol dan ruang berlebihan.
export function normalize(raw) {
  return String(raw || '')
    .slice(0, MAX_LEN * 2)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, MAX_LEN);
}

const compact = (s) => s.replace(/ /g, '');

function splitList(text) {
  return String(text || '').split(',').map(normalize).filter(Boolean);
}

// Jarak suntingan (Damerau-Levenshtein ringkas) dengan had awal supaya laju.
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2 = new Array(b.length + 1);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j];
    prev = cur;
  }
  return prev[b.length];
}

const fuzzyAllowance = (len) => (len <= 3 ? 0 : len <= 6 ? 1 : 2);

function looksGibberish(norm) {
  const c = compact(norm);
  if (!/[a-z]/.test(c)) return true;
  if (/(.)\1\1/.test(c)) return true;
  for (const w of norm.split(' ')) {
    if (w.length >= 4 && /^[a-z]+$/.test(w) && !/[aeiouy]/.test(w)) return true;
  }
  if (c.length >= 6 && new Set(c).size <= 2) return true; // "ababab" (tetapi "dada", "nana" sah)
  return false;
}

function isBad(norm) {
  const tokens = norm.split(' ');
  return BAD_WORDS.some((w) => (w.includes(' ') ? norm.includes(w) : tokens.some((t) => t === w || (w.length >= 5 && t.includes(w)))));
}

function englishSingulars(w) {
  const out = [];
  if (w.endsWith('ies') && w.length > 4) out.push(w.slice(0, -3) + 'y');
  if (w.endsWith('es') && w.length > 3) out.push(w.slice(0, -2));
  if (w.endsWith('s') && w.length > 3) out.push(w.slice(0, -1));
  return out;
}

class ListIndex {
  constructor(words, heads) {
    this.full = new Map(); // compact -> bentuk asal
    this.byLetter = new Map(); // huruf -> [compact]
    for (const w of words) {
      const c = compact(w);
      if (!c || this.full.has(c)) continue;
      this.full.set(c, w);
      const l = c[0];
      if (!this.byLetter.has(l)) this.byLetter.set(l, []);
      this.byLetter.get(l).push(c);
    }
    this.heads = new Set((heads || []).map(normalize));
  }

  count(letter) {
    return (this.byLetter.get(letter) || []).length;
  }

  // Pulangkan perkataan senarai yang sepadan, atau null.
  find(norm, lang) {
    const c = compact(norm);
    if (this.full.has(c)) return { word: this.full.get(c), fuzzy: false };
    if (lang === 'en') {
      for (const s of englishSingulars(c)) if (this.full.has(s)) return { word: this.full.get(s), fuzzy: false };
    }
    const words = norm.split(' ');
    if (words.length >= 2 && this.heads.has(words[0])) {
      const rest = words.slice(1);
      if (rest.every((w) => w.length >= 2 && /[a-z]/.test(w)) && !looksGibberish(rest.join(' '))) return { word: norm, fuzzy: false, head: true };
    }
    const max = fuzzyAllowance(c.length);
    if (!max) return null;
    let best = null;
    for (const cand of this.byLetter.get(c[0]) || []) {
      const d = editDistance(c, cand, max);
      if (d <= max && (!best || d < best.d)) best = { d, cand };
      if (best && best.d === 1 && max === 1) break;
    }
    return best ? { word: this.full.get(best.cand), fuzzy: true } : null;
  }
}

// Muat senarai perkataan bahasa yang dipilih (import dinamik supaya pemain biasa tidak perlu memuatkannya).
export async function loadChecker(lang, colIds) {
  const [{ SHARED }, mod] = await Promise.all([
    import('./words/shared.js'),
    lang === 'en' ? import('./words/en.js') : import('./words/ms.js'),
  ]);
  return new Checker(lang, colIds, mod.WORDS, mod.HEADS, SHARED);
}

export class Checker {
  constructor(lang, colIds, words, heads, shared) {
    this.lang = lang;
    this.cols = colIds.map((id) => {
      const cat = categoryById(id);
      const col = { id, mode: cat ? cat.mode : 'loose', min: (cat && cat.min) || 2 };
      if (col.mode === 'list') col.index = new ListIndex([...splitList(words[id]), ...splitList(shared[id])], heads[id]);
      return col;
    });
  }

  // { A: [true, true, false, ...], ... } - kolum mana yang ada jawapan untuk setiap huruf.
  letterInfo() {
    const info = {};
    for (const L of LETTERS) {
      const l = L.toLowerCase();
      info[L] = this.cols.map((c) => (c.mode === 'loose' ? true : c.index.count(l) > 0));
    }
    return info;
  }

  // Semak satu baris jawapan (5 kolum) untuk huruf tertentu.
  checkRow(letter, answers, active) {
    const l = String(letter).toLowerCase();
    const seen = [];
    return this.cols.map((col, i) => {
      const raw = String((answers && answers[i]) || '').slice(0, MAX_LEN);
      const norm = normalize(raw);
      const res = this._checkOne(col, l, norm, active ? active[i] : true);
      if (res.ok && col.mode === 'loose' && seen.includes(compact(norm))) return { ok: false, reason: 'dup' };
      if (norm) seen.push(compact(norm));
      return res;
    });
  }

  _checkOne(col, l, norm, active) {
    if (!active) return { ok: false, reason: 'inactive' };
    if (!norm) return { ok: false, reason: 'empty' };
    if (compact(norm)[0] !== l) return { ok: false, reason: 'letter' };
    if (col.mode === 'list' && col.index.full.has(compact(norm))) return { ok: true };
    if (looksGibberish(norm)) return { ok: false, reason: 'gibberish' };
    if (col.mode === 'loose') {
      if (compact(norm).length < col.min) return { ok: false, reason: 'short' };
      if (isBad(norm)) return { ok: false, reason: 'bad' };
      return { ok: true };
    }
    const hit = col.index.find(norm, this.lang);
    if (!hit) return { ok: false, reason: 'invalid' };
    return hit.fuzzy ? { ok: true, match: hit.word } : { ok: true };
  }
}
