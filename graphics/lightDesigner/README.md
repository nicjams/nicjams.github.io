# Light Designer

A virtual kinetic arena lighting rig over a bare stage and floor in a hazy void (or
inside a club, theater, or stadium): 30 moving truss sticks carrying 60 moving
heads, 12 floor units, volumetric haze, optional stage extras, MIDI play mode, and
immersive WebXR VR.

## The rig: moving sticks

The rig uses 30 separate sticks of 5′, 8′ and 10′ truss, none pinned together, each
on its own hoists, hung in six rows of five across a 62′ grid to make zigzags,
smiles, frowns, columns, portals and rooftops. Each row carries ten moving heads
(two per stick). The Rig tab and every show and scene drive three things per row:

- **Height**: trims the row (rows 1–6 from front to back).
- **Roll**: bends the row into a smile or frown; alternate rows zigzag.
- **Flip**: turns sticks toward vertical. The *flip pattern* decides which ones: all
  (columns), alternate (zigzags, and diamonds at half-way), a lattice with rows
  opposed, the outer legs only (each row becomes a portal frame), the inner three,
  or a fan. A *flip wave* rolls flips through the rows over time.

Flips let a single modular truss rig form arches, domes, portal frames, lattices and
standing columns, traveling smoothly at about 60°/s like a hoist lifting one end.

## Scenes

The **Scenes** grid at the top of the Show tab has 33 complete looks, each with a
thumbnail and category filter (*Beams*, *Kinetic*, *FX & Lasers*, *Mood*). A scene is
the whole rig: a held look, a stick formation, and every stage device. Click a
thumbnail, press <kbd>1</kbd>–<kbd>0</kbd> for the first ten, pick from **Launch
scene** (the Studio remote sees this), play MIDI notes on channel 16 from C2 up (one
pad per scene), or link with `?scene=<id>`.

Every launch moves; nothing cuts. Color and intensity crossfade over **Move time**,
the heads pan and tilt there at motor speed, and the sticks fly and flip at hoist
speed. Devices the new scene adds or drops travel too:

- **LED tubes** rise out of the deck (the wall and the columns), grow out of the
  truss (bars on the sticks), or fly in over the crowd (canopy). They light once
  they're nearly in place. If the new scene wants a different tube layout, the old
  tubes leave before the new ones arrive.
- **Mirror balls** fly in from the grid (about 3 s) and back out; the pin spots
  open once a ball is at its trim.
- **Lasers, blinders, strobes and CO₂ nozzles** lift out of the deck before they
  fire and stop before they sink. A hit asked for while they're rising waits.
- **The projection screen** flies in from above, and the liquid light show starts
  once it's in place.

While anything is still traveling, the live thumbnail pulses and the status says
*Moving to …*. **Auto-trigger** launches a scene every 4–64 bars, in order or at
random. The programmer, live FX and masters still apply on top of a scene; pick a
show to go back to timed playback.

Scenes are defined in `scenes.js`. Thumbnails are `scenes/<id>.webp` (480×300).
Regenerate them with the repo served on port 8124:

```sh
node graphics/scripts/lightDesigner-scene-thumbs.mjs            # all scenes
node graphics/scripts/lightDesigner-scene-thumbs.mjs portal     # just some
```

## Venue, house lights and fairy lights

The **Room** tab puts the rig in a venue and controls the camera. The default is **Empty**: the stage and
floor in a hazy black void, as before. `?venue=club|theater|stadium` picks one from a
link, and the page remembers the room.

- **Club**: a brick box with a low steel ceiling, concrete pillars, a bar with
  backlit bottles, a flickering neon sign and exit signs.
- **Theater**: a proscenium arch with a red house curtain (**House curtain
  closed** draws it in about 3.5 s, and it catches the beams), raked velvet seats,
  opera boxes, a balcony, crystal chandeliers and wall sconces.
- **Stadium**: an open-air bowl under a starry sky, with a stage roof on truss
  towers, a field with yard lines, two decks of seats, a ribbon board showing the
  rig's colors, and four floodlight towers.

