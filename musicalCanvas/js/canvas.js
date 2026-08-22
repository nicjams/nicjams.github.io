/* The painting surface: grid, strokes, derived notes, playhead, pointer input. */

import { brushById, BRUSHES } from './audio.js';
import { KIT, clamp } from './music.js';

const GUTTER = 54;        // left key strip, px
const RULER = 22;         // top bar ruler, px

/* Blue (slow) -> red (fast), used when "show speed" is on. */
function speedColor(s, alpha = 1) {
  const h = 210 - clamp(s, 0, 1) * 210;
  return `hsla(${h}, 85%, 42%, ${alpha})`;
}

/* One tile of primed canvas weave: warp and weft threads plus grain. */
function makeWeaveTile(size = 256, thread = 3) {
  const tile = document.createElement('canvas');
  tile.width = tile.height = size;
  const g = tile.getContext('2d');
  g.fillStyle = '#e9e1d0';
  g.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += thread) {
    for (let x = 0; x < size; x += thread) {
      const over = ((x / thread + y / thread) % 2) === 0;
      const n = Math.random() * 7 - 3.5;
      const base = over ? 237 : 228;
      g.fillStyle = `rgb(${base + n}, ${base - 6 + n}, ${base - 19 + n})`;
      g.fillRect(x, y, thread, thread);
    }
  }
  // slubs: the odd thicker fibre, so the weave is not perfectly regular
  g.globalAlpha = 0.16;
  for (let i = 0; i < size / 8; i++) {
    const horiz = Math.random() < 0.5;
    const p = Math.floor(Math.random() * size);
    const len = 6 + Math.random() * size * 0.4;
    const q = Math.random() * size;
    g.fillStyle = Math.random() < 0.5 ? '#d8ceb8' : '#f7f2e8';
    if (horiz) g.fillRect(q, p, len, thread - 1);
    else g.fillRect(p, q, thread - 1, len);
  }
  g.globalAlpha = 1;
  return tile;
}

export class CanvasView {
  constructor(canvas, scene, handlers = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scene = scene;
    this.h = handlers;                 // { onStroke*, onErase, onHover }
    this.tool = 'brush';               // 'brush' | 'erase'
    this.brush = BRUSHES[0].id;
    this.showSpeed = false;
    this.showGrid = false;             // off: bare canvas, just the paint
    this.playhead = null;              // beats, or null when stopped
    this.soloBrush = null;             // dim other brushes when set
    this.dpr = 1;
    this.W = 0;
    this.H = 0;

    this._active = null;               // stroke in progress
    this._lastPt = null;
    this._t0 = 0;

    this._bindPointer();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    // the canvas can measure 0 if the page lays out while hidden (background
    // tab, collapsed pane) -- observe it so it recovers when it appears
    if (window.ResizeObserver) {
      new ResizeObserver(() => this.resize()).observe(canvas);
    }
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.dpr = window.devicePixelRatio || 1;
    this.W = r.width;
    this.H = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.draw();
  }

  /* ---- geometry -------------------------------------------------------- */

  /* the key strip and ruler are part of the grid overlay, not the paint */
  get gutter() { return this.showGrid ? GUTTER : 0; }
  get ruler() { return this.showGrid ? RULER : 0; }
  get plotW() { return this.W - this.gutter; }
  get plotH() { return this.H - this.ruler; }
  get rowH() { return this.plotH / this.scene.settings.rows; }

  xForBeat(b) { return this.gutter + (b / this.scene.totalBeats) * this.plotW; }
  beatForX(x) { return ((x - this.gutter) / this.plotW) * this.scene.totalBeats; }
  /* y normalized 0 (bottom) .. 1 (top) */
  yNormForPx(py) { return clamp(1 - (py - this.ruler) / this.plotH, 0, 0.9999); }
  pxForYNorm(y) { return this.ruler + (1 - y) * this.plotH; }
  yForRow(row) { return this.ruler + this.plotH - (row + 1) * this.rowH; }

  /* ---- input ----------------------------------------------------------- */

