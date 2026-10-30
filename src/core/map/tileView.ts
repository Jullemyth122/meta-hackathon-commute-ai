/**
 * Which map tiles a view wants, around the point it looks at.
 *
 *   near  detailed tiles (zoom 14: roads, land use, buildings) within a
 *         radius that grows as the operator zooms out;
 *   far   coarse tiles (zoom 11: water, land, main roads, no buildings)
 *         for the zoomed-out operator, out to tens of kilometres.
 *
 * Each person sees what they would on the street: the driver about the
 * horizon of their screen, the commuter their neighbourhood, the operator
 * as much as the camera shows. Budgets cap how many tiles are kept, so a
 * long pan around Metro Manila never grows memory.
 */

import type { LatLng } from '../geo/projection';
import { lngLatToTile, tileToLngLat, type TileId } from './tiles';

export type MapView = 'twin' | 'driver' | 'commuter';

export const NEAR_ZOOM = 14;
export const FAR_ZOOM = 11;
/** Most detailed tiles kept loaded (dense Manila tiles carry ~100k building vertices). */
export const NEAR_BUDGET = 24;
export const FAR_BUDGET = 20;
/** The operator gets the coarse map once the camera is this high (metres). */
export const FAR_FROM_M = 1800;

/** Above this the operator cannot see buildings: only the coarse map is loaded (metres). */
export const NEAR_UNTIL_M = 6000;

/** Detailed-map radius (metres) for a view and camera height. */
export function nearRadius(view: MapView, cameraHeightM: number): number {
  if (view === 'driver') return 1700; // the screen's 1.5 km horizon, and a bit
  if (view === 'commuter') return 2500; // their neighbourhood
  if (cameraHeightM > NEAR_UNTIL_M) return 0;
  return Math.max(1500, Math.min(5000, cameraHeightM * 1.3));
}

/** Coarse-map radius (metres), or 0 for none. */
export function farRadius(view: MapView, cameraHeightM: number): number {
  if (view !== 'twin' || cameraHeightM < FAR_FROM_M) return 0;
  return Math.min(60_000, cameraHeightM * 3);
}

const M_PER_DEG_LAT = 111_195;

/** Tiles at zoom z within radius r (metres) of centre, nearest first, at most `max`. */
export function tilesWithin(center: LatLng, radiusM: number, z: number, max: number): TileId[] {
  if (radiusM <= 0) return [];
  const dLat = radiusM / M_PER_DEG_LAT;
  const dLng = radiusM / (M_PER_DEG_LAT * Math.cos((center.lat * Math.PI) / 180));
  const a = lngLatToTile({ lat: center.lat + dLat, lng: center.lng - dLng }, z);
  const b = lngLatToTile({ lat: center.lat - dLat, lng: center.lng + dLng }, z);
  const out: Array<{ t: TileId; d: number }> = [];
  for (let y = Math.floor(a.y); y <= Math.floor(b.y); y++)
    for (let x = Math.floor(a.x); x <= Math.floor(b.x); x++) {
      const c = tileToLngLat(x + 0.5, y + 0.5, z);
      const dy = (c.lat - center.lat) * M_PER_DEG_LAT;
      const dx = (c.lng - center.lng) * M_PER_DEG_LAT * Math.cos((center.lat * Math.PI) / 180);
      out.push({ t: { z, x, y }, d: Math.hypot(dx, dy) });
    }
  return out
    .sort((p, q) => p.d - q.d)
    .slice(0, max)
    .map((p) => p.t);
}

export function wantedTiles(
  center: LatLng,
  view: MapView,
  cameraHeightM: number,
): { near: TileId[]; far: TileId[] } {
  return {
    near: tilesWithin(center, nearRadius(view, cameraHeightM), NEAR_ZOOM, NEAR_BUDGET),
    far: tilesWithin(center, farRadius(view, cameraHeightM), FAR_ZOOM, FAR_BUDGET),
  };
}
