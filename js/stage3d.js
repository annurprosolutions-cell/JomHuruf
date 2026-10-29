// Pentas 3D: satu renderer dikongsi untuk paparan karakter (solo), lobi ramai pemain
// dan podium akhir. PortraitMaker pula menghasilkan gambar potret (PNG) setiap karakter.

import { THREE, Avatar, AVATAR_METRICS, addAvatarLights } from './avatar3d.js';
import { OutlineEffect } from '../vendor/three/OutlineEffect.js';
import { avatarKey } from './avatar-config.js';

const addLights = addAvatarLights;

let SHADOW_TEX = null;
function shadowTexture() {
  if (SHADOW_TEX) return SHADOW_TEX;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(20,0,40,0.42)');
  grad.addColorStop(0.6, 'rgba(20,0,40,0.18)');
  grad.addColorStop(1, 'rgba(20,0,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  SHADOW_TEX = new THREE.CanvasTexture(c);
  SHADOW_TEX.colorSpace = THREE.SRGBColorSpace;
  return SHADOW_TEX;
}

function blobShadow(scale = 1) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.3 * scale, 1.3 * scale), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }));
  m.material.userData.outlineParameters = { visible: false };
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.005;
  return m;
}

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch (e) {
    return false;
  }
}

function numberTexture(text, bg, fg) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 256, 256);
  g.fillStyle = fg;
  g.font = '900 170px "Fredoka", "Nunito", system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 140);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Stage {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'stage3d-canvas';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x000000, 0);
    this.effect = new OutlineEffect(this.renderer, { defaultThickness: 0.0042, defaultColor: [0.12, 0.08, 0.12] });
    this.effect.autoClear = true; // OutlineEffect tidak menetapkan nilai ini; tanpa ia kanvas tidak dibersihkan
    this.scene = new THREE.Scene();
    addLights(this.scene);
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 200);
    this.camTarget = new THREE.Vector3(0, 1.1, 0);
    this.camPos = new THREE.Vector3(0, 1.5, 7);
    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.clock = new THREE.Clock();
    this.mode = null;
    this.running = false;
    this.avatars = new Map();
    this.labels = null;
    this.tags = [];
    this.onTap = null;
    this._loop = this._loop.bind(this);
    this._setupPointer();
    this.ro = new ResizeObserver(() => this.resize());
  }

  mount(container) {
    if (this.container === container && this.canvas.parentNode === container) return;
    if (this.container) this.ro.unobserve(this.container);
    this.container = container;
    container.appendChild(this.canvas);
    if (this.labels) container.appendChild(this.labels);
    this.ro.observe(container);
    this.resize();
    this.start();
  }

  unmount() {
    this.stop();
    if (this.container) this.ro.unobserve(this.container);
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    if (this.labels && this.labels.parentNode) this.labels.parentNode.removeChild(this.labels);
    this.container = null;
  }

  resize() {
    if (!this.container) return;
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.mode === 'crowd') this._layoutCrowd(false);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.getDelta();
    requestAnimationFrame(this._loop);
  }

  stop() { this.running = false; }

  clear() {
    for (const a of this.avatars.values()) a.dispose();
    this.avatars.clear();
    while (this.world.children.length) {
      const o = this.world.children.pop();
      o.traverse((m) => { if (m.isMesh && m.geometry) m.geometry.dispose(); });
    }
    if (this.labels) this.labels.innerHTML = '';
    this.tags = [];
    this.confetti = null;
    this.solo = null;
    this.podium = null;
  }

  _setupPointer() {
    let down = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!down || this.mode !== 'solo' || !this.solo) return;
      const dx = e.clientX - down.x;
      if (Math.abs(dx) > 4) down.moved = true;
      this.solo.vel = dx * 0.012;
      this.solo.rotY += dx * 0.012;
      down.x = e.clientX;
    });
    const up = (e) => {
      if (down && !down.moved && performance.now() - down.t < 350 && this.onTap) this.onTap(e);
      down = null;
    };
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', () => { down = null; });
  }

  // ------------------------------------------------------------ solo (pencipta karakter / telefon pemain)
  showSolo(cfg, opts = {}) {
    if (this.mode !== 'solo') {
      this.clear();
      this.mode = 'solo';
      this.world.add(blobShadow(1.1));
      if (opts.pedestal !== false) {
        const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.05, 0.12, 48), new THREE.MeshToonMaterial({ color: opts.pedestalColor || 0x7b5cf0 }));
        ped.material.userData.outlineParameters = { color: [0.2, 0.12, 0.35] };
        ped.position.y = -0.06;
        this.world.add(ped);
      }
      this.solo = { avatar: null, rotY: 0.35, vel: 0, zoom: opts.zoom || 'full', key: '' };
    }
    if (opts.zoom) this.solo.zoom = opts.zoom;
    const key = avatarKey(cfg);
    if (key !== this.solo.key) {
      const old = this.solo.avatar;
      const av = new Avatar(cfg, { quality: 'high' });
      if (old) {
        av.anim = old.anim;
        av.setBaseExpression(old.baseExpr);
        old.dispose();
      }
      this.world.add(av.root);
      this.solo.avatar = av;
      this.solo.key = key;
    }
    return this.solo.avatar;
  }

  setZoom(zoom) { if (this.solo) this.solo.zoom = zoom; }

  soloAvatar() { return this.solo ? this.solo.avatar : null; }

  // ------------------------------------------------------------ lobi (ramai pemain)
  showCrowd() {
    if (this.mode === 'crowd') return;
    this.clear();
    this.mode = 'crowd';
    if (!this.labels) {
      this.labels = document.createElement('div');
      this.labels.className = 'stage3d-labels';
    }
    if (this.container) this.container.appendChild(this.labels);
    this.crowd = { order: [] };
    this._layoutCrowd(true);
  }

  // list: [{pid, name, avatar}] - disusun ikut urutan masuk
  syncCrowd(list, max = 40) {
    if (this.mode !== 'crowd') this.showCrowd();
    const shown = list.slice(-max);
    const keep = new Set(shown.map((p) => p.pid));
    for (const [pid, av] of this.avatars) {
      if (!keep.has(pid)) {
        av.dispose();
        if (av.label) av.label.remove();
        this.avatars.delete(pid);
      }
    }
    for (const p of shown) {
      const key = avatarKey(p.avatar);
      let av = this.avatars.get(p.pid);
      if (av && av.key !== key) {
        const pos = av.root.position.clone();
        av.dispose();
        if (av.label) av.label.remove();
        this.avatars.delete(p.pid);
        av = null;
        const nav = this._crowdAvatar(p, key);
        nav.root.position.copy(pos);
        nav.target = pos.clone();
        nav.play('spin');
        continue;
      }
      if (!av) {
        av = this._crowdAvatar(p, key);
        av.root.position.set((Math.random() - 0.5) * 2, 8, 0);
        av.dropping = true;
        av.play('jump', 1.2);
      } else if (av.label && av.label.textContent !== p.name) {
        av.label.textContent = p.name;
      }
    }
    this.crowd.order = shown.map((p) => p.pid);
    this._layoutCrowd(false);
  }

  _crowdAvatar(p, key) {
    const n = this.avatars.size;
    // 8 karakter pertama kualiti penuh; selebihnya versi ringan (geometri digabung) supaya laju.
    const av = new Avatar(p.avatar, { quality: n >= 8 ? 'low' : 'high', merge: n >= 8, idle: 'idle' });
    av.key = key;
    av.root.add(blobShadow(0.9));
    av.root.rotation.y = 0;
    this.world.add(av.root);
    const label = document.createElement('div');
    label.className = 'stage3d-label';
    label.textContent = p.name;
    this.labels.appendChild(label);
    av.label = label;
    av.labelUntil = performance.now() + 4500;
    this.avatars.set(p.pid, av);
    return av;
  }

  _layoutCrowd(snap) {
    if (!this.crowd) return;
    const ids = this.crowd.order;
    const n = ids.length;
    const aspect = this.camera.aspect || 1.6;
    const perRow = Math.max(4, Math.min(12, Math.ceil(Math.sqrt(n * aspect * 1.6))));
    const rows = Math.max(1, Math.ceil(n / perRow));
    const spacing = n <= 6 ? 1.55 : 1.35;
    ids.forEach((pid, i) => {
      const av = this.avatars.get(pid);
      if (!av) return;
      const row = Math.floor(i / perRow);
      const inRow = Math.min(perRow, n - row * perRow);
      const col = i % perRow;
      const x = (col - (inRow - 1) / 2) * spacing + (row % 2 ? spacing * 0.5 : 0);
      const z = -row * 1.3;
      // baris belakang lebih tinggi (macam tangga stadium) supaya semua karakter nampak
      av.target = new THREE.Vector3(x, row * 1.05, z);
      if (snap) av.root.position.copy(av.target);
    });
    const width = Math.max(4, perRow * spacing + 1.2);
    const depth = (rows - 1) * 1.3;
    const rise = (rows - 1) * 1.05;
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const distW = (width / 2) / Math.tan(hfov / 2);
    const distH = ((2.9 + rise + depth * 0.35) / 2) / Math.tan(vfov / 2);
    const dist = Math.max(distW, distH, 6.5) + 0.8;
    this.camTarget.set(0, 1.1 + rise * 0.5, -depth / 2);
    this.camPos.set(0, this.camTarget.y + dist * 0.18, this.camTarget.z + dist);
  }

  crowdEmote(pid, anim) {
    const av = this.avatars.get(pid);
    if (av) { av.play(anim); av.labelUntil = performance.now() + 3500; }
  }

  // ------------------------------------------------------------ podium akhir
  showPodium(top) {
    this.clear();
    this.mode = 'podium';
    const blocks = [
      { rank: 2, x: -1.55, h: 0.9, color: 0xc9d1e3, num: '2', bg: '#c9d1e3', fg: '#56607a' },
      { rank: 1, x: 0, h: 1.35, color: 0xf6c945, num: '1', bg: '#f6c945', fg: '#8a5a00' },
      { rank: 3, x: 1.55, h: 0.6, color: 0xe0a36b, num: '3', bg: '#e0a36b', fg: '#7a4316' },
    ];
    this.podium = { slots: [] };
    for (const b of blocks) {
      const mat = new THREE.MeshToonMaterial({ color: b.color });
      mat.userData.outlineParameters = { color: [0.25, 0.18, 0.3] };
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.45, b.h, 1.3), mat);
      box.position.set(b.x, b.h / 2, 0);
      this.world.add(box);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.75), new THREE.MeshBasicMaterial({ map: numberTexture(b.num, b.bg, b.fg) }));
      face.material.userData.outlineParameters = { visible: false };
      face.position.set(b.x, Math.max(0.38, b.h - 0.45), 0.651);
      this.world.add(face);
      const entry = top[b.rank - 1];
      const slot = { rank: b.rank, x: b.x, h: b.h, avatar: null, shown: false, entry };
      if (entry) {
        const av = new Avatar(entry.avatar, { quality: 'high' });
        av.root.position.set(b.x, b.h, 0.05);
        av.root.visible = false;
        av.root.add(blobShadow(0.9));
        this.world.add(av.root);
        slot.avatar = av;
        this.avatars.set('p' + b.rank, av);
      }
      this.podium.slots.push(slot);
    }
    const ground = new THREE.Mesh(new THREE.CircleGeometry(6, 64), new THREE.MeshToonMaterial({ color: 0x5b3cc4 }));
    ground.material.userData.outlineParameters = { visible: false };
    ground.rotation.x = -Math.PI / 2;
    this.world.add(ground);
    this._makeConfetti();
    this.camTarget.set(0, 1.85, 0);
    this.camPos.set(0, 2.9, 10.6);
    this.podiumDist = 10.6;
  }

  revealPodium(rank) {
    if (!this.podium) return;
    const slot = this.podium.slots.find((s) => s.rank === rank);
    if (!slot || !slot.avatar) return;
    slot.avatar.root.visible = true;
    slot.avatar.root.position.y = slot.h + 3;
    slot.dropT = 0;
    slot.shown = true;
    slot.avatar.play(rank === 1 ? 'celebrate' : 'dance', Infinity);
    if (rank === 1) this.confetti.active = true;
  }

  // Lekatkan label HTML (nama & markah) di atas karakter podium.
  attachTag(node, rank) {
    if (!this.podium) return;
    const slot = this.podium.slots.find((s) => s.rank === rank);
    if (!slot) return;
    this.tags.push({ el: node, pos: new THREE.Vector3(slot.x, slot.h + 2.62, 0.05) });
  }

  _updateTags() {
    if (!this.tags.length || !this.container) return;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const v = new THREE.Vector3();
    for (const tg of this.tags) {
      v.copy(tg.pos).project(this.camera);
      tg.el.style.left = `${((v.x * 0.5 + 0.5) * w).toFixed(1)}px`;
      tg.el.style.top = `${((-v.y * 0.5 + 0.5) * h).toFixed(1)}px`;
    }
  }

  _makeConfetti() {
    const count = 260;
    const geo = new THREE.PlaneGeometry(0.09, 0.05);
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    mat.userData.outlineParameters = { visible: false };
    const inst = new THREE.InstancedMesh(geo, mat, count);
    const colors = [0xff5a7a, 0xffd23f, 0x3ec7ff, 0x7cf08d, 0xb58cff, 0xffffff];
    const parts = [];
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      c.setHex(colors[i % colors.length]);
      inst.setColorAt(i, c);
      parts.push({ p: new THREE.Vector3((Math.random() - 0.5) * 9, 4 + Math.random() * 8, (Math.random() - 0.5) * 4), v: 0.6 + Math.random() * 0.9, r: Math.random() * 6, s: (Math.random() - 0.5) * 6 });
    }
    inst.visible = false;
    this.world.add(inst);
    this.confetti = { inst, parts, active: false, dummy: new THREE.Object3D() };
  }

  _updateConfetti(dt, t) {
    const C = this.confetti;
    if (!C) return;
    C.inst.visible = C.active;
    if (!C.active) return;
    const d = C.dummy;
    C.parts.forEach((q, i) => {
      q.p.y -= q.v * dt;
      q.p.x += Math.sin(t * 2 + i) * dt * 0.3;
      q.r += q.s * dt;
      if (q.p.y < 0) { q.p.y = 6 + Math.random() * 2; q.p.x = (Math.random() - 0.5) * 9; }
      d.position.copy(q.p);
      d.rotation.set(q.r, q.r * 0.7, q.r * 0.3);
      d.updateMatrix();
      C.inst.setMatrixAt(i, d.matrix);
    });
    C.inst.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------ gelung animasi
  _loop() {
    if (!this.running) return;
    requestAnimationFrame(this._loop);
    // Jimat bateri: jangan render jika tab tersembunyi atau bekas pentas sedang tidak dipaparkan.
    if (document.hidden || !this.container || this.container.offsetParent === null) { this.clock.getDelta(); return; }
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    if (this.mode === 'solo' && this.solo) {
      const s = this.solo;
      if (s.avatar) {
        s.vel *= 0.92;
        if (Math.abs(s.vel) < 0.0005) s.rotY += (0.35 - s.rotY) * 0.01;
        s.avatar.root.rotation.y = s.rotY;
        s.avatar.update(dt);
      }
      const face = s.zoom === 'face';
      const tgt = face ? new THREE.Vector3(0, 1.62, 0) : new THREE.Vector3(0, 1.15, 0);
      const pos = face ? new THREE.Vector3(0, 1.75, 4.1) : new THREE.Vector3(0, 1.6, 7.4);
      const aspect = this.camera.aspect;
      if (aspect < 0.8 && !face) pos.z *= 1.1 / Math.max(0.55, aspect);
      this.camTarget.lerp(tgt, 0.12);
      this.camPos.lerp(pos, 0.12);
    } else if (this.mode === 'crowd') {
      for (const av of this.avatars.values()) {
        if (av.target) {
          const p = av.root.position;
          if (av.dropping) {
            p.x += (av.target.x - p.x) * 0.12;
            p.z += (av.target.z - p.z) * 0.12;
            p.y = Math.max(av.target.y, p.y - dt * 9);
            if (p.y === av.target.y) av.dropping = false;
          } else p.lerp(av.target, 0.1);
        }
        av.update(dt);
      }
      this._updateLabels();
    } else if (this.mode === 'podium' && this.podium) {
      for (const s of this.podium.slots) {
        if (!s.avatar || !s.shown) continue;
        const p = s.avatar.root.position;
        p.y = Math.max(s.h, p.y - dt * 7);
        s.avatar.update(dt);
      }
      this._updateConfetti(dt, t);
      const aspect = this.camera.aspect || 1.6;
      const dist = this.podiumDist * Math.max(1, 1.45 / aspect);
      this.camPos.set(Math.sin(t * 0.25) * 1.2, 2.9, dist);
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
    this.camera.updateMatrixWorld();
    this._updateTags();
    this.effect.render(this.scene, this.camera);
  }

  _updateLabels() {
    if (!this.labels || !this.container) return;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const v = new THREE.Vector3();
    const now = performance.now();
    for (const av of this.avatars.values()) {
      if (!av.label) continue;
      // Kelas kecil: label sentiasa nampak. Kelas besar: label muncul sekejap bila masuk/emote supaya tak tutup muka.
      const show = this.avatars.size <= 8 || now < (av.labelUntil || 0);
      av.label.style.opacity = show ? '1' : '0';
      if (!show) continue;
      v.set(0, AVATAR_METRICS.HEIGHT + 0.12, 0).add(av.root.position);
      v.y += av.body.position.y;
      v.project(this.camera);
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      av.label.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }
}

// ------------------------------------------------------------ potret 2D untuk senarai & papan markah
export class PortraitMaker {
  constructor(size = 192) {
    this.size = size;
    this.canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size, size, false);
    this.renderer.setClearColor(0x000000, 0);
    this.effect = new OutlineEffect(this.renderer, { defaultThickness: 0.009, defaultColor: [0.12, 0.08, 0.12] });
    this.effect.autoClear = true;
    this.scene = new THREE.Scene();
    addLights(this.scene);
    this.camera = new THREE.PerspectiveCamera(24, 1, 0.1, 50);
    this.camera.position.set(0, 1.78, 3.9);
    this.camera.lookAt(0, 1.64, 0);
    this.cache = new Map();
  }

  get(cfg, expr = 'normal') {
    const key = avatarKey(cfg) + '|' + expr;
    if (this.cache.has(key)) return this.cache.get(key);
    const av = new Avatar(cfg, { quality: 'high' });
    av.root.rotation.y = 0.32;
    av.setExpression(expr);
    this.scene.add(av.root);
    this.effect.render(this.scene, this.camera);
    const url = this.canvas.toDataURL('image/png');
    av.dispose();
    this.cache.set(key, url);
    return url;
  }
}
