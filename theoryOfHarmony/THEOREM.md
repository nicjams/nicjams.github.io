# From consonant triads to the major scale

This is a two-stage optimization theorem synthesizing two values:

1. Choose three distinct pitch classes that form a maximally consonant chord.
2. Choose three distinct such chords that form a maximally consonant collection.

“Consonant” is defined by a harmonicity model, not by an empirical claim that everyone prefers its winners. We distinguish a chord's harmonicity from timbral roughness and from a listener's preference. The model deliberately identifies octaves, so register and voicing do not affect its score.

Unlike the previous fifth-count construction, neither seven notes nor twelve equal-tempered pitch classes are assumptions. A tonic emerges as the unique harmonic center of the optimal chord collection.

## Model: harmonic height and consonance

A pitch class is a positive frequency modulo multiplication by powers of two. Write [f] for the class of f. A finite nonempty pitch-class set P has **harmonic height**

    H(P) = min max(n1,...,nk),

where the minimum runs over positive integers ni and a common fundamental b>0 such that

    P = { [b n1], ..., [b nk] }.

If no common harmonic representation exists, H(P)=infinity. Define its **harmonic consonance** by

    C(P) = 1/H(P), with 1/infinity = 0.

Thus a set is more consonant in this model when it fits earlier in a common harmonic series. This definition is invariant under transposition and octave displacement. It is a measure of exact harmonic simplicity, not a continuous model of tuning tolerance.

For two chords A and B, use the same rule:

    C(A,B) = C(A union B).

For three distinct chords A,B,C, define collection consonance as the total of all three pairwise consonances:

    S(A,B,C) = C(A,B) + C(B,C) + C(C,A).

This is an explicit equal-weight pairwise objective. It is not H(A union B union C)^{-1}; that different objective has different winners. Choosing three notes per chord, three primary chords, and the reciprocal scoring law are modeling assumptions.

## Lemma: computing harmonic height exactly

For a harmonically related finite pitch-class set, choose representatives proportional to primitive odd positive integers a1,...,ak with gcd(a1,...,ak)=1. Then

    H(P) = max(a1,...,ak).

**Proof.** Any integer harmonic representation can have powers of two removed from each integer without changing its pitch class, and the common gcd divided out by changing the fundamental. These operations cannot increase the maximum, giving a primitive odd representation.

To see uniqueness, suppose two primitive odd integer lists represent the same classes under different fundamentals. After matching the classes, the common scaling factor can be written 2^m u/v with u,v coprime odd positive integers. Because both lists are odd, the octave factor used in every match must cancel 2^m. Thus the two odd lists differ by the same factor u/v. Integrality and primitivity force v=1 and then u=1. The lists agree up to permutation. Every integer representation therefore has maximum at least the maximum of this primitive odd list, and the list itself attains it. QED.

The app computes this representation using exact integer arithmetic: reduce rational representatives, remove powers of two, clear denominators, and divide by the gcd.

## Theorem 1: the major triad is the unique optimal triad

Among all sets of three distinct pitch classes,

    H(P) >= 5, equivalently C(P) <= 1/5.

Equality holds exactly for the major triads

    M(r) = { [r], [3r], [5r] },

up to transposition.

**Proof.** The first four harmonics represent only two distinct pitch classes: [1]=[2]=[4] and [3]. They cannot contain three distinct pitch classes. The fifth harmonic first supplies a third class, [5]. Thus every triad has height at least five, and any triad of height five must consist of precisely [b], [3b], [5b] for some b. Conversely those classes have height five. Fold into one octave to obtain

    {1, 5/4, 3/2},

or 4:5:6 in root position: a major triad. QED.

For comparison, a just minor triad {1,6/5,3/2} has primitive odd representatives {5,3,15} and height 15. The suspended collection {1,4/3,3/2} has height 9. These rankings belong to this model; they are not universal perceptual rankings.

## Lemma: the best relationship between two major triads is a fifth

For two distinct major triads M(r), M(s), write their root ratio, modulo octaves, as b/a for coprime odd positive integers a,b. Then

    H(M(r) union M(s)) = 5 max(a,b).

In particular,

    C(M(r),M(s)) <= 1/15,

with equality exactly when the roots differ by a perfect fifth or its inverse, modulo octaves. Every other root relationship has consonance at most 1/25. Irrationally related roots have score zero.

**Proof.** Scale the roots to a,b. Their union is represented by the odd integers

    {a,3a,5a,b,3b,5b}.

Their gcd is one and their maximum is 5 max(a,b), so the height lemma applies. Distinct octave classes require a!=b. The smallest possible maximum of two distinct coprime odd positive integers is three, uniquely for the unordered pair {1,3}. The next possible maximum is at least five. Since [3]=[3/2], equality is exactly a fifth relationship. QED.

## Theorem 2: the optimal three-chord collection is a fifth chain

