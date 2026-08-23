/* Audio engine: one synth voice per paintbrush, plus the transport scheduler. */

import { midiToFreq, clamp } from './music.js';

const LOOKAHEAD = 0.12;   // seconds of notes scheduled in advance
const TICK = 25;          // scheduler wake-up interval, ms

/*
 * Paintbrushes. Each one is an instrument: a colour on the canvas, a synth
 * voice, and a MIDI channel/program for export.
 */
export const BRUSHES = [
  { id: 'bass',    name: 'Bass',    color: '#1170a8', voice: 'bass',   program: 33, chan: 0, gain: 0.9, range: [36, 60] },
  { id: 'keys',    name: 'Keys',    color: '#c07800', voice: 'keys',   program: 4,  chan: 1, gain: 0.7, range: [48, 84] },
  { id: 'strings', name: 'Strings', color: '#7b3fd4', voice: 'pad',    program: 48, chan: 2, gain: 0.5, range: [48, 84] },
  { id: 'lead',    name: 'Lead',    color: '#c2185b', voice: 'lead',   program: 81, chan: 3, gain: 0.6, range: [55, 91] },
  { id: 'bells',   name: 'Bells',   color: '#0f8a5f', voice: 'bell',   program: 14, chan: 4, gain: 0.6, range: [60, 96] },
  { id: 'pluck',   name: 'Pluck',   color: '#d1541b', voice: 'pluck',  program: 24, chan: 5, gain: 0.8, range: [48, 84] },
  { id: 'drums',   name: 'Drums',   color: '#4b5563', voice: 'drum',   program: 0,  chan: 9, gain: 1.0, kit: true },
];

