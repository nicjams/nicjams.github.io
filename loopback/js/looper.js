// The looper itself: recording a loop, soloing over it, playing it back,
// saving it. Runs on the station (the computer the mixer is plugged into).
// Everything it does is driven by commands — from the station's own page or
// from a paired remote — and everything it knows is published as a plain,
// serialisable snapshot that any screen can draw (see view.js).
//
// Times are context seconds; loops are measured in frames so that a loop's
// length, and every multiple of it, is exact.

import { Engine } from './engine.js';
import * as store from './store.js';
import { seamlessLoop, peaks as peakBins, peakAbs, levelGain, mixTake, measureLatency, guessMeter,
  toPcm16, fromPcm16, encodeWav, clamp } from './dsp.js';
import { detectChords, soloAdvice } from './harmony.js';
import { strumChart, leadLine, DEMOS } from './strum.js';
import { quantize } from './view.js';

const FADE = 0.012;   // the loop seam's crossfade
const QUIET = 0.003;  // a recording peaking below this (about −50 dB) is probably the wrong input or channel
const SETTINGS_KEY = 'loopback:settings';
const SETTINGS_VERSION = 2;   // 2: the channel defaults to input 10
const DEFAULTS = {
  mode: 'click', bpm: 96, beatsPerBar: 4, bars: 4, countIn: 1, clickRec: false,
  soloPasses: 2, loopLevel: 0.9, soloLevel: 1, clickLevel: 0.5, keepLooping: false, metronome: false,
  deviceId: '', outputId: '', channel: 9, latencies: {},   // channel 9 = input 10, on the mixer
};
const CHECK = {
  mode: (v) => (v === 'free' ? 'free' : 'click'),
  bpm: (v) => clamp(Math.round(+v) || 96, 40, 240),
  beatsPerBar: (v) => clamp(Math.round(+v) || 4, 1, 12),
  bars: (v) => clamp(Math.round(+v) || 4, 1, 32),
  countIn: (v) => clamp(Math.round(+v) || 0, 0, 4),
  soloPasses: (v) => clamp(Math.round(+v) || 1, 1, 16),
  loopLevel: (v) => clamp(+v || 0, 0, 1.5),
  soloLevel: (v) => clamp(+v || 0, 0, 1.5),
  clickLevel: (v) => clamp(+v || 0, 0, 1),
  clickRec: Boolean, keepLooping: Boolean, metronome: Boolean,
  channel: (v) => (v === 'mix' ? 'mix' : clamp(Math.round(+v) || 0, 0, 31)),
  deviceId: String, outputId: String,
};

export function chartSummary(chart) {
  const out = [];
  for (const bar of chart || []) {
    const s = bar.join(' ');
    if (s && s !== out[out.length - 1]) out.push(s);
  }
  return out.join(' – ');
}

async function resample(data, from, to) {
  if (from === to) return data;
  const off = new OfflineAudioContext(1, Math.round((data.length * to) / from), to);
  const buf = off.createBuffer(1, data.length, from);
  buf.copyToChannel(data, 0);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start();
  return (await off.startRendering()).getChannelData(0);
}

