/**
 * The rest of Metro Manila around the focused route: every network route as
 * a light line (operator view), the commuter's planned trip, and the
 * jeepneys of the network's flows (core/network/flow.ts) near the camera.
 *
 * What each person sees is what they would see on the street:
 *
 *   operator  everything within a few km of where the camera looks (more
 *             when zoomed out), free to move anywhere.
 *   driver    the road ahead to the end of their screen's horizon (1.5 km),
 *             the mirror's worth behind (100 m), side streets near by.
 *   commuter  around them, about a 1.5 km walk-and-look.
 *
 * Flow jeepneys fill a fixed pool of instance slots (the nearest in full,
 * the rest as blocks), refilled a few times a second with the nearest ones; positions are recomputed every frame (the
 * flow is a function of the clock, so this is cheap). Clicking one focuses
 * its route: the twin takes it over from the flow.
 */

import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { flowOf, focusRoute, getNetwork } from '@/app/network';
import { useRuntimes } from '@/app/runtimeContext';
import { useApp } from '@/app/store';
import type { TwinRuntime } from '@/app/twinRuntime';
import type { Livery } from '@/core/fleet/fleetSim';
import { simplify } from '@/core/geo/simplify';
import type { Route } from '@/core/geo/routes';
import type { Network } from '@/core/network/network';
import type { FlowVehicle } from '@/core/network/flow';
import { JeepneyInstances, type GroundPose } from '../jeepney/JeepneyInstances';
import { lanePose, laneOffset } from './lanes';
import { viewScale } from './viewScale';
import { TripPlanLayer } from './TripPlanLayer';
import { keepSlots, type Slotted } from './slots';

/**
 * The nearest network jeepneys are drawn in full (a jeepney is ~22,000
 * vertices, so only a few dozen), the rest as simple jeepney-sized blocks
 * in their livery colour: from where they are, that is all anyone sees.
 */
const DETAILED = 48;
const BLOCKS = 400;
const BLOCK = { length: 6.9, width: 2.4, height: 2.5 };
const BLOCK_COLOURS: Record<Livery, string> = {
  red: '#b42318',
  yellow: '#c48a0a',
  green: '#1e7a3c',
};
const REFILL_S = 0.25;
/** Overview lines are simplified this much (metres): drawn thin, from far. */
const OVERVIEW_TOLERANCE_M = 12;
const LINE_Y = 0.35;
const HIDDEN = 1e7;
const LIVERIES: Livery[] = ['red', 'yellow', 'green'];
/**
 * A flow jeepney's livery: its own, by its number on its route, as the twin
 * paints its jeepneys (FleetSim: i % 3), so it keeps its colour drawn in
 * full or as a block, and when its route is focused and the twin takes it over.
 */
const liveryOf = (i: number): Livery => LIVERIES[i % 3]!;

/** Which flow jeepneys a view shows, around a point looking along a heading. */
export interface ViewReach {
  x: number;
  z: number;
  /** Ahead/behind/side limits (metres) relative to `heading`, or a plain radius. */
  ahead: number;
  behind: number;
  side: number;
  /** Three.js yaw: forward is (cos h, −sin h) in x/z. */
  heading: number;
}

/** Whether point (x, z) is within reach. */
export function inReach(r: ViewReach, x: number, z: number): boolean {
  const dx = x - r.x;
  const dz = z - r.z;
  const fwd = dx * Math.cos(r.heading) - dz * Math.sin(r.heading);
  const lat = dx * Math.sin(r.heading) + dz * Math.cos(r.heading);
  return fwd <= r.ahead && fwd >= -r.behind && Math.abs(lat) <= r.side;
}

interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function boundsOf(route: Route): Bounds {
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const p of route.polyline.points) {
    b.minX = Math.min(b.minX, p.x);
    b.maxX = Math.max(b.maxX, p.x);
    b.minZ = Math.min(b.minZ, p.z);
    b.maxZ = Math.max(b.maxZ, p.z);
  }
  return b;
}

