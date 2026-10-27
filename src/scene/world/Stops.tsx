/** Persistent passengers and marked waiting/arrival areas on both sides of each stop. */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import { Matrix4, type Mesh } from 'three';
import { useApp } from '@/app/store';
import type { FleetSim } from '@/core/fleet/fleetSim';
import { newRiderPose } from '@/core/people/riderMotion';
import { stopPoint, STOP_CURB_M } from '@/core/people/stopLayout';
import type { CrewState } from '../jeepney/crewState';
import { riderSeed } from '../jeepney/crew';
import { PeopleInstances, type PeopleHandle } from '../people/PeopleInstances';
import { appearance, poseFromMotion, rootFor, STANDING } from '../people/personRig';
import { Labels } from './Labels';

export function Stops({ fleet, crew }: { fleet: FleetSim; crew: CrewState }) {
  const people = useRef<PeopleHandle>(null);
  const marker = useRef<Mesh>(null);
  const tracked = useApp((s) => s.trackedRiderId);
  const inside = useApp((s) => s.follow?.view === 'inside');
  const [capacity, setCapacity] = useState(512);
  const scratch = useMemo(
    () => ({ root: new Matrix4(), person: { ...STANDING }, motion: newRiderPose() }),
    [],
  );
  const areas = useMemo(
    () =>
      fleet.route.stops.flatMap((stop, i) =>
        ([1, -1] as const).flatMap((direction) => {
          const yaw = fleet.route.polyline.headingAt(stop.s, 4.3) + (direction === 1 ? 0 : Math.PI);
          return [
            {
              ...stopPoint(fleet.route, i, direction, 0, STOP_CURB_M + 2),
              yaw,
              width: 7,
              depth: 7,
              color: '#bbc9e7',
              label: `${stop.name} · Waiting`,
            },
            {
              ...stopPoint(fleet.route, i, direction, 10, STOP_CURB_M + 2),
              yaw,
              width: 8,
              depth: 7,
              color: '#b2d5bc',
              label: `${stop.name} · Arrivals`,
            },
          ];
        }),
      ),
    [fleet],
  );
  const labels = useMemo(
    () => areas.map((a) => ({ text: a.label, kind: 'passenger-area', x: a.x, y: 0.2, z: a.z })),
    [areas],
  );

  useFrame((state) => {
    if (crew.passengers.size > capacity) setCapacity(Math.ceil(crew.passengers.size / 256) * 256);
    const crowd = people.current;
    if (!crowd) return;
    crowd.begin();
    crew.forEachOutside((r) => {
      const seed = riderSeed(r.id);
      const look = appearance(seed);
      crowd.emit(
        rootFor(r.pose, look.size, scratch.root),
        poseFromMotion(r.pose, look, state.clock.elapsedTime, scratch.person),
        seed,
      );
    });
    crowd.end();
    if (marker.current) {
      const p = tracked === null ? null : crew.worldPose(tracked, scratch.motion);
      marker.current.visible = !!p;
      if (p) marker.current.position.set(p.x, p.y + 0.03, p.z);
    }
  });

  return (
    <group>
      {areas.map((a, i) => (
        <mesh key={i} position={[a.x, 0.01, a.z]} rotation={[-Math.PI / 2, 0, a.yaw]} receiveShadow>
          <planeGeometry args={[a.width, a.depth]} />
          <meshStandardMaterial color={a.color} roughness={0.9} />
        </mesh>
      ))}
      <Labels labels={labels} hidden={inside} />
      <PeopleInstances ref={people} capacity={capacity} />
      <mesh ref={marker} rotation-x={-Math.PI / 2} visible={false}>
        <ringGeometry args={[0.45, 0.6, 32]} />
        <meshBasicMaterial color="#f5c542" depthTest={false} />
      </mesh>
    </group>
  );
}