In the club and theater, walls, ceilings and the curtain stop beams, lasers and
mirror-ball rays, and the moving heads leave pools of light on them. Camera
presets move to suit each room (a real balcony in the theater, the upper deck at
the stadium).

**House lights** are each venue's ceiling fixtures: cans in the void, Edison
pendants in the club, chandeliers and sconces in the theater, floodlight towers at
the stadium. *Showtime* fades them out over 8 s, *Walk-in* brings them to half,
and *House up* brings them full. They also have a level and fade time; white with
a warmth control from candle to daylight, one color, or the rig's color; and
effects: steady, breathing, old-tungsten flicker, a chase around the room, pulse on
the beat, twinkle or rainbow. While they're up they fill the room and wash the
beams out a little. Blackout takes them out; the grand master doesn't.

**Fairy lights** hang as swags or drops: a canopy over the crowd, spokes from a hub,
swags between the truss sticks (they ride the kinetics), or a starcloth curtain
upstage. Each venue has its own anchor points. Strands are catenaries that sway in
a **breeze**, and bulbs switch on running along each string. Colors are warm or
cool white, classic C9 multicolor, pastel, rainbow along the string, the rig's
color, or one color. Effects are steady, twinkle, chase, wave, breathing,
sparkle, pulse on the beat, or rain. You can also set level, speed, bulbs per
meter, sag and bulb size.

**Camera**: the page opens *In the audience*, at eye height (1.7 m) on the floor,
centered, 15 ft (4.6 m) back from the front of the stage, with a wider lens because
the rig fills the sky from that close. The other presets are still under View.

## Lasers (optional)

The **Rig** tab adds an optional full-color, audience-scanning laser package
alongside the moving heads. There are six projectors: the two upstage corners,
upstage center, the two wings and front of house. Beams are razor-thin (drawn a
fixed number of pixels wide in both desktop and stereo VR), stop on the deck, floor
or venue walls, and otherwise run out into the haze.

- **Looks**: fans, sweeping fans, liquid sky (a rippling sheet just over the
  crowd), tunnel (a spinning cone), starburst, beam chase (jumps on the beat),
  crossfire (the wings plus front of house), and *follow the show*, which changes
  look by section and scales with how bright the show is.
- **Color**: full-color rotating, rainbow across each fan, classic green, the
  rig's dominant color, or one color.
- **Controls**: level, beams per fan, spread, scan period in beats, height over the
  crowd, and chop on the beat. The grand master, blackout, flash and haze level
  all apply to the lasers.
- In MIDI play mode, **Fire with MIDI notes** makes the lasers flash with your playing.
- `?lasers=1` turns them on from a link, and the page remembers the setting.

## Other devices (optional)

The **Rig** tab also holds optional stage extras, collapsing inactive devices until
turned on. These devices follow the grand master, blackout and flash, and travel in
and out rather than popping (see *Scenes*). A **Stage kit** menu sets them up in one
step: arena, trance-fusion, late-night club, psychedelic ’60s, starlight ballroom,
everything, or clean rig (`?kit=arena|trance|club|psych|starlight|all`).

- **LED pixel tubes** (24 pixels each): a wall upstage, bars on the truss sticks
  (riding the kinetics), columns around the stage, or a canopy over the crowd. Looks: follow the nearest
  head, rain drips, rainbow wave, bar chase, sparkle, a level meter (show energy
  or MIDI), or flash on the beat. Like the lasers, they're drawn in screen space
  with anti-aliased edges and seams, so they stay crisp at any distance.
- **Mirror balls**: one over the stage, or three with two over the crowd. Pin spots
  from the grid, faceted glints, rays through the haze, and spots sweeping the
  floor. Set spin, reflections, color and level. *Drop the ball* flies them out
  and back in again; *Fly out* takes them away.
- **Blinders & strobes**: six 4-lite tungsten audience blinders (fast attack, slow,
  warming decay) and eight strobe bars. Hits can come on the drops (sections that
  cut in hard), every 4 bars, every beat, or with the show's own strobes. They fill
  the stage with light for an instant.
- **Liquid light show**: an oil-and-water projection on an upstage screen, with
  two dyes, oil and bubble walls. Palettes are classic, follow the rig, or acid,
  and it can pulse on the beat.
