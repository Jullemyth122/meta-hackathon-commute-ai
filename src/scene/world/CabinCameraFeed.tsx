/**
 * The cabin camera of the jeepney you are riding along with in the live
 * twin: the same ESP32-S3-CAM mount and counting pipeline as the sensor lab,
 * riding on a moving jeepney and watching its real (simulated) riders board,
 * sit and leave. Renders the picture-in-picture; ui/PipOverlay draws the
 * detections from twin.cabinFeed.
 */

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { type Group, Matrix4, Quaternion, Vector3 } from 'three';
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
import { PipRenderer } from '../doorway/PipRenderer';
import { riderSeed } from '../jeepney/crew';
import { appearance, HEAD_CENTRE_Y } from '../people/personRig';
import { fleetPose } from './lanes';
import { viewScale } from './viewScale';

export function CabinCameraFeed({ index }: { index: number }) {
  const { twin } = useRuntimes();
  const hideFrustum = useApp((s) => s.follow?.view === 'inside' || s.follow?.view === 'pov');
  const camera = useMemo(createCabinCamera, []);
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

  useFrame((state, dt) => {
    const feed = twin.cabinFeed;
    if (!feed.pipeline || !twin.fleet.vehicles[index]) return;
    // Same transform the renderer uses, including the zoomed-out symbol scale.
    fleetPose(twin.fleet, index, s.pose);
    s.vehicle.compose(
      s.p.set(s.pose.x, 0, s.pose.z),
      s.q.setFromAxisAngle(s.up, s.pose.heading),
      s.k.setScalar(viewScale(state)),
    );
    placeOnVehicle(camera, s.vehicle);
    if (mountRef.current) {
      mountRef.current.matrix.copy(s.vehicle);
      mountRef.current.matrixWorldNeedsUpdate = true;
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

  return (
    <>
      <group ref={mountRef} matrixAutoUpdate={false}>
        <CabinCameraModel showFrustum={!hideFrustum} />
      </group>
      <PipRenderer espCamera={camera} />
    </>
  );
}
