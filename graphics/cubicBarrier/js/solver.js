// solver.js — a CPU port of the core loop of ZOZO's contact solver
// (github.com/st-tech/ppf-contact-solver; R. Ando, "A Cubic Barrier with
// Elasticity-Inclusive Dynamic Stiffness", ACM TOG 43(6), 2024), specialised
// to rods: strands of vertices joined by stretch and bending energies, with
// rod–rod, bead–rod and rod–collider contact.
//
// One call to step() is one substep of the solver's `advance()`:
//
//   1. inertia target  x̃ = x + Δt·v + Δt²·g.
//   2. Newton iteration on
//          ½‖x − x̃‖²_M / Δt² + E_stretch + E_bend + Σ κ ψ(g) + friction,
//      with ψ the cubic barrier and κ = m/g² + nᵀHn re-evaluated at every
//      iteration (the elasticity-inclusive dynamic stiffness), and strain
//      limiting as the same cubic barrier on the edge strain.
//   3. The Newton direction is filtered by CCD over an extended step
//      (line-search-max-t = 1.25) and by the strain-limit time of impact.
//      The accepted fraction is toi.
//   4. toi_advanced += (1 − toi_advanced)·toi. Once it passes target-toi
//      (0.25), Δt shrinks to Δt·toi_advanced and one final "error reduction"
//      iteration runs against the shrunk target.
//
// There is no energy line search. The only things that can shorten a step are
// a collision or a strain limit, so every accepted configuration is
// intersection-free by construction.

import { BARRIERS } from './barrier.js';
import { CP, segSegDist2, pointSegDist2 } from './distance.js';

export const DEFAULTS = {
  dt: 1 / 240,
  gravity: -9.8,
  barrier: 'cubic',
  ccd: true,
  dynamicStiffness: true,
  fixedStiffness: 60,
  ghat: 0.006,
  friction: 0.3,
  frictionEps: 2e-5,
  targetToi: 0.25,
  lineSearchMaxT: 1.25,
  maxDx: 0.2,
  ccdSafety: 0.1,
  cgTol: 1e-3,
  cgMaxIter: 400,
  maxNewton: 32,
  drag: 0,
};

export const STRAND_DEFAULTS = {
  radius: 0.018,
  density: 0.03,     // kg/m
  stretch: 400,      // EA (N)
  bend: 2e-4,        // EI (N·m²)
  strainLimit: 0.03, // 3 % stretch
};

const BAND = 8; // scalar half-bandwidth of a strand's matrix (vertex ±2, 3 dofs)
const BW = BAND + 1;

export class Sim {
  constructor(params = {}) {
    this.p = { ...DEFAULTS, ...params };
    this.t = 0;
    this._pts = [];
    this._extraMass = [];
    this._pins = new Map();
    this._balls = [];
    this.strands = [];
    this.colliders = [];
    this.grab = null;
    this.onPins = null;
    this.lastToiAdv = 1;
    this.lastMaxStrain = 0;
    this.stats = emptyStats();
  }

  // ---------------------------------------------------------------- building

  addStrand(points, opts = {}) {
    const s = { ...STRAND_DEFAULTS, ...opts, start: this._pts.length, count: points.length, index: this.strands.length };
    for (const q of points) {
      this._pts.push([q[0], q[1], q[2]]);
      this._extraMass.push(0);
    }
    this.strands.push(s);
    return s;
  }

  addMass(v, m) { this._extraMass[v] += m; }

  pin(v, mask = 7) { this._pins.set(v, (this._pins.get(v) || 0) | mask); }

  addBall(v, r) { this._balls.push({ v, r }); }

  addCollider(c) { this.colliders.push(c); }

