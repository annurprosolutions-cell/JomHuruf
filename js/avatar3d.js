// Enjin karakter 3D chibi gaya anime (Three.js, prosedural - tiada fail model luar).
// Semua bahagian (kepala, muka, rambut, tudung, kopiah, songkok, baju) dibina daripada
// bentuk asas supaya ringan dan boleh diwarnakan ikut pilihan pemain.

import * as THREE from '../vendor/three/three.module.min.js';
import { sanitizeAvatar, skinHex } from './avatar-config.js';

export { THREE };

const TAU = Math.PI * 2;
const R = 0.6; // jejari kepala
const HEAD_CY = 1.6; // pusat kepala (paksi Y dunia)
const NECK_Y = 1.04; // titik pangsi kepala

// ---------------------------------------------------------------- utiliti warna

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt >= 0) {
    r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt;
  } else {
    r *= 1 + amt; g *= 1 + amt; b *= 1 + amt;
  }
  const h = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b);
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

// ---------------------------------------------------------------- bahan (material)
let GRADIENT = null;
function gradientMap() {
  if (!GRADIENT) {
    const data = new Uint8Array([105, 185, 255]);
    GRADIENT = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
    GRADIENT.needsUpdate = true;
  }
  return GRADIENT;
}

const matCache = new Map();
function outlineFor(hex) {
  const c = new THREE.Color(shade(hex, luminance(hex) > 0.85 ? -0.62 : -0.68));
  return [c.r, c.g, c.b];
}

