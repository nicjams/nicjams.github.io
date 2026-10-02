import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../js/model.js";
const near = (a, b, t = 1e-10) =>
  assert.ok(Math.abs(a - b) < t, `${a} != ${b}`);

test("exact triad construction, octave folding and syntonic-comma tradeoff", () => {
  const root = M.toneFrequency(0, "just");
  const all = [5, 0, 7].flatMap((r) => M.builderFrequencies(r));
  const unique = [
    ...new Set(all.map((f) => Math.round((f / root) * 1e10) / 1e10)),
  ].sort((a, b) => a - b);
  assert.equal(unique.length, 7);
  unique.forEach((r, i) => near(r, M.JI[i], 1e-9));
  for (const r of [5, 0, 7]) {
    const f = M.builderFrequencies(r, false);
    near(f[1] / f[0], 5 / 4);
    near(f[2] / f[0], 3 / 2);
  }
  for (const r of [1, 2, 4, 0.5, 0.25, 1 - Number.EPSILON])
    near(M.foldOctave(r), 1);
  const ii = M.chordFrequencies("ii", "just"),
    v = M.chordFrequencies("V", "just");
  near(ii[2] / ii[0], 40 / 27);
  near(v[2] / v[0], 3 / 2);
  const repairII = M.chordFrequencies("ii", "just", true),
    repairV = M.chordFrequencies("V", "just", true);
  near(repairII[1] / repairII[0], 6 / 5);
  near(repairII[2] / repairII[0], 3 / 2);
  near(repairV[2] / repairV[0], 40 / 27);
  near(M.toneFrequency(2, "just") / M.toneFrequency(2, "just", true), 81 / 80);
  near(M.toneFrequency(4) / root, 2 ** (4 / 12));
  near(M.cents(M.toneFrequency(7) / root), 700);
  for (const [n, d] of M.RATIOS) near((220 * (n / d)) / 220, n / d);
});
test("plucked string has correct midpoint parity and converges to triangular initial displacement", () => {
  const ps = M.spectrum("pluck", 0.5);
  ps.forEach((p, i) => {
    if ((i + 1) % 2 === 0) near(p.amplitude, 0);
  });
  for (const p of [0.1, 0.25, 0.5, 0.8]) {
    const triangle = (x) => (x <= p ? x / p : (1 - x) / (1 - p));
    for (const x of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      let sum = 0;
      for (let n = 1; n <= 2000; n++)
        sum +=
          ((2 * Math.sin(n * Math.PI * p)) /
            (Math.PI ** 2 * n * n * p * (1 - p))) *
          Math.sin(n * Math.PI * x);
      near(sum, triangle(x), 0.002);
    }
  }
  assert.notDeepEqual(M.spectrum("pluck", 0.1), ps);
});
test("roughness is symmetric, nonnegative and frequency dependent", () => {
  near(M.partialRoughness(440, 440), 0);
  near(M.partialRoughness(440, 470), M.partialRoughness(470, 440));
  assert.ok(M.partialRoughness(440, 470) > M.partialRoughness(440, 441));
  assert.notEqual(M.partialRoughness(440, 470), M.partialRoughness(1440, 1470));
  for (const timbre of ["sine", "string", "bright", "stretched"])
    for (let c = 0; c <= 1200; c += 20)
      assert.ok(
        M.roughness([220, 220 * 2 ** (c / 1200)], M.spectrum(timbre)) >= 0,
      );
});
test("voice leading preserves chord identity and reduces motion in both offered progressions", () => {
  for (const names of [
    ["I", "IV", "V", "I"],
    ["I", "ii", "iii", "IV", "V", "vi", "vii°", "I"],
  ]) {
    const vs = M.voiceLeading(names);
    assert.ok(M.motion(vs) < M.motion(names.map((n) => M.TRIADS[n])));
    vs.forEach((v, i) => {
      assert.deepEqual(
        v.map((n) => M.mod(n)).sort((a, b) => a - b),
        M.TRIADS[names[i]].map((n) => M.mod(n)).sort((a, b) => a - b),
      );
      assert.ok(v.every((n) => n >= -12 && n <= 24));
      assert.deepEqual(
        v,
        [...v].sort((a, b) => a - b),
      );
    });
  }
  assert.equal(M.motion(M.voiceLeading(["I", "IV", "V", "I"])), 12);
});
