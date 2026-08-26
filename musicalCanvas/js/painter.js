/*
 * Lays a finished set of strokes onto the canvas.
 *
 * Shared by the two generators. Timing is staged as though a hand had drawn
 * the strokes in order at the current tempo, so a saved generated set replays
 * the way a painted one does. Distance along the path drives the clock rather
 * than beat position -- a picture stroke can double back on itself, and a
 * stroke's recorded timing has to keep moving forwards.
 */

import { clamp } from './music.js';

const PAUSE_BETWEEN = 120;      // ms of "lifting the brush" between strokes

export function paintStrokes(scene, settings, strokes) {
  scene.clear();                       // snapshots first, so undo still works
  Object.assign(scene.settings, settings);
  scene.createdAt = Date.now();
  scene.invalidate();

  const rows = settings.rows;
  const msPerBeat = 60000 / settings.bpm;
  let stagedAt = 0;

  for (const { brush, pts } of strokes) {
    if (!pts || !pts.length) continue;
    const stroke = scene.beginStroke(brush, { snapshot: false });
    stroke.at = stagedAt;
    stroke.t0 = scene.createdAt + stagedAt;

    let travelled = 0;
    pts.forEach((p, i) => {
      const prev = pts[i - 1] || p;
      const db = Math.abs(p.b - prev.b);
      const dy = Math.abs(p.y - prev.y) * (rows / 8);   // rows read as beats-ish
      travelled += Math.hypot(db, dy);
      const rate = Math.abs(p.y - prev.y) * rows / Math.max(db, 1e-6);
      scene.addPoint(stroke, p.b, p.y, travelled * msPerBeat,
        clamp(0.2 + rate / 12, 0, 1));
    });

    scene.endStroke(stroke, { snapshot: false });
    stagedAt += travelled * msPerBeat + PAUSE_BETWEEN;
  }
}