export const brushById = id => BRUSHES.find(b => b.id === id) || BRUSHES[0];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.buses = {};          // brush id -> gain node
    this.levels = {};         // brush id -> 0..1 user level
    this.playing = false;
    this.timer = null;
    this.loopStart = 0;       // ctx time at beat 0 of the current cycle
    this.cursor = 0;          // beats already scheduled in this cycle
    this.bpm = 100;
    this.totalBeats = 16;
    this.noteSource = () => [];
    this.onCycle = null;
    BRUSHES.forEach(b => { this.levels[b.id] = 1; });
  }

  async ensureCtx() {
    if (!this.ctx) {
      // iOS puts Web Audio on the ringer channel unless the page asks for a
      // playback session -- without this the app is silent whenever the phone's
      // mute switch is on, with no other sign that anything is wrong
      try {
        if (navigator.audioSession) navigator.audioSession.type = 'playback';
      } catch (e) { /* not supported, carry on */ }
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;

      this.reverb = this.ctx.createConvolver();
      this.reverb.buffer = this._impulse(1.8, 2.2);
      this.reverbGain = this.ctx.createGain();
      this.reverbGain.gain.value = 0.35;
      this.reverb.connect(this.reverbGain).connect(this.master);

      this.master.connect(this.ctx.destination);
      this._unlock();
      BRUSHES.forEach(b => {
        const g = this.ctx.createGain();
        g.gain.value = b.gain;
        g.connect(this.master);
        const send = this.ctx.createGain();
        send.gain.value = b.voice === 'drum' ? 0.08 : 0.22;
        g.connect(send).connect(this.reverb);
        this.buses[b.id] = g;
      });
    }
    // 'interrupted' is an iOS-only state (a call, Siri, the page going away);
    // anything that is not 'running' should be resumed
    if (this.ctx.state !== 'running') {
      try { await this.ctx.resume(); } catch (e) { /* needs another gesture */ }
    }
    return this.ctx;
  }

  /* True while the browser is holding audio back and needs a user gesture. */
  get blocked() {
    return !this.ctx || this.ctx.state !== 'running';
  }

  /* Older iOS only opens the output once a source has run inside a gesture. */
  _unlock() {
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      src.connect(this.ctx.destination);
      src.start(0);
    } catch (e) { /* nothing to unlock */ }
  }

  /*
   * Mobile browsers throttle timers in the background, so the scheduler can
   * come back to find its cursor far behind. Anything already in the past is
   * dropped rather than fired as one clump.
   */
  _stale(time) {
    return time < this.ctx.currentTime - 0.05;
  }

  /* Exponentially decaying noise: a cheap, decent plate. */
  _impulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  setLevel(brushId, v) {
    this.levels[brushId] = v;
    const b = brushById(brushId);
    if (this.buses[brushId]) this.buses[brushId].gain.value = b.gain * v;
  }

  setMaster(v) { if (this.master) this.master.gain.value = v; }

  /* ---- transport ------------------------------------------------------- */

  get beatsPerSecond() { return this.bpm / 60; }

  /* Current playhead position in beats, or null when stopped. */
  position() {
    if (!this.playing || !this.ctx) return null;
    const b = (this.ctx.currentTime - this.loopStart) * this.beatsPerSecond;
    return ((b % this.totalBeats) + this.totalBeats) % this.totalBeats;
  }

  async start(fromBeat = 0) {
    await this.ensureCtx();
    if (this.playing) return;
    this.playing = true;
    this.cursor = fromBeat;
    this.loopStart = this.ctx.currentTime - fromBeat / this.beatsPerSecond;
    this.timer = setInterval(() => this._schedule(), TICK);
    this._schedule();
  }

  stop() {
    this.playing = false;
    clearInterval(this.timer);
    this.timer = null;
  }

  /* Keep the playhead where it is while the tempo changes underneath it. */
  setTempo(bpm) {
    const pos = this.position();
    this.bpm = bpm;
    if (this.playing && pos !== null) {
      this.loopStart = this.ctx.currentTime - pos / this.beatsPerSecond;
      this.cursor = pos;
    }
  }

  setLength(totalBeats) {
    this.totalBeats = totalBeats;
    if (this.cursor > totalBeats) this.cursor = 0;
  }

  _schedule() {
    if (!this.playing) return;
    const bps = this.beatsPerSecond;
    const horizon = (this.ctx.currentTime + LOOKAHEAD - this.loopStart) * bps;
    const notes = this.noteSource();

    while (this.cursor < horizon) {
      const until = Math.min(horizon, this.totalBeats);
      for (const n of notes) {
        if (n.start >= this.cursor && n.start < until) {
          const at = this.loopStart + n.start / bps;
          if (!this._stale(at)) this.play(n, at, n.dur / bps);
        }
      }
      this.cursor = until;
      if (this.cursor >= this.totalBeats) {
        // wrap into the next cycle
        this.loopStart += this.totalBeats / bps;
        this.cursor = 0;
        if (this.onCycle) this.onCycle();
        if (horizon - this.totalBeats <= 0) break;
        return this._schedule();
      }
    }
  }

  /* ---- voices ---------------------------------------------------------- */

  /* Play one note. `when`/`dur` are in seconds; omit them to audition now. */
  play(note, when, dur) {
    if (!this.ctx) return;
    const b = brushById(note.brush);
    const t = when === undefined ? this.ctx.currentTime + 0.01 : when;
    const d = Math.max(0.05, dur === undefined ? 0.3 : dur);
    const vel = clamp((note.vel || 90) / 127, 0.05, 1);
    const out = this.buses[b.id] || this.master;
    const f = midiToFreq(note.midi);
    switch (b.voice) {
      case 'bass':  return this._bass(f, t, d, vel, out);
      case 'keys':  return this._fm(f, t, d, vel, out, 3, 4, 0.9);
      case 'bell':  return this._fm(f, t, Math.max(d, 0.9), vel, out, 3.5, 7, 2.4);
      case 'pad':   return this._pad(f, t, d, vel, out);
      case 'lead':  return this._lead(f, t, d, vel, out);
      case 'pluck': return this._pluck(f, t, d, vel, out);
      case 'drum':  return this._drum(note.midi, t, vel, out);
    }
  }

  _env(t, d, vel, a, r, peak = 1) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vel * peak), t + a);
    g.gain.setValueAtTime(Math.max(0.0002, vel * peak), t + Math.max(a, d));
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a, d) + r);
    return g;
  }

  _stop(nodes, t, d, r) {
    nodes.forEach(n => { n.start(t); n.stop(t + d + r + 0.1); });
  }

  _bass(f, t, d, vel, out) {
    const o = this.ctx.createOscillator(), sub = this.ctx.createOscillator();
    o.type = 'triangle'; o.frequency.value = f;
    sub.type = 'sine'; sub.frequency.value = f / 2;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(f * 8, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(120, f * 2), t + d * 0.8 + 0.1);
    const g = this._env(t, d, vel, 0.012, 0.12, 0.9);
    o.connect(lp); sub.connect(lp); lp.connect(g).connect(out);
    this._stop([o, sub], t, d, 0.12);
  }

  /* Two-operator FM: Rhodes-ish at low index, bell at high index. */
  _fm(f, t, d, vel, out, ratio, index, decay) {
    const car = this.ctx.createOscillator(), mod = this.ctx.createOscillator();
    car.frequency.value = f;
    mod.frequency.value = f * ratio;
    const modGain = this.ctx.createGain();
    modGain.gain.setValueAtTime(f * index * vel, t);
    modGain.gain.exponentialRampToValueAtTime(0.01, t + decay);
    mod.connect(modGain).connect(car.frequency);
    const g = this._env(t, d, vel, 0.005, Math.min(1.6, d + 0.5), 0.7);
    car.connect(g).connect(out);
    this._stop([car, mod], t, d, Math.min(1.6, d + 0.5));
  }

  _pad(f, t, d, vel, out) {
    const g = this._env(t, d, vel, Math.min(0.35, d * 0.5 + 0.06), 0.5, 0.35);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(f * 2, t);
    lp.frequency.linearRampToValueAtTime(f * 6, t + d);
    lp.Q.value = 2;
    const oscs = [-7, 0, 7].map(cents => {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = cents;
      o.connect(lp);
      return o;
    });
    lp.connect(g).connect(out);
    this._stop(oscs, t, d, 0.5);
  }

  _lead(f, t, d, vel, out) {
    const o = this.ctx.createOscillator(), o2 = this.ctx.createOscillator();
    o.type = 'square'; o.frequency.value = f;
    o2.type = 'sawtooth'; o2.frequency.value = f; o2.detune.value = 6;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 6;
    lp.frequency.setValueAtTime(f * 10, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(200, f * 3), t + 0.18);
    const g = this._env(t, d, vel, 0.008, 0.14, 0.45);
    o.connect(lp); o2.connect(lp); lp.connect(g).connect(out);
    this._stop([o, o2], t, d, 0.14);
  }

  /* Karplus-Strong: noise burst round a short filtered delay line. */
  _pluck(f, t, d, vel, out) {
    const len = 0.2;
    const noise = this.ctx.createBufferSource();
    const buf = this.ctx.createBuffer(1, Math.ceil(this.ctx.sampleRate * len), this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    const burst = Math.ceil(this.ctx.sampleRate / f);
    for (let i = 0; i < burst; i++) data[i] = (Math.random() * 2 - 1);
    noise.buffer = buf;

    const delay = this.ctx.createDelay(0.1);
    delay.delayTime.value = 1 / f;
    const fb = this.ctx.createGain();
    fb.gain.value = clamp(0.88 + Math.min(0.09, d * 0.05), 0.5, 0.985);
    const damp = this.ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = clamp(f * 6, 800, 9000);

    delay.connect(damp).connect(fb).connect(delay);
    noise.connect(delay);
    const g = this._env(t, Math.min(d, 2), vel, 0.002, 0.25, 0.8);
    delay.connect(g).connect(out);
    noise.start(t);
    noise.stop(t + len);
    setTimeout(() => { try { fb.disconnect(); } catch (e) { /* already gone */ } },
      (t - this.ctx.currentTime + d + 1.2) * 1000);
  }

  _drum(midi, t, vel, out) {
    const noiseBurst = (dur, hz, type, peak) => {
      const src = this.ctx.createBufferSource();
      const n = Math.ceil(this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
      src.buffer = buf;
      const bp = this.ctx.createBiquadFilter();
      bp.type = type; bp.frequency.value = hz; bp.Q.value = 1.2;
      const g = this.ctx.createGain();
      g.gain.value = vel * peak;
      src.connect(bp).connect(g).connect(out);
      src.start(t); src.stop(t + dur);
    };
    const tone = (f0, f1, dur, peak) => {
      const o = this.ctx.createOscillator();
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vel * peak, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(out);
      o.start(t); o.stop(t + dur + 0.02);
    };
    switch (midi) {
      case 36: tone(150, 42, 0.32, 1.0); noiseBurst(0.03, 1200, 'lowpass', 0.3); break;
      case 38: tone(210, 130, 0.12, 0.35); noiseBurst(0.18, 1900, 'bandpass', 0.7); break;
      case 39: noiseBurst(0.14, 1500, 'bandpass', 0.8); break;
      case 41: tone(120, 70, 0.34, 0.8); break;
      case 45: tone(180, 100, 0.30, 0.8); break;
      case 48: tone(260, 150, 0.26, 0.8); break;
      case 42: noiseBurst(0.045, 8000, 'highpass', 0.45); break;
      case 46: noiseBurst(0.32, 7000, 'highpass', 0.35); break;
      case 51: noiseBurst(0.6, 6000, 'highpass', 0.22); break;
      case 49: noiseBurst(1.1, 4200, 'highpass', 0.35); break;
      default: noiseBurst(0.1, 3000, 'bandpass', 0.4);
    }
  }
}
