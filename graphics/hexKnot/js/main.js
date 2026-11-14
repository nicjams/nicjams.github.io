/* ------------------------------------------------------------------ *
 *  Hex Knot — identical hexagonal tiles, each carrying three woven
 *  bands. Tiles turn; bands join across edges into closed loops (the
 *  grid is a torus); each loop is colored on its own, and colors are
 *  carried through merges and splits.
 *
 *  Tile-local coordinates have circumradius 1, pointy-top, angles in
 *  canvas orientation (y down). Edge e has outward normal at 60e°, so
 *  turning a tile by one step sends local edge e to world edge e + 1.
 * ------------------------------------------------------------------ */

import { PALETTES, PALETTE_ORDER, css, mix, shade } from './colors.js';

const $ = id => document.getElementById(id);
const TAU = Math.PI * 2, R3 = Math.sqrt(3), AP = R3 / 2;

/* ---- Tile designs -------------------------------------------------- *
 * Strands are pairs of local edges, listed in drawing order (later is
 * on top at a crossing).
 */
const DESIGNS = {
    salobrena: {
        strands: [[0, 1], [3, 5], [2, 4]],
        caption: 'A corner arc and two wide arcs that cross once, one over the other. The tile has no symmetry, so it lies in six distinct orientations, and a single turn can reroute all three bands.',
    },
    lattice: {
        strands: [[0, 2], [1, 4], [3, 5]],
        caption: 'Two wide arcs with a straight band running between them, over one and under the other, so the band alternates as a knot diagram should.',
    },
    weave: {
        strands: [[5, 1], [0, 3], [2, 4]],
        caption: 'A straight band threaded through two hoops that hug its own ends: under the first, over the second.',
    },
    truchet: {
        strands: [[0, 1], [2, 3], [4, 5]],
        caption: 'Three corner arcs and no crossings: the classic hexagonal Truchet tile. It has only two orientations, and the loops it makes never interlace.',
    },
};
const TILE_ORDER = Object.keys(DESIGNS);

const MOTION_CAPTIONS = {
    still: 'Nothing moves on its own. Click a tile to turn it a sixth of a turn; shift-click turns it back.',
    random: 'Tiles turn one at a time, chosen at random. Each turn reroutes three bands, so loops split and merge, and their colors follow.',
    wave: 'A straight front sweeps across the floor and turns every tile it passes by the same amount.',
    ripples: 'Rings spread from random points and turn the tiles they cross.',
};
const SCHEME_CAPTIONS = {
    component: 'Each closed loop has its own color. When a turn joins two loops, the merged loop keeps the larger one’s color; when a loop splits, its largest piece keeps it.',
    length: 'Color follows a loop’s length, counted in bands, from short to long.',
    stone: 'One color for every band, as on the pavement itself.',
};
const MOTIONS = Object.keys(MOTION_CAPTIONS);
const SCHEMES = Object.keys(SCHEME_CAPTIONS);

/* ---- Strand geometry ---------------------------------------------- */
const mid = e => [AP * Math.cos(e * Math.PI / 3), AP * Math.sin(e * Math.PI / 3)];