- **CO₂ jets**: six cryo jets downstage, fired on the drops, every 4 bars, every beat,
  or by *Blast now*.
- With **A MIDI crash cymbal fires…** on, a crash on channel 10 in MIDI play mode
  hits the blinders, strobes and CO₂.

## Files

- `layout.js`: the moving-sticks rig (30 posed rigid bodies with height, roll and flip), fixtures, groups and aiming math.
- `engine.js`: the console. Each frame runs the show section (cross-faded with
  the one before it), then programmer overrides, live FX, the snapshot fade used by
  jumps and GO, highlight, masters, and finally physics (motor response, hoist and
  flip speed).
- `shows.js`: eight long shows (~75 min as a set), built from a small look vocabulary.
- `rig.js`: three.js renderer. It builds the stage, the floor, the truss sticks and
  their chains. Beams are instanced additive cones. Surfaces sample a
  per-fixture data texture, so beams leave pools on the deck and floor and catch the metal.
- `scenes.js`: the scene library (looks, stick formations and device settings).
- `devices.js`: LED tubes, mirror balls, blinders & strobes, liquid light show and CO₂
  jets, each with a *presence* that travels in and out.
- `lasers.js`: the optional laser package (projectors, looks, beam list; no DOM).
- `venue.js`: the four venues (architecture, what stops beams, house-light and fairy-light anchors, camera tweaks).
- `ambient.js`: house lights and fairy lights.
- `midi.js`: MIDI play mode. `NoteLayer` turns MIDI bytes into per-fixture light (no DOM). `setupMidi` wires
  Web MIDI, the on-screen and computer keyboards, the test groove, the sweep and the monitor.
- `vr.js`: WebXR (`immersive-vr`) session, vantage teleportation, thumbstick locomotion, controller laser pointers and the floating 3D spatial console.
- `main.js`: panel, keyboard, cue list, MIDI learn and microphone sound-to-light.

## WebXR VR

Press **VR** in the header on a WebXR headset (Meta Quest, Apple Vision Pro, PCVR) to
step inside the venue at 1:1 scale with all graphics intact (volumetric beams,
stereo screen-space lasers and LED pixel tubes, mirror-ball facet glints, liquid
projection, CO₂ and room lights):

- **Spatial console**: a floating, grabbable 3D lighting desk (`vr.js`) gives full
  access to all five tabs (**Show**, **Rig**, **Room**, **Desk**, **MIDI**), scene
  thumbnails, master faders, the 72-head programmer plot, live effects, cues, and a
  two-handed playable 2-octave MIDI keyboard.
- **Vantage spots & locomotion**: jump between *Crowd*, *On Stage* (under the 30
  moving sticks), *FOH*, *Wing* and *Balcony*, or walk with the left thumbstick
  (stepping automatically onto the 1.2 m stage deck) and snap-turn / fly with the
  right thumbstick.
- **Live controller shortcuts**: **B / Y** hides or summons the console, **A**
  launches the next scene, **X** taps tempo, grip on the console repositions it, and
  squeezing grip in open air holds **Flash** (right) or **Strobe** (left).

## Writing a show

```js
{ id: 'myShow', name: 'My Show', bpm: 120, blurb: '…', sections: [
  sec('Intro', 60, 4, merge(L.dark({ cycCol: K.blue }), L.wash({ col: K.royal, dim: up(0, 0.5) }))),
  sec('Build', 90, 6, L.fan({ col: K.cyan, chase: { rate: steps([8, 4, 2]), by: 'x' } })),
] }
```

`sec(name, seconds, fadeIn, look)`. A look has `layers` (group assignments:
`dim`, `col`/`alt`, `pan`, `tilt`, `aim` + `spread`, `fan`, `zoom`, `frost`,
`strobe`, `hueSpread`), `fx` (`a` attribute, `w` waveform, `rate` beats/cycle,
`size`, `spread` degrees of phase, `by` order, `wings`, `off`), `kin` (pod shape)
and `cyc` (a backdrop color: still accepted, but not drawn now there is no backdrop). Any value can be a function of `c = { p, t, T, beat }`. Use `up`,
`steps`, `blend`, `journey` and `every` for builds and color journeys. Wrap
scaled function values with `mul(v, k)`, not `v * k`.

