// Pairing a remote (an iPad) with the station (the computer with the mixer).
//
// Three routes, best first:
//  * direct — a WebRTC data channel, usually straight across the Wi-Fi. Taps
//    arrive in a few milliseconds and the remote's clock can be synced to the
//    station's audio clock closely enough to time a loop's end.
//  * local — a BroadcastChannel, for a remote in another tab of the same
//    browser.
//  * cloud — the Firebase Realtime Database the Graphics Studio remote uses,
//    under sessions/loopback-<room>. It carries the WebRTC handshake, and
//    commands and state whenever the direct route isn't up.
//
// Messages are small JSON objects: remote → station `hello`, `cmd`, `ping`;
// station → remote `state`, `meter`, `pong`.

import { firebaseConfig } from '../../graphics/app/firebase.js';

const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const ROOM_RE = /^[a-z0-9]{8,40}$/;
const epoch = () => (performance.timeOrigin + performance.now()) / 1000;
const rid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

let loading;
function script(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => { s.remove(); reject(new Error('Couldn’t reach the pairing service. Check the internet connection.')); };
    document.head.append(s);
  });
}
function database() {
  if (!loading) loading = (async () => {
    if (!window.firebase) await script('https://www.gstatic.com/firebasejs/9.22.1/firebase-app-compat.js');
    if (!window.firebase.database) await script('https://www.gstatic.com/firebasejs/9.22.1/firebase-database-compat.js');
    const fb = window.firebase;
    const app = fb.apps.find((a) => a.name === 'loopback') || fb.initializeApp(firebaseConfig, 'loopback');
    return app.database();
  })().catch((err) => { loading = null; throw err; });
  return loading;
}
const TS = () => window.firebase.database.ServerValue.TIMESTAMP;

export function newRoom() { return rid() + rid(); }
export const validRoom = (room) => ROOM_RE.test(room || '');

// ---- the station ------------------------------------------------------------------

export class Host {
  constructor({ room, onCommand, heard }) {
    this.room = room;
    this.onCommand = onCommand;
    this.heard = heard;
    this.peers = new Map();
    this.local = new Map();   // remotes seen on the BroadcastChannel → last heard
    this.cloudRemotes = new Map();   // …and through the cloud
    this.cloud = 'off';
    this.error = '';
    this.statusFns = new Set();
    this.state = null;
    this.seen = new Set();
    this.bc = typeof BroadcastChannel === 'function' ? new BroadcastChannel(`loopback-${room}`) : null;
    if (this.bc) this.bc.onmessage = (e) => this.receive(e.data, (m) => this.bc.postMessage(m), 'local');
  }

  onStatus(fn) { this.statusFns.add(fn); fn(this.status()); }
  status() {
    const now = Date.now(), ids = new Set();
    for (const [id, t] of this.local) if (now - t < 6000) ids.add(id);
    let direct = 0;
    for (const p of this.peers.values()) if (p.dc?.readyState === 'open') { direct++; ids.add(p.remote || p); }
    for (const [id, t] of this.cloudRemotes) if (now - t < 6000) ids.add(id);
    return { cloud: this.cloud, error: this.error, direct, remotes: ids.size };
  }
  changed() { const s = this.status(); this.statusFns.forEach((fn) => fn(s)); }

  async startCloud() {
    if (this.ref) return;
    this.cloud = 'connecting';
    this.changed();
    try {
      const db = await database();
      this.db = db;
      this.ref = db.ref(`sessions/loopback-${this.room}`);
      await this.ref.child('signal').remove();
      const fail = (err) => { this.cloud = 'error'; this.error = err.message; this.changed(); };
      this.ref.child('commands').on('child_added', (snap) => {
        const rec = snap.val();
        snap.ref.remove().catch(() => {});
        if (!rec || typeof rec.data !== 'string' || Date.now() + this.offset - rec.sentAt > 15000) return;
        try {
          const msg = JSON.parse(rec.data);
          this.receive(msg, (m) => this.ref.child(`pong/${msg.from}`).set({ data: JSON.stringify(m), sentAt: TS() }), 'cloud');
        } catch {}
      }, fail);
      this.ref.child('signal').on('child_added', (snap) => this.acceptPeer(snap.key), fail);
      this.offset = 0;
      db.ref('.info/serverTimeOffset').on('value', (s) => { this.offset = s.val() || 0; });
      db.ref('.info/connected').on('value', async (snap) => {
        if (!snap.val()) { this.cloud = 'offline'; this.changed(); return; }
        try {
          await this.ref.child('host').onDisconnect().remove();
          await this.ref.child('state').onDisconnect().remove();
          await this.ref.child('host').set({ at: TS() });
          this.cloud = 'online';
          this.error = '';
          this.changed();
          if (this.state) this.writeState(true);
        } catch (err) { fail(err); }
      });
    } catch (err) {
      this.ref = null;
      this.cloud = 'error';
      this.error = err.message;
      this.changed();
    }
  }