function strandPoints(a, b) {
    let d = (b - a + 6) % 6;
    if (d > 3) { [a, b] = [b, a]; d = 6 - d; }
    const P = mid(a), Q = mid(b);
    let pts = [];
    if (d === 3) {
        for (let i = 0; i <= 8; i++) pts.push([P[0] + (Q[0] - P[0]) * i / 8, P[1] + (Q[1] - P[1]) * i / 8]);
    } else {
        // d = 1: around the shared corner, radius ½. d = 2: around the
        // corner of the neighbor beyond the skipped edge, radius 3/2.
        const ang = d === 1 ? (a + 0.5) * Math.PI / 3 : (a + 1) * Math.PI / 3;
        const dist = d === 1 ? 1 : R3, rad = d === 1 ? 0.5 : 1.5;
        const C = [dist * Math.cos(ang), dist * Math.sin(ang)];
        const a0 = Math.atan2(P[1] - C[1], P[0] - C[0]);
        let da = Math.atan2(Q[1] - C[1], Q[0] - C[0]) - a0;
        da -= TAU * Math.round(da / TAU);
        const n = 28;
        for (let i = 0; i <= n; i++) {
            const t = a0 + da * i / n;
            pts.push([C[0] + rad * Math.cos(t), C[1] + rad * Math.sin(t)]);
        }
    }
    // Overshoot each end a hair along its tangent so neighbors' bands
    // meet without an antialiasing seam.
    const ext = (p, q) => {
        const dx = p[0] - q[0], dy = p[1] - q[1], l = Math.hypot(dx, dy);
        return [p[0] + dx / l * 0.012, p[1] + dy / l * 0.012];
    };
    pts = [ext(pts[0], pts[1]), ...pts, ext(pts[pts.length - 1], pts[pts.length - 2])];
    return pts;
}
function pathOf(pts) {
    const p = new Path2D();
    p.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
    return p;
}
for (const D of Object.values(DESIGNS)) {
    D.pts = D.strands.map(([a, b]) => strandPoints(a, b));
    D.paths = D.pts.map(pathOf);
}
const HEX = (() => {
    const p = new Path2D();
    for (let k = 0; k < 6; k++) {
        const t = (k - 0.5) * Math.PI / 3;
        k ? p.lineTo(Math.cos(t), Math.sin(t)) : p.moveTo(Math.cos(t), Math.sin(t));
    }
    p.closePath();
    return p;
})();

/* ---- State ---------------------------------------------------------- */
const state = {
    motion: 'random', speed: 1, turn: 'either', lift: true, paused: false,
    tile: 'salobrena', size: 46, band: 0.34,
    scheme: 'component', palette: 'gold', style: 'bevel', grout: true, hover: true,
    turns: 0,
};

const view = { W: 0, H: 0, DPR: 1, ox: 0, oy: 0 };
const grid = { C: 0, R: 0, n: 0, rot: null, x: null, y: null, nb: null };
let turning = new Map();             // cell → { from, amt, t0, dur }
let comp = null, compLen = [], compColorId = [], strandComp = null;
let nextColorId = 0;
let cur = null, tgt = null;          // per-strand current / target rgb
let hoverComp = -1, hoverCell = -1;
let dirty = true, needComponents = false, now = 0;

/* ---- Grid on a torus ------------------------------------------------ */
const DQ = [1, 0, -1, -1, 0, 1], DR = [0, 1, 1, 0, -1, -1];

function buildGrid() {
    const s = state.size;
    const C = Math.max(4, Math.ceil(view.W / (s * R3)) + 2);
    let R = Math.max(4, Math.ceil(view.H / (1.5 * s)) + 2);
    if (R & 1) R++;
    const old = grid.rot ? { C: grid.C, R: grid.R, rot: grid.rot } : null;
    const n = C * R;
    Object.assign(grid, { C, R, n, rot: new Uint8Array(n), x: new Float32Array(n), y: new Float32Array(n), nb: new Int32Array(6 * n) });
    // Centre the patch: one hidden column/row of margin on each side.
    view.ox = (view.W - (C - 0.5) * s * R3) / 2 + s * R3 / 4;
    view.oy = (view.H - (R - 1) * 1.5 * s) / 2;
    for (let row = 0; row < R; row++) for (let col = 0; col < C; col++) {
        const c = row * C + col;
        grid.x[c] = view.ox + s * R3 * (col + 0.5 * (row & 1));
        grid.y[c] = view.oy + 1.5 * s * row;
        grid.rot[c] = old && col < old.C && row < old.R ? old.rot[row * old.C + col] : (Math.random() * 6) | 0;
        const q = col - (row - (row & 1)) / 2;
        for (let e = 0; e < 6; e++) {
            const r2 = row + DR[e], q2 = q + DQ[e];
            const c2 = q2 + (r2 - (r2 & 1)) / 2;
            grid.nb[6 * c + e] = ((r2 % R + R) % R) * C + ((c2 % C + C) % C);
        }
    }
    turning.clear();
    cur = new Float32Array(9 * n); tgt = new Float32Array(9 * n);
    comp = null;
    computeComponents(true);
    buildGroutPath();
    $('tileCount').textContent = `${n.toLocaleString()} tiles`;
}

