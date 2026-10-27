/**
 * Route sources. A route always ends up as a Polyline in local metres; what
 * differs is where it came from and therefore how much we may claim about it.
 *
 *   synthetic  generated for offline development. NOT a real road.
 *   osm        Road geometry from OpenStreetMap (see scripts/fetch-route.mjs).
 *   recorded   simplified GPS trace from a real ride.
 *
 * Only geographic routes (osm, recorded) carry a projection, and only those
 * can be map-matched against live GPS.
 */

import { Polyline } from './polyline';
import { createProjection, type LatLng, type LocalPoint, type Projection } from './projection';
import { simplify } from './simplify';
import defaultRouteJson from '@/data/malaria-fairview.route.json';

export type RouteSource = 'synthetic' | 'osm' | 'recorded';

export interface Stop {
  name: string;
  /** Along-route distance, metres. */
  s: number;
}

export interface Route {
  id: string;
  name: string;
  source: RouteSource;
  polyline: Polyline;
  stops: Stop[];
  /** 'placeholder' = evenly spaced stand-ins, not real stop locations. */
  stopsSource: 'osm' | 'placeholder';
  /** Present only for geographic routes. */
  projection: Projection | null;
  /** Caveat about the geometry, shown in the UI (e.g. "routed, verify by riding"). */
  note?: string;
}

/** A bus stop that is further than this from the line is on another road. */
const STOP_MAX_OFFSET_M = 40;
/** Stops closer than this are the same stop (often one per side of the road). */
const STOP_MERGE_M = 120;

/** Evenly spaced stops; good enough until real stop data is loaded. */
function evenStops(polyline: Polyline, spacingM: number): Stop[] {
  const count = Math.max(2, Math.round(polyline.length / spacingM) + 1);
  return Array.from({ length: count }, (_, i) => ({
    name: `Stop ${i + 1}`,
    s: (polyline.length * i) / (count - 1),
  }));
}

/**
 * A ~3 km winding road for developing without data or network.
 * Deterministic, so screenshots and tests are stable.
 */
export function syntheticDemoRoute(): Route {
  const points: LocalPoint[] = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    points.push({
      x: -1400 + 2800 * t,
      z: 260 * Math.sin(t * Math.PI * 2.2) + 90 * Math.sin(t * Math.PI * 7),
    });
  }
  const polyline = new Polyline(points);
  return {
    id: 'demo',
    name: 'Synthetic demo route (not a real road)',
    source: 'synthetic',
    polyline,
    stops: evenStops(polyline, 400),
    stopsSource: 'placeholder',
    projection: null,
  };
}

/** Build a geographic route. The first coordinate becomes the scene origin. */
export function geographicRoute(
  id: string,
  name: string,
  source: Exclude<RouteSource, 'synthetic'>,
  coords: readonly LatLng[],
  simplifyToleranceM = 0,
): Route {
  if (coords.length < 2) throw new Error(`Route "${name}" needs at least 2 coordinates`);
  const projection = createProjection(coords[0]!);
  const local = coords.map((c) => projection.toLocal(c));
  const points = simplifyToleranceM > 0 ? simplify(local, simplifyToleranceM) : local;
  const polyline = new Polyline(points);
  return {
    id,
    name,
    source,
    polyline,
    stops: evenStops(polyline, 400),
    stopsSource: 'placeholder',
    projection,
  };
}

/**
 * Snap named stop locations onto the route and order them by distance.
 * Stops off the road are dropped; stops on both sides of the road merge into
 * one. The two ends are always stops, named after the terminals.
 */
export function stopsAlong(
  polyline: Polyline,
  projection: Projection,
  points: ReadonlyArray<{ name: string | null; at: LatLng }>,
  terminals: { from?: string | null; to?: string | null } = {},
): Stop[] {
  const snapped = points
    .map((p) => ({ name: p.name, hit: polyline.project(projection.toLocal(p.at)) }))
    .filter((p) => p.hit.offset <= STOP_MAX_OFFSET_M)
    .sort((a, b) => a.hit.s - b.hit.s);

  const stops: Stop[] = [{ name: terminals.from ?? 'Start', s: 0 }];
  for (const { name, hit } of snapped) {
    if (hit.s - stops[stops.length - 1]!.s < STOP_MERGE_M) continue;
    if (polyline.length - hit.s < STOP_MERGE_M) continue;
    stops.push({ name: name ?? `Stop ${stops.length + 1}`, s: hit.s });
  }
  stops.push({ name: terminals.to ?? 'End', s: polyline.length });
  return stops;
}

interface GeoJsonFeature {
  properties?: {
    name?: string | null;
    from?: string | null;
    to?: string | null;
    geometry?: string;
  };
  geometry?: { type: string; coordinates: unknown };
}

/** Parse the first LineString / MultiLineString feature of a GeoJSON document. */
export function parseGeoJsonRoute(geojson: unknown, fallbackName: string): Route {
  const features = (geojson as { features?: GeoJsonFeature[] }).features ?? [];
  const feature = features.find(
    (f) => f.geometry?.type === 'LineString' || f.geometry?.type === 'MultiLineString',
  );
  if (!feature?.geometry) throw new Error('GeoJSON has no LineString feature');

  const raw =
    feature.geometry.type === 'LineString'
      ? (feature.geometry.coordinates as number[][])
      : (feature.geometry.coordinates as number[][][]).flat();

  // GeoJSON order is [lng, lat], not [lat, lng].
  const toLatLng = ([lng, lat]: number[]): LatLng => ({ lat: lat!, lng: lng! });
  const props = feature.properties ?? {};
  const route = geographicRoute('osm', props.name ?? fallbackName, 'osm', raw.map(toLatLng));
  route.note = props.geometry;

  const stopPoints = features
    .filter((f) => f.geometry?.type === 'Point')
    .map((f) => ({
      name: f.properties?.name ?? null,
      at: toLatLng(f.geometry!.coordinates as number[]),
    }));
  if (stopPoints.length > 0) {
    route.stops = stopsAlong(route.polyline, route.projection!, stopPoints, props);
    route.stopsSource = 'osm';
  }
  return route;
}

/**
 * The route the dashboard opens with: Malaria – SM City Fairview along
 * Quirino Highway, with its OpenStreetMap bus stops. Bundled with the app
 * (generated by scripts/fetch-route.mjs), so it needs no network.
 */
export const DEFAULT_ROUTE_ID = 'malaria-fairview';

export function defaultRoute(): Route {
  return {
    ...parseGeoJsonRoute(defaultRouteJson, 'Malaria – SM City Fairview'),
    id: DEFAULT_ROUTE_ID,
  };
}

/** Export a geographic route back to GeoJSON, e.g. to keep a recorded trace. */
export function routeToGeoJson(route: Route): object {
  const { projection } = route;
  if (!projection) throw new Error('Only geographic routes can be exported');
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: route.name, source: route.source },
        geometry: {
          type: 'LineString',
          coordinates: route.polyline.points.map((p) => {
            const g = projection.toGeo(p);
            return [g.lng, g.lat];
          }),
        },
      },
    ],
  };
}
