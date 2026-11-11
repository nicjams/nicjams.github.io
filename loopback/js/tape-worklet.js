// The tape machine. Runs on the audio thread so every recording and playback
// is placed on the same sample clock (the context's frame counter):
//
//  * capture — the input is kept for the last few seconds, or from a `keep`
//    frame onwards while a loop or a solo is being recorded. Frames are the
//    context's own, so "what came in at frame f" is exact.
//  * voices — loops and one-shots that play either an array sent from the
//    page or a stretch of the capture itself. Reading the capture lets a loop
//    start playing the instant it is closed, and lets a solo play back one
//    window after it was played, before the page has even seen the audio.
//  * metronome — clicks on a beat grid, accented on each bar.
//
// The page only ever speaks in frames; see engine.js.

const CHUNK = 16384;   // a multiple of the 128-frame render quantum

function makeClick(freq, amp) {
  const n = Math.round(0.05 * sampleRate), buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    buf[i] = amp * Math.sin(2 * Math.PI * freq * t) * Math.exp(-t / 0.011);
  }
  return buf;
}

const VOICE_KEYS = ['data', 'from', 'length', 'period', 'anchor', 'start', 'stop', 'fadeIn', 'fadeOut', 'gain'];

class Tape extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = new Map();
    this.pool = [];
    this.low = Infinity;
    this.keeps = new Map();
    this.keepFrom = Infinity;
    this.history = Math.round(4 * sampleRate);
    this.channel = 'mix';
    this.inputChannels = 0;   // how many arrive, reported to the page when it changes
    this.voices = new Map();
    this.metro = null;
    this.clicks = [];
    this.accent = makeClick(1568, 0.9);
    this.beat = makeClick(1046, 0.6);
    this.smooth = 1 - Math.exp(-1 / (0.012 * sampleRate));
    this.meter = new Float32Array(8);
    this.meterN = 0;
    this.meterFrame = 0;
    this.port.onmessage = (e) => this.handle(e.data);
  }

  handle(m) {
    const now = currentFrame;
    switch (m.type) {
      case 'voice': {
        const v = { data: null, from: 0, length: 0, period: 0, anchor: 0, start: now, stop: Infinity,
          fadeIn: 64, fadeOut: 64, gain: 1 };
        for (const k of VOICE_KEYS) if (m[k] !== undefined && m[k] !== null) v[k] = m[k];
        if (v.data) v.length = v.data.length;
        v.g = v.gain;
        this.voices.set(m.id, v);
        break;
      }
      case 'update': {
        const v = this.voices.get(m.id);
        if (!v) break;
        for (const k of VOICE_KEYS) if (m[k] !== undefined && m[k] !== null) v[k] = m[k];
        if (m.data) v.length = m.data.length;
        break;
      }
      case 'stop': {
        const ids = m.id === undefined ? [...this.voices.keys()] : [m.id];
        for (const id of ids) {
          const v = this.voices.get(id);
          const fade = m.fade ?? 256, end = Math.max(m.at ?? now, now) + fade;
          if (v && end < v.stop) { v.stop = end; v.fadeOut = fade; }
        }
        break;
      }
      case 'metro':
        this.metro = { anchor: m.anchor, interval: m.interval, bpb: m.bpb || 4, from: m.from ?? now,
          until: m.until ?? Infinity, gain: m.gain ?? 0.5 };
        break;
      case 'metroOff':
        if (this.metro) this.metro.until = Math.min(this.metro.until, Math.max(now, m.at ?? now));
        break;
      case 'metroGain':
        if (this.metro) this.metro.gain = m.gain;
        break;
      case 'keep':
      case 'release':
        if (m.type === 'keep') this.keeps.set(m.id, m.from); else this.keeps.delete(m.id);
        this.keepFrom = Math.min(Infinity, ...this.keeps.values());
        break;
      case 'channel': this.channel = m.mode; break;
      case 'recount': this.inputChannels = -1; break;
      case 'extract': {
        const data = this.read(m.from, m.to - m.from);
        this.port.postMessage({ type: 'extract', id: m.id, data }, [data.buffer]);
        break;
      }
    }
  }

  // ---- capture --------------------------------------------------------------

  at(frame) {
    const idx = Math.floor(frame / CHUNK), c = this.chunks.get(idx);
    return c ? c[frame - idx * CHUNK] : 0;
  }

  read(from, len) {
    const out = new Float32Array(Math.max(0, len));
    for (let i = 0; i < out.length;) {
      const f = from + i, idx = Math.floor(f / CHUNK), off = f - idx * CHUNK;
      const n = Math.min(CHUNK - off, out.length - i), c = this.chunks.get(idx);
      if (c) out.set(c.subarray(off, off + n), i);
      i += n;
    }
    return out;
  }

  capture(f0, input) {
    const n = input[0].length, idx = Math.floor(f0 / CHUNK), off = f0 - idx * CHUNK;
    let c = this.chunks.get(idx);
    if (!c) {
      c = this.pool.pop() || new Float32Array(CHUNK);
      c.fill(0);
      this.chunks.set(idx, c);
      if (idx < this.low) this.low = idx;
    }
    const pick = this.channel === 'mix' ? -1 : Math.min(input.length - 1, this.channel | 0);
    const a = pick >= 0 ? input[pick] : input[0], b = pick >= 0 ? a : input[1] || a;
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const s = (a[i] + b[i]) * 0.5;
      c[off + i] = s;
      const v = s < 0 ? -s : s;
      if (v > peak) peak = v;
    }
    const keepFrom = Math.min(this.keepFrom, f0 - this.history);
    while (this.low <= idx && (this.low + 1) * CHUNK <= keepFrom) {
      const old = this.chunks.get(this.low);
      if (old) { this.chunks.delete(this.low); this.pool.push(old); }
      this.low++;
    }
    return peak;
  }

  // ---- playback -------------------------------------------------------------

  renderVoice(v, out, f0) {
    const n = out.length;
    for (let i = 0; i < n; i++) {
      const f = f0 + i;
      if (f < v.start || f >= v.stop) continue;
      let p = f - v.anchor;
      if (v.period) p = ((p % v.period) + v.period) % v.period;
      if (p < 0 || p >= v.length) continue;
      const s = v.data ? v.data[p] : this.at(v.from + p);
      let env = 1;
      if (f - v.start < v.fadeIn) env = (f - v.start) / v.fadeIn;
      if (v.stop - f < v.fadeOut) env = Math.min(env, (v.stop - f) / v.fadeOut);
      v.g += (v.gain - v.g) * this.smooth;
      out[i] += s * env * v.g;
    }
  }

  renderClicks(out, f0) {
    const n = out.length, m = this.metro;
    if (m) {
      let k = Math.ceil((Math.max(f0, m.from) - 0.5 - m.anchor) / m.interval);
      for (;; k++) {
        const at = Math.round(m.anchor + k * m.interval);
        if (at >= f0 + n || at >= m.until) break;
        if (at < f0 || at < m.from) continue;
        const accent = ((k % m.bpb) + m.bpb) % m.bpb === 0;
        this.clicks.push({ buf: accent ? this.accent : this.beat, at, gain: m.gain });
      }
      if (m.until <= f0) this.metro = null;
    }
    for (const c of this.clicks) {
      for (let i = Math.max(0, c.at - f0); i < n; i++) {
        const p = f0 + i - c.at;
        if (p >= c.buf.length) break;
        out[i] += c.buf[p] * c.gain;
      }
    }
    this.clicks = this.clicks.filter((c) => f0 + n - c.at < c.buf.length);
  }

  process(inputs, outputs) {
    const f0 = currentFrame, out = outputs[0][0], input = inputs[0];
    const peak = input && input.length ? this.capture(f0, input) : 0;
    if ((input ? input.length : 0) !== this.inputChannels) {
      this.inputChannels = input ? input.length : 0;
      this.port.postMessage({ type: 'channels', n: this.inputChannels });
    }
    if (this.meterN === 0) this.meterFrame = f0;
    this.meter[this.meterN++] = peak;
    if (this.meterN === this.meter.length) {
      this.port.postMessage({ type: 'meter', frame: this.meterFrame, peaks: this.meter.slice() });
      this.meterN = 0;
    }
    out.fill(0);
    for (const [id, v] of this.voices) {
      this.renderVoice(v, out, f0);
      if (f0 + out.length >= v.stop) this.voices.delete(id);
    }
    this.renderClicks(out, f0);
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    return true;
  }
}

registerProcessor('tape', Tape);
