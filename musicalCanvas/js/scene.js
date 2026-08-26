/*
 * The scene: settings, painted strokes, and the MIDI notes derived from them.
 *
 * Strokes are stored resolution-independently -- beat position plus a 0..1
 * pitch-axis coordinate -- so the same painting can be re-read through a
 * different mode, key or quantize grid. Notes are always derived, never
 * edited directly, which is what makes those dropdowns live controls rather
 * than one-way conversions.
 */

import { PitchMap, QUANTIZE, KIT, clamp } from './music.js';
import { brushById } from './audio.js';

export const DEFAULTS = {
  bpm: 100,
  bars: 4,
  beatsPerBar: 4,
  mode: 'modal',        // 'modal' | 'chromatic'
  root: 0,              // pitch class
  scale: 'ionian',
  quantize: '1/8',
  rows: 21,
  lowest: 48,           // C3
};

/*
 * Chord rules. A grid slot sounds every row the brush lingered on, so a
 * vertical smear becomes a chord while an ordinary line stays one note:
 *   - a row has to hold MIN_SHARE of the slot before it sounds at all, which
 *     keeps a shaky hand and the notes passed through mid-glide out of it
 *   - the rows that qualify have to be MIN_SPREAD apart before any of this
 *     counts as deliberate, so wobble across a row boundary stays monophonic
 *   - and a slot never sounds more than MAX_VOICES at once
 */
const MAX_VOICES = 3;
const MIN_SHARE = 0.2;
const MIN_SPREAD = 2;

const round4 = v => Math.round(v * 1e4) / 1e4;
let nextId = 1;

export class Scene {
  constructor(settings = {}) {
    this.name = 'Untitled set';
    this.id = null;                        // backend id once saved
    this.createdAt = Date.now();           // session clock the strokes are timed against
    this.settings = { ...DEFAULTS, ...settings };
    this.strokes = [];
    this._notes = null;
    this._undo = [];
    this._redo = [];
    this.onChange = null;
  }

  get totalBeats() { return this.settings.bars * this.settings.beatsPerBar; }
  get grid() { return (QUANTIZE[this.settings.quantize] || QUANTIZE.off).beats; }

  pitchMap() {
    const s = this.settings;
    return new PitchMap({ mode: s.mode, root: s.root, scale: s.scale, lowest: s.lowest, rows: s.rows });
  }

  set(key, value) {
    if (this.settings[key] === value) return;
    this.settings[key] = value;
    this.invalidate();
  }

  invalidate() {
    this._notes = null;
    if (this.onChange) this.onChange();
  }

  /* ---- editing --------------------------------------------------------- */

  _snapshot() {
    this._undo.push(JSON.stringify(this.strokes));
    if (this._undo.length > 60) this._undo.shift();
    this._redo.length = 0;
  }

  beginStroke(brush, { snapshot = true } = {}) {
    if (snapshot) this._snapshot();
    // t0: wall clock, at: ms into the session -- together with each point's dt
    // these say when in the making of the set the gesture happened, and how
    // fast the hand moved through it
    const t0 = Date.now();
    const stroke = { id: nextId++, brush, t0, at: t0 - this.createdAt, points: [] };
    this.strokes.push(stroke);
    return stroke;
  }

  /* beat: position in beats, y: 0 (bottom) .. 1 (top), dt: ms since stroke start */
  addPoint(stroke, beat, y, dt, speed) {
    stroke.points.push({
      b: round4(clamp(beat, 0, this.totalBeats)),
      y: round4(clamp(y, 0, 1)),
      dt: Math.round(dt),
      s: round4(clamp(speed, 0, 1)),
    });
    this.invalidate();
  }

  endStroke(stroke, { snapshot = true } = {}) {
    if (!stroke.points.length) {
      this.strokes = this.strokes.filter(s => s !== stroke);
      if (snapshot) this._undo.pop();
    }
    this.invalidate();
  }

  /* Remove strokes passing within `radius` (in beat/pitch units) of a point. */
  eraseAt(beat, y, radiusBeats, radiusY) {
    const hit = this.strokes.filter(s => s.points.some(p =>
      Math.abs(p.b - beat) < radiusBeats && Math.abs(p.y - y) < radiusY));
    if (!hit.length) return false;
    this._snapshot();
    this.strokes = this.strokes.filter(s => !hit.includes(s));
    this.invalidate();
    return true;
  }

