// main.js — UI, the frame loop, telemetry, and the braid panel.

import { View } from './render.js';
import { SCENES, KNOTS } from './scenes.js';
import { drawBraid } from './diagram.js';
import { drawBarrierPlot, sparkline } from './theory.js';
import * as BR from './braid.js';

const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const view = new View(canvas);

const ABOUT = {
  braid: 'Weighted beads hang on rails below a bar. Each generator <b>σᵢ</b> is a half-twist of the bottom pins at positions i and i+1; the left one passes in front. The solver never lets two strands cross, so the braid read back from the geometry must equal the word you typed.',
  knot: 'A loose knot in one rope is pulled tight by its ends. With every step CCD-filtered, no strand can slip through another. The knot type is preserved all the way to a tight knot.',
  rope: 'Strands between two clamps with the bottom clamp spinning, after ppf’s <b>twist</b> scene. One turn of the clamp is the full twist Δ², the generator of the centre of Bₙ.',
  noodles: 'Long strands dropped into a bowl, after ppf’s <b>noodle</b> scene. Hundreds of contacts settle into a pile without a single intersection.',
};

// per-scene defaults for the shared solver sliders
const SCENE_DEFAULTS = {
  braid: { friction: 0.08 },
  knot: { friction: 0.25 },
  rope: { friction: 0.08 },
  noodles: { friction: 0.3 },
};

const PRESETS = [
  { label: 'Plait (σ₁σ₂⁻¹)⁴ — a hair braid', n: 3, word: [1, -2, 1, -2, 1, -2, 1, -2] },
  { label: 'Braid relation σ₁σ₂σ₁·(σ₂σ₁σ₂)⁻¹ = e', n: 3, word: [1, 2, 1, -2, -1, -2] },
  { label: 'Trefoil closure σ₁³', n: 2, word: [1, 1, 1] },
  { label: 'Figure-eight (σ₁σ₂⁻¹)²', n: 3, word: [1, -2, 1, -2] },
  { label: 'Borromean rings (σ₁σ₂⁻¹)³', n: 3, word: [1, -2, 1, -2, 1, -2] },
  { label: 'Cinquefoil σ₁⁵', n: 2, word: [1, 1, 1, 1, 1] },
  { label: 'Torus knot T(3,4) = (σ₁σ₂)⁴', n: 3, word: [1, 2, 1, 2, 1, 2, 1, 2] },
  { label: 'Three-twist 5₂: σ₁³σ₂σ₁⁻¹σ₂', n: 3, word: [1, 1, 1, 2, -1, 2] },
  { label: 'Full twist Δ² on 4 strands', n: 4, delta: 2 },
  { label: 'Far commutation σ₁σ₃·(σ₃σ₁)⁻¹ = e', n: 4, word: [1, 3, -1, -3] },
  { label: 'Random word (length 8)', random: 8 },
];

const state = {
  id: 'braid',
  sc: null,
  running: true,
  speed: 1,
  simClock: 0,
  hist: { gap: [], toi: [] },
  frameStats: [],
  rt: { sim: 0, wall: 0, ratio: 1 },
  braidVersion: -1,
  lastProgress: -1,
  readback: null,
  readAt: 0,
  drag: null,
};

// ------------------------------------------------------------ controls

const num = (id) => parseFloat($(id).value);
const checked = (id) => $(id).checked;

function solverParams() {
  return {
    barrier: $('barrier').value,
    dynamicStiffness: checked('dynK'),
    ccd: checked('ccd'),
    friction: num('friction'),
    ghat: num('ghat') / 1000,
  };
}

function sceneOptions(id) {
  if (id === 'braid') return { n: num('nStrands'), beadMass: num('beadMass'), twistTime: num('twistTime') };
  if (id === 'knot') return { knot: $('knotType').value, pull: num('pull'), loose: num('loose') };
  if (id === 'rope') return { n: num('ropeN'), speed: num('spinSpeed'), spin: checked('spin') };
  return { count: num('noodleCount'), length: num('noodleLength') };
}

