/* Music theory: note names, scales, row<->midi mapping, quantization grids. */

export const SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export const SCALES = {
  ionian:    { name: 'Ionian (major)',  ivs: [0, 2, 4, 5, 7, 9, 11] },
  dorian:    { name: 'Dorian',          ivs: [0, 2, 3, 5, 7, 9, 10] },
  phrygian:  { name: 'Phrygian',        ivs: [0, 1, 3, 5, 7, 8, 10] },
  lydian:    { name: 'Lydian',          ivs: [0, 2, 4, 6, 7, 9, 11] },
  mixolydian:{ name: 'Mixolydian',      ivs: [0, 2, 4, 5, 7, 9, 10] },
  aeolian:   { name: 'Aeolian (minor)', ivs: [0, 2, 3, 5, 7, 8, 10] },
  locrian:   { name: 'Locrian',         ivs: [0, 1, 3, 5, 6, 8, 10] },
  harmMinor: { name: 'Harmonic minor',  ivs: [0, 2, 3, 5, 7, 8, 11] },
  majPent:   { name: 'Major pentatonic',ivs: [0, 2, 4, 7, 9] },
  minPent:   { name: 'Minor pentatonic',ivs: [0, 3, 5, 7, 10] },
  blues:     { name: 'Blues',           ivs: [0, 3, 5, 6, 7, 10] },
  wholeTone: { name: 'Whole tone',      ivs: [0, 2, 4, 6, 8, 10] },
};

/* Quantize divisions, in beats (quarter note = 1 beat). */
export const QUANTIZE = {
  off:     { name: 'Off',    beats: 0 },
  '1/1':   { name: '1/1',    beats: 4 },
  '1/2':   { name: '1/2',    beats: 2 },
  '1/4':   { name: '1/4',    beats: 1 },
  '1/4T':  { name: '1/4T',   beats: 2 / 3 },
  '1/8':   { name: '1/8',    beats: 0.5 },
  '1/8T':  { name: '1/8T',   beats: 1 / 3 },
  '1/16':  { name: '1/16',   beats: 0.25 },
  '1/16T': { name: '1/16T',  beats: 1 / 6 },
  '1/32':  { name: '1/32',   beats: 0.125 },
};

export const pc = m => ((Math.round(m) % 12) + 12) % 12;
export const midiToFreq = m => 440 * Math.pow(2, (m - 69) / 12);
export const octaveOf = m => Math.floor(Math.round(m) / 12) - 1;
export const noteName = m => SHARP[pc(m)] + octaveOf(m);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* General MIDI drum kit, low row -> high row. */
export const KIT = [
  { note: 36, name: 'Kick' },
  { note: 38, name: 'Snare' },
  { note: 39, name: 'Clap' },
  { note: 41, name: 'Low tom' },
  { note: 45, name: 'Mid tom' },
  { note: 48, name: 'High tom' },
  { note: 42, name: 'Hat' },
  { note: 46, name: 'Open hat' },
  { note: 51, name: 'Ride' },
  { note: 49, name: 'Crash' },
];

/*
 * Maps canvas rows to pitches. Rows are numbered from the bottom of the canvas.
 *
 *   chromatic - one row per semitone, scale tones merely shaded
 *   modal     - one row per scale degree, so every row is in key
 */
export class PitchMap {
  constructor({ mode = 'modal', root = 0, scale = 'ionian', lowest = 48, rows = 24 }) {
    this.mode = mode;
    this.root = root;
    this.scale = scale;
    this.lowest = lowest;      // midi note of row 0 in chromatic mode
    this.rows = rows;
    this.ivs = (SCALES[scale] || SCALES.ionian).ivs;
  }

  /* Row index (int) -> midi note. */
  rowToMidi(row) {
    if (this.mode === 'chromatic') return this.lowest + row;
    const n = this.ivs.length;
    const deg = ((row % n) + n) % n;
    const oct = Math.floor(row / n);
    // anchor the modal grid on the root at-or-below `lowest`
    const base = this.lowest - ((this.lowest - this.root) % 12 + 12) % 12;
    return base + this.ivs[deg] + 12 * oct;
  }

  inScale(row) {
    return this.ivs.includes(((this.rowToMidi(row) - this.root) % 12 + 12) % 12);
  }

  isRoot(row) {
    return pc(this.rowToMidi(row)) === pc(this.root);
  }

  label(row) {
    return noteName(this.rowToMidi(row));
  }
}

/* Snap a beat position to the quantize grid. */
export function snap(beat, grid, dir = 'round') {
  if (!grid) return beat;
  const f = dir === 'floor' ? Math.floor : dir === 'ceil' ? Math.ceil : Math.round;
  return f(beat / grid) * grid;
}
