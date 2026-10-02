import { audio } from "./audio.js";
import { chapters } from "./content.js";
import * as M from "./model.js";
const $ = (id) => document.getElementById(id);
const colors = [
  "#7bb7ff",
  "#bda2ff",
  "#f9c66b",
  "#ff92b3",
  "#64dfb3",
  "#73d9ef",
  "#f49d84",
  "#d8ce83",
];
const canvas = $("main-canvas"),
  ctx = canvas.getContext("2d");
let W = 600,
  H = 360,
  current = 0,
  state = {},
  drag = null,
  frame = 0,
  curveCache = null;
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const defaults = () => ({
  f1: 440,
  f2: 441,
  position: 0.5,
  pull: 60,
  direction: 1,
  pluckAt: 0,
  plucked: false,
  solo: 0,
  base: 220,
  ratio: 1.5,
  third: false,
  thirdRatio: 1.25,
  timbre: "string",
  roots: [0],
  fold: true,
  tuning: "just",
  repair: false,
  chord: "ii",
  smooth: false,
  all: false,
  step: -1,
  harmonicLimit: 5,
  chosenH: [1, 3, 5],
  rootsExact: [M.fraction(1, 3), M.fraction(1), M.fraction(3)],
});
const fmt = (n) => Number(n).toFixed(2);
const kind = () => chapters[current].id;
function button(label, attrs = "") {
  return `<button type="button" ${attrs}>${label}</button>`;
}
function range(id, label, min, max, step, value, unit = "") {
  return `<div class="range-field"><label for="${id}">${label}<output id="${id}-value" for="${id}">${value}${unit}</output></label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"></div>`;
}
function bindRange(id, key, fn = changed, unit = "") {
  $(id).addEventListener("input", (e) => {
    state[key] = +e.target.value;
    $(id + "-value").textContent = fmt(state[key]) + unit;
    fn();
  });
}
function safe(promise) {
  return Promise.resolve(promise).catch(() => {
    audio.stop();
    $("sound-status").textContent =
      "Audio unavailable. Check your browser audio settings, then try Play.";
  });
}
function frequencies() {
  return kind() === "beating"
    ? [state.f1, state.f2]
    : [
        state.base,
        state.base * state.ratio,
        ...(state.third ? [state.base * state.thirdRatio] : []),
      ];
}
function partials() {
  return M.spectrum(state.timbre);
}
function playingChanged() {
  $("stop").disabled = !audio.playing;
  $("play").textContent = audio.playing ? "↻ Replay" : "▶ Play";
  $("sound-status").textContent = audio.playing ? "Playing" : "Ready to listen";
  if (!audio.playing && state.solo) {
    state.solo = 0;
  }
  if (!audio.playing && state.step !== -1) {
    state.step = -1;
    if (kind() === "voice") renderVoices();
  }
  requestDraw();
}
audio.onChange = playingChanged;
$("volume").addEventListener("input", (e) => audio.setVolume(+e.target.value));
$("stop").addEventListener("click", () => {
  audio.stop();
  state.plucked = false;
  state.solo = 0;
  state.step = -1;
  if (kind() === "voice") renderVoices();
  requestDraw();
});
$("play").addEventListener("click", () => safe(play()));
$("reset").addEventListener("click", () => {
  audio.stop();
  state = defaults();
  curveCache = null;
  renderLab();
});
$("prev").addEventListener("click", () => navigate(current - 1, true));
$("next").addEventListener("click", () => navigate(current + 1, true));
$("chapters").innerHTML = chapters
  .map((c, i) =>
    button(
      `${i + 1}`,
      `data-chapter="${i}" aria-label="Chapter ${i + 1}: ${c.name}" title="${c.name}"`,
    ),
  )
  .join("");