function build(id = state.id, { keepCamera = false } = {}) {
  state.id = id;
  const sc = new SCENES[id](sceneOptions(id));
  sc.build(solverParams());
  applyStrainLimit(sc.sim);
  state.sc = sc;
  state.simClock = sc.sim.t;
  state.hist = { gap: [], toi: [] };
  state.readback = null;
  state.braidVersion = -1;
  view.setScene(sc, keepCamera);
  state.follow = !!view.dec.follow;
  view.setColorMode($('colorMode').value);
  view.showContacts = checked('showContacts');
  document.querySelectorAll('.scene-opts').forEach((el) => { el.hidden = el.dataset.scene !== id; });
  $('about').innerHTML = ABOUT[id];
  $('braidPanel').hidden = id !== 'braid';
  document.body.classList.toggle('braid', id === 'braid');
  if (id === 'braid') buildGenPad();
  return sc;
}

function applyStrainLimit(sim) {
  const tau = num('strainLimit') / 100;
  sim.eLim.fill(tau);
  for (const s of sim.strands) s.strainLimit = tau;
}

function bindRange(id, fmt, onInput) {
  const el = $(id), badge = $(id + 'V');
  const show = () => { if (badge) badge.textContent = fmt(parseFloat(el.value)); };
  el.addEventListener('input', () => { show(); onInput?.(parseFloat(el.value)); });
  show();
}

// scene picker
document.querySelectorAll('input[name=scene]').forEach((r) => r.addEventListener('change', () => {
  if (!r.checked) return;
  const d = SCENE_DEFAULTS[r.value];
  $('friction').value = d.friction;
  $('friction').dispatchEvent(new Event('input'));
  build(r.value);
}));

// braid
bindRange('nStrands', (v) => `${v}`, () => build('braid', { keepCamera: false }));
bindRange('beadMass', (v) => `${Math.round(v * 1000)} g`, (v) => {
  const sc = state.sc;
  if (state.id !== 'braid') return;
  const dm = v - sc.o.beadMass;
  sc.o.beadMass = v;
  for (const b of sc.beads) sc.sim.mass[b] += dm;
});
bindRange('twistTime', (v) => `${v.toFixed(2)} s`, (v) => { if (state.id === 'braid') state.sc.o.twistTime = v; });

// knot
for (const [k, label] of Object.entries(KNOTS)) {
  const o = document.createElement('option');
  o.value = k; o.textContent = label;
  $('knotType').appendChild(o);
}
$('knotType').addEventListener('change', () => build('knot'));
bindRange('pull', (v) => `${Math.round(v * 100)}%`, (v) => { if (state.id === 'knot') state.sc.o.pull = v; });
bindRange('loose', (v) => v.toFixed(1), () => build('knot', { keepCamera: true }));

// rope
bindRange('ropeN', (v) => `${v}`, () => build('rope', { keepCamera: true }));
bindRange('spinSpeed', (v) => `${v.toFixed(2)} rev/s`, (v) => { if (state.id === 'rope') state.sc.o.speed = v; });
$('spin').addEventListener('change', () => { if (state.id === 'rope') state.sc.o.spin = checked('spin'); });

// noodles
bindRange('noodleCount', (v) => `${v}`, () => build('noodles', { keepCamera: true }));
bindRange('noodleLength', (v) => `${v.toFixed(1)} m`, () => build('noodles', { keepCamera: true }));

// solver
const sim = () => state.sc.sim;
$('barrier').addEventListener('change', () => { sim().p.barrier = $('barrier').value; });
$('dynK').addEventListener('change', () => { sim().p.dynamicStiffness = checked('dynK'); });
$('ccd').addEventListener('change', () => {
  sim().p.ccd = checked('ccd');
  $('unsafeNote').hidden = checked('ccd');
});
bindRange('friction', (v) => v.toFixed(2), (v) => { if (state.sc) sim().p.friction = v; });
bindRange('ghat', (v) => `${v} mm`, (v) => { if (state.sc) sim().p.ghat = v / 1000; });
bindRange('strainLimit', (v) => `${v}%`, () => { if (state.sc) applyStrainLimit(sim()); });

