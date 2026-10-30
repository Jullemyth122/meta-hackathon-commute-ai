import { Vector3 } from 'three';
import type { FleetKind } from '@/core/vehicles/specs';

/**
 * Inside view: a person standing in the aisle just behind the driver,
 * looking down the cabin to the rear door, in the jeepney's own frame
 * (facing +X). Not the ESP camera's mount: that sits beside the driver's
 * head, and at a wide screen's field of view the head and seat back would
 * fill half the picture. The camera's own view is the picture-in-picture.
 */
export const INSIDE_EYE = new Vector3(0.72, 1.88, 0.15);
export const INSIDE_LOOK = new Vector3(-3.2, 1.05, 0);
export const INSIDE_VFOV = 75;

/**
 * Where the ride-along cameras sit, per kind of vehicle, in its own frame
 * (facing +X): the chase camera behind and to the left (far enough back to
 * clear a 12 m bus), the front seat beside the driver (pov), and standing
 * behind the driver looking down the cabin (inside).
 */
export interface FollowViews {
  /** The orbit pivot: along the body, and its height. */
  centreX: number;
  targetY: number;
  chaseBack: number;
  chaseUp: number;
  chaseLeft: number;
  povEye: Vector3;
  povTarget: Vector3;
  insideEye: Vector3;
  insideLook: Vector3;
}

export const FOLLOW_VIEWS: Record<FleetKind, FollowViews> = {
  jeepney: {
    centreX: -0.5,
    targetY: 1.2,
    chaseBack: 7.2,
    chaseUp: 3.2,
    chaseLeft: 2.6,
    povEye: new Vector3(0.94, 1.5, 0.24),
    povTarget: new Vector3(1.16, 1.46, 0.08),
    insideEye: INSIDE_EYE,
    insideLook: INSIDE_LOOK,
  },
  // Cab over the front axle, seat cushion 1.42 m up: the front seat is the step beside the driver.
  modern: {
    centreX: 0,
    targetY: 1.4,
    chaseBack: 7.8,
    chaseUp: 3.7,
    chaseLeft: 2.8,
    povEye: new Vector3(2.85, 2.17, 0.2),
    povTarget: new Vector3(3.2, 2.1, 0.08),
    insideEye: new Vector3(2.3, 2.4, 0),
    insideLook: new Vector3(-3.3, 1.2, 0),
  },
  // The front passenger seat of the van, under its 2.15 m ceiling.
  uv: {
    centreX: 0,
    targetY: 1.2,
    chaseBack: 6.8,
    chaseUp: 3.2,
    chaseLeft: 2.6,
    povEye: new Vector3(1.12, 1.77, 0.34),
    povTarget: new Vector3(1.4, 1.72, 0.25),
    insideEye: new Vector3(1.1, 1.95, 0.45),
    insideLook: new Vector3(-2.5, 0.9, 0.1),
  },
  // Standing at the top of the front steps beside the driver; the chase camera well back.
  bus: {
    centreX: 0,
    targetY: 1.7,
    chaseBack: 10.8,
    chaseUp: 4.8,
    chaseLeft: 3.6,
    povEye: new Vector3(5.0, 2.5, 0.25),
    povTarget: new Vector3(5.4, 2.4, 0.1),
    insideEye: new Vector3(4.0, 2.55, 0),
    insideLook: new Vector3(-5.8, 1.3, 0),
  },
};
