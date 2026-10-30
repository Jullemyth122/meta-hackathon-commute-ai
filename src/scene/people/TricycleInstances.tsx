/**
 * Tricycles carrying riders the first mile to their stop: a motorcycle with
 * a covered sidecar, as on Philippine streets. Two instanced meshes for all
 * of them (painted body, dark running gear), driven imperatively like
 * PeopleInstances:
 *
 *   tricycles.begin();
 *   tricycles.emit(pose, seed);   // once per rider in a sidecar
 *   tricycles.end();
 *
 * Frame: the passenger's root (on the road) at the origin, +X forward, +Z
 * to the right. The sidecar is on the right, the kerb side, so riders get
 * out onto the pavement; the motorcycle runs beside it on the left. A seated
 * rider's hips are 0.74 m up (personRig.ts), about a sidecar seat's height.
 */

import { useEffect, useImperativeHandle, useMemo, useRef, type Ref } from 'react';
import {
  Color,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type InstancedMesh,
} from 'three';
import { box, cylinder, mergeParts } from '../jeepney/geometryKit';

/** The driver sits astride the motorcycle here, relative to the passenger's root. */
export const TRICYCLE_DRIVER = { x: -0.2, y: 0.18, z: -0.9 };

const BODY_COLOURS = ['#1f6fb2', '#b83227', '#2e8b57', '#d4a017', '#6c3483', '#d35400'].map(
  (c) => new Color(c),
);

function bodyGeometry() {
  return mergeParts([
    box(-0.75, 0.85, 0.18, 0.32, -0.5, 0.5), // sidecar floor
    box(-0.35, 0.3, 0.32, 0.6, -0.42, 0.42), // seat
    box(-0.5, -0.35, 0.32, 1.15, -0.48, 0.48), // backrest
    box(0.55, 0.85, 0.32, 0.95, -0.5, 0.5), // nose
    box(-0.5, 0.55, 0.32, 0.8, 0.42, 0.5), // kerb-side wall
    box(-0.8, 0.9, 1.62, 1.7, -1.3, 0.56), // roof over both
    box(0.78, 0.84, 0.95, 1.62, 0.44, 0.5), // roof posts
    box(-0.5, -0.44, 1.15, 1.62, 0.44, 0.5),
    box(0.82, 0.88, 0.95, 1.62, -1.28, -1.22),
    box(-0.7, -0.64, 0.6, 1.62, -1.28, -1.22),
  ])!;
}

function gearGeometry() {
  return mergeParts([
    box(-0.6, 0.6, 0.5, 0.82, -1.04, -0.76), // motorcycle body
    box(-0.55, 0.05, 0.82, 0.92, -1.02, -0.78), // its seat
    box(0.6, 0.68, 0.3, 1.0, -0.94, -0.86), // fork
    box(0.58, 0.64, 0.98, 1.03, -1.22, -0.58), // handlebar
    box(-0.75, 0.6, 0.3, 0.36, -0.86, -0.5), // sidecar arm
    cylinder(0.28, 0.28, 0.1, 14, 'z', 0.75, 0.28, -0.9), // wheels
    cylinder(0.28, 0.28, 0.1, 14, 'z', -0.6, 0.28, -0.9),
    cylinder(0.25, 0.25, 0.1, 14, 'z', -0.1, 0.25, 0.56),
  ])!;
}

export interface TricycleHandle {
  begin(): void;
  /** One tricycle around a seated rider at `pose` (root position, yaw); colour from `seed`. */
  emit(pose: { x: number; y: number; z: number; yaw: number }, seed: number): void;
  end(): void;
}

export function TricycleInstances({
  ref,
  capacity,
}: {
  ref: Ref<TricycleHandle>;
  capacity: number;
}) {
  const body = useRef<InstancedMesh>(null);
  const gear = useRef<InstancedMesh>(null);
  const parts = useMemo(
    () => ({
      body: bodyGeometry(),
      gear: gearGeometry(),
      paint: new MeshStandardMaterial({ roughness: 0.55 }),
      dark: new MeshStandardMaterial({ color: '#2b2b2e', roughness: 0.7 }),
    }),
    [],
  );
  useEffect(
    () => () => {
      for (const p of Object.values(parts)) p.dispose();
    },
    [parts],
  );
  const state = useMemo(
    () => ({
      n: 0,
      m: new Matrix4(),
      q: new Quaternion(),
      at: new Vector3(),
      up: new Vector3(0, 1, 0),
      one: new Vector3(1, 1, 1),
    }),
    [],
  );

  useImperativeHandle(
    ref,
    () => ({
      begin() {
        state.n = 0;
      },
      emit(pose, seed) {
        if (state.n >= capacity || !body.current || !gear.current) return;
        const i = state.n++;
        state.q.setFromAxisAngle(state.up, pose.yaw);
        state.m.compose(state.at.set(pose.x, pose.y, pose.z), state.q, state.one);
        body.current.setMatrixAt(i, state.m);
        gear.current.setMatrixAt(i, state.m);
        body.current.setColorAt(i, BODY_COLOURS[Math.abs(seed) % BODY_COLOURS.length]!);
      },
      end() {
        for (const mesh of [body.current, gear.current]) {
          if (!mesh) continue;
          mesh.count = state.n;
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
      },
    }),
    [capacity, state],
  );

  return (
    <group>
      <instancedMesh
        key={`body-${capacity}`}
        ref={body}
        args={[parts.body, parts.paint, capacity]}
        castShadow
        receiveShadow
        frustumCulled={false}
      />
      <instancedMesh
        key={`gear-${capacity}`}
        ref={gear}
        args={[parts.gear, parts.dark, capacity]}
        castShadow
        frustumCulled={false}
      />
    </group>
  );
}