let groutPath = null;
function buildGroutPath() {
    const s = state.size, p = new Path2D();
    for (let c = 0; c < grid.n; c++) {
        // Three edges per cell draw every shared edge once.
        for (let k = 0; k < 4; k++) {
            const t = (k - 0.5) * Math.PI / 3;
            const X = grid.x[c] + s * Math.cos(t), Y = grid.y[c] + s * Math.sin(t);
            k ? p.lineTo(X, Y) : p.moveTo(X, Y);
        }
    }
    groutPath = p;
}

/* ---- Components (union–find over strands) -------------------------- */
function computeComponents(snap) {
    const D = DESIGNS[state.tile], n = grid.n, m = 3 * n;
    const parent = new Int32Array(m);
    for (let i = 0; i < m; i++) parent[i] = i;
    const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    // Which strand ends on each world edge of each cell.
    const at = new Int32Array(6 * n);
    for (let c = 0; c < n; c++) {
        const r = grid.rot[c];
        D.strands.forEach(([a, b], k) => {
            at[6 * c + (a + r) % 6] = 3 * c + k;
            at[6 * c + (b + r) % 6] = 3 * c + k;
        });
    }
    for (let c = 0; c < n; c++) for (let e = 0; e < 3; e++) {
        const a = find(at[6 * c + e]), b = find(at[6 * grid.nb[6 * c + e] + e + 3]);
        if (a !== b) parent[a] = b;
    }
    const label = new Int32Array(m).fill(-1);
    const nc = new Int32Array(m);
    let count = 0;
    const lens = [];
    for (let i = 0; i < m; i++) {
        const r = find(i);
        if (label[r] < 0) { label[r] = count++; lens.push(0); }
        nc[i] = label[r];
        lens[nc[i]]++;
    }

    // Carry colors: each new loop takes the old color it overlaps most,
    // biggest overlaps first; leftovers get fresh colors.
    const ids = new Array(count).fill(-1);
    if (comp && !snap) {
        const overlap = new Map();
        for (let i = 0; i < m; i++) {
            const key = nc[i] * 1e7 + compColorId[comp[i]];
            overlap.set(key, (overlap.get(key) || 0) + 1);
        }
        const pairs = [...overlap].map(([k, v]) => [Math.floor(k / 1e7), k % 1e7, v]).sort((a, b) => b[2] - a[2]);
        const used = new Set();
        for (const [c, id, v] of pairs) {
            if (ids[c] >= 0 || used.has(id)) continue;
            ids[c] = id; used.add(id);
        }
    }
    for (let c = 0; c < count; c++) if (ids[c] < 0) ids[c] = nextColorId++;
    comp = nc; compLen = lens; compColorId = ids; strandComp = nc;
    $('compCount').textContent = ` · ${count.toLocaleString()} loops`;
    retarget(snap);
}

/* ---- Colors --------------------------------------------------------- */
let P, ground, groutRGB, terrazzo = null;
const GOLD = 0.6180339887;

