/* ------------------------------------------------------------------ *
 *  Palettes (what the colors are) and schemes (what the colors mean).
 *
 *  Every palette supplies the same small vocabulary — a fat/thin pair,
 *  five hues for the five pentagrid directions, a ramp for continuous
 *  quantities, cube shades, arc colors — and every scheme draws only on
 *  that vocabulary, so any scheme × palette combination holds together.
 *  Gradients are interpolated in OKLab.
 * ------------------------------------------------------------------ */

import { N, E, Ei, PAIRS, basePerp, windowPolygon } from './tiling.js';

/* ---- Color math --------------------------------------------------- */
export function hex(h) {
    const v = parseInt(h.slice(1), 16);
    return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
}
const toLin = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const toSrgb = c => c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

export function oklab([r, g, b]) {
    r = toLin(r); g = toLin(g); b = toLin(b);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    ];
}
export function rgb([L, a, b]) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    const cl = x => Math.min(1, Math.max(0, toSrgb(x)));
    return [
        cl(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        cl(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        cl(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
    ];
}
export function mix(c1, c2, t) {
    const A = oklab(c1), B = oklab(c2);
    return rgb([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}
/** Shift OKLab lightness by dL and scale chroma by k. */
export function shade(c, dL, k = 1) {
    const [L, a, b] = oklab(c);
    return rgb([Math.min(1, Math.max(0, L + dL)), a * k, b * k]);
}
/** Shift lightness by dL and rotate OKLab hue by dh radians (chroma × k). */
export function tint(c, dL, dh, k = 1) {
    const [L, a, b] = oklab(c);
    const cs = Math.cos(dh) * k, sn = Math.sin(dh) * k;
    return rgb([Math.min(1, Math.max(0, L + dL)), a * cs - b * sn, a * sn + b * cs]);
}
export const css = c => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

function lut(stops, n, cyclic) {
    const labs = stops.map(s => oklab(hex(s)));
    const out = new Float32Array(n * 3);
    const segs = cyclic ? labs.length : labs.length - 1;
    for (let i = 0; i < n; i++) {
        const t = cyclic ? i / n : i / (n - 1);
        const x = t * segs, s = Math.min(segs - 1, Math.floor(x)), f = x - s;
        const A = labs[s], B = labs[(s + 1) % labs.length];
        const c = rgb([A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f]);
        out[3 * i] = c[0]; out[3 * i + 1] = c[1]; out[3 * i + 2] = c[2];
    }
    return out;
}
const LUTN = 256;
/* ---- Palettes ----------------------------------------------------- *
 *  fat/thin (+ optional hand-set lines), five (direction hues, in
 *  angular order), ramp (dark → light), cube (top/left/right), arcs
 *  (the two matching-arc colors), grout (gap color), glow.
 */
const PALETTE_DEFS = {
    gold: {
        name: 'Gold & ink',
        fat: '#d8a84a', fatLine: '#b8893a', thin: '#4a6572', thinLine: '#344b56',
        five: ['#dcae50', '#c7773f', '#9b5747', '#4a6572', '#7d9a84'],
        ramp: ['#121820', '#2c4250', '#4f6b74', '#9a8a5a', '#d8a84a', '#f3dfa8'],
        cube: ['#e8cd88', '#8c6c3e', '#3f4d57'],
        arcs: ['#f6e7bd', '#b5462c'],
        grout: '#16120c', glow: '#fff1c4', bg: '#0c0a07',
    },
    terracotta: {
        name: 'Terracotta',
        fat: '#c4643f', fatLine: '#9e4c2f', thin: '#efe2c4', thinLine: '#cdb994',
        five: ['#c4643f', '#e0a55e', '#a3a45e', '#3f6470', '#8f4f62'],
        ramp: ['#241a1e', '#5e2f2a', '#a8492f', '#d98a55', '#ecc98e', '#f8eedb'],
        cube: ['#f1e2c2', '#c4643f', '#5b3226'],
        arcs: ['#2f4f5c', '#f7ecd2'],
        grout: '#2a1a14', glow: '#fff4dc', bg: '#140d0a',
    },
    delft: {
        name: 'Delft',
        fat: '#f3f0e8', fatLine: '#9fb3d6', thin: '#2d5ca5', thinLine: '#1b3d75',
        five: ['#f3f0e8', '#a9c3e6', '#5d8bcc', '#2d5ca5', '#15336a'],
        ramp: ['#0c1d40', '#1b3d75', '#2d5ca5', '#6f98d2', '#c3d5ee', '#f8f6f0'],
        cube: ['#f6f3ec', '#6f98d2', '#1b3d75'],
        arcs: ['#15336a', '#e0a33c'],
        grout: '#0e1a33', glow: '#ffffff', bg: '#0a1224',
    },
    verdigris: {
        name: 'Verdigris',
        fat: '#63a596', fatLine: '#4a8475', thin: '#7a5431', thinLine: '#5c3e22',
        five: ['#8fcab7', '#56a08f', '#2f6a64', '#b08a4e', '#7a5431'],
        ramp: ['#0d2222', '#245553', '#4f9486', '#a8b98a', '#e1cf98', '#f6efd6'],
        cube: ['#a9dac9', '#56a08f', '#3a2716'],
        arcs: ['#f3e3b0', '#1f4a47'],
        grout: '#0f1a17', glow: '#e9fff6', bg: '#08110f',
    },
    nocturne: {
        name: 'Nocturne',
        fat: '#2a3374', fatLine: '#6c86e0', thin: '#141a3d', thinLine: '#5a58b8',
        five: ['#58c6e6', '#8a7cf0', '#df72c4', '#f1b35d', '#5fdca6'],
        ramp: ['#08081c', '#28165a', '#6b2a8a', '#c2457e', '#f28a5f', '#fbe3a2'],
        cube: ['#5d6fd6', '#2a3374', '#0f1330'],
        arcs: ['#7fe3ff', '#ff9ad5'],
        grout: '#05050f', glow: '#bff4ff', bg: '#05060f',
    },
    paper: {
        name: 'Paper',
        fat: '#f2eadb', fatLine: '#3b3226', thin: '#d8c9a9', thinLine: '#3b3226',
        five: ['#d9b067', '#c9795b', '#9a7aa6', '#6d95aa', '#8fb07f'],
        ramp: ['#3b3226', '#77654c', '#b09c79', '#d8c9a9', '#efe6d3', '#fbf7ee'],
        cube: ['#fbf6ea', '#d8c9a9', '#8f7b5c'],
        arcs: ['#b3452c', '#2f5f86'],
        grout: '#3b3226', glow: '#fff6d8', bg: '#e9e1cf', light: true,
    },
};

export const PALETTE_ORDER = Object.keys(PALETTE_DEFS);

function buildPalette(d) {
    const P = { name: d.name, light: !!d.light };
    P.fat = hex(d.fat); P.thin = hex(d.thin);
    P.fatLine = d.fatLine ? hex(d.fatLine) : shade(P.fat, -0.09);
    P.thinLine = d.thinLine ? hex(d.thinLine) : shade(P.thin, -0.09);
    P.five = d.five.map(hex);
    // Fat tiles take the direction hue lightly, thin tiles deeper.
    P.fiveFat = P.five.map(c => shade(c, 0.05, 0.95));
    P.fiveThin = P.five.map(c => shade(c, -0.12, 0.9));
    P.fam = P.five.map(c => oklab(c)[0] < 0.45 ? shade(c, 0.22, 1.1) : shade(c, 0.04, 1.15));
    P.cube = d.cube.map(hex);
    P.cubeLine = P.cube.map(c => shade(c, -0.12));
    P.arcs = d.arcs.map(hex);
    P.grout = hex(d.grout);
    P.glow = hex(d.glow);
    P.bg = hex(d.bg);
    P.rampL = lut(d.ramp, LUTN, false);
    P.cycleL = lut(d.five, LUTN, true);
    P.rampStops = d.ramp;
    P.fiveHex = d.five;
    return P;
}
export const PALETTES = {};
for (const k of PALETTE_ORDER) PALETTES[k] = buildPalette(PALETTE_DEFS[k]);

/* ---- Schemes ------------------------------------------------------ *
 * type · orient · ribbons · supertiles · stability · level · cubes
 */

/* Long-axis direction of each rhombus, as a fraction of a half turn:
 * fat tiles point along multiples of 36°, thin ones in between. */
const AXIS = PAIRS.map(({ j, jp, fat }) => {
    const x = fat ? E[j][0] + E[jp][0] : E[j][0] - E[jp][0];
    const y = fat ? E[j][1] + E[jp][1] : E[j][1] - E[jp][1];
    let a = Math.atan2(y, x) / Math.PI;
    a -= Math.floor(a);
    return a;
});
export const axisOf = p => AXIS[p];

const perp = [0, 0];

/**
 * Colors every tile of `ts` for the given scheme and palette.
 *   fill, line : Float32Array(3n) — rgb
 *   aux        : per-tile extras the renderer needs (dim flag etc.)
 * `cubes` (Map tile index → 0/1/2 face) is only consulted for 'cubes'.
 */
export function colorTiles(ts, schemeName, P, s, fill, line, cubes) {
    const n = ts.n;
    const put = (arr, i, c) => { arr[3 * i] = c[0]; arr[3 * i + 1] = c[1]; arr[3 * i + 2] = c[2]; };

    if (schemeName === 'type' || schemeName === 'ribbons' || schemeName === 'supertiles') {
        // Ribbons mode mutes the tiles so the woven lines carry the picture.
        const dim = schemeName === 'ribbons';
        const f0 = dim ? mutedOf(P, 'fat', 0.5) : P.fat, f1 = dim ? mutedOf(P, 'thin', 0.5) : P.thin;
        const l0 = dim ? mutedOf(P, 'fat', 0.72) : P.fatLine, l1 = dim ? mutedOf(P, 'thin', 0.72) : P.thinLine;
        for (let i = 0; i < n; i++) {
            const fat = PAIRS[ts.pair[i]].fat;
            put(fill, i, fat ? f0 : f1);
            put(line, i, fat ? l0 : l1);
        }
        return;
    }

    if (schemeName === 'orient') {
        // Like shot silk: each rhombus keeps its type color but catches the
        // light by direction — tone and hue both turn with the long axis.
        const O = orientColors(P);
        for (let i = 0; i < n; i++) {
            const p = ts.pair[i];
            put(fill, i, O.fill[p]);
            put(line, i, O.line[p]);
        }
        return;
    }

    if (schemeName === 'level') {
        // Base-vertex index ΣK − Σγ: in a classical tiling it is 1 or 2 and
        // decides which way the rhombus's matching-rule arrow points.
        const cols = levelColors(P);
        const lines = cols.map(c => shade(c, -0.09));
        for (let i = 0; i < n; i++) {
            const fat = PAIRS[ts.pair[i]].fat;
            const lv = Math.round(ts.lvl[i] - s);
            const q = (fat ? 0 : 2) + ((lv & 1) ? 0 : 1);
            put(fill, i, cols[q]);
            put(line, i, lines[q]);
        }
        return;
    }

    if (schemeName === 'cubes') {
        const mf = mutedOf(P, 'fat', 0.3), mt = mutedOf(P, 'thin', 0.3);
        const lf = mutedOf(P, 'fatLine', 0.3), lt = mutedOf(P, 'thinLine', 0.3);
        for (let i = 0; i < n; i++) {
            const face = cubes ? cubes[i] : -1;
            if (face >= 0) {
                put(fill, i, P.cube[face]);
                put(line, i, P.cubeLine[face]);
            } else {
                const fat = PAIRS[ts.pair[i]].fat;
                put(fill, i, fat ? mf : mt);
                put(line, i, fat ? lf : lt);
            }
        }
        return;
    }

    if (schemeName === 'stability') {
        // How far γ⊥ can move before this rhombus flips: the depth of its
        // four vertices inside their acceptance windows.
        const R = rampSet(P);
        const edges = new Map();
        const edgesFor = t => {
            let e = edges.get(t);
            if (e === undefined) { e = windowEdges(t - s); edges.set(t, e); }
            return e;
        };
        for (let i = 0; i < n; i++) {
            const { j, jp, fat } = PAIRS[ts.pair[i]];
            basePerp(ts, i, perp);
            let d = Infinity;
            for (let c = 0; c < 4 && d > 0; c++) {
                const a = c === 1 || c === 2 ? 1 : 0, b = c >= 2 ? 1 : 0;
                const W = edgesFor(ts.lvl[i] + a + b);
                if (!W) { d = 0; break; }
                const x = perp[0] + a * Ei[j][0] + b * Ei[jp][0];
                const y = perp[1] + a * Ei[j][1] + b * Ei[jp][1];
                for (let e = 0; e < W.length; e += 3) {
                    const v = W[e] * x + W[e + 1] * y + W[e + 2];
                    if (v < d) d = v;
                }
            }
            const t = Math.max(0, Math.min(1, Math.sqrt(Math.max(0, d) / 0.42)));
            const q = 3 * Math.round((0.04 + 0.92 * t) * (LUTN - 1));
            const F = fat ? R.fat : R.thin, L = fat ? R.fatLine : R.thinLine;
            fill[3 * i] = F[q]; fill[3 * i + 1] = F[q + 1]; fill[3 * i + 2] = F[q + 2];
            line[3 * i] = L[q]; line[3 * i + 1] = L[q + 1]; line[3 * i + 2] = L[q + 2];
        }
        return;
    }
}

/* Window edges as (nx, ny, c) with inward unit normals: depth = nx·x + ny·y + c. */
function windowEdges(level) {
    const W = windowPolygon(level);
    if (!W) return null;
    const out = new Float64Array(3 * W.length);
    W.forEach((p, a) => {
        const q = W[(a + 1) % W.length];
        const ex = q[0] - p[0], ey = q[1] - p[1], L = Math.hypot(ex, ey);
        const nx = -ey / L, ny = ex / L;
        out[3 * a] = nx; out[3 * a + 1] = ny; out[3 * a + 2] = -(nx * p[0] + ny * p[1]);
    });
    return out;
}

/* The ramp, pre-shaded for fat/thin fills and lines. */
const rampMemo = new Map();
function rampSet(P) {
    let v = rampMemo.get(P.name);
    if (!v) {
        const mk = (dL, k) => {
            const out = new Float32Array(LUTN * 3);
            for (let i = 0; i < LUTN; i++) {
                const c = shade([P.rampL[3 * i], P.rampL[3 * i + 1], P.rampL[3 * i + 2]], dL, k);
                out.set(c, 3 * i);
            }
            return out;
        };
        v = { fat: mk(0, 1), thin: mk(-0.07, 0.9), fatLine: mk(-0.08, 1), thinLine: mk(-0.15, 0.9) };
        rampMemo.set(P.name, v);
    }
    return v;
}

const mutedMemo = new Map();
export function mutedOf(P, which, amt = 0.55) {
    const key = P.name + which + amt;
    let v = mutedMemo.get(key);
    if (!v) {
        v = mix(P[which], P.light ? [1, 1, 1] : P.bg, amt);
        v = shade(v, 0, 0.6);
        mutedMemo.set(key, v);
    }
    return v;
}
const orientMemo = new Map();
export function orientColors(P) {
    let v = orientMemo.get(P.name);
    if (!v) {
        v = { fill: [], line: [] };
        PAIRS.forEach((pp, p) => {
            const th = 2 * Math.PI * AXIS[p] + 0.6;
            const base = pp.fat ? P.fat : P.thin;
            const amp = P.light ? 0.07 : 0.1;
            const c = tint(base, amp * Math.cos(th) + (pp.fat ? 0.01 : 0), 0.24 * Math.sin(th), 1.04);
            v.fill.push(c);
            v.line.push(shade(c, -0.09));
        });
        orientMemo.set(P.name, v);
    }
    return v;
}
const levelMemo = new Map();
export function levelColors(P) {
    let v = levelMemo.get(P.name);
    if (!v) {
        const lift = P.light ? -0.1 : 0.1;
        v = [P.fat, shade(mix(P.fat, P.arcs[1], 0.35), lift * 0.4, 1.05),
             P.thin, shade(mix(P.thin, P.arcs[0], 0.3), lift, 1.0)];
        levelMemo.set(P.name, v);
    }
    return v;
}

/* ---- Cube clusters ------------------------------------------------ *
 * Three rhombi meeting at a vertex with angles summing to 360° form a
 * hexagon that reads as a cube. Returns Int8Array face per tile (0 top,
 * 1 left, 2 right, −1 none) using on-screen orientation.
 */
export function findCubes(ts, viewAngle) {
    const n = ts.n;
    const slotOf = new Map();
    const cnt = new Uint8Array(4 * n), sum = new Uint16Array(4 * n);
    const who = new Int32Array(12 * n), crn = new Uint8Array(12 * n);
    let slots = 0;
    const K = ts.K, kk = new Int32Array(N);
    for (let i = 0; i < n; i++) {
        const { j, jp, fat } = PAIRS[ts.pair[i]];
        const o = i * N;
        for (let c = 0; c < 4; c++) {
            const a = c === 1 || c === 2 ? 1 : 0, b = c >= 2 ? 1 : 0;
            for (let m = 0; m < N; m++) kk[m] = K[o + m];
            kk[j] += a; kk[jp] += b;
            const k0 = kk[0] - 2048;
            const key = (((kk[1] - k0) * 4096 + kk[2] - k0) * 4096 + kk[3] - k0) * 4096 + kk[4] - k0;
            let sl = slotOf.get(key);
            if (sl === undefined) { sl = slots++; slotOf.set(key, sl); }
            // interior angle: base/top carry the angle between e_j and e_j′
            sum[sl] += (c === 0 || c === 2) ? (fat ? 72 : 144) : (fat ? 108 : 36);
            if (cnt[sl] < 3) { who[3 * sl + cnt[sl]] = i; crn[3 * sl + cnt[sl]] = c; }
            cnt[sl]++;
        }
    }
    const faces = new Int8Array(n).fill(-1);
    const cs = Math.cos(viewAngle), sn = Math.sin(viewAngle);
    const items = [{}, {}, {}];
    for (let sl = 0; sl < slots; sl++) {
        if (cnt[sl] !== 3 || sum[sl] !== 360) continue;
        let taken = false;
        for (let q = 0; q < 3; q++) {
            const i = who[3 * sl + q], c = crn[3 * sl + q];
            if (faces[i] >= 0) taken = true;
            const { j, jp } = PAIRS[ts.pair[i]];
            const a = c === 1 || c === 2 ? 1 : 0, b = c >= 2 ? 1 : 0;
            // centroid offset from the shared vertex, in screen orientation
            const dx = (0.5 - a) * E[j][0] + (0.5 - b) * E[jp][0];
            const dy = (0.5 - a) * E[j][1] + (0.5 - b) * E[jp][1];
            items[q].i = i; items[q].x = cs * dx - sn * dy; items[q].y = sn * dx + cs * dy;
        }
        if (taken) continue;
        const sorted = items.slice().sort((u, v) => v.y - u.y);
        const [l, r] = sorted[1].x < sorted[2].x ? [sorted[1], sorted[2]] : [sorted[2], sorted[1]];
        faces[sorted[0].i] = 0;
        faces[l.i] = 1;
        faces[r.i] = 2;
    }
    return faces;
}
