// The loop drawn as a ring: one pass of the loop is one turn, starting at the
// top and running clockwise. The waveform sits in the middle band, bar lines
// and beats inside it, chord names inside those. The outer band is the solo:
// the current pass of it, written in as the playhead sweeps, and read back on
// replay.

const TAU = Math.PI * 2;

export class Ring {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.colors = {};
    this.size = 0;
    this.readColors();
  }

  readColors() {
    const css = getComputedStyle(this.canvas);
    for (const k of ['paper', 'ink', 'ink-dim', 'line', 'line-strong', 'accent', 'rec', 'count', 'surface'])
      this.colors[k] = css.getPropertyValue('--' + k).trim();
    this.serif = css.getPropertyValue('--serif').trim() || 'Georgia, serif';
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const s = this.canvas.clientWidth;
    if (!s) return;
    this.size = s;
    this.canvas.width = Math.round(s * dpr);
    this.canvas.height = Math.round(s * dpr);
    this.dpr = dpr;
  }

  draw(v) {
    const { ctx, colors: C } = this;
    if (!this.size) this.resize();
    const S = this.size;
    if (!S) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, S, S);
    // from the outside in: chord names, the solo band, the loop, beat dots
    const c = S / 2, R = S / 2 - 4, bars = v.bars || 0, bpb = v.beatsPerBar || 4;
    const fs = Math.max(12, Math.min(24, (S / 23) * (bars > 8 ? 0.8 : 1)));
    const labelR = R - fs * 0.75, soloOut = R - fs * 1.7, soloIn = soloOut - R * 0.09;
    const waveOut = soloIn - R * 0.035, waveIn = waveOut - R * 0.26;
    const mid = (waveIn + waveOut) / 2, half = (waveOut - waveIn) / 2;
    this.inner = waveIn - 12;
    const ang = (p) => -Math.PI / 2 + p * TAU;
    const ray = (p, r0, r1) => {
      const a = ang(p), x = Math.cos(a), y = Math.sin(a);
      ctx.moveTo(c + x * r0, c + y * r0);
      ctx.lineTo(c + x * r1, c + y * r1);
    };

    // tracks; the solo band's track swells with the input level
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(c, c, mid, 0, TAU); ctx.stroke();
    const lvl = Math.min(1, v.level || 0);
    ctx.lineWidth = 1 + lvl * (soloOut - soloIn) * 0.9;
    if (lvl > 0.01) { ctx.strokeStyle = v.mode === 'rec' || v.soloKind === 'rec' ? C.rec : C.accent; ctx.globalAlpha = 0.25 + lvl * 0.4; }
    ctx.beginPath(); ctx.arc(c, c, (soloIn + soloOut) / 2, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;

    // bars and beats
    if (bars) {
      ctx.strokeStyle = C['line-strong'];
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      for (let b = 0; b < bars; b++) ray(b / bars, waveIn - 6, soloOut);
      ctx.stroke();
      const beats = bars * bpb, dot = Math.max(1.5, S / 260);
      for (let k = 0; k < beats; k++) {
        const a = ang(k / beats), r = waveIn - 10;
        const lit = v.countBeat !== undefined && v.countBeat === k % bpb && v.mode === 'count';
        ctx.fillStyle = lit ? C.count : k % bpb === 0 ? C.ink : C['ink-dim'];
        ctx.globalAlpha = lit ? 1 : k % bpb === 0 ? 0.6 : 0.35;
        ctx.beginPath(); ctx.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, lit ? dot * 2.2 : dot, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // the loop, and the solo
    const wave = (peaks, upto, color, alpha, r0, h, outward) => {
      const n = peaks.length, lw = Math.max(1, ((TAU * (r0 + h / 2)) / n) * 0.62);
      ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.globalAlpha = alpha;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        if (i / n >= upto) break;
        const p = Math.min(1, peaks[i]) ** 0.7 * h;
        if (outward) ray((i + 0.5) / n, r0, r0 + Math.max(0.6, p));
        else ray((i + 0.5) / n, r0 - Math.max(0.3, p), r0 + Math.max(0.3, p));
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    };
    if (v.loopPeaks) wave(v.loopPeaks, 1, C.accent, v.mode === 'idle' ? 0.5 : 0.9, mid, half, false);
    if (v.livePeaks) wave(v.livePeaks, v.liveProgress ?? 1, C.rec, 0.95, mid, half, false);
    if (v.soloPeaks) {
      const color = v.soloKind === 'rec' ? C.rec : C.accent;
      if (v.soloKind !== 'rec') wave(v.soloPeaks, 1, color, 0.25, soloIn, soloOut - soloIn, true);
      wave(v.soloPeaks, v.phase ?? 1, color, 0.95, soloIn, soloOut - soloIn, true);
    }

    // chord names round the rim, at the middle of where each one sounds
    if (v.chart && bars) {
      ctx.font = `600 ${fs}px ${this.serif}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      let prev = null;
      v.chart.forEach((names, b) => {
        names.forEach((name, i) => {
          if (!name || name === prev) return;
          prev = name;
          const p = (b + (i + 0.5) / names.length) / bars;
          const a = ang(p);
          const now = v.phase !== null && v.phase !== undefined && Math.floor(v.phase * bars) === b
            && Math.floor((v.phase * bars - b) * names.length) === i;
          ctx.fillStyle = now ? C.ink : C['ink-dim'];
          ctx.fillText(name, c + Math.cos(a) * labelR, c + Math.sin(a) * labelR);
        });
      });
    }

    // playhead
    if (v.phase !== null && v.phase !== undefined) {
      const color = v.mode === 'rec' || v.soloKind === 'rec' ? C.rec : C.ink;
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ray(v.phase, waveIn - 6, soloOut + 3); ctx.stroke();
      const a = ang(v.phase);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(c + Math.cos(a) * (soloOut + 3), c + Math.sin(a) * (soloOut + 3), 3.5, 0, TAU); ctx.fill();
    }
  }
}
