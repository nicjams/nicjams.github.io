// The page's side of the tape machine: owns the AudioContext, the input, and
// the conversion between seconds (what the UI thinks in) and frames (what the
// worklet thinks in). Every musical time here is a context time in seconds;
// `latency` is the round trip from a sound being scheduled to it coming back
// in through the input, so the take of a moment t lives at capture frame
// (t + latency) * sampleRate.

const ROUND_TRIP_GUESS = 0.012;   // input-side latency the browser doesn't report

export class Engine {
  constructor() {
    this.ctx = null;
    this.node = null;
    this.stream = null;
    this.source = null;
    this.latency = 0.03;
    this.onMeter = () => {};
    this.onChannels = () => {};   // how many input channels actually arrive
    this.pending = new Map();
    this.nextId = 1;
    // block peaks of the input, 128 frames each, for level meters, live
    // waveforms and setting the gain of a fresh recording
    this.peakRing = new Float32Array(1 << 18);
    this.peakBlock = -1;
    this.virtual = null;
  }

  get sr() { return this.ctx.sampleRate; }
  get running() { return !!this.ctx && this.ctx.state === 'running'; }
  get hasInput() { return !!this.source || !!this.virtual; }

  /** Create the context and the tape machine; with `resume`, also make sure
   *  it is running (a browser only allows that after the page has been
   *  clicked). */
  async start({ resume = true } = {}) {
    if (!this.starting) this.starting = this.create().catch((err) => { this.starting = null; throw err; });
    await this.starting;
    if (resume && this.ctx.state !== 'running')
      await Promise.race([this.ctx.resume(), new Promise((r) => setTimeout(r, 1200))]);
  }

