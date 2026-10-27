/**
 * The simulated part of the hybrid twin: other jeepneys on the same route,
 * riders appearing at stops, boarding and alighting.
 *
 * Deliberately simple and deterministic (seeded). It is a backdrop that makes
 * the one GPS-driven jeepney meaningful, not a traffic model. Anything that
 * claims accuracy (counts, ETAs) has to be validated against field data first.
 */

import type { Route } from '../geo/routes';
import { createRng, poisson, type Rng } from '../math/random';

export type Livery = 'red' | 'yellow' | 'green';

export interface FleetVehicle {
  id: number;
  plate: string;
  livery: Livery;
  /** Along-route distance, metres. */
  s: number;
  direction: 1 | -1;
  cruiseMps: number;
  speedMps: number;
  /** Seconds left at the current stop. */
  dwellS: number;
  capacity: number;
  /** True number of riders (the simulation knows; sensors would estimate). */
  occupancy: number;
  /** Index of the next stop in the direction of travel. */
  nextStop: number;
  /** Stop being served; cleared only when passenger movements are finished. */
  currentStop: number | null;
}

export interface PassengerService {
  demand(stop: number, count: number): void;
  arrive(vehicle: FleetVehicle, stop: number): void;
  busy(vehicle: number): boolean;
}

export interface FleetConfig {
  count: number;
  capacity: number;
  seed: number;
  /** Riders arriving per stop per minute. */
  demandPerStopPerMin: number;
}

export const DEFAULT_FLEET: FleetConfig = {
  count: 10,
  capacity: 22,
  seed: 11,
  demandPerStopPerMin: 0.8,
};

const MIN_GAP_M = 14;
/** A loaded jeepney pulling away, and comfortable braking (m/s²). */
const ACCEL_MPS2 = 1.2;
const BRAKE_MPS2 = 1.6;
/** Speed for the last metre into a stop, so the braking curve never stalls short. */
const CREEP_MPS = 0.8;
const TERMINAL_DWELL_S = 20;
const LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ';

function plate(rng: Rng): string {
  const letter = () => LETTERS[Math.floor(rng() * LETTERS.length)];
  const digits = String(Math.floor(rng() * 10_000)).padStart(4, '0');
  return `${letter()}${letter()}${letter()} ${digits}`;
}

export class FleetSim {
  passengerService: PassengerService | null = null;
  readonly vehicles: FleetVehicle[];
  /** Riders waiting at each stop (route.stops order). */
  readonly waiting: number[];
  readonly route: Route;
  private readonly rng: Rng;
  private readonly cfg: FleetConfig;

  constructor(route: Route, cfg: FleetConfig = DEFAULT_FLEET) {
    this.route = route;
    this.cfg = cfg;
    this.rng = createRng(cfg.seed);
    this.waiting = route.stops.map(() => Math.floor(this.rng() * 4));

    const L = route.polyline.length;
    this.vehicles = Array.from({ length: cfg.count }, (_, i) => {
      const direction: 1 | -1 = i % 2 === 0 ? 1 : -1;
      const s = ((i + 0.5) / cfg.count) * L;
      const cruise = 7 + this.rng() * 3; // 25–36 km/h on a clear road
      return {
        id: i,
        plate: plate(this.rng),
        livery: (['red', 'yellow', 'green'] as const)[i % 3]!,
        s,
        direction,
        cruiseMps: cruise,
        speedMps: cruise,
        dwellS: 0,
        capacity: cfg.capacity,
        occupancy: Math.floor(this.rng() * cfg.capacity * 0.6),
        nextStop: this.nextStopIndex(s, direction),
        currentStop: null,
      };
    });
  }

  step(dtS: number): void {
    const arrivalsMean = (this.cfg.demandPerStopPerMin / 60) * dtS;
    for (let i = 0; i < this.waiting.length; i++) {
      const arrivals = Math.min(40 - this.waiting[i]!, poisson(this.rng, arrivalsMean));
      if (this.passengerService) this.passengerService.demand(i, arrivals);
      else this.waiting[i]! += arrivals;
    }
    for (const v of this.vehicles) this.stepVehicle(v, dtS);
  }

