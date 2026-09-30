// scenes.js — the four scenes. Each builds a Sim and drives its pins.
//
//   BraidScene   weighted strands on rails; σᵢ^±1 = half-twist of the bottom
//                pins at positions i, i+1 (Δ, Δ² rotate every pin)
//   KnotScene    a loose knot in a single rope, pulled tight by its ends
//   RopeScene    strands on a circle, the bottom clamp spinning (ppf "twist")
//   NoodleScene  long strands poured into a bowl (ppf "noodle")

import { Sim } from './solver.js';
import { deltaWord, inverse } from './braid.js';

export const PALETTE = ['#ff6b6b', '#ffc15e', '#5ce1a4', '#5cc8ff', '#b197fc', '#ff8fd1', '#9be15c', '#ffa94d'];

const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (u * (6 * u - 15) + 10));

function column(x, yTop, z, length, count) {
  const pts = [];
  for (let k = 0; k < count; k++) pts.push([x, yTop - (length * k) / (count - 1), z]);
  return pts;
}

// ------------------------------------------------------------------ braid

export class BraidScene {
  static id = 'braid';

  constructor(opts = {}) {
    this.o = {
      n: 4, spacing: 0.14, radius: 0.019, length: 1.5, segments: 44,
      beadMass: 0.06, beadRadius: 0.034, twistTime: 1.1, ...opts,
    };
  }

  build(params) {
    const o = this.o, n = o.n;
    const sim = new Sim(params);
    this.yTop = 1.95;
    this.rails = Array.from({ length: n }, (_, k) => (k - (n - 1) / 2) * o.spacing);
    this.beads = [];
    this.tops = [];
    for (let k = 0; k < n; k++) {
      const s = sim.addStrand(column(this.rails[k], this.yTop, 0, o.length, o.segments + 1), {
        radius: o.radius, density: 0.03, stretch: 500, bend: 3e-4, strainLimit: 0.03,
      });
      const top = s.start, bead = s.start + s.count - 1;
      sim.pin(top, 7);
      sim.pin(bead, 1 | 4); // rail: x and z prescribed, y free
      sim.addMass(bead, o.beadMass);
      sim.addBall(bead, o.beadRadius);
      this.tops.push(top);
      this.beads.push(bead);
    }
    sim.addCollider({ type: 'plane', n: [0, 1, 0], d: 0, friction: 0.4 });
    sim.finalize();
    sim.onPins = (t, S) => this._pins(t, S);
    this.sim = sim;
    this.colors = Array.from({ length: n }, (_, k) => PALETTE[k % PALETTE.length]);
    this.slot = Array.from({ length: n }, (_, k) => k); // slot[pos] = strand
    this.applied = [];   // committed letters
    this.queue = [];     // pending moves
    this.active = null;  // move in progress
    this.version = 0;
    return sim;
  }

  get n() { return this.o.n; }

  /** A move is {word, kind:'pair'|'rotate', i, sign, turns}. */
  enqueue(move) { this.queue.push(move); this.version++; }

  gen(g) {
    const i = Math.abs(g);
    if (i < 1 || i >= this.n) return;
    this.enqueue({ word: [g], kind: 'pair', i, sign: Math.sign(g) });
  }

  delta(sign = 1, turns = 1) {
    const w = [];
    for (let k = 0; k < turns; k++) w.push(...(sign > 0 ? deltaWord(this.n) : inverse(deltaWord(this.n))));
    this.enqueue({ word: w, kind: 'rotate', sign, turns });
  }

  /** Undo: drop the last pending move, reverse the one in flight, or apply the inverse letter. */
  undo() {
    if (this.queue.length) { this.queue.pop(); this.version++; return; }
    if (this.active) { this.active.dir = -this.active.dir; this.active.hold = 0; this.version++; return; }
    const last = this.applied[this.applied.length - 1];
    if (last !== undefined) this.gen(-last);
  }

  clearPending() { this.queue.length = 0; this.version++; }

