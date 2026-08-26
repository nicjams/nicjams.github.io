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
* **New** (`N`) paints a fresh piece — a new image and a new tune. Press it
  again for another. Like Demo it clears first, so ⌘Z brings back what was
  there.
* **Scene** (`P`) draws a little picture that plays — a sailboat with an island
  and the sun, a mountain range, a city skyline.
* **Demo** paints the built-in score; press it again to stop and keep what is
  on the canvas. It clears first, so ⌘Z brings your painting back.
* **Solo brush** is on by default: the brush you are holding paints at full
  strength and the other parts sit back. Turn it off to see everything level.

## What New generates

The picture and the piece are the same object, so `js/generate.js` composes
music and lets the image fall out of it. It picks one of three temperaments —
`drift` (slow, major-ish, sparse), `groove` (mid tempo, dorian and mixolydian,
backbeat) or `pulse` (fast, minor, sixteenths) — then a key, a mode and a
four-chord progression, and gives each instrument its own band of the canvas:

* **bass** holds the root of each chord low on the canvas, sometimes stepping
  to the fifth halfway through the bar
* **strings** paint the chord as a smear woven up and down through the chord
  tones inside every beat, which is what the scene reads back as a triad — the
  generator uses the same chord rule your hand does
* **keys** arpeggiate the same chords, so the harmony keeps moving when the pad
  drops out
* **lead** enters in the back half along a contour (arc, rise, fall, wave or
  step) with rests for phrasing
* **drums** lay down a kick pattern, a backbeat and hats to suit the style
* **bells** or **pluck** add a few high scale tones, some of the time

Everything is diatonic by construction, since modal rows only ever land on
scale degrees. Triads with a diminished fifth drop the fifth rather than hold a
tritone under a whole bar. Each piece is named for the seed that made it, and
`mc.generate(seed)` in the console paints that exact one again.

## What Scene draws

`js/picture.js` is the other way round from New: it draws a picture and lets
the music fall out of it. Two choices keep an arbitrary drawing listenable — a
**pentatonic** grid, so no two rows in the picture can land a semitone apart
however the pencil moves, and a slow tempo, so the scene unfolds as the
playhead reads it left to right.

Shapes carry their own musical weight, which is what makes this more than a
gimmick:

* a **mast** or a **tree trunk** is a vertical smear across many rows, which
  the chord rule reads as a spread chord — the boat strikes a chord as the
  playhead passes it
* the **sun** is a circle, so the interval between its upper and lower arc
  opens from a unison to its widest and closes again
* the **sea** is a slow sine, which becomes an undulating bass line, and the
  **sail** is a triangle, which becomes a descending run
* **birds** are quick high flicks, **rays** and **stars** single bright notes

Everything is placed in beats and rows, so the picture is the score. Scenes are
seeded and named for it, and `mc.picture(seed)` in the console draws that exact
one again.

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
js/generate.js    composes a new piece and paints it
js/picture.js     draws a scene that plays (sailboat, mountains, skyline)
js/painter.js     lays generated strokes down with staged timing
js/replay.js      repaints a saved set at its recorded pace
js/store.js       backend client with localStorage fallback
js/midi.js        standard MIDI file writer
js/main.js        wiring
server.py         static server + SQLite set storage
```

`window.mc` exposes `{ scene, engine, store, view, demo }` in the console.
