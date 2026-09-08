# superGroups

Train virtual musicians in PyTorch, assemble a band, and hear how its members respond to one another.

[Open the T4 training notebook in Colab](https://colab.research.google.com/github/nicjams/nicjams.github.io/blob/main/superGroups/train_colab.ipynb)

This is a working **symbolic MIDI research prototype**. It trains from scratch on multitrack performances, with a learned identity for each musician. It generates polyphonic MIDI and a simple synthesized WAV preview. It does not learn recorded instrument timbres, voices, or famous artists from their names. The included twelve musicians learn procedural practice patterns, not human performances.

## Adaptive experiments

Four T4 runs improved note duration and learned pitch responses to other players. See the [results and tradeoffs](experiments/README.md) and [experiment notebook](https://colab.research.google.com/github/nicjams/nicjams.github.io/blob/main/superGroups/experiments_colab.ipynb). The original CLI defaults remain compatible with existing checkpoints.

## First session

Open the notebook, choose **Runtime → Change runtime type → T4 GPU**, and run the cells. Start with the synthetic dataset to exercise the complete pipeline. The notebook includes musician dropdowns, A/B listening examples, a piano roll, and checkpoint downloads. Optional Google Drive storage lets checkpoints survive Colab disconnects.

Locally:

```bash
cd superGroups
python -m venv .venv
source .venv/bin/activate
pip install -e .
supergroups demo-data --songs 256
supergroups train --updates 1000
supergroups generate --lineup pocket-bass,spacious-keys,restless-lead,pocket-drums
supergroups render runs/demo/supergroup.mid --out runs/demo/supergroup.wav
```

The default model has four Transformer layers, width 192, six attention heads, and 128 sixteenth-note positions (eight 4/4 bars). Training starts at microbatch 4 with four gradient accumulation steps. CUDA uses FP16 autocast and gradient scaling. These are conservative starting settings for a T4, not a measured memory or speed guarantee. If memory is exhausted, reduce `--batch-size` to 1, then `--width` to 96 with `--heads 6`, or prepare 64-step windows. Colab GPU allocation and session duration vary.

## What a musician learns

The four ensemble slots are **bass, keys, lead, drums**. Each slot can host any trained musician of the corresponding role. The demo has three personalities in each slot: `pocket`, `restless`, and `spacious`.

At every sixteenth-note step, each of the 128 pitches has one of ten states: silence, sustain, or an onset in one of eight velocity bins. This preserves chords, duration, retriggering, and dynamics. A causal Transformer predicts one target musician from:

- its previous notes;
- the other musicians' notes through the current step;
- the four musician identities, target role, and position.

Training removes the entire target track from ensemble context, shifts its input one step, and sometimes drops other tracks to teach entering incomplete ensembles. Validation holds out entire `song_id` groups rather than windows from the same song. The checkpoint saves the registry, split, optimizer, scaler, RNG states, and model.

Generation starts from silence. Drums, bass, keys, then lead take turns creating a part. Subsequent rehearsal rounds let each player regenerate while hearing the others' latest parts. This is offline conditional generation, not simultaneous real-time audio jamming. The fixed order introduces bias; changing order and improving longer-term harmonic planning are future experiments. Sampling also constrains instrument ranges and note density; these constraints are not learned abilities.

## Train your own musicians

Use paired, synchronized performances: four MIDI tracks per song, explicitly labelled with musician identities. Export MIDI from musicalCanvas or your DAW. The track index is the actual zero-based MIDI file track index, including any conductor/tempo track. Assign separate tracks for bass, keys, lead, and drums; omit or arrange extra instruments before import. Track numbers are not MIDI channel numbers.

Create `data/manifest.json` next to your MIDI files:

```json
{
  "musicians": [
    {"name": "Ada", "role": "bass"},
    {"name": "Bea", "role": "keys"},
    {"name": "Cy", "role": "lead"},
    {"name": "Dee", "role": "drums"}
  ],
  "songs": [
    {"song_id": "session-01", "path": "session-01.mid", "tracks": {
      "bass": {"index": 1, "musician": "Ada"},
      "keys": {"index": 2, "musician": "Bea"},
      "lead": {"index": 3, "musician": "Cy"},
      "drums": {"index": 4, "musician": "Dee"}
    }},
    {"song_id": "session-02", "path": "session-02.mid", "tracks": {
      "bass": {"index": 1, "musician": "Ada"},
      "keys": {"index": 2, "musician": "Bea"},
      "lead": {"index": 3, "musician": "Cy"},
      "drums": {"index": 4, "musician": "Dee"}
    }}
  ]
}
```

Two songs are the minimum for a valid split, not enough to establish a useful style model. Collect many performances per musician, ideally with different collaborators, keys, and tempos. Keep arrangements, duplicates, and alternate takes of a composition under the same `song_id` to prevent leakage. If an identity appears only in validation, training stops with an explanatory error. The importer quantizes to sixteenths and does not model swing microtiming, pedal, pitch bend, tempo expression, or meter changes.

```bash
supergroups prepare data/manifest.json --out data/custom.npz
supergroups train --data data/custom.npz --out runs/custom --updates 3000
supergroups generate --checkpoint runs/custom/best.pt --lineup Ada,Bea,Cy,Dee --out runs/custom/band.mid
```

Add new names to the manifest and train a new registry/model. Expanding an existing checkpoint's embedding table is not implemented. Identity embeddings are only meaningful for musicians represented in training. MIDI source material should be yours or available for the intended training use; the repository does not download a third-party corpus automatically.

## Compare interactions

Hold checkpoint, seed, tempo, temperature, and rehearsal rounds fixed. Swap one musician, listen, and inspect note timing/density. Compare ensemble listening against independent playing:

```bash
supergroups generate --seed 17 --out runs/demo/listening.mid
supergroups generate --seed 17 --no-listening --out runs/demo/independent.mid
supergroups generate --seed 17 --lineup pocket-bass,restless-keys,restless-lead,pocket-drums --out runs/demo/swapped.mid
```

Each MIDI has an adjacent JSON record with lineup, seed, settings, training source, and note counts. A changed output shows sensitivity to conditioning; it does not by itself prove better musical collaboration. Evaluate blinded listening, role-specific density, rhythmic alignment, and harmonic compatibility on held-out sessions. Logged onset F1 is teacher-forced classification (pitch/time onsets, ignoring velocity), not a free-generation quality score. Low weighted loss alone can conceal silence collapse.

## Resume and verification

```bash
supergroups train --data data/demo.npz --resume runs/demo/last.pt --out runs/demo --updates 1000
supergroups inspect runs/demo/best.pt
python -m unittest discover -s tests -v
```

`--updates` means additional updates when resuming. Resume restores the optimizer learning rate and architecture from the checkpoint; retain the same dataset and split seed. Save data alongside checkpoints. `last.pt` and `best.pt` are replaced atomically. Load checkpoints only from sources you trust; loading uses PyTorch's restricted `weights_only=True` mode.

Tests cover causal masking, target exclusion, identity/context sensitivity, MIDI polyphony/retrigger/drum round trips, grouped splitting/import, and deterministic valid generation. See `examples/VALIDATION.md` for the actual local training run. CUDA/T4 execution still requires a signed-in Colab session.

## Scope and next steps

The immediate milestone is a credible experiment in learned symbolic interaction. Next: larger paired MIDI data, stronger held-out evaluations, musician-specific fine-tuning, flexible instrumentation, longer-context generation, and real-time scheduling. Learning audio timbre or adapting audio foundation models is a separate stage. GitHub Pages can distribute the notebook and examples; PyTorch training runs in Colab or locally.

Implementation references: [PyTorch AMP](https://docs.pytorch.org/docs/stable/amp.html), [Colab resource limits](https://research.google.com/colaboratory/faq.html).

## Listening room

[Open superGroups](https://nicjams.github.io/superGroups/). The frontend contains five training stages, a keyboard-led response test, profiles for 12 synthetic musicians, and 81 jointly generated lineups. Every mixer channel has independent volume, mute, and solo; playback supports seeking, looping, and MIDI download.

These are saved note performances synthesized with Web Audio, not live browser model inference. Band rehearsals use run 4, 64 steps, two listening rounds, temperature 0.85. Sampling is batched in groups of nine with seeds 1709 + batch offset; lineups vary both identity and random draw. The comparison stages use the same lineup and seed 17. The response test holds keys fixed. Sound design is illustrative, not learned timbre.

Frontend commands (Node 20+ and Python 3): `npm run dev`, `npm run build`, `npm test`. The dependency-free build validates note bounds and copies static assets into `dist/`. To regenerate performances, install the Python package and run `python scripts/build_web_catalog.py --results PATH_TO_T4_RESULTS --baseline PATH_TO_ORIGINAL_MIDI`.

Validation: note bounds and catalog completeness checked; audio clock, seek, mute/solo and take replacement have unit tests. Visual browser testing was not performed. Optional WebMCP registration is feature-detected; no supported WebMCP test context was available.

## New musician: trancefusion guitarist

Select **Trancefusion guitarist** in the lead slot of the [listening room](https://nicjams.github.io/superGroups/). Its dedicated model was trained in three T4 experiments on sixteen-bar synthetic phrase exercises. The site now has 13 musicians, 108 lineups, and eight progress stages. Guitar rehearsals use fixed backing from the original rhythm players; the guitarist generates a responding part.

Read the [musician profile](musicians/trancefusion/PROFILE.md) and [training report](musicians/trancefusion/TRAINING_REPORT.md). Reproduce the experiments in [Colab](https://colab.research.google.com/github/nicjams/nicjams.github.io/blob/main/superGroups/trancefusion_colab.ipynb). Checkpoints are in the downloaded `trancefusion-guitarist-results.zip`, not in Git.

This specialist has a different event representation from the original ensemble model. Load it with `supergroups.trancefusion.load(checkpoint)` and call `generate(model, backing_roll, seed=1709)` with a 256-step, four-track backing roll. It generates the lead slot and preserves the supplied backing. `scripts/export_guitar_web.py` shows the complete integration.

## Staged next version: custom instruments

[v0.2 design and backlog](docs/v0.2-instruments.md) separates musician behavior from instrument sound: MIDI plus expression → selected sample or neural instrument → aligned audio stems → mixer and WAV/MP3 export. Start with a sampled baseline, then a compact PyTorch neural guitar pilot using isolated recordings. This is staged future work; no neural audio renderer is shipped yet.
