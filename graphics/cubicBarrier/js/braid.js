// braid.js — exact braid-group algebra for the Braid Lab.
//
// Words are arrays of nonzero integers: +i is σᵢ, −i is σᵢ⁻¹ (1 ≤ i < n).
// Convention, matching the simulation: the braid is read top to bottom, new
// letters are appended at the bottom, and in σᵢ the strand moving from
// position i to position i+1 passes IN FRONT (toward the viewer).
//
//   garside(word, n)    left normal form Δᵖ·A₁⋯A_r (solves the word problem)
//   burau(word, n)      reduced Burau matrix over ℤ[t, t⁻¹] (BigInt)
//   alexander(word, n)  Alexander polynomial of the closure
//   readBraid(...)      the braid word of a set of simulated strands

// -------------------------------------------------------------- basics

export function freeReduce(word) {
  const out = [];
  for (const g of word) {
    if (out.length && out[out.length - 1] === -g) out.pop();
    else out.push(g);
  }
  return out;
}

export const inverse = (word) => word.slice().reverse().map((g) => -g);

export const exponentSum = (word) => word.reduce((s, g) => s + Math.sign(g), 0);

/** perm[k] = bottom position of the strand that starts at top position k. */
export function permutation(word, n) {
  const at = Array.from({ length: n }, (_, k) => k); // at[pos] = strand
  for (const g of word) {
    const i = Math.abs(g) - 1;
    [at[i], at[i + 1]] = [at[i + 1], at[i]];
  }
  const perm = new Array(n);
  at.forEach((strand, pos) => { perm[strand] = pos; });
  return perm;
}

export function cycles(perm) {
  const seen = new Array(perm.length).fill(false), out = [];
  for (let k = 0; k < perm.length; k++) {
    if (seen[k]) continue;
    const c = [];
    for (let j = k; !seen[j]; j = perm[j]) { seen[j] = true; c.push(j); }
    out.push(c);
  }
  return out;
}

const SUB = '₀₁₂₃₄₅₆₇₈₉', SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
export const sub = (k) => String(k).split('').map((c) => SUB[+c]).join('');
export const sup = (k) => String(k).split('').map((c) => SUP[c]).join('');

export function letter(g) {
  return `σ${sub(Math.abs(g))}${g < 0 ? '⁻¹' : ''}`;
}

/** Compact word: runs of the same letter become powers, σ₁σ₁σ₁ → σ₁³. */
export function wordString(word, empty = 'e') {
  if (!word.length) return empty;
  let out = '', k = 0;
  while (k < word.length) {
    let j = k;
    while (j < word.length && word[j] === word[k]) j++;
    const run = j - k, g = word[k];
    out += `σ${sub(Math.abs(g))}` + (g < 0 || run > 1 ? sup(g < 0 ? -run : run) : '');
    k = j;
  }
  return out;
}

// ------------------------------------------------- Garside normal form
//
// A simple braid (positive, every pair of strands crosses at most once) is
// stored as its permutation π, π(k) = bottom position of the strand starting
// at top position k. Composition A·B (A on top) is π_B ∘ π_A.

const idPerm = (n) => Array.from({ length: n }, (_, k) => k);
const deltaPerm = (n) => Array.from({ length: n }, (_, k) => n - 1 - k);
const isId = (p) => p.every((v, k) => v === k);
const isDelta = (p) => p.every((v, k) => v === p.length - 1 - k);
const invPerm = (p) => { const q = new Array(p.length); p.forEach((v, k) => { q[v] = k; }); return q; };

// j ∈ S(B) ⇔ B = σⱼ·B′: the strands starting at j, j+1 cross in B.
const starts = (p, j) => p[j] > p[j + 1];
// j ∈ F(A) ⇔ A = A′·σⱼ: the strands ending at j, j+1 have crossed in A.
const finishes = (pinv, j) => pinv[j] > pinv[j + 1];

function tau(p) { // Garside automorphism x ↦ ΔxΔ⁻¹ (σᵢ ↦ σₙ₋ᵢ)
  const n = p.length;
  return p.map((_, k) => n - 1 - p[n - 1 - k]);
}

