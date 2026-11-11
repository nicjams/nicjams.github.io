// What to show, given the looper's state and the time. Shared by the station
// (the computer doing the audio) and remotes (an iPad), so both see the same
// ring, the same chord, the same pedal. All times are the station's heard
// context time in seconds; see engine.js.

const deq = (q) => (q / 255) ** 2;   // peaks travel as bytes on a square-root scale
export const quantize = (p) => Math.round(Math.sqrt(Math.min(1, Math.max(0, p))) * 255);
export const dequantize = (arr) => (arr ? Float32Array.from(arr, deq) : null);

/** A copy of the station's input-peak history (128-frame blocks), kept by
 *  remotes from the meter stream. The station reads its engine directly. */
export class PeakMirror {
  constructor() { this.ring = new Float32Array(1 << 18); this.last = -1; }
  push(first, bytes) {
    // the station's clock went back to zero: it was reloaded
    if (first + bytes.length < this.last - 2000) { this.ring.fill(0); this.last = -1; }
    for (let i = 0; i < bytes.length; i++) this.ring[(first + i) & (this.ring.length - 1)] = deq(bytes[i]);
    this.last = Math.max(this.last, first + bytes.length - 1);
  }
  peakBetween(a, z) {
    a = Math.max(Math.floor(a / 128), this.last - this.ring.length + 1);
    z = Math.min(Math.floor(z / 128), this.last);
    let m = 0;
    for (let b = a; b <= z; b++) m = Math.max(m, this.ring[b & (this.ring.length - 1)]);
    return m;
  }
  peakSlices(from, to, bins) {
    const out = new Float32Array(bins), span = (to - from) / bins;
    for (let i = 0; i < bins; i++) {
      const a = from + i * span;
      if (a > this.last * 128 + 128) break;
      out[i] = this.peakBetween(a, a + span);
    }
    return out;
  }
}

const frac = (x) => x - Math.floor(x);
const clock = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

/** The chord sounding at a fraction `p` of the way round the loop. */
export function chordAt(chart, p) {
  if (!chart?.length) return '';
  const bars = chart.length, x = frac(p) * bars, bar = Math.floor(x);
  const names = chart[bar] || [];
  if (names.length) return names[Math.min(names.length - 1, Math.floor((x - bar) * names.length))];
  for (let b = bar - 1; b > bar - bars; b--) {
    const prev = chart[(b + bars) % bars];
    if (prev?.length) return prev[prev.length - 1];
  }
  return '';
}

export const PEDAL = {
  empty: { label: 'Record', kind: 'rec' },
  count: { label: 'Cancel', kind: 'cancel' },
  rec: { label: 'Cancel', kind: 'cancel' },
  free: { label: 'Close the loop', kind: 'close' },
  ready: { label: 'Solo', kind: 'rec' },
  lead: { label: 'Cancel solo', kind: 'cancel' },
  solo: { label: 'End after this pass', kind: 'end' },
  replay: { label: 'Stop', kind: 'stop' },
  take: { label: 'Stop', kind: 'stop' },
  calibrate: { label: 'Cancel', kind: 'cancel' },
};

/**
 * @param state  the looper's snapshot
 * @param t      station heard time now (seconds)
 * @param peaks  { peakSlices(fromFrame, toFrame, bins) } over capture frames
 * @param cache  per-state memo for decoded arrays
 */
