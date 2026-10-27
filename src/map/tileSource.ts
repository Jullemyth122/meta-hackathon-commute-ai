/**
 * Loads vector tiles for the 3D map through a small pool of Web Workers.
 *
 * The browser's HTTP cache does the caching (OpenFreeMap serves tiles with a
 * ten-year max-age), so a second visit loads the map from disk, even offline.
 */

import { config } from '@/config';
import type { LatLng, LocalPoint } from '@/core/geo/projection';
import type { TileMeshes } from '@/core/map/buildTile';
import { tileKey, type TileId } from '@/core/map/tiles';
import type { TileRequest } from './tileWorker';

/** OpenMapTiles' most detailed zoom; deeper zooms are just this, enlarged. */
export const MAP_ZOOM = 14;

type Reply =
  { id: number; ok: true; result: TileMeshes } | { id: number; ok: false; error: string };

let templatePromise: Promise<string> | null = null;

/** Tile URL template from the TileJSON. Its path is versioned, so never hard-code it. */
function tileTemplate(): Promise<string> {
  templatePromise ??= fetch(config.mapTiles)
    .then((res) => {
      if (!res.ok) throw new Error(`TileJSON: HTTP ${res.status}`);
      return res.json() as Promise<{ tiles?: string[] }>;
    })
    .then((json) => {
      const url = json.tiles?.[0];
      if (!url) throw new Error('TileJSON has no tile URL');
      return url;
    })
    .catch((err: unknown) => {
      templatePromise = null; // let the next attempt retry
      throw err;
    });
  return templatePromise;
}

export interface TileLoadHandle {
  /** Stop delivering results (already-running fetches finish and are dropped). */
  cancel(): void;
}

/**
 * Load `tiles` in order, calling `onTile` as each one is ready and `onDone`
 * once all have settled. Failed tiles are reported, not retried.
 */
export function loadTiles(
  tiles: readonly TileId[],
  origin: LatLng,
  onTile: (t: TileMeshes) => void,
  onDone: (failed: Array<{ key: string; error: string }>) => void,
  route: readonly LocalPoint[] = [],
  pedestrianAreas: readonly (readonly LocalPoint[])[] = [],
): TileLoadHandle {
  let cancelled = false;
  const workers: Worker[] = [];
  const failed: Array<{ key: string; error: string }> = [];

  void tileTemplate()
    .then((template) => {
      if (cancelled) return;
      const queue = [...tiles];
      const poolSize = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
      let active = 0;
      let nextId = 0;

      const retire = (worker: Worker) => {
        worker.terminate();
        if (--active === 0 && !cancelled) onDone(failed);
      };

      const pump = (worker: Worker) => {
        const tile = queue.shift();
        if (!tile || cancelled) return retire(worker);
        const url = template
          .replace('{z}', String(tile.z))
          .replace('{x}', String(tile.x))
          .replace('{y}', String(tile.y));
        const request: TileRequest = { id: nextId++, url, tile, origin, route, pedestrianAreas };
        worker.onmessage = (e: MessageEvent<Reply>) => {
          if (cancelled) return;
          if (e.data.ok) onTile(e.data.result);
          else failed.push({ key: tileKey(tile), error: e.data.error });
          pump(worker);
        };
        worker.postMessage(request);
      };

      for (let i = 0; i < poolSize && i < tiles.length; i++) {
        const worker = new Worker(new URL('./tileWorker.ts', import.meta.url), { type: 'module' });
        // A crashed worker takes its in-flight tile with it; the others carry on.
        worker.onerror = (e) => {
          e.preventDefault();
          failed.push({ key: 'worker', error: e.message });
          retire(worker);
        };
        workers.push(worker);
        active++;
        pump(worker);
      }
      if (tiles.length === 0) onDone(failed);
    })
    .catch((err: unknown) => {
      if (!cancelled) onDone([{ key: 'tilejson', error: String(err) }]);
    });

  return {
    cancel() {
      cancelled = true;
      workers.forEach((w) => w.terminate());
    },
  };
}
