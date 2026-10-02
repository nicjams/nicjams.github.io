import test from "node:test";
import assert from "node:assert/strict";
import { AudioEngine } from "../js/audio.js";
import { spectrum } from "../js/model.js";
class Param {
  constructor() {
    this.value = 0;
    this.events = [];
  }
  setValueAtTime(v, t) {
    this.value = v;
    this.events.push(["set", v, t]);
  }
  linearRampToValueAtTime(v, t) {
    this.value = v;
    this.events.push(["ramp", v, t]);
  }
  setTargetAtTime(v, t, c) {
    this.value = v;
    this.events.push(["target", v, t, c]);
  }
  cancelScheduledValues(t) {
    this.events.push(["cancel", t]);
  }
}
class FakeContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 48000;
    this.state = "running";
    this.destination = {};
    this.oscs = [];
  }
  createGain() {
    return { gain: new Param(), connect() {}, disconnect() {} };
  }
  createOscillator() {
    const osc = {
      frequency: new Param(),
      stops: [],
      connect() {},
      disconnect() {},
      start() {},
      stop(t) {
        this.stops.push(t);
      },
    };
    this.oscs.push(osc);
    return osc;
  }
  async resume() {
    this.state = "running";
  }
}
test("Stop releases every voice and frequency drags reuse oscillators", async () => {
  const ctx = new FakeContext(),
    a = new AudioEngine(() => ctx);
  await a.play([220, 330], spectrum());
  assert.equal(ctx.oscs.length, 16);
  assert.equal(a.voices.size, 16);
  const old = [...a.voices];
  a.update([230, 345]);
  assert.equal(ctx.oscs.length, 16);
  old.forEach((v) =>
    assert.equal(v.osc.frequency.value, [230, 345][v.voiceIndex] * v.multiple),
  );
  a.stop();
  assert.equal(a.voices.size, 0);
  old.forEach((v) => assert.equal(v.osc.stops.at(-1), 0.06));
  assert.equal(a.playing, false);
});
test("replacing a chord releases its voices; stale ended callbacks cannot stop the replacement", async () => {
  const ctx = new FakeContext(),
    a = new AudioEngine(() => ctx);
  await a.play([220], spectrum(), 3);
  const first = [...a.voices];
  ctx.currentTime = 1;
  await a.play([330], spectrum(), 3);
  const second = [...a.voices];
  first.forEach((v) => {
    assert.equal(v.osc.stops.at(-1), 1.06);
    v.osc.onended();
  });
  assert.equal(a.voices.size, 8);
  assert.equal(a.playing, true);
  second.forEach((v) => assert.equal(v.osc.stops.at(-1), 4));
  a.stop();
});
test("Stop during an asynchronous audio resume prevents late playback", async () => {
  const ctx = new FakeContext();
  ctx.state = "suspended";
  let resume;
  ctx.resume = () =>
    new Promise((resolve) => {
      resume = resolve;
    });
  const a = new AudioEngine(() => ctx);
  const pending = a.play([440]);
  a.stop();
  resume();
  await pending;
  assert.equal(ctx.oscs.length, 0);
});
test("sequence owns and stops its voices, cancels timers, and ends cleanly", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const ctx = new FakeContext(),
    a = new AudioEngine(() => ctx),
    steps = [];
  await a.playSequence(
    [
      [220, 275, 330],
      [220, 293, 366],
      [247, 294, 392],
      [220, 275, 330],
    ],
    (i) => steps.push(i),
    1,
  );
  t.mock.timers.tick(0);
  assert.equal(ctx.oscs.length, 24);
  t.mock.timers.tick(1000);
  assert.equal(ctx.oscs.length, 48);
  a.stop();
  assert.equal(a.timers.size, 0);
  assert.equal(a.voices.size, 0);
  assert.ok(ctx.oscs.every((o) => o.stops.length >= 1));
  t.mock.timers.tick(10000);
  assert.equal(ctx.oscs.length, 48);
  assert.deepEqual(steps, [0, 1]);
  await a.playSequence([[220], [330]], (i) => steps.push(i), 1);
  t.mock.timers.tick(2000);
  assert.equal(a.sequence, false);
  assert.equal(steps.at(-1), -1);
  assert.ok(ctx.oscs.every((o) => o.stops.length >= 1));
  for (const v of [...a.voices]) v.osc.onended();
  assert.equal(a.playing, false);
  assert.equal(a.timers.size, 0);
});
test("pluck sound follows supplied amplitudes, omits absent modes and releases on exit", async () => {
  const ctx = new FakeContext(),
    a = new AudioEngine(() => ctx),
    ps = spectrum("pluck", 0.5);
  await a.play([82.41], ps, 8, true);
  assert.equal(a.voices.size, 4);
  assert.deepEqual(
    [...a.voices].map((v) => v.multiple),
    [1, 3, 5, 7],
  );
  const gains = [...a.voices].map(
    (v) => v.gain.gain.events.find((e) => e[0] === "ramp")[1],
  );
  assert.ok(gains[0] > 0 && gains[1] < 0);
  a.stop();
  ctx.oscs.forEach((o) => assert.equal(o.stops.at(-1), 0.06));
});
