import type { LocalPoint } from '../geo/projection';
import { MeshBuilder } from './meshBuilder';

type Ring = readonly LocalPoint[];
type Triangle = readonly [LocalPoint, LocalPoint, LocalPoint];
const CELL_M = 64;
const EPS = 1e-7;

function cross(a: LocalPoint, b: LocalPoint, p: LocalPoint): number {
  return (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
}

function onSegment(a: LocalPoint, b: LocalPoint, p: LocalPoint): boolean {
  return (
    Math.abs(cross(a, b, p)) <= EPS &&
    p.x >= Math.min(a.x, b.x) - EPS &&
    p.x <= Math.max(a.x, b.x) + EPS &&
    p.z >= Math.min(a.z, b.z) - EPS &&
    p.z <= Math.max(a.z, b.z) + EPS
  );
}

function intersects(a: LocalPoint, b: LocalPoint, c: LocalPoint, d: LocalPoint): boolean {
  if (onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b))
    return true;
  return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
}

function inRing(p: LocalPoint, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j]!;
    const b = ring[i]!;
    if (onSegment(a, b, p)) return true;
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x)
      inside = !inside;
  }
  return inside;
}

function overlaps(triangle: Triangle, rings: readonly Ring[]): boolean {
  // Containment in either direction; holes are open courtyards, not walls.
  if (triangle.some((p) => inRing(p, rings[0]!) && !rings.slice(1).some((hole) => inRing(p, hole))))
    return true;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      if (inRing(a, triangle)) return true;
      for (let j = 0; j < 3; j++) {
        if (intersects(a, b, triangle[j]!, triangle[(j + 1) % 3]!)) return true;
      }
    }
  }
  return false;
}

function cells(points: Ring): string[] {
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const keys: string[] = [];
  for (let x = Math.floor(minX / CELL_M); x <= Math.floor(maxX / CELL_M); x++) {
    for (let z = Math.floor(minZ / CELL_M); z <= Math.floor(maxZ / CELL_M); z++)
      keys.push(`${x}/${z}`);
  }
  return keys;
}

/** Static worker-side footprint checks against the same ribbons used to draw roads. */
export class RoadClearance {
  private readonly grid = new Map<string, Triangle[]>();

  add(line: Ring, width: number): void {
    const builder = new MeshBuilder();
    builder.ribbon(line, width, 0, [0, 0, 0]);
    const mesh = builder.build();
    if (!mesh) return;
    for (let i = 0; i < mesh.index.length; i += 3) {
      const point = (j: number): LocalPoint => {
        const index = mesh.index[i + j]! * 3;
        return { x: mesh.position[index]!, z: mesh.position[index + 2]! };
      };
      const triangle: Triangle = [point(0), point(1), point(2)];
      if (Math.abs(cross(...triangle)) < EPS) continue;
      for (const key of cells(triangle)) {
        const bucket = this.grid.get(key) ?? [];
        bucket.push(triangle);
        this.grid.set(key, bucket);
      }
    }
  }

  intersects(rings: readonly Ring[]): boolean {
    if (!rings[0]?.length) return false;
    const checked = new Set<Triangle>();
    for (const key of cells(rings[0])) {
      for (const triangle of this.grid.get(key) ?? []) {
        if (checked.has(triangle)) continue;
        checked.add(triangle);
        if (overlaps(triangle, rings)) return true;
      }
    }
    return false;
  }
}
