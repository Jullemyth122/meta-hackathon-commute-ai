import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { newRiderPose, RiderMotion } from '@/core/people/riderMotion';
import { CABIN, SEATS_AT } from '../jeepney/crew';
import { DRIVER_SEAT, REAR_X, rimPoint, SEATED_ROOT_Y } from '../jeepney/jeepneyGeometry';
import { HEAD_CENTRE_Y, RigWriter, rootFor, STANDING, type PersonPose } from './personRig';

const parts = () => ({
  torso: new Matrix4(),
  pelvis: new Matrix4(),
  head: new Matrix4(),
  hair: new Matrix4(),
  thigh: [new Matrix4(), new Matrix4()] as [Matrix4, Matrix4],
  shin: [new Matrix4(), new Matrix4()] as [Matrix4, Matrix4],
  foot: [new Matrix4(), new Matrix4()] as [Matrix4, Matrix4],
  sleeve: [new Matrix4(), new Matrix4()] as [Matrix4, Matrix4],
  forearm: [new Matrix4(), new Matrix4()] as [Matrix4, Matrix4],
});

/** Same placement as JeepneyInstances' driver. */
const DRIVER = {
  x: DRIVER_SEAT.x,
  y: SEATED_ROOT_Y - 0.06,
  z: DRIVER_SEAT.z,
  yaw: 0,
  sit: 1,
  walk: 0,
  phase: 0,
  stoop: 0.96,
};
const GRIP = (62 * Math.PI) / 180;
/** Centre of the hand in the forearm's frame (rig geometry). */
const HAND = new Vector3(0, -0.235, 0);

describe('driver', () => {
  it.each([0, 0.6, -0.9])('holds the wheel rim with both hands (wheel turned %f rad)', (turn) => {
    const grip: [Vector3, Vector3] = [
      rimPoint(GRIP, turn, new Vector3()),
      rimPoint(-GRIP, turn, new Vector3()),
    ];
    const pose: PersonPose = { ...STANDING, sit: 1, steer: turn, grip };
    const out = parts();
    new RigWriter().write(rootFor(DRIVER, 1, new Matrix4()), pose, out);
    for (const j of [0, 1] as const) {
      const hand = HAND.clone().applyMatrix4(out.forearm[j]);
      expect(hand.distanceTo(grip[j]), `hand ${j}`).toBeLessThan(0.002);
    }
  });

  it('turns the rim clockwise (top toward the driver’s right, +Z) when steering right', () => {
    const still = rimPoint(0, 0, new Vector3());
    const right = rimPoint(0, 0.5, new Vector3());
    expect(right.z).toBeGreaterThan(still.z);
  });

  it('sits with the back against the seat back, not through it', () => {
    // Torso: capsule radius 0.155 scaled 0.85 along X, centred on the hip line.
    const torsoBack = DRIVER.x - 0.155 * 0.85;
    expect(torsoBack).toBeGreaterThanOrEqual(0.86 - 0.005);
  });
});

describe('climbing in', () => {
  const motion = RiderMotion.boarding(CABIN, SEATS_AT[0]!, -6);
  const p = newRiderPose();

  it('stands on the step on the way up, lifting a knee', () => {
    let onStep = 0;
    let maxLift = 0;
    for (let t = 0; t < motion.duration; t += 1 / 60) {
      motion.poseAt(t, p);
      if (Math.abs(p.y - CABIN.step!.y) < 0.02) onStep++;
      maxLift = Math.max(maxLift, p.lift);
    }
    expect(onStep).toBeGreaterThan(3);
    expect(maxLift).toBeGreaterThan(0.9);
  });

  it('ducks under the door header (2.04 m) while passing it', () => {
    for (let t = 0; t < motion.duration; t += 1 / 120) {
      motion.poseAt(t, p);
      if (Math.abs(p.x - REAR_X) > 0.05) continue;
      // Top of the head: head centre plus the skull's half height (0.138).
      const headTop = p.y + (HEAD_CENTRE_Y + 0.138) * p.stoop;
      expect(headTop).toBeLessThan(2.06);
    }
  });

  it('never rises before the climbing foot is planted', () => {
    motion.poseAt(0, p);
    let prevY = p.y;
    for (let t = 0; t < motion.duration; t += 1 / 60) {
      motion.poseAt(t, p);
      expect(p.y).toBeGreaterThanOrEqual(prevY - 0.3); // only sitting down lowers the root
      prevY = p.y;
    }
  });
});
