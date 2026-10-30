/** Vehicle geometry adapters for the shared passenger journey system. */
import type { FleetSim } from '@/core/fleet/fleetSim';
import { PassengerSystem, type PassengerLayout } from '@/core/people/passengerSystem';
import { RiderMotion, seatedAt } from '@/core/people/riderMotion';
import { puvLayout } from '../vehicles/puvCrew';
import { fleetPose } from '../world/lanes';
import { CABIN, SEAT_ORDER, SEATS_AT } from './crew';
import { HALF_WIDTH } from './jeepneyGeometry';

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
  // In the cabin: past the rear opening AND between the side walls. Someone
  // walking along the outside towards the back step is level with the cabin
  // but not in it, and the jeepney must not pull away with them.
  isInside: (pose) => pose.x > CABIN.doorX && Math.abs(pose.z) < HALF_WIDTH,
};

export class CrewState extends PassengerSystem {
  constructor(fleet: FleetSim) {
    super(
      fleet,
      // Each vehicle as it is built: a jeepney, or a modern jeepney, UV Express or bus.
      fleet.vehicles.map((v) =>
        v.kind === 'jeepney' ? JEEPNEY_PASSENGER_LAYOUT : puvLayout(v.kind),
      ),
      (i, out) => fleetPose(fleet, i, out),
    );
  }
}