  clear(brushId = null) {
    if (!this.strokes.length) return;
    this._snapshot();
    this.strokes = brushId ? this.strokes.filter(s => s.brush !== brushId) : [];
    this.invalidate();
  }

  undo() {
    if (!this._undo.length) return;
    this._redo.push(JSON.stringify(this.strokes));
    this.strokes = JSON.parse(this._undo.pop());
    this.invalidate();
  }

  redo() {
    if (!this._redo.length) return;
    this._undo.push(JSON.stringify(this.strokes));
    this.strokes = JSON.parse(this._redo.pop());
    this.invalidate();
  }

  /* ---- stroke -> MIDI -------------------------------------------------- */

  get notes() {
    if (!this._notes) this._notes = this._derive();
    return this._notes;
  }

  rowForY(y) {
    const rows = this.settings.rows;
    return clamp(Math.floor(y * rows), 0, rows - 1);
  }

  midiFor(brushId, row, map) {
    const b = brushById(brushId);
    if (b.kit) return KIT[row % KIT.length].note;
    return clamp(map.rowToMidi(row), 0, 127);
  }

  _derive() {
    const map = this.pitchMap();
    const grid = this.grid;
    const notes = [];
    for (const stroke of this.strokes) {
      for (const n of this._strokeToNotes(stroke, map, grid)) notes.push(n);
    }
    notes.sort((a, b) => a.start - b.start);
    return notes;
  }

  _strokeToNotes(stroke, map, grid) {
    const pts = stroke.points;
    if (!pts.length) return [];

    // 1. group consecutive points that land on the same row
    const runs = [];
    for (const p of pts) {
      const row = this.rowForY(p.y);
      const last = runs[runs.length - 1];
      if (last && last.row === row) {
        last.start = Math.min(last.start, p.b);
        last.end = Math.max(last.end, p.b);
        last.speed += p.s;
        last.n++;
      } else {
        runs.push({ row, start: p.b, end: p.b, speed: p.s, n: 1 });
      }
    }

    // a run holds its row until the next run begins -- without this a stroke
    // sampled point by point looks like a series of zero-length visits, and
    // nothing ever holds a slot for long enough to sound
    for (let i = 0; i < runs.length - 1; i++) {
      runs[i].end = Math.max(runs[i].end, runs[i + 1].start);
    }

    const kit = brushById(stroke.brush).kit;
    const spans = grid ? this._quantizeRuns(runs, grid, kit) : this._freeRuns(runs);
    return this._emit(spans, stroke, map, grid);
  }

  /*
   * On a grid, every slot the stroke passes through sounds the row (or rows)
   * it spent its time on. One row is the ordinary case; a smear across several
   * rows inside one slot plays them together, up to MAX_VOICES.
   */
  _quantizeRuns(runs, grid, kit = false) {
    const slots = new Map();          // slot index -> row -> time spent there
    for (const r of runs) {
      const first = Math.floor(r.start / grid + 1e-9);
      const last = Math.max(first, Math.floor((r.end - 1e-9) / grid));
      for (let i = first; i <= last; i++) {
        const lo = i * grid, hi = lo + grid;
        const overlap = Math.max(Math.min(r.end, hi) - Math.max(r.start, lo), 1e-6);
        let rows = slots.get(i);
        if (!rows) slots.set(i, rows = new Map());
        const cur = rows.get(r.row);
        if (cur) {
          cur.weight += overlap;
          cur.speed = (cur.speed * cur.n + r.speed / r.n) / (cur.n + 1);
          cur.n++;
        } else {
          rows.set(r.row, { weight: overlap, speed: r.speed / r.n, n: 1 });
        }
      }
    }

    const voiced = new Map();
    for (const [i, rows] of slots) voiced.set(i, this._voices(rows, grid));
    return this._merge(voiced, grid, kit);
  }

  /* Which rows of one slot actually sound. */
  _voices(rows, grid) {
    const ranked = [...rows.entries()]
      .map(([row, v]) => ({ row, weight: v.weight, speed: v.speed }))
      .sort((a, b) => b.weight - a.weight || a.row - b.row);
    const spread = list =>
      Math.max(...list.map(v => v.row)) - Math.min(...list.map(v => v.row));

    const strong = ranked.filter(v => v.weight >= grid * MIN_SHARE);
    if (strong.length >= 2 && spread(strong) >= MIN_SPREAD) {
      return strong.slice(0, MAX_VOICES);
    }
    // A smear fast enough that no row holds the slot on its own: if it covered
    // real ground, sound where it leaned and the two ends of the sweep.
    if (!strong.length && ranked.length > 1 && spread(ranked) >= MIN_SPREAD) {
      const byRow = [...ranked].sort((a, b) => a.row - b.row);
      const picks = [ranked[0], byRow[0], byRow[byRow.length - 1]];
      return picks.filter((v, i) => picks.indexOf(v) === i).slice(0, MAX_VOICES);
    }
    return [ranked[0]];
  }