$("chapters").addEventListener("click", (e) => {
  const b = e.target.closest("[data-chapter]");
  if (b) navigate(+b.dataset.chapter, true);
});
document.addEventListener("keydown", (e) => {
  if (
    e.target.closest(
      "input,select,textarea,button,summary,[contenteditable]",
    ) ||
    e.altKey ||
    e.ctrlKey ||
    e.metaKey
  )
    return;
  if (e.key === "ArrowRight") {
    e.preventDefault();
    navigate(current + 1, true);
  }
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    navigate(current - 1, true);
  }
  if (e.key === "Escape") audio.stop();
});
window.addEventListener("hashchange", () => {
  const index = chapters.findIndex((c) => "#" + c.id === location.hash);
  if (index >= 0 && index !== current) navigate(index, true, false);
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    audio.stop();
    cancelAnimationFrame(frame);
    frame = 0;
  } else requestDraw();
});
window.addEventListener("pagehide", () => audio.stop());
reduced.addEventListener("change", requestDraw);
function navigate(i, focus = false, updateHash = true) {
  if (i < 0 || i >= chapters.length) return;
  audio.stop();
  current = i;
  state = defaults();
  curveCache = null;
  drag = null;
  const c = chapters[i];
  $("story").innerHTML =
    `<span class="eyebrow">${String(i + 1).padStart(2, "0")} / ${c.name}</span><h1>${c.title}</h1>${c.body}<a class="experiment-link" href="#experiment">Try the experiment ↓</a>`;
  $("chapters")
    .querySelectorAll("button")
    .forEach((b, j) => {
      if (j === i) b.setAttribute("aria-current", "step");
      else b.removeAttribute("aria-current");
    });
  $("chapter-count").textContent = `${i + 1} / ${chapters.length}`;
  $("prev").disabled = i === 0;
  $("next").disabled = i === chapters.length - 1;
  if (updateHash) history.replaceState(null, "", "#" + c.id);
  renderLab();
  if (focus) $("story").focus({ preventScroll: false });
}
function renderLab() {
  $("lab-title").textContent = chapters[current].lab;
  $("lab-controls").innerHTML = "";
  $("lab-extra").innerHTML = "";
  $("diagram").innerHTML = "";
  $("readout").textContent = "";
  canvas.hidden = !["beating", "string", "intervals"].includes(kind());
  canvas.classList.toggle("draggable", !canvas.hidden);
  if (kind() === "intro") renderIntro();
  if (kind() === "beating") setupBeating();
  if (kind() === "string") setupString();
  if (kind() === "intervals") setupIntervals();
  if (kind() === "triads") setupTriads();
  if (kind() === "chords") setupBuilder();
  if (kind() === "tuning") setupTuning();
  if (kind() === "voice") setupVoice();
  if (kind() === "theorem") setupTheorem();
  resize();
  playingChanged();
}
async function play() {
  if (kind() === "intro")
    return audio.playSequence(
      [...M.MAJOR, 12].map((n) => [M.toneFrequency(n)]),
      (i) => {
        $("readout").textContent =
          i < 0
            ? "C major: seven pitch classes, returning to C."
            : `Listening: ${M.noteName([...M.MAJOR, 12][i], true)}`;
      },
      0.55,
    );
  if (kind() === "beating")
    return audio.play(frequencies(), M.spectrum("sine"));
  if (kind() === "string") return pluck();
  if (kind() === "intervals") return audio.play(frequencies(), partials());
  if (kind() === "triads") {
    if (!state.chosenH.length) {
      $("readout").textContent = "Select a pitch class to listen.";
      return;
    }
    return audio.play(
      state.chosenH.map((n) => 261.6255653005986 * M.foldOctave(n)),
      M.spectrum(),
      3,
    );
  }
  if (kind() === "chords") {
    if (!state.roots.length) {
      $("readout").textContent = "Select at least one triad to listen.";
      return;
    }
    return audio.playSequence(
      state.roots.map((r) => builderTones(r)),
      (i) => {
        if (i >= 0)
          $("readout").textContent =
            `Listening to ${M.NAMES[state.roots[i]]} major${state.fold ? " within one octave" : ""}.`;
        else updateBuilderReadout();
      },
    );
  }
  if (kind() === "tuning")
    return audio.play(
      M.chordFrequencies(state.chord, state.tuning, state.repair),
      M.spectrum("string"),
      3,
    );
  if (kind() === "voice")
    return audio.playSequence(
      voicings().map((v) => v.map((n) => M.toneFrequency(n))),
      (i) => {
        state.step = i;
        renderVoices();
      },
    );
  if (kind() === "theorem") {
    const network = M.harmonicNetwork(state.rootsExact);
    if (!network.distinct) {
      $("readout").textContent =
        "Choose three distinct major triads before comparing them.";
      return;
    }
    return audio.playSequence(
      state.rootsExact.map((root) => networkTones(root)),
      () => {},
    );
  }
}
function changed() {
  if (audio.playing) audio.update(frequencies());
  if (kind() === "beating") updateBeating();
  if (kind() === "intervals") updateIntervals();
  requestDraw();
}
function renderIntro() {
  circle(
    M.MAJOR,
    M.NAMES.map((_, i) => i),
    [],
    (n) => safe(audio.play([M.toneFrequency(n)], M.spectrum(), 1)),
    `<strong>C major</strong>Seven pitch classes`,
    "Play",
  );
  $("readout").innerHTML =
    "Listen first. Then explore <strong>why these notes connect</strong>.";
  $("lab-extra").innerHTML =
    '<p class="small">All sound begins with your interaction. Volume and Stop remain available in every experiment.</p>';
}
function setupBeating() {
  $("lab-controls").innerHTML =
    `<div class="controls">${range("freq1", "First frequency", 200, 800, 0.1, state.f1, " Hz")}${range("freq2", "Second frequency", 200, 800, 0.1, state.f2, " Hz")}</div><div class="button-row">${[
      [0, "Unison"],
      [1, "1 beat / s"],
      [5, "5 beats / s"],
      [30, "Rougher"],
      [150, "Wide apart"],
    ]
      .map(([d, l]) => button(l, `data-beat="${d}"`))
      .join("")}</div>`;
  bindRange("freq1", "f1", changed, " Hz");
  bindRange("freq2", "f2", changed, " Hz");
  $("lab-controls")
    .querySelectorAll("[data-beat]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          state.f1 = 440;
          state.f2 = 440 + Number(b.dataset.beat);
          syncRange("freq1", state.f1, " Hz");
          syncRange("freq2", state.f2, " Hz");
          changed();
          safe(play());
        }),
    );
  $("lab-extra").innerHTML =
    '<p class="small">Drag the two separate handles vertically. Each waveform shares the same time window. The envelope and the sum use the same phase model.</p>';
  updateBeating();
}
function updateBeating() {
  const d = Math.abs(state.f2 - state.f1);
  $("readout").innerHTML =
    `<strong>${fmt(d)} beats / second</strong> · ${fmt(state.f1)} + ${fmt(state.f2)} Hz · Modelled roughness ${M.roughness(frequencies(), M.spectrum("sine")).toFixed(4)}`;
}
function syncRange(id, value, unit = "") {
  if ($(id)) {
    $(id).value = value;
    $(id + "-value").textContent = fmt(value) + unit;
  }
}
function setupString() {
  $("lab-controls").innerHTML =
    `<div class="controls">${range("position", "Pluck position", 0.05, 0.95, 0.01, state.position)}${range("pull", "Pull strength", 10, 100, 1, state.pull, "%")}</div><div class="button-row">${button("Pluck at midpoint", 'id="midpoint"')}${button("Pluck near bridge", 'id="bridge"')}</div>`;
  bindRange("position", "position", () => {
    state.plucked = false;
    audio.stop();
    updateString();
    requestDraw();
  });
  bindRange(
    "pull",
    "pull",
    () => {
      updateString();
      requestDraw();
    },
    "%",
  );
  $("midpoint").onclick = () => {
    state.position = 0.5;
    syncRange("position", 0.5);
    safe(pluck());
  };
  $("bridge").onclick = () => {
    state.position = 0.1;
    syncRange("position", 0.1);
    safe(pluck());
  };
  updateString();
}
function updateString() {
  const ps = M.spectrum("pluck", state.position);
  $("readout").innerHTML =
    `Pluck at <strong>${Math.round(state.position * 100)}% of the string</strong> · Fundamental 82.41 Hz · ${ps.filter((p) => Math.abs(p.amplitude) < 1e-9).length} of 8 modes absent.`;
  $("lab-extra").innerHTML =
    `<p class="small">Solo an excited harmonic (3 seconds):</p><div class="harmonics">${ps.map((p, i) => button(`${i + 1}f₀ <span>${fmt(82.41 * (i + 1))} Hz · ${Math.abs(p.amplitude).toFixed(3)}</span>`, `data-harmonic="${i + 1}" ${Math.abs(p.amplitude) < 1e-9 ? "disabled" : ""} aria-label="Solo harmonic ${i + 1}, amplitude ${Math.abs(p.amplitude).toFixed(3)}"`)).join("")}</div><p class="small">The even-mode buttons are disabled when the midpoint pluck does not excite them. Animation uses slow motion; reduced-motion settings show a stationary shape.</p>`;
  $("lab-extra")
    .querySelectorAll("[data-harmonic]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          const n = +b.dataset.harmonic;
          state.pluckAt = performance.now();
          state.plucked = false;
          safe(audio.play([82.41 * n], M.spectrum("sine"), 3)).then(() => {
            if (audio.playing) state.solo = n;
            requestDraw();
          });
        }),
    );
}
function pluck() {
  state.plucked = true;
  state.solo = 0;
  state.pluckAt = performance.now();
  updateString();
  requestDraw();
  return audio.play(
    [82.41],
    M.spectrum("pluck", state.position).map((p) => ({
      ...p,
      amplitude: ((p.amplitude * state.pull) / 100) * state.direction,
    })),
    8,
    true,
  );
}
function setupIntervals() {
  $("lab-controls").innerHTML =
    `<div class="controls">${range("base", "Lower frequency", 80, 400, 1, state.base, " Hz")}${range("ratio", "Upper / lower ratio", 1, 2, 0.0001, state.ratio)}<label><span>Spectrum</span><select id="timbre"><option value="string">String-like (1/n²)</option><option value="sine">Pure sine</option><option value="bright">Bright (1/n)</option><option value="stretched">Stretched partials</option></select></label></div><div class="button-row">${M.RATIOS.map(([n, d, l]) => button(`${n}:${d} ${l}`, `data-ratio="${n / d}"`)).join("")}</div><div class="controls"><label class="check"><input id="third" type="checkbox"> Add a third note</label><div id="third-field" hidden>${range("third-ratio", "Third / lower ratio", 1, 2, 0.0001, state.thirdRatio)}</div></div>`;
  bindRange(
    "base",
    "base",
    () => {
      curveCache = null;
      changed();
    },
    " Hz",
  );
  bindRange("ratio", "ratio");
  bindRange("third-ratio", "thirdRatio");
  $("timbre").onchange = (e) => {
    state.timbre = e.target.value;
    curveCache = null;
    if (audio.playing) safe(play());
    updateIntervals();
    requestDraw();
  };
  $("third").onchange = (e) => {
    state.third = e.target.checked;
    $("third-field").hidden = !state.third;
    if (audio.playing) safe(play());
    updateIntervals();
    requestDraw();
  };
  $("lab-controls")
    .querySelectorAll("[data-ratio]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          state.ratio = +b.dataset.ratio;
          syncRange("ratio", state.ratio);
          changed();
          safe(play());
        }),
    );
  $("lab-extra").innerHTML =
    '<p class="small">Drag the cursor on the curve to tune the upper note. The curve always scores the first two notes; the readout includes all active notes. Exact presets preserve fractional frequencies.</p>';
  updateIntervals();
}
function updateIntervals() {
  const f = frequencies(),
    r = M.roughness(f, partials());
  $("readout").innerHTML =
    `<strong>Modelled roughness ${r.toFixed(4)}</strong> · ${f.map((x) => fmt(x) + " Hz").join(" + ")}<br>Upper interval: ${state.ratio.toFixed(6)} · ${M.cents(state.ratio).toFixed(2)} cents`;
  $("lab-controls")
    .querySelectorAll("[data-ratio]")
    .forEach((b) =>
      b.setAttribute(
        "aria-pressed",
        Math.abs(+b.dataset.ratio - state.ratio) < 1e-10 ? "true" : "false",
      ),
    );
}
function builderTones(root) {
  return M.builderFrequencies(root, state.fold);
}
function setupBuilder() {
  $("lab-controls").innerHTML =
    `<div class="button-row">${[5, 0, 7].map((r) => button(`${M.NAMES[r]} major`, `data-root="${r}" aria-pressed="${state.roots.includes(r)}"`)).join("")}</div><label class="controls check"><input id="fold" type="checkbox" checked> Fold frequencies into one octave</label>`;
  $("lab-controls")
    .querySelectorAll("[data-root]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          audio.stop();
          const r = +b.dataset.root;
          state.roots = state.roots.includes(r)
            ? state.roots.filter((x) => x !== r)
            : [...state.roots, r];
          b.setAttribute("aria-pressed", state.roots.includes(r));
          renderBuilder();
        }),
    );
  $("fold").onchange = (e) => {
    audio.stop();
    state.fold = e.target.checked;
    renderBuilder();
  };
  renderBuilder();
}
function renderBuilder() {
  const notes = M.unionTriads(state.roots),
    groups = state.roots.map((r) => ({
      notes: [r, M.mod(r + 4), M.mod(r + 7)],
      color: colors[[0, 5, 7].indexOf(r)],
    }));
  circle(
    notes,
    M.NAMES.map((_, i) => i),
    groups,
    (n) => {
      if (notes.includes(n))
        safe(audio.play([M.toneFrequency(n, "just")], M.spectrum(), 1));
    },
    `<strong>${notes.length} notes</strong>${state.roots.length} triad${state.roots.length === 1 ? "" : "s"}`,
    "Play",
  );
  const fractions = ["1", "9/8", "5/4", "4/3", "3/2", "5/3", "15/8"];
  $("lab-extra").innerHTML =
    `<div class="pitch-strip">${notes.map((n) => `<span class="new">${M.NAMES[n]}<small>${fractions[M.MAJOR.indexOf(n)]}</small></span>`).join("")}</div><div class="table-wrap"><table><caption class="small">${state.fold ? "Octave-folded pitches" : "Original registers"} · relative to C₄ = 1</caption><thead><tr><th>Triad</th><th>Frequencies (Hz)</th></tr></thead><tbody>${state.roots.map((r) => `<tr><td>${M.NAMES[r]} major</td><td>${builderTones(r).map(fmt).join(" · ")}</td></tr>`).join("")}</tbody></table></div>`;
  updateBuilderReadout();
}
function updateBuilderReadout() {
  const notes = M.unionTriads(state.roots);
  $("readout").innerHTML =
    notes.length === 7
      ? "<strong>The diatonic collection is complete.</strong> With C as tonic: C major."
      : `<strong>${notes.map((n) => M.NAMES[n]).join(" · ") || "No notes yet"}</strong> · Add the remaining triads to discover the collection.`;
}
function setupTuning() {
  $("lab-controls").innerHTML =
    `<div class="controls"><label><span>Tuning</span><select id="tuning"><option value="just">Just C major</option><option value="equal">12-tone equal temperament</option></select></label><label class="check"><input id="repair" type="checkbox"> Repair ii: lower D by 81:80</label></div><div class="button-row chord-buttons">${Object.keys(
      M.TRIADS,
    )
      .map((n) =>
        button(n, `data-chord="${n}" aria-pressed="${state.chord === n}"`),
      )
      .join("")}</div>`;
  $("tuning").onchange = (e) => {
    const was = audio.playing;
    audio.stop();
    state.tuning = e.target.value;
    $("repair").disabled = state.tuning === "equal";
    renderTuning();
    if (was) safe(play());
  };
  $("repair").onchange = (e) => {
    const was = audio.playing;
    audio.stop();
    state.repair = e.target.checked;
    renderTuning();
    if (was) safe(play());
  };
  $("lab-controls")
    .querySelectorAll("[data-chord]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          state.chord = b.dataset.chord;
          $("lab-controls")
            .querySelectorAll("[data-chord]")
            .forEach((c) => c.setAttribute("aria-pressed", c === b));
          renderTuning();
          safe(play());
        }),
    );
  renderTuning();
}
function renderTuning() {
  const fs = M.chordFrequencies(state.chord, state.tuning, state.repair),
    ns = M.TRIADS[state.chord];
  $("diagram").innerHTML =
    `<div class="table-wrap"><table><caption>Pitch positions within the octave</caption><thead><tr><th>Note</th><th>Frequency</th><th>Ratio to C</th><th>From equal tuning</th></tr></thead><tbody>${M.MAJOR.map(
      (n) => {
        const f = M.toneFrequency(n, state.tuning, state.repair),
          r = f / M.toneFrequency(0, state.tuning),
          d = M.cents(r) - n * 100;
        return `<tr><th>${M.NAMES[n]}</th><td>${fmt(f)} Hz</td><td>${r.toFixed(5)}</td><td>${d >= 0 ? "+" : ""}${d.toFixed(2)} cents</td></tr>`;
      },
    ).join("")}</tbody></table></div>`;
  $("readout").innerHTML =
    `<strong>${state.chord}: ${ns.map((n) => M.noteName(n)).join("–")}</strong> · ${fs.map(fmt).join(" / ")} Hz<br>Third above root: ${M.cents(fs[1] / fs[0]).toFixed(2)} cents · Fifth above root: ${M.cents(fs[2] / fs[0]).toFixed(2)} cents`;
  const repaired = state.tuning === "just" && state.repair;
  $("lab-extra").innerHTML =
    `<p class="small">${state.tuning === "equal" ? "Equal temperament: both D–A and G–D are 700 cents." : repaired ? "D = 10/9: ii is pure (10:12:15), but V’s fifth is now 40:27." : "D = 9/8: I, IV and V are pure (4:5:6); ii’s fifth is 40:27."} The pure fifth is 701.96 cents; 40:27 is 680.45 cents.</p>`;
}
function progression() {
  return state.all
    ? ["I", "ii", "iii", "IV", "V", "vi", "vii°", "I"]
    : ["I", "IV", "V", "I"];
}
function voicings() {
  return state.smooth
    ? M.voiceLeading(progression())
    : progression().map((n) => M.TRIADS[n]);
}
function setupVoice() {
  $("lab-controls").innerHTML =
    `<div class="controls"><label><span>Voicing</span><select id="voicing"><option value="root">Root position</option><option value="smooth">Smooth voices</option></select></label><label><span>Progression</span><select id="progression"><option value="cadence">I → IV → V → I</option><option value="all">All seven triads → I</option></select></label></div>`;
  $("voicing").onchange = (e) => {
    audio.stop();
    state.smooth = e.target.value === "smooth";
    state.step = -1;
    renderVoices();
  };
  $("progression").onchange = (e) => {
    audio.stop();
    state.all = e.target.value === "all";
    state.step = -1;
    renderVoices();
  };
  renderVoices();
}
function renderVoices() {
  const vs = voicings(),
    names = progression(),
    w = Math.max(550, vs.length * 100),
    h = 330;
  const x = (i) => 55 + (i * (w - 110)) / (vs.length - 1),
    y = (n) => 265 - ((n + 12) / 36) * 215;
  let svg = `<svg class="voice-chart" style="min-width:${w}px" viewBox="0 0 ${w} ${h}" role="img" aria-label="Three voices through ${names.join(", ")}. Total motion ${M.motion(vs)} semitones.">`;
  vs.forEach((v, i) => {
    if (i === state.step)
      svg += `<rect class="active" x="${x(i) - 35}" y="15" width="70" height="295" rx="8"/>`;
    svg += `<text x="${x(i)}" y="30" text-anchor="middle">${names[i]}</text>`;
  });
  for (let j = 0; j < 3; j++) {
    svg += `<polyline points="${vs.map((v, i) => `${x(i)},${y(v[j])}`).join(" ")}" fill="none" stroke="${colors[j]}" stroke-width="3"/>`;
    vs.forEach((v, i) => {
      svg += `<circle cx="${x(i)}" cy="${y(v[j])}" r="5" fill="${colors[j]}"/><text x="${x(i)}" y="${y(v[j]) + 20}" text-anchor="middle">${M.noteName(v[j], true)}</text>`;
    });
  }
  svg += "</svg>";
  $("diagram").innerHTML = `<div class="table-wrap">${svg}</div>`;
  const rootMotion = M.motion(names.map((n) => M.TRIADS[n])),
    smoothMotion = M.motion(M.voiceLeading(names));
  $("readout").innerHTML =
    `<strong>${M.motion(vs)} semitones of total voice motion</strong> · Root position: ${rootMotion} · Smooth: ${smoothMotion}${state.step >= 0 ? `<br>Now playing ${names[state.step]}` : ""}`;
  $("lab-extra").innerHTML =
    `<div class="button-row">${names.map((n, i) => button(`${i + 1}. ${n}`, `data-voice-step="${i}"`)).join("")}</div><p class="small">Listen to a single voicing, or Play the sequence. Horizontal segments hold the same pitch.</p>`;
  $("lab-extra")
    .querySelectorAll("[data-voice-step]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          const i = +b.dataset.voiceStep;
          safe(
            audio.play(
              vs[i].map((n) => M.toneFrequency(n)),
              M.spectrum(),
              1,
            ),
          );
        }),
    );
}
function rootLabel(root) {
  const names = {
    "1/1": "C",
    "3/1": "G",
    "1/3": "F",
    "5/1": "E",
    "1/5": "A♭",
    "5/3": "A",
    "3/5": "E♭",
    "9/1": "D",
    "15/1": "B",
  };
  return names[M.ratioKey(root)] || M.formatRatio(M.foldRatio(root));
}
function setupTriads() {
  $("lab-controls").innerHTML =
    `<div class="controls">${range("harmonic-limit", "Highest available harmonic", 1, 15, 1, state.harmonicLimit)}</div><div class="button-row">${button("First four harmonics", 'id="first-four"')}${button("Major: H = 5", 'id="major-triad"')}${button("Minor: H = 15", 'id="minor-triad"')}${button("Suspended: H = 9", 'id="sus-triad"')}</div>`;
  bindRange("harmonic-limit", "harmonicLimit", () => {
    audio.stop();
    const available = Array.from({ length: state.harmonicLimit }, (_, i) =>
      M.oddPart(i + 1),
    );
    state.chosenH = state.chosenH.filter((n) => available.includes(n));
    renderTriads();
  });
  const preset = (limit, chosen) => {
    audio.stop();
    state.harmonicLimit = limit;
    state.chosenH = chosen;
    syncRange("harmonic-limit", limit);
    renderTriads();
  };
  $("first-four").onclick = () => preset(4, [1, 3]);
  $("major-triad").onclick = () => preset(5, [1, 3, 5]);
  $("minor-triad").onclick = () => preset(15, [3, 5, 15]);
  $("sus-triad").onclick = () => preset(9, [1, 3, 9]);
  renderTriads();
}
function renderTriads() {
  const hs = Array.from({ length: state.harmonicLimit }, (_, i) => i + 1),
    classes = [...new Set(hs.map(M.oddPart))],
    chosen = state.chosenH;
  const height = chosen.length
    ? M.harmonicHeight(chosen.map((n) => M.fraction(n)))
    : 0n;
  $("diagram").innerHTML =
    `<p class="small">Harmonics of a common C reference. Octave-equivalent harmonics share a pitch class; select up to three classes.</p><div class="harmonics">${hs
      .map((n) => {
        const odd = M.oddPart(n);
        return button(
          `Harmonic ${n}<span>${rootLabel(M.fraction(odd))} · class [${odd}]</span>`,
          `data-h="${odd}" aria-pressed="${chosen.includes(odd)}" aria-label="Toggle octave class of harmonic ${n}, class ${odd}"`,
        );
      })
      .join(
        "",
      )}</div><div class="pitch-strip">${chosen.map((n) => `<span>${rootLabel(M.fraction(n))}<small>${M.formatRatio(M.foldRatio(M.fraction(n)))}</small></span>`).join("")}</div>`;
  $("diagram")
    .querySelectorAll("[data-h]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          const n = +b.dataset.h;
          audio.stop();
          if (chosen.includes(n)) state.chosenH = chosen.filter((x) => x !== n);
          else if (chosen.length < 3) state.chosenH = [...chosen, n];
          else {
            $("readout").textContent =
              "Deselect a pitch class before adding another: a triad has three distinct classes.";
            return;
          }
          renderTriads();
        }),
    );
  $("readout").innerHTML =
    `<strong>${classes.length} distinct octave class${classes.length === 1 ? "" : "es"} in the first ${hs.length} harmonics.</strong><br>${chosen.length === 3 ? `Selected triad: H = ${height}, consonance = 1/${height}.${height === 5n ? " The major-triad bound is attained." : ""}` : `Selected ${chosen.length} / 3 classes.${hs.length < 5 ? " A triad cannot fit before harmonic 5." : ""}`}`;
  $("lab-extra").innerHTML =
    '<p class="small">Play sounds the selected classes folded into one octave. The fundamental reference stays C; the minor example is E–G–B. Transposition does not change harmonic height.</p>';
}
function networkTones(root) {
  const f = 261.6255653005986 * M.ratioNumber(M.foldRatio(root));
  return [f, (f * 5) / 4, (f * 3) / 2];
}
function setupTheorem() {
  $("lab-controls").innerHTML =
    `<p class="small">Chord roots as exact ratios to C (octave-equivalent inputs are identified). Each chord is a pure major triad.</p><div class="root-inputs">${state.rootsExact.map((r, i) => `<fieldset><legend>Chord ${"ABC"[i]}</legend><label>Numerator<input id="root-${i}-n" type="number" min="1" max="99" step="1" required value="${r.n}"></label><label>Denominator<input id="root-${i}-d" type="number" min="1" max="99" step="1" required value="${r.d}"></label></fieldset>`).join("")}</div><div class="button-row">${button("Apply roots", 'id="apply-roots"')}${button("IV–I–V", 'id="chain-preset"')}${button("I–V–III", 'id="thirds-preset"')}${button("C–G–D: find its tonic", 'id="shift-preset"')}</div>`;
  $("apply-roots").onclick = () => {
    const fields = [...$("lab-controls").querySelectorAll("input")];
    if (!fields.every((f) => f.reportValidity())) return;
    audio.stop();
    state.rootsExact = [0, 1, 2].map((i) =>
      M.fraction(
        $(`root-${i}-n`).valueAsNumber,
        $(`root-${i}-d`).valueAsNumber,
      ),
    );
    renderTheorem();
  };
  const preset = (roots) => {
    audio.stop();
    state.rootsExact = roots;
    roots.forEach((r, i) => {
      $(`root-${i}-n`).value = String(r.n);
      $(`root-${i}-d`).value = String(r.d);
    });
    renderTheorem();
  };
  $("chain-preset").onclick = () =>
    preset([M.fraction(1, 3), M.fraction(1), M.fraction(3)]);
  $("thirds-preset").onclick = () =>
    preset([M.fraction(1), M.fraction(3), M.fraction(5)]);
  $("shift-preset").onclick = () =>
    preset([M.fraction(1), M.fraction(3), M.fraction(9)]);
  renderTheorem();
}
function renderTheorem() {
  const network = M.harmonicNetwork(state.rootsExact),
    points = [
      [20, 76],
      [50, 18],
      [80, 76],
    ],
    labels = state.rootsExact.map(rootLabel);
  const center = network.centers.length === 1 ? network.centers[0] : -1;
  let svg =
    '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">';
  network.pairs.forEach((p) => {
    const a = points[p.i],
      b = points[p.j],
      best = p.height === 15n;
    svg += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${best ? colors[4] : colors[1]}" stroke-width="${best ? 1 : 0.5}"/><text x="${(a[0] + b[0]) / 2}" y="${(a[1] + b[1]) / 2 - 3}" fill="#edf2fc" text-anchor="middle" font-size="4">1/${p.height}</text>`;
  });
  svg += "</svg>";
  $("diagram").innerHTML =
    `<div class="network">${svg}${points.map(([x, y], i) => button(`${labels[i]} major<small>${network.optimal && i === center ? "Tonic · unique center" : "Chord " + "ABC"[i]}</small>`, `data-network-chord="${i}" style="left:${x}%;top:${y}%" ${network.optimal && i === center ? 'class="tonic"' : ""}`)).join("")}</div>`;
  $("diagram")
    .querySelectorAll("[data-network-chord]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          safe(
            audio.play(
              networkTones(state.rootsExact[+b.dataset.networkChord]),
              M.spectrum(),
              2,
            ),
          )),
    );
  $("readout").innerHTML = !network.distinct
    ? "<strong>Choose three distinct chords.</strong> At least two roots identify the same octave class, so this is outside the theorem."
    : `<strong>Collection consonance: ${M.formatRatio(network.score)} = ${network.value.toFixed(6)}</strong><br>${network.optimal ? `Global optimum. ${labels[center]} major is the unique harmonic center.` : `Below 7/45 = ${(7 / 45).toFixed(6)}. Try giving one chord a fifth-neighbor on each side.`}`;
  let union = "";
  if (network.optimal) {
    const relative = network.union
      .map((p) => M.foldRatio(M.divide(p, state.rootsExact[center])))
      .sort((a, b) => M.ratioNumber(a) - M.ratioNumber(b));
    union = `<p><strong>${labels[center]} major emerges:</strong> seven exact ratios relative to its tonic.</p><div class="pitch-strip">${relative.map((r, i) => `<span>${i + 1}<small>${M.formatRatio(r)}</small></span>`).join("")}</div><p class="small">The center’s connections sum to 2/15; each outer chord has 4/45. Choosing a different starting note would not change this unique center.</p>`;
  }
  $("lab-extra").innerHTML =
    `<div class="table-wrap"><table><caption>All three pairs enter the score</caption><thead><tr><th>Pair</th><th>Harmonic height</th><th>Consonance</th></tr></thead><tbody>${network.pairs.map((p) => `<tr><td>${labels[p.i]} ↔ ${labels[p.j]}</td><td>${p.height}</td><td>1/${p.height}</td></tr>`).join("")}</tbody></table></div>${union}<details><summary>Why the scoring rule matters</summary><p class="small">For these roots, the sum of pair heights is ${network.pairs.reduce((sum, p) => sum + p.height, 0n)}, and the height of the whole union is ${M.harmonicHeight(network.union)}. Minimizing either is a different problem. The proved objective maximizes the sum of reciprocal pair heights.</p><p class="small">The inputs range from 1 to 99 for convenience. The proof covers all root ratios, not just these inputs.</p></details>`;
}

