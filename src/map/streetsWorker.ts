/**
 * Fetches a route's street tiles and builds its catchments off the page's
 * thread (core/people/streetsBuild.ts): for a long route that is seconds of
 * work that would otherwise freeze the twin. Replies once, with the result
 * as flat arrays, or with why it could not.
 */

import type { LatLng } from '@/core/geo/projection';
import { streetLines, type StreetLines } from '@/core/map/streets';
import type { TileId } from '@/core/map/tiles';
import {
  buildStreets,
  streetsState,
  type StreetsRoute,
  type StreetsState,
} from '@/core/people/streetsBuild';
import { tileTemplate } from './tileSource';

export interface StreetsRequest {
  route: StreetsRoute;
  tiles: TileId[];
  origin: LatLng;
}

export type StreetsReply =
  | { ok: true; state: StreetsState; tiles: number; failed: number; points: number }
  | { ok: false; error: string };

/** Tiles fetched at once. */
const PARALLEL = 4;

/** The worker's global scope, typed by hand as in tileWorker.ts (no "webworker" lib beside "dom"). */
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<StreetsRequest>) => void) | null;
  postMessage(message: StreetsReply, transfer?: Transferable[]): void;
};

scope.onmessage = async (e: MessageEvent<StreetsRequest>) => {
  const { route, tiles, origin } = e.data;
  try {
    const template = await tileTemplate();
    const parts: StreetLines[] = [];
    let failed = 0;
    const queue = [...tiles];
    const fetchOne = async (): Promise<void> => {
      for (let t = queue.shift(); t; t = queue.shift()) {
        const url = template
          .replace('{z}', String(t.z))
          .replace('{x}', String(t.x))
          .replace('{y}', String(t.y));
        try {
          const res = await fetch(url);
          // 204 / 404: no data there (edge of coverage), not a failure.
          if (res.status === 204 || res.status === 404) continue;
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          parts.push(streetLines(await res.arrayBuffer(), t, origin));
        } catch {
          failed++;
        }
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, fetchOne));
    if (parts.length === 0) {
      scope.postMessage({
        ok: false,
        error: `no street tiles (${failed} failed)`,
      } satisfies StreetsReply);
      return;
    }
    const c = buildStreets(route, parts);
    const { state, transfer } = streetsState(c);
    scope.postMessage(
      { ok: true, state, tiles: parts.length, failed, points: c.graph.size } satisfies StreetsReply,
      transfer,
    );
  } catch (err) {
    scope.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    } satisfies StreetsReply);
  }
};
