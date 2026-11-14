// Formations are independent of the renderer. Coordinates are centered on the
// stage, with positive y pointing upward. Every preset works at any drone count.
const TAU = Math.PI * 2;
const line = (...points) => points;
const curve = (fn, steps = 240, start = 0, end = TAU) =>
  Array.from({ length: steps + 1 }, (_, i) => fn(start + (end - start) * i / steps));
const ellipse = (x, y, rx, ry, rotation = 0) => curve(t => {
  const a = rx * Math.cos(t), b = ry * Math.sin(t);
  return [x + a * Math.cos(rotation) - b * Math.sin(rotation), y + a * Math.sin(rotation) + b * Math.cos(rotation)];
});
const polygon = (sides, radius = .76, rotation = Math.PI / 2) =>
  Array.from({ length: sides + 1 }, (_, i) => [radius * Math.cos(rotation + TAU * i / sides), radius * Math.sin(rotation + TAU * i / sides)]);
const star = (points = 5, outer = .85, inner = .37, rotation = Math.PI / 2) =>
  Array.from({ length: points * 2 + 1 }, (_, i) => {
    const r = i % 2 ? inner : outer, a = rotation + Math.PI * i / points;
    return [r * Math.cos(a), r * Math.sin(a)];
  });

// Sample connected paths by arc length. Separate strokes remain separate, so
// drones never fill the gaps between features of a drawing.
function samplePaths(paths, count) {
  const segments = [];
  let total = 0;
  for (const path of paths) for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length > 0) { segments.push({ a, b, start: total, length }); total += length; }
  }
  if (!total) return Array.from({ length: count }, () => [0, 0]);
  let segment = 0;
  return Array.from({ length: count }, (_, i) => {
    const d = (i + .5) * total / count;
    while (segment < segments.length - 1 && d > segments[segment].start + segments[segment].length) segment++;
    const s = segments[segment], t = (d - s.start) / s.length;
    return [s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t];
  });
}
const paths = f => n => samplePaths(f(), n);
const circle = (r = .75) => ellipse(0, 0, r, r);
const pointField = fn => n => Array.from({ length: n }, (_, i) => fn(i, n));
const golden = Math.PI * (3 - Math.sqrt(5));

