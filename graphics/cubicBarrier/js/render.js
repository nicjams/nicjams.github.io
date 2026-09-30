// render.js — three.js view: strands as smooth tubes (radius = contact
// radius, so what touches on screen touches in the solver), beads, pucks,
// clamps, the glass bowl, and x-ray contact sparks.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const RADIAL = 14;
const SUB = 3;

// ------------------------------------------------------------------ tube

class Tube {
  constructor(count, radius, material) {
    this.count = count;
    this.radius = radius;
    const M = (this.M = (count - 1) * SUB + 1);
    const g = (this.geometry = new THREE.BufferGeometry());
    this.pos = new Float32Array(M * RADIAL * 3);
    this.nrm = new Float32Array(M * RADIAL * 3);
    this.col = new Float32Array(M * RADIAL * 3).fill(1);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let k = 0; k < M - 1; k++) {
      for (let j = 0; j < RADIAL; j++) {
        const a = k * RADIAL + j, b = k * RADIAL + ((j + 1) % RADIAL), c = a + RADIAL, d = b + RADIAL;
        idx.push(a, b, c, b, d, c); // outward-facing: (b − a) × (c − a) ∥ +radial
      }
    }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    const capGeo = new THREE.SphereGeometry(radius, RADIAL, 8);
    this.capA = new THREE.Mesh(capGeo, material);
    this.capB = new THREE.Mesh(capGeo, material);
    this.capA.castShadow = this.capB.castShadow = true;
    this.base = new THREE.Color(1, 1, 1);
    this.stripes = true;
    this.P = new Float32Array(M * 3);
    this.T = new Float32Array(M * 3);
    this.scalar = new Float32Array(count);
  }

  addTo(group) { group.add(this.mesh, this.capA, this.capB); }

  update(x, start, colorFn) {
    const n = this.count, P = this.P, M = this.M;
    const X = (k, d) => {
      const kk = k < 0 ? 0 : k >= n ? n - 1 : k;
      return x[3 * (start + kk) + d];
    };
    // uniform Catmull–Rom through the vertices
    let o = 0;
    for (let k = 0; k < n - 1; k++) {
      for (let j = 0; j < SUB; j++, o++) {
        const t = j / SUB, t2 = t * t, t3 = t2 * t;
        const w0 = -0.5 * t3 + t2 - 0.5 * t, w1 = 1.5 * t3 - 2.5 * t2 + 1;
        const w2 = -1.5 * t3 + 2 * t2 + 0.5 * t, w3 = 0.5 * t3 - 0.5 * t2;
        for (let d = 0; d < 3; d++) {
          let a = X(k - 1, d), b = X(k, d), c = X(k + 1, d), e = X(k + 2, d);
          if (k === 0) a = 2 * b - c;
          if (k + 2 >= n) e = 2 * c - b;
          P[3 * o + d] = w0 * a + w1 * b + w2 * c + w3 * e;
        }
      }
    }
    for (let d = 0; d < 3; d++) P[3 * o + d] = X(n - 1, d);
    // tangents and a parallel-transported frame
    const T = this.T;
    for (let k = 0; k < M; k++) {
      const a = Math.max(0, k - 1), b = Math.min(M - 1, k + 1);
      let tx = P[3 * b] - P[3 * a], ty = P[3 * b + 1] - P[3 * a + 1], tz = P[3 * b + 2] - P[3 * a + 2];
      const l = Math.hypot(tx, ty, tz) || 1;
      T[3 * k] = tx / l; T[3 * k + 1] = ty / l; T[3 * k + 2] = tz / l;
    }
    let nx = 1, ny = 0, nz = 0;
    if (Math.abs(T[0]) > 0.9) { nx = 0; nz = 1; }
    const r = this.radius, pos = this.pos, nrm = this.nrm, col = this.col;
    const base = this.base, pitch = 7 * r;
    let arc = 0;
    for (let k = 0; k < M; k++) {
      if (k) arc += Math.hypot(P[3 * k] - P[3 * k - 3], P[3 * k + 1] - P[3 * k - 2], P[3 * k + 2] - P[3 * k - 1]);
      const tx = T[3 * k], ty = T[3 * k + 1], tz = T[3 * k + 2];
      const dd = nx * tx + ny * ty + nz * tz;
      nx -= dd * tx; ny -= dd * ty; nz -= dd * tz;
      let l = Math.hypot(nx, ny, nz);
      if (l < 1e-6) { nx = ty; ny = -tx; nz = 0; l = Math.hypot(nx, ny, nz) || 1; }
      nx /= l; ny /= l; nz /= l;
      const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
      let cr = base.r, cg = base.g, cb = base.b;
      if (colorFn) {
        const s = (k / SUB) | 0, f = k / SUB - s;
        const v = s + 1 < n ? this.scalar[s] * (1 - f) + this.scalar[s + 1] * f : this.scalar[n - 1];
        [cr, cg, cb] = colorFn(v);
      }
      for (let j = 0; j < RADIAL; j++) {
        const th = (2 * Math.PI * j) / RADIAL, c = Math.cos(th), s = Math.sin(th);
        const ex = c * nx + s * bx, ey = c * ny + s * by, ez = c * nz + s * bz;
        const q = 3 * (k * RADIAL + j);
        pos[q] = P[3 * k] + r * ex; pos[q + 1] = P[3 * k + 1] + r * ey; pos[q + 2] = P[3 * k + 2] + r * ez;
        nrm[q] = ex; nrm[q + 1] = ey; nrm[q + 2] = ez;
        // three helical plies, just a shade darker in the grooves
        const f = this.stripes ? 0.84 + 0.16 * Math.pow(0.5 + 0.5 * Math.cos(3 * th - (2 * Math.PI * arc) / pitch), 0.6) : 1;
        col[q] = cr * f; col[q + 1] = cg * f; col[q + 2] = cb * f;
      }
    }
    const g = this.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.computeBoundingSphere();
    this.capA.position.set(P[0], P[1], P[2]);
    this.capB.position.set(P[3 * (M - 1)], P[3 * (M - 1) + 1], P[3 * (M - 1) + 2]);
  }
}

