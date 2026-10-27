/**
 * Accumulates map geometry into flat typed arrays: one buffer per layer per
 * tile, so a whole tile of roads or buildings is a single draw call.
 *
 * Output layout (all transferable between threads without copying):
 *   position  Float32 xyz
 *   normal    Float32 xyz
 *   color     Uint8   rgba (normalised; alpha unused)
 *   index     Uint32  triangles, counter-clockwise seen from the normal side
 *
 * Coordinates are local scene metres: +X east, +Y up, +Z south.
 */

import earcut from 'earcut';
import type { LocalPoint } from '../geo/projection';

export interface MeshData {
  position: Float32Array;
  normal: Float32Array;
  color: Uint8Array;
  index: Uint32Array;
}

/** [r, g, b] in 0..255. */
export type Rgb = readonly [number, number, number];

export class MeshBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  private vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, c: Rgb) {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.col.push(c[0], c[1], c[2], 255);
  }

  /**
   * A flat strip of `width` metres along a line, at height y. Each end is
   * pushed out by half the width so strips meeting at a junction overlap
   * instead of leaving a notch.
   */
  ribbon(line: readonly LocalPoint[], width: number, y: number, color: Rgb): void {
    const n = line.length;
    if (n < 2) return;
    const half = width / 2;
    const base = this.vertexCount;

    for (let i = 0; i < n; i++) {
      // Direction averaged over the neighbouring segments gives a smooth join.
      const prev = line[Math.max(0, i - 1)]!;
      const next = line[Math.min(n - 1, i + 1)]!;
      let dx = next.x - prev.x;
      let dz = next.z - prev.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;

      const p = line[i]!;
      const cap = i === 0 ? -half : i === n - 1 ? half : 0;
      const cx = p.x + dx * cap;
      const cz = p.z + dz * cap;
      // Left of travel in X–Z (seen from above, +Z south): (dz, -dx).
      this.vertex(cx + dz * half, y, cz - dx * half, 0, 1, 0, color);
      this.vertex(cx - dz * half, y, cz + dx * half, 0, 1, 0, color);
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2;
      // (left0, right0, left1) and (right0, right1, left1): counter-clockwise from +Y.
      this.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  /** A filled horizontal polygon (outer ring + holes) at height y, facing up. */
  polygon(rings: ReadonlyArray<readonly LocalPoint[]>, y: number, color: Rgb): void {
    const { flat, holes } = flatten(rings);
    if (flat.length < 6) return;
    const base = this.vertexCount;
    for (let i = 0; i < flat.length; i += 2) this.vertex(flat[i]!, y, flat[i + 1]!, 0, 1, 0, color);
    this.pushUpFacing(base, earcut(flat, holes), flat);
  }

  /**
   * An extruded building: walls from minY to maxY around every ring, plus a
   * flat roof. Walls get their own vertices so each face shades flat.
   */
  extrusion(
    rings: ReadonlyArray<readonly LocalPoint[]>,
    minY: number,
    maxY: number,
    wall: Rgb,
    roof: Rgb,
  ): void {
    rings.forEach((ring, ri) => {
      const n = closedLength(ring);
      if (n < 3) return;
      // Outer ring walls face away from its interior; hole walls face into
      // the hole (a courtyard). Which way is "away" depends on winding.
      const sign = (signedArea(ring) > 0 ? 1 : -1) * (ri === 0 ? 1 : -1);
      for (let i = 0; i < n; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % n]!;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const len = Math.hypot(dx, dz);
        if (len < 1e-6) continue;
        const nx = (dz / len) * sign;
        const nz = (-dx / len) * sign;
        const v = this.vertexCount;
        this.vertex(a.x, minY, a.z, nx, 0, nz, wall);
        this.vertex(b.x, minY, b.z, nx, 0, nz, wall);
        this.vertex(b.x, maxY, b.z, nx, 0, nz, wall);
        this.vertex(a.x, maxY, a.z, nx, 0, nz, wall);
        // Triangle (a, b, b') faces (-dz, 0, dx); flip when that is inward.
        if (-dz * nx + dx * nz > 0) this.idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
        else this.idx.push(v, v + 2, v + 1, v, v + 3, v + 2);
      }
    });
    this.polygon(rings, maxY, roof);
  }

  /** Hand the buffers over and reset. Returns null when nothing was added. */
  build(): MeshData | null {
    if (this.idx.length === 0) return null;
    const out: MeshData = {
      position: new Float32Array(this.pos),
      normal: new Float32Array(this.nrm),
      color: new Uint8Array(this.col),
      index: new Uint32Array(this.idx),
    };
    this.pos = [];
    this.nrm = [];
    this.col = [];
    this.idx = [];
    return out;
  }

  /** Earcut does not promise a winding, so orient every triangle to face +Y. */
  private pushUpFacing(base: number, tris: number[], flat: number[]): void {
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t]!;
      const b = tris[t + 1]!;
      const c = tris[t + 2]!;
      // y of (B - A) × (C - A); positive means counter-clockwise from above.
      const cross =
        (flat[b * 2 + 1]! - flat[a * 2 + 1]!) * (flat[c * 2]! - flat[a * 2]!) -
        (flat[b * 2]! - flat[a * 2]!) * (flat[c * 2 + 1]! - flat[a * 2 + 1]!);
      if (cross >= 0) this.idx.push(base + a, base + b, base + c);
      else this.idx.push(base + a, base + c, base + b);
    }
  }
}

/** Vector-tile rings repeat the first point at the end; ignore that copy. */
function closedLength(ring: readonly LocalPoint[]): number {
  const n = ring.length;
  if (n > 1 && ring[0]!.x === ring[n - 1]!.x && ring[0]!.z === ring[n - 1]!.z) return n - 1;
  return n;
}

/** Twice the signed area in X–Z; positive = clockwise seen from above (+Z south). */
export function signedArea(ring: readonly LocalPoint[]): number {
  const n = closedLength(ring);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    sum += a.x * b.z - b.x * a.z;
  }
  return sum;
}

function flatten(rings: ReadonlyArray<readonly LocalPoint[]>): { flat: number[]; holes: number[] } {
  const flat: number[] = [];
  const holes: number[] = [];
  rings.forEach((ring, ri) => {
    if (ri > 0) holes.push(flat.length / 2);
    const n = closedLength(ring);
    for (let i = 0; i < n; i++) flat.push(ring[i]!.x, ring[i]!.z);
  });
  return { flat, holes };
}
