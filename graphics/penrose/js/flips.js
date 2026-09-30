/* ------------------------------------------------------------------ *
 *  Hexagon flips.
 *
 *  A rhombus is identified by its pentagrid crossing (pair, k, k′), which
 *  moves continuously with γ. When a third grid line sweeps across the
 *  crossing, the rhombus jumps by a unit vector; three such jumps around
 *  one hexagon are a flip — the three faces of a cube seen from the
 *  other corner. The hexagon is centrally symmetric, and the new three
 *  rhombi are the old three reflected through its center Z.
 *
 *  Flip styles:
 *    slide   — the hexagon's inner vertex glides from v to 2Z − v; the
 *              three quads deform continuously (a Necker-cube reversal).
 *    launch  — the old cube flies off along one of its axes and fades.
 *    instant — no transition.
 *  Independently, freshly flipped rhombi can glow for a moment.
 * ------------------------------------------------------------------ */

import { E, PAIRS } from './tiling.js';

export const flips = {
    active: [],
    glow: new Map(),   // tile key → time of last flip
    count: 0,          // total flips seen (for the readout)
    rate: 0,           // flips per second (smoothed)
};

const DUR = { slide: 0.46, launch: 0.55 };
const GLOW_T = 0.9;

export function cornersOf(ts, i, out, o = 0) {
    const { j, jp } = PAIRS[ts.pair[i]];
    const bx = ts.bx[i], by = ts.by[i];
    out[o] = bx; out[o + 1] = by;
    out[o + 2] = bx + E[j][0]; out[o + 3] = by + E[j][1];
    out[o + 4] = bx + E[j][0] + E[jp][0]; out[o + 5] = by + E[j][1] + E[jp][1];
    out[o + 6] = bx + E[jp][0]; out[o + 7] = by + E[jp][1];
    return out;
}

function cornerAt(c, x, y) {
    for (let q = 0; q < 4; q++) {
        if (Math.abs(c[2 * q] - x) < 1e-6 && Math.abs(c[2 * q + 1] - y) < 1e-6) return q;
    }
    return -1;
}

export function resetFlips() {
    flips.active.length = 0;
}

/**
 * Compare the previous tile set with the current one; start transitions
 * for every hexagon that flipped.
 */
export function detectFlips(prev, cur, now, style, glowOn) {
    const groups = new Map();
    const jumped = new Set();
    let jumps = 0;
    // Keys are sorted inside each pair block, so matching is a merge.
    for (let p = 0; p < 10; p++) {
        let o = prev.pstart[p];
        const oEnd = prev.pstart[p + 1];
        for (let i = cur.pstart[p], iEnd = cur.pstart[p + 1]; i < iEnd; i++) {
            const key = cur.key[i];
            while (o < oEnd && prev.key[o] < key) o++;
            if (o >= oEnd) break;
            if (prev.key[o] !== key) continue;
            const dx = cur.bx[i] - prev.bx[o], dy = cur.by[i] - prev.by[o];
            const d2 = dx * dx + dy * dy;
            if (d2 < 1e-10) continue;
            jumps++;
            jumped.add(cur.key[i]);
            if (glowOn) flips.glow.set(cur.key[i], now);
            if (Math.abs(d2 - 1) > 1e-6) continue;
            const { j, jp } = PAIRS[cur.pair[i]];
            const zx = prev.bx[o] + 0.5 * (E[j][0] + E[jp][0] + dx);
            const zy = prev.by[o] + 0.5 * (E[j][1] + E[jp][1] + dy);
            const gk = Math.round(zx * 1000) * 1e8 + Math.round(zy * 1000);
            let g = groups.get(gk);
            if (!g) { g = { zx, zy, items: [] }; groups.set(gk, g); }
            g.items.push([o, i]);
        }
    }
    flips.count += Math.round(jumps / 3);
    // a rhombus that moves again cancels any transition it was part of
    if (jumped.size) flips.active = flips.active.filter(f => !f.newKeys.some(k => jumped.has(k)));
    if (style === 'instant' || !groups.size) return;

    const dur = DUR[style] || 0.45;
    const oc = new Float64Array(8);
    for (const g of groups.values()) {
        if (g.items.length !== 3) continue;
        // inner vertex: the one corner the three old rhombi share
        const olds = g.items.map(([o]) => cornersOf(prev, o, new Float64Array(8)));
        let vA = null;
        for (let q = 0; q < 4 && !vA; q++) {
            const x = olds[0][2 * q], y = olds[0][2 * q + 1];
            if (cornerAt(olds[1], x, y) >= 0 && cornerAt(olds[2], x, y) >= 0) vA = [x, y];
        }
        if (!vA) continue;
        const vB = [2 * g.zx - vA[0], 2 * g.zy - vA[1]];
        const newKeys = g.items.map(([, i]) => cur.key[i]);

        const old = g.items.map(([o], q) => ({
            c: olds[q],
            q: cornerAt(olds[q], vA[0], vA[1]),
            fill: [prev.fill[3 * o], prev.fill[3 * o + 1], prev.fill[3 * o + 2]],
            line: [prev.line[3 * o], prev.line[3 * o + 1], prev.line[3 * o + 2]],
            pair: prev.pair[o], lvl: prev.lvl[o], key: prev.key[o],
        }));
        const newQ = g.items.map(([, i]) => cornerAt(cornersOf(cur, i, oc), vB[0], vB[1]));

        // launch direction: one of the cube's edge directions, fixed per hexagon
        const fams = new Set();
        for (const [o] of g.items) { fams.add(PAIRS[prev.pair[o]].j); fams.add(PAIRS[prev.pair[o]].jp); }
        const fl = [...fams];
        const h = Math.abs(Math.round(g.zx * 977 + g.zy * 331));
        const ax = E[fl[h % fl.length]];
        const sg = (h >> 3) & 1 ? 1 : -1;

        flips.active.push({
            t0: now, dur, style, Z: [g.zx, g.zy], vA, vB, old, newKeys, newQ,
            axis: [ax[0] * sg, ax[1] * sg],
        });
    }
}

