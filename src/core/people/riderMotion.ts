/**
 * How a rider moves through a jeepney, as a timeline of simple segments,
 * after the prototype's animation system (a3sg / a3eval in index.html):
 *
 *   boarding   walk up behind the jeepney → climb onto the rear step
 *              (leading knee up, lean in, hands on the grab poles) → climb
 *              into the cabin, ducking under the door header → walk the
 *              aisle (stooped, the roof is low) → turn to face across the
 *              aisle → back onto the bench and sit down
 *   alighting  the same, reversed: stand up → turn → aisle → step down onto
 *              the step → down to the road → away
 *
 * Coordinates are the jeepney's ground frame: metres, +X toward the front,
 * +Z the left side, y = 0 the road. Pure functions of time, so the sensor lab
 * and the live twin animate the same way and tests can check the poses.
 */

export interface CabinLayout {
  /** Rear entrance plane. Crossing it is what boarding and alighting mean. */
  doorX: number;
  /** Where people stand on the road behind the step. */
  stepOutsideX: number;
  /** First standing spot on the cabin floor. */
  insideX: number;
  floorY: number;
  /** Root height of a seated person (personRig: hips on the cushion). */
  seatedRootY: number;
  /**
   * The boarding step behind the entrance: where a foot lands and its height.
   * Without one, people climb straight from the road to the floor.
   */
  step?: { x: number; y: number };
}

export interface Seat {
  x: number;
  z: number;
  /** Facing across the aisle: +π/2 for the left bench, -π/2 for the right. */
  yaw: number;
  /** Root height seated, when not the cabin's (a raised back bench). */
  y?: number;
  /**
   * A seat facing forward, in a row: where its sitter stands in front of it
   * (along the vehicle) before sitting back into it. Absent for a bench
   * along the wall, sat on from the aisle.
   */
  standX?: number;
}

/**
 * A door in the vehicle's side, on +z (the kerb: modern jeepney, UV
 * Express, bus), and the line people walk along inside from it.
 */
export interface SideDoor {
  /** Middle of the opening, along the vehicle. */
  x: number;
  /** Where boarders stand on the pavement, facing it. */
  outsideZ: number;
  /** Each foothold on the way in, (y, z): steps up, the last on the cabin floor. */
  steps: ReadonlyArray<readonly [number, number]>;
  /** Along the cabin from this door. */
  aisleZ: number;
  /** Ducking under the top of the opening (1 upright). */
  duck: number;
}

/** How people move about a cabin: room to stand, how fast, what they hold. */
export interface CabinStyle {
  floorY: number;
  seatedRootY: number;
  /** Bent under the roof (1 upright) and forward from the hips (radians). */
  stoop: number;
  lean: number;
  /** Along the aisle, and sideways along a row, m/s. */
  aisleMps: number;
  shuffleMps: number;
  /** Hands out to the poles, rails or seat backs (0–1). */
  reach: number;
}

export interface RiderPose {
  x: number;
  y: number;
  z: number;
  /** Three.js yaw (0 = facing +X, the front). */
  yaw: number;
  /** 0 standing … 1 seated. */
  sit: number;
  /** 0 still … 1 walking stride. */
  walk: number;
  /** Stride phase, radians; advances ~5.7 per metre walked. */
  phase: number;
  /** Height multiplier: people duck under the jeepney's low roof. */
  stoop: number;
  /** Upper body leaning forward from the hips, radians. */
  lean: number;
  /** 0..1: how far the climbing leg is raised (knee up) on a step. */
  lift: number;
  /** Which leg climbs: 0 = the +Z-side leg (the right), 1 = the left. */
  liftLeg: 0 | 1;
  /** 0..1: hands reaching forward to the grab poles beside the entrance. */
  reach: number;
}

type Range = readonly [number, number];

interface Segment {
  dur: number;
  from: readonly [number, number, number];
  to: readonly [number, number, number];
  yaw0: number;
  yaw1: number;
  sit0: number;
  sit1: number;
  walking: boolean;
  /** Constant-speed motion without a walking stride (first-mile vehicle). */
  travelling?: boolean;
  inside: boolean;
  /** Present on a step: which leg climbs it. */
  climbLeg?: 0 | 1;
  lean?: Range;
  stoop?: Range;
  reach?: Range;
}

