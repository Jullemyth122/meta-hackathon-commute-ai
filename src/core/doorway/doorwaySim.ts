/**
 * Ground truth for the sensor lab: one parked jeepney at a stop, riders
 * walking up, boarding, taking a seat, and later standing up and leaving.
 * The counting pipeline never reads this; it only sees what the simulated
 * cabin camera sees.
 *
 * Geometry is the jeepney's ground frame (metres, +X toward the front). The
 * rear entrance is at layout.doorX; crossing it is what boarding means.
 */

import type { Rng } from '../math/random';
import {
  newRiderPose,
  RiderMotion,
  seatedAt,
  type CabinLayout,
  type RiderPose,
  type Seat,
} from '../people/riderMotion';

/** Where riders come from and go to on the road behind the jeepney. */
const STREET_X = -6.2;
/** Single file through the entrance: next boarder starts this long after the last. */
const BOARD_GAP_S = 1.4;
const ALIGHT_GAP_S = 1.1;
/**
 * People getting off pass the rear entrance at least this far apart: it is
 * one person wide. Someone seated near the door would otherwise catch up
 * with the person ahead and both would be in the doorway at once.
 */
const DOOR_SPACING_S = 1.0;
/** A boarder this close to the door blocks people from getting off (and vice versa). */
const DOOR_ZONE_X = -2.3;

export type Direction = 'board' | 'alight';

export interface DoorRider {
  id: number;
  seat: number;
  mode: 'boarding' | 'seated' | 'alighting';
  /** Present while boarding or alighting. */
  motion: RiderMotion | null;
  /** Seconds since the current motion started. */
  t: number;
  /** Whether the rider is past the rear entrance (truth for counting). */
  inside: boolean;
  /** Per-rider build, so the detector sees varied box sizes. */
  heightScale: number;
}

export class DoorwaySim {
  readonly riders: DoorRider[] = [];
  /** True counts. The pipeline's estimate is compared against these. */
  readonly truth = { inside: 0, boarded: 0, alighted: 0 };
  autoStops = true;

  private readonly rng: Rng;
  private readonly layout: CabinLayout;
  private readonly seats: readonly Seat[];
  private queue: Direction[] = [];
  private nextId = 1;
  private sinceSpawnS = Infinity;
  private untilNextStopS = 4;
  private clockS = 0;
  /** When the last person getting off passes (or will pass) the door, on clockS. */
  private lastAlightAtDoorS = -Infinity;
  private readonly scratch = newRiderPose();

  constructor(rng: Rng, layout: CabinLayout, seats: readonly Seat[], initialSeated = 8) {
    this.rng = rng;
    this.layout = layout;
    this.seats = seats;
    for (let i = 0; i < Math.min(initialSeated, seats.length); i++) {
      this.riders.push(this.newRider(this.freeSeat()!, 'seated'));
      this.truth.inside++;
    }
  }

  request(direction: Direction, count = 1): void {
    for (let i = 0; i < count; i++) this.queue.push(direction);
  }

  step(dtS: number): void {
    if (this.autoStops) this.scheduleStops(dtS);
    this.clockS += dtS;
    this.sinceSpawnS += dtS;
    this.trySpawn();

    for (let i = this.riders.length - 1; i >= 0; i--) {
      const r = this.riders[i]!;
      if (!r.motion) continue;
      r.t += dtS;
      const inside = this.pose(r, this.scratch).x > this.layout.doorX;
      if (inside !== r.inside) {
        r.inside = inside;
        if (inside) {
          this.truth.inside++;
          this.truth.boarded++;
        } else {
          this.truth.inside--;
          this.truth.alighted++;
        }
      }
      if (r.t >= r.motion.duration) {
        if (r.mode === 'boarding') {
          r.mode = 'seated';
          r.motion = null;
        } else {
          this.riders.splice(i, 1);
        }
      }
    }
  }

  pose(r: DoorRider, out: RiderPose): RiderPose {
    return r.motion ? r.motion.poseAt(r.t, out) : seatedAt(this.layout, this.seats[r.seat]!, out);
  }

  private newRider(seat: number, mode: DoorRider['mode']): DoorRider {
    return {
      id: this.nextId++,
      seat,
      mode,
      motion: null,
      t: 0,
      inside: mode === 'seated',
      heightScale: 0.92 + this.rng() * 0.14,
    };
  }

  /** A random free seat, or null when the jeepney is full. */
  private freeSeat(): number | null {
    const taken = new Set(this.riders.map((r) => r.seat));
    const free = this.seats.map((_, i) => i).filter((i) => !taken.has(i));
    return free.length ? free[Math.floor(this.rng() * free.length)]! : null;
  }

  /** A jeepney stop: a few people get off, then a few get on. */
  private scheduleStops(dtS: number): void {
    this.untilNextStopS -= dtS;
    if (this.untilNextStopS > 0) return;
    this.untilNextStopS = 14 + this.rng() * 8;
    this.request('alight', Math.floor(this.rng() * 3));
    this.request('board', Math.floor(this.rng() * 4));
  }

  /**
   * Rear entrances are single file, and people let others off first: a
   * boarder waits while anyone is getting off, and nobody gets off while a
   * boarder is still at the door.
   */
  private trySpawn(): void {
    const next = this.queue[0];
    if (!next) return;
    if (next === 'board') {
      if (this.riders.some((r) => r.mode === 'alighting')) return;
      if (this.sinceSpawnS < BOARD_GAP_S) return;
      const seat = this.freeSeat();
      this.queue.shift();
      if (seat === null) return; // full: they wait for the next jeepney
      const r = this.newRider(seat, 'boarding');
      const lane = (this.rng() - 0.5) * 0.4;
      r.motion = RiderMotion.boarding(this.layout, this.seats[seat]!, STREET_X, lane);
      this.riders.push(r);
    } else {
      const atDoor = this.riders.some(
        (r) => r.mode === 'boarding' && this.pose(r, this.scratch).x < DOOR_ZONE_X,
      );
      if (atDoor || this.sinceSpawnS < ALIGHT_GAP_S) return;
      const seated = this.riders.filter((r) => r.mode === 'seated');
      this.queue.shift();
      if (!seated.length) return; // nobody left to get off
      const r = seated[Math.floor(this.rng() * seated.length)]!;
      const lane = (this.rng() - 0.5) * 0.4;
      const motion = RiderMotion.alighting(this.layout, this.seats[r.seat]!, STREET_X, lane);
      // Stay seated a moment if standing up now would reach the door right
      // behind the previous person (a negative t holds the motion's first pose).
      const reachDoor = motion.timeToCross(this.layout.doorX);
      const wait = Math.max(0, this.lastAlightAtDoorS + DOOR_SPACING_S - (this.clockS + reachDoor));
      this.lastAlightAtDoorS = this.clockS + wait + reachDoor;
      r.mode = 'alighting';
      r.t = -wait;
      r.motion = motion;
    }
    this.sinceSpawnS = 0;
  }
}
