/*
 * Draw a little picture that plays.
 *
 * The other generator composes music and lets the image follow. This one goes
 * the other way: it draws a scene, and the scene is read back as music. Two
 * choices keep an arbitrary drawing listenable -- a pentatonic modal grid, so
 * no two rows can clash however a line lands, and a slow tempo, so the picture
 * unfolds as the playhead reads it left to right.
 *
 * Shapes carry musical weight of their own: a vertical mast is a fast smear
 * across many rows, which the scene reads as a spread chord, and the sun's
 * circle opens an interval and closes it again as the playhead crosses it.
 */

import { paintStrokes } from './painter.js';

const SAMPLE = 1 / 48;          // beats between samples along a path

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---- drawing primitives, in beats across and (fractional) rows up -------- */

const seg = (b0, r0, b1, r1, out = []) => {
  const steps = Math.max(2, Math.ceil(Math.hypot(b1 - b0, (r1 - r0) / 6) / SAMPLE));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    out.push([b0 + (b1 - b0) * t, r0 + (r1 - r0) * t]);
  }
  return out;
};

const path = points => {
  const out = [];
  for (let i = 1; i < points.length; i++) {
    seg(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], out);
  }
  return out;
};

/* An elliptical arc. Angles in turns: 0 is due right, 0.25 straight up. */
const arc = (bc, rc, br, rr, from = 0, to = 1) => {
  const out = [];
  const steps = Math.max(12, Math.ceil((Math.abs(to - from) * 2 * Math.PI * br) / SAMPLE));
  for (let i = 0; i <= steps; i++) {
    const a = (from + (to - from) * (i / steps)) * Math.PI * 2;
    out.push([bc + Math.cos(a) * br, rc + Math.sin(a) * rr]);
  }
  return out;
};

const wave = (b0, b1, row, amp, cycles) => {
  const out = [];
  for (let b = b0; b <= b1; b += SAMPLE) {
    out.push([b, row + amp * Math.sin(((b - b0) / (b1 - b0)) * Math.PI * 2 * cycles)]);
  }
  return out;
};

/* Up and straight back down: two grid steps of the same spread chord. */
const mast = (b, rLow, rHigh, width = 0.22) =>
  path([[b, rLow], [b + width / 2, rHigh], [b + width, rLow]]);

/* ---- scenes ------------------------------------------------------------- */

function sailboat(rng, bars, beatsPerBar) {
  const total = bars * beatsPerBar;
  const jitter = (n) => (rng() - 0.5) * n;
  const sea = 4 + jitter(0.6);
  const strokes = [];

  // sun, low on the left where the playhead meets it first
  const sunB = 2.4 + jitter(0.5), sunR = 16.5 + jitter(1);
  strokes.push({ brush: 'bells', pts: arc(sunB, sunR, 1.5, 3.1) });
  for (let i = 0; i < 6; i++) {                      // rays
    const a = (i / 6 + 0.04) * Math.PI * 2;
    strokes.push({ brush: 'bells', pts: path([
      [sunB + Math.cos(a) * 2.1, sunR + Math.sin(a) * 4.2],
      [sunB + Math.cos(a) * 2.9, sunR + Math.sin(a) * 5.6],
    ]) });
  }

  // the sea, running the whole width
  strokes.push({ brush: 'bass', pts: wave(0, total - 0.1, sea, 1.1, 3) });
  strokes.push({ brush: 'strings', pts: wave(0.6, total - 0.4, sea - 2.2, 0.8, 2) });

  // boat: hull, mast, sail
  const boat = 5 + jitter(0.8);
  strokes.push({ brush: 'pluck', pts: path([
    [boat - 1.6, sea + 1.6], [boat - 1.1, sea + 0.5],
    [boat + 1.1, sea + 0.5], [boat + 1.6, sea + 1.6], [boat - 1.6, sea + 1.6],
  ]) });
  strokes.push({ brush: 'keys', pts: mast(boat, sea + 1.6, sea + 8.5) });
  strokes.push({ brush: 'keys', pts: path([
    [boat + 0.25, sea + 8.2], [boat + 1.9, sea + 2.2], [boat + 0.25, sea + 2.2],
  ]) });

  // island with a palm, off to the right
  const isle = total - 3.6 + jitter(0.6);
  // 0 -> 0.5 of a turn is the upper half: a hump sitting on the waterline
  strokes.push({ brush: 'strings', pts: arc(isle, sea + 0.4, 2.2, 3.4, 0, 0.5) });
  strokes.push({ brush: 'pluck', pts: mast(isle, sea + 1.4, sea + 6.4, 0.3) });
  for (let i = 0; i < 4; i++) {
    const dir = i < 2 ? 1 : -1;
    const spread = 0.5 + (i % 2) * 0.5;
    strokes.push({ brush: 'bells', pts: path([
      [isle + 0.15, sea + 6.4],
      [isle + 0.15 + dir * spread, sea + 7.2],
      [isle + 0.15 + dir * spread * 1.9, sea + 6.1],
    ]) });
  }

  // two birds and a wisp of cloud
  const birdB = total * 0.55 + jitter(1);
  [0, 1].forEach(i => strokes.push({ brush: 'lead', pts: path([
    [birdB + i * 1.4, 17], [birdB + 0.45 + i * 1.4, 18.2], [birdB + 0.9 + i * 1.4, 17],
  ]) }));
  strokes.push({ brush: 'strings', pts: wave(total - 5, total - 2.5, 19, 0.35, 1.5) });

  return { name: 'Sailboat', strokes };
}

