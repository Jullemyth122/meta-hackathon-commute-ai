/**
 * Finding things in the network by name: a route ("Cubao Divisoria",
 * "fairview"), or a place to go from or to (a stop name, which in the GTFS
 * feed is the landmark or intersection people know: "SM Fairview", "Philcoa").
 */

import type { LocalPoint } from '../geo/projection';
import type { Network } from './network';

/** Lower case, no punctuation, one space: "C'wealth Ave." → "c wealth ave". */
function norm(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();
}

/**
 * Every word of the query starts some word of the text; a short one ("SM",
 * "B") must be a whole word, or it would match half the names.
 */
function matches(text: string, words: readonly string[]): boolean {
  const t = ` ${norm(text)} `;
  return words.every((w) => t.includes(w.length < 3 ? ` ${w} ` : ` ${w}`));
}

/** Routes whose name matches the query, shortest names first (the main ones). */
export function searchRoutes(network: Network, query: string, max = 12): number[] {
  const words = norm(query).split(' ').filter(Boolean);
  if (words.length === 0) return [];
  return network.routes
    .map((r, i) => ({ i, name: `${r.route.name} ${r.meta.from} ${r.meta.to}` }))
    .filter((r) => matches(r.name, words))
    .sort((a, b) => network.routes[a.i]!.route.name.length - network.routes[b.i]!.route.name.length)
    .slice(0, max)
    .map((r) => r.i);
}

/**
 * A named place: a landmark people say (a district, mall, station, market…,
 * from OpenStreetMap), or a stop name, wherever routes stop there.
 */
export interface Place {
  name: string;
  /** 'stop', or a landmark kind: 'area', 'mall', 'station', 'market', 'terminal', … */
  kind: string;
  at: LocalPoint;
  /** For stops: how many routes stop there (busier first). */
  routes: number;
}

/** Landmarks before stops, and the places people say before the rest. */
const KIND_ORDER = [
  'area',
  'city',
  'mall',
  'station',
  'market',
  'terminal',
  'school',
  'hospital',
  'city hall',
  'stop',
];

/** Stops of one route this close along it are at one point (metres). */
const SAME_POINT_M = 1;

/**
 * Every stop name in the network as a place, where it is. The 2015 feed's
 * stops were placed along each route's road path; where a route's path
 * missed some of them, they all ended up at one point of it, several names
 * at once ("Malaria Road" and its neighbours, on Regalado Highway 4 km
 * from Malaria Road). Such a route's every placing of those names is
 * suspect (its way back put "Malaria Road" on Regalado too, alone). A name
 * is placed where some route has it and never piled it up; a name no route
 * places so is left out, rather than shown in the wrong place.
 */
export function placesOf(network: Network): Place[] {
  const byName = new Map<string, { at: LocalPoint | null; routes: Set<number> }>();
  const names = new Map<string, string>();
  network.routes.forEach(({ route }, r) => {
    const piled = new Set<string>();
    route.stops.forEach((st, i) => {
      if (
        route.stops.some(
          (o, j) => j !== i && o.name !== st.name && Math.abs(o.s - st.s) < SAME_POINT_M,
        )
      )
        piled.add(norm(st.name));
    });
    route.stops.forEach((st) => {
      const key = norm(st.name);
      names.set(key, st.name);
      const found = byName.get(key) ?? byName.set(key, { at: null, routes: new Set() }).get(key)!;
      found.routes.add(r);
      if (!found.at && !piled.has(key)) {
        const p = route.polyline.pointAt(st.s);
        found.at = { x: p.x, z: p.z };
      }
    });
  });
  return [...byName].flatMap(([key, v]) =>
    v.at ? [{ name: names.get(key)!, kind: 'stop', at: v.at, routes: v.routes.size }] : [],
  );
}

/**
 * Places matching the query: the name itself first ("Sampaguita", not
 * "Sampaguita Village"); then places `near` where the person is looking
 * (the route on the map), so a same-named place across the city does not
 * win over the stop down the road; then names starting with it ("Cubao"
 * before "Araneta Center - Cubao"), landmarks before stops, busiest first.
 */
export function searchPlaces(
  places: readonly Place[],
  query: string,
  max = 8,
  near?: (p: Place) => boolean,
): Place[] {
  const q = norm(query);
  const words = q.split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const rank = (p: Place) => {
    const k = KIND_ORDER.indexOf(p.kind);
    return k < 0 ? KIND_ORDER.length : k;
  };
  const far = (p: Place) => Number(near ? !near(p) : false);
  return places
    .filter((p) => matches(p.name, words))
    .sort(
      (a, b) =>
        Number(norm(a.name) !== q) - Number(norm(b.name) !== q) ||
        far(a) - far(b) ||
        Number(!norm(a.name).startsWith(q)) - Number(!norm(b.name).startsWith(q)) ||
        rank(a) - rank(b) ||
        b.routes - a.routes ||
        a.name.length - b.name.length,
    )
    .slice(0, max);
}

/** What people call places the map names otherwise: [what they say, the name on the map]. */
const ALSO_CALLED: ReadonlyArray<[string, string]> = [
  ['SM Tungko', 'SM City San Jose del Monte'],
  ['SM SJDM', 'SM City San Jose del Monte'],
];

/** `places`, and each again by what people call it ("SM Tungko (SM City San Jose del Monte)"). */
export function withAliases(places: readonly Place[]): Place[] {
  const extra = ALSO_CALLED.flatMap(([alias, name]) =>
    places
      .filter((p) => norm(p.name) === norm(name))
      .map((p) => ({ ...p, name: `${alias} (${p.name})` })),
  );
  return [...places, ...extra];
}

/** Landmarks from the places file ([name, kind, lat, lng] rows), in scene metres. */
export function landmarks(
  rows: ReadonlyArray<[string, string, number, number]>,
  toLocal: (p: { lat: number; lng: number }) => LocalPoint,
): Place[] {
  return rows.map(([name, kind, lat, lng]) => ({
    name,
    kind,
    at: toLocal({ lat, lng }),
    routes: 0,
  }));
}
