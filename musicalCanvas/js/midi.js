/* Standard MIDI File (type 1) writer: one track per paintbrush. */

import { BRUSHES, brushById } from './audio.js';

const PPQ = 480;

const varint = n => {
  const out = [n & 0x7f];
  n >>= 7;
  while (n > 0) { out.unshift((n & 0x7f) | 0x80); n >>= 7; }
  return out;
};

const ascii = s => [...s].map(c => c.charCodeAt(0));
const utf8 = s => [...new TextEncoder().encode(s)];
const be32 = n => [(n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const be16 = n => [(n >> 8) & 255, n & 255];

function chunk(id, bytes) {
  return [...ascii(id), ...be32(bytes.length), ...bytes];
}

function trackBytes(events, name) {
  const bytes = [];
  if (name) {
    const text = utf8(name).slice(0, 127);
    bytes.push(0x00, 0xff, 0x03, ...varint(text.length), ...text);
  }
  let last = 0;
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  for (const e of events) {
    bytes.push(...varint(Math.max(0, e.tick - last)), ...e.data);
    last = e.tick;
  }
  bytes.push(0x00, 0xff, 0x2f, 0x00);   // end of track
  return chunk('MTrk', bytes);
}

/* Returns a Blob holding the scene's notes as a .mid file. */
export function exportMidi(scene) {
  const bpm = scene.settings.bpm;
  const usPerBeat = Math.round(60000000 / bpm);
  const tempoTrack = trackBytes([
    { tick: 0, order: 0, data: [0xff, 0x51, 0x03, (usPerBeat >> 16) & 255, (usPerBeat >> 8) & 255, usPerBeat & 255] },
    { tick: 0, order: 1, data: [0xff, 0x58, 0x04, scene.settings.beatsPerBar, 2, 24, 8] },
  ], scene.name);

  const used = BRUSHES.filter(b => scene.notes.some(n => n.brush === b.id));
  const tracks = used.map(b => {
    const events = [{ tick: 0, order: 0, data: [0xc0 | b.chan, b.program] }];
    for (const n of scene.notes.filter(n => n.brush === b.id)) {
      const on = Math.round(n.start * PPQ);
      const off = Math.max(on + 1, Math.round((n.start + n.dur) * PPQ));
      events.push({ tick: on, order: 1, data: [0x90 | b.chan, n.midi, n.vel] });
      events.push({ tick: off, order: 0, data: [0x80 | b.chan, n.midi, 0] });
    }
    return trackBytes(events, b.name);
  });

  const header = chunk('MThd', [...be16(1), ...be16(tracks.length + 1), ...be16(PPQ)]);
  const all = [...header, ...tempoTrack, ...tracks.flat()];
  return new Blob([new Uint8Array(all)], { type: 'audio/midi' });
}

export function downloadMidi(scene) {
  const url = URL.createObjectURL(exportMidi(scene));
  const a = document.createElement('a');
  a.href = url;
  a.download = (scene.name || 'musicalCanvas').replace(/[^\w\-]+/g, '_') + '.mid';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
