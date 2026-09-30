// theory.js — the barrier explainer: the three barriers of ppf plotted over
// the gap, with the live distribution of contact gaps from the running solve
// drawn underneath, plus a sparkline helper for the telemetry strip.

import { BARRIERS } from './barrier.js';

const CURVES = [
  ['cubic', '#ffc15e'],
  ['log', '#7fa8ff'],
  ['quad', '#b197fc'],
];

export function drawBarrierPlot(canvas, { current = 'cubic', samples, nSamples = 0, minGap = null }) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth || 280, H = canvas.clientHeight || 150;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const L = 30, R = 8, T = 10, B = 22;
  const px = (u) => L + ((W - L - R) * u) / 1.2;   // u = g/ĝ ∈ [0, 1.2]
  const py = (v) => T + (H - T - B) * (1 - v);      // v ∈ [0, 1]

  // live gap histogram
  if (samples && nSamples) {
    const bins = 24, hist = new Array(bins).fill(0);
    for (let k = 0; k < nSamples; k++) {
      const b = Math.floor(Math.max(0, Math.min(0.9999, samples[k])) * bins);
      hist[b]++;
    }
    const mx = Math.max(...hist);
    g.fillStyle = 'rgba(99, 230, 190, 0.22)';
    for (let b = 0; b < bins; b++) {
      if (!hist[b]) continue;
      const h = (hist[b] / mx) * 0.85;
      g.fillRect(px(b / bins) + 0.5, py(h), px(1 / bins) - px(0) - 1, py(0) - py(h));
    }
  }
  // axes
  g.strokeStyle = 'rgba(160,175,210,0.25)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(L, T); g.lineTo(L, py(0)); g.lineTo(W - R, py(0));
  g.stroke();
  g.setLineDash([3, 4]);
  g.beginPath(); g.moveTo(px(1), T); g.lineTo(px(1), py(0)); g.stroke();
  g.setLineDash([]);
  g.fillStyle = '#7d88a6';
  g.font = '10px JetBrains Mono, monospace';
  g.textAlign = 'center';
  g.fillText('0', px(0), H - 7);
  g.fillText('ĝ', px(1), H - 7);
  g.fillText('gap g', px(0.55), H - 7);
  g.save();
  g.translate(11, py(0.5));
  g.rotate(-Math.PI / 2);
  g.fillText('ψ(g) / ψ(0)', 0, 0);
  g.restore();

  // curves, normalised so that the cubic and quadratic read 1 at contact;
  // the log barrier is normalised at g = 0.05ĝ and runs off the top
  for (const [key, col] of CURVES) {
    const B = BARRIERS[key];
    const norm = key === 'log' ? B.energy(0.05, 1) : B.energy(0, 1);
    g.strokeStyle = col;
    g.globalAlpha = key === current ? 1 : 0.4;
    g.lineWidth = key === current ? 2.4 : 1.4;
    g.beginPath();
    let started = false;
    for (let k = 0; k <= 240; k++) {
      const u = (1.2 * k) / 240;
      const v = Math.min(1.08, B.energy(Math.max(u, 1e-4), 1) / norm);
      if (!isFinite(v)) continue;
      if (!started) { g.moveTo(px(u), py(v)); started = true; } else g.lineTo(px(u), py(v));
    }
    g.stroke();
  }
  g.globalAlpha = 1;
  if (minGap !== null && isFinite(minGap) && minGap < 1.2) {
    g.strokeStyle = '#63e6be';
    g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(px(Math.max(0, minGap)), T); g.lineTo(px(Math.max(0, minGap)), py(0)); g.stroke();
  }
}

/** A tiny line chart of recent values; `log` plots log10. */
export function sparkline(canvas, values, { color = '#7fa8ff', min = null, max = null, log = false, fill = true } = {}) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth || 90, H = canvas.clientHeight || 22;
  if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  if (!values.length) return;
  const f = (v) => (log ? Math.log10(Math.max(1e-9, v)) : v);
  const vs = values.map(f);
  const lo = min !== null ? f(min) : Math.min(...vs), hi = max !== null ? f(max) : Math.max(...vs);
  const span = hi - lo || 1;
  const X = (k) => (W * k) / Math.max(1, values.length - 1), Y = (v) => H - 2 - (H - 4) * Math.min(1, Math.max(0, (v - lo) / span));
  g.beginPath();
  vs.forEach((v, k) => (k ? g.lineTo(X(k), Y(v)) : g.moveTo(X(k), Y(v))));
  g.strokeStyle = color;
  g.lineWidth = 1.4;
  g.stroke();
  if (fill) {
    g.lineTo(W, H); g.lineTo(0, H); g.closePath();
    g.globalAlpha = 0.14; g.fillStyle = color; g.fill(); g.globalAlpha = 1;
  }
}
