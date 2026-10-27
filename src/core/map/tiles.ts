/**
 * Web Mercator ("slippy map") tile addressing, as used by every OSM-based
 * tile server. Tile (z, x, y): x grows east, y grows south, 2^z tiles per side.
 *
 * Inside a vector tile, coordinates are integers in [0, extent) (usually
 * 4096), with the same orientation as the tile grid.
 */

import type { LatLng, LocalPoint, Projection } from '../geo/projection';

export interface TileId {
  z: number;
  x: number;
  y: number;
}

const DEG = Math.PI / 180;

export const tileKey = (t: TileId): string => `${t.z}/${t.x}/${t.y}`;

/** Fractional tile coordinates of a geographic point. */
export function lngLatToTile(p: LatLng, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const lat = p.lat * DEG;
  return {
    x: ((p.lng + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n,
  };
}

/** Geographic point at fractional tile coordinates (inverse of lngLatToTile). */
export function tileToLngLat(x: number, y: number, z: number): LatLng {
  const n = 2 ** z;
  return {
    lng: (x / n) * 360 - 180,
    lat: Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) / DEG,
  };
}

/** All tiles at zoom z that touch the geographic box [sw, ne]. */
export function tilesInBounds(sw: LatLng, ne: LatLng, z: number): TileId[] {
  const a = lngLatToTile({ lat: ne.lat, lng: sw.lng }, z);
  const b = lngLatToTile({ lat: sw.lat, lng: ne.lng }, z);
  const tiles: TileId[] = [];
  for (let y = Math.floor(a.y); y <= Math.floor(b.y); y++) {
    for (let x = Math.floor(a.x); x <= Math.floor(b.x); x++) tiles.push({ z, x, y });
  }
  return tiles;
}

/**
 * Tiles covering a set of local points plus a margin, nearest to `first`
 * first, so the map fills in where the camera starts.
 */
export function tilesAround(
  points: readonly LocalPoint[],
  projection: Projection,
  marginM: number,
  z: number,
): TileId[] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  // Local -Z is north, so the north-east corner has the smallest z.
  const sw = projection.toGeo({ x: minX - marginM, z: maxZ + marginM });
  const ne = projection.toGeo({ x: maxX + marginM, z: minZ - marginM });
  const first = points[0] ? projection.toGeo(points[0]) : sw;
  const start = lngLatToTile(first, z);
  return tilesInBounds(sw, ne, z).sort(
    (a, b) =>
      Math.hypot(a.x + 0.5 - start.x, a.y + 0.5 - start.y) -
      Math.hypot(b.x + 0.5 - start.x, b.y + 0.5 - start.y),
  );
}

/**
 * Converter from a tile's integer coordinates to local scene metres.
 *
 * Mercator is not linear in latitude, but across one z14 tile (~2.4 km) the
 * difference from a linear map is centimetres, so we interpolate linearly
 * between the tile corners. That makes per-vertex conversion two multiply-adds,
 * which matters when a tile has 100k building vertices.
 */
export function tileToLocal(
  tile: TileId,
  extent: number,
  projection: Projection,
): (px: number, py: number) => LocalPoint {
  const nw = projection.toLocal(tileToLngLat(tile.x, tile.y, tile.z));
  const se = projection.toLocal(tileToLngLat(tile.x + 1, tile.y + 1, tile.z));
  const sx = (se.x - nw.x) / extent;
  const sz = (se.z - nw.z) / extent;
  return (px, py) => ({ x: nw.x + px * sx, z: nw.z + py * sz });
}
