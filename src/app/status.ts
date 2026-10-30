/**
 * What a simulated jeepney is doing, in a few words: the one wording the
 * ride card, the operator's table and the driver app all show.
 */

import type { FleetVehicle } from '@/core/fleet/fleetSim';
import { aheadOf, type Route } from '@/core/geo/routes';
import { metres, minutes } from '@/ui/phone/format';
import type { TwinRuntime } from './twinRuntime';

export function jeepneyStatus(twin: TwinRuntime, v: FleetVehicle): string {
  const kept = v.owner ? 'home' : 'the garage';
  if (v.duty === 'parked') return v.depot !== null ? 'Parked at the terminal' : `Parked at ${kept}`;
  if (v.duty === 'returning') return `Driving to ${kept}, empty`;
  if (v.yard) return dieselDoing(twin.route, v) ?? 'At a gas station';
  const doing = twin.crew.status(v.id);
  const fuel = v.refuel ? ` · low on diesel, to ${v.refuel.name}` : '';
  return (v.duty === 'homebound' ? `Last trip · ${doing}` : doing) + fuel;
}

/**
 * What jeepney `v` is doing about diesel, in a few words (the driver app,
 * the labels on the map): going to a station, in line or filling up there,
 * or pulling out full. Null when nothing.
 */
export function dieselDoing(route: Route, v: FleetVehicle): string | null {
  if (v.duty === 'parked') return null;
  const y = v.yard;
  if (y?.full) return `Full, pulling out of ${y.stop.name}`;
  if (y && v.refuelLeftS > 0)
    return `Filling up at ${y.stop.name} · ${v.refuelLeftS < 45 ? 'almost full' : `${minutes(v.refuelLeftS)} left`}`;
  if (y) {
    const jeepneys = y.ahead - y.cars;
    if (y.cars > 0)
      return `In line at ${y.stop.name} · ${y.cars === 1 ? 'a car' : '2 cars'} at the pump first`;
    if (jeepneys > 0)
      return `In line at ${y.stop.name} · ${jeepneys} jeepney${jeepneys === 1 ? '' : 's'} first`;
    return `Pulling in at ${y.stop.name}`;
  }
  if (!v.refuel) return null;
  const m = route.loop ? aheadOf(route, v.s, v.refuel.s) : Math.abs(v.refuel.s - v.s);
  return `Going to fill up at ${v.refuel.name} · ${metres(m)}`;
}