Among all collections of three distinct major triads,

    S <= 1/15 + 1/15 + 1/45 = 7/45.

Equality holds precisely for

    { M(r/3), M(r), M(3r) },

up to transposition and reordering.

**Proof.** Call a pair a best pair if it attains consonance 1/15. By the preceding lemma its roots differ by a factor of three or its inverse, modulo powers of two.

Three distinct roots cannot have all three pairs best: two successive fifth steps either return to the initial root (contrary to distinctness) or give a ratio of nine, not three modulo octaves. Equivalently, powers of three form an infinite path of fifth connections, with no triangle.

If at most one pair is best, then the other two pairs have consonance at most 1/25. Consequently

    S <= 1/15 + 2/25 = 11/75 < 7/45.

This bound also covers the case with no best pair.

If two pairs are best, they share a root r. Their other roots must be r/3 and 3r: choosing the same direction would duplicate a chord. The two outer roots differ by nine, so their pair has height 45. The total is exactly 7/45. These collections exist, attain the bound, and are the only equality cases. QED.

## Theorem 3: its unique harmonic center produces the major scale

Define the centrality of a chord in the collection as the sum of its consonances with the other two. In the optimal collection, the middle chord M(r) has centrality

    1/15 + 1/15 = 2/15,

whereas each outer chord has

    1/15 + 1/45 = 4/45.

Since 2/15 > 4/45, the middle chord is the unique harmonic center. Take its root as the tonic. Relative to that tonic, the union of the three chords, folded into [1,2), is exactly

    1, 9/8, 5/4, 4/3, 3/2, 5/3, 15/8.

**Proof of the union.** Use root representatives 2/3, 1, 3/2 for the fifth below, tonic, and fifth above. In root position their major triads are

    {2/3,5/6,1}, {1,5/4,3/2}, {3/2,15/8,9/4}.

Octave-folding and removing duplicates yields the seven ratios displayed above. For tonic C these are F–A–C, C–E–G, G–B–D, whose union is C–D–E–F–G–A–B. QED.

Thus the two values, under this model, select both a seven-note collection and a distinguished major tonic. Merely rotating its note names to begin on B does not make B the harmonic center; a B-Locrian reading does not satisfy the theorem's tonic rule. This is a mathematical distinction between a rooted harmonic construction and an unrooted pitch collection, not a claim that listeners cannot establish another modal center.

## Assumptions, alternatives, and scope

The conclusions are conditional on octave equivalence, exact harmonic simplicity C=1/H, three distinct notes per chord, three distinct optimal chords, equal-weight pairwise collection scoring, and identifying the tonic with the unique chord center.

In particular, changing the collection objective changes the theorem. If one minimizes harmonic height of the entire union, the roots {1,3,5} give height 25, better than the fifth chain's height 45. If one minimizes the sum of pair heights, {1,3,5} totals 15+25+25=65, better than 15+15+45=75. Neither alternative proves the requested conclusion. The reciprocal law matters and is visible in the explorer.

This model is discontinuous under exact detuning. It is useful for deriving ideal harmonic structures but is not by itself a complete acoustic, perceptual, historical, or aesthetic theory. Real tuning tolerance, timbre, familiarity, voicing, rhythm and melodic behavior all matter. The page's roughness experiment is a separate continuous acoustic model.

## The tuning compromise within the resulting scale

With the seven ratios fixed, D–A is (5/3)/(9/8)=40/27, not 3/2. Lowering D to 10/9 makes D–F–A pure (10:12:15), but the G–D fifth becomes 40/27. The D values differ by 81/80, about 21.506 cents. The Tuning chapter lets the reader hear this compromise. The theorem does not assert purity of all seven diatonic triads.

## Verification

The proofs above cover all pitch classes, with no finite search bound. Run `npm test` for exact-arithmetic model checks, low-height triad enumeration, exhaustive tests of bounded rational root triples, equality cases, tuning identities, audio lifecycle and voice-leading regressions. Bounded enumeration is a check, not a replacement for the proof.

The page's Triads chapter shows why the fifth harmonic is the first to provide three distinct octave classes. The Proof chapter accepts arbitrary positive integer root ratios up to its stated input limit, displays all three pair heights and the exact sum, identifies the unique center at equality, and derives the union relative to it.

## Background

- Sethares, [Local Consonance and the Relationship Between Timbre and Scale](https://sethares.engr.wisc.edu/papers/consance.html), JASA, 1993: spectrum-dependent sensory consonance.
- McDermott, Lehr & Oxenham, [Individual Differences Reveal the Acoustic Basis of Consonance](https://mcdermottlab.mit.edu/consonance_examples/page2.html), Current Biology, 2010: harmonicity and musical experience.

These are background for distinguishing acoustic and perceptual ingredients, not citations for this exact harmonic-height objective or proof. No claim of historical novelty is made.
