import { yardShift, type FleetSim, type FuelStopAt } from '@/core/fleet/fleetSim';
import type { PointOnPolyline } from '@/core/geo/polyline';
import { aheadOf, kerbAt, type Route } from '@/core/geo/routes';
import type { GroundPose } from '../jeepney/JeepneyInstances';

/** Distance between a jeepney's axles, metres: the span its heading follows. */
const WHEELBASE_M = 4.3;
/** Jeepneys keep to the kerb-side lane: its centre is this far in from the kerb. */
const KERB_LANE_M = 1.75;
/** At a stop the body (1 m half-width) pulls in to 25 cm from the kerb. */
const AT_KERB_M = 1.25;
/** Pulling in starts this far before a stop and ends as far after it. */
const PULL_IN_M = 30;

/** Metres to the nearest stop, ahead or behind. */
function nearestStopM(route: Route, s: number): number {
  let best = Infinity;
  for (const st of route.stops) {
    const d = route.loop
      ? Math.min(aheadOf(route, s, st.s), aheadOf(route, st.s, s))
      : Math.abs(st.s - s);
    best = Math.min(best, d);
  }
  return best;
}

/**
 * Lane centre, metres right of the route line at s: the kerb-side lane,
 * easing in to the kerb around every stop (jeepneys stop at the kerb, so
 * riders step straight off the pavement).
 */
export function laneOffset(route: Route, s: number): number {
  const kerb = kerbAt(route, s);
  const t = Math.max(0, 1 - nearestStopM(route, s) / PULL_IN_M);
  const pull = t * t * (3 - 2 * t);
  const cruise = Math.max(0, kerb - KERB_LANE_M);
  const atKerb = Math.max(0, kerb - AT_KERB_M);
  return cruise + (atKerb - cruise) * pull;
}

/**
 * Pose of simulated jeepney i: on its lane, heading smoothed over the
 * wheelbase and turned by any drift across the road (pulling in to a stop).
 * One function for the renderer, the chase camera and the cabin camera, so
 * they always agree.
 */
export function fleetPose(fleet: FleetSim, i: number, out: GroundPose): GroundPose {
  const v = fleet.vehicles[i]!;
  const route = fleet.route;
  const line = route.polyline;
  // Parked for the night: off the road where it is kept.
  if (v.duty === 'parked') {
    const spot = fleet.parkedSpot(v);
    const p = line.pointAt(spot.s);
    p.heading = line.headingAt(spot.s, WHEELBASE_M);
    return lanePose(p, v.direction, laneOffset(route, spot.s) + spot.shift, out);
  }
  const p = line.pointAt(v.s);
  p.heading = line.headingAt(v.s, WHEELBASE_M);
  // Plus any swing out round a jeepney stopped at the kerb (fleetSim.ts).
  lanePose(p, v.direction, laneOffset(route, v.s) + v.laneShiftM, out);
  // Moving right while driving forward turns the nose right (heading down).
  const half = WHEELBASE_M / 2;
  let drift =
    (laneOffset(route, v.s + v.direction * half) - laneOffset(route, v.s - v.direction * half)) /
    WHEELBASE_M;
  // Turning into a station's forecourt, or back out of it.
  const y = v.yard;
  if (y)
    drift +=
      (yardShift(y.stop, y.bay, y.u + half) - yardShift(y.stop, y.bay, y.u - half)) / WHEELBASE_M;
  out.heading -= Math.atan(drift);
  return out;
}

/**
 * Pose of something standing `u` metres into `stop`'s forecourt, in its
 * lane of pumps `bay`, facing the way a jeepney drives through it (a car at
 * the pumps, say).
 */
export function yardPose(
  route: Route,
  stop: FuelStopAt,
  bay: number,
  u: number,
  out: GroundPose,
): GroundPose {
  const direction = stop.side === 'right' ? 1 : -1;
  const L = route.polyline.length;
  const raw = stop.inS + direction * u;
  const s = route.loop ? ((raw % L) + L) % L : Math.max(0, Math.min(L, raw));
  const p = route.polyline.pointAt(s);
  p.heading = route.polyline.headingAt(s, WHEELBASE_M);
  return lanePose(p, direction, laneOffset(route, s) + yardShift(stop, bay, u), out);
}

/**
 * Pose of a vehicle at along-route distance s, driving in `direction`, kept in
 * the right-hand lane (Philippine traffic drives on the right).
 */
export function lanePose(
  p: PointOnPolyline,
  direction: 1 | -1,
  laneOffsetM: number,
  out: GroundPose,
): GroundPose {
  const heading = direction === 1 ? p.heading : p.heading + Math.PI;
  // Right of the direction of travel, in the X–Z plane: (sin θ, cos θ).
  out.x = p.x + Math.sin(heading) * laneOffsetM;
  out.z = p.z + Math.cos(heading) * laneOffsetM;
  out.heading = heading;
  return out;
}
