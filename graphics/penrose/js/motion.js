/* ------------------------------------------------------------------ *
 *  Motion modes — ways of moving through the space of Penrose tilings.
 *
 *  A tiling depends only on the internal part of γ: its projection γ⊥ to
 *  the internal plane (the phason) and the sum Σγ (integer ⇔ a classical
 *  Penrose tiling obeying the matching rules). The physical part of γ
 *  just relabels the grid.
 *
 *    still    nothing moves
 *    wander   γ performs a damped random walk in [0,1]⁵
 *    orbit    γ⊥ circles, Σγ fixed — a loop through one tiling class
 *    bloom    γ = (c,c,c,c,c), c sweeping: five-fold symmetric tilings
 *             from sun to star and through the generalized ones between
 *    wave     a traveling phason wave: bands of flips sweep the plane
 *    ripples  click (or wait) to drop phason pulses
 *    deflate  an endless zoom; each tile splits into its deflation
 * ------------------------------------------------------------------ */

import { N, E, Ei, PHI, state, view, gammaChanged, shiftGamma, resetTracking, sigma } from './state.js';
import { field, stepRipples, dropRipple, worldToGrid } from './field.js';

export const MODES = {
    still: 'Still',
    wander: 'Wander',
    orbit: 'Orbit',
    bloom: 'Bloom',
    wave: 'Wave',
    ripples: 'Ripples',
    deflate: 'Deflate',
};

export const CAPTIONS = {
    still: 'Drag to pan, scroll to zoom. Hover a rhombus to light its two de Bruijn ribbons; click to pin them.',
    wander: 'γ drifts at random through the 5-torus. When Σγ leaves the integers the tiling stops being a true Penrose tiling and new vertex types appear.',
    orbit: 'The phason γ⊥ travels a circle while Σγ stays fixed, so every frame is the same kind of tiling. Each change is a hexagon flip.',
    bloom: 'All five shifts move together, γ = (c,c,c,c,c). Every frame is five-fold symmetric. c = ⅕ is the sun and c = ⅖ is the star; the frames between them are generalized Penrose tilings.',
    wave: 'A traveling phason wave sets a different γ⊥ at each point. Hexagons flip where the wave passes, but no tile ever moves.',
    ripples: 'Click the tiling to drop a phason pulse. The ring flips hexagons as it spreads, and they flip back after it passes.',
    deflate: 'Endless zoom. Scaling a Penrose tiling by the golden ratio φ gives another Penrose tiling, so every tile splits into smaller ones. The coarse outlines are the supertiles.',
};

const motion = {
    mode: 'still',
    tween: null,        // { from, to, t, dur, m }
    orbit: null,        // { center, th }
    bloom: 0,
    lastDrop: 0,
    zoomLo: 30,
    driftDir: Math.random() * 2 * Math.PI,
};

export function currentMode() { return motion.mode; }

/* ---- helpers ------------------------------------------------------ */

/** Tween γ to `target` along the shortest integer-shifted path. */
export function tweenTo(target, dur = 1.1) {
    const m = state.gamma.map((g, i) => Math.round(g - target[i]));
    motion.tween = {
        from: state.gamma.slice(),
        to: target.map((t, i) => t + m[i]),
        m, t: 0, dur,
    };
}

function stepTween(dt) {
    const T = motion.tween;
    T.t += dt / T.dur;
    const t = Math.min(1, T.t);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    for (let i = 0; i < N; i++) state.gamma[i] = T.from[i] + (T.to[i] - T.from[i]) * e;
    if (t >= 1) {
        motion.tween = null;
        shiftGamma(T.m.map(v => -v));
        onTweenDone();
    }
}

function onTweenDone() {
    if (motion.mode === 'orbit') motion.orbit = { center: state.gamma.slice(), th: 0 };
    if (motion.mode === 'bloom') motion.bloom = state.gamma[0];
    if (motion.mode === 'deflate') motion.zoomLo = clampLo(state.scale);
}

function clampLo(s) { return Math.max(16, Math.min(60, s)); }

/** Internal-plane projection of γ, as a vector in ℝ⁵. */
function perpPart(g) {
    const out = [0, 0, 0, 0, 0];
    for (let i = 0; i < N; i++) {
        let v = 0;
        for (let m = 0; m < N; m++) v += 0.4 * g[m] * (Ei[m][0] * Ei[i][0] + Ei[m][1] * Ei[i][1]);
        out[i] = v;
    }
    return out;
}
/** Physical-plane projection of γ, as a vector in ℝ⁵. */
function physPart(g) {
    const out = [0, 0, 0, 0, 0];
    for (let i = 0; i < N; i++) {
        let v = 0;
        for (let m = 0; m < N; m++) v += 0.4 * g[m] * (E[m][0] * E[i][0] + E[m][1] * E[i][1]);
        out[i] = v;
    }
    return out;
}

