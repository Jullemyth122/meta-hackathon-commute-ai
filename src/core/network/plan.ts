/**
 * Trips across the network, from anywhere to anywhere: walk to a stop, ride
 * a jeepney (or two, with a short walk between), walk to where you are going.
 *
 * Like a commuter thinks about it: a direct jeepney if there is one, else
 * one change; no more (two changes is a different trip, by bus or train).
 * Each option gets its time door to door, its fares, and the next jeepney
 * with seats, from the live twin on the focused route and the flows
 * elsewhere.
 */

import { FARE_BY_VEHICLE, fareFor } from '../fare';
import type { LocalPoint } from '../geo/projection';
import { aheadOf, stopsAhead, type Route } from '../geo/routes';
import type { Network } from './network';
import { flowSpeedKmh } from './flow';

/** Walking to or from a stop, at most (metres). Further is a tricycle ride. */
export const WALK_TO_STOP_M = 700;
/**
 * A waiting area the commuter chose: the stops this close to it are it
 * (metres). Two routes' stops of one name can stand a few hundred metres apart.
 */
export const WAITING_AREA_M = 350;
/** Walking between two stops to change jeepneys, at most (metres). */
export const TRANSFER_WALK_M = 250;
/**
 * Further than a walk from any stop, a tricycle takes you to one, up to this
 * far (metres): the tricycle's job in the Philippines, door to the highway.
 */
export const TRICYCLE_M = 3000;
/** Tricycle: waiting at the line, then about 15 km/h on local streets, 1.3× the straight line. */
const TRICYCLE_WAIT_S = 180;
const TRICYCLE_MPS = 15 / 3.6;
const ROAD_FACTOR = 1.3;
const WALK_MPS = 1.2;
/**
 * Boarding stops considered per route near the start, each way it runs: the
 * nearest ones. Its two ways often pass within metres of each other (the
 * two sides of one road), and only one of them goes where you are going.
 */
const BOARD_STOPS_PER_ROUTE = 2;
/** Options returned. */
const MAX_OPTIONS = 3;
/** A change of jeepney is offered only if it beats riding straight through by this much. */
const TRANSFER_MUST_SAVE_S = 300;

export interface Arrival {
  plate: string;
  etaS: number;
  freeSeats: number;
  vehicle: number;
}

/** The next jeepneys of route r at stop i, at clock t (seconds), soonest first. */
export type ArrivalsAt = (route: number, stop: number, t: number) => Arrival[];

export interface Leg {
  route: number;
  routeName: string;
  board: number;
  boardName: string;
  alight: number;
  alightName: string;
  rideM: number;
  rideS: number;
  waitS: number;
  /** The jeepney to take: the first coming with an estimated free seat, else the first. */
  jeepney: Arrival | null;
  fare: number;
  fareDiscounted: number;
  /**
   * Other routes that do this same ride (from near the same stop to near the
   * same place): a commuter takes whichever comes first.
   */
  alsoBy: string[];
}

/** How someone gets between a stop and where they are: on foot, or by tricycle. */
export type Access = 'walk' | 'tricycle';

export interface TripOption {
  legs: Leg[];
  /** To the first stop: metres (straight line) and how. */
  walkToM: number;
  toBy: Access;
  transferWalkM: number;
  /** From the last stop. */
  walkFromM: number;
  fromBy: Access;
  totalS: number;
  fare: number;
  fareDiscounted: number;
}

interface Candidate {
  route: number;
  stop: number;
  walkM: number;
}

/** Which way along its loop stop `i` is: out to its far terminal (0), or back (1). */
function wayOf(route: Route, i: number): 0 | 1 {
  const far = route.stops.findIndex((s, k) => k > 0 && s.terminal);
  return far > 0 && i >= far ? 1 : 0;
}

/** Nearest boarding stops per route and way, at most BOARD_STOPS_PER_ROUTE each. */
function perRoute(list: ReadonlyArray<Candidate>, routes: readonly Route[]): Candidate[] {
  const count = new Map<string, number>();
  const out: Candidate[] = [];
  for (const c of list) {
    const key = `${c.route}:${wayOf(routes[c.route]!, c.stop)}`;
    const n = count.get(key) ?? 0;
    if (n >= BOARD_STOPS_PER_ROUTE) continue;
    count.set(key, n + 1);
    out.push(c);
  }
  return out;
}

