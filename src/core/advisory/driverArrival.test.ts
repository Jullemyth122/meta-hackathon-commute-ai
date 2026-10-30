import { describe, expect, it } from 'vitest';
import { Polyline } from '../geo/polyline';
import type { PassengerState, TwinState } from './model';
import { arrivalHeadsUp, driverView } from './driver';
import { dispatch } from './dispatch';
import { driverScreen, operatorScreen } from './screen';
import { arrivalAdvice } from '../../../api/_lib/arrivalAdvice';

const rider = (id: number, extra: Partial<PassengerState> = {}): PassengerState => ({
  id,
  phase: 'approaching',
  originStop: 1,
  destinationStop: 2,
  direction: 1,
  vehicle: null,
  x: 900,
  z: 0,
  queuedAt: id,
  approachMode: 'walk',
  distanceToStopM: 100,
  arrivalInS: 70,
  ...extra,
});
const scene = (passengers: PassengerState[]): TwinState => ({
  route: {
    id: 'incoming',
    name: 'Incoming test',
    source: 'synthetic',
    projection: null,
    stopsSource: 'placeholder',
    loop: false,
    polyline: new Polyline([
      { x: 0, z: 0 },
      { x: 2000, z: 0 },
    ]),
    stops: [
      { name: 'Start', s: 0, terminal: true },
      { name: 'Pickup', s: 1000 },
      { name: 'End', s: 2000, terminal: true },
    ],
  },
  vehicles: [
    {
      index: 0,
      plate: 'TEST',
      s: 500,
      direction: 1,
      speedMps: 10,
      occupancy: 0,
      capacity: 20,
      atStop: null,
      x: 500,
      z: 0,
      heading: 0,
    },
  ],
  passengers,
});

describe('driver arrival heads-up', () => {
  it('separates the queue from matching approaches within 500 m and compares ETAs', () => {
    const state = scene([
      rider(1, { phase: 'waiting' }),
      rider(2, { approachMode: 'tricycle', arrivalInS: 20 }),
      rider(3, { distanceToStopM: 500, arrivalInS: 350 }),
      rider(4, { distanceToStopM: 501 }),
      rider(5, { direction: -1 }),
      rider(6, { phase: 'walking' }),
    ]);
    const plan = dispatch(state);
    const stop = driverView(state, 0, plan).ahead[0]!;
    expect(stop.waiting).toBe(1);
    expect(stop.incoming.map((p) => p.passenger)).toEqual([2, 3]);
    expect(stop.arrivingBeforeYou).toBe(1);
    expect(plan.claimedAt(0, 1)).toBe(1);
    expect(plan.vehicleFor(2)).toBeNull();
    expect(arrivalHeadsUp(stop)).toContain('1 waiting now, 2 approaching');
    expect(arrivalHeadsUp(stop)).toContain('1 by tricycle');
  });

  it('does not command a stop or reserve seats just because someone is approaching', () => {
    const state = scene([rider(1, { arrivalInS: 10 })]);
    const stop = driverView(state, 0, dispatch(state)).ahead[0]!;
    expect(stop).toMatchObject({ action: 'pass', waiting: 0, forYou: 0, arrivingBeforeYou: 1 });
    expect(arrivalHeadsUp(stop)).toContain('Recheck on arrival; seats are not reserved');
  });

  it('includes incoming-only stops in the operator summary and bounded driver facts', () => {
    const state = scene(Array.from({ length: 100 }, (_, i) => rider(i)));
    const plan = dispatch(state);
    const screen = driverScreen(driverView(state, 0, plan));
    expect(screen.nextStops[0]).toMatchObject({
      waiting: 0,
      approaching: 100,
      walking: 100,
      byTricycle: 0,
    });
    expect(JSON.stringify(screen).length).toBeLessThan(3000);
    const operator = operatorScreen(state, plan);
    expect(operator.approachingWithin500m).toBe(100);
    expect(operator.busiestStops[0]).toMatchObject({
      stop: 'Pickup',
      waiting: 0,
      approaching: 100,
    });
  });
});

describe('arrival answers without an external model', () => {
  it('uses the displayed distinction and current stop/pass decision', () => {
    const state = scene([rider(1, { approachMode: 'tricycle', arrivalInS: 120 })]);
    const screen = driverScreen(driverView(state, 0, dispatch(state)));
    const answer = arrivalAdvice('Are commuters approaching the next stop?', 'driver', screen);
    expect(answer).toContain('0 waiting now; 1 approaching within 500 m');
    expect(answer).toContain('2 min');
    expect(answer).toContain('Pass:');
    expect(answer).toContain('simulation estimates');
    expect(arrivalAdvice('How much is diesel?', 'driver', screen)).toBeNull();
  });

  it('reports an individual first-mile trip and rejects malformed facts', () => {
    expect(
      arrivalAdvice('When will I reach the stop?', 'commuter', {
        approachingStop: { mode: 'tricycle', distanceM: 300, etaMin: 1 },
        stop: 'Pickup',
        yourJeepney: null,
      }),
    ).toContain('No catchable jeepney with a seat');
    expect(
      arrivalAdvice('Are people approaching?', 'driver', {
        nextStops: [{ name: 'Pickup', waiting: -1, approaching: 'many' }],
      }),
    ).toBeNull();
  });

  it('keeps the default commuter pickup and seat questions consistent with first-mile timing', () => {
    for (const question of ['When does my jeepney come?', 'Will it have a seat for me?']) {
      expect(
        arrivalAdvice(question, 'commuter', {
          approachingStop: { mode: 'walk', distanceM: 500, etaMin: 6 },
          stop: 'Pickup',
          yourJeepney: null,
        }),
      ).toContain('No catchable jeepney with a seat');
    }
  });
});
