/**
 * The twin's modern jeepneys (or a bus or UV Express route's buses or vans),
 * one kind per component, drawn from FleetSim each frame (PuvBodies): doors
 * open while it stands serving a stop and shut as soon as it moves, wheels
 * rolling as far as it has driven, a driver at the wheel, and its riders
 * getting on, sitting and getting off (CrewState, puvCrew.ts). Parked for
 * the night, it stands where it is kept (lanes.fleetPose), empty.
 */

import { useThree } from '@react-three/fiber';
import { useCallback, useMemo, useRef } from 'react';
import { Matrix4, Vector3 } from 'three';
import { useApp } from '@/app/store';
import type { FleetSim } from '@/core/fleet/fleetSim';
import { VEHICLES, type VehicleKind } from '@/core/vehicles/specs';
import { crewSeed, riderSeed } from '../jeepney/crew';
import type { CrewState } from '../jeepney/crewState';
import { drivingPose, type GroundPose } from '../jeepney/JeepneyInstances';
import { PeopleInstances, type PeopleHandle } from '../people/PeopleInstances';
import {
  appearance,
  driverAppearance,
  poseFromMotion,
  rootFor,
  STANDING,
  type PersonPose,
} from '../people/personRig';
import { fleetPose } from '../world/lanes';
import { PuvBodies, type PuvCrew, type PuvState } from './PuvBodies';
import { vehicleGeometry } from './vehicleGeometry';

/** The driver's seed in crewSeed's scheme (k past every passenger seat). */
const DRIVER_SEAT_K = 63;
/** Riders are drawn within this of the camera, as the jeepneys' are (metres). */
const CREW_WITHIN_M = 250;
/** Moving faster than this, the doors are shut (m/s). */
const DOORS_SHUT_MPS = 0.3;

interface Props {
  fleet: FleetSim;
  crew: CrewState;
  kind: VehicleKind;
  onSelect?: (index: number, part: 'front' | 'body') => void;
}

export function PuvInstances({ fleet, crew, kind, onSelect }: Props) {
  const ids = useMemo(
    () => fleet.vehicles.filter((v) => v.kind === kind).map((v) => v.id),
    [fleet, kind],
  );
  return ids.length === 0 ? null : (
    <Instances fleet={fleet} crew={crew} kind={kind} ids={ids} onSelect={onSelect} />
  );
}

function Instances({ fleet, crew, kind, ids, onSelect }: Props & { ids: readonly number[] }) {
  const viewer = useThree((s) => s.camera);
  const built = vehicleGeometry(kind);
  const S = VEHICLES[kind];
  const people = useRef<PeopleHandle>(null);
  const scratch = useMemo(
    () => ({
      root: new Matrix4(),
      local: new Matrix4(),
      person: { ...STANDING } as PersonPose,
      grip: [new Vector3(), new Vector3()] as [Vector3, Vector3],
      driver: {
        x: built.driver.x,
        y: built.driver.y,
        z: built.driver.z,
        yaw: 0,
        sit: 1,
        walk: 0,
        phase: 0,
        stoop: 0.96,
      },
    }),
    [built],
  );

  const poseAt = useCallback(
    (j: number, out: GroundPose) => fleetPose(fleet, ids[j]!, out),
    [fleet, ids],
  );
  const stateAt = useCallback(
    (j: number, out: PuvState) => {
      const v = fleet.vehicles[ids[j]!];
      out.shown = !!v;
      if (!v) return;
      out.open =
        v.duty !== 'parked' &&
        v.speedMps < DOORS_SHUT_MPS &&
        (v.currentStop !== null || crew.busy(v.id));
      // The wheels have turned as far as it has driven today.
      out.spin = v.day.metres / S.wheelRadiusM;
    },
    [fleet, ids, crew, S],
  );

  const draw = useMemo<PuvCrew>(
    () => ({
      begin: () => people.current?.begin(),
      end: () => people.current?.end(),
      vehicle: (j, matrix, k) => {
        const crowd = people.current;
        const id = ids[j]!;
        const v = fleet.vehicles[id];
        // Parked for the night: nobody in it.
        if (!crowd || !v || v.duty === 'parked') return;
        const selected = useApp.getState();
        const followed = selected.follow?.kind === 'sim' ? selected.follow.index : null;
        const tracked =
          selected.trackedRiderId === null
            ? null
            : crew.passengers.get(selected.trackedRiderId)?.vehicleId;
        const x = matrix.elements[12]!;
        const z = matrix.elements[14]!;
        const near =
          Math.hypot(x - viewer.position.x, z - viewer.position.z) < CREW_WITHIN_M * Math.max(1, k);
        if (!near && followed !== id && tracked !== id) return;
        const { root, local, person, grip, driver } = scratch;
        const t = performance.now() / 1000;
        // The driver, hands on the wheel at ten to two.
        const seed = crewSeed(id, DRIVER_SEAT_K);
        const look = driverAppearance(seed);
        root.multiplyMatrices(matrix, rootFor(driver, look.size, local));
        grip[0].copy(built.driver.grips[0]).applyMatrix4(matrix);
        grip[1].copy(built.driver.grips[1]).applyMatrix4(matrix);
        crowd.emit(root, drivingPose(t, look.idle, 0, grip, person), seed, look);
        crew.forEachRider(id, (riderId, motion) => {
          const riderLook = appearance(riderSeed(riderId));
          root.multiplyMatrices(matrix, rootFor(motion, riderLook.size, local));
          crowd.emit(root, poseFromMotion(motion, riderLook, t, person), riderSeed(riderId));
        });
      },
    }),
    [fleet, ids, crew, built, scratch, viewer],
  );

  return (
    <>
      <PuvBodies
        kind={kind}
        count={ids.length}
        poseAt={poseAt}
        stateAt={stateAt}
        onSelect={onSelect && ((j, part) => onSelect(ids[j]!, part))}
        crew={draw}
      />
      <PeopleInstances ref={people} capacity={ids.length * (S.seats + 1)} />
    </>
  );
}
