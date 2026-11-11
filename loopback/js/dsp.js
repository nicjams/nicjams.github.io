// Signal helpers shared by the app and the tests. Nothing here touches the Web
// Audio API, so all of it runs under `node --test`.

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const mod = (a, n) => ((a % n) + n) % n;

// ---- loops ------------------------------------------------------------------

/** Cut `len` samples starting at `start` out of a recording so the loop wraps
 *  without a click: the last `fade` samples crossfade into the audio recorded
 *  just before `start`, so the sample after the loop's end is the one that
 *  really did come before its start. The downbeat itself stays untouched. */
export function seamlessLoop(rec, start, len, fade) {
  const out = new Float32Array(len);
  out.set(rec.subarray(start, Math.min(rec.length, start + len)));
  const f = Math.min(fade, start, len >> 1);
  for (let i = 0; i < f; i++) {
    const w = ((i + 1) / f) * (Math.PI / 2);
    const j = len - f + i;
    out[j] = out[j] * Math.cos(w) + rec[start - f + i] * Math.sin(w);
  }
  return out;
}

/** Largest absolute sample in each of `bins` equal slices of data[from, to). */
export function peaks(data, bins, from = 0, to = data.length) {
  const out = new Float32Array(bins);
  const span = (to - from) / bins;
  for (let b = 0; b < bins; b++) {
    let m = 0;
    const a = Math.floor(from + b * span), z = Math.min(to, Math.floor(from + (b + 1) * span));
    for (let i = a; i < z; i++) { const v = Math.abs(data[i]); if (v > m) m = v; }
    out[b] = m;
  }
  return out;
}

export function peakAbs(data) {
  let m = 0;
  for (let i = 0; i < data.length; i++) { const v = Math.abs(data[i]); if (v > m) m = v; }
  return m;
}

/** Gain that brings a recording's peak to `target`, without boosting silence
 *  into noise. Up to +40 dB, for a mixer whose USB send runs low. */
export function levelGain(peak, target = 0.7, max = 100) {
  return peak > 1e-4 ? Math.min(max, target / peak) : 1;
}

/** Sum the loop (repeated `passes` times, then ringing out its downbeat) with
 *  a solo take into one track for download. Peaks above 1 are softened. */
export function mixTake({ loop, loopGain = 1, solo, soloGain = 1, passes, ringOut = 0 }) {
  const n = loop.length * passes;
  const out = new Float32Array(n + ringOut);
  for (let i = 0; i < out.length; i++) {
    let v = loop[i % loop.length] * loopGain;
    if (i >= n) v *= 1 - (i - n) / ringOut;
    if (i < solo.length) v += solo[i] * soloGain;
    out[i] = Math.abs(v) < 0.9 ? v : Math.sign(v) * (0.9 + 0.1 * Math.tanh((Math.abs(v) - 0.9) / 0.1));
  }
  return out;
}

// ---- latency ----------------------------------------------------------------

/** Onset in data[from, to): the first sample where a 1 ms envelope climbs well
 *  above both the noise just before `from` and a third of the window's peak.
 *  Returns -1 when nothing stands out. */
export function detectOnset(data, sr, from, to, noiseLen = Math.round(0.08 * sr)) {
  from = Math.max(0, from); to = Math.min(data.length, to);
  const k = Math.exp(-1 / (0.001 * sr));
  let noise = 0, n = 0;
  for (let i = Math.max(0, from - noiseLen); i < from; i++) { noise += data[i] * data[i]; n++; }
  noise = n ? Math.sqrt(noise / n) : 0;
  let env = noise, peak = 0;
  const envs = new Float32Array(to - from);
  for (let i = from; i < to; i++) {
    env = Math.max(Math.abs(data[i]), env * k);
    envs[i - from] = env;
    if (env > peak) peak = env;
  }
  if (peak < Math.max(noise * 4, 1e-3)) return -1;
  const threshold = Math.max(noise * 4, peak * 0.33);
  for (let i = 0; i < envs.length; i++) if (envs[i] >= threshold) return from + i;
  return -1;
}

/** Round-trip latency from a recording of known click times (sample indices
 *  into `rec`): the median delay before each click shows up. */
export function measureLatency(rec, sr, clicks, maxDelay = 0.5) {
  const delays = [];
  for (const c of clicks) {
    const at = detectOnset(rec, sr, c, c + Math.round(maxDelay * sr));
    if (at >= 0) delays.push(at - c);
  }
  if (delays.length < Math.ceil(clicks.length / 2)) return null;
  delays.sort((a, b) => a - b);
  const median = delays[delays.length >> 1];
  const q1 = delays[Math.floor(delays.length / 4)], q3 = delays[Math.floor((delays.length * 3) / 4)];
  return { latency: median / sr, spread: (q3 - q1) / sr, heard: delays.length };
}

