# Loopback

Record a chord loop, set how long you'll solo, and play over it. When the solo
is up, the loop keeps going and your solo plays straight back over it, once.
Loops and the takes you keep are saved in the browser.

The computer the mixer is plugged into does all the audio. An iPad (or any
other browser) can pair with it and act as the remote, with the same ring,
chords and buttons.

## Using it

1. **Record a loop.** *With a click*: set the tempo (or tap it), beats per bar,
   bars and count-in, then press **Record**. After the count-in it records
   exactly that many bars and starts looping the moment it's done. *Free, like
   a pedal*: press Record, play, and press again on the downbeat to close the
   loop. Loopback then guesses the bar count from your strumming; **½ bars** and
   **2× bars** fix a wrong guess. You can also load a demo loop or open an audio
   file.
2. **Check the chords.** It listens to each bar (two chords in a bar when the
   halves clearly differ) and fills in the chart, which you can edit. It reads
   the first chord as home and suggests a scale that fits every chord tone, for
   example *G major pentatonic · G Mixolydian* for G–F–C–G.
3. **Solo.** Choose how long in passes of the loop, then press **Solo**. If the
   loop is playing, the solo starts at the next top of the loop with a count-in;
   if not, it counts in and starts the loop with you. The outer band of the ring
   draws your solo as you play, and the middle shows the current chord. Press
   the pedal again to end after the current pass.
4. **Hear it back.** At the end of the last pass the loop carries straight on
   and your solo plays back over it for the same length. Then the loop rings out
   on its downbeat (or keeps going, if you turn that on in settings).
5. **Keep it.** Each solo becomes a take: play it again, **Keep** it (which
   saves the loop too), download the loop-plus-solo mix as a WAV, or delete it.

The big button works like a footswitch: **Space**, or a Bluetooth page-turner
pedal (Page Down, or the arrow keys). **Esc** stops everything, and **P** (or
Page Up) plays or stops the loop.

## The iPad and the mixer

Open Loopback on the computer, pick the mixer under **Input & timing**, and
press **iPad**. Scan the code (or open the link) on the iPad. The pairing
link stays the same, so you can add it to the iPad's home screen. Keep the
computer's page open; once you've clicked it, the iPad can start and stop
sound on it.

Run from `serve.py` (see below), it's simpler still: open
`http://localhost:8931/loopback/` on the computer, turn on **iPad** once, and
on the iPad just open the computer's address, such as
`http://Mac-mini.local:8931/loopback/`. A browser that can't record where it
is, like an iPad on plain http, becomes the remote and asks the server which
computer to pair with.

- **Input.** Mixers that send each channel over USB show every channel; pick
  the one your instrument is on, on the computer or from the iPad's
  **Input & timing**, where a meter shows the level of the channel you've
  picked. It starts on input 10. (The input device itself is chosen on the
  computer.) Loopback counts the channels that actually arrive, since not
  every browser says how many it sends. If the mixer
  only sends its main mix, send the computer's return to headphones or the
  control room rather than the main mix. Otherwise the loop gets recorded
  into your solo and plays back louder.
- **Output.** Where the browser supports it (Chrome, Edge), you can send the
  loop to the mixer's USB return instead of the system output.
- **Latency.** Press **Measure**. It plays eight clicks and listens for them.
  On speakers, let the input hear them; on headphones, mute your strings and
  strum along with each one. It's stored per input device. Solos are lined up
  using this number, so it's worth measuring once per setup.

Pairing uses the same Firebase Realtime Database as the Graphics Studio remote
(under `sessions/loopback-<room>`), and only to make the connection. From then
on the iPad talks to the computer directly over WebRTC, usually across the
Wi-Fi. Taps arrive in milliseconds, and the iPad keeps its clock synced to the
computer's audio clock, so its playhead and count-ins line up and a free loop
can be closed from the iPad. If the direct link can't be made, commands go
through Firebase instead. That's slower to arrive, but the loop's timing is
unaffected because everything is scheduled on the computer. The link grants
control of the looper, so don't share it.

## How the timing works

All audio runs in an AudioWorklet, `js/tape-worklet.js`, which works like a
tape machine on the context's own frame clock:

- **Capture.** Input is kept, stamped with the frame it arrived at, for the
  last few seconds, or from a held frame onward while something is recording.
- **Voices.** Loops and one-shots play either an array or a stretch of the
  capture itself. A just-recorded loop starts playing from the capture the
  instant it ends, then a cleaned-up copy is swapped in without losing its
  place. The solo's playback reads the capture one solo-length behind, so it
  can begin the moment the solo ends.
- **Metronome.** Clicks on a beat grid, accented on the bar.

With round-trip latency *L*, what you play at musical time *t* is captured at
frame *(t + L)·rate*. Loops and solos are cut from there, so they line up
with what you heard. The loop's last 12 ms crossfade into the audio just
before its first downbeat, so the wrap is seamless and the downbeat stays
intact.

## Files

| | |
|---|---|
| `js/tape-worklet.js` | the audio thread: capture, voices, metronome |
| `js/engine.js` | the AudioContext, input and output devices, seconds ↔ frames |
| `js/looper.js` | recording, soloing, playback, saving; driven by commands, publishes snapshots |
| `js/view.js` | what to draw for a snapshot at a given time (shared by computer and iPad) |
| `js/ui.js`, `js/ring.js` | the page and the ring |
| `js/link.js` | pairing: WebRTC, BroadcastChannel and Firebase routes |
| `js/dsp.js` | loop seams, levels, latency, tempo guessing, WAV |
| `js/harmony.js` | chromagram, chord detection, scale advice |
| `js/strum.js` | a Karplus–Strong guitar for demo loops and tests |
| `js/store.js` | IndexedDB storage |
| `serve.py` | dev server for the computer and an iPad on the same Wi-Fi |

## Developing

```sh
npm test          # dsp, harmony, view and the worklet itself, under node --test
npm run check     # syntax-check every module
python3 serve.py  # the site on port 8931, on the Wi-Fi too, with iPad discovery
```

`serve.py` has no auth: while it runs, anything on the Wi-Fi can read the
site's files and get the pairing room. Don't run it on untrusted networks.

`?virtual` replaces the input with a virtual room: everything Loopback plays
comes back 80 ms later, and a synthetic guitarist strums the loop and plays a
lead line on cue. Recording, latency measurement, chord detection and solo
alignment can be exercised without a microphone. `?demo` opens with a demo
loop loaded. A remote opened with `&via=cloud` uses only Firebase, which is
useful for checking that route.