  async create() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !('audioWorklet' in AC.prototype)) throw new Error('This browser can’t run the looper (no AudioWorklet).');
    const ctx = new AC({ latencyHint: 'interactive' });
    await ctx.audioWorklet.addModule(new URL('./tape-worklet.js', import.meta.url));
    this.ctx = ctx;
    this.node = new AudioWorkletNode(ctx, 'tape', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
    });
    this.master = this.ctx.createGain();
    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20;
    limiter.attack.value = 0.002; limiter.release.value = 0.12;
    this.node.connect(this.master).connect(limiter).connect(this.ctx.destination);
    this.node.port.onmessage = (e) => this.receive(e.data);
  }

  receive(m) {
    if (m.type === 'meter') {
      const first = Math.floor(m.frame / 128);
      for (let i = 0; i < m.peaks.length; i++) this.peakRing[(first + i) & (this.peakRing.length - 1)] = m.peaks[i];
      this.peakBlock = first + m.peaks.length - 1;
      this.onMeter(m.peaks, first);
    } else if (m.type === 'channels') {
      this.onChannels(m.n);
    } else if (m.type === 'extract') {
      const resolve = this.pending.get(m.id);
      this.pending.delete(m.id);
      resolve?.(m.data);
    }
  }

  // ---- input ----------------------------------------------------------------

  /** Open an input — a mic, an interface, a mixer. Mixers often show up with
   *  many channels; ask for as many as there are and let the user pick one. */
  async openInput(deviceId) {
    await this.start();
    this.closeInput();
    const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 32 } };
    if (deviceId) audio.deviceId = { exact: deviceId };
    this.stream = await navigator.mediaDevices.getUserMedia({ audio });
    const track = this.stream.getAudioTracks()[0], settings = track?.getSettings?.() || {};
    // Not every browser says how many channels it sends (Safari doesn't), so
    // take as many as arrive; the worklet counts them (onChannels).
    const channels = Math.max(1, Math.min(32, settings.channelCount || 2));
    this.node.channelCountMode = 'max';
    this.node.channelInterpretation = 'discrete';
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.source.connect(this.node);
    this.post({ type: 'recount' });
    return { label: track?.label || 'Input', deviceId: settings.deviceId, channels };
  }

  /** Send the output to a particular device (the mixer), where supported. */
  async setOutput(deviceId) {
    if (!this.ctx?.setSinkId) return false;
    await this.ctx.setSinkId(deviceId || '');
    return true;
  }

  closeInput() {
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.source = this.stream = null;
  }

  /** What the browser admits to, plus a little for the converters it doesn't. */
  estimateLatency() {
    const ctx = this.ctx;
    const track = this.stream?.getAudioTracks()[0]?.getSettings?.();
    const input = typeof track?.latency === 'number' ? track.latency : ROUND_TRIP_GUESS;
    return (ctx.baseLatency || 0.005) + (ctx.outputLatency || 0.01) + input;
  }

  /** A stand-in for a player in a room, for testing without a microphone:
   *  everything the looper plays comes back `latency` seconds later, mixed
   *  with whatever `play()` is given to strum. */
  async openVirtualInput(latency = 0.08, bleed = 0.25) {
    await this.start();
    const ctx = this.ctx, delay = ctx.createDelay(1), room = ctx.createGain(), player = ctx.createGain();
    delay.delayTime.value = latency;
    room.gain.value = bleed;
    this.node.connect(room).connect(delay);
    player.connect(delay);
    delay.connect(this.node);
    this.virtual = { delay, room, player, latency };
    return { label: `Virtual room (${Math.round(latency * 1000)} ms)` };
  }

  virtualPlay(data, when) {
    if (!this.virtual) return;
    const buf = this.ctx.createBuffer(1, data.length, this.sr);
    buf.copyToChannel(data, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.virtual.player);
    src.start(when);
    return src;
  }

  // ---- clock ----------------------------------------------------------------

  now() { return this.ctx.currentTime; }
  frame(t) { return Math.round(t * this.sr); }

  /** The context time now coming out of the speakers. */
  heard() {
    const ctx = this.ctx, ts = ctx.getOutputTimestamp?.();
    if (ts && ts.contextTime > 0) return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
    return ctx.currentTime - (ctx.outputLatency || 0) - (ctx.baseLatency || 0);
  }

  /** The heard context time at which an input event happened. */
  eventTime(ev) {
    const ts = this.ctx.getOutputTimestamp?.();
    if (ev?.timeStamp && ts && ts.contextTime > 0) return ts.contextTime + (ev.timeStamp - ts.performanceTime) / 1000;
    return this.heard();
  }

  /** Where the take of musical time t sits in the capture. */
  captureFrame(t) { return this.frame(t + this.latency); }

  // ---- commands -------------------------------------------------------------

  post(msg, transfer) { this.node.port.postMessage(msg, transfer || []); }
  setChannel(mode) { this.post({ type: 'channel', mode }); }
  /** Hold on to the capture from a frame onwards, until released. Several
   *  holds (a loop finishing while a solo starts) can overlap. */
  keep(id, fromFrame) { this.post({ type: 'keep', id, from: fromFrame }); }
  release(id) { this.post({ type: 'release', id }); }

  extract(from, to) {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.post({ type: 'extract', id, from, to });
    });
  }

  /** Play a voice. Times in seconds: `start` when it begins sounding,
   *  `anchor` where its sample 0 falls, `stop` when it ends; `period`
   *  (frames) makes it loop. Its source is `data` or the capture from frame
   *  `from`. */
  voice({ id, data, from, length, period, anchor, start, stop, fadeIn, fadeOut, gain }) {
    const f = (t) => (t === undefined || t === Infinity ? undefined : this.frame(t));
    this.post({ type: 'voice', id, data, from, length, period, anchor: f(anchor), start: f(start), stop: f(stop),
      fadeIn: fadeIn === undefined ? undefined : this.frame(fadeIn), fadeOut: fadeOut === undefined ? undefined : this.frame(fadeOut), gain });
  }

  update(id, { data, length, stop, fadeOut, gain, start, anchor } = {}) {
    this.post({ type: 'update', id, data, length, gain,
      anchor: anchor === undefined ? undefined : this.frame(anchor),
      stop: stop === undefined ? undefined : stop === Infinity ? Infinity : this.frame(stop),
      start: start === undefined ? undefined : this.frame(start),
      fadeOut: fadeOut === undefined ? undefined : this.frame(fadeOut) });
  }

  stop(id, at, fade = 0.012) {
    this.post({ type: 'stop', id, at: at === undefined ? undefined : this.frame(at), fade: this.frame(fade) });
  }

  stopAll(fade = 0.02) { this.post({ type: 'stop', fade: this.frame(fade) }); this.metroOff(); }

  metro({ anchor, beat, beatsPerBar, from, until, gain }) {
    this.post({ type: 'metro', anchor: anchor * this.sr, interval: beat * this.sr, bpb: beatsPerBar,
      from: this.frame(from), until: until === undefined || until === Infinity ? Infinity : this.frame(until), gain });
  }

  metroOff(at) { this.post({ type: 'metroOff', at: at === undefined ? undefined : this.frame(at) }); }
  metroGain(gain) { this.post({ type: 'metroGain', gain }); }

  // ---- input levels -----------------------------------------------------------

  /** Loudest input peak between two capture frames, from the meter history. */
  peakBetween(fromFrame, toFrame) {
    const a = Math.max(Math.floor(fromFrame / 128), this.peakBlock - this.peakRing.length + 1);
    const z = Math.min(Math.floor(toFrame / 128), this.peakBlock);
    let m = 0;
    for (let b = a; b <= z; b++) m = Math.max(m, this.peakRing[b & (this.peakRing.length - 1)]);
    return m;
  }

  /** Peaks of `bins` slices of capture frames [from, to), for drawing. */
  peakSlices(fromFrame, toFrame, bins) {
    const out = new Float32Array(bins), span = (toFrame - fromFrame) / bins;
    for (let i = 0; i < bins; i++) {
      const a = fromFrame + i * span;
      if (a > this.peakBlock * 128 + 128) break;
      out[i] = this.peakBetween(a, a + span);
    }
    return out;
  }
}
