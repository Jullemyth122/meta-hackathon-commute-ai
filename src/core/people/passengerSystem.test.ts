import { describe, expect, it } from 'vitest';
import { FleetSim, DEFAULT_FLEET } from '../fleet/fleetSim';
import { Polyline } from '../geo/polyline';
import type { Route } from '../geo/routes';
import { PassengerSystem } from './passengerSystem';
import { newRiderPose } from './riderMotion';
import { queuePoint } from './stopLayout';
import { JEEPNEY_PASSENGER_LAYOUT } from '@/scene/jeepney/crewState';
import { fleetPose } from '@/scene/world/lanes';

const route: Route = {
  id: 'journey-test',
  name: 'Test route',
  source: 'synthetic',
  projection: null,
  stopsSource: 'placeholder',
  polyline: new Polyline([
    { x: 0, z: 0 },
    { x: 100, z: 0 },
    { x: 200, z: 0 },
  ]),
  stops: [
    { name: 'A', s: 0 },
    { name: 'B', s: 100 },
    { name: 'C', s: 200 },
  ],
};

function setup(onboard = 2, waiting = 2, capacity = 22) {
  const fleet = new FleetSim(route, { ...DEFAULT_FLEET, count: 1, demandPerStopPerMin: 0 });
  const v = fleet.vehicles[0]!;
  Object.assign(v, { s: 90, nextStop: 1, occupancy: onboard, direction: 1 });
  fleet.waiting.fill(0);
  const base = JEEPNEY_PASSENGER_LAYOUT;
  const layout = {
    ...base,
    seats: Array.from({ length: capacity }, (_, i) => base.seats[i % 22]!),
    seatOrder: Array.from({ length: capacity }, (_, i) => i),
    seated: (i: number, out: ReturnType<typeof newRiderPose>) => base.seated(i % 22, out),
    board: (i: number, start: readonly [number, number, number]) => base.board(i % 22, start),
    alight: (i: number) => base.alight(i % 22),
  };
  const crew = new PassengerSystem(fleet, [layout], (i, out) => fleetPose(fleet, i, out));
  for (const r of crew.passengers.values()) r.destinationStop = 1;
  crew.demand(1, waiting, true);
  for (const r of crew.passengers.values())
    if (r.phase === 'waiting') {
      r.direction = 1;
      r.destinationStop = 2;
      Object.assign(r.pose, queuePoint(route, 1, 1, r.slot));
    }
  const stop = (index = 1) => {
    Object.assign(v, { s: route.stops[index]!.s, speedMps: 0, dwellS: 3, currentStop: index });
    crew.arrive(v, index);
  };
  const step = (dt = 0.1) => {
    fleet.step(dt);
    crew.update(dt);
  };
  return { fleet, crew, v, stop, step };
}

describe('persistent passenger journeys', () => {
  it('animates equal boarding and alighting instead of reconciling only the net count', () => {
    const { fleet, crew, v, stop, step } = setup();
    const ids = [...crew.passengers.keys()];
    const incoming = [...crew.passengers.values()].filter((r) => r.phase === 'waiting');
    stop();
    let sawLowerCount = false;
    for (let frame = 0; frame < 2400 && crew.busy(0); frame++) {
      step([1 / 60, 1 / 24, 0.1][frame % 3]!);
      const riders = [...crew.passengers.values()];
      expect(v.occupancy).toBe(riders.filter((r) => r.vehicleId === 0 && r.inside).length);
      expect(
        riders.filter((r) => r.phase === 'boarding' || r.phase === 'alighting').length,
      ).toBeLessThanOrEqual(1);
      expect(v.speedMps).toBe(0);
      expect(v.s).toBe(100);
      if (v.occupancy < 2) sawLowerCount = true;
    }
    expect(crew.busy(0)).toBe(false);
    expect(sawLowerCount).toBe(true);
    expect(v.occupancy).toBe(2);
    expect(fleet.waiting[1]).toBe(0);
    expect([...crew.passengers.keys()]).toEqual(ids);
    expect(
      incoming.every((r) => r.phase === 'seated' && r.history.some((h) => h.phase === 'boarding')),
    ).toBe(true);
    expect(
      ids
        .slice(0, 2)
        .every((id) => ['walking', 'arrived'].includes(crew.passengers.get(id)!.phase)),
    ).toBe(true);
  });

  it('preserves identity and continuous world positions at queue/vehicle and vehicle/street handoffs', () => {
    const { crew, stop, step } = setup(1, 1);
    stop();
    const previous = new Map<number, ReturnType<typeof newRiderPose>>();
    let boarded = false,
      exited = false;
    for (let frame = 0; frame < 1200 && crew.busy(0); frame++) {
      for (const r of crew.passengers.values())
        previous.set(r.id, crew.worldPose(r.id, newRiderPose())!);
      step(0.05);
      for (const r of crew.passengers.values()) {
        const p = crew.worldPose(r.id, newRiderPose())!,
          before = previous.get(r.id)!;
        expect(Math.hypot(p.x - before.x, p.z - before.z)).toBeLessThan(0.1);
        boarded ||= r.phase === 'boarding';
        exited ||= r.phase === 'walking';
      }
    }
    expect({ boarded, exited }).toEqual({ boarded: true, exited: true });
  });

  it('keeps departed people in the world and at their destination after the vehicle leaves', () => {
    const { crew, v, stop, step } = setup(1, 0);
    const id = [...crew.passengers.keys()][0]!;
    stop();
    for (let i = 0; i < 900; i++) step(0.1);
    const r = crew.passengers.get(id)!;
    expect(r.phase).toBe('arrived');
    expect(r.vehicleId).toBeNull();
    expect(r.history.map((h) => h.phase)).toEqual(['seated', 'alighting', 'walking', 'arrived']);
    const position = { ...r.pose };
    v.s = 150;
    for (let i = 0; i < 1200; i++) step(0.1);
    expect(crew.passengers.get(id)!.pose).toEqual(position);
  });

  it('leaves excess passengers waiting when seats are full, with unique seat assignments', () => {
    const { fleet, crew, stop, step, v } = setup(0, 5, 2);
    stop();
    for (let i = 0; i < 1500 && crew.busy(0); i++) step();
    expect(v.occupancy).toBe(2);
    expect(fleet.waiting[1]).toBe(3);
    expect([...crew.passengers.values()].filter((r) => r.phase === 'waiting')).toHaveLength(3);
    expect(
      new Set([...crew.passengers.values()].filter((r) => r.vehicleId === 0).map((r) => r.seat))
        .size,
    ).toBe(2);
  });

  it('does not reverse at a terminal while anybody is still on board or in the doorway', () => {
    const { crew, v, stop, step } = setup(3, 0);
    for (const r of crew.passengers.values()) r.destinationStop = 2;
    stop(2);
    for (let i = 0; i < 1200 && crew.busy(0); i++) {
      step();
      if (v.occupancy || [...crew.passengers.values()].some((r) => r.phase === 'alighting'))
        expect(v.direction).toBe(1);
    }
    expect(v.direction).toBe(-1);
    expect(v.occupancy).toBe(0);
    expect([...crew.passengers.values()]).toHaveLength(3);
  });

  it('uses the supplied capacity for a larger vehicle instead of assuming 22 seats', () => {
    const { crew, v } = setup(40, 0, 48);
    expect(v.capacity).toBe(48);
    expect(v.occupancy).toBe(40);
    expect(new Set([...crew.passengers.values()].map((r) => r.seat)).size).toBe(40);
  });
});
