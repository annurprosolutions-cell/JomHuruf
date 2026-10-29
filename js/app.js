// Titik masuk aplikasi: pilih peranan (pemain / hos) dan muatkan 3D jika peranti menyokong.
import { $, $$, el, show, sfx, initialsAvatar } from './ui.js';
import { peerSupported } from './net.js';
import { startPlayer } from './player.js';
import { startHost } from './host.js';
import { loadStats, renderStats } from './stats.js';

export const app = {
  g3d: undefined,
  stage: null,
  portraits: null,

  // Muat modul 3D (Three.js) secara dinamik. Jika gagal (peranti lama), permainan tetap jalan tanpa 3D.
  async load3D() {
    if (app.g3d !== undefined) return app.g3d;
    try {
      const m = await import('./stage3d.js');
      if (!m.webglAvailable()) throw new Error('WebGL2 tidak disokong');
      app.g3d = m;
    } catch (e) {
      console.warn('3D dimatikan:', e);
      app.g3d = null;
    }
    return app.g3d;
  },

  getStage() {
    if (!app.g3d) return null;
    if (!app.stage) {
      try { app.stage = new app.g3d.Stage(); } catch (e) { console.warn(e); app.g3d = null; return null; }
    }
    return app.stage;
  },

  portraitURL(avatar) {
    if (!app.g3d) return null;
    try {
      if (!app.portraits) app.portraits = new app.g3d.PortraitMaker(128);
      return app.portraits.get(avatar);
    } catch (e) {
      console.warn(e);
      return null;
    }
  },

  portrait(avatar, name, extraClass = '') {
    const box = el('div', { class: 'portrait ' + extraClass });
    const url = app.portraitURL(avatar);
    if (url) box.append(el('img', { src: url, alt: '' }));
    else box.append(initialsAvatar(name, avatar));
    return box;
  },

  error(title, text) {
    if (app.cleanup) { try { app.cleanup(); } catch (e) { /* abaikan */ } app.cleanup = null; }
    if (app.stage) app.stage.unmount();
    $('#reconnect').hidden = true;
    $('#error-title').textContent = title;
    $('#error-text').textContent = text || '';
    show('scr-error');
  },

  home(msg) {
    const url = new URL(location.href);
    for (const k of ['pin', 'hos']) url.searchParams.delete(k);
    history.replaceState(null, '', url);
    if (app.cleanup) { try { app.cleanup(); } catch (e) { /* abaikan */ } app.cleanup = null; }
    if (app.stage) app.stage.unmount();
    document.body.dataset.awake = '0';
    $('#reconnect').hidden = true;
    show('scr-home');
    $('#home-error').textContent = msg || '';
  },
};

function refreshMuteButtons() {
  for (const b of $$('[data-action="mute"]')) b.textContent = sfx.muted ? '🔇' : '🔊';
}

function boot() {
  refreshMuteButtons();
  loadStats().then((s) => renderStats($('#home-stats'), s));
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action]');
    sfx.unlock();
    if (!t) return;
    if (t.dataset.action === 'mute') { sfx.setMuted(!sfx.muted); refreshMuteButtons(); }
  });

  const pinInput = $('#pin-input');
  pinInput.addEventListener('input', () => { pinInput.value = pinInput.value.replace(/\D/g, '').slice(0, 6); });
  $('#join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const pin = pinInput.value.trim();
    if (!/^\d{6}$/.test(pin)) { $('#home-error').textContent = 'PIN mesti 6 digit.'; return; }
    go('pin', pin);
  });
  $('#btn-host').addEventListener('click', () => go('hos', '1'));
  $('#error-home').addEventListener('click', () => app.home());
  $('#loading-cancel').addEventListener('click', () => app.home());

  if (!peerSupported()) {
    app.error('Pelayar tidak disokong', 'Pelayar ini tidak menyokong WebRTC. Cuba guna Chrome, Safari atau Firefox versi terkini.');
    return;
  }
  route();
}

function go(key, value) {
  const url = new URL(location.href);
  for (const k of ['pin', 'hos']) url.searchParams.delete(k);
  url.searchParams.set(key, value);
  history.pushState(null, '', url);
  route();
}

function route() {
  const qs = new URLSearchParams(location.search);
  if (app.cleanup) { try { app.cleanup(); } catch (e) { /* abaikan */ } app.cleanup = null; }
  if (qs.has('hos')) { startHost(app); return; }
  if (qs.has('pin') && /^\d{6}$/.test(qs.get('pin'))) { startPlayer(app, qs.get('pin')); return; }
  show('scr-home');
}

window.addEventListener('popstate', route);
boot();
