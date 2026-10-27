/** Jeepney geometry adapter for the shared passenger journey system. */
import type { FleetSim } from '@/core/fleet/fleetSim';
import { PassengerSystem, type PassengerLayout } from '@/core/people/passengerSystem';
import { RiderMotion, seatedAt } from '@/core/people/riderMotion';
import { fleetPose } from '../world/lanes';
import { CABIN, SEAT_ORDER, SEATS_AT } from './crew';

export const JEEPNEY_PASSENGER_LAYOUT: PassengerLayout = {
  seats: SEATS_AT,
  seatOrder: SEAT_ORDER,
  seated: (seat, out) => seatedAt(CABIN, SEATS_AT[seat]!, out),
  board: (seat, start) =>
    RiderMotion.boardingVia(CABIN, SEATS_AT[seat]!, [
      start,
      [CABIN.stepOutsideX - 1, 0, start[2]],
      [CABIN.stepOutsideX - 1, 0, 0],
      [CABIN.stepOutsideX, 0, 0],
    ]),
  alight: (seat) => RiderMotion.alighting(CABIN, SEATS_AT[seat]!, CABIN.stepOutsideX),
  isInside: (pose) => pose.x > CABIN.doorX,
};

export class CrewState extends PassengerSystem {
  constructor(fleet: FleetSim) {
    super(
      fleet,
      fleet.vehicles.map(() => JEEPNEY_PASSENGER_LAYOUT),
      (i, out) => fleetPose(fleet, i, out),
    );
  }
}