  stopCloud() {
    if (!this.ref) return;
    this.ref.child('commands').off();
    this.ref.child('signal').off();
    this.ref.child('host').remove().catch(() => {});
    this.ref.child('state').remove().catch(() => {});
    for (const id of [...this.peers.keys()]) this.dropPeer(id);
    this.ref = null;
    this.cloud = 'off';
    this.changed();
  }

  close() {
    this.stopCloud();
    this.bc?.close();
    this.bc = null;
  }

  async acceptPeer(id) {
    if (this.peers.has(id) || !this.ref) return;
    const sig = this.ref.child(`signal/${id}`);
    const peer = { pc: null, dc: null, sig };
    this.peers.set(id, peer);
    sig.child('offer').on('value', async (snap) => {
      const offer = snap.val();
      if (!offer || peer.pc) return;
      const pc = (peer.pc = new RTCPeerConnection(ICE));
      pc.onicecandidate = (e) => { if (e.candidate) sig.child('host').push(JSON.stringify(e.candidate)); };
      pc.onconnectionstatechange = () => {
        if (['failed', 'closed'].includes(pc.connectionState)) this.dropPeer(id);
        this.changed();
      };
      pc.ondatachannel = (e) => {
        const dc = (peer.dc = e.channel);
        const reply = (m) => { if (dc.readyState === 'open') dc.send(JSON.stringify(m)); };
        dc.onopen = () => { this.changed(); if (this.state) reply({ t: 'state', state: this.state }); };
        dc.onclose = () => this.changed();
        dc.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.from && !peer.remote) { peer.remote = msg.from; this.changed(); }
            this.receive(msg, reply, 'direct');
          } catch {}
        };
      };
      try {
        await pc.setRemoteDescription(JSON.parse(offer));
        await pc.setLocalDescription(await pc.createAnswer());
        await sig.child('answer').set(JSON.stringify(pc.localDescription));
        sig.child('peer').on('child_added', (c) => pc.addIceCandidate(JSON.parse(c.val())).catch(() => {}));
      } catch (err) { console.warn('Pairing handshake failed', err); this.dropPeer(id); }
    });
    sig.on('value', (snap) => { if (!snap.exists() && peer.pc) this.dropPeer(id); });
  }

  dropPeer(id) {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    p.sig.off();
    p.sig.child('offer').off();
    p.sig.child('peer').off();
    try { p.dc?.close(); p.pc?.close(); } catch {}
    this.changed();
  }

  receive(msg, reply, route) {
    if (!msg || typeof msg !== 'object') return;
    if (route === 'local' && ['state', 'meter', 'pong'].includes(msg.t)) return;   // another station
    if (route !== 'direct' && msg.from) {
      const seen = route === 'local' ? this.local : this.cloudRemotes;
      const fresh = !seen.has(msg.from);
      seen.set(msg.from, Date.now());
      if (fresh) this.changed();
    }
    if (msg.t === 'hello') { if (this.state) reply({ t: 'state', state: this.state }); return; }
    if (msg.t === 'ping') { reply({ t: 'pong', id: msg.id, t0: msg.t0, heard: this.heard(), to: msg.from }); return; }
    if (msg.t === 'cmd') {
      if (this.seen.has(msg.id)) return;
      this.seen.add(msg.id);
      if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value);
      this.onCommand(msg.cmd, msg.args || {}, route);
    }
  }

  /** Send the latest state to every remote. */
  publish(state) {
    this.state = state;
    const m = JSON.stringify({ t: 'state', state });
    for (const p of this.peers.values()) if (p.dc?.readyState === 'open') p.dc.send(m);
    this.bc?.postMessage({ t: 'state', state });
    this.writeState();
  }

  writeState(now = false) {
    if (!this.ref || this.cloud !== 'online') return;
    clearTimeout(this.stateTimer);
    const write = () => this.ref.child('state').set({ data: JSON.stringify(this.state), sentAt: TS() }).catch(() => {});
    if (now) write(); else this.stateTimer = setTimeout(write, 250);
  }

  /** Input peaks for remotes' live waveforms — direct and local routes only. */
  meter(first, bytes) {
    const direct = [...this.peers.values()].filter((p) => p.dc?.readyState === 'open');
    const local = this.local.size && [...this.local.values()].some((t) => Date.now() - t < 6000);
    if (!direct.length && !local) return;
    const m = { t: 'meter', b: first, p: bytes };
    const s = JSON.stringify(m);
    for (const p of direct) p.dc.send(s);
    if (local) this.bc?.postMessage(m);
  }
}

