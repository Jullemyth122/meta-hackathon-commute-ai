/**
 * Draws up to `capacity` articulated people (personRig.ts) with one
 * InstancedMesh per body part: 9 draw calls for the whole crowd.
 *
 * Whoever owns the poses drives it imperatively, inside their own useFrame,
 * so people can be posed with the same matrices as the vehicle they sit in:
 *
 *   people.begin();
 *   people.emit(rootMatrix, pose, seed);   // once per visible person
 *   people.end();
 *
 * A person's colours depend only on `seed`, and colours are re-uploaded only
 * for instance slots whose occupant changed.
 */

import { useImperativeHandle, useMemo, useRef, type Ref } from 'react';
import { Matrix4, MeshStandardMaterial, type InstancedMesh } from 'three';
import {
  appearance,
  PAIRED_PARTS,
  PART_COLOR,
  RigWriter,
  rigGeometries,
  SINGLE_PARTS,
  type Appearance,
  type BodyPart,
  type PersonPose,
} from './personRig';

export interface PeopleHandle {
  begin(): void;
  /**
   * Add one person. `look` defaults to appearance(seed); pass one to dress
   * someone differently (the driver). Ignored once capacity is reached.
   */
  emit(root: Matrix4, pose: PersonPose, seed: number, look?: Appearance): void;
  end(): void;
}

const PARTS: readonly BodyPart[] = [...SINGLE_PARTS, ...PAIRED_PARTS];
const isPaired = (p: BodyPart) => (PAIRED_PARTS as readonly string[]).includes(p);

let material: MeshStandardMaterial | null = null;

export function PeopleInstances({
  capacity,
  castShadow = true,
  ref,
}: {
  capacity: number;
  castShadow?: boolean;
  ref: Ref<PeopleHandle>;
}) {
  const geometries = rigGeometries();
  material ??= new MeshStandardMaterial({ roughness: 0.72 });
  const meshes = useRef<Partial<Record<BodyPart, InstancedMesh | null>>>({});

  const state = useMemo(
    () => ({
      n: 0,
      writer: new RigWriter(),
      out: {
        torso: new Matrix4(),
        pelvis: new Matrix4(),
        head: new Matrix4(),
        hair: new Matrix4(),
        thigh: [new Matrix4(), new Matrix4()],
        shin: [new Matrix4(), new Matrix4()],
        foot: [new Matrix4(), new Matrix4()],
        sleeve: [new Matrix4(), new Matrix4()],
        forearm: [new Matrix4(), new Matrix4()],
      } as Parameters<RigWriter['write']>[2],
      /** Seed currently shown in each slot, to skip unchanged colour uploads. */
      seeds: new Int32Array(capacity).fill(-1),
      coloursDirty: false,
    }),
    [capacity],
  );

  useImperativeHandle(
    ref,
    () => ({
      begin() {
        state.n = 0;
        state.coloursDirty = false;
      },
      emit(root, pose, seed, lookOverride) {
        const i = state.n;
        if (i >= capacity) return;
        state.n++;
        state.writer.write(root, pose, state.out);
        const recolour = state.seeds[i] !== seed;
        const look = recolour ? (lookOverride ?? appearance(seed)) : null;
        if (recolour) {
          state.seeds[i] = seed;
          state.coloursDirty = true;
        }
        for (const part of PARTS) {
          const mesh = meshes.current[part];
          if (!mesh) continue;
          if (isPaired(part)) {
            const [l, r] = state.out[part as (typeof PAIRED_PARTS)[number]];
            mesh.setMatrixAt(i * 2, l);
            mesh.setMatrixAt(i * 2 + 1, r);
            if (look) {
              mesh.setColorAt(i * 2, look[PART_COLOR[part]]);
              mesh.setColorAt(i * 2 + 1, look[PART_COLOR[part]]);
            }
          } else {
            mesh.setMatrixAt(i, state.out[part as (typeof SINGLE_PARTS)[number]]);
            if (look) mesh.setColorAt(i, look[PART_COLOR[part]]);
          }
        }
      },
      end() {
        for (const part of PARTS) {
          const mesh = meshes.current[part];
          if (!mesh) continue;
          mesh.count = isPaired(part) ? state.n * 2 : state.n;
          mesh.instanceMatrix.needsUpdate = true;
          if (state.coloursDirty && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
      },
    }),
    [capacity, state],
  );

  return (
    <group>
      {PARTS.map((part) => (
        <instancedMesh
          key={`${part}-${capacity}`}
          ref={(m) => {
            meshes.current[part] = m;
            // A fresh mesh has no colours yet: force every slot to recolour.
            if (m) state.seeds.fill(-1);
          }}
          args={[geometries[part], material!, isPaired(part) ? capacity * 2 : capacity]}
          castShadow={castShadow}
          receiveShadow
          frustumCulled={false}
        />
      ))}
    </group>
  );
}
