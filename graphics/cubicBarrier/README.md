# Cubic Barrier Braids

A penetration-free rod simulator that follows the core loop of ZOZO's
[ppf-contact-solver](https://github.com/st-tech/ppf-contact-solver)
(R. Ando, *A Cubic Barrier with Elasticity-Inclusive Dynamic Stiffness*,
ACM TOG 43(6), 2024), with a braid-group lab built on top of it.

Open `index.html` (it enters the Graphics Studio stage) or
`index.html?standalone=1`. URL parameters: `scene=braid|knot|rope|noodles`,
`n=4`, `word=1,-2,1` (braid scene).

## Scenes

- **Braid**: weighted beads hang on rails below a bar. The generator σᵢ is a
  half-twist of the bottom pins at positions i and i+1, and the left pin
  passes in front. Δ, Δ⁻¹ and Δ² rotate every pin. After each move the braid
  is read back from the simulated strands (sweep by height, sign from depth)
  and compared with the applied word through the Garside normal form. The
  panel also shows the permutation, the Garside normal form, the trace of the
  reduced Burau matrix, and the Alexander polynomial of the closure.
- **Knot**: a loose trefoil, figure-eight, cinquefoil or T(2,7) in one rope,
  pulled tight by its ends. The camera follows the knotted part.
- **Rope**: strands between two clamps with the bottom clamp spinning, after
  ppf's `twist` scene.
- **Noodles**: self-avoiding random strands dropped into a bowl, after ppf's
  `noodle` scene.

## What is ported (js/solver.js)

| ppf | here |
| --- | --- |
| `kernels/barrier/cubic.hpp`: ψ(g) = −(2/3ĝ)(g−ĝ)³ | `barrier.js`, along with the `log` and `quad` barriers |
| `contact_stiffness.kernel.cpp`: κ = Σmᵢwᵢ²/(W²g²) + dᵀHd | `Sim._contactN`, with H the fixed (inertia + elastic) matrix |
| Hessian `κψ″ n nᵀ` per contact stencil | COO blocks `wᵢwⱼ[λI + (κψ″ − λ) n nᵀ]` |
| `friction.kernel.cpp`: λ = μ f_n / max(ε, ‖u_t‖) | same, with slip measured from the start of the step |
| `strainlimiting/rod_strain.kernel.cpp` | the cubic barrier on τ − ε, κ = shapeᵀH shape + m/gap² |
| `driver/step.rs`: `toi_advanced`, `target-toi` = 0.25, `line-search-max-t` = 1.25, Δt shrink, final error-reduction iteration | `Sim.step` |
| `contact/accd.hpp` (additive CCD) | `accd4` / `accd3` (the classic ACCD of Li et al. 2021) |
| block-Jacobi PCG | PCG with a per-strand banded Cholesky preconditioner |

The design choice that matters: there is no energy line search. The only
things that shorten a Newton step are CCD and the strain limits, so every
accepted configuration is intersection-free. The telemetry strip counts
intersecting pairs in each accepted state, and it stays at 0 unless you turn
the CCD filter off.

When a pinned motion drives strands that cannot yield (friction locking the
wraps, strain at its limit), ppf reports a stalled Newton loop. Here each
scene holds its pins still and retries instead, and the braid panel says so.

## Checks

    node graphics/tests/cubicBarrier.mjs

These check the braid relations, Garside normal-form round trips, the Burau
homomorphism and the Alexander polynomials of known closures. They also run
braids and check the read-back equals the applied word with 0 intersections,
check that a fast yank tunnels only when CCD is off, and check that every
knot tightens without stalling.