// ---- a remote -------------------------------------------------------------------

export class Remote {
  constructor({ room, onState, onMeter, cloudOnly = false }) {
    this.room = room;
    this.cloudOnly = cloudOnly;
    this.id = rid();
    this.onState = onState;
    this.onMeter = onMeter;
    this.statusFns = new Set();
    this.route = 'none';
    this.cloud = 'connecting';
    this.hostOnline = null;
    this.samples = [];
    this.offset = null;
    this.lastLocal = 0;
    this.pings = new Map();
    this.bc = typeof BroadcastChannel === 'function' && !cloudOnly ? new BroadcastChannel(`loopback-${room}`) : null;
    if (this.bc) this.bc.onmessage = (e) => {
      if (!['state', 'meter', 'pong'].includes(e.data?.t)) return;
      if (e.data.t === 'pong' && e.data.to !== this.id) return;
      this.lastLocal = Date.now();
      this.receive(e.data, 'local');
    };
  }

  onStatus(fn) { this.statusFns.add(fn); fn(this.status()); }
  status() {
    return { route: this.bestRoute(), cloud: this.cloud, host: this.hostOnline, rtt: this.rtt ?? null, synced: this.offset !== null, error: this.error || '' };
  }
  changed() { const s = this.status(); this.statusFns.forEach((fn) => fn(s)); }

  bestRoute() {
    if (this.dc?.readyState === 'open') return 'direct';
    if (Date.now() - this.lastLocal < 4000) return 'local';
    if (this.ref && this.cloud === 'online') return 'cloud';
    return 'none';
  }

  start() {
    this.post({ t: 'hello' }, 'local');
    this.connectCloud();
    this.timer = setInterval(() => this.ping(), 1000);
    for (let i = 1; i <= 5; i++) setTimeout(() => this.ping(), i * 150);
  }

  async connectCloud() {
    try {
      const db = await database();
      this.ref = db.ref(`sessions/loopback-${this.room}`);
      const fail = (err) => { this.cloud = 'error'; this.error = err.message; this.changed(); };
      this.ref.child('state').on('value', (snap) => {
        const rec = snap.val();
        if (!rec?.data || ['direct', 'local'].includes(this.bestRoute())) return;
        try { this.receive({ t: 'state', state: JSON.parse(rec.data) }, 'cloud'); } catch {}
      }, fail);
      this.ref.child('host').on('value', (snap) => {
        const was = this.hostOnline;
        this.hostOnline = snap.exists();
        if (this.hostOnline && !was && this.dc?.readyState !== 'open') this.connectDirect();
        this.changed();
      }, fail);
      this.ref.child(`pong/${this.id}`).on('value', (snap) => {
        const rec = snap.val();
        if (rec?.data) try { this.receive(JSON.parse(rec.data), 'cloud'); } catch {}
      });
      this.ref.child(`pong/${this.id}`).onDisconnect().remove();
      db.ref('.info/connected').on('value', (snap) => { this.cloud = snap.val() ? 'online' : 'offline'; this.changed(); });
    } catch (err) {
      this.cloud = 'error';
      this.error = err.message;
      this.changed();
    }
  }

