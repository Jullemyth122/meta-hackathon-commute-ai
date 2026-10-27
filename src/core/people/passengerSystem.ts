import type { FleetSim, FleetVehicle, PassengerService } from '../fleet/fleetSim';
import { createRng } from '../math/random';
import { newRiderPose, RiderMotion, type RiderPose, type Seat } from './riderMotion';
import { arrivalPoint, queuePoint, stopPoint, STOP_CURB_M } from './stopLayout';

export type PassengerPhase =
  'approaching' | 'waiting' | 'boarding' | 'seated' | 'alighting' | 'walking' | 'arrived';
export interface VehiclePose {
  x: number;
  z: number;
  heading: number;
}
type Point3 = readonly [number, number, number];

/** Vehicle geometry adapter: journey logic has no fixed seat count or door orientation. */
export interface PassengerLayout {
  seats: readonly Seat[];
  seatOrder: readonly number[];
  seated(seat: number, out: RiderPose): RiderPose;
  board(seat: number, start: Point3): RiderMotion;
  alight(seat: number): RiderMotion;
  isInside(pose: RiderPose): boolean;
}

export interface Passenger {
  id: number;
  originStop: number;
  destinationStop: number;
  direction: 1 | -1;
  phase: PassengerPhase;
  vehicleId: number | null;
  lastVehicleId: number | null;
  seat: number | null;
  slot: number;
  inside: boolean;
  /** World pose outside; vehicle-local while boarding, riding or alighting. */
  pose: RiderPose;
  motion: RiderMotion | null;
  t: number;
  history: { phase: PassengerPhase; at: number }[];
}

interface Service {
  stop: number;
  exits: number[];
  boarders: number[] | null;
  active: number | null;
  terminal: boolean;
  turned: boolean;
}

export class PassengerSystem implements PassengerService {
  readonly passengers = new Map<number, Passenger>();
  readonly services = new Map<number, Service>();
  private readonly rng = createRng(53);
  private nextId = 1;
  private clock = 0;
  private readonly vehiclePose: VehiclePose = { x: 0, z: 0, heading: 0 };
  private readonly scratch = newRiderPose();
  private readonly arrivals = new Map<string, number>();

  constructor(
    readonly fleet: FleetSim,
    readonly layouts: readonly PassengerLayout[],
    private readonly poseAt: (vehicle: number, out: VehiclePose) => VehiclePose,
  ) {
    fleet.vehicles.forEach((v) => {
      const layout = layouts[v.id]!;
      v.capacity = layout.seats.length;
      v.occupancy = Math.min(v.occupancy, v.capacity);
      for (let k = 0; k < v.occupancy; k++) {
        const origin = Math.max(
          0,
          Math.min(fleet.route.stops.length - 1, v.nextStop - v.direction),
        );
        const r = this.create(origin, v.direction, 'seated');
        const options = fleet.route.stops
          .map((_, i) => i)
          .filter((i) => (i - v.nextStop) * v.direction >= 0);
        r.destinationStop = options[Math.floor(this.rng() * options.length)]!;
        r.vehicleId = r.lastVehicleId = v.id;
        r.inside = true;
        r.seat = layout.seatOrder[k]!;
        layout.seated(r.seat, r.pose);
      }
    });
    const waiting = [...fleet.waiting];
    fleet.waiting.fill(0);
    waiting.forEach((count, stop) => this.demand(stop, count, true));
    fleet.passengerService = this;
  }

  private create(stop: number, direction: 1 | -1, phase: PassengerPhase): Passenger {
    const options = this.fleet.route.stops
      .map((_, i) => i)
      .filter((i) => (i - stop) * direction > 0);
    const r: Passenger = {
      id: this.nextId++,
      originStop: stop,
      destinationStop: options[Math.floor(this.rng() * options.length)] ?? stop,
      direction,
      phase,
      vehicleId: null,
      lastVehicleId: null,
      seat: null,
      slot: 0,
      inside: false,
      pose: newRiderPose(),
      motion: null,
      t: 0,
      history: [{ phase, at: this.clock }],
    };
    this.passengers.set(r.id, r);
    return r;
  }