/** A commuter's walk: brisk, they have somewhere to be. */
const WALK_MPS = 1.4;
const AISLE_MPS = 0.85;
const STEP_S = 0.6;
/** One step of a two-step climb (road → step → floor). */
const CLIMB_S = 0.62;
const TURN_S = 0.4;
const SIT_S = 0.85;
const STRIDE_PER_M = 5.7;
const STOOP = 0.88;
/** Ducking under the door header (2.04 m) on the way in or out. */
const DUCK = 0.84;
/** Bent forward under the low cabin roof, and while climbing. */
const AISLE_LEAN = 0.12;
const CLIMB_LEAN = 0.28;
/** Where people walk in the aisle, and how far out from the bench they turn. */
const AISLE_Z = 0;
const TURN_Z_FRACTION = 0.35;

function walk(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  mps: number,
  inside: boolean,
  yaw = Math.atan2(-(to[2] - from[2]), to[0] - from[0]),
): Segment {
  const len = Math.hypot(to[0] - from[0], to[2] - from[2]);
  return {
    dur: Math.max(0.05, len / mps),
    from,
    to,
    yaw0: yaw,
    yaw1: yaw,
    sit0: 0,
    sit1: 0,
    walking: true,
    inside,
  };
}

/** One climb (up or down) from `from` to `to`, facing `yaw`, leading with `leg`. */
function climb(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  yaw: number,
  leg: 0 | 1,
  ranges: { lean: Range; stoop: Range; reach: Range },
): Segment {
  return {
    dur: CLIMB_S,
    from,
    to,
    yaw0: yaw,
    yaw1: yaw,
    sit0: 0,
    sit1: 0,
    walking: false,
    inside: true,
    climbLeg: leg,
    ...ranges,
  };
}

/** The climb between the road at stepOutsideX and the cabin floor at insideX. */
function climbIn(L: CabinLayout): Segment[] {
  const road = [L.stepOutsideX, 0, AISLE_Z] as const;
  const floor = [L.insideX, L.floorY, AISLE_Z] as const;
  if (!L.step) {
    return [
      { ...walk(road, floor, WALK_MPS, true, 0), dur: STEP_S, stoop: [1, STOOP], lean: [0, 0.1] },
    ];
  }
  const step = [L.step.x, L.step.y, AISLE_Z] as const;
  return [
    climb(road, step, 0, 0, { lean: [0, CLIMB_LEAN], stoop: [1, 0.95], reach: [0.2, 1] }),
    climb(step, floor, 0, 1, {
      lean: [CLIMB_LEAN, CLIMB_LEAN],
      stoop: [0.95, DUCK],
      reach: [1, 0.4],
    }),
  ];
}

/** The same climb, down and out: floor → step → road, facing the street. */
function climbOut(L: CabinLayout): Segment[] {
  const road = [L.stepOutsideX, 0, AISLE_Z] as const;
  const floor = [L.insideX, L.floorY, AISLE_Z] as const;
  if (!L.step) {
    return [
      {
        ...walk(floor, road, WALK_MPS, true, Math.PI),
        dur: STEP_S,
        stoop: [STOOP, 1],
        lean: [0.1, 0],
      },
    ];
  }
  const step = [L.step.x, L.step.y, AISLE_Z] as const;
  return [
    climb(floor, step, Math.PI, 1, {
      lean: [CLIMB_LEAN, 0.2],
      stoop: [DUCK, 0.95],
      reach: [0.4, 1],
    }),
    climb(step, road, Math.PI, 0, { lean: [0.2, 0], stoop: [0.95, 1], reach: [1, 0] }),
  ];
}