// ---------------------------------------------------------------- colors

const tmpC = new THREE.Color();
function strainColor(v) { // 0 → cool slate, 1 → the strain limit (hot)
  const t = Math.min(1, Math.max(0, v));
  tmpC.setHSL(0.62 - 0.62 * t, 0.75, 0.35 + 0.25 * t);
  return [tmpC.r, tmpC.g, tmpC.b];
}

function sparkTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.8)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------------ view

export class View {
  constructor(canvas) {
    const R = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true }));
    R.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    R.toneMapping = THREE.ACESFilmicToneMapping;
    R.toneMappingExposure = 0.92;
    R.outputColorSpace = THREE.SRGBColorSpace;
    R.shadowMap.enabled = true;
    R.shadowMap.type = THREE.PCFSoftShadowMap;

    const S = (this.scene = new THREE.Scene());
    S.background = new THREE.Color('#0a0d14');
    S.fog = new THREE.Fog('#0a0d14', 5, 11);
    const pmrem = new THREE.PMREMGenerator(R);
    S.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    S.environmentIntensity = 0.45;

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.01, 60);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.4;
    this.controls.maxDistance = 8;
    this.controls.maxPolarAngle = Math.PI * 0.495;

    S.add(new THREE.HemisphereLight('#c9d4ff', '#18120c', 0.55));
    const key = (this.key = new THREE.DirectionalLight('#fff1dc', 2.4));
    key.position.set(1.6, 3.4, 2.2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -1.6; key.shadow.camera.right = 1.6;
    key.shadow.camera.top = 2.4; key.shadow.camera.bottom = -0.6;
    key.shadow.camera.near = 0.5; key.shadow.camera.far = 8;
    key.shadow.bias = -0.0004;
    key.shadow.radius = 4;
    S.add(key, key.target);
    const rim = new THREE.DirectionalLight('#7fb6ff', 1.3);
    rim.position.set(-2.5, 1.8, -2.2);
    S.add(rim);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(7, 96),
      new THREE.MeshStandardMaterial({ color: '#10141d', roughness: 0.92, metalness: 0 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    S.add(floor);
    const grid = new THREE.PolarGridHelper(3, 16, 12, 96, '#1d2433', '#161b27');
    grid.position.y = 0.0015;
    S.add(grid);

    this.world = new THREE.Group();
    S.add(this.world);
    this.sparkMat = new THREE.PointsMaterial({
      size: 0.028, map: sparkTexture(), vertexColors: true, transparent: true,
      depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    this.lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthTest: false });
    this.showContacts = false;
    this.colorMode = 'strand';
    this.resize();
  }

  resize() {
    const c = this.renderer.domElement;
    const w = c.clientWidth || window.innerWidth, h = c.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    if (w < 760) {
      // phones: panels are bottom sheets, so centre the scene in the upper
      // part of the screen (a taller virtual frustum, lower window of it)
      const extra = 0.3 * h;
      this.camera.aspect = w / (h + extra);
      this.camera.zoom = 0.38;
      this.camera.setViewOffset(w, h + extra, 0, extra, w, h);
    } else {
      this.camera.aspect = w / Math.max(1, h);
      this.camera.zoom = 1;
      this.camera.clearViewOffset();
    }
    this.camera.updateProjectionMatrix();
  }

  /** Rebuild everything for a scene object from scenes.js. */
  setScene(sc, keepCamera = false) {
    const W = this.world;
    W.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    W.clear();
    this.sc = sc;
    const sim = sc.sim, dec = sc.decor();
    this.dec = dec;
    this.tubes = sim.strands.map((s, k) => {
      const mat = new THREE.MeshPhysicalMaterial({
        color: '#ffffff', vertexColors: true, roughness: 0.5, metalness: 0,
        clearcoat: 0.25, clearcoatRoughness: 0.5,
      });
      const t = new Tube(s.count, s.radius, mat);
      t.base.set(sc.colors[k % sc.colors.length]);
      t.stripes = dec.stripes !== false;
      t.capA.material = t.capB.material = new THREE.MeshPhysicalMaterial({ color: t.base, roughness: 0.5, clearcoat: 0.25 });
      t.strand = s;
      t.addTo(W);
      return t;
    });
    const metal = new THREE.MeshStandardMaterial({ color: '#a7afc0', metalness: 0.85, roughness: 0.32 });
    const dark = new THREE.MeshStandardMaterial({ color: '#1b2130', metalness: 0.2, roughness: 0.7 });
    this.beadMeshes = [];
    this.pucks = [];
    if (dec.topBar) {
      const { y, x0, x1 } = dec.topBar;
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, x1 - x0, 32), metal);
      bar.rotation.z = Math.PI / 2;
      bar.position.set((x0 + x1) / 2, y + 0.045, 0);
      bar.castShadow = true;
      W.add(bar);
      for (const s of sim.strands) {
        const i = s.start;
        const eye = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.006, 10, 24), metal);
        eye.position.set(sim.x[3 * i], y + 0.012, sim.x[3 * i + 2]);
        W.add(eye);
      }
    }
    if (dec.clamp) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(dec.clamp.r, 0.012, 16, 64), metal);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = dec.clamp.y + 0.01;
      ring.castShadow = true;
      const disk = new THREE.Mesh(new THREE.CylinderGeometry(dec.clamp.r, dec.clamp.r, 0.02, 48), dark);
      disk.position.y = dec.clamp.y + 0.03;
      W.add(ring, disk);
    }
    if (dec.beads) {
      // slots on the floor plate, and a puck + tether under each bead
      const plate = new THREE.Mesh(new THREE.BoxGeometry(1, 0.02, 1), dark);
      plate.receiveShadow = true;
      if (dec.rails) {
        const xs = dec.rails.map((r) => r.x);
        plate.scale.set(Math.max(...xs) - Math.min(...xs) + 0.34, 1, 0.34);
      } else {
        const r = (dec.bottomClamp?.r ?? 0.2) * 2 + 0.12;
        plate.geometry.dispose();
        plate.geometry = new THREE.CylinderGeometry(r / 2, r / 2, 0.02, 64);
      }
      plate.position.y = 0.01;
      W.add(plate);
      for (const r of dec.rails || []) {
        const slot = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.028, 32), new THREE.MeshBasicMaterial({ color: '#39445c' }));
        slot.rotation.x = -Math.PI / 2;
        slot.position.set(r.x, 0.021, r.z);
        W.add(slot);
      }
      const tetherMat = new THREE.MeshStandardMaterial({ color: '#8390a8', metalness: 0.6, roughness: 0.4, transparent: true, opacity: 0.55 });
      for (const b of dec.beads) {
        const bm = new THREE.MeshPhysicalMaterial({ color: b.color, metalness: 0.35, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12 });
        const bead = new THREE.Mesh(new THREE.SphereGeometry(b.r, 32, 18), bm);
        bead.castShadow = true;
        const puck = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.016, 28), metal);
        puck.castShadow = true;
        const tether = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 1, 8), tetherMat);
        W.add(bead, puck, tether);
        this.beadMeshes.push({ v: b.v, mesh: bead, puck, tether, r: b.r });
      }
    }
    if (dec.handles) {
      this.handles = dec.handles.map((v) => {
        const h = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.09, 24), metal);
        h.rotation.z = Math.PI / 2;
        h.castShadow = true;
        W.add(h);
        return { v, mesh: h };
      });
    } else this.handles = null;
    if (dec.bowl) {
      const { c, r } = dec.bowl;
      const glass = new THREE.MeshPhysicalMaterial({
        color: '#cfe6ff', roughness: 0.06, metalness: 0, transparent: true, opacity: 0.09,
        side: THREE.DoubleSide, depthWrite: false, clearcoat: 1, envMapIntensity: 1.2,
      });
      const bowl = new THREE.Mesh(new THREE.SphereGeometry(r + 0.012, 72, 36, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.58), glass);
      bowl.position.set(c[0], c[1], c[2]);
      const lipR = (r + 0.012) * Math.sin(Math.PI * 0.42), lipY = c[1] + (r + 0.012) * Math.cos(Math.PI * 0.42);
      const lip = new THREE.Mesh(new THREE.TorusGeometry(lipR, 0.008, 12, 96), glass);
      lip.rotation.x = Math.PI / 2;
      lip.position.set(c[0], lipY, c[2]);
      W.add(bowl, lip);
    }
    // contact sparks + spokes
    this.sparkGeo = new THREE.BufferGeometry();
    this.sparkPos = new Float32Array(3 * 4096);
    this.sparkCol = new Float32Array(3 * 4096);
    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.sparkGeo.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.sparks = new THREE.Points(this.sparkGeo, this.sparkMat);
    this.sparks.frustumCulled = false;
    this.sparks.renderOrder = 10;
    this.spokeGeo = new THREE.BufferGeometry();
    this.spokePos = new Float32Array(6 * 4096);
    this.spokeCol = new Float32Array(6 * 4096);
    this.spokeGeo.setAttribute('position', new THREE.BufferAttribute(this.spokePos, 3).setUsage(THREE.DynamicDrawUsage));
    this.spokeGeo.setAttribute('color', new THREE.BufferAttribute(this.spokeCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.spokes = new THREE.LineSegments(this.spokeGeo, this.lineMat);
    this.spokes.frustumCulled = false;
    this.spokes.renderOrder = 9;
    W.add(this.sparks, this.spokes);
    if (!keepCamera) this.frame(dec);
    this.update();
  }

  frame(dec = this.dec) {
    this.camera.position.set(...dec.camera);
    this.controls.target.set(...dec.target);
    this.controls.update();
  }

  setColorMode(mode) {
    this.colorMode = mode;
  }

  update() {
    const sc = this.sc;
    if (!sc) return;
    const sim = sc.sim, x = sim.x, mode = this.colorMode;
    for (const t of this.tubes) {
      const s = t.strand;
      let fn = null;
      if (mode === 'strain') {
        const lim = s.strainLimit || 0.03;
        for (let k = 0; k < s.count; k++) {
          const e0 = s.firstEdge + Math.min(k, s.count - 2), e1 = s.firstEdge + Math.max(0, k - 1);
          t.scalar[k] = Math.max(0, 0.5 * (sim.strainOf(e0) + sim.strainOf(e1))) / lim;
        }
        fn = strainColor;
      } else if (mode === 'contact') {
        const base = t.base;
        for (let k = 0; k < s.count; k++) t.scalar[k] = sim.vContact[s.start + k];
        // strands dimmed to a cool slate, glowing orange-white where they touch
        fn = (v) => {
          const h = Math.min(1, v) ** 0.7;
          const r0 = 0.06 + 0.25 * base.r, g0 = 0.07 + 0.25 * base.g, b0 = 0.1 + 0.25 * base.b;
          return [r0 + h * (1.0 - r0), g0 + h * (0.55 - g0), b0 + h * (0.12 - b0)];
        };
      }
      t.update(x, s.start, fn);
    }
    for (const b of this.beadMeshes) {
      const i = b.v, px = x[3 * i], py = x[3 * i + 1], pz = x[3 * i + 2];
      b.mesh.position.set(px, py, pz);
      b.puck.position.set(px, 0.028, pz);
      const h = Math.max(0.001, py - b.r - 0.036);
      b.tether.scale.set(1, h, 1);
      b.tether.position.set(px, 0.036 + h / 2, pz);
    }
    if (this.handles) {
      for (const h of this.handles) h.mesh.position.set(x[3 * h.v], x[3 * h.v + 1], x[3 * h.v + 2]);
    }
    // contacts
    const on = this.showContacts;
    this.sparks.visible = this.spokes.visible = on;
    if (on) {
      const n = Math.min(sim.nViz, 4096), V = sim.viz;
      let kmax = 0;
      for (let c = 0; c < n; c++) kmax = Math.max(kmax, V[8 * c + 7]);
      for (let c = 0; c < n; c++) {
        const o = 8 * c, g = Math.max(0, Math.min(1, V[o + 6]));
        const mx = 0.5 * (V[o] + V[o + 3]), my = 0.5 * (V[o + 1] + V[o + 4]), mz = 0.5 * (V[o + 2] + V[o + 5]);
        this.sparkPos.set([mx, my, mz], 3 * c);
        // hot white-yellow when nearly touching, teal at the edge of ĝ
        tmpC.setHSL(0.14 + 0.36 * g, 1, 0.62 - 0.22 * g);
        const w = 0.35 + 0.65 * Math.min(1, V[o + 7] / (kmax || 1)) ** 0.3;
        this.sparkCol.set([tmpC.r * w, tmpC.g * w, tmpC.b * w], 3 * c);
        this.spokePos.set([V[o], V[o + 1], V[o + 2], V[o + 3], V[o + 4], V[o + 5]], 6 * c);
        this.spokeCol.set([tmpC.r * 0.6, tmpC.g * 0.6, tmpC.b * 0.6, tmpC.r * 0.6, tmpC.g * 0.6, tmpC.b * 0.6], 6 * c);
      }
      this.sparkGeo.setDrawRange(0, n);
      this.spokeGeo.setDrawRange(0, 2 * n);
      this.sparkGeo.attributes.position.needsUpdate = true;
      this.sparkGeo.attributes.color.needsUpdate = true;
      this.spokeGeo.attributes.position.needsUpdate = true;
      this.spokeGeo.attributes.color.needsUpdate = true;
    }
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // ---- picking: the strand vertex nearest a ray through the pointer

  pick(ndcX, ndcY) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const hits = ray.intersectObjects(this.tubes.map((t) => t.mesh), false);
    if (!hits.length) return null;
    const hit = hits[0], sim = this.sc.sim, x = sim.x;
    const tube = this.tubes.find((t) => t.mesh === hit.object), s = tube.strand;
    let best = -1, bd = Infinity;
    for (let k = 0; k < s.count; k++) {
      const i = s.start + k;
      if (sim.fix[3 * i] && sim.fix[3 * i + 1] && sim.fix[3 * i + 2]) continue;
      const d = (x[3 * i] - hit.point.x) ** 2 + (x[3 * i + 1] - hit.point.y) ** 2 + (x[3 * i + 2] - hit.point.z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) return null;
    return { v: best, point: hit.point.clone() };
  }

  /** Where the pointer ray meets the plane through p facing the camera. */
  dragPoint(ndcX, ndcY, p) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const n = new THREE.Vector3();
    this.camera.getWorldDirection(n);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, p);
    const out = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, out) ? out : null;
  }
}