  demand(stop: number, count: number, initial = false): void {
    for (let i = 0; i < count && this.fleet.waiting[stop]! < 40; i++) {
      const direction =
        stop === 0
          ? 1
          : stop === this.fleet.route.stops.length - 1
            ? -1
            : this.rng() < 0.5
              ? 1
              : -1;
      const used = new Set(
        [...this.passengers.values()]
          .filter(
            (r) =>
              r.originStop === stop &&
              r.direction === direction &&
              ['approaching', 'waiting', 'boarding'].includes(r.phase),
          )
          .map((r) => r.slot),
      );
      let slot = 0;
      while (used.has(slot)) slot++;
      const r = this.create(stop, direction, initial ? 'waiting' : 'approaching');
      r.slot = slot;
      const target = queuePoint(this.fleet.route, stop, direction, slot);
      if (initial) Object.assign(r.pose, target);
      else {
        const start = stopPoint(this.fleet.route, stop, direction, -8, STOP_CURB_M + 2);
        r.motion = RiderMotion.walking([
          [start.x, 0, start.z],
          [target.x, 0, target.z],
        ]);
        r.motion.poseAt(0, r.pose);
      }
      this.fleet.waiting[stop]!++;
    }
  }

  arrive(vehicle: FleetVehicle, stop: number): void {
    const terminal = stop === 0 || stop === this.fleet.route.stops.length - 1;
    const exits = [...this.passengers.values()].filter(
      (r) =>
        r.vehicleId === vehicle.id &&
        r.phase === 'seated' &&
        (terminal || r.destinationStop === stop),
    );
    exits.sort(
      (a, b) =>
        this.layouts[vehicle.id]!.alight(a.seat!).duration -
        this.layouts[vehicle.id]!.alight(b.seat!).duration,
    );
    this.services.set(vehicle.id, {
      stop,
      exits: exits.map((r) => r.id),
      boarders: null,
      active: null,
      terminal,
      turned: false,
    });
  }

  busy(vehicle: number): boolean {
    return this.services.has(vehicle);
  }

  status(vehicle: number): string {
    const s = this.services.get(vehicle);
    if (!s)
      return this.fleet.vehicles[vehicle]!.currentStop === null
        ? 'Driving'
        : 'Stopped, ready to depart';
    const active = s.active === null ? null : this.passengers.get(s.active);
    if (active?.phase === 'alighting' || s.exits.length) return 'Stopped, passengers getting off';
    if (active?.phase === 'boarding') return 'Stopped, passenger boarding';
    return 'Stopped, waiting for passengers to clear';
  }

  update(dt: number): void {
    this.clock += dt;
    for (const r of this.passengers.values()) {
      if (!r.motion) continue;
      r.t = Math.min(r.t + dt, r.motion.duration);
      r.motion.poseAt(r.t, r.pose);
      if (r.vehicleId !== null) r.inside = this.layouts[r.vehicleId]!.isInside(r.pose);
      if (r.t < r.motion.duration) continue;
      r.motion = null;
      if (r.phase === 'approaching') this.transition(r, 'waiting');
      else if (r.phase === 'boarding') this.transition(r, 'seated');
      else if (r.phase === 'alighting') this.walkAway(r);
      else if (r.phase === 'walking') this.transition(r, 'arrived');
      r.pose.walk = 0;
    }
    for (const v of this.fleet.vehicles) {
      const service = this.services.get(v.id);
      if (service) this.advanceService(v, service);
      v.occupancy = 0;
    }
    for (const r of this.passengers.values()) {
      if (r.vehicleId !== null && r.inside) {
        const v = this.fleet.vehicles[r.vehicleId];
        if (v) v.occupancy++;
      }
    }
  }

