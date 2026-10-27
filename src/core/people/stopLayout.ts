import type { Route } from '../geo/routes';
import type { LocalPoint } from '../geo/projection';

/** Explicit simulation waiting/arrival areas, not claimed to be surveyed sidewalks. */
export const STOP_CURB_M = 14;

export function stopPoint(
  route: Route,
  stop: number,
  direction: 1 | -1,
  along: number,
  out: number,
): LocalPoint {
  const s = route.stops[stop]!.s;
  const p = route.polyline.pointAt(s);
  const yaw = route.polyline.headingAt(s, 4.3) + (direction === 1 ? 0 : Math.PI);
  return {
    x: p.x + Math.cos(yaw) * along + Math.sin(yaw) * out,
    z: p.z - Math.sin(yaw) * along + Math.cos(yaw) * out,
  };
}

export function queuePoint(
  route: Route,
  stop: number,
  direction: 1 | -1,
  slot: number,
): LocalPoint {
  return stopPoint(
    route,
    stop,
    direction,
    -3 + (slot % 6) * 0.85,
    STOP_CURB_M + Math.floor(slot / 6) * 0.85,
  );
}

export function arrivalPoint(
  route: Route,
  stop: number,
  direction: 1 | -1,
  slot: number,
): LocalPoint {
  return stopPoint(
    route,
    stop,
    direction,
    7 + (slot % 8) * 0.85,
    STOP_CURB_M + Math.floor(slot / 8) * 0.85,
  );
}

/** Keep the marked waiting/walking area free of map building meshes. */
export function stopClearancePaths(route: Route): LocalPoint[][] {
  return route.stops.flatMap((_, stop) =>
    ([1, -1] as const).map((direction) => [
      stopPoint(route, stop, direction, -9, STOP_CURB_M + 2),
      stopPoint(route, stop, direction, 17, STOP_CURB_M + 2),
    ]),
  );
}
