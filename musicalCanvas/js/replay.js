/*
 * Replay: repaint a saved set the way it was made.
 *
 * Loading a set shows the finished painting. Pressing play wipes it and lays
 * the strokes back down one at a time, in the order they were performed and at
 * the pace they were drawn -- the recorded `at` per stroke and `dt` per point.
 * Only the thinking time between strokes is compressed, so a set made over ten
 * minutes still replays in something like the time it took to paint.
 */

import { clamp } from './music.js';
import { Auditioner } from './demo.js';

const MAX_GAP = 900;      // ms of pause kept between two strokes

let cloneId = 1;
const cloneStrokes = strokes => (strokes || []).map(s => ({
  id: `r${cloneId++}`,
  brush: s.brush,
  t0: s.t0 || null,
  at: s.at != null ? s.at : null,
  points: (s.points || []).map(p => ({ ...p })),
}));

export class Replay {
  constructor({ scene, engine, view, onBrush, onDone }) {
    this.scene = scene;
    this.engine = engine;
    this.view = view;
    this.onBrush = onBrush;
    this.onDone = onDone;
    this.audition = new Auditioner(scene, engine);
    this.armed = false;
    this.running = false;
    this.payload = null;
  }

  /* Called when a set is loaded: the painting stays, the performance waits. */
  arm(payload) {
    this.payload = payload;
    this.armed = !!(payload && (payload.strokes || []).length);
    return this.armed;
  }

  disarm() {
    this.armed = false;
    this.payload = null;
  }

  /*
   * Lay the strokes out on one timeline: each starts after the previous one
   * ended, plus however long the painter paused, capped at MAX_GAP.
   */
  _plan() {
    const strokes = cloneStrokes(this.payload.strokes);
    strokes.forEach((s, i) => {
      s.recorded = s.at != null ? s.at : (s.t0 != null ? s.t0 : i * 600);
      s.dur = s.points.length ? s.points[s.points.length - 1].dt : 0;
    });
    strokes.sort((a, b) => a.recorded - b.recorded);
    let clock = 0;
    strokes.forEach((s, i) => {
      if (i > 0) {
        const prev = strokes[i - 1];
        const gap = s.recorded - (prev.recorded + prev.dur);
        clock += prev.dur + clamp(isFinite(gap) ? gap : 0, 0, MAX_GAP);
      }
      s.start = clock;
      s.pi = 0;
    });
    return strokes;
  }

  start() {
    if (!this.armed || !this.payload) return false;
    this.plan = this._plan();
    this.scene.clear();
    this.si = 0;
    this.open = null;
    this.t0 = performance.now();
    this.running = true;
    this.armed = false;
    this.engine.setTempo(this.scene.settings.bpm);
    this.engine.setLength(this.scene.totalBeats);
    this.engine.start(0);
    return true;
  }

  /* Called once per frame while running. */
  tick() {
    if (!this.running) return;
    const elapsed = performance.now() - this.t0;
    while (this.si < this.plan.length) {
      const s = this.plan[this.si];
      if (elapsed < s.start) return;
      if (!this.open) {
        this.open = this.scene.beginStroke(s.brush, { snapshot: false });
        this.audition.reset();
        if (this.onBrush) this.onBrush(s.brush);
      }
      while (s.pi < s.points.length && s.start + s.points[s.pi].dt <= elapsed) {
        const p = s.points[s.pi];
        this.scene.addPoint(this.open, p.b, p.y, p.dt, p.s);
        this.audition.feed(s.brush, p);
        s.pi++;
      }
      if (s.pi < s.points.length) return;
      this.scene.endStroke(this.open, { snapshot: false });
      this.open = null;
      this.si++;
    }
    this._end(true);
  }

  /* Stop early and put the finished painting back. */
  cancel() {
    if (!this.running) return;
    if (this.open) {
      this.scene.endStroke(this.open, { snapshot: false });
      this.open = null;
    }
    this.scene.strokes = cloneStrokes(this.payload.strokes);
    this.scene.invalidate();
    this._end(false);
  }

  _end(finished) {
    this.running = false;
    if (this.onDone) this.onDone(finished);
  }
}
