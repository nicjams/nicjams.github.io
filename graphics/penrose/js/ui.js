/* ------------------------------------------------------------------ *
 *  Sidebar controls, legend, readout, keyboard.
 * ------------------------------------------------------------------ */

import { N, E, state, schedule, gammaChanged, normalizeGamma, sigma, resetTracking } from './state.js';
import { PAIRS, gammaPerp } from './tiling.js';
import { PALETTES, PALETTE_ORDER, css, shade, levelColors, mutedOf, orientColors, axisOf } from './colors.js';
import { CAPTIONS, setMode, tweenTo, reanchor, currentMode } from './motion.js';
import { flips } from './flips.js';

const SCHEME_CAPTIONS = {
    type: 'Fat rhombi (72°/108°) and thin ones (36°/144°). Every Penrose tiling has φ ≈ 1.618 fat rhombi for each thin one.',
    orient: 'Hue follows each rhombus’s long axis. Fat rhombi point along multiples of 36° and thin ones halfway between, so there are ten directions.',
    ribbons: 'Each pentagrid line becomes a ribbon of rhombi that share parallel edges. The five colors are the five families of ribbons, and every rhombus is where two of them cross.',
    supertiles: 'Scaled up by the golden ratio φ, the vertices of a Penrose tiling are a subset of another Penrose tiling’s vertices. The big rhombi are those supertiles; the fine lines are the tiling itself, and some fine rhombi are cut in half along supertile edges. Only true Penrose tilings (Σγ an integer) have supertiles.',
    stability: 'Brightness is how far γ⊥ can move before the rhombus flips. Dark rhombi sit near the edge of an acceptance window and flip first.',
    level: 'The index ΣK − Σγ of each rhombus’s base vertex is 1 or 2 in a true Penrose tiling. It sets which way the matching-rule arrow points and where the matching arcs sit.',
    cubes: 'Three rhombi around a degree-3 vertex make a hexagon that reads as a cube: the shadow of three faces of a unit cube in ℤ⁵. A flip turns the cube inside out.',
};

const PRESETS = {
    sunny: () => [0.2, 0.2, 0.2, 0.2, 0.2],
    starry: () => [0.4, 0.4, 0.4, 0.4, 0.4],
    half: () => [0.5, 0.5, 0.5, 0.5, 0.5],
    graded: () => [0.1, 0.3, 0.5, 0.7, 0.9],
    cartwheel: () => [0, 0, 0, 0, 0],
    generic: () => [0.13, 0.41, 0.27, 0.82, 0.56],
    random: () => state.gamma.map(() => Math.random()),
};

let slidersDiv;
const $ = id => document.getElementById(id);

export function initUI() {
    slidersDiv = $('sliders');
    buildSliders();
    buildPalettes();
    bindRadios('motion', v => { setMode(v); showMotion(); });
    bindRadios('scheme', v => { state.scheme = v; showScheme(); });
    bindRadios('palette', v => { state.palette = v; showScheme(); });
    bindRadios('style', v => { state.style = v; schedule(); });
    bindRange('speed', v => { state.speed = v; }, 2);
    bindRange('amp', v => { state.amp = v; }, 2);
    bindCheck('glow', v => { state.glow = v; });
    bindCheck('drift', v => { state.drift = v; });
    bindCheck('ribbonsOverlay', v => { state.ribbons = v; showScheme(); });
    bindCheck('arcsOverlay', v => { state.arcs = v; showScheme(); });
    $('flipStyle').addEventListener('change', e => { state.flip = e.target.value; });
    $('pauseBtn').addEventListener('click', togglePause);
    $('snapBtn').addEventListener('click', snapClassical);
    $('resetView').addEventListener('click', resetView);
    $('sigma').addEventListener('input', e => {
        const s = sigma();
        const base = Math.floor(s / 5) * 5;
        const d = (+e.target.value + base - s) / 5;
        for (let i = 0; i < N; i++) state.gamma[i] += d;
        leaveDeflateIfGeneralized(state.gamma);
        reanchor();
        gammaChanged();
    });
    document.querySelectorAll('[data-preset]').forEach(btn => {
        btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
    });
    window.addEventListener('keydown', onKey);
    showProj();
    showMotion();
    showScheme();
}

