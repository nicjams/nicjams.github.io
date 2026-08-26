/*
 * Generate a painting.
 *
 * The picture and the piece are the same object, so this composes music and
 * lets the image fall out of it: a key, a progression, and one band of the
 * canvas per instrument. Chords are painted the way a hand would paint them --
 * a stroke smeared across the chord tones inside each beat, which the scene
 * reads back as up to three notes at once.
 */

import { SCALES } from './music.js';
import { smoothPath } from './demo.js';
import { paintStrokes } from './painter.js';

/* Small deterministic RNG, so a seed can be shown and painted again. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rng, list) => list[Math.floor(rng() * list.length)];
const chance = (rng, p) => rng() < p;
const between = (rng, lo, hi) => lo + rng() * (hi - lo);

/*
 * Three temperaments. Each sets a tempo range, the modes that suit it, and how
 * busy the parts are -- which is what makes one generated canvas look sparse
 * and airy and the next one dense and striped.
 */
const STYLES = [
  {
    name: 'drift', bpm: [70, 88], quantize: '1/8',
    scales: ['ionian', 'lydian', 'majPent'],
    kick: 'sparse', hats: 'offbeat', snare: false,
    arp: [0, 2, 1, 2], leadChance: 0.5, sparkleChance: 0.7, padBars: 'all',
  },
  {
    name: 'groove', bpm: [94, 116], quantize: '1/8',
    scales: ['dorian', 'mixolydian', 'ionian', 'minPent'],
    kick: 'four', hats: 'eighths', snare: true,
    arp: [0, 1, 2, 1], leadChance: 0.75, sparkleChance: 0.4, padBars: 'half',
  },
  {
    name: 'pulse', bpm: [120, 140], quantize: '1/16',
    scales: ['aeolian', 'minPent', 'phrygian', 'dorian'],
    kick: 'driving', hats: 'sixteenths', snare: true,
    arp: [0, 2, 1, 3], leadChance: 0.9, sparkleChance: 0.3, padBars: 'half',
  },
];

/* One chord per bar, as scale degrees. */
const PROGRESSIONS = [
  [0, 4, 5, 3], [0, 5, 3, 4], [5, 3, 0, 4], [0, 3, 4, 3],
  [0, 6, 5, 4], [5, 5, 3, 4], [0, 0, 3, 4], [3, 4, 0, 0],
];

/* Lead contours, sampled over the phrase. */
const SHAPES = {
  arc: t => Math.sin(Math.PI * t),
  rise: t => t,
  fall: t => 1 - t,
  wave: t => 0.5 + 0.5 * Math.sin(Math.PI * 2 * 1.5 * t),
  step: t => Math.min(1, Math.floor(t * 4) / 3),
};

const KIT_ROW = { kick: 0, snare: 1, hat: 6, ride: 8 };

/* Short strokes, one per hit: the kit brush fires once per grid step. */
const hits = (beats, row, len) => beats.map(b => ({ end: b + len, steps: [[b, row]] }));

