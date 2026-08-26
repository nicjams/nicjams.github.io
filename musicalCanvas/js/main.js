/* App wiring: controls, render loop, live audition, set save/load. */

import { SHARP, SCALES, QUANTIZE } from './music.js';
import { AudioEngine, BRUSHES, brushById } from './audio.js';
import { Scene } from './scene.js';
import { CanvasView } from './canvas.js';
import { Store } from './store.js';
import { downloadMidi } from './midi.js';
import { Demo } from './demo.js';
import { Replay } from './replay.js';
import { generate } from './generate.js';

const $ = id => document.getElementById(id);

const scene = new Scene();
const engine = new AudioEngine();
const store = new Store();
let view;
let demo;
let replay;
let lastAuditionRow = null;

/* ---- controls ---------------------------------------------------------- */

function fillSelects() {
  $('root').innerHTML = SHARP.map((n, i) => `<option value="${i}">${n}</option>`).join('');
  $('scale').innerHTML = Object.entries(SCALES)
    .map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
  $('quantize').innerHTML = Object.entries(QUANTIZE)
    .map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
  $('root').value = scene.settings.root;
  $('scale').value = scene.settings.scale;
  $('quantize').value = scene.settings.quantize;
  $('mode').value = scene.settings.mode;
  $('bars').value = scene.settings.bars;
  $('bpm').value = scene.settings.bpm;
}

function buildBrushes() {
  $('brushList').innerHTML = BRUSHES.map((b, i) => `
    <button class="brush" data-id="${b.id}" style="color:${b.color}">
      <span class="swatch" style="background:${b.color}"></span>
      <span>${b.name}</span>
      <span class="count" data-count="${b.id}">0</span>
      <kbd>${i + 1}</kbd>
    </button>`).join('');
  $('brushList').querySelectorAll('.brush').forEach(el => {
    el.addEventListener('click', () => selectBrush(el.dataset.id));
  });
}

function selectBrush(id) {
  view.brush = id;
  view.tool = 'brush';
  $('canvas').classList.remove('erasing');
  $('eraseBtn').classList.remove('on');
  $('brushList').querySelectorAll('.brush').forEach(el => {
    el.classList.toggle('active', el.dataset.id === id);
  });
  $('brushLevel').value = engine.levels[id];
  if (view.soloBrush) view.soloBrush = id;
  refresh();
}

function toggleErase() {
  view.tool = view.tool === 'erase' ? 'brush' : 'erase';
  $('eraseBtn').classList.toggle('on', view.tool === 'erase');
  $('canvas').classList.toggle('erasing', view.tool === 'erase');
}

/* ---- readouts ---------------------------------------------------------- */

function refresh() {
  const s = scene.settings;
  const stats = scene.stats();
  $('sceneInfo').textContent = `${stats.strokes} strokes · ${stats.notes} notes`;
  BRUSHES.forEach(b => {
    const el = document.querySelector(`[data-count="${b.id}"]`);
    if (el) el.textContent = stats.byBrush[b.id] || 0;
  });
  updateSpeed();
  $('setName').value = scene.name;
}

/* Playhead speed, refreshed in the render loop so it tracks the transport. */
function updateSpeed() {
  const s = scene.settings;
  const loopSec = (scene.totalBeats / s.bpm) * 60;
  const sweep = Math.max(0, view ? view.plotW : 0) / Math.max(loopSec, 0.001);
  const head = view && view.playhead !== null
    ? ` · bar ${Math.floor(view.playhead / s.beatsPerBar) + 1}.${(view.playhead % s.beatsPerBar + 1).toFixed(1)}`
    : '';
  $('speedInfo').textContent =
    `${s.bpm} BPM · ${s.bars} bars · ${loopSec.toFixed(2)} s loop · ${sweep.toFixed(0)} px/s${head}`;
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 1900);
}

/* ---- transport --------------------------------------------------------- */

async function togglePlay() {
  if (engine.playing) {
    if (demo.running) demo.stop();
    if (replay.running) replay.cancel();
    engine.stop();
    $('playBtn').textContent = '▶';
    $('playBtn').classList.remove('on');
    view.playhead = null;
    return;
  }
  await engine.ensureCtx();
  // a set that was just loaded gets repainted as it was performed
  if (!replay.start()) {
    engine.setTempo(scene.settings.bpm);
    engine.setLength(scene.totalBeats);
    await engine.start(0);
  } else {
    toast('Replaying the performance…');
  }
  $('playBtn').textContent = '■';
  $('playBtn').classList.add('on');
  if (engine.blocked) toast('Tap the screen to let this device play audio');
}

let frameCount = 0;
function frame() {
  view.playhead = engine.position();
  if (demo.running) demo.tick(view.playhead);
  if (replay.running) replay.tick();
  view.draw();
  if (frameCount++ % 6 === 0) updateSpeed();
  requestAnimationFrame(frame);
}