/** γ of the tiling whose −τ-inflation is a subset of T(γ) (the supertiles). */
export function coarseGamma(g) {
    const s = Math.round(g.reduce((a, b) => a + b, 0));
    const p = perpPart(g);
    return p.map(v => (3 * s) / 5 + PHI * v);
}
/** γ of the tiling that T(γ) is the supertiling of (its deflation, scaled by −1/τ). */
export function fineGamma(g) {
    const s = Math.round(g.reduce((a, b) => a + b, 0));
    const p = perpPart(g);
    return p.map(v => (2 * s) / 5 + v / PHI);
}

/** Keep numbers small after a zoom rebase without changing the picture. */
function canonicalize() {
    // 1. lattice-translate so the camera sits near the origin
    const m = [0, 0, 0, 0, 0];
    for (let i = 0; i < N; i++) m[i] = -Math.round(0.4 * (state.cx * E[i][0] + state.cy * E[i][1]));
    shiftGamma(m);
    // 2. drop the physical part of γ (it only relabels the grid)
    const ph = physPart(state.gamma);
    for (let i = 0; i < N; i++) state.gamma[i] -= ph[i];
    // 3. Σγ mod 5 (adding (1,1,1,1,1) moves nothing: Σ e_i = 0)
    const k = Math.floor(sigma() / 5 + 1e-9);
    if (k) shiftGamma([-k, -k, -k, -k, -k]);
    resetTracking();
}

function rebaseIn() {
    state.pinned = null;
    state.gamma = fineGamma(state.gamma);
    state.cx *= -PHI; state.cy *= -PHI;
    state.angle += Math.PI;
    state.scale /= PHI;
    canonicalize();
}
function rebaseOut() {
    state.pinned = null;
    state.gamma = coarseGamma(state.gamma);
    state.cx /= -PHI; state.cy /= -PHI;
    state.angle += Math.PI;
    state.scale *= PHI;
    canonicalize();
}

/** Called when the user zooms by hand in deflate mode. */
export function deflateRebase() {
    if (motion.mode !== 'deflate' || motion.tween) return;
    let guard = 0;
    while (state.scale >= motion.zoomLo * PHI && guard++ < 8) rebaseIn();
    while (state.scale < motion.zoomLo && guard++ < 16) rebaseOut();
}

/** Fraction of the way to the next deflation, in [0, 1). */
export function deflateFrac() {
    if (motion.mode !== 'deflate' || motion.tween) return 0;
    return Math.log(state.scale / motion.zoomLo) / Math.log(PHI);
}

/* ---- mode switching ----------------------------------------------- */
export function setMode(mode) {
    if (!MODES[mode]) mode = 'still';
    const prev = motion.mode;
    motion.mode = mode;
    state.motion = mode;
    field.kind = mode === 'wave' ? 'wave' : mode === 'ripples' ? 'ripples' : null;
    field.stamp++;
    if (mode !== 'ripples') field.drops = [];
    if (prev === 'deflate' && mode !== 'deflate') motion.zoomLo = 30;

    if (mode === 'orbit') {
        motion.orbit = { center: state.gamma.slice(), th: 0 };
    } else if (mode === 'bloom') {
        // collapse to the symmetric line γ = (c, …, c), keeping Σγ
        const c = sigma() / 5;
        const c0 = c - Math.floor(c);
        motion.bloom = c0;
        tweenTo([c0, c0, c0, c0, c0], 1.4);
    } else if (mode === 'deflate') {
        const s = sigma();
        const d = (Math.round(s) - s) / 5;
        motion.zoomLo = clampLo(state.scale);
        if (Math.abs(d) > 1e-9) tweenTo(state.gamma.map(g => g + d), 0.8);
    } else if (mode === 'ripples') {
        motion.lastDrop = -10;
    }
    if (mode === 'wander') state.wanderVel = [0, 0, 0, 0, 0];
}

/** Re-anchor modes that remember where they started (after a slider drag). */
export function reanchor() {
    if (motion.mode === 'orbit') motion.orbit = { center: state.gamma.slice(), th: 0 };
    if (motion.mode === 'bloom') motion.bloom = sigma() / 5 - Math.floor(sigma() / 5);
}

/* ---- per-frame update --------------------------------------------- *
 * Returns true while something is moving. */
