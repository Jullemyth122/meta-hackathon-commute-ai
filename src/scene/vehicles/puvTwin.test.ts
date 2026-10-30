import { describe, expect, it } from 'vitest';
import { TwinRuntime } from '@/app/twinRuntime';
import { FARE_BY_VEHICLE, fareFor } from '@/core/fare';
import { FIELD_SCENARIO } from '@/core/fleet/scenario';
import { defaultRoute, isTerminal } from '@/core/geo/routes';
import { newRiderPose } from '@/core/people/riderMotion';
import { fleetKinds, VEHICLES, type FleetKind } from '@/core/vehicles/specs';
import { puvLayout } from './puvCrew';

describe('modern jeepneys, UV Express and buses in the live twin', () => {
  it('a few of each in the fleet', () => {
    const kinds = fleetKinds(60);
    const count = (k: FleetKind) => kinds.filter((x) => x === k).length;
    expect(count('modern')).toBe(5);
    expect(count('bus')).toBe(3);
    expect(count('uv')).toBe(3);
    expect(count('jeepney')).toBe(49);
    expect(fleetKinds(8).every((k) => k === 'jeepney')).toBe(true);
  });

  it('fares by the vehicle (LTFRB, 28 Sept 2026)', () => {
    expect(fareFor(4, false, FARE_BY_VEHICLE.jeepney)).toBe(14);
    expect(fareFor(6, false, FARE_BY_VEHICLE.modern)).toBe(21.75); // 17 + 2 × 2.40 = 21.80 → nearest 25 c
    expect(fareFor(5, false, FARE_BY_VEHICLE.bus)).toBe(18);
    expect(fareFor(7, false, FARE_BY_VEHICLE.bus)).toBe(24); // 18 + 2 × 2.98 = 23.96
    expect(fareFor(10, false, FARE_BY_VEHICLE.uv)).toBe(26);
    expect(fareFor(10, true, FARE_BY_VEHICLE.uv)).toBe(20.75); // 20% off 26 = 20.80
  });

  it(
    'riders get on each kind, sit in their own seats, and a UV Express loads only at its terminal',
    { timeout: 300_000 },
    () => {
      const twin = new TwinRuntime(defaultRoute(), undefined, { ...FIELD_SCENARIO, startHour: 6 });
      const { fleet, crew, route } = twin;
      const seen = new Map<FleetKind, Set<number>>();
      const uvBoardedAt = new Set<number>();
      const seat = newRiderPose();
      for (let k = 0; k < 2.5 * 3600 * 2; k++) {
        twin.step(0.5, 0);
        if (k % 20) continue;
        const bySeat = new Map<string, number>();
        for (const r of crew.passengers.values()) {
          if (r.vehicleId === null || r.seat === null) continue;
          const v = fleet.vehicles[r.vehicleId]!;
          // Nobody shares a seat.
          const key = `${v.id}:${r.seat}`;
          expect(bySeat.has(key), `two riders in seat ${key}`).toBe(false);
          bySeat.set(key, r.id);
          if (v.kind === 'jeepney') continue;
          (seen.get(v.kind) ?? seen.set(v.kind, new Set()).get(v.kind)!).add(r.id);
          if (v.kind === 'uv' && r.phase === 'boarding') uvBoardedAt.add(r.originStop);
          // Seated: exactly in the seat they were given.
          if (r.phase === 'seated') {
            puvLayout(v.kind).seated(r.seat, seat);
            expect(
              Math.hypot(r.pose.x - seat.x, r.pose.y - seat.y, r.pose.z - seat.z),
            ).toBeLessThan(0.01);
            expect(r.seat).toBeLessThan(VEHICLES[v.kind].seats);
          }
        }
      }
      // Riders on every kind, the capacity of each its seats.
      for (const kind of ['modern', 'uv', 'bus'] as const) {
        expect(seen.get(kind)?.size ?? 0, `riders on a ${kind}`).toBeGreaterThan(0);
        for (const v of fleet.vehicles.filter((x) => x.kind === kind))
          expect(v.capacity).toBe(VEHICLES[kind].seats);
      }
      for (const stop of uvBoardedAt) expect(isTerminal(route, stop)).toBe(true);
    },
  );
});
