import { describe, expect, it } from 'vitest';
import { defaultRoute } from '../geo/routes';
import {
  canPullIn,
  dieselPrice,
  DRIVER_MAP_RADIUS_M,
  DIESEL_COMMON_PHP_PER_L,
  fuelAdvice,
  fuelAhead,
  priceGroup,
  PULL_IN_M,
  stationsFor,
  stationsNear,
  TOP_UP_LITRES,
  type FuelStation,
} from './stations';

const route = defaultRoute();
const stations = stationsFor(route);

describe('gas stations along Tungko – SM City Fairview', () => {
  it('has every station within 4 km of the route, placed against it', () => {
    expect(stations.length).toBeGreaterThanOrEqual(150);
    expect(stations.filter((s) => s.outline).length).toBeGreaterThan(130);
    for (const s of stations) {
      expect(s.roadM).toBeLessThan(4100);
      expect(s.s).toBeGreaterThanOrEqual(0);
      expect(s.s).toBeLessThanOrEqual(route.polyline.length);
    }
    // Brands are normalised: no "petron" next to "Petron", no "SEAOIL".
    const brands = new Set(stations.map((s) => s.brand));
    expect(brands.has('Petron')).toBe(true);
    expect([...brands].some((b) => /^(petron|SEAOIL|Phoenix Petroleum)$/.test(b))).toBe(false);
  });

  it('leaves out closed and demolished stations, and counts each station once', () => {
    const ids = new Set(stations.map((s) => s.id));
    expect(ids.has('way/304231732')).toBe(false); // Caltex, disused:amenity=fuel
    expect(ids.has('way/816088680')).toBe(false); // Phoenix, razed:amenity=fuel
    // No two stations of one brand within 40 m (one mapped as a point and an area).
    for (const a of stations)
      for (const b of stations)
        if (a !== b && a.brand === b.brand)
          expect(Math.hypot(a.at.x - b.at.x, a.at.z - b.at.z)).toBeGreaterThanOrEqual(40);
  });

  it('offers drivers only stations they can pull straight into', () => {
    const usable = stations.filter((s) => canPullIn(s, 1));
    expect(usable.length).toBeGreaterThan(5);
    expect(usable.every((s) => s.roadM <= PULL_IN_M && s.side === 'right')).toBe(true);
  });
});

describe('diesel prices (DOE NCR, week of Oct 20–26 2026)', () => {
  it('gives a brand its range over Caloocan and Quezon City', () => {
    expect(dieselPrice('Petron')).toEqual({ min: 92.4, max: 96.5 });
    expect(dieselPrice('Seaoil')).toEqual({ min: 89.99, max: 92.7 });
    expect(dieselPrice('Shell', 'dieselPlus')).toEqual({ min: 97.7, max: 100.2 });
  });

  it('prices brands the DOE does not name as Independent', () => {
    expect(priceGroup('Cleanfuel')).toBe('Independent');
    expect(dieselPrice('Uno Fuel')).toEqual({ min: 88.0, max: 93.3 });
  });

  it('uses the week’s common price, not the old ₱58', () => {
    expect(DIESEL_COMMON_PHP_PER_L).toBeCloseTo((95.8 + 93.3) / 2, 2);
  });
});

describe('gas stations ahead of a jeepney', () => {
  // A straight road along x: along-route and straight-line distances agree.
  const at = (s: number, brand: string, side: 'left' | 'right', roadM = 20): FuelStation => ({
    id: `${brand}@${s}`,
    name: null,
    brand,
    at: { x: s, z: 0 },
    outline: null,
    fuels: [],
    hours: null,
    s,
    roadM,
    side,
  });
  const lineRoute = { ...route, loop: false };
  const list = [
    at(1200, 'Shell', 'right'),
    at(400, 'Petron', 'right'),
    at(800, 'Seaoil', 'right'),
    at(600, 'Caltex', 'left'), // across the road
    at(700, 'Phoenix', 'right', 300), // set back down a side street
    at(12000, 'Flying V', 'right'), // too far
    at(100, 'Unioil', 'right'), // behind
  ];

  const jeep = (s: number, direction: 1 | -1 = 1) => ({ s, direction, x: s, z: 0 });

  it('lists the ones on your side, nearest first, and marks the cheapest', () => {
    const ahead = fuelAhead(lineRoute, list, jeep(200));
    expect(ahead.map((f) => f.station.brand)).toEqual(['Petron', 'Seaoil', 'Shell']);
    expect(ahead.map((f) => f.distanceM)).toEqual([200, 600, 1000]);
    // Expected = middle of the brand's range: Seaoil (89.99 + 92.70) / 2.
    expect(ahead[1]!.expectedPhpPerL).toBeCloseTo(91.35, 2);
    expect(ahead.filter((f) => f.cheapest).map((f) => f.station.brand)).toEqual(['Seaoil']);
  });

  it('weighs filling up now against a cheaper station further on', () => {
    const advice = fuelAdvice(fuelAhead(lineRoute, list, jeep(200)));
    expect(advice.nearest?.station.brand).toBe('Petron');
    expect(advice.cheaper?.station.brand).toBe('Seaoil');
    // (Petron ~₱94.45 − Seaoil ~₱91.35, to the centavo) × a 30 L top-up.
    expect(advice.savingPhp).toBeCloseTo((94.45 - 91.35) * TOP_UP_LITRES, 2);
    // When the next station is already the cheapest, there is nothing to wait for.
    const next = fuelAdvice(fuelAhead(lineRoute, list, jeep(700)));
    expect(next.nearest?.station.brand).toBe('Seaoil');
    expect(next.cheaper).toBeNull();
  });

  it('turns the other way round for a jeepney going the other way', () => {
    const ahead = fuelAhead(lineRoute, list, jeep(1000, -1));
    expect(ahead.map((f) => f.station.brand)).toEqual(['Caltex']);
  });

  it('tells stations on the driver’s map from those further ahead', () => {
    const road = [at(1500, 'Petron', 'right'), at(6000, 'Seaoil', 'right')];
    const ahead = fuelAhead(lineRoute, road, jeep(0));
    expect(ahead.map((f) => [f.station.brand, f.onMap])).toEqual([
      ['Petron', true],
      ['Seaoil', false],
    ]);
    // The cheaper one is further on: worth knowing, though not drawn yet.
    const advice = fuelAdvice(ahead);
    expect(advice.cheaper?.station.brand).toBe('Seaoil');
    expect(advice.cheaper?.onMap).toBe(false);
  });

  it('draws only the stations within the driver’s map radius, in any direction', () => {
    const around = [
      at(-2000, 'Shell', 'left'),
      at(2400, 'Petron', 'right'),
      at(3000, 'Caltex', 'right'),
    ];
    expect(stationsNear(around, 0, 0, DRIVER_MAP_RADIUS_M).map((st) => st.brand)).toEqual([
      'Shell',
      'Petron',
    ]);
  });
});
