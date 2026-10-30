/**
 * A long-lived pool of tile workers for a map that follows the camera.
 *
 * Unlike loadTiles (one batch, workers retired after), tiles are asked for
 * and dropped continually as the view moves: the queue is re-prioritised
 * on every update (nearest first), tiles no longer wanted are dropped before
 * they start, and results for dropped tiles are discarded.
 */

import { config } from '@/config';
import type { LatLng, LocalPoint } from '@/core/geo/projection';
import type { TileMeshes } from '@/core/map/buildTile';
import { tileKey, type TileId } from '@/core/map/tiles';
import type { TileRequest } from './tileWorker';

type Reply =
  { id: number; ok: true; result: TileMeshes } | { id: number; ok: false; error: string };

interface Job {
  tile: TileId;
  key: string;
  route: readonly LocalPoint[];
  pedestrianAreas: readonly (readonly LocalPoint[])[];
}

export class TileStreamer {
  private readonly workers: Worker[] = [];
  private readonly idle: Worker[] = [];
  private queue: Job[] = [];
  /** Tiles being built: key → request id (a newer request for the key wins). */
  private readonly running = new Map<string, number>();
  private nextId = 0;
  private template: string | null = null;
  private disposed = false;

  constructor(
    private readonly origin: LatLng,
    private readonly onTile: (key: string, t: TileMeshes) => void,
    private readonly onError: (key: string, error: string) => void,
    poolSize = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1)),
  ) {
    void fetch(config.mapTiles)
      .then((res) => {
        if (!res.ok) throw new Error(`TileJSON: HTTP ${res.status}`);
        return res.json() as Promise<{ tiles?: string[] }>;
      })
      .then((json) => {
        this.template = json.tiles?.[0] ?? null;
        if (!this.template) throw new Error('TileJSON has no tile URL');
        this.pump();
      })
      .catch((err: unknown) => this.onError('tilejson', String(err)));
    for (let i = 0; i < poolSize; i++) {
      const w = new Worker(new URL('./tileWorker.ts', import.meta.url), { type: 'module' });
      w.onerror = (e) => {
        e.preventDefault();
        this.onError('worker', e.message);
      };
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  /** Wanted tiles, most wanted first. Anything queued but not in the list is dropped. */
  want(jobs: Array<Omit<Job, 'key'>>): void {
    this.queue = jobs
      .map((j) => ({ ...j, key: tileKey(j.tile) }))
      .filter((j) => !this.running.has(j.key));
    this.pump();
  }

  /** Forget a tile being built: its result will be discarded. */
  drop(key: string): void {
    this.running.delete(key);
  }

  get busy(): number {
    return this.running.size + this.queue.length;
  }

  private pump(): void {
    if (!this.template || this.disposed) return;
    while (this.idle.length > 0 && this.queue.length > 0) {
      const job = this.queue.shift()!;
      const worker = this.idle.pop()!;
      const id = this.nextId++;
      this.running.set(job.key, id);
      const url = this.template
        .replace('{z}', String(job.tile.z))
        .replace('{x}', String(job.tile.x))
        .replace('{y}', String(job.tile.y));
      worker.onmessage = (e: MessageEvent<Reply>) => {
        this.idle.push(worker);
        const current = this.running.get(job.key) === id;
        if (current) this.running.delete(job.key);
        if (current && !this.disposed) {
          if (e.data.ok) this.onTile(job.key, e.data.result);
          else this.onError(job.key, e.data.error);
        }
        this.pump();
      };
      const request: TileRequest = {
        id,
        url,
        tile: job.tile,
        origin: this.origin,
        route: job.route,
        pedestrianAreas: job.pedestrianAreas,
      };
      worker.postMessage(request);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.workers.forEach((w) => w.terminate());
  }
}
