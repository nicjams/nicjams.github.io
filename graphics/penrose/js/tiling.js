/* ------------------------------------------------------------------ *
 *  Penrose tiling via de Bruijn's pentagrid (pure — no DOM).
 *
 *  Five families of parallel lines in the grid plane:
 *     L_{j,k} :  f_j(x) = x · e_j + γ_j + φ_j(x) = k,    k ∈ ℤ
 *  where e_j = (cos 2πj/5, sin 2πj/5) and φ_j(x) = u(x) · e′_j is an
 *  optional phason field (u lives in the internal plane, e′_j is the
 *  internal star). Each crossing of L_{j,k} and L_{j′,k′} is one rhombus;
 *  its lift K ∈ ℤ⁵ has K_i = ⌈f_i⌉, and the rhombus sits at Σ K_i e_i.
 *
 *  Since Σ_i (x·e_i) e_i = (5/2) x, a grid point x lands near
 *  (5/2) x + Σ γ_i e_i in the tiling (within the golden ratio), so we only
 *  enumerate the grid disc that maps onto the viewport.
 * ------------------------------------------------------------------ */

export const N = 5;
export const TAU = 2 * Math.PI;
export const PHI = (1 + Math.sqrt(5)) / 2;

export const E = [];   // physical star  π(e_k)
export const Ei = [];  // internal star  π⊥(e_k)
for (let k = 0; k < N; k++) {
    E.push([Math.cos(TAU * k / N), Math.sin(TAU * k / N)]);
    Ei.push([Math.cos(2 * TAU * k / N), Math.sin(2 * TAU * k / N)]);
}

/* The ten rhombus shapes: pair (j, j′) with j < j′. Adjacent directions
 * (72°) give fat rhombi, next-adjacent (144°) give thin ones. */
export const PAIRS = [];
for (let j = 0; j < N; j++) {
    for (let jp = j + 1; jp < N; jp++) {
        const d = jp - j;
        const det = E[j][0] * E[jp][1] - E[j][1] * E[jp][0];
        PAIRS.push({ j, jp, fat: d === 1 || d === 4, det, area: Math.abs(det) });
    }
}

/* Generic infinitesimal shift: resolves singular (≥3-line) crossings the
 * same way for every rhombus, so ties never produce gaps or overlaps. */
const TIE = [0.1234e-9, 0.5678e-9, 0.9012e-9, 0.3456e-9, 0.7891e-9];

/* ---- Tile storage (struct of arrays, reused frame to frame) ------ */
export class TileSet {
    constructor(cap = 4096) {
        this.n = 0;
        this.alloc(cap);
        this.gamma = new Float64Array(N);
        this.pstart = new Int32Array(11);   // tiles of pair p occupy [pstart[p], pstart[p+1])
    }
    alloc(cap) {
        const old = this.cap ? this : null;
        this.cap = cap;
        const F64 = Float64Array, I32 = Int32Array;
        const next = {
            key: new F64(cap), pair: new Uint8Array(cap), K: new I32(cap * N),
            bx: new F64(cap), by: new F64(cap), lvl: new I32(cap),
            gx: new F64(cap), gy: new F64(cap), ux: new Float32Array(cap), uy: new Float32Array(cap),
        };
        if (old) for (const f in next) next[f].set(old[f].subarray(0, f === 'K' ? old.n * N : old.n));
        Object.assign(this, next);
    }
    /** Index of the tile with this key, or -1. Keys are sorted within each pair block. */
    find(key) {
        const p = key % 16;
        let lo = this.pstart[p], hi = this.pstart[p + 1] - 1;
        const key_ = this.key;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1, v = key_[mid];
            if (v === key) return mid;
            if (v < key) lo = mid + 1; else hi = mid - 1;
        }
        return -1;
    }
}

/** Stable identity of a rhombus: the grid crossing (pair, k, k′). */
export function tileKey(p, k, kp) {
    return ((k + 524288) * 1048576 + (kp + 524288)) * 16 + p;
}

