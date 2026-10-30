/**
 * The door cameras of the modern jeepney, UV Express and bus: an ESP32-S3-CAM
 * (the same 4:3 QVGA module as the jeepney's, see doorway/cabinCamera.ts) in
 * the header over each door, just inside it, looking down at the steps and a
 * little into the vehicle, as overhead people counters are mounted. Looking
 * down, heads do not hide one another, and everyone boarding or getting off
 * passes under it while still on the steps (so their head is well below it,
 * even in a van): across the frame from the door edge (outside) to the top
 * of the steps (inside).
 *
 * Same frame as core/vehicles/specs.ts (ground at y = 0, +x front, +z kerb).
 */

import { PerspectiveCamera, Plane, Ray, Vector3 } from 'three';
import { FRAME_H, FRAME_W } from '@/core/doorway/pipeline';
import { VEHICLES, type DoorSpec, type VehicleKind } from '@/core/vehicles/specs';

export interface DoorCam {
  door: DoorSpec;
  position: Vector3;
  lookAt: Vector3;
  /** Vertical field of view, degrees (a wide-angle module lens, as on the jeepney). */
  vfov: number;
}

/** Above the top of the opening, in the header; never closer to the ceiling than this; in from the wall (metres). */
const ABOVE_OPENING_M = 0.1;
const BELOW_CEILING_M = 0.04;
const IN_FROM_WALL_M = 0.15;

export function doorCameras(kind: VehicleKind): DoorCam[] {
  const S = VEHICLES[kind];
  const ceiling = S.floorM + S.headroomM;
  const halfW = S.widthM / 2;
  return S.doors.map((door) => {
    // A van's cab door: at its back edge, under the roof just behind the
    // raked windscreen (over its middle would be outside the glass), looking
    // down and forward at the sill and the seat.
    if (door.opens === 'hinged')
      return {
        door,
        position: new Vector3(door.x0, door.y1 + 0.05, halfW - IN_FROM_WALL_M),
        lookAt: new Vector3(door.x0 + 0.35, door.y0, halfW - IN_FROM_WALL_M - 0.45),
        vfov: 140,
      };
    const x = (door.x0 + door.x1) / 2;
    return {
      door,
      position: new Vector3(
        x,
        Math.min(door.y1 + ABOVE_OPENING_M, ceiling - BELOW_CEILING_M),
        halfW - IN_FROM_WALL_M,
      ),
      // Down at the bottom step, tilted a little towards the inside.
      lookAt: new Vector3(x, door.y0, halfW - IN_FROM_WALL_M - 0.45),
      // The van's camera clears a ducking rider's head by only ~20 cm, and
      // its door is 1.1 m wide: it needs the wide-angle (160°) module lens.
      vfov: kind === 'uv' ? 140 : 100,
    };
  });
}

export function createDoorCamera(cam: DoorCam): PerspectiveCamera {
  const c = new PerspectiveCamera(cam.vfov, FRAME_W / FRAME_H, 0.05, 30);
  c.position.copy(cam.position);
  // Image "up" towards the front of the vehicle, so boarding runs across the frame.
  c.up.set(1, 0, 0);
  c.lookAt(cam.lookAt);
  c.updateMatrixWorld();
  c.updateProjectionMatrix();
  return c;
}

const ndc = new Vector3();
const ray = new Ray();
const plane = new Plane(new Vector3(0, 1, 0), 0);

/** Where the frame's four corners land on the floor at height `y` (for drawing what it sees). */
export function footprint(camera: PerspectiveCamera, y: number): Vector3[] {
  plane.constant = -y;
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([u, v]) => {
    ndc.set(u!, v!, 0.5).unproject(camera);
    ray.origin.copy(camera.position);
    ray.direction.copy(ndc).sub(camera.position).normalize();
    return ray.intersectPlane(plane, new Vector3()) ?? camera.position.clone();
  });
}
