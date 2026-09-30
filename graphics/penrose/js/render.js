/* ------------------------------------------------------------------ *
 *  The frame: advance motion → regenerate the tiling if anything
 *  changed → detect flips → color → build instances → draw.
 * ------------------------------------------------------------------ */

import { N, E, PHI, state, view, schedule, setFrameFn, onTrackingReset, sigma } from './state.js';
import { TileSet, generateTiles, PAIRS } from './tiling.js';
import { PALETTES, colorTiles, findCubes, shade } from './colors.js';
import { GLRenderer, CanvasRenderer, FLOATS } from './gl.js';
import { activeField, field } from './field.js';
import { flips, detectFlips, pruneFlips, flipFrame, glowOf, resetFlips } from './flips.js';
import { stepMotion, currentMode, deflateFrac, fineGamma, coarseGamma } from './motion.js';
import { updateHUD } from './ui.js';
import { drawInset } from './inset.js';
import { pointer } from './interaction.js';

let canvas, stage, R;
let cur = new TileSet(), prev = new TileSet();
const fine = new TileSet();
let havePrev = false;
let genSig = '', colorSig = '', fineSig = '', fineColorSig = '', coarseSig = '';
let inst = new Float32Array(8192 * FLOATS);
let inst2 = new Float32Array(8192 * FLOATS);
let insetT = 0;

export function initRender() {
    canvas = document.getElementById('tiling');
    stage = document.getElementById('stage');
    R = new GLRenderer(canvas);
    if (!R.ok) {
        // A failed WebGL canvas cannot fall back to 2D; swap in a fresh one.
        const c2 = canvas.cloneNode(false);
        canvas.replaceWith(c2);
        canvas = c2;
        R = new CanvasRenderer(canvas);
    }
    new ResizeObserver(resize).observe(stage);
    window.addEventListener('resize', resize);
    resize();
    onTrackingReset(() => { havePrev = false; resetFlips(); });
    setFrameFn(frame);
}

export function getCanvas() { return canvas; }

function resize() {
    view.DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    view.W = stage.clientWidth;
    view.H = stage.clientHeight;
    canvas.width = Math.max(1, Math.round(view.W * view.DPR));
    canvas.height = Math.max(1, Math.round(view.H * view.DPR));
    canvas.style.width = view.W + 'px';
    canvas.style.height = view.H + 'px';
    R.resize(canvas.width, canvas.height);
    schedule();
}

function ensureColors(ts) {
    if (!ts.fill || ts.fill.length < ts.n * 3) {
        const cap = Math.max(ts.cap, ts.n) * 3;
        ts.fill = new Float32Array(cap);
        ts.line = new Float32Array(cap);
    }
}

function ensureInst(arr, n) {
    if (arr.length >= n * FLOATS) return arr;
    return new Float32Array(Math.ceil(n * 1.5) * FLOATS);
}

/* ---- hit testing ------------------------------------------------- */
function tileAt(ts, wx, wy) {
    for (let i = 0; i < ts.n; i++) {
        const { j, jp, det } = PAIRS[ts.pair[i]];
        const dx = wx - ts.bx[i], dy = wy - ts.by[i];
        const a = (dx * E[jp][1] - dy * E[jp][0]) / det;
        if (a < 0 || a > 1) continue;
        const b = (E[j][0] * dy - E[j][1] * dx) / det;
        if (b >= 0 && b <= 1) return i;
    }
    return -1;
}

/** Click: pin (or unpin) the two ribbons through the rhombus under the pointer. */
export function pick(wx, wy) {
    const i = tileAt(cur, wx, wy);
    if (i < 0) { state.pinned = null; return; }
    const { j, jp } = PAIRS[cur.pair[i]];
    const kA = cur.K[i * N + j], kB = cur.K[i * N + jp];
    const p = state.pinned;
    if (p && p.fa === j && p.ka === kA && p.fb === jp && p.kb === kB) state.pinned = null;
    else state.pinned = { fa: j, ka: kA, fb: jp, kb: kB };
}