// Make the pair (A, B) left-weighted: slide letters from the head of B onto
// the tail of A until every starting letter of B is a finishing letter of A.
function leftWeight(A, B) {
  const n = A.length;
  let changed = false;
  for (;;) {
    const Ainv = invPerm(A);
    let moved = false;
    for (let j = 0; j < n - 1; j++) {
      if (starts(B, j) && !finishes(Ainv, j)) {
        // A ← A·σⱼ (swap bottom positions j, j+1);  B ← σⱼ⁻¹·B
        const a = A.map((v) => (v === j ? j + 1 : v === j + 1 ? j : v));
        const b = B.slice(); [b[j], b[j + 1]] = [b[j + 1], b[j]];
        A.splice(0, n, ...a); B.splice(0, n, ...b);
        moved = changed = true;
        break;
      }
    }
    if (!moved) return changed;
  }
}

/** Left normal form {n, p, factors}: β = Δᵖ · A₁ ⋯ A_r. */
export function garside(word, n) {
  let p = 0;
  let F = [];
  const append = (X) => {
    F.push(X.slice());
    for (let k = F.length - 2; k >= 0; k--) leftWeight(F[k], F[k + 1]);
    while (F.length && isDelta(F[0])) { F.shift(); p++; }
    while (F.length && isId(F[F.length - 1])) F.pop();
  };
  for (const g of word) {
    const j = Math.abs(g) - 1;
    if (g > 0) {
      const s = idPerm(n); [s[j], s[j + 1]] = [s[j + 1], s[j]];
      append(s);
    } else {
      // σⱼ⁻¹ = Δ⁻¹·M with M = Δσⱼ⁻¹ simple (π_M = sⱼ ∘ π_Δ); pull Δ⁻¹ left.
      p -= 1;
      F = F.map(tau);
      const M = deltaPerm(n).map((v) => (v === j ? j + 1 : v === j + 1 ? j : v));
      append(M);
    }
  }
  return { n, p, factors: F };
}

export function garsideEqual(a, b) {
  if (a.n !== b.n || a.p !== b.p || a.factors.length !== b.factors.length) return false;
  return a.factors.every((f, k) => f.every((v, j) => v === b.factors[k][j]));
}

/** Positive word for a simple braid (read off its crossings left to right). */
export function simpleWord(perm) {
  const q = perm.slice(), w = [];
  for (;;) {
    let j = 0;
    while (j < q.length - 1 && !(q[j] > q[j + 1])) j++;
    if (j >= q.length - 1) return w;
    w.push(j + 1);
    [q[j], q[j + 1]] = [q[j + 1], q[j]];
  }
}

export function garsideString(nf) {
  const parts = [];
  if (nf.p !== 0) parts.push(`Δ${nf.p === 1 ? '' : sup(nf.p)}`);
  for (const f of nf.factors) parts.push(wordString(simpleWord(f)));
  return parts.length ? parts.join(' · ') : 'e';
}

export const deltaWord = (n) => simpleWord(deltaPerm(n));

// --------------------------------------------- Laurent polynomials (ℤ)
//
// {lo, c}: c[k] (BigInt) is the coefficient of t^(lo + k); trimmed at both
// ends, zero is {lo: 0, c: []}.

const Z0 = 0n;
function norm(P) {
  let a = 0, b = P.c.length;
  while (a < b && P.c[a] === Z0) a++;
  while (b > a && P.c[b - 1] === Z0) b--;
  return a === b ? { lo: 0, c: [] } : { lo: P.lo + a, c: P.c.slice(a, b) };
}
export const L = {
  zero: () => ({ lo: 0, c: [] }),
  mono: (k, deg = 0) => norm({ lo: deg, c: [BigInt(k)] }),
  isZero: (P) => P.c.length === 0,
  add(P, Q) {
    if (!P.c.length) return Q;
    if (!Q.c.length) return P;
    const lo = Math.min(P.lo, Q.lo), hi = Math.max(P.lo + P.c.length, Q.lo + Q.c.length);
    const c = new Array(hi - lo).fill(Z0);
    P.c.forEach((v, k) => { c[P.lo - lo + k] += v; });
    Q.c.forEach((v, k) => { c[Q.lo - lo + k] += v; });
    return norm({ lo, c });
  },
  neg: (P) => ({ lo: P.lo, c: P.c.map((v) => -v) }),
  sub: (P, Q) => L.add(P, L.neg(Q)),
  mul(P, Q) {
    if (!P.c.length || !Q.c.length) return L.zero();
    const c = new Array(P.c.length + Q.c.length - 1).fill(Z0);
    P.c.forEach((a, i) => { if (a !== Z0) Q.c.forEach((b, j) => { c[i + j] += a * b; }); });
    return norm({ lo: P.lo + Q.lo, c });
  },
  // exact division by a divisor whose extreme coefficients are ±1
  div(P, Q) {
    if (!P.c.length) return L.zero();
    const r = P.c.slice(), dq = Q.c.length, lead = Q.c[dq - 1];
    const qn = r.length - dq + 1;
    if (qn <= 0) throw new Error('inexact division');
    const q = new Array(qn).fill(Z0);
    for (let k = qn - 1; k >= 0; k--) {
      const coef = r[k + dq - 1] / lead;
      if (coef * lead !== r[k + dq - 1]) throw new Error('inexact division');
      q[k] = coef;
      for (let j = 0; j < dq; j++) r[k + j] -= coef * Q.c[j];
    }
    if (r.some((v) => v !== Z0)) throw new Error('inexact division');
    return norm({ lo: P.lo - Q.lo, c: q });
  },
  evalAt1: (P) => P.c.reduce((s, v) => s + v, Z0),
};