function mountains(rng, bars, beatsPerBar) {
  const total = bars * beatsPerBar;
  const strokes = [];
  const base = 6 + (rng() - 0.5);

  // a ridge line: peaks of falling height
  const peaks = [];
  let b = 0;
  peaks.push([0, base]);
  while (b < total) {
    const w = 1.6 + rng() * 2.2;
    peaks.push([Math.min(total, b + w / 2), base + 3 + rng() * 6]);
    peaks.push([Math.min(total, b + w), base + rng() * 1.2]);
    b += w;
  }
  strokes.push({ brush: 'strings', pts: path(peaks) });

  // a lake, and its reflection
  strokes.push({ brush: 'bass', pts: wave(0, total - 0.1, base - 2.5, 0.9, 2) });
  strokes.push({ brush: 'pluck', pts: wave(1, total - 1, base - 4.2, 0.5, 4) });

  // sun behind the range
  const sunB = total * 0.35 + (rng() - 0.5) * 2;
  strokes.push({ brush: 'bells', pts: arc(sunB, 17, 1.7, 3.2) });

  // three pines
  for (let i = 0; i < 3; i++) {
    const t = 2 + rng() * (total - 4);
    strokes.push({ brush: 'pluck', pts: mast(t, base - 1, base + 2.5 + rng() * 2, 0.26) });
  }

  // a bird high up
  const birdB = total * 0.7;
  strokes.push({ brush: 'lead', pts: path([
    [birdB, 18], [birdB + 0.5, 19.3], [birdB + 1, 18],
  ]) });

  return { name: 'Mountains', strokes };
}

function skyline(rng, bars, beatsPerBar) {
  const total = bars * beatsPerBar;
  const strokes = [];
  const street = 3;

  // buildings: a run of towers, each a chord where it rises
  let b = 0.4;
  while (b < total - 1) {
    const w = 0.8 + rng() * 1.4;
    const h = street + 3 + rng() * 9;
    strokes.push({ brush: 'keys', pts: path([
      [b, street], [b, h], [b + w, h], [b + w, street],
    ]) });
    b += w + 0.3 + rng() * 0.5;
  }

  strokes.push({ brush: 'bass', pts: wave(0, total - 0.1, street - 1.5, 0.5, 2) });

  // moon and a few stars
  strokes.push({ brush: 'bells', pts: arc(total * 0.8, 18, 1.2, 2.4) });
  for (let i = 0; i < 5; i++) {
    const t = rng() * total, r = 15 + rng() * 5;
    strokes.push({ brush: 'bells', pts: path([[t, r], [t + 0.12, r + 0.4]]) });
  }

  return { name: 'Skyline', strokes };
}

const SCENES = [sailboat, sailboat, mountains, skyline];   // the boat twice: it is the nicest

/* ---- entry point -------------------------------------------------------- */

export function drawPicture(scene, seed = Math.floor(Math.random() * 1e6)) {
  const rng = mulberry32(seed);
  const bars = 4;
  const beatsPerBar = 4;
  const rows = 21;

  const settings = {
    // pentatonic, so nothing the pencil does can land a semitone apart
    bpm: Math.round(66 + rng() * 22),
    bars, beatsPerBar, mode: 'modal',
    root: Math.floor(rng() * 12),
    scale: rng() < 0.6 ? 'majPent' : 'minPent',
    quantize: '1/8', rows, lowest: 48,
  };

  const drawn = SCENES[Math.floor(rng() * SCENES.length)](rng, bars, beatsPerBar);
  const strokes = drawn.strokes.map(s => ({
    brush: s.brush,
    pts: s.pts
      .filter(([b]) => b >= -0.5 && b <= bars * beatsPerBar + 0.5)
      .map(([b, row]) => ({
        b: Math.min(Math.max(b, 0), bars * beatsPerBar),
        y: Math.min(Math.max((row + 0.5) / rows, 0), 0.9999),
      })),
  })).filter(s => s.pts.length > 1);

  paintStrokes(scene, settings, strokes);
  return { seed, picture: drawn.name, scale: settings.scale, root: settings.root, bpm: settings.bpm };
}
