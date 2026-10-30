/**
 * The streets people walk (and tricycles drive) to a jeepney stop, from the
 * same vector tiles the 3D map is drawn from: so a commuter coming from home
 * follows a street you can see on the map.
 *
 * The roads people walk and tricycles run on: secondary and tertiary roads,
 * minor and service streets, tracks and footpaths. National roads (primary,
 * trunk) come too, marked: tricycles are barred from them and the jeepney
 * routes run on them, so the everyday crowd comes by the side streets
 * (streetGraph.ts), but someone setting out from a spot of their own walks
 * along a highway's pavement where no side street goes. Motorways are left
 * out: nobody walks the expressway.
 *
 * Runs in the tile workers (src/map/tileWorker.ts) when asked for streets
 * only; a pure function of its inputs, so testable in Node.
 */

import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { createProjection, type LatLng, type LocalPoint } from '../geo/projection';
import { ROADS, roadClass, roadWidth } from './style';
import { tileToLocal, type TileId } from './tiles';

/** OpenMapTiles `transportation` classes people walk along to a stop. */
export const WALKABLE = new Set(['secondary', 'tertiary', 'minor', 'service', 'track', 'path']);
/** National roads: walked along their pavement only where no side street goes. */
export const NATIONAL = new Set(['primary', 'trunk']);

/**
 * Street lines in local metres, flattened for transfer between threads:
 * line k is points[2·starts[k] .. 2·starts[k+1]) as x, z pairs,
 * widths[k] metres wide kerb to kerb as the map draws it, and a national
 * road when national[k] is 1.
 */
export interface StreetLines {
  points: Float32Array;
  starts: Uint32Array;
  widths: Float32Array;
  national: Uint8Array;
}

/** A street's points, its width kerb to kerb when known (metres), and whether it is a national road. */
export type StreetLine = LocalPoint[] & { width?: number; national?: boolean };

const LINE = 2;

/** Walkable street lines of one tile (none for a tile without a transportation layer). */
export function streetLines(buffer: ArrayBuffer, tile: TileId, origin: LatLng): StreetLines {
  const vt = new VectorTile(new PbfReader(new Uint8Array(buffer)));
  const layer = vt.layers.transportation;
  const coords: number[] = [];
  const starts: number[] = [0];
  const widths: number[] = [];
  const national: number[] = [];
  if (layer) {
    const toLocal = tileToLocal(tile, layer.extent, createProjection(origin));
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      if (f.type !== LINE || f.properties.brunnel === 'tunnel') continue;
      const cls = roadClass(String(f.properties.class ?? ''));
      const major = NATIONAL.has(cls);
      if (!major && !WALKABLE.has(cls)) continue;
      const oneway = f.properties.oneway === 1 || f.properties.oneway === -1;
      const width = roadWidth(ROADS[cls]!, oneway);
      for (const line of f.loadGeometry()) {
        if (line.length < 2) continue;
        for (const p of line) {
          const q = toLocal(p.x, p.y);
          coords.push(q.x, q.z);
        }
        starts.push(coords.length / 2);
        widths.push(width);
        national.push(major ? 1 : 0);
      }
    }
  }
  return {
    points: new Float32Array(coords),
    starts: new Uint32Array(starts),
    widths: new Float32Array(widths),
    national: new Uint8Array(national),
  };
}

/** The lines of a StreetLines as point arrays, each with its width. */
export function* eachLine(s: StreetLines): Generator<StreetLine> {
  for (let k = 0; k + 1 < s.starts.length; k++) {
    const line: StreetLine = [];
    for (let i = s.starts[k]!; i < s.starts[k + 1]!; i++)
      line.push({ x: s.points[2 * i]!, z: s.points[2 * i + 1]! });
    line.width = s.widths[k];
    line.national = s.national[k] === 1;
    yield line;
  }
}