/* ---- generic bindings ------------------------------------------- */
function bindRadios(name, fn) {
    document.querySelectorAll(`input[name="${name}"]`).forEach(r => {
        r.addEventListener('change', () => { if (r.checked) { fn(r.value); schedule(); } });
    });
}
function setRadio(name, value) {
    const r = document.querySelector(`input[name="${name}"][value="${value}"]`);
    if (r && !r.checked) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
}
function bindRange(id, fn, digits) {
    const inp = $(id), out = $(id + 'Val');
    const sync = () => { fn(+inp.value); if (out) out.textContent = (+inp.value).toFixed(digits); schedule(); };
    inp.addEventListener('input', sync);
    sync();
}
function bindCheck(id, fn) {
    const inp = $(id);
    inp.addEventListener('change', () => { fn(inp.checked); schedule(); });
    fn(inp.checked);
}

/* ---- γ sliders --------------------------------------------------- */
function buildSliders() {
    for (let i = 0; i < N; i++) {
        const row = document.createElement('div');
        row.className = 'slider-row';
        row.innerHTML = `
      <label class="name" for="gamma${i}">γ<sub>${i}</sub></label>
      <input type="range" id="gamma${i}" min="0" max="1" step="0.001" value="${state.gamma[i]}" data-i="${i}">
      <span class="val" data-val="${i}">${state.gamma[i].toFixed(3)}</span>`;
        slidersDiv.appendChild(row);
    }
    slidersDiv.addEventListener('input', e => {
        if (e.target.dataset.i === undefined) return;
        const i = +e.target.dataset.i;
        const v = +e.target.value;
        // nearest representative: moving a slider never jumps the tiling
        state.gamma[i] = v + Math.round(state.gamma[i] - v);
        state.wanderVel[i] = 0;
        leaveDeflateIfGeneralized(state.gamma);
        reanchor();
        gammaChanged();
    });
}

let lastSync = '';
function syncSliders() {
    const key = state.gamma.map(g => g.toFixed(4)).join();
    if (key === lastSync) return;
    lastSync = key;
    for (let i = 0; i < N; i++) {
        const f = state.gamma[i] - Math.floor(state.gamma[i]);
        const inp = $('gamma' + i);
        if (document.activeElement !== inp) inp.value = f;
        slidersDiv.querySelector(`[data-val="${i}"]`).textContent = f.toFixed(3);
    }
    const s = sigma();
    const sm = s - Math.floor(s / 5) * 5;
    const sg = $('sigma');
    if (document.activeElement !== sg) sg.value = sm;
    $('sigmaVal').textContent = sm.toFixed(3);
    const [px, py] = gammaPerp(state.gamma);
    const f3 = v => (Math.abs(v) < 5e-4 ? 0 : v).toFixed(3);
    $('perpVal').textContent = `(${f3(px)}, ${f3(py)})`;
    const classical = Math.abs(s - Math.round(s)) < 5e-4;
    const tag = $('classTag');
    tag.textContent = classical ? 'classical Penrose' : 'generalized';
    $('sumPill').classList.toggle('integer', classical);
    $('snapBtn').disabled = classical;
}

/* ---- palette swatches ------------------------------------------- */
function buildPalettes() {
    const box = $('paletteChips');
    for (const k of PALETTE_ORDER) {
        const P = PALETTES[k];
        const lab = document.createElement('label');
        lab.className = 'swatch';
        lab.title = P.name;
        lab.innerHTML = `<input type="radio" name="palette" value="${k}" ${k === state.palette ? 'checked' : ''}>` +
            `<i><b style="--a:${css(P.fat)};--b:${css(P.thin)};--c:${P.fiveHex[1]};--d:${P.fiveHex[4]}"></b>${P.name}</i>`;
        box.appendChild(lab);
    }
}

/* ---- captions & legend ------------------------------------------ */
function showMotion() {
    $('motionCaption').textContent = CAPTIONS[state.motion] || '';
    $('pauseBtn').disabled = state.motion === 'still';
    document.body.dataset.motion = state.motion;
    schedule();
}