function lutAt(L, t) {
    const i = Math.min(255, Math.max(0, Math.round(t * 255)));
    return [L[3 * i], L[3 * i + 1], L[3 * i + 2]];
}
function loopColor(id) {
    const c = lutAt(P.cycleL, (id * GOLD + 0.07) % 1);
    return shade(c, ((id % 3) - 1) * 0.05);
}
function retarget(snap) {
    P = PALETTES[state.palette];
    ground = mix(P.bg, P.thin, P.light ? 0.55 : 0.3);
    groutRGB = P.light ? shade(ground, -0.12) : P.grout;
    const maxLen = Math.max(2, ...compLen);
    const cache = new Map();
    for (let i = 0; i < 3 * grid.n; i++) {
        const k = strandComp[i];
        let c = cache.get(k);
        if (!c) {
            if (state.scheme === 'component') c = loopColor(compColorId[k]);
            else if (state.scheme === 'length') c = lutAt(P.rampL, 0.3 + 0.7 * Math.log(compLen[k]) / Math.log(maxLen));
            else c = P.fat;
            cache.set(k, c);
        }
        tgt[3 * i] = c[0]; tgt[3 * i + 1] = c[1]; tgt[3 * i + 2] = c[2];
    }
    if (snap) cur.set(tgt);
    terrazzo = null;
    dirty = true;
    showLegend();
}
function easeColors(dt) {
    const k = 1 - Math.exp(-dt * 5);
    let moving = false;
    for (let i = 0; i < cur.length; i++) {
        const d = tgt[i] - cur[i];
        if (d > 0.002 || d < -0.002) { cur[i] += d * k; moving = true; } else cur[i] = tgt[i];
    }
    return moving;
}
const rgbStr = (r, g, b, a = 1) => `rgba(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0},${a})`;

function terrazzoPattern(ctx) {
    const cv = document.createElement('canvas');
    const S = 220 * view.DPR;
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    g.fillStyle = css(ground);
    g.fillRect(0, 0, S, S);
    const chips = [shade(ground, 0.16, 0.6), shade(ground, -0.08), shade(ground, 0.3, 0.3), P.thin];
    for (let i = 0; i < 1400; i++) {
        g.fillStyle = css(chips[i % chips.length]);
        g.globalAlpha = 0.35 + 0.5 * Math.random();
        const r = (0.5 + Math.random() * 1.6) * view.DPR;
        g.beginPath();
        g.ellipse(Math.random() * S, Math.random() * S, r, r * (0.5 + Math.random() * 0.5), Math.random() * 3, 0, TAU);
        g.fill();
    }
    return ctx.createPattern(cv, 'repeat');
}

/* ---- Turning -------------------------------------------------------- */
function turnAmount() {
    const sgn = Math.random() < 0.5 ? -1 : 1;
    return state.turn === 'cw' ? 1 : state.turn === 'third' ? 2 * sgn : state.turn === 'half' ? 3 : sgn;
}
function startTurn(c, amt, delay = 0) {
    if (turning.has(c) || !amt) return false;
    const dur = (0.42 + 0.12 * Math.abs(amt)) / Math.sqrt(state.speed);
    turning.set(c, { from: grid.rot[c], amt, t0: now + delay, dur });
    return true;
}
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

function stepTurns() {
    let finished = false;
    for (const [c, T] of turning) {
        if (now >= T.t0 + T.dur) {
            grid.rot[c] = ((T.from + T.amt) % 6 + 6) % 6;
            turning.delete(c);
            state.turns++;
            finished = true;
        }
    }
    if (finished) needComponents = true;
    return turning.size > 0;
}

/* ---- Motion --------------------------------------------------------- */
const motion = { acc: 0, wave: null, ripples: [], nextRipple: 0 };

