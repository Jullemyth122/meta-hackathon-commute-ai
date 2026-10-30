/**
 * Where a route passes a place: every stretch of the path within `within`
 * metres of point `p`, as the along-route position of its closest point.
 *
 * A loop route's way out and way back often run along the same road, or
 * parallel ones: a driver who keeps the jeepney beside that road reaches it
 * from whichever passes comes first, not only from the one it set out on.
 */

import type { Polyline } from './polyline';
import type { LocalPoint } from './projection';

/** Two passes closer than this along the route are one (metres). */
const SAME_PASS_M = 200;

export function passesNear(line: Polyline, p: LocalPoint, within: number): number[] {
  const out: Array<{ s: number; d: number }> = [];
  const pts = line.points;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2)) : 0;
    const d = Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
    if (d > within) continue;
    const s = line.cumulative[i]! + (line.cumulative[i + 1]! - line.cumulative[i]!) * t;
    const last = out[out.length - 1];
    if (last && s - last.s < SAME_PASS_M) {
      if (d < last.d) out[out.length - 1] = { s, d };
    } else out.push({ s, d });
  }
  // On a loop the end meets the start: one pass, not two.
  if (out.length > 1 && line.length - out[out.length - 1]!.s + out[0]!.s < SAME_PASS_M) {
    const [first, last] = [out[0]!, out[out.length - 1]!];
    out.pop();
    if (last.d < first.d) out[0] = last;
  }
  return out.map((x) => x.s);
}
