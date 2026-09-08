# Local validation · 2026-09-08

Executed with Python 3.14 and PyTorch 2.9.1 on CPU. This is a small synthetic-data smoke run, not a T4 benchmark or a claim of realistic musicianship.

- Dataset: 64 procedural songs, 32 steps per song, seed 7; 52 training songs and 12 held-out songs.
- Model: width 64, two layers, four heads, 358,184 parameters.
- Training: 800 updates, batch size 8, accumulation 1; checkpoint then loaded and resumed for one update (801 total).
- Held-out weighted loss: 0.340437.
- Held-out onset F1: 0.259374, using summed onset probability > 0.5 from the class-weighted model, with teacher forcing. This is not calibrated generation quality.
- Best/last checkpoints loaded successfully with restricted weights-only deserialization.
- Four unittest cases pass, covering causal/target masking, conditioning, MIDI round trips, WAV output, grouped splits/import, and generation validity/reproducibility.
- Notebook code cells compile. Interactive Colab/CUDA execution has not been verified because the available browser is signed out.

Reproduce the training run:

```bash
supergroups demo-data --songs 64 --steps 32
supergroups train --updates 800 --batch-size 8 --accumulate 1 --width 64 --heads 4 --layers 2 --eval-every 200 --out runs/verified
supergroups train --resume runs/verified/last.pt --updates 1 --batch-size 8 --accumulate 1 --out runs/verified
```

The three MIDI examples use the same checkpoint, seed 17, temperature 0.85, and two rehearsal rounds. `listening.mid` uses ensemble context, `independent.mid` removes it, and `swapped.mid` changes the keys player from spacious to restless. JSON files preserve the settings. `listening.wav` is a basic synthesized preview. The early model can be sparse, repetitive, or harmonically inconsistent; the examples demonstrate execution and sensitivity, not convincing human styles.

Sampling compensates for the training class weights before applying temperature, then enforces instrument ranges and polyphony limits. See the README for interpretation and limitations.