  finalize() {
    const P = this._pts, nv = P.length, p = this.p;
    this.nv = nv;
    const x = (this.x = new Float64Array(3 * nv));
    P.forEach((q, i) => { x[3 * i] = q[0]; x[3 * i + 1] = q[1]; x[3 * i + 2] = q[2]; });
    this.v = new Float64Array(3 * nv);
    this.x0 = new Float64Array(x);
    this.xt = new Float64Array(3 * nv);
    this.mass = new Float64Array(nv);
    this.fix = new Uint8Array(3 * nv);
    this.pinGoal = new Float64Array(x);
    this.vChain = new Int32Array(nv);
    this.vStrand = new Int32Array(nv);
    this.vRad = new Float64Array(nv);

    let ne = 0, nb = 0;
    for (const s of this.strands) { ne += s.count - 1; nb += Math.max(0, s.count - 2); }
    this.ne = ne; this.nbend = nb;
    this.eA = new Int32Array(ne); this.eB = new Int32Array(ne);
    this.rest = new Float64Array(ne); this.eRad = new Float64Array(ne);
    this.eStrand = new Int32Array(ne); this.eIdx = new Int32Array(ne);
    this.eKs = new Float64Array(ne); this.eLim = new Float64Array(ne); this.eMass = new Float64Array(ne);
    this.bA = new Int32Array(nb); this.bB = new Int32Array(nb); this.bC = new Int32Array(nb);
    this.bK = new Float64Array(nb);
    this.chainStart = new Int32Array(this.strands.length);
    this.chainEnd = new Int32Array(this.strands.length);

    let e = 0, b = 0;
    for (const s of this.strands) {
      const c = s.index;
      this.chainStart[c] = s.start;
      this.chainEnd[c] = s.start + s.count;
      let total = 0;
      for (let k = 0; k < s.count; k++) {
        const i = s.start + k;
        this.vChain[i] = c; this.vStrand[i] = c; this.vRad[i] = s.radius;
      }
      s.firstEdge = e;
      for (let k = 0; k < s.count - 1; k++, e++) {
        const i = s.start + k, j = i + 1;
        const l0 = Math.hypot(x[3 * j] - x[3 * i], x[3 * j + 1] - x[3 * i + 1], x[3 * j + 2] - x[3 * i + 2]);
        this.eA[e] = i; this.eB[e] = j; this.rest[e] = l0;
        this.eRad[e] = s.radius; this.eStrand[e] = c; this.eIdx[e] = k;
        this.eKs[e] = s.stretch; this.eLim[e] = s.strainLimit;
        this.eMass[e] = s.density * l0;
        this.mass[i] += 0.5 * s.density * l0;
        this.mass[j] += 0.5 * s.density * l0;
        total += l0;
      }
      s.restLength = total;
      s.segLength = total / Math.max(1, s.count - 1);
      for (let k = 1; k < s.count - 1; k++, b++) {
        const i = s.start + k;
        const l0 = 0.5 * (this.rest[s.firstEdge + k - 1] + this.rest[s.firstEdge + k]);
        this.bA[b] = i - 1; this.bB[b] = i; this.bC[b] = i + 1;
        this.bK[b] = s.bend / (l0 * l0 * l0);
      }
      // Segments of one strand closer than this many indices are never tested
      // against each other: at rest they already sit inside each other's
      // contact offset (the capsules overlap along the strand).
      s.skip = Math.max(2, Math.ceil((1.3 * (2 * s.radius + p.ghat)) / s.segLength) + 1);
    }
    for (let i = 0; i < nv; i++) this.mass[i] += this._extraMass[i];
    for (const [v, mask] of this._pins) {
      for (let d = 0; d < 3; d++) if (mask & (1 << d)) this.fix[3 * v + d] = 1;
    }
    this.nBall = this._balls.length;
    this.ballV = Int32Array.from(this._balls, (q) => q.v);
    this.ballR = Float64Array.from(this._balls, (q) => q.r);

    // Fixed-pattern block CSR (ppf's "fixed CSR"): vertex i couples to i±1
    // (stretch) and i±2 (bending) inside its strand. Contact goes elsewhere.
    this.rowLo = new Int32Array(nv);
    this.rowStart = new Int32Array(nv + 1);
    let nnz = 0;
    for (let i = 0; i < nv; i++) {
      const c = this.vChain[i];
      const lo = Math.max(this.chainStart[c], i - 2), hi = Math.min(this.chainEnd[c] - 1, i + 2);
      this.rowLo[i] = lo; this.rowStart[i] = nnz; nnz += hi - lo + 1;
    }
    this.rowStart[nv] = nnz;
    this.fb = new Float64Array(9 * nnz);
    this.dynDiag = new Float64Array(9 * nv);
    this.grad = new Float64Array(3 * nv);
    this.dx = new Float64Array(3 * nv);
    this.dxp = new Float64Array(3 * nv);
    this.rhs = new Float64Array(3 * nv);
    this.cgR = new Float64Array(3 * nv);
    this.cgZ = new Float64Array(3 * nv);
    this.cgP = new Float64Array(3 * nv);
    this.cgQ = new Float64Array(3 * nv);
    this.sol = new Float64Array(3 * nv);
    this.band = this.strands.map((s) => new Float64Array(3 * s.count * BW));

    this.cooCap = 0;
    this._growCoo(4096);
    this.nCoo = 0;

    this.nPrim = ne + this.nBall;
    this.boxMin = new Float64Array(3 * this.nPrim);
    this.boxMax = new Float64Array(3 * this.nPrim);
    this.order = new Int32Array(this.nPrim).map((_, i) => i);
    this.pairs = new Int32Array(8192);
    this.nPairs = 0;

    this.strainTmp = new Float64Array(6 * ne);
    this.strainTmpE = new Int32Array(ne);

    this.vizCap = 0;
    this._growViz(1024);
    this.nViz = 0;
    this.vContact = new Float32Array(nv);
    this.gapSamples = new Float32Array(4096);
    this.nGapSamples = 0;
    return this;
  }

  _growCoo(cap) {
    const I = new Int32Array(cap), J = new Int32Array(cap), A = new Float64Array(5 * cap);
    if (this.cooCap) { I.set(this.cooI); J.set(this.cooJ); A.set(this.cooA); }
    this.cooI = I; this.cooJ = J; this.cooA = A; this.cooCap = cap;
  }

  _growViz(cap) {
    const V = new Float32Array(8 * cap);
    if (this.vizCap) V.set(this.viz);
    this.viz = V; this.vizCap = cap;
  }

  // ------------------------------------------------------------ public api

  get barrier() { return BARRIERS[this.p.barrier] || BARRIERS.cubic; }

  /** Current extension (L/l₀ − 1) of edge e. */
  strainOf(e) {
    const x = this.x, a = 3 * this.eA[e], b = 3 * this.eB[e];
    return Math.hypot(x[b] - x[a], x[b + 1] - x[a + 1], x[b + 2] - x[a + 2]) / this.rest[e] - 1;
  }

  /** Advance one substep. Returns (and keeps in this.stats) the solver telemetry. */
  step() {
    const p = this.p, nv = this.nv, x = this.x, x0 = this.x0, v = this.v, fix = this.fix;
    const dtFull = p.dt;
    const st = (this.stats = emptyStats());
    x0.set(x);
    if (this.onPins) this.onPins(this.t + dtFull, this);
    this._target(dtFull);
    let dt = dtFull, toiAdv = 0, final = false, iter = 0;
    const t0 = performance.now();
    for (;;) {
      // Pinned dofs head for their goal on ordinary iterations; the final
      // iteration keeps them where the accumulated toi has left them.
      const dxp = this.dxp;
      for (let d = 0; d < 3 * nv; d++) dxp[d] = fix[d] && !final ? this.pinGoal[d] - x[d] : 0;
      this._assemble(dt, iter === 0 && !final);
      const cg = this._solve();
      st.cgIters += cg;
      const dx = this.dx;
      let maxd = 0;
      for (let i = 0; i < nv; i++) {
        const m = dx[3 * i] * dx[3 * i] + dx[3 * i + 1] * dx[3 * i + 1] + dx[3 * i + 2] * dx[3 * i + 2];
        if (m > maxd) maxd = m;
      }
      maxd = Math.sqrt(maxd);
      const rescale = maxd > p.maxDx ? p.maxDx / maxd : 1;
      if (rescale < 1) for (let d = 0; d < 3 * nv; d++) dx[d] *= rescale;
      const toi = this._lineSearch();
      st.tois.push(toi);
      st.newton++;
      if (!(toi > 1e-9)) { st.stalled = true; break; }
      for (let d = 0; d < 3 * nv; d++) x[d] += toi * dx[d];
      if (final) break;
      toiAdv += Math.max(0, 1 - toiAdv) * rescale * toi;
      iter++;
      if (toiAdv >= p.targetToi || iter >= p.maxNewton) {
        final = true;
        dt = dtFull * toiAdv;
        if (dt < 1e-9) { st.stalled = true; break; }
        this._target(dt);
      }
    }
    st.toiAdvanced = toiAdv;
    this.lastToiAdv = toiAdv; // the fraction of their path the pins actually covered
    st.dt = final ? dt : 0;
    if (st.dt > 0) {
      const inv = 1 / st.dt;
      for (let d = 0; d < 3 * nv; d++) v[d] = (x[d] - x0[d]) * inv;
      this.t += st.dt;
    } else {
      v.fill(0);
    }
    st.ms = performance.now() - t0;
    this.lastMaxStrain = st.maxStrain;
    return st;
  }