export function generate(scene, seed = Math.floor(Math.random() * 1e6)) {
  const rng = mulberry32(seed);
  const style = pick(rng, STYLES);
  const scale = pick(rng, style.scales);
  const degrees = SCALES[scale].ivs.length;
  const bars = chance(rng, 0.25) ? 8 : 4;
  const beatsPerBar = 4;
  const grid = style.quantize === '1/16' ? 0.25 : 0.5;

  const settings = {
    bpm: Math.round(between(rng, style.bpm[0], style.bpm[1])),
    bars, beatsPerBar, mode: 'modal',
    root: Math.floor(rng() * 12), scale,
    quantize: style.quantize, rows: 21, lowest: 48,
  };

  // one bar per chord, looped out to the length of the canvas
  const base = pick(rng, PROGRESSIONS);
  const prog = Array.from({ length: bars }, (_, i) => base[i % base.length] % degrees);

  /*
   * The triad on a degree, as rows. A diminished fifth is left out rather than
   * held: stacked thirds are diatonic wherever they land, but a tritone droning
   * under a whole bar is the one that sounds like a mistake.
   */
  const ivs = SCALES[scale].ivs;
  const semis = i => ivs[i % degrees] + 12 * Math.floor(i / degrees);
  const tonesFor = (deg, octaveRow) => {
    const steps = semis(deg + 4) - semis(deg) === 6 ? [0, 2] : [0, 2, 4];
    return steps.map(i => octaveRow + deg + i);
  };

  const parts = [];
  const add = (brush, strokes, opts) => strokes.length && parts.push({ brush, strokes, opts });

  // --- bass: the root of each chord, low and wide ------------------------
  const bass = [];
  prog.forEach((deg, bar) => {
    const t0 = bar * beatsPerBar;
    if (style.name === 'pulse' && chance(rng, 0.6)) {
      for (let b = 0; b < beatsPerBar; b += 1) {
        bass.push({ end: t0 + b + 0.7, steps: [[t0 + b, deg]] });
      }
    } else if (chance(rng, 0.4)) {
      bass.push({ end: t0 + beatsPerBar - 0.05,
        steps: [[t0, deg], [t0 + beatsPerBar / 2, deg + 4]] });
    } else {
      bass.push({ end: t0 + beatsPerBar - 0.05, steps: [[t0, deg]] });
    }
  });
  add('bass', bass);

  // --- pad: chord tones smeared inside every beat, so they sound together -
  const pad = [];
  prog.forEach((deg, bar) => {
    if (style.padBars === 'half' && bar % 2 === 1) return;
    const t0 = bar * beatsPerBar;
    const tones = tonesFor(deg, degrees);
    const steps = [];
    let up = true;
    for (let b = t0; b < t0 + beatsPerBar - 1e-9; b += grid) {
      // sweep the chord up, then back down: same notes, a woven stroke rather
      // than the same column stamped over and over
      const order = up ? tones : [...tones].reverse();
      order.forEach((row, i) => steps.push([b + (i * grid) / order.length, row]));
      up = !up;
    }
    pad.push({ end: t0 + beatsPerBar - 0.02, steps });
  });
  // near-instant moves and no wobble: the smear must dwell on chord tones only
  add('strings', pad, { glide: 0.012, breath: 0, step: 1 / 96 });

  // --- keys: an arpeggio walking the same chords -------------------------
  const keys = [];
  const pattern = style.arp;
  prog.forEach((deg, bar) => {
    const t0 = bar * beatsPerBar;
    const tones = tonesFor(deg, degrees);
    const steps = [];
    let k = 0;
    for (let b = t0; b < t0 + beatsPerBar - 1e-9; b += grid * 2) {
      const pickIdx = pattern[k++ % pattern.length];
      steps.push([b, tones[pickIdx % tones.length] + (pickIdx >= tones.length ? degrees : 0)]);
    }
    keys.push({ end: t0 + beatsPerBar - 0.05, steps });
  });
  add('keys', keys);

  // --- lead: a shaped phrase over the back half --------------------------
  if (chance(rng, style.leadChance)) {
    const shape = SHAPES[pick(rng, Object.keys(SHAPES))];
    const span = 5 + Math.floor(rng() * 4);
    const low = degrees * 2;
    const from = bars >= 8 ? beatsPerBar * 4 : beatsPerBar * 2;
    const phrase = [];
    const note = grid * 2;
    for (let b = from; b < bars * beatsPerBar - note; b += note) {
      const t = (b - from) / (bars * beatsPerBar - from);
      if (chance(rng, 0.25)) continue;                    // rests give it phrasing
      phrase.push([b, low + Math.round(shape(t) * span)]);
    }
    if (phrase.length > 2) {
      add('lead', [{ end: bars * beatsPerBar - 0.05, steps: phrase }]);
    }
  }

  // --- sparkle: a few high plucked scale tones ---------------------------
  if (chance(rng, style.sparkleChance)) {
    const brush = chance(rng, 0.5) ? 'bells' : 'pluck';
    const sparks = [];
    const count = 3 + Math.floor(rng() * 5);
    for (let i = 0; i < count; i++) {
      const b = Math.round(between(rng, 0, bars * beatsPerBar - 1) / grid) * grid;
      const row = degrees * 2 + Math.floor(rng() * degrees);
      sparks.push({ end: b + grid * 2, steps: [[b, row]] });
    }
    add(brush, sparks);
  }

  // --- drums -------------------------------------------------------------
  const drums = [];
  const total = bars * beatsPerBar;
  const kicks = [];
  for (let bar = 0; bar < bars; bar++) {
    const t0 = bar * beatsPerBar;
    if (style.kick === 'four') for (let b = 0; b < 4; b++) kicks.push(t0 + b);
    else if (style.kick === 'driving') [0, 1, 1.75, 2.5, 3].forEach(b => kicks.push(t0 + b));
    else [0, 2.5].forEach(b => kicks.push(t0 + b));
  }
  drums.push(...hits(kicks, KIT_ROW.kick, grid * 0.8));

  if (style.snare) {
    const snares = [];
    for (let bar = 0; bar < bars; bar++) {
      snares.push(bar * beatsPerBar + 1, bar * beatsPerBar + 3);
      if (chance(rng, 0.25)) snares.push(bar * beatsPerBar + 3.5);   // a small fill
    }
    drums.push(...hits(snares, KIT_ROW.snare, grid * 0.8));
  }

  if (style.hats === 'offbeat') {
    const off = [];
    for (let b = grid * 2; b < total; b += grid * 4) off.push(b);
    drums.push(...hits(off, KIT_ROW.hat, grid * 0.8));
  } else if (style.hats === 'eighths' || style.hats === 'sixteenths') {
    // one long line: the kit brush retriggers on every grid step beneath it
    drums.push({ end: total - 0.02, steps: [[0, KIT_ROW.hat]] });
  }
  add('drums', drums);

  const strokes = [];
  let phase = 0;
  parts.forEach(part => part.strokes.forEach(spec => {
    strokes.push({
      brush: part.brush,
      pts: smoothPath(spec, settings.rows, (phase += 1.7), part.opts || {}),
    });
  }));
  paintStrokes(scene, settings, strokes);
  return { seed, style: style.name, scale, root: settings.root, bpm: settings.bpm, bars };
}
