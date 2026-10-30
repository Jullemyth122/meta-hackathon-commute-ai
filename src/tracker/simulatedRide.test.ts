import { describe, expect, it } from 'vitest';
import { defaultRoute } from '@/core/geo/routes';
import { createRng } from '@/core/math/random';
import { GpsFilter } from '@/core/tracking/gpsFilter';
import { LiveVehicle } from '@/core/tracking/liveVehicle';
import { initialTripState, stepTrip, type TripState } from '@/core/tracking/tripState';
import { SimulatedRide } from './simulatedRide';

describe('SimulatedRide', () => {
  it('drives the tracker and the dashboard as a phone on a jeepney would', () => {
    const route = defaultRoute();
    const ride = new SimulatedRide(route, createRng(4));
    const filter = new GpsFilter();
    const live = new LiveVehicle(route);
    let trip: TripState = initialTripState;
    const t0 = 1_700_000_000_000;
    let possibleAt: number | null = null;
    let rejected = 0;
    let unmatched = 0;

    for (let k = 0; k <= 180; k++) {
      const fix = ride.advance(k === 0 ? 0 : 1, t0 + k * 1000);
      if (!filter.push(fix)) rejected++;
      trip = stepTrip(trip, {
        kind: 'motion',
        now: fix.timestamp,
        motion: filter.estimate(),
        onRoute: null,
      });
      if (trip.phase === 'POSSIBLE_VEHICLE') possibleAt ??= k;
      live.ingest(fix);
      if (!live.matched) unmatched++;
    }

    // Every fix is good enough to keep, and every one lies on the road.
    expect(rejected).toBe(0);
    expect(unmatched).toBe(0);
    // Standing at the stop first is not a ride; driving off soon is.
    expect(possibleAt).not.toBeNull();
    expect(possibleAt!).toBeGreaterThan(20);
    expect(possibleAt!).toBeLessThan(60);
  });

  it('stands still at the stop first, then runs to the end of the route and stops there', () => {
    const route = defaultRoute();
    const ride = new SimulatedRide(route, createRng(9));
    const start = route.polyline.pointAt(route.stops[0]!.s);
    const first = route.projection!.toLocal(ride.advance(0, 0));
    expect(Math.hypot(first.x - start.x, first.z - start.z)).toBeLessThan(40);
    expect(ride.advance(10, 10_000).speedMps).toBe(0);

    let t = 10_000;
    for (let k = 0; k < 4 * 3600 && !ride.done; k++) ride.advance(1, (t += 1000));
    expect(ride.done).toBe(true);
    const end = ride.advance(30, (t += 30_000));
    expect(end.speedMps).toBe(0);
    expect(ride.describe()).toMatch(/^End of the route/);
  });

  it('catches up after a long gap instead of crawling (a throttled background tab)', () => {
    const route = defaultRoute();
    const a = new SimulatedRide(route, createRng(1));
    const b = new SimulatedRide(route, createRng(1));
    for (let k = 0; k < 120; k++) a.advance(1, k * 1000);
    b.advance(120, 0);
    const pa = route.projection!.toLocal(a.advance(0, 200_000));
    const pb = route.projection!.toLocal(b.advance(0, 200_000));
    // Same ride, sampled differently: within GPS noise of each other.
    expect(Math.hypot(pa.x - pb.x, pa.z - pb.z)).toBeLessThan(60);
  });
});