  private advanceService(v: FleetVehicle, s: Service): void {
    if (s.active !== null) {
      const r = this.passengers.get(s.active)!;
      if (r.phase === 'boarding' || r.phase === 'alighting') return;
      s.active = null;
    }
    const exiting = s.exits.shift();
    if (exiting !== undefined) {
      const r = this.passengers.get(exiting)!;
      this.transition(r, 'alighting');
      r.motion = this.layouts[v.id]!.alight(r.seat!);
      r.t = 0;
      s.active = r.id;
      return;
    }
    const pose = this.poseAt(v.id, this.vehiclePose);
    if (
      [...this.passengers.values()].some(
        (r) =>
          r.lastVehicleId === v.id &&
          r.phase === 'walking' &&
          Math.hypot(r.pose.x - pose.x, r.pose.z - pose.z) < 7,
      )
    )
      return;
    if (s.terminal && !s.turned) {
      v.direction = v.direction === 1 ? -1 : 1;
      s.turned = true;
    }
    if (s.boarders === null) {
      const seated = [...this.passengers.values()].filter((r) => r.vehicleId === v.id).length;
      s.boarders = [...this.passengers.values()]
        .filter(
          (r) => r.phase === 'waiting' && r.originStop === s.stop && r.direction === v.direction,
        )
        .slice(0, v.capacity - seated)
        .map((r) => r.id);
    }
    let id: number | undefined;
    while ((id = s.boarders.shift()) !== undefined) {
      const r = this.passengers.get(id)!;
      if (r.phase !== 'waiting') continue;
      const taken = new Set(
        [...this.passengers.values()].filter((p) => p.vehicleId === v.id).map((p) => p.seat),
      );
      const seat = this.layouts[v.id]!.seatOrder.find((k) => !taken.has(k));
      if (seat === undefined) break;
      this.poseAt(v.id, pose);
      const dx = r.pose.x - pose.x,
        dz = r.pose.z - pose.z;
      const start: Point3 = [
        dx * Math.cos(pose.heading) - dz * Math.sin(pose.heading),
        0,
        dx * Math.sin(pose.heading) + dz * Math.cos(pose.heading),
      ];
      r.vehicleId = r.lastVehicleId = v.id;
      r.seat = seat;
      this.transition(r, 'boarding');
      r.motion = this.layouts[v.id]!.board(seat, start);
      r.t = 0;
      r.motion.poseAt(0, r.pose);
      this.fleet.waiting[s.stop]!--;
      s.active = r.id;
      return;
    }
    this.services.delete(v.id);
  }

  private walkAway(r: Passenger): void {
    const s = this.services.get(r.vehicleId!)!;
    this.worldPose(r.id, this.scratch);
    Object.assign(r.pose, this.scratch);
    r.vehicleId = null;
    r.seat = null;
    r.inside = false;
    const key = `${s.stop}/${r.direction}`;
    const slot = this.arrivals.get(key) ?? 0;
    this.arrivals.set(key, slot + 1);
    const target = arrivalPoint(this.fleet.route, s.stop, r.direction, slot);
    const rear = stopPoint(this.fleet.route, s.stop, r.direction, -5, STOP_CURB_M);
    r.motion = RiderMotion.walking([
      [r.pose.x, 0, r.pose.z],
      [rear.x, 0, rear.z],
      [target.x, 0, target.z],
    ]);
    r.t = 0;
    this.transition(r, 'walking');
  }

  private transition(r: Passenger, phase: PassengerPhase): void {
    r.phase = phase;
    r.history.push({ phase, at: this.clock });
  }

  forEachRider(vehicle: number, visit: (id: number, pose: RiderPose) => void): void {
    for (const r of this.passengers.values()) if (r.vehicleId === vehicle) visit(r.id, r.pose);
  }

  forEachOutside(visit: (rider: Passenger) => void): void {
    for (const r of this.passengers.values()) if (r.vehicleId === null) visit(r);
  }

  worldPose(id: number, out: RiderPose): RiderPose | null {
    const r = this.passengers.get(id);
    if (!r) return null;
    Object.assign(out, r.pose);
    if (r.vehicleId !== null) {
      const vehicle = this.poseAt(r.vehicleId, this.vehiclePose);
      const c = Math.cos(vehicle.heading),
        s = Math.sin(vehicle.heading);
      out.x = vehicle.x + r.pose.x * c + r.pose.z * s;
      out.z = vehicle.z - r.pose.x * s + r.pose.z * c;
      out.yaw += vehicle.heading;
    }
    return out;
  }
}