/** Boarding from `startX` on the road (lateral offset `lane`) to `seat`. */
function boardingSegments(L: CabinLayout, seat: Seat, startX: number, lane: number): Segment[] {
  const turnZ = seat.z * TURN_Z_FRACTION;
  const out: Segment[] = [];
  if (startX < L.stepOutsideX - 0.05)
    out.push(walk([startX, 0, lane], [L.stepOutsideX, 0, AISLE_Z], WALK_MPS, false, 0));
  out.push(...climbIn(L));
  out.push({
    ...walk([L.insideX, L.floorY, AISLE_Z], [seat.x, L.floorY, turnZ], AISLE_MPS, true, 0),
    lean: [CLIMB_LEAN, AISLE_LEAN],
    stoop: [DUCK, STOOP],
    reach: [0.4, 0],
  });
  out.push({
    ...walk([seat.x, L.floorY, turnZ], [seat.x, L.floorY, turnZ], 1, true, 0),
    dur: TURN_S,
    yaw1: seat.yaw,
    walking: false,
    lean: [AISLE_LEAN, 0.06],
  });
  out.push({
    dur: SIT_S,
    from: [seat.x, L.floorY, turnZ],
    to: [seat.x, L.seatedRootY, seat.z],
    yaw0: seat.yaw,
    yaw1: seat.yaw,
    sit0: 0,
    sit1: 1,
    walking: false,
    inside: true,
    lean: [0.06, 0],
  });
  return out;
}

/** Alighting from `seat` out to `endX` on the road: stand, turn, aisle, step down, away. */
function alightingSegments(L: CabinLayout, seat: Seat, endX: number, lane: number): Segment[] {
  const turnZ = seat.z * TURN_Z_FRACTION;
  const out: Segment[] = [
    {
      dur: SIT_S,
      from: [seat.x, L.seatedRootY, seat.z],
      to: [seat.x, L.floorY, turnZ],
      yaw0: seat.yaw,
      yaw1: seat.yaw,
      sit0: 1,
      sit1: 0,
      walking: false,
      inside: true,
      lean: [0, 0.06],
    },
    {
      ...walk([seat.x, L.floorY, turnZ], [seat.x, L.floorY, turnZ], 1, true, seat.yaw),
      dur: TURN_S,
      yaw1: Math.PI,
      walking: false,
      lean: [0.06, AISLE_LEAN],
    },
    {
      ...walk([seat.x, L.floorY, turnZ], [L.insideX, L.floorY, AISLE_Z], AISLE_MPS, true, Math.PI),
      lean: [AISLE_LEAN, CLIMB_LEAN],
      stoop: [STOOP, DUCK],
      reach: [0, 0.4],
    },
    ...climbOut(L),
  ];
  if (endX < L.stepOutsideX - 0.05)
    out.push(walk([L.stepOutsideX, 0, AISLE_Z], [endX, 0, lane], WALK_MPS, false, Math.PI));
  return out;
}

/** Facing into the vehicle from a +z door, and out of it. */
const FACING_IN = Math.PI / 2;
const FACING_OUT = -Math.PI / 2;

/** Hold still at `at` while turning from yaw0 to yaw1. */
function turnAt(
  at: readonly [number, number, number],
  yaw0: number,
  yaw1: number,
  C: CabinStyle,
  inside: boolean,
): Segment {
  return {
    ...walk(at, at, 1, inside, yaw0),
    dur: TURN_S,
    yaw1,
    walking: false,
    stoop: [inside ? C.stoop : 1, inside ? C.stoop : 1],
    lean: [inside ? C.lean : 0, inside ? C.lean : 0],
    reach: [inside ? C.reach : 0, inside ? C.reach : 0],
  };
}

/** Where a sitter stands before sitting in `seat` (and after getting up). */
function standingSpot(seat: Seat, C: CabinStyle): [number, number, number] {
  return seat.standX !== undefined
    ? [seat.standX, C.floorY, seat.z]
    : [seat.x, C.floorY, seat.z * TURN_Z_FRACTION];
}

/**
 * In through a side door to `seat`: along the pavement to the door, turn to
 * it, up each step (ducking under the opening, a hand on the poles), along
 * the aisle, then into the seat: a bench along the wall from the aisle, or
 * a row seat by shuffling along the row facing forward and sitting back.
 */