const definitions = [
  ['orbit', 'Orbit', 'Geometry', 'A quiet circle of light.', paths(() => [circle(.76)])],
  ['concentric', 'Concentric', 'Geometry', 'Three rings, one center.', paths(() => [circle(.82), circle(.56), circle(.3)])],
  ['triangle', 'Triangle', 'Geometry', 'A simple three-sided silhouette.', paths(() => [polygon(3, .88)])],
  ['square', 'Square', 'Geometry', 'Four clean sides.', paths(() => [polygon(4, .94, Math.PI / 4)])],
  ['diamond', 'Diamond', 'Geometry', 'A jewel in the sky.', paths(() => [polygon(4, .87)])],
  ['hexagon', 'Hexagon', 'Geometry', 'Six sides in balance.', paths(() => [polygon(6, .82, 0)])],
  ['star', 'Five-point star', 'Geometry', 'The classic star formation.', paths(() => [star()])],
  ['starburst', 'Starburst', 'Geometry', 'A little extra radiance.', paths(() => [star(12, .85, .56)])],
  ['cube', 'Wireframe cube', 'Geometry', 'A dimensional illusion drawn in light.', paths(() => [
    line([-.72,-.42],[.1,-.42],[.1,.42],[-.72,.42],[-.72,-.42]),
    line([-.1,-.7],[.72,-.7],[.72,.14],[-.1,.14],[-.1,-.7]),
    line([-.72,-.42],[-.1,-.7]), line([.1,-.42],[.72,-.7]), line([.1,.42],[.72,.14]), line([-.72,.42],[-.1,.14])
  ])],
  ['grid', 'Grid', 'Geometry', 'Orderly rows and columns.', pointField((i, n) => {
    const cols = Math.ceil(Math.sqrt(n * 1.35)), rows = Math.ceil(n / cols), row = Math.floor(i / cols), col = i % cols;
    return [cols > 1 ? (col / (cols - 1) - .5) * 1.65 : 0, rows > 1 ? (row / (rows - 1) - .5) * 1.35 : 0];
  })],
  ['spiral', 'Spiral', 'Motion', 'A sweeping spiral trail.', paths(() => [curve(t => { const r = .05 + .75 * t / (TAU * 3); return [r * Math.cos(t), r * Math.sin(t)]; }, 700, 0, TAU * 3)])],
  ['double-spiral', 'Double spiral', 'Motion', 'Two arms winding outward.', paths(() => [0, Math.PI].map(offset => curve(t => { const r = .06 + .72 * t / (TAU * 2.2); return [r * Math.cos(t + offset), r * Math.sin(t + offset)]; }, 500, 0, TAU * 2.2)))],
  ['wave', 'Wave', 'Motion', 'A gentle ribbon across the sky.', paths(() => [curve(t => [t, .32 * Math.sin(t * Math.PI * 2)], 400, -.9, .9)])],
  ['waves', 'Sound waves', 'Motion', 'Three ribbons in harmony.', paths(() => [-.45, 0, .45].map(y => curve(t => [t, y + .17 * Math.sin(t * Math.PI * 2)], 300, -.88, .88)))],
  ['infinity', 'Infinity', 'Motion', 'A loop without an end.', paths(() => [curve(t => [.86 * Math.cos(t) / (1 + Math.sin(t) ** 2), .86 * Math.sin(t) * Math.cos(t) / (1 + Math.sin(t) ** 2)])])],
  ['lissajous', 'Lissajous', 'Motion', 'A woven mathematical curve.', paths(() => [curve(t => [.78 * Math.sin(3*t + Math.PI/2), .7 * Math.sin(2*t)], 700)])],
  ['helix', 'Double helix', 'Motion', 'Two threads twisting together.', paths(() => {
    const a = curve(t => [.31 * Math.sin(t * Math.PI * 3), t], 400, -.78, .78);
    const b = curve(t => [-.31 * Math.sin(t * Math.PI * 3), t], 400, -.78, .78);
    const bars = Array.from({ length: 11 }, (_, i) => { const y = -.75 + i * .15, x = .31 * Math.sin(y * Math.PI * 3); return line([x,y],[-x,y]); });
    return [a,b,...bars];
  })],
  ['galaxy', 'Galaxy', 'Motion', 'A field of stars spiraling outward.', pointField((i,n) => {
    const r = .82 * Math.sqrt((i + .5) / n), a = i * golden + r * 4;
    return [r * Math.cos(a), r * Math.sin(a) * .72];
  })],
  ['heart', 'Heart', 'Icons', 'A familiar shape, written in light.', paths(() => [curve(t => [.052 * 16 * Math.sin(t)**3, .052 * (13*Math.cos(t)-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t)) + .1], 500)])],
  ['smile', 'Smiley', 'Icons', 'A little joy overhead.', paths(() => [circle(.8), ellipse(-.28,.22,.045,.065), ellipse(.28,.22,.045,.065), curve(t => [.42*Math.cos(t), -.03 + .38*Math.sin(t)], 180, Math.PI, TAU)])],
  ['moon', 'Crescent moon', 'Icons', 'A sliver of moonlight.', paths(() => [curve(t => [.72*Math.cos(t), .8*Math.sin(t)], 250, Math.PI/3, 5*Math.PI/3), curve(t => [.36 - .52*Math.sin(Math.PI*t), -.4*Math.sqrt(3) + .8*Math.sqrt(3)*t], 250, 0, 1)])],
  ['sun', 'Sun', 'Icons', 'A bright circle with long rays.', paths(() => [circle(.44), ...Array.from({length:12},(_,i)=>{const a=TAU*i/12;return line([.57*Math.cos(a),.57*Math.sin(a)],[.82*Math.cos(a),.82*Math.sin(a)]);})])],
  ['flower', 'Flower', 'Nature', 'A six-petaled bloom.', paths(() => [curve(t => {const r=.44+.27*Math.cos(6*t);return [r*Math.cos(t),r*Math.sin(t)];}, 600), circle(.13)])],
  ['rose', 'Rose curve', 'Nature', 'Petals from a single equation.', paths(() => [curve(t => {const r=.8*Math.cos(5*t);return [r*Math.cos(t),r*Math.sin(t)];}, 700, 0, Math.PI)])],
  ['butterfly', 'Butterfly', 'Nature', 'A pair of luminous wings.', paths(() => [curve(t => {const r=Math.exp(Math.cos(t))-2*Math.cos(4*t)-Math.sin(t/12)**5;return [.22*r*Math.sin(t), .19*r*Math.cos(t)];}, 900, 0, 12*Math.PI)])],
  ['tree', 'Evergreen', 'Nature', 'A tree with a pointed crown.', paths(() => [line([0,.84],[-.32,.4],[-.17,.4],[-.52,-.02],[-.3,-.02],[-.72,-.52],[.72,-.52],[.3,-.02],[.52,-.02],[.17,.4],[.32,.4],[0,.84]), line([-.13,-.52],[-.13,-.8],[.13,-.8],[.13,-.52])])],
  ['mountains', 'Mountains', 'Nature', 'Peaks on the horizon.', paths(() => [line([-.9,-.52],[-.5,.2],[-.29,-.08],[.04,.62],[.52,-.25],[.68,.02],[.9,-.52],[-.9,-.52]),line([-.1,.32],[.04,.62],[.22,.29]),line([-.62,-.01],[-.5,.2],[-.38,.04])])],
  ['snowflake', 'Snowflake', 'Nature', 'Six delicate branches.', paths(() => Array.from({length:6},(_,i)=>{
    const a=TAU*i/6, unit=[Math.cos(a),Math.sin(a)], side=[-Math.sin(a),Math.cos(a)];
    const p=(r,s=0)=>[r*unit[0]+s*side[0],r*unit[1]+s*side[1]];
    return [line(p(0),p(.82)),line(p(.46,-.17),p(.61),p(.46,.17)),line(p(.25,-.12),p(.37),p(.25,.12))];
  }).flat())],
  ['planet', 'Ringed planet', 'Cosmos', 'A world with a sweeping ring.', paths(() => [circle(.48), ellipse(0,0,.85,.2,.35)])],
  ['comet', 'Comet', 'Cosmos', 'A bright head and a trailing tail.', paths(() => [ellipse(.45,.22,.2,.2),line([.3,.08],[-.8,-.62]),line([.24,.21],[-.84,-.26]),line([.4,.02],[-.4,-.72])])],
  ['rocket', 'Rocket', 'Cosmos', 'Ready for liftoff.', paths(() => [line([0,.86],[-.27,.48],[-.27,-.38],[-.48,-.6],[-.48,-.75],[-.18,-.57],[.18,-.57],[.48,-.75],[.48,-.6],[.27,-.38],[.27,.48],[0,.86]),ellipse(0,.3,.12,.12),line([-.13,-.64],[0,-.86],[.13,-.64])])],
  ['constellation', 'Constellation', 'Cosmos', 'A scattered sky of lights.', pointField((i,n) => {
    // A deterministic low-discrepancy field keeps the sky stable across visits.
    const x = ((i * .754877666 + .13) % 1) * 1.7 - .85;
    const y = ((i * .569840296 + .31) % 1) * 1.45 - .725;
    return [x,y];
  })],
  ['saturn', 'Solar system', 'Cosmos', 'Orbiting worlds around a central sun.', paths(() => [circle(.13),ellipse(0,0,.45,.27,-.3),ellipse(0,0,.82,.49,-.3),ellipse(.4,-.2,.055,.055),ellipse(-.63,.22,.075,.075)])],
  ['firework', 'Firework', 'Celebration', 'A burst frozen in the sky.', paths(() => Array.from({length:18},(_,i)=>{const a=TAU*i/18; const r=i%2?.68:.86; return line([.12*Math.cos(a),.12*Math.sin(a)],[r*Math.cos(a),r*Math.sin(a)]);}))],
  ['confetti', 'Confetti', 'Celebration', 'A joyful scatter of light.', pointField((i,n) => {
    const x = ((i * .618033989 + .17) % 1) * 1.75 - .875;
    const y = ((i * .414213562 + .11) % 1) * 1.5 - .75;
    return [x,y];
  })],
  ['peace', 'Peace', 'Celebration', 'A message everyone recognizes.', paths(() => [circle(.8),line([0,.8],[0,-.8]),line([0,-.12],[-.57,-.57]),line([0,-.12],[.57,-.57])])],
  ['music', 'Music note', 'Celebration', 'A little music in the sky.', paths(() => [ellipse(-.3,-.54,.23,.15,.25),line([-.08,-.54],[-.08,.65],[.54,.8],[.54,-.35]),ellipse(.32,-.35,.23,.15,.25),line([-.08,.4],[.54,.55])])],
];

export const PRESETS = definitions.map(([id, name, category, description]) => ({ id, name, category, description }));

export function makeFormation(id, count) {
  const definition = definitions.find(item => item[0] === id) || definitions[0];
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return definition[4](safeCount);
}
