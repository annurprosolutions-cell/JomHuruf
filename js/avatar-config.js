// Pilihan karakter, nilai lalai dan pembersihan (sanitize) data avatar.
// Semua data avatar yang diterima dari rangkaian MESTI melalui sanitizeAvatar().

export const SKIN_TONES = [
  { id: 'cerah', label: 'Cerah', hex: '#ffe3cf' },
  { id: 'langsat', label: 'Kuning langsat', hex: '#f7d0ae' },
  { id: 'sawo', label: 'Sawo matang', hex: '#e2b08a' },
  { id: 'perang', label: 'Perang', hex: '#c48a60' },
  { id: 'gelap', label: 'Gelap', hex: '#9a6443' },
  { id: 'koko', label: 'Koko', hex: '#6f4631' },
];

export const HAIR_COLORS = ['#1d1a22', '#3a281f', '#6b4428', '#a8743f', '#e6c46c', '#d9dbe4', '#c4473f', '#f29ac0', '#5aa7e8', '#9a7be0', '#4fbf8a'];
export const EYE_COLORS = ['#3a2418', '#6b3f1d', '#2f6fd6', '#2e9c6a', '#8a4fd8', '#d0452f', '#d9a21b', '#2b2b38'];
export const CLOTH_COLORS = ['#f6f1e7', '#1f2433', '#9f1d3f', '#e85d75', '#f7a8c8', '#f59e42', '#f2d15c', '#7cc96b', '#11845b', '#4fb3e8', '#2550a8', '#1b2f6b', '#8e6fd8', '#c9b6f2', '#8b5a3c', '#d7b98e', '#6b7280'];
export const TUDUNG_COLORS = ['#f6f1e7', '#1f2433', '#9f1d3f', '#f7a8c8', '#e85d75', '#bfe3ff', '#2550a8', '#1b2f6b', '#a7ecd0', '#11845b', '#d7b98e', '#c9b6f2', '#f2d15c', '#6b7280'];
export const KOPIAH_COLORS = ['#f8f6f0', '#1c1c22', '#efe2c4', '#7a1730', '#1b2f6b', '#14533b'];

export const EYE_STYLES = [
  { id: 'bulat', label: 'Bulat' },
  { id: 'ceria', label: 'Ceria' },
  { id: 'tajam', label: 'Tajam' },
  { id: 'lembut', label: 'Lembut' },
];

export const MOUTH_STYLES = [
  { id: 'senyum', label: 'Senyum' },
  { id: 'gigi', label: 'Gelak' },
  { id: 'kucing', label: 'Comel :3' },
  { id: 'kecil', label: 'Tenang' },
];

export const HAIR_STYLES = [
  { id: 'pendek', label: 'Pendek' },
  { id: 'pacak', label: 'Pacak anime' },
  { id: 'kemas', label: 'Kemas' },
  { id: 'panjang', label: 'Panjang' },
  { id: 'tocang', label: 'Tocang dua' },
  { id: 'ekorkuda', label: 'Ekor kuda' },
  { id: 'bob', label: 'Bob' },
  { id: 'botak', label: 'Botak' },
];

export const HEADWEAR = [
  { id: 'tiada', label: 'Tiada' },
  { id: 'tudung', label: 'Tudung' },
  { id: 'kopiah', label: 'Kopiah' },
  { id: 'songkok', label: 'Songkok' },
  { id: 'serban', label: 'Serban' },
  { id: 'topi', label: 'Topi' },
];

export const TUDUNG_STYLES = [
  { id: 'bawal', label: 'Bawal' },
  { id: 'sarung', label: 'Sarung' },
  { id: 'labuh', label: 'Labuh' },
];

export const OUTFITS = [
  { id: 'bajumelayu', label: 'Baju Melayu' },
  { id: 'bajukurung', label: 'Baju Kurung' },
  { id: 'jubah', label: 'Jubah' },
  { id: 'hoodie', label: 'Hoodie' },
  { id: 'tshirt', label: 'T-shirt' },
];

export const GLASSES = [
  { id: 'tiada', label: 'Tiada' },
  { id: 'bulat', label: 'Bulat' },
  { id: 'segi', label: 'Segi' },
];

const ids = (list) => list.map((o) => o.id);
const HEX_RE = /^#[0-9a-f]{6}$/i;

