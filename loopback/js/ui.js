// The page: draws a looper snapshot and turns clicks, taps and pedal presses
// into commands. The same UI runs on the station and on a remote; `send`
// decides where commands go and `clock` says what time it is on the
// station's audio clock.

import { Ring } from './ring.js';
import { buildView, dequantize } from './view.js';

const $ = (id) => document.getElementById(id);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v !== null && v !== undefined) el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
  return el;
};
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const PEDAL_KEYS = new Set([' ', 'PageDown', 'ArrowDown', 'ArrowRight']);
const PLAY_KEYS = new Set(['p', 'P', 'PageUp', 'ArrowUp', 'ArrowLeft']);
const TYPING = (el) => el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/** A waveform strip as an inline SVG path, from byte peaks. */
function strip(bytes, w = 160, hgt = 28) {
  const p = dequantize(bytes) || new Float32Array(0), n = p.length;
  let d = '';
  for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) / n) * w, a = Math.max(0.6, p[i] ** 0.7 * (hgt / 2 - 1));
    d += `M${x.toFixed(1)} ${(hgt / 2 - a).toFixed(1)}V${(hgt / 2 + a).toFixed(1)}`;
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<path d="${d}" stroke="currentColor" stroke-width="${Math.max(0.8, (w / n) * 0.6).toFixed(2)}" stroke-linecap="round"/>`;
  return svg;
}

/** A tiny ring, for the library cards. */
function miniRing(bytes, size = 64) {
  const p = dequantize(bytes) || new Float32Array(0), n = p.length, c = size / 2, r0 = size * 0.3, r1 = size * 0.47;
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + ((i + 0.5) / n) * Math.PI * 2, m = (r0 + r1) / 2, half = Math.max(0.4, p[i] ** 0.7 * (r1 - r0) / 2);
    const x = Math.cos(a), y = Math.sin(a);
    d += `M${(c + x * (m - half)).toFixed(1)} ${(c + y * (m - half)).toFixed(1)}L${(c + x * (m + half)).toFixed(1)} ${(c + y * (m + half)).toFixed(1)}`;
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<circle cx="${c}" cy="${c}" r="${(r0 + r1) / 2}" fill="none" stroke="currentColor" stroke-opacity=".15"/><path d="${d}" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`;
  return svg;
}

export class UI {
  /**
   * @param role    'station' | 'remote'
   * @param send    (cmd, args, ev) => void
   * @param clock   (ev?) => station heard time (seconds), or null if unknown
   * @param peaks   { peakSlices(from, to, bins) } over capture frames
   * @param station { looper } — only on the station, for its local-only tools
   */
  constructor({ role, send, clock, peaks, station = null }) {
    this.role = role;
    this.send = send;
    this.clock = clock;
    this.peaks = peaks;
    this.station = station;
    this.state = null;
    this.cache = {};
    this.level = 0;
    this.taps = [];
    this.demo = 0;
    this.lastMessage = null;
    this.ring = new Ring($('ring'));
    document.body.classList.add(role);
    this.bind();
    new ResizeObserver(() => { this.ring.resize(); }).observe($('ring'));
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.ring.readColors());
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---- input ------------------------------------------------------------------

