/**
 * The commuter's app: when a jeepney comes, which one takes you, when you
 * get there, and what it costs.
 *
 * Two kinds of commuter:
 *
 *   { passenger }           someone in the twin, followed through their trip:
 *                           walking to the stop, in the queue, riding, there
 *   { stop, destination }   someone planning a trip from a stop (the phone
 *                           app before they leave the house)
 *
 * The jeepney that takes you is the FCFS one (see dispatch.ts): the first to
 * arrive with a seat left after everyone ahead of you in the queue.
 */

import { FARE_BY_VEHICLE, fareFor } from '../fare';
import type { FleetKind } from '../vehicles/specs';
import type { Dispatch } from './dispatch';
import {
  ADVISORY,
  carries,
  distanceTo,
  loadsAt,
  rideDistance,
  serves,
  takingRiders,
  type PassengerPhase,
  type TwinState,
} from './model';

/**
 * Whose trip the commuter's phone shows: a rider in the twin (their own, or
 * `chosen`: someone already there they picked to be), or a trip being
 * planned from a stop.
 */
export type CommuterQuery =
  { passenger: number; chosen?: boolean } | { stop: number; destination: number };

export interface Arrival {
  vehicle: number;
  plate: string;
  /** A traditional jeepney, modern jeepney, UV Express or bus. */
  kind: FleetKind;
  distanceM: number;
  etaS: number;
  /** Seats free when it reaches your stop, before anyone there boards. */
  freeSeats: number;
  /** Seats still free for you after the people queued ahead of you board. */
  seatsForYou: number;
  /** False when this jeepney is expected to pass before you reach the stop. */
  catchable: boolean;
}

export interface CommuterView {
  /** 'planning' for a trip query, the passenger's phase otherwise. */
  phase: PassengerPhase | 'planning';
  approach: { mode: 'walk' | 'tricycle'; distanceM: number; etaS: number } | null;
  stop: { index: number; name: string; towards?: string };
  destination: { index: number; name: string };
  /** People in the queue who board before you. */
  queueAhead: number;
  /** The next jeepneys to reach your stop, soonest first. */
  arrivals: Arrival[];
  /** The one that takes you, or null if none in sight has a seat. */
  pickup: Arrival | null;
  trip: {
    distanceM: number;
    /** By the vehicle that takes you (riding, or the pickup; a jeepney when none yet). */
    by: FleetKind;
    fare: number;
    fareDiscounted: number;
    /** Seconds until you get off, or null if no jeepney can take you yet. */
    arriveInS: number | null;
  };
  /** While on board. */
  riding: {
    vehicle: number;
    plate: string;
    kind: FleetKind;
    remainingM: number;
    etaS: number;
  } | null;
}

const ARRIVALS_SHOWN = 3;