/**
 * Fill `ts` with every rhombus that can touch the disc of `radius` around
 * the world point (cx, cy).
 *
 *   field(x, y, out) — optional phason field at grid point (x, y): writes
 *     out[0..1] = u, out[2..5] = ∂u_x/∂x, ∂u_x/∂y, ∂u_y/∂x, ∂u_y/∂y.
 *     Keep |∇u| ≲ 0.2 so the curved grid stays a valid pentagrid.
 *   fieldAmp — bound on |u| (widens the enumeration margin).
 *   rect — optional [halfWidth, halfHeight, angle]: also cull to that
 *     (rotated) rectangle around the center, which saves the disc's corners.
 */
export function generateTiles(ts, { gamma, cx, cy, radius, rect = null, field = null, fieldAmp = 0 }) {
    ts.n = 0;
    ts.stamp = (ts.stamp || 0) + 1;
    ts.gamma.set(gamma);
    const g = [0, 0, 0, 0, 0];
    let ox = 0, oy = 0;
    for (let i = 0; i < N; i++) {
        g[i] = gamma[i] + TIE[i];
        ox += gamma[i] * E[i][0];
        oy += gamma[i] * E[i][1];
    }
    const xc = (cx - ox) / 2.5, yc = (cy - oy) / 2.5;
    const Rx = (radius + 3.7) / 2.5 + 1.2 * fieldAmp;
    const Rview = radius + 1.3;
    const Rview2 = Rview * Rview;
    const U = new Float64Array(6);
    const Kt = new Int32Array(N);
    const rw = rect ? rect[0] + 1.3 : Infinity, rh = rect ? rect[1] + 1.3 : Infinity;
    const rc = rect ? Math.cos(rect[2]) : 1, rs = rect ? Math.sin(rect[2]) : 0;

    for (let p = 0; p < PAIRS.length; p++) {
        ts.pstart[p] = ts.n;
        const { j, jp, det } = PAIRS[p];
        const aj = E[j][0], bj = E[j][1], ajp = E[jp][0], bjp = E[jp][1];
        const idet = 1 / det;
        const cosA = aj * ajp + bj * bjp;
        const cj = xc * aj + yc * bj + g[j];
        const cjp = xc * ajp + yc * bjp + g[jp];
        const kMin = Math.ceil(cj - Rx), kMax = Math.floor(cj + Rx);
        const adet = Math.abs(det);
        const pad = fieldAmp * 1.2;
        const ej0 = Ei[j][0], ej1 = Ei[j][1], ejp0 = Ei[jp][0], ejp1 = Ei[jp][1];
        const cx0 = aj + ajp, cy0 = bj + bjp; // center offset (×½) of the rhombus

        for (let k = kMin; k <= kMax; k++) {
            const d = k - cj;
            const h = Math.sqrt(Math.max(0, Rx * Rx - d * d));
            const mid = cjp + d * cosA, span = h * adet + pad;
            const kpMin = Math.ceil(mid - span), kpMax = Math.floor(mid + span);
            for (let kp = kpMin; kp <= kpMax; kp++) {
                // straight crossing
                const Uu = k - g[j], Vv = kp - g[jp];
                let x = (bjp * Uu - bj * Vv) * idet;
                let y = (-ajp * Uu + aj * Vv) * idet;
                let ux = 0, uy = 0;
                if (field) {
                    // Newton on the curved grid lines
                    for (let it = 0; it < 4; it++) {
                        field(x, y, U);
                        const Fj = x * aj + y * bj + g[j] + U[0] * ej0 + U[1] * ej1 - k;
                        const Fjp = x * ajp + y * bjp + g[jp] + U[0] * ejp0 + U[1] * ejp1 - kp;
                        const gj0 = aj + ej0 * U[2] + ej1 * U[4], gj1 = bj + ej0 * U[3] + ej1 * U[5];
                        const gp0 = ajp + ejp0 * U[2] + ejp1 * U[4], gp1 = bjp + ejp0 * U[3] + ejp1 * U[5];
                        const D = gj0 * gp1 - gj1 * gp0;
                        const dx = (gp1 * Fj - gj1 * Fjp) / D;
                        const dy = (-gp0 * Fj + gj0 * Fjp) / D;
                        x -= dx; y -= dy;
                        if (dx * dx + dy * dy < 1e-18) break;
                    }
                    field(x, y, U);
                    ux = U[0]; uy = U[1];
                }

                let bx = 0, by = 0, lvl = 0;
                for (let i = 0; i < N; i++) {
                    let Ki;
                    if (i === j) Ki = k;
                    else if (i === jp) Ki = kp;
                    else Ki = Math.ceil(x * E[i][0] + y * E[i][1] + g[i] + ux * Ei[i][0] + uy * Ei[i][1]);
                    Kt[i] = Ki;
                    bx += Ki * E[i][0];
                    by += Ki * E[i][1];
                    lvl += Ki;
                }
                const mx = bx + 0.5 * cx0 - cx, my = by + 0.5 * cy0 - cy;
                if (mx * mx + my * my > Rview2) continue;
                if (rect && (Math.abs(rc * mx - rs * my) > rw || Math.abs(rs * mx + rc * my) > rh)) continue;

                if (ts.n === ts.cap) ts.alloc(ts.cap * 2);
                const n = ts.n++;
                ts.key[n] = tileKey(p, k, kp);
                ts.pair[n] = p;
                ts.K.set(Kt, n * N);
                ts.bx[n] = bx; ts.by[n] = by;
                ts.lvl[n] = lvl;
                ts.gx[n] = x; ts.gy[n] = y;
                ts.ux[n] = ux; ts.uy[n] = uy;
            }
        }
    }
    ts.pstart[PAIRS.length] = ts.n;
    return ts;
}

