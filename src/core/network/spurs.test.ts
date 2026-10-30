import { describe, expect, it } from 'vitest';
import { Polyline } from '../geo/polyline';
import type { LocalPoint } from '../geo/projection';
import { removeSpurs } from './spurs';

/** A path through these corners, a point every metre. */
function path(...corners: Array<[number, number]>): LocalPoint[] {
  const out: LocalPoint[] = [];
  for (let k = 0; k < corners.length - 1; k++) {
    const [x0, z0] = corners[k]!;
    const [x1, z1] = corners[k + 1]!;
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0)));
    for (let i = 0; i < n; i++)
      out.push({ x: x0 + ((x1 - x0) * i) / n, z: z0 + ((z1 - z0) * i) / n });
  }
  const [x, z] = corners[corners.length - 1]!;
  out.push({ x, z });
  return out;
}

const length = (p: LocalPoint[]) => new Polyline(p).length;

describe('cutting the router’s spurs out of a route’s path', () => {
  it('cuts a U-turn to a stop on the far side of a divided road, and puts the stop back on the road', () => {
    // East along a road; at 1 km over to the far carriageway (20 m), back 150 m
    // to a stop, then on east past where it turned: the router's out-and-back.
    const raw = path([0, 0], [1150, 0], [1150, 20], [1000, 20], [1000, 0], [2000, 0]);
    const stopS = [0, 1150 + 20 + 150, length(raw)]; // the middle one is on the spur
    const out = removeSpurs(raw, stopS, [0]);
    expect(out.spurs).toBeGreaterThan(0);
    // About the road itself (2 km), not the 2.3 km the spur made.
    expect(length(out.points)).toBeLessThan(2050);
    // Stops in order, the one from the spur within a few metres of where it was.
    expect(out.stopS[0]).toBe(0);
    expect(out.stopS[1]).toBeGreaterThan(950);
    expect(out.stopS[1]).toBeLessThan(1060);
    expect(out.stopS[2]).toBeGreaterThan(out.stopS[1]!);
  });

  it('cuts a squiggle across an intersection to the other carriageway and back', () => {
    const raw = path([0, 0], [500, 0], [500, 25], [470, 25], [470, -5], [1000, -5]);
    const out = removeSpurs(raw, [0, length(raw)], [0]);
    expect(out.spurs).toBeGreaterThan(0);
    expect(length(out.points)).toBeLessThan(1010);
  });

  it('keeps real roads: a right-angle corner and a long bend', () => {
    const corner = path([0, 0], [600, 0], [600, 600]);
    expect(removeSpurs(corner, [0, 1200], [0]).spurs).toBe(0);
    const bend: LocalPoint[] = [];
    for (let a = 0; a <= Math.PI; a += 0.01)
      bend.push({ x: 300 * Math.sin(a), z: 300 - 300 * Math.cos(a) });
    expect(removeSpurs(bend, [0, length(bend)], [0]).spurs).toBe(0);
  });

  it('keeps the route’s own turnaround at its terminal', () => {
    // Out 2 km and straight back on the other side: the far terminal is at 2 km.
    const raw = path([0, 0], [2000, 0], [2000, 20], [0, 20]);
    const out = removeSpurs(raw, [0, 2000, length(raw)], [0, 2000]);
    expect(out.spurs).toBe(0);
    expect(length(out.points)).toBeCloseTo(length(raw), 3);
  });
});