export class Looper {
  constructor({ virtual = false } = {}) {
    this.engine = new Engine();
    this.virtual = virtual;
    this.settings = { ...DEFAULTS };
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
      if (!(saved.version >= 2)) delete saved.channel;   // saved before the input-10 default
      Object.assign(this.settings, saved);
    } catch {}
    this.settings.version = SETTINGS_VERSION;
    this.settings.metronome = false;
    this.phase = 'empty';
    this.loop = null;
    this.takes = [];
    this.takeNo = 0;
    this.library = [];
    this.counts = {};
    this.tl = { play: null, rec: null, solo: null, take: null, cal: null };
    this.input = { on: false, label: '', channels: 0 };
    this.busy = '';
    this.message = null;
    this.pending = { loop: null, take: null };
    this.listeners = new Set();
    this.meterListeners = new Set();
    // The worklet's meter messages keep arriving when the tab is in the
    // background and timers are throttled, so they drive the clock too.
    this.engine.onMeter = (peaks, first) => { this.tick(); this.meterListeners.forEach((fn) => fn(first, peaks)); };
    // what the browser said about the input's channels was a guess; this is what arrives
    this.engine.onChannels = (n) => {
      if (!this.input.on || this.virtual || !n || n === this.input.channels) return;
      this.input.channels = n;
      this.applyChannel();
      this.emit();
    };
    setInterval(() => this.tick(), 20);
    this.refreshLibrary();
  }

  onState(fn) { this.listeners.add(fn); fn(this.snapshot()); return () => this.listeners.delete(fn); }
  onMeter(fn) { this.meterListeners.add(fn); return () => this.meterListeners.delete(fn); }

  emit() {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      const s = this.snapshot();
      this.listeners.forEach((fn) => fn(s));
    });
  }

  say(text, kind = 'info') {
    this.message = { id: Date.now() + Math.random(), text, kind };
    this.emit();
  }

  saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch {}
  }

  // ---- snapshot ---------------------------------------------------------------

  snapshot() {
    const L = this.loop, e = this.engine, s = this.settings;
    const { deviceId, outputId, latencies, ...settings } = s;
    const solo = this.tl.solo && (({ B, E, R, passes, norm }) => ({ B, E, R, passes, norm }))(this.tl.solo);
    return {
      v: 1,
      phase: this.phase,
      busy: this.busy,
      message: this.message,
      at: e.ctx ? e.heard() : 0,
      audio: e.ctx ? { sr: e.sr, latency: e.latency, running: e.running } : null,
      input: { ...this.input },
      settings: { ...settings, deviceId, outputId },
      loop: L && {
        id: L.id, name: L.name, saved: !!L.id, source: L.source, ready: !!L.data,
        bpm: L.bpm, beatsPerBar: L.beatsPerBar, bars: L.bars, seconds: L.seconds,
        chart: L.chart, edited: L.edited, advice: L.advice || null, peaks: L.qpeaks || null,
      },
      // a loop playing indefinitely has stop: null (JSON has no Infinity)
      timeline: { play: this.tl.play && { ...this.tl.play, stop: isFinite(this.tl.play.stop) ? this.tl.play.stop : null },
        rec: this.tl.rec && { ...this.tl.rec }, solo, take: this.tl.take, cal: this.tl.cal },
      takes: this.takes.map((k) => ({ id: k.id, name: k.name, passes: k.passes, seconds: k.seconds,
        kept: k.kept, fresh: k.fresh, created: k.created, peaks: k.qpeaks })),
      library: this.library.map((m) => ({ id: m.id, name: m.name, bpm: m.bpm, bars: m.bars, beatsPerBar: m.beatsPerBar,
        summary: chartSummary(m.chart), takes: this.counts[m.id] || 0, updated: m.updated, peaks: m.peaks })),
    };
  }

  // ---- commands ---------------------------------------------------------------

  /** Run a command. `args.at` (station heard time) times a remote's press;
   *  `ev` times a local one. */
  async dispatch(cmd, args = {}, ev) {
    try {
      switch (cmd) {
        case 'pedal': return await this.pedal(args, ev);
        case 'play': return await this.togglePlay();
        case 'stop': return this.stopAll();
        case 'metronome': return this.set('metronome', !!args.on);
        case 'set': return await this.set(args.key, args.value);
        case 'demo': return await this.loadDemo(args.index || 0);
        case 'name': return this.editLoop({ name: String(args.name || '').slice(0, 80) });
        case 'chord': return this.editChord(args.bar, args.text);
        case 'scaleBars': return this.scaleBars(args.factor);
        case 'redetect': return this.redetect();
        case 'save': return await this.saveLoop();
        case 'new': return this.newLoop();
        case 'load': return await this.loadLoop(args.id);
        case 'delete': return await this.deleteLoop(args.id);
        case 'takePlay': return await this.takePlay(args.id);
        case 'takeKeep': return await this.takeKeep(args.id);
        case 'takeDelete': return await this.takeDelete(args.id);
        case 'calibrate': return await this.calibrate();
        case 'input': return await this.openInput();
        case 'hello': return this.emit();
        default: throw new Error(`Unknown command “${cmd}”`);
      }
    } catch (err) {
      console.error(err);
      this.busy = '';
      this.say(err.message || String(err), 'error');
    }
  }

  async ensureAudio() {
    await this.engine.start();
    if (!this.engine.running) throw new Error('The computer needs a click on its Loopback page before it can play sound.');
  }

  async openInput() {
    const e = this.engine;
    await e.start();
    let info;
    if (this.virtual) info = await e.openVirtualInput(0.08);
    else {
      try { info = await e.openInput(this.settings.deviceId); }
      catch (err) {
        if (!this.settings.deviceId || err.name === 'NotAllowedError') throw err;
        info = await e.openInput('');   // the saved device has gone; use the default
      }
    }
    this.input = { on: true, label: info.label, channels: info.channels || 2 };
    this.applyChannel();
    const known = this.settings.latencies[info.label];
    e.latency = typeof known === 'number' ? known : e.estimateLatency();
    if (this.settings.outputId) e.setOutput(this.settings.outputId).catch(() => {});
    this.emit();
  }

  async ensureInput() {
    await this.ensureAudio();
    if (!this.engine.hasInput) {
      try { await this.openInput(); }
      catch (err) {
        throw new Error(err.name === 'NotAllowedError'
          ? 'Loopback needs permission to use an input. Allow the microphone for this site, then try again.'
          : `Couldn’t open the input: ${err.message}`);
      }
    }
  }

  pressTime(args, ev) {
    const e = this.engine, heard = e.heard();
    if (typeof args.at === 'number' && Math.abs(args.at - heard) < 1.5) return args.at;
    return ev ? e.eventTime(ev) : heard;
  }

  async pedal(args, ev) {
    switch (this.phase) {
      case 'empty': return this.settings.mode === 'free' ? this.freeStart(args, ev) : this.recordStart();
      case 'count': case 'rec': return this.cancelRecording();
      case 'free': return this.freeClose(args, ev);
      case 'ready': return this.loop?.data ? this.soloStart() : undefined;
      case 'lead': return this.soloCancel();
      case 'solo': return this.soloEndEarly();
      case 'replay': case 'take': return this.stopAll();
      case 'calibrate': return this.calibrateCancel();
    }
  }

  async set(key, value) {
    if (!(key in CHECK)) throw new Error(`Unknown setting ${key}`);
    const v = CHECK[key](value), s = this.settings, e = this.engine, L = this.loop;
    s[key] = v;
    this.saveSettings();
    if (e.ctx) {
      if (key === 'loopLevel' && L) e.update('loop', { gain: L.gain * v });
      if (key === 'soloLevel') {
        if (this.tl.solo?.norm) e.update('replay', { gain: this.tl.solo.norm * v });
        const k = this.tl.take && this.takes.find((t) => t.id === this.tl.take.id);
        if (k) e.update('take', { gain: k.gain * v });
      }
      if (key === 'clickLevel') e.metroGain(v);
      if (key === 'channel') this.applyChannel();
      if (key === 'metronome') this.applyMetronome();
      if (key === 'outputId') await e.setOutput(v);
      if (key === 'deviceId' && this.input.on) await this.openInput();
    }
    this.emit();
  }

  /** Capture the chosen channel, or both mixed on an input that doesn't have
   *  it. The choice is kept for when the input that does comes back. */
  applyChannel() {
    const c = this.settings.channel, n = this.input.channels;
    this.engine.setChannel(typeof c === 'number' && n && c >= n ? 'mix' : c);
  }

  setLatency(seconds) {
    const e = this.engine;
    e.latency = clamp(seconds, 0, 0.6);
    if (this.input.label) this.settings.latencies[this.input.label] = e.latency;
    this.saveSettings();
    this.emit();
  }

  beatOf(L = this.loop) { return L.seconds / (L.bars * L.beatsPerBar); }

  applyMetronome() {
    const e = this.engine, L = this.loop, p = this.tl.play;
    if (!e.ctx) return;
    if (this.settings.metronome && L && p && p.stop === Infinity)
      e.metro({ anchor: p.anchor, beat: this.beatOf(), beatsPerBar: L.beatsPerBar, from: Math.max(e.now(), p.start), gain: this.settings.clickLevel });
    else if (!['count', 'lead', 'calibrate'].includes(this.phase) && !(this.phase === 'rec' && this.settings.clickRec)) e.metroOff();
  }

  // ---- recording a loop ---------------------------------------------------------

  async recordStart() {
    await this.ensureInput();
    const e = this.engine, s = this.settings, sr = e.sr;
    this.stopVoices();
    const beat = 60 / s.bpm, bar = beat * s.beatsPerBar;
    const T0 = e.now() + 0.15;
    const fTs = e.frame(T0 + s.countIn * bar), len = Math.round(s.bars * bar * sr);
    const Ts = fTs / sr, Te = (fTs + len) / sr, latF = e.frame(e.latency);
    e.keep('loop', fTs + latF - e.frame(FADE) - 256);
    if (s.countIn > 0 || s.clickRec)
      e.metro({ anchor: Ts, beat, beatsPerBar: s.beatsPerBar, from: T0, until: s.clickRec ? Te : Ts, gain: s.clickLevel });
    // The loop starts playing the moment it is recorded, straight from the
    // capture; the cleaned-up copy replaces it a moment later.
    e.voice({ id: 'loop', from: fTs + latF, length: len, period: len, anchor: Te, start: Te, gain: s.loopLevel, fadeIn: 0.002 });
    this.tl.rec = { mode: 'click', T0, Ts, Te, beat, beatsPerBar: s.beatsPerBar, bars: s.bars, bpm: s.bpm, fTs, len, latF };
    this.tl.play = null;
    this.loop = null;
    this.takes = [];
    this.phase = s.countIn > 0 ? 'count' : 'rec';
    if (this.virtual) {
      const chart = Array.from({ length: s.bars }, (_, i) => DEMOS[0].chart[i % 4]);
      e.virtualPlay(strumChart({ chart, bpm: s.bpm, beatsPerBar: s.beatsPerBar, sr }), Ts);
    }
    this.emit();
  }

  async freeStart(args, ev) {
    const pressed = this.engine.running ? this.pressTime(args, ev) : null;   // before awaiting anything
    await this.ensureInput();
    const e = this.engine, t1 = pressed ?? e.heard(), sr = e.sr, fTs = e.frame(t1), latF = e.frame(e.latency);
    this.stopVoices();
    e.keep('loop', fTs + latF - e.frame(FADE) - 256);
    this.tl.rec = { mode: 'free', Ts: t1, fTs, latF, beatsPerBar: this.settings.beatsPerBar };
    this.tl.play = null;
    this.loop = null;
    this.takes = [];
    this.phase = 'free';
    if (this.virtual) e.virtualPlay(strumChart({ chart: DEMOS[1].chart, bpm: DEMOS[1].bpm, sr }), t1 + 0.05);
    this.emit();
  }

  freeClose(args, ev) {
    const e = this.engine, r = this.tl.rec, s = this.settings, sr = e.sr;
    const t2 = this.pressTime(args, ev), len = e.frame(t2) - r.fTs;
    if (len < sr) { this.say('That’s under a second — keep playing, then close the loop.'); return; }
    r.len = len;
    r.Te = (r.fTs + len) / sr;
    const seconds = len / sr, bars = Math.max(1, Math.round(seconds / ((60 / s.bpm) * s.beatsPerBar)));
    r.bars = bars;
    r.bpm = (60 * bars * s.beatsPerBar) / seconds;
    const gain = levelGain(e.peakBetween(r.fTs + r.latF, r.fTs + r.latF + len));
    const start = Math.max(r.Te, e.now() + 0.01);
    e.voice({ id: 'loop', from: r.fTs + r.latF, length: len, period: len, anchor: r.Te, start, gain: gain * s.loopLevel, fadeIn: 0.004 });
    this.loopClosed(r, start, gain);
  }

  loopClosed(r, start, gain) {
    const e = this.engine, sr = e.sr, from = r.fTs + r.latF;
    if (gain === undefined) gain = levelGain(e.peakBetween(from, from + r.len));
    const draft = Float32Array.from(e.peakSlices(from, from + r.len, 360), (p) => quantize(p * gain));
    this.loop = {
      id: null, name: '', created: Date.now(), sr, len: r.len, seconds: r.len / sr,
      bpm: r.bpm, beatsPerBar: r.beatsPerBar, bars: r.bars, chart: [], detected: [], edited: false,
      gain, source: r.mode, data: null, qpeaks: Array.from(draft),
    };
    this.takes = [];
    this.tl.play = { anchor: r.Te, start, stop: Infinity };
    this.tl.rec = null;
    this.phase = 'ready';
    this.pending.loop = { at: r.Te + e.latency + 0.25, from, len: r.len, mode: r.mode, loop: this.loop };
    this.applyMetronome();
    this.emit();
  }

  async finishLoop(p) {
    const e = this.engine, F = e.frame(FADE), s = this.settings;
    const rec = await e.extract(p.from - F, p.from + p.len);
    e.release('loop');
    const L = p.loop;
    if (this.loop !== L) return;   // thrown away while we waited
    const data = seamlessLoop(rec, F, p.len, F);
    if (peakAbs(data) < QUIET) this.say('That loop came in almost silent. Check the input and channel under Input & timing.', 'error');
    L.data = data;
    L.gain = levelGain(peakAbs(data));
    e.update('loop', { data, gain: L.gain * s.loopLevel });
    if (p.mode === 'free') {
      const m = guessMeter(data, L.sr, L.beatsPerBar);
      L.bars = m.bars;
      L.bpm = m.bpm;
    }
    this.analyze(L);
    L.name = this.defaultName(L);
    this.applyMetronome();
    this.emit();
  }

  cancelRecording() {
    const e = this.engine;
    e.stop('loop', undefined, 0.01);
    e.metroOff();
    e.release('loop');
    this.tl.rec = null;
    this.phase = this.loop ? 'ready' : 'empty';
    this.emit();
  }

  analyze(L, detect = true) {
    if (detect) {
      L.detected = detectChords(L.data, L.sr, { bars: L.bars, beatsPerBar: L.beatsPerBar });
      if (!L.edited) L.chart = L.detected.map((b) => b.slice());
    }
    L.advice = soloAdvice(L.chart);
    L.qpeaks = Array.from(peakBins(L.data, 360), (p) => quantize(p * L.gain));
  }

  defaultName(L) {
    const sum = chartSummary(L.chart);
    return sum ? `${sum}` : `Loop ${this.library.length + 1}`;
  }

  // ---- playing ----------------------------------------------------------------

  stopVoices(fade = 0.02) {
    const e = this.engine;
    if (!e.ctx) return;
    e.stop(undefined, undefined, fade);
    e.metroOff();
    this.tl.play = null;
  }

  playing() { const p = this.tl.play; return !!p && p.stop === Infinity; }

  async togglePlay() {
    const L = this.loop;
    if (!L) return;
    if (['lead', 'solo', 'replay', 'take', 'count', 'rec', 'free', 'calibrate'].includes(this.phase)) return this.stopAll();
    const e = this.engine;
    if (this.playing()) {
      e.stop('loop', undefined, 0.03);
      e.metroOff();
      this.tl.play = null;
    } else {
      if (!L.data) return;
      await this.ensureAudio();
      const S0 = e.now() + 0.06;
      e.voice({ id: 'loop', data: L.data, period: L.len, anchor: S0, start: S0, gain: L.gain * this.settings.loopLevel });
      this.tl.play = { anchor: S0, start: S0, stop: Infinity };
      this.applyMetronome();
    }
    this.emit();
  }

  stopAll() {
    const e = this.engine;
    if (['count', 'rec', 'free'].includes(this.phase)) return this.cancelRecording();
    if (this.phase === 'calibrate') return this.calibrateCancel();
    if (['lead', 'solo'].includes(this.phase)) { e.release('solo'); this.pending.take = null; }
    this.stopVoices();
    this.tl.solo = this.tl.take = null;
    this.phase = this.loop ? 'ready' : 'empty';
    this.emit();
  }

  // ---- soloing ----------------------------------------------------------------

  async soloStart() {
    await this.ensureInput();
    const e = this.engine, s = this.settings, L = this.loop, sr = e.sr, now = e.now();
    const len = L.len, P = s.soloPasses, beat = this.beatOf(), bar = beat * L.beatsPerBar;
    let fB, startedLoop = false;
    const p = this.tl.play;
    if (p && p.stop === Infinity && now >= p.start - 0.05) {
      // already looping: come in at the top of the next pass
      const aF = e.frame(p.anchor), minF = e.frame(now + 0.3);
      fB = aF + Math.ceil((minF - aF) / len) * len;
      if (s.countIn > 0 && !s.metronome)
        e.metro({ anchor: fB / sr, beat, beatsPerBar: L.beatsPerBar, from: Math.max(now + 0.05, fB / sr - s.countIn * bar), until: fB / sr, gain: s.clickLevel });
    } else {
      this.stopVoices();
      const T0 = now + 0.15;
      fB = e.frame(T0 + s.countIn * bar);
      if (s.countIn > 0 || s.metronome)
        e.metro({ anchor: fB / sr, beat, beatsPerBar: L.beatsPerBar, from: T0, until: s.metronome ? Infinity : fB / sr, gain: s.clickLevel });
      e.voice({ id: 'loop', data: L.data, period: len, anchor: fB / sr, start: fB / sr, gain: L.gain * s.loopLevel });
      this.tl.play = { anchor: fB / sr, start: fB / sr, stop: Infinity };
      startedLoop = true;
    }
    const latF = e.frame(e.latency), fE = fB + P * len, fR = fE + P * len;
    const B = fB / sr, E = fE / sr, R = fR / sr, ring = Math.min(1.5 * beat, L.seconds / 2);
    e.keep('solo', fB + latF - 256);
    // The replay reads the capture one solo-length behind, so it can start
    // the instant the solo ends.
    e.voice({ id: 'replay', from: fB + latF, length: P * len, anchor: E, start: E, stop: R, gain: s.soloLevel, fadeIn: 0.002, fadeOut: 0.03 });
    if (!s.keepLooping) {
      e.update('loop', { stop: R + ring, fadeOut: ring });
      this.tl.play.stop = R + ring;
    }
    this.tl.solo = { B, E, R, passes: P, fB, len, latF, ring, startedLoop, norm: 0 };
    this.phase = 'lead';
    if (this.virtual) e.virtualPlay(leadLine({ seconds: P * L.seconds, bpm: L.bpm, sr }), B);
    this.emit();
  }

  soloCancel() {
    const e = this.engine, so = this.tl.solo;
    e.stop('replay', undefined, 0.01);
    e.release('solo');
    if (so.startedLoop) { e.stop('loop', undefined, 0.02); this.tl.play = null; }
    else if (this.tl.play) { e.update('loop', { stop: Infinity }); this.tl.play.stop = Infinity; }
    this.tl.solo = null;
    this.phase = 'ready';
    if (!this.settings.metronome) e.metroOff();
    this.emit();
  }

  soloEndEarly() {
    const e = this.engine, so = this.tl.solo, sr = e.sr;
    const pass = Math.floor((e.frame(e.now() + 0.05) - so.fB) / so.len);
    const P = pass + 1;
    if (P >= so.passes) return;
    so.passes = P;
    so.E = (so.fB + P * so.len) / sr;
    so.R = (so.fB + 2 * P * so.len) / sr;
    e.update('replay', { anchor: so.E, start: so.E, stop: so.R, length: P * so.len });
    if (this.tl.play && this.tl.play.stop !== Infinity) {
      e.update('loop', { stop: so.R + so.ring, fadeOut: so.ring });
      this.tl.play.stop = so.R + so.ring;
    }
    this.say(`Ending after pass ${P}`);
  }

  async collectTake(so) {
    const e = this.engine, L = this.loop;
    const data = await e.extract(so.fB + so.latF, so.fB + so.latF + so.passes * so.len);
    e.release('solo');
    if (!L || this.loop !== so.loop) return;
    if (peakAbs(data) < QUIET) this.say('That solo came in almost silent. Check the input and channel under Input & timing.', 'error');
    const gain = levelGain(peakAbs(data));
    const take = {
      id: store.newId(), loopId: L.id, created: Date.now(), passes: so.passes, sr: e.sr, seconds: data.length / e.sr,
      data, gain, kept: false, fresh: true, name: `Take ${++this.takeNo}`,
      qpeaks: Array.from(peakBins(data, 160), (p) => quantize(p * gain)),
    };
    this.takes.forEach((k) => { k.fresh = false; });
    this.takes.unshift(take);
    this.emit();
  }

  // ---- takes ------------------------------------------------------------------

  async takeAudio(k) {
    if (!k.data) {
      const pcm = await store.loadAudio('take', k.id);
      if (!pcm) throw new Error('That take’s audio is missing.');
      k.data = await resample(fromPcm16(pcm), k.sr, this.engine.sr);
      k.gain = levelGain(peakAbs(k.data));
    }
    return k.data;
  }

  async takePlay(id) {
    const k = this.takes.find((t) => t.id === id), L = this.loop;
    if (!k || !L?.data) return;
    await this.ensureAudio();
    const data = await this.takeAudio(k), e = this.engine, s = this.settings;
    this.stopAll();
    const S0 = e.now() + 0.1, end = S0 + (k.passes * L.len) / e.sr, ring = Math.min(1.5 * this.beatOf(), L.seconds / 2);
    e.voice({ id: 'loop', data: L.data, period: L.len, anchor: S0, start: S0, stop: end + ring, fadeOut: ring, gain: L.gain * s.loopLevel });
    e.voice({ id: 'take', data, anchor: S0, start: S0, gain: k.gain * s.soloLevel });
    if (!k.passPeaks) k.passPeaks = Array.from(peakBins(data, 360 * k.passes, 0, k.passes * L.len), (p) => quantize(p * k.gain));
    this.tl.play = { anchor: S0, start: S0, stop: end + ring };
    this.tl.take = { id, name: k.name, start: S0, end, passes: k.passes, peaks: k.passPeaks };
    this.phase = 'take';
    this.emit();
  }

  async takeKeep(id) {
    const k = this.takes.find((t) => t.id === id);
    if (!k || k.kept) return;
    if (!this.loop.id) await this.saveLoop();
    k.loopId = this.loop.id;
    await store.saveTake({ id: k.id, loopId: k.loopId, created: k.created, passes: k.passes, sr: k.sr, seconds: k.seconds,
      gain: k.gain, name: k.name, qpeaks: k.qpeaks }, toPcm16(await this.takeAudio(k)));
    k.kept = true;
    this.counts[k.loopId] = (this.counts[k.loopId] || 0) + 1;
    this.emit();
  }

  async takeDelete(id) {
    const k = this.takes.find((t) => t.id === id);
    if (!k) return;
    if (this.tl.take?.id === id) this.stopAll();
    if (k.kept) {
      await store.deleteTake(id);
      this.counts[k.loopId] = Math.max(0, (this.counts[k.loopId] || 1) - 1);
    }
    this.takes = this.takes.filter((t) => t !== k);
    this.emit();
  }

  // ---- the library --------------------------------------------------------------

  async refreshLibrary() {
    try {
      [this.library, this.counts] = await Promise.all([store.listLoops(), store.countTakes()]);
    } catch (err) {
      console.warn('Library unavailable', err);
    }
    this.emit();
  }

  loopMeta(L) {
    return {
      id: L.id, name: L.name, created: L.created, updated: Date.now(), sr: L.sr, length: L.len,
      bpm: L.bpm, beatsPerBar: L.beatsPerBar, bars: L.bars, chart: L.chart, detected: L.detected, edited: L.edited,
      gain: L.gain, source: L.source, peaks: Array.from(peakBins(L.data, 96), (p) => quantize(p * L.gain)),
    };
  }

  async saveLoop() {
    const L = this.loop;
    if (!L?.data) return;
    const fresh = !L.id;
    if (fresh) L.id = store.newId();
    await store.saveLoop(this.loopMeta(L), L.audioSaved ? null : toPcm16(L.data));
    L.audioSaved = true;
    for (const k of this.takes) k.loopId = L.id;
    if (fresh) store.persist();
    await this.refreshLibrary();
    if (fresh) this.say(`Saved “${L.name}”`);
  }

  saveSoon() {
    clearTimeout(this.saveTimer);
    if (!this.loop?.id) return;
    const L = this.loop;
    this.saveTimer = setTimeout(() => {
      if (this.loop === L) store.saveLoop(this.loopMeta(L)).then(() => this.refreshLibrary()).catch((err) => this.say(err.message, 'error'));
    }, 500);
  }

  editLoop(fields) {
    if (!this.loop) return;
    Object.assign(this.loop, fields);
    this.saveSoon();
    this.emit();
  }

  editChord(bar, text) {
    const L = this.loop;
    if (!L || !(bar >= 0 && bar < L.bars)) return;
    const chart = L.chart.slice();
    while (chart.length < L.bars) chart.push([]);
    chart[bar] = String(text || '').trim().split(/\s+/).filter(Boolean).slice(0, 4);
    L.chart = chart;
    L.edited = true;
    this.analyze(L, false);
    this.saveSoon();
    this.emit();
  }

  redetect() {
    const L = this.loop;
    if (!L?.data) return;
    L.edited = false;
    this.analyze(L);
    this.saveSoon();
    this.emit();
  }

  scaleBars(factor) {
    const L = this.loop;
    if (!L?.data) return;
    const bars = L.bars * factor;
    if (bars < 1 || bars > 32 || bars !== Math.round(bars)) return;
    L.bars = bars;
    L.bpm *= factor;
    L.edited = false;
    this.analyze(L);
    if (this.settings.metronome) this.applyMetronome();
    this.saveSoon();
    this.emit();
  }

  async loadLoop(id) {
    const meta = this.library.find((m) => m.id === id);
    if (!meta) return;
    await this.engine.start({ resume: false });
    this.stopAll();
    this.busy = 'Loading…';
    this.emit();
    try {
      const pcm = await store.loadAudio('loop', id);
      if (!pcm) throw new Error('That loop’s audio is missing.');
      const e = this.engine, data = await resample(fromPcm16(pcm), meta.sr, e.sr);
      // the level is worked out afresh, so loops saved before a change to levelGain get it too
      const L = { ...meta, len: data.length, seconds: data.length / e.sr, sr: e.sr, data, audioSaved: true, gain: levelGain(peakAbs(data)) };
      L.chart = L.chart || [];
      this.analyze(L, false);
      this.loop = L;
      this.takes = (await store.listTakes(id)).map((k) => ({ ...k, kept: true, fresh: false, data: null }));
      this.takeNo = this.takes.length;
      this.phase = 'ready';
    } finally {
      this.busy = '';
      this.emit();
    }
  }

  async deleteLoop(id) {
    await store.deleteLoop(id);
    if (this.loop?.id === id) {
      this.loop.id = null;
      this.loop.audioSaved = false;
      this.takes.forEach((k) => { k.kept = false; k.loopId = null; });
    }
    await this.refreshLibrary();
  }

  newLoop() {
    this.stopAll();
    this.loop = null;
    this.takes = [];
    this.takeNo = 0;
    this.phase = 'empty';
    this.emit();
  }

  setLoopFromAudio(data, fields) {
    const e = this.engine;
    this.stopAll();
    const L = {
      id: null, created: Date.now(), sr: e.sr, len: data.length, seconds: data.length / e.sr, data,
      chart: [], detected: [], edited: false, gain: levelGain(peakAbs(data)), ...fields,
    };
    this.analyze(L, !fields.chart);
    if (fields.chart) L.detected = fields.chart.map((b) => b.slice());
    L.name = L.name || this.defaultName(L);
    this.loop = L;
    this.takes = [];
    this.takeNo = 0;
    this.phase = 'ready';
    this.emit();
  }

  async loadDemo(index) {
    await this.engine.start({ resume: false });
    const d = DEMOS[index % DEMOS.length];
    const data = strumChart({ chart: d.chart, bpm: d.bpm, beatsPerBar: d.beatsPerBar, sr: this.engine.sr });
    this.setLoopFromAudio(data, { name: `Demo · ${d.name}`, source: 'demo', bpm: d.bpm, beatsPerBar: d.beatsPerBar,
      bars: d.chart.length, chart: d.chart.map((b) => b.slice()) });
  }

  /** A loop from an audio file (station only). */
  async importFile(file) {
    await this.engine.start({ resume: false });
    this.busy = 'Opening the file…';
    this.emit();
    try {
      const buf = await this.engine.ctx.decodeAudioData(await file.arrayBuffer());
      if (buf.duration > 300) throw new Error('That file is over five minutes — Loopback wants a loop.');
      const data = new Float32Array(buf.length);
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const ch = buf.getChannelData(c);
        for (let i = 0; i < data.length; i++) data[i] += ch[i] / buf.numberOfChannels;
      }
      const m = guessMeter(data, buf.sampleRate, this.settings.beatsPerBar);
      this.setLoopFromAudio(data, { name: file.name.replace(/\.[^.]+$/, ''), source: 'file', bpm: m.bpm,
        beatsPerBar: this.settings.beatsPerBar, bars: m.bars });
    } finally {
      this.busy = '';
      this.emit();
    }
  }

  /** WAV of the loop, or of a take mixed over the loop (station only). */
  async wav(takeId) {
    const L = this.loop, s = this.settings;
    if (!L?.data) return null;
    const safe = (L.name || 'loop').replace(/[^\w\s.–-]+/g, '').trim() || 'loop';
    if (!takeId) return { name: `${safe}.wav`, blob: new Blob([encodeWav([L.data.map((v) => v * L.gain * 0.9)], L.sr)], { type: 'audio/wav' }) };
    const k = this.takes.find((t) => t.id === takeId);
    const solo = await this.takeAudio(k);
    const mix = mixTake({ loop: L.data, loopGain: L.gain * s.loopLevel * 0.8, solo, soloGain: k.gain * s.soloLevel * 0.8,
      passes: k.passes, ringOut: Math.round(Math.min(1.5 * this.beatOf(), L.seconds / 2) * L.sr) });
    return { name: `${safe} – ${k.name}.wav`, blob: new Blob([encodeWav([mix], L.sr)], { type: 'audio/wav' }) };
  }

  // ---- latency ----------------------------------------------------------------

  async calibrate() {
    await this.ensureInput();
    this.stopAll();
    const e = this.engine, T0 = e.now() + 0.5, n = 8, interval = 0.6;
    e.metro({ anchor: T0, beat: interval, beatsPerBar: 1, from: T0, until: T0 + (n - 0.5) * interval, gain: 1 });
    e.keep('cal', e.frame(T0 - 0.15));
    this.tl.cal = { T0, n, interval };
    this.phase = 'calibrate';
    this.emit();
  }

  calibrateCancel() {
    this.engine.metroOff();
    this.engine.release('cal');
    this.tl.cal = null;
    this.phase = this.loop ? 'ready' : 'empty';
    this.emit();
  }

  async finishCalibration(c) {
    const e = this.engine, sr = e.sr, from = e.frame(c.T0 - 0.1);
    const rec = await e.extract(from, e.frame(c.T0 + c.n * c.interval + 0.55));
    e.release('cal');
    const clicks = Array.from({ length: c.n }, (_, k) => e.frame(c.T0 + k * c.interval) - from);
    const result = measureLatency(rec, sr, clicks);
    this.tl.cal = null;
    this.phase = this.loop ? 'ready' : 'empty';
    if (result && result.spread < 0.025) {
      this.setLatency(result.latency);
      this.say(`Latency measured: ${Math.round(result.latency * 1000)} ms (heard ${result.heard} of ${c.n} clicks)`);
    } else {
      this.say(result ? 'The clicks came back unevenly — try again with less noise, or strum more crisply.'
        : 'Couldn’t hear the clicks. Turn the speakers up near the input, or strum muted strings along with each click.', 'error');
    }
  }

  // ---- the clock ----------------------------------------------------------------

  tick() {
    const e = this.engine;
    if (!e.node) return;
    const now = e.now(), tl = this.tl;
    let changed = false;
    const r = tl.rec;
    if (r) {
      if (this.phase === 'count' && now >= r.Ts) { this.phase = 'rec'; changed = true; }
      if (r.mode === 'click' && !r.gainSet && now >= r.Te - 0.12) {
        r.gainSet = true;
        r.gain = levelGain(e.peakBetween(r.fTs + r.latF, r.fTs + r.latF + r.len));
        e.update('loop', { gain: r.gain * this.settings.loopLevel });
      }
      if (r.mode === 'click' && this.phase === 'rec' && now >= r.Te) { this.loopClosed(r, r.Te, r.gain); changed = false; }
    }
    const pl = this.pending.loop;
    if (pl && now >= pl.at) { this.pending.loop = null; this.finishLoop(pl).catch((err) => this.say(err.message, 'error')); }

    const so = tl.solo;
    if (so) {
      if (this.phase === 'lead' && now >= so.B) { this.phase = 'solo'; changed = true; }
      if (!so.norm && now >= so.E - 0.12) {
        so.norm = levelGain(e.peakBetween(so.fB + so.latF, so.fB + so.latF + so.passes * so.len));
        e.update('replay', { gain: so.norm * this.settings.soloLevel });
      }
      if (this.phase === 'solo' && now >= so.E) {
        this.phase = 'replay';
        so.loop = this.loop;
        this.pending.take = so;
        changed = true;
      }
      if (this.phase === 'replay' && now >= so.R) {
        tl.solo = null;
        this.phase = 'ready';
        changed = true;
      }
    }
    const pt = this.pending.take;
    if (pt && now >= pt.E + e.latency + 0.25) { this.pending.take = null; this.collectTake(pt).catch((err) => this.say(err.message, 'error')); }

    if (tl.take && now >= tl.take.end) { tl.take = null; if (this.phase === 'take') this.phase = 'ready'; changed = true; }
    if (tl.play && now >= tl.play.stop) { tl.play = null; if (!['count', 'lead'].includes(this.phase)) e.metroOff(); changed = true; }
    if (tl.cal && this.phase === 'calibrate' && now >= tl.cal.T0 + tl.cal.n * tl.cal.interval + 0.6 && !tl.cal.done) {
      tl.cal.done = true;
      this.finishCalibration(tl.cal).catch((err) => this.say(err.message, 'error'));
    }
    if (changed) this.emit();
  }
}
