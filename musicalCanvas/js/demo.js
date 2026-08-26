/*
 * The demo paints itself: one instrument per loop, in time with the playhead,
 * as though a hand were drawing it. The score below is written in rows and
 * beats, and smoothPath turns each part into a flowing line -- pitch changes
 * glide instead of jumping, and the line breathes slightly as it holds.
 */

import { clamp } from './music.js';

const STEP = 1 / 32;        // sampling resolution along a stroke, in beats
const GLIDE = 0.36;         // beats spent easing from one row to the next
const BREATH = 0.1;         // wobble amplitude, in rows

/*
 * Each part is one instrument. A stroke holds `steps` ([beat, row]) until the
 * next step, and runs to `end`. Row 0 is the bottom of the canvas: in C ionian
 * that is C3, and for the kit brush it is the kick.
 */
const SCORE = [
  {
    brush: 'bass',
    strokes: [{ end: 16, steps: [[0, 0], [4, 3], [8, 4], [12, 2]] }],
  },
  {
    brush: 'drums',
    strokes: [
      { end: 16, steps: [[0, 0]] },       // kick
      { end: 16, steps: [[0, 6]] },       // hat
    ],
  },
  {
    brush: 'keys',
    strokes: [{
      end: 16,
      steps: [[0, 7], [1, 8], [2, 9], [3, 11], [4, 9], [6, 7],
              [8, 9], [10, 11], [12, 12], [14, 11]],
    }],
  },
  {
    brush: 'strings',
    strokes: [{ end: 16, steps: [[0, 11], [8, 12]] }],
  },
  {
    brush: 'lead',
    strokes: [{
      end: 16,
      steps: [[12, 10], [12.5, 12], [13, 13], [13.5, 14],
              [14, 15], [14.5, 17], [15, 18], [15.5, 19]],
    }],
  },
];

const smoothstep = t => t * t * (3 - 2 * t);

/* Row (int) -> the 0..1 pitch coordinate at the middle of that row. */
export const rowToY = (row, rows) => (row + 0.5) / rows;

/*
 * Sample one stroke into points. Row changes ease over GLIDE beats centred on
 * the step boundary, which is short enough that every quantize slot still
 * belongs to one row -- the drawing is smooth, the MIDI stays exact.
 */
export function smoothPath(stroke, rows, phase, opts = {}) {
  const steps = stroke.steps;
  const gaps = steps.slice(1).map((s, i) => s[0] - steps[i][0]);
  const fitted = Math.min(GLIDE, 0.35 * Math.min(...gaps, stroke.end - steps[steps.length - 1][0]));
  const glide = Math.max(1e-4, opts.glide != null ? opts.glide : fitted);
  const breath = opts.breath != null ? opts.breath : BREATH;
  const step = opts.step || STEP;
  const pts = [];
  for (let b = steps[0][0]; b <= stroke.end + 1e-9; b += step) {
    const beat = Math.min(b, stroke.end);
    let i = 0;
    while (i + 1 < steps.length && steps[i + 1][0] <= beat) i++;
    let row = steps[i][1];
    if (i + 1 < steps.length) {
      const edge = steps[i + 1][0];
      if (beat > edge - glide / 2) {
        const t = smoothstep(clamp((beat - (edge - glide / 2)) / glide, 0, 1));
        row = steps[i][1] + (steps[i + 1][1] - steps[i][1]) * t;
      }
    }
    const wobble = breath * Math.sin(beat * 1.3 * Math.PI * 2 + phase)
      * (0.6 + 0.4 * Math.sin(beat * 0.37 + phase));
    pts.push({ b: beat, y: rowToY(row + wobble, rows) });
    if (beat >= stroke.end) break;
  }
  return pts;
}

/*
 * Sounds the note under a brush as it is drawn -- once per row for pitched
 * brushes, once per grid step for the kit. Shared by the demo and by replay.
 */
export class Auditioner {
  constructor(scene, engine) {
    this.scene = scene;
    this.engine = engine;
    this.reset();
  }

  reset() {
    this.row = null;
    this.slot = null;
  }

