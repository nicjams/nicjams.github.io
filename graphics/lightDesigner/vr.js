// vr.js — WebXR immersive VR mode and in-world spatial lighting console.
//
// Brings the entire Light Designer into stereo WebXR ('immersive-vr'):
//   - Standing scale in any venue (Crowd, On Stage under the 30 sticks, FOH, Wing, Balcony)
//   - Smooth thumbstick walking (steps onto the 1.2 m stage deck), 30° snap-turn & elevation
//   - Dual controller / hand-pinch / Vision Pro transient-pointer laser rays with haptics
//   - Floating, grabbable 3D glass lighting desk (1024×1280 CanvasTexture, toneMapped: false)
//     exposing all 5 tabs (Show, Rig, Room, Desk, MIDI): all 33 scenes with thumbnails,
//     shows, 4 master faders, kinetics, stage extras, venues, 72-head programmer plot,
//     live FX stack, cue list, and a two-handed playable 2-octave MIDI keyboard.

import * as THREE from 'three';
import { DECK_Y, DECK_FRONT, DECK_BACK, DECK_HALF, POD_COUNT, PER_POD, FLOOR_COUNT } from './layout.js';
import { K } from './shows.js';

const CW = 1024, CH = 1280;
const PANEL_W = 0.66, PANEL_H = PANEL_W * (CH / CW);
const BODY_TOP = 168, BODY_BOT = CH - 14, BODY_H = BODY_BOT - BODY_TOP;
const DEG = Math.PI / 180;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

const SWATCHES = [
  K.red, K.orange, K.amber, K.gold, K.warm, K.white, K.ice, K.cyan, K.teal, K.green,
  K.lime, K.blue, K.royal, K.uv, K.violet, K.magenta, K.pink, K.lav, '#ff7a40', '#7affd8',
  '#00ff40', '#ff3cc8', '#ffcf8a', '#ffd6a0',
];

export const VANTAGES = {
  audience: { label: 'Crowd', pos: () => [0, 0, DECK_FRONT + 4.6], yaw: 0 },
  stage: { label: 'On Stage', pos: () => [0, DECK_Y, -3.2], yaw: Math.PI },
  foh: { label: 'FOH', pos: () => [0, 0, 22], yaw: 0 },
  side: { label: 'Wing', pos: () => [-9.6, DECK_Y, -2.0], yaw: -Math.PI / 2 },
  balcony: {
    label: 'Balcony',
    pos: (venueId) => (venueId === 'theater' ? [0, 6.2, 22.5] : venueId === 'stadium' ? [0, 14.5, 56] : venueId === 'club' ? [0, 0, 18.5] : [0, 8.5, 28]),
    yaw: 0,
  },
};