/** Human-readable Laurent polynomial in t. */
export function polyString(P, v = 't') {
  if (!P.c.length) return '0';
  let out = '';
  for (let k = P.c.length - 1; k >= 0; k--) {
    const c = P.c[k];
    if (c === Z0) continue;
    const e = P.lo + k, neg = c < Z0, a = neg ? -c : c;
    const mon = e === 0 ? '' : e === 1 ? v : `${v}${sup(e)}`;
    const coef = a === 1n && mon ? '' : String(a);
    out += out ? (neg ? ' − ' : ' + ') : neg ? '−' : '';
    out += coef + mon;
  }
  return out;
}

// ------------------------------------------------------------ Burau

// Reduced Burau: σᵢ ↦ I except row i (1-based) = (…, t, −t, 1, …) in
// columns i−1, i, i+1;  σᵢ⁻¹ row i = (…, 1, −t⁻¹, t⁻¹, …).
function burauGen(g, n) {
  const m = n - 1, i = Math.abs(g) - 1;
  const M = Array.from({ length: m }, (_, r) => Array.from({ length: m }, (_, c) => (r === c ? L.mono(1) : L.zero())));
  if (g > 0) {
    if (i - 1 >= 0) M[i][i - 1] = L.mono(1, 1);
    M[i][i] = L.mono(-1, 1);
    if (i + 1 < m) M[i][i + 1] = L.mono(1);
  } else {
    if (i - 1 >= 0) M[i][i - 1] = L.mono(1);
    M[i][i] = L.mono(-1, -1);
    if (i + 1 < m) M[i][i + 1] = L.mono(1, -1);
  }
  return M;
}

function matMul(A, B) {
  const m = A.length;
  return A.map((row, r) => Array.from({ length: m }, (_, c) => {
    let s = L.zero();
    for (let k = 0; k < m; k++) if (row[k].c.length && B[k][c].c.length) s = L.add(s, L.mul(row[k], B[k][c]));
    return s;
  }));
}

export function burau(word, n) {
  const m = n - 1;
  if (m < 1) return [];
  let M = Array.from({ length: m }, (_, r) => Array.from({ length: m }, (_, c) => (r === c ? L.mono(1) : L.zero())));
  for (const g of word) M = matMul(M, burauGen(g, n));
  return M;
}

// determinant by expansion over column subsets (m ≤ 7)
function det(A) {
  const m = A.length;
  if (!m) return L.mono(1);
  const memo = new Map();
  const rec = (row, mask) => {
    if (row === m) return L.mono(1);
    const key = mask;
    if (memo.has(key)) return memo.get(key);
    let s = L.zero(), sign = 1;
    for (let c = 0; c < m; c++) {
      if (mask & (1 << c)) continue;
      if (A[row][c].c.length) {
        const term = L.mul(A[row][c], rec(row + 1, mask | (1 << c)));
        s = sign > 0 ? L.add(s, term) : L.sub(s, term);
      }
      sign = -sign;
    }
    memo.set(key, s);
    return s;
  };
  return rec(0, 0);
}

/**
 * Alexander polynomial of the braid closure:
 *   Δ(t) ≐ det(I − B̄(β)) · (1 − t)/(1 − tⁿ),
 * normalised to be symmetric under t ↦ t⁻¹ when possible, with Δ(1) > 0.
 */
