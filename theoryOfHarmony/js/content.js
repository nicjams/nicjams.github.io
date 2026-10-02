export const chapters = [
  {
    id: "intro",
    name: "Begin",
    title: "A Theory of Harmony",
    lab: "A scale to investigate",
    body: `
<p>Can two values lead us to the major scale? First, choose <strong>notes that fit well together</strong>. Then choose <strong>chords that fit well together</strong>.</p>
<div class="insight"><p>We will turn these values into one harmonicity model, prove that it selects major triads, and prove that the best three-triad collection is <strong>IV–I–V</strong>.</p></div>
<p>The middle chord becomes the unique harmonic center. Its seven notes form the major scale relative to that center—without assuming seven notes or twelve equal-tempered pitch classes at the outset.</p>
<p>Listen to the scale, then explore waves, strings, and the optimization behind it.</p>
<details><summary>What kind of consonance will we prove?</summary><p>Our harmonic consonance score is the reciprocal of the lowest harmonic limit needed to contain a pitch-class set. It measures exact harmonic simplicity. It is distinct from roughness and from a listener’s preference.</p><p>We assume octave equivalence, three notes per chord, and three primary chords. The collection score sums pairwise chord consonances. Each assumption will be stated where it enters the proof.</p></details>`,
  },
  {
    id: "beating",
    name: "Beating",
    title: "From beats to roughness",
    lab: "Two nearby frequencies",
    body: `
<p>Play 440 Hz and 441 Hz together. Their interference produces <strong>one beat per second</strong>. Increase the separation and the distinct pulses merge into a rougher sound.</p>
<p>Compare the presets, then move each handle or use the frequency controls. The dashed curves trace the amplitude envelope.</p>
<div class="insight"><p><strong>Listen for the difference:</strong> slow beating is not automatically unpleasant. Roughness depends on separation, register, and the listener.</p></div>
<details><summary>The identity behind the picture</summary><div class="equation">sin(2πf₁t) + sin(2πf₂t)<br>= 2 cos(π(f₁ − f₂)t) sin(π(f₁ + f₂)t)</div><p>The signed cosine factor has frequency |f₁ − f₂|/2. Its absolute value—the amplitude envelope—has |f₁ − f₂| maxima per second.</p><p>The plot shows a 0.12-second signal window in slow motion. It is not a live oscilloscope. The frequency-dependent roughness model is explained in the Intervals chapter.</p></details>`,
  },
  {
    id: "string",
    name: "String",
    title: "One string, many modes",
    lab: "Pluck position changes timbre",
    body: `
<p>Pull the string and release it. Its motion is a sum of standing waves, with frequencies f₀, 2f₀, 3f₀, …</p>
<p><strong>Try the midpoint:</strong> the even harmonics disappear. Move the pluck toward an end and compare the brighter sound. The picture and sound use the same eight amplitudes.</p>
<div class="insight"><p>The harmonic series describes the available modes. How you excite the string determines which modes are present.</p></div>
<details><summary>The plucked-string model</summary><div class="equation">Aₙ = 2h sin(nπp) / [π²n²p(1 − p)]<br>y(x,t) = Σ Aₙ sin(nπx) cos(2πnf₀t)</div><p>For an ideal flexible string pulled into a triangle of height h at fractional position p, these are the Fourier coefficients. Release is from rest, with time measured from release. We add a simple harmonic-dependent decay and retain eight modes.</p><p>The animation runs at 1.5 Hz for the fundamental, while audio uses E₂ ≈ 82.41 Hz. Real stiff strings can have inharmonic partials; not every sound has integer-multiple overtones. The fundamental is harmonic 1; harmonic 2 is the first overtone.</p></details>`,
  },
  {
    id: "intervals",
    name: "Intervals",
    title: "Where partials meet",
    lab: "Explore the roughness landscape",
    body: `
<p>Hold one note fixed and move the other. With harmonic tones, simple ratios often align prominent partials and produce local valleys in roughness.</p>
<p>Select <strong>5:4</strong>, then switch between a pure sine, a string-like tone, and stretched partials. Does the same interval still occupy a valley?</p>
<div class="insight"><p>Consonance depends on the sound’s spectrum. A low roughness score is one acoustic property, not a verdict on musical beauty.</p></div>
<details><summary>Read the spectrum and model</summary><p>Colored stems show the same partial amplitudes used in the sound. Green connectors mark coincidences (within 0.05 Hz), and rose connectors mark nearby interactions. At a fifth, every third harmonic of the lower note matches every second harmonic of the upper. At an octave, every harmonic of the upper note matches an even harmonic of the lower.</p><p>Our dimensionless score averages pairwise interactions between notes using absolute amplitude products. The pair curve is exp(−3.5sΔf) − exp(−5.75sΔf), with s = 0.24/(0.021fmin + 19). It is an illustrative variant of the <a href="https://sethares.engr.wisc.edu/comprog.html">Sethares parameterization</a>, not a calibrated perceptual scale. The bandwidth grows with frequency.</p><p>Research also implicates <a href="https://mcdermottlab.mit.edu/consonance_examples/page2.html">harmonicity and musical experience</a>. Roughness alone does not explain musical consonance.</p></details>`,
  },
  {
    id: "triads",
    name: "Triads",
    title: "The optimal triad",
    lab: "When does a third pitch class appear?",
    body: `
<p>Define a chord’s <strong>harmonic height H</strong> as the smallest highest harmonic needed to contain its pitch classes in a common harmonic series. Lower height means greater harmonic simplicity.</p>
<p>Start with the first four harmonics. After identifying octaves, they give only <strong>two</strong> pitch classes. Harmonic 5 supplies the third.</p>
<div class="insight"><p><strong>Theorem 1.</strong> Every three-note pitch-class set has H ≥ 5. Equality holds only for a major triad, up to transposition.</p></div>
<details><summary>The short proof</summary><p>Among harmonics 1, 2, 3, 4, the classes of 1, 2 and 4 coincide. Only classes [1] and [3] remain. Adding harmonic 5 gives precisely {[1], [3], [5]}.</p><p>Fold those classes into one octave: 1, 5/4, 3/2. These are 4:5:6 in root position—the major triad. No three-class set fits before harmonic 5, and no other three-class set appears at that limit.</p></details>
<details><summary>Consonance, normalization and scope</summary><p>Set C(P) = 1/H(P). Harmonic height allows a common transposition and independent octave shifts. For exact rational classes, remove powers of two, clear denominators, divide out their common gcd, and take the largest resulting odd integer.</p><p>This is a harmonicity model, not a universal preference ranking. A just minor triad has H = 15; a suspended triad has H = 9. Detuning requires a tolerance model, explored separately through roughness.</p></details>`,
  },
  {
    id: "chords",
    name: "Build",
    title: "Three interlocking triads",
    lab: "Build the seven-note collection",
    body: `
<p>The first theorem selects a major triad. Start with <strong>C–E–G</strong>, then add major triads a fifth below and above. We will prove why these two additions optimize our second value.</p>
<p>Watch shared notes merge. Fold octave-related frequencies into one octave to compare the resulting pitch classes.</p>
<div class="insight"><p>C–E–G ∪ F–A–C ∪ G–B–D<br><strong>= C–D–E–F–G–A–B.</strong></p></div>
<details><summary>What we have chosen</summary><p>Major triads were selected by the harmonic-height theorem. The final proof will show that a fifth-chain is the unique optimal three-chord collection under the sum of pairwise reciprocal harmonic heights. Its middle chord is the unique center.</p><p>The exact ratios relative to C are 1, 9/8, 5/4, 4/3, 3/2, 5/3, 15/8. They support pure I, IV and V chords. Calling the roots “scale degrees 1, 4, 5” comes after constructing the scale.</p><p>The final theorem identifies C’s chord as this collection’s unique harmonic center. Calling B the tonic would give a Locrian reading, but B is not the center selected by our model. The next experiment exposes a tuning compromise within the collection.</p></details>`,
  },
  {
    id: "tuning",
    name: "Tuning",
    title: "A beautiful compromise",
    lab: "Just intonation and equal temperament",
    body: `
<p>Our exact scale makes I, IV and V pure. But play <strong>ii: D–F–A</strong>. D–A is 40:27, narrower than a pure 3:2 fifth.</p>
<p>Lower D from 9/8 to 10/9 to repair ii. Then play V: its G–D fifth has become narrow instead. The adjustment is <strong>81:80 ≈ 21.51 cents</strong>, the syntonic comma.</p>
<div class="insight"><p>One fixed set of these seven pitches cannot satisfy both demands. Equal temperament distributes the compromises.</p></div>
<details><summary>Exact tuning versus pitch classes</summary><p>Equal temperament uses f = fC · 2^(n/12). Its fifth is 700 cents, rather than the pure fifth’s 701.955; its major third is 400 cents rather than 386.314.</p><p>Here “just” means this specific fixed C-major tuning. Other just tunings are possible. The repair gives ii the ratios 10:12:15, but sacrifices V. The diminished vii° chord is included; it is not a major or minor triad.</p><p>The final theorem uses exact pitch classes modulo octaves and a harmonicity score. It does not claim that all the diatonic triads are simultaneously pure.</p></details>`,
  },
  {
    id: "voice",
    name: "Motion",
    title: "Chords become a progression",
    lab: "Follow three voices",
    body: `
<p>Play I–IV–V–I in root position, then select <strong>smooth voices</strong>. The chord names stay the same; their notes move through different octaves.</p>
<p>Follow each colored voice. A horizontal line means the pitch stays fixed. Shorter steps reduce total motion, measured here in semitones.</p>
<div class="insight"><p>Shared notes help connect chords. Register, voicing, rhythm, and a sense of tonic also shape a progression.</p></div>
<details><summary>How the comparison works</summary><p>The smooth version starts with C–E–G. At each transition it chooses an inversion in C₃–C₆ minimizing the sum of three voices’ absolute semitone movements, without crossing voices. This is a local rule, not a claim that it finds the best musical arrangement or a globally optimal progression.</p><p>Both versions use equal temperament. You can also hear all seven diatonic triads, including vii°, followed by a return to I.</p></details>`,
  },
  {
    id: "theorem",
    name: "Synthesis",
    title: "The optimal collection of triads",
    lab: "Three chords, one harmonic center",
    body: `
<p>We already selected major triads. Apply the <strong>same consonance score</strong> to each pair of chords: C(A,B) = 1/H(A ∪ B). Score a collection by the sum over its three pairs.</p>
<div class="insight"><p><strong>Theorem 2.</strong> The maximum is 7/45, attained only by a chain of fifth-related major triads.</p><p><strong>Theorem 3.</strong> Its middle chord is the unique harmonic center. Relative to that root, the union is exactly the just major scale.</p></div>
<details><summary>Why fifths are the best chord connection</summary><p>Write the root ratio as b/a, with a,b coprime odd integers (octaves removed). The two major triads have primitive harmonic representatives {a,3a,5a,b,3b,5b}, so their union has height <strong>5 max(a,b)</strong>.</p><p>For distinct chords, the lowest possible maximum is 3: {a,b} = {1,3}. Hence fifth-related chords score 1/15; every other pair scores at most 1/25.</p></details>
<details><summary>Why the fifth chain wins globally</summary><p>Three distinct roots cannot all be pairwise fifth-related. If at most one pair earns 1/15, the total is at most <strong>1/15 + 2/25 = 11/75</strong>.</p><p>Two best pairs force roots r/3, r, 3r. The outer pair has root ratio 9 and height 45. This gives <strong>1/15 + 1/15 + 1/45 = 7/45 &gt; 11/75</strong>, proving the bound and its unique equality shape.</p></details>
<details><summary>Why this selects major, not Locrian</summary><p>The middle chord’s connections sum to 2/15. Each outer chord has only 4/45. Thus the middle chord is the unique harmonic center.</p><p>Take its root as tonic. The three triads are IV, I and V; their octave-folded union is <strong>1, 9/8, 5/4, 4/3, 3/2, 5/3, 15/8</strong>. This distinguishes the major tonic from another starting note in the same collection.</p></details>
<details><summary>Assumptions and alternative objectives</summary><p>The theorem assumes octave equivalence, three distinct notes per chord, three distinct optimal chords, the reciprocal-height score, and taking the unique chord center as tonic. Seven notes and twelve pitch classes are not assumptions.</p><p>Using the whole union’s harmonic height or summing heights instead produces different optima. Our model sums reciprocal pair heights; the choice matters. This proves a conditional harmonic structure, not a universal cultural or perceptual preference.</p><p><a href="THEOREM.md">Full definitions, proofs, scope, and verification.</a></p></details>`,
  },
];