/* ---- uniforms ---------------------------------------------------- */
const STYLE = { flat: 0, grout: 1, bevel: 2, line: 3 };
function frameUniforms(P, scale, hasHL) {
    const dpr = view.DPR;
    const st = state.style;
    const lwCss = st === 'grout' ? Math.min(6, Math.max(1, scale * 0.055))
        : st === 'line' ? Math.min(3, Math.max(1, scale * 0.045))
            : Math.min(1, scale * 0.025);
    const ribbonsOn = state.ribbons || state.scheme === 'ribbons';
    const mwCss = state.scheme === 'ribbons' ? Math.min(6, Math.max(1.4, scale * 0.1)) : Math.min(3.5, Math.max(1, scale * 0.05));
    const awCss = Math.min(4.5, Math.max(0.9, scale * 0.055));
    const fam = new Float32Array(15);
    P.fam.forEach((c, q) => fam.set(c, 3 * q));
    return {
        ppw: state.scale * dpr,
        angle: state.angle,
        style: STYLE[st] ?? 0,
        lw: lwCss * dpr / 2,
        fam,
        ribbons: ribbonsOn,
        mw: mwCss * dpr / 2,
        arcs: state.arcs,
        aw: awCss * dpr / 2,
        arcR: [0.618034, 0.381966, 0.236068],
        arc0: P.arcs[0], arc1: P.arcs[1],
        glow: P.glow, grout: P.grout, bg: P.bg,
        hl: P.light ? [0.1, 0.08, 0.05] : [1, 0.97, 0.88],
        hasHL,
        light: P.light ? 0.7 : 1,
    };
}

/* ---- instance writing -------------------------------------------- */
function put(buf, n, c, cx, cy, fr, fg, fb, fa, lr, lg, lb, la, glow, famAB, bits, lw) {
    const o = n * FLOATS;
    buf[o] = c[0] - cx; buf[o + 1] = c[1] - cy;
    buf[o + 2] = c[2] - cx; buf[o + 3] = c[3] - cy;
    buf[o + 4] = c[4] - cx; buf[o + 5] = c[5] - cy;
    buf[o + 6] = c[6] - cx; buf[o + 7] = c[7] - cy;
    buf[o + 8] = fr; buf[o + 9] = fg; buf[o + 10] = fb; buf[o + 11] = fa;
    buf[o + 12] = lr; buf[o + 13] = lg; buf[o + 14] = lb; buf[o + 15] = la;
    buf[o + 16] = glow; buf[o + 17] = famAB; buf[o + 18] = bits; buf[o + 19] = lw;
}

/* Per-pair constants: edge vectors, shape, ribbon families. */
const PC = PAIRS.map(({ j, jp, fat }) => ({
    ex: E[j][0], ey: E[j][1], fx: E[jp][0], fy: E[jp][1], fat, j, jp, fam: j + 8 * jp,
}));
const corners = new Float64Array(8);

/**
 * Write tiles of `ts` into `buf`. `xf` scales world → display world
 * (the deflated tiling is shown as −v/φ); `ff` carries flip overrides.
 */
function writeTiles(ts, buf, s, now, { xf = 1, ff = null, lit = null, hoverIdx = -1, lw = 1 }) {
    const cx = state.cx, cy = state.cy;
    const nT = ts.n;
    // Resolve the (small) override sets to tile indices once, not per tile.
    let hide = null, move = null, glow = null;
    if (ff && (ff.hidden.size || ff.moved.size)) {
        hide = new Uint8Array(nT);
        for (const k of ff.hidden) { const i = ts.find(k); if (i >= 0) hide[i] = 1; }
        move = new Map();
        for (const [k, v] of ff.moved) { const i = ts.find(k); if (i >= 0) { move.set(i, v); hide[i] |= 2; } }
    }
    if (ff && state.glow && flips.glow.size) {
        glow = new Float32Array(nT);
        for (const k of flips.glow.keys()) { const i = ts.find(k); if (i >= 0) glow[i] = glowOf(k, now); }
    }
    const f = ts.fill, l = ts.line, K = ts.K;
    let n = 0;
    for (let i = 0; i < nT; i++) {
        const h = hide ? hide[i] : 0;
        if (h & 1) continue;
        const P = PC[ts.pair[i]];
        const bx = ts.bx[i], by = ts.by[i];
        corners[0] = bx; corners[1] = by;
        corners[2] = bx + P.ex; corners[3] = by + P.ey;
        corners[4] = bx + P.ex + P.fx; corners[5] = by + P.ey + P.fy;
        corners[6] = bx + P.fx; corners[7] = by + P.fy;
        if (h & 2) {
            const mv = move.get(i);
            corners[2 * mv[0]] = mv[1]; corners[2 * mv[0] + 1] = mv[2];
        }
        if (xf !== 1) for (let q = 0; q < 8; q++) corners[q] *= xf;
        let bits = P.fat ? 1 : 0;
        if (Math.round(ts.lvl[i] - s) & 1) bits |= 2;
        if (lit) {
            const o = i * N, kj = K[o + P.j], kp = K[o + P.jp];
            if ((lit.fa === P.j && kj === lit.ka) || (lit.fb === P.j && kj === lit.kb)) bits |= 4;
            if ((lit.fa === P.jp && kp === lit.ka) || (lit.fb === P.jp && kp === lit.kb)) bits |= 8;
        }
        if (i === hoverIdx) bits |= 16;
        put(buf, n++, corners, cx, cy,
            f[3 * i], f[3 * i + 1], f[3 * i + 2], 1,
            l[3 * i], l[3 * i + 1], l[3 * i + 2], 1,
            glow ? glow[i] : 0, P.fam, bits, lw);
    }
    return n;
}

