// Panel pencipta karakter (tab + pilihan warna). Dipaparkan pada telefon pemain.
import { el, clear } from './ui.js';
import * as C from './avatar-config.js';

const SONGKOK_COLORS = ['#1c1c22', '#3a2a5a', '#5a1a2a', '#1b2f6b'];

export function mountCreator({ tabsEl, bodyEl, initial, onChange, onZoom }) {
  let a = C.sanitizeAvatar(initial);
  let tab = 'kepala';

  const set = (patch) => {
    a = C.sanitizeAvatar({ ...a, ...patch });
    onChange(a);
    render();
  };

  const chips = (title, options, value, key) => el('div', { class: 'opt-group' },
    el('h4', null, title),
    el('div', { class: 'chips' }, options.map((o) => el('button', {
      class: 'chip' + (o.id === value ? ' on' : ''), type: 'button', 'aria-pressed': String(o.id === value),
      onclick: () => set({ [key]: o.id }),
    }, o.label))));

  const swatches = (title, colors, value, key) => el('div', { class: 'opt-group' },
    el('h4', null, title),
    el('div', { class: 'swatches' }, colors.map((c) => el('button', {
      class: 'swatch' + (c === value ? ' on' : ''), type: 'button', style: { background: c }, 'aria-label': `Warna ${c}`,
      onclick: () => set({ [key]: c }),
    }))));

  const TABS = [
    { id: 'kepala', label: 'Tudung / Kopiah', zoom: 'face' },
    { id: 'muka', label: 'Muka', zoom: 'face' },
    { id: 'rambut', label: 'Rambut', zoom: 'face' },
    { id: 'baju', label: 'Pakaian', zoom: 'full' },
    { id: 'aksesori', label: 'Aksesori', zoom: 'face' },
  ];

  function body() {
    switch (tab) {
      case 'muka':
        return [
          el('div', { class: 'opt-group' }, el('h4', null, 'Warna kulit'), el('div', { class: 'swatches' }, C.SKIN_TONES.map((s) => el('button', {
            class: 'swatch' + (s.id === a.skin ? ' on' : ''), type: 'button', style: { background: s.hex }, 'aria-label': s.label, title: s.label,
            onclick: () => set({ skin: s.id }),
          })))),
          chips('Gaya mata', C.EYE_STYLES, a.eyes, 'eyes'),
          swatches('Warna mata', C.EYE_COLORS, a.eyeColor, 'eyeColor'),
          chips('Mulut', C.MOUTH_STYLES, a.mouth, 'mouth'),
          el('div', { class: 'opt-group' }, el('h4', null, 'Pipi merah'), el('div', { class: 'chips' },
            el('button', { class: 'chip' + (a.blush ? ' on' : ''), type: 'button', onclick: () => set({ blush: true }) }, 'Ya'),
            el('button', { class: 'chip' + (!a.blush ? ' on' : ''), type: 'button', onclick: () => set({ blush: false }) }, 'Tidak'))),
        ];
      case 'rambut':
        return [
          a.head === 'tudung' ? el('div', { class: 'note' }, 'Rambut tersembunyi di bawah tudung. Pilihan ini digunakan jika tudung ditanggalkan.') : null,
          chips('Gaya rambut', C.HAIR_STYLES, a.hair, 'hair'),
          swatches('Warna rambut', C.HAIR_COLORS, a.hairColor, 'hairColor'),
        ];
      case 'kepala': {
        const out = [chips('Penutup kepala', C.HEADWEAR, a.head, 'head')];
        if (a.head === 'tudung') {
          out.push(chips('Gaya tudung', C.TUDUNG_STYLES, a.headStyle, 'headStyle'));
          out.push(swatches('Warna tudung', C.TUDUNG_COLORS, a.headColor, 'headColor'));
          out.push(swatches('Warna anak tudung', C.TUDUNG_COLORS, a.headColor2, 'headColor2'));
        } else if (a.head === 'kopiah' || a.head === 'serban') {
          out.push(swatches(a.head === 'kopiah' ? 'Warna kopiah' : 'Warna serban', C.KOPIAH_COLORS, a.headColor, 'headColor'));
        } else if (a.head === 'songkok') {
          out.push(swatches('Warna songkok', SONGKOK_COLORS, a.headColor, 'headColor'));
        } else if (a.head === 'topi') {
          out.push(swatches('Warna topi', C.CLOTH_COLORS, a.headColor, 'headColor'));
        }
        return out;
      }
      case 'baju': {
        const second = { bajumelayu: 'Warna samping', bajukurung: 'Warna kain', hoodie: 'Warna seluar', tshirt: 'Warna seluar & logo' }[a.outfit];
        return [
          chips('Jenis pakaian', C.OUTFITS, a.outfit, 'outfit'),
          swatches('Warna baju', C.CLOTH_COLORS, a.outfitColor, 'outfitColor'),
          second ? swatches(second, C.CLOTH_COLORS, a.outfitColor2, 'outfitColor2') : null,
        ];
      }
      case 'aksesori':
        return [chips('Cermin mata', C.GLASSES, a.glasses, 'glasses')];
      default:
        return [];
    }
  }

  function render() {
    clear(tabsEl).append(...TABS.map((t) => el('button', {
      class: 'tab' + (t.id === tab ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': String(t.id === tab),
      onclick: () => { tab = t.id; onZoom && onZoom(t.zoom); render(); },
    }, t.label)));
    clear(bodyEl).append(...body().filter(Boolean));
  }

  render();
  onZoom && onZoom('face');
  return {
    get value() { return a; },
    setValue(v) { a = C.sanitizeAvatar(v); onChange(a); render(); },
  };
}