  bind() {
    const set = (key, value) => this.send('set', { key, value });
    const pressAt = (ev) => {
      const at = this.clock(ev);
      return at === null ? {} : { at };
    };
    $('pedal').addEventListener('click', (ev) => this.send('pedal', pressAt(ev), ev));
    $('soloBtn').addEventListener('click', (ev) => this.send('pedal', pressAt(ev), ev));
    $('playBtn').addEventListener('click', () => this.send('play'));
    $('clickBtn').addEventListener('click', () => this.send('metronome', { on: !this.state?.settings.metronome }));

    for (const b of document.querySelectorAll('[data-mode]')) b.addEventListener('click', () => set('mode', b.dataset.mode));
    for (const b of document.querySelectorAll('[data-bars]')) b.addEventListener('click', () => set('bars', +b.dataset.bars));
    $('bpm').addEventListener('change', (e) => set('bpm', e.target.value));
    $('bpb').addEventListener('change', (e) => set('beatsPerBar', e.target.value));
    $('countIn').addEventListener('change', (e) => set('countIn', e.target.value));
    $('clickRec').addEventListener('change', (e) => set('clickRec', e.target.checked));
    $('tapBtn').addEventListener('click', (e) => this.tap(e));
    $('demoBtn').addEventListener('click', () => {
      if (!this.okToReplace()) return;
      this.send('demo', { index: this.demo++ });
    });

    $('loopName').addEventListener('change', (e) => this.send('name', { name: e.target.value }));
    $('loopName').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
    $('halfBtn').addEventListener('click', () => this.send('scaleBars', { factor: 0.5 }));
    $('doubleBtn').addEventListener('click', () => this.send('scaleBars', { factor: 2 }));
    $('saveBtn').addEventListener('click', () => this.send('save'));
    $('newBtn').addEventListener('click', () => { if (this.okToReplace()) this.send('new'); });

    $('passMinus').addEventListener('click', () => set('soloPasses', (this.state?.settings.soloPasses || 2) - 1));
    $('passPlus').addEventListener('click', () => set('soloPasses', (this.state?.settings.soloPasses || 2) + 1));
    for (const id of ['loopLevel', 'soloLevel']) {
      let last = 0;
      $(id).addEventListener('input', (e) => {
        const now = performance.now();
        if (this.role === 'remote' && now - last < 60) return;
        last = now;
        set(id, +e.target.value);
      });
      $(id).addEventListener('change', (e) => set(id, +e.target.value));
    }

    $('settingsBtn').addEventListener('click', () => this.openSettings());
    $('channelSel').addEventListener('change', (e) => set('channel', e.target.value));
    $('remoteInputBtn').addEventListener('click', () => this.send('input'));
    $('calBtn').addEventListener('click', () => { $('settings').close(); this.send('calibrate'); });
    $('clickLevel').addEventListener('change', (e) => set('clickLevel', +e.target.value));
    $('keepLooping').addEventListener('change', (e) => set('keepLooping', e.target.checked));

    document.addEventListener('keydown', (e) => this.key(e));
    document.addEventListener('pointerdown', () => { this.pointer = true; }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Tab') this.pointer = false; }, true);
  }

  key(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return;
    const t = e.target;
    if (TYPING(t) && !(t.type === 'checkbox' || t.type === 'radio')) {
      if (e.key === 'Escape') t.blur();
      return;
    }
    // Space on a button the mouse last clicked works the pedal, not that button.
    if (t.tagName === 'BUTTON' && e.key === ' ' && !this.pointer && t.id !== 'pedal') return;
    if (PEDAL_KEYS.has(e.key)) {
      if (e.repeat) { e.preventDefault(); return; }
      e.preventDefault();
      const at = this.clock(e);
      this.send('pedal', at === null ? {} : { at }, e);
      $('pedal').classList.add('pressed');
      setTimeout(() => $('pedal').classList.remove('pressed'), 140);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.send('stop');
    } else if (PLAY_KEYS.has(e.key) && !e.repeat) {
      e.preventDefault();
      this.send('play');
    }
  }

  tap(e) {
    const t = e.timeStamp / 1000;
    this.taps = this.taps.filter((x) => t - x < 2.5).concat(t);
    if (this.taps.length < 2) { $('tapBtn').textContent = 'Tap…'; return; }
    const gaps = this.taps.slice(1).map((x, i) => x - this.taps[i]).sort((a, b) => a - b);
    const bpm = Math.round(60 / gaps[gaps.length >> 1]);
    $('tapBtn').textContent = 'Tap';
    $('bpm').value = bpm;
    this.send('set', { key: 'bpm', value: bpm });
  }

  okToReplace() {
    const L = this.state?.loop;
    if (!L?.ready || L.saved || L.source === 'demo') return true;
    return confirm('This loop isn’t saved. Replace it anyway?');
  }

  openSettings() {
    const dlg = $('settings');
    this.renderSettings(this.state);
    if (this.role === 'station') this.station?.fillDevices?.();
    dlg.showModal();
  }

  // ---- state ------------------------------------------------------------------

  render(state) {
    const prev = this.state;
    this.state = state;
    const { phase, loop, settings: s, takes, library } = state;
    document.body.dataset.phase = phase;

    // setup
    const empty = !loop;
    $('setup').hidden = !empty;
    $('loopInfo').hidden = empty;
    for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-checked', String(b.dataset.mode === s.mode));
    for (const b of document.querySelectorAll('[data-bars]')) b.setAttribute('aria-checked', String(+b.dataset.bars === s.bars));
    for (const el of document.querySelectorAll('[data-only="click"]')) el.hidden = s.mode !== 'click';
    $('modeNote').textContent = s.mode === 'click'
      ? 'A count-in, then exactly the bars you choose. The loop plays as soon as it’s recorded.'
      : 'Press Record and play. Press again on the downbeat to close the loop — it starts playing straight away.';
    if (document.activeElement !== $('bpm')) $('bpm').value = s.bpm;
    $('bpb').value = String(s.beatsPerBar);
    $('countIn').value = String(s.countIn);
    $('clickRec').checked = s.clickRec;
    const recording = ['count', 'rec', 'free', 'calibrate'].includes(phase);
    for (const el of $('setup').querySelectorAll('input, select, button')) el.disabled = recording;

    // the loop
    if (loop) {
      if (document.activeElement !== $('loopName')) $('loopName').value = loop.name || '';
      const sig = `${loop.beatsPerBar}/${loop.beatsPerBar === 6 ? 8 : 4}`;
      $('loopMeta').textContent = loop.ready
        ? `${Math.round(loop.bpm)} BPM · ${sig} · ${loop.bars} ${loop.bars === 1 ? 'bar' : 'bars'} · ${loop.seconds.toFixed(1)} s`
        : 'Listening back…';
      $('halfBtn').disabled = !loop.ready || loop.bars % 2 !== 0;
      $('doubleBtn').disabled = !loop.ready || loop.bars >= 32;
      this.renderChart(loop);
      const a = loop.advice;
      $('advice').replaceChildren(...(a ? [
        h('span', { class: 'label' }, 'Solo with'), ' ',
        h('strong', {}, a.pentatonic), ` (${a.pentatonicNotes.join(' ')})`,
        a.blues ? ` or ${a.blues}` : '', ' · ',
        h('strong', {}, a.mode), ` (${a.notes.join(' ')})`,
      ] : loop.ready ? ['Type the chords into the boxes and I’ll suggest a scale.'] : []));
      $('saveBtn').textContent = loop.saved ? 'Saved' : 'Save loop';
      $('saveBtn').disabled = loop.saved || !loop.ready;
      $('saveBtn').classList.toggle('done', loop.saved);
      $('wavBtn').disabled = !loop.ready;
    }

    // transport
    const playing = !!state.timeline.play;
    $('playBtn').disabled = !loop?.ready && !playing;
    $('playBtn').setAttribute('aria-pressed', String(!!playing));
    $('playBtn').querySelector('span').textContent = playing ? 'Stop' : 'Play';
    $('clickBtn').setAttribute('aria-pressed', String(s.metronome));

    // solo
    $('soloStep').classList.toggle('waiting', !loop?.ready);
    $('passes').textContent = `${s.soloPasses} ${s.soloPasses === 1 ? 'pass' : 'passes'}`;
    $('passMinus').disabled = s.soloPasses <= 1;
    $('passPlus').disabled = s.soloPasses >= 16;
    $('passInfo').textContent = loop?.ready
      ? `= ${s.soloPasses * loop.bars} bars · ${mmss(s.soloPasses * loop.seconds)}`
      : 'times through the loop';
    for (const id of ['loopLevel', 'soloLevel']) if (document.activeElement !== $(id)) $(id).value = s[id];
    const soloLabel = { ready: 'Start solo', lead: 'Waiting for the top…', solo: 'Soloing…', replay: 'Playing it back…', take: 'Playing a take…' }[phase] || 'Start solo';
    $('soloBtn').lastChild.textContent = ` ${soloLabel}`;
    $('soloBtn').disabled = !(phase === 'ready' && loop?.ready);

    const takesKey = JSON.stringify([takes.map((k) => [k.id, k.kept, k.fresh, k.name]), state.timeline.take?.id]);
    if (takesKey !== this.takesKey) { this.takesKey = takesKey; this.renderTakes(state); }
    const libKey = JSON.stringify([library, loop?.id]);
    if (libKey !== this.libKey) { this.libKey = libKey; this.renderLibrary(state); }
    if ($('settings').open) this.renderSettings(state);

    // input
    if (this.role === 'station') {
      $('inputLabel').textContent = state.input.on ? state.input.label : 'Enable input';
      $('inputBtn').classList.toggle('on', state.input.on);
    }

    if (state.message && state.message.id !== this.lastMessage) {
      this.lastMessage = state.message.id;
      if (prev || Date.now() - state.message.id < 4000) this.toast(state.message.text, state.message.kind);
    }
  }

  renderChart(loop) {
    const chart = $('chart'), bars = loop.ready ? loop.bars : 0;
    if (chart.children.length !== bars) {
      chart.replaceChildren(...Array.from({ length: bars }, (_, i) => h('input', {
        type: 'text', class: 'bar', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off',
        'aria-label': `Bar ${i + 1} chords`,
        onchange: (e) => this.send('chord', { bar: i, text: e.target.value }),
        onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
      })));
      chart.style.setProperty('--per-row', String(Math.min(4, Math.max(1, bars))));
    }
    [...chart.children].forEach((input, i) => {
      if (document.activeElement === input) return;
      input.value = (loop.chart[i] || []).join(' ');
      input.placeholder = loop.ready ? '?' : '';
    });
  }

  renderTakes(state) {
    const { takes } = state, list = $('takes');
    $('takesTitle').hidden = !takes.length;
    list.replaceChildren(...takes.map((k) => {
      const playing = state.timeline.take?.id === k.id;
      return h('li', { class: `take${k.fresh ? ' fresh' : ''}${k.kept ? ' kept' : ''}` },
        h('div', { class: 'take-head' },
          h('span', { class: 'take-name' }, k.name),
          h('span', { class: 'note-inline' }, `${k.passes} ${k.passes === 1 ? 'pass' : 'passes'} · ${mmss(k.seconds)}`)),
        h('div', { class: 'take-wave' }, strip(k.peaks)),
        h('div', { class: 'take-actions' },
          h('button', { class: 'mini', type: 'button', onclick: () => this.send(playing ? 'stop' : 'takePlay', { id: k.id }) }, playing ? 'Stop' : '▶ Play'),
          h('button', { class: 'mini', type: 'button', disabled: k.kept, onclick: () => this.send('takeKeep', { id: k.id }) }, k.kept ? '★ Kept' : '☆ Keep'),
          this.role === 'station' ? h('button', { class: 'mini', type: 'button', onclick: () => this.station.download(k.id) }, 'WAV') : null,
          h('button', { class: 'mini quiet', type: 'button', 'aria-label': `Delete ${k.name}`, onclick: () => {
            if (k.kept && !confirm(`Delete ${k.name}?`)) return;
            this.send('takeDelete', { id: k.id });
          } }, '✕')));
    }));
  }

  renderLibrary(state) {
    const lib = $('library'), current = state.loop?.id;
    if (!state.library.length) {
      lib.replaceChildren(h('p', { class: 'empty' }, 'Loops you save show up here, with their kept takes. They stay in this browser.'));
      return;
    }
    lib.replaceChildren(...state.library.map((m) => h('div', { class: `lib-card${m.id === current ? ' current' : ''}` },
      h('button', { class: 'lib-open', type: 'button', onclick: () => {
        if (m.id === current || !this.okToReplace()) return;
        this.send('load', { id: m.id });
      } },
        miniRing(m.peaks),
        h('span', { class: 'lib-text' },
          h('span', { class: 'lib-name' }, m.name || 'Untitled'),
          h('span', { class: 'lib-meta' }, `${Math.round(m.bpm)} BPM · ${m.bars} bars${m.takes ? ` · ${m.takes} ${m.takes === 1 ? 'take' : 'takes'}` : ''}`),
          m.summary && m.summary !== m.name ? h('span', { class: 'lib-chords' }, m.summary) : null)),
      h('button', { class: 'lib-del mini quiet', type: 'button', 'aria-label': `Delete ${m.name}`, onclick: () => {
        if (confirm(`Delete “${m.name}” and its takes?`)) this.send('delete', { id: m.id });
      } }, '✕'))));
  }

  renderSettings(state) {
    if (!state) return;
    const s = state.settings;
    if (document.activeElement !== $('latency') && state.audio) $('latency').value = Math.round(state.audio.latency * 1000);
    $('clickLevel').value = s.clickLevel;
    $('keepLooping').checked = s.keepLooping;
    const ch = $('channelSel'), n = state.input.channels || 2;
    // a channel this input doesn't have stays chosen (both are mixed meanwhile)
    const on = state.input.on, missing = typeof s.channel === 'number' && s.channel >= n ? s.channel : null;
    const chKey = `${n}|${missing}|${on}`;
    if (ch.dataset.key !== chKey) {
      ch.dataset.key = chKey;
      ch.replaceChildren(h('option', { value: 'mix' }, n > 2 ? 'Inputs 1 + 2, mixed' : 'Both channels, mixed'),
        ...Array.from({ length: n }, (_, i) => h('option', { value: String(i) }, `Input ${i + 1} only`)),
        missing === null ? null : h('option', { value: String(missing), disabled: on },
          on ? `Input ${missing + 1} — this input has ${n}, so both are mixed` : `Input ${missing + 1} only`));
    }
    ch.value = String(s.channel);
    if (this.role === 'remote') {
      // a remote picks the channel; the device itself is chosen on the computer
      const { on, label, channels } = state.input;
      $('remoteInput').textContent = on ? `${label}${channels > 2 ? ` · ${channels} channels` : ''}` : 'Off';
      $('remoteInputBtn').hidden = on;
      ch.disabled = !on;
    }
  }

  toast(text, kind = 'info') {
    const t = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, text);
    $('toasts').append(t);
    setTimeout(() => t.classList.add('out'), kind === 'error' ? 6000 : 3500);
    setTimeout(() => t.remove(), kind === 'error' ? 6600 : 4100);
  }