function sideDoorBoarding(
  D: SideDoor,
  C: CabinStyle,
  seat: Seat,
  start: readonly [number, number, number],
): Segment[] {
  const out: Segment[] = [];
  const outside = [D.x, 0, D.outsideZ] as const;
  // Out onto the pavement first if standing in the road beside the vehicle.
  let at: readonly [number, number, number] = [start[0], 0, start[2]];
  if (at[2] < D.outsideZ - 0.3) {
    const kerb = [at[0], 0, D.outsideZ] as const;
    out.push(walk(at, kerb, WALK_MPS, false));
    at = kerb;
  }
  if (Math.hypot(outside[0] - at[0], outside[2] - at[2]) > 0.05) {
    const w = walk(at, outside, WALK_MPS, false);
    out.push(w);
    out.push(turnAt(outside, w.yaw1, FACING_IN, C, false));
  } else out.push(turnAt(outside, FACING_IN, FACING_IN, C, false));
  let from: readonly [number, number, number] = outside;
  D.steps.forEach(([y, z], k) => {
    const to = [D.x, y, z] as const;
    out.push(
      climb(from, to, FACING_IN, (k % 2) as 0 | 1, {
        lean: [k === 0 ? 0 : CLIMB_LEAN, CLIMB_LEAN],
        stoop: [k === 0 ? 1 : D.duck, D.duck],
        reach: [k === 0 ? 0.2 : 1, 1],
      }),
    );
    from = to;
  });
  // Up: into the aisle, and along it to the seat.
  const inside = (
    a: readonly [number, number, number],
    b: readonly [number, number, number],
    mps: number,
    yaw?: number,
  ): Segment => ({
    ...walk(a, b, mps, true, yaw),
    stoop: [C.stoop, C.stoop],
    lean: [C.lean, C.lean],
    reach: [C.reach, C.reach],
  });
  const aisle = [D.x, C.floorY, D.aisleZ] as const;
  if (Math.hypot(aisle[0] - from[0], aisle[2] - from[2]) > 0.05) {
    out.push({
      ...inside(from, aisle, C.aisleMps),
      stoop: [D.duck, C.stoop],
      lean: [CLIMB_LEAN, C.lean],
    });
    from = aisle;
  }
  const spot = standingSpot(seat, C);
  if (seat.standX !== undefined) {
    const rowEnd = [seat.standX, C.floorY, D.aisleZ] as const;
    if (Math.abs(rowEnd[0] - from[0]) > 0.05) out.push(inside(from, rowEnd, C.aisleMps));
    const facing = out[out.length - 1]!.yaw1;
    out.push(turnAt(rowEnd, facing, 0, C, true));
    // Sideways along the row, facing forward, to the seat.
    if (Math.abs(spot[2] - rowEnd[2]) > 0.05) out.push(inside(rowEnd, spot, C.shuffleMps, 0));
  } else {
    out.push(inside(from, spot, C.aisleMps));
    out.push(turnAt(spot, out[out.length - 1]!.yaw1, seat.yaw, C, true));
  }
  out.push({
    dur: SIT_S,
    from: spot,
    to: [seat.x, seat.y ?? C.seatedRootY, seat.z],
    yaw0: seat.standX !== undefined ? 0 : seat.yaw,
    yaw1: seat.standX !== undefined ? 0 : seat.yaw,
    sit0: 0,
    sit1: 1,
    walking: false,
    inside: true,
    stoop: [C.stoop, 1],
    lean: [C.lean, 0],
    reach: [C.reach, 0],
  });
  return out;
}