function circle(selected, order, groups, onClick, center, action) {
  const point = (n) => {
    const i = order.indexOf(M.mod(n)),
      a = (i / order.length) * 2 * Math.PI - Math.PI / 2;
    return [50 + 40 * Math.cos(a), 50 + 40 * Math.sin(a)];
  };
  let svg = '<svg viewBox="0 0 100 100" aria-hidden="true">';

  groups.forEach((g) => {
    const points = g.notes
      .map(point)
      .map((p) => p.join(","))
      .join(" ");
    svg +=
      g.notes.length === 2
        ? `<polyline points="${points}" fill="none" stroke="${g.color}" stroke-width="1"/>`
        : `<polygon points="${points}" fill="${g.color}15" stroke="${g.color}" stroke-width=".6"/>`;
  });
  if (kind() === "chords")
    groups.forEach((g, i) =>
      g.notes.forEach((n) => {
        const [x, y] = point(n);
        svg += `<circle class="merging-note" cx="${x}" cy="${y}" r="2" fill="${g.color}" style="--merge-x:${(i - 1) * 12}px;--merge-y:${18 + i * 4}px"/>`;
      }),
    );
  svg += "</svg>";
  $("diagram").innerHTML =
    `<div class="circle">${svg}<div class="center">${center}</div>${order
      .map((n) => {
        const [x, y] = point(n),
          on = selected.includes(n);
        return button(
          M.NAMES[n],
          `data-note="${n}" style="left:${x}%;top:${y}%" aria-pressed="${on}" aria-label="${action} ${M.NAMES[n]}${on ? ", selected" : ""}" ${action === "Play" && !on ? "disabled" : ""}`,
        );
      })
      .join("")}</div>`;
  $("diagram")
    .querySelectorAll("[data-note]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          const n = +b.dataset.note;
          onClick(n);
          if (action === "Toggle")
            $("diagram")
              .querySelector(`[data-note="${n}"]`)
              ?.focus({ preventScroll: true });
        }),
    );
}
function resize() {
  const rect = canvas.getBoundingClientRect();
  W = rect.width || 600;
  H = kind() === "string" ? 440 : kind() === "intervals" ? 460 : 360;
  canvas.style.height = H + "px";
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  requestDraw();
}
new ResizeObserver(() => resize()).observe($("visual"));
function requestDraw() {
  if (!frame && !document.hidden) frame = requestAnimationFrame(draw);
}
function line(points, color, width = 2, dash = []) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.stroke();
  ctx.setLineDash([]);
}
function text(label, x, y, color = "#b1bdd3", align = "left", size = 12) {
  ctx.fillStyle = color;
  ctx.font = `${size}px Inter,system-ui,sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(label, x, y);
}
function sample(fn, start, end, step = 2) {
  const points = [];
  for (let x = start; x <= end; x += step) points.push([x, fn(x)]);
  return points;
}
function dot(x, y, color, r = 7) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}
function draw(ts) {
  frame = 0;
  if (canvas.hidden) return;
  ctx.clearRect(0, 0, W, H);
  if (kind() === "beating") drawBeating(ts);
  if (kind() === "string") drawString(ts);
  if (kind() === "intervals") drawIntervals();
  if (
    !reduced.matches &&
    ((kind() === "beating" && audio.playing) ||
      (kind() === "string" && audio.playing))
  )
    requestDraw();
}
function beatY(f) {
  return 40 + ((800 - f) / 600) * 90;
}
function drawBeating(ts) {
  const t = audio.playing && !reduced.matches ? (ts / 1000) * 0.025 : 0,
    left = 12,
    right = W - 12;
  [
    [state.f1, 50, 0],
    [state.f2, W - 50, 1],
  ].forEach(([f, x, i]) => {
    line(
      [
        [x, 40],
        [x, 130],
      ],
      "#2a3650",
    );
    dot(x, beatY(f), colors[i], 17);
    text(`f${i + 1}`, x, beatY(f), "#080c18", "center", 13);
    text(`${fmt(f)} Hz`, x, 20, colors[i], "center");
  });
  const bases = [178, 232, 306],
    amp = 17;
  const signal = (f, x) =>
    Math.sin(2 * Math.PI * f * (((x - left) / (right - left)) * 0.12 + t));
  [state.f1, state.f2].forEach((f, i) =>
    line(
      sample((x) => bases[i] - amp * signal(f, x), left, right, 1),
      colors[i],
    ),
  );
  const combined = (x) => signal(state.f1, x) + signal(state.f2, x);
  line(
    sample((x) => bases[2] - amp * combined(x), left, right, 1),
    "#edf2fc",
  );
  for (const sign of [-1, 1])
    line(
      sample(
        (x) =>
          bases[2] +
          sign *
            2 *
            amp *
            Math.abs(
              Math.cos(
                Math.PI *
                  (state.f1 - state.f2) *
                  (((x - left) / (right - left)) * 0.12 + t),
              ),
            ),
        left,
        right,
        1,
      ),
      colors[2],
      1,
      [5, 4],
    );
  text("f₁", left, 151, colors[0]);
  text("f₂", left, 207, colors[1]);
  text("Sum + envelope", left, 266);
  text("0.12-second window · slow motion", W / 2, H - 8, "#b1bdd3", "center");
}
function drawString(ts) {
  const left = 20,
    right = W - 20,
    center = 100,
    p = state.position,
    ps = M.spectrum("pluck", p);
  const elapsed = state.plucked || state.solo ? (ts - state.pluckAt) / 1000 : 0;
  const t = reduced.matches ? 0 : elapsed;
  const amp = state.pull * 0.8 * state.direction;
  dot(left, center, "#edf2fc", 4);
  dot(right, center, "#edf2fc", 4);
  if (drag?.type === "string" || (!state.plucked && !state.solo))
    line(
      [
        [left, center],
        [left + p * (right - left), center - amp],
        [right, center],
      ],
      colors[0],
    );
  else if (state.solo)
    line(
      sample(
        (x) =>
          center -
          amp *
            Math.sin((state.solo * Math.PI * (x - left)) / (right - left)) *
            Math.cos(2 * Math.PI * state.solo * 1.5 * t),
        left,
        right,
      ),
      colors[state.solo - 1],
      2.5,
    );
  else
    line(
      sample(
        (x) =>
          center -
          ps.reduce(
            (sum, h, i) =>
              sum +
              amp *
                h.amplitude *
                Math.exp(-elapsed * (0.3 + i * 0.15)) *
                Math.sin(((i + 1) * Math.PI * (x - left)) / (right - left)) *
                Math.cos(2 * Math.PI * (i + 1) * 1.5 * t),
            0,
          ),
        left,
        right,
      ),
      "#edf2fc",
      2.5,
    );
  text(
    "Pull and release · ideal flexible string",
    W / 2,
    12,
    "#b1bdd3",
    "center",
  );
  ps.forEach((h, i) => {
    const y = 185 + i * 31,
      n = i + 1;
    line(
      [
        [35, y],
        [right, y],
      ],
      "#263047",
      1,
    );
    const amplitude = state.solo
      ? state.solo === n
        ? 18
        : 0
      : h.amplitude *
        35 *
        (state.plucked ? Math.exp(-elapsed * (0.3 + i * 0.15)) : 1);
    line(
      sample(
        (x) =>
          y -
          amplitude *
            Math.sin((n * Math.PI * (x - 35)) / (right - 35)) *
            Math.cos(2 * Math.PI * n * 1.5 * t),
        35,
        right,
      ),
      colors[i],
      1.7,
    );
    text(`${n}`, 12, y, colors[i]);
  });
}
function drawIntervals() {
  const fs = frequencies(),
    ps = partials(),
    left = 30,
    right = W - 15,
    top = 35,
    band = 52,
    max = Math.max(...fs) * ps.at(-1).multiple * 1.05;
  const x = (f) => left + ((right - left) * f) / max;
  fs.forEach((f, i) => {
    const y = top + i * band;
    text(`${fmt(f)} Hz`, left, y - 22, colors[i]);
    line(
      [
        [left, y],
        [right, y],
      ],
      "#263047",
      1,
    );
    ps.forEach((p) => {
      const px = x(f * p.multiple),
        height = Math.abs(p.amplitude) * 30;
      line(
        [
          [px, y],
          [px, y - height],
        ],
        colors[i],
        2,
      );
      dot(px, y - height, colors[i], 3);
    });
  });
  for (let a = 0; a < fs.length; a++)
    for (let b = a + 1; b < fs.length; b++)
      for (const p of ps)
        for (const q of ps) {
          const f = fs[a] * p.multiple,
            g = fs[b] * q.multiple,
            w = Math.abs(p.amplitude * q.amplitude);
          if (w < 0.01) continue;
          const delta = Math.abs(f - g);
          if (delta < 0.05 || M.partialRoughness(f, g) > 0.12) {
            ctx.globalAlpha = Math.max(0.2, Math.min(0.65, w));
            line(
              [
                [x(f), top + a * band],
                [x(g), top + b * band],
              ],
              delta < 0.05 ? colors[4] : colors[3],
              1,
            );
            ctx.globalAlpha = 1;
          }
        }
  text("Partial frequencies →", right, 195, "#b1bdd3", "right");
  const yTop = 235,
    yBottom = H - 50;
  if (!curveCache) {
    curveCache = Array.from({ length: 401 }, (_, i) => {
      const ratio = 2 ** (i / 400);
      return M.roughness([state.base, state.base * ratio], ps);
    });
  }
  const peak = Math.max(...curveCache, 0.001),
    px = (c) => left + ((right - left) * c) / 1200,
    py = (v) => yBottom - (v / peak) * (yBottom - yTop);
  text(`Pair roughness · vertical maximum ${peak.toFixed(3)}`, left, 215);
  line(
    curveCache.map((v, i) => [px(i * 3), py(v)]),
    colors[1],
    2,
  );
  const cx = px(M.cents(state.ratio)),
    val = M.roughness([state.base, state.base * state.ratio], ps);
  line(
    [
      [cx, yTop],
      [cx, yBottom],
    ],
    colors[0],
    1,
    [4, 4],
  );
  dot(cx, py(val), colors[0], 6);
  [0, 300, 600, 900, 1200].forEach((c) =>
    text(
      String(c),
      px(c),
      yBottom + 20,
      "#b1bdd3",
      c === 0 ? "left" : c === 1200 ? "right" : "center",
    ),
  );
  text(
    "Interval (cents) · drag cursor to listen",
    W / 2,
    H - 8,
    "#b1bdd3",
    "center",
  );
}
function coords(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
canvas.addEventListener("pointerdown", (e) => {
  const { x, y } = coords(e);
  if (kind() === "beating") {
    const distances = [
      Math.hypot(x - 50, y - beatY(state.f1)),
      Math.hypot(x - (W - 50), y - beatY(state.f2)),
    ];
    const i = distances[0] < distances[1] ? 0 : 1;
    if (distances[i] > 30) return;
    drag = { type: "beat", i };
  } else if (kind() === "string") {
    if (y > 165 || x < 20 || x > W - 20) return;
    audio.stop();
    state.plucked = false;
    state.solo = 0;
    drag = { type: "string" };
  } else if (kind() === "intervals" && y > 225) drag = { type: "interval" };
  else return;
  canvas.setPointerCapture(e.pointerId);
  e.preventDefault();
  movePointer(e);
  if (kind() === "beating" || kind() === "intervals")
    if (!audio.playing) safe(play());
});
function movePointer(e) {
  if (!drag) return;
  const { x, y } = coords(e);
  if (drag.type === "beat") {
    state[drag.i === 0 ? "f1" : "f2"] = Math.max(
      200,
      Math.min(800, 800 - ((y - 40) / 90) * 600),
    );
    syncRange(
      drag.i === 0 ? "freq1" : "freq2",
      drag.i === 0 ? state.f1 : state.f2,
      " Hz",
    );
    changed();
  } else if (drag.type === "string") {
    state.direction = y <= 100 ? 1 : -1;
    state.position = Math.max(0.05, Math.min(0.95, (x - 20) / (W - 40)));
    state.pull = Math.max(10, Math.min(100, Math.abs(100 - y) / 0.8));
    syncRange("position", state.position);
    syncRange("pull", state.pull, "%");
    updateString();
    requestDraw();
  } else {
    state.ratio = 2 ** Math.max(0, Math.min(1, (x - 30) / (W - 45)));
    syncRange("ratio", state.ratio);
    changed();
  }
}
canvas.addEventListener("pointermove", movePointer);
canvas.addEventListener("pointerup", (e) => {
  if (!drag) return;
  const plucked = drag.type === "string";
  drag = null;
  if (canvas.hasPointerCapture(e.pointerId))
    canvas.releasePointerCapture(e.pointerId);
  if (plucked) safe(pluck());
});
canvas.addEventListener("pointercancel", () => {
  drag = null;
  requestDraw();
});
const start = chapters.findIndex((c) => "#" + c.id === location.hash);
navigate(start >= 0 ? start : 0);