export function stepMotion(dt) {
    let moving = false;
    const sp = state.speed;
    if (motion.tween) {
        stepTween(dt);
        gammaChanged();
        moving = true;
    }
    if (state.drift && !state.paused) {
        motion.driftDir += (Math.random() - 0.5) * 0.6 * dt + 0.04 * dt;
        const v = 0.9 * sp;
        state.cx += Math.cos(motion.driftDir) * v * dt;
        state.cy += Math.sin(motion.driftDir) * v * dt;
        state.angle += 0.018 * sp * dt;
        moving = true;
    }
    if (motion.mode === 'deflate') deflateRebase();
    if (state.paused || motion.tween) return moving || !!motion.tween;

    switch (motion.mode) {
        case 'wander': stepWander(dt * 60); gammaChanged(); return true;
        case 'orbit': {
            const O = motion.orbit;
            O.th += dt * sp * 0.32;
            const r = 0.06 + 0.5 * state.amp;
            const ux = r * (Math.cos(O.th) - 1), uy = r * Math.sin(O.th);
            for (let i = 0; i < N; i++) state.gamma[i] = O.center[i] + ux * Ei[i][0] + uy * Ei[i][1];
            gammaChanged();
            return true;
        }
        case 'bloom': {
            motion.bloom += dt * sp * 0.022;
            if (motion.bloom >= 1) { motion.bloom -= 1; resetTracking(); }
            for (let i = 0; i < N; i++) state.gamma[i] = motion.bloom;
            gammaChanged();
            return true;
        }
        case 'wave': {
            field.A = 0.04 + 0.32 * state.amp;
            field.phase += dt * sp * 1.1;
            field.nAng += dt * sp * 0.021;
            field.dAng += dt * sp * 0.047;
            field.stamp++;
            return true;
        }
        case 'ripples': {
            const R = Math.hypot(view.W, view.H) / (2 * state.scale) / 2.5 + 4;
            const alive = stepRipples(dt, sp, R);
            if (field.t - motion.lastDrop > 3.2 / Math.max(0.2, sp)) autoDrop();
            field.stamp++;
            return alive || true;
        }
        case 'deflate': {
            state.scale *= Math.pow(PHI, dt * sp * 0.13);
            deflateRebase();
            return true;
        }
    }
    return moving;
}

function autoDrop() {
    motion.lastDrop = field.t;
    const R = Math.min(view.W, view.H) / (2 * state.scale) * 0.8;
    const a = Math.random() * 2 * Math.PI, r = R * Math.sqrt(Math.random());
    const [x, y] = worldToGrid(state.gamma, state.cx + r * Math.cos(a), state.cy + r * Math.sin(a));
    dropRipple(x, y, 0.05 + 0.22 * state.amp);
}

/** User click in ripples mode. */
export function userRipple(wx, wy) {
    const [x, y] = worldToGrid(state.gamma, wx, wy);
    dropRipple(x, y, 0.05 + 0.22 * state.amp);
    motion.lastDrop = field.t;
    field.stamp++;
}

/* ---- wander: the original damped random walk ---------------------- */
const DAMPING = 0.985, BASE_FORCE = 0.00045, MAX_VEL = 0.02;
const BOUND_SOFT = 0.06, BOUND_PUSH = 0.0009, MARGIN = 0.001;

function gauss() {
    const u = Math.max(1e-12, Math.random());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

function stepWander(steps) {
    const speed = state.speed;
    const force = BASE_FORCE * speed;
    const velCap = MAX_VEL * Math.max(0.2, speed);
    const n = Math.max(1, Math.round(steps));
    for (let s = 0; s < n; s++) {
        for (let k = 0; k < N; k++) {
            let g = state.gamma[k] - Math.floor(state.gamma[k]);
            const base = state.gamma[k] - g;
            state.wanderVel[k] += gauss() * force;
            if (g < BOUND_SOFT) state.wanderVel[k] += BOUND_PUSH * speed;
            if (g > 1 - BOUND_SOFT) state.wanderVel[k] -= BOUND_PUSH * speed;
            state.wanderVel[k] *= DAMPING;
            state.wanderVel[k] = Math.max(-velCap, Math.min(velCap, state.wanderVel[k]));
            g += state.wanderVel[k] * (steps / n);
            if (g < MARGIN) { g = MARGIN; state.wanderVel[k] = Math.abs(state.wanderVel[k]); }
            if (g > 1 - MARGIN) { g = 1 - MARGIN; state.wanderVel[k] = -Math.abs(state.wanderVel[k]); }
            state.gamma[k] = base + g;
        }
    }
}