/** Out of `seat` through a side door: the boarding the other way round, facing the way they go. */
function sideDoorAlighting(D: SideDoor, C: CabinStyle, seat: Seat): Segment[] {
  const out: Segment[] = [];
  const yawSeated = seat.standX !== undefined ? 0 : seat.yaw;
  const spot = standingSpot(seat, C);
  const inside = (
    a: readonly [number, number, number],
    b: readonly [number, number, number],
    mps: number,
    yaw?: number,
  ): Segment => ({
    ...walk(a, b, mps, true, yaw),
    stoop: [C.stoop, C.stoop],
    lean: [C.lean, C.lean],
    reach: [C.reach, C.reach],
  });
  out.push({
    dur: SIT_S,
    from: [seat.x, seat.y ?? C.seatedRootY, seat.z],
    to: spot,
    yaw0: yawSeated,
    yaw1: yawSeated,
    sit0: 1,
    sit1: 0,
    walking: false,
    inside: true,
    stoop: [1, C.stoop],
    lean: [0, C.lean],
    reach: [0, C.reach],
  });
  let from: readonly [number, number, number] = spot;
  const aisle = [D.x, C.floorY, D.aisleZ] as const;
  if (seat.standX !== undefined) {
    const rowEnd = [seat.standX, C.floorY, D.aisleZ] as const;
    if (Math.abs(rowEnd[2] - from[2]) > 0.05) out.push(inside(from, rowEnd, C.shuffleMps, 0));
    from = rowEnd;
  }
  // Turn to the door along the aisle, and walk there.
  const toward = Math.abs(aisle[0] - from[0]) > 0.05 || Math.abs(aisle[2] - from[2]) > 0.05;
  if (toward) {
    const w = inside(from, aisle, C.aisleMps);
    out.push(turnAt(from, yawSeated, w.yaw0, C, true));
    out.push(w);
    from = aisle;
  }
  // To the top of the steps, facing out, and down them.
  const top = D.steps[D.steps.length - 1]!;
  const head = [D.x, top[0], top[1]] as const;
  out.push(turnAt(from, out[out.length - 1]!.yaw1, FACING_OUT, C, true));
  if (Math.hypot(head[0] - from[0], head[2] - from[2]) > 0.05) {
    out.push({
      ...inside(from, head, C.aisleMps, FACING_OUT),
      stoop: [C.stoop, D.duck],
      lean: [C.lean, CLIMB_LEAN],
    });
    from = head;
  }
  const down = [...D.steps.slice(0, -1)].reverse().map(([y, z]) => [D.x, y, z] as const);
  down.push([D.x, 0, D.outsideZ]);
  down.forEach((to, k) => {
    const last = k === down.length - 1;
    out.push(
      climb(from, to, FACING_OUT, (k % 2) as 0 | 1, {
        lean: [CLIMB_LEAN, last ? 0 : CLIMB_LEAN],
        stoop: [D.duck, last ? 1 : D.duck],
        reach: [1, last ? 0 : 1],
      }),
    );
    from = to;
  });
  return out;
}

const total = (segs: readonly Segment[]) => segs.reduce((t, s) => t + s.dur, 0);