function toon(hex, opts = {}) {
  const side = opts.side || THREE.FrontSide;
  const key = `${hex}|${side}|${opts.map ? opts.map.uuid : ''}|${opts.outline === false ? 0 : 1}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial({
      color: opts.map ? 0xffffff : hex,
      map: opts.map || null,
      gradientMap: gradientMap(),
      side,
    });
    m.userData.outlineParameters = { color: outlineFor(hex), visible: opts.outline !== false, keepAlive: true };
    m.userData.baseHex = hex;
    matCache.set(key, m);
  }
  return m;
}

let VCOL_MAT = null;
function vertexColorToon() {
  if (!VCOL_MAT) {
    VCOL_MAT = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: gradientMap(), side: THREE.DoubleSide });
    VCOL_MAT.userData.outlineParameters = { color: [0.16, 0.1, 0.14], keepAlive: true };
  }
  return VCOL_MAT;
}

// ---------------------------------------------------------------- geometri asas
// Koordinat sfera untuk kepala: theta dari atas (0) ke bawah (PI), a = sudut dari depan (+z), positif ke kanan penonton (+x).
function sph(r, theta, a) {
  const s = Math.sin(theta);
  return new THREE.Vector3(r * s * Math.sin(a), r * Math.cos(theta), r * s * Math.cos(a));
}

// Bentuk muka anime: kepala bulat di atas, dagu tirus di bawah.
function deformHead(v) {
  const len = v.length() || 1;
  const t = Math.max(0, -v.y / len);
  const tp = Math.pow(t, 1.6);
  v.x *= 1.05 * (1 - 0.3 * tp);
  v.z *= 1 - 0.1 * tp;
  if (v.z > 0) v.z *= 1 + 0.05 * tp;
  v.y *= 1 - 0.12 * t;
  return v;
}

function deformGeometry(geo, fn) {
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    fn(v, i);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// Buang segi tiga yang semua bucunya "di luar" (contoh: bawah garis rambut) atau yang tiada luas.
// Segi tiga kosong menghasilkan normal sifar dan merosakkan garis outline.
function dropTriangles(geo, outside) {
  const idx = geo.index.array;
  const p = geo.attributes.position;
  const keep = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < idx.length; i += 3) {
    const i0 = idx[i], i1 = idx[i + 1], i2 = idx[i + 2];
    if (outside[i0] && outside[i1] && outside[i2]) continue;
    a.fromBufferAttribute(p, i0); b.fromBufferAttribute(p, i1); c.fromBufferAttribute(p, i2);
    const area = b.clone().sub(a).cross(c.clone().sub(a)).lengthSq();
    if (area < 1e-12) continue;
    keep.push(i0, i1, i2);
  }
  geo.setIndex(keep);
  geo.computeVertexNormals();
  return geo;
}

function lathe(points, segs, phiStart = Math.PI, phiLength = TAU) {
  // LatheGeometry perlukan titik dari bawah ke atas supaya normal menghala keluar.
  const pts = points[0][1] > points[points.length - 1][1] ? points.slice().reverse() : points;
  return new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), segs, phiStart, phiLength);
}

// Helaian rambut: tiub leper yang tirus ke hujung, sisi leper menghadap keluar dari kepala.
function strandGeometry(points, width, thick, o = {}) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const segs = o.segs || 10;
  const rad = o.rad || 7;
  const center = o.center || new THREE.Vector3();
  const taper = o.taper === undefined ? 0.9 : o.taper;
  const profile = o.profile || ((t) => Math.pow(1 - t, taper));
  const pos = [];
  const idx = [];
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = curve.getPointAt(t);
    curve.getTangentAt(t, T);
    N.copy(p).sub(center).normalize();
    B.crossVectors(T, N);
    if (B.lengthSq() < 1e-8) B.set(1, 0, 0);
    B.normalize();
    N.crossVectors(B, T).normalize();
    const f = Math.max(0, profile(t));
    const w = width * f * 0.5;
    const h = thick * Math.max(f, i === segs ? 0 : 0.15) * 0.5;
    for (let k = 0; k < rad; k++) {
      const ang = (k / rad) * TAU;
      const c = Math.cos(ang), s = Math.sin(ang);
      pos.push(p.x + B.x * c * w + N.x * s * h, p.y + B.y * c * w + N.y * s * h, p.z + B.z * c * w + N.z * s * h);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let k = 0; k < rad; k++) {
      const a = i * rad + k, b = i * rad + ((k + 1) % rad), c = (i + 1) * rad + k, d = (i + 1) * rad + ((k + 1) % rad);
      idx.push(a, c, b, b, c, d);
    }
  }
  // tutup pangkal
  const base = pos.length / 3;
  const p0 = curve.getPointAt(0);
  pos.push(p0.x, p0.y, p0.z);
  for (let k = 0; k < rad; k++) idx.push(base, k, (k + 1) % rad);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function mesh(geo, mat, parent, pos, rot, scale) {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  if (scale !== undefined) {
    if (typeof scale === 'number') m.scale.setScalar(scale);
    else m.scale.set(scale[0], scale[1], scale[2]);
  }
  if (parent) parent.add(m);
  return m;
}

// ---------------------------------------------------------------- tekstur corak
const texCache = new Map();
function patternTexture(kind, base, accent) {
  const key = `${kind}|${base}|${accent}`;
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 128);
  if (kind === 'songket') {
    g.strokeStyle = accent; g.lineWidth = 3;
    for (let x = -128; x < 256; x += 32) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 128, 128); g.stroke();
      g.beginPath(); g.moveTo(x + 128, 0); g.lineTo(x, 128); g.stroke();
    }
    g.fillStyle = accent;
    g.fillRect(0, 6, 256, 6); g.fillRect(0, 116, 256, 6);
    for (let x = 16; x < 256; x += 32) for (let y = 32; y < 128; y += 32) {
      g.beginPath(); g.arc(x, y, 3, 0, TAU); g.fill();
    }
  } else if (kind === 'bunga') {
    for (let i = 0; i < 26; i++) {
      const x = (i * 53) % 256 + 8, y = (i * 37) % 128 + 6;
      g.fillStyle = accent;
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU;
        g.beginPath(); g.arc(x + Math.cos(a) * 5, y + Math.sin(a) * 5, 3.6, 0, TAU); g.fill();
      }
      g.fillStyle = shade(accent, 0.5);
      g.beginPath(); g.arc(x, y, 2.4, 0, TAU); g.fill();
    }
  } else if (kind === 'kopiah') {
    g.strokeStyle = accent; g.fillStyle = accent; g.lineWidth = 2;
    // jalur sulaman di bahagian sisi (v rendah = bawah)
    for (const yy of [92, 104, 116]) { g.beginPath(); g.moveTo(0, yy); g.lineTo(256, yy); g.stroke(); }
    for (let x = 0; x < 256; x += 16) {
      g.beginPath(); g.moveTo(x, 98); g.lineTo(x + 8, 92 + 2); g.lineTo(x + 16, 98); g.lineTo(x + 8, 104); g.closePath(); g.fill();
    }
    for (let x = 8; x < 256; x += 16) { g.beginPath(); g.arc(x, 76, 2.2, 0, TAU); g.fill(); }
    for (let x = 0; x < 256; x += 24) { g.beginPath(); g.arc(x + 12, 50, 4, 0, TAU); g.stroke(); }
  } else if (kind === 'velvet') {
    const img = g.getImageData(0, 0, 256, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 14;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
  } else if (kind === 'serban') {
    g.strokeStyle = accent; g.lineWidth = 4;
    for (let y = -256; y < 256; y += 22) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y + 128); g.stroke(); }
  } else if (kind === 'rambut') {
    // jalur kilat "angel ring" pada rambut
    g.fillStyle = accent;
    g.beginPath();
    g.moveTo(0, 30);
    for (let x = 0; x <= 256; x += 16) g.lineTo(x, 30 + (x / 16 % 2 ? 7 : 0));
    for (let x = 256; x >= 0; x -= 16) g.lineTo(x, 42 + (x / 16 % 2 ? 0 : 8));
    g.closePath(); g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (kind === 'songket' || kind === 'bunga') tex.repeat.set(3, 1);
  if (kind === 'serban') tex.repeat.set(2, 2);
  texCache.set(key, tex);
  return tex;
}

// ---------------------------------------------------------------- muka (tekstur kanvas)
// Segmen sfera di bahagian depan kepala; kanvas dilukis dalam koordinat sudut.
const FACE_W = 1.9; // lebar (radian, azimut)
const FACE_T0 = 0.8; // theta mula
const FACE_TH = 1.5; // tinggi (radian)
const FW = 512, FH = 400;
const fx = (a) => ((a + FACE_W / 2) / FACE_W) * FW;
const fy = (theta) => ((theta - FACE_T0) / FACE_TH) * FH;

const EYE_A = 0.335;
const EYE_T = 1.73;

const faceCache = new Map();

function faceKey(a, expr, size) {
  return [a.eyes, a.eyeColor, a.mouth, a.blush, a.hairColor, a.skin, expr, size].join('|');
}

function drawEyeOpen(g, cx, cy, side, style, iris, wide) {
  const w = style === 'tajam' ? 92 : 86;
  let h = style === 'tajam' ? 78 : style === 'lembut' ? 88 : 104;
  if (wide) h = 110;
  const lash = '#2a1a1e';
  // bentuk putih mata
  g.save();
  g.beginPath();
  if (style === 'tajam') {
    const ix = cx - side * w * 0.5, ox = cx + side * w * 0.5;
    g.moveTo(ix, cy + h * 0.05);
    g.bezierCurveTo(ix + side * w * 0.2, cy - h * 0.55, ox - side * w * 0.15, cy - h * 0.7, ox, cy - h * 0.28);
    g.bezierCurveTo(ox + side * w * 0.02, cy + h * 0.3, ix + side * w * 0.45, cy + h * 0.62, ix, cy + h * 0.05);
  } else {
    g.ellipse(cx, cy, w / 2, h / 2, 0, 0, TAU);
  }
  g.closePath();
  g.fillStyle = '#ffffff';
  g.fill();
  g.clip();
  // anak mata (iris)
  const iw = wide ? w * 0.6 : w * 0.82, ih = wide ? h * 0.62 : h * 0.86;
  const icx = cx, icy = cy + h * (wide ? 0.02 : 0.07);
  const grad = g.createLinearGradient(0, icy - ih / 2, 0, icy + ih / 2);
  grad.addColorStop(0, shade(iris, -0.55));
  grad.addColorStop(0.45, iris);
  grad.addColorStop(1, shade(iris, 0.45));
  g.fillStyle = grad;
  g.beginPath(); g.ellipse(icx, icy, iw / 2, ih / 2, 0, 0, TAU); g.fill();
  g.lineWidth = 3.5; g.strokeStyle = shade(iris, -0.65); g.stroke();
  // pupil
  g.fillStyle = shade(iris, -0.78);
  g.beginPath(); g.ellipse(icx, icy - ih * 0.04, iw * 0.24, ih * 0.27, 0, 0, TAU); g.fill();
  // bayang kelopak atas
  g.fillStyle = 'rgba(40,20,40,0.18)';
  g.beginPath(); g.ellipse(cx, cy - h * 0.48, w * 0.6, h * 0.22, 0, 0, TAU); g.fill();
  // kilauan
  g.fillStyle = '#ffffff';
  g.beginPath(); g.ellipse(icx - iw * 0.2, icy - ih * 0.2, iw * 0.2, ih * 0.15, -0.5, 0, TAU); g.fill();
  g.globalAlpha = 0.9;
  g.beginPath(); g.arc(icx + iw * 0.2, icy + ih * 0.24, iw * 0.08, 0, TAU); g.fill();
  if (style === 'ceria') {
    g.globalAlpha = 1;
    star(g, icx + iw * 0.16, icy - ih * 0.26, 9);
    star(g, icx - iw * 0.22, icy + ih * 0.2, 6);
  }
  g.globalAlpha = 1;
  g.restore();
  // kelopak/bulu mata atas (tebal, gaya anime)
  g.strokeStyle = lash; g.fillStyle = lash; g.lineCap = 'round'; g.lineJoin = 'round';
  const ix = cx - side * w * 0.56, ox = cx + side * w * 0.56;
  g.lineWidth = style === 'lembut' ? 8 : 10;
  g.beginPath();
  if (style === 'tajam') {
    g.moveTo(ix, cy + h * 0.02);
    g.bezierCurveTo(ix + side * w * 0.25, cy - h * 0.6, ox - side * w * 0.2, cy - h * 0.72, ox + side * 6, cy - h * 0.26);
  } else if (style === 'lembut') {
    g.moveTo(ix, cy - h * 0.08);
    g.quadraticCurveTo(cx, cy - h * 0.5, ox, cy - h * 0.18);
  } else {
    g.moveTo(ix, cy - h * 0.05);
    g.bezierCurveTo(ix + side * w * 0.12, cy - h * 0.58, ox - side * w * 0.12, cy - h * 0.6, ox, cy - h * 0.12);
  }
  g.stroke();
  // kelopak separuh untuk gaya lembut
  if (style === 'lembut') {
    g.save();
    g.beginPath(); g.ellipse(cx, cy, w / 2 + 2, h / 2 + 2, 0, 0, TAU); g.clip();
    g.fillStyle = 'rgba(0,0,0,0)';
    g.restore();
  }
  // lentik di hujung luar
  g.beginPath();
  g.moveTo(ox - side * 4, cy - h * 0.2);
  g.lineTo(ox + side * 16, cy - h * 0.36);
  g.lineTo(ox + side * 6, cy - h * 0.06);
  g.closePath(); g.fill();
  // bulu mata bawah
  g.lineWidth = 3; g.globalAlpha = 0.55;
  g.beginPath();
  g.moveTo(cx + side * w * 0.1, cy + h * 0.5);
  g.quadraticCurveTo(cx + side * w * 0.4, cy + h * 0.42, ox - side * 2, cy + h * 0.16);
  g.stroke();
  g.globalAlpha = 1;
}

function star(g, x, y, r) {
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const rr = i % 2 ? r * 0.35 : r;
    const a = (i / 8) * TAU - Math.PI / 2;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath(); g.fill();
}

function drawEyeClosed(g, cx, cy, side, happy) {
  g.strokeStyle = '#2a1a1e'; g.lineCap = 'round'; g.lineWidth = 9;
  g.beginPath();
  if (happy) {
    g.moveTo(cx - 36, cy + 12);
    g.quadraticCurveTo(cx, cy - 36, cx + 36, cy + 12);
  } else {
    g.moveTo(cx - 38, cy + 2);
    g.quadraticCurveTo(cx, cy + 26, cx + 38, cy + 2);
    g.lineWidth = 8;
  }
  g.stroke();
  if (!happy) {
    g.lineWidth = 5;
    g.beginPath(); g.moveTo(cx + side * 34, cy + 4); g.lineTo(cx + side * 46, cy - 6); g.stroke();
  }
}

function drawBrow(g, cx, cy, side, color, mode) {
  g.strokeStyle = color; g.lineCap = 'round'; g.lineWidth = 7;
  let innerDy = 0, outerDy = 0, lift = 0;
  if (mode === 'sad') { innerDy = -16; outerDy = 6; }
  else if (mode === 'surprised') { lift = -16; }
  else if (mode === 'happy') { lift = -6; }
  else if (mode === 'determined') { innerDy = 10; outerDy = -8; }
  const ix = cx - side * 30, ox = cx + side * 32;
  g.beginPath();
  g.moveTo(ix, cy + innerDy + lift);
  g.quadraticCurveTo(cx, cy - 12 + lift + (innerDy + outerDy) / 2, ox, cy + outerDy + lift + 4);
  g.stroke();
}

function drawMouth(g, x, y, style, expr) {
  g.lineCap = 'round'; g.lineJoin = 'round';
  const line = '#6e2f2b';
  if (expr === 'happy' || (expr === 'normal' && style === 'gigi') || expr === 'wink') {
    g.fillStyle = '#8c2635';
    g.beginPath();
    g.moveTo(x - 24, y - 6);
    g.quadraticCurveTo(x, y - 1, x + 24, y - 6);
    g.quadraticCurveTo(x + 18, y + 26, x, y + 27);
    g.quadraticCurveTo(x - 18, y + 26, x - 24, y - 6);
    g.closePath(); g.fill();
    g.fillStyle = '#ef7b8c';
    g.beginPath(); g.ellipse(x, y + 18, 12, 7, 0, 0, TAU); g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(x - 18, y - 4); g.quadraticCurveTo(x, y + 1, x + 18, y - 4); g.lineTo(x + 15, y + 2); g.quadraticCurveTo(x, y + 6, x - 15, y + 2); g.closePath(); g.fill();
    return;
  }
  if (expr === 'sad') {
    g.strokeStyle = line; g.lineWidth = 5;
    g.beginPath(); g.moveTo(x - 15, y + 10); g.quadraticCurveTo(x, y - 4, x + 15, y + 10); g.stroke();
    return;
  }
  if (expr === 'surprised') {
    g.fillStyle = '#8c2635';
    g.beginPath(); g.ellipse(x, y + 6, 11, 14, 0, 0, TAU); g.fill();
    return;
  }
  g.strokeStyle = line; g.lineWidth = 5;
  if (style === 'kucing') {
    g.beginPath();
    g.moveTo(x - 20, y); g.quadraticCurveTo(x - 10, y + 13, x, y + 1); g.quadraticCurveTo(x + 10, y + 13, x + 20, y);
    g.stroke();
  } else if (style === 'kecil') {
    g.beginPath(); g.moveTo(x - 9, y + 3); g.quadraticCurveTo(x, y + 8, x + 9, y + 3); g.stroke();
  } else {
    g.beginPath(); g.moveTo(x - 17, y); g.quadraticCurveTo(x, y + 14, x + 17, y); g.stroke();
  }
}

function drawBlush(g, x, y, strong) {
  const grad = g.createRadialGradient(x, y, 2, x, y, 34);
  grad.addColorStop(0, strong ? 'rgba(255,92,120,0.62)' : 'rgba(255,110,135,0.45)');
  grad.addColorStop(1, 'rgba(255,110,135,0)');
  g.fillStyle = grad;
  g.beginPath(); g.ellipse(x, y, 36, 20, 0, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(240,95,120,0.38)'; g.lineWidth = 2.2; g.lineCap = 'round';
  for (let i = -1; i <= 1; i++) {
    g.beginPath(); g.moveTo(x + i * 10 - 3, y + 5); g.lineTo(x + i * 10 + 3, y - 5); g.stroke();
  }
}

function drawTear(g, x, y) {
  g.fillStyle = 'rgba(120,190,255,0.95)';
  g.beginPath();
  g.moveTo(x, y);
  g.quadraticCurveTo(x + 10, y + 16, x, y + 22);
  g.quadraticCurveTo(x - 10, y + 16, x, y);
  g.fill();
}

export function faceTexture(avatar, expr = 'normal', size = 'high') {
  const a = sanitizeAvatar(avatar);
  const key = faceKey(a, expr, size);
  if (faceCache.has(key)) return faceCache.get(key);
  const scale = size === 'high' ? 1 : 0.5;
  const c = document.createElement('canvas');
  c.width = FW * scale; c.height = FH * scale;
  const g = c.getContext('2d');
  g.scale(scale, scale);
  const brow = shade(a.hairColor, luminance(a.hairColor) > 0.55 ? -0.45 : -0.15);
  const eyeY = fy(EYE_T);
  const browY = fy(1.37);
  const mouthY = fy(2.07);
  const blushY = fy(1.95);
  const sides = [-1, 1];
  for (const s of sides) {
    const ex = fx(s * EYE_A);
    drawBrow(g, ex, browY, s, brow, expr);
    if (expr === 'blink' || (expr === 'wink' && s === 1)) drawEyeClosed(g, ex, eyeY, s, false);
    else if (expr === 'happy' || (expr === 'wink' && s === -1 && false)) drawEyeClosed(g, ex, eyeY, s, true);
    else drawEyeOpen(g, ex, eyeY, s, a.eyes, a.eyeColor, expr === 'surprised');
    if (a.blush || expr === 'happy') drawBlush(g, fx(s * 0.52), blushY, expr === 'happy');
  }
  if (expr === 'sad') drawTear(g, fx(EYE_A) + 34, eyeY + 44);
  // hidung kecil
  g.strokeStyle = 'rgba(150,80,60,0.35)'; g.lineWidth = 3.5; g.lineCap = 'round';
  g.beginPath(); g.moveTo(fx(0.01), fy(1.92)); g.lineTo(fx(0.03), fy(1.955)); g.stroke();
  drawMouth(g, fx(0), mouthY, a.mouth, expr);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  faceCache.set(key, tex);
  if (faceCache.size > 400) {
    const first = faceCache.keys().next().value;
    faceCache.get(first).dispose();
    faceCache.delete(first);
  }
  return tex;
}

function faceGeometry(nx, ny) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const a = -FACE_W / 2 + (FACE_W * i) / nx;
      const th = FACE_T0 + (FACE_TH * j) / ny;
      const p = deformHead(sph(R * 1.004, th, a));
      pos.push(p.x, p.y, p.z);
      uv.push(i / nx, 1 - j / ny);
    }
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- kepala & rambut
function hairline(a, style) {
  const k = (1 - Math.cos(a)) / 2; // 0 depan, 1 belakang
  if (style === 'bob') return 1.12 + (2.38 - 1.12) * Math.pow(k, 0.55);
  if (style === 'botak') return 1.18 + (2.1 - 1.18) * k;
  return 1.12 + (2.25 - 1.12) * Math.pow(k, 0.8);
}

function hairCap(style, color, q, hatMode) {
  const r = style === 'botak' ? R * 1.012 : R * 1.06;
  const geo = new THREE.SphereGeometry(r, Math.round(q.seg * 1.4), Math.round(q.seg * 1.1));
  const v2 = new THREE.Vector3();
  const outside = [];
  deformGeometry(geo, (v, i) => {
    v2.copy(v).normalize();
    let theta = Math.acos(THREE.MathUtils.clamp(v2.y, -1, 1));
    const a = Math.atan2(v2.x, v2.z);
    const hl = hairline(Math.abs(a), style);
    let rr = r;
    outside[i] = theta > hl;
    if (theta > hl) { theta = hl; rr = r * 0.97; }
    v.copy(sph(rr, theta, a));
    if (style === 'bob' && theta > 1.35) {
      const f = THREE.MathUtils.smoothstep(theta, 1.35, 2.3);
      v.x *= 1 + 0.16 * f; v.z *= 1 + 0.1 * f;
    }
    deformHead(v);
  });
  dropTriangles(geo, outside);
  const ring = style !== 'botak' && q.detail ? patternTexture('rambut', color, shade(color, luminance(color) > 0.6 ? -0.18 : 0.28)) : null;
  return new THREE.Mesh(geo, toon(color, { map: ring }));
}

function hp(r, theta, a) { return deformHead(sph(r, theta, a)); }

function addStrand(group, pts, width, thick, mat, o) {
  return mesh(strandGeometry(pts, width, thick, o), mat, group);
}

function buildHair(group, a, q, hatMode) {
  const style = a.hair;
  const color = a.hairColor;
  const mat = toon(color);
  group.add(hairCap(style, color, q, hatMode));
  if (style === 'botak') return;
  const so = { segs: q.strandSegs, rad: q.strandRad };

  // rambut depan (poni)
  if (style === 'kemas') {
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      const a0 = -0.55 + t * 0.15;
      const a1 = -0.6 + t * 1.6;
      addStrand(group, [hp(R * 1.02, 0.42, a0), hp(R * (hatMode ? 1.085 : 1.12), 0.85, (a0 + a1) / 2), hp(R * 1.08, 1.2 + 0.05 * Math.sin(i * 2.1), a1)], 0.2, 0.05, mat, so);
    }
  } else if (style === 'pacak') {
    const n = 6;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const a1 = -0.82 + t * 1.64;
      addStrand(group, [hp(R * 1.0, 0.4, a1 * 0.35), hp(R * (hatMode ? 1.09 : 1.13), 0.88, a1 * 0.85), hp(R * 1.1, 1.26 + (i % 2) * 0.08, a1 * 1.08)], 0.21, 0.06, mat, { ...so, taper: 1.15 });
    }
  } else {
    const n = style === 'bob' ? 9 : 7;
    const lens = [0.02, 0.07, -0.02, 0.09, -0.02, 0.07, 0.02, 0.05, 0.0];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const a1 = -0.86 + t * 1.72;
      const blunt = style === 'bob';
      addStrand(
        group,
        [hp(R * 1.0, 0.42, a1 * 0.4), hp(R * (hatMode ? 1.085 : 1.12), 0.92, a1 * 0.86), hp(R * 1.075, (blunt ? 1.3 : 1.28) + (blunt ? 0 : lens[i]), a1 * 0.96 + (blunt ? 0 : (t - 0.5) * 0.12))],
        blunt ? 0.2 : 0.18, 0.05, mat, { ...so, taper: blunt ? 0.35 : 0.9 },
      );
    }
  }

  // rambut sisi (depan telinga)
  if (style !== 'pacak' && style !== 'kemas') {
    for (const s of [-1, 1]) {
      const long = style === 'panjang';
      const pts = [hp(R * 1.05, 0.95, s * 1.14), hp(R * 1.1, 1.45, s * 1.14), hp(R * 1.07, 1.84, s * 1.16)];
      if (long) pts.push(new THREE.Vector3(s * 0.5, -0.75, 0.12), new THREE.Vector3(s * 0.48, -1.0, 0.1));
      else if (style === 'bob') pts[2] = hp(R * 1.1, 2.05, s * 1.1);
      addStrand(group, pts, long ? 0.2 : 0.16, 0.06, mat, { ...so, segs: long ? so.segs + 4 : so.segs });
    }
  } else {
    for (const s of [-1, 1]) {
      addStrand(group, [hp(R * 1.04, 1.0, s * 1.2), hp(R * 1.08, 1.45, s * 1.2), hp(R * 1.05, 1.75, s * 1.15)], 0.15, 0.05, mat, so);
    }
  }

  // pacak: duri-duri di atas & belakang
  if (style === 'pacak' && !hatMode) {
    const spikes = [
      [0.35, Math.PI], [0.45, 2.3], [0.45, -2.3], [0.85, 2.7], [0.85, -2.7], [0.8, Math.PI], [1.25, 2.55], [1.25, -2.55], [1.3, Math.PI], [0.3, 1.5], [0.3, -1.5],
    ];
    for (const [th, az] of spikes) {
      const root = hp(R * 0.98, th, az);
      const mid = hp(R * 1.22, th + 0.05, az);
      const tip = hp(R * 1.55, th + 0.12, az).add(new THREE.Vector3(0, 0.06, 0));
      addStrand(group, [root, mid, tip], 0.3, 0.2, mat, { ...so, taper: 1.0 });
    }
  }
  if ((style === 'pendek' || style === 'pacak') && !hatMode) {
    for (const az of [2.5, -2.5, Math.PI]) {
      addStrand(group, [hp(R * 1.02, 1.6, az), hp(R * 1.1, 1.95, az), hp(R * 1.05, 2.25, az * 0.98)], 0.22, 0.07, mat, so);
    }
  }

  // rambut belakang panjang
  if (style === 'panjang') {
    const n = 7;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const az = Math.PI + (t - 0.5) * 2.4;
      const root = hp(R * 1.0, 1.0, az);
      const mid = hp(R * 1.12, 1.9, az);
      const tip = new THREE.Vector3(mid.x * 0.75, -1.05 - 0.06 * Math.sin(i * 1.7), mid.z * 0.62 - 0.04);
      addStrand(group, [root, mid, new THREE.Vector3(mid.x * 0.9, -0.6, mid.z * 0.8), tip], 0.34, 0.09, mat, { ...so, segs: so.segs + 4, taper: 0.7 });
    }
  }
  // tocang dua
  if (style === 'tocang') {
    for (const s of [-1, 1]) {
      const root = hp(R * 1.0, 1.0, s * 1.75);
      const pts = [root, root.clone().add(new THREE.Vector3(s * 0.2, 0.0, -0.06)), new THREE.Vector3(s * 0.66, -0.36, -0.2), new THREE.Vector3(s * 0.6, -0.98, -0.12)];
      addStrand(group, pts, 0.34, 0.32, mat, { ...so, rad: so.rad + 2, segs: so.segs + 4, profile: (t) => (0.62 + 0.55 * Math.sin(Math.PI * Math.min(1, t * 1.4))) * Math.pow(1 - t, 0.55) });
      mesh(new THREE.SphereGeometry(0.075, 12, 10), toon(a.head === 'tudung' ? a.headColor2 : '#e85d75'), group, [root.x + s * 0.06, root.y, root.z - 0.02]);
    }
  }
  // ekor kuda
  if (style === 'ekorkuda') {
    const root = hp(R * 1.03, 1.2, Math.PI);
    const pts = [root, root.clone().add(new THREE.Vector3(0, 0.08, -0.22)), new THREE.Vector3(0, -0.25, -0.86), new THREE.Vector3(0.04, -0.92, -0.62)];
    addStrand(group, pts, 0.32, 0.3, mat, { ...so, rad: so.rad + 2, segs: so.segs + 4, profile: (t) => (0.62 + 0.55 * Math.sin(Math.PI * Math.min(1, t * 1.4))) * Math.pow(1 - t, 0.55) });
    mesh(new THREE.SphereGeometry(0.08, 12, 10), toon('#e85d75'), group, [root.x, root.y + 0.02, root.z - 0.06]);
  }
  // ahoge (sehelai rambut tercacak)
  if ((style === 'pendek' || style === 'panjang' || style === 'bob') && !hatMode) {
    addStrand(group, [hp(R * 1.0, 0.12, 0.3), new THREE.Vector3(0.02, R * 1.3, 0.08), new THREE.Vector3(0.12, R * 1.48, 0.16), new THREE.Vector3(0.22, R * 1.4, 0.24)], 0.07, 0.035, mat, { ...so, taper: 1.0 });
  }
}

// ---------------------------------------------------------------- penutup kepala
function buildTudung(headGroup, bodyGroup, a, q) {
  const main = a.headColor;
  const inner = a.headColor2;
  const style = a.headStyle;
  const matMain = toon(main, { side: THREE.DoubleSide });
  // bahagian kepala, dengan bukaan muka berbentuk bujur
  const OC = 1.73, OA = 0.86, OB = 0.67; // pusat theta, separuh lebar, separuh tinggi bukaan
  const geo = new THREE.SphereGeometry(R * 1.1, Math.round(q.seg * 1.6), Math.round(q.seg * 1.2));
  const d = new THREE.Vector3();
  const rad0 = R * 1.1;
  const outside = [];
  deformGeometry(geo, (v, i) => {
    d.copy(v).normalize();
    let theta = Math.acos(THREE.MathUtils.clamp(d.y, -1, 1));
    let az = Math.atan2(d.x, d.z);
    let rr = rad0;
    const e = (az / OA) ** 2 + ((theta - OC) / OB) ** 2;
    outside[i] = e < 1;
    if (e < 1) {
      // tolak titik dalam bukaan ke tepi bujur supaya tepi muka licin
      const k = 1 / Math.sqrt(Math.max(e, 1e-4));
      az *= k; theta = OC + (theta - OC) * k; rr = rad0 * 0.96;
    }
    // sedikit kembang di atas (gaya anime, kepala bertudung nampak bulat)
    if (theta < 1.2) rr *= 1 + 0.02 * (1 - theta / 1.2);
    v.copy(sph(rr, theta, az));
    deformHead(v);
  });
  dropTriangles(geo, outside);
  mesh(geo, matMain, headGroup);
  // lingkaran bingkai muka (anak tudung)
  const rimPts = [];
  for (let i = 0; i < 48; i++) {
    const t = (i / 48) * TAU;
    rimPts.push(deformHead(sph(R * 1.08, OC + OB * Math.sin(t) * 0.98, OA * Math.cos(t) * 0.98)));
  }
  const rimCurve = new THREE.CatmullRomCurve3(rimPts, true);
  mesh(new THREE.TubeGeometry(rimCurve, 64, style === 'sarung' ? 0.05 : 0.036, 8, true), toon(inner), headGroup);
  if (style === 'sarung') {
    // awning/bidai di dahi, ciri tudung sarung
    const top = [];
    for (let i = 0; i <= 16; i++) {
      const t = -0.62 + (i / 16) * 1.24;
      top.push(deformHead(sph(R * 1.16, OC - OB * 0.97 * Math.cos(t * 0.9) - 0.02, t * OA * 1.05)));
    }
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(top), 24, 0.065, 8, false), toon(main), headGroup, null, null, [1, 0.7, 1]).position.y = 0.02;
  }
  // kerongsang
  const brooch = deformHead(sph(R * 1.14, 2.32, -0.42));
  mesh(new THREE.SphereGeometry(0.045, 12, 10), toon('#f2d15c'), headGroup, [brooch.x, brooch.y, brooch.z]);
  // labuh/bawal di bahu (melekat pada badan)
  const len = style === 'labuh' ? 0.5 : style === 'sarung' ? 0.2 : 0.32;
  const top = HEAD_CY - 0.42;
  const prof = [
    [0.3, top + 0.02],
    [0.38, top - 0.1],
    [0.5, top - 0.2],
    [0.6, top - 0.3],
    [0.66 + len * 0.15, top - 0.3 - len * 0.6],
    [0.68 + len * 0.2, top - 0.32 - len],
  ];
  const drape = lathe(prof, q.seg, Math.PI, TAU);
  const yTop = prof[0][1], yBot = prof[prof.length - 1][1];
  const drop = style === 'bawal' ? 0.26 : style === 'labuh' ? 0.14 : 0.08;
  deformGeometry(drape, (v) => {
    const phi = Math.atan2(v.x, v.z);
    const k = THREE.MathUtils.clamp((yTop - v.y) / (yTop - yBot), 0, 1);
    v.y -= drop * k * k * Math.pow(Math.max(0, Math.cos(phi)), 3);
    v.z *= 0.84;
  });
  mesh(drape, matMain, bodyGroup);
}

function buildKopiah(headGroup, a, q) {
  const h = 0.3, r = 0.56;
  const prof = [[0.001, h], [r * 0.82, h], [r * 0.95, h - 0.025], [r * 1.0, h - 0.08], [r * 1.02, 0.0], [r * 0.96, -0.01]];
  const geo = lathe(prof, q.seg);
  const tex = patternTexture('kopiah', a.headColor, shade(a.headColor, luminance(a.headColor) > 0.6 ? -0.2 : 0.35));
  const m = mesh(geo, toon(a.headColor, { map: q.detail ? tex : null }), headGroup, [0, 0.36, -0.04], [-0.2, 0, 0]);
  m.scale.z = 1.04;
}

function buildSongkok(headGroup, a, q) {
  const h = 0.36, r = 0.585;
  const prof = [[0.001, h], [r * 0.97, h], [r, h - 0.02], [r * 1.0, 0], [r * 0.97, -0.01]];
  const tex = patternTexture('velvet', a.headColor, a.headColor);
  mesh(lathe(prof, q.seg), toon(a.headColor, { map: q.detail ? tex : null }), headGroup, [0, 0.27, -0.02], [-0.12, 0, 0], [1, 1, 1.12]);
}

function buildSerban(headGroup, a, q) {
  const base = a.headColor;
  const prof = [[0.001, 0.46], [0.22, 0.45], [0.46, 0.38], [0.62, 0.24], [0.68, 0.1], [0.66, 0.0], [0.6, -0.04]];
  const tex = patternTexture('serban', base, shade(base, luminance(base) > 0.6 ? -0.12 : 0.18));
  mesh(lathe(prof, q.seg), toon(base, { map: q.detail ? tex : null }), headGroup, [0, 0.24, -0.03], [-0.14, 0, 0], [1, 1, 1.06]);
  const wrapMat = toon(shade(base, luminance(base) > 0.6 ? -0.06 : 0.1));
  for (let i = 0; i < 3; i++) {
    mesh(new THREE.TorusGeometry(0.6 - i * 0.08, 0.055, 8, q.seg), wrapMat, headGroup, [0, 0.29 + i * 0.1, -0.03], [Math.PI / 2 - 0.14 + i * 0.1, 0.12 * (i - 1), 0], [1, 1.06, 1]);
  }
}

function buildTopi(headGroup, a, q) {
  const col = a.headColor;
  const g = new THREE.SphereGeometry(R * 1.17, q.seg, Math.round(q.seg / 2), 0, TAU, 0, Math.PI * 0.5);
  deformGeometry(g, (v) => deformHead(v));
  mesh(g, toon(col, { side: THREE.DoubleSide }), headGroup, [0, 0.04, -0.02], [-0.12, 0, 0]);
  const brimCol = shade(col, -0.22);
  const brim = new THREE.CylinderGeometry(0.46, 0.46, 0.04, q.seg, 1, false, -Math.PI * 0.42, Math.PI * 0.84);
  mesh(brim, toon(brimCol), headGroup, [0, 0.13, 0.36], [0.16, 0, 0], [1, 1, 1]);
  mesh(new THREE.SphereGeometry(0.055, 10, 8), toon(brimCol), headGroup, [0, R * 1.17 + 0.02, -0.12]);
}

function buildGlasses(headGroup, a) {
  const mat = toon('#2b2b38');
  for (const s of [-1, 1]) {
    const p = deformHead(sph(R * 1.08, EYE_T + 0.02, s * EYE_A));
    const ring = a.glasses === 'segi'
      ? new THREE.TorusGeometry(0.135, 0.014, 6, 4)
      : new THREE.TorusGeometry(0.125, 0.014, 8, 28);
    const m = mesh(ring, mat, headGroup, [p.x, p.y, p.z + 0.02], [0, s * EYE_A * 0.9, a.glasses === 'segi' ? Math.PI / 4 : 0]);
    if (a.glasses === 'segi') m.scale.set(1.15, 0.85, 1);
    // tangkai
    const ear = deformHead(sph(R * 1.04, EYE_T - 0.05, s * 1.35));
    const start = new THREE.Vector3(p.x + s * 0.13, p.y + 0.02, p.z - 0.02);
    const dir = new THREE.Vector3().subVectors(ear, start);
    const arm = mesh(new THREE.CylinderGeometry(0.011, 0.011, dir.length(), 6), mat, headGroup);
    arm.position.copy(start).addScaledVector(dir, 0.5);
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  }
  const l = deformHead(sph(R * 1.1, EYE_T - 0.02, -0.12)), rr = deformHead(sph(R * 1.1, EYE_T - 0.02, 0.12));
  const bridge = mesh(new THREE.CylinderGeometry(0.011, 0.011, l.distanceTo(rr), 6), mat, headGroup);
  bridge.position.copy(l).add(rr).multiplyScalar(0.5);
  bridge.rotation.z = Math.PI / 2;
}

// ---------------------------------------------------------------- badan & pakaian
const TORSO = [[0.001, 1.04], [0.13, 1.03], [0.235, 0.99], [0.29, 0.93], [0.296, 0.85], [0.28, 0.73], [0.27, 0.62], [0.28, 0.53], [0.286, 0.46], [0.001, 0.44]];

function buildBody(body, a, q, refs) {
  const skin = skinHex(a.skin);
  const skinMat = toon(skin);
  const A = a.outfitColor, B = a.outfitColor2;
  const outfit = a.outfit;
  const longSkirt = outfit === 'bajukurung' || outfit === 'jubah';

  // leher
  mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.2, 12), skinMat, body, [0, 1.08, 0]);

  // badan atas
  let prof = TORSO.slice();
  if (outfit === 'bajumelayu') prof = prof.slice(0, -2).concat([[0.3, 0.42], [0.31, 0.36], [0.001, 0.35]]);
  if (outfit === 'bajukurung') prof = prof.slice(0, -3).concat([[0.3, 0.5], [0.34, 0.4], [0.35, 0.36], [0.001, 0.35]]);
  if (outfit === 'hoodie') prof = prof.map(([r, y]) => [r > 0.01 ? r * 1.06 : r, y]);
  if (outfit === 'jubah') prof = [[0.001, 1.04], [0.13, 1.03], [0.235, 0.99], [0.29, 0.93], [0.296, 0.85], [0.285, 0.72], [0.29, 0.6], [0.31, 0.45], [0.34, 0.3], [0.37, 0.15], [0.39, 0.05], [0.001, 0.04]];
  const torso = mesh(lathe(prof, q.seg), toon(A), body);
  torso.scale.z = 0.8;

  // kolar / butang / aksesori pakaian
  const gold = toon('#e6b422');
  if (outfit === 'bajumelayu' || outfit === 'jubah') {
    mesh(new THREE.CylinderGeometry(0.11, 0.125, 0.08, 20), toon(A), body, [0, 1.03, 0]);
    const ys = outfit === 'jubah' ? [0.95, 0.88, 0.81, 0.74] : [0.94, 0.87, 0.8];
    for (const y of ys) mesh(new THREE.SphereGeometry(0.02, 8, 6), outfit === 'jubah' ? toon(shade(A, -0.3)) : gold, body, [0, y, 0.244]);
  }
  if (outfit === 'bajumelayu') {
    const tex = patternTexture('songket', B, '#e6b422');
    const samp = lathe([[0.31, 0.6], [0.325, 0.5], [0.345, 0.4], [0.36, 0.31]], q.seg);
    mesh(samp, toon(B, { map: q.detail ? tex : null, side: THREE.DoubleSide }), body, null, null, [1, 1, 0.84]);
    mesh(new THREE.TorusGeometry(0.3, 0.018, 6, q.seg), toon(shade(B, -0.2)), body, [0, 0.6, 0], [Math.PI / 2, 0, 0], [1, 0.84, 1]);
  }
  if (outfit === 'bajukurung') {
    const tex = patternTexture('bunga', B, shade(B, luminance(B) > 0.6 ? -0.25 : 0.35));
    const kain = lathe([[0.27, 0.56], [0.3, 0.42], [0.35, 0.25], [0.39, 0.1], [0.4, 0.05]], q.seg);
    mesh(kain, toon(B, { map: q.detail ? tex : null, side: THREE.DoubleSide }), body, null, null, [1, 1, 0.84]);
    mesh(new THREE.SphereGeometry(0.03, 10, 8), gold, body, [0, 0.98, 0.205]);
  }
  if (outfit === 'hoodie') {
    mesh(new THREE.SphereGeometry(1, 16, 10), toon(shade(A, -0.12)), body, [0, 0.57, 0.215], null, [0.17, 0.075, 0.04]);
    const hood = mesh(new THREE.TorusGeometry(0.2, 0.085, 10, 24), toon(shade(A, -0.06)), body, [0, 1.02, -0.13], [Math.PI / 2 + 0.5, 0, 0], [1.1, 1, 0.8]);
    hood.scale.set(1.1, 1, 0.8);
    for (const s of [-1, 1]) mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.16, 6), toon('#f5f5f5'), body, [s * 0.05, 0.9, 0.235]);
  }
  if (outfit === 'tshirt') {
    mesh(new THREE.CircleGeometry(0.075, 20), toon(B), body, [0, 0.82, 0.236]);
    mesh(new THREE.TorusGeometry(0.11, 0.02, 6, 20), toon(shade(A, -0.15)), body, [0, 1.0, 0.0], [Math.PI / 2, 0, 0], [1, 0.8, 1]);
  }

  // tangan
  const sleeveMat = toon(A);
  for (const s of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(s * 0.3, 0.94, 0);
    arm.rotation.z = s * 0.2;
    body.add(arm);
    if (outfit === 'tshirt') {
      mesh(new THREE.CapsuleGeometry(0.066, 0.22, 4, 10), skinMat, arm, [0, -0.19, 0]);
      mesh(new THREE.CylinderGeometry(0.088, 0.096, 0.15, 12), sleeveMat, arm, [0, -0.06, 0]);
    } else {
      mesh(new THREE.CapsuleGeometry(0.074, 0.22, 4, 10), sleeveMat, arm, [0, -0.18, 0]);
      mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.04, 12), toon(shade(A, -0.15)), arm, [0, -0.32, 0]);
    }
    mesh(new THREE.SphereGeometry(0.078, 14, 10), skinMat, arm, [0, -0.38, 0]);
    refs[s < 0 ? 'armR' : 'armL'] = arm;
  }

  // kaki
  const pantsCol = outfit === 'bajumelayu' ? A : B;
  const shoeMat = toon(outfit === 'hoodie' || outfit === 'tshirt' ? '#f2f2f2' : '#3a3346');
  for (const s of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(s * 0.13, 0.47, 0);
    body.add(leg);
    if (!longSkirt) mesh(new THREE.CapsuleGeometry(0.09, 0.26, 4, 10), toon(pantsCol), leg, [0, -0.22, 0]);
    mesh(new THREE.SphereGeometry(1, 14, 10), shoeMat, leg, [0, -0.405, longSkirt ? 0.07 : 0.035], null, [0.1, 0.07, 0.15]);
    refs[s < 0 ? 'legR' : 'legL'] = leg;
  }
}

// ---------------------------------------------------------------- kelas Avatar
const QUALITY = {
  high: { seg: 40, strandSegs: 10, strandRad: 7, faceN: [28, 22], detail: true, face: 'high' },
  low: { seg: 20, strandSegs: 6, strandRad: 5, faceN: [14, 11], detail: false, face: 'low' },
};

export class Avatar {
  constructor(cfg, opts = {}) {
    this.cfg = sanitizeAvatar(cfg);
    this.quality = opts.quality || 'high';
    const q = QUALITY[this.quality];
    this.q = q;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.refs = {};
    buildBody(this.body, this.cfg, q, this.refs);

    // kepala
    const head = new THREE.Group();
    head.position.set(0, NECK_Y, 0);
    this.body.add(head);
    this.head = head;
    const inner = new THREE.Group();
    inner.position.set(0, HEAD_CY - NECK_Y, 0);
    head.add(inner);
    this.headInner = inner;

    const skin = skinHex(this.cfg.skin);
    const hg = new THREE.SphereGeometry(R, q.seg, Math.round(q.seg * 0.8));
    deformGeometry(hg, deformHead);
    mesh(hg, toon(skin), inner);

    const fg = faceGeometry(q.faceN[0], q.faceN[1]);
    this.faceMat = new THREE.MeshBasicMaterial({ map: faceTexture(this.cfg, 'normal', q.face), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.faceMat.userData.outlineParameters = { visible: false };
    this.face = mesh(fg, this.faceMat, inner);
    this.face.renderOrder = 2;

    const hw = this.cfg.head;
    if (hw !== 'tudung') {
      for (const s of [-1, 1]) {
        const p = deformHead(sph(R * 0.97, 1.66, s * 1.5));
        mesh(new THREE.SphereGeometry(1, 12, 10), toon(skin), inner, [p.x, p.y, p.z], [0, s * 0.3, 0], [0.06, 0.11, 0.085]);
      }
      buildHair(inner, this.cfg, q, hw !== 'tiada');
    }
    if (hw === 'tudung') buildTudung(inner, this.body, this.cfg, q);
    else if (hw === 'kopiah') buildKopiah(inner, this.cfg, q);
    else if (hw === 'songkok') buildSongkok(inner, this.cfg, q);
    else if (hw === 'serban') buildSerban(inner, this.cfg, q);
    else if (hw === 'topi') buildTopi(inner, this.cfg, q);
    if (this.cfg.glasses !== 'tiada') buildGlasses(inner, this.cfg);

    this.expr = 'normal';
    this.baseExpr = 'normal';
    this.anim = null;
    this.time = Math.random() * 10;
    this.nextBlink = 1 + Math.random() * 3;
    this.blinkUntil = 0;
    this.idleStyle = opts.idle || 'idle';
    if (opts.merge) this.mergeStatic();
  }

  setExpression(expr) {
    if (expr === this.expr) return;
    this.expr = expr;
    this.faceMat.map = faceTexture(this.cfg, expr, this.q.face);
    this.faceMat.needsUpdate = true;
  }

  setBaseExpression(expr) {
    this.baseExpr = expr;
    if (!this.anim) this.setExpression(expr);
  }

  // Mainkan animasi: wave, jump, celebrate, sad, dance, spin, nod
  play(name, duration) {
    const durs = { wave: 1.8, jump: 0.9, celebrate: 2.6, sad: 2.6, dance: 3.2, spin: 1.1, nod: 1.0 };
    this.anim = { name, t: 0, dur: duration || durs[name] || 1.5, loop: duration === Infinity };
  }

  stop() { this.anim = null; this.setExpression(this.baseExpr); }

  update(dt) {
    this.time += dt;
    const t = this.time;
    const { armL, armR, legL, legR } = this.refs;
    // pose asas (idle)
    let rootY = 0, bodyRotZ = 0, bodyRotY = 0, headX = Math.sin(t * 0.9) * 0.03, headZ = Math.sin(t * 1.1) * 0.04;
    let aL = 0.2 + Math.sin(t * 1.6) * 0.04, aR = -0.2 - Math.sin(t * 1.6 + 1) * 0.04, aLx = 0, aRx = 0;
    let squash = 1 + Math.sin(t * 2.2) * 0.012;
    let lL = 0, lR = 0;
    let expr = this.baseExpr;
    const A = this.anim;
    if (A) {
      A.t += dt;
      const p = A.t / A.dur;
      const k = A.loop ? A.t : A.t;
      switch (A.name) {
        case 'wave':
          aR = -2.5 + Math.sin(k * 12) * 0.35; headZ = 0.12; expr = 'happy';
          break;
        case 'jump': {
          const j = Math.sin(Math.min(1, p) * Math.PI);
          rootY = j * 0.45; squash = 1 + j * 0.08; aL = 0.4 + j * 2.2; aR = -0.4 - j * 2.2; lL = -j * 0.3; lR = -j * 0.3; expr = 'happy';
          break;
        }
        case 'celebrate': {
          const ph = (k * 2.6) % 1;
          const j = Math.sin(ph * Math.PI);
          rootY = j * 0.32; squash = 1 + j * 0.06; aL = 2.5 + Math.sin(k * 14) * 0.3; aR = -2.5 - Math.sin(k * 14 + 1) * 0.3; bodyRotY = Math.sin(k * 3) * 0.3; expr = 'happy';
          lL = -j * 0.25; lR = -j * 0.25;
          break;
        }
        case 'sad':
          headX = 0.32; aL = 0.08; aR = -0.08; squash = 0.97; rootY = -0.01; expr = 'sad';
          bodyRotZ = Math.sin(k * 7) * 0.012;
          break;
        case 'dance': {
          const b = Math.sin(k * 7);
          rootY = Math.abs(b) * 0.12; bodyRotZ = b * 0.1; aL = 0.6 + Math.max(0, b) * 1.8; aR = -0.6 - Math.max(0, -b) * 1.8; headZ = -b * 0.12; expr = 'happy';
          lL = Math.max(0, b) * -0.35; lR = Math.max(0, -b) * -0.35;
          break;
        }
        case 'spin': {
          const e = Math.min(1, p);
          bodyRotY = e * TAU; rootY = Math.sin(e * Math.PI) * 0.25; aL = 1.2; aR = -1.2; expr = 'happy';
          break;
        }
        case 'nod':
          headX = Math.sin(p * Math.PI * 4) * 0.18; expr = 'normal';
          break;
        default:
      }
      if (!A.loop && A.t >= A.dur) this.anim = null;
    } else if (this.idleStyle === 'dance') {
      const b = Math.sin(t * 5);
      rootY = Math.abs(b) * 0.06; bodyRotZ = b * 0.06; aL = 0.3 + Math.max(0, b) * 0.6; aR = -0.3 - Math.max(0, -b) * 0.6;
    }
    // kelip mata
    if (expr === 'normal' || expr === 'surprised') {
      if (t > this.nextBlink) { this.blinkUntil = t + 0.13; this.nextBlink = t + 2.2 + Math.random() * 3.5; }
      if (t < this.blinkUntil) expr = 'blink';
    }
    this.setExpression(expr);

    this.body.position.y = rootY;
    this.body.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
    this.body.rotation.z = bodyRotZ;
    this.body.rotation.y = bodyRotY;
    this.head.rotation.x = headX;
    this.head.rotation.z = headZ;
    if (armL) { armL.rotation.z = aL; armL.rotation.x = aLx; }
    if (armR) { armR.rotation.z = aR; armR.rotation.x = aRx; }
    if (legL) legL.rotation.x = lL;
    if (legR) legR.rotation.x = lR;
  }

  // Gabungkan geometri statik (untuk paparan ramai pemain): kurangkan draw call.
  mergeStatic() {
    const groups = [this.body, this.headInner, this.refs.armL, this.refs.armR, this.refs.legL, this.refs.legR].filter(Boolean);
    for (const grp of groups) {
      const meshes = [];
      grp.updateWorldMatrix(true, true);
      const inv = new THREE.Matrix4().copy(grp.matrixWorld).invert();
      grp.traverse((o) => {
        if (!o.isMesh || o === this.face) return;
        // hanya anak-anak terus kumpulan ini (bukan kumpulan lain yang juga digabung)
        let p = o.parent;
        while (p && p !== grp) { if (groups.includes(p)) return; p = p.parent; }
        meshes.push(o);
      });
      if (meshes.length < 2) continue;
      const geos = [];
      for (const m of meshes) {
        let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        const mat = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
        g.applyMatrix4(mat);
        const col = new THREE.Color(m.material.userData.baseHex || '#ffffff');
        const n = g.attributes.position.count;
        const colors = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b; }
        const ng = new THREE.BufferGeometry();
        ng.setAttribute('position', g.attributes.position);
        ng.setAttribute('normal', g.attributes.normal);
        ng.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geos.push(ng);
        m.geometry.dispose();
        m.parent.remove(m);
      }
      const merged = mergeNonIndexed(geos);
      const mm = new THREE.Mesh(merged, vertexColorToon());
      grp.add(mm);
    }
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
    });
    this.faceMat.dispose();
    if (this.root.parent) this.root.parent.remove(this.root);
  }
}

function mergeNonIndexed(geos) {
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let off = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, off * 3);
    nor.set(g.attributes.normal.array, off * 3);
    col.set(g.attributes.color.array, off * 3);
    off += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

export const AVATAR_METRICS = { R, HEAD_CY, NECK_Y, HEIGHT: 2.3 };

// Pencahayaan standard untuk semua paparan karakter (dikongsi supaya rupa konsisten).
export function addAvatarLights(scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd2c4ec, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(1.4, 2.6, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xe2d8ff, 0.55);
  rim.position.set(-3, 2.5, -3);
  scene.add(rim);
}