  get busy() { return !!this.active || this.queue.length > 0; }

  get blocked() { return !!(this.active && this.active.hold > 0); }

  // A move runs on its own clock u ∈ [0, 1]. Each step asks the pins to go a
  // little further along their arcs; the solver may only get them part of the
  // way (toi_advanced < 1 when CCD or a strain limit cuts the step), so u
  // advances by what was actually achieved. A pin driven into strands that
  // cannot yield (friction holding the wraps, strain at its limit) would
  // stall the solver — ppf reports exactly that — so once the strands are
  // taut the pins hold still where they are and the move retries later.
  _pins(tEnd, S) {
    const o = this.o;
    let a = this.active;
    if (a && a.goal !== null) {
      a.u += S.lastToiAdv * (a.goal - a.u);
      a.goal = null;
    }
    if (a && a.dir > 0 && a.u >= 1 - 1e-9) {
      if (a.kind === 'pair') {
        const i = a.i - 1;
        [this.slot[i], this.slot[i + 1]] = [this.slot[i + 1], this.slot[i]];
      } else if (a.turns % 2 === 1) {
        this.slot.reverse();
      }
      this.applied.push(...a.word);
      this.active = a = null;
      this.version++;
    } else if (a && a.dir < 0 && a.u <= 1e-9) {
      this.active = a = null;
      this.version++;
    }
    if (!a && this.queue.length) {
      const m = this.queue.shift();
      const T = m.kind === 'pair' ? o.twistTime : o.twistTime * 1.6 * m.turns * Math.sqrt(this.n / 2);
      this.active = a = { ...m, T, u: 0, dir: 1, goal: null, hold: 0, blocks: 0 };
      this.version++;
    }
    if (a && a.dir > 0 && a.hold === 0) {
      const lim = S.strands[0].strainLimit;
      if (S.lastMaxStrain > 0.55 * lim || S.lastToiAdv < 0.02) { a.hold = 120; a.blocks++; this.version++; }
    }
    if (a && a.hold > 0) {
      // hold every pin exactly where it is
      a.hold--;
      if (a.hold === 0) this.version++;
      for (const bead of this.beads) {
        S.pinGoal[3 * bead] = S.x[3 * bead];
        S.pinGoal[3 * bead + 2] = S.x[3 * bead + 2];
      }
      return;
    }
    let u = 0;
    if (a) {
      a.goal = Math.min(1, Math.max(0, a.u + (a.dir * S.p.dt) / a.T));
      u = a.goal;
    }
    const e = smooth(u);
    for (let pos = 0; pos < this.n; pos++) {
      let gx = this.rails[pos], gz = 0;
      if (a) {
        let mid = null, phi = 0;
        if (a.kind === 'pair' && (pos === a.i - 1 || pos === a.i)) {
          mid = 0.5 * (this.rails[a.i - 1] + this.rails[a.i]);
          phi = a.sign * Math.PI * e;
        } else if (a.kind === 'rotate') {
          mid = 0;
          phi = a.sign * Math.PI * a.turns * e;
        }
        if (mid !== null) {
          // left pin passes in front (+z) for a positive move
          const r = this.rails[pos] - mid;
          gx = mid + r * Math.cos(phi);
          gz = -r * Math.sin(phi);
        }
      }
      const bead = this.beads[this.slot[pos]];
      S.pinGoal[3 * bead] = gx;
      S.pinGoal[3 * bead + 2] = gz;
    }
  }

  /** Progress of the move in flight, 0…1, or null. */
  progress() {
    return this.active ? this.active.u : null;
  }

  strandPolylines() {
    const x = this.sim.x;
    return this.sim.strands.map((s) => {
      const pts = [];
      for (let k = 0; k < s.count; k++) {
        const i = s.start + k;
        pts.push([x[3 * i], x[3 * i + 1], x[3 * i + 2]]);
      }
      return pts;
    });
  }