// playback & display
$('running').addEventListener('change', () => { state.running = checked('running'); state.simClock = sim().t; });
$('resetBtn').addEventListener('click', () => build(state.id, { keepCamera: true }));
bindRange('speed', (v) => `${v.toFixed(2)}×`, (v) => { state.speed = v; });
$('colorMode').addEventListener('change', () => view.setColorMode($('colorMode').value));
$('showContacts').addEventListener('change', () => { view.showContacts = checked('showContacts'); });

// panels: collapsible on desktop; on phones they are bottom sheets, one at a time
const phone = window.matchMedia('(max-width: 760px)');
function setPanel(side, open) {
  const el = side === 'left' ? $('controls') : $('braidPanel');
  el.classList.toggle('collapsed', !open);
  if (open && phone.matches) {
    const other = side === 'left' ? $('braidPanel') : $('controls');
    other.classList.add('collapsed');
  }
  document.body.classList.toggle('left-collapsed', $('controls').classList.contains('collapsed'));
  document.body.classList.toggle('right-collapsed', $('braidPanel').classList.contains('collapsed'));
}
$('collapseLeft').addEventListener('click', () => setPanel('left', false));
$('collapseRight').addEventListener('click', () => setPanel('right', false));
$('openLeft').addEventListener('click', () => setPanel('left', $('controls').classList.contains('collapsed')));
$('openRight').addEventListener('click', () => setPanel('right', $('braidPanel').classList.contains('collapsed')));
$('showUi').addEventListener('click', () => toggleUi(false));
function toggleUi(hide = !document.body.classList.contains('ui-hidden')) {
  document.body.classList.toggle('ui-hidden', hide);
  if (!hide) {
    setPanel('left', !phone.matches || state.id !== 'braid');
    if (state.id === 'braid') setPanel('right', true);
  }
  $('showUi').hidden = !hide;
}

// ------------------------------------------------------------ braid pad

function buildGenPad() {
  const n = state.sc.n, pad = $('genPad');
  pad.innerHTML = '';
  pad.style.gridTemplateColumns = `repeat(${n - 1}, 1fr)`;
  for (let i = 1; i < n; i++) {
    const col = document.createElement('div');
    col.className = 'col';
    for (const s of [1, -1]) {
      const b = document.createElement('button');
      b.className = `btn gen ${s > 0 ? 'pos' : 'neg'}`;
      b.id = `gen${s > 0 ? '' : 'Inv'}${i}`;
      b.textContent = BR.letter(s * i);
      b.title = `${s > 0 ? 'Half-twist' : 'Inverse half-twist'} of pins ${i} and ${i + 1} (${s > 0 ? '' : '⇧'}${i})`;
      b.addEventListener('click', () => state.sc.gen(s * i));
      col.appendChild(b);
    }
    pad.appendChild(col);
  }
  $('groupName').textContent = `B${BR.sub(n)}`;
}

$('deltaBtn').addEventListener('click', () => state.id === 'braid' && state.sc.delta(1, 1));
$('deltaInvBtn').addEventListener('click', () => state.id === 'braid' && state.sc.delta(-1, 1));
$('fullTwistBtn').addEventListener('click', () => state.id === 'braid' && state.sc.delta(1, 2));
$('undoBtn').addEventListener('click', () => state.id === 'braid' && state.sc.undo());
$('clearBtn').addEventListener('click', () => build('braid', { keepCamera: true }));
PRESETS.forEach((p, k) => {
  const o = document.createElement('option');
  o.value = String(k); o.textContent = p.label;
  $('preset').appendChild(o);
});
$('preset').addEventListener('change', () => {
  const p = PRESETS[+$('preset').value];
  $('preset').value = '';
  if (!p) return;
  applyPreset(p);
});

