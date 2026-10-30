import { describe, expect, it } from 'vitest';
import { FleetSim, DEFAULT_FLEET, type FleetVehicle } from '../fleet/fleetSim';
import { Polyline } from '../geo/polyline';
import type { Route } from '../geo/routes';
import { PassengerSystem } from './passengerSystem';
import { newRiderPose } from './riderMotion';
import { waitingSpot } from './stopLayout';
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
  loop: false,
  stops: [
    { name: 'A', s: 0, terminal: true },
    { name: 'B', s: 100 },
    { name: 'C', s: 200, terminal: true },
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
      r.spot = waitingSpot(route, 1, 1, r.id, []);
      Object.assign(r.pose, r.spot);
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
    let clock = 0;
    const gotIn: number[] = [];
    const wasInside = new Set<number>();
    for (let frame = 0; frame < 2400 && crew.busy(0); frame++) {
      const dt = [1 / 60, 1 / 24, 0.1][frame % 3]!;
      step(dt);
      clock += dt;
      const riders = [...crew.passengers.values()];
      expect(v.occupancy).toBe(riders.filter((r) => r.vehicleId === 0 && r.inside).length);
      // Boarders walk up together but climb in one at a time.
      for (const r of riders)
        if (r.phase === 'boarding' && r.inside && !wasInside.has(r.id)) {
          wasInside.add(r.id);
          gotIn.push(clock);
        }
      // One alighter on the step at a time.
      expect(riders.filter((r) => r.phase === 'alighting' && !r.inside).length).toBeLessThanOrEqual(
        1,
      );
      // Nobody boards while someone is still getting off.
      expect(
        riders.some((r) => r.phase === 'boarding') && riders.some((r) => r.phase === 'alighting'),
      ).toBe(false);
      expect(v.speedMps).toBe(0);
      expect(v.s).toBe(100);
      if (v.occupancy < 2) sawLowerCount = true;
    }
    expect(crew.busy(0)).toBe(false);
    expect(sawLowerCount).toBe(true);
    expect(v.occupancy).toBe(2);
    expect(fleet.waiting[1]).toBe(0);
    // Climbing in about DOOR_HEADWAY_S (1.4 s) apart, give or take a tick.
    expect(gotIn).toHaveLength(2);
    expect(gotIn[1]! - gotIn[0]!).toBeGreaterThanOrEqual(1.4 - 0.11);
    // Same people throughout; those who got off may have left the twin already.
    expect([...crew.passengers.keys()].every((id) => ids.includes(id))).toBe(true);
    // Everyone is on board; the last one in may still be walking to a seat.
    expect(incoming.every((r) => r.inside && r.history.some((h) => h.phase === 'boarding'))).toBe(
      true,
    );
    expect(
      ids.slice(0, 2).every((id) => {
        const r = crew.passengers.get(id);
        return !r || r.phase === 'walking' || r.phase === 'arrived';
      }),
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

  it('lets arrived people stand a moment, fade out, and leave the twin', () => {
    const { crew, stop, step } = setup(1, 0);
    const id = [...crew.passengers.keys()][0]!;
    stop();
    let arrived = null as ReturnType<typeof crew.passengers.get> | null;
    let faded = false;
    for (let i = 0; i < 900 && crew.passengers.has(id); i++) {
      step(0.1);
      const r = crew.passengers.get(id);
      if (r?.phase === 'arrived') {
        arrived = r;
        expect(r.vehicleId).toBeNull();
        if (crew.visibility(r) < 1) faded = true;
      }
    }
    expect(arrived?.history.map((h) => h.phase)).toEqual([
      'seated',
      'alighting',
      'walking',
      'arrived',
    ]);
    expect(faded).toBe(true);
    expect(crew.passengers.has(id)).toBe(false);
    expect(crew.delivered).toBe(1);
  });

  it('fades newcomers in as they walk up to the stop', () => {
    const { crew, step } = setup(0, 0);
    crew.demand(1, 1);
    const r = [...crew.passengers.values()].find((p) => p.phase === 'approaching')!;
    expect(crew.visibility(r)).toBe(0);
    step(0.4);
    expect(crew.visibility(r)).toBeGreaterThan(0);
    step(1);
    expect(crew.visibility(r)).toBe(1);
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

  it('never pulls away while someone is still walking along the outside to the step', () => {
    const { crew, stop, step } = setup(0, 3);
    // Stand the queue up the road, beside where the cabin will be.
    for (const r of crew.passengers.values())
      if (r.phase === 'waiting') {
        r.spot = waitingSpot(route, 1, 1, r.id, []);
        Object.assign(r.pose, { ...r.spot, x: 100 + 4 + r.id });
      }
    stop();
    let sawOutside = false;
    for (let i = 0; i < 2000 && crew.busy(0); i++) {
      step(0.05);
      for (const r of crew.passengers.values()) {
        if (r.phase !== 'boarding') continue;
        // Beside the jeepney is not in it, and while anyone is out there it waits.
        if (Math.abs(r.pose.z) > 1) {
          sawOutside = true;
          expect(r.inside).toBe(false);
          expect(crew.busy(0)).toBe(true);
        }
      }
    }
    expect(sawOutside).toBe(true);
    expect([...crew.passengers.values()].every((r) => r.phase === 'seated' || r.inside)).toBe(true);
  });

  it('waits for someone hurrying to the stop when there is a seat', () => {
    const { crew, stop, step } = setup(0, 0);
    crew.demand(1, 1);
    const runner = [...crew.passengers.values()].find((r) => r.phase === 'approaching')!;
    runner.t = runner.motion!.duration - 3; // three seconds from the stop
    stop();
    for (let i = 0; i < 2000 && crew.busy(0); i++) step(0.05);
    expect(runner.history.some((h) => h.phase === 'boarding')).toBe(true);
    expect(runner.vehicleId).toBe(0);
  });

  /** Two jeepneys and a crowd of `crowd` at stop B, all going to C. */
  function rush(crowd: number) {
    const fleet = new FleetSim(route, { ...DEFAULT_FLEET, count: 2, demandPerStopPerMin: 0 });
    fleet.waiting.fill(0);
    const [a, b] = fleet.vehicles as [FleetVehicle, FleetVehicle];
    Object.assign(a, { s: 99, nextStop: 1, occupancy: 0, direction: 1, speedMps: 1 });
    Object.assign(b, { s: 60, nextStop: 1, occupancy: 0, direction: 1, speedMps: 6 });
    const layout = JEEPNEY_PASSENGER_LAYOUT;
    const crew = new PassengerSystem(fleet, [layout, layout], (i, out) => fleetPose(fleet, i, out));
    crew.demand(1, crowd, true);
    for (const r of crew.passengers.values()) {
      r.direction = 1;
      r.destinationStop = 2;
      r.spot = waitingSpot(route, 1, 1, r.id, []);
      Object.assign(r.pose, r.spot);
    }
    const step = (dt = 0.05) => {
      fleet.step(dt);
      crew.update(dt);
    };
    return { fleet, crew, a, b, step };
  }

  it('lets a jeepney queued close behind load at the same stop, not wait its turn', () => {
    const { crew, a, b, step } = rush(30);
    let bothLoading = false;
    for (let i = 0; i < 4000 && !bothLoading; i++) {
      step();
      bothLoading = a.currentStop === 1 && b.currentStop === 1 && crew.busy(1);
    }
    expect(bothLoading).toBe(true);
    // The second one opened its door where it stood in the queue, short of the stop.
    expect(b.s).toBeLessThan(route.stops[1]!.s - 10);
  });

  it('boards a big crowd quickly: walking up together, climbing in one by one', () => {
    const { crew, a, step } = rush(20);
    let seconds = 0;
    while (seconds < 120 && !(a.currentStop === 1 && !crew.busy(0) && seconds > 1)) {
      step();
      seconds += 0.05;
    }
    const aboard = [...crew.passengers.values()].filter((r) => r.vehicleId !== null).length;
    expect(aboard).toBe(20);
    // ~2.3 s a head (1.4 s apart at the step, plus the walk for the first):
    // about 46 s for twenty, where one-at-a-time took 6–8 s each.
    expect(seconds).toBeLessThan(60);
  });

  it('overtakes a jeepney loading at a stop it does not need, instead of queueing', () => {
    const fleet = new FleetSim(route, { ...DEFAULT_FLEET, count: 2, demandPerStopPerMin: 0 });
    fleet.waiting.fill(0);
    const [a, b] = fleet.vehicles as [FleetVehicle, FleetVehicle];
    Object.assign(a, { s: 99, nextStop: 1, occupancy: 0, direction: 1, speedMps: 1 });
    // B is full, and everyone on it rides to C: nothing for it at B.
    Object.assign(b, { s: 40, nextStop: 1, occupancy: 22, direction: 1, speedMps: 7 });
    const layout = JEEPNEY_PASSENGER_LAYOUT;
    const crew = new PassengerSystem(fleet, [layout, layout], (i, out) => fleetPose(fleet, i, out));
    for (const r of crew.passengers.values()) if (r.vehicleId === 1) r.destinationStop = 2;
    crew.demand(1, 15, true);
    for (const r of crew.passengers.values())
      if (r.phase === 'waiting') {
        r.direction = 1;
        r.destinationStop = 2;
        r.spot = waitingSpot(route, 1, 1, r.id, []);
        Object.assign(r.pose, r.spot);
      }
    let passed = false;
    let swungOut = 0;
    for (let i = 0; i < 2000 && !passed; i++) {
      fleet.step(0.05);
      crew.update(0.05);
      swungOut = Math.min(swungOut, b.laneShiftM);
      passed = b.s > a.s + 5 && a.currentStop === 1;
    }
    expect(passed).toBe(true); // went round while A was still loading
    expect(swungOut).toBeLessThan(-1.5); // out into the road to do it
    expect(b.currentStop).toBeNull();
  });

  it('lets riders off in a queue short of their stop, and still calls at the stop', () => {
    const fleet = new FleetSim(route, { ...DEFAULT_FLEET, count: 2, demandPerStopPerMin: 0 });
    fleet.waiting.fill(0);
    const [a, b] = fleet.vehicles as [FleetVehicle, FleetVehicle];
    // A stands in the traffic 40 m before the stop (the end of a long queue):
    // B is held up about 54 m back.
    Object.assign(a, { s: 60, nextStop: 1, occupancy: 0, direction: 1, currentStop: 0 });
    Object.assign(a, { speedMps: 0, dwellS: 1e6 });
    Object.assign(b, { s: 20, nextStop: 1, occupancy: 4, direction: 1, speedMps: 7 });
    const layout = JEEPNEY_PASSENGER_LAYOUT;
    const crew = new PassengerSystem(fleet, [layout, layout], (i, out) => fleetPose(fleet, i, out));
    const off = [...crew.passengers.values()].filter((r) => r.vehicleId === 1);
    for (const r of off) r.destinationStop = 1;
    let letOffAt = Infinity;
    for (let i = 0; i < 4000 && letOffAt === Infinity; i++) {
      fleet.step(0.05);
      crew.update(0.05);
      if (off.every((r) => r.vehicleId === null)) letOffAt = b.s;
    }
    // Got off in the queue, more than the boarding zone back from the stop…
    expect(letOffAt).toBeLessThan(route.stops[1]!.s - 30);
    // …and the jeepney has still to call at the stop for anyone waiting.
    expect(b.nextStop).toBe(1);
  });

  it('drives past a stop where nobody gets on or off', () => {
    const { fleet, crew, v } = setup(0, 0);
    let stopped = false;
    for (let i = 0; i < 400 && v.s < 120; i++) {
      fleet.step(0.05);
      crew.update(0.05);
      stopped ||= v.currentStop === 1;
    }
    expect(stopped).toBe(false);
    expect(v.s).toBeGreaterThan(105);
  });

  it('uses the supplied capacity for a larger vehicle instead of assuming 22 seats', () => {
    const { crew, v } = setup(40, 0, 48);
    expect(v.capacity).toBe(48);
    expect(v.occupancy).toBe(40);
    expect(new Set([...crew.passengers.values()].map((r) => r.seat)).size).toBe(40);
  });
});