export function alexander(word, n) {
  if (n === 1) return L.mono(1);
  const B = burau(word, n), m = n - 1;
  const IB = B.map((row, r) => row.map((e, c) => L.sub(r === c ? L.mono(1) : L.zero(), e)));
  const D = det(IB);
  const num = L.mul(D, { lo: 0, c: [1n, -1n] });
  const den = norm({ lo: 0, c: [1n, ...new Array(n - 1).fill(0n), -1n] });
  let P = L.div(num, den);
  if (!P.c.length) return P;
  // centre: shift so exponents run −d … d (or 0 … 2d+1 if the span is odd)
  const span = P.c.length - 1;
  P = { lo: span % 2 === 0 ? -span / 2 : 0, c: P.c };
  const v1 = L.evalAt1(P);
  if (v1 < 0n || (v1 === 0n && P.c[P.c.length - 1] < 0n)) P = L.neg(P);
  return P;
}

// Conway-normalised Alexander polynomials, coefficients from t^(−d) to t^d.
const KNOTS = [
  ['0₁ (unknot)', [1]],
  ['3₁ (trefoil)', [1, -1, 1]],
  ['4₁ (figure-eight)', [-1, 3, -1]],
  ['5₁ (cinquefoil)', [1, -1, 1, -1, 1]],
  ['5₂ (three-twist)', [2, -3, 2]],
  ['6₁ (stevedore)', [-2, 5, -2]],
  ['6₂', [-1, 3, -3, 3, -1]],
  ['6₃', [1, -3, 5, -3, 1]],
  ['7₁', [1, -1, 1, -1, 1, -1, 1]],
  ['3₁ # 3₁ (granny / square)', [1, -2, 3, -2, 1]],
  ['8₁₉ = T(3,4)', [1, -1, 0, 1, 0, -1, 1]],
  ['T(2,9)', [1, -1, 1, -1, 1, -1, 1, -1, 1]],
  ['10₁₂₄ = T(3,5)', [1, -1, 0, 1, -1, 1, 0, -1, 1]],
];

export function knotName(P) {
  if (!P.c.length) return null;
  const key = P.c.map(String).join(',');
  for (const [name, coeffs] of KNOTS) if (coeffs.join(',') === key) return name;
  return null;
}

// ------------------------------------------------- reading a braid back
//
// Strands are polylines listed top to bottom. Each one is extended straight
// down its rail to `yBottom`, then swept by height: at each level the strands
// are ordered by x, and every adjacent transposition between two levels is a
// crossing whose sign comes from which strand is nearer the viewer (+z).

export function readBraid(strands, yTop, yBottom, levels = 900) {
  const n = strands.length;
  let upward = 0;
  const curves = strands.map((pts) => {
    // monotone in y: drop points that climb above the running minimum
    const out = [];
    let ymin = Infinity;
    for (const q of pts) {
      if (q[1] < ymin) { out.push(q); ymin = q[1]; }
      else upward = Math.max(upward, q[1] - ymin);
    }
    const last = out[out.length - 1];
    if (last[1] > yBottom) out.push([last[0], yBottom, last[2]]);
    if (out[0][1] < yTop) out.unshift([out[0][0], yTop, out[0][2]]);
    return out;
  });
  const cursor = new Array(n).fill(0);
  const X = new Float64Array(n), Zs = new Float64Array(n);
  const sample = (s, y) => {
    const c = curves[s];
    let k = cursor[s];
    while (k < c.length - 2 && c[k + 1][1] > y) k++;
    cursor[s] = k;
    const a = c[k], b = c[k + 1], h = a[1] - b[1];
    const u = h > 1e-12 ? Math.min(1, Math.max(0, (a[1] - y) / h)) : 0;
    X[s] = a[0] + u * (b[0] - a[0]);
    Zs[s] = a[2] + u * (b[2] - a[2]);
  };
  for (let s = 0; s < n; s++) sample(s, yTop);
  const order = Array.from({ length: n }, (_, k) => k).sort((a, b) => X[a] - X[b]);
  const word = [];
  let prevZ = Float64Array.from(Zs);
  for (let l = 1; l <= levels; l++) {
    const y = yTop + ((yBottom - yTop) * l) / levels;
    for (let s = 0; s < n; s++) sample(s, y);
    // bubble the order into the new x-order, one adjacent swap at a time
    for (let pass = 0; pass < n; pass++) {
      let swapped = false;
      for (let k = 0; k < n - 1; k++) {
        const a = order[k], b = order[k + 1];
        if (X[a] > X[b]) {
          const za = 0.5 * (Zs[a] + prevZ[a]), zb = 0.5 * (Zs[b] + prevZ[b]);
          word.push(za > zb ? k + 1 : -(k + 1));
          order[k] = b; order[k + 1] = a;
          swapped = true;
        }
      }
      if (!swapped) break;
    }
    prevZ = Float64Array.from(Zs);
  }
  return { word, upward };
}
