// scenes.js — the scene library: complete, launchable states of the whole rig.
//
// A scene is a held look (the same vocabulary as the shows), a formation for the
// 30 truss sticks, and every optional device, given as panel control values.
// Launching one always moves smoothly: color and intensity crossfade, heads
// pan/tilt at motor speed, sticks travel and flip at hoist speed, and devices
// come and go on their own travel — tubes rise out of the deck or grow out of
// the truss, balls fly in from the grid, the projection screen flies in.
//
// Stick formations: `kin` takes the usual shape/h/amp/roll/period plus
//   flip     — 0…1, how far each stick turns toward vertical (1 = straight up)
//   flipMode — all | alt | lattice | outer | inner | fan (see engine FLIP_MODES)
//   flipWave — a flip that rolls through the rows over time
//
// Thumbnails live in scenes/<id>.webp; regenerate them with
//   node graphics/scripts/lightDesigner-scene-thumbs.mjs   (repo served on :8124)

import { L, K, merge, cyc } from './shows.js';

/** Every scene starts from this clean baseline so per-scene tweaks never bleed across launches. */
export const DEVICE_BASE = {
  laserOn: false, laserChop: false, laserSpread: 60,
  tubesOn: false, tubeLevel: 0.9,
  ballCount: '0', ballSpin: 2,
  blindersOn: false, strobesOn: false,
  liquidOn: false, liquidLevel: 0.7, liquidSpeed: 1,
  co2On: false,
};

export const SCENE_CATS = {
  all: 'All',
  beams: 'Beams',
  kinetic: 'Kinetic',
  extras: 'FX & Lasers',
  mood: 'Mood',
};

const s = (id, name, cat, look, devices = {}, extra = {}) => ({ id, name, cat, look, devices, ...extra });
const withKin = (look, kin) => merge(look, { kin });