export const DEFAULT_AVATAR = Object.freeze({
  v: 1,
  skin: 'langsat',
  eyes: 'bulat',
  eyeColor: '#3a2418',
  mouth: 'senyum',
  blush: true,
  hair: 'pendek',
  hairColor: '#1d1a22',
  head: 'tiada',
  headStyle: 'bawal',
  headColor: '#f6f1e7',
  headColor2: '#f7a8c8',
  outfit: 'bajumelayu',
  outfitColor: '#4fb3e8',
  outfitColor2: '#1b2f6b',
  glasses: 'tiada',
});

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function hex(value, fallback) {
  return typeof value === 'string' && HEX_RE.test(value) ? value.toLowerCase() : fallback;
}

// Buang apa-apa medan pelik; pastikan setiap nilai datang dari senarai pilihan yang sah.
export function sanitizeAvatar(input) {
  const a = input && typeof input === 'object' ? input : {};
  const d = DEFAULT_AVATAR;
  return {
    v: 1,
    skin: pick(a.skin, ids(SKIN_TONES), d.skin),
    eyes: pick(a.eyes, ids(EYE_STYLES), d.eyes),
    eyeColor: hex(a.eyeColor, d.eyeColor),
    mouth: pick(a.mouth, ids(MOUTH_STYLES), d.mouth),
    blush: a.blush === undefined ? d.blush : !!a.blush,
    hair: pick(a.hair, ids(HAIR_STYLES), d.hair),
    hairColor: hex(a.hairColor, d.hairColor),
    head: pick(a.head, ids(HEADWEAR), d.head),
    headStyle: pick(a.headStyle, ids(TUDUNG_STYLES), d.headStyle),
    headColor: hex(a.headColor, d.headColor),
    headColor2: hex(a.headColor2, d.headColor2),
    outfit: pick(a.outfit, ids(OUTFITS), d.outfit),
    outfitColor: hex(a.outfitColor, d.outfitColor),
    outfitColor2: hex(a.outfitColor2, d.outfitColor2),
    glasses: pick(a.glasses, ids(GLASSES), d.glasses),
  };
}

export function skinHex(id) {
  const s = SKIN_TONES.find((t) => t.id === id);
  return s ? s.hex : SKIN_TONES[1].hex;
}

export function avatarKey(a) {
  const s = sanitizeAvatar(a);
  return Object.keys(s).sort().map((k) => `${k}:${s[k]}`).join('|');
}

const rand = (list) => list[Math.floor(Math.random() * list.length)];

// Karakter rawak untuk butang "Rawak" dan untuk pemain bot ujian.
export function randomAvatar() {
  const girl = Math.random() < 0.5;
  const head = girl ? (Math.random() < 0.75 ? 'tudung' : 'tiada') : rand(['tiada', 'kopiah', 'kopiah', 'songkok', 'topi', 'serban']);
  return sanitizeAvatar({
    skin: rand(SKIN_TONES).id,
    eyes: rand(ids(EYE_STYLES)),
    eyeColor: rand(EYE_COLORS),
    mouth: rand(ids(MOUTH_STYLES)),
    blush: Math.random() < 0.8,
    hair: girl ? rand(['panjang', 'tocang', 'ekorkuda', 'bob']) : rand(['pendek', 'pacak', 'kemas']),
    hairColor: Math.random() < 0.6 ? rand(HAIR_COLORS.slice(0, 4)) : rand(HAIR_COLORS),
    head,
    headStyle: rand(ids(TUDUNG_STYLES)),
    headColor: head === 'kopiah' || head === 'serban' ? rand(KOPIAH_COLORS) : head === 'songkok' ? '#1c1c22' : rand(TUDUNG_COLORS),
    headColor2: rand(TUDUNG_COLORS),
    outfit: girl ? rand(['bajukurung', 'bajukurung', 'jubah', 'hoodie', 'tshirt']) : rand(['bajumelayu', 'bajumelayu', 'jubah', 'hoodie', 'tshirt']),
    outfitColor: rand(CLOTH_COLORS),
    outfitColor2: rand(CLOTH_COLORS),
    glasses: Math.random() < 0.15 ? rand(['bulat', 'segi']) : 'tiada',
  });
}