function stepMotion(dt) {
    if (state.paused || state.motion === 'still') return;
    const sp = state.speed;
    if (state.motion === 'random') {
        motion.acc += dt * sp * Math.max(1.5, grid.n / 80);
        let guard = 0;
        while (motion.acc >= 1 && guard++ < 50) {
            motion.acc -= 1;
            startTurn((Math.random() * grid.n) | 0, turnAmount());
        }
    } else if (state.motion === 'wave') {
        let W = motion.wave;
        if (!W || W.pos > W.max + state.size * 4) {
            const th = Math.random() * TAU, dx = Math.cos(th), dy = Math.sin(th);
            const d = new Float32Array(grid.n);
            let lo = Infinity, hi = -Infinity;
            for (let c = 0; c < grid.n; c++) { d[c] = grid.x[c] * dx + grid.y[c] * dy; lo = Math.min(lo, d[c]); hi = Math.max(hi, d[c]); }
            W = motion.wave = { d, pos: lo - state.size * 2, max: hi, amt: turnAmount() };
        }
        const prev = W.pos;
        W.pos += dt * sp * 220 * Math.sqrt(state.size / 46);
        for (let c = 0; c < grid.n; c++) if (W.d[c] > prev && W.d[c] <= W.pos) startTurn(c, W.amt);
    } else if (state.motion === 'ripples') {
        motion.nextRipple -= dt * sp;
        if (motion.nextRipple <= 0) {
            motion.ripples.push({ x: Math.random() * view.W, y: Math.random() * view.H, r: 0, amt: turnAmount() });
            motion.nextRipple = 2.6;
        }
        const maxR = Math.hypot(view.W, view.H);
        for (const Rp of motion.ripples) {
            const prev = Rp.r;
            Rp.r += dt * sp * 200 * Math.sqrt(state.size / 46);
            for (let c = 0; c < grid.n; c++) {
                const d = Math.hypot(grid.x[c] - Rp.x, grid.y[c] - Rp.y);
                if (d > prev && d <= Rp.r) startTurn(c, Rp.amt);
            }
        }
        motion.ripples = motion.ripples.filter(Rp => Rp.r < maxR);
    }
}

function shuffleAll() {
    for (let c = 0; c < grid.n; c++) {
        const amt = ((Math.random() * 6) | 0) - 2;
        startTurn(c, amt, Math.random() * 0.7);
    }
}
function alignAll() {
    const cx = view.W / 2, cy = view.H / 2;
    for (let c = 0; c < grid.n; c++) {
        let amt = (6 - grid.rot[c]) % 6;
        if (amt > 3) amt -= 6;
        startTurn(c, amt, Math.hypot(grid.x[c] - cx, grid.y[c] - cy) / 900);
    }
}

/* ---- Rendering ------------------------------------------------------ */
let canvas, ctx;

function drawTile(c, ang, sc, lifted) {
    const D = DESIGNS[state.tile], s = state.size * sc, k = view.DPR * s;
    const cs = Math.cos(ang) * k, sn = Math.sin(ang) * k;
    ctx.setTransform(cs, sn, -sn, cs, view.DPR * grid.x[c], view.DPR * grid.y[c]);
    const w = state.band, g = 1.3 / s;
    const dimTo = hoverComp >= 0;
    if (lifted) {
        ctx.fillStyle = state.style === 'terrazzo' ? (terrazzo || css(ground)) : css(ground);
        ctx.shadowColor = 'rgba(0,0,0,0.55)';
        ctx.shadowBlur = 18 * view.DPR;
        ctx.shadowOffsetY = 6 * view.DPR;
        ctx.fill(HEX);
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    }
    for (let j = 0; j < D.paths.length; j++) {
        const i = 3 * c + j;
        let r = cur[3 * i], gg = cur[3 * i + 1], b = cur[3 * i + 2];
        if (dimTo && strandComp[i] !== hoverComp) {
            r = r * 0.3 + ground[0] * 0.7; gg = gg * 0.3 + ground[1] * 0.7; b = b * 0.3 + ground[2] * 0.7;
        }
        const path = D.paths[j];
        if (state.style === 'line') {
            const lw = Math.max(0.07, 2.2 / s);
            ctx.strokeStyle = state.style === 'terrazzo' ? terrazzo : css(ground);
            ctx.lineWidth = lw * 4;
            ctx.stroke(path);
            ctx.strokeStyle = rgbStr(r, gg, b);
            ctx.lineWidth = lw;
            ctx.stroke(path);
            continue;
        }
        const or = r * 0.42 + groutRGB[0] * 0.58, og = gg * 0.42 + groutRGB[1] * 0.58, ob = b * 0.42 + groutRGB[2] * 0.58;
        if (state.style === 'bevel') {
            ctx.strokeStyle = 'rgba(0,0,0,0.28)';
            ctx.lineWidth = w + 6 * g;
            ctx.stroke(path);
        }
        ctx.strokeStyle = rgbStr(or, og, ob);
        ctx.lineWidth = w + 2 * g;
        ctx.stroke(path);
        ctx.strokeStyle = rgbStr(r, gg, b);
        ctx.lineWidth = w;
        ctx.stroke(path);
        if (state.style === 'bevel') {
            ctx.strokeStyle = 'rgba(255,255,255,0.13)';
            ctx.lineWidth = w * 0.42;
            ctx.stroke(path);
        } else if (state.style === 'terrazzo') {
            ctx.strokeStyle = rgbStr(or, og, ob, 0.5);
            ctx.lineWidth = g;
            ctx.stroke(path);
        }
    }
    if (lifted && state.grout) {
        ctx.strokeStyle = css(groutRGB);
        ctx.lineWidth = 1.4 / s;
        ctx.stroke(HEX);
    }
}

