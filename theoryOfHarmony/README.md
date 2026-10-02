# A Theory of Harmony

An interactive static walkthrough from beating and harmonic spectra to a two-stage harmonicity theorem for the major scale.

## Run locally

From this directory:

```sh
python3 -m http.server 8879 --bind 127.0.0.1
```

Open `http://127.0.0.1:8879/`. No build or runtime dependencies are required. Font downloads are optional; system-font fallbacks work offline. All experiments and the proof run locally.

## Chapters

1. Listen to a scale.
2. Compare beating frequencies and their mathematically consistent envelope.
3. Pluck an ideal string: picture and sound share position-dependent Fourier coefficients.
4. Explore a continuous roughness curve with sine, harmonic and stretched spectra.
5. Prove that a major triad uniquely minimizes harmonic height among three-class chords.
6. Build and octave-fold the union of three pure major triads.
7. Compare just tuning, equal temperament and the syntonic-comma repair.
8. Compare root-position and locally smooth voicings; hear all seven diatonic triads.
9. Prove and explore the globally optimal three-major-triad collection and its unique harmonic center.

The final theorem uses exact rational pitch classes, not a twelve-note grid. See [THEOREM.md](THEOREM.md) for definitions, proofs, assumptions, and alternative objectives. `js/model.js` implements the numerical models, with BigInt rational arithmetic for harmonic heights and network scores. `js/audio.js` owns every oscillator and scheduled sequence callback. `js/content.js` contains the prose; `js/app.js` connects controls, diagrams and sound.

## Validation

Requires Node.js with its built-in test runner and mock timers:

```sh
npm run check
npm test
```

Tests cover the harmonic-height normalization, triad lower bound, pair-height formula, bounded rational root triples and exact equality cases, tuning identities, plucked-string Fourier coefficients, roughness properties, voice leading, and audio cancellation/replacement/sequence lifecycles. The tests need no third-party packages. The bounded enumeration verifies the implementation; the global theorem has an independent mathematical proof.

All interactive actions have labeled HTML controls. Frequency sliders supplement pointer dragging; audio has a persistent Stop and volume control. Only the active chapter is mounted. The layout scrolls naturally on phones and honors reduced-motion settings.
