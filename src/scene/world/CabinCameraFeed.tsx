/**
 * The cabin camera of the jeepney you are riding along with in the live
 * twin: the same ESP32-S3-CAM mount and counting pipeline as the sensor lab,
 * riding on a moving jeepney and watching its real (simulated) riders board,
 * sit and leave. Renders the picture-in-picture; ui/PipOverlay draws the
 * detections from twin.cabinFeed.
 */

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { type Group, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { useRuntimes } from '@/app/runtimeContext';
import { useApp } from '@/app/store';
import { CabinPipeline, type VisiblePerson } from '@/core/doorway/pipeline';
import { createRng } from '@/core/math/random';
import { CabinCameraModel } from '../DoorwayScene';
import {
  cabinViewFor,
  createCabinCamera,
  placeOnVehicle,
  projectPerson,
} from '../doorway/cabinCamera';
import { MIRROR_LAYOUT, PipRenderer } from '../doorway/PipRenderer';
import { createDoorCamera, doorCameras } from '../vehicles/doorCamera';
import type { VehicleKind } from '@/core/vehicles/specs';
import { REAR_X } from '../jeepney/jeepneyGeometry';
import { riderSeed } from '../jeepney/crew';
import { appearance, HEAD_CENTRE_Y } from '../people/personRig';
import { fleetPose } from './lanes';
import { useScaledPose } from './viewScale';

/**
 * The rear-view mirror while riding in the front seat: what is behind the
 * jeepney (someone running for it, the jeepney behind), seen from the back of
 * the roof, since a cab mirror would only show the cabin full of riders.
 */
const MIRROR_EYE = new Vector3(REAR_X - 0.2, 2.6, 0);
const MIRROR_LOOK = new Vector3(REAR_X - 30, 0.6, 0);
/** Narrow vertically: the strip is about 3.4 times wider than tall (≈80° across). */
const MIRROR_VFOV = 28;

export function CabinCameraFeed({ index }: { index: number }) {
  const { twin } = useRuntimes();
  const kind = twin.fleet.vehicles[index]?.kind ?? 'jeepney';
  return kind === 'jeepney' ? (
    <JeepneyCabinFeed index={index} />
  ) : (
    <DoorCameraFeed index={index} kind={kind} />
  );
}

/**
 * A modern jeepney's, UV Express's or bus's door camera (vehicles/doorCamera)
 * as the picture-in-picture while riding along: the first door's, riding on
 * the moving vehicle. Its counting is not wired up yet, so no overlay.
 */
function DoorCameraFeed({ index, kind }: { index: number; kind: VehicleKind }) {
  const { twin } = useRuntimes();
  const camera = useMemo(() => createDoorCamera(doorCameras(kind)[0]!), [kind]);
  const mount = useMemo(() => camera.matrix.clone(), [camera]);
  const s = useMemo(
    () => ({
      pose: { x: 0, z: 0, heading: 0 },
      vehicle: new Matrix4(),
      placed: new Matrix4(),
      q: new Quaternion(),
      up: new Vector3(0, 1, 0),
      p: new Vector3(),
      k: new Vector3(1, 1, 1),
    }),
    [],
  );
  useEffect(() => {
    twin.cabinFeed.pipeline = null;
  }, [twin, index]);
  useFrame(() => {
    if (!twin.fleet.vehicles[index]) return;
    fleetPose(twin.fleet, index, s.pose);
    s.vehicle.compose(
      s.p.set(s.pose.x, 0, s.pose.z),
      s.q.setFromAxisAngle(s.up, s.pose.heading),
      s.k,
    );
    s.placed.multiplyMatrices(s.vehicle, mount);
    s.placed.decompose(camera.position, camera.quaternion, camera.scale);
    camera.scale.set(1, 1, 1);
    camera.updateMatrixWorld();
  });
  return <PipRenderer espCamera={camera} />;
}

/** The jeepney's cabin camera, with its counting pipeline. */
function JeepneyCabinFeed({ index }: { index: number }) {
  const { twin } = useRuntimes();
  const hideFrustum = useApp((s) => s.follow?.view === 'inside' || s.follow?.view === 'pov');
  const frontSeat = useApp((s) => s.follow?.view === 'pov');
  const camera = useMemo(createCabinCamera, []);
  const mirror = useMemo(
    () => new PerspectiveCamera(MIRROR_VFOV, MIRROR_LAYOUT.width / MIRROR_LAYOUT.height, 0.3, 800),
    [],
  );
  const mountRef = useRef<Group>(null);
  const s = useMemo(
    () => ({
      pose: { x: 0, z: 0, heading: 0 },
      vehicle: new Matrix4(),
      q: new Quaternion(),
      up: new Vector3(0, 1, 0),
      p: new Vector3(),
      k: new Vector3(),
      head: new Vector3(),
    }),
    [],
  );

  // A fresh counter per jeepney ridden, starting from what is on board.
  useEffect(() => {
    const feed = twin.cabinFeed;
    feed.pipeline = new CabinPipeline(
      createRng(1000 + index),
      twin.fleet.vehicles[index]?.occupancy ?? 0,
      cabinViewFor(createCabinCamera()),
    );
    feed.clockMs = 0;
    return () => {
      feed.pipeline = null;
    };
  }, [twin, index]);

  useFrame((_, dt) => {
    const feed = twin.cabinFeed;
    if (!feed.pipeline || !twin.fleet.vehicles[index]) return;
    // The real camera rides a real-size jeepney: true scale, whatever the
    // main view's zoom (the cabin pass re-poses the scene at scale 1 too).
    fleetPose(twin.fleet, index, s.pose);
    s.vehicle.compose(
      s.p.set(s.pose.x, 0, s.pose.z),
      s.q.setFromAxisAngle(s.up, s.pose.heading),
      s.k.setScalar(1),
    );
    placeOnVehicle(camera, s.vehicle);
    if (frontSeat) {
      mirror.position.copy(MIRROR_EYE).applyMatrix4(s.vehicle);
      mirror.lookAt(s.head.copy(MIRROR_LOOK).applyMatrix4(s.vehicle));
      mirror.updateMatrixWorld();
    }

    feed.clockMs += Math.min(dt, 0.1) * 1000;
    feed.pipeline.tick(feed.clockMs, () => {
      const seen: VisiblePerson[] = [];
      twin.crew.forEachRider(index, (riderId, m) => {
        const size = appearance(riderSeed(riderId)).size;
        s.head.set(m.x, m.y + HEAD_CENTRE_Y * size * m.stoop, m.z).applyMatrix4(s.vehicle);
        const p = projectPerson(camera, riderId, s.head.x, s.head.y, s.head.z);
        if (p) seen.push(p);
      });
      return seen;
    });
  });

  // The camera model and its FOV cone are a symbol on the jeepney: they grow
  // with it in the zoomed-out main view and are true size for the cabin pass.
  useScaledPose((k) => {
    const mount = mountRef.current;
    if (!mount) return;
    mount.matrix.compose(
      s.p.set(s.pose.x, 0, s.pose.z),
      s.q.setFromAxisAngle(s.up, s.pose.heading),
      s.k.setScalar(k),
    );
    mount.matrixWorldNeedsUpdate = true;
  });

  return (
    <>
      <group ref={mountRef} matrixAutoUpdate={false}>
        <CabinCameraModel showFrustum={!hideFrustum} />
      </group>
      <PipRenderer espCamera={camera} mirrorCamera={frontSeat ? mirror : null} />
    </>
  );
}
