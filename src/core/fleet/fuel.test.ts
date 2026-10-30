import { describe, expect, it } from 'vitest';
import { TwinRuntime } from '@/app/twinRuntime';
import { defaultRoute } from '../geo/routes';
import { FIELD_SCENARIO } from './scenario';

describe('diesel', () => {
  it(
    'tanks differ; nobody runs dry; they fill up in the forecourt, sometimes in line; the day’s diesel adds up and what is left carries over',
    { timeout: 900_000 },
    () => {
      const twin = new TwinRuntime(defaultRoute(), undefined, {
        ...FIELD_SCENARIO,
        vehicles: 24,
        dailyTrips: 24 * 60,
        startHour: 5,
      });
      const { fleet } = twin;
      const sizes = fleet.vehicles.map((v) => v.tankCapacityL);
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(40);
      expect(Math.max(...sizes)).toBeLessThanOrEqual(60);
      expect(new Set(sizes.map((x) => x.toFixed(1))).size).toBeGreaterThan(10);

      // The first morning: some filled the night before, some not.
      const start = fleet.vehicles.map((v) => v.tankL / v.tankCapacityL);
      expect(Math.min(...start)).toBeGreaterThanOrEqual(0.2);
      expect(Math.max(...start) - Math.min(...start)).toBeGreaterThan(0.5);
      expect(start.filter((x) => x >= 0.9).length).toBeGreaterThan(3);
      expect(start.filter((x) => x < 0.6).length).toBeGreaterThan(3);

      let lowest = Infinity;
      let nightFills = 0;
      // Each visit to a station: how long at the pump, whether it waited in line, how far off the road.
      const visiting = new Map<number, { pumpS: number; waited: boolean; offRoadM: number }>();
      const visits: Array<{ pumpS: number; waited: boolean; offRoadM: number }> = [];
      while (fleet.dayNumber <= 2) {
        twin.step(1, 0);
        for (const v of fleet.vehicles) {
          if (v.duty !== 'parked') lowest = Math.min(lowest, v.tankL / v.tankCapacityL);
          if (v.duty === 'homebound' && v.refuelLeftS > 0) nightFills++;
          const y = v.yard;
          const visit = visiting.get(v.id);
          if (y) {
            const now = visit ?? { pumpS: 0, waited: false, offRoadM: 0 };
            if (v.refuelLeftS > 0) now.pumpS++;
            now.waited ||= y.ahead > 0;
            now.offRoadM = Math.max(now.offRoadM, v.laneShiftM);
            visiting.set(v.id, now);
          } else if (visit) {
            visits.push(visit);
            visiting.delete(v.id);
          }
        }
      }
      // Two minutes or a little more at the pump, in the forecourt off the road.
      expect(visits.length).toBeGreaterThan(fleet.vehicles.length);
      for (const visit of visits) {
        expect(visit.pumpS).toBeGreaterThanOrEqual(119);
        expect(visit.pumpS).toBeLessThan(200);
        expect(visit.offRoadM).toBeGreaterThanOrEqual(4);
      }
      // Some wait their turn: a car at the pump, or a jeepney.
      expect(visits.filter((x) => x.waited).length / visits.length).toBeGreaterThan(0.2);
      // Never below a tenth of a tank on the road: always a station in reach.
      expect(lowest).toBeGreaterThan(0.1);
      // Some drivers fill up on the way home.
      expect(nightFills).toBeGreaterThan(0);

      expect(fleet.history.length).toBeGreaterThanOrEqual(2);
      fleet.history.forEach((h, k) =>
        h.totals.forEach((d, i) => {
          // In the tank at the start, less what was burnt, plus what was bought.
          expect(d.tankStartL - d.fuelUsedL + d.fuelBoughtL).toBeCloseTo(d.tankEndL!, 6);
          // The next day starts with what was left.
          const next = fleet.history[k + 1]?.totals[i];
          if (next) expect(next.tankStartL).toBeCloseTo(d.tankEndL!, 6);
          if (d.metres > 10_000) expect(d.fuelUsedL).toBeGreaterThan(0);
        }),
      );
      const refuels = fleet.history.reduce(
        (n, h) => n + h.totals.reduce((m, d) => m + d.refuels, 0),
        0,
      );
      expect(refuels).toBeGreaterThan(fleet.vehicles.length);
    },
  );
});