  _pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _bindPointer() {
    const c = this.canvas;
    c.addEventListener('pointerdown', e => {
      const p = this._pos(e);
      if (p.x < this.gutter) return this._auditionKey(p);
      try { c.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
      this._t0 = performance.now();
      this._lastPt = { ...p, t: this._t0 };
      if (this.tool === 'erase') {
        this._erasing = true;
        this._eraseAt(p);
        return;
      }
      this._active = this.scene.beginStroke(this.brush);
      this._push(p, 0);
      if (this.h.onStrokeStart) this.h.onStrokeStart(this._active);
    });

    c.addEventListener('pointermove', e => {
      const p = this._pos(e);
      if (this.h.onHover) this.h.onHover(this._describe(p));
      if (this._erasing) return this._eraseAt(p);
      if (!this._active) return;
      // coalesced events keep fast strokes smooth (and their speeds honest);
      // the list is empty for synthetic events, so fall back to the event itself
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      for (const ev of (evs.length ? evs : [e])) {
        this._push(this._pos(ev), performance.now() - this._t0);
      }
    });

    const end = e => {
      this._erasing = false;
      if (!this._active) return;
      const s = this._active;
      this._active = null;
      this.scene.endStroke(s);
      if (this.h.onStrokeEnd) this.h.onStrokeEnd(s);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { if (this.h.onHover) this.h.onHover(null); });
    c.addEventListener('contextmenu', e => e.preventDefault());
  }

  _push(p, dt) {
    const now = performance.now();
    const last = this._lastPt;
    let speed = 0;
    if (last) {
      const dist = Math.hypot(p.x - last.x, p.y - last.y);
      const ms = Math.max(4, now - last.t);
      speed = clamp((dist / ms) / 1.6, 0, 1);       // ~1.6 px/ms reads as full tilt
    }
    this._lastPt = { ...p, t: now };
    const beat = this.beatForX(p.x);
    const y = this.yNormForPx(p.y);
    this.scene.addPoint(this._active, beat, y, dt, speed);
    if (this.h.onPoint) {
      const row = this.scene.rowForY(y);
      this.h.onPoint({ brush: this._active.brush, row, speed });
    }
  }

  _eraseAt(p) {
    const rBeats = this.scene.totalBeats * (10 / this.plotW);
    const rY = 1.5 / this.scene.settings.rows;
    if (this.scene.eraseAt(this.beatForX(p.x), this.yNormForPx(p.y), rBeats, rY)) {
      if (this.h.onErase) this.h.onErase();
    }
  }

  _auditionKey(p) {
    const y = this.yNormForPx(p.y);
    const row = this.scene.rowForY(y);
    if (this.h.onAudition) this.h.onAudition(row);
  }

  _describe(p) {
    if (p.x < this.gutter || p.y < this.ruler) return null;
    const row = this.scene.rowForY(this.yNormForPx(p.y));
    const beat = this.beatForX(p.x);
    const bpb = this.scene.settings.beatsPerBar;
    return {
      row,
      label: this.rowLabel(row),
      bar: Math.floor(beat / bpb) + 1,
      beat: (beat % bpb) + 1,
    };
  }

  rowLabel(row) {
    if (brushById(this.brush).kit) return KIT[row % KIT.length].name;
    return this.scene.pitchMap().label(row);
  }

  /* ---- drawing --------------------------------------------------------- */

  draw() {
    if (!this.W || !this.H) return;
    const g = this.ctx;
    g.clearRect(0, 0, this.W, this.H);
    this._drawSurface();
    if (this.showGrid) {
      this._drawRows();
      this._drawTimeGrid();
      this._drawNotes();
    }
    this._drawStrokes();
    if (this.showGrid) {
      this._drawGutter();
      this._drawRuler();
    }
    this._drawPlayhead();
  }

  /* Primed canvas: a woven tile, tinted and vignetted. Built once, tiled. */
  _drawSurface() {
    const g = this.ctx;
    if (!this._weave) this._weave = g.createPattern(makeWeaveTile(), 'repeat');
    g.fillStyle = '#eae2d2';
    g.fillRect(0, 0, this.W, this.H);
    g.fillStyle = this._weave;
    g.fillRect(0, 0, this.W, this.H);
    if (this.showGrid) {
      // the grid reads better over a flatter ground
      g.fillStyle = 'rgba(252, 250, 245, 0.82)';
      g.fillRect(0, 0, this.W, this.H);
      return;
    }
    const vig = g.createRadialGradient(
      this.W / 2, this.H / 2, Math.min(this.W, this.H) * 0.25,
      this.W / 2, this.H / 2, Math.max(this.W, this.H) * 0.75);
    vig.addColorStop(0, 'rgba(90, 70, 40, 0)');
    vig.addColorStop(1, 'rgba(90, 70, 40, 0.17)');
    g.fillStyle = vig;
    g.fillRect(0, 0, this.W, this.H);
  }

  _drawRows() {
    const g = this.ctx;
    const map = this.scene.pitchMap();
    const kit = brushById(this.brush).kit;
    for (let row = 0; row < this.scene.settings.rows; row++) {
      const y = this.yForRow(row);
      const inScale = kit ? row % 2 === 0 : map.inScale(row);
      const isRoot = kit ? row % KIT.length === 0 : map.isRoot(row);
      g.fillStyle = isRoot ? 'rgba(14,124,150,0.11)'
        : inScale ? 'rgba(255,255,255,0.75)'
        : 'rgba(110,120,135,0.13)';
      g.fillRect(GUTTER, y, this.plotW, this.rowH);
      g.strokeStyle = isRoot ? 'rgba(14,124,150,0.4)' : 'rgba(30,36,48,0.1)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(GUTTER, Math.round(y) + 0.5);
      g.lineTo(this.W, Math.round(y) + 0.5);
      g.stroke();
    }
  }

  _drawTimeGrid() {
    const g = this.ctx;
    const s = this.scene.settings;
    const grid = this.scene.grid;
    const top = this.ruler, bot = this.H;
    if (grid) {
      g.strokeStyle = 'rgba(30,36,48,0.07)';
      g.lineWidth = 1;
      g.beginPath();
      for (let b = 0; b < this.scene.totalBeats + 1e-6; b += grid) {
        const x = Math.round(this.xForBeat(b)) + 0.5;
        g.moveTo(x, top); g.lineTo(x, bot);
      }
      g.stroke();
    }
    g.strokeStyle = 'rgba(30,36,48,0.16)';
    g.beginPath();
    for (let b = 0; b <= this.scene.totalBeats; b += 1) {
      const x = Math.round(this.xForBeat(b)) + 0.5;
      g.moveTo(x, top); g.lineTo(x, bot);
    }
    g.stroke();
    g.strokeStyle = 'rgba(30,36,48,0.32)';
    g.beginPath();
    for (let b = 0; b <= this.scene.totalBeats; b += s.beatsPerBar) {
      const x = Math.round(this.xForBeat(b)) + 0.5;
      g.moveTo(x, top); g.lineTo(x, bot);
    }
    g.stroke();
  }

  _drawNotes() {
    const g = this.ctx;
    const head = this.playhead;
    for (const n of this.scene.notes) {
      const b = brushById(n.brush);
      const x = this.xForBeat(n.start);
      const w = Math.max(3, this.xForBeat(n.start + n.dur) - x);
      const y = this.yForRow(n.row) + 1.5;
      const h = Math.max(3, this.rowH - 3);
      const live = head !== null && head >= n.start && head < n.start + Math.max(n.dur, 0.12);
      const dim = this.soloBrush && this.soloBrush !== n.brush;
      g.globalAlpha = dim ? 0.18 : 0.35 + (n.vel / 127) * 0.55;
      g.fillStyle = b.color;
      this._roundRect(x, y, w, h, Math.min(4, h / 2));
      g.fill();
      if (live && !dim) {
        g.globalAlpha = 1;
        g.strokeStyle = 'rgba(30,36,48,0.8)';
        g.lineWidth = 1.5;
        this._roundRect(x, y, w, h, Math.min(4, h / 2));
        g.stroke();
        g.shadowColor = b.color;
        g.shadowBlur = 18;
        g.fillStyle = b.color;
        this._roundRect(x, y, w, h, Math.min(4, h / 2));
        g.fill();
        g.shadowBlur = 0;
      }
    }
    g.globalAlpha = 1;
  }

  _drawStrokes() {
    const g = this.ctx;
    const head = this.playhead;
    for (const s of this.scene.strokes) {
      const pts = s.points;
      if (!pts.length) continue;
      const b = brushById(s.brush);
      const dim = this.soloBrush && this.soloBrush !== s.brush;
      g.lineCap = 'round';
      g.lineJoin = 'round';

      if (pts.length === 1) {
        g.globalAlpha = dim ? 0.2 : 0.9;
        g.fillStyle = this.showSpeed ? speedColor(pts[0].s) : b.color;
        g.beginPath();
        g.arc(this.xForBeat(pts[0].b), this.pxForYNorm(pts[0].y),
          this.showGrid ? 3.5 : 6, 0, Math.PI * 2);
        g.fill();
        continue;
      }

      // wet edge under the stroke, only on the bare canvas
      if (!this.showGrid && !dim) {
        g.globalAlpha = 0.16;
        g.strokeStyle = b.color;
        g.lineWidth = 16;
        g.beginPath();
        g.moveTo(this.xForBeat(pts[0].b), this.pxForYNorm(pts[0].y));
        for (let i = 1; i < pts.length; i++) {
          g.lineTo(this.xForBeat(pts[i].b), this.pxForYNorm(pts[i].y));
        }
        g.stroke();
      }

      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1], p1 = pts[i];
        // a slow hand lays down more paint than a fast flick
        const w = this.showGrid
          ? (this.showSpeed ? 1.2 + p1.s * 5 : 2)
          : (this.showSpeed ? 3 + p1.s * 9 : 9 - p1.s * 5);
        const lit = head !== null && Math.abs(p1.b - head) < 0.12;
        g.globalAlpha = dim ? 0.15 : this.showGrid ? 0.85 : 0.95;
        g.strokeStyle = this.showSpeed ? speedColor(p1.s) : b.color;
        g.lineWidth = w;
        if (lit && !dim) {
          g.shadowColor = b.color;
          g.shadowBlur = 22;
        }
        g.beginPath();
        g.moveTo(this.xForBeat(p0.b), this.pxForYNorm(p0.y));
        g.lineTo(this.xForBeat(p1.b), this.pxForYNorm(p1.y));
        g.stroke();
        g.shadowBlur = 0;
      }
    }
    g.globalAlpha = 1;
  }

  _drawGutter() {
    const g = this.ctx;
    const kit = brushById(this.brush).kit;
    const map = this.scene.pitchMap();
    g.fillStyle = '#ffffff';
    g.fillRect(0, this.ruler, GUTTER, this.plotH);
    g.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.textBaseline = 'middle';
    for (let row = 0; row < this.scene.settings.rows; row++) {
      const y = this.yForRow(row);
      const isRoot = kit ? row % KIT.length === 0 : map.isRoot(row);
      const inScale = kit ? true : map.inScale(row);
      g.fillStyle = isRoot ? 'rgba(14,124,150,0.14)' : inScale ? 'rgba(30,36,48,0.04)' : 'transparent';
      g.fillRect(0, y + 1, GUTTER - 1, this.rowH - 1);
      if (this.rowH > 9) {
        g.fillStyle = isRoot ? '#0b6a80' : inScale ? '#333a45' : '#98a0ac';
        const label = kit ? KIT[row % KIT.length].name : map.label(row);
        g.fillText(label.slice(0, 8), 6, y + this.rowH / 2);
      }
    }
    g.strokeStyle = 'rgba(30,36,48,0.14)';
    g.beginPath();
    g.moveTo(GUTTER + 0.5, this.ruler); g.lineTo(GUTTER + 0.5, this.H);
    g.stroke();
  }

  _drawRuler() {
    const g = this.ctx;
    const s = this.scene.settings;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, this.W, RULER);
    g.strokeStyle = 'rgba(30,36,48,0.14)';
    g.beginPath(); g.moveTo(0, RULER + 0.5); g.lineTo(this.W, RULER + 0.5); g.stroke();
    g.fillStyle = '#6c7480';
    g.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.textBaseline = 'middle';
    for (let bar = 0; bar < s.bars; bar++) {
      const x = this.xForBeat(bar * s.beatsPerBar);
      g.fillText(String(bar + 1), x + 5, RULER / 2);
    }
  }

  _drawPlayhead() {
    if (this.playhead === null) return;
    const g = this.ctx;
    const x = this.xForBeat(this.playhead);
    const grad = g.createLinearGradient(x - 26, 0, x, 0);
    grad.addColorStop(0, 'rgba(30,36,48,0)');
    grad.addColorStop(1, 'rgba(30,36,48,0.09)');
    g.fillStyle = grad;
    g.fillRect(x - 26, this.ruler, 26, this.plotH);
    g.strokeStyle = '#1e242e';
    g.shadowColor = 'rgba(30,36,48,0.35)';
    g.shadowBlur = 8;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x, this.ruler); g.lineTo(x, this.H);
    g.stroke();
    g.shadowBlur = 0;
    g.fillStyle = '#1e242e';
    g.beginPath();
    g.moveTo(x - 5, 2); g.lineTo(x + 5, 2); g.lineTo(x, 10);
    g.closePath(); g.fill();
  }

  _roundRect(x, y, w, h, r) {
    const g = this.ctx;
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
}
