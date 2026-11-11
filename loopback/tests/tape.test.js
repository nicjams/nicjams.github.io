// The tape machine runs in an AudioWorklet; here it runs under a stand-in for
// the worklet's globals, one 128-frame quantum at a time.
import test from 'node:test';
import assert from 'node:assert/strict';

let Tape;
globalThis.sampleRate = 48000;
globalThis.currentFrame = 0;
globalThis.AudioWorkletProcessor = class {
  constructor() { this.port = { posted: [], postMessage(m) { this.posted.push(m); }, onmessage: null }; }
};
globalThis.registerProcessor = (_name, cls) => { Tape = cls; };
await import('../js/tape-worklet.js');

const Q = 128;
const signal = (f) => Math.sin(f * 0.013) * 0.5 + ((f % 97) - 48) / 400;

function machine() {
  globalThis.currentFrame = 0;
  const tape = new Tape();
  const send = (m) => tape.port.onmessage({ data: m });
  const run = (frames, input = signal) => {
    const out = new Float32Array(frames);
    for (let o = 0; o < frames; o += Q) {
      const f0 = globalThis.currentFrame;
      const inp = Float32Array.from({ length: Q }, (_, i) => (input ? input(f0 + i) : 0));
      const block = new Float32Array(Q);
      tape.process(input ? [[inp]] : [[]], [[block]]);
      out.set(block.subarray(0, Math.min(Q, frames - o)), o);
      globalThis.currentFrame += Q;
    }
    return out;
  };
  const extract = (from, to) => {
    send({ type: 'extract', id: 1, from, to });
    return tape.port.posted.filter((m) => m.type === 'extract').pop().data;
  };
  return { tape, send, run, extract };
}

test('the capture is stamped with the context frame it arrived at', () => {
  const { run, extract } = machine();
  run(48000);
  const got = extract(30000, 30500);
  for (let i = 0; i < got.length; i++) assert.equal(got[i], Math.fround(signal(30000 + i)));
});

test('old capture is let go unless something keeps it', () => {
  const { send, run, extract } = machine();
  send({ type: 'keep', id: 'solo', from: 10000 });
  send({ type: 'keep', id: 'loop', from: 20000 });
  run(48000 * 6);
  send({ type: 'release', id: 'loop' });
  run(Q);
  assert.equal(extract(12000, 12001)[0], Math.fround(signal(12000)), 'kept by the solo');
  send({ type: 'release', id: 'solo' });
  run(Q);
  assert.equal(extract(12000, 12001)[0], 0, 'released');
  const recent = 48000 * 6 - 1000;
  assert.equal(extract(recent, recent + 1)[0], Math.fround(signal(recent)), 'the last few seconds stay');
});

test('a loop voice plays a stretch of the capture round and round', () => {
  const { send, run } = machine();
  const from = 1000, period = 6000, anchor = 20000;
  run(anchor - 2 * Q);
  send({ type: 'voice', id: 'loop', from, length: period, period, anchor, start: anchor, fadeIn: 0, gain: 1 });
  const before = globalThis.currentFrame;
  const out = run(3 * period);
  for (let i = 0; i < out.length; i++) {
    const f = before + i;
    const want = f < anchor ? 0 : Math.fround(signal(from + ((f - anchor) % period)));
    assert.ok(Math.abs(out[i] - want) < 1e-6, `frame ${f}`);
  }
});

test('the replay reads the capture one solo behind, sample for sample', () => {
  const { send, run } = machine();
  const B = 4096, len = 10000, E = B + len, lat = 300;
  send({ type: 'voice', id: 'replay', from: B + lat, length: len, anchor: E, start: E, stop: E + len, fadeIn: 0, fadeOut: 0, gain: 1 });
  const out = run(E + len + 1000);
  assert.equal(out[E - 1], 0);
  for (let f = E; f < E + len; f++) assert.ok(Math.abs(out[f] - Math.fround(signal(B + lat + f - E))) < 1e-6, `frame ${f}`);
  assert.equal(out[E + len + 10], 0);
});

