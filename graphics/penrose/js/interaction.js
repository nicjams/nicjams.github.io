/* ------------------------------------------------------------------ *
 *  Pan, wheel/pinch zoom, hover, and click on the canvas.
 *  Screen ↔ world respects the view rotation.
 * ------------------------------------------------------------------ */

import { state, schedule } from './state.js';
import { currentMode, userRipple, deflateRebase } from './motion.js';

const MIN_SCALE = 5;
const MAX_SCALE = 260;

export const pointer = { world: null, inside: false };

/** Screen offset from the canvas center (y down) → world delta. */
function screenToWorldDelta(dx, dy) {
    const c = Math.cos(state.angle), s = Math.sin(state.angle);
    // screen = R(θ)·w·scale with y flipped; invert
    const X = dx / state.scale, Y = -dy / state.scale;
    return [c * X + s * Y, -s * X + c * Y];
}

function clientToWorld(canvas, clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const [dx, dy] = screenToWorldDelta(clientX - rect.left - rect.width / 2, clientY - rect.top - rect.height / 2);
    return [state.cx + dx, state.cy + dy];
}

function zoomAt(canvas, factor, clientX, clientY) {
    const [wx, wy] = clientToWorld(canvas, clientX, clientY);
    // keep the rhombus count manageable on very large displays
    const minS = Math.max(MIN_SCALE, Math.sqrt(canvas.clientWidth * canvas.clientHeight / 36000));
    const lo = currentMode() === 'deflate' ? 1 : minS, hi = currentMode() === 'deflate' ? 1e9 : MAX_SCALE;
    const ns = Math.max(lo, Math.min(hi, state.scale * factor));
    const k = state.scale / ns;
    state.cx = wx + (state.cx - wx) * k;
    state.cy = wy + (state.cy - wy) * k;
    state.scale = ns;
    deflateRebase();
}

export function initInteraction(canvas, onPick) {
    let dragging = false, lx = 0, ly = 0, moved = 0;
    const pointers = new Map();
    let lastDist = 0;

    canvas.addEventListener('pointerdown', e => {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 1) {
            dragging = true;
            moved = 0;
            lx = e.clientX; ly = e.clientY;
            canvas.classList.add('dragging');
            try { canvas.setPointerCapture(e.pointerId); } catch { }
        } else {
            dragging = false;
            moved = 99;
        }
    });

    canvas.addEventListener('pointermove', e => {
        if (e.pointerType === 'mouse' || !pointers.size) {
            pointer.world = clientToWorld(canvas, e.clientX, e.clientY);
            pointer.inside = true;
            if (!dragging) schedule();
        }
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (pointers.size === 2) {
            const pts = [...pointers.values()];
            const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
            const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
            if (lastDist > 0) {
                zoomAt(canvas, dist / lastDist, mid.x, mid.y);
                schedule();
            }
            lastDist = dist;
            return;
        }

        if (dragging) {
            const dx = e.clientX - lx, dy = e.clientY - ly;
            moved += Math.abs(dx) + Math.abs(dy);
            lx = e.clientX; ly = e.clientY;
            const [wx, wy] = screenToWorldDelta(dx, dy);
            state.cx -= wx;
            state.cy -= wy;
            schedule();
        }
    });

    const endPointer = e => {
        const wasClick = dragging && moved < 5 && pointers.size === 1;
        pointers.delete(e.pointerId);
        lastDist = 0;
        if (pointers.size === 0) {
            dragging = false;
            canvas.classList.remove('dragging');
        }
        try { canvas.releasePointerCapture(e.pointerId); } catch { }
        if (wasClick && e.type === 'pointerup') {
            const [wx, wy] = clientToWorld(canvas, e.clientX, e.clientY);
            if (currentMode() === 'ripples') userRipple(wx, wy);
            else onPick(wx, wy);
            schedule();
        }
    };
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('pointerleave', () => { pointer.inside = false; pointer.world = null; schedule(); });

    canvas.addEventListener('wheel', e => {
        e.preventDefault();
        zoomAt(canvas, Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
        schedule();
    }, { passive: false });
}