function showScheme() {
    $('schemeCaption').textContent = SCHEME_CAPTIONS[state.scheme] || '';
    const P = PALETTES[state.palette];
    $('stage').classList.toggle('light', P.light);
    buildLegend(P);
    schedule();
}

const SVGNS = 'http://www.w3.org/2000/svg';
function rhombSVG(angleDeg, fat, fill, stroke, s = 13) {
    // long axis along angleDeg; fat: 72° acute angle; thin: 36°
    const half = (fat ? 36 : 18) * Math.PI / 180;
    const a = angleDeg * Math.PI / 180;
    const L = Math.cos(half) * s, W = Math.sin(half) * s;
    const ux = Math.cos(a), uy = -Math.sin(a), vx = -uy, vy = ux;
    const pts = [[L * ux, L * uy], [W * vx, W * vy], [-L * ux, -L * uy], [-W * vx, -W * vy]];
    return `<svg viewBox="${-s} ${-s} ${2 * s} ${2 * s}" width="${s + 5}" height="${s + 5}"><polygon points="${pts.map(p => p.map(v => v.toFixed(2)).join(',')).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="0.9"/></svg>`;
}

function buildLegend(P) {
    const box = $('legend');
    let h = '';
    const row = (sw, txt) => `<div class="row">${sw}<span>${txt}</span></div>`;
    switch (state.scheme) {
        case 'type':
            h += row(rhombSVG(54, true, css(P.fat), css(P.fatLine)), 'fat · 72°/108°');
            h += row(rhombSVG(54, false, css(P.thin), css(P.thinLine)), 'thin · 36°/144°');
            break;
        case 'orient': {
            const O = orientColors(P);
            let sw = '';
            for (let q = 0; q < 10; q++) {
                // fat rhombi point along multiples of 36°, thin ones in between
                const fat = q % 2 === 0;
                const p = PAIRS.findIndex((pp, k) => pp.fat === fat && Math.abs(axisOf(k) * 180 - q * 18) < 1);
                sw += rhombSVG(q * 18, fat, css(O.fill[p]), css(O.line[p]), 11);
            }
            h += `<div class="row fan">${sw}</div><div class="row"><span>tone turns with the long axis</span></div>`;
            break;
        }
        case 'ribbons': {
            let sw = '';
            for (let j = 0; j < N; j++) sw += `<i class="bar" style="background:${css(P.fam[j])}"></i>`;
            h += `<div class="row">${sw}<span>ribbon families e₀ … e₄</span></div>`;
            break;
        }
        case 'supertiles':
            h += row(rhombSVG(54, true, css(P.fat), css(shade(P.fat, -0.25)), 15) + rhombSVG(54, false, css(P.thin), css(shade(P.thin, -0.25)), 15), 'supertiles, φ× larger');
            h += row('<i class="bar thin"></i>', 'rhombi of the tiling');
            break;
        case 'stability':
            h += `<div class="row"><i class="ramp" style="background:linear-gradient(90deg, ${P.rampStops.join(',')})"></i></div>`;
            h += `<div class="row ends"><span>flips soon</span><span>stable</span></div>`;
            break;
        case 'level': {
            const c = levelColors(P);
            h += row(rhombSVG(54, true, css(c[0]), css(shade(c[0], -0.1))) + rhombSVG(54, true, css(c[1]), css(shade(c[1], -0.1))), 'fat · index 1 / 2');
            h += row(rhombSVG(54, false, css(c[2]), css(shade(c[2], -0.1))) + rhombSVG(54, false, css(c[3]), css(shade(c[3], -0.1))), 'thin · index 1 / 2');
            break;
        }
        case 'cubes':
            h += row(['top', 'left', 'right'].map((_, q) => `<i class="sq" style="background:${css(P.cube[q])}"></i>`).join(''), 'cube faces: top, left, right');
            h += row(`<i class="sq" style="background:${css(mutedOf(P, 'fat', 0.3))}"></i><i class="sq" style="background:${css(mutedOf(P, 'thin', 0.3))}"></i>`, 'not part of a cube');
            break;
    }
    if (state.arcs) {
        h += row(`<i class="arc" style="border-color:${css(P.arcs[0])}"></i><i class="arc small" style="border-color:${css(P.arcs[1])}"></i>`, 'matching arcs');
    }
    if (state.ribbons && state.scheme !== 'ribbons') {
        let sw = '';
        for (let j = 0; j < N; j++) sw += `<i class="bar" style="background:${css(P.fam[j])}"></i>`;
        h += `<div class="row">${sw}<span>ribbons</span></div>`;
    }
    box.innerHTML = h;
}

