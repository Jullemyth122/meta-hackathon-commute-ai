/**
 * Trip state machine for one phone.
 *
 *   WAITING ──(sustained vehicle-like motion, on route)──▶ POSSIBLE_VEHICLE
 *   WAITING / POSSIBLE_VEHICLE ──(rider confirms)──▶ CONFIRMED
 *   POSSIBLE_VEHICLE ──(off route for a while)──▶ WAITING
 *   CONFIRMED ──(rider ends trip)──▶ ENDED ──(reset)──▶ WAITING
 *
 * Speed alone never confirms a trip: 24 km/h could be a jeepney, a taxi or a
 * private car. Only the rider can say "I am on this jeepney". The thresholds
 * below are starting points, to be tuned from field recordings.
 */

import type { MotionEstimate } from './gpsFilter';
import type { TripPhase } from './types';

export interface TripConfig {
  /** Faster than brisk walking (≈ 12.6 km/h). */
  vehicleMinMps: number;
  /** How long motion must stay vehicle-like before we suggest a trip. */
  sustainMs: number;
  /** Minimum good fixes in the filter window. */
  minFixes: number;
  /** How long off-route before a possible trip is dropped. */
  offRouteMs: number;
}

export const DEFAULT_TRIP: TripConfig = {
  vehicleMinMps: 3.5,
  sustainMs: 12_000,
  minFixes: 4,
  offRouteMs: 30_000,
};

export interface TripState {
  phase: TripPhase;
  /** When motion first became vehicle-like, or null. */
  vehicleLikeSince: number | null;
  /** When the phone was first seen off the route, or null. */
  offRouteSince: number | null;
  /** Human-readable reason for the last transition. Shown in the UI. */
  reason: string;
}

export type TripInput =
  /** `onRoute` is null when no geographic route is loaded to compare against. */
  | { kind: 'motion'; now: number; motion: MotionEstimate; onRoute: boolean | null }
  | { kind: 'confirm' }
  | { kind: 'end' }
  | { kind: 'reset' };

export const initialTripState: TripState = {
  phase: 'WAITING',
  vehicleLikeSince: null,
  offRouteSince: null,
  reason: 'No trip linked yet',
};

function isVehicleLike(m: MotionEstimate, cfg: TripConfig): boolean {
  return m.significant && m.goodFixes >= cfg.minFixes && m.speedMps >= cfg.vehicleMinMps;
}

export function stepTrip(
  state: TripState,
  input: TripInput,
  cfg: TripConfig = DEFAULT_TRIP,
): TripState {
  switch (input.kind) {
    case 'reset':
      return initialTripState;

    case 'confirm':
      if (state.phase === 'WAITING' || state.phase === 'POSSIBLE_VEHICLE') {
        return { ...state, phase: 'CONFIRMED', reason: 'Rider confirmed the jeepney and route' };
      }
      return state;

    case 'end':
      if (state.phase === 'CONFIRMED')
        return { ...state, phase: 'ENDED', reason: 'Rider ended the trip' };
      return state;

    case 'motion':
      return stepMotion(state, input.now, input.motion, input.onRoute, cfg);
  }
}

function stepMotion(
  state: TripState,
  now: number,
  motion: MotionEstimate,
  onRoute: boolean | null,
  cfg: TripConfig,
): TripState {
  const offRouteSince = onRoute === false ? (state.offRouteSince ?? now) : null;

  if (state.phase === 'WAITING') {
    // Off a known route: whatever this vehicle is, it is not our jeepney.
    if (!isVehicleLike(motion, cfg) || onRoute === false) {
      return { ...state, vehicleLikeSince: null, offRouteSince };
    }
    const since = state.vehicleLikeSince ?? now;
    if (now - since >= cfg.sustainMs) {
      return {
        phase: 'POSSIBLE_VEHICLE',
        vehicleLikeSince: since,
        offRouteSince,
        reason: `Moving at ${(motion.speedMps * 3.6).toFixed(0)} km/h for ${Math.round(
          (now - since) / 1000,
        )} s${onRoute ? ' along the route' : ''}. Ask the rider to confirm.`,
      };
    }
    return { ...state, vehicleLikeSince: since, offRouteSince };
  }

  if (state.phase === 'POSSIBLE_VEHICLE') {
    // Jeepneys stop often and long, so slowing down is not a reason to drop.
    // Leaving the route is.
    if (offRouteSince !== null && now - offRouteSince >= cfg.offRouteMs) {
      return { ...initialTripState, reason: 'Left the route, so probably not this jeepney' };
    }
    return { ...state, offRouteSince };
  }

  return { ...state, offRouteSince };
}
