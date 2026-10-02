import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../js/model.js";
const f = M.fraction;
const sameRatio = (a, b) => assert.equal(a.n * b.d, b.n * a.d);
const keys = (ps) => ps.map(M.ratioKey).sort().join(",");

test("harmonic height identifies octaves, common factors and common transpositions", () => {
  assert.equal(M.harmonicHeight([f(4), f(5), f(6)]), 5n);
  assert.equal(M.harmonicHeight([f(3), f(4), f(5)]), 5n);
  assert.equal(M.harmonicHeight([f(10), f(12), f(15)]), 15n);
  assert.equal(M.harmonicHeight([f(1), f(4, 3), f(3, 2)]), 9n);
  for (const root of [f(17, 35), f(4, 9), f(1), f(99, 98)]) {
    assert.equal(M.harmonicHeight(M.majorChord(root)), 5n);
    const chord = M.majorChord(root).map((p, i) =>
      M.multiply(p, f(2 ** (i + 1))),
    );
    assert.equal(M.harmonicHeight(chord), 5n);
  }
  assert.equal(M.harmonicHeight([f(2), f(4), f(8)]), 1n);
  assert.throws(() => f(0));
  assert.throws(() => f(-1));
  assert.throws(() => f(1, 0));
});
test("every low-height triad has height at least five, equality only for major", () => {
  // Independent representatives from the first 31 harmonics, including inversions and octave duplications.
  let checked = 0;
  for (let a = 1; a <= 31; a++)
    for (let b = a + 1; b <= 31; b++)
      for (let c = b + 1; c <= 31; c++) {
        const triad = [a, b, c].map((n) => f(n));
        if (new Set(triad.map(M.ratioKey)).size < 3) continue;
        const h = M.harmonicHeight(triad);
        assert.ok(h >= 5n);
        checked++;
        if (h === 5n) {
          // Normalize independently using elementary number arithmetic; only primitive odd {1,3,5} can attain 5.
          const odd = (n) => {
            while (n % 2 === 0) n /= 2;
            return n;
          };
          const gcd = (a, b) => (b ? gcd(b, a % b) : a);
          const ns = [a, b, c].map(odd),
            g = ns.reduce(gcd);
          assert.deepEqual(
            ns.map((n) => n / g).sort((x, y) => x - y),
            [1, 3, 5],
          );
        }
      }
  assert.ok(checked > 3000);
  const firstFour = new Set([1, 2, 3, 4].map((n) => M.ratioKey(f(n))));
  assert.equal(firstFour.size, 2);
  assert.equal(new Set([1, 2, 3, 4, 5].map((n) => M.ratioKey(f(n)))).size, 3);
});
test("pair-height formula and the unique best-pair root relationship", () => {
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  for (let a = 1; a <= 31; a += 2)
    for (let b = 1; b <= 31; b += 2) {
      if (gcd(a, b) !== 1 || a === b) continue;
      const height = M.chordPairHeight(f(a), f(b));
      assert.equal(height, BigInt(5 * Math.max(a, b)));
      assert.equal(
        height === 15n,
        (a === 1 && b === 3) || (a === 3 && b === 1),
      );
      if (height !== 15n) assert.ok(height >= 25n);
    }
});
test("all bounded rational chord triples satisfy the global theorem; equality has a unique center", () => {
  const roots = [
    ...new Map(
      Array.from({ length: 9 }, (_, i) => 2 * i + 1)
        .flatMap((n) => Array.from({ length: 9 }, (_, i) => f(n, 2 * i + 1)))
        .map((r) => [M.ratioKey(r), r]),
    ).values(),
  ];
  // Fix one root by transposition; the two other roots range independently over this grid.
  let checked = 0,
    winners = 0;
  for (let i = 0; i < roots.length; i++)
    for (let j = i + 1; j < roots.length; j++) {
      const rs = [f(1), roots[i], roots[j]],
        network = M.harmonicNetwork(rs);
      if (!network.distinct) continue;
      checked++;
      assert.ok(network.score.n * 45n <= 7n * network.score.d);
      const best = network.pairs.filter((p) => p.height === 15n);
      assert.equal(network.optimal, best.length === 2);
      if (network.optimal) {
        winners++;
        assert.equal(network.centers.length, 1);
        const center = network.centers[0];
        const relative = rs.map((r) => M.divide(r, rs[center]));
        assert.equal(keys(relative), keys([f(1, 3), f(1), f(3)]));
        const union = network.union
          .map((p) => M.foldRatio(M.divide(p, rs[center])))
          .sort((a, b) => M.ratioNumber(a) - M.ratioNumber(b));
        assert.deepEqual(union.map(M.formatRatio), [
          "1",
          "9/8",
          "5/4",
          "4/3",
          "3/2",
          "5/3",
          "15/8",
        ]);
      }
    }
  assert.ok(checked > 1000);
  assert.equal(winners, 3); // C can be the lower, middle or upper root of the chain.
});
test("center distinguishes the rooted major scale, and alternative objectives really differ", () => {
  const chain = M.harmonicNetwork([f(1, 3), f(1), f(3)]),
    alternative = M.harmonicNetwork([f(1), f(3), f(5)]);
  sameRatio(chain.score, f(7, 45));
  sameRatio(alternative.score, f(11, 75));
  assert.deepEqual(chain.centers, [1]);
  assert.ok(chain.centrality[1] > chain.centrality[0]);
  assert.equal(chain.union.length, 7);
  assert.equal(alternative.union.length, 6);
  assert.equal(M.harmonicHeight(chain.union), 45n);
  assert.equal(M.harmonicHeight(alternative.union), 25n);
  assert.equal(
    chain.pairs.reduce((s, p) => s + p.height, 0n),
    75n,
  );
  assert.equal(
    alternative.pairs.reduce((s, p) => s + p.height, 0n),
    65n,
  );
  const shifted = M.harmonicNetwork([f(1), f(3), f(9)]);
  assert.deepEqual(shifted.centers, [1]);
  assert.ok(shifted.optimal);
  assert.equal(M.harmonicNetwork([f(1), f(2), f(3)]).distinct, false);
});