function draw() {
    const { W, H, DPR } = view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (state.style === 'terrazzo' && !terrazzo) terrazzo = terrazzoPattern(ctx);
    ctx.fillStyle = state.style === 'terrazzo' ? terrazzo : css(ground);
    ctx.fillRect(0, 0, W * DPR, H * DPR);
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';

    const lifted = [];
    for (let c = 0; c < grid.n; c++) {
        const T = turning.get(c);
        if (T && now >= T.t0) { lifted.push(c); continue; }
        drawTile(c, grid.rot[c] * Math.PI / 3, 1, false);
    }
    if (state.grout) {
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        ctx.strokeStyle = css(groutRGB);
        ctx.lineWidth = 1.4;
        ctx.stroke(groutPath);
    }
    for (const c of lifted) {
        const T = turning.get(c);
        const t = Math.min(1, (now - T.t0) / T.dur), e = ease(t);
        const s = state.size;
        // the empty socket the tile was lifted out of
        ctx.setTransform(view.DPR * s, 0, 0, view.DPR * s, view.DPR * grid.x[c], view.DPR * grid.y[c]);
        ctx.fillStyle = css(shade(ground, -0.07));
        ctx.fill(HEX);
        const sc = state.lift ? 1 + 0.12 * Math.sin(Math.PI * t) : 1;
        drawTile(c, (T.from + T.amt * e) * Math.PI / 3, sc, state.lift);
    }
}

/* ---- Picking -------------------------------------------------------- */
function cellAt(x, y) {
    const s = state.size;
    const row0 = Math.round((y - view.oy) / (1.5 * s));
    let best = -1, bd = Infinity;
    for (let row = row0 - 1; row <= row0 + 1; row++) {
        if (row < 0 || row >= grid.R) continue;
        const col0 = Math.round((x - view.ox) / (s * R3) - 0.5 * (row & 1));
        for (let col = col0 - 1; col <= col0 + 1; col++) {
            if (col < 0 || col >= grid.C) continue;
            const c = row * grid.C + col, d = Math.hypot(grid.x[c] - x, grid.y[c] - y);
            if (d < bd) { bd = d; best = c; }
        }
    }
    return bd < state.size ? best : -1;
}
function strandAt(c, x, y) {
    const s = state.size, a = -grid.rot[c] * Math.PI / 3;
    const dx = (x - grid.x[c]) / s, dy = (y - grid.y[c]) / s;
    const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    const D = DESIGNS[state.tile];
    let best = -1, bd = Infinity;
    for (let j = D.pts.length - 1; j >= 0; j--) {
        let m = Infinity;
        for (const [px, py] of D.pts[j]) m = Math.min(m, Math.hypot(px - lx, py - ly));
        if (m < state.band / 2 + 0.03) return j;   // topmost band under the pointer wins
        if (m < bd) { bd = m; best = j; }
    }
    return bd < 0.35 ? best : -1;
}
function setHover(x, y) {
    let hc = -1;
    if (state.hover && x !== null) {
        const c = cellAt(x, y);
        if (c >= 0 && !turning.has(c)) {
            const j = strandAt(c, x, y);
            if (j >= 0) hc = strandComp[3 * c + j];
        }
    }
    if (hc !== hoverComp) { hoverComp = hc; dirty = true; showReadout(); }
}

