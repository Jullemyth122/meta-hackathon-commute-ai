import { describe, expect, it } from 'vitest';
import { CentroidTracker } from './doorway/centroidTracker';
import { fareFor } from './fare';
import { Polyline } from './geo/polyline';
import { createProjection, haversineM } from './geo/projection';
import { simplify } from './geo/simplify';
import { GpsFilter } from './tracking/gpsFilter';
import { initialTripState, stepTrip } from './tracking/tripState';
import type { GpsFix } from './tracking/types';

const fix = (
  lat: number,
  lng: number,
  t: number,
  accuracyM = 5,
  speedMps: number | null = null,
): GpsFix => ({
  lat,
  lng,
  accuracyM,
  speedMps,
  headingDeg: null,
  timestamp: t,
});

describe('projection', () => {
  const origin = { lat: 14.7, lng: 121.05 };
  const proj = createProjection(origin);

  it('round-trips lat/lng through local metres', () => {
    const p = { lat: 14.7123, lng: 121.0412 };
    const back = proj.toGeo(proj.toLocal(p));
    expect(back.lat).toBeCloseTo(p.lat, 9);
    expect(back.lng).toBeCloseTo(p.lng, 9);
  });

  it('agrees with haversine to within 0.1% over a few km', () => {
    const p = { lat: 14.73, lng: 121.08 };
    const local = proj.toLocal(p);
    const planar = Math.hypot(local.x, local.z);
    expect(Math.abs(planar - haversineM(origin, p)) / planar).toBeLessThan(0.001);
  });

  it('puts north at -Z and east at +X', () => {
    expect(proj.toLocal({ lat: 14.71, lng: 121.05 }).z).toBeLessThan(0);
    expect(proj.toLocal({ lat: 14.7, lng: 121.06 }).x).toBeGreaterThan(0);
  });
});

describe('polyline', () => {
  const line = new Polyline([
    { x: 0, z: 0 },
    { x: 100, z: 0 },
    { x: 100, z: -100 },
  ]);

  it('measures length and interpolates', () => {
    expect(line.length).toBe(200);
    expect(line.pointAt(150)).toMatchObject({ x: 100, z: -50 });
  });

  it('projects onto the nearest segment', () => {
    const hit = line.project({ x: 40, z: 7 });
    expect(hit.s).toBeCloseTo(40);
    expect(hit.offset).toBeCloseTo(7);
  });

  it('respects the search window', () => {
    // (95, -40) is closest to the second leg; a window on the first leg must stay there.
    const hit = line.project({ x: 95, z: -40 }, [0, 90]);
    expect(hit.s).toBeLessThanOrEqual(90);
  });
});

describe('simplify', () => {
  it('drops collinear points but keeps corners', () => {
    const pts = [0, 1, 2, 3, 4].map((x) => ({ x: x * 10, z: 0 })).concat([{ x: 40, z: 30 }]);
    expect(simplify(pts, 1)).toEqual([pts[0], pts[4], pts[5]]);
  });
});

describe('GPS filter', () => {
  it('reports zero speed for a stationary phone with noisy fixes', () => {
    const f = new GpsFilter();
    // ±10 m wobble around one spot, 3 s apart: naive differencing says ~12 km/h.
    f.push(fix(14.7, 121.05, 0, 10));
    f.push(fix(14.70009, 121.05, 3000, 10));
    expect(f.estimate().speedMps).toBe(0);
  });

  it('rejects inaccurate fixes', () => {
    expect(new GpsFilter().push(fix(14.7, 121.05, 0, 120))).toBe(false);
  });
});

describe('trip state machine', () => {
  const vehicleLike = { speedMps: 6, goodFixes: 8, spanMs: 15000, significant: true };

  it('needs sustained motion before suggesting a trip', () => {
    let s = stepTrip(initialTripState, {
      kind: 'motion',
      now: 0,
      motion: vehicleLike,
      onRoute: true,
    });
    expect(s.phase).toBe('WAITING');
    s = stepTrip(s, { kind: 'motion', now: 13_000, motion: vehicleLike, onRoute: true });
    expect(s.phase).toBe('POSSIBLE_VEHICLE');
  });

  it('never confirms from speed alone', () => {
    let s = initialTripState;
    for (let t = 0; t < 120_000; t += 1000) {
      s = stepTrip(s, { kind: 'motion', now: t, motion: vehicleLike, onRoute: true });
    }
    expect(s.phase).toBe('POSSIBLE_VEHICLE');
    expect(stepTrip(s, { kind: 'confirm' }).phase).toBe('CONFIRMED');
  });

  it('ignores vehicle-like motion off a known route', () => {
    const s = stepTrip(initialTripState, {
      kind: 'motion',
      now: 60_000,
      motion: vehicleLike,
      onRoute: false,
    });
    expect(s.phase).toBe('WAITING');
  });
});

describe('centroid tracker', () => {
  it('keeps the same id for a moving person', () => {
    const t = new CentroidTracker();
    t.update([{ cx: 100, cy: 200, w: 30, h: 30, score: 0.9 }]);
    const id = t.visible()[0]!.id;
    t.update([{ cx: 104, cy: 190, w: 30, h: 30, score: 0.9 }]);
    expect(t.visible()[0]!.id).toBe(id);
  });

  it('drops a track after enough missed frames', () => {
    const t = new CentroidTracker({ maxJumpPx: 40, maxMissedFrames: 2, maxSizeRatio: Infinity });
    t.update([{ cx: 100, cy: 100, w: 30, h: 30, score: 0.9 }]);
    t.update([]);
    t.update([]);
    expect(t.update([])).toHaveLength(1);
  });
});

describe('fare', () => {
  it('follows the ₱14 + ₱2/km rule', () => {
    expect(fareFor(3.2)).toBe(14);
    expect(fareFor(4)).toBe(14);
    expect(fareFor(4.1)).toBe(16);
    expect(fareFor(7.5)).toBe(22);
  });

  it('applies the 20% discount rounded to 25 centavos', () => {
    expect(fareFor(4, true)).toBe(11.25);
  });
});
