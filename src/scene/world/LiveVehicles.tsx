/**
 * Jeepneys driven by real phones. Each gets:
 *   - the jeepney model at its interpolated pose,
 *   - a beacon above it coloured by link status (live / stale / lost),
 *   - a breadcrumb line of the raw GPS fixes (the evidence behind the pose).
 *
 * A stale or lost jeepney is shown as such. We never animate a vehicle we
 * have not heard from.
 */

import { useFrame } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Line,
  LineBasicMaterial,
  Object3D,
  type InstancedMesh,
} from 'three';
import { useApp } from '@/app/store';
import type { Livery } from '@/core/fleet/fleetSim';
import type { LinkStatus, LiveVehicle } from '@/core/tracking/liveVehicle';
import { JeepneyInstances, type GroundPose } from '../jeepney/JeepneyInstances';
import { useScaledPose } from './viewScale';

const STATUS_COLOR: Record<LinkStatus, Color> = {
  live: new Color('#3a9d5d'),
  stale: new Color('#efbe2c'),
  lost: new Color('#8a929b'),
};
const TRACE_CAPACITY = 4_000;

export function LiveVehicles({
  vehicles,
  ids,
}: {
  vehicles: LiveVehicle[];
  ids?: readonly string[];
}) {
  const setFollow = useApp((s) => s.setFollow);
  const liveries = useMemo<Livery[]>(() => vehicles.map(() => 'red'), [vehicles]);
  const beacons = useRef<InstancedMesh>(null);
  const scratch = useMemo(() => new Object3D(), []);
  const handleSelect = useCallback(
    (index: number, part: 'front' | 'body') => {
      const id = ids?.[index];
      if (!id) return;
      const cur = useApp.getState().follow;
      const same = cur?.kind === 'live' && cur.id === id;
      setFollow({ kind: 'live', id, view: part === 'front' && same ? 'pov' : 'chase' });
    },
    [ids, setFollow],
  );

  const poseAt = (i: number, out: GroundPose) => Object.assign(out, vehicles[i]!.pose);

  // Placed per render pass: true size for the cabin camera, enlarged for the
  // zoomed-out main view (see viewScale.ts).
  useScaledPose((k) => {
    const mesh = beacons.current;
    if (!mesh) return;
    const now = Date.now();
    scratch.scale.setScalar(k);
    vehicles.forEach((v, i) => {
      // Beacon over the roof, scaled with the jeepney.
      scratch.position.set(v.pose.x, 4.2 * k, v.pose.z);
      scratch.updateMatrix();
      mesh.setMatrixAt(i, scratch.matrix);
      mesh.setColorAt(i, STATUS_COLOR[v.status(now)]);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  if (vehicles.length === 0) return null;
  return (
    <group>
      <JeepneyInstances
        count={vehicles.length}
        liveries={liveries}
        poseAt={poseAt}
        scaleWithView
        onSelect={handleSelect}
      />
      <instancedMesh
        key={vehicles.length}
        ref={beacons}
        args={[undefined, undefined, vehicles.length]}
        frustumCulled={false}
      >
        <coneGeometry args={[0.45, 1.1, 18]} />
        <meshStandardMaterial color="#ffffff" roughness={0.4} />
      </instancedMesh>
      {vehicles.map((v, i) => (
        <Trace key={i} vehicle={v} />
      ))}
    </group>
  );
}

/** Breadcrumb trail. Uploads new points only when the trace grows. */
function Trace({ vehicle }: { vehicle: LiveVehicle }) {
  const line = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(TRACE_CAPACITY * 3), 3));
    g.setDrawRange(0, 0);
    return new Line(g, new LineBasicMaterial({ color: '#2a4bd7' }));
  }, []);
  const uploaded = useRef(0);

  useEffect(
    () => () => {
      line.geometry.dispose();
      (line.material as LineBasicMaterial).dispose();
    },
    [line],
  );

  useFrame(() => {
    const trace = vehicle.trace;
    if (trace.length === uploaded.current) return;
    const attr = line.geometry.getAttribute('position') as BufferAttribute;
    const n = Math.min(trace.length, TRACE_CAPACITY);
    for (let i = 0; i < n; i++) attr.setXYZ(i, trace[i]!.x, 0.3, trace[i]!.z);
    attr.needsUpdate = true;
    line.geometry.setDrawRange(0, n);
    line.geometry.computeBoundingSphere();
    uploaded.current = trace.length;
  });

  return <primitive object={line} />;
}