/* ---- Legend & readout ------------------------------------------------ */
function showLegend() {
    const L = $('legend');
    if (state.scheme === 'length') {
        const stops = [];
        for (let i = 0; i <= 8; i++) stops.push(css(lutAt(P.rampL, 0.3 + 0.7 * i / 8)));
        const maxLen = Math.max(...compLen);
        L.innerHTML = `<div class="row">Loop length</div>
            <div class="row"><i class="ramp" style="background:linear-gradient(90deg,${stops.join(',')})"></i></div>
            <div class="row ends"><span>1 band</span><span>${maxLen} bands</span></div>`;
    } else if (state.scheme === 'component') {
        const sq = [0, 1, 2, 3, 4, 5].map(i => `<i class="sq" style="background:${css(loopColor(i * 7 + 3))}"></i>`).join('');
        L.innerHTML = `<div class="row">${sq}</div><div class="row">one color per closed loop</div>`;
    } else L.innerHTML = '';
}
let readoutKey = '';
function showReadout() {
    let html;
    if (hoverComp >= 0) {
        const len = compLen[hoverComp];
        html = `<b>loop</b> · ${len} band${len === 1 ? '' : 's'}`;
    } else {
        html = `<b>turns</b> ${state.turns.toLocaleString()}<br><b>longest loop</b> ${Math.max(...compLen)} bands`;
    }
    if (html !== readoutKey) { readoutKey = html; $('readout').innerHTML = html; }
}

/* ---- Main loop ------------------------------------------------------- */
let last = 0;
function frame(ms) {
    const t = ms / 1000;
    const dt = Math.min(0.1, last ? t - last : 0);
    last = t;
    now = t;
    stepMotion(dt);
    const active = stepTurns();
    if (needComponents) { needComponents = false; computeComponents(false); }
    const fading = easeColors(dt);
    if (active || fading || dirty) { draw(); dirty = false; }
    showReadout();
    requestAnimationFrame(frame);
}

function resize() {
    const r = $('stage').getBoundingClientRect();
    view.W = Math.max(1, r.width); view.H = Math.max(1, r.height);
    view.DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(view.W * view.DPR);
    canvas.height = Math.round(view.H * view.DPR);
    terrazzo = null;
    motion.wave = null; motion.ripples = [];
    buildGrid();
    dirty = true;
}

/* ---- UI --------------------------------------------------------------- */
function bindRadios(name, fn) {
    document.querySelectorAll(`input[name="${name}"]`).forEach(r => {
        r.addEventListener('change', () => { if (r.checked) fn(r.value); });
    });
}
function setRadio(name, value) {
    const r = document.querySelector(`input[name="${name}"][value="${value}"]`);
    if (r && !r.checked) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
}
function cycleRadio(name, list, key) {
    const i = list.indexOf(state[key]);
    setRadio(name, list[(i + 1) % list.length]);
}
function bindRange(id, fn, digits) {
    const inp = $(id), out = $(id + 'Val');
    const sync = () => { fn(+inp.value); if (out) out.textContent = (+inp.value).toFixed(digits); };
    inp.addEventListener('input', sync);
    sync();
}
function bindCheck(id, fn) {
    const inp = $(id);
    inp.addEventListener('change', () => fn(inp.checked));
    fn(inp.checked);
}

function buildPalettes() {
    const box = $('paletteChips');
    for (const k of PALETTE_ORDER) {
        const Q = PALETTES[k];
        const lab = document.createElement('label');
        lab.className = 'swatch';
        lab.title = Q.name;
        lab.innerHTML = `<input type="radio" name="palette" value="${k}" ${k === state.palette ? 'checked' : ''}>` +
            `<i><b style="--a:${css(Q.fat)};--b:${css(Q.thin)};--c:${Q.fiveHex[1]};--d:${Q.fiveHex[4]}"></b>${Q.name}</i>`;
        box.appendChild(lab);
    }
}

