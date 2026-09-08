# Trancefusion guitarist — completed training

The new musician is trained and available in superGroups. Three T4 runs executed 4,500 optimizer updates. The selected weights descend from A update 1,500, B update 1,000, and C update 1,500: 4,000 updates along the selected lineage. B's later checkpoints were not selected.

The curriculum contains 640 original sixteen-bar synthetic exercises: 512 training, 64 validation, and 64 final-test songs. There are no exact performance duplicates across splits. This is description-derived musical behavior, not training on the named artist's recordings.

| Experiment | Validation loss | Pitch prediction | Generated motif continuity | Without band |
| --- | ---: | ---: | ---: | ---: |
| run-a-event-baseline | 0.182 | 93.2% | 95.8% | 40.0% |
| run-b-motif-memory | 0.140 | 94.4% | 98.3% | 25.8% |
| run-c-history-robustness | 0.129 | 94.8% | 100.0% | 30.0% |

C was selected on validation evidence before opening the test set. On all 64 untouched test songs, next-onset pitch accuracy was **94.6%**, compared with **90.5%** when accompaniment features were zeroed. On 16 generated test performances, motif continuity averaged **95.4%**, compared with **29.6%** without the band.

Pitch accuracy uses correct preceding guitar notes (teacher forcing), so it is not generated-melody accuracy. Motif continuity uses generated history: the first three pitch classes, relative to backing root, are compared across the early phrase bars. It rewards repeating an idea but is not a measure of artistic quality. Timing metrics are strong partly because the curriculum has a prescribed arc, fixed rest bars, and four rhythmic templates. The test set shares this curriculum family; it is not a test on real jams.

A established the note-event representation. B added past-bar memory and more training. C additionally omitted 6% of historical steps during fine-tuning. Those sequential changes are useful iterations, not controlled evidence isolating architecture from extra training.

## What you can hear

The listening room has three new guitar training stages and 27 new guitarist lineups, for 13 musicians and 108 combinations. Guitar lineups contain a newly generated guitar response over a fixed four-bar rhythm-section recording looped to sixteen bars. The other musicians were not retrained to follow guitar-initiated chord changes. Browser sound is an illustrative guitar synthesizer; exported MIDI uses GM clean electric guitar.

The musician learns clipped/repeated figures, phrase variation, sustained endings, dynamics, rests, and an upward register arc. Bends, vibrato, slides, real guitar timbre, polyphonic chord fragments, and unconstrained long jams are not represented. See PROFILE.md for the detailed musical mapping.

## Saved artifacts and verification

Each run includes best weights, optimizer/scaler state, metrics, provenance, and sampled MIDI/WAV performances. The archive also includes the full synthetic curriculum, exact training source, final-test evidence, and all exported lineups. All three checkpoints loaded successfully and had finite weights. Thirteen Python tests and four audio-engine tests passed. Static catalog validation checks all 108 lineups and note bounds. Visual browser testing and WebMCP contract testing were not performed.
