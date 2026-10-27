/**
 * Web Worker: fetch a vector tile and turn it into meshes off the main thread.
 *
 * Protocol (one request in flight per message id):
 *   in   { id, url, tile, origin, route }
 *   out  { id, ok: true, result: TileMeshes }  (buffers transferred, not copied)
 *        { id, ok: false, error }
 */

import type { LatLng, LocalPoint } from '@/core/geo/projection';
import { buildTile, transferables } from '@/core/map/buildTile';
import type { TileId } from '@/core/map/tiles';

export interface TileRequest {
  id: number;
  url: string;
  tile: TileId;
  origin: LatLng;
  route: readonly LocalPoint[];
  pedestrianAreas: readonly (readonly LocalPoint[])[];
}

/**
 * The worker's global scope. Typed by hand because the "webworker" lib cannot
 * be combined with the "dom" lib the rest of the app compiles against.
 */
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<TileRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = async (e: MessageEvent<TileRequest>) => {
  const { id, url, tile, origin, route, pedestrianAreas } = e.data;
  try {
    const res = await fetch(url);
    // 204 / 404 mean "no data here" (open sea, edge of coverage), not an error.
    if (res.status === 204 || res.status === 404) {
      scope.postMessage({ id, ok: true, result: { tile, layers: {}, labels: [] } });
      return;
    }
    if (!res.ok) throw new Error(`Tile ${tile.z}/${tile.x}/${tile.y}: HTTP ${res.status}`);
    const result = buildTile(await res.arrayBuffer(), tile, origin, route, pedestrianAreas);
    scope.postMessage({ id, ok: true, result }, transferables(result));
  } catch (err) {
    scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
