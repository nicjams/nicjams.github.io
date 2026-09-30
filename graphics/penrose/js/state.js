/* ------------------------------------------------------------------ *
 *  Shared state and the frame scheduler.
 * ------------------------------------------------------------------ */

import { N, E, Ei, PHI, gammaSum } from './tiling.js';
export { N, E, Ei, PHI };

export const state = {
    gamma: [0.2, 0.2, 0.2, 0.2, 0.2],
    scale: 30,                        // px per unit edge
    cx: 0, cy: 0,                     // world coord of viewport center
    angle: 0,                         // view rotation (radians)

    scheme: 'type',
    palette: 'gold',
    style: 'flat',
    ribbons: false,                   // de Bruijn ribbon overlay
    arcs: false,                      // matching-arc overlay

    motion: 'still',
    speed: 1,
    amp: 0.5,
    paused: false,
    drift: false,                     // camera drift
    flip: 'slide',                    // slide | launch | instant
    glow: true,

    wanderVel: [0, 0, 0, 0, 0],
    hover: null,                      // key of hovered tile
    pinned: null,                     // { key, famA, kA, famB, kB } — lit ribbons
};

export const view = { W: 0, H: 0, DPR: 1 };

/* Draw scheduler — render.js registers the frame fn; the loop keeps running
 * while anything is moving and otherwise sleeps until schedule(). */
let frameFn = null;
let raf = 0;
let last = 0;

export function setFrameFn(fn) { frameFn = fn; }

export function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(tick);
}

function tick(now) {
    raf = 0;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
    last = now;
    const again = frameFn ? frameFn(dt, now) : false;
    if (again) schedule();
    else last = 0;
}

/* ---- γ bookkeeping ------------------------------------------------ *
 * Adding an integer vector m to γ translates the tiling by Σ m_i e_i, so
 * we can always pick the representative of γ nearest a target and move
 * the camera to compensate — no visible jump.
 */
const resetListeners = [];
export function onTrackingReset(fn) { resetListeners.push(fn); }
export function gammaChanged() { schedule(); }
/** The next tiling is not a continuous continuation of this one: skip flip detection. */
export function resetTracking() { for (const f of resetListeners) f(); }

/** Translate γ by an integer vector m and move the camera so nothing moves on screen. */
export function shiftGamma(m) {
    let dx = 0, dy = 0, any = false;
    for (let i = 0; i < N; i++) {
        if (!m[i]) continue;
        any = true;
        state.gamma[i] += m[i];
        dx += m[i] * E[i][0];
        dy += m[i] * E[i][1];
    }
    if (!any) return;
    state.cx += dx;
    state.cy += dy;
    // ribbon (family f, line k) is now line k + m_f
    const p = state.pinned;
    if (p) { p.ka += m[p.fa]; p.kb += m[p.fb]; }
    resetTracking();
}

/** Bring every γ_i into [0, 1). */
export function normalizeGamma() {
    shiftGamma(state.gamma.map(g => -Math.floor(g)));
}

export function sigma() { return gammaSum(state.gamma); }
