/**
 * Sensor lab, for the modern jeepney, UV Express and bus: the vehicle parked
 * at the kerb with its doors open, and each door camera with an outline of
 * what it sees (to the floor and the bottom step).
 */

import { useEffect, useMemo } from 'react';
import { BufferGeometry, LineBasicMaterial, LineSegments, type Vector3 } from 'three';
import { useApp } from '@/app/store';
import type { VehicleKind } from '@/core/vehicles/specs';
import type { Slot } from './bodyKit';
import { createDoorCamera, doorCameras, footprint } from './doorCamera';
import { vehicleGeometry } from './vehicleGeometry';
import { vehicleMaterial } from './vehicleMaterials';

export function VehicleShowcase({ kind }: { kind: VehicleKind }) {
  const showFov = useApp((s) => s.showFov);
  const built = vehicleGeometry(kind);
  // The lab shows it at a stop: doors open.
  const parts = { ...built.parts };
  const doors = built.doors.open;
  const frusta = useMemo(() => {
    const pts: Vector3[] = [];
    for (const cam of doorCameras(kind)) {
      const camera = createDoorCamera(cam);
      const floor = footprint(camera, cam.door.y0);
      floor.forEach((c, i) => pts.push(cam.position, c, c, floor[(i + 1) % 4]!));
    }
    return new LineSegments(
      new BufferGeometry().setFromPoints(pts),
      new LineBasicMaterial({ color: '#ff3b30', transparent: true, opacity: 0.55 }),
    );
  }, [kind]);
  useEffect(
    () => () => {
      frusta.geometry.dispose();
      (frusta.material as LineBasicMaterial).dispose();
    },
    [frusta],
  );

  return (
    <group>
      {[parts, doors].flatMap((set, k) =>
        (Object.keys(set) as Slot[]).map((slot) => (
          <mesh
            key={`${k}-${slot}`}
            geometry={set[slot]}
            material={vehicleMaterial(kind, slot)}
            castShadow={slot !== 'glass'}
            receiveShadow
          />
        )),
      )}
      {showFov && <primitive object={frusta} />}
    </group>
  );
}
