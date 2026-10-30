/**
 * A planned trip on the map, end to end, so it can be checked against the
 * streets: a pin at home, where "you" appear (green), and where you are
 * going (red); the way to the waiting area, on foot or by tricycle (purple: once the trip is taken,
 * the very streets "you" go by; before, as the crow flies, the planner's
 * estimate); each jeepney
 * ride along its route (green, a second one orange); the walk to change
 * jeepneys (grey); and the last stretch to where you are going (purple).
 * Labels say which is which: where to board, where to get off.
 *
 * The trip shown is the one being looked at in the planner, else the one
 * being travelled. The bands widen as the camera pulls back, like the
 * jeepneys, so the whole trip shows from far.
 */

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Group } from 'three';
import { useRuntimes } from '@/app/runtimeContext';
import { useApp, type TripEnd, type TripLeg, type TripPoint } from '@/app/store';
import { Polyline } from '@/core/geo/polyline';
import type { LocalPoint } from '@/core/geo/projection';
import { aheadOf } from '@/core/geo/routes';
import type { Network } from '@/core/network/network';
import { WALK_TO_STOP_M } from '@/core/network/plan';
import { metres } from '@/ui/phone/format';
import { FLAT_ORDER } from '../map/flatLayers';
import { Labels, type SceneLabel } from './Labels';
import { bandMaterial, widthlessRibbon } from './RouteLine';
import { viewScale } from './viewScale';

const COLOURS = {
  access: '#7c3aed',
  ride: ['#15803d', '#c2410c'],
  change: '#475569',
  from: '#15803d',
  to: '#b91c1c',
};
/** Band and casing widths close up (metres); both widen with the view. */
const BAND_M = 3;
const CASING_M = 5;
/** Along a jeepney's route, a point this often (metres). */
const STEP_M = 10;
/** Label heights above the ground (metres; grow with the view like the pins). */
const PIN_LABEL_Y = 6;
/** Above the stop's own name and its waiting count, which stand at the same place. */
const WAITING_LABEL_Y = 9;
const STOP_LABEL_Y = 4;

interface Piece {
  points: LocalPoint[];
  colour: string;
}

/** Where along route `r` stop `i` is, as a point. */
const stopAt = (network: Network, r: number, i: number): LocalPoint => {
  const route = network.routes[r]!.route;
  const p = route.polyline.pointAt(route.stops[i]!.s);
  return { x: p.x, z: p.z };
};

const middle = (a: LocalPoint, b: LocalPoint) => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
const apart = (a: LocalPoint, b: LocalPoint) => Math.hypot(a.x - b.x, a.z - b.z);
/** On foot within a walk of the stop, else by tricycle (as the planner decides). */
const by = (m: number) => (m <= WALK_TO_STOP_M ? 'Walk' : 'Tricycle');

/** The trip's pieces to draw, and its labels. */
function tripOf(
  network: Network,
  legs: readonly TripLeg[] | null,
  ends: Record<TripPoint, TripEnd | null>,
  /**
   * The way "you" go to the first stop, once the trip is taken: drawn
   * instead of the planner's straight line; `streets` false while it is
   * still straight, the streets not in yet.
   */
  firstWay: { points: readonly LocalPoint[]; streets: boolean } | null,
): { pieces: Piece[]; labels: SceneLabel[] } {
  const pieces: Piece[] = [];
  const labels: SceneLabel[] = [];
  const label = (text: string, kind: string, p: LocalPoint, y: number) =>
    labels.push({ text, kind, x: p.x, y, z: p.z, scaleWithView: true });
  if (ends.home) label(`Home: ${ends.home.name}`, 'trip-from', ends.home.at, PIN_LABEL_Y);
  if (ends.to) label(`To: ${ends.to.name}`, 'trip-to', ends.to.at, PIN_LABEL_Y);
  if (!legs || legs.length === 0) return { pieces, labels };

  legs.forEach((leg, k) => {
    const route = network.routes[leg.route]!.route;
    const board = stopAt(network, leg.route, leg.board);
    const alight = stopAt(network, leg.route, leg.alight);
    // To the stop: from where the trip starts, or from the jeepney before.
    const before =
      k === 0
        ? (leg.from ?? ends.home?.at)
        : stopAt(network, legs[k - 1]!.route, legs[k - 1]!.alight);
    if (k === 0 && firstWay && firstWay.points.length > 1) {
      const way = firstWay.points;
      let m = 0;
      for (let i = 1; i < way.length; i++) m += apart(way[i - 1]!, way[i]!);
      pieces.push({ points: [...way], colour: COLOURS.access });
      label(
        `${leg.approachMode === 'tricycle' ? 'Tricycle' : 'Walk'} ${metres(m)} ` +
          (firstWay.streets ? 'by the streets' : '(straight line until the streets load)'),
        'trip-way',
        way[Math.floor(way.length / 2)]!,
        1,
      );
    } else if (before && apart(before, board) > 1) {
      const m = apart(before, board);
      pieces.push({ points: [before, board], colour: k === 0 ? COLOURS.access : COLOURS.change });
      label(
        k === 0
          ? `${leg.approachMode === 'tricycle' ? 'Tricycle' : by(m)} ~${metres(m)} (straight line)`
          : `Walk ${metres(m)} to change`,
        'trip-way',
        middle(before, board),
        1,
      );
    }
    // The ride, along the route from stop to stop (round the loop's end if need be).
    const from = route.stops[leg.board]!.s;
    const length = aheadOf(route, from, route.stops[leg.alight]!.s);
    const L = route.polyline.length;
    const ride: LocalPoint[] = [];
    for (let d = 0; d < length; d += STEP_M) {
      const p = route.polyline.pointAt((from + d) % L);
      ride.push({ x: p.x, z: p.z });
    }
    ride.push(alight);
    if (ride.length > 1) pieces.push({ points: ride, colour: COLOURS.ride[k % 2]! });
    label(
      `${k === 0 ? 'From (waiting area)' : 'Change here'}: ${route.stops[leg.board]!.name} · ${route.name}`,
      'trip-board',
      board,
      WAITING_LABEL_Y,
    );
    label(`Get off: ${route.stops[leg.alight]!.name}`, 'trip-alight', alight, STOP_LABEL_Y);
  });

  // The last stretch, to where you are going.
  const last = legs[legs.length - 1]!;
  const off = stopAt(network, last.route, last.alight);
  if (ends.to && apart(off, ends.to.at) > 1) {
    const m = apart(off, ends.to.at);
    pieces.push({ points: [off, ends.to.at], colour: COLOURS.access });
    label(`${by(m)} ${metres(m)}`, 'trip-way', middle(off, ends.to.at), 1);
  }
  return { pieces, labels };
}

