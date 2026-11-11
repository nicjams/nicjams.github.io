import test from 'node:test';
import assert from 'node:assert/strict';
import { seamlessLoop, peaks, levelGain, mixTake, detectOnset, measureLatency, guessMeter,
  toPcm16, fromPcm16, encodeWav, decimate } from '../js/dsp.js';
import { strumChart } from '../js/strum.js';

test('a seamless loop keeps its downbeat and continues across the seam', () => {
  const sr = 1000, f = 7;
  const rec = Float32Array.from({ length: 3000 }, (_, i) => Math.sin((2 * Math.PI * f * i) / sr));
  const start = 500, len = 1234, fade = 40;   // 1234 samples is not a whole number of cycles
  const loop = seamlessLoop(rec, start, len, fade);
  assert.equal(loop.length, len);
  for (let i = 0; i < len - fade; i++) assert.equal(loop[i], rec[start + i]);
  // the last sample leads into the first as the recording did into `start`
  assert.ok(Math.abs(loop[len - 1] - rec[start - 1]) < 1e-6);
  // the wrap itself steps no further than the waveform does between samples,
  // and nothing in the crossfade clicks
  const maxStep = 2 * Math.sin((Math.PI * f) / sr);
  assert.ok(Math.abs(loop[0] - loop[len - 1]) <= maxStep * 1.05);
  const naive = rec.slice(start, start + len);
  assert.ok(Math.abs(naive[0] - naive[len - 1]) > 5 * maxStep, 'the uncut loop would have clicked');
  for (let i = 0; i < len; i++) assert.ok(Math.abs(loop[(i + 1) % len] - loop[i]) <= maxStep + Math.PI / fade, `step at ${i}`);
});

test('peaks and level gain', () => {
  const d = Float32Array.from([0, 0.5, -1, 0.25, 0, 0, -0.1, 0.2]);
  assert.deepEqual(Array.from(peaks(d, 4)), [0.5, 1, 0, 0.2].map(Math.fround));
  assert.equal(levelGain(0.35), 2);
  assert.equal(levelGain(0), 1);
  assert.equal(levelGain(0.001), 100);
  assert.ok(Math.abs(levelGain(0.0039) * 0.0039 - 0.39) < 0.01);   // a −48 dB recording comes up to about −8 dB
});

test('a take mixes over the loop repeated, then rings out', () => {
  const loop = Float32Array.from([0.1, 0.2]);
  const solo = Float32Array.from([0.5, 0, 0, 0.5]);
  const mix = mixTake({ loop, solo, passes: 2, ringOut: 2 });
  assert.equal(mix.length, 6);
  assert.ok(Math.abs(mix[0] - 0.6) < 1e-6 && Math.abs(mix[3] - 0.7) < 1e-6);
  assert.ok(Math.abs(mix[4] - 0.1) < 1e-6 && Math.abs(mix[5] - 0.1) < 1e-6);
  const loud = mixTake({ loop: Float32Array.from([0.9]), solo: Float32Array.from([0.9]), passes: 1 });
  assert.ok(loud[0] <= 1 && loud[0] > 0.9);
});

test('latency is measured from clicks heard after a delay', () => {
  const sr = 48000, delay = 0.0437, out = new Float32Array(sr * 4);
  const clicks = [0.5, 1.1, 1.7, 2.3, 2.9].map((t) => Math.round(t * sr));
  for (let i = 0; i < out.length; i++) out[i] = (Math.random() - 0.5) * 0.004;
  for (const c of clicks) {
    const at = c + Math.round(delay * sr);
    for (let i = 0; i < 2000; i++) out[at + i] += 0.6 * Math.sin((2 * Math.PI * 1568 * i) / sr) * Math.exp(-i / 500);
  }
  const r = measureLatency(out, sr, clicks);
  assert.ok(r, 'heard the clicks');
  assert.equal(r.heard, 5);
  assert.ok(Math.abs(r.latency - delay) < 0.001, `measured ${r.latency}`);
  assert.equal(measureLatency(new Float32Array(sr * 4), sr, clicks), null);
  assert.equal(detectOnset(new Float32Array(1000), sr, 0, 1000), -1);
});

test('the bar count of an untimed loop is recovered from its strumming', () => {
  const sr = 22050;
  for (const [bpm, bars] of [[96, 4], [120, 4], [84, 2], [108, 8]]) {
    const chart = Array.from({ length: bars }, (_, i) => [['G'], ['C'], ['D'], ['G']][i % 4]);
    const data = strumChart({ chart, bpm, sr });
    const m = guessMeter(data, sr, 4);
    assert.equal(m.bars, bars, `${bpm} BPM`);
    assert.ok(Math.abs(m.bpm - bpm) < 0.5);
  }
});

test('16-bit PCM and WAV round trip', () => {
  const d = Float32Array.from([0, 0.5, -0.5, 1, -1, 2]);
  const back = fromPcm16(toPcm16(d));
  for (let i = 0; i < 5; i++) assert.ok(Math.abs(back[i] - d[i]) < 1e-4);
  assert.equal(back[5], 1);   // clipped
  const wav = new DataView(encodeWav([d], 44100));
  assert.equal(String.fromCharCode(...new Uint8Array(wav.buffer, 0, 4)), 'RIFF');
  assert.equal(wav.getUint32(24, true), 44100);
  assert.equal(wav.getUint32(40, true), d.length * 2);
  assert.equal(wav.getInt16(44 + 2, true), Math.round(0.5 * 32767));
});

test('decimation keeps a low tone and removes a high one', () => {
  const sr = 48000, n = 4800;
  const low = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 200 * i) / sr));
  const high = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 9000 * i) / sr));
  const rms = (x) => Math.sqrt(x.slice(50, -50).reduce((a, v) => a + v * v, 0) / (x.length - 100));
  assert.ok(Math.abs(rms(decimate(low, 4)) - Math.SQRT1_2) < 0.02);
  assert.ok(rms(decimate(high, 4)) < 0.02);
});