/** Every route except the focused one, as one set of thin line segments. */
function NetworkLines({ network, focusedId }: { network: Network; focusedId: string }) {
  const lines = useMemo(() => {
    const parts: number[] = [];
    for (const { route } of network.routes) {
      if (route.id === focusedId) continue;
      const pts = simplify(route.polyline.points, OVERVIEW_TOLERANCE_M);
      for (let i = 1; i < pts.length; i++)
        parts.push(pts[i - 1]!.x, LINE_Y, pts[i - 1]!.z, pts[i]!.x, LINE_Y, pts[i]!.z);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(parts), 3));
    const m = new LineBasicMaterial({ color: '#5b6b8c' });
    const l = new LineSegments(g, m);
    l.frustumCulled = false;
    l.renderOrder = 5;
    return l;
  }, [network, focusedId]);
  useEffect(
    () => () => {
      lines.geometry.dispose();
      (lines.material as LineBasicMaterial).dispose();
    },
    [lines],
  );
  return <primitive object={lines} />;
}

/** The commuter's legs: green for the first jeepney, orange for the second. */
/** The current view's reach, from the camera target (and the driver's jeepney). */
function reachFor(
  view: string,
  twin: TwinRuntime,
  target: Vector3,
  cameraHeight: number,
  driver: number,
): ViewReach {
  if (view === 'driver' && twin.fleet.vehicles[driver]) {
    const v = twin.fleet.vehicles[driver]!;
    const p = twin.route.polyline.pointAt(v.s);
    const heading = twin.route.polyline.headingAt(v.s, 4.3);
    return { x: p.x, z: p.z, heading, ahead: 1500, behind: 100, side: 300 };
  }
  const r = view === 'commuter' ? 1500 : Math.max(600, Math.min(4000, cameraHeight * 2));
  return { x: target.x, z: target.z, heading: 0, ahead: r, behind: r, side: r };
}