  private stepVehicle(v: FleetVehicle, dtS: number): void {
    if (v.currentStop !== null) {
      v.dwellS = Math.max(0, v.dwellS - dtS);
      v.speedMps = 0;
      if (v.dwellS > 0 || this.passengerService?.busy(v.id)) return;
      // Turn around only after everyone is clear of the vehicle.
      if (
        !this.passengerService &&
        (v.currentStop === 0 || v.currentStop === this.route.stops.length - 1)
      )
        v.direction = v.direction === 1 ? -1 : 1;
      v.nextStop = this.nextStopIndex(v.s + v.direction * 0.01, v.direction);
      v.currentStop = null;
      return;
    }

    const stop = this.route.stops[v.nextStop];
    const isTerminalNext = v.nextStop === 0 || v.nextStop === this.route.stops.length - 1;
    // Slow for the stop if anyone could get on or off there (or it is the end).
    const mayStop =
      stop && (isTerminalNext || (this.waiting[v.nextStop] ?? 0) > 0 || v.occupancy > 0);

    // Speed the jeepney wants: cruise, but able to brake in time for the stop
    // and for the jeepney ahead (v² = 2·a·d).
    const room = Math.max(0, this.gapAhead(v) - MIN_GAP_M);
    let target = Math.min(v.cruiseMps, Math.sqrt(2 * BRAKE_MPS2 * room));
    if (mayStop) {
      const toStop = Math.abs(stop.s - v.s);
      target = Math.min(target, Math.max(CREEP_MPS, Math.sqrt(2 * BRAKE_MPS2 * toStop)));
    }
    // Accelerate gently; braking follows the curve above, which is smooth.
    v.speedMps = target > v.speedMps ? Math.min(target, v.speedMps + ACCEL_MPS2 * dtS) : target;
    // Never drive through the jeepney ahead in the same direction.
    const sNew = v.s + v.direction * Math.min(v.speedMps * dtS, room);

    const reachedStop = stop && (v.direction === 1 ? sNew >= stop.s : sNew <= stop.s);
    if (!reachedStop) {
      v.s = sNew;
      return;
    }

    v.s = stop.s;
    v.speedMps = 0;
    v.currentStop = v.nextStop;
    if (this.passengerService) {
      v.dwellS = isTerminalNext ? TERMINAL_DWELL_S : 3;
      this.passengerService.arrive(v, v.currentStop);
    } else if (isTerminalNext) {
      // Everyone gets off at the terminal; the jeepney turns around.
      v.occupancy = 0;
      v.dwellS = TERMINAL_DWELL_S;
    } else {
      const remaining = v.direction === 1 ? this.route.stops.length - 1 - v.nextStop : v.nextStop;
      const alighting = binomial(this.rng, v.occupancy, 1 / Math.max(1, remaining));
      v.occupancy -= alighting;
      const boarding = Math.min(this.waiting[v.nextStop]!, v.capacity - v.occupancy);
      this.waiting[v.nextStop]! -= boarding;
      v.occupancy += boarding;
      if (alighting + boarding > 0) v.dwellS = 3 + 1.4 * (alighting + boarding);
    }
  }

  private gapAhead(v: FleetVehicle): number {
    let gap = Number.POSITIVE_INFINITY;
    for (const o of this.vehicles) {
      if (o === v || o.direction !== v.direction) continue;
      const d = (o.s - v.s) * v.direction;
      if (d > 0 && d < gap) gap = d;
    }
    return gap;
  }

  private nextStopIndex(s: number, direction: 1 | -1): number {
    const stops = this.route.stops;
    if (direction === 1) {
      const i = stops.findIndex((st) => st.s >= s);
      return i === -1 ? stops.length - 1 : i;
    }
    for (let i = stops.length - 1; i >= 0; i--) if (stops[i]!.s <= s) return i;
    return 0;
  }
}

function binomial(rng: Rng, n: number, p: number): number {
  let k = 0;
  for (let i = 0; i < n; i++) if (rng() < p) k++;
  return k;
}
