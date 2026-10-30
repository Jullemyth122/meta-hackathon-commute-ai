/**
 * One Mapbox Vector Tile (OpenMapTiles schema) -> meshes in local metres.
 *
 * Runs in a Web Worker (src/map/tileWorker.ts): decoding and triangulating a
 * dense tile takes tens of milliseconds, which would otherwise stutter the 3D
 * view. Pure function of its inputs, so it is also testable in Node.
 */

import { classifyRings, VectorTile, type VectorTileLayer } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { createProjection, type LatLng, type LocalPoint } from '../geo/projection';
import { MeshBuilder, type MeshData } from './meshBuilder';
import { RoadClearance } from './roadClearance';
import {
  AREA_PRIORITY,
  areaColor,
  buildingColors,
  BUILDING_ROAD_CLEARANCE_M,
  CASING_EXTRA_M,
  DEFAULT_BUILDING_HEIGHT_M,
  LABEL_PLACES,
  RAIL,
  RAIL_CLASSES,
  ROAD_ORDER,
  roadClass,
  roadWidth,
  ROADS,
  ROUTE_ROAD_WIDTH_M,
  WATER,
  WATERWAY_WIDTH,
} from './style';
import { tileToLocal, type TileId } from './tiles';

/** Flat layers are drawn in this order, then buildings. */
export const FLAT_LAYERS = ['areas', 'water', 'roadCasing', 'roadFill'] as const;
export type MapLayer = (typeof FLAT_LAYERS)[number] | 'buildings';

export interface MapLabel {
  text: string;
  kind: string;
  x: number;
  z: number;
}

export interface TileMeshes {
  tile: TileId;
  layers: Partial<Record<MapLayer, MeshData>>;
  labels: MapLabel[];
}

const enum GeomType {
  Point = 1,
  Line = 2,
  Polygon = 3,
}

type Rings = LocalPoint[][];

export function buildTile(
  buffer: ArrayBuffer,
  tile: TileId,
  origin: LatLng,
  route: readonly LocalPoint[] = [],
  pedestrianAreas: readonly (readonly LocalPoint[])[] = [],
): TileMeshes {
  const vt = new VectorTile(new PbfReader(new Uint8Array(buffer)));
  const projection = createProjection(origin);
  const L = vt.layers;
  const extent = Object.values(L)[0]?.extent ?? 4096;
  const toLocal = tileToLocal(tile, extent, projection);
  const convert = (ring: Array<{ x: number; y: number }>) => ring.map((p) => toLocal(p.x, p.y));

  /** Every polygon of a layer (outer ring + holes), with its feature props. */
  function* polygons(layer: VectorTileLayer | undefined) {
    if (!layer) return;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      if (f.type !== GeomType.Polygon) continue;
      for (const poly of classifyRings(f.loadGeometry())) yield { props: f.properties, poly };
    }
  }

  function* lines(layer: VectorTileLayer | undefined) {
    if (!layer) return;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      if (f.type !== GeomType.Line) continue;
      for (const line of f.loadGeometry()) yield { props: f.properties, line: convert(line) };
    }
  }

  const layers: TileMeshes['layers'] = {};
  const mesh = new MeshBuilder();
  const clearance = new RoadClearance();
  clearance.add(route, ROUTE_ROAD_WIDTH_M + 2 * BUILDING_ROAD_CLEARANCE_M);
  for (const path of pedestrianAreas) clearance.add(path, 10);

  // Land use, parks, woods. One mesh; draw order within it = insertion order.
  for (const name of AREA_PRIORITY) {
    for (const { props, poly } of polygons(L[name])) {
      mesh.polygon(poly.map(convert), 0, areaColor(name, String(props.class ?? '')));
    }
  }
  layers.areas = mesh.build() ?? undefined;

  for (const { poly } of polygons(L.water)) mesh.polygon(poly.map(convert), 0, WATER);
  for (const { props, line } of lines(L.waterway)) {
    if (props.brunnel === 'tunnel') continue;
    mesh.ribbon(line, WATERWAY_WIDTH[String(props.class)] ?? 2, 0, WATER);
  }
  layers.water = mesh.build() ?? undefined;

  // Roads: all casings first, then all fills, minor classes under major ones,
  // so junctions read as one continuous surface.
  const byClass = new Map<string, Array<{ line: LocalPoint[]; width: number }>>();
  const rails: Rings = [];
  for (const { props, line } of lines(L.transportation)) {
    if (props.brunnel === 'tunnel') continue;
    const cls = roadClass(String(props.class ?? ''));
    const style = ROADS[cls];
    if (RAIL_CLASSES.has(cls)) rails.push(line);
    else if (style) {
      const width = roadWidth(style, props.oneway === 1 || props.oneway === -1);
      clearance.add(line, width + CASING_EXTRA_M + 2 * BUILDING_ROAD_CLEARANCE_M);
      (byClass.get(cls) ?? byClass.set(cls, []).get(cls)!).push({ line, width });
    }
  }
  for (const cls of ROAD_ORDER) {
    const { casing } = ROADS[cls]!;
    for (const r of byClass.get(cls) ?? [])
      mesh.ribbon(r.line, r.width + CASING_EXTRA_M, 0, casing);
  }
  layers.roadCasing = mesh.build() ?? undefined;
  for (const cls of ROAD_ORDER) {
    const { fill } = ROADS[cls]!;
    for (const r of byClass.get(cls) ?? []) mesh.ribbon(r.line, r.width, 0, fill);
  }
  for (const line of rails) mesh.ribbon(line, RAIL.width, 0, RAIL.color);
  layers.roadFill = mesh.build() ?? undefined;

  // Buildings. Tiles overlap by a small buffer, so a building near an edge
  // is in two tiles; the tile that contains its centre owns it.
  for (const { props, poly } of polygons(L.building)) {
    const outer = poly[0]!;
    let cx = 0;
    let cy = 0;
    for (const p of outer) {
      cx += p.x;
      cy += p.y;
    }
    cx /= outer.length;
    cy /= outer.length;
    if (cx < 0 || cy < 0 || cx >= extent || cy >= extent) continue;

    const footprint = poly.map(convert);
    // Suppress conflicting footprints in this visualization rather than
    // moving real mapped buildings to invented locations.
    if (clearance.intersects(footprint)) continue;

    const top = Number(props.render_height) || DEFAULT_BUILDING_HEIGHT_M;
    const bottom = Math.min(Number(props.render_min_height) || 0, top - 0.5);
    const { wall, roof } = buildingColors(cx * 4099 + cy);
    mesh.extrusion(footprint, bottom, top, wall, roof);
  }
  layers.buildings = mesh.build() ?? undefined;

  const labels: MapLabel[] = [];
  const places = L.place;
  for (let i = 0; places && i < places.length; i++) {
    const f = places.feature(i);
    const kind = String(f.properties.class ?? '');
    const text = f.properties['name:latin'] ?? f.properties.name;
    if (!LABEL_PLACES.has(kind) || typeof text !== 'string') continue;
    const p = f.loadGeometry()[0]?.[0];
    if (!p || p.x < 0 || p.y < 0 || p.x >= extent || p.y >= extent) continue;
    labels.push({ text, kind, ...toLocal(p.x, p.y) });
  }

  return { tile, layers, labels };
}

/** Typed arrays to hand over to the main thread without copying. */
export function transferables(t: TileMeshes): ArrayBuffer[] {
  return [
    ...Object.values(t.layers).flatMap((m) =>
      m ? [m.position.buffer, m.normal.buffer, m.color.buffer, m.index.buffer] : [],
    ),
  ] as ArrayBuffer[];
}