function showMotion() {
    $('motionCaption').textContent = MOTION_CAPTIONS[state.motion];
    $('pauseBtn').disabled = state.motion === 'still';
    $('pauseBtn').textContent = state.paused ? 'Resume' : 'Pause';
    $('pauseBtn').classList.toggle('active', state.paused);
}
function togglePause() {
    state.paused = !state.paused;
    showMotion();
}

function initUI() {
    buildPalettes();
    bindRadios('motion', v => { state.motion = v; state.paused = false; motion.wave = null; motion.ripples = []; motion.nextRipple = 0; showMotion(); });
    bindRadios('tile', v => {
        state.tile = v;
        turning.clear();
        $('tileCaption').textContent = DESIGNS[v].caption;
        computeComponents(true);
    });
    bindRadios('scheme', v => { state.scheme = v; $('schemeCaption').textContent = SCHEME_CAPTIONS[v]; retarget(false); });
    bindRadios('palette', v => {
        state.palette = v;
        $('stage').classList.toggle('light', !!PALETTES[v].light);
        retarget(false);
    });
    bindRadios('style', v => { state.style = v; dirty = true; });
    bindRange('speed', v => { state.speed = v; }, 2);
    bindRange('band', v => { state.band = v; dirty = true; }, 2);
    bindRange('scale', v => {
        if (v === state.size) return;
        state.size = v;
        if (canvas) { grid.rot = null; resize(); }
    }, 0);
    bindCheck('lift', v => { state.lift = v; });
    bindCheck('grout', v => { state.grout = v; dirty = true; });
    bindCheck('hover', v => { state.hover = v; if (!v) setHover(null, null); });
    $('turnStyle').addEventListener('change', e => { state.turn = e.target.value; });
    $('pauseBtn').addEventListener('click', togglePause);
    $('shuffleBtn').addEventListener('click', shuffleAll);
    $('alignBtn').addEventListener('click', alignAll);
    $('tileCaption').textContent = DESIGNS[state.tile].caption;
    $('schemeCaption').textContent = SCHEME_CAPTIONS[state.scheme];
    showMotion();

    window.addEventListener('keydown', e => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const tag = e.target.tagName;
        if (tag === 'SELECT' || (tag === 'INPUT' && e.target.type === 'text')) return;
        const k = e.key.toLowerCase();
        if (k === ' ') { e.preventDefault(); if (state.motion !== 'still') togglePause(); }
        else if (k === 'm') cycleRadio('motion', MOTIONS, 'motion');
        else if (k === 't') cycleRadio('tile', TILE_ORDER, 'tile');
        else if (k === 'k') cycleRadio('scheme', SCHEMES, 'scheme');
        else if (k === 'p') cycleRadio('palette', PALETTE_ORDER, 'palette');
        else if (k === 'g') { $('grout').click(); }
        else if (k === 'r') shuffleAll();
        else if (k === 'a') alignAll();
    });
}

function initPointer() {
    const pos = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    canvas.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') setHover(...pos(e)); });
    canvas.addEventListener('pointerleave', () => setHover(null, null));
    canvas.addEventListener('click', e => {
        const c = cellAt(...pos(e));
        if (c >= 0) { hoverComp = -1; startTurn(c, e.shiftKey ? -1 : 1); dirty = true; }
    });
}

/* ---- Boot ------------------------------------------------------------- */
canvas = $('tiling');
ctx = canvas.getContext('2d');
initUI();
P = PALETTES[state.palette];
resize();
initPointer();
new ResizeObserver(() => {
    const r = $('stage').getBoundingClientRect();
    if (Math.abs(r.width - view.W) > 0.5 || Math.abs(r.height - view.H) > 0.5) resize();
}).observe($('stage'));
requestAnimationFrame(frame);

window.hexKnot = { state, grid, shuffleAll, alignAll, startTurn, setRadio, draw };