  // -------------------------------------------------------------- energies

  _target(dt) {
    const { x0, v, xt, nv } = this, g = this.p.gravity;
    for (let i = 0; i < nv; i++) {
      xt[3 * i] = x0[3 * i] + dt * v[3 * i];
      xt[3 * i + 1] = x0[3 * i + 1] + dt * v[3 * i + 1] + dt * dt * g;
      xt[3 * i + 2] = x0[3 * i + 2] + dt * v[3 * i + 2];
    }
  }

  _fpos(i, j) {
    if (this.vChain[i] !== this.vChain[j]) return -1;
    const d = j - i;
    if (d > 2 || d < -2) return -1;
    return this.rowStart[i] + (j - this.rowLo[i]);
  }

  // block(i,j) += a·I + b·n nᵀ
  _addIso(i, j, a, b, nx, ny, nz) {
    const k = 9 * this._fpos(i, j), B = this.fb;
    const bx = b * nx, by = b * ny, bz = b * nz;
    B[k] += a + bx * nx; B[k + 1] += bx * ny; B[k + 2] += bx * nz;
    B[k + 3] += by * nx; B[k + 4] += a + by * ny; B[k + 5] += by * nz;
    B[k + 6] += bz * nx; B[k + 7] += bz * ny; B[k + 8] += a + bz * nz;
  }

  // nᵀ·block(i,j)·n for the fixed (inertia + elastic) matrix, 0 if absent
  _quad(i, j, nx, ny, nz) {
    const q = this._fpos(i, j);
    if (q < 0) return 0;
    const k = 9 * q, B = this.fb;
    return nx * (B[k] * nx + B[k + 1] * ny + B[k + 2] * nz)
      + ny * (B[k + 3] * nx + B[k + 4] * ny + B[k + 5] * nz)
      + nz * (B[k + 6] * nx + B[k + 7] * ny + B[k + 8] * nz);
  }