function applyPreset(p) {
  if (p.n && p.n !== num('nStrands')) {
    $('nStrands').value = p.n;
    $('nStrandsV').textContent = p.n;
    build('braid', { keepCamera: false });
  } else {
    build('braid', { keepCamera: true });
  }
  const sc = state.sc;
  if (p.delta) sc.delta(1, p.delta);
  let word = p.word;
  if (p.random) {
    word = [];
    while (word.length < p.random) {
      const g = (1 + Math.floor(Math.random() * (sc.n - 1))) * (Math.random() < 0.5 ? -1 : 1);
      if (word.length && word[word.length - 1] === -g) continue;
      word.push(g);
    }
  }
  for (const g of word || []) sc.gen(g);
}

// ------------------------------------------------------------ braid panel

let invCache = { key: '', html: '' };

function renderBraidPanel(force = false) {
  if (state.id !== 'braid') return;
  const sc = state.sc, n = sc.n;
  const prog = sc.progress();
  const progKey = prog === null ? -1 : Math.round(prog * 40);
  if (!force && sc.version === state.braidVersion && progKey === state.lastProgress) return;
  state.braidVersion = sc.version;
  state.lastProgress = progKey;
  const rows = sc.applied.map((g) => ({ g, state: 'done' }));
  const lastDone = rows.length - 1;
  if (sc.active) {
    const w = sc.active.word, u = sc.active.u;
    w.forEach((g, k) => rows.push({ g, state: 'active', u: Math.min(1, Math.max(0, u * w.length - k)) }));
  }
  for (const m of sc.queue) for (const g of m.word) rows.push({ g, state: 'queued' });
  rows.forEach((r, k) => { r.lastDone = lastDone === k ? k : -1; });
  drawBraid($('diagram'), n, rows, sc.colors);
  const wrap = $('diagramWrap');
  wrap.scrollTop = wrap.scrollHeight;

  // the word itself
  const parts = [];
  const span = (cls, txt) => `<span class="${cls}">${txt}</span>`;
  if (!rows.length) parts.push(span('empty', 'e — the trivial braid'));
  if (sc.applied.length) parts.push(span('done', BR.wordString(sc.applied)));
  if (sc.active) parts.push(span('active', sc.active.kind === 'rotate' ? `Δ${sc.active.turns === 2 ? '²' : ''}${sc.active.sign < 0 ? '⁻¹' : ''}` : BR.wordString(sc.active.word)));
  for (const m of sc.queue) parts.push(span('queued', m.kind === 'rotate' ? `Δ${m.turns === 2 ? '²' : ''}${m.sign < 0 ? '⁻¹' : ''}` : BR.wordString(m.word)));
  $('wordLine').innerHTML = parts.join('');

  const blocked = sc.blocked;
  $('blockNote').hidden = !blocked;
  if (blocked) {
    $('blockNote').textContent = sc.active.dir > 0
      ? 'Twist on hold: the strands are taut. Friction is holding the wraps (a capstan) or an edge is near its strain limit. Lower μ or the bead weight, or press Undo to unwind.'
      : 'Unwinding…';
  }

  // invariants of the committed braid
  const key = `${n}|${sc.applied.join(',')}`;
  if (key !== invCache.key) {
    const w = sc.applied;
    const nf = BR.garside(w, n);
    const perm = BR.permutation(w, n);
    const cyc = BR.cycles(perm);
    const comps = cyc.length;
    const cycStr = cyc.filter((c) => c.length > 1).map((c) => `(${c.map((k) => k + 1).join(' ')})`).join('') || 'id';
    let alex = null, alexStr = '–', knot = null;
    try {
      alex = BR.alexander(w, n);
      alexStr = BR.polyString(alex);
      if (comps === 1) knot = BR.knotName(alex);
    } catch { alexStr = '–'; }
    let tr = '–';
    if (n >= 2 && w.length <= 400) {
      const B = BR.burau(w, n);
      let t = BR.L.zero();
      for (let k = 0; k < n - 1; k++) t = BR.L.add(t, B[k][k]);
      tr = BR.polyString(t);
    }
    const rows2 = [
      ['length', `${w.length} (free-reduced ${BR.freeReduce(w).length})`],
      ['exponent sum', `${BR.exponentSum(w)}`],
      ['permutation', cycStr + (comps === n && w.length ? ' · pure braid' : '')],
      ['Garside NF', BR.garsideString(nf)],
      ['inf · sup', `${nf.p} · ${nf.p + nf.factors.length}`],
      ['tr Burau', tr],
      ['closure', comps === 1 ? 'a knot' : `a link, ${comps} components`],
      ['Alexander Δ(t)', alexStr],
    ];
    let html = rows2.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    if (knot) html += `<dt>matches</dt><dd class="knot">${knot}</dd>`;
    invCache = { key, html };
  }
  $('invariants').innerHTML = invCache.html;
  renderReadback();
}

