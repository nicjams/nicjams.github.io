// diagram.js — the braid word as a standard braid diagram (SVG), strands
// coloured like the 3D strands, read top to bottom like the simulation.
// Committed letters are solid, the move in flight is drawn to its progress,
// queued letters are ghosted.

import { letter } from './braid.js';

const NS = 'http://www.w3.org/2000/svg';
const ROW = 30, TOP = 18, BOTTOM = 22, LABEL = 34, PADR = 14;

function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

/**
 * rows: [{g, state:'done'|'active'|'queued', u?}]
 * colors[strand]; the strand at top position k is strand k.
 */
export function drawBraid(svg, n, rows, colors, bg = '#0f1422') {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const width = svg.clientWidth || 280;
  const lanes = Math.max(1, n - 1);
  const span = Math.min(46 * lanes, width - LABEL - PADR);
  const x0 = LABEL + Math.max(0, (width - LABEL - PADR - span) / 2);
  const X = (k) => x0 + (n === 1 ? span / 2 : (span * k) / lanes);
  const H = TOP + BOTTOM + Math.max(1, rows.length) * ROW;
  svg.setAttribute('viewBox', `0 0 ${width} ${H}`);
  svg.setAttribute('height', H);
  const under = el('g', {}, svg), halo = el('g', {}, svg), over = el('g', {}, svg), deco = el('g', {}, svg);
  const order = Array.from({ length: n }, (_, k) => k);
  const stroke = (pos) => ({ stroke: colors[order[pos] % colors.length], 'stroke-width': 3.4, fill: 'none', 'stroke-linecap': 'round' });

  // top pins
  for (let k = 0; k < n; k++) el('circle', { cx: X(k), cy: TOP - 7, r: 3.6, fill: colors[k % colors.length] }, deco);
  let y = TOP;
  if (!rows.length) {
    for (let k = 0; k < n; k++) el('line', { x1: X(k), y1: y, x2: X(k), y2: y + ROW, ...stroke(k) }, under);
    y += ROW;
  }
  rows.forEach((row, r) => {
    const g = row.g, j = Math.abs(g) - 1, y1 = y + ROW;
    const ghost = row.state === 'queued';
    const op = ghost ? 0.28 : 1;
    if (row.state === 'active') {
      el('rect', { x: 2, y: y + 1, width: width - 4, height: ROW - 2, rx: 6, fill: 'rgba(120,160,255,0.10)' }, under);
      el('rect', { x: 4, y: y1 - 4, width: Math.max(0, (width - 8) * (row.u ?? 0)), height: 2, rx: 1, fill: '#7fa8ff' }, under);
    } else if (row.state === 'done' && r === row.lastDone) {
      el('rect', { x: 2, y: y + 1, width: width - 4, height: ROW - 2, rx: 6, fill: 'rgba(255,255,255,0.04)' }, under);
    }
    const lab = el('text', { x: 6, y: y + ROW / 2 + 4, 'font-size': 12, fill: ghost ? '#56607a' : '#b9c3dd', 'font-family': 'JetBrains Mono, monospace' }, deco);
    lab.textContent = letter(g);
    for (let k = 0; k < n; k++) {
      if (k === j || k === j + 1) continue;
      el('line', { x1: X(k), y1: y, x2: X(k), y2: y1, ...stroke(k), opacity: op }, under);
    }
    const right = `M${X(j)},${y} C${X(j)},${y + ROW * 0.55} ${X(j + 1)},${y1 - ROW * 0.55} ${X(j + 1)},${y1}`;
    const left = `M${X(j + 1)},${y} C${X(j + 1)},${y + ROW * 0.55} ${X(j)},${y1 - ROW * 0.55} ${X(j)},${y1}`;
    // σ positive: the strand moving right (from position j) is in front
    const [pOver, sOver, pUnder, sUnder] = g > 0 ? [right, j, left, j + 1] : [left, j + 1, right, j];
    el('path', { d: pUnder, ...stroke(sUnder), opacity: op }, under);
    el('path', { d: pOver, stroke: bg, 'stroke-width': 9, fill: 'none', 'stroke-linecap': 'round', opacity: op }, halo);
    el('path', { d: pOver, ...stroke(sOver), opacity: op }, over);
    [order[j], order[j + 1]] = [order[j + 1], order[j]];
    y = y1;
  });
  // beads at the bottom in their final order
  for (let k = 0; k < n; k++) {
    el('line', { x1: X(k), y1: y, x2: X(k), y2: y + 6, ...stroke(k) }, under);
    el('circle', { cx: X(k), cy: y + 10, r: 5.2, fill: colors[order[k] % colors.length], stroke: '#0b0f18', 'stroke-width': 1.5 }, deco);
  }
}
