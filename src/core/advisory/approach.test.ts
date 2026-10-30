import { describe, expect, it } from 'vitest';
import { incomingAtStop } from './approach';
import type { PassengerState, TwinState } from './model';
import { defaultRoute } from '../geo/routes';

function passenger(id: number, extra: Partial<PassengerState> = {}): PassengerState {
  return {
    id,
    phase: 'approaching',
    originStop: 1,
    destinationStop: 2,
    direction: 1,
    vehicle: null,
    x: 0,
    z: 0,
    queuedAt: Infinity,
    approachMode: 'walk',
    distanceToStopM: 100,
    arrivalInS: 70,
    ...extra,
  };
}
const state = (passengers: PassengerState[]): TwinState => ({
  route: defaultRoute(),
  vehicles: [],
  passengers,
});

describe('incoming commuters at a stop', () => {
  it('separates waiting, other stops, other directions and unknown/invalid estimates', () => {
    const s = state([
      passenger(1),
      passenger(2, { phase: 'waiting' }),
      passenger(3, { originStop: 2 }),
      passenger(4, { direction: -1 }),
      passenger(5, { distanceToStopM: undefined }),
      passenger(6, { arrivalInS: undefined }),
      passenger(7, { arrivalInS: NaN }),
      passenger(8, { vehicle: 0 }),
      passenger(9, { distanceToStopM: -1 }),
      passenger(10, { arrivalInS: -1 }),
    ]);
    expect(incomingAtStop(s, 1, 1).map((p) => p.passenger)).toEqual([1]);
    expect(incomingAtStop(s, 1).map((p) => p.passenger)).toEqual([1, 4]);
  });
  it('includes the 500 m boundary, sorts by arrival and keeps tricycle mode', () => {
    const s = state([
      passenger(1, { distanceToStopM: 500, arrivalInS: 350 }),
      passenger(2, { distanceToStopM: 500.1 }),
      passenger(3, { distanceToStopM: 300, arrivalInS: 60, approachMode: 'tricycle' }),
    ]);
    expect(incomingAtStop(s, 1)).toEqual([
      { passenger: 3, distanceM: 300, etaS: 60, mode: 'tricycle' },
      { passenger: 1, distanceM: 500, etaS: 350, mode: 'walk' },
    ]);
  });
});