export function buildView(state, t, peaks, cache) {
  const { phase, loop, timeline: tl, audio } = state;
  const sr = audio?.sr || 48000, lat = audio?.latency || 0;
  const cap = (time) => Math.round((time + lat) * sr);
  if (cache.loopPeaksSrc !== loop?.peaks) { cache.loopPeaksSrc = loop?.peaks; cache.loopPeaks = dequantize(loop?.peaks); }
  if (cache.takePeaksSrc !== tl.take?.peaks) { cache.takePeaksSrc = tl.take?.peaks; cache.takePeaks = dequantize(tl.take?.peaks); }

  const ring = {
    mode: 'idle', bars: loop?.bars || 0, beatsPerBar: loop?.beatsPerBar || state.settings.beatsPerBar,
    chart: loop?.chart || null, loopPeaks: cache.loopPeaks, phase: null, level: state.level || 0,
  };
  let big = '', sub = '', pips = null, alert = '';
  const loopSec = loop?.seconds || 0;
  const pos = (anchor) => (loopSec ? frac((t - anchor) / loopSec) : 0);
  const playing = tl.play && t >= tl.play.start - 0.02 && t < (tl.play.stop ?? Infinity);

  if (playing && loopSec) { ring.phase = pos(tl.play.anchor); ring.mode = 'play'; }

  switch (phase) {
    case 'empty': {
      const s = state.settings;
      big = 'Loop';
      sub = s.mode === 'free' ? 'Press Record, play, press again to close the loop' : `${s.bars} ${s.bars === 1 ? 'bar' : 'bars'} at ${s.bpm} BPM · press Record`;
      ring.bars = s.mode === 'free' ? 0 : s.bars;
      ring.beatsPerBar = s.beatsPerBar;
      break;
    }
    case 'count': {
      const r = tl.rec, beat = r.beat;
      const k = Math.floor((t - r.T0) / beat + 1e-6);
      const left = Math.round((r.Ts - t) / beat);
      big = t < r.T0 ? '' : String(((k % r.beatsPerBar) + 1));
      sub = left > r.beatsPerBar ? 'Count-in' : 'Get ready…';
      ring.mode = 'count'; ring.countBeat = t >= r.T0 ? k % r.beatsPerBar : undefined;
      ring.bars = r.bars; ring.beatsPerBar = r.beatsPerBar; ring.chart = null; ring.loopPeaks = null;
      break;
    }
    case 'rec': {
      const r = tl.rec, p = Math.max(0, (t - r.Ts) / (r.Te - r.Ts));
      const bar = Math.min(r.bars, Math.floor(p * r.bars) + 1);
      big = String(bar); sub = `Recording · bar ${bar} of ${r.bars}`;
      ring.mode = 'rec'; ring.bars = r.bars; ring.beatsPerBar = r.beatsPerBar; ring.chart = null; ring.loopPeaks = null;
      ring.phase = Math.min(0.9999, p);
      ring.livePeaks = scale(peaks.peakSlices(cap(r.Ts), cap(r.Te), 360)); ring.liveProgress = p;
      break;
    }
    case 'free': {
      const r = tl.rec, el = Math.max(0, t - r.Ts);
      big = clock(el); sub = 'Recording — press again to close the loop';
      ring.mode = 'rec'; ring.bars = 0; ring.chart = null; ring.loopPeaks = null;
      const turn = 8;   // seconds per turn while the length is unknown
      ring.phase = frac(el / turn);
      ring.livePeaks = scale(peaks.peakSlices(cap(r.Ts + Math.floor(el / turn) * turn), cap(r.Ts + (Math.floor(el / turn) + 1) * turn), 360));
      ring.liveProgress = ring.phase;
      break;
    }
    case 'lead': {
      const s = tl.solo, beat = loopSec / (loop.bars * loop.beatsPerBar);
      const beatsLeft = Math.ceil((s.B - t) / beat - 1e-6);
      if (beatsLeft <= loop.beatsPerBar) { big = String(Math.max(1, beatsLeft)); sub = 'Solo in…'; ring.countBeat = (loop.beatsPerBar - beatsLeft + loop.beatsPerBar) % loop.beatsPerBar; ring.mode = playing ? 'play' : 'count'; }
      else { const bars = Math.ceil(beatsLeft / loop.beatsPerBar); big = String(bars); sub = `${bars === 1 ? 'bar' : 'bars'} until your solo`; }
      break;
    }
    case 'solo':
    case 'replay': {
      const s = tl.solo, from = phase === 'solo' ? s.B : s.E;
      const pass = Math.min(s.passes - 1, Math.max(0, Math.floor((t - from) / loopSec)));
      ring.phase = pos(from);
      big = chordAt(loop.chart, ring.phase) || '•';
      sub = phase === 'solo' ? `Your solo · pass ${pass + 1} of ${s.passes}` : `Playback · pass ${pass + 1} of ${s.passes}`;
      pips = { n: s.passes, done: pass, kind: phase === 'solo' ? 'rec' : 'play' };
      ring.soloKind = phase === 'solo' ? 'rec' : 'replay';
      const a = s.B + pass * loopSec;
      ring.soloPeaks = scale(peaks.peakSlices(cap(a), cap(a + loopSec), 360), s.norm);
      if (phase === 'solo' && s.passes - pass === 1) alert = 'last';
      break;
    }
    case 'take': {
      const k = tl.take, pass = Math.min(k.passes - 1, Math.max(0, Math.floor((t - k.start) / loopSec)));
      ring.phase = pos(k.start);
      big = chordAt(loop.chart, ring.phase) || '•';
      sub = `${k.name} · pass ${pass + 1} of ${k.passes}`;
      pips = { n: k.passes, done: pass, kind: 'play' };
      ring.soloKind = 'take';
      if (cache.takePeaks) ring.soloPeaks = cache.takePeaks.subarray(pass * 360, pass * 360 + 360);
      break;
    }
    case 'calibrate': {
      const c = tl.cal, k = Math.min(c.n, Math.max(0, Math.floor((t - c.T0) / c.interval) + 1));
      big = `${k}/${c.n}`; sub = 'Measuring latency — strum each click on headphones';
      ring.mode = 'count'; ring.bars = 0;
      break;
    }
    default: {   // ready
      if (playing) {
        big = chordAt(loop.chart, ring.phase) || '•';
        const bar = Math.floor(ring.phase * loop.bars) + 1;
        sub = `Bar ${bar} of ${loop.bars}`;
      } else if (loop) {
        big = String(Math.round(loop.bpm));
        sub = `BPM · ${loop.beatsPerBar}/${loop.beatsPerBar === 6 ? 8 : 4} · ${loop.bars} ${loop.bars === 1 ? 'bar' : 'bars'}`;
      }
    }
  }
  if (state.busy) sub = state.busy;
  return { ring, big, sub, pips, alert, pedal: pedalFor(state, t) };
}

function scale(p, gain) {
  let g = gain;
  if (!g) { let m = 0; for (const v of p) m = Math.max(m, v); g = m > 0.01 ? 0.9 / m : 1; }
  for (let i = 0; i < p.length; i++) p[i] = Math.min(1, p[i] * g);
  return p;
}

export function pedalFor(state, t) {
  const base = PEDAL[state.phase] || PEDAL.ready;
  if (state.phase === 'solo' && state.timeline.solo && state.loop) {
    const s = state.timeline.solo, pass = Math.floor((t - s.B) / state.loop.seconds);
    if (pass >= s.passes - 1) return { label: 'Last pass', kind: 'end', idle: true };
  }
  if (state.phase === 'ready' && !state.loop?.ready) return { label: 'Finishing…', kind: 'rec', idle: true };
  return base;
}
