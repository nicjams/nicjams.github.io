// Shared numerical models. UI, sound and tests all use these functions.
export const NAMES = [
  "C",
  "C♯",
  "D",
  "E♭",
  "E",
  "F",
  "F♯",
  "G",
  "A♭",
  "A",
  "B♭",
  "B",
];
export const MAJOR = [0, 2, 4, 5, 7, 9, 11];
export const JI = [1, 9 / 8, 5 / 4, 4 / 3, 3 / 2, 5 / 3, 15 / 8];
export const RATIOS = [
  [2, 1, "Octave"],
  [3, 2, "Fifth"],
  [4, 3, "Fourth"],
  [5, 4, "Major third"],
  [6, 5, "Minor third"],
  [5, 3, "Major sixth"],
];
export const TRIADS = {
  I: [0, 4, 7],
  ii: [2, 5, 9],
  iii: [4, 7, 11],
  IV: [5, 9, 12],
  V: [7, 11, 14],
  vi: [9, 12, 16],
  "vii°": [11, 14, 17],
};
export const mod = (x, n = 12) => ((x % n) + n) % n;
export const cents = (r) => 1200 * Math.log2(r);
export function spectrum(kind = "string", position = 0.25) {
  if (kind === "sine") return [{ multiple: 1, amplitude: 1 }];
  return Array.from({ length: 8 }, (_, i) => {
    const n = i + 1;
    return {
      multiple: kind === "stretched" ? n ** 1.08 : n,
      amplitude:
        kind === "pluck"
          ? (2 * Math.sin(n * Math.PI * position)) /
            (Math.PI ** 2 * n * n * position * (1 - position))
          : kind === "bright"
            ? 1 / n
            : 1 / (n * n),
    };
  });
}
// Plomp–Levelt curve parameterization used by Sethares; product amplitude weights.
// This dimensionless model is illustrative, not a calibrated preference measure.
export function partialRoughness(f1, f2) {
  const s = 0.24 / (0.021 * Math.min(f1, f2) + 19),
    x = s * Math.abs(f1 - f2);
  return Math.exp(-3.5 * x) - Math.exp(-5.75 * x);
}
export function roughness(freqs, partials = spectrum()) {
  let sum = 0,
    weight = 0;
  for (let a = 0; a < freqs.length; a++)
    for (let b = a + 1; b < freqs.length; b++)
      for (const p of partials)
        for (const q of partials) {
          const w = Math.abs(p.amplitude * q.amplitude);
          sum +=
            w * partialRoughness(freqs[a] * p.multiple, freqs[b] * q.multiple);
          weight += w;
        }
  return weight ? sum / weight : 0;
}
export function toneFrequency(semitone, tuning = "equal", repair = false) {
  if (tuning === "equal") return 261.6255653005986 * 2 ** (semitone / 12);
  const pc = mod(semitone),
    index = MAJOR.indexOf(pc);
  if (index < 0)
    throw new Error("Just tuning is defined for the diatonic collection only.");
  let ratio = JI[index];
  if (repair && pc === 2) ratio = 10 / 9;
  return 261.6255653005986 * ratio * 2 ** Math.floor(semitone / 12);
}
export function chordFrequencies(name, tuning = "equal", repair = false) {
  return TRIADS[name].map((n) => toneFrequency(n, tuning, repair));
}
export function unionTriads(roots) {
  return [
    ...new Set(roots.flatMap((r) => [r, r + 4, r + 7].map((n) => mod(n)))),
  ].sort((a, b) => a - b);
}
export function noteName(midiOffset, octave = false) {
  return (
    NAMES[mod(midiOffset)] + (octave ? 4 + Math.floor(midiOffset / 12) : "")
  );
}
// Three ordered voices: minimize semitone motion, retaining each chord's three pitch classes.
export function voiceLeading(names) {
  const result = [TRIADS[names[0]].slice()];
  for (const name of names.slice(1)) {
    const prev = result.at(-1),
      pcs = TRIADS[name].map((n) => mod(n));
    let best = null,
      cost = Infinity;
    const options = pcs.map((pc) =>
      Array.from({ length: 4 }, (_, i) => pc + 12 * (i - 1)).filter(
        (n) => n >= -12 && n <= 24,
      ),
    );
    for (const a of options[0])
      for (const b of options[1])
        for (const c of options[2]) {
          const next = [a, b, c].sort((x, y) => x - y);
          const d = next.reduce((s, n, i) => s + Math.abs(n - prev[i]), 0);
          if (d < cost) {
            cost = d;
            best = next;
          }
        }
    result.push(best);
  }
  return result;
}
export function motion(voicings) {
  return voicings
    .slice(1)
    .reduce(
      (sum, v, k) =>
        sum + v.reduce((s, n, i) => s + Math.abs(n - voicings[k][i]), 0),
      0,
    );
}
export function foldOctave(ratio) {
  let folded = ratio / 2 ** Math.floor(Math.log2(ratio));
  // Treat floating-point representations of the boundary as the same pitch.
  if (Math.abs(folded - 2) < 1e-12 || Math.abs(folded - 1) < 1e-12) folded = 1;
  return folded;
}
export function builderFrequencies(root, fold = true) {
  const rootRatio = { 5: 2 / 3, 0: 1, 7: 3 / 2 }[root];
  if (rootRatio === undefined)
    throw new Error("Builder root must be F, C or G.");
  return [1, 5 / 4, 3 / 2].map(
    (r) =>
      261.6255653005986 * (fold ? foldOctave(rootRatio * r) : rootRatio * r),
  );
}