/* ---- generate ---------------------------------------------------------- */

async function newPainting() {
  if (demo.running) demo.stop();
  if (replay.running) replay.cancel();
  replay.disarm();
  const made = generate(scene);
  scene.name = `Generated ${made.seed}`;
  scene.id = null;                       // a new piece, not an edit of the loaded set
  fillSelects();
  $('bpmOut').value = scene.settings.bpm;
  engine.setTempo(scene.settings.bpm);
  engine.setLength(scene.totalBeats);
  if (!engine.playing) {
    await engine.start(0);
    $('playBtn').textContent = '■';
    $('playBtn').classList.add('on');
  }
  refresh();
  toast(`${made.style} · ${SHARP[made.root]} ${SCALES[made.scale].name} · ${made.bpm} BPM`);
  return made;
}

/* ---- demo -------------------------------------------------------------- */

function toggleDemo() {
  if (demo.running) return demo.stop();
  if (replay.running) replay.cancel();
  replay.disarm();
  demo.start();
  $('demoBtn').classList.add('on');
  $('playBtn').textContent = '■';
  $('playBtn').classList.add('on');
  fillSelects();
  $('bpmOut').value = scene.settings.bpm;
}

/* ---- sets -------------------------------------------------------------- */

async function refreshSets() {
  const sets = await store.list();
  $('setList').innerHTML = sets.length ? sets.map(s => `
    <div class="set ${s.id === scene.id ? 'current' : ''}">
      <div class="meta">
        <div class="name">${escapeHtml(s.name || 'Untitled')}</div>
        <div class="sub">${s.bpm || '?'} BPM · ${s.bars || '?'} bars · ${s.notes || 0} notes · ${fmtDate(s.updated_at)}</div>
      </div>
      <button data-load="${s.id}">Load</button>
      <button class="del" data-del="${s.id}">Del</button>
    </div>`).join('') : '<p class="note">No saved sets yet.</p>';

  $('setList').querySelectorAll('[data-load]').forEach(b =>
    b.addEventListener('click', () => loadSet(b.dataset.load)));
  $('setList').querySelectorAll('[data-del]').forEach(b =>
    b.addEventListener('click', async () => {
      await store.remove(b.dataset.del);
      if (scene.id === b.dataset.del) scene.id = null;
      refreshSets();
      toast('Set deleted');
    }));

  $('storageNote').textContent = store.online
    ? 'Saving to the musicalCanvas backend (SQLite). Strokes, their timing and the derived MIDI are all stored.'
    : 'Backend offline — saving to this browser only. Run `python3 server.py` in the musicalCanvas folder to store sets on disk.';
}

async function saveSet(asNew = false) {
  scene.name = $('setName').value.trim() || 'Untitled set';
  const saved = await store.save(scene.toJSON(), asNew ? null : scene.id);
  scene.id = saved.id;
  refreshSets();
  toast(store.online ? `Saved “${scene.name}”` : `Saved “${scene.name}” locally`);
}

async function loadSet(id) {
  const data = await store.load(id);
  if (!data) return toast('Could not load that set');
  if (demo.running) demo.stop();
  if (replay.running) replay.cancel();
  engine.stop();
  $('playBtn').textContent = '▶';
  $('playBtn').classList.remove('on');
  view.playhead = null;
  scene.load(data);
  scene.id = id;
  replay.arm(data);
  fillSelects();
  engine.setTempo(scene.settings.bpm);
  engine.setLength(scene.totalBeats);
  $('bpmOut').value = scene.settings.bpm;
  refresh();
  refreshSets();
  toast(`Loaded “${scene.name}” — press ▶ to watch it painted`);
}

const escapeHtml = s => String(s).replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/* ---- boot -------------------------------------------------------------- */