function renderReadback() {
  const el = $('readback'), sc = state.sc;
  const rb = state.readback;
  if (sc.busy) {
    el.innerHTML = '<span class="muted">Reading the braid back from the geometry after the move…</span>';
    return;
  }
  if (!rb) { el.innerHTML = ''; return; }
  const w = BR.freeReduce(rb.word);
  const shown = w.length > 40 ? BR.wordString(w.slice(0, 40)) + '…' : BR.wordString(w, 'e');
  const verdict = rb.equal
    ? '<span class="ok">✓ equal</span> to the applied braid (same Garside normal form)'
    : '<span class="bad">✗ differs</span> from the applied braid. The strands passed through each other.';
  const note = rb.upward > 0.02 ? ' <span class="muted">(a strand loops upward; read-back approximate)</span>' : '';
  el.innerHTML = `Read from the simulated strands: <code>${shown}</code><br>${verdict}${note}`;
}

function updateReadback(now) {
  const sc = state.sc;
  if (state.id !== 'braid' || sc.busy || now - state.readAt < 500) return;
  state.readAt = now;
  const s = sc.sim;
  const yb = Math.min(...sc.beads.map((v) => s.x[3 * v + 1])) - 0.05;
  const rb = BR.readBraid(sc.strandPolylines(), sc.yTop, yb);
  rb.equal = BR.garsideEqual(BR.garside(rb.word, sc.n), BR.garside(sc.applied, sc.n));
  const changed = !state.readback || state.readback.equal !== rb.equal || state.readback.word.join() !== rb.word.join();
  state.readback = rb;
  if (changed) renderReadback();
}

// ------------------------------------------------------------ telemetry

