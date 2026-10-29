// Lapisan rangkaian: WebRTC peer-to-peer melalui PeerJS.
// Peranti hos ialah "pelayan" permainan. Telefon pemain lain sambung terus ke hos.
// PeerJS Cloud (0.peerjs.com) hanya digunakan untuk "memperkenalkan" dua pelayar
// (signaling). Data permainan tidak disimpan di mana-mana pelayan.
/* global Peer */

const PREFIX = 'jomhuruf-v1-';

export function peerId(pin) {
  return PREFIX + pin;
}

// ?peer=host:port membolehkan guna pelayan PeerJS sendiri (contoh: ujian tempatan).
export function peerConfig() {
  const qs = new URLSearchParams(location.search);
  const custom = qs.get('peer');
  const cfg = { debug: 0 };
  if (custom) {
    const m = custom.match(/^([\w.-]+)(?::(\d+))?$/);
    if (m) {
      const local = m[1] === 'localhost' || m[1] === '127.0.0.1';
      Object.assign(cfg, { host: m[1], port: +(m[2] || 9000), path: '/', secure: !local && location.protocol === 'https:' });
      if (local) cfg.config = { iceServers: [] };
    }
  }
  return cfg;
}

export function peerSupported() {
  return typeof window.Peer === 'function' && typeof window.RTCPeerConnection === 'function';
}

// ------------------------------------------------------------------ HOS
export class HostLink {
  constructor(pin, handlers) {
    this.pin = pin;
    this.h = handlers; // onConnect(conn), onData(conn, msg), onClose(conn), onStatus(status)
    this.conns = new Set();
    this.peer = null;
    this.pingN = 0;
    this.timer = null;
    this.destroyed = false;
  }

  // Buka sambungan dengan ID berdasarkan PIN. Gagal dengan err.type === 'unavailable-id' jika PIN sedang digunakan.
  open(timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const peer = new Peer(peerId(this.pin), peerConfig());
      this.peer = peer;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        try { peer.destroy(); } catch (e) { /* abaikan */ }
        reject(err);
      };
      const to = setTimeout(() => fail(Object.assign(new Error('Tamat masa menyambung ke pelayan'), { type: 'timeout' })), timeoutMs);
      peer.on('open', () => {
        clearTimeout(to);
        settled = true;
        this._startHeartbeat();
        this.h.onStatus && this.h.onStatus('online');
        resolve();
      });
      peer.on('connection', (conn) => this._accept(conn));
      peer.on('disconnected', () => {
        if (this.destroyed) return;
        this.h.onStatus && this.h.onStatus('reconnecting');
        setTimeout(() => {
          if (!this.destroyed && peer.disconnected && !peer.destroyed) {
            try { peer.reconnect(); } catch (e) { /* cuba lagi nanti */ }
          }
        }, 2000);
      });
      peer.on('error', (err) => {
        if (!settled) { clearTimeout(to); fail(err); return; }
        // Ralat selepas dibuka: kebanyakannya sementara (rangkaian). Peer akan cuba sambung semula.
        if (err && (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed')) {
          this.h.onStatus && this.h.onStatus('reconnecting');
        }
      });
    });
  }

  _accept(conn) {
    conn.lastSeen = Date.now();
    conn.on('open', () => {
      conn.lastSeen = Date.now();
      this.conns.add(conn);
      this.h.onConnect && this.h.onConnect(conn);
    });
    conn.on('data', (msg) => {
      conn.lastSeen = Date.now();
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
      if (msg.t === 'pong') { conn.rtt = Date.now() - (msg.at || Date.now()); return; }
      this.h.onData && this.h.onData(conn, msg);
    });
    const closed = () => {
      if (!this.conns.has(conn)) return;
      this.conns.delete(conn);
      this.h.onClose && this.h.onClose(conn);
    };
    conn.on('close', closed);
    conn.on('error', closed);
  }

  // Sambungan dalaman untuk pemain di peranti hos sendiri (hos juga bermain).
  addLocal(conn) {
    this.conns.add(conn);
    this.h.onConnect && this.h.onConnect(conn);
  }

  _startHeartbeat() {
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      const now = Date.now();
      for (const c of this.conns) {
        if (c.local) continue;
        if (now - c.lastSeen > 12000) {
          try { c.close(); } catch (e) { /* abaikan */ }
          this.conns.delete(c);
          this.h.onClose && this.h.onClose(c);
          continue;
        }
        this.send(c, { t: 'ping', at: now });
      }
    }, 3000);
  }

  send(conn, msg) {
    try {
      if (conn && conn.open) conn.send(msg);
    } catch (e) { /* sambungan mungkin baru terputus */ }
  }

  broadcast(msg, filter) {
    for (const c of this.conns) if (!filter || filter(c)) this.send(c, msg);
  }

  close() {
    this.destroyed = true;
    clearInterval(this.timer);
    for (const c of [...this.conns]) { try { c.close(); } catch (e) { /* abaikan */ } }
    this.conns.clear();
    try { this.peer && this.peer.destroy(); } catch (e) { /* abaikan */ }
  }
}

