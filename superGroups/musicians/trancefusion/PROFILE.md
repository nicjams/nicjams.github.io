# Trancefusion guitarist

An original synthetic lead-guitar identity derived from the user's musical brief. This is a musical interpretation, not a model of a named performer's recordings. It occupies the lead slot alongside the existing bass, keys, and drums.

## Musical curriculum

| Trait in the brief | Original training exercise | What we measure |
| --- | --- | --- |
| Small, memorable ideas | Independently sampled four-note contours and four syncopated rhythm families | Adjacent-bar onset overlap; repeated rhythmic identity |
| Dance-like repetition | Short picked notes over a four-on-the-floor pulse; repeated two-bar harmony | Onset timing and recurrence without generating continuous streams |
| Gradual variation | Changed phrase endings, brief connecting runs, octave lifts | Pitch prediction and changes across phrase sections |
| Melodic destinations | Sustained endings after clipped sequences | Duration distribution and sustained-note fraction |
| Bright/dark harmonic shifts | All 12 tonics; major/minor thirds; multiple progressions | Correct pitches with and without accompaniment |
| Building a jam | Sixteen-bar establish / repeat / transform / peak-and-resolve arc | Late-versus-early pitch register; final resolution |
| Space and restraint | Empty introductory, seventh, and eleventh bars | Silent bars and event prediction |
| Dynamics | Section-dependent velocity and recurring accents | Learned velocity categories |

The fixed arc and prescribed gaps are teaching exercises, not claims about how the source artist always performs. More varied real musical data would be needed to learn less predictable, longer improvisations.

## Representation and training

A dedicated causal PyTorch Transformer predicts silence, sustain, or a new note, followed by pitch and velocity. It sees the previous guitar events and the bass, keyboard, and drum activity heard so far. The target guitar is excluded from accompaniment features. It uses 256 sixteenth-note steps (16 bars), 128 hidden channels, three attention layers, and four heads, with separate action/pitch/velocity objectives.

The synthetic corpus contains 640 independent songs: 512 training, 64 validation, and 64 untouched final-test songs. Each entire song and its motif stay within one partition. All seeds are deterministic. Validation guides model changes; the final test is evaluated only after selection. These scores describe synthetic exercises, not likeness to an artist or perceptual musical quality.

The motif-memory variant adds the guitarist's event from exactly one bar earlier. This is past generated history at inference, not copied future notes or supplied target melodies. All exported guitar notes are sampled from the trained network.

## Scope and limits

The model learns note decisions, durations, rests, and velocities. It does not learn recorded timbre, amplifier behavior, bends, vibrato, slides, or picking technique. The browser guitar sound is an illustrative synthesizer. The accompaniment for the new musician is held fixed while it generates its part; the existing rhythm players have not been retrained to follow harmonic changes initiated by this guitarist. The current monophonic representation cannot play clipped multi-note chord fragments.

The supplied prose is a design brief. Interview links in it are references supplied by the user; their contents were not used as training material.