## Console

The panel is organized into five single-row tabs (**Show**, **Rig**, **Room**, **Desk**, **MIDI**) with progressive disclosure so inactive devices and secondary settings stay tucked out of the way:

- **Show**: scenes (with category filters and auto-cycle), timed show playback, scrubbing and section list, and masters (grand, pods, floor, haze, flash, strobe, blackout, tap tempo).
- **Rig**: quick stage kits, kinetic pod override and live pod meter, plus stage devices (lasers, LED tubes, mirror balls, liquid light show, blinders & strobes, CO₂ jets).
- **Room**: venue architecture (empty, club, theater with curtain, stadium), house lights, fairy lights, camera presets, bloom and render quality.
- **Desk**: fixture selection chips and map, programmer attributes and position palettes, stackable live effects, and recordable cue list with JSON export/import.
- **MIDI**: play mode (notes fire lights), on-screen and computer keyboards, test groove, MIDI learn, and microphone sound-to-light.

## MIDI play mode

Turn on **Notes fire lights** (any incoming note turns it on), or just connect a
keyboard and play. Notes are laid over the show just before the masters: the
brighter of the show and the note wins, and the note's color wins in proportion
to its level. **Under the notes** sets how much of the show stays up (blackout,
12%, 35% or the full show).

- **Keys map to**: *keys across the stage* (a column of light at the key's
  position between the lowest and highest key), *octave → pod, note → head*
  (C1 octave = floor units, each higher octave one pod further downstage),
  *scatter* (each pitch class lights a spread of heads), or *whole rig*.
- **Color**: pitch → hue (C red, 30° per semitone), velocity → heat, the show's
  own color, or one fixed color.
- Velocity → brightness. Sustain pedal (CC64) holds notes. The mod wheel (CC1)
  makes the tilt kicks bigger, and pitch bend rotates the hue ±60°. CC120/123 is
  all notes off. Response sets the held level, release, column width, tilt kick
  and how far pods dip.
- **Channel 10 plays the drum map** (General MIDI): the kick fires the floor and
  back pod, the snare the mid pods, hi-hats random heads, the toms one pod each
  (low toms at the back), crashes the whole rig, and the ride steps a column across.
- Learned MIDI mappings take priority: a learned note or CC drives its console
  control and doesn't fire lights.

**MIDI test** (no hardware needed): *Play test groove* loops 8 bars at 120 BPM
(pad, bass, arpeggio and a GM drum kit with a tom fill). *Sweep all notes* plays
C1–B7 and reports how many of the 72 fixtures the current mapping reached. There
is also a two-octave on-screen keyboard (click lower on a key for more velocity),
**Computer keys play notes** (A W S E D F T G Y H U J K, Shift = hard, Z/X change
octave, and these keys override the console shortcuts while it's on), an optional
monitor synth, a now-playing readout, a coverage count and a message log.

Automated test: serve the repo on port 8124, then run
`node graphics/tests/lightDesigner-midi.mjs`. It mocks a Web MIDI keyboard in
headless Chrome over the DevTools protocol (no npm packages needed) and checks
connecting, mapping, color, velocity, release, sustain, pitch bend, the drum map,
the channel filter, MIDI learn priority, the computer and on-screen keyboards,
the sweep reaching all 72 fixtures, the test groove, handing the rig back to
the show, stick flips (portal legs stand vertical and travel back smoothly), all eight laser looks (projectors rising, and firing them with notes), the extras (kits, and a crash cymbal firing blinders, strobes and CO₂), venues (the empty default with the audience camera, the club ceiling and theater curtain stopping beams, stadium floodlights, the Showtime fade, fairy lights riding the truss), and scenes (every launch moves, truss bars grow in, the tube wall rises from the deck only after the bars leave, the ball flies in, keys, pads, auto-trigger).

Keys: Space play · ←/→ section · T tap · X flash · S strobe · B blackout ·
G GO · H hide the panel. With *Computer keys play notes* on, the note
letters play the rig instead.
