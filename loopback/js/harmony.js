// Hearing the chords in a loop, and suggesting what to solo with.
//
// A chromagram folds the spectrum onto twelve pitch classes; each bar (or half
// bar, when the halves clearly disagree) is matched against chord templates.
// The first chord is taken as home, and the mode that best holds every chord
// tone is offered as the scale to solo in.

import { decimate, mod } from './dsp.js';

export const PC_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

const QUALITIES = [
  { suffix: '', tones: [0, 4, 7], weights: [1, 1, 1], penalty: 0 },
  { suffix: 'm', tones: [0, 3, 7], weights: [1, 1, 1], penalty: 0 },
  { suffix: '7', tones: [0, 4, 7, 10], weights: [1, 1, 1, 0.8], penalty: 0.05 },
  { suffix: 'm7', tones: [0, 3, 7, 10], weights: [1, 1, 1, 0.8], penalty: 0.05 },
  { suffix: 'maj7', tones: [0, 4, 7, 11], weights: [1, 1, 1, 0.8], penalty: 0.08 },
  { suffix: '5', tones: [0, 7], weights: [1, 1], penalty: 0.03 },
];

// ---- spectrum ---------------------------------------------------------------

const twiddles = new Map();

/** In-place radix-2 FFT of (re, im); length must be a power of two. */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  let tw = twiddles.get(n);
  if (!tw) {
    tw = { c: new Float64Array(n / 2), s: new Float64Array(n / 2) };
    for (let i = 0; i < n / 2; i++) { tw.c[i] = Math.cos((2 * Math.PI * i) / n); tw.s[i] = -Math.sin((2 * Math.PI * i) / n); }
    twiddles.set(n, tw);
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const a = start + k, b = a + half, c = tw.c[k * step], s = tw.s[k * step];
        const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

const LOW_NOTE = 28, HIGH_NOTE = 96;   // E1 .. C7
const DEFLATE = [[12, 0.4], [19, 0.45], [24, 0.25], [28, 0.3]];   // octave, 12th, 2 octaves, 17th

/** Note salience over time. The loop is treated as circular, so the first
 *  frames hear the end of the loop leading into them. */
export function chromagram(data, sr, hopSec = 0.08) {
  const factor = Math.max(1, Math.floor(sr / 11025));
  const x = decimate(data, factor), rate = sr / factor;
  const N = rate > 16000 ? 8192 : 4096, hop = Math.max(1, Math.round(hopSec * rate));
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const re = new Float64Array(N), im = new Float64Array(N), mag = new Float64Array(N / 2);
  const kLo = Math.floor((55 * N) / rate), kHi = Math.min(N / 2 - 2, Math.ceil((2200 * N) / rate));
  const frames = [];
  for (let c = 0; c < x.length; c += hop) {
    for (let i = 0; i < N; i++) { re[i] = x[mod(c - N / 2 + i, x.length)] * win[i]; im[i] = 0; }
    fft(re, im);
    for (let k = kLo - 1; k <= kHi + 1; k++) mag[k] = Math.hypot(re[k], im[k]);
    const s = new Float64Array(HIGH_NOTE + 1);
    for (let k = kLo; k <= kHi; k++) {
      if (mag[k] <= mag[k - 1] || mag[k] < mag[k + 1]) continue;
      const a = mag[k - 1], b = mag[k], g = mag[k + 1];
      const d = (a - g) / (2 * (a - 2 * b + g) || 1);
      const midi = 69 + 12 * Math.log2((((k + d) * rate) / N) / 440);
      const note = Math.round(midi);
      if (note < LOW_NOTE || note > HIGH_NOTE) continue;
      const w = Math.cos(Math.PI * (midi - note)) ** 2;
      s[note] += w * Math.sqrt(b);
    }
    const t = new Float64Array(s);
    for (let m = LOW_NOTE; m <= HIGH_NOTE; m++)
      for (const [d, w] of DEFLATE) if (m - d >= LOW_NOTE) t[m] = Math.max(0, t[m] - w * s[m - d]);
    const chroma = new Float64Array(12), bass = new Float64Array(12);
    let energy = 0;
    for (let m = 36; m <= 88; m++) { chroma[m % 12] += t[m]; energy += t[m]; }
    for (let m = LOW_NOTE; m <= 55; m++) bass[m % 12] += t[m] * (1 + (55 - m) / 27);
    frames.push({ time: c / rate, chroma, bass, energy });
  }
  return { frames, hop: hop / rate, window: N / rate };
}

function bestChords(chroma, bass) {
  const norm = Math.hypot(...chroma) || 1;
  const bassSum = bass.reduce((a, b) => a + b, 0) || 1;
  const out = [];
  for (let root = 0; root < 12; root++) {
    for (const q of QUALITIES) {
      let dot = 0, tn = 0;
      q.tones.forEach((iv, i) => { dot += chroma[(root + iv) % 12] * q.weights[i]; tn += q.weights[i] ** 2; });
      const score = dot / (norm * Math.sqrt(tn)) + 0.18 * (bass[root] / bassSum) - q.penalty;
      out.push({ root, quality: q.suffix, score });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

function segmentChroma(frames, t0, t1, window) {
  const chroma = new Float64Array(12), bass = new Float64Array(12);
  let energy = 0;
  const pad = Math.min(window / 4, (t1 - t0) / 4);
  let pick = frames.filter((f) => f.time >= t0 + pad && f.time < t1 - pad);
  if (!pick.length) pick = frames.filter((f) => f.time >= t0 && f.time < t1);
  for (const f of pick) {
    for (let i = 0; i < 12; i++) { chroma[i] += f.chroma[i]; bass[i] += f.bass[i]; }
    energy += f.energy;
  }
  return { chroma, bass, energy: energy / (pick.length || 1) };
}

/** One chord per bar, or two when the halves of a bar clearly disagree.
 *  Returns an array of bars, each an array of chord names. */
export function detectChords(data, sr, { bars, beatsPerBar = 4 }) {
  const { frames, window } = chromagram(data, sr);
  const dur = data.length / sr, barLen = dur / bars;
  const loud = Math.max(...frames.map((f) => f.energy)) * 0.04;
  const quiet = (seg) => seg.energy < loud;
  const chart = [];
  for (let b = 0; b < bars; b++) {
    const t0 = b * barLen, t1 = t0 + barLen;
    const whole = segmentChroma(frames, t0, t1, window);
    if (quiet(whole)) { chart.push([]); continue; }
    const top = bestChords(whole.chroma, whole.bass)[0];
    let names = [chordName(top)];
    const split = Math.floor(beatsPerBar / 2);
    if (split > 0 && barLen >= 1) {
      const tm = t0 + (barLen * split) / beatsPerBar;
      const a = segmentChroma(frames, t0, tm, window), z = segmentChroma(frames, tm, t1, window);
      if (!quiet(a) && !quiet(z)) {
        const ra = bestChords(a.chroma, a.bass), rz = bestChords(z.chroma, z.bass);
        const same = (list) => list.find((c) => c.root === top.root && c.quality === top.quality).score;
        const gain = (ra[0].score + rz[0].score - same(ra) - same(rz)) / 2;
        if (chordName(ra[0]) !== chordName(rz[0]) && gain > 0.06) names = [chordName(ra[0]), chordName(rz[0])];
      }
    }
    chart.push(names);
  }
  return chart;
}

// ---- names ------------------------------------------------------------------

export function chordName({ root, quality }) { return PC_NAMES[root] + quality; }

/** Root pitch class and chord tones of a typed chord symbol such as "Bbm7",
 *  "F#", "Gmaj7" or "E5"; null when it isn't one. */
export function parseChord(text) {
  const m = /^\s*([A-Ga-g])([#♯b♭]?)(.*?)\s*(?:\/.*)?$/.exec(text || '');
  if (!m) return null;
  let root = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()];
  if (m[2] === '#' || m[2] === '♯') root++;
  if (m[2] === 'b' || m[2] === '♭') root--;
  root = mod(root, 12);
  const rest = m[3];
  let quality;
  if (/^(maj|M|Δ)/.test(rest)) quality = 'maj7';
  else if (/^(m|min|-)(?!aj)/.test(rest)) quality = /\d/.test(rest) ? 'm7' : 'm';
  else if (/^(dim|°|o)/.test(rest)) quality = 'dim';
  else if (/^sus2/.test(rest)) quality = 'sus2';
  else if (/^sus/.test(rest)) quality = 'sus4';
  else if (/^5/.test(rest)) quality = '5';
  else if (/^(7|9|11|13)/.test(rest)) quality = '7';
  else if (rest === '' || /^(6|add|\()/.test(rest)) quality = '';
  else return null;
  const tones = { '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11],
    dim: [0, 3, 6], sus2: [0, 2, 7], sus4: [0, 5, 7], '5': [0, 7] }[quality];
  return { root, quality, tones: tones.map((t) => (root + t) % 12) };
}

// ---- what to play -------------------------------------------------------------

const MODES = [
  { name: 'Ionian', label: 'major', steps: [0, 2, 4, 5, 7, 9, 11], family: 'major' },
  { name: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10], family: 'major' },
  { name: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11], family: 'major' },
  { name: 'Aeolian', label: 'natural minor', steps: [0, 2, 3, 5, 7, 8, 10], family: 'minor' },
  { name: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10], family: 'minor' },
  { name: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10], family: 'minor' },
  { name: 'Harmonic minor', steps: [0, 2, 3, 5, 7, 8, 11], family: 'minor' },
];
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];

function tonicName(pc, family) {
  if (family === 'major') return ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'][pc];
  return ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'][pc];
}

/** Spell a seven-note scale with one note per letter, starting from the
 *  tonic's letter. */
export function spellScale(tonic, steps, family) {
  const name = tonicName(tonic, family), letter = LETTERS.indexOf(name[0]);
  return steps.map((s, i) => {
    const L = (letter + i) % 7, pc = (tonic + s) % 12;
    const diff = mod(pc - LETTER_PC[L] + 6, 12) - 6;
    return LETTERS[L] + (diff > 0 ? '♯'.repeat(diff) : '♭'.repeat(-diff));
  });
}

/** Home key and a scale to solo with, from a chart of chord names. */
export function soloAdvice(chart) {
  const chords = chart.flatMap((bar) => bar.map((name) => ({ name, chord: parseChord(name), beats: 1 / bar.length })))
    .filter((c) => c.chord);
  if (!chords.length) return null;
  const home = chords[0].chord;
  const weight = new Float64Array(12);
  for (const { chord, beats } of chords) chord.tones.forEach((pc, i) => { weight[pc] += beats * (i === 0 ? 1.4 : 1); });
  const minor = ['m', 'm7', 'dim'].includes(home.quality);
  const family = minor ? 'minor' : 'major';
  const order = minor ? ['Aeolian', 'Dorian', 'Phrygian', 'Harmonic minor']
    : home.quality === '7' ? ['Mixolydian', 'Ionian', 'Lydian'] : ['Ionian', 'Mixolydian', 'Lydian'];
  let best = null;
  for (const name of order) {
    const mode = MODES.find((m) => m.name === name);
    const set = new Set(mode.steps.map((s) => (home.root + s) % 12));
    let outside = 0;
    for (let pc = 0; pc < 12; pc++) if (!set.has(pc)) outside += weight[pc];
    if (!best || outside < best.outside - 1e-9) best = { mode, outside };
  }
  const tonic = tonicName(home.root, family);
  const notes = spellScale(home.root, best.mode.steps, family);
  const pentatonic = `${tonic} ${family} pentatonic`;
  const pentatonicNotes = minor
    ? [0, 2, 3, 4, 6].map((i) => spellScale(home.root, MODES[3].steps, family)[i])
    : [0, 1, 2, 4, 5].map((i) => spellScale(home.root, MODES[0].steps, family)[i]);
  const blues = home.quality === '7' ? `${tonic} blues` : null;
  return {
    tonic, family,
    key: `${tonic} ${best.mode.label ?? best.mode.name}`,
    mode: `${tonic} ${best.mode.name}`,
    notes,
    pentatonic, pentatonicNotes,
    blues,
    fits: best.outside < 0.05,
  };
}
