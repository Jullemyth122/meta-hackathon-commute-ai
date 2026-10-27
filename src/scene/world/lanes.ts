import type { FleetSim } from '@/core/fleet/fleetSim';
import type { PointOnPolyline } from '@/core/geo/polyline';
import type { GroundPose } from '../jeepney/JeepneyInstances';

/** Distance between a jeepney's axles, metres: the span its heading follows. */
const WHEELBASE_M = 4.3;
/** Lane centre, metres right of the route line. */
const LANE_OFFSET_M = 2;

/**
 * Pose of simulated jeepney i: on its lane, heading smoothed over the
 * wheelbase. One function for the renderer, the chase camera and the cabin
 * camera, so they always agree.
 */
export function fleetPose(fleet: FleetSim, i: number, out: GroundPose): GroundPose {
  const v = fleet.vehicles[i]!;
  const line = fleet.route.polyline;
  const p = line.pointAt(v.s);
  p.heading = line.headingAt(v.s, WHEELBASE_M);
  return lanePose(p, v.direction, LANE_OFFSET_M, out);
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
