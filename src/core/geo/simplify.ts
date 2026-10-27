/**
 * Ramer–Douglas–Peucker simplification. Turns a noisy 1 Hz GPS trace into a
 * route polyline with far fewer vertices while staying within `toleranceM`.
 */

import type { LocalPoint } from './projection';

function perpendicularDistance(p: LocalPoint, a: LocalPoint, b: LocalPoint): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len === 0) return Math.hypot(p.x - a.x, p.z - a.z);
  return Math.abs(dz * p.x - dx * p.z + b.x * a.z - b.z * a.x) / len;
}

export function simplify<T extends LocalPoint>(points: readonly T[], toleranceM: number): T[] {
  if (points.length < 3) return points.slice();

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  // Iterative, so a 10 000-point trace cannot blow the call stack.
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = perpendicularDistance(points[i]!, points[first]!, points[last]!);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (index !== -1 && maxDist > toleranceM) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}