// ------------------------------------------------------------------ PEMAIN / PENONTON
export class ClientLink {
  constructor(pin, handlers) {
    this.pin = pin;
    this.h = handlers; // onOpen(), onData(msg), onStatus(status, info)
    this.peer = null;
    this.conn = null;
    this.everConnected = false;
    this.closed = false;
    this.retryUntil = 0;
    this.lastSeen = 0;
    this.watch = null;
    this.dialTimer = null;
  }

  status(s, info) { this.h.onStatus && this.h.onStatus(s, info); }

  connect() {
    this.closed = false;
    this.status(this.everConnected ? 'reconnecting' : 'connecting');
    this._ensurePeer().then(() => this._dial(), (err) => this._failed(err));
    if (!this.watch) {
      this.watch = setInterval(() => {
        if (this.closed) return;
        if (this.conn && this.conn.open && Date.now() - this.lastSeen > 10000) this._lost('senyap');
      }, 2000);
    }
  }

  _ensurePeer() {
    return new Promise((resolve, reject) => {
      const p = this.peer;
      if (p && !p.destroyed && p.open) { resolve(); return; }
      if (p && !p.destroyed && p.disconnected) {
        try { p.reconnect(); } catch (e) { /* buat peer baru di bawah */ }
      }
      if (p && !p.destroyed) {
        const ok = () => { p.off('open', ok); resolve(); };
        p.on('open', ok);
        setTimeout(() => { if (!p.open) { try { p.destroy(); } catch (e) { /* abaikan */ } this.peer = null; this._ensurePeer().then(resolve, reject); } }, 8000);
        return;
      }
      const peer = new Peer(peerConfig());
      this.peer = peer;
      let opened = false;
      peer.on('open', () => { opened = true; resolve(); });
      peer.on('error', (err) => {
        if (err && err.type === 'peer-unavailable') { this._unavailable(); return; }
        if (!opened) reject(err);
      });
      peer.on('disconnected', () => {
        if (this.closed || peer.destroyed) return;
        setTimeout(() => { if (!this.closed && peer.disconnected && !peer.destroyed) { try { peer.reconnect(); } catch (e) { /* abaikan */ } } }, 1500);
      });
      setTimeout(() => { if (!opened) reject(Object.assign(new Error('Tamat masa'), { type: 'timeout' })); }, 12000);
    });
  }