export function planTrips(
  network: Network,
  from: LocalPoint,
  to: LocalPoint,
  clockS: number,
  arrivalsAt: ArrivalsAt,
  /** How they go to the first stop, when they have said (else walking if near, as most do). */
  toBy?: Access,
  /**
   * The waiting area they chose (a stop, or a spot by the road): they board
   * there, coming from `from` (home), rather than at the stops near home.
   */
  via?: LocalPoint,
): TripOption[] {
  const routes = network.routes.map((r) => r.route);
  const speed = flowSpeedKmh((clockS / 3600) % 24) / 3.6;
  // Stops within a walk; if there are none, within a tricycle ride. Gone
  // the way they said, when they said.
  const reach = (
    p: LocalPoint,
    by?: Access,
  ): { by: Access; stops: ReturnType<typeof network.stops.near> } => {
    const walk = network.stops.near(p, WALK_TO_STOP_M);
    const stops = walk.length > 0 ? walk : network.stops.near(p, TRICYCLE_M);
    return { by: by ?? (walk.length > 0 ? 'walk' : 'tricycle'), stops };
  };
  const access = (m: number, by: Access) =>
    by === 'walk' ? m / WALK_MPS : TRICYCLE_WAIT_S + (m * ROAD_FACTOR) / TRICYCLE_MPS;
  const origin = via
    ? (() => {
        // At the waiting area chosen: its stops, and the way to them is from home.
        const stops = network.stops.near(via, WAITING_AREA_M).map((st) => ({
          ...st,
          distanceM: Math.hypot(st.x - from.x, st.z - from.z),
        }));
        const nearest = Math.min(Infinity, ...stops.map((st) => st.distanceM));
        return {
          by: toBy ?? (nearest <= WALK_TO_STOP_M ? 'walk' : 'tricycle'),
          stops: stops.sort((a, b) => a.distanceM - b.distanceM),
        } as ReturnType<typeof reach>;
      })()
    : reach(from, toBy);
  const destination = reach(to);
  const starts = perRoute(
    origin.stops.map((s) => ({ route: s.route, stop: s.stop, walkM: s.distanceM })),
    routes,
  );
  // Where each route can drop us within reach of the destination.
  const ends = new Map<number, Map<number, number>>();
  for (const s of destination.stops) {
    const m = ends.get(s.route) ?? new Map<number, number>();
    if (!m.has(s.stop)) m.set(s.stop, s.distanceM);
    ends.set(s.route, m);
  }

  const leg = (route: number, board: number, alight: number, atS: number): Leg => {
    const r = routes[route]!;
    const rideM = aheadOf(r, r.stops[board]!.s, r.stops[alight]!.s);
    const coming = arrivalsAt(route, board, atS);
    const jeepney = coming.find((a) => a.freeSeats > 0) ?? coming[0] ?? null;
    const km = rideM / 1000;
    return {
      route,
      routeName: r.name,
      board,
      boardName: r.stops[board]!.name,
      alight,
      alightName: r.stops[alight]!.name,
      rideM,
      rideS: rideM / speed,
      waitS: jeepney?.etaS ?? network.routes[route]!.meta.headwayS,
      jeepney,
      fare: fareFor(km, false, FARE_BY_VEHICLE[network.routes[route]!.route.kind ?? 'jeepney']),
      fareDiscounted: fareFor(
        km,
        true,
        FARE_BY_VEHICLE[network.routes[route]!.route.kind ?? 'jeepney'],
      ),
      alsoBy: [],
    };
  };

  const options: TripOption[] = [];
  const option = (
    legs: Leg[],
    walkToM: number,
    transferWalkM: number,
    walkFromM: number,
  ): TripOption => ({
    legs,
    walkToM,
    toBy: origin.by,
    transferWalkM,
    walkFromM,
    fromBy: destination.by,
    totalS:
      access(walkToM, origin.by) +
      transferWalkM / WALK_MPS +
      access(walkFromM, destination.by) +
      legs.reduce((sum, l) => sum + l.waitS + l.rideS, 0),
    fare: legs.reduce((sum, l) => sum + l.fare, 0),
    fareDiscounted: legs.reduce((sum, l) => sum + l.fareDiscounted, 0),
  });

  // Walking there beats any jeepney for a short trip.
  const direct = Math.hypot(to.x - from.x, to.z - from.z);

  for (const start of starts) {
    const atStop = clockS + access(start.walkM, origin.by);
    const ahead = stopsAhead(routes[start.route]!, start.stop, 1);
    // Direct: the same jeepney all the way.
    const endsHere = ends.get(start.route);
    if (endsHere)
      for (const j of ahead) {
        const walkFrom = endsHere.get(j);
        if (walkFrom === undefined) continue;
        options.push(option([leg(start.route, start.stop, j, atStop)], start.walkM, 0, walkFrom));
      }
    // One change: ride to a stop near another route that ends near the destination.
    for (const a of ahead) {
      const r1 = routes[start.route]!;
      const p = r1.polyline.pointAt(r1.stops[a]!.s);
      for (const b of network.stops.near(p, TRANSFER_WALK_M)) {
        if (b.route === start.route) continue;
        const endsThere = ends.get(b.route);
        if (!endsThere) continue;
        for (const j of stopsAhead(routes[b.route]!, b.stop, 1)) {
          const walkFrom = endsThere.get(j);
          if (walkFrom === undefined) continue;
          const first = leg(start.route, start.stop, a, atStop);
          const atSecond = atStop + first.waitS + first.rideS + b.distanceM / WALK_MPS;
          options.push(
            option([first, leg(b.route, b.stop, j, atSecond)], start.walkM, b.distanceM, walkFrom),
          );
        }
      }
    }
  }

  // The best few, fastest first. Options that are the same trip by other
  // routes are one option, "or any of …": a commuter takes whichever jeepney
  // comes first. Direct: the same boarding stop. With a change: the same
  // first ride, then any route for the second. A change of jeepney has to
  // save real time over riding straight through.
  options.sort((x, y) => x.totalS - y.totalS);
  const fastestDirect = options.find((o) => o.legs.length === 1)?.totalS ?? Infinity;
  const kept = new Map<string, TripOption>();
  const best: TripOption[] = [];
  // The same two jeepneys, only changing at another stop, is the same trip.
  const sameJeepneys = (a: TripOption, b: TripOption) =>
    a.legs.length === 2 &&
    b.legs.length === 2 &&
    a.legs.every((l, k) => {
      const m = b.legs[k]!;
      return (
        l.route === m.route &&
        (k === 0 ? l.board === m.board : l.jeepney?.plate === m.jeepney?.plate)
      );
    });
  for (const o of options) {
    if (o.legs.length > 1 && o.totalS > fastestDirect - TRANSFER_MUST_SAVE_S) continue;
    if (best.some((b) => sameJeepneys(b, o))) continue;
    const first = o.legs[0]!;
    const key =
      o.legs.length === 1
        ? `direct:${first.boardName}`
        : `change:${first.route}:${first.board}:${first.alight}`;
    const same = kept.get(key);
    if (same) {
      const leg = same.legs.at(-1)!;
      const other = o.legs.at(-1)!;
      if (other.route !== leg.route && !leg.alsoBy.includes(other.routeName))
        leg.alsoBy.push(other.routeName);
      continue;
    }
    // The same jeepney line from a stop further on is only a longer walk.
    if (
      o.legs.length === 1 &&
      best.some(
        (b) =>
          b.legs.length === 1 &&
          (b.legs[0]!.route === first.route || b.legs[0]!.alsoBy.includes(first.routeName)),
      )
    )
      continue;
    if (best.length === MAX_OPTIONS) continue;
    kept.set(key, o);
    best.push(o);
  }
  // A jeepney all the way is always among them when there is one: no change,
  // no second fare, even if changing could be a little faster.
  const straight = options.find((o) => o.legs.length === 1);
  if (straight && !best.some((o) => o.legs.length === 1)) {
    if (best.length === MAX_OPTIONS) best.pop();
    best.push(straight);
    best.sort((x, y) => x.totalS - y.totalS);
  }
  return direct < WALK_TO_STOP_M ? best.filter((o) => o.totalS < direct / WALK_MPS) : best;
}