  // With `check`, the configuration being assembled is the one the previous
  // step accepted: record its smallest gap, its active contacts, its largest
  // strain, and how many pairs intersect (always 0 with the CCD filter on).
  _assemble(dt, check = false) {
    const p = this.p, nv = this.nv, x = this.x, xt = this.xt, x0 = this.x0, m = this.mass;
    const G = this.grad, B = this.barrier, st = this.stats;
    G.fill(0); this.fb.fill(0); this.dynDiag.fill(0);
    this.nCoo = 0; this.nViz = 0; this.nGapSamples = 0;
    this.vContact.fill(0);
    let maxStrain = 0, minGap = Infinity, bad = 0, near = 0;
    const idt2 = 1 / (dt * dt);

    // inertia (+ optional isotropic drag)
    const drag = p.drag > 0 ? p.drag / dt : 0;
    for (let i = 0; i < nv; i++) {
      const k = m[i] * idt2, kd = m[i] * drag;
      for (let d = 0; d < 3; d++) {
        const a = 3 * i + d;
        G[a] += k * (x[a] - xt[a]) + kd * (x[a] - x0[a]);
      }
      this._addIso(i, i, k + kd, 0, 0, 0, 0);
    }

    // stretch: E = (EA/2l₀)(L − l₀)², Hessian projected to PSD
    for (let e = 0; e < this.ne; e++) {
      const a = this.eA[e], b = this.eB[e];
      const ex = x[3 * b] - x[3 * a], ey = x[3 * b + 1] - x[3 * a + 1], ez = x[3 * b + 2] - x[3 * a + 2];
      const L = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1e-12;
      const nx = ex / L, ny = ey / L, nz = ez / L, l0 = this.rest[e];
      const coef = this.eKs[e] / l0, f = coef * (L - l0);
      G[3 * b] += f * nx; G[3 * b + 1] += f * ny; G[3 * b + 2] += f * nz;
      G[3 * a] -= f * nx; G[3 * a + 1] -= f * ny; G[3 * a + 2] -= f * nz;
      const al = coef * Math.max(0, 1 - l0 / L), be = coef - al;
      this._addIso(a, a, al, be, nx, ny, nz);
      this._addIso(b, b, al, be, nx, ny, nz);
      this._addIso(a, b, -al, -be, nx, ny, nz);
      this._addIso(b, a, -al, -be, nx, ny, nz);
    }

    // bending: E = (EI/2l₀³)|x₋ − 2x + x₊|², constant Hessian
    for (let q = 0; q < this.nbend; q++) {
      const a = this.bA[q], b = this.bB[q], c = this.bC[q], k = this.bK[q];
      for (let d = 0; d < 3; d++) {
        const dd = k * (x[3 * a + d] - 2 * x[3 * b + d] + x[3 * c + d]);
        G[3 * a + d] += dd; G[3 * b + d] -= 2 * dd; G[3 * c + d] += dd;
      }
      this._addIso(a, a, k, 0, 0, 0, 0); this._addIso(c, c, k, 0, 0, 0, 0);
      this._addIso(b, b, 4 * k, 0, 0, 0, 0);
      this._addIso(a, b, -2 * k, 0, 0, 0, 0); this._addIso(b, a, -2 * k, 0, 0, 0, 0);
      this._addIso(b, c, -2 * k, 0, 0, 0, 0); this._addIso(c, b, -2 * k, 0, 0, 0, 0);
      this._addIso(a, c, k, 0, 0, 0, 0); this._addIso(c, a, k, 0, 0, 0, 0);
    }

    // strain limiting: the cubic barrier on the edge strain, gap = τ − ε,
    // with ĝ = τ and κ = shapeᵀH shape + m/gap² (rod_strain_stiffness).
    // Every κ reads the matrix before any strain term is added.
    let nst = 0;
    const ST = this.strainTmp, STE = this.strainTmpE;
    for (let e = 0; e < this.ne; e++) {
      const a = this.eA[e], b = this.eB[e];
      const ex = x[3 * b] - x[3 * a], ey = x[3 * b + 1] - x[3 * a + 1], ez = x[3 * b + 2] - x[3 * a + 2];
      const L = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1e-12, l0 = this.rest[e];
      const strain = L / l0 - 1;
      if (strain > maxStrain) maxStrain = strain;
      const lim = this.eLim[e];
      if (!(lim > 0) || strain <= 0) continue;
      const nx = ex / L, ny = ey / L, nz = ez / L;
      const gap = Math.max(lim - strain, 1e-6 * lim);
      const shape = 0.25 * L * L * (this._quad(a, a, nx, ny, nz) - this._quad(a, b, nx, ny, nz)
        - this._quad(b, a, nx, ny, nz) + this._quad(b, b, nx, ny, nz));
      const kap = shape + this.eMass[e] / (gap * gap);
      const gr = -B.gradient(gap, lim), cu = Math.max(0, B.curvature(gap, lim));
      if (!isFinite(gr) || !isFinite(cu)) continue;
      const f = (kap * gr) / l0;
      G[3 * b] += f * nx; G[3 * b + 1] += f * ny; G[3 * b + 2] += f * nz;
      G[3 * a] -= f * nx; G[3 * a + 1] -= f * ny; G[3 * a + 2] -= f * nz;
      const al = (kap * Math.max(0, gr)) / (L * l0);
      STE[nst] = e;
      ST[6 * nst] = al; ST[6 * nst + 1] = (kap * cu) / (l0 * l0) - al;
      ST[6 * nst + 2] = nx; ST[6 * nst + 3] = ny; ST[6 * nst + 4] = nz;
      nst++;
    }
    for (let k = 0; k < nst; k++) {
      const e = STE[k], a = this.eA[e], b = this.eB[e];
      const al = ST[6 * k], be = ST[6 * k + 1], nx = ST[6 * k + 2], ny = ST[6 * k + 3], nz = ST[6 * k + 4];
      this._addIso(a, a, al, be, nx, ny, nz); this._addIso(b, b, al, be, nx, ny, nz);
      this._addIso(a, b, -al, -be, nx, ny, nz); this._addIso(b, a, -al, -be, nx, ny, nz);
    }

    // user grab: a soft spring on one vertex
    if (this.grab) {
      const g = this.grab, i = g.v, k = g.k * m[i] * idt2;
      for (let d = 0; d < 3; d++) G[3 * i + d] += k * (x[3 * i + d] - g.target[d]);
      this._addIso(i, i, k, 0, 0, 0, 0);
    }

    // contact
    this._broadPhase(null, 0, 0.5 * p.ghat);
    const pairs = this.pairs, ne = this.ne;
    const vs = STENCIL_V, ws = STENCIL_W;
    for (let k = 0; k < this.nPairs; k++) {
      const pa = pairs[2 * k], pb = pairs[2 * k + 1];
      if (pa < ne && pb < ne) {
        const a = this.eA[pa], b = this.eB[pa], c = this.eA[pb], d = this.eB[pb];
        const d2 = segSegDist2(
          x[3 * a], x[3 * a + 1], x[3 * a + 2], x[3 * b], x[3 * b + 1], x[3 * b + 2],
          x[3 * c], x[3 * c + 1], x[3 * c + 2], x[3 * d], x[3 * d + 1], x[3 * d + 2]);
        const off = this.eRad[pa] + this.eRad[pb];
        const D = Math.sqrt(d2);
        if (check) { const g = D - off; if (g < minGap) minGap = g; if (g <= 0) bad++; if (g < p.ghat) near++; }
        if (D - off >= p.ghat || D < 1e-12) continue;
        const s = CP.s, t = CP.t;
        vs[0] = a; vs[1] = b; vs[2] = c; vs[3] = d;
        ws[0] = 1 - s; ws[1] = s; ws[2] = -(1 - t); ws[3] = -t;
        this._contact(4, D - off, D, dt);
      } else {
        const ball = (pa < ne ? pb : pa) - ne, seg = pa < ne ? pa : pb;
        const i = this.ballV[ball], c = this.eA[seg], d = this.eB[seg];
        const d2 = pointSegDist2(x[3 * i], x[3 * i + 1], x[3 * i + 2],
          x[3 * c], x[3 * c + 1], x[3 * c + 2], x[3 * d], x[3 * d + 1], x[3 * d + 2]);
        const off = this.ballR[ball] + this.eRad[seg];
        const D = Math.sqrt(d2);
        if (check) { const g = D - off; if (g < minGap) minGap = g; if (g <= 0) bad++; if (g < p.ghat) near++; }
        if (D - off >= p.ghat || D < 1e-12) continue;
        const t = CP.t;
        vs[0] = i; vs[1] = c; vs[2] = d;
        ws[0] = 1; ws[1] = -(1 - t); ws[2] = -t;
        this._contact(3, D - off, D, dt);
      }
    }
    // colliders (analytic walls, spheres, bowls)
    if (this.colliders.length) {
      for (let i = 0; i < nv; i++) {
        if (this.fix[3 * i] && this.fix[3 * i + 1] && this.fix[3 * i + 2]) continue;
        for (const c of this.colliders) {
          const g = colliderGap(c, x, i, this.vRad[i], NRM);
          if (check) { if (g < minGap) minGap = g; if (g <= 0) bad++; if (g < p.ghat) near++; }
          if (g >= p.ghat) continue;
          vs[0] = i; ws[0] = 1;
          this._contactN(1, g, NRM[0], NRM[1], NRM[2], dt, c);
        }
      }
    }
    if (check) {
      st.minGap = minGap; st.intersecting = bad; st.contacts = near; st.maxStrain = maxStrain;
    }
  }

  // Separation vector e = Σ wᵢxᵢ, gap g = |e| − offset
  _contact(k, g, D, dt) {
    const x = this.x, vs = STENCIL_V, ws = STENCIL_W;
    let ex = 0, ey = 0, ez = 0;
    for (let a = 0; a < k; a++) {
      const i = vs[a];
      ex += ws[a] * x[3 * i]; ey += ws[a] * x[3 * i + 1]; ez += ws[a] * x[3 * i + 2];
    }
    this._contactN(k, g, ex / D, ey / D, ez / D, dt, null);
  }

