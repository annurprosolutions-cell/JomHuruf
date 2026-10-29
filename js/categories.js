// Bank kategori (kolum) yang hos boleh pilih. Hos pilih tepat 5 kolum setiap permainan.
// mode 'list'  : jawapan mesti ada dalam senarai perkataan (dengan toleransi salah eja kecil).
// mode 'loose' : terlalu terbuka untuk senarai (nama orang, benda) - semakan asas sahaja.

export const COLS_PER_GAME = 5;

export const CATEGORIES = [
  { id: 'nama', ms: 'Nama', en: 'Name', mode: 'loose', min: 2, icon: '🙂' },
  { id: 'benda', ms: 'Benda', en: 'Thing', mode: 'loose', min: 3, icon: '📦' },
  { id: 'binatang', ms: 'Binatang', en: 'Animal', mode: 'list', icon: '🐘' },
  { id: 'buahsayur', ms: 'Buah / Sayur', en: 'Fruit / Vegetable', mode: 'list', icon: '🍉' },
  { id: 'negara', ms: 'Negara', en: 'Country', mode: 'list', icon: '🌏' },
  { id: 'makanan', ms: 'Makanan & Minuman', en: 'Food & Drink', mode: 'list', icon: '🍜' },
  { id: 'pekerjaan', ms: 'Pekerjaan', en: 'Job', mode: 'list', icon: '👷' },
  { id: 'bandar', ms: 'Bandar / Negeri', en: 'City / State', mode: 'list', icon: '🏙️' },
  { id: 'warna', ms: 'Warna', en: 'Colour', mode: 'list', icon: '🎨' },
  { id: 'sukan', ms: 'Sukan', en: 'Sport', mode: 'list', icon: '⚽' },
  { id: 'kenderaan', ms: 'Kenderaan', en: 'Vehicle', mode: 'list', icon: '🚗' },
  { id: 'badan', ms: 'Anggota Badan', en: 'Body Part', mode: 'list', icon: '✋' },
  { id: 'pakaian', ms: 'Pakaian', en: 'Clothing', mode: 'list', icon: '👕' },
  { id: 'tumbuhan', ms: 'Bunga & Pokok', en: 'Plant & Flower', mode: 'list', icon: '🌺' },
];

export const DEFAULT_COLS = ['nama', 'benda', 'binatang', 'buahsayur', 'negara'];

export const LANGS = {
  ms: { label: 'Bahasa Melayu', short: 'BM' },
  en: { label: 'English', short: 'EN' },
};

export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export function categoryById(id) {
  return CATEGORIES.find((c) => c.id === id) || null;
}

export function colLabel(id, lang) {
  const c = categoryById(id);
  return c ? (lang === 'en' ? c.en : c.ms) : id;
}