test('an array voice swaps in without losing its place', () => {
  const { send, run } = machine();
  const period = 1000, data = Float32Array.from({ length: period }, (_, i) => i / period);
  send({ type: 'voice', id: 'loop', from: 0, length: period, period, anchor: 0, start: 0, fadeIn: 0, gain: 1 });
  run(5 * Q);
  send({ type: 'update', id: 'loop', data });
  const at = globalThis.currentFrame, out = run(Q);
  for (let i = 0; i < Q; i++) assert.ok(Math.abs(out[i] - data[(at + i) % period]) < 1e-6);
});

test('stopping a voice fades it and then it is gone', () => {
  const { tape, send, run } = machine();
  const data = new Float32Array(1000).fill(0.5);
  send({ type: 'voice', id: 'v', data, period: 1000, anchor: 0, start: 0, fadeIn: 0, gain: 1 });
  run(2 * Q);
  send({ type: 'stop', id: 'v', fade: 64 });
  const out = run(2 * Q);
  assert.ok(out[0] > 0.4 && out[63] < 0.02 && out[200] === 0);
  assert.equal(tape.voices.size, 0);
});

test('metronome clicks land on their frames, accented on the bar', () => {
  const { send, run } = machine();
  const anchor = 1000.4, interval = 24000 * 0.5;   // 120 BPM
  send({ type: 'metro', anchor, interval, bpb: 4, from: 0, until: Math.round(anchor + 5 * interval), gain: 1 });
  const out = run(anchor + 6 * interval, null);
  const starts = [];
  for (let i = 1; i < out.length; i++) if (out[i] !== 0 && out[i - 1] === 0 && (starts.length === 0 || i - starts.at(-1) > 1000)) starts.push(i);
  assert.deepEqual(starts.map((s) => s - 1), [0, 1, 2, 3, 4].map((k) => Math.round(anchor + k * interval)));
  const peak = (s) => Math.max(...out.subarray(s, s + 200).map(Math.abs));
  assert.ok(peak(starts[0]) > peak(starts[1]) * 1.3, 'the downbeat is accented');
  assert.ok(peak(starts[4]) > peak(starts[3]) * 1.3);
});

test('a chosen input channel is captured on its own', () => {
  const { tape, send, extract } = machine();
  send({ type: 'channel', mode: 2 });
  const chans = [0, 1, 2, 3].map((c) => new Float32Array(Q).fill(c / 10));
  tape.process([chans], [[new Float32Array(Q)]]);
  assert.ok(Math.abs(extract(0, 1)[0] - 0.2) < 1e-6);
  send({ type: 'channel', mode: 'mix' });
  globalThis.currentFrame = Q;
  tape.process([chans], [[new Float32Array(Q)]]);
  assert.ok(Math.abs(extract(Q, Q + 1)[0] - 0.05) < 1e-6);
});

test('it says how many input channels arrive, and counts again when asked', () => {
  const { tape, send, extract } = machine();
  const counts = () => tape.port.posted.filter((m) => m.type === 'channels').map((m) => m.n);
  const chans = Array.from({ length: 24 }, (_, c) => new Float32Array(Q).fill(c / 100));
  send({ type: 'channel', mode: 9 });
  tape.process([chans], [[new Float32Array(Q)]]);
  globalThis.currentFrame = Q;
  tape.process([chans], [[new Float32Array(Q)]]);
  assert.deepEqual(counts(), [24]);
  assert.ok(Math.abs(extract(0, 1)[0] - 0.09) < 1e-6);   // input 10 of a mixer's 24
  send({ type: 'recount' });
  globalThis.currentFrame = 2 * Q;
  tape.process([chans], [[new Float32Array(Q)]]);
  assert.deepEqual(counts(), [24, 24]);
});