export function commuterView(state: TwinState, plan: Dispatch, q: CommuterQuery): CommuterView {
  const { route, vehicles, passengers } = state;
  const p = 'passenger' in q ? passengers.find((x) => x.id === q.passenger) : undefined;
  if ('passenger' in q && !p) throw new Error(`No passenger ${q.passenger}`);

  const origin = p ? p.originStop : (q as { stop: number }).stop;
  const destination = p ? p.destinationStop : (q as { destination: number }).destination;
  const direction: 1 | -1 =
    p?.direction ?? (route.loop || route.stops[destination]!.s >= route.stops[origin]!.s ? 1 : -1);
  const queue = passengers
    .filter((x) => x.phase === 'waiting' && x.originStop === origin && x.direction === direction)
    .sort((a, b) => a.queuedAt - b.queuedAt || a.id - b.id);
  const queueAhead = p?.phase === 'waiting' ? queue.findIndex((x) => x.id === p.id) : queue.length;
  const approach =
    p?.phase === 'approaching' && Number.isFinite(p.arrivalInS)
      ? {
          mode: p.approachMode ?? 'walk',
          distanceM: Math.max(0, p.distanceToStopM ?? 0),
          etaS: Math.max(0, p.arrivalInS!),
        }
      : null;
  const assigned = p?.phase === 'waiting' ? plan.vehicleFor(p.id) : null;

  // Jeepneys still to reach the stop, going our way. A small overshoot is "here".
  const arrivals: Arrival[] = vehicles
    .filter(
      (v) =>
        takingRiders(v) &&
        serves(route, v, direction) &&
        loadsAt(route, v, origin) &&
        carries(route, v, origin, destination),
    )
    .map((v) => ({ v, d: distanceTo(route, v, route.stops[origin]!.s) }))
    .filter(({ d }) => d > -5)
    .sort((a, b) => plan.etaS(a.v.index, origin) - plan.etaS(b.v.index, origin))
    .map(({ v, d }) => {
      const freeSeats = plan.freeSeatsAt(v.index, origin);
      return {
        vehicle: v.index,
        plate: v.plate,
        kind: v.kind ?? 'jeepney',
        distanceM: Math.max(0, d),
        etaS: plan.etaS(v.index, origin),
        freeSeats,
        seatsForYou: Math.max(
          assigned === v.index ? 1 : 0,
          freeSeats - plan.claimedAt(v.index, origin),
        ),
        catchable: !approach || plan.etaS(v.index, origin) >= approach.etaS,
      };
    });

  // In the queue, FCFS has already named your jeepney; otherwise you take
  // the first one with a seat left over.
  const pickup =
    (assigned !== null
      ? arrivals.find((a) => a.vehicle === assigned)
      : arrivals.find((a) => a.catchable && a.seatsForYou > 0)) ?? null;
  // Keep the next arrivals visible, but do not hide a later jeepney you can actually catch.
  const shown = arrivals.slice(0, ARRIVALS_SHOWN);
  if (pickup && !shown.includes(pickup)) shown[ARRIVALS_SHOWN - 1] = pickup;

  const distanceM = rideDistance(route, origin, destination, direction);
  const km = distanceM / 1000;

  // On board: straight from the jeepney's position to the destination.
  const onBoard = p && p.vehicle !== null && (p.phase === 'boarding' || p.phase === 'seated');
  const riding = onBoard
    ? {
        vehicle: p.vehicle!,
        plate: vehicles[p.vehicle!]!.plate,
        kind: vehicles[p.vehicle!]!.kind ?? 'jeepney',
        remainingM: Math.max(
          0,
          distanceTo(route, vehicles[p.vehicle!]!, route.stops[destination]!.s),
        ),
        etaS: plan.etaS(p.vehicle!, destination),
      }
    : null;

  // Waiting: until pickup, plus the ride. The jeepney's ETA to the
  // destination already includes the stops it makes on the way, the
  // pickup stop included if it is collecting someone there; if it is not,
  // it stops for you.
  const done = p?.phase === 'alighting' || p?.phase === 'walking' || p?.phase === 'arrived';
  let arriveInS: number | null = null;
  if (done) arriveInS = 0;
  else if (riding) arriveInS = riding.etaS;
  else if (pickup) {
    const ride = plan.etaS(pickup.vehicle, destination) - pickup.etaS;
    const dwellForYou = plan.claimedAt(pickup.vehicle, origin) > 0 ? 0 : ADVISORY.dwellS;
    arriveInS = pickup.etaS + dwellForYou + ride;
  }

  const by: FleetKind = riding?.kind ?? pickup?.kind ?? 'jeepney';
  const st = route.stops[origin]!;
  return {
    phase: p ? p.phase : 'planning',
    approach,
    stop: { index: origin, name: st.name, towards: st.towards },
    destination: { index: destination, name: route.stops[destination]!.name },
    queueAhead: Math.max(0, queueAhead),
    arrivals: shown,
    pickup,
    trip: {
      distanceM,
      by,
      fare: fareFor(km, false, FARE_BY_VEHICLE[by]),
      fareDiscounted: fareFor(km, true, FARE_BY_VEHICLE[by]),
      arriveInS,
    },
    riding,
  };
}