export const SCENES = [
  s('hush', 'Blue Hush', 'mood',
    merge(L.dark({ cycCol: K.blue }), L.wash({ col: K.royal, dim: 0.4 }), L.floorUp({ col: K.blue, dim: 0.3, rate: 32 }), { kin: { shape: 'flat', h: 11 } }),
    {}, { bpm: 96, thumbCam: 'low' }),
  s('curtain', 'Teal Curtain', 'beams',
    merge(L.curtain({ col: K.teal, alt: K.cyan, dim: 0.75, ripple: 14, rate: 16, kin: { shape: 'arch', h: 10, amp: 1.4 } }), L.floorUp({ col: K.blue, dim: 0.35 })),
    {}, { thumbCam: 'angle' }),
  s('magentaX', 'Magenta X', 'beams',
    merge(L.converge({ col: K.magenta, alt: K.uv, dim: 0.95, circle: 10, rate: 8, kin: { shape: 'vee', h: 10.5, amp: 1, roll: 0.25 } }), L.floorUp({ col: K.uv, dim: 0.6, rate: 8 }))),
  s('goldSweep', 'Gold Sweep', 'beams',
    merge(L.sweep({ col: K.gold, alt: K.amber, dim: 1, swing: 28, rate: 4, cycCol: K.amber, kin: { shape: 'wave', h: 9.5, amp: 1.4, period: 16, roll: 0.25 } }), L.floorUp({ col: K.gold, dim: 0.8, rate: 4 })),
    { blindersOn: true, blinderMode: 'phrase' }),
  s('smiles', 'Smiles & Frowns', 'kinetic',
    merge(L.fan({ col: K.lime, alt: K.cyan, dim: 0.9, tilt: 38, fan: 45, zoom: 3.5, chase: { w: 'square', rate: 2, spread: 360, by: 'pod' }, kin: { shape: 'vee', h: 9.5, amp: 0.6, roll: 0.38 } }), L.floorUp({ col: K.magenta, dim: 0.6, rate: 4 })),
    { tubesOn: true, tubeLayout: 'truss', tubeLook: 'follow', tubeColor: 'rig' }),
  s('rainbowPeak', 'Rainbow Peak', 'extras',
    L.peak({ col: K.red, alt: K.cyan, rate: 1, hueSpread: 300 }),
    { strobesOn: true, strobeMode: 'show', laserOn: true, laserPattern: 'fan', laserColor: 'rainbow' }, { bpm: 128 }),
  s('starfield', 'Starfield', 'mood',
    merge(L.rain({ col: K.ice, dim: 0.7, rate: 1, zoom: 1.2, kin: { shape: 'breathe', h: 12, amp: 0.8, period: 96 } }), L.dark({ floor: 0, cycCol: K.blue, cycDim: 0.12 })),
    { ballCount: '1', ballColor: 'white', ballSpin: 1.2 }, { bpm: 80 }),
  s('laserSky', 'Liquid Sky', 'extras',
    merge(L.dark({ col: K.green, cycCol: K.green }), L.wash({ col: K.teal, dim: 0.25, g: 'pods', zoom: 26 }), { kin: { shape: 'flat', h: 11.5 } }),
    { laserOn: true, laserPattern: 'sky', laserColor: 'green', tubesOn: true, tubeLayout: 'curtain', tubeLook: 'rain', tubeColor: 'fixed', tubeFixed: '#10ff48' }, { bpm: 124 }),
  s('co2Drop', 'The Drop', 'extras',
    L.peak({ col: K.white, alt: K.gold, rate: 0.5 }),
    { co2On: true, co2Mode: 'phrase', strobesOn: true, strobeMode: 'phrase', blindersOn: true, blinderMode: 'phrase' }, { bpm: 132 }),
  s('dome', 'Violet Dome', 'kinetic',
    merge(L.fan({ col: K.violet, alt: K.uv, dim: 0.85, tilt: 30, fan: 20, zoom: 4, chase: { rate: 8, by: 'pod' }, kin: { shape: 'arch', h: 9.8, amp: 2, roll: -0.3 } }), L.floorUp({ col: K.uv, dim: 0.5 })),
    {}, { thumbCam: 'foh' }),
  s('columns', 'Standing Columns', 'kinetic',
    merge({
      // sticks stood straight up; heads aimed up and out through the grid like searchlights
      layers: [{ g: 'pods', col: K.ice, alt: K.royal, dim: 0.85, aim: 'sky', spread: [60, 0, 20], spreadPod: [0, 0, -25], zoom: 2.6, frost: 0.05 }],
      fx: [{ g: 'pods', a: 'dim', w: 'sin', rate: 8, size: 0.6, spread: 360, by: 'x' }, { g: 'pods', a: 'tilt', w: 'sin', rate: 16, size: 10, spread: 360, by: 'pod' }],
      kin: { shape: 'arch', h: 8.8, amp: 0.8, flip: 1, flipMode: 'all' },
      cyc: cyc(K.black, K.royal, 0.25),
    }, L.floorUp({ col: K.royal, dim: 0.5 })),
    {}, { thumbCam: 'angle' }),
  s('ringTilt', 'Tilting Rows', 'kinetic',
    L.ballyhoo({ col: K.magenta, alt: K.orange, dim: 0.9, size: 18, rate: 8, zoom: 3.5, tilt: 25, kin: { shape: 'wave', h: 10, amp: 0.8, period: 32, roll: 0.35, flipWave: 0.3, flipMode: 'alt' } }),
    {}, { thumbCam: 'angle' }),
  s('sunset', 'Sunset Arches', 'mood',
    withKin(L.sunrise({ col: K.amber, sun: K.gold, dim: 0.85 }), { shape: 'twist', h: 10, amp: 0.8, period: 64, roll: -0.3 }),
    { liquidOn: true, liquidPalette: 'classic', liquidLevel: 0.45 }, { bpm: 92 }),
  s('portal', 'Portal Tunnel', 'kinetic',
    // outer sticks stood up as legs: each row becomes a frame, the rows a tunnel; beams spiral down it
    merge(L.tunnel({ col: K.green, alt: K.teal, dim: 0.85, size: 9, rate: 8, target: 'cyc', kin: { shape: 'rake', h: 9.2, amp: -1.3, flip: 1, flipMode: 'outer' } }), L.floorUp({ col: K.teal, dim: 0.5 })),
    {}, { thumbCam: 'foh' }),
  s('diamonds', 'Diamond Lattice', 'kinetic',
    L.split({ left: K.magenta, right: K.cyan, dim: 0.9, rate: 4, kin: { shape: 'flat', h: 9.8, flip: 0.5, flipMode: 'lattice' } }),
    { tubesOn: true, tubeLayout: 'columns', tubeLook: 'chase', tubeColor: 'rainbow' }),
  s('popWall', 'Pop-Art Rows', 'extras',
    L.funk({ a: K.lime, b: K.magenta, rate: 1, kin: { shape: 'flat', h: 7.8, amp: 0 } }),
    { tubesOn: true, tubeLayout: 'truss', tubeLook: 'wave', tubeColor: 'rainbow' }, { bpm: 112 }),
  s('wallSplit', 'The Rig Splits', 'kinetic',
    withKin(L.peak({ col: K.white, alt: K.cyan, rate: 1 }), { shape: 'chaos', h: 9.5, amp: 1.6, period: 16, roll: 0.35, flipWave: 0.45, flipMode: 'alt' }),
    { strobesOn: true, strobeMode: 'show' }),
  s('sphere', 'Sphere Spiral', 'extras',
    merge(L.converge({ col: K.red, alt: K.gold, dim: 0.9, circle: 18, rate: 4, point: 'air', kin: { shape: 'breathe', h: 9.8, amp: 1, period: 32, roll: -0.25, flipWave: 0.35, flipMode: 'fan' } }), { fx: [{ g: 'pods', a: 'hue', w: 'saw', rate: 32, size: 180, spread: 360, by: 'pod' }] }),
    { laserOn: true, laserPattern: 'tunnel', laserColor: 'rgb' }),
  s('sixtyseven', 'Liquid ’67', 'mood',
    merge(L.wash({ col: K.warm, dim: 0.35, g: 'pods', zoom: 30 }), L.specials({ col: K.warm, dim: 0.6 }), { cyc: cyc(K.amber, K.black, 0.1), kin: { shape: 'flat', h: 11 } }),
    { liquidOn: true, liquidPalette: 'classic', liquidLevel: 0.8, ballCount: '1', ballColor: 'rig' }, { bpm: 84 }),
  s('disco', 'Disco Inferno', 'extras',
    merge(L.fan({ col: K.pink, alt: K.gold, dim: 0.8, tilt: 50, fan: 45, zoom: 4, chase: { w: 'square', rate: 1, spread: 360, by: 'x', size: 0.8 }, kin: { shape: 'breathe', h: 10.5, amp: 0.5, period: 16 } })),
    { ballCount: '3', ballColor: 'rainbow', tubesOn: true, tubeLayout: 'canopy', tubeLook: 'sparkle', tubeColor: 'white' }, { bpm: 120 }),

  // ——— new presets ———
  s('cathedral', 'Cathedral Nave', 'kinetic',
    merge({
      layers: [{ g: 'pods', col: K.gold, alt: K.ice, dim: 0.88, aim: 'air', spread: [14, 2, 10], zoom: 2.2, frost: 0.05 }],
      fx: [{ g: 'pods', a: 'dim', w: 'sin', rate: 12, size: 0.45, spread: 360, by: 'center' }],
      kin: { shape: 'arch', h: 10.6, amp: 1.8, flip: 1, flipMode: 'inner' },
      cyc: cyc(K.gold, K.royal, 0.25),
    }, L.floorUp({ col: K.royal, dim: 0.65, fan: 18, rate: 24 })),
    {}, { bpm: 88, thumbCam: 'foh' }),
  s('aurora', 'Northern Lights', 'mood',
    merge({
      layers: [{ g: 'pods', col: K.green, alt: K.teal, dim: 0.8, pan: 0, tilt: 28, fan: 32, zoom: 9, frost: 0.5, hueSpread: 115 }],
      fx: [
        { g: 'pods', a: 'tilt', w: 'sin', rate: 20, size: 16, spread: 360, by: 'diag' },
        { g: 'pods', a: 'hue', w: 'sin', rate: 32, size: 45, spread: 240, by: 'x' },
      ],
      kin: { shape: 'twist', h: 10.8, amp: 1.3, period: 48, roll: 0.32 },
      cyc: cyc(K.teal, K.violet, 0.25),
    }, L.floorUp({ col: K.violet, dim: 0.4, fan: 14, rate: 32 })),
    {}, { bpm: 86, thumbCam: 'low' }),
  s('crossfire', 'Laser Crossfire', 'extras',
    merge(
      L.fan({ col: K.uv, alt: K.cyan, dim: 0.78, tilt: 44, fan: 38, zoom: 2.8, chase: { w: 'saw', rate: 4, spread: 360, by: 'x', wings: true }, kin: { shape: 'vee', h: 9.6, amp: 1.1, flip: 0.85, flipMode: 'outer' } }),
      L.floorUp({ col: K.cyan, dim: 0.55, rate: 8 }),
    ),
    { laserOn: true, laserPattern: 'cross', laserColor: 'rgb', laserSpread: 85 }, { bpm: 130, thumbCam: 'foh' }),
  s('hourglass', 'Hourglass', 'kinetic',
    merge({
      layers: [
        { g: 'left', col: K.gold, dim: 0.92, aim: 'air', spread: [5, 0, 8], zoom: 2.3, frost: 0.04 },
        { g: 'right', col: K.royal, dim: 0.92, aim: 'air', spread: [-5, 0, 8], zoom: 2.3, frost: 0.04 },
      ],
      fx: [{ g: 'pods', a: 'dim', w: 'sin', rate: 6, size: 0.45, spread: 360, by: 'pod' }],
      kin: { shape: 'vee', h: 10, amp: -1.2, flip: 0.72, flipMode: 'fan' },
      cyc: cyc(K.gold, K.royal, 0.28),
    }, L.floorUp({ col: K.amber, alt: K.royal, dim: 0.55, rate: 12 })),
    {}, { bpm: 110, thumbCam: 'foh' }),
  s('acidWash', 'Acid Wash', 'extras',
    merge(
      L.ballyhoo({ col: K.uv, alt: K.lime, dim: 0.82, size: 26, rate: 8, zoom: 6.5, tilt: 42, hueSpread: 90, kin: { shape: 'wave', h: 9.8, amp: 1.2, period: 24, roll: 0.28 } }),
      L.floorUp({ col: K.magenta, dim: 0.5, rate: 12 }),
    ),
    { liquidOn: true, liquidPalette: 'acid', liquidLevel: 0.95, liquidSpeed: 1.5, tubesOn: true, tubeLayout: 'truss', tubeLook: 'wave', tubeColor: 'rainbow' }, { bpm: 108, thumbCam: 'foh' }),
  s('supernova', 'Supernova', 'extras',
    merge(
      L.converge({ col: K.gold, alt: K.crimson, dim: 0.95, point: 'air', spread: 16, circle: 12, rate: 4, zoom: 3.2, kin: { shape: 'arch', h: 9.8, amp: 1.4, flip: 0.75, flipMode: 'fan' } }),
      L.floorUp({ col: K.white, alt: K.gold, dim: 0.8, rate: 4 }),
    ),
    { laserOn: true, laserPattern: 'burst', laserColor: 'follow', blindersOn: true, blinderMode: 'phrase' }, { bpm: 126, thumbCam: 'foh' }),
  s('neonRain', 'Neon Rain', 'extras',
    merge(
      L.split({ left: K.pink, right: K.cyan, dim: 0.88, tilt: 34, fan: 28, rate: 6, zoom: 2.2, kin: { shape: 'rake', h: 9.2, amp: 1.5, flip: 0.45, flipMode: 'lattice' } }),
      L.floorUp({ col: K.pink, dim: 0.5, rate: 12 }),
    ),
    { tubesOn: true, tubeLayout: 'columns', tubeLook: 'rain', tubeColor: 'fixed', tubeFixed: '#00d8ff' }, { bpm: 116, thumbCam: 'angle' }),
  s('searchlight', 'Searchlights', 'beams',
    merge(
      L.sweep({ col: K.ice, alt: K.white, dim: 0.95, swing: 32, rate: 8, zoom: 1.6, wave: 'tri', kin: { shape: 'rake', h: 8.6, amp: -1.8, flip: 0.65, flipMode: 'alt' }, cycCol: K.crimson }),
      L.dark({ col: K.crimson, cycCol: K.crimson, floor: 0.45, cycDim: 0.25 }),
    ),
    {}, { bpm: 122, thumbCam: 'angle' }),
  s('fireflies', 'Firefly Canopy', 'mood',
    merge(
      L.rain({ col: K.warm, dim: 0.65, rate: 0.75, zoom: 1.8, tilt: 14, kin: { shape: 'breathe', h: 10.4, amp: 0.9, period: 64, roll: 0.16 }, cycCol: K.teal }),
      L.floorUp({ col: K.teal, dim: 0.3, fan: 16, rate: 32 }),
    ),
    { tubesOn: true, tubeLayout: 'canopy', tubeLook: 'sparkle', tubeColor: 'fixed', tubeFixed: '#ffd6a0', tubeLevel: 0.75 }, { bpm: 92, thumbCam: 'audience' }),
  s('twinMoons', 'Twin Moons', 'mood',
    merge(
      L.fan({ col: K.lav, alt: K.pink, dim: 0.68, tilt: 34, fan: 26, zoom: 5.5, chase: { rate: 16, by: 'center', size: 0.5 }, kin: { shape: 'arch', h: 10.4, amp: 1.5, roll: -0.22 } }),
      L.floorUp({ col: K.violet, dim: 0.4, rate: 24 }),
    ),
    { ballCount: '2', ballColor: 'fixed', ballFixed: '#b89cff', ballSpin: 1.5 }, { bpm: 98, thumbCam: 'foh' }),
  s('cyberPulse', 'Robot Strobe', 'extras',
    merge(
      L.fan({ col: K.cyan, alt: K.white, dim: 0.92, tilt: 42, fan: 36, zoom: 2.6, chase: { w: 'square', rate: 1, spread: 360, by: 'pod', size: 0.9 }, kin: { shape: 'flat', h: 9.0, flip: 0.85, flipMode: 'lattice', flipWave: 0.25, period: 8 } }),
      L.floorUp({ col: K.cyan, dim: 0.75, rate: 2 }),
    ),
    { laserOn: true, laserPattern: 'chase', laserColor: 'follow', laserChop: true, tubesOn: true, tubeLayout: 'truss', tubeLook: 'chase', tubeColor: 'white' }, { bpm: 124, thumbCam: 'foh' }),
  s('encore', 'Acoustic Glow', 'mood',
    merge(
      L.wash({ col: K.amber, dim: 0.28, g: 'back', zoom: 32 }),
      L.specials({ col: K.warm, dim: 0.78, zoom: 6 }),
      { cyc: cyc(K.amber, K.black, 0.15), kin: { shape: 'arch', h: 10.8, amp: 0.7 } },
    ),
    { tubesOn: true, tubeLayout: 'curtain', tubeLook: 'sparkle', tubeColor: 'fixed', tubeFixed: '#ffb86c', tubeLevel: 0.45 }, { bpm: 74, thumbCam: 'audience' }),
  s('blackout', 'Blackout', 'mood',
    { layers: [], kin: { shape: 'flat', h: 11 } }),
];