function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, w * 0.5, h * 0.5);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export class VRConsole {
  constructor(ctx) {
    this.ctx = ctx; // { engine, rig, midi, lasers, devices, venue, ambience, holds, tap, selectGroup, selectionChanged, markActive, launchScene, setVenue, selectTab, flashHint }
    this.rig = ctx.rig;
    this.engine = ctx.engine;
    this.renderer = this.rig.renderer;
    this.supported = false;
    this.active = false;
    this.vantage = 'audience';
    this.floorOffset = 0; // 1.7 when falling back to 'local' reference space without floor tracking
    this.flyY = 0;
    this.multiSelect = false;

    // 2D canvas surface for the 3D spatial console
    this.canvas = document.createElement('canvas');
    this.canvas.width = CW;
    this.canvas.height = CH;
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;

    this.xrRig = new THREE.Group();
    this.xrRig.name = 'xrRig';

    // Console 3D assembly: opaque dark backing plate (occludes beams behind it) + crisp UI plane
    this.panelGroup = new THREE.Group();
    this.panelGroup.visible = false;
    const backMat = new THREE.MeshBasicMaterial({ color: 0x07090e, transparent: true, opacity: 0.94, depthWrite: true, toneMapped: false });
    const backMesh = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W + 0.024, PANEL_H + 0.024), backMat);
    backMesh.position.z = -0.003;
    backMesh.renderOrder = 2;
    const borderMat = new THREE.MeshBasicMaterial({ color: 0xffb02e, transparent: true, opacity: 0.28, depthWrite: false, toneMapped: false });
    const borderMesh = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W + 0.03, PANEL_H + 0.03), borderMat);
    borderMesh.position.z = -0.004;
    borderMesh.renderOrder = 1;
    const uiMat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, toneMapped: false });
    this.panelMesh = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_H), uiMat);
    this.panelMesh.renderOrder = 31;
    this.panelGroup.add(borderMesh, backMesh, this.panelMesh);
    this.rig.scene.add(this.panelGroup);

    // Subtle floating pill shown when the main console is hidden, so hand-pinch / pointer users can reopen it
    this.reopenCanvas = document.createElement('canvas');
    this.reopenCanvas.width = 256; this.reopenCanvas.height = 72;
    const rg = this.reopenCanvas.getContext('2d');
    roundRect(rg, 2, 2, 252, 68, 34);
    rg.fillStyle = 'rgba(11, 14, 20, 0.88)'; rg.fill();
    rg.lineWidth = 2; rg.strokeStyle = 'rgba(255, 176, 46, 0.55)'; rg.stroke();
    rg.fillStyle = '#ffb02e'; rg.font = '600 24px Inter, system-ui, sans-serif';
    rg.textAlign = 'center'; rg.textBaseline = 'middle';
    rg.fillText('Console · B / Y', 128, 37);
    const reopenTex = new THREE.CanvasTexture(this.reopenCanvas);
    reopenTex.colorSpace = THREE.SRGBColorSpace;
    this.reopenMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.19, 0.054),
      new THREE.MeshBasicMaterial({ map: reopenTex, transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.reopenMesh.renderOrder = 31;
    this.reopenMesh.visible = false;
    this.rig.scene.add(this.reopenMesh);

    this.consoleOpen = true;
    this.scroll = { show: 0, rig: 0, venue: 0, desk: 0, midi: 0 };
    this.contentH = BODY_H;
    this.hits = [];
    this.modal = null; // { kind: 'select' | 'color', id, label, scroll }
    this.drawT = 0;
    this.dirty = true;
    this.grab = null; // { ctrl, offset, dist }
    this.snapCooldown = 0;
    this.btnLatch = new Set();

    // Dual XR controllers + pointer rays + hit cursor dots
    this.raycaster = new THREE.Raycaster();
    this._mat4 = new THREE.Matrix4();
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._q1 = new THREE.Quaternion();
    this.pointers = [0, 1].map((idx) => this.buildController(idx));

    this.renderer.xr.addEventListener('sessionstart', () => this.onSessionStart());
    this.renderer.xr.addEventListener('sessionend', () => this.onSessionEnd());
    this.initButton();
  }

  buildController(idx) {
    const ctrl = this.renderer.xr.getController(idx);
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffb02e, transparent: true, opacity: 0.55, depthTest: false, toneMapped: false });
    const ray = new THREE.Line(lineGeo, lineMat);
    ray.scale.z = 2.5;
    ray.renderOrder = 32;
    ray.visible = false;
    ctrl.add(ray);

    const wand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.013, 0.11, 10).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x1c222e, toneMapped: false }),
    );
    wand.position.z = 0.045;
    wand.visible = false;
    ctrl.add(wand);

    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.007, 16),
      new THREE.MeshBasicMaterial({ color: 0xffb02e, depthTest: false, toneMapped: false }),
    );
    dot.renderOrder = 33;
    dot.visible = false;
    this.panelGroup.add(dot);

    this.xrRig.add(ctrl);
    const p = { idx, ctrl, ray, wand, dot, uv: null, down: false, activeHit: null, scrollDrag: null, note: null, airHold: null, source: null };

    ctrl.addEventListener('connected', (e) => {
      p.source = e.data;
      ray.visible = wand.visible = this.active;
      if (e.data?.targetRayMode === 'transient-pointer') wand.visible = false; // Apple Vision Pro gaze+pinch
    });
    ctrl.addEventListener('disconnected', () => {
      p.source = null;
      ray.visible = wand.visible = dot.visible = false;
      this.releasePointer(p);
    });
    ctrl.addEventListener('selectstart', () => this.onPointerDown(p));
    ctrl.addEventListener('selectend', () => this.onPointerUp(p));
    ctrl.addEventListener('squeezestart', () => this.onSqueezeDown(p));
    ctrl.addEventListener('squeezeend', () => this.onSqueezeUp(p));
    return p;
  }

  async initButton() {
    const btn = document.getElementById('enterVrBtn');
    if (!btn) return;
    const check = async () => {
      try { this.supported = !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-vr')); } catch { this.supported = false; }
      btn.classList.toggle('vr-ready', this.supported);
      btn.title = this.supported ? 'Enter immersive VR' : 'WebXR VR (requires a VR headset or WebXR browser)';
    };
    await check();
    navigator.xr?.addEventListener?.('devicechange', check);
    btn.addEventListener('click', () => this.toggleSession());
  }

  async toggleSession() {
    if (this.renderer.xr.isPresenting) {
      await this.renderer.xr.getSession()?.end();
      return;
    }
    if (!navigator.xr) {
      this.ctx.flashHint('WebXR not available — open in Meta Quest, Vision Pro, or a WebXR browser.');
      return;
    }
    try {
      let refType = 'local-floor';
      let session;
      try {
        session = await navigator.xr.requestSession('immersive-vr', {
          optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
        });
      } catch {
        session = await navigator.xr.requestSession('immersive-vr');
        refType = 'local';
      }
      // Verify whether local-floor is actually supported by this session; fall back to local + 1.7m standing height
      try {
        await session.requestReferenceSpace('local-floor');
        refType = 'local-floor';
        this.floorOffset = 0;
      } catch {
        refType = 'local';
        this.floorOffset = 1.7;
      }
      this.renderer.xr.setReferenceSpaceType(refType);
      await this.renderer.xr.setSession(session);
    } catch (err) {
      this.ctx.flashHint(`Could not start VR: ${err?.message || 'headset unavailable'}.`);
    }
  }

  onSessionStart() {
    this.active = true;
    this.savedCam = { pos: this.rig.camera.position.clone(), target: this.rig.controls.target.clone(), fov: this.rig.camera.fov };
    this.rig.controls.enabled = false;
    this.rig.scene.add(this.xrRig);
    this.xrRig.add(this.rig.camera);
    this.rig.camera.position.set(0, 0, 0);
    this.rig.camera.rotation.set(0, 0, 0);

    const startSpot = VANTAGES[this.rig.camId] ? this.rig.camId : 'audience';
    this.teleport(startSpot, false);
    this.consoleOpen = true;
    this.panelGroup.visible = true;
    this.reopenMesh.visible = false;
    for (const p of this.pointers) if (p.source) { p.ray.visible = true; p.wand.visible = p.source.targetRayMode !== 'transient-pointer'; }
    // Place console slightly ahead on first frame, then recenter once head pose arrives
    this.needsInitialPlace = true;
    this.dirty = true;
    const btn = document.getElementById('enterVrBtn');
    if (btn) { btn.textContent = 'Exit VR'; btn.classList.add('active'); }
  }

  onSessionEnd() {
    this.active = false;
    this.grab = null;
    for (const p of this.pointers) {
      this.releasePointer(p);
      if (p.airHold) { p.airHold.stop(); p.airHold = null; }
      p.ray.visible = p.wand.visible = p.dot.visible = false;
    }
    this.panelGroup.visible = false;
    this.reopenMesh.visible = false;
    this.rig.scene.add(this.rig.camera);
    this.rig.scene.remove(this.xrRig);
    this.rig.controls.enabled = true;
    if (this.savedCam) {
      this.rig.camera.position.copy(this.savedCam.pos);
      this.rig.controls.target.copy(this.savedCam.target);
      this.rig.camera.fov = this.savedCam.fov;
      this.rig.camera.updateProjectionMatrix();
    }
    this.rig.resize();
    const btn = document.getElementById('enterVrBtn');
    if (btn) { btn.textContent = 'VR'; btn.classList.remove('active'); }
  }

  headWorldPose() {
    const xrCam = this.renderer.xr.isPresenting ? this.renderer.xr.getCamera() : this.rig.camera;
    const pos = xrCam.getWorldPosition(this._v1).clone();
    const quat = xrCam.getWorldQuaternion(this._q1).clone();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-5) fwd.set(0, 0, -1); else fwd.normalize();
    return { pos, fwd };
  }

  /** Place the floating console comfortably in front of the viewer, angled like a lighting desk. */
  placeConsoleInFront() {
    const { pos, fwd } = this.headWorldPose();
    const target = pos.clone().addScaledVector(fwd, 1.02);
    target.y = Math.max((this.baseFloorY || 0) + 0.72, pos.y - 0.42);
    this.panelGroup.position.copy(target);
    this.orientPanelToHead(pos);
    this.placeReopenPill(pos, fwd);
  }

  orientPanelToHead(headPos) {
    const dx = headPos.x - this.panelGroup.position.x, dz = headPos.z - this.panelGroup.position.z;
    const yaw = Math.atan2(dx, dz);
    this.panelGroup.rotation.set(0, yaw, 0, 'YXZ');
    this.panelGroup.rotateX(-26 * DEG);
  }

  placeReopenPill(headPos, fwd) {
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    this.reopenMesh.position.copy(headPos).addScaledVector(fwd, 0.75).addScaledVector(right, -0.28);
    this.reopenMesh.position.y = Math.max((this.baseFloorY || 0) + 0.65, headPos.y - 0.45);
    this.reopenMesh.lookAt(headPos);
  }

  setConsoleOpen(open) {
    this.consoleOpen = open;
    this.panelGroup.visible = this.active && open;
    this.reopenMesh.visible = this.active && !open;
    if (open) this.placeConsoleInFront();
    else { const { pos, fwd } = this.headWorldPose(); this.placeReopenPill(pos, fwd); }
    this.dirty = true;
  }

  /** Teleport the VR rig to one of the named vantage spots in the current venue. */
  teleport(id, placePanel = true) {
    const spot = VANTAGES[id] || VANTAGES.audience;
    this.vantage = VANTAGES[id] ? id : 'audience';
    const [x, y, z] = spot.pos(this.ctx.venue.id);
    this.flyY = 0;
    this.baseFloorY = y;
    this.xrRig.position.set(x, y + this.floorOffset, z);
    this.xrRig.rotation.set(0, spot.yaw || 0, 0);
    if (placePanel && this.active) this.needsInitialPlace = true;
    this.dirty = true;
  }

  pulseHaptic(p, strength = 0.25, ms = 18) {
    try { p.source?.gamepad?.hapticActuators?.[0]?.pulse?.(strength, ms); } catch { /* optional */ }
  }

  // ——— raycasting & pointer events ———
  intersectPanel(ctrl) {
    this._mat4.identity().extractRotation(ctrl.matrixWorld);
    this.raycaster.ray.origin.setFromMatrixPosition(ctrl.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this._mat4);
    if (this.consoleOpen && this.panelGroup.visible) {
      const hit = this.raycaster.intersectObject(this.panelMesh, false)[0];
      if (hit && hit.distance < 4.5 && hit.uv) return { kind: 'panel', distance: hit.distance, uv: hit.uv, point: hit.point };
    } else if (!this.consoleOpen && this.reopenMesh.visible) {
      const hit = this.raycaster.intersectObject(this.reopenMesh, false)[0];
      if (hit && hit.distance < 4.5) return { kind: 'reopen', distance: hit.distance, point: hit.point };
    }
    return null;
  }

  uvToCanvas(uv) {
    return { x: uv.x * CW, y: (1 - uv.y) * CH };
  }

  hitAt(cx, cy) {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (cx >= h.x && cx <= h.x + h.w && cy >= h.y && cy <= h.y + h.h) return h;
    }
    return null;
  }

  onPointerDown(p) {
    if (!this.active) return;
    p.down = true;
    const hit = this.intersectPanel(p.ctrl);
    if (!hit) return;
    if (hit.kind === 'reopen') {
      this.pulseHaptic(p, 0.35, 25);
      this.setConsoleOpen(true);
      return;
    }
    const { x, y } = this.uvToCanvas(hit.uv);
    this.pointerDownAt(p, x, y, hit.distance);
  }

  pointerDownAt(p, x, y, dist = 1) {
    const region = this.hitAt(x, y);
    if (region) {
      this.pulseHaptic(p, 0.25, 16);
      if (region.grab && p.ctrl) {
        this.startGrab(p.ctrl, dist);
        return;
      }
      p.activeHit = region;
      region.onDown?.(x, y, p);
      this.dirty = true;
      return;
    }
    if (y >= BODY_TOP && !this.modal) {
      p.scrollDrag = { startY: y, startScroll: this.curScroll() };
    }
  }

  pointerMoveAt(p, x, y) {
    if (p.activeHit?.onMove) {
      p.activeHit.onMove(x, y, p);
      this.dirty = true;
    } else if (p.scrollDrag) {
      const tab = this.curTab();
      const maxS = Math.max(0, this.contentH - BODY_H);
      this.scroll[tab] = clamp(p.scrollDrag.startScroll + (p.scrollDrag.startY - y), 0, maxS);
      this.dirty = true;
    }
  }

  onPointerUp(p) {
    this.releasePointer(p);
  }

  releasePointer(p) {
    p.down = false;
    if (p.activeHit) {
      p.activeHit.onUp?.(p);
      p.activeHit = null;
      this.dirty = true;
    }
    if (p.note !== null) {
      this.ctx.midi.noteOff(p.note);
      p.note = null;
      this.dirty = true;
    }
    p.scrollDrag = null;
    if (this.grab?.ctrl === p.ctrl) this.grab = null;
  }

  startGrab(ctrl, dist) {
    const inv = this._mat4.copy(ctrl.matrixWorld).invert();
    const localPos = this.panelGroup.position.clone().applyMatrix4(inv);
    this.grab = { ctrl, localPos, dist };
  }

  onSqueezeDown(p) {
    if (!this.active) return;
    const hit = this.intersectPanel(p.ctrl);
    if (hit && hit.kind === 'panel') {
      this.pulseHaptic(p, 0.3, 22);
      this.startGrab(p.ctrl, hit.distance);
      return;
    }
    // Live performance squeeze in open air: right hand = Flash, left hand = Strobe
    const isLeft = p.source?.handedness === 'left';
    const hold = isLeft ? this.ctx.holds.strobe : this.ctx.holds.flash;
    if (hold) { hold.start(); p.airHold = hold; this.pulseHaptic(p, 0.4, 25); this.dirty = true; }
  }

  onSqueezeUp(p) {
    if (this.grab?.ctrl === p.ctrl) this.grab = null;
    if (p.airHold) { p.airHold.stop(); p.airHold = null; this.dirty = true; }
  }

  /** Test helper: simulate a tap on normalized canvas coordinates (cx, cy in pixels). */
  tapCanvas(cx, cy) {
    const fake = { idx: 0, note: null, activeHit: null, scrollDrag: null };
    this.pointerDownAt(fake, cx, cy, 1);
    this.releasePointer(fake);
    this.redraw();
  }

  /** Test helper: simulate a drag on canvas coordinates. */
  dragCanvas(x0, y0, x1, y1) {
    const fake = { idx: 0, note: null, activeHit: null, scrollDrag: null };
    this.pointerDownAt(fake, x0, y0, 1);
    this.pointerMoveAt(fake, x1, y1);
    this.releasePointer(fake);
    this.redraw();
  }

  // ——— per-frame update (locomotion, controller rays, throttled canvas draw) ———
  update(dt) {
    if (!this.active) return;
    if (this.needsInitialPlace) {
      this.needsInitialPlace = false;
      this.placeConsoleInFront();
    }
    if (this.grab) {
      const worldPos = this.grab.localPos.clone().applyMatrix4(this.grab.ctrl.matrixWorld);
      this.panelGroup.position.lerp(worldPos, Math.min(1, dt * 18));
      const { pos } = this.headWorldPose();
      this.orientPanelToHead(pos);
    }

    this.snapCooldown = Math.max(0, this.snapCooldown - dt);
    let hovering = false;

    for (const p of this.pointers) {
      if (!p.source) continue;
      const hit = this.intersectPanel(p.ctrl);
      if (hit) {
        hovering = true;
        p.ray.scale.z = hit.distance;
        p.ray.material.opacity = 0.85;
        if (hit.kind === 'panel') {
          p.dot.visible = true;
          p.dot.position.set((hit.uv.x - 0.5) * PANEL_W, (hit.uv.y - 0.5) * PANEL_H, 0.002);
          const { x, y } = this.uvToCanvas(hit.uv);
          p.uv = { x, y };
          if (p.down) this.pointerMoveAt(p, x, y);
        } else p.dot.visible = false;
      } else {
        p.ray.scale.z = 2.4;
        p.ray.material.opacity = 0.35;
        p.dot.visible = false;
        p.uv = null;
      }

      // Gamepad thumbsticks & face buttons
      const gp = p.source.gamepad;
      if (!gp) continue;
      const hand = p.source.handedness;
      const axX = gp.axes.length >= 4 ? gp.axes[2] : gp.axes[0] || 0;
      const axY = gp.axes.length >= 4 ? gp.axes[3] : gp.axes[1] || 0;

      if (hand === 'left') {
        if (Math.hypot(axX, axY) > 0.16) {
          const { fwd } = this.headWorldPose();
          const right = this._v2.set(-fwd.z, 0, fwd.x);
          const speed = 3.8 * dt;
          this.xrRig.position.addScaledVector(fwd, -axY * speed).addScaledVector(right, axX * speed);
          this.xrRig.position.x = clamp(this.xrRig.position.x, -65, 65);
          this.xrRig.position.z = clamp(this.xrRig.position.z, -20, 85);
          // Step smoothly onto the 1.2 m stage deck when walking onto the stage footprint
          const onStage = Math.abs(this.xrRig.position.x) < DECK_HALF && this.xrRig.position.z > DECK_BACK && this.xrRig.position.z < DECK_FRONT;
          if (this.baseFloorY <= DECK_Y + 0.05) this.baseFloorY = onStage ? DECK_Y : 0;
          this.xrRig.position.y = clamp(this.baseFloorY + this.floorOffset + this.flyY, 0, 26);
        }
      } else {
        if (Math.abs(axX) > 0.65 && this.snapCooldown <= 0) {
          this.xrRig.rotation.y -= Math.sign(axX) * (30 * DEG);
          this.snapCooldown = 0.28;
          this.pulseHaptic(p, 0.2, 12);
        }
        if (Math.abs(axY) > 0.22) {
          if (hit?.kind === 'panel') {
            const tab = this.curTab();
            this.scroll[tab] = clamp(this.scroll[tab] + axY * 720 * dt, 0, Math.max(0, this.contentH - BODY_H));
            this.dirty = true;
          } else {
            this.flyY = clamp(this.flyY - axY * 3.0 * dt, -this.baseFloorY, 22);
            this.xrRig.position.y = clamp(this.baseFloorY + this.floorOffset + this.flyY, 0, 26);
          }
        }
      }

      // Face buttons: [4] = A / X, [5] = B / Y
      const b4 = !!gp.buttons[4]?.pressed, b5 = !!gp.buttons[5]?.pressed;
      const k4 = `${p.idx}:4`, k5 = `${p.idx}:5`;
      if (b5 && !this.btnLatch.has(k5)) {
        this.btnLatch.add(k5);
        this.pulseHaptic(p, 0.3, 20);
        this.setConsoleOpen(!this.consoleOpen);
      } else if (!b5) this.btnLatch.delete(k5);

      if (b4 && !this.btnLatch.has(k4)) {
        this.btnLatch.add(k4);
        this.pulseHaptic(p, 0.3, 20);
        if (hand === 'left') this.ctx.tap();
        else this.nextScene();
        this.dirty = true;
      } else if (!b4) this.btnLatch.delete(k4);
    }

    this.drawT += dt;
    if (this.consoleOpen && (this.dirty || hovering || this.drawT >= 0.06)) {
      this.drawT = 0;
      this.dirty = false;
      this.redraw();
    }
  }

  nextScene() {
    const scenes = this.ctx.SCENES.filter((s) => s.id !== 'blackout');
    const cur = document.getElementById('sceneSelect')?.value;
    const i = scenes.findIndex((s) => s.id === cur);
    const next = scenes[(i + 1) % scenes.length];
    if (next) this.ctx.launchScene(next.id);
  }

  // ——— DOM bridge helpers ———
  el(id) { return document.getElementById(id); }
  val(id) { return this.el(id)?.value ?? ''; }
  checked(id) { return !!this.el(id)?.checked; }
  outText(id) {
    const n = this.el(id);
    if (!n) return '';
    const lab = document.querySelector(`label[for="${id}"]`);
    const o = lab?.querySelector('output') || n.closest('.fader')?.querySelector('output');
    return o ? o.textContent : n.value;
  }
  setVal(id, v) {
    const n = this.el(id);
    if (!n) return;
    if (n.type === 'checkbox') n.checked = !!v;
    else n.value = v;
    n.dispatchEvent(new Event('input', { bubbles: true }));
    n.dispatchEvent(new Event('change', { bubbles: true }));
    this.dirty = true;
  }
  clickEl(id) { this.el(id)?.click(); this.dirty = true; }
  curTab() { return document.querySelector('.tabs [role="tab"][aria-selected="true"]')?.dataset.tab || 'show'; }
  curScroll() { return this.scroll[this.curTab()] || 0; }
  selLabel(id) {
    const s = this.el(id);
    if (!s) return '';
    const o = s.selectedOptions?.[0] || s.options?.[s.selectedIndex];
    return o ? o.textContent.trim() : s.value;
  }

  // ——— 2D Canvas Spatial UI Renderer ———
  redraw() {
    const g = this.g;
    this.hits = [];
    g.clearRect(0, 0, CW, CH);

    // Outer glass panel
    roundRect(g, 2, 2, CW - 4, CH - 4, 26);
    g.fillStyle = 'rgba(11, 14, 21, 0.96)';
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    g.stroke();

    // 1. Header bar (grabbable)
    const E = this.engine;
    const beatPh = E.beat - Math.floor(E.beat);
    const beatAlpha = 0.25 + 0.75 * Math.max(0, 1 - beatPh * 3);
    g.fillStyle = `rgba(255, 176, 46, ${beatAlpha.toFixed(2)})`;
    g.beginPath(); g.arc(34, 34, 8, 0, Math.PI * 2); g.fill();

    g.fillStyle = '#e5e9f0'; g.font = '600 26px Inter, system-ui, sans-serif';
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('Light Designer', 54, 34);

    const hudShow = this.el('hudShow')?.textContent || '';
    const hudSec = this.el('hudSection')?.textContent || '';
    g.fillStyle = '#929cad'; g.font = '500 18px "JetBrains Mono", monospace';
    g.fillText(`${hudShow} ${hudSec} · ${Math.round(E.bpm)} BPM`.replace(/\s+/g, ' ').slice(0, 38), 252, 35);

    // Header action buttons + grab region
    this.hits.push({ x: 12, y: 6, w: 690, h: 54, grab: true });
    this.drawBtn(712, 12, 108, 42, 'Recenter', false, () => this.placeConsoleInFront());
    this.drawBtn(828, 12, 82, 42, 'Hide', false, () => this.setConsoleOpen(false));
    this.drawBtn(918, 12, 90, 42, 'Exit VR', false, () => this.toggleSession(), null, null, '#ff808c');

    // 2. VR Vantage teleport bar
    g.fillStyle = 'rgba(255, 255, 255, 0.03)';
    g.fillRect(16, 64, CW - 32, 44);
    g.fillStyle = '#646e80'; g.font = '500 15px "JetBrains Mono", monospace';
    g.textAlign = 'left'; g.fillText('STAND', 28, 86);
    const spots = Object.entries(VANTAGES);
    let sx = 102;
    const sw = Math.floor((CW - 122 - (spots.length - 1) * 8) / spots.length);
    for (const [id, sp] of spots) {
      this.drawBtn(sx, 69, sw, 34, sp.label, this.vantage === id, () => this.teleport(id, true));
      sx += sw + 8;
    }

    // 3. 5-Tab bar
    const tabs = [['show', 'Show'], ['rig', 'Rig'], ['venue', 'Room'], ['desk', 'Desk'], ['midi', 'MIDI']];
    const curTab = this.curTab();
    const tw = Math.floor((CW - 32) / tabs.length);
    tabs.forEach(([id, label], i) => {
      const x = 16 + i * tw, sel = curTab === id;
      g.fillStyle = sel ? 'rgba(255, 176, 46, 0.12)' : 'transparent';
      roundRect(g, x + 2, 114, tw - 4, 46, 10); g.fill();
      g.fillStyle = sel ? '#ffb02e' : '#929cad';
      g.font = '600 20px Inter, system-ui, sans-serif';
      g.textAlign = 'center'; g.fillText(label, x + tw * 0.5, 137);
      if (sel) { g.fillStyle = '#ffb02e'; g.fillRect(x + 18, 157, tw - 36, 3); }
      this.hits.push({ x, y: 114, w: tw, h: 48, onDown: () => { this.modal = null; this.ctx.selectTab(id); } });
    });
    g.fillStyle = 'rgba(255,255,255,0.09)';
    g.fillRect(16, 162, CW - 32, 1);

    // 4. Modal picker (for <select> or <input type=color>) OR scrollable tab body
    if (this.modal) {
      this.drawModal();
      this.tex.needsUpdate = true;
      return;
    }

    const scrollY = this.curScroll();
    const bodyHits = [];
    const prevHits = this.hits;
    this.hits = bodyHits;

    g.save();
    g.beginPath(); g.rect(14, BODY_TOP, CW - 40, BODY_H); g.clip();
    g.translate(0, BODY_TOP - scrollY);

    let y = 8;
    if (curTab === 'show') y = this.drawShowTab(y);
    else if (curTab === 'rig') y = this.drawRigTab(y);
    else if (curTab === 'venue') y = this.drawRoomTab(y);
    else if (curTab === 'desk') y = this.drawDeskTab(y);
    else if (curTab === 'midi') y = this.drawMidiTab(y);

    this.contentH = y + 16;
    g.restore();

    // Transform body hit-boxes into clipped canvas coordinates
    this.hits = prevHits;
    for (const h of bodyHits) {
      const cy = h.y + BODY_TOP - scrollY;
      const top = Math.max(BODY_TOP, cy), bot = Math.min(BODY_BOT, cy + h.h);
      if (bot - top >= 6) {
        this.hits.push({
          ...h, y: top, h: bot - top,
          onDown: h.onDown ? (px, py, ptr) => h.onDown(px, py - BODY_TOP + scrollY, ptr) : undefined,
          onMove: h.onMove ? (px, py, ptr) => h.onMove(px, py - BODY_TOP + scrollY, ptr) : undefined,
        });
      }
    }

    // Scrollbar if content overflows
    if (this.contentH > BODY_H + 4) {
      const maxS = this.contentH - BODY_H;
      if (scrollY > maxS) this.scroll[curTab] = maxS;
      const trackX = CW - 22, trackY = BODY_TOP + 6, trackH = BODY_H - 12;
      roundRect(g, trackX, trackY, 8, trackH, 4);
      g.fillStyle = 'rgba(255,255,255,0.07)'; g.fill();
      const thumbH = Math.max(44, (BODY_H / this.contentH) * trackH);
      const thumbY = trackY + (this.curScroll() / maxS) * (trackH - thumbH);
      roundRect(g, trackX, thumbY, 8, thumbH, 4);
      g.fillStyle = 'rgba(255,176,46,0.65)'; g.fill();
      const scrubScroll = (py) => {
        const t = clamp((py - trackY - thumbH * 0.5) / Math.max(1, trackH - thumbH), 0, 1);
        this.scroll[curTab] = t * maxS;
      };
      this.hits.push({ x: CW - 34, y: trackY, w: 28, h: trackH, onDown: (_, py) => scrubScroll(py), onMove: (_, py) => scrubScroll(py) });
    }

    this.tex.needsUpdate = true;
  }

  // ——— Widget Primitives ———
  sectionTitle(y, title, right = '') {
    const g = this.g;
    g.fillStyle = '#929cad'; g.font = '600 16px "JetBrains Mono", monospace';
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(title.toUpperCase(), 26, y + 14);
    if (right) {
      g.fillStyle = '#ffb02e'; g.font = '500 16px "JetBrains Mono", monospace';
      g.textAlign = 'right'; g.fillText(right, CW - 44, y + 14);
    }
    return y + 32;
  }

  drawBtn(x, y, w, h, label, active, onClick, onDown, onUp, tint = null) {
    const g = this.g;
    roundRect(g, x, y, w, h, 10);
    g.fillStyle = active ? (tint ? 'rgba(255,66,84,0.24)' : 'rgba(255,176,46,0.20)') : '#161b26';
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = active ? (tint || '#ffb02e') : 'rgba(255,255,255,0.15)';
    g.stroke();
    g.fillStyle = active ? (tint || '#ffb02e') : (tint || '#e5e9f0');
    g.font = '500 18px Inter, system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, x + w * 0.5, y + h * 0.5 + 1, w - 12);
    this.hits.push({
      x, y, w, h,
      onDown: () => { if (onDown) onDown(); else onClick?.(); },
      onUp: onUp ? () => onUp() : undefined,
    });
  }

  drawToggle(x, y, w, id, label) {
    const g = this.g, on = this.checked(id), h = 44;
    roundRect(g, x, y, w, h, 10);
    g.fillStyle = on ? 'rgba(255,176,46,0.08)' : 'rgba(255,255,255,0.025)';
    g.fill();
    g.strokeStyle = on ? 'rgba(255,176,46,0.38)' : 'rgba(255,255,255,0.09)';
    g.lineWidth = 1.2; g.stroke();
    g.fillStyle = '#dde3ee'; g.font = '500 18px Inter, system-ui, sans-serif';
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(label, x + 14, y + h * 0.5, w - 84);
    // Switch pill
    const sx = x + w - 62, sy = y + 9;
    roundRect(g, sx, sy, 48, 26, 13);
    g.fillStyle = on ? 'rgba(255,176,46,0.32)' : '#232936'; g.fill();
    g.strokeStyle = on ? '#ffb02e' : 'rgba(255,255,255,0.2)'; g.stroke();
    g.beginPath(); g.arc(on ? sx + 35 : sx + 13, sy + 13, 9, 0, Math.PI * 2);
    g.fillStyle = on ? '#ffb02e' : '#9aa4b5'; g.fill();
    this.hits.push({ x, y, w, h, onDown: () => this.setVal(id, !this.checked(id)) });
    return y + h + 8;
  }

  drawSlider(x, y, w, id, label, extraReset = null) {
    const el = this.el(id);
    if (!el) return y;
    const g = this.g, h = 54;
    const min = +el.min || 0, max = +el.max || 1, v = +el.value;
    const t = clamp((v - min) / (max - min || 1), 0, 1);
    g.fillStyle = '#c7ced9'; g.font = '500 17px Inter, system-ui, sans-serif';
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(label, x + 4, y + 13);
    g.fillStyle = '#8b95a7'; g.font = '500 16px "JetBrains Mono", monospace';
    g.textAlign = 'right';
    g.fillText(this.outText(id), x + w - (extraReset ? 48 : 4), y + 13);
    if (extraReset) {
      this.drawBtn(x + w - 40, y, 38, 24, '↺', true, extraReset);
    }
    const bx = x + 4, by = y + 30, bw = w - 8, bh = 16;
    roundRect(g, bx, by, bw, bh, 8);
    g.fillStyle = '#161b26'; g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1; g.stroke();
    if (t > 0.005) {
      roundRect(g, bx, by, Math.max(12, bw * t), bh, 8);
      g.fillStyle = id === 'pHue' ? `hsl(${v}, 95%, 55%)` : '#ffb02e';
      g.fill();
    }
    const setFromX = (px) => {
      const u = clamp((px - bx) / bw, 0, 1);
      const step = +el.step || 0.01;
      const raw = min + u * (max - min);
      this.setVal(id, Math.round(raw / step) * step);
    };
    this.hits.push({ x, y: y + 22, w, h: 32, onDown: (px) => setFromX(px), onMove: (px) => setFromX(px) });
    return y + h + 6;
  }

  drawSelect(x, y, w, id, label) {
    const g = this.g, h = 46;
    roundRect(g, x, y, w, h, 10);
    g.fillStyle = '#141923'; g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 1.2; g.stroke();
    g.fillStyle = '#8b95a7'; g.font = '500 15px Inter, system-ui, sans-serif';
    g.textAlign = 'left'; g.textBaseline = 'middle';
    const lw = label ? Math.min(150, g.measureText(label).width + 22) : 0;
    if (label) g.fillText(label, x + 14, y + h * 0.5);
    g.fillStyle = '#e5e9f0'; g.font = '500 17px Inter, system-ui, sans-serif';
    g.textAlign = label ? 'right' : 'left';
    const cur = this.selLabel(id) || 'Choose…';
    g.fillText(`${cur}  ▾`, label ? x + w - 14 : x + 14, y + h * 0.5, w - lw - 24);
    this.hits.push({ x, y, w, h, onDown: () => { this.modal = { kind: 'select', id, label: label || id, scroll: 0 }; } });
    return y + h + 8;
  }

  drawColorPick(x, y, w, id, label) {
    const g = this.g, h = 44, col = this.val(id) || '#ffffff';
    roundRect(g, x, y, w, h, 10);
    g.fillStyle = '#141923'; g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 1.2; g.stroke();
    g.fillStyle = '#c7ced9'; g.font = '500 17px Inter, system-ui, sans-serif';
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(label, x + 14, y + h * 0.5);
    roundRect(g, x + w - 66, y + 8, 52, 28, 7);
    g.fillStyle = col; g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 1.2; g.stroke();
    this.hits.push({ x, y, w, h, onDown: () => { this.modal = { kind: 'color', id, label }; } });
    return y + h + 8;
  }

  // ——— Modal Overlay for <select> and <input type=color> ———
  drawModal() {
    const g = this.g, m = this.modal;
    g.fillStyle = 'rgba(7, 9, 14, 0.96)';
    g.fillRect(16, BODY_TOP, CW - 32, BODY_H);
    g.fillStyle = '#ffb02e'; g.font = '600 20px Inter, system-ui, sans-serif';
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(m.label, 32, BODY_TOP + 28);
    this.drawBtn(CW - 134, BODY_TOP + 10, 102, 38, 'Done', false, () => { this.modal = null; });

    if (m.kind === 'color') {
      const cols = 6, pad = 12, x0 = 32, y0 = BODY_TOP + 68;
      const sw = Math.floor((CW - 64 - (cols - 1) * pad) / cols), sh = 68;
      SWATCHES.forEach((c, i) => {
        const col = i % cols, row = Math.floor(i / cols);
        const sx = x0 + col * (sw + pad), sy = y0 + row * (sh + pad);
        roundRect(g, sx, sy, sw, sh, 12);
        g.fillStyle = c; g.fill();
        if (this.val(m.id).toLowerCase() === c.toLowerCase()) {
          g.lineWidth = 4; g.strokeStyle = '#fff'; g.stroke();
        }
        this.hits.push({ x: sx, y: sy, w: sw, h: sh, onDown: () => { this.setVal(m.id, c); this.modal = null; } });
      });
      return;
    }

    const sel = this.el(m.id);
    const opts = sel ? [...sel.options].filter((o) => !o.hidden) : [];
    const listTop = BODY_TOP + 60, listH = BODY_H - 72, rowH = 52;
    const totalH = opts.length * (rowH + 6);
    const maxS = Math.max(0, totalH - listH);
    m.scroll = clamp(m.scroll || 0, 0, maxS);

    g.save();
    g.beginPath(); g.rect(24, listTop, CW - 68, listH); g.clip();
    opts.forEach((o, i) => {
      const ry = listTop + i * (rowH + 6) - m.scroll;
      if (ry + rowH < listTop || ry > listTop + listH) return;
      const active = sel.value === o.value;
      roundRect(g, 28, ry, CW - 84, rowH, 10);
      g.fillStyle = active ? 'rgba(255,176,46,0.2)' : '#151a24'; g.fill();
      g.strokeStyle = active ? '#ffb02e' : 'rgba(255,255,255,0.1)'; g.lineWidth = 1.2; g.stroke();
      g.fillStyle = active ? '#ffb02e' : '#e5e9f0';
      g.font = '500 18px Inter, system-ui, sans-serif';
      g.textAlign = 'left'; g.fillText(o.textContent.trim(), 46, ry + rowH * 0.5, CW - 120);
      const top = Math.max(listTop, ry), bot = Math.min(listTop + listH, ry + rowH);
      if (bot - top > 8) this.hits.push({ x: 28, y: top, w: CW - 84, h: bot - top, onDown: () => { this.setVal(m.id, o.value); this.modal = null; } });
    });
    g.restore();

    if (maxS > 0) {
      this.drawBtn(CW - 52, listTop, 36, 48, '▲', false, () => { m.scroll = clamp(m.scroll - 220, 0, maxS); });
      this.drawBtn(CW - 52, listTop + listH - 48, 36, 48, '▼', false, () => { m.scroll = clamp(m.scroll + 220, 0, maxS); });
    }
  }

  // ——— Tab 1: SHOW ———
  drawShowTab(y) {
    const g = this.g, L = 24, W = CW - 64;
    y = this.sectionTitle(y, 'Scenes', this.el('sceneStatus')?.textContent || '');

    // Category pills
    const catBtns = [...document.querySelectorAll('#sceneCats button')];
    let cx = L;
    for (const b of catBtns) {
      const label = b.textContent.trim(), act = b.classList.contains('active');
      const pw = Math.max(96, Math.round(label.length * 11 + 34));
      this.drawBtn(cx, y, pw, 36, label, act, () => b.click());
      cx += pw + 8;
    }
    y += 46;

    // 3-column Scene grid with live .webp thumbnails
    const cards = [...document.querySelectorAll('#sceneGrid .scene')].filter((b) => !b.hidden);
    const cols = 3, gap = 10, cw = Math.floor((W - gap * 2) / cols), ch = 84;
    cards.forEach((card, idx) => {
      const col = idx % cols, row = Math.floor(idx / cols);
      const sx = L + col * (cw + gap), sy = y + row * (ch + gap);
      const isLive = card.classList.contains('live');
      roundRect(g, sx, sy, cw, ch, 10);
      g.save(); g.clip();
      g.fillStyle = '#090c12'; g.fillRect(sx, sy, cw, ch);
      const img = card.querySelector('img');
      if (img && img.complete && img.naturalWidth > 0) g.drawImage(img, sx, sy, cw, ch);
      const grad = g.createLinearGradient(0, sy + ch * 0.4, 0, sy + ch);
      grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.88)');
      g.fillStyle = grad; g.fillRect(sx, sy, cw, ch);
      g.fillStyle = '#ffffff'; g.font = '500 15px Inter, system-ui, sans-serif';
      g.textAlign = 'left'; g.textBaseline = 'bottom';
      g.fillText(card.querySelector('span')?.textContent || '', sx + 10, sy + ch - 7, cw - 18);
      g.restore();
      roundRect(g, sx, sy, cw, ch, 10);
      g.lineWidth = isLive ? 3 : 1.2;
      g.strokeStyle = isLive ? '#ffb02e' : 'rgba(255,255,255,0.15)';
      g.stroke();
      this.hits.push({ x: sx, y: sy, w: cw, h: ch, onDown: () => card.click() });
    });
    y += Math.ceil(cards.length / cols) * (ch + gap) + 6;

    y = this.drawSlider(L, y, W, 'sceneFade', 'Move time');
    const autoOn = this.val('sceneAuto') !== 'off';
    if (autoOn) {
      const hw = Math.floor((W - 10) / 2);
      this.drawSelect(L, y, hw, 'sceneAuto', 'Auto');
      y = this.drawSelect(L + hw + 10, y, hw, 'sceneEvery', 'Every');
    } else {
      y = this.drawSelect(L, y, W, 'sceneAuto', 'Auto-cycle');
    }

    // Shows & Transport
    y = this.sectionTitle(y + 6, 'Shows');
    y = this.drawSelect(L, y, W, 'showSelect', '');
    const bw = Math.floor((W - 24) / 4);
    this.drawBtn(L, y, bw, 44, '◀ Prev', false, () => this.clickEl('prevSection'));
    this.drawBtn(L + bw + 8, y, bw, 44, this.el('playBtn')?.textContent || 'Pause', this.engine.playing, () => this.clickEl('playBtn'));
    this.drawBtn(L + (bw + 8) * 2, y, bw, 44, 'Next ▶', false, () => this.clickEl('nextSection'));
    this.drawBtn(L + (bw + 8) * 3, y, bw, 44, 'Restart', false, () => this.clickEl('restartShow'));
    y += 54;
    y = this.drawSlider(L, y, W, 'showPos', 'Timeline');

    // Clickable section pills when a timed show is loaded
    const secs = [...document.querySelectorAll('#sectionList li')];
    if (secs.length) {
      const scols = 3, sw = Math.floor((W - 16) / scols);
      secs.forEach((li, i) => {
        const sx = L + (i % scols) * (sw + 8), sy = y + Math.floor(i / scols) * 40;
        const label = li.querySelector('span')?.textContent || `Sec ${i + 1}`;
        this.drawBtn(sx, sy, sw, 34, `${i + 1}. ${label}`, li.classList.contains('now'), () => li.click());
      });
      y += Math.ceil(secs.length / scols) * 40 + 6;
    }
    const hw = Math.floor((W - 10) / 2);
    this.drawSelect(L, y, hw + 40, 'playMode', 'End');
    y = this.drawSlider(L + hw + 50, y - 4, hw - 50, 'fadeScale', 'X-fade');

    // Masters
    y = this.sectionTitle(y + 6, 'Masters');
    y = this.drawFaders(L, y, W, [['grandMaster', 'Grand'], ['podMaster', 'Pods'], ['floorMaster', 'Floor'], ['hazeLevel', 'Haze']]);
    const mw = Math.floor((W - 16) / 3);
    this.drawBtn(L, y, mw, 46, 'Flash', this.engine.m.flash > 0, null, () => this.ctx.holds.flash.start(), () => this.ctx.holds.flash.stop());
    this.drawBtn(L + mw + 8, y, mw, 46, 'Strobe', this.engine.m.strobeHold, null, () => this.ctx.holds.strobe.start(), () => this.ctx.holds.strobe.stop());
    this.drawBtn(L + (mw + 8) * 2, y, mw, 46, 'Blackout', this.checked('blackoutToggle'), () => this.setVal('blackoutToggle', !this.checked('blackoutToggle')), null, null, '#ff5c6c');
    y += 56;

    // Tempo & speed
    this.drawBtn(L, y, 56, 44, '−2', false, () => this.setVal('bpm', clamp(+this.val('bpm') - 2, 40, 220)));
    roundRect(g, L + 64, y, 130, 44, 10);
    g.fillStyle = '#141923'; g.fill();
    g.fillStyle = '#e5e9f0'; g.font = '600 18px "JetBrains Mono", monospace';
    g.textAlign = 'center'; g.fillText(`${Math.round(this.engine.bpm)} BPM`, L + 129, y + 23);
    this.drawBtn(L + 202, y, 56, 44, '+2', false, () => this.setVal('bpm', clamp(+this.val('bpm') + 2, 40, 220)));
    this.drawBtn(L + 266, y, 108, 44, 'Tap', false, () => this.ctx.tap());
    y = this.drawSlider(L + 388, y - 6, W - 388, 'speedMaster', 'FX speed');
    y = this.drawSlider(L, y, W, 'strobeRate', 'Strobe rate');
    return y;
  }

  drawFaders(x, y, w, items) {
    const g = this.g, gap = 12, fw = Math.floor((w - gap * (items.length - 1)) / items.length), fh = 164;
    items.forEach(([id, label], i) => {
      const el = this.el(id), min = +el.min || 0, max = +el.max || 1, v = +el.value;
      const t = clamp((v - min) / (max - min || 1), 0, 1);
      const fx = x + i * (fw + gap);
      roundRect(g, fx, y, fw, fh, 12);
      g.fillStyle = '#0b0e15'; g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.1)'; g.lineWidth = 1; g.stroke();
      const tx = fx + fw * 0.5 - 10, ty = y + 14, th = fh - 58;
      roundRect(g, tx, ty, 20, th, 10);
      g.fillStyle = '#1a202c'; g.fill();
      const fillH = Math.max(12, th * t);
      roundRect(g, tx, ty + th - fillH, 20, fillH, 10);
      g.fillStyle = '#ffb02e'; g.fill();
      g.fillStyle = '#929cad'; g.font = '500 15px Inter, system-ui, sans-serif';
      g.textAlign = 'center'; g.fillText(label, fx + fw * 0.5, y + fh - 26);
      g.fillStyle = '#646e80'; g.font = '500 14px "JetBrains Mono", monospace';
      g.fillText(this.outText(id), fx + fw * 0.5, y + fh - 10);
      const setFromY = (py) => {
        const u = clamp(1 - (py - ty) / th, 0, 1);
        this.setVal(id, Math.round((min + u * (max - min)) * 100) / 100);
      };
      this.hits.push({ x: fx, y, w: fw, h: fh, onDown: (_, py) => setFromY(py), onMove: (_, py) => setFromY(py) });
    });
    return y + fh + 12;
  }

  // ——— Tab 2: RIG ———
  drawRigTab(y) {
    const g = this.g, L = 24, W = CW - 64, hw = Math.floor((W - 10) / 2);
    y = this.sectionTitle(y, 'Stage kit');
    y = this.drawSelect(L, y, W, 'extrasKit', 'Load kit');

    // Live 6-row Kinetic sticks meter
    y = this.sectionTitle(y + 4, 'Kinetic sticks');
    roundRect(g, L, y, W, 92, 10);
    g.fillStyle = '#090c12'; g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.1)'; g.stroke();
    const pw = (W - 40) / POD_COUNT;
    for (let i = 0; i < POD_COUNT; i++) {
      const p = this.engine.pods[i];
      const cx = L + 20 + pw * (i + 0.5);
      const cy = y + 72 - clamp((p.h - 4) / 10, 0, 1) * 54;
      g.save(); g.translate(cx, cy); g.rotate(-p.r);
      g.fillStyle = '#ffb02e'; g.fillRect(-pw * 0.36, -3, pw * 0.72, 6);
      g.restore();
      g.fillStyle = '#646e80'; g.font = '500 13px "JetBrains Mono", monospace';
      g.textAlign = 'center'; g.fillText(`R${i + 1}`, cx, y + 80);
    }
    y += 102;
    y = this.drawToggle(L, y, W, 'kinOverride', 'Manual pod override');
    if (this.checked('kinOverride')) {
      this.drawSelect(L, y, hw, 'kinShape', 'Shape');
      y = this.drawSelect(L + hw + 10, y, hw, 'kinFlipMode', 'Flip');
      y = this.drawSlider(L, y, W, 'kinHeight', 'Trim height (m)');
      y = this.drawSlider(L, y, W, 'kinAmp', 'Amplitude (m)');
      y = this.drawSlider(L, y, W, 'kinRoll', 'Roll (rad)');
      y = this.drawSlider(L, y, W, 'kinPeriod', 'Period (beats)');
      y = this.drawSlider(L, y, W, 'kinFlip', 'Flip vertical');
      y = this.drawSlider(L, y, W, 'kinFlipWave', 'Flip wave');
    }
    this.drawSlider(L, y, hw, 'hoistSpeed', 'Hoist m/s');
    y = this.drawSlider(L + hw + 10, y, hw, 'motorSpeed', 'Motor s');

    // Stage devices with progressive disclosure
    y = this.sectionTitle(y + 6, 'Stage devices');
    y = this.drawToggle(L, y, W, 'laserOn', 'Lasers');
    if (this.checked('laserOn')) {
      this.drawSelect(L, y, hw, 'laserPattern', 'Look');
      y = this.drawSelect(L + hw + 10, y, hw, 'laserColor', 'Color');
      if (this.val('laserColor') === 'fixed') y = this.drawColorPick(L, y, W, 'laserFixed', 'Laser color');
      y = this.drawSlider(L, y, W, 'laserLevel', 'Laser level');
      this.drawSlider(L, y, hw, 'laserCount', 'Beams');
      y = this.drawSlider(L + hw + 10, y, hw, 'laserSpread', 'Spread');
      this.drawSlider(L, y, hw, 'laserSpeed', 'Scan');
      y = this.drawSlider(L + hw + 10, y, hw, 'laserHeight', 'Height');
      y = this.drawToggle(L, y, W, 'laserChop', 'Chop on the beat');
      y = this.drawToggle(L, y, W, 'laserNotes', 'Pulse with MIDI notes');
    }

    y = this.drawToggle(L, y, W, 'tubesOn', 'LED pixel tubes');
    if (this.checked('tubesOn')) {
      y = this.drawSelect(L, y, W, 'tubeLayout', 'Placement');
      this.drawSelect(L, y, hw, 'tubeLook', 'Look');
      y = this.drawSelect(L + hw + 10, y, hw, 'tubeColor', 'Color');
      if (this.val('tubeColor') === 'fixed') y = this.drawColorPick(L, y, W, 'tubeFixed', 'Tube color');
      this.drawSlider(L, y, hw, 'tubeLevel', 'Level');
      y = this.drawSlider(L + hw + 10, y, hw, 'tubeSpeed', 'Speed');
    }

    y = this.drawSelect(L, y, W, 'ballCount', 'Mirror balls');
    if (this.val('ballCount') !== '0') {
      y = this.drawSelect(L, y, W, 'ballColor', 'Pin-spot color');
      if (this.val('ballColor') === 'fixed') y = this.drawColorPick(L, y, W, 'ballFixed', 'Pin-spot color');
      y = this.drawSlider(L, y, W, 'ballLevel', 'Ball level');
      this.drawSlider(L, y, hw, 'ballSpin', 'Spin');
      y = this.drawSlider(L + hw + 10, y, hw, 'ballRays', 'Rays');
      this.drawBtn(L, y, hw, 42, 'Fly out', false, () => this.clickEl('ballRaise'));
      this.drawBtn(L + hw + 10, y, hw, 42, 'Drop the ball', false, () => this.clickEl('ballDrop'));
      y += 50;
    }

    y = this.drawToggle(L, y, W, 'liquidOn', 'Liquid light show');
    if (this.checked('liquidOn')) {
      y = this.drawSelect(L, y, W, 'liquidPalette', 'Dyes');
      this.drawSlider(L, y, hw, 'liquidLevel', 'Level');
      y = this.drawSlider(L + hw + 10, y, hw, 'liquidSpeed', 'Flow');
      y = this.drawToggle(L, y, W, 'liquidPulse', 'Pulse on the beat');
    }

    // Blinders, strobes & CO₂ quick hits + toggles
    const tw = Math.floor((W - 16) / 3);
    this.drawBtn(L, y, tw, 44, 'Blinder hit', false, () => this.clickEl('blinderHit'));
    this.drawBtn(L + tw + 8, y, tw, 44, 'Strobe burst', false, () => this.clickEl('strobeBurst'));
    this.drawBtn(L + (tw + 8) * 2, y, tw, 44, 'CO₂ blast', false, () => this.clickEl('co2Blast'));
    y += 52;
    y = this.drawToggle(L, y, W, 'blindersOn', 'Audience blinders');
    if (this.checked('blindersOn')) {
      this.drawSelect(L, y, hw, 'blinderMode', 'Trigger');
      y = this.drawSlider(L + hw + 10, y - 4, hw, 'blinderLevel', 'Level');
    }
    y = this.drawToggle(L, y, W, 'strobesOn', 'Strobe bars');
    if (this.checked('strobesOn')) {
      y = this.drawSelect(L, y, W, 'strobeMode', 'Trigger');
      this.drawSlider(L, y, hw, 'strobeRateX', 'Rate');
      y = this.drawSlider(L + hw + 10, y, hw, 'strobeLevelX', 'Level');
    }
    y = this.drawToggle(L, y, W, 'co2On', 'CO₂ cryo jets');
    if (this.checked('co2On')) {
      y = this.drawSelect(L, y, W, 'co2Mode', 'Auto-blast');
      y = this.drawToggle(L, y, W, 'crashFires', 'MIDI crash fires hits & CO₂');
    }
    return y;
  }

  // ——— Tab 3: ROOM ———
  drawRoomTab(y) {
    const L = 24, W = CW - 64, hw = Math.floor((W - 10) / 2);
    y = this.sectionTitle(y, 'Venue');
    y = this.drawSelect(L, y, W, 'venueSelect', 'Room');
    if (this.val('venueSelect') === 'theater') {
      y = this.drawToggle(L, y, W, 'curtainClosed', 'Close theater house curtain');
    }

    y = this.sectionTitle(y + 4, 'House lights');
    const tw = Math.floor((W - 16) / 3);
    this.drawBtn(L, y, tw, 42, 'Showtime', false, () => this.clickEl('houseOut'));
    this.drawBtn(L + tw + 8, y, tw, 42, 'Walk-in', false, () => this.clickEl('houseHalf'));
    this.drawBtn(L + (tw + 8) * 2, y, tw, 42, 'House up', false, () => this.clickEl('houseUp'));
    y += 50;
    y = this.drawSlider(L, y, W, 'houseLevel', 'House level');
    this.drawSlider(L, y, hw, 'houseFade', 'Fade (s)');
    y = this.drawSelect(L + hw + 10, y + 4, hw, 'houseColor', 'Color');
    if (this.val('houseColor') === 'tungsten') y = this.drawSlider(L, y, W, 'houseWarmth', 'Warmth');
    if (this.val('houseColor') === 'color') y = this.drawColorPick(L, y, W, 'houseFixed', 'House color');
    this.drawSelect(L, y, hw, 'houseEffect', 'Effect');
    y = this.drawSlider(L + hw + 10, y - 4, hw, 'houseSpeed', 'Speed');

    y = this.sectionTitle(y + 4, 'Fairy lights');
    y = this.drawToggle(L, y, W, 'fairyOn', 'Fairy lights');
    if (this.checked('fairyOn')) {
      y = this.drawSelect(L, y, W, 'fairyLayout', 'Hang');
      this.drawSelect(L, y, hw, 'fairyColor', 'Bulbs');
      y = this.drawSelect(L + hw + 10, y, hw, 'fairyEffect', 'Effect');
      if (this.val('fairyColor') === 'fixed') y = this.drawColorPick(L, y, W, 'fairyFixed', 'Bulb color');
      this.drawSlider(L, y, hw, 'fairyLevel', 'Level');
      y = this.drawSlider(L + hw + 10, y, hw, 'fairySpeed', 'Speed');
      this.drawSlider(L, y, hw, 'fairyDensity', 'Density');
      y = this.drawSlider(L + hw + 10, y, hw, 'fairySag', 'Sag');
      this.drawSlider(L, y, hw, 'fairySway', 'Breeze');
      y = this.drawSlider(L + hw + 10, y, hw, 'fairySize', 'Size');
    }

    y = this.sectionTitle(y + 4, 'Render & atmosphere');
    y = this.drawSlider(L, y, W, 'bloomLevel', 'Glow / bloom');
    y = this.drawSlider(L, y, W, 'hazeTexture', 'Haze texture');
    y = this.drawToggle(L, y, W, 'stageToggle', 'Stage & floor');
    y = this.drawToggle(L, y, W, 'strobeRandom', 'Random strobe phase');
    y = this.drawSelect(L, y, W, 'quality', 'Render quality');
    return y;
  }

  // ——— Tab 4: DESK (Programmer + Live FX + Cues) ———
  drawDeskTab(y) {
    const g = this.g, L = 24, W = CW - 64, hw = Math.floor((W - 10) / 2);
    y = this.sectionTitle(y, 'Fixtures & programmer', `${this.engine.selection.size} selected`);

    // Group chips
    const chips = [...document.querySelectorAll('#groupChips button')];
    const cols = 5, cw = Math.floor((W - (cols - 1) * 8) / cols);
    chips.forEach((b, i) => {
      const sx = L + (i % cols) * (cw + 8), sy = y + Math.floor(i / cols) * 40;
      this.drawBtn(sx, sy, cw, 34, b.textContent.trim(), b.classList.contains('active'), () => this.ctx.selectGroup(b.dataset.g, this.multiSelect));
    });
    y += Math.ceil(chips.length / cols) * 40 + 6;

    // Multi-select + Highlight toggles
    this.drawBtn(L, y, hw, 40, this.multiSelect ? 'Multi-select: ON' : 'Multi-select: OFF', this.multiSelect, () => { this.multiSelect = !this.multiSelect; });
    y = this.drawToggle(L + hw + 10, y - 2, hw, 'highlightToggle', 'Highlight');

    // Interactive 72-fixture plot
    const mapH = 264;
    roundRect(g, L, y, W, mapH, 12);
    g.fillStyle = '#07090e'; g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.1)'; g.stroke();
    const toggleFix = (idx) => {
      if (this.multiSelect) this.engine.selection.has(idx) ? this.engine.selection.delete(idx) : this.engine.selection.add(idx);
      else { this.engine.selection.clear(); this.engine.selection.add(idx); }
      this.ctx.selectionChanged();
    };
    // Row 0 at top: 12 floor units; Rows 1..6 below: POD 6 → POD 1
    const drawDot = (cx, cy, r, idx) => {
      const o = this.engine.out[idx], k = 0.25 + 0.75 * Math.min(1, o.dim);
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fillStyle = o.dim > 0.01 ? `rgb(${o.r * 255 * k | 0},${o.g * 255 * k | 0},${o.b * 255 * k | 0})` : '#1d222d';
      g.fill();
      if (this.engine.selection.has(idx)) { g.lineWidth = 3; g.strokeStyle = '#ffffff'; g.stroke(); }
      else if (this.engine.prog.has(idx)) { g.lineWidth = 2; g.strokeStyle = '#ffb02e'; g.stroke(); }
      this.hits.push({ x: cx - r - 4, y: cy - r - 4, w: (r + 4) * 2, h: (r + 4) * 2, onDown: () => toggleFix(idx) });
    };
    g.fillStyle = '#646e80'; g.font = '500 13px "JetBrains Mono", monospace'; g.textAlign = 'left';
    g.fillText('FLOOR', L + 14, y + 26);
    const fBase = POD_COUNT * PER_POD;
    for (let s = 0; s < FLOOR_COUNT; s++) drawDot(L + 104 + s * ((W - 126) / (FLOOR_COUNT - 1)), y + 26, 13, fBase + s);
    for (let r = 0; r < POD_COUNT; r++) {
      const p = POD_COUNT - 1 - r, ry = y + 62 + r * 35;
      g.fillStyle = '#646e80'; g.textAlign = 'left'; g.fillText(`ROW ${p + 1}`, L + 14, ry);
      for (let s = 0; s < PER_POD; s++) drawDot(L + 132 + s * ((W - 180) / (PER_POD - 1)), ry, 13, p * PER_POD + s);
    }
    y += mapH + 10;

    // 20 Swatches
    const swBtns = [...document.querySelectorAll('#swatches button')];
    const scols = 10, swW = Math.floor((W - (scols - 1) * 6) / scols);
    swBtns.forEach((b, i) => {
      const sx = L + (i % scols) * (swW + 6), sy = y + Math.floor(i / scols) * 40;
      roundRect(g, sx, sy, swW, 34, 7);
      g.fillStyle = b.style.background; g.fill();
      this.hits.push({ x: sx, y: sy, w: swW, h: 34, onDown: () => b.click() });
    });
    y += Math.ceil(swBtns.length / scols) * 40 + 8;

    const rel = (attrs) => (this.engine.progAttrActive(attrs[0]) ? () => { this.engine.progRelease(attrs); this.ctx.markActive(); } : null);
    y = this.drawSlider(L, y, W, 'pDim', 'Intensity', rel(['dim']));
    y = this.drawSelect(L, y, W, 'pAim', 'Aim preset');
    this.drawSlider(L, y, hw, 'pHue', 'Hue', rel(['hue', 'sat']));
    y = this.drawSlider(L + hw + 10, y, hw, 'pSat', 'Sat', rel(['hue', 'sat']));
    this.drawSlider(L, y, hw, 'pPan', 'Pan', rel(['pan', 'tilt', 'aim']));
    y = this.drawSlider(L + hw + 10, y, hw, 'pTilt', 'Tilt', rel(['pan', 'tilt', 'aim']));
    this.drawSlider(L, y, hw, 'pZoom', 'Zoom', rel(['zoom']));
    y = this.drawSlider(L + hw + 10, y, hw, 'pFrost', 'Frost', rel(['frost']));
    y = this.drawSlider(L, y, W, 'pStrobe', 'Shutter strobe', rel(['strobe']));
    this.drawBtn(L, y, hw, 42, 'Release selected', false, () => this.clickEl('pRelease'));
    this.drawBtn(L + hw + 10, y, hw, 42, 'Clear all', false, () => this.clickEl('pClear'));
    y += 52;

    // Live Effects
    y = this.sectionTitle(y, 'Live effects');
    this.drawSelect(L, y, W - 116, 'fxPreset', 'Preset');
    this.drawBtn(L + W - 106, y, 106, 46, 'Add', false, () => this.clickEl('fxAdd'));
    y += 54;
    const fxRows = [...document.querySelectorAll('#fxList li')];
    for (const li of fxRows) {
      const sel = li.classList.contains('sel'), off = li.classList.contains('off');
      roundRect(g, L, y, W, 44, 9);
      g.fillStyle = sel ? 'rgba(255,176,46,0.16)' : '#121620'; g.fill();
      g.strokeStyle = sel ? '#ffb02e' : 'rgba(255,255,255,0.1)'; g.stroke();
      this.drawBtn(L + 6, y + 6, 42, 32, off ? 'Off' : 'On', !off, () => li.querySelector('input')?.click());
      g.fillStyle = off ? '#646e80' : '#e5e9f0'; g.font = '500 17px Inter, system-ui, sans-serif';
      g.textAlign = 'left'; g.fillText(li.querySelector('span')?.textContent || '', L + 60, y + 23, W - 130);
      this.hits.push({ x: L + 54, y, w: W - 114, h: 44, onDown: () => li.click() });
      this.drawBtn(L + W - 50, y + 6, 44, 32, '✕', false, () => li.querySelector('button')?.click());
      y += 50;
    }
    if (!this.el('fxEditor')?.hidden) {
      this.drawSelect(L, y, hw, 'fxGroup', 'Group');
      y = this.drawSelect(L + hw + 10, y, hw, 'fxAttr', 'Attr');
      this.drawSelect(L, y, hw, 'fxWave', 'Wave');
      y = this.drawSelect(L + hw + 10, y, hw, 'fxBy', 'Order');
      this.drawSlider(L, y, hw, 'fxRate', 'Rate');
      y = this.drawSlider(L + hw + 10, y, hw, 'fxSize', 'Size');
      this.drawSlider(L, y, hw, 'fxSpread', 'Spread');
      y = this.drawSlider(L + hw + 10, y, hw, 'fxDuty', 'Duty');
      this.drawToggle(L, y, hw, 'fxWings', 'Wings');
      y = this.drawToggle(L + hw + 10, y, hw, 'fxReverse', 'Reverse');
    }
    if (fxRows.length) { this.drawBtn(L, y, W, 40, 'Clear all effects', false, () => this.clickEl('fxClear')); y += 48; }

    // Cue List
    y = this.sectionTitle(y + 4, 'Cue list');
    const tw = Math.floor((W - 16) / 3);
    this.drawBtn(L, y, tw, 44, '● Record', false, () => this.clickEl('cueRecord'));
    this.drawBtn(L + tw + 8, y, tw, 44, 'GO', true, () => this.clickEl('cueGo'));
    this.drawBtn(L + (tw + 8) * 2, y, tw, 44, 'Back', false, () => this.clickEl('cueBack'));
    y += 52;
    for (const li of document.querySelectorAll('#cueList li')) {
      const live = li.classList.contains('live');
      roundRect(g, L, y, W, 42, 9);
      g.fillStyle = live ? 'rgba(61,255,138,0.14)' : '#121620'; g.fill();
      g.strokeStyle = live ? '#3dff8a' : 'rgba(255,255,255,0.1)'; g.stroke();
      g.fillStyle = '#e5e9f0'; g.font = '500 17px Inter, system-ui, sans-serif';
      g.textAlign = 'left'; g.fillText(li.querySelector('span')?.textContent || '', L + 14, y + 22, W - 160);
      this.hits.push({ x: L, y, w: W - 56, h: 42, onDown: () => li.click() });
      this.drawBtn(L + W - 48, y + 5, 42, 32, '✕', false, () => li.querySelector('button')?.click());
      y += 48;
    }
    this.drawSlider(L, y, hw, 'cueFade', 'Fade (s)');
    y = this.drawSlider(L + hw + 10, y, hw, 'cueHold', 'Hold (s)');
    y = this.drawToggle(L, y, W, 'cueRun', 'Auto-run cue list');
    return y;
  }

  // ——— Tab 5: MIDI & AUDIO ———
  drawMidiTab(y) {
    const g = this.g, L = 24, W = CW - 64, hw = Math.floor((W - 10) / 2);
    y = this.sectionTitle(y, 'MIDI play', this.val('midiNow'));
    y = this.drawToggle(L, y, W, 'midiMode', 'Notes fire lights');
    this.drawBtn(L, y, hw, 46, 'Connect MIDI', false, () => this.clickEl('midiConnect'));
    y = this.drawSelect(L + hw + 10, y, hw, 'midiInput', '');
    this.drawSelect(L, y, hw, 'midiMapping', 'Map');
    y = this.drawSelect(L + hw + 10, y, hw, 'midiColor', 'Color');
    if (this.val('midiColor') === 'fixed') y = this.drawColorPick(L, y, W, 'midiFixed', 'Note color');
    y = this.drawSelect(L, y, W, 'midiBase', 'Under the notes');
    y = this.drawToggle(L, y, W, 'midiDrums', 'Ch 10 plays drum map');

    // Groove + Playable 2-octave Piano
    y = this.sectionTitle(y + 4, 'Playable VR keyboard & groove');
    const tw = Math.floor((W - 16) / 3);
    this.drawBtn(L, y, tw, 44, this.el('midiDemo')?.textContent || 'Test groove', this.el('midiDemo')?.classList.contains('active'), () => this.clickEl('midiDemo'));
    this.drawBtn(L + tw + 8, y, tw, 44, 'Sweep', false, () => this.clickEl('midiSweep'));
    this.drawBtn(L + (tw + 8) * 2, y, tw, 44, 'Notes off', false, () => this.clickEl('midiPanic'));
    y += 52;

    this.drawBtn(L, y, 64, 38, 'Oct −', false, () => this.clickEl('pianoDown'));
    g.fillStyle = '#ffb02e'; g.font = '600 18px "JetBrains Mono", monospace';
    g.textAlign = 'center'; g.fillText(this.el('pianoOct')?.textContent || 'C4', L + 114, y + 20);
    this.drawBtn(L + 164, y, 64, 38, 'Oct +', false, () => this.clickEl('pianoUp'));
    y = this.drawToggle(L + 244, y - 3, W - 244, 'midiSound', 'Synth sound');

    y = this.drawPiano(L, y, W, 176);

    y = this.sectionTitle(y + 4, 'Response & microphone');
    this.drawSlider(L, y, hw, 'midiSustain', 'Sustain');
    y = this.drawSlider(L + hw + 10, y, hw, 'midiRelease', 'Release');
    this.drawSlider(L, y, hw, 'midiWidth', 'Width');
    y = this.drawSlider(L + hw + 10, y, hw, 'midiKick', 'Tilt kick');
    this.drawSlider(L, y, hw, 'midiLift', 'Pod dip');
    y = this.drawSlider(L + hw + 10, y, hw, 'midiVolume', 'Synth vol');

    y = this.drawToggle(L, y, W, 'micToggle', 'Listen with microphone');
    y = this.drawToggle(L, y, W, 'micTempo', 'Follow detected tempo');
    y = this.drawSlider(L, y, W, 'micPulse', 'Pulse intensity');
    return y;
  }

  drawPiano(x, y, w, h) {
    const g = this.g;
    const keys = [...document.querySelectorAll('#pianoKeys button')];
    const whites = keys.filter((k) => k.classList.contains('white'));
    const held = new Set(this.ctx.midi.layer.held());
    const ww = w / Math.max(1, whites.length);
    const whiteX = new Map();

    const playAt = (note, ky, kh, ptr) => {
      if (ptr.note === note) return;
      if (ptr.note !== null) this.ctx.midi.noteOff(ptr.note);
      const vel = Math.round(55 + 72 * clamp((ky - y) / kh, 0, 1));
      ptr.note = note;
      this.ctx.midi.noteOn(note, vel);
      this.pulseHaptic(ptr, 0.3, 14);
    };

    // White keys (registered first; black keys registered after so they win hit-test overlap)
    whites.forEach((b, i) => {
      const note = +b.dataset.note, kx = x + i * ww, down = held.has(note) || b.classList.contains('down');
      whiteX.set(note, kx);
      roundRect(g, kx + 1, y, ww - 2, h, 7);
      g.fillStyle = down ? '#ffb02e' : '#dde2ea'; g.fill();
      g.strokeStyle = '#090c12'; g.lineWidth = 1.5; g.stroke();
      if (b.textContent) {
        g.fillStyle = '#2b313d'; g.font = '600 13px "JetBrains Mono", monospace';
        g.textAlign = 'center'; g.fillText(b.textContent, kx + ww * 0.5, y + h - 14);
      }
      this.hits.push({ x: kx, y, w: ww, h, onDown: (_, py, ptr) => playAt(note, py, h, ptr), onMove: (_, py, ptr) => playAt(note, py, h, ptr) });
    });

    const bw = ww * 0.62, bh = h * 0.6;
    for (const b of keys) {
      if (!b.classList.contains('black')) continue;
      const note = +b.dataset.note, prevX = whiteX.get(note - 1);
      if (prevX === undefined) continue;
      const kx = prevX + ww - bw * 0.5, down = held.has(note) || b.classList.contains('down');
      roundRect(g, kx, y, bw, bh, 5);
      g.fillStyle = down ? '#ffb02e' : '#14171f'; g.fill();
      g.strokeStyle = '#000'; g.lineWidth = 1.5; g.stroke();
      this.hits.push({ x: kx, y, w: bw, h: bh, onDown: (_, py, ptr) => playAt(note, py, bh, ptr), onMove: (_, py, ptr) => playAt(note, py, bh, ptr) });
    }
    return y + h + 10;
  }
}