function FlowJeepneys({ network, twin }: { network: Network; twin: TwinRuntime }) {
  const setFocus = useApp((s) => s.setFocus);
  const setFollow = useApp((s) => s.setFollow);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as { target: Vector3 } | null;
  const bounds = useMemo(() => network.routes.map((r) => boundsOf(r.route)), [network]);
  /** Detailed slot → [route, vehicle], or null; then the blocks, nearest first. */
  const slots = useRef<Array<Slotted | null>>(Array(DETAILED).fill(null));
  const blocks = useRef<Slotted[]>([]);
  const since = useRef(Infinity);
  const scratch = useMemo(() => ({}) as FlowVehicle, []);
  // Each slot painted as the jeepney in it (changed only when the slots change hands).
  const [liveries, setLiveries] = useState<Livery[]>(() => Array(DETAILED).fill(liveryOf(0)));
  const focusedId = twin.route.id;
  const blockMesh = useMemo(() => {
    const g = new BoxGeometry(BLOCK.length, BLOCK.height, BLOCK.width);
    g.translate(0, BLOCK.height / 2, 0);
    const m = new InstancedMesh(g, new MeshLambertMaterial(), BLOCKS);
    m.count = 0;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    return m;
  }, []);
  useEffect(
    () => () => {
      blockMesh.geometry.dispose();
      (blockMesh.material as MeshLambertMaterial).dispose();
    },
    [blockMesh],
  );
  const pose = useMemo(() => ({ x: 0, z: 0, heading: 0 }), []);
  const matrix = useMemo(() => new Matrix4(), []);
  const turn = useMemo(() => new Quaternion(), []);
  const up = useMemo(() => new Vector3(0, 1, 0), []);
  const at = useMemo(() => new Vector3(), []);
  const size = useMemo(() => new Vector3(), []);
  const colour = useMemo(() => new Color(), []);

  /** Where flow jeepney i of route r is now. */
  const placeFlow = useCallback(
    (r: number, i: number, out: GroundPose) => {
      const route = network.routes[r]!.route;
      const s = flowOf(r).vehicle(i, twin.clockS, scratch).s;
      const p = route.polyline.pointAt(s);
      p.heading = route.polyline.headingAt(s, 4.3);
      lanePose(p, 1, laneOffset(route, s), out);
    },
    [network, twin, scratch],
  );

  // The blocks follow their jeepneys every frame, growing with the view like the rest.
  useFrame((state) => {
    const k = viewScale(state);
    const list = blocks.current;
    for (let n = 0; n < list.length; n++) {
      placeFlow(list[n]![0], list[n]![1], pose);
      turn.setFromAxisAngle(up, pose.heading);
      matrix.compose(at.set(pose.x, 0, pose.z), turn, size.set(k, k, k));
      blockMesh.setMatrixAt(n, matrix);
    }
    blockMesh.count = list.length;
    blockMesh.instanceMatrix.needsUpdate = true;
  });

  useFrame((_, dt) => {
    since.current += dt;
    if (since.current < REFILL_S) return;
    since.current = 0;
    const { view, driverVehicle } = useApp.getState();
    const target = controls?.target ?? new Vector3();
    const reach = reachFor(view, twin, target, camera.position.y, driverVehicle);
    const t = twin.clockS;
    const radius = Math.max(reach.ahead, reach.behind, reach.side);
    const found: Array<{ r: number; i: number; d: number }> = [];
    network.routes.forEach(({ route }, r) => {
      if (route.id === focusedId) return; // the twin draws these
      const b = bounds[r]!;
      if (b.maxX < reach.x - radius || b.minX > reach.x + radius) return;
      if (b.maxZ < reach.z - radius || b.minZ > reach.z + radius) return;
      const flow = flowOf(r);
      for (let i = 0; i < flow.count; i++) {
        const v = flow.vehicle(i, t, scratch);
        if (!v.inService) continue; // parked for the night
        const p = route.polyline.pointAt(v.s);
        if (!inReach(reach, p.x, p.z)) continue;
        found.push({ r, i, d: Math.hypot(p.x - reach.x, p.z - reach.z) });
      }
    });
    found.sort((a, b) => a.d - b.d);
    // The nearest in full; one already drawn keeps its slot, and so its look.
    const next = keepSlots(
      slots.current,
      found.map((f) => [f.r, f.i] as const),
    );
    slots.current = next;
    const painted = next.map((slot) => liveryOf(slot?.[1] ?? 0));
    setLiveries((now) => (now.every((l, k) => l === painted[k]) ? now : painted));
    blocks.current = found.slice(DETAILED, DETAILED + BLOCKS).map((f) => [f.r, f.i]);
    blocks.current.forEach(([, i], n) =>
      blockMesh.setColorAt(n, colour.set(BLOCK_COLOURS[liveryOf(i)])),
    );
    if (blockMesh.instanceColor) blockMesh.instanceColor.needsUpdate = true;
  });

  const poseAt = useCallback(
    (k: number, out: GroundPose) => {
      const slot = slots.current[k];
      if (!slot) {
        out.x = out.z = HIDDEN;
        out.heading = 0;
        return;
      }
      placeFlow(slot[0], slot[1], out);
    },
    [placeFlow],
  );

  /** Focus a flow jeepney's route; the new twin starts with the flow's jeepneys in order. */
  const select = useCallback(
    (slot: Slotted | null | undefined) => {
      if (!slot) return;
      const [r, i] = slot;
      setFocus(focusRoute(r, twin));
      if (useApp.getState().view === 'twin') setFollow({ kind: 'sim', index: i, view: 'chase' });
    },
    [twin, setFocus, setFollow],
  );

  return (
    <>
      <JeepneyInstances
        count={DETAILED}
        liveries={liveries}
        poseAt={poseAt}
        scaleWithView
        castShadow={false}
        onSelect={(k) => select(slots.current[k])}
      />
      <primitive
        object={blockMesh}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          if (e.instanceId !== undefined) select(blocks.current[e.instanceId]);
        }}
      />
    </>
  );
}

export function NetworkLayer() {
  const { twin } = useRuntimes();
  const state = useApp((s) => s.network.state);
  const view = useApp((s) => s.view);
  const otherRoutes = useApp((s) => s.otherRoutes);
  const network = state === 'ready' ? getNetwork() : null;
  if (!network) return null;
  return (
    <>
      {view === 'twin' && <NetworkLines network={network} focusedId={twin.route.id} />}
      {view === 'commuter' && <TripPlanLayer network={network} />}
      {otherRoutes && <FlowJeepneys network={network} twin={twin} />}
    </>
  );
}