export function pruneFlips(now) {
    flips.active = flips.active.filter(f => now - f.t0 < f.dur);
    for (const [k, t] of flips.glow) if (now - t > GLOW_T * 3) flips.glow.delete(k);
    return flips.active.length > 0 || flips.glow.size > 0;
}

export function glowOf(key, now) {
    const t = flips.glow.get(key);
    if (t === undefined) return 0;
    const a = (now - t) / GLOW_T;
    return a < 0 ? 0 : Math.exp(-a * a * 1.6) * Math.min(1, a * 8 + 0.4);
}

const ease = t => t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);

/**
 * Per-frame view of the active transitions:
 *   hidden  : Set of tile keys not to draw (yet)
 *   moved   : Map tile key → [cornerIndex, x, y]
 *   ghosts  : [{ c(8), fill, line, alpha, pair, lvl, key }]
 */
export function flipFrame(now) {
    const hidden = new Set(), moved = new Map(), ghosts = [];
    for (const f of flips.active) {
        const t = Math.min(1, (now - f.t0) / f.dur);
        if (f.style === 'slide') {
            const e = ease(t);
            const X0 = 0.42, X1 = 0.58;
            const fade = e <= X0 ? 1 : e >= X1 ? 0 : 1 - (e - X0) / (X1 - X0);
            if (e < X1) {
                const s = Math.min(1, e / 0.5);
                const vx = f.vA[0] + (f.Z[0] - f.vA[0]) * s, vy = f.vA[1] + (f.Z[1] - f.vA[1]) * s;
                for (const o of f.old) {
                    const c = Float64Array.from(o.c);
                    if (o.q >= 0) { c[2 * o.q] = vx; c[2 * o.q + 1] = vy; }
                    ghosts.push({ c, fill: o.fill, line: o.line, alpha: fade, pair: o.pair, lvl: o.lvl, key: o.key });
                }
            }
            if (e <= X0) {
                for (const k of f.newKeys) hidden.add(k);
            } else {
                const s = Math.max(0, (e - 0.5) / 0.5);
                const vx = f.Z[0] + (f.vB[0] - f.Z[0]) * s, vy = f.Z[1] + (f.vB[1] - f.Z[1]) * s;
                f.newKeys.forEach((k, q) => { if (f.newQ[q] >= 0) moved.set(k, [f.newQ[q], vx, vy]); });
            }
        } else if (f.style === 'launch') {
            const dist = 14 * (1 - (1 - t) * (1 - t));
            const alpha = t < 0.2 ? 1 : Math.max(0, 1 - (t - 0.2) / 0.8);
            const dx = f.axis[0] * dist, dy = f.axis[1] * dist;
            for (const o of f.old) {
                const c = Float64Array.from(o.c);
                for (let q = 0; q < 4; q++) { c[2 * q] += dx; c[2 * q + 1] += dy; }
                ghosts.push({ c, fill: o.fill, line: o.line, alpha, pair: o.pair, lvl: o.lvl, key: o.key, ghost: true });
            }
        }
    }
    return { hidden, moved, ghosts };
}
