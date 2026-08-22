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

    const kit = brushById(stroke.brush).kit;
    const spans = grid ? this._quantizeRuns(runs, grid, kit) : this._freeRuns(runs);
    return this._emit(spans, stroke, map, grid);
  }

  /*
   * On a grid, every slot the stroke passes through gets one note: the row it
   * spent the most time on. That keeps a wobbly line from spraying grace notes
   * while still letting a fast diagonal read as a scale run.
   */
  _quantizeRuns(runs, grid, kit = false) {
    const slots = new Map();
    for (const r of runs) {
      const first = Math.floor(r.start / grid + 1e-9);
      const last = Math.max(first, Math.floor((r.end - 1e-9) / grid));
      for (let i = first; i <= last; i++) {
        const lo = i * grid, hi = lo + grid;
        const overlap = Math.max(Math.min(r.end, hi) - Math.max(r.start, lo), 1e-6);
        const cur = slots.get(i);
        if (!cur || overlap > cur.weight) {
          slots.set(i, { row: r.row, weight: overlap, speed: r.speed / r.n });
        }
      }
    }
    // consecutive slots on the same row are one held note -- except for the
    // drum kit, where a line along a row means a hit on every grid step
    const spans = [];
    for (const i of [...slots.keys()].sort((a, b) => a - b)) {
      const slot = slots.get(i);
      const last = spans[spans.length - 1];
      if (!kit && last && last.row === slot.row && Math.abs(last.endSlot + 1 - i) < 1e-9) {
        last.endSlot = i;
        last.speed = (last.speed * last.n + slot.speed) / (last.n + 1);
        last.n++;
      } else {
        spans.push({ row: slot.row, startSlot: i, endSlot: i, speed: slot.speed, n: 1 });
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