  feed(brush, point) {
    const grid = this.scene.grid || 0.25;
    const slot = Math.floor(point.b / grid);
    const row = this.scene.rowForY(point.y);
    const kit = brush === 'drums';
    if (kit ? slot === this.slot : row === this.row) return;
    this.slot = slot;
    this.row = row;
    const midi = this.scene.midiFor(brush, row, this.scene.pitchMap());
    this.engine.play({ brush, midi, vel: 88 }, undefined, kit ? 0.2 : 0.4);
  }
}

export class Demo {
  constructor({ scene, engine, view, onPart, onDone }) {
    this.scene = scene;
    this.engine = engine;
    this.view = view;
    this.onPart = onPart;
    this.onDone = onDone;
    this.running = false;
    this.part = -1;
    this.audition = new Auditioner(scene, engine);
  }

  start() {
    this.engine.stop();
    this.scene.clear();
    this.scene.name = 'Demo';
    this.scene.id = null;
    Object.assign(this.scene.settings, {
      bpm: 100, bars: 4, beatsPerBar: 4,
      mode: 'modal', root: 0, scale: 'ionian', quantize: '1/8', rows: 21, lowest: 48,
    });
    this.scene.createdAt = Date.now();
    this.scene.invalidate();

    const rows = this.scene.settings.rows;
    this.parts = SCORE.map((p, i) => ({
      brush: p.brush,
      strokes: p.strokes.map((s, j) => ({ pts: smoothPath(s, rows, i * 1.7 + j * 0.9), i: 0 })),
      si: 0,
      open: null,
      lastRow: null,
      lastSlot: null,
    }));

    this.running = true;
    this.part = -1;
    this.engine.setTempo(this.scene.settings.bpm);
    this.engine.setLength(this.scene.totalBeats);
    this.engine.onCycle = () => this._next();
    this.engine.start(0);
    this._next();
  }

  stop(finished = false) {
    if (!this.running) return;
    this.running = false;
    this.engine.onCycle = null;
    const p = this.parts && this.parts[this.part];
    if (p && p.open) { this.scene.endStroke(p.open); p.open = null; }
    if (this.onDone) this.onDone(finished);
  }

  /* Called when the transport wraps: finish this part, take up the next one. */
  _next() {
    if (!this.running) return;
    const cur = this.parts[this.part];
    if (cur) this._flush(cur);
    this.part++;
    if (this.part >= this.parts.length) return this.stop(true);
    if (this.onPart) this.onPart(this.parts[this.part].brush, this.part, this.parts.length);
  }

  /* Feed the part everything up to the playhead. Called once per frame. */
  tick(playhead) {
    if (!this.running || playhead === null) return;
    const part = this.parts[this.part];
    if (part) this._feed(part, playhead);
  }

  _flush(part) {
    this._feed(part, Infinity);
    if (part.open) { this.scene.endStroke(part.open); part.open = null; }
  }

  _feed(part, upto) {
    while (part.si < part.strokes.length) {
      const stroke = part.strokes[part.si];
      if (stroke.pts[stroke.i].b > upto) return;
      if (!part.open) {
        part.open = this.scene.beginStroke(part.brush, { snapshot: false });
        part.t0 = performance.now();
        this.audition.reset();
      }
      while (stroke.i < stroke.pts.length && stroke.pts[stroke.i].b <= upto) {
        const p = stroke.pts[stroke.i];
        const prev = stroke.i > 0 ? stroke.pts[stroke.i - 1] : p;
        this.scene.addPoint(part.open, p.b, p.y, performance.now() - part.t0,
          this._speed(prev, p));
        this.audition.feed(part.brush, p);
        stroke.i++;
      }
      if (stroke.i >= stroke.pts.length) {
        this.scene.endStroke(part.open);
        part.open = null;
        part.si++;
      } else {
        return;
      }
    }
  }

  /* How fast the hand would be moving here, in the same 0..1 units as painting. */
  _speed(a, b) {
    const s = this.scene.settings;
    const dx = ((b.b - a.b) / this.scene.totalBeats) * Math.max(this.view.plotW, 1);
    const dy = (b.y - a.y) * Math.max(this.view.plotH, 1);
    const ms = Math.max(1, (b.b - a.b) * 60000 / s.bpm);
    return clamp(Math.hypot(dx, dy) / ms / 1.6, 0, 1);
  }

}
