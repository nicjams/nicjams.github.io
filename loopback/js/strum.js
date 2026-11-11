// A plucked-string guitar (Karplus–Strong) that strums a chord chart. It makes
// the demo loops, and stands in for a player when the app is tested without a
// microphone.

const OPEN = [40, 45, 50, 55, 59, 64];   // E A D G B E
const SHAPES = {
  C: [-1, 3, 2, 0, 1, 0], Cmaj7: [-1, 3, 2, 0, 0, 0], C7: [-1, 3, 2, 3, 1, 0],
  D: [-1, -1, 0, 2, 3, 2], Dm: [-1, -1, 0, 2, 3, 1], D7: [-1, -1, 0, 2, 1, 2], Dm7: [-1, -1, 0, 2, 1, 1],
  E: [0, 2, 2, 1, 0, 0], Em: [0, 2, 2, 0, 0, 0], E7: [0, 2, 0, 1, 0, 0], Em7: [0, 2, 0, 0, 0, 0],
  F: [1, 3, 3, 2, 1, 1], Fmaj7: [-1, -1, 3, 2, 1, 0],
  G: [3, 2, 0, 0, 0, 3], G7: [3, 2, 0, 0, 0, 1],
  A: [-1, 0, 2, 2, 2, 0], Am: [-1, 0, 2, 2, 1, 0], A7: [-1, 0, 2, 0, 2, 0], Am7: [-1, 0, 2, 0, 1, 0],
  B7: [-1, 2, 1, 2, 0, 2], Bm: [-1, 2, 4, 4, 3, 2], 'B♭': [-1, 1, 3, 3, 3, 1], Bb: [-1, 1, 3, 3, 3, 1],
};

export const DEMOS = [
  { name: 'Mixolydian jam', bpm: 100, beatsPerBar: 4, chart: [['G'], ['F'], ['C'], ['G']] },
  { name: 'Minor groove', bpm: 88, beatsPerBar: 4, chart: [['Am'], ['F'], ['C'], ['G']] },
  { name: 'Dorian vamp', bpm: 108, beatsPerBar: 4, chart: [['Em7'], ['A'], ['Em7'], ['A']] },
];

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Add one plucked string into `out` starting at sample `at`, ringing for
 *  `dur` samples before it is damped. */
export function pluck(out, sr, at, midi, dur, amp, rand, bright = 0.5) {
  const f = 440 * 2 ** ((midi - 69) / 12);
  const P = sr / f - 0.5, N = Math.ceil(P) + 2;
  const line = new Float32Array(N + 1);
  // excitation: a noise burst, softened for a duller pick
  let lp = 0;
  for (let i = 0; i < N; i++) { lp += (rand() * 2 - 1 - lp) * (0.25 + 0.7 * bright); line[i] = lp; }
  const decay = 0.996 - 0.0015 * Math.max(0, (midi - 50) / 24);
  const total = Math.min(out.length - at, dur + Math.round(0.03 * sr));
  const y = new Float32Array(total);
  for (let n = 0; n < total; n++) {
    let v;
    if (n < N) v = line[n];
    else {
      const d = n - P, i = Math.floor(d), fr = d - i;
      const a = y[i] * (1 - fr) + y[i + 1] * fr;
      const b = y[i - 1] * (1 - fr) + y[i] * fr;
      v = decay * 0.5 * (a + b);
    }
    y[n] = v;
    const damp = n < dur ? 1 : 1 - (n - dur) / (total - dur);
    out[at + n] += v * amp * damp;
  }
}

/** Strum a chart (an array of bars, each an array of chord names) into a
 *  loop of exactly bars × beatsPerBar beats. Eighth-note strums: down on the
 *  beat, up on the "and" — a pattern that keeps the downbeats strongest. */
export function strumChart({ chart, bpm, beatsPerBar = 4, sr = 48000, seed = 7, gain = 0.22 }) {
  const rand = rng(seed);
  const beat = (60 / bpm) * sr, barLen = beat * beatsPerBar;
  const len = Math.round(barLen * chart.length);
  const out = new Float32Array(len);
  const pattern = [1, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1].slice(0, beatsPerBar * 2);
  const hits = [];
  chart.forEach((bar, b) => {
    pattern.forEach((on, slot) => {
      if (!on) return;
      const chord = bar[Math.min(bar.length - 1, Math.floor((slot * bar.length) / pattern.length))];
      hits.push({ at: b * barLen + (slot * beat) / 2, down: slot % 2 === 0, chord, accent: slot % 4 === 0 });
    });
  });
  hits.forEach((h, i) => {
    const shape = SHAPES[h.chord] || SHAPES.G;
    const next = hits[i + 1] ? hits[i + 1].at : len + beat / 2;
    const strings = shape.map((fret, s) => ({ s, fret })).filter((x) => x.fret >= 0);
    const order = h.down ? strings : strings.slice().reverse().slice(0, 4);
    const spread = (h.down ? 0.011 : 0.008) * sr;
    order.forEach(({ s, fret }, k) => {
      const at = Math.round(h.at + k * spread + (rand() - 0.5) * 0.004 * sr);
      if (at < 0 || at >= len) return;
      const amp = gain * (h.accent ? 1 : h.down ? 0.8 : 0.55) * (0.85 + 0.3 * rand());
      pluck(out, sr, at, OPEN[s] + fret, Math.max(1, Math.round(next - at)), amp, rand, h.down ? 0.55 : 0.75);
    });
  });
  return out;
}

/** A short lead line in the key of a chart, for testing solos. */
export function leadLine({ seconds, bpm, sr = 48000, notes = [67, 69, 71, 74, 76, 74, 71, 69], seed = 3 }) {
  const rand = rng(seed);
  const out = new Float32Array(Math.round(seconds * sr));
  const step = (60 / bpm / 2) * sr;
  for (let k = 0, at = 0; at < out.length; k++, at = Math.round(k * step * 2)) {
    pluck(out, sr, at, notes[k % notes.length] + 12, Math.round(step * 1.8), 0.35, rand, 0.8);
  }
  return out;
}