  decor() {
    const o = this.o, half = ((this.n - 1) / 2) * o.spacing + 0.12;
    return {
      topBar: { y: this.yTop, x0: -half, x1: half },
      rails: this.rails.map((x) => ({ x, z: 0 })),
      beads: this.beads.map((v, k) => ({ v, r: o.beadRadius, color: this.colors[k] })),
      floor: 0,
      target: [0, 1.1, 0],
      camera: [0.35, 1.32, 3.45 + 0.12 * this.n],
    };
  }
}

// ------------------------------------------------------------------- knot

const KNOT_CURVES = {
  trefoil: { label: 'Trefoil 3₁', f: (t) => [Math.sin(t) + 2 * Math.sin(2 * t), Math.cos(t) - 2 * Math.cos(2 * t), -Math.sin(3 * t)] },
  figure8: { label: 'Figure-eight 4₁', f: (t) => [(2 + Math.cos(2 * t)) * Math.cos(3 * t), (2 + Math.cos(2 * t)) * Math.sin(3 * t), Math.sin(4 * t)] },
  cinquefoil: { label: 'Cinquefoil 5₁', f: (t) => torus(2, 5, t) },
  septafoil: { label: 'T(2,7) = 7₁', f: (t) => torus(2, 7, t) },
};
function torus(p, q, t) {
  const r = 2.2 + Math.cos(q * t);
  return [r * Math.cos(p * t), r * Math.sin(p * t), -1.1 * Math.sin(q * t)];
}
export const KNOTS = Object.fromEntries(Object.entries(KNOT_CURVES).map(([k, v]) => [k, v.label]));

export class KnotScene {
  static id = 'knot';

  constructor(opts = {}) {
    this.o = { knot: 'trefoil', radius: 0.02, seg: 0.026, loose: 2.6, pull: 0.6, pullSpeed: 0.3, ...opts };
  }

