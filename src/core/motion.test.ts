import { describe, expect, it } from 'vitest';
import { FleetSim } from './fleet/fleetSim';
import { syntheticDemoRoute } from './geo/routes';
import { newRiderPose, RiderMotion, type CabinLayout } from './people/riderMotion';

const CABIN: CabinLayout = {
  doorX: -3.1,
  stepOutsideX: -3.6,
  insideX: -2.9,
  floorY: 0.68,
  seatedRootY: 0.35,
};
const SEAT = { x: -1, z: 0.75, yaw: Math.PI / 2 };

describe('rider motion', () => {
  it('boards: from the road, through the door, ends seated in the seat', () => {
    const m = RiderMotion.boarding(CABIN, SEAT, -6);
    const p = newRiderPose();
    m.poseAt(0, p);
    expect(p).toMatchObject({ x: -6, y: 0, sit: 0 });
    m.poseAt(m.duration, p);
    expect(p.x).toBeCloseTo(SEAT.x);
    expect(p.z).toBeCloseTo(SEAT.z);
    expect(p.y).toBeCloseTo(CABIN.seatedRootY);
    expect(p.sit).toBeCloseTo(1);
    expect(p.yaw).toBeCloseTo(SEAT.yaw);
  });

  it('sits down gradually, not in one frame', () => {
    const m = RiderMotion.boarding(CABIN, SEAT, -6);
    const p = newRiderPose();
    let prev = 0;
    for (let t = 0; t <= m.duration; t += 1 / 60) {
      m.poseAt(t, p);
      expect(p.sit - prev).toBeLessThan(0.05);
      prev = p.sit;
    }
  });

  it('alights: stands up, walks out facing the door, ends outside', () => {
    const m = RiderMotion.alighting(CABIN, SEAT, -6);
    const p = newRiderPose();
    m.poseAt(0, p);
    expect(p.sit).toBeCloseTo(1);
    m.poseAt(m.duration, p);
    expect(p).toMatchObject({ x: -6, y: 0, sit: 0 });
    expect(Math.abs(p.yaw)).toBeCloseTo(Math.PI);
  });
});

describe('fleet driving', () => {
  it('changes speed smoothly and never overlaps the jeepney ahead', () => {
    const fleet = new FleetSim(syntheticDemoRoute());
    const dt = 1 / 60;
    let prev = fleet.vehicles.map((v) => v.speedMps);
    let harshAccel = 0;
    let overlaps = 0;
    // Plain counters, one assertion at the end: millions of expect() calls are slow.
    for (let step = 0; step < 60 * 300; step++) {
      fleet.step(dt);
      fleet.vehicles.forEach((v, i) => {
        // Acceleration is capped; braking follows a smooth curve, except the
        // final creep into a stop and the dwell, which may drop to zero.
        if (v.speedMps > 0.81 && (v.speedMps - prev[i]!) / dt > 1.25) harshAccel++;
      });
      prev = fleet.vehicles.map((v) => v.speedMps);
      for (const a of fleet.vehicles)
        for (const b of fleet.vehicles)
          if (a !== b && a.direction === b.direction && a.dwellS <= 0 && b.dwellS <= 0)
            if (Math.abs(a.s - b.s) <= 5) overlaps++;
    }
    expect({ harshAccel, overlaps }).toEqual({ harshAccel: 0, overlaps: 0 });
  });
});
