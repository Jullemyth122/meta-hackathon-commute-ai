/**
 * Finds z-fighting in a vehicle's geometry: two faces of different material
 * slots in the same plane (within PLANE_TOLERANCE_M), facing the same way,
 * overlapping by more than MIN_OVERLAP_M2. The renderer cannot tell which is
 * in front, so the two flicker through each other as the camera moves.
 * Faces in one slot share a material, so their overlaps cannot be seen; nor
 * can faces pressed against a face looking the other way (two boxes
 * touching, inside a wall). Only axis-aligned faces are checked: every flat
 * panel here is a box.
 */

import type { VehicleParts, Slot } from './bodyKit';

const PLANE_TOLERANCE_M = 0.0015;
const MIN_OVERLAP_M2 = 0.0001;

interface Flat {
  slot: Slot;
  /** The triangle in the plane's two other axes. */
  pts: [number, number][];
  plane: number;
}

export interface Fight {
  slots: [Slot, Slot];
  /** Where (a point in both faces). */
  at: [number, number, number];
}

function inside(p: [number, number], t: [number, number][]): boolean {
  const [a, b, c] = t as [[number, number], [number, number], [number, number]];
  const s = (u: [number, number], v: [number, number]) =>
    (v[0] - u[0]) * (p[1] - u[1]) - (v[1] - u[1]) * (p[0] - u[0]);
  const d1 = s(a, b);
  const d2 = s(b, c);
  const d3 = s(c, a);
  const eps = 1e-9;
  return (d1 > eps && d2 > eps && d3 > eps) || (d1 < -eps && d2 < -eps && d3 < -eps);
}

export function zFights(parts: VehicleParts): Fight[] {
  // Faces by the way they face (axis and sign).
  const groups = new Map<string, Flat[]>();
  for (const [slot, g] of Object.entries(parts) as [Slot, NonNullable<VehicleParts[Slot]>][]) {
    const pos = g.attributes.position!.array as Float32Array;
    for (let i = 0; i < pos.length; i += 9) {
      const p = [0, 3, 6].map((o) => [pos[i + o]!, pos[i + o + 1]!, pos[i + o + 2]!]);
      const e1 = [0, 1, 2].map((k) => p[1]![k]! - p[0]![k]!);
      const e2 = [0, 1, 2].map((k) => p[2]![k]! - p[0]![k]!);
      const n = [
        e1[1]! * e2[2]! - e1[2]! * e2[1]!,
        e1[2]! * e2[0]! - e1[0]! * e2[2]!,
        e1[0]! * e2[1]! - e1[1]! * e2[0]!,
      ];
      const len = Math.hypot(n[0]!, n[1]!, n[2]!);
      if (len < 1e-12) continue;
      const axis = [0, 1, 2].find((k) => Math.abs(n[k]!) / len > 0.9999);
      if (axis === undefined) continue;
      const [u, v] = [0, 1, 2].filter((k) => k !== axis) as [number, number];
      const key = `${axis}${Math.sign(n[axis]!)}`;
      const list = groups.get(key) ?? [];
      list.push({ slot, plane: p[0]![axis]!, pts: p.map((q) => [q[u]!, q[v]!]) });
      groups.set(key, list);
    }
  }
  const fights: Fight[] = [];
  const seen = new Set<string>();
  for (const [key, flats] of groups) {
    const axis = Number(key[0]);
    flats.sort((a, b) => a.plane - b.plane);
    for (let i = 0; i < flats.length; i++) {
      const A = flats[i]!;
      for (let j = i + 1; j < flats.length && flats[j]!.plane - A.plane <= PLANE_TOLERANCE_M; j++) {
        const B = flats[j]!;
        if (A.slot === B.slot) continue;
        const lo = [0, 1].map((k) =>
          Math.max(Math.min(...A.pts.map((q) => q[k]!)), Math.min(...B.pts.map((q) => q[k]!))),
        );
        const hi = [0, 1].map((k) =>
          Math.min(Math.max(...A.pts.map((q) => q[k]!)), Math.max(...B.pts.map((q) => q[k]!))),
        );
        if ((hi[0]! - lo[0]!) * (hi[1]! - lo[1]!) < MIN_OVERLAP_M2) continue;
        // A point inside both triangles?
        const N = 5;
        let hit: [number, number] | null = null;
        for (let a = 1; a < N && !hit; a++)
          for (let b = 1; b < N && !hit; b++) {
            const q: [number, number] = [
              lo[0]! + ((hi[0]! - lo[0]!) * a) / N,
              lo[1]! + ((hi[1]! - lo[1]!) * b) / N,
            ];
            if (inside(q, A.pts) && inside(q, B.pts)) hit = q;
          }
        if (!hit) continue;
        // Covered: a face looking the other way at the same place (boxes touching).
        const flip = groups.get(`${axis}${key[1] === '-' ? '1' : '-1'}`) ?? [];
        const q = hit;
        if (flip.some((F) => Math.abs(F.plane - A.plane) <= PLANE_TOLERANCE_M && inside(q, F.pts)))
          continue;
        const at: [number, number, number] = [0, 0, 0];
        const [u, v] = [0, 1, 2].filter((k) => k !== axis) as [number, number];
        at[axis] = A.plane;
        at[u] = hit[0];
        at[v] = hit[1];
        const id = `${[A.slot, B.slot].sort().join('/')}@${at.map((c) => c.toFixed(1)).join(',')}`;
        if (seen.has(id)) continue;
        seen.add(id);
        fights.push({ slots: [A.slot, B.slot], at });
      }
    }
  }
  return fights;
}