  _dial() {
    if (this.closed) return;
    clearTimeout(this.dialTimer);
    const conn = this.peer.connect(peerId(this.pin), { serialization: 'json', reliable: true });
    this.pending = conn;
    this.dialTimer = setTimeout(() => {
      if (this.pending === conn && !conn.open) {
        try { conn.close(); } catch (e) { /* abaikan */ }
        this._retryOrFail('timeout');
      }
    }, 12000);
    conn.on('open', () => {
      clearTimeout(this.dialTimer);
      if (this.closed) { conn.close(); return; }
      this.pending = null;
      this.conn = conn;
      this.lastSeen = Date.now();
      this.everConnected = true;
      this.status('connected');
      this.h.onOpen && this.h.onOpen();
    });
    conn.on('data', (msg) => {
      this.lastSeen = Date.now();
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'ping') { this.send({ t: 'pong', at: msg.at }); return; }
      this.h.onData && this.h.onData(msg);
    });
    conn.on('close', () => { if (this.conn === conn) this._lost('tutup'); });
    conn.on('error', () => { if (this.conn === conn) this._lost('ralat'); });
  }

  _unavailable() {
    clearTimeout(this.dialTimer);
    this.pending = null;
    this._retryOrFail('notfound');
  }

  _lost() {
    if (this.closed) return;
    const c = this.conn;
    this.conn = null;
    try { c && c.close(); } catch (e) { /* abaikan */ }
    if (!this.retryUntil) this.retryUntil = Date.now() + 180000;
    this.status('reconnecting');
    setTimeout(() => !this.closed && this.connect(), 1500);
  }

  _retryOrFail(reason) {
    if (this.closed) return;
    if (this.everConnected) {
      if (!this.retryUntil) this.retryUntil = Date.now() + 180000;
      if (Date.now() < this.retryUntil) {
        this.status('reconnecting');
        setTimeout(() => !this.closed && this.connect(), 2500);
        return;
      }
    }
    this.status(reason === 'notfound' ? 'notfound' : 'failed', reason);
  }

  _failed(err) {
    this._retryOrFail(err && err.type === 'peer-unavailable' ? 'notfound' : 'network');
  }

  markStable() { this.retryUntil = 0; }

  send(msg) {
    try {
      if (this.conn && this.conn.open) { this.conn.send(msg); return true; }
    } catch (e) { /* abaikan */ }
    return false;
  }

  close() {
    this.closed = true;
    clearInterval(this.watch);
    clearTimeout(this.dialTimer);
    this.watch = null;
    try { this.conn && this.conn.close(); } catch (e) { /* abaikan */ }
    try { this.peer && this.peer.destroy(); } catch (e) { /* abaikan */ }
    this.conn = null;
    this.peer = null;
  }
}

// ------------------------------------------------------------------ PEMAIN DI PERANTI HOS
// Hos juga seorang pemain. Daripada sambung ke diri sendiri melalui WebRTC, pemain hos
// guna saluran dalaman ini yang meniru antara muka ClientLink (connect/send/close).
const clone = (m) => JSON.parse(JSON.stringify(m));

export class LocalLink {
  constructor(hostLink, handlers) {
    this.hostLink = hostLink;
    this.h = handlers; // onOpen(), onData(msg), onStatus(status)
    this.conn = null;
  }

  connect() {
    if (this.conn && this.conn.open) return;
    const self = this;
    const conn = {
      local: true,
      open: true,
      lastSeen: Date.now(),
      send(msg) {
        if (!conn.open) return;
        const m = clone(msg);
        setTimeout(() => { if (conn.open && m && m.t !== 'ping') self.h.onData && self.h.onData(m); }, 0);
      },
      close() {
        if (!conn.open) return;
        conn.open = false;
        const link = self.hostLink;
        if (link.conns.has(conn)) {
          link.conns.delete(conn);
          link.h.onClose && link.h.onClose(conn);
        }
      },
    };
    this.conn = conn;
    this.hostLink.addLocal(conn);
    this.h.onStatus && this.h.onStatus('connected');
    setTimeout(() => this.h.onOpen && this.h.onOpen(), 0);
  }

  markStable() { /* tiada rangkaian untuk dipulihkan */ }

  send(msg) {
    const conn = this.conn;
    if (!conn || !conn.open) return false;
    const m = clone(msg);
    setTimeout(() => {
      if (conn.open && this.hostLink.h.onData) this.hostLink.h.onData(conn, m);
    }, 0);
    return true;
  }

  close() {
    if (this.conn) this.conn.close();
    this.conn = null;
  }
}
