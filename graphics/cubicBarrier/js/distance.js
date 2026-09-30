// distance.js — closest points between segments and from a point to a segment.
//
// Scalar arguments rather than vectors so the hot loops allocate nothing. The
// closest-point parameters of the last call are left in CP.s and CP.t:
//   p = a + s(b − a),  q = c + t(d − c),  and the return value is |p − q|².

export const CP = { s: 0, t: 0 };

const EPS = 1e-18;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function segSegDist2(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz) {
  const d1x = bx - ax, d1y = by - ay, d1z = bz - az;
  const d2x = dx - cx, d2y = dy - cy, d2z = dz - cz;
  const rx = ax - cx, ry = ay - cy, rz = az - cz;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s, t;
  if (a <= EPS && e <= EPS) {
    s = 0; t = 0;
  } else if (a <= EPS) {
    s = 0; t = clamp01(f / e);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) {
      t = 0; s = clamp01(-c / a);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom > 1e-12 * a * e ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0; s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1; s = clamp01((b - c) / a);
      }
    }
  }
  CP.s = s; CP.t = t;
  const px = ax + s * d1x - cx - t * d2x;
  const py = ay + s * d1y - cy - t * d2y;
  const pz = az + s * d1z - cz - t * d2z;
  return px * px + py * py + pz * pz;
}

export function pointSegDist2(px, py, pz, cx, cy, cz, dx, dy, dz) {
  const ex = dx - cx, ey = dy - cy, ez = dz - cz;
  const e = ex * ex + ey * ey + ez * ez;
  const t = e <= EPS ? 0 : clamp01(((px - cx) * ex + (py - cy) * ey + (pz - cz) * ez) / e);
  CP.s = 0; CP.t = t;
  const qx = px - cx - t * ex, qy = py - cy - t * ey, qz = pz - cz - t * ez;
  return qx * qx + qy * qy + qz * qz;
}