  meter(peak) { this.level = Math.max(peak, this.level); }

  // ---- animation --------------------------------------------------------------

  frame() {
    requestAnimationFrame(() => this.frame());
    const state = this.state;
    if (!state) return;
    const t = this.clock() ?? 0;
    const v = buildView(state, t, this.peaks, this.cache);
    this.level *= 0.9;
    v.ring.level = state.input.on || this.role === 'remote' ? this.level : 0;
    this.ring.draw(v.ring);
    const meter = `scaleX(${Math.min(1, Math.sqrt(this.level) * 1.2).toFixed(3)})`;
    $('meterFill').style.transform = meter;
    if ($('settings').open) $('channelMeter').style.transform = meter;
    if (v.big !== this.big) { this.big = v.big; $('centerBig').textContent = v.big; $('centerBig').classList.toggle('long', v.big.length > 4); }
    if (v.sub !== this.sub) { this.sub = v.sub; $('centerSub').textContent = v.sub; $('status').textContent = v.sub; }
    const pips = v.pips ? `${v.pips.n}:${v.pips.done}:${v.pips.kind}` : '';
    if (pips !== this.pipsKey) {
      this.pipsKey = pips;
      $('centerPips').replaceChildren(...(v.pips ? Array.from({ length: v.pips.n }, (_, i) =>
        h('i', { class: i < v.pips.done ? 'done' : i === v.pips.done ? 'now' : '' })) : []));
      $('centerPips').dataset.kind = v.pips?.kind || '';
    }
    const ped = `${v.pedal.label}|${v.pedal.kind}|${!!v.pedal.idle}`;
    if (ped !== this.pedalKey) {
      this.pedalKey = ped;
      $('pedalLabel').textContent = v.pedal.label;
      $('pedal').dataset.kind = v.pedal.kind;
      $('pedal').classList.toggle('idle', !!v.pedal.idle);
    }
    document.body.classList.toggle('last-pass', v.alert === 'last');
  }
}