function writeGhosts(ghosts, buf, n, s) {
    const cx = state.cx, cy = state.cy;
    for (const gh of ghosts) {
        const { j, jp, fat } = PAIRS[gh.pair];
        let bits = fat ? 1 : 0;
        if (Math.round(gh.lvl - s) & 1) bits |= 2;
        if (gh.ghost) bits |= 32;
        put(buf, n++, gh.c, cx, cy,
            gh.fill[0], gh.fill[1], gh.fill[2], gh.alpha,
            gh.line[0], gh.line[1], gh.line[2], gh.alpha,
            0, j + 8 * jp, bits, 1);
    }
    return n;
}

/* ---- the frame --------------------------------------------------- */
function frame(dt, nowMs) {
    const now = nowMs / 1000;
    const moving = stepMotion(dt);
    const P = PALETTES[state.palette] || PALETTES.gold;
    const s = sigma();
    const radius = Math.hypot(view.W, view.H) / (2 * state.scale) + 0.5;
    const F = activeField();
    // 1. tiles
    const sig = state.gamma.join(',') + '|' + state.cx + ',' + state.cy + '|' + radius.toFixed(4) + '|' + state.angle +
        '|' + (F ? field.stamp : '-');
    if (sig !== genSig) {
        genSig = sig;
        const t = prev; prev = cur; cur = t;
        generateTiles(cur, {
            gamma: state.gamma, cx: state.cx, cy: state.cy, radius,
            rect: [view.W / (2 * state.scale), view.H / (2 * state.scale), state.angle],
            field: F ? F.fn : null, fieldAmp: F ? F.amp : 0,
        });
        if (havePrev) detectFlips(prev, cur, now, state.flip, state.glow);
        havePrev = true;
        colorSig = '';
    }

    // 2. colors
    const cSig = state.scheme + '|' + state.palette + '|' + s.toFixed(6) + '|' + (state.scheme === 'cubes' ? state.angle.toFixed(3) : '');
    if (cSig !== colorSig) {
        ensureColors(cur);
        const cubes = state.scheme === 'cubes' ? findCubes(cur, state.angle) : null;
        colorTiles(cur, state.scheme, P, s, cur.fill, cur.line, cubes);
        colorSig = cSig;
    }
    // 3. hover & lit ribbons
    const hoverIdx = pointer.world ? tileAt(cur, pointer.world[0], pointer.world[1]) : -1;
    let lit = state.pinned;
    if (!lit && hoverIdx >= 0) {
        const { j, jp } = PAIRS[cur.pair[hoverIdx]];
        lit = { fa: j, ka: cur.K[hoverIdx * N + j], fb: jp, kb: cur.K[hoverIdx * N + jp] };
    }

    // 4. flips
    const flipsLive = pruneFlips(now);
    const ff = flipsLive ? flipFrame(now) : { hidden: new Set(), moved: new Map(), ghosts: [] };
    // 5. instances
    inst = ensureInst(inst, cur.n + ff.ghosts.length);
    let n = writeTiles(cur, inst, s, now, { ff, lit, hoverIdx });
    n = writeGhosts(ff.ghosts, inst, n, s);
    R.clear();
    const U = frameUniforms(P, state.scale, !!lit);
    R.setFrame(U);

    const df = currentMode() === 'deflate' ? deflateFrac() : 0;
    if (df > 0.2) {
        // the finer tiling, displayed as −v/φ in our coordinates
        const fg = fineGamma(state.gamma);
        const fsig = fg.join(',') + '|' + state.cx + ',' + state.cy + '|' + radius.toFixed(4);
        if (fsig !== fineSig) {
            fineSig = fsig;
            generateTiles(fine, { gamma: fg, cx: -PHI * state.cx, cy: -PHI * state.cy, radius: PHI * radius });
            fineColorSig = '';
            coarseSig = '';
        }
        const fs = fg.reduce((a, b) => a + b, 0);
        const fcSig = cSig + '|' + fsig;
        if (fcSig !== fineColorSig) {
            ensureColors(fine);
            const cubes = state.scheme === 'cubes' ? findCubes(fine, state.angle + Math.PI) : null;
            colorTiles(fine, state.scheme, P, fs, fine.fill, fine.line, cubes);
            fineColorSig = fcSig;
        }
        inst2 = ensureInst(inst2, fine.n);
        const n2 = writeTiles(fine, inst2, fs, now, { xf: -1 / PHI, lit: null, hoverIdx: -1 });
        const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
        R.draw(inst, n, 1, 0);
        const UF = frameUniforms(P, state.scale / PHI, false);
        UF.arcR = UF.arcR.map(r => r / PHI);
        R.setFrame(UF);
        R.draw(inst2, n2, sm(0.5, 0.95, df), sm(0.25, 0.7, df));
        R.setFrame(U);
        // coarse outlines: the supertiles, fading as the split completes
        for (let q = 0; q < n; q++) inst[q * FLOATS + 19] = 1 + 0.9 * df;
        R.draw(inst, n, 0, 1 - sm(0.8, 1.0, df));
    } else if (state.scheme === 'supertiles' && Math.abs(s - Math.round(s)) < 1e-6) {
        // the supertiling, displayed as −φ·v: big rhombi underneath, our
        // rhombi as a light tint and fine lines, supertile edges on top
        const cg = coarseGamma(state.gamma);
        const csig = cg.join(',') + '|' + state.cx + ',' + state.cy + '|' + radius.toFixed(4) + '|' + state.palette;
        if (csig !== coarseSig) {
            coarseSig = csig;
            generateTiles(fine, { gamma: cg, cx: -state.cx / PHI, cy: -state.cy / PHI, radius: radius / PHI + 1 });
            ensureColors(fine);
            colorTiles(fine, 'type', P, cg.reduce((a, b) => a + b, 0), fine.fill, fine.line, null);
            const ink = P.light ? P.fatLine : null;
            for (let i = 0; i < fine.n; i++) {
                const c = ink || shade([fine.fill[3 * i], fine.fill[3 * i + 1], fine.fill[3 * i + 2]], -0.3, 0.9);
                fine.line.set(c, 3 * i);
            }
            fineSig = '';
        }
        inst2 = ensureInst(inst2, fine.n);
        const n2 = writeTiles(fine, inst2, cg.reduce((a, b) => a + b, 0), now, { xf: -PHI, lit: null, hoverIdx: -1, lw: 2.4 });
        const UC = frameUniforms(P, state.scale * PHI, false);
        UC.lw = U.lw;
        UC.arcs = false; UC.ribbons = false;
        R.setFrame(UC);
        R.draw(inst2, n2, 1, 0);
        R.setFrame(U);
        R.draw(inst, n, 0.3, 1);
        R.setFrame(UC);
        R.draw(inst2, n2, 0, 1);
    } else {
        R.draw(inst, n, 1, 1);
    }
    // 6. HUD
    let hover = null;
    if (hoverIdx >= 0) {
        const o = hoverIdx * N;
        hover = { pair: cur.pair[hoverIdx], K: Array.from(cur.K.subarray(o, o + N)), level: Math.round(cur.lvl[hoverIdx] - s) };
    }
    updateHUD({ count: cur.n, hover });
    if (now - insetT > 1 / 30 || !moving) {
        insetT = now;
        drawInset(cur, s, hoverIdx);
    }
    return moving || flipsLive;
}
