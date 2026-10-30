/**
 * A jeepney's money today, from the twin's running totals (FleetVehicle.day):
 * the one rule the driver app, the fleet summary and the operator's table
 * all use, with the profit model's fuel and cost figures.
 */

import { ADVISORY } from '@/core/advisory/model';
import { DEFAULT_EXPERIMENT } from '@/core/economics/model';
import type { DayTotals } from '@/core/fleet/fleetSim';

export interface DayMoney {
  km: number;
  idleMin: number;
  litres: number;
  /** All PHP. */
  fares: number;
  diesel: number;
  /** Boundary (or an owner's upkeep) and other daily costs: owed for the day from the start. */
  fixed: number;
  /** Of which the boundary, paid to the owner; 0 for an owner-driver. */
  boundary: number;
  net: number;
}

/** Money from a day's totals: a jeepney today (FleetVehicle) or a closed day of the ledger. */
export function dayMoney(v: { day: DayTotals }): DayMoney {
  const km = v.day.metres / 1000;
  const litres =
    km / DEFAULT_EXPERIMENT.movingKmPerL + (v.day.idleS / 3600) * DEFAULT_EXPERIMENT.idleLPerHour;
  const fares = v.day.fareCentavos / 100;
  const diesel = litres * ADVISORY.fuel.dieselPhpPerL;
  // A boundary driver pays the owner; an owner-driver pays their own upkeep.
  const boundary = v.day.owner ? 0 : DEFAULT_EXPERIMENT.boundaryPhp;
  const fixed =
    (v.day.owner ? DEFAULT_EXPERIMENT.ownerUpkeepPhp : boundary) + DEFAULT_EXPERIMENT.otherDailyPhp;
  return {
    km,
    idleMin: v.day.idleS / 60,
    litres,
    fares,
    diesel,
    fixed,
    boundary,
    net: fares - diesel - fixed,
  };
}

/** Seconds since midnight as "06:42:10". */
export function clockText(s: number): string {
  const t = Math.floor(((s % 86_400) + 86_400) % 86_400);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(Math.floor(t / 3600))}:${two(Math.floor((t % 3600) / 60))}:${two(t % 60)}`;
}