function init() {
  view = new CanvasView($('canvas'), scene, {
    onStrokeStart: () => {
      lastAuditionRow = null;
      engine.ensureCtx();
      replay.disarm();      // hand-painting makes the loaded performance stale
    },
    onPoint: ({ brush, row, speed }) => {
      if (row === lastAuditionRow) return;
      lastAuditionRow = row;
      const midi = scene.midiFor(brush, row, scene.pitchMap());
      engine.play({ brush, midi, vel: 48 + speed * 72 }, undefined, 0.25);
    },
    onStrokeEnd: () => refresh(),
    onErase: () => { replay.disarm(); refresh(); },
    onAudition: row => {
      engine.ensureCtx().then(() => {
        const midi = scene.midiFor(view.brush, row, scene.pitchMap());
        engine.play({ brush: view.brush, midi, vel: 100 }, undefined, 0.4);
      });
    },
    onHover: info => {
      $('cursorInfo').textContent = info
        ? `${info.label}  ·  bar ${info.bar} beat ${info.beat.toFixed(2)}`
        : '—';
    },
  });

  scene.onChange = () => refresh();
  engine.noteSource = () => scene.notes;

  replay = new Replay({
    scene, engine, view,
    onBrush: brush => selectBrush(brush),
    onDone: finished => { if (finished) toast('Replay complete'); },
  });

  demo = new Demo({
    scene, engine, view,
    onPart: (brush, i, n) => {
      selectBrush(brush);
      toast(`Demo · ${brushById(brush).name} (${i + 1}/${n})`);
    },
    onDone: finished => {
      $('demoBtn').classList.remove('on');
      if (finished) toast('Demo complete — the loop keeps playing');
    },
  });

  fillSelects();
  buildBrushes();
  selectBrush(BRUSHES[1].id);
  view.soloBrush = view.brush;              // solo is the default view
  $('soloBtn').classList.add('on');

  $('playBtn').addEventListener('click', togglePlay);
  $('bpm').addEventListener('input', e => {
    const bpm = +e.target.value;
    $('bpmOut').value = bpm;
    scene.set('bpm', bpm);
    engine.setTempo(bpm);
  });
  $('bars').addEventListener('change', e => {
    scene.set('bars', +e.target.value);
    engine.setLength(scene.totalBeats);
  });
  $('mode').addEventListener('change', e => scene.set('mode', e.target.value));
  $('root').addEventListener('change', e => scene.set('root', +e.target.value));
  $('scale').addEventListener('change', e => scene.set('scale', e.target.value));
  $('quantize').addEventListener('change', e => scene.set('quantize', e.target.value));

  $('gridChk').addEventListener('change', e => { view.showGrid = e.target.checked; });
  $('speedBtn').addEventListener('click', () => {
    view.showSpeed = !view.showSpeed;
    $('speedBtn').classList.toggle('on', view.showSpeed);
  });
  $('undoBtn').addEventListener('click', () => scene.undo());
  $('redoBtn').addEventListener('click', () => scene.redo());
  $('clearBtn').addEventListener('click', () => {
    if (demo.running) demo.stop();
    if (replay.running) replay.cancel();
    replay.disarm();
    if (scene.strokes.length && confirm('Clear the whole canvas?')) scene.clear();
  });
  $('midiBtn').addEventListener('click', () => {
    if (!scene.notes.length) return toast('Paint something first');
    downloadMidi(scene);
    toast('Exported .mid');
  });
  $('newBtn').addEventListener('click', newPainting);
  $('demoBtn').addEventListener('click', toggleDemo);
  $('eraseBtn').addEventListener('click', toggleErase);
  $('soloBtn').addEventListener('click', () => {
    view.soloBrush = view.soloBrush ? null : view.brush;
    $('soloBtn').classList.toggle('on', !!view.soloBrush);
  });
  $('brushLevel').addEventListener('input', e => engine.setLevel(view.brush, +e.target.value));
  $('master').addEventListener('input', e => engine.setMaster(+e.target.value));

  $('setsBtn').addEventListener('click', () => {
    $('setsPanel').classList.toggle('hidden');
    if (!$('setsPanel').classList.contains('hidden')) refreshSets();
  });
  $('closeSets').addEventListener('click', () => $('setsPanel').classList.add('hidden'));
  $('saveBtn').addEventListener('click', () => saveSet(false));
  $('saveAsBtn').addEventListener('click', () => saveSet(true));

  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= BRUSHES.length) return selectBrush(BRUSHES[n - 1].id);
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'e') toggleErase();
    else if (e.key === 'n') newPainting();
    else if (e.key === 'g') { $('gridChk').checked = !$('gridChk').checked; view.showGrid = $('gridChk').checked; }
    else if (e.key === 'b') selectBrush(view.brush);
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? scene.redo() : scene.undo();
    }
  });

  // Mobile browsers suspend audio when the page goes away and need a gesture
  // to give it back, so take any tap as permission and re-check on return.
  const reclaim = () => { if (engine.ctx && engine.blocked) engine.ensureCtx(); };
  ['pointerdown', 'touchend', 'keydown'].forEach(ev =>
    document.addEventListener(ev, reclaim, { passive: true }));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) reclaim();
  });

  store.ping().then(online => {
    $('netDot').classList.toggle('live', online);
    $('netDot').title = online ? 'Sets are saved to the backend' : 'Backend offline — sets are saved in this browser';
    refreshSets();
  });

  // console hook: mc.scene.notes, mc.engine.play({brush:'keys',midi:60}), ...
  // mc.generate(seed) repaints a particular piece
  window.mc = { scene, engine, store, view, demo, replay, generate: seed => generate(scene, seed) };

  refresh();
  requestAnimationFrame(frame);
}

init();