  /*
   * Consecutive slots holding the same row are one held note -- per row, so a
   * chord can hold while a voice above it moves. The drum kit never merges: a
   * line along a row means a hit on every grid step.
   */
  _merge(voiced, grid, kit) {
    const spans = [];
    const open = new Map();           // row -> the span still being held
    for (const i of [...voiced.keys()].sort((a, b) => a - b)) {
      const sounding = new Set();
      for (const v of voiced.get(i)) {
        sounding.add(v.row);
        const held = open.get(v.row);
        if (!kit && held && held.endSlot + 1 === i) {
          held.endSlot = i;
          held.speed = (held.speed * held.n + v.speed) / (held.n + 1);
          held.n++;
        } else {
          const span = { row: v.row, startSlot: i, endSlot: i, speed: v.speed, n: 1 };
          spans.push(span);
          open.set(v.row, span);
        }
      }
      for (const row of [...open.keys()]) {
        if (!sounding.has(row)) open.delete(row);
      }
    }
    return spans.map(s => ({
      row: s.row,
      start: s.startSlot * grid,
      end: (s.endSlot + 1) * grid,
      speed: s.speed,
    }));
  }

  /* Unquantized: keep the raw runs, minus the slivers left by row wobble. */
  _freeRuns(runs) {
    const kept = runs.length === 1
      ? runs
      : runs.filter(r => r.end - r.start >= 0.04 || r.n > 2);
    const merged = [];
    for (const r of (kept.length ? kept : [runs[0]])) {
      const last = merged[merged.length - 1];
      if (last && last.row === r.row) {
        last.end = Math.max(last.end, r.end);
        last.speed = (last.speed * last.n + r.speed) / (last.n + r.n);
        last.n += r.n;
      } else {
        merged.push({ row: r.row, start: r.start, end: r.end, speed: r.speed / r.n, n: r.n });
      }
    }
    return merged.map(r => ({ row: r.row, start: r.start, end: Math.max(r.end, r.start + 0.08), speed: r.speed }));
  }

  _emit(spans, stroke, map, grid) {
    const kit = brushById(stroke.brush).kit;
    const out = [];
    for (const s of spans) {
      const start = Math.max(0, s.start);
      if (start >= this.totalBeats) continue;
      const end = Math.min(s.end, this.totalBeats);
      const dur = kit ? Math.min(end - start, 0.25) : end - start;
      if (dur <= 0) continue;
      out.push({
        brush: stroke.brush,
        strokeId: stroke.id,
        row: s.row,
        midi: this.midiFor(stroke.brush, s.row, map),
        start: round4(start),
        dur: round4(dur),
        vel: Math.round(clamp(48 + s.speed * 72, 20, 127)),
      });
    }
    return out;
  }

  /* ---- persistence ----------------------------------------------------- */

  toJSON() {
    return {
      version: 1,
      name: this.name,
      settings: { ...this.settings },
      createdAt: this.createdAt,
      strokes: this.strokes.map(s => ({
        id: s.id, brush: s.brush, t0: s.t0, at: s.at, points: s.points,
      })),
      notes: this.notes,          // derived snapshot, for anything reading the file
    };
  }

  load(data) {
    this.name = data.name || 'Untitled set';
    this.settings = { ...DEFAULTS, ...(data.settings || {}) };
    this.createdAt = data.createdAt || Date.now();
    this.strokes = (data.strokes || []).map(s => ({
      id: nextId++,
      brush: s.brush,
      t0: s.t0 || null,
      at: s.at != null ? s.at : (s.t0 ? s.t0 - this.createdAt : null),
      points: s.points || [],
    }));
    this._undo.length = 0;
    this._redo.length = 0;
    this.invalidate();
  }

  stats() {
    const notes = this.notes;
    const byBrush = {};
    notes.forEach(n => { byBrush[n.brush] = (byBrush[n.brush] || 0) + 1; });
    return { strokes: this.strokes.length, notes: notes.length, byBrush };
  }
}
