/**
 * Modern jeepneys, UV Express vans or buses (one kind per component): the
 * bodies, their doors (open or shut), and their wheels rolling about the
 * axles, posed each frame by whoever owns them: the live twin's fleet
 * (PuvInstances, which adds the drivers and riders) or the network's
 * estimated flows (NetworkLayer). One instanced mesh per material slot.
 * Symbol-scaled with the view like the jeepneys; clickable.
 */

import { useEffect, useMemo, useRef } from 'react';
import {
  Box3,
  Matrix4,
  Object3D,
  Ray,
  Vector3,
  type InstancedMesh,
  type Intersection,
  type Raycaster,
} from 'three';
import { useApp } from '@/app/store';
import { VEHICLES, type VehicleKind } from '@/core/vehicles/specs';
import type { GroundPose } from '../jeepney/JeepneyInstances';
import { useScaledPose } from '../world/viewScale';
import type { Slot } from './bodyKit';
import { vehicleGeometry } from './vehicleGeometry';
import { vehicleMaterial } from './vehicleMaterials';

/** Collapses an instance to nothing: how a vehicle not shown, or a shut door, is "drawn". */
const NOWHERE = new Matrix4().makeScale(0, 0, 0);

export interface PuvState {
  /** False: not drawn. */
  shown: boolean;
  /** Doors open (standing at a stop, riders on and off). */
  open: boolean;
  /** How far its wheels have turned (radians). */
  spin: number;
}

/** Called as each vehicle is posed, with its matrix (to draw who is in it). */
export interface PuvCrew {
  begin(): void;
  vehicle(k: number, matrix: Matrix4, scale: number): void;
  end(): void;
}

interface Props {
  kind: VehicleKind;
  count: number;
  poseAt(k: number, out: GroundPose): void;
  stateAt(k: number, out: PuvState): void;
  onSelect?: (k: number, part: 'front' | 'body') => void;
  crew?: PuvCrew;
  castShadow?: boolean;
}

export function PuvBodies({
  kind,
  count,
  poseAt,
  stateAt,
  onSelect,
  crew,
  castShadow = true,
}: Props) {
  const built = vehicleGeometry(kind);
  const S = VEHICLES[kind];
  const sets = useMemo(
    () =>
      [
        ['body', built.parts],
        ['open', built.doors.open],
        ['closed', built.doors.closed],
        ...built.axles.map((a, n) => [`axle${n}`, a.parts] as const),
      ] as const,
    [built],
  );
  const meshes = useRef<Record<string, InstancedMesh | null>>({});
  const picker = useRef<Object3D>(null);
  const matrices = useRef<Array<Matrix4 | null>>([]);
  const hitBox = useMemo(
    () =>
      new Box3(
        new Vector3(-S.lengthM / 2 - 0.2, 0, -S.widthM / 2 - 0.1),
        new Vector3(S.lengthM / 2 + 0.2, S.heightM, S.widthM / 2 + 0.1),
      ),
    [S],
  );
  const scratch = useMemo(
    () => ({
      pose: { x: 0, z: 0, heading: 0 },
      state: { shown: false, open: false, spin: 0 } as PuvState,
      obj: new Object3D(),
      wheel: new Matrix4(),
      roll: new Matrix4(),
    }),
    [],
  );

  useEffect(
    () => () => {
      document.body.style.cursor = '';
    },
    [],
  );

  useScaledPose((k) => {
    const { pose, state, obj, wheel, roll } = scratch;
    const all = Object.entries(meshes.current);
    crew?.begin();
    for (let j = 0; j < count; j++) {
      stateAt(j, state);
      if (!state.shown) {
        for (const [, m] of all) m?.setMatrixAt(j, NOWHERE);
        matrices.current[j] = null;
        continue;
      }
      poseAt(j, pose);
      obj.position.set(pose.x, 0, pose.z);
      obj.rotation.set(0, pose.heading, 0);
      obj.scale.setScalar(k);
      obj.updateMatrix();
      (matrices.current[j] ??= new Matrix4()).copy(obj.matrix);
      // Rolled forward about each axle (nose-down: a negative angle).
      roll.makeRotationZ(-state.spin);
      for (const [key, m] of all) {
        if (!m) continue;
        const set = key.split(':')[0]!;
        if (set.startsWith('axle')) {
          const a = built.axles[Number(set.slice(4))]!;
          wheel.makeTranslation(a.x, a.y, 0).multiply(roll).premultiply(obj.matrix);
          m.setMatrixAt(j, wheel);
          continue;
        }
        const shown = set === 'body' || (set === 'open') === state.open;
        m.setMatrixAt(j, shown ? obj.matrix : NOWHERE);
      }
      crew?.vehicle(j, obj.matrix, k);
    }
    crew?.end();
    for (const [, m] of all) if (m) m.instanceMatrix.needsUpdate = true;
  });

  const raycast = useMemo(() => {
    const inv = new Matrix4();
    const ray = new Ray();
    const hit = new Vector3();
    return (raycaster: Raycaster, intersects: Intersection[]) => {
      if (!onSelect || !picker.current || useApp.getState().follow?.view === 'inside') return;
      matrices.current.forEach((m, j) => {
        if (!m) return;
        inv.copy(m).invert();
        ray.copy(raycaster.ray).applyMatrix4(inv);
        if (!ray.intersectBox(hitBox, hit)) return;
        const world = hit.clone().applyMatrix4(m);
        intersects.push({
          distance: raycaster.ray.origin.distanceTo(world),
          point: world,
          object: picker.current!,
          instanceId: j,
        });
      });
    };
  }, [onSelect, hitBox]);

  return (
    <group>
      {onSelect && (
        <object3D
          ref={picker}
          raycast={raycast}
          onClick={(e) => {
            if (e.delta > 6 || e.instanceId === undefined) return;
            e.stopPropagation();
            const m = matrices.current[e.instanceId];
            const local = m ? e.point.clone().applyMatrix4(m.clone().invert()) : null;
            // Clicked near the windscreen: the front seat; anywhere else, follow it.
            onSelect(
              e.instanceId,
              local !== null && local.x > S.lengthM / 2 - 1.4 ? 'front' : 'body',
            );
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={() => {
            document.body.style.cursor = '';
          }}
        />
      )}
      {sets.flatMap(([set, parts]) =>
        (Object.keys(parts) as Slot[]).map((slot) => (
          <instancedMesh
            key={`${set}:${slot}:${count}`}
            ref={(m) => {
              meshes.current[`${set}:${slot}`] = m;
            }}
            args={[parts[slot], vehicleMaterial(kind, slot), count]}
            castShadow={castShadow && slot !== 'glass'}
            receiveShadow
            frustumCulled={false}
          />
        )),
      )}
    </group>
  );
}