  async connectDirect() {
    if (this.connecting || this.cloudOnly || !this.ref || typeof RTCPeerConnection !== 'function') return;
    this.connecting = true;
    this.closeDirect();
    const peerId = rid();
    const sig = (this.sig = this.ref.child(`signal/${peerId}`));
    const pc = (this.pc = new RTCPeerConnection(ICE));
    const dc = (this.dc = pc.createDataChannel('loopback', { ordered: true }));
    const retry = () => {
      if (this.pc !== pc) return;
      this.closeDirect();
      this.changed();
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => { if (this.hostOnline) this.connectDirect(); }, 5000);
    };
    try {
      await sig.onDisconnect().remove();
      pc.onicecandidate = (e) => { if (e.candidate) sig.child('peer').push(JSON.stringify(e.candidate)); };
      pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) retry(); };
      dc.onopen = () => {
        clearTimeout(this.openTimer);
        this.samples = [];
        this.post({ t: 'hello' });
        for (let i = 0; i < 6; i++) setTimeout(() => this.ping(), i * 120);
        this.changed();
      };
      dc.onclose = retry;
      dc.onmessage = (e) => { try { this.receive(JSON.parse(e.data), 'direct'); } catch {} };
      await pc.setLocalDescription(await pc.createOffer());
      await sig.child('offer').set(JSON.stringify(pc.localDescription));
      sig.child('answer').on('value', async (snap) => {
        if (!snap.val() || pc.remoteDescription) return;
        await pc.setRemoteDescription(JSON.parse(snap.val()));
        sig.child('host').on('child_added', (c) => pc.addIceCandidate(JSON.parse(c.val())).catch(() => {}));
      });
      this.openTimer = setTimeout(() => { if (dc.readyState !== 'open') retry(); }, 15000);
    } catch (err) {
      console.warn('Direct link failed', err);
      retry();
    } finally {
      this.connecting = false;
    }
  }

  closeDirect() {
    clearTimeout(this.openTimer);
    if (this.sig) { this.sig.off(); this.sig.child('answer').off(); this.sig.child('host').off(); this.sig.remove().catch(() => {}); }
    try { this.dc?.close(); this.pc?.close(); } catch {}
    this.sig = this.pc = this.dc = null;
  }

  post(msg, route = this.bestRoute()) {
    msg.from = this.id;
    if (route === 'direct') this.dc.send(JSON.stringify(msg));
    else if (route === 'local') this.bc?.postMessage(msg);
    else if (route === 'cloud') this.ref.child('commands').push({ data: JSON.stringify(msg), sentAt: TS() });
    else return false;
    return true;
  }

  send(cmd, args = {}) {
    if (!this.post({ t: 'cmd', id: rid(), cmd, args })) throw new Error('Not connected to the computer.');
  }

  ping() {
    const route = this.bestRoute();
    if (route === 'none' || (route === 'cloud' && this.samples.length >= 3 && Math.random() < 0.7)) return;
    const id = rid();
    this.pings.set(id, route);
    this.post({ t: 'ping', id, t0: epoch() }, route);
  }

  receive(m, route) {
    if (m.t === 'state') {
      this.onState(m.state);
      this.changed();
    } else if (m.t === 'meter') this.onMeter(m.b, m.p);
    else if (m.t === 'pong' && this.pings.has(m.id)) {
      this.pings.delete(m.id);
      const t1 = epoch(), rtt = t1 - m.t0;
      this.samples.push({ rtt, offset: m.heard - (m.t0 + t1) / 2, at: t1 });
      this.samples = this.samples.filter((s) => t1 - s.at < 30).slice(-12);
      const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
      this.offset = best.offset;
      this.rtt = best.rtt;
      this.changed();
    }
  }

  /** The station's heard time, now or at an event's timestamp. */
  clock(ev) {
    if (this.offset === null) return null;
    const t = ev?.timeStamp ? (performance.timeOrigin + ev.timeStamp) / 1000 : epoch();
    return t + this.offset;
  }
}