  _contactN(k, g, nx, ny, nz, dt, collider) {
    const p = this.p, B = this.barrier, x = this.x, x0 = this.x0, G = this.grad;
    const vs = STENCIL_V, ws = STENCIL_W, m = this.mass;
    const gh = p.ghat;
    const gs = p.ccd ? g : Math.max(g, 1e-3 * gh);
    // elasticity-inclusive dynamic stiffness (contact_stiffness.kernel.cpp):
    // κ = Σ mᵢwᵢ²/(W²g²) + dᵀHd,   d = (wᵢn)/W,   H = inertia + elastic
    let kappa;
    if (p.dynamicStiffness) {
      let W2 = 0, inert = 0, q = 0;
      for (let a = 0; a < k; a++) { W2 += ws[a] * ws[a]; inert += m[vs[a]] * ws[a] * ws[a]; }
      for (let a = 0; a < k; a++) {
        for (let b = 0; b < k; b++) {
          q += ws[a] * ws[b] * this._quad(vs[a], vs[b], nx, ny, nz);
        }
      }
      const gg = Math.max(gs, 1e-4 * gh);
      kappa = (q + inert / (gg * gg)) / W2;
    } else {
      let mm = 0;
      for (let a = 0; a < k; a++) mm = Math.max(mm, m[vs[a]]);
      kappa = p.fixedStiffness * mm / (gh * gh);
    }
    let dpsi = B.gradient(gs, gh), ddpsi = B.curvature(gs, gh);
    if (!isFinite(dpsi)) dpsi = B.gradient(1e-3 * gh, gh);
    if (!isFinite(ddpsi)) ddpsi = B.curvature(1e-3 * gh, gh);
    const fg = kappa * dpsi;
    for (let a = 0; a < k; a++) {
      const i = vs[a], w = ws[a] * fg;
      G[3 * i] += w * nx; G[3 * i + 1] += w * ny; G[3 * i + 2] += w * nz;
    }
    const fn = -fg;
    // lagged quadratic friction (friction.kernel.cpp): λ = μ f_n / max(ε, |u_t|)
    let lam = 0;
    if (p.friction > 0 && fn > 0) {
      let ux = 0, uy = 0, uz = 0;
      for (let a = 0; a < k; a++) {
        const i = vs[a], w = ws[a];
        ux += w * (x[3 * i] - x0[3 * i]); uy += w * (x[3 * i + 1] - x0[3 * i + 1]); uz += w * (x[3 * i + 2] - x0[3 * i + 2]);
      }
      const un = ux * nx + uy * ny + uz * nz;
      ux -= un * nx; uy -= un * ny; uz -= un * nz;
      const ut = Math.sqrt(ux * ux + uy * uy + uz * uz);
      const mu = collider && collider.friction !== undefined ? collider.friction : p.friction;
      lam = (mu * fn) / Math.max(p.frictionEps, ut);
      for (let a = 0; a < k; a++) {
        const i = vs[a], w = ws[a] * lam;
        G[3 * i] += w * ux; G[3 * i + 1] += w * uy; G[3 * i + 2] += w * uz;
      }
    }
    // Hessian: wᵢwⱼ[κψ″ n nᵀ + λ(I − n nᵀ)] = wᵢwⱼ[λ I + (κψ″ − λ) n nᵀ]
    const kn = kappa * Math.max(0, ddpsi);
    const DD = this.dynDiag;
    for (let a = 0; a < k; a++) {
      const i = vs[a], waa = ws[a] * ws[a];
      const al = lam * waa, be = (kn - lam) * waa, o = 9 * i;
      DD[o] += al + be * nx * nx; DD[o + 1] += be * nx * ny; DD[o + 2] += be * nx * nz;
      DD[o + 3] += be * ny * nx; DD[o + 4] += al + be * ny * ny; DD[o + 5] += be * ny * nz;
      DD[o + 6] += be * nz * nx; DD[o + 7] += be * nz * ny; DD[o + 8] += al + be * nz * nz;
      for (let b = a + 1; b < k; b++) {
        if (this.nCoo >= this.cooCap) this._growCoo(this.cooCap * 2);
        const c = this.nCoo++, wab = ws[a] * ws[b];
        this.cooI[c] = i; this.cooJ[c] = vs[b];
        const A = this.cooA;
        A[5 * c] = lam * wab; A[5 * c + 1] = (kn - lam) * wab;
        A[5 * c + 2] = nx; A[5 * c + 3] = ny; A[5 * c + 4] = nz;
      }
    }
    // telemetry for the view: the two closest points, the gap and κ
    if (this.nViz >= this.vizCap) this._growViz(this.vizCap * 2);
    const V = this.viz, o = 8 * this.nViz++;
    let px = 0, py = 0, pz = 0, qx = 0, qy = 0, qz = 0;
    for (let a = 0; a < k; a++) {
      const i = vs[a], w = ws[a];
      if (w >= 0) { px += w * x[3 * i]; py += w * x[3 * i + 1]; pz += w * x[3 * i + 2]; }
      else { qx -= w * x[3 * i]; qy -= w * x[3 * i + 1]; qz -= w * x[3 * i + 2]; }
    }
    if (k === 1) { qx = px - nx * (g + this.vRad[vs[0]]); qy = py - ny * (g + this.vRad[vs[0]]); qz = pz - nz * (g + this.vRad[vs[0]]); }
    V[o] = px; V[o + 1] = py; V[o + 2] = pz; V[o + 3] = qx; V[o + 4] = qy; V[o + 5] = qz;
    V[o + 6] = g / gh; V[o + 7] = kappa;
    if (this.nGapSamples < this.gapSamples.length) this.gapSamples[this.nGapSamples++] = g / gh;
    const heat = Math.min(1, Math.max(0, 1 - g / gh));
    for (let a = 0; a < k; a++) {
      const i = vs[a], h = heat * Math.min(1, 2 * Math.abs(ws[a]));
      if (h > this.vContact[i]) this.vContact[i] = h;
    }
  }

  // ------------------------------------------------------------ linear solve

  // q = H p on free dofs (fixed CSR + contact diagonal + contact COO)
  _matvec(P, Q) {
    const nv = this.nv, fb = this.fb, rs = this.rowStart, lo = this.rowLo, DD = this.dynDiag;
    for (let i = 0; i < nv; i++) {
      let s0 = 0, s1 = 0, s2 = 0;
      let j = lo[i];
      for (let k = rs[i]; k < rs[i + 1]; k++, j++) {
        const o = 9 * k, p0 = P[3 * j], p1 = P[3 * j + 1], p2 = P[3 * j + 2];
        s0 += fb[o] * p0 + fb[o + 1] * p1 + fb[o + 2] * p2;
        s1 += fb[o + 3] * p0 + fb[o + 4] * p1 + fb[o + 5] * p2;
        s2 += fb[o + 6] * p0 + fb[o + 7] * p1 + fb[o + 8] * p2;
      }
      const o = 9 * i, p0 = P[3 * i], p1 = P[3 * i + 1], p2 = P[3 * i + 2];
      Q[3 * i] = s0 + DD[o] * p0 + DD[o + 1] * p1 + DD[o + 2] * p2;
      Q[3 * i + 1] = s1 + DD[o + 3] * p0 + DD[o + 4] * p1 + DD[o + 5] * p2;
      Q[3 * i + 2] = s2 + DD[o + 6] * p0 + DD[o + 7] * p1 + DD[o + 8] * p2;
    }
    const I = this.cooI, J = this.cooJ, A = this.cooA;
    for (let c = 0; c < this.nCoo; c++) {
      const i = I[c], j = J[c], al = A[5 * c], be = A[5 * c + 1];
      const nx = A[5 * c + 2], ny = A[5 * c + 3], nz = A[5 * c + 4];
      const pj0 = P[3 * j], pj1 = P[3 * j + 1], pj2 = P[3 * j + 2];
      const pi0 = P[3 * i], pi1 = P[3 * i + 1], pi2 = P[3 * i + 2];
      const dj = be * (nx * pj0 + ny * pj1 + nz * pj2), di = be * (nx * pi0 + ny * pi1 + nz * pi2);
      Q[3 * i] += al * pj0 + dj * nx; Q[3 * i + 1] += al * pj1 + dj * ny; Q[3 * i + 2] += al * pj2 + dj * nz;
      Q[3 * j] += al * pi0 + di * nx; Q[3 * j + 1] += al * pi1 + di * ny; Q[3 * j + 2] += al * pi2 + di * nz;
    }
    const fix = this.fix;
    for (let d = 0; d < 3 * nv; d++) if (fix[d]) Q[d] = 0;
  }

