/**
 * The people side of the jeepney: where its seats are, the order riders take
 * them, and the cabin layout the rider motions use. Shared by the live twin
 * and the sensor lab, so a jeepney seats people the same way in both.
 */

import type { CabinLayout, Seat } from '@/core/people/riderMotion';
import { benchSeat, BODY_LIFT, REAR_X, SEATED_ROOT_Y } from './jeepneyGeometry';

/** Seats per jeepney (two facing benches of 11). */
export const SEATS = 22;

export const CABIN: CabinLayout = {
  doorX: REAR_X,
  stepOutsideX: REAR_X - 0.5,
  insideX: REAR_X + 0.2,
  floorY: BODY_LIFT + 0.06, // top of the cabin floor
  seatedRootY: SEATED_ROOT_Y,
  // The rear boarding step (jeepneyGeometry: x -3.52…-3.1, top 0.46 m).
  step: { x: REAR_X - 0.21, y: BODY_LIFT - 0.16 },
};

/** Seat k, facing across the aisle (ground frame of the jeepney). */
export const SEATS_AT: readonly Seat[] = Array.from({ length: SEATS }, (_, k) => {
  const seat = benchSeat(k, SEATS);
  return { x: seat.x, z: seat.z, yaw: seat.side > 0 ? Math.PI / 2 : -Math.PI / 2 };
});

/**
 * The order riders take seats: spread along both benches, the way people
 * leave a gap to the next stranger, instead of filling strictly from the back.
 */
export const SEAT_ORDER: readonly number[] = (() => {
  const perSide = SEATS / 2;
  const rows = Array.from({ length: perSide }, (_, j) => j).sort(
    (a, b) => ((a * 7) % perSide) - ((b * 7) % perSide) || a - b,
  );
  return rows.flatMap((j) => [j * 2, j * 2 + 1]);
})();

/** Stable identity for the person in vehicle i, seat k (k = SEATS: the driver). */
export const crewSeed = (i: number, k: number) => i * 64 + k;

/** Look seed for twin rider `riderId` (CrewState), clear of crewSeed and the lab's. */
export const riderSeed = (riderId: number) => 1_000_000 + riderId;