/* ---- HUD --------------------------------------------------------- */
const SUB = '₀₁₂₃₄';
let hudKey = '';
export function updateHUD(info) {
    $('rhombCount').textContent = info.count.toLocaleString() + ' rhombi';
    const fc = $('flipCount');
    fc.textContent = flips.count ? ` · ${flips.count.toLocaleString()} flips` : '';
    syncSliders();

    let h = `<b>center</b> (${state.cx.toFixed(2)}, ${state.cy.toFixed(2)})<br>` +
        `<b>scale</b> ${state.scale.toFixed(1)} px/edge`;
    const deg = ((state.angle * 180 / Math.PI) % 360 + 360) % 360;
    if (deg > 0.05 && deg < 359.95) h += ` · ${deg.toFixed(0)}°`;
    if (info.hover) {
        const t = info.hover;
        const { j, jp, fat } = PAIRS[t.pair];
        h += `<br><b>${fat ? 'fat' : 'thin'}</b> e${SUB[j]} ∧ e${SUB[jp]} · index ${t.level}` +
            `<br><b>lift</b> (${t.K.join(', ')})` +
            `<br><b>ribbons</b> L${SUB[j]},${t.K[j]} × L${SUB[jp]},${t.K[jp]}`;
    }
    if (h !== hudKey) { $('readout').innerHTML = h; hudKey = h; }
}

/* ---- actions ----------------------------------------------------- */
/** Deflation needs supertiles, which only classical tilings (integer Σγ) have. */
function leaveDeflateIfGeneralized(g) {
    const s = g.reduce((a, b) => a + b, 0);
    if (currentMode() === 'deflate' && Math.abs(s - Math.round(s)) > 1e-6) setRadio('motion', 'still');
}

function applyPreset(name) {
    const target = PRESETS[name]();
    leaveDeflateIfGeneralized(target);
    tweenTo(target, name === 'random' ? 1.3 : 1.1);
    if (currentMode() === 'bloom' || currentMode() === 'orbit') setRadio('motion', 'still');
    schedule();
}

function snapClassical() {
    const s = sigma();
    const d = (Math.round(s) - s) / 5;
    tweenTo(state.gamma.map(g => g + d), 0.7);
    schedule();
}

function resetView() {
    normalizeGamma();
    state.cx = 0; state.cy = 0; state.scale = 30; state.angle = 0;
    resetTracking();
    schedule();
}

function togglePause() {
    state.paused = !state.paused;
    $('pauseBtn').textContent = state.paused ? 'Resume' : 'Pause';
    $('pauseBtn').classList.toggle('active', state.paused);
    schedule();
}

function cycleRadio(name) {
    const rs = [...document.querySelectorAll(`input[name="${name}"]`)];
    const i = rs.findIndex(r => r.checked);
    setRadio(name, rs[(i + 1) % rs.length].value);
}

function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'select' || tag === 'textarea' || (tag === 'input' && e.target.type === 'text')) return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); togglePause(); }
    else if (k === 'm') cycleRadio('motion');
    else if (k === 'k') cycleRadio('scheme');
    else if (k === 'p') cycleRadio('palette');
    else if (k === 'g') { const c = $('ribbonsOverlay'); c.checked = !c.checked; c.dispatchEvent(new Event('change')); }
    else if (k === 'a') { const c = $('arcsOverlay'); c.checked = !c.checked; c.dispatchEvent(new Event('change')); }
    else if (k === 'r') applyPreset('random');
    else if (k === '0') resetView();
}

function showProj() {
    const div = $('projMat');
    let html = '';
    for (let k = 0; k < N; k++) html += `<span>${E[k][0].toFixed(2)}</span>`;
    for (let k = 0; k < N; k++) html += `<span>${E[k][1].toFixed(2)}</span>`;
    div.innerHTML = html;
}