/** Shortest-way angle interpolation. */
function lerpAngle(a: number, b: number, t: number): number {
  const d = ((((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return a + d * t;
}

const smooth = (u: number) => u * u * (3 - 2 * u);
const clamp01 = (u: number) => Math.min(1, Math.max(0, u));
const lerp = (r: Range | undefined, fallback: number, u: number) =>
  r ? r[0] + (r[1] - r[0]) * u : fallback;

function evaluate(segs: readonly Segment[], t: number, out: RiderPose): RiderPose {
  let start = 0;
  let travelled = 0;
  for (const s of segs) {
    const len = Math.hypot(s.to[0] - s.from[0], s.to[2] - s.from[2]);
    if (t < start + s.dur || s === segs[segs.length - 1]) {
      const u = clamp01((t - start) / s.dur);
      // Walking is constant speed; everything else eases in and out.
      const e = s.walking || s.travelling ? u : smooth(u);
      // On a step the body moves forward first and rises (or drops) once the
      // climbing foot is planted: height trails the forward motion.
      const ey = s.climbLeg === undefined ? e : smooth(clamp01((u - 0.3) / 0.55));
      out.x = s.from[0] + (s.to[0] - s.from[0]) * e;
      out.y = s.from[1] + (s.to[1] - s.from[1]) * ey;
      out.z = s.from[2] + (s.to[2] - s.from[2]) * e;
      out.yaw = lerpAngle(s.yaw0, s.yaw1, e);
      out.sit = s.sit0 + (s.sit1 - s.sit0) * e;
      out.walk = s.walking ? 1 : 0;
      out.phase = (travelled + len * e) * STRIDE_PER_M;
      out.stoop = lerp(s.stoop, s.inside ? STOOP + (1 - STOOP) * out.sit : 1, e);
      out.lean = lerp(s.lean, 0, e);
      out.reach = lerp(s.reach, 0, e);
      // The climbing knee comes up, plants on the step, and the leg straightens.
      out.lift = s.climbLeg === undefined ? 0 : Math.sin(Math.PI * clamp01(u / 0.8));
      out.liftLeg = s.climbLeg ?? 0;
      return out;
    }
    start += s.dur;
    if (s.walking) travelled += len;
  }
  return out;
}

/** A rider's movement for one trip through the door. */
export class RiderMotion {
  readonly duration: number;
  private readonly segs: Segment[];

  private constructor(segs: Segment[]) {
    this.segs = segs;
    this.duration = total(segs);
  }

  static boarding(L: CabinLayout, seat: Seat, startX: number, lane = 0): RiderMotion {
    return new RiderMotion(boardingSegments(L, seat, startX, lane));
  }

  static alighting(L: CabinLayout, seat: Seat, endX: number, lane = 0): RiderMotion {
    return new RiderMotion(alightingSegments(L, seat, endX, lane));
  }

  /** Follow an explicit approach behind the vehicle before using its door. */
  static boardingVia(
    L: CabinLayout,
    seat: Seat,
    points: readonly (readonly [number, number, number])[],
  ): RiderMotion {
    const approach = points.slice(1).map((p, i) => walk(points[i]!, p, WALK_MPS, false));
    return new RiderMotion([...approach, ...boardingSegments(L, seat, L.stepOutsideX, 0)]);
  }

  /** In through a side door (modern jeepney, UV Express, bus) to `seat`, from `start` on the pavement. */
  static throughSideDoor(
    door: SideDoor,
    cabin: CabinStyle,
    seat: Seat,
    start: readonly [number, number, number],
  ): RiderMotion {
    return new RiderMotion(sideDoorBoarding(door, cabin, seat, start));
  }

  /** Out of `seat` and down through a side door, to the pavement in front of it. */
  static outOfSideDoor(door: SideDoor, cabin: CabinStyle, seat: Seat): RiderMotion {
    return new RiderMotion(sideDoorAlighting(door, cabin, seat));
  }

  /** Ground-space path, also used after detaching from a stopped vehicle. */
  static walking(points: readonly (readonly [number, number, number])[]): RiderMotion {
    return new RiderMotion(points.slice(1).map((p, i) => walk(points[i]!, p, WALK_MPS, false)));
  }

  /** Simulated tricycle first mile: 18 km/h, seated until the stop. */
  static tricycle(points: readonly (readonly [number, number, number])[]): RiderMotion {
    return new RiderMotion(
      points.slice(1).map((p, i) => ({
        ...walk(points[i]!, p, 5, false),
        walking: false,
        travelling: true,
        sit0: 1,
        sit1: 1,
      })),
    );
  }

  /** Ground-path metres left at the same position as poseAt(t). */
  remainingDistance(t: number): number {
    let start = 0;
    let remaining = 0;
    for (const s of this.segs) {
      const u = clamp01((t - start) / s.dur);
      const e = s.walking || s.travelling ? u : smooth(u);
      remaining += Math.hypot(s.to[0] - s.from[0], s.to[2] - s.from[2]) * (1 - e);
      start += s.dur;
    }
    return remaining;
  }

  /**
   * Seconds until the rider first passes the plane x = `x` (e.g. the rear
   * entrance), or the full duration if they never do.
   */
  timeToCross(x: number): number {
    const p = newRiderPose();
    const startSide = Math.sign(this.poseAt(0, p).x - x);
    for (let t = 0; t <= this.duration; t += 1 / 50) {
      if (Math.sign(this.poseAt(t, p).x - x) !== startSide) return t;
    }
    return this.duration;
  }

  /** Pose at `t` seconds since the motion started (clamped to its ends). */
  poseAt(t: number, out: RiderPose): RiderPose {
    return evaluate(this.segs, Math.max(0, t), out);
  }
}

/** Pose of someone sitting still in `seat`. */
export function seatedAt(L: CabinLayout, seat: Seat, out: RiderPose): RiderPose {
  out.x = seat.x;
  out.y = L.seatedRootY;
  out.z = seat.z;
  out.yaw = seat.yaw;
  out.sit = 1;
  out.walk = 0;
  out.phase = 0;
  out.stoop = 1;
  out.lean = 0;
  out.lift = 0;
  out.liftLeg = 0;
  out.reach = 0;
  return out;
}

export const newRiderPose = (): RiderPose => ({
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
  sit: 0,
  walk: 0,
  phase: 0,
  stoop: 1,
  lean: 0,
  lift: 0,
  liftLeg: 0,
  reach: 0,
});
