import { spectrum } from "./model.js";

export class AudioEngine {
  constructor(
    factory = () =>
      new (globalThis.AudioContext || globalThis.webkitAudioContext)(),
  ) {
    this.factory = factory;
    this.context = null;
    this.master = null;
    this.voices = new Set();
    this.timers = new Set();
    this.volume = 0.3;
    this.generation = 0;
    this.onChange = () => {};
    this.sequence = false;
  }
  async ensure() {
    if (!this.context) {
      this.context = this.factory();
      this.master = this.context.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") await this.context.resume();
  }
  setVolume(value) {
    this.volume = value;
    if (this.master)
      this.master.gain.setTargetAtTime(value, this.context.currentTime, 0.02);
  }
  get playing() {
    return this.voices.size > 0 || this.sequence;
  }
  later(fn, ms) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
    return id;
  }
  async play(freqs, partials = spectrum(), duration = null, decay = false) {
    this.stop();
    const generation = this.generation;
    await this.ensure();
    if (generation !== this.generation) return;
    this.add(freqs, partials, duration, decay);
    this.onChange();
  }
  add(freqs, partials, duration = null, decay = false) {
    const ctx = this.context,
      now = ctx.currentTime;
    const normalization = Math.max(
      1,
      partials.reduce((s, p) => s + Math.abs(p.amplitude), 0),
    );
    freqs.forEach((f, voiceIndex) =>
      partials.forEach((p, i) => {
        if (
          Math.abs(p.amplitude) < 1e-9 ||
          f * p.multiple >= ctx.sampleRate / 2
        )
          return;
        const osc = ctx.createOscillator(),
          gain = ctx.createGain();
        const level = (0.65 * p.amplitude) / (freqs.length * normalization);
        osc.frequency.value = f * p.multiple;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(level, now + 0.015);
        if (decay)
          gain.gain.setTargetAtTime(0, now + 0.015, 1 / (0.3 + i * 0.15));
        osc.connect(gain);
        gain.connect(this.master);
        const voice = { osc, gain, multiple: p.multiple, voiceIndex };
        this.voices.add(voice);
        osc.onended = () => {
          this.voices.delete(voice);
          osc.disconnect();
          gain.disconnect();
          this.onChange();
        };
        if (duration !== null) {
          const end = now + duration;
          gain.gain.setTargetAtTime(0, end - 0.08, 0.02);
          osc.stop(end);
        }
        osc.start();
      }),
    );
  }
  update(freqs) {
    if (!this.context) return;
    for (const v of this.voices) {
      const f = freqs[v.voiceIndex];
      if (f !== undefined)
        v.osc.frequency.setTargetAtTime(
          f * v.multiple,
          this.context.currentTime,
          0.012,
        );
    }
  }
  stop() {
    this.generation++;
    this.sequence = false;
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    if (this.context) {
      const now = this.context.currentTime;
      for (const v of this.voices) {
        v.gain.gain.cancelScheduledValues(now);
        v.gain.gain.setTargetAtTime(0, now, 0.015);
        v.osc.stop(now + 0.06);
      }
    }
    this.voices.clear();
    this.onChange();
  }
  async playSequence(chords, onStep = () => {}, seconds = 1.25) {
    this.stop();
    const generation = this.generation;
    await this.ensure();
    if (generation !== this.generation) return;
    this.sequence = true;
    chords.forEach((freqs, i) =>
      this.later(
        () => {
          if (generation !== this.generation) return;
          this.add(freqs, spectrum("string"), seconds * 0.9);
          onStep(i);
          this.onChange();
        },
        i * seconds * 1000,
      ),
    );
    this.later(
      () => {
        if (generation !== this.generation) return;
        this.sequence = false;
        onStep(-1);
        this.onChange();
      },
      chords.length * seconds * 1000,
    );
    this.onChange();
  }
}
export const audio = new AudioEngine();
