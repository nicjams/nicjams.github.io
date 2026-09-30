// Checks for graphics/cubicBarrier (no browser needed):
//   node graphics/tests/cubicBarrier.mjs
//
// 1. Braid algebra: relations, Garside normal form, Burau, Alexander.
// 2. The solver is intersection-free through a braid, and the braid read
//    back from the simulated strands equals the applied word.
// 3. A strand yanked through its neighbour tunnels with the CCD filter off
//    and never with it on.
// 4. Every knot preset starts with clearance and tightens without stalling.
import assert from 'node:assert/strict';
import {
  garside, garsideEqual, alexander, polyString, knotName, permutation, freeReduce,
  inverse, deltaWord, simpleWord, burau, readBraid,
} from '../cubicBarrier/js/braid.js';
import { BraidScene, KnotScene, KNOTS } from '../cubicBarrier/js/scenes.js';
import { BARRIERS } from '../cubicBarrier/js/barrier.js';

const eq = (a, b, n) => garsideEqual(garside(a, n), garside(b, n));

// ---------------------------------------------------------------- 1. algebra
{
  assert.ok(eq([1, 2, 1], [2, 1, 2], 3), 'braid relation');
  assert.ok(eq([1, 3], [3, 1], 4), 'far commutation');
  assert.ok(eq([1, -1], [], 3), 'inverse');
  assert.ok(!eq([1, 2], [2, 1], 3), 'σ1σ2 ≠ σ2σ1');
  assert.ok(!eq([1, 1], [], 2), 'σ1² ≠ e');
  const D = deltaWord(4), D2 = [...D, ...D];
  for (const g of [1, 2, 3, -1, -2, -3]) assert.ok(eq([...D2, g], [g, ...D2], 4), 'Δ² is central');
  assert.ok(eq([...D, 1], [3, ...D], 4), 'Δσ1 = σ3Δ');
  assert.ok(eq(Array(4).fill([1, 2, 3]).flat(), D2, 4), 'δ⁴ = Δ²');

  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let trial = 0; trial < 200; trial++) {
    const n = 2 + Math.floor(rnd() * 5);
    const w = Array.from({ length: Math.floor(rnd() * 24) }, () => (1 + Math.floor(rnd() * (n - 1))) * (rnd() < 0.5 ? -1 : 1));
    const nf = garside(w, n), back = [];
    for (let k = 0; k < Math.abs(nf.p); k++) back.push(...(nf.p > 0 ? deltaWord(n) : inverse(deltaWord(n))));
    for (const f of nf.factors) back.push(...simpleWord(f));
    assert.ok(garsideEqual(garside(back, n), nf), 'normal form round trip');
    assert.ok(eq([...w, ...inverse(w)], [], n), 'w·w⁻¹ = e');
    assert.ok(eq(freeReduce(w), w, n), 'free reduction');
    assert.deepEqual(permutation(w, n), permutation(back, n));
    burau([...w, ...inverse(w)], n).forEach((row, r) => row.forEach((e, c) => assert.equal(polyString(e), r === c ? '1' : '0')));
  }
  assert.equal(polyString(alexander([1, 1, 1], 2)), 't − 1 + t⁻¹');
  assert.equal(knotName(alexander([-1, -1, -1], 2)), '3₁ (trefoil)');
  assert.equal(knotName(alexander([1, -2, 1, -2], 3)), '4₁ (figure-eight)');
  assert.equal(knotName(alexander([1, 1, 1, 1, 1], 2)), '5₁ (cinquefoil)');
  assert.equal(knotName(alexander([1, 1, 1, 2, -1, 2], 3)), '5₂ (three-twist)');
  assert.equal(knotName(alexander([1, 2, 1, 2, 1, 2, 1, 2], 3)), '8₁₉ = T(3,4)');
  assert.equal(knotName(alexander([1, 2], 3)), '0₁ (unknot)');
  // the barriers are C¹ at ĝ and the cubic one is finite at contact
  for (const B of Object.values(BARRIERS)) assert.equal(B.energy(1, 1), 0);
  assert.equal(BARRIERS.cubic.energy(0, 1), 2 / 3);
  console.log('✓ braid algebra');
}

// ------------------------------------------------ 2. braid, then read it back
for (const [n, word] of [[3, [1, -2, 1, -2, 1, -2]], [4, [1, 2, -3, 1, -2, 3]]]) {
  const scene = new BraidScene({ n });
  const sim = scene.build({ friction: 0.08 });
  for (const g of word) scene.gen(g);
  let steps = 0, bad = 0, stalls = 0, doneAt = null;
  while (steps < 20000) {
    const st = sim.step();
    steps++; bad += st.intersecting; stalls += st.stalled;
    if (!scene.busy && doneAt === null) doneAt = sim.t;
    if (doneAt !== null && sim.t > doneAt + 1) break;
  }
  sim._assemble(sim.p.dt, true);
  bad += sim.stats.intersecting;
  const yb = Math.min(...scene.beads.map((v) => sim.x[3 * v + 1])) - 0.05;
  const rb = readBraid(scene.strandPolylines(), scene.yTop, yb);
  assert.equal(bad, 0, 'no intersecting pair in any accepted step');
  assert.equal(stalls, 0, 'no stalled step');
  assert.deepEqual(scene.applied, word, 'every move committed');
  assert.ok(garsideEqual(garside(rb.word, n), garside(word, n)), 'read-back braid equals the applied braid');
  console.log(`✓ B${n}: ${word.join(',')} — ${steps} steps, read back equal`);
}

// ------------------------------------------------ 3. the CCD filter matters
for (const ccd of [true, false]) {
  const scene = new BraidScene({ n: 2 });
  const sim = scene.build({ friction: 0.08, ccd });
  for (let k = 0; k < 200; k++) sim.step();
  const s0 = sim.strands[0], v = s0.start + Math.floor(s0.count * 0.55);
  sim.grab = { v, target: [sim.x[3 * v], sim.x[3 * v + 1], 0], k: 0.5 };
  let worst = 0;
  for (let k = 0; k < 90; k++) {
    if (k < 30) sim.grab.target[0] = -0.07 + (0.5 * (k + 1)) / 30;
    worst = Math.max(worst, sim.step().intersecting);
  }
  if (ccd) assert.equal(worst, 0, 'CCD on: a yanked strand never passes through');
  else assert.ok(worst > 0, 'CCD off: the yanked strand tunnels');
  console.log(`✓ yank with CCD ${ccd ? 'on ' : 'off'}: ${worst} intersecting pairs at worst`);
}

// ------------------------------------------------ 4. knots tighten cleanly
for (const knot of Object.keys(KNOTS)) {
  const sc = new KnotScene({ knot, pull: 1 });
  const sim = sc.build({ friction: 0.25 });
  sim._assemble(sim.p.dt, true);
  assert.equal(sim.stats.intersecting, 0, `${knot}: starts intersection-free`);
  let bad = 0, stalls = 0;
  while (sim.t < 8) { const st = sim.step(); bad += st.intersecting; stalls += st.stalled; }
  assert.equal(bad, 0, `${knot}: stays intersection-free`);
  assert.equal(stalls, 0, `${knot}: never stalls`);
  console.log(`✓ knot ${knot}: separation ${sc.sep0.toFixed(2)} → ${sc.sep.toFixed(2)} m, ${sim.stats.contacts} contacts`);
}

console.log('all cubicBarrier checks passed');
