/**
 * Which stops of a route each kind of vehicle uses. Buses and UV Express are
 * not jeepneys: they run routes of their own (Route.kind: SM Tungko to
 * Cubao, Quiapo, Makati…), from their own terminals; jeepney routes carry
 * jeepneys and modern jeepneys only. So on any route:
 *
 *   jeepney, modern jeepney, bus   riders on and off at every stop
 *   UV Express                     riders on at its two terminals only (point
 *                                  to point, it leaves full), off anywhere
 *
 * A terminal is where everyone gets off, where vehicles line up to fill
 * before setting out (passengerSystem FILL), and where the day ends.
 */

import { isTerminal, type Route } from '../geo/routes';
import type { FleetKind } from './specs';

export interface StopRoles {
  /** It stops here to let riders off. */
  serves: readonly boolean[];
  /** Riders get on here. */
  loads: readonly boolean[];
  /** Its terminals. */
  terminal: readonly boolean[];
}

const cache = new WeakMap<Route, Map<FleetKind, StopRoles>>();

export function stopRoles(route: Route, kind: FleetKind): StopRoles {
  let byKind = cache.get(route);
  if (!byKind) cache.set(route, (byKind = new Map()));
  let roles = byKind.get(kind);
  if (!roles) {
    const terminal = route.stops.map((_, i) => isTerminal(route, i));
    const all = route.stops.map(() => true);
    roles =
      kind === 'uv'
        ? { serves: all, loads: terminal, terminal }
        : { serves: all, loads: all, terminal };
    byKind.set(kind, roles);
  }
  return roles;
}

/**
 * The stops after `stop` where a `kind` vehicle going `direction` lets
 * riders off, up to and with its next terminal (where everyone gets off).
 */
export function stopsAheadFor(
  route: Route,
  kind: FleetKind,
  stop: number,
  direction: 1 | -1,
): number[] {
  const roles = stopRoles(route, kind);
  const n = route.stops.length;
  const out: number[] = [];
  for (let k = 1; k < n; k++) {
    const i = route.loop ? (((stop + k * direction) % n) + n) % n : stop + k * direction;
    if (i < 0 || i >= n) break;
    if (roles.serves[i] || roles.terminal[i]) out.push(i);
    if (roles.terminal[i]) break;
  }
  return out;
}
