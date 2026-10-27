import { describe, expect, it } from 'vitest';
import { PbfWriter } from 'pbf';
import { createProjection, type LocalPoint } from '../geo/projection';
import { RoadClearance } from './roadClearance';
import { buildTile } from './buildTile';
import { tileToLocal } from './tiles';

const rectangle = (x: number, z: number, w: number, h: number): LocalPoint[] => [
  { x, z },
  { x: x + w, z },
  { x: x + w, z: z + h },
  { x, z: z + h },
];

describe('building clearance', () => {
  it('checks full walls and corners, not just the building centre', () => {
    const roads = new RoadClearance();
    roads.add(
      [
        { x: 0, z: 0 },
        { x: 100, z: 0 },
      ],
      12,
    );
    expect(roads.intersects([rectangle(40, 5, 30, 40)])).toBe(true);
    expect(roads.intersects([rectangle(40, 6.1, 30, 40)])).toBe(false);
    // A long wall crosses the entire road with every corner outside it.
    expect(roads.intersects([rectangle(40, -40, 2, 80)])).toBe(true);
    expect(roads.intersects([rectangle(-20, -20, 140, 40)])).toBe(true);
  });

  it('covers bends, junctions, square caps and spatial-index boundaries', () => {
    const roads = new RoadClearance();
    roads.add(
      [
        { x: 0, z: 0 },
        { x: 64, z: 0 },
        { x: 64, z: 64 },
      ],
      12,
    );
    roads.add(
      [
        { x: 30, z: -30 },
        { x: 30, z: 30 },
      ],
      8,
    );
    for (const p of [
      [64, 20],
      [62, 0],
      [-5.9, -5.9],
      [29, -20],
      [62, 68],
    ]) {
      expect(roads.intersects([rectangle(p[0]!, p[1]!, 0.5, 0.5)])).toBe(true);
    }
    expect(roads.intersects([rectangle(80, 20, 5, 5)])).toBe(false);
  });

  it('preserves buildings around an open courtyard and handles closed/reversed rings', () => {
    const roads = new RoadClearance();
    roads.add(
      [
        { x: -2, z: 0 },
        { x: 2, z: 0 },
      ],
      2,
    );
    const outer = rectangle(-20, -20, 40, 40);
    const hole = rectangle(-10, -10, 20, 20);
    expect(roads.intersects([outer, hole])).toBe(false);
    expect(roads.intersects([[...outer, outer[0]!].reverse()])).toBe(true);
    roads.add(
      [
        { x: 0, z: 0 },
        { x: 30, z: 0 },
      ],
      2,
    );
    expect(roads.intersects([outer, hole])).toBe(true);
  });

  it('handles duplicate road points, empty geometry and kilometre-scale coordinates', () => {
    const roads = new RoadClearance();
    roads.add([], 12);
    roads.add(
      [
        { x: 0, z: 0 },
        { x: 0, z: 0 },
      ],
      12,
    );
    expect(roads.intersects([])).toBe(false);
    roads.add(
      [
        { x: -6000, z: 7000 },
        { x: -5900, z: 7000 },
      ],
      12,
    );
    expect(roads.intersects([rectangle(-5950, 7005, 4, 4)])).toBe(true);
    expect(roads.intersects([rectangle(-5950, 7007, 4, 4)])).toBe(false);
  });
});

/** Minimal real vector tile: two buildings, optionally a road through one. */
function fixture(withRoad: boolean): ArrayBuffer {
  const pbf = new PbfWriter();
  const zig = (n: number) => (n << 1) ^ (n >> 31);
  const feature = (points: LocalPoint[], polygon: boolean, writer: PbfWriter) => {
    writer.writeVarintField(3, polygon ? 3 : 2);
    if (!polygon) writer.writePackedVarint(2, [0, 0]);
    const commands = [9, zig(points[0]!.x), zig(points[0]!.z), ((points.length - 1) << 3) | 2];
    for (let i = 1; i < points.length; i++) {
      commands.push(zig(points[i]!.x - points[i - 1]!.x), zig(points[i]!.z - points[i - 1]!.z));
    }
    if (polygon) commands.push(15);
    writer.writePackedVarint(4, commands);
  };
  pbf.writeMessage(
    3,
    (_, layer) => {
      layer.writeVarintField(15, 2);
      layer.writeStringField(1, 'building');
      layer.writeVarintField(5, 4096);
      for (const z of [2040, 2140]) {
        layer.writeMessage(2, (_, f) => feature(rectangle(2000, z, 40, 40), true, f), null);
      }
    },
    null,
  );
  if (withRoad)
    pbf.writeMessage(
      3,
      (_, layer) => {
        layer.writeVarintField(15, 2);
        layer.writeStringField(1, 'transportation');
        layer.writeVarintField(5, 4096);
        layer.writeStringField(3, 'class');
        layer.writeMessage(4, (_, v) => v.writeStringField(1, 'primary'), null);
        layer.writeMessage(
          2,
          (_, f) =>
            feature(
              [
                { x: 0, z: 2048 },
                { x: 4096, z: 2048 },
              ],
              false,
              f,
            ),
          null,
        );
      },
      null,
    );
  return new Uint8Array(pbf.finish()).buffer;
}

describe('tile building exclusion integration', () => {
  const tile = { x: 13701, y: 7510, z: 14 };
  const origin = { lat: 14.7335, lng: 121.0584 };

  it('omits the overlapping building but preserves the neighbouring footprint', () => {
    const before = buildTile(fixture(false), tile, origin);
    const after = buildTile(fixture(true), tile, origin);
    expect(after.layers.roadFill).toBeDefined();
    expect(after.layers.buildings!.index.length).toBe(before.layers.buildings!.index.length / 2);
    const local = tileToLocal(tile, 4096, createProjection(origin));
    const positions = after.layers.buildings!.position;
    const minZ = Math.min(...Array.from(positions).filter((_, i) => i % 3 === 2));
    expect(minZ).toBeCloseTo(local(2000, 2140).z, 3);
  });

  it('protects the route even when the tile has no transportation layer', () => {
    const local = tileToLocal(tile, 4096, createProjection(origin));
    const route = [local(-100, 2048), local(4200, 2048)];
    const before = buildTile(fixture(false), tile, origin);
    const after = buildTile(fixture(false), tile, origin, route);
    expect(after.layers.buildings!.index.length).toBe(before.layers.buildings!.index.length / 2);
  });
});