  // Strand-wise banded Cholesky of (fixed + contact diagonal + in-band contact
  // blocks): exact for a strand on its own, so PCG only iterates on coupling.
  _factor() {
    const fb = this.fb, DD = this.dynDiag, fix = this.fix;
    for (const s of this.strands) {
      const Bd = this.band[s.index], N = 3 * s.count, s0 = s.start;
      Bd.fill(0);
      for (let i = s0; i < s0 + s.count; i++) {
        let j = this.rowLo[i];
        for (let k = this.rowStart[i]; k < this.rowStart[i + 1]; k++, j++) {
          if (j > i) break;
          const o = 9 * k;
          for (let a = 0; a < 3; a++) {
            const r = 3 * (i - s0) + a;
            for (let b = 0; b < 3; b++) {
              const c = 3 * (j - s0) + b;
              if (c > r) continue;
              Bd[r * BW + c - r + BAND] += fb[o + 3 * a + b] + (i === j ? DD[9 * i + 3 * a + b] : 0);
            }
          }
        }
      }
    }
    // in-band contact blocks (both ends of one segment), one pass
    const A = this.cooA;
    for (let c = 0; c < this.nCoo; c++) {
      let i = this.cooI[c], j = this.cooJ[c];
      const ch = this.vChain[i];
      if (ch !== this.vChain[j] || i === j || i - j > 2 || j - i > 2) continue;
      if (j > i) { const t = i; i = j; j = t; }
      const Bd = this.band[ch], s0 = this.chainStart[ch];
      const al = A[5 * c], be = A[5 * c + 1], n0 = A[5 * c + 2], n1 = A[5 * c + 3], n2 = A[5 * c + 4];
      for (let a = 0; a < 3; a++) {
        const r = 3 * (i - s0) + a, na = a === 0 ? n0 : a === 1 ? n1 : n2;
        for (let b = 0; b < 3; b++) {
          const cc = 3 * (j - s0) + b, nb = b === 0 ? n0 : b === 1 ? n1 : n2;
          Bd[r * BW + cc - r + BAND] += (a === b ? al : 0) + be * na * nb;
        }
      }
    }
    for (const s of this.strands) {
      const Bd = this.band[s.index], N = 3 * s.count, s0 = s.start;
      for (let r = 0; r < N; r++) {
        if (!fix[3 * s0 + r]) continue;
        for (let c = Math.max(0, r - BAND); c < r; c++) Bd[r * BW + c - r + BAND] = 0;
        for (let rr = r + 1; rr <= Math.min(N - 1, r + BAND); rr++) Bd[rr * BW + r - rr + BAND] = 0;
        Bd[r * BW + BAND] = 1;
      }
      for (let r = 0; r < N; r++) {
        const r0 = Math.max(0, r - BAND);
        for (let c = r0; c <= r; c++) {
          let sum = Bd[r * BW + c - r + BAND];
          for (let k = r0; k < c; k++) {
            if (k < c - BAND) continue;
            sum -= Bd[r * BW + k - r + BAND] * Bd[c * BW + k - c + BAND];
          }
          if (c === r) Bd[r * BW + BAND] = Math.sqrt(Math.max(sum, 1e-30));
          else Bd[r * BW + c - r + BAND] = sum / Bd[c * BW + BAND];
        }
      }
    }
  }

  _precond(R, Z) {
    for (const s of this.strands) {
      const Bd = this.band[s.index], N = 3 * s.count, o = 3 * s.start;
      for (let r = 0; r < N; r++) {
        let sum = R[o + r];
        for (let k = Math.max(0, r - BAND); k < r; k++) sum -= Bd[r * BW + k - r + BAND] * Z[o + k];
        Z[o + r] = sum / Bd[r * BW + BAND];
      }
      for (let r = N - 1; r >= 0; r--) {
        let sum = Z[o + r];
        for (let k = r + 1; k <= Math.min(N - 1, r + BAND); k++) sum -= Bd[k * BW + r - k + BAND] * Z[o + k];
        Z[o + r] = sum / Bd[r * BW + BAND];
      }
    }
    const fix = this.fix;
    for (let d = 0; d < Z.length; d++) if (fix[d]) Z[d] = 0;
  }

  _solve() {
    const n3 = 3 * this.nv, fix = this.fix, p = this.p;
    const R = this.cgR, Z = this.cgZ, P = this.cgP, Q = this.cgQ, X = this.sol, rhs = this.rhs;
    // rhs = −g − H·dx_pinned, restricted to free dofs
    this._matvec(this.dxp, Q);
    for (let d = 0; d < n3; d++) rhs[d] = fix[d] ? 0 : -this.grad[d] - Q[d];
    this._factor();
    X.fill(0);
    R.set(rhs);
    let r0 = 0;
    for (let d = 0; d < n3; d++) r0 += R[d] * R[d];
    r0 = Math.sqrt(r0);
    let it = 0;
    if (r0 > 0) {
      this._precond(R, Z);
      P.set(Z);
      let rz = 0;
      for (let d = 0; d < n3; d++) rz += R[d] * Z[d];
      for (it = 1; it <= p.cgMaxIter; it++) {
        this._matvec(P, Q);
        let pq = 0;
        for (let d = 0; d < n3; d++) pq += P[d] * Q[d];
        if (!(pq > 0)) break;
        const alpha = rz / pq;
        let rr = 0;
        for (let d = 0; d < n3; d++) { X[d] += alpha * P[d]; R[d] -= alpha * Q[d]; rr += R[d] * R[d]; }
        if (Math.sqrt(rr) <= p.cgTol * r0) break;
        this._precond(R, Z);
        let rz2 = 0;
        for (let d = 0; d < n3; d++) rz2 += R[d] * Z[d];
        const beta = rz2 / rz;
        rz = rz2;
        for (let d = 0; d < n3; d++) P[d] = Z[d] + beta * P[d];
      }
    }
    const dx = this.dx, dxp = this.dxp;
    for (let d = 0; d < n3; d++) dx[d] = fix[d] ? dxp[d] : X[d];
    return it;
  }

