/* Palettes and color math, shared vocabulary with the Penrose tiling (graphics/penrose/js/colors.js). */


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
