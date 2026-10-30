/**
 * Out-and-back spurs cut from a route's road path.
 *
 * The network's paths were routed between the 2015 GTFS stops (OSRM, see
 * scripts/build-network.mjs). A stop on the far side of a divided road, or a
 * few metres up a side street, made the router drive past it, U-turn and come
 * back, then U-turn again to carry on: a jeepney following that path goes
 * round in a small circle that no real one drives. Here every such reversal
 * is found and the out-and-back removed, the stops put back on the road.
 *
 * A spur: around a sharp turn (more than REVERSAL_RAD between the
 * TURN_SPAN_M before a point and after it), a stretch of path whose two ends
 * are close: within RETRACE_M (the other carriageway, or the same street)
 * and within CHORD_SHARE of the path between them, MIN_SPUR_M to MAX_SPUR_M
 * of it. That is an out-and-back (a U-turn to a stop and back) or a
 * squiggle (crossing an intersection to the other carriageway and back). A
 * real road never is: a 90° corner's ends are 71% of its length apart, a
 * U-shaped bend's 64%. The real turnarounds, at the route's terminals, are
 * kept.
 */

import { Polyline } from '../geo/polyline';
import type { LocalPoint } from '../geo/projection';

/** Sampling step for finding reversals (metres). */
const STEP_M = 5;
/** A sharp turn: more than this between the way in and the way out (radians, ~60°)… */
const REVERSAL_RAD = 1.05;
/** …measured over this much path either side (metres). */
const TURN_SPAN_M = 20;
/** A spur's two ends are within this of each other (a divided road's far side)… */
const RETRACE_M = 45;
/** …and within this share of the path between them. */
const CHORD_SHARE = 0.45;
/** Shorter than this is a corner or road-width jitter, not a spur; longer is a real dead-end leg. */
const MIN_SPUR_M = 40;
const MAX_SPUR_M = 1500;
/** Within this of a terminal, a turnaround is the route's own: kept. */
const TERMINAL_GUARD_M = 400;
/**
 * A hook: a vertex where the path doubles back by more than HOOK_RAD with a
 * segment under HOOK_M beside it (vertex noise, or where a cut's two ends
 * meet). Dropped, so a jeepney does not twitch there.
 */
const HOOK_RAD = 2.1;
const HOOK_M = 15;

/** Drop hook vertices until none is left (the ends are kept). */
function withoutHooks(points: LocalPoint[]): LocalPoint[] {
  let pts = points;
  for (let changed = true; changed && pts.length > 2;) {
    changed = false;
    const keep: LocalPoint[] = [pts[0]!];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = keep[keep.length - 1]!;
      const b = pts[i]!;
      const c = pts[i + 1]!;
      const inX = b.x - a.x;
      const inZ = b.z - a.z;
      const outX = c.x - b.x;
      const outZ = c.z - b.z;
      const turn = Math.abs(Math.atan2(inX * outZ - inZ * outX, inX * outX + inZ * outZ));
      const short = Math.min(Math.hypot(inX, inZ), Math.hypot(outX, outZ)) < HOOK_M;
      if (turn > HOOK_RAD && short) changed = true;
      else keep.push(b);
    }
    keep.push(pts[pts.length - 1]!);
    pts = keep;
  }
  return pts;
}

export interface Despurred {
  points: LocalPoint[];
  /** Each stop's new along-route distance, in order. */
  stopS: number[];
  /** How many spurs were cut, and how much road they made jeepneys drive (metres). */
  spurs: number;
  removedM: number;
}

/**
 * Cut the spurs of `points` (a loop or line path), keeping the turnarounds
 * within TERMINAL_GUARD_M of `terminalS`, and move each stop (at `stopS`
 * along the old path) onto the new one, in the same order.
 */
export function removeSpurs(
  points: readonly LocalPoint[],
  stopS: readonly number[],
  terminalS: readonly number[],
): Despurred {
  const old = new Polyline(points);
  const L = old.length;
  const n = Math.floor(L / STEP_M) + 1;
  const at = (i: number) => old.pointAt(Math.min(L, i * STEP_M));
  const sample = Array.from({ length: n }, (_, i) => at(i));
  const guarded = (s: number) =>
    terminalS.some((t) => {
      const d = Math.abs(t - s);
      return Math.min(d, L - d) < TERMINAL_GUARD_M;
    });
  const dist = (a: LocalPoint, b: LocalPoint) => Math.hypot(a.x - b.x, a.z - b.z);

  // Find the spurs: [from, to] along the old path, cut out between them.
  const cuts: Array<[number, number]> = [];
  const span = Math.round(TURN_SPAN_M / STEP_M);
  for (let i = span; i < n - span; i++) {
    const a = sample[i - span]!;
    const b = sample[i]!;
    const c = sample[i + span]!;
    const inX = b.x - a.x;
    const inZ = b.z - a.z;
    const outX = c.x - b.x;
    const outZ = c.z - b.z;
    const turn = Math.abs(Math.atan2(inX * outZ - inZ * outX, inX * outX + inZ * outZ));
    if (turn < REVERSAL_RAD || guarded(i * STEP_M)) continue;
    // The widest stretch either side of here whose ends are close (see above).
    let k = 0;
    const most = Math.floor(MAX_SPUR_M / 2 / STEP_M);
    for (let j = 1; j <= most && i - j >= 0 && i + j < n; j++) {
      const chord = dist(sample[i - j]!, sample[i + j]!);
      if (chord < Math.min(RETRACE_M, CHORD_SHARE * 2 * j * STEP_M)) k = j;
      else if (chord > 3 * RETRACE_M) break; // the two ways have parted
    }
    if (2 * k * STEP_M < MIN_SPUR_M || k >= most) continue;
    const from = (i - k) * STEP_M;
    const to = (i + k) * STEP_M;
    const previous = cuts[cuts.length - 1];
    if (previous && from <= previous[1]) previous[1] = Math.max(previous[1], to);
    else cuts.push([from, to]);
    i += k;
  }

  // The new path: the old vertices outside the cuts, joined across each one.
  const inCut = (s: number) => cuts.some(([a, b]) => s > a && s < b);
  const out: LocalPoint[] = [];
  let c = 0;
  for (let v = 0; v < points.length; v++) {
    const s = old.cumulative[v]!;
    while (c < cuts.length && cuts[c]![1] <= s) {
      // Crossing a cut: its two ends, then on.
      const [a, b] = cuts[c]!;
      const pa = old.pointAt(a);
      const pb = old.pointAt(b);
      out.push({ x: pa.x, z: pa.z }, { x: pb.x, z: pb.z });
      c++;
    }
    if (!inCut(s)) out.push({ x: points[v]!.x, z: points[v]!.z });
  }
  const clean = withoutHooks(
    out.filter((p, i) => i === 0 || Math.hypot(p.x - out[i - 1]!.x, p.z - out[i - 1]!.z) > 0.01),
  );
  const line = new Polyline(clean);

  // Each stop onto the new path, in order: the nearest point a little past the last.
  const moved: number[] = [];
  let prevOld = 0;
  let prevNew = 0;
  for (const s of stopS) {
    const gap = Math.max(0, s - prevOld);
    const p = old.pointAt(Math.min(L, Math.max(0, s)));
    const hit = line.project(p, [prevNew, Math.min(line.length, prevNew + gap + 60)]);
    const ns = Math.max(prevNew, hit.s);
    moved.push(ns);
    prevOld = s;
    prevNew = ns;
  }

  return {
    points: clean,
    stopS: moved,
    spurs: cuts.length,
    removedM: L - line.length,
  };
}
