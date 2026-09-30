/* ------------------------------------------------------------------ *
 *  Phason fields: a slowly varying internal shift u(x) added to γ, so
 *  different parts of the plane sit at different points of the hull.
 *  Where u changes in time, hexagons flip; the tiling stays a valid
 *  rhombus tiling as long as |∇u| stays small (≲ 0.2).
 *
 *  Coordinates are pentagrid coordinates x (a tile at world point p has
 *  x ≈ (p − Σ γ_i e_i) / 2.5); u is in the units of γ.
 * ------------------------------------------------------------------ */

import { N, E } from './tiling.js';

export const field = {
    kind: null,           // null | 'wave' | 'ripples'
    stamp: 0,             // bumps whenever the field changes
    // traveling wave
    A: 0.18, q: 0.55, phase: 0, nAng: 0.35, dAng: 1.1,
    // ripples
    drops: [],
    t: 0,
    width: 2.1,
    speed: 2.6,
};

/** Grid coordinates of a world point for the current γ. */
export function worldToGrid(gamma, wx, wy) {
    let ox = 0, oy = 0;
    for (let i = 0; i < N; i++) { ox += gamma[i] * E[i][0]; oy += gamma[i] * E[i][1]; }
    return [(wx - ox) / 2.5, (wy - oy) / 2.5];
}

let nx = 1, ny = 0, dx = 1, dy = 0;
function wave(x, y, o) {
    const ph = field.q * (x * nx + y * ny) - field.phase;
    const s = Math.sin(ph), c = Math.cos(ph) * field.A * field.q;
    o[0] = field.A * s * dx; o[1] = field.A * s * dy;
    o[2] = c * dx * nx; o[3] = c * dx * ny;
    o[4] = c * dy * nx; o[5] = c * dy * ny;
}

function ripples(x, y, o) {
    o[0] = o[1] = o[2] = o[3] = o[4] = o[5] = 0;
    const w2 = field.width * field.width;
    for (const d of field.drops) {
        const rx = x - d.x, ry = y - d.y;
        const r = Math.hypot(rx, ry);
        const rho = r - d.R;
        if (rho * rho > 9 * w2) continue;
        const G = Math.exp(-rho * rho / w2) * d.a;
        o[0] += G * d.dx; o[1] += G * d.dy;
        if (r > 1e-6) {
            const g = -2 * rho / w2 * G / r;       // dG/dr · (1/r)
            o[2] += g * rx * d.dx; o[3] += g * ry * d.dx;
            o[4] += g * rx * d.dy; o[5] += g * ry * d.dy;
        }
    }
    // Where rings overlap, scale the field back so |∇u| stays in the safe range.
    const J = Math.hypot(o[2], o[3], o[4], o[5]);
    if (J > JMAX) {
        const k = JMAX / J;
        for (let q = 0; q < 6; q++) o[q] *= k;
    }
}
const JMAX = 0.18;

/** The active field function and a bound on |u|, or null. */
export function activeField() {
    if (field.kind === 'wave') {
        nx = Math.cos(field.nAng); ny = Math.sin(field.nAng);
        dx = Math.cos(field.dAng); dy = Math.sin(field.dAng);
        return { fn: wave, amp: field.A };
    }
    if (field.kind === 'ripples' && field.drops.length) {
        let a = 0;
        for (const d of field.drops) a = Math.max(a, d.a);
        return { fn: ripples, amp: Math.min(0.6, a * 1.5) };
    }
    return null;
}

/** Drop a ripple at grid point (x, y). */
export function dropRipple(x, y, amp) {
    const th = Math.random() * 2 * Math.PI;
    // a fresh drop right on top of a young one replaces it (keeps rings from piling up)
    field.drops = field.drops.filter(d => field.t - d.t0 > 1.2 || Math.hypot(d.x - x, d.y - y) > 3);
    field.drops.push({ x, y, t0: field.t, R: 0, a: 0, A: amp, dx: Math.cos(th), dy: Math.sin(th) });
    if (field.drops.length > 5) field.drops.shift();
}

/** Advance ripples; returns whether any are alive. */
export function stepRipples(dt, speed, maxR) {
    field.t += dt;
    for (const d of field.drops) {
        const age = field.t - d.t0;
        d.R = field.speed * speed * age;
        const env = Math.min(1, age / 0.35) * Math.exp(-age * speed / 9) / Math.sqrt(1 + d.R / 12);
        d.a = d.A * env;
    }
    field.drops = field.drops.filter(d => d.R < maxR + 4 * field.width && d.a > 0.004);
    return field.drops.length > 0;
}
