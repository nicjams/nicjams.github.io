# Adaptive T4 experiments · September 8, 2026

Four sequential runs were executed on a Tesla T4 using PyTorch 2.11.0+cu128. Each run used 1,000 optimizer updates, seed 7, width 192, four Transformer layers, six heads, 128 steps, microbatch 4 and accumulation 4. Each dataset had 256 procedural songs, split into 205 training and 51 validation songs. No human performances were used.

[Reproduce a selected experiment in Colab](https://colab.research.google.com/github/nicjams/nicjams.github.io/blob/main/superGroups/experiments_colab.ipynb).

## What changed and why

| Run | Change from preceding approach | Finding |
|---|---|---|
| 1 · Duration | Shared pitch-local transition head and conditional class balancing; original corpus | Pocket bass now averages about 2 steps; spacious keys about 4.8, close to the intended 2 and 5. Removing bandmates still changes loss by only 0.60%. |
| 2 · Conversation | Keep run-1 model/settings; replace corpus with random keyboard cues and delayed bass/lead replies | State loss falls, but response pitches remain near chance. Data dependence alone does not solve the flattened pitch representation. |
| 3 · Pitch listener | Same response data/settings; add a learned causal relative-pitch convolutional path | Strong response to correct cues; shuffling/removing cues brings pitch accuracy near chance. Bass improves substantially; lead still misses replies. |
| 4 · Pitch objective | Same run-3 architecture/data/settings; add 0.2-weight pitch-choice loss at monophonic note starts | Improves lead's actual generated replies. Select as the interaction baseline, while retaining run 3 for its lower aggregate state loss. |

The run-1 change bundles architecture and loss balancing; their separate causal effects were not isolated. Runs 2–4 each change one major factor. Only one training seed was used, so this is exploratory development, not a statistical benchmark.

## Exact reply-pitch tests

The corpus chooses a new keyboard chord root every eight steps. Bass responds one step later and lead four steps later. Cues are procedurally generated, with responses determined by synthetic style. There are twelve possible cue roots. Exogenous keyboard roots are not predictable from their own previous notes.

Teacher-forced results use 32 held-out windows and 512 reply positions per responding instrument. The model is given the real prior notes, but not future notes or the target track as ensemble context.

| Run | Bass pitch, correct cues | Lead pitch, correct cues | Bass without peers | Lead without peers |
|---|---:|---:|---:|---:|
| 2 | 12.89% | 9.77% | 9.18% | 9.57% |
| 3 | 100.00% | 59.77% | 8.01% | 9.38% |
| 4 | 100.00% | 89.26% | 8.20% | 9.18% |

For run 4, shuffled peer performances give 8.40% bass and 8.59% lead accuracy. The collapse under wrong cues supports real use of musical context on this task.

## Generated history with fixed keyboard cues

Three held-out keyboard tracks were kept unchanged while the model generated the other roles through two rehearsal rounds, temperature 0.85, seeds 17–19. Each role has 48 expected reply positions total. A missing reply counts as incorrect. This does not test fully autonomous keyboard generation.

| Run | Correct bass replies | Correct lead replies |
|---|---:|---:|
| 2 | 2/48 · 4.17% | 2/48 · 4.17% |
| 3 | 42/48 · 87.50% | 18/48 · 37.50% |
| 4 | 48/48 · 100.00% | 38/48 · 79.17% |

Run 4 without listening scores 2/48 bass and 0/48 lead. These three examples are a small diagnostic set and should not be treated as robust population estimates.

## Tradeoffs and limits

Run 3 has lower held-out state loss than run 4 (0.02634 versus 0.03405), and slightly higher onset F1 (0.550 versus 0.531). Run 4 was selected because correct generated responses better match the project's current objective. Its composite training loss includes an extra term, so training-loss curves are not directly comparable. State-loss values across different datasets or across the original and conditional-weight objectives are also not directly comparable.

Fully generated ensembles remain sparse: for the tested lineup, run 4 produces only 4–6 bass onsets and 8–15 lead onsets over eight bars. Generated keyboard chords are not guaranteed coherent. Strong conditional replies are a narrower achievement than convincing autonomous improvisation. No subjective listening-quality rating is claimed.

The relative-pitch listener has learned coefficients, a ±24-semitone receptive field and eight-step causal history; the inference model has no hard-coded rule for the correct response note. Causal and target-exclusion checks are covered by tests.

## Commands

All runs include `--local-transition --conditional-weights`. Run 3 also uses `--pitch-context`; run 4 adds `--pitch-loss 0.2`. The original behavior remains the default for backward compatibility.

```bash
supergroups conversation-data --out data/conversation.npz --songs 256
supergroups train --data data/conversation.npz --out runs/interaction \
  --updates 1000 --eval-every 200 --local-transition --conditional-weights \
  --pitch-context --pitch-loss 0.2 --device cuda
python -m supergroups.evaluate runs/interaction/best.pt data/conversation.npz --out runs/interaction/eval
python -m supergroups.response_probe runs/interaction/best.pt data/conversation.npz --out runs/interaction/probe
```

Use `perform(..., initial_band=prompt, fixed_roles=(1,))` to keep a keyboard part fixed while generating replies. `initial_band` has shape `(steps, 4, 128)`, uses the existing state encoding, and is not mutated.

## Provenance and next experiment

Training commits: run 1 `342b432`, run 2 `00450ee`, run 3 `2ecde49`, run 4 `3ddb78c`. The downloadable run archive includes datasets, checkpoint optimizer/scaler/RNG state, metrics, evaluation JSON, MIDI/WAV, code snapshot and provenance. When best and last refer to the same update, only best is archived; it still supports resume. Preserve the experiment flags when resuming, especially `--pitch-loss 0.2` for run 4.

Next: stress-test new cue ranges, tempos and rhythms, reduce missed onsets, and introduce labelled real multitrack performances. Keep the cue-removal and shuffled-cue controls. Learn richer style while verifying that responsiveness survives beyond the simple synthetic task.

## Final check on previously unused validation songs

After choosing run 4, its checkpoint was evaluated locally on the remaining 19 validation songs (304 reply positions per role), which had not been used in the 32-window checkpoint selection or iteration comparisons. No further training followed this check.

Teacher-forced pitch accuracy was 100% bass and 89.80% lead; without peers it fell to 8.88% and 9.21%, and with shuffled peers to 8.22% and 9.54%. For three new fixed-keyboard examples with generated history, bass scored 48/48 and lead 31/48 (64.58%). The lead's lower score than the earlier 38/48 illustrates remaining variation and errors. This final evaluation used CPU/PyTorch 2.9.1; the four training runs and earlier comparisons used the T4/PyTorch 2.11.0.

The original downloaded archive's SHA-256 was verified against Colab's printed digest. All four checkpoints loaded locally, recorded update 1,000, and contained finite model tensors. Nine unit tests pass. The supplied final bundle also includes this independent check and the reproduction notebook.