// ---- tempo ------------------------------------------------------------------

/** Lowpass with a windowed sinc, then keep every `factor`-th sample. */
export function decimate(data, factor) {
  if (factor <= 1) return Float32Array.from(data);
  const half = factor * 4, taps = new Float32Array(2 * half + 1), fc = 0.45 / factor;
  let sum = 0;
  for (let i = -half; i <= half; i++) {
    const sinc = i === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * i) / (Math.PI * i);
    const win = 0.42 + 0.5 * Math.cos((Math.PI * i) / half) + 0.08 * Math.cos((2 * Math.PI * i) / half);
    taps[i + half] = sinc * win; sum += sinc * win;
  }
  for (let i = 0; i < taps.length; i++) taps[i] /= sum;
  const out = new Float32Array(Math.floor(data.length / factor));
  for (let o = 0; o < out.length; o++) {
    const c = o * factor;
    let acc = 0;
    for (let t = -half; t <= half; t++) {
      const i = c + t;
      if (i >= 0 && i < data.length) acc += data[i] * taps[t + half];
    }
    out[o] = acc;
  }
  return out;
}

/** Onset strength of a loop, one value per `hop` seconds: the rise in log
 *  energy, treating the loop as circular. */
export function onsetEnvelope(data, sr, hop = 0.01) {
  const h = Math.max(1, Math.round(hop * sr)), n = Math.floor(data.length / h);
  const e = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0;
    for (let i = f * h, z = i + h; i < z; i++) s += data[i] * data[i];
    e[f] = Math.log(1e-6 + s / h);
  }
  const env = new Float32Array(n);
  for (let f = 0; f < n; f++) env[f] = Math.max(0, e[f] - e[mod(f - 1, n)]) + 0.5 * Math.max(0, e[mod(f + 1, n)] - e[mod(f - 1, n)]);
  return { env, hop: h / sr };
}

/** Guess how many bars a loop of unknown tempo holds: for each bar count
 *  that gives a playable tempo, comb the onset envelope at the implied beats,
 *  then weigh the result towards a moderate tempo, which settles the usual
 *  double-or-half ambiguity, and slightly towards a power-of-two bar count. */
export function guessMeter(data, sr, beatsPerBar = 4) {
  const seconds = data.length / sr;
  const factor = Math.max(1, Math.floor(sr / 8000));
  const { env } = onsetEnvelope(decimate(data, factor), sr / factor, 0.01);
  const n = env.length;
  let mean = 0;
  for (const v of env) mean += v;
  mean = mean / (n || 1) || 1;
  const comb = (beats) => {
    const p = n / beats;
    let s = 0;
    for (let k = 0; k < beats; k++) {
      let m = 0;
      for (let d = -2; d <= 2; d++) m = Math.max(m, env[mod(Math.round(k * p) + d, n)]);
      s += m;
    }
    return s / beats / mean;
  };
  let best = null;
  for (const bars of [1, 2, 3, 4, 6, 8, 12, 16, 24, 32]) {
    const beats = bars * beatsPerBar, bpm = (60 * beats) / seconds;
    if (bpm < 45 || bpm > 220) continue;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 110) / 0.75) ** 2) * ((bars & (bars - 1)) === 0 ? 1.05 : 0.8);
    const score = comb(beats) * prior;
    if (!best || score > best.score) best = { bars, bpm, score };
  }
  if (!best) {
    const bars = Math.max(1, Math.round((seconds * 110) / 60 / beatsPerBar));
    best = { bars, bpm: (60 * bars * beatsPerBar) / seconds };
  }
  return { bars: best.bars, bpm: best.bpm };
}

// ---- files ------------------------------------------------------------------

export function toPcm16(data, gain = 1) {
  const out = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = Math.round(clamp(data[i] * gain, -1, 1) * 32767);
  return out;
}

export function fromPcm16(pcm) {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32767;
  return out;
}

/** A 16-bit PCM WAV file from one or more equal-length channels. */
export function encodeWav(channels, sr) {
  const nch = channels.length, len = channels[0].length;
  const buf = new ArrayBuffer(44 + len * nch * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + len * nch * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * nch * 2, true); v.setUint16(32, nch * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, len * nch * 2, true);
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < nch; c++, o += 2) v.setInt16(o, Math.round(clamp(channels[c][i], -1, 1) * 32767), true);
  return buf;
}
