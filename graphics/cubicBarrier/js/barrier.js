// barrier.js — the three contact barriers of ppf-contact-solver, ported from
// crates/ppf-cts-solver/src/kernels/barrier/{cubic,logarithm,quadratic}.hpp.
//
// Each barrier is a function of the gap g (distance minus the contact offset)
// that switches on below the activation gap ĝ. The solver multiplies it by a
// stiffness κ; for the cubic barrier κ is the elasticity-inclusive dynamic
// stiffness  κ = m/g² + nᵀHn, re-evaluated at every Newton iteration.
//
//   cubic      ψ(g) = −(2/3ĝ)(g − ĝ)³           finite at g = 0, C² at ĝ
//   log (IPC)  ψ(g) = −(g − ĝ)² ln(g/ĝ)          infinite at g = 0
//   quadratic  ψ(g) = (ĝ − g)²                   a penalty; finite everywhere
//
// The cubic barrier does not diverge at contact. It does not have to: the
// line search never lets g reach 0 (CCD), and the dynamic stiffness grows like
// 1/g², so the force  κ·ψ′(g)  still blows up as the gap closes.

export const BARRIERS = {
  cubic: {
    label: 'Cubic',
    energy(g, gh) {
      const y = g - gh;
      return y < 0 ? (-2 * y * y * y) / (3 * gh) : 0;
    },
    gradient(g, gh) {
      const y = g - gh;
      return y < 0 ? (-2 * y * y) / gh : 0;
    },
    curvature(g, gh) {
      return g < gh ? 4 * (1 - g / gh) : 0;
    },
  },
  log: {
    label: 'Log (IPC)',
    energy(g, gh) {
      if (g <= 0) return Infinity;
      if (g >= gh) return 0;
      return -(g - gh) * (g - gh) * Math.log(g / gh);
    },
    gradient(g, gh) {
      if (g <= 0) return -Infinity;
      if (g >= gh) return 0;
      return ((gh - g) * (2 * g * Math.log(g / gh) + g - gh)) / g;
    },
    curvature(g, gh) {
      if (g <= 0) return Infinity;
      if (g >= gh) return 0;
      return -2 * Math.log(g / gh) + (gh * (gh + 2 * g)) / (g * g) - 3;
    },
  },
  quad: {
    label: 'Quadratic',
    energy(g, gh) {
      const y = gh - g;
      return y > 0 ? y * y : 0;
    },
    gradient(g, gh) {
      const y = gh - g;
      return y > 0 ? -2 * y : 0;
    },
    curvature(g, gh) {
      return gh - g > 0 ? 2 : 0;
    },
  },
};
