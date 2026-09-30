/* ------------------------------------------------------------------ *
 *  The hidden side of cut & project: acceptance windows.
 *
 *  A lattice point K ∈ ℤ⁵ is a vertex of the tiling exactly when its
 *  internal image Σ (K_i − γ_i) e′_i lands in the window for its index
 *  ΣK − Σγ: a pentagon for integer levels, a decagon otherwise. Every
 *  visible vertex is plotted as a dot, so the windows fill up uniformly.
 *  Dragging the dots is a phason shift: the dots slide, those pushed
 *  over an edge leave the tiling, and new vertices enter on the far side.
 * ------------------------------------------------------------------ */

import { N, Ei, state } from './state.js';
import { windowPolygon, PAIRS, basePerp } from './tiling.js';

let cv, ctx, W = 0, H = 0, DPR = 1;
let cells = [];
let unit = 20;
let dragging = null;
let onShift = null;
const perp = [0, 0];
const MAX_TILES = 3000;

export function initInset(shiftFn) {
    cv = document.getElementById('inset');
    if (!cv) return;
    ctx = cv.getContext('2d');
    onShift = shiftFn;
    const ro = new ResizeObserver(size);
    ro.observe(cv);
    size();

    cv.addEventListener('pointerdown', e => {
        dragging = { x: e.clientX, y: e.clientY };
        cv.setPointerCapture(e.pointerId);
        cv.classList.add('dragging');
    });
    cv.addEventListener('pointermove', e => {
        if (!dragging) return;
        const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y;
        dragging = { x: e.clientX, y: e.clientY };
        if (onShift) onShift(dx / unit, -dy / unit);
    });
    const end = e => {
        dragging = null;
        cv.classList.remove('dragging');
        try { cv.releasePointerCapture(e.pointerId); } catch { }
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
}

function size() {
    DPR = window.devicePixelRatio || 1;
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
}

/** Levels ℓ = t − s with non-degenerate windows. */
function levels(s) {
    const out = [];
    for (let t = Math.floor(s) - 1; t <= Math.ceil(s) + 6; t++) {
        const l = t - s;
        const poly = windowPolygon(l);
        if (poly) out.push({ t, l, poly });
    }
    return out;
}

export function drawInset(ts, s, hoverIdx) {
    if (!ctx || !W) return;
    const L = levels(s);
    const labelH = 16;
    const cw = W / L.length;
    unit = Math.min(cw * 0.5 / 1.72, (H - labelH) * 0.5 / 1.72);
    cells = L.map((c, q) => ({ ...c, x: cw * (q + 0.5), y: (H - labelH) / 2 + 2 }));

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // windows
    for (const c of cells) {
        ctx.beginPath();
        c.poly.forEach(([x, y], k) => {
            const px = c.x + x * unit, py = c.y - y * unit;
            k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        });
        ctx.closePath();
        ctx.fillStyle = 'rgba(235,223,198,0.035)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(235,223,198,0.28)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = 'rgba(154,142,116,0.9)';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        const lab = Math.abs(c.l - Math.round(c.l)) < 1e-6 ? String(Math.round(c.l)) : c.l.toFixed(2);
        ctx.fillText(lab, c.x, H - 4);
    }
    if (!ts || !ts.n) return;

    // dots: all four corners of (up to MAX_TILES) tiles
    const byT = new Map(cells.map(c => [c.t, c]));
    const n = Math.min(ts.n, MAX_TILES);
    ctx.fillStyle = 'rgba(216,168,74,0.55)';
    const r = W > 260 ? 1.3 : 1.1;
    for (let i = 0; i < n; i++) {
        const { j, jp } = PAIRS[ts.pair[i]];
        basePerp(ts, i, perp);
        const t0 = ts.lvl[i];
        for (let q = 0; q < 4; q++) {
            const a = q === 1 || q === 2 ? 1 : 0, b = q >= 2 ? 1 : 0;
            const c = byT.get(t0 + a + b);
            if (!c) continue;
            const x = perp[0] + a * Ei[j][0] + b * Ei[jp][0];
            const y = perp[1] + a * Ei[j][1] + b * Ei[jp][1];
            ctx.fillRect(c.x + x * unit - r / 2, c.y - y * unit - r / 2, r, r);
        }
    }

    // the hovered rhombus: its four vertices
    if (hoverIdx >= 0 && hoverIdx < ts.n) {
        const i = hoverIdx;
        const { j, jp } = PAIRS[ts.pair[i]];
        basePerp(ts, i, perp);
        ctx.strokeStyle = '#fff4d6';
        ctx.lineWidth = 1.4;
        for (let q = 0; q < 4; q++) {
            const a = q === 1 || q === 2 ? 1 : 0, b = q >= 2 ? 1 : 0;
            const c = byT.get(ts.lvl[i] + a + b);
            if (!c) continue;
            const x = perp[0] + a * Ei[j][0] + b * Ei[jp][0];
            const y = perp[1] + a * Ei[j][1] + b * Ei[jp][1];
            ctx.beginPath();
            ctx.arc(c.x + x * unit, c.y - y * unit, 3.2, 0, 2 * Math.PI);
            ctx.stroke();
        }
    }
}

/** δγ that slides every internal point by (dx, dy). */
export function phasonShift(dx, dy) {
    for (let i = 0; i < N; i++) state.gamma[i] -= 0.4 * (dx * Ei[i][0] + dy * Ei[i][1]);
}
