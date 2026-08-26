# musicalCanvas

Paint music. A cycling playhead sweeps the canvas left to right; every stroke
you paint becomes MIDI notes that play when the head crosses them.

Press **Demo** to watch it paint itself: one instrument per loop, drawn live at
the playhead. The demo score lives in `js/demo.js` as beats and rows; the paths
are sampled smoothly, with pitch changes easing over a fraction of a beat —
short enough that every quantize slot still belongs to one row, so the smooth
line and the exact MIDI agree.

## Running

```bash
python3 server.py          # http://127.0.0.1:8770/
```

The server both serves the app and stores sets in `data/sets.db` (SQLite,
stdlib only — no dependencies). Opened from a plain static server instead, the
app still works and falls back to saving sets in localStorage. The dot on the
`Sets` button is green when the backend is answering, and the sets panel says
where saving is going.

Also registered in `Code/.claude/launch.json` as `musicalcanvas`.

## Painting

* **Brushes** — one per instrument (Bass, Keys, Strings, Lead, Bells, Pluck,
  Drums), keys `1`–`7`. Each has its own synth voice, colour and MIDI channel.
  The Drums brush maps rows to a GM kit and retriggers on every grid step, so a
  line along a row is a steady hat pattern.
* **Eraser** (`E`) removes whole strokes; `⌘Z` / `⇧⌘Z` undo and redo.
* **Grid + MIDI** (`G`) — off by default: you see bare canvas and your strokes.
  Tick it to reveal the pitch grid, the key strip and the notes your strokes
  derived.
* **Speed** colours strokes by how fast you painted them. Paint speed also sets
  note velocity, and a slow hand lays down a fatter line.
* Click the key strip (grid mode) to audition a row.
* **Chords** — a grid slot sounds every row the brush lingered on, up to three
  at once. Smear a stroke up and down within a beat and it plays a chord; an
  ordinary line stays one note. A row has to hold about a fifth of the slot
  before it sounds, and the rows have to be at least two apart, so a shaky hand
  stays monophonic. A smear too fast to dwell anywhere plays where it leaned
  plus both ends of the sweep. Stacking separate strokes of the same colour
  chords too. The rules are three constants at the top of `js/scene.js`.
* **Demo** paints the built-in score; press it again to stop and keep what is
  on the canvas. It clears first, so ⌘Z brings your painting back.
* **Solo brush** is on by default: the brush you are holding paints at full
  strength and the other parts sit back. Turn it off to see everything level.

## The dropdowns

Strokes are stored as beat position plus a 0..1 pitch coordinate, and notes are
*derived* from them. So the dropdowns are live: change one and the same
painting is re-read.

* **Pitch** — `Modal` gives one row per scale degree, so nothing is out of key;
  `Chromatic` gives one row per semitone, with scale tones shaded.
* **Key / Scale** — transposes and remaps the whole canvas.
* **Quantize** — `Off` through `1/32`, triplets included. The grid is also what
  makes chords possible: with quantize off, a vertical smear reads as a fast
  arpeggio rather than notes struck together.
* **Tempo / Bars** set the loop; the status bar shows the loop length and how
  fast the playhead sweeps, in px/s.

## Sets

`Sets` saves the whole scene to the backend: settings, every stroke, and the
derived notes. Strokes keep their timing — `t0` (wall clock), `at` (ms into the
session, i.e. when during the making of the set the gesture happened) and per
point `dt` (ms since the stroke started) — so a set records not just the
picture but the performance that made it.

Loading a set puts the finished painting on the canvas. Press ▶ and the canvas
wipes: the strokes go back down one at a time, in the order they were performed
and at the speed they were drawn, with only the thinking time between strokes
compressed. The music fills in as the paint lands. Stopping part-way puts the
finished painting back, and painting by hand (or pressing Demo) cancels the
pending replay so your own work is never wiped.

`MIDI` downloads the scene as a type-1 .mid file, one track per brush.

## API

```
GET    /api/health
GET    /api/sets            list summaries
POST   /api/sets            create, returns {id}
GET    /api/sets/<id>       full scene
PUT    /api/sets/<id>       replace
DELETE /api/sets/<id>
```

## Layout

```
index.html        toolbar, brush rail, canvas, sets panel
style.css
js/music.js       scales, quantize grids, row -> midi mapping, GM kit
js/audio.js       brush definitions, synth voices, transport scheduler
js/scene.js       settings, strokes, stroke -> note derivation, undo, save format
js/canvas.js      canvas texture, grid, notes, playhead, pointer input
js/demo.js        the built-in score and the self-painting player
js/replay.js      repaints a saved set at its recorded pace
js/store.js       backend client with localStorage fallback
js/midi.js        standard MIDI file writer
js/main.js        wiring
server.py         static server + SQLite set storage
```

`window.mc` exposes `{ scene, engine, store, view, demo }` in the console.