// Harmonicity model on rational pitch classes modulo powers of two.
// Fractions use BigInt so the proof explorer never identifies nearly equal pitches.
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
export function fraction(n, d = 1) {
  n = BigInt(n);
  d = BigInt(d);
  if (n <= 0n || d <= 0n) throw new Error("Pitch ratios must be positive.");
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}
export function pitchClass(r) {
  let { n, d } = fraction(r.n, r.d);
  while (n % 2n === 0n) n /= 2n;
  while (d % 2n === 0n) d /= 2n;
  return fraction(n, d);
}
export function ratioKey(r) {
  r = pitchClass(r);
  return `${r.n}/${r.d}`;
}
export function multiply(a, b) {
  return fraction(a.n * b.n, a.d * b.d);
}
export function divide(a, b) {
  return fraction(a.n * b.d, a.d * b.n);
}
export function ratioNumber(r) {
  return Number(r.n) / Number(r.d);
}
export function majorChord(root) {
  return [1, 3, 5].map((n) => pitchClass(multiply(root, fraction(n))));
}
export function harmonicHeight(pitches) {
  if (!pitches.length) return 0n;
  const ps = pitches.map(pitchClass);
  const denominator = ps.reduce((d, p) => (d / gcd(d, p.d)) * p.d, 1n);
  const integers = ps.map((p) => p.n * (denominator / p.d));
  const common = integers.reduce(gcd);
  return integers
    .map((n) => n / common)
    .reduce((max, n) => (n > max ? n : max), 0n);
}
export function chordPairHeight(a, b) {
  return harmonicHeight([...majorChord(a), ...majorChord(b)]);
}
export function addFractions(a, b) {
  return fraction(a.n * b.d + b.n * a.d, a.d * b.d);
}
export function harmonicNetwork(roots) {
  const canonical = roots.map(pitchClass),
    distinct = new Set(canonical.map(ratioKey)).size === roots.length;
  const pairs = [];
  let sum = { n: 0n, d: 1n };
  const centrality = roots.map(() => 0);
  for (let i = 0; i < roots.length; i++)
    for (let j = i + 1; j < roots.length; j++) {
      const height = chordPairHeight(canonical[i], canonical[j]),
        value = 1 / Number(height);
      pairs.push({ i, j, height, value });
      sum = addFractions(sum, { n: 1n, d: height });
      centrality[i] += value;
      centrality[j] += value;
    }
  const max = Math.max(...centrality),
    centers = centrality.flatMap((v, i) =>
      Math.abs(v - max) < 1e-12 ? [i] : [],
    );
  const optimal = roots.length === 3 && distinct && sum.n * 45n === 7n * sum.d;
  const union = [
    ...new Map(
      canonical.flatMap(majorChord).map((p) => [ratioKey(p), p]),
    ).values(),
  ];
  return {
    pairs,
    score: sum,
    value: ratioNumber(sum),
    centrality,
    centers,
    distinct,
    optimal,
    union,
  };
}
export function oddPart(n) {
  while (n % 2 === 0) n /= 2;
  return n;
}
export function foldRatio(r) {
  let { n, d } = fraction(r.n, r.d);
  while (n < d) n *= 2n;
  while (n >= 2n * d) d *= 2n;
  return fraction(n, d);
}
export function formatRatio(r) {
  r = fraction(r.n, r.d);
  return r.d === 1n ? String(r.n) : `${r.n}/${r.d}`;
}