let hudAt = 0, plotAt = 0;
function updateHud(now) {
  if (now - hudAt < 120) return;
  hudAt = now;
  const fs = state.frameStats;
  const s = state.sc.sim, p = s.p;
  const last = fs[fs.length - 1] || s.stats;
  const avg = (f) => (fs.length ? fs.reduce((a, st) => a + f(st), 0) / fs.length : 0);
  $('hNewton').textContent = fs.length ? avg((st) => st.newton).toFixed(1) : '–';
  $('hCg').textContent = fs.length ? Math.round(avg((st) => st.cgIters)) : '–';
  const minToi = fs.length ? Math.min(...fs.map((st) => Math.min(...st.tois))) : 1;
  const dtRatio = fs.length ? avg((st) => st.dt) / p.dt : 1;
  $('hToi').textContent = `${minToi.toFixed(2)} · ${(dtRatio * 100).toFixed(0)}%`;
  $('hContacts').textContent = last.contacts;
  const g = last.minGap;
  $('hGap').textContent = isFinite(g) ? `${(g * 1000).toFixed(2)} mm` : '–';
  const tau = s.strands[0]?.strainLimit || 0.03;
  $('hStrain').textContent = `${(last.maxStrain * 100).toFixed(2)}% / ${(tau * 100).toFixed(1)}%`;
  $('hStrain').className = `v ${last.maxStrain > 0.8 * tau ? 'warn' : ''}`;
  const bad = fs.reduce((m, st) => Math.max(m, st.intersecting), 0);
  $('hBad').textContent = bad ? `${bad} ✗` : '0 ✓';
  $('hBad').className = `v ${bad ? 'bad' : 'ok'}`;
  const r = state.rt.ratio;
  const stalled = fs.some((st) => st.stalled);
  $('hSpeed').textContent = !state.running ? 'paused' : stalled ? 'stalled' : `${r.toFixed(2)}× real`;
  $('hSpeed').className = `v ${stalled ? 'bad' : r < 0.6 * state.speed ? 'warn' : ''}`;
  sparkline($('sToi'), state.hist.toi, { color: '#7fa8ff', min: 0, max: 1 });
  sparkline($('sGap'), state.hist.gap, { color: '#63e6be', min: 0, max: 1.2 });
  if (state.id === 'rope') {
    const sc = state.sc, turns = sc.angle / (2 * Math.PI);
    $('twistReadout').innerHTML = `${turns.toFixed(2)} turns<br>≈ Δ${BR.sup(Math.round(2 * turns))}${sc.hold ? ' · taut' : ''}`;
  }
  state.frameStats = [];
  if (now - plotAt > 250 && $('barrierPlot').offsetParent) {
    plotAt = now;
    drawBarrierPlot($('barrierPlot'), {
      current: p.barrier, samples: s.gapSamples, nSamples: s.nGapSamples,
      minGap: isFinite(g) ? g / p.ghat : null,
    });
  }
}

function record(st) {
  state.frameStats.push(st);
  const h = state.hist;
  h.toi.push(st.tois.length ? Math.min(...st.tois) : 1);
  h.gap.push(isFinite(st.minGap) ? Math.max(0, st.minGap / state.sc.sim.p.ghat) : 1.2);
  if (h.toi.length > 240) { h.toi.shift(); h.gap.shift(); }
}

// ------------------------------------------------------------ loop

let lastT = performance.now();
function tick(now = performance.now()) {
  const raw = Math.max(0, (now - lastT) / 1000), wall = Math.min(0.05, raw);
  lastT = now;
  const s = state.sc.sim;
  if (state.running) {
    state.simClock += wall * state.speed;
    const t0 = performance.now(), simStart = s.t;
    let guard = 0;
    while (s.t < state.simClock && performance.now() - t0 < 14 && guard++ < 64) {
      const st = s.step();
      record(st);
    }
    if (state.simClock - s.t > 0.08) state.simClock = s.t + 0.02;
    const rt = state.rt;
    rt.sim += s.t - simStart; rt.wall += Math.min(raw, 1); // true elapsed time, not the capped frame
    if (rt.wall > 0.5) { rt.ratio = rt.sim / rt.wall; rt.sim = 0; rt.wall = 0; }
  }
  if (state.follow && state.sc.focus) followKnot();
  view.update();
  view.render();
  updateHud(now);
  if (state.id === 'braid') {
    renderBraidPanel();
    updateReadback(now);
  }
}

function loop(now) {
  tick(now);
  requestAnimationFrame(loop);
}

// keep the knotted part framed while it tightens, until the user orbits
function followKnot() {
  const f = state.sc.focus(), cam = view.camera, ctl = view.controls;
  const want = Math.max(0.3, Math.min(4, 5.2 * f.r));
  const dir = cam.position.clone().sub(ctl.target);
  const dist = dir.length();
  dir.normalize();
  ctl.target.x += 0.06 * (f.c[0] - ctl.target.x);
  ctl.target.y += 0.06 * (f.c[1] - ctl.target.y);
  ctl.target.z += 0.06 * (f.c[2] - ctl.target.z);
  const d = dist + 0.04 * (want - dist);
  cam.position.copy(ctl.target).addScaledVector(dir, d);
}
view.controls.addEventListener('start', () => { state.follow = false; });

