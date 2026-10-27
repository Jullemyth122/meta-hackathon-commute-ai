import { describe, expect, it } from 'vitest';
import { DoorwaySim } from '@/core/doorway/doorwaySim';
import { CabinPipeline, type VisiblePerson } from '@/core/doorway/pipeline';
import { createRng } from '@/core/math/random';
import { newRiderPose } from '@/core/people/riderMotion';
import { HEAD_CENTRE_Y } from '../people/personRig';
import { CABIN, SEATS_AT } from '../jeepney/crew';
import { cabinViewFor, createCabinCamera, projectPerson } from './cabinCamera';

/**
 * End to end with the real camera geometry: riders walk up, board, sit, stand
 * and leave; the camera projects them; the pipeline counts. No GPU needed.
 */
function run(minutes: number, seed: number) {
  const cam = createCabinCamera();
  const sim = new DoorwaySim(createRng(seed), CABIN, SEATS_AT);
  const pipeline = new CabinPipeline(createRng(seed + 1), sim.truth.inside, cabinViewFor(cam));
  const pose = newRiderPose();
  let errSum = 0;
  let samples = 0;
  let maxInside = 0;

  const dt = 1 / 60;
  let clock = 0;
  for (let t = 0; t < minutes * 60; t += dt) {
    sim.step(dt);
    clock += dt * 1000;
    pipeline.tick(clock, () => {
      const seen: VisiblePerson[] = [];
      for (const r of sim.riders) {
        sim.pose(r, pose);
        const headY = pose.y + HEAD_CENTRE_Y * r.heightScale * pose.stoop;
        const p = projectPerson(cam, r.id, pose.x, headY, pose.z);
        if (p) seen.push(p);
      }
      return seen;
    });
    if (Math.round(t * 60) % 30 === 0) {
      errSum += Math.abs(pipeline.telemetry(clock).counts.current - sim.truth.inside);
      samples++;
      maxInside = Math.max(maxInside, sim.truth.inside);
    }
  }
  return {
    truth: sim.truth,
    counts: pipeline.telemetry(clock).counts,
    meanAbsError: errSum / samples,
    maxInside,
  };
}

describe('cabin camera counter (integration)', () => {
  it('sees every seat and the rear entrance', () => {
    const cam = createCabinCamera();
    for (const [k, seat] of SEATS_AT.entries()) {
      const p = projectPerson(cam, k, seat.x, CABIN.seatedRootY + HEAD_CENTRE_Y, seat.z);
      expect(p, `seat ${k}`).not.toBeNull();
    }
    const view = cabinViewFor(cam);
    expect(view.door.x1 - view.door.x0).toBeGreaterThan(10);
  });

  // Measured 2026-10-27 over seeds 3 / 5 / 9 / 11 / 21: mean error 0.2–0.8
  // riders, final count exact, alightings exact, boardings 1–5 short (the
  // head count corrects the running total for those), including a full
  // jeepney (22). These bounds guard against regressions with some margin;
  // they are not a claim about real-world accuracy.
  it.each([3, 5, 9])('tracks the true passenger count over ten minutes (seed %i)', (seed) => {
    const { truth, counts, meanAbsError, maxInside } = run(10, seed);
    expect(truth.boarded).toBeGreaterThan(20);
    expect(maxInside).toBeGreaterThan(12);
    expect(meanAbsError).toBeLessThan(1);
    expect(Math.abs(counts.current - truth.inside)).toBeLessThanOrEqual(1);
    expect(Math.abs(counts.alighted - truth.alighted)).toBeLessThanOrEqual(2);
  });
});