  build(params) {
    const o = this.o, sim = new Sim({ ...params, gravity: 0 });
    const curve = KNOT_CURVES[o.knot] || KNOT_CURVES.trefoil;
    // dense samples of the closed curve
    const M = 4000, raw = [];
    for (let k = 0; k < M; k++) raw.push(curve.f((2 * Math.PI * k) / M));
    // put the lobe tip farthest from the axis at the top
    let best = 0, bestR = -1;
    raw.forEach((q, k) => { const r = q[0] * q[0] + q[1] * q[1]; if (r > bestR) { bestR = r; best = k; } });
    const ang = Math.PI / 2 - Math.atan2(raw[best][1], raw[best][0]);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    let pts = raw.map((q) => [q[0] * ca - q[1] * sa, q[0] * sa + q[1] * ca, q[2]]);
    pts = pts.slice(best).concat(pts.slice(0, best)); // start at the tip
    // arclength
    const arc = [0];
    for (let k = 1; k <= M; k++) {
      const a = pts[k - 1], b = pts[k % M];
      arc.push(arc[k - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    }
    const total = arc[M];
    // scale so that far-apart parts of the rope clear each other by `loose` diameters
    const need = 2 * o.radius + sim.p.ghat;
    let dmin = Infinity;
    const stride = 8;
    for (let i = 0; i < M; i += stride) {
      for (let j = i + stride; j < M; j += stride) {
        const da = Math.min(arc[j] - arc[i], total - (arc[j] - arc[i]));
        if (da < 0.12 * total) continue;
        const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1], pts[i][2] - pts[j][2]);
        if (d < dmin) dmin = d;
      }
    }
    const scale = (o.loose * need) / dmin;
    // resample the open arc (cut out a gap at the tip) at spacing `seg`
    const cut = (3.5 * need) / scale;
    const sample = (s) => {
      let lo = 0, hi = M;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (arc[mid] <= s) lo = mid; else hi = mid; }
      const u = (s - arc[lo]) / (arc[lo + 1] - arc[lo] || 1);
      const a = pts[lo], b = pts[(lo + 1) % M];
      return [(a[0] + u * (b[0] - a[0])) * scale, (a[1] + u * (b[1] - a[1])) * scale, (a[2] + u * (b[2] - a[2])) * scale];
    };
    const len = (total - 2 * cut) * scale, count = Math.max(8, Math.round(len / o.seg));
    const body = [];
    for (let k = 0; k <= count; k++) body.push(sample(cut + ((total - 2 * cut) * k) / count));
    // tails: out of each end along the tangent, tilted upward
    const tail = (end, prev, dirX) => {
      const tx = end[0] - prev[0], ty = end[1] - prev[1], tz = end[2] - prev[2];
      const tl = Math.hypot(tx, ty, tz);
      let dx = tx / tl + 0.4 * dirX, dy = ty / tl + 0.7, dz = tz / tl;
      const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
      const out = [], steps = Math.round(0.55 / o.seg);
      for (let k = 1; k <= steps; k++) out.push([end[0] + dx * o.seg * k, end[1] + dy * o.seg * k, end[2] + dz * o.seg * k]);
      return out;
    };
    const tailA = tail(body[0], body[1], -1).reverse();
    const tailB = tail(body[body.length - 1], body[body.length - 2], 1);
    let rope = tailA.concat(body, tailB);
    // centre the knot
    const cy = rope.reduce((s, q) => s + q[1], 0) / rope.length;
    rope = rope.map((q) => [q[0], q[1] - cy + 1.0, q[2]]);
    const s = sim.addStrand(rope, { radius: o.radius, density: 0.03, stretch: 500, bend: 1.5e-4, strainLimit: 0.03 });
    this.endA = s.start; this.endB = s.start + s.count - 1;
    sim.pin(this.endA, 7); sim.pin(this.endB, 7);
    sim.finalize();
    this.sim = sim;
    this.colors = ['#ffc15e'];
    const x = sim.x;
    this.a0 = [x[3 * this.endA], x[3 * this.endA + 1], x[3 * this.endA + 2]];
    this.b0 = [x[3 * this.endB], x[3 * this.endB + 1], x[3 * this.endB + 2]];
    this.sep0 = Math.hypot(this.b0[0] - this.a0[0], this.b0[1] - this.a0[1], this.b0[2] - this.a0[2]);
    this.ropeLength = s.restLength;
    this.sep = this.sep0;
    this.hold = false;
    sim.onPins = (t, S) => this._pins(t, S);
    return sim;
  }

  // Ends slide apart toward the separation the pull slider asks for, and
  // stop once the rope is taut (a pin driven into a rope that cannot yield
  // would stall the solver, exactly as ppf reports it).
  _pins(tEnd, S) {
    const o = this.o, dt = S.p.dt;
    const maxSep = this.ropeLength - 18 * o.radius;
    const want = this.sep0 + o.pull * (maxSep - this.sep0);
    const taut = S.lastMaxStrain > 0.5 * S.strands[0].strainLimit;
    let step = Math.sign(want - this.sep) * Math.min(Math.abs(want - this.sep), o.pullSpeed * dt);
    if (step > 0 && taut) step = 0;
    this.hold = step === 0 && want > this.sep + 1e-4;
    this.sep += step;
    const mid = [(this.a0[0] + this.b0[0]) / 2, (this.a0[1] + this.b0[1]) / 2, (this.a0[2] + this.b0[2]) / 2];
    const h = this.sep / 2;
    S.pinGoal.set([mid[0] - h, mid[1], mid[2]], 3 * this.endA);
    S.pinGoal.set([mid[0] + h, mid[1], mid[2]], 3 * this.endB);
  }

  /** Centre and size of the knotted part: curvature-weighted, so the
   *  straightened tails drop out as the knot tightens. */
  focus() {
    const x = this.sim.x, s = this.sim.strands[0];
    let W = 0, cx = 0, cy = 0, cz = 0;
    const w = new Float64Array(s.count);
    for (let k = 1; k < s.count - 1; k++) {
      const i = s.start + k;
      const ax = x[3 * i] - x[3 * i - 3], ay = x[3 * i + 1] - x[3 * i - 2], az = x[3 * i + 2] - x[3 * i - 1];
      const bx = x[3 * i + 3] - x[3 * i], by = x[3 * i + 4] - x[3 * i + 1], bz = x[3 * i + 5] - x[3 * i + 2];
      const c = (ax * bx + ay * by + az * bz) / (Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz) || 1);
      w[k] = Math.acos(Math.max(-1, Math.min(1, c))) + 1e-4;
      W += w[k]; cx += w[k] * x[3 * i]; cy += w[k] * x[3 * i + 1]; cz += w[k] * x[3 * i + 2];
    }
    cx /= W; cy /= W; cz /= W;
    let r2 = 0;
    for (let k = 1; k < s.count - 1; k++) {
      const i = s.start + k;
      r2 += w[k] * ((x[3 * i] - cx) ** 2 + (x[3 * i + 1] - cy) ** 2 + (x[3 * i + 2] - cz) ** 2);
    }
    return { c: [cx, cy, cz], r: Math.sqrt(r2 / W) };
  }

  decor() {
    const f = this.focus(), d = Math.max(0.5, 5.2 * f.r);
    return {
      handles: [this.endA, this.endB],
      target: f.c,
      camera: [f.c[0] + 0.15 * d, f.c[1] + 0.25 * d, f.c[2] + d],
      follow: true,
    };
  }
}

