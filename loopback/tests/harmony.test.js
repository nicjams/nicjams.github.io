import test from 'node:test';
import assert from 'node:assert/strict';
import { detectChords, parseChord, soloAdvice, spellScale, fft } from '../js/harmony.js';
import { strumChart } from '../js/strum.js';
import { chordAt, buildView, pedalFor, quantize, dequantize } from '../js/view.js';
import { chartSummary } from '../js/looper.js';

test('the FFT finds a pure tone in its bin', () => {
  const n = 64, re = Float64Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * 5 * i) / n)), im = new Float64Array(n);
  fft(re, im);
  const mags = Array.from(re, (r, i) => Math.hypot(r, im[i]));
  assert.ok(Math.abs(mags[5] - n / 2) < 1e-9 && Math.abs(mags[59] - n / 2) < 1e-9);
  assert.ok(mags.every((m, i) => i === 5 || i === 59 || m < 1e-9));
});

test('strummed progressions are heard bar by bar', () => {
  const cases = [
    [[['G'], ['F'], ['C'], ['G']], 100],
    [[['Am'], ['F'], ['C'], ['G']], 88],
    [[['E'], ['A'], ['B7'], ['E']], 132],
    [[['Dm'], ['Bb'], ['C'], ['Dm']], 92],
    [[['C', 'G'], ['Am', 'F'], ['C'], ['G']], 96],
    [[['Em7'], ['A'], ['Em7'], ['A']], 108],
  ];
  for (const [chart, bpm] of cases) {
    const data = strumChart({ chart, bpm, sr: 44100 });
    const got = detectChords(data, 44100, { bars: chart.length, beatsPerBar: 4 });
    assert.deepEqual(got, chart.map((bar) => bar.map((c) => c.replace('Bb', 'B♭'))), JSON.stringify(chart));
  }
});

test('typed chord symbols', () => {
  assert.deepEqual(parseChord('Bbm7'), { root: 10, quality: 'm7', tones: [10, 1, 5, 8] });
  assert.equal(parseChord('F#').root, 6);
  assert.equal(parseChord('Gmaj7').quality, 'maj7');
  assert.equal(parseChord('C/E').quality, '');
  assert.equal(parseChord('D9').quality, '7');
  assert.equal(parseChord('Asus4').quality, 'sus4');
  assert.equal(parseChord('E5').quality, '5');
  assert.equal(parseChord('hello'), null);
  assert.equal(parseChord('C♯m').root, 1);
});

test('what to solo with', () => {
  const a = soloAdvice([['G'], ['F'], ['C'], ['G']]);
  assert.equal(a.mode, 'G Mixolydian');
  assert.equal(a.pentatonic, 'G major pentatonic');
  assert.deepEqual(a.notes, ['G', 'A', 'B', 'C', 'D', 'E', 'F']);
  assert.equal(soloAdvice([['Am'], ['F'], ['C'], ['G']]).mode, 'A Aeolian');
  assert.equal(soloAdvice([['Em7'], ['A']]).mode, 'E Dorian');
  assert.equal(soloAdvice([['C'], ['G'], ['Am'], ['F']]).key, 'C major');
  const blues = soloAdvice([['A7'], ['D7'], ['E7']]);
  assert.equal(blues.blues, 'A blues');
  assert.deepEqual(soloAdvice([['Am'], ['E']]).notes.at(-1), 'G♯', 'harmonic minor for a major V');
  assert.equal(soloAdvice([[]]), null);
});

test('scales are spelled one letter per note', () => {
  assert.deepEqual(spellScale(3, [0, 2, 4, 5, 7, 9, 11], 'major'), ['E♭', 'F', 'G', 'A♭', 'B♭', 'C', 'D']);
  assert.deepEqual(spellScale(6, [0, 2, 4, 5, 7, 9, 11], 'major'), ['F♯', 'G♯', 'A♯', 'B', 'C♯', 'D♯', 'E♯']);
});

test('the chord under the playhead', () => {
  const chart = [['C', 'G'], ['Am'], [], ['F']];
  assert.equal(chordAt(chart, 0.01), 'C');
  assert.equal(chordAt(chart, 0.2), 'G');
  assert.equal(chordAt(chart, 0.3), 'Am');
  assert.equal(chordAt(chart, 0.6), 'Am', 'an empty bar holds the last chord');
  assert.equal(chordAt(chart, 0.99), 'F');
  assert.equal(chartSummary([['G'], ['G'], ['C', 'D'], ['G']]), 'G – C D – G');
});

test('the view follows a solo and its playback', () => {
  const loop = { bars: 4, beatsPerBar: 4, seconds: 8, chart: [['G'], ['F'], ['C'], ['G']], bpm: 120, ready: true, peaks: [10, 200] };
  const state = {
    phase: 'solo', loop, settings: { beatsPerBar: 4, bars: 4, bpm: 120, mode: 'click' }, audio: { sr: 48000, latency: 0.02 },
    timeline: { play: { anchor: 10, start: 10, stop: null }, solo: { B: 10, E: 26, R: 42, passes: 2 } },
  };
  const peaks = { peakSlices: (a, z, n) => new Float32Array(n).fill(0.5) };
  let v = buildView(state, 19, peaks, {});
  assert.equal(v.big, 'G');
  assert.match(v.sub, /pass 2 of 2/);
  assert.equal(v.pedal.label, 'Last pass');
  assert.equal(v.ring.soloKind, 'rec');
  v = buildView({ ...state, phase: 'replay' }, 28.5, peaks, {});
  assert.equal(v.big, 'F');
  assert.match(v.sub, /Playback · pass 1 of 2/);
  assert.equal(pedalFor({ ...state, phase: 'solo' }, 11).label, 'End after this pass');
  assert.deepEqual(Array.from(dequantize([quantize(0.25)])).map((x) => +x.toFixed(2)), [0.25]);
});