// ------------------------------------------------------------ input

function ndc(e) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
}
// capture phase on the document runs before OrbitControls sees the event
document.addEventListener('pointerdown', (e) => {
  if (e.target !== canvas || e.button !== 0 || e.shiftKey) return;
  const q = ndc(e), hit = view.pick(q.x, q.y);
  if (!hit) return;
  e.stopPropagation();
  e.preventDefault();
  state.drag = { v: hit.v, p: hit.point, id: e.pointerId };
  sim().grab = { v: hit.v, target: [hit.point.x, hit.point.y, hit.point.z], k: 0.5 };
  canvas.classList.add('dragging');
  canvas.setPointerCapture(e.pointerId);
}, true);
canvas.addEventListener('pointermove', (e) => {
  if (!state.drag || e.pointerId !== state.drag.id) return;
  const q = ndc(e), p = view.dragPoint(q.x, q.y, state.drag.p);
  if (p && sim().grab) sim().grab.target = [p.x, Math.max(0.03, p.y), p.z];
});
const endDrag = (e) => {
  if (!state.drag || (e && e.pointerId !== state.drag.id)) return;
  state.drag = null;
  sim().grab = null;
  canvas.classList.remove('dragging');
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

window.addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input, select, textarea')) {
    if (e.target.type !== 'range' && e.target.type !== 'checkbox') return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const sc = state.sc;
  const m = /^Digit([1-9])$/.exec(e.code);
  if (m && state.id === 'braid') {
    sc.gen((e.shiftKey ? -1 : 1) * +m[1]);
    e.preventDefault();
    return;
  }
  switch (e.key) {
    case ' ':
      $('running').checked = !$('running').checked;
      $('running').dispatchEvent(new Event('change'));
      e.preventDefault();
      break;
    case 'd': if (state.id === 'braid') sc.delta(1, 1); break;
    case 'D': if (state.id === 'braid') sc.delta(-1, 1); break;
    case 'f': case 'F': if (state.id === 'braid') sc.delta(e.shiftKey ? -1 : 1, 2); break;
    case 'u': case 'U': case 'Backspace': if (state.id === 'braid') { sc.undo(); e.preventDefault(); } break;
    case 'r': case 'R': build(state.id, { keepCamera: true }); break;
    case 'c': case 'C':
      $('showContacts').checked = !$('showContacts').checked;
      $('showContacts').dispatchEvent(new Event('change'));
      break;
    case 'k': case 'K': {
      const sel = $('colorMode');
      sel.selectedIndex = (sel.selectedIndex + 1) % sel.options.length;
      sel.dispatchEvent(new Event('change'));
      break;
    }
    case 'h': case 'H': toggleUi(); break;
    case '0': view.frame(); state.follow = !!view.dec.follow; break;
    default: break;
  }
});

window.addEventListener('resize', () => view.resize());

// ------------------------------------------------------------ boot

const params = new URLSearchParams(location.search);
const startScene = SCENES[params.get('scene')] ? params.get('scene') : 'braid';
if (params.get('n')) { $('nStrands').value = params.get('n'); $('nStrandsV').textContent = params.get('n'); }
document.querySelector(`input[name=scene][value=${startScene}]`).checked = true;
$('friction').value = SCENE_DEFAULTS[startScene].friction;
$('friction').dispatchEvent(new Event('input'));
build(startScene);
if (phone.matches) setPanel(startScene === 'braid' ? 'right' : 'left', true);
else setPanel('left', true);
if (startScene === 'braid' && params.get('word')) {
  for (const g of params.get('word').split(',').map(Number).filter(Boolean)) state.sc.gen(g);
}
requestAnimationFrame(loop);

// a small hook for tests and thumbnails
window.__cb = { state, view, build, tick, applyPreset, PRESETS, BR };