// ------------------------------------------------------------------- rope

export class RopeScene {
  static id = 'rope';

  constructor(opts = {}) {
    this.o = { n: 5, ringRadius: 0.075, radius: 0.017, length: 1.55, segments: 48, beadMass: 0.03, speed: 0.35, spin: true, ...opts };
  }

  build(params) {
    const o = this.o, n = o.n, sim = new Sim({ ...params, dt: 1 / 120 });
    this.yTop = 1.95;
    this.angle = 0;
    this.phase = Array.from({ length: n }, (_, k) => (2 * Math.PI * k) / n + Math.PI / 2);
    this.beads = [];
    for (let k = 0; k < n; k++) {
      const x = o.ringRadius * Math.cos(this.phase[k]), z = o.ringRadius * Math.sin(this.phase[k]);
      const s = sim.addStrand(column(x, this.yTop, z, o.length, o.segments + 1), {
        radius: o.radius, density: 0.03, stretch: 500, bend: 3e-4, strainLimit: 0.03,
      });
      sim.pin(s.start, 7);
      const bead = s.start + s.count - 1;
      sim.pin(bead, 1 | 4);
      sim.addMass(bead, o.beadMass);
      this.beads.push(bead);
    }
    sim.addCollider({ type: 'plane', n: [0, 1, 0], d: 0, friction: 0.4 });
    sim.finalize();
    sim.onPins = (t, S) => this._pins(t, S);
    this.sim = sim;
    this.colors = Array.from({ length: n }, (_, k) => PALETTE[(k + 2) % PALETTE.length]);
    this.hold = false;
    return sim;
  }

  _pins(tEnd, S) {
    const o = this.o, dt = S.p.dt;
    // stop winding when the strands are taut or the clamp has climbed too far
    const lift = Math.min(...this.beads.map((v) => S.x[3 * v + 1]));
    const taut = S.lastMaxStrain > 0.55 * S.strands[0].strainLimit || lift > this.yTop - 0.45;
    const w = o.spin ? 2 * Math.PI * o.speed : 0;
    this.hold = w > 0 && taut;
    if (!this.hold) this.angle += w * dt;
    for (let k = 0; k < o.n; k++) {
      const a = this.phase[k] + this.angle;
      S.pinGoal[3 * this.beads[k]] = o.ringRadius * Math.cos(a);
      S.pinGoal[3 * this.beads[k] + 2] = o.ringRadius * Math.sin(a);
    }
  }

  unwind() { this.o.speed = -Math.abs(this.o.speed); }

