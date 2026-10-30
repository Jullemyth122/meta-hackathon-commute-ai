import { describe, expect, it } from 'vitest';
import { COMMUTE_BY_HOUR } from '../fleet/scenario';
import { RIDER_KINDS } from '../fare';
import { BASE_MIX, calibrate, drawKind, mixAt, schoolStop, weekend } from './riderMix';

/** A route of ten stops, one a school's, over a weekday's commute. */
const schools = [false, false, false, true, false, false, false, false, false, false];
const cells = COMMUTE_BY_HOUR.flatMap((weight, hour) =>
  schools.map((school) => ({ weight: weight / schools.length, hour, school })),
);
const cal = calibrate(BASE_MIX, cells);

describe('who rides, by hour, day and stop', () => {
  it('averages to the base mix over a weekday, however the hours and stops move it', () => {
    const total = cells.reduce((a, c) => a + c.weight, 0);
    for (const k of RIDER_KINDS) {
      let share = 0;
      for (const c of cells)
        share += (c.weight * mixAt(BASE_MIX, { ...c, day: 0 }, cal, null)[k]) / total;
      expect(share).toBeCloseTo(BASE_MIX[k], 3);
    }
  });

  it('has students out in the rush, a school stop full of them when classes let out, few at night', () => {
    const at = (hour: number, school: boolean) =>
      mixAt(BASE_MIX, { hour, day: 0, school }, cal, null).student;
    expect(at(6.5, false)).toBeGreaterThan(1.3 * BASE_MIX.student);
    expect(at(16, true)).toBeGreaterThan(0.5);
    expect(at(16, true)).toBeGreaterThan(1.8 * at(16, false));
    expect(at(22, false)).toBeLessThan(BASE_MIX.student / 4);
  });

  it('brings seniors out mid-morning, not in the rush', () => {
    const senior = (hour: number) =>
      mixAt(BASE_MIX, { hour, day: 0, school: false }, cal, null).senior;
    expect(senior(10)).toBeGreaterThan(2 * senior(7));
  });

  it('has few students at the weekend (day 1 is a Monday)', () => {
    expect([0, 4, 5, 6, 7].map(weekend)).toEqual([false, false, true, true, false]);
    const student = (day: number) =>
      mixAt(BASE_MIX, { hour: 7, day, school: false }, cal, null).student;
    expect(student(5)).toBeLessThan(student(4) / 3);
  });

  it('makes no two days alike, but each day the same every time', () => {
    const students = Array.from(
      { length: 28 },
      (_, day) =>
        mixAt(BASE_MIX, { hour: 7, day: day - (day % 7) + (day % 5), school: false }, cal).student,
    );
    expect(new Set(students.map((s) => s.toFixed(4))).size).toBeGreaterThan(10);
    expect(Math.max(...students) / Math.min(...students)).toBeGreaterThan(1.15);
    expect(mixAt(BASE_MIX, { hour: 7, day: 3, school: false }, cal)).toEqual(
      mixAt(BASE_MIX, { hour: 7, day: 3, school: false }, cal),
    );
  });

  it('draws each kind as often as its share, and knows a school by its name', () => {
    const counts = Object.fromEntries(RIDER_KINDS.map((k) => [k, 0]));
    for (let i = 0; i < 10_000; i++) counts[drawKind(BASE_MIX, (i + 0.5) / 10_000)]!++;
    for (const k of RIDER_KINDS) expect(counts[k]! / 10_000).toBeCloseTo(BASE_MIX[k], 2);
    expect(schoolStop('Mater Carmeli School')).toBe(true);
    expect(schoolStop('SM City Fairview Jeepney Terminal')).toBe(false);
  });
});

describe('the twin’s riders', () => {
  it(
    'are drawn by the hour (students in the rush, seniors mid-morning) and mostly go to the big stops',
    { timeout: 300_000 },
    async () => {
      const { TwinRuntime } = await import('@/app/twinRuntime');
      const { defaultRoute } = await import('../geo/routes');
      const { FIELD_SCENARIO } = await import('../fleet/scenario');
      const route = defaultRoute();
      const twin = new TwinRuntime(route, undefined, {
        ...FIELD_SCENARIO,
        vehicles: 10,
        dailyTrips: 6000,
        startHour: 6,
      });
      const seen = new Set<number>();
      const rush = { student: 0, senior: 0, all: 0 };
      const midday = { student: 0, senior: 0, all: 0 };
      const off = new Map<number, number>();
      while (twin.fleet.timeOfDay < 14 * 3600) {
        twin.step(5, 0);
        const hour = twin.fleet.timeOfDay / 3600;
        for (const r of twin.crew.passengers.values()) {
          if (seen.has(r.id)) continue;
          seen.add(r.id);
          const bucket = hour < 8 ? rush : hour >= 9.5 && hour < 13 ? midday : null;
          if (bucket) {
            bucket.all++;
            if (r.kind === 'student') bucket.student++;
            if (r.kind === 'senior') bucket.senior++;
          }
          off.set(r.destinationStop, (off.get(r.destinationStop) ?? 0) + 1);
        }
      }
      expect(rush.all).toBeGreaterThan(300);
      expect(midday.all).toBeGreaterThan(300);
      expect(rush.student / rush.all).toBeGreaterThan(1.5 * (midday.student / midday.all));
      expect(midday.senior / midday.all).toBeGreaterThan(1.5 * (rush.senior / rush.all));
      // The SM Fairview terminal takes far more than an even share of the riders.
      const terminal = route.stops.findIndex((s) => /SM City Fairview.*Terminal/i.test(s.name));
      const total = [...off.values()].reduce((a, b) => a + b, 0);
      expect(off.get(terminal)! / total).toBeGreaterThan(2 / route.stops.length);
    },
  );
});