  // ------------------------------------------------------------- collision

  // Sweep-and-prune over segment and bead boxes; with dx, boxes are swept
  // over x → x + T·dx (the extended line-search step).
  _broadPhase(dx, T, pad) {
    const x = this.x, ne = this.ne, nP = this.nPrim, mn = this.boxMin, mx = this.boxMax;
    for (let k = 0; k < nP; k++) {
      let r, i0, i1;
      if (k < ne) { i0 = this.eA[k]; i1 = this.eB[k]; r = this.eRad[k]; }
      else { i0 = i1 = this.ballV[k - ne]; r = this.ballR[k - ne]; }
      r += pad;
      for (let d = 0; d < 3; d++) {
        let a = x[3 * i0 + d], b = x[3 * i1 + d];
        let lo = a < b ? a : b, hi = a < b ? b : a;
        if (dx) {
          const a2 = a + T * dx[3 * i0 + d], b2 = b + T * dx[3 * i1 + d];
          if (a2 < lo) lo = a2; if (a2 > hi) hi = a2;
          if (b2 < lo) lo = b2; if (b2 > hi) hi = b2;
        }
        mn[3 * k + d] = lo - r; mx[3 * k + d] = hi + r;
      }
    }
    // insertion sort on min-x: nearly sorted from the previous call
    const ord = this.order;
    for (let i = 1; i < nP; i++) {
      const v = ord[i], key = mn[3 * v];
      let j = i - 1;
      while (j >= 0 && mn[3 * ord[j]] > key) { ord[j + 1] = ord[j]; j--; }
      ord[j + 1] = v;
    }
    let np = 0;
    for (let ii = 0; ii < nP; ii++) {
      const a = ord[ii], ax = mx[3 * a];
      for (let jj = ii + 1; jj < nP; jj++) {
        const b = ord[jj];
        if (mn[3 * b] > ax) break;
        if (mn[3 * b + 1] > mx[3 * a + 1] || mn[3 * a + 1] > mx[3 * b + 1]) continue;
        if (mn[3 * b + 2] > mx[3 * a + 2] || mn[3 * a + 2] > mx[3 * b + 2]) continue;
        if (this._excluded(a, b)) continue;
        if (2 * np + 2 > this.pairs.length) {
          const bigger = new Int32Array(this.pairs.length * 2);
          bigger.set(this.pairs); this.pairs = bigger;
        }
        this.pairs[2 * np] = a; this.pairs[2 * np + 1] = b; np++;
      }
    }
    this.nPairs = np;
  }

  _excluded(a, b) {
    const ne = this.ne;
    if (a >= ne && b >= ne) return true;
    if (a < ne && b < ne) {
      const sa = this.eStrand[a];
      if (sa !== this.eStrand[b]) return false;
      return Math.abs(this.eIdx[a] - this.eIdx[b]) <= this.strands[sa].skip;
    }
    const ball = (a >= ne ? a : b) - ne, seg = a >= ne ? b : a;
    return this.vStrand[this.ballV[ball]] === this.eStrand[seg];
  }

  // The filtered step: the largest fraction of dx (≤ 1) that neither closes a
  // contact (ACCD over the extended step T·dx, then divided by T) nor takes
  // an edge past its strain limit.
  _lineSearch() {
    const p = this.p, x = this.x, dx = this.dx, T = p.lineSearchMaxT, s = p.ccdSafety;
    let tmin = T;
    if (p.ccd) {
      this._broadPhase(dx, T, 0);
      const ne = this.ne, pairs = this.pairs;
      for (let k = 0; k < this.nPairs && tmin > 0; k++) {
        const pa = pairs[2 * k], pb = pairs[2 * k + 1];
        let t;
        if (pa < ne && pb < ne) {
          t = accd4(x, dx, this.eA[pa], this.eB[pa], this.eA[pb], this.eB[pb],
            this.eRad[pa] + this.eRad[pb], s, tmin);
        } else {
          const ball = (pa < ne ? pb : pa) - ne, seg = pa < ne ? pa : pb;
          t = accd3(x, dx, this.ballV[ball], this.eA[seg], this.eB[seg],
            this.ballR[ball] + this.eRad[seg], s, tmin);
        }
        if (t < tmin) tmin = t;
      }
      if (this.colliders.length) {
        for (let i = 0; i < this.nv; i++) {
          for (const c of this.colliders) {
            const t = colliderToi(c, x, dx, i, this.vRad[i], s, tmin);
            if (t < tmin) tmin = t;
          }
        }
      }
    }
    let toi = Math.min(1, tmin / T);
    // strain limit: consume at most (1 − s) of the remaining room to τ
    let sl = T;
    for (let e = 0; e < this.ne; e++) {
      const lim = this.eLim[e];
      if (!(lim > 0)) continue;
      const a = 3 * this.eA[e], b = 3 * this.eB[e], l0 = this.rest[e];
      const ex = x[b] - x[a], ey = x[b + 1] - x[a + 1], ez = x[b + 2] - x[a + 2];
      const fx = dx[b] - dx[a], fy = dx[b + 1] - dx[a + 1], fz = dx[b + 2] - dx[a + 2];
      const A = fx * fx + fy * fy + fz * fz;
      if (A < 1e-30) continue;
      const L = Math.sqrt(ex * ex + ey * ey + ez * ez);
      const eps = Math.max(0, L / l0 - 1);
      const Lt = l0 * (1 + eps + (1 - s) * (lim - eps));
      const Bq = ex * fx + ey * fy + ez * fz, C = L * L - Lt * Lt;
      let t;
      if (C < 0) t = (-Bq + Math.sqrt(Bq * Bq - A * C)) / A;
      else t = Bq < 0 ? (-2 * Bq) / A : 0; // at the limit: only a shortening move may proceed, and only until it is back
      if (t < sl) sl = t;
      if (sl <= 0) break;
    }
    const slToi = Math.min(1, sl / T);
    this.stats.strainToi = Math.min(this.stats.strainToi, slToi);
    return Math.min(toi, slToi);
  }
}