  decor() {
    const o = this.o;
    return {
      clamp: { y: this.yTop, r: o.ringRadius + 0.05 },
      bottomClamp: { beads: this.beads, r: o.ringRadius + 0.05 },
      beads: this.beads.map((v, k) => ({ v, r: 0.03, color: this.colors[k] })),
      floor: 0,
      target: [0, 1.08, 0],
      camera: [1.2, 1.4, 3.1],
    };
  }
}

// ----------------------------------------------------------------- noodles

export class NoodleScene {
  static id = 'noodles';

  constructor(opts = {}) {
    this.o = { count: 6, length: 2.0, radius: 0.016, seg: 0.03, bowl: 0.62, seed: 7, ...opts };
  }

  build(params) {
    const o = this.o, sim = new Sim(params);
    const c = [0, o.bowl + 0.04, 0];
    let seed = o.seed;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const clear = 2 * o.radius + sim.p.ghat + 0.014;
    // Each noodle is a smooth, self-avoiding random curve in its own
    // horizontal layer inside the bowl; the layers fall and interleave.
    for (let k = 0; k < o.count; k++) {
      const y = c[1] - 0.12 + k * 0.066;
      const R = Math.sqrt(o.bowl * o.bowl - (y - c[1]) ** 2) - 0.07;
      let best = [];
      for (let attempt = 0; attempt < 16 && best.length <= Math.round(o.length / o.seg); attempt++) {
      const pts = [];
      const py = (j) => y + 0.008 * Math.sin(0.9 * j + k);
      let px = (rnd() - 0.5) * 0.3 * R, pz = (rnd() - 0.5) * 0.3 * R, th = 2 * Math.PI * rnd(), rate = 0;
      pts.push([px, py(0), pz]);
      const steps = Math.round(o.length / o.seg), MAXT = 0.3;
      const clampT = (v) => Math.max(-MAXT, Math.min(MAXT, v));
      for (let j = 1; j <= steps; j++) {
        let placed = false;
        for (let tries = 0; tries < 30 && !placed; tries++) {
          // bounded turning rate: no hairpin tighter than seg / MAXT
          rate = tries ? clampT((rnd() - 0.5) * 2 * MAXT) : clampT(0.85 * rate + (rnd() - 0.5) * 0.25);
          if (px * px + pz * pz > 0.55 * R * R) {
            let diff = Math.atan2(-pz, -px) - th;
            diff = Math.atan2(Math.sin(diff), Math.cos(diff));
            rate = clampT(rate + 0.12 * Math.sign(diff));
          }
          const h = th + rate, nx = px + o.seg * Math.cos(h), nz = pz + o.seg * Math.sin(h);
          let ok = nx * nx + nz * nz <= R * R;
          for (let q = 0; ok && q < pts.length - 3; q++) {
            if ((pts[q][0] - nx) ** 2 + (pts[q][2] - nz) ** 2 < clear * clear) ok = false;
          }
          if (ok) { px = nx; pz = nz; th = h; pts.push([px, py(j), pz]); placed = true; }
        }
        if (!placed) break;
      }
      if (pts.length > best.length) best = pts;
      }
      const pts = best;
      if (pts.length > 8) sim.addStrand(pts, { radius: o.radius, density: 0.03, stretch: 400, bend: 1.2e-4, strainLimit: 0.03 });
    }
    sim.addCollider({ type: 'bowl', c, r: o.bowl, friction: 0.35 });
    sim.finalize();
    this.sim = sim;
    this.colors = Array.from({ length: sim.strands.length }, (_, k) => PALETTE[(k * 3) % PALETTE.length]);
    this.bowl = { c, r: o.bowl };
    return sim;
  }

  decor() {
    return { bowl: this.bowl, stripes: false, target: [0, 0.3, 0], camera: [0.55, 1.75, 2.35] };
  }
}

export const SCENES = { braid: BraidScene, knot: KnotScene, rope: RopeScene, noodles: NoodleScene };