/* ---- Internal-space geometry -------------------------------------- */

/** y⊥ = Σ (K_i − γ_i − φ_i) e′_i of the base vertex of tile i. */
export function basePerp(ts, i, out) {
    let px = 0, py = 0;
    const o = i * N;
    const ux = ts.ux[i], uy = ts.uy[i];
    for (let m = 0; m < N; m++) {
        const phi = ux * Ei[m][0] + uy * Ei[m][1];
        const c = ts.K[o + m] - ts.gamma[m] - phi;
        px += c * Ei[m][0];
        py += c * Ei[m][1];
    }
    out[0] = px; out[1] = py;
    return out;
}

/**
 * The acceptance window for vertices of index t when Σγ = s: the slice
 * {z ∈ [0,1]⁵ : Σz = t − s} projected by z ↦ Σ z_i e′_i. A pentagon at
 * integer levels, a decagon otherwise. Returns a CCW polygon or null.
 */
const windowCache = new Map();
export function windowPolygon(level) {
    const key = Math.round(level * 1e6);
    if (windowCache.has(key)) return windowCache.get(key);
    let poly = null;
    if (level > 1e-9 && level < N - 1e-9) {
        const m = Math.floor(level + 1e-12), f = level - m;
        const pts = [];
        for (let mask = 0; mask < 32; mask++) {
            let bits = 0;
            for (let b = 0; b < N; b++) if (mask >> b & 1) bits++;
            if (bits !== m) continue;
            let px = 0, py = 0;
            for (let b = 0; b < N; b++) if (mask >> b & 1) { px += Ei[b][0]; py += Ei[b][1]; }
            if (f > 1e-9) {
                for (let b = 0; b < N; b++) {
                    if (mask >> b & 1) continue;
                    pts.push([px + f * Ei[b][0], py + f * Ei[b][1]]);
                }
            } else pts.push([px, py]);
        }
        poly = convexHull(pts);
        if (poly.length < 3) poly = null;
    }
    if (windowCache.size > 256) windowCache.clear();
    windowCache.set(key, poly);
    return poly;
}

function convexHull(pts) {
    const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const p of P) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-12) lower.pop();
        lower.push(p);
    }
    for (let i = P.length - 1; i >= 0; i--) {
        const p = P[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-12) upper.pop();
        upper.push(p);
    }
    upper.pop(); lower.pop();
    return lower.concat(upper);
}

/* ---- Coordinates of γ ---------------------------------------------- */

/** Internal (phason) coordinate γ⊥ = (2/5) Σ γ_i e′_i. */
export function gammaPerp(gamma) {
    let x = 0, y = 0;
    for (let i = 0; i < N; i++) { x += gamma[i] * Ei[i][0]; y += gamma[i] * Ei[i][1]; }
    return [0.4 * x, 0.4 * y];
}

export function gammaSum(gamma) {
    let s = 0;
    for (let i = 0; i < N; i++) s += gamma[i];
    return s;
}