function emptyStats() {
  return {
    newton: 0, cgIters: 0, tois: [], toiAdvanced: 0, dt: 0, ms: 0, stalled: false,
    minGap: Infinity, intersecting: 0, contacts: 0, maxStrain: 0, strainToi: 1,
  };
}

const STENCIL_V = new Int32Array(4);
const STENCIL_W = new Float64Array(4);
const NRM = new Float64Array(3);

// --------------------------------------------------------------- colliders

// Gap from vertex i (radius r) to an analytic collider; outward normal in n.
function colliderGap(c, x, i, r, n) {
  const px = x[3 * i], py = x[3 * i + 1], pz = x[3 * i + 2];
  if (c.type === 'plane') {
    n[0] = c.n[0]; n[1] = c.n[1]; n[2] = c.n[2];
    return px * c.n[0] + py * c.n[1] + pz * c.n[2] - c.d - r;
  }
  const dx = px - c.c[0], dy = py - c.c[1], dz = pz - c.c[2];
  const D = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-12;
  if (c.type === 'bowl') { // inside of a sphere
    n[0] = -dx / D; n[1] = -dy / D; n[2] = -dz / D;
    return c.r - D - r;
  }
  n[0] = dx / D; n[1] = dy / D; n[2] = dz / D;
  return D - c.r - r;
}

function colliderToi(c, x, dx, i, r, s, tMax) {
  const g0 = colliderGap(c, x, i, r, NRM);
  if (g0 <= 0) return 0;
  const ux = dx[3 * i], uy = dx[3 * i + 1], uz = dx[3 * i + 2];
  if (c.type === 'plane') {
    const rate = ux * c.n[0] + uy * c.n[1] + uz * c.n[2];
    if (rate >= 0) return tMax;
    return Math.min(tMax, ((1 - s) * g0) / -rate);
  }
  const lp = Math.sqrt(ux * ux + uy * uy + uz * uz);
  if (lp < 1e-300) return tMax;
  // conservative advancement: the gap changes no faster than |dx|
  let t = 0, g = g0;
  for (let it = 0; it < 200; it++) {
    const tl = (g - s * g0) / lp;
    if (tl <= 1e-12 * tMax) break;
    t += tl;
    if (t >= tMax) return tMax;
    TMPX[0] = x[3 * i] + t * ux; TMPX[1] = x[3 * i + 1] + t * uy; TMPX[2] = x[3 * i + 2] + t * uz;
    g = colliderGap(c, TMPX, 0, r, NRM);
    if (g <= s * g0) { t -= tl; break; }
  }
  return Math.max(0, t);
}
const TMPX = new Float64Array(3);

// ------------------------------------------------------------------- ACCD

// Additive CCD (Li, Kaufman & Jiang 2021), as used by ppf for its line
// search: advance in steps that cannot close more than (1 − s) of the current
// gap given the largest relative displacement, stop once the gap would drop
// below s times its starting value.
function accd4(x, dx, a, b, c, d, xi, s, tMax) {
  const mx = 0.25 * (dx[3 * a] + dx[3 * b] + dx[3 * c] + dx[3 * d]);
  const my = 0.25 * (dx[3 * a + 1] + dx[3 * b + 1] + dx[3 * c + 1] + dx[3 * d + 1]);
  const mz = 0.25 * (dx[3 * a + 2] + dx[3 * b + 2] + dx[3 * c + 2] + dx[3 * d + 2]);
  const len = (i) => Math.hypot(dx[3 * i] - mx, dx[3 * i + 1] - my, dx[3 * i + 2] - mz);
  const lp = Math.max(len(a), len(b)) + Math.max(len(c), len(d));
  if (lp <= 1e-300) return tMax;
  const dist = (t) => Math.sqrt(segSegDist2(
    x[3 * a] + t * dx[3 * a], x[3 * a + 1] + t * dx[3 * a + 1], x[3 * a + 2] + t * dx[3 * a + 2],
    x[3 * b] + t * dx[3 * b], x[3 * b + 1] + t * dx[3 * b + 1], x[3 * b + 2] + t * dx[3 * b + 2],
    x[3 * c] + t * dx[3 * c], x[3 * c + 1] + t * dx[3 * c + 1], x[3 * c + 2] + t * dx[3 * c + 2],
    x[3 * d] + t * dx[3 * d], x[3 * d + 1] + t * dx[3 * d + 1], x[3 * d + 2] + t * dx[3 * d + 2]));
  return accdLoop(dist, xi, s, lp, tMax);
}

function accd3(x, dx, i, c, d, xi, s, tMax) {
  const mx = (dx[3 * i] + dx[3 * c] + dx[3 * d]) / 3;
  const my = (dx[3 * i + 1] + dx[3 * c + 1] + dx[3 * d + 1]) / 3;
  const mz = (dx[3 * i + 2] + dx[3 * c + 2] + dx[3 * d + 2]) / 3;
  const len = (k) => Math.hypot(dx[3 * k] - mx, dx[3 * k + 1] - my, dx[3 * k + 2] - mz);
  const lp = len(i) + Math.max(len(c), len(d));
  if (lp <= 1e-300) return tMax;
  const dist = (t) => Math.sqrt(pointSegDist2(
    x[3 * i] + t * dx[3 * i], x[3 * i + 1] + t * dx[3 * i + 1], x[3 * i + 2] + t * dx[3 * i + 2],
    x[3 * c] + t * dx[3 * c], x[3 * c + 1] + t * dx[3 * c + 1], x[3 * c + 2] + t * dx[3 * c + 2],
    x[3 * d] + t * dx[3 * d], x[3 * d + 1] + t * dx[3 * d + 1], x[3 * d + 2] + t * dx[3 * d + 2]));
  return accdLoop(dist, xi, s, lp, tMax);
}

function accdLoop(dist, xi, s, lp, tMax) {
  let d = dist(0);
  if (d <= xi) return 0;
  const g = s * (d - xi);
  let t = 0, tl = ((1 - s) * (d - xi)) / lp;
  for (let it = 0; it < 4096; it++) {
    d = dist(t + tl);
    if (t > 0 && d - xi < g) break;
    if (d - xi <= 0) break;
    t += tl;
    if (t > tMax) return tMax;
    tl = (0.9 * (d - xi)) / lp;
  }
  return t;
}
