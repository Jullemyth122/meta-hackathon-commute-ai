import { describe, expect, it } from 'vitest';
import { FleetSim, DEFAULT_FLEET } from '../fleet/fleetSim';
import { DEFAULT_SCENARIO } from '../fleet/scenario';
import { defaultRoute, isTerminal } from '../geo/routes';
import type { LocalPoint } from '../geo/projection';
import { kerbOf, onRouteRoad, stopAreaQuads, stopPoint, waitingSpot } from './stopLayout';

const route = defaultRoute();
const STOP = route.stops.findIndex((s) => s.name === 'Lagro');

/** Where a point is relative to the stop: metres along the road, and in from the kerb. */
function local(p: LocalPoint): { along: number; inM: number } {
  const o = stopPoint(route, STOP, 1, 0, 0);
  const a = stopPoint(route, STOP, 1, 1, 0);
  const fx = a.x - o.x;
  const fz = a.z - o.z;
  const dx = p.x - o.x;
  const dz = p.z - o.z;
  // Forward is (fx, fz); right of travel, towards the pavement, is (−fz, fx).
  return { along: dx * fx + dz * fz, inM: dx * -fz + dz * fx - kerbOf(route, STOP) };
}

describe('a crowd at a stop, not a queue', () => {
  const crowd: LocalPoint[] = [];
  for (let id = 1; id <= 40; id++) crowd.push(waitingSpot(route, STOP, 1, id, crowd));

  it('keeps everyone on the pavement near the stop', () => {
    for (const p of crowd) {
      const { along, inM } = local(p);
      expect(Math.abs(along)).toBeLessThanOrEqual(10.01);
      expect(inM).toBeGreaterThan(0.2);
      expect(inM).toBeLessThan(6.5);
    }
  });

  it('gives each person their own space', () => {
    let closest = Infinity;
    for (let i = 0; i < crowd.length; i++)
      for (let j = i + 1; j < crowd.length; j++)
        closest = Math.min(
          closest,
          Math.hypot(crowd[i]!.x - crowd[j]!.x, crowd[i]!.z - crowd[j]!.z),
        );
    expect(closest).toBeGreaterThanOrEqual(0.6);
  });

  it('is scattered, not lined up in rows', () => {
    const rows = new Set(crowd.map((p) => local(p).inM.toFixed(1)));
    expect(rows.size).toBeGreaterThan(25);
  });

  it('puts the same person in the same spot every replay', () => {
    expect(waitingSpot(route, STOP, 1, 7, [])).toEqual(waitingSpot(route, STOP, 1, 7, []));
  });
});

describe('nobody waits in the road', () => {
  it('keeps every waiting spot and stop area off the route’s roads, bends included', () => {
    // The SM City Fairview terminal sits in a tight loop of service roads:
    // the old straight-line layout put its crowd across the road there.
    for (let stop = 0; stop < route.stops.length; stop++) {
      const crowd: LocalPoint[] = [];
      for (let id = 1; id <= 30; id++) {
        const p = waitingSpot(route, stop, 1, id, crowd);
        expect(onRouteRoad(route, p), `${route.stops[stop]!.name} #${id}`).toBe(false);
        crowd.push(p);
      }
      for (const quad of stopAreaQuads(route, stop, 1))
        for (const p of quad) expect(onRouteRoad(route, p)).toBe(false);
    }
  });
});

describe('riders by stop', () => {
  it('sends about three times the riders to a terminal as to an ordinary stop', () => {
    const fleet = new FleetSim(route, { ...DEFAULT_FLEET, scenario: DEFAULT_SCENARIO });
    const arrived = route.stops.map(() => 0);
    fleet.passengerService = {
      demand: (stop, count) => void (arrived[stop]! += count),
      arrive: () => {},
      pickUp: () => {},
      busy: () => false,
      wantsStop: () => true,
      dropsAt: () => false,
    };
    for (let i = 0; i < 3 * 3600; i++) fleet.step(1);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const terminal = mean(arrived.filter((_, i) => isTerminal(route, i)));
    const ordinary = mean(arrived.filter((_, i) => !isTerminal(route, i)));
    expect(terminal / ordinary).toBeGreaterThan(2.4);
    expect(terminal / ordinary).toBeLessThan(3.6);
  });

  it('starts the day with people already waiting', () => {
    const fleet = new FleetSim(route, { ...DEFAULT_FLEET, scenario: DEFAULT_SCENARIO });
    expect(fleet.waiting.reduce((a, b) => a + b, 0)).toBeGreaterThan(20);
  });
});