/** A pin standing on the ground, growing with the view like the jeepneys. */
function Pin({ at, colour }: { at: LocalPoint; colour: string }) {
  const pin = useRef<Group>(null);
  useFrame((state) => {
    if (pin.current) pin.current.scale.setScalar(viewScale(state));
  });
  return (
    <group ref={pin} position={[at.x, 0, at.z]}>
      <mesh position={[0, 3.2, 0]}>
        <sphereGeometry args={[1.1, 20, 14]} />
        <meshStandardMaterial color={colour} />
      </mesh>
      <mesh position={[0, 1.4, 0]}>
        <coneGeometry args={[0.6, 2.4, 16]} />
        <meshStandardMaterial color={colour} />
      </mesh>
    </group>
  );
}

/** One piece of the trip: a band with a white casing. */
function Band({ piece }: { piece: Piece }) {
  const geometry = useMemo(() => widthlessRibbon(new Polyline(piece.points)), [piece]);
  const casing = useMemo(() => bandMaterial('#ffffff', CASING_M), []);
  const fill = useMemo(() => bandMaterial(piece.colour, BAND_M), [piece.colour]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => casing.material.dispose(), [casing]);
  useEffect(() => () => fill.material.dispose(), [fill]);
  useFrame((state) => {
    const k = viewScale(state);
    casing.width.value = CASING_M * k;
    fill.width.value = BAND_M * k;
  });
  return (
    <group>
      <mesh geometry={geometry} material={casing.material} renderOrder={FLAT_ORDER.tripCasing} />
      <mesh geometry={geometry} material={fill.material} renderOrder={FLAT_ORDER.tripFill} />
    </group>
  );
}

/** Seconds between looking for the rider's way (it changes when the streets come in). */
const WAY_EVERY_MS = 1000;

/** The way the commuter app's own rider goes to their first stop, once the trip is taken. */
function useFirstWay(on: boolean): { points: LocalPoint[]; streets: boolean } | null {
  const { twin } = useRuntimes();
  const query = useApp((s) => s.commuter);
  const [streets, setStreets] = useState(false);
  const [way, setWay] = useState<ReadonlyArray<readonly [number, number, number]> | null>(null);
  useEffect(() => {
    if (!on || !('passenger' in query)) {
      setWay(null);
      return;
    }
    const look = () => {
      const r = twin.crew.passengers.get(query.passenger);
      setWay(r?.way ?? null);
      setStreets(!r?.offStreets);
    };
    look();
    const id = window.setInterval(look, WAY_EVERY_MS);
    return () => window.clearInterval(id);
  }, [on, query, twin]);
  return useMemo(
    () => (way ? { points: way.map(([x, , z]) => ({ x, z })), streets } : null),
    [way, streets],
  );
}

export function TripPlanLayer({ network }: { network: Network }) {
  const preview = useApp((s) => s.tripPreview);
  const taken = useApp((s) => s.tripLegs);
  const leg = useApp((s) => s.tripLeg);
  const ends = useApp((s) => s.tripEnds);
  const legs = preview ?? taken;
  const firstWay = useFirstWay(!preview && !!taken && leg === 0);
  const { pieces, labels } = useMemo(
    () => tripOf(network, legs, ends, firstWay),
    [network, legs, ends, firstWay],
  );
  return (
    <>
      {pieces.map((p, i) => (
        <Band key={i} piece={p} />
      ))}
      {ends.home && <Pin at={ends.home.at} colour={COLOURS.from} />}
      {ends.to && <Pin at={ends.to.at} colour={COLOURS.to} />}
      <Labels labels={labels} />
    </>
  );
}
