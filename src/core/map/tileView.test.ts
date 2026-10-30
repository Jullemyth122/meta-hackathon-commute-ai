import { describe, expect, it } from 'vitest';
import { lngLatToTile } from './tiles';
import {
  FAR_BUDGET,
  FAR_ZOOM,
  NEAR_BUDGET,
  NEAR_ZOOM,
  farRadius,
  nearRadius,
  tilesWithin,
  wantedTiles,
} from './tileView';

const QUIAPO = { lat: 14.5995, lng: 120.9842 };

describe('which map tiles a view loads', () => {
  it('gives the driver about their horizon, the commuter their neighbourhood', () => {
    expect(nearRadius('driver', 50)).toBeGreaterThanOrEqual(1500);
    expect(nearRadius('commuter', 50)).toBeGreaterThan(nearRadius('driver', 50));
    expect(farRadius('driver', 5000)).toBe(0);
    expect(farRadius('commuter', 5000)).toBe(0);
  });

  it('lets the operator see further as they zoom out, up to a cap', () => {
    expect(nearRadius('twin', 500)).toBeLessThan(nearRadius('twin', 3000));
    expect(nearRadius('twin', 3900)).toBe(5000);
    // So high that buildings are specks: coarse map only.
    expect(nearRadius('twin', 1e6)).toBe(0);
    expect(farRadius('twin', 1000)).toBe(0);
    expect(farRadius('twin', 6000)).toBeGreaterThan(0);
    expect(farRadius('twin', 1e7)).toBe(60_000);
  });

  it('starts with the tile under the camera and never exceeds the budget', () => {
    const { near, far } = wantedTiles(QUIAPO, 'twin', 4000);
    const under = lngLatToTile(QUIAPO, NEAR_ZOOM);
    expect(near[0]).toEqual({ z: NEAR_ZOOM, x: Math.floor(under.x), y: Math.floor(under.y) });
    expect(near.length).toBeLessThanOrEqual(NEAR_BUDGET);
    expect(far.length).toBeLessThanOrEqual(FAR_BUDGET);
    expect(far.every((t) => t.z === FAR_ZOOM)).toBe(true);
  });

  it('lists each tile once, nearest first', () => {
    const tiles = tilesWithin(QUIAPO, 4000, NEAR_ZOOM, 100);
    const keys = tiles.map((t) => `${t.x}/${t.y}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(tiles.length).toBeGreaterThan(4);
    expect(tilesWithin(QUIAPO, 0, NEAR_ZOOM, 10)).toEqual([]);
  });
});
