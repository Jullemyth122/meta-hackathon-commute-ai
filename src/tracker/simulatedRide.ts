/**
 * A jeepney ride for testing the tracker without going anywhere: GPS fixes
 * along a route, as a phone on board would report them. Wait at the first
 * stop, pull away, drive at jeepney speed, slow for each stop and stand
 * there a moment, and stand still at the end of the route.
 *
 * The fixes carry everyday phone GPS error (a few metres, with the accuracy
 * the phone would claim), so they go through the same filter and trip state
 * machine as real ones and reach the dashboard the same way. Nothing here is
 * the phone's own location.
 */

import type { Route } from '@/core/geo/routes';
import { createRng, gaussian, type Rng } from '@/core/math/random';
import type { GpsFix } from '@/core/tracking/types';

/** Standing at the first stop before the jeepney pulls away (seconds). */
const FIRST_WAIT_S = 20;
/** About 30 km/h: a jeepney on a clear stretch. */
const CRUISE_MPS = 8.5;
const ACCEL_MPS2 = 1;
const BRAKE_MPS2 = 1.2;
const CREEP_MPS = 0.8;
/** At each stop on the way, riders getting on and off (seconds). */
const DWELL_S = 12;
/** Physics step: fixes come about once a second, the motion in finer steps. */
const STEP_S = 0.1;
/** A long gap (a throttled background tab) is caught up to at most this (seconds). */
const MAX_CATCH_UP_S = 600;
/** Claimed accuracy range of an outdoor phone fix (metres, ~68% radius). */
const ACCURACY_M = { min: 5, max: 12 } as const;

interface Target {
  s: number;
  name: string;
  dwellS: number;
}

export class SimulatedRide {
  private s: number;
  private speedMps = 0;
  private holdS = FIRST_WAIT_S;
  private next = 0;
  private readonly targets: Target[];
  private readonly from: string;

  constructor(
    private readonly route: Route,
    private readonly rng: Rng = createRng(Date.now() >>> 0),
  ) {
    if (!route.projection) throw new Error('A simulated ride needs a route on the map');
    const [first, ...rest] = route.stops;
    this.s = first?.s ?? 0;
    this.from = first?.name ?? 'the start';
    const end = route.loop ? route.polyline.length : (route.stops.at(-1)?.s ?? 0);
    this.targets = [
      ...rest
        .filter((st) => st.s > this.s + 1 && st.s < end - 1)
        .map((st) => ({ s: st.s, name: st.name, dwellS: DWELL_S })),
      { s: end, name: route.loop ? this.from : (route.stops.at(-1)?.name ?? 'the end'), dwellS: 0 },
    ];
  }

  /** The route's end reached: standing still from now on. */
  get done(): boolean {
    return this.next >= this.targets.length;
  }

  /** Move on by `dtS` seconds and report a fix taken at `timestamp` (epoch ms). */
  advance(dtS: number, timestamp: number): GpsFix {
    let left = Math.min(Math.max(0, dtS), MAX_CATCH_UP_S);
    while (left > 1e-9) {
      const dt = Math.min(STEP_S, left);
      this.step(dt);
      left -= dt;
    }
    return this.fix(timestamp);
  }

  /** What the ride is doing, in a few words, for the tracker screen. */
  describe(): string {
    if (this.done) return `End of the route · ${this.targets.at(-1)!.name}`;
    const target = this.targets[this.next]!;
    if (this.holdS > 0) {
      const at = this.next === 0 ? this.from : this.targets[this.next - 1]!.name;
      return `At ${at} · leaving in ${Math.ceil(this.holdS)} s`;
    }
    const km = (target.s - this.s) / 1000;
    return `${(this.speedMps * 3.6).toFixed(0)} km/h to ${target.name} · ${km.toFixed(1)} km`;
  }

  private step(dt: number): void {
    if (this.holdS > 0) {
      this.holdS = Math.max(0, this.holdS - dt);
      this.speedMps = 0;
      return;
    }
    const target = this.targets[this.next];
    if (!target) {
      this.speedMps = 0;
      return;
    }
    const left = target.s - this.s;
    // Cruise, braking in time for the stop (v² = 2·a·d).
    const want = Math.min(CRUISE_MPS, Math.max(CREEP_MPS, Math.sqrt(2 * BRAKE_MPS2 * left)));
    this.speedMps = want > this.speedMps ? Math.min(want, this.speedMps + ACCEL_MPS2 * dt) : want;
    const move = this.speedMps * dt;
    if (move < left) {
      this.s += move;
      return;
    }
    this.s = target.s;
    this.speedMps = 0;
    this.holdS = target.dwellS;
    this.next++;
  }

  private fix(timestamp: number): GpsFix {
    const p = this.route.polyline.pointAt(this.s);
    const accuracyM = ACCURACY_M.min + this.rng() * (ACCURACY_M.max - ACCURACY_M.min);
    // Accuracy is a ~68% radius: about half of it each way.
    const sigma = accuracyM / 2;
    const at = this.route.projection!.toGeo({
      x: p.x + gaussian(this.rng) * sigma,
      z: p.z + gaussian(this.rng) * sigma,
    });
    return {
      lat: at.lat,
      lng: at.lng,
      accuracyM,
      speedMps: this.speedMps,
      headingDeg: null,
      timestamp,
    };
  }
}
