/**
 * The simulated part of the hybrid twin: other jeepneys on the same route,
 * riders appearing at stops, boarding and alighting.
 *
 * Deliberately simple and deterministic (seeded). It is a backdrop that makes
 * the one GPS-driven jeepney meaningful, not a traffic model. Anything that
 * claims accuracy (counts, ETAs) has to be validated against field data first.
 */

import { BAY_APART_M, type Forecourt } from '../fuel/stations';
import { VEHICLES, type FleetKind } from '../vehicles/specs';
import { stopRoles } from '../vehicles/stops';
import { passesNear } from '../geo/near';
import { aheadOf, isTerminal, stopsAhead, type Route } from '../geo/routes';
import { createRng, poisson, type Rng } from '../math/random';
import { flowSpeedKmh } from '../network/flow';
import {
  DAY_ENDS_S,
  expectedArrivals,
  HOME_FROM_S,
  HOME_TO_S,
  LAST_RIDERS_S,
  SERVICE_FROM_S,
  TERMINAL_KEPT_SHARE,
  type SimulationScenario,
} from './scenario';

export type Livery = 'red' | 'yellow' | 'green';
/**
 * Out for the day; on the last trip (on to the next terminal, still taking
 * riders on the way, as they all ride to it at most); driving back from
 * there, empty, not stopping, to where it is kept along the route (an
 * owner's home, an operator's garage); or parked for the night, there or
 * at the terminal.
 */
export type Duty = 'service' | 'homebound' | 'returning' | 'parked';

/** One closed day of the fleet's ledger: each jeepney's totals, by index. */
export interface DayRecord {
  /** 1 for the day the simulation started. */
  day: number;
  totals: DayTotals[];
}

export interface FleetVehicle {
  id: number;
  plate: string;
  livery: Livery;
  /** A traditional jeepney, or one of the few modern jeepneys, UV Express vans and buses. */
  kind: FleetKind;
  /** Along-route distance, metres. */
  s: number;
  direction: 1 | -1;
  cruiseMps: number;
  speedMps: number;
  /** Seconds left at the current stop. */
  dwellS: number;
  capacity: number;
  /** True number of riders (the simulation knows; sensors would estimate). */
  occupancy: number;
  /** Index of the next stop in the direction of travel. */
  nextStop: number;
  /** Stop being served; cleared only when passenger movements are finished. */
  currentStop: number | null;
  /**
   * Metres moved over from its lane towards the middle of the road, while
   * overtaking (0 otherwise).
   */
  laneShiftM: number;
  /**
   * The driver, 0–1: how readily they overtake a slower jeepney. Most
   * drivers sit behind; a few are out the moment they are held up.
   */
  boldness: number;
  /** Today's running totals: what the driver's earnings are worked out from. */
  day: DayTotals;
  duty: Duty;
  /**
   * Where it is kept overnight, metres along the route. An owner-driver's
   * home, or the operator's garage of a boundary driver who collects it
   * there: just off the road, away from the terminals; it pulls out there in
   * the morning and drives back there at night. Or a terminal (see depot).
   */
  garageS: number;
  /** The driver owns the jeepney: no boundary to pay, their own upkeep instead. */
  owner: boolean;
  /**
   * The terminal (route.stops index) where the operator keeps it, for a
   * boundary driver who collects it there; null when kept along the route.
   */
  depot: number | null;
  /** Diesel in the tank (litres): it pulls in at a station on the way when low. */
  tankL: number;
  /** Its tank, full (litres): not every jeepney's is the same. */
  tankCapacityL: number;
  /** Knocking off tonight, its driver fills up on the way home (decided each night). */
  topUpTonight: boolean;
  /** The station it is going to fill up at (`s`: where it turns in), or is in now. */
  refuel: { s: number; name: string; at: FuelStopAt } | null;
  /** Seconds of filling up left (0 when not at a pump). */
  refuelLeftS: number;
  /** Turned in at a station, off the road: where it is in the forecourt (null on the road). */
  yard: FuelYard | null;
}

/** A jeepney in a station's forecourt. */
export interface FuelYard {
  stop: FuelStopAt;
  /** Its lane of pumps (0 nearest the road). */
  bay: number;
  /** Metres into the forecourt, from where it turned in. */
  u: number;
  /** Cars at its pump before it (one at the pump, one waiting), and seconds left for the one at it. */
  cars: number;
  carLeftS: number;
  /** In line before it for the pump: cars and jeepneys. */
  ahead: number;
  /** Filled up: on its way out. */
  full: boolean;
}

/** Jeepney `id`'s share (0-1) of the TANK_MIN_L to TANK_MAX_L range, fixed by `seed`. */
function tankShare(seed: number, id: number): number {
  let h = Math.imul(seed ^ 0x74616e6b, 0x85ebca6b) ^ Math.imul(id + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 12)) >>> 0) / 4_294_967_296;
}

/**
 * A fuel station a jeepney can pull in at: along-route position, name, side
 * of the road, and its way through the forecourt (see forecourtAlong).
 */
export interface FuelStopAt extends Forecourt {
  s: number;
  name: string;
  /** For a jeepney driving towards higher s; jeepneys keep right. */
  side: 'left' | 'right';
}

/** Where the pumps are, metres into `stop`'s forecourt: the exit's turn and a jeepney's half-length short of its end. */
export function pumpAt(stop: Forecourt): number {
  // Several lanes of pumps: the turn into a further one is over a gap before them.
  return baysOf(stop) > 1 ? yardTurn(stop) + YARD_GAP_M : stop.lengthM - yardTurn(stop) - 4;
}

/**
 * Lanes of pumps a jeepney can use: more than one only on a forecourt long
 * enough for the turns in and out (where a jeepney crosses the other lanes)
 * to be a gap clear of the pumps.
 */
export function baysOf(stop: Forecourt): number {
  return stop.lengthM >= 2 * (YARD_TURN_M + YARD_GAP_M) ? stop.bays : 1;
}

/** The turn in (and out) takes this much road, metres. */
function yardTurn(stop: Forecourt): number {
  return Math.min(YARD_TURN_M, stop.lengthM / 3);
}

/**
 * Metres off the lane `u` metres into `stop`'s forecourt, in pump lane
 * `bay`: easing off the road over the turn in, along the pumps, and back
 * onto it over the turn out.
 */
export function yardShift(stop: Forecourt, bay: number, u: number): number {
  const turn = yardTurn(stop);
  const t = Math.max(0, Math.min(1, u / turn, (stop.lengthM - u) / turn));
  return (stop.depthM + bay * BAY_APART_M) * t * t * (3 - 2 * t);
}

/** A jeepney's running totals since the day started. */
export interface DayTotals {
  /** Metres driven. */
  metres: number;
  /** Seconds standing with the engine on (at stops, at terminals, in queues). */
  idleS: number;
  /** Fares collected, centavos (paid as riders get off). */
  fareCentavos: number;
  riders: number;
  /** Driven by its owner that day (no boundary; their own upkeep). */
  owner: boolean;
  /** Diesel: in the tank when the day began, burnt, bought, and how many times. */
  tankStartL: number;
  fuelUsedL: number;
  fuelBoughtL: number;
  refuels: number;
  /** In the tank when the day closed (set as it closes). */
  tankEndL?: number;
}

export interface PassengerService {
  demand(stop: number, count: number): void;
  /** Serve `stop`; `dropOffOnly` when stuck in a queue short of it (riders get off and walk). */
  arrive(vehicle: FleetVehicle, stop: number, dropOffOnly?: boolean): void;
  /** Waiting on at `stop` after serving it: take on whoever has come since (nobody gets off). */
  pickUp(vehicle: FleetVehicle, stop: number): void;
  /** The day is over: anyone still waiting goes home some other way. */
  endOfDay?(): void;
  busy(vehicle: number): boolean;
  /** Whether anyone gets off at `stop`, or anyone there can get on (or it is a terminal). */
  wantsStop(vehicle: FleetVehicle, stop: number): boolean;
  /** Whether anyone on board gets off at `stop`. */
  dropsAt(vehicle: FleetVehicle, stop: number): boolean;
}

export interface FleetConfig {
  count: number;
  capacity: number;
  seed: number;
  /** Riders arriving per stop per minute. */
  demandPerStopPerMin: number;
  scenario?: SimulationScenario;
  /** Drivers overtake slower jeepneys while moving (default true). */
  overtaking?: boolean;
  /** What each vehicle is (see fleetKinds); all traditional jeepneys when not given. */
  kinds?: readonly FleetKind[];
  /** Drivers hang back and wait at stops behind a jeepney too close in front (default true). */
  hangBack?: boolean;
  /**
   * A working day: out in the morning, home at night, a ledger closed every
   * day (see SERVICE_FROM_S). Needs `scenario` for the clock.
   */
  dayCycle?: boolean;
  /** The stations along the route (asked for when a jeepney runs low): it fills up there. */
  fuelStops?: () => readonly FuelStopAt[];
}

export const DEFAULT_FLEET: FleetConfig = {
  count: 10,
  capacity: 22,
  seed: 11,
  demandPerStopPerMin: 0.8,
};

const MIN_GAP_M = 14;
/** A loaded jeepney pulling away, and comfortable braking (m/s²). */
const ACCEL_MPS2 = 1.2;
const BRAKE_MPS2 = 1.6;
/** Speed for the last metre into a stop, so the braking curve never stalls short. */
const CREEP_MPS = 0.8;
const TERMINAL_DWELL_S = 20;
/**
 * A jeepney held up in a queue this close to its stop loads where it is:
 * riders walk the few metres to it rather than wait for the one in front to
 * leave. Two jeepneys behind the one at the stop, at the minimum gap.
 */
const STOP_ZONE_M = 30;
/**
 * Stuck in a queue this far before their stop, riders getting off there do
 * not wait: they call "para", get off, and walk. The jeepney still stops
 * at the stop itself afterwards, for whoever is waiting.
 */
const ALIGHT_ZONE_M = 90;
/** Overtaking a stopped jeepney: swing out this far (a jeepney's width and a gap)… */
const PASS_SHIFT_M = 2.4;
/** …starting this far before it, back in this far after it… */
const PASS_WINDOW_AHEAD_M = 22;
const PASS_WINDOW_BEHIND_M = 10;
/** …at this sideways speed, and past at most this many in a row. */
const LANE_SHIFT_MPS = 1.5;
const PASS_AT_MOST = 3;
/**
 * Overtaking a slower moving jeepney. A driver held up within CATCH_UP_M
 * by one going at least SLOWER_BY_MPS under their own pace may pull out,
 * if the road is straight for STRAIGHT_M, their own stop is not that
 * close, and there is ROOM_AHEAD_M past it to cut back into. They speed up
 * by PASS_BOOST_MPS, cut in MERGE_AHEAD_M ahead of it, and give up after
 * PASS_GIVE_UP_S. Then they settle for about CALM_S (less if bolder).
 */
const CATCH_UP_M = 40;
const SLOWER_BY_MPS = 1.5;
const STRAIGHT_M = 120;
const STRAIGHT_RAD = 0.25;
const OWN_STOP_CLEAR_M = 150;
const ROOM_AHEAD_M = 60;
const PASS_BOOST_MPS = 2.5;
const PASS_TOP_MPS = 13;
const MERGE_AHEAD_M = MIN_GAP_M + 8;
const PASS_GIVE_UP_S = 25;
const CALM_S = 60;
/** Chance per second of pulling out, for the boldest driver (scaled by boldness²). */
const PULL_OUT_PER_S = 0.5;
/** Closer than this along the road, two jeepneys (7.5 m long) are side by side. */
const ALONGSIDE_M = 9;
/**
 * The traditional jeepney's length, which the gaps above are for (metres).
 * Longer vehicles (a 12 m bus) keep half their extra length more from each
 * other and count as alongside further apart; a shorter van, less.
 */
const JEEPNEY_LENGTH_M = 6.9;
/** Parked: this far out from its lane (off the road, in a yard or driveway beside it)… */
const PARKED_OFF_M = 4.2;
/** …this far from the next one parked there… */
const PARKED_GAP_M = 1.5;
/** …and at a terminal, the row back from the stop by this much (metres). */
const PARKED_BEHIND_STOP_M = 25;
const lengthOf = (kind: FleetKind) =>
  kind === 'jeepney' ? JEEPNEY_LENGTH_M : VEHICLES[kind].lengthM;
/** One further out and this much further behind is coming up: wait before moving out. */
const COMING_UP_M = 12;
/**
 * Swung out this far, a jeepney (about 2 m wide) clears one in the lane: only
 * then may it drive on past it. Until then it brakes for it like any other.
 */
const SWUNG_OUT_M = 2.1;
/**
 * Hanging back (nag-aabang): a driver close behind another slows to pick up
 * the riders the one in front has not reached yet, rather than follow it and
 * find every stop empty. Closer than this share of the even spacing, at this
 * share of their pace. It is what keeps a route's jeepneys spread out
 * instead of in platoons.
 */
const HANG_BACK_SHARE = 0.4;
const HANG_BACK_PACE = 0.6;
/**
 * Waiting at a stop for the same reason: at an ordinary stop for up to
 * ABANG_S while the one in front is closer than HANG_BACK_SHARE of the
 * spacing. At a terminal, the pila: the dispatcher holds it until the one
 * before is DISPATCH_SHARE of the spacing away, and on a working day
 * (dayCycle) the head of the line loads until PILA_FILL of the seats are
 * taken; either for up to PILA_WAIT_S. Riders who come meanwhile get on.
 * When riders are few, the line grows and jeepneys stand in it rather than
 * drive round near-empty, as at a real terminal.
 */
const ABANG_S = 20;
const DISPATCH_SHARE = 0.75;
const PILA_FILL = 0.9;
/** How long the head of a terminal's line waits to fill: 2 to 5 minutes, a new draw each time. */
const PILA_WAIT_MIN_S = 120;
const PILA_WAIT_MAX_S = 300;
/**
 * With this many lined up behind, the dispatcher sends the head out after
 * LINE_DISPATCH_S at most once loaded, full or not: the line keeps moving.
 */
const LONG_LINE = 3;
const LINE_DISPATCH_S = 15;
/** Drivers set out over this long from SERVICE_FROM_S, at a new time each day (seconds). */
const SET_OUT_OVER_S = 60 * 60;
/** A home or garage along the route is at least this far from a terminal (metres). */
const HOME_CLEAR_M = 800;
/**
 * The route passing within this of a home or garage (metres) is a way home:
 * at night they drive to whichever such pass comes first, the short way,
 * not round the whole loop to the spot they set out from.
 */
const HOME_ROAD_M = 80;
/**
 * Diesel: each jeepney's own tank, TANK_MIN_L to TANK_MAX_L (an assumption
 * for traditional jeepneys), burnt as the profit model has it
 * (MOVING_KM_PER_L moving, IDLE_L_PER_H standing with the engine on). The
 * driver pulls in at the next station on their side of the road when below
 * REFUEL_BELOW of a tank, or when what is left would not reach the station
 * after it (with RANGE_MARGIN for traffic): nobody passes the last station
 * they could reach. Knocking off for the night, TOP_UP_SHARE of drivers
 * below TOP_UP_BELOW fill up on the way home (each night, a draw of their
 * own); whatever is left carries into the next day. On the first morning,
 * NIGHT_FILLED_SHARE of tanks were filled the night before (90-100%), the
 * rest anywhere from LOWEST_START to 85%.
 *
 * At the station a jeepney turns off the road into the forecourt and drives
 * along it at YARD_MPS, to the pumps of the lane with the shortest line
 * (bays: one, or more on a deep forecourt), stopping YARD_GAP_M behind any
 * jeepney in front. BUSY_SHARE of the time a car is at that pump first (two,
 * SECOND_CAR_SHARE of those), for CAR_MIN_S to CAR_MAX_S each. Filling up
 * takes HANDLING_MIN_S to HANDLING_MAX_S (nozzle, cap, paying the
 * attendant) plus the litres at PUMP_L_PER_MIN, engine off, and never under
 * REFUEL_MIN_S. Full, it drives on to the exit and back onto the road once
 * nobody is coming.
 */
const TANK_MIN_L = 40;
const TANK_MAX_L = 60;
const MOVING_KM_PER_L = 6;
const IDLE_L_PER_H = 0.8;
const REFUEL_BELOW = 0.25;
const RANGE_MARGIN = 1.5;
/** Stations looked for this far ahead, when going for diesel or checking it would last (metres). */
const STATION_LOOK_M = 30_000;
const TOP_UP_SHARE = 0.5;
const TOP_UP_BELOW = 0.6;
const NIGHT_FILLED_SHARE = 0.45;
const LOWEST_START = 0.2;
const YARD_MPS = 2.5;
const YARD_GAP_M = 9;
/** The turn off the road into a forecourt (and back out) takes at most this much road (metres). */
const YARD_TURN_M = 9;
const BUSY_SHARE = 0.3;
const SECOND_CAR_SHARE = 0.35;
const CAR_MIN_S = 90;
const CAR_MAX_S = 180;
/** A car waiting for a pump stands this far behind the one at it (metres). */
export const CAR_GAP_M = 6.5;
const HANDLING_MIN_S = 60;
const HANDLING_MAX_S = 90;
const PUMP_L_PER_MIN = 35;
const REFUEL_MIN_S = 120;
/** A jeepney low on diesel with no station near enough looks again this often (seconds). */
const FUEL_LOOK_S = 30;
/** A boundary driver joins the back of the terminal's line if it is within this of the kerb. */
const LINE_REACH_M = 1500;
/** Pulling out of (or into) the side of the road at home: this far off the lane (metres). */
const KERBSIDE_M = 3;
/** While waiting, look for newcomers to board this often (seconds). */
const REBOARD_EVERY_S = 5;
/**
 * A terminal draws this many times the riders of an ordinary stop: every
 * trip starts there, and it is where the malls and transfers are.
 */
const TERMINAL_DEMAND = 3;
/** The day starts with this much demand already waiting (about half a headway). */
const START_WAITING_S = 300;
const LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ';

function plate(rng: Rng): string {
  const letter = () => LETTERS[Math.floor(rng() * LETTERS.length)];
  const digits = String(Math.floor(rng() * 10_000)).padStart(4, '0');
  return `${letter()}${letter()}${letter()} ${digits}`;
}

export class FleetSim {
  elapsedS = 0;
  generatedDemand = 0;
  passengerService: PassengerService | null = null;
  readonly vehicles: FleetVehicle[];
  /** Riders waiting at each stop (route.stops order). */
  readonly waiting: number[];
  readonly route: Route;
  private readonly rng: Rng;
  private readonly demandRng: Rng;
  /** Each stop's share of the route's riders (terminals draw more). */
  /** Each stop's share of the route's riders (terminals draw more). */
  readonly demandShare: number[];
  private readonly cfg: FleetConfig;
  private readonly lanes: [FleetVehicle[], FleetVehicle[]] = [[], []];
  private readonly leaders: Array<FleetVehicle | null> = [];
  /** The jeepney directly behind each one (for finishing an overtake). */
  private readonly followers: Array<FleetVehicle | null> = [];
  /** The even spacing of each direction's jeepneys (metres), from the last indexLeaders. */
  private readonly spacing: [number, number] = [Infinity, Infinity];
  /** Seconds each jeepney has waited at its stop for the one in front to get away. */
  private readonly heldS: number[] = [];
  /** Jeepneys letting riders off in a queue, before reaching the stop itself. */
  private readonly dropOffOnly = new Set<number>();
  /** Overtakes under way: passer id → the jeepney being passed, and since when. */
  private readonly overtakes = new Map<number, { of: number; sinceS: number }>();
  /** When each driver may next think about overtaking (elapsedS). */
  private readonly calmUntil: number[] = [];
  /** Drivers' choices: a stream of their own, so riders and plates replay the same. */
  private readonly driverRng: Rng;
  private scanLeaders = false;
  /** Day 1 is the day the simulation started; every closed day is in history. */
  dayNumber = 1;
  readonly history: DayRecord[] = [];
  /** Days since the epoch at which the current ledger day started (see DAY_ENDS_S). */
  private ledgerDay: number;
  /** For each jeepney kept along the route: every place the route passes it (see HOME_ROAD_M). */
  private readonly homeSpots: number[][] = [];
  /** When each jeepney low on diesel next looks for a station ahead (elapsedS). */
  private readonly fuelLookAt: number[] = [];
  /** How long the head of a terminal's line waits to fill this time (seconds). */
  private readonly pilaWaitS: number[] = [];
  /** Driven home already today: parked until tomorrow. */
  private readonly doneToday: boolean[] = [];
  /** Traffic now: the share of a clear-road pace the jeepneys can make. */
  private traffic = 1;

  /** Riders a day on the route (the scenario's), or 0 without a scenario. */
  get dailyTrips(): number {
    return this.cfg.scenario?.dailyTrips ?? 0;
  }

  constructor(route: Route, cfg: FleetConfig = DEFAULT_FLEET) {
    this.route = route;
    this.cfg = cfg;
    this.rng = createRng(cfg.seed);
    // Fleet size must not change the demand experiment for the same seed.
    this.demandRng = createRng(cfg.seed ^ 0x51ed270b);
    this.driverRng = createRng(cfg.seed ^ 0x2c1b3c6d);
    // Riders turn up where its vehicles take them on (a UV Express route: at
    // its terminals only), more at the terminals.
    const fleetKindsHere: FleetKind[] = [...new Set(cfg.kinds ?? ['jeepney' as const])];
    const weights = route.stops.map((_, i): number =>
      !fleetKindsHere.some((k) => stopRoles(route, k).loads[i])
        ? 0
        : isTerminal(route, i)
          ? TERMINAL_DEMAND
          : 1,
    );
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    this.demandShare = weights.map((w) => w / total);
    // Started while jeepneys run: the riders of the last few minutes are
    // waiting. Before the day's first riders (or after its last), nobody is.
    const startedAt = this.startTimeOfDay(cfg);
    const riding = !cfg.dayCycle || (startedAt >= SERVICE_FROM_S && startedAt < LAST_RIDERS_S);
    const waitingNow = !riding
      ? 0
      : cfg.scenario
        ? expectedArrivals(cfg.scenario, 0, START_WAITING_S)
        : (cfg.demandPerStopPerMin * route.stops.length * START_WAITING_S) / 60;
    this.waiting = this.demandShare.map((share) => poisson(this.demandRng, waitingNow * share));

    const L = route.polyline.length;
    this.ledgerDay = Math.floor((this.clockS - DAY_ENDS_S) / 86_400);
    const now = this.timeOfDay;
    const ownerShare = cfg.scenario?.ownerShare ?? 0;
    // Each kind's own terminals (a bus's are not the jeepneys': core/vehicles/stops.ts).
    const depotsOf = (kind: FleetKind) => {
      const own = stopRoles(route, kind).terminal.flatMap((t, i) => (t ? [i] : []));
      return own.length > 0 ? own : [0];
    };
    // Boundary drivers' garages: a stream of their own, so the other draws replay the same.
    const garageRng = createRng(cfg.seed ^ 0x7f4a7c15);
    let atTerminals = 0;
    this.vehicles = Array.from({ length: cfg.count }, (_, i) => {
      // On a loop everyone drives the same way round; on a line, alternate.
      const direction: 1 | -1 = route.loop || i % 2 === 0 ? 1 : -1;
      const s = ((i + 0.5) / cfg.count) * L;
      // 25–36 km/h on a clear road; a van a little quicker, a bus a little slower.
      const kind = cfg.kinds?.[i] ?? 'jeepney';
      const cruise = (7 + this.rng() * 3) * (kind === 'uv' ? 1.08 : kind === 'bus' ? 0.95 : 1);
      // An owner keeps it at home, somewhere along the route away from the
      // terminals; a boundary driver collects it from the operator, at a
      // terminal or at a garage along the route (TERMINAL_KEPT_SHARE).
      const owner = this.driverRng() < ownerShare;
      const atTerminal = !owner && garageRng() < TERMINAL_KEPT_SHARE;
      const depots = depotsOf(kind);
      const depot = atTerminal ? depots[atTerminals++ % depots.length]! : null;
      const rng = owner ? this.driverRng : garageRng;
      let garageS = depot === null ? rng() * L : route.stops[depot]!.s;
      for (let tries = 0; depot === null && tries < 20 && !this.awayFromTerminals(garageS); tries++)
        garageS = rng() * L;
      // Its own tank size, fixed by its number (no draw from the shared stream).
      const tankCapacityL = TANK_MIN_L + (TANK_MAX_L - TANK_MIN_L) * tankShare(this.cfg.seed, i);
      // In the tank the first morning: filled last night, or whatever was left.
      const night = this.driverRng();
      const tankL =
        tankCapacityL *
        (night < NIGHT_FILLED_SHARE
          ? 0.9 + (0.1 * night) / NIGHT_FILLED_SHARE
          : LOWEST_START +
            ((0.85 - LOWEST_START) * (night - NIGHT_FILLED_SHARE)) / (1 - NIGHT_FILLED_SHARE));
      this.homeSpots[i] =
        depot === null
          ? passesNear(route.polyline, route.polyline.pointAt(garageS), HOME_ROAD_M)
          : [];
      this.doneToday[i] = false;
      // Started during the working day: already out on the road. Before its
      // morning departure (or after knocking off): parked where it is kept.
      const out = !cfg.dayCycle || (now >= this.outAt(i) + 600 && now < this.homeAt(i));
      return {
        id: i,
        plate: plate(this.rng),
        livery: (['red', 'yellow', 'green'] as const)[i % 3]!,
        kind,
        s,
        direction,
        cruiseMps: cruise,
        speedMps: cruise,
        dwellS: 0,
        capacity: cfg.capacity,
        occupancy: Math.floor(this.rng() * cfg.capacity * 0.6),
        nextStop: this.nextStopIndex(s, direction),
        currentStop: null,
        laneShiftM: 0,
        boldness: this.driverRng(),
        day: {
          metres: 0,
          idleS: 0,
          fareCentavos: 0,
          riders: 0,
          owner,
          tankStartL: tankL,
          fuelUsedL: 0,
          fuelBoughtL: 0,
          refuels: 0,
        },
        duty: out ? 'service' : 'parked',
        garageS,
        owner,
        depot,
        tankL,
        tankCapacityL,
        topUpTonight: false,
        refuel: null,
        refuelLeftS: 0,
        yard: null,
        ...(out
          ? {}
          : {
              s: garageS,
              occupancy: 0,
              speedMps: 0,
              nextStop: this.nextStopIndex(garageS, direction),
            }),
      };
    });
  }

  /** Seconds since midnight when the simulation starts (before `this` is set up). */
  private startTimeOfDay(cfg: FleetConfig): number {
    const sc = cfg.scenario;
    const s = sc ? sc.startHour * 3600 + (sc.startOffsetS ?? 0) : 7 * 3600;
    return ((s % 86_400) + 86_400) % 86_400;
  }

  /** Simulated clock: seconds since midnight of the first day. */
  get clockS(): number {
    const sc = this.cfg.scenario;
    return (sc ? sc.startHour * 3600 + (sc.startOffsetS ?? 0) : 7 * 3600) + this.elapsedS;
  }

  /** Seconds since midnight, today. */
  get timeOfDay(): number {
    return ((this.clockS % 86_400) + 86_400) % 86_400;
  }

  /** Every jeepney parked: the night, when nothing moves. */
  get allParked(): boolean {
    return this.vehicles.every((v) => v.duty === 'parked');
  }

  /** A driver's own draw for today, 0–1: a different morning and night every day. */
  private today(id: number, salt: number): number {
    let h = Math.imul(this.cfg.seed ^ 0x6a09e667, 0x85ebca6b) ^ Math.imul(id + 1, 0xc2b2ae35);
    h = Math.imul(h ^ Math.imul(this.dayNumber + salt, 0x27d4eb2f), 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    return ((h ^ (h >>> 12)) >>> 0) / 4_294_967_296;
  }

  /** When driver `id` sets out today, and when they knock off (seconds since midnight). */
  private outAt(id: number): number {
    return SERVICE_FROM_S + this.today(id, 1) * SET_OUT_OVER_S;
  }
  private homeAt(id: number): number {
    return HOME_FROM_S + this.today(id, 2) * (HOME_TO_S - HOME_FROM_S);
  }

  /**
   * Where parked `v` stands (drawn, not driven): off the road beside where it
   * is kept, PARKED_OFF_M out from the lane, in a row back from it with any
   * others kept there; at a terminal, the row starts PARKED_BEHIND_STOP_M
   * back from the stop (clear of the people waiting there).
   */
  parkedSpot(v: FleetVehicle): { s: number; shift: number } {
    let k = 0;
    for (const o of this.vehicles)
      if (o !== v && o.duty === 'parked' && o.id < v.id && this.apartS(o.garageS, v.garageS) < 1)
        k++;
    const back =
      k * (lengthOf(v.kind) + PARKED_GAP_M) + (v.depot !== null ? PARKED_BEHIND_STOP_M : 0);
    const L = this.route.polyline.length;
    const s = v.garageS - v.direction * back;
    return {
      s: this.route.loop ? ((s % L) + L) % L : Math.max(0, Math.min(L, s)),
      shift: PARKED_OFF_M,
    };
  }

  /** Whether `stop` is one of `v`'s terminals (a bus's and a UV Express's are their own). */
  private terminalFor(v: FleetVehicle, stop: number): boolean {
    return stopRoles(this.route, v.kind).terminal[stop] === true;
  }

  /** Whether along-route position `s` is at least HOME_CLEAR_M from every terminal. */
  private awayFromTerminals(s: number): boolean {
    return this.route.stops.every((st) => !st.terminal || this.apartS(s, st.s) >= HOME_CLEAR_M);
  }

  /** Close the day's ledger at DAY_ENDS_S: every jeepney's totals into history. */
  private closeDays(): void {
    const ledger = Math.floor((this.clockS - DAY_ENDS_S) / 86_400);
    while (this.ledgerDay < ledger) {
      this.history.push({
        day: this.dayNumber,
        totals: this.vehicles.map((v) => ({ ...v.day, tankEndL: v.tankL })),
      });
      // The diesel left carries over: the new day starts with it in the tank.
      for (const v of this.vehicles)
        v.day = {
          metres: 0,
          idleS: 0,
          fareCentavos: 0,
          riders: 0,
          owner: v.owner,
          tankStartL: v.tankL,
          fuelUsedL: 0,
          fuelBoughtL: 0,
          refuels: 0,
        };
      this.doneToday.fill(false);
      this.dayNumber++;
      this.ledgerDay++;
      this.passengerService?.endOfDay?.();
    }
  }

  /** Drivers setting out in the morning, and knocking off at night. */
  private changeDuties(): void {
    const now = this.timeOfDay;
    for (const v of this.vehicles) {
      if (v.duty === 'service' && (now >= this.homeAt(v.id) || now < SERVICE_FROM_S)) {
        v.duty = 'homebound';
        // Some fill up on the way home tonight, ready for the morning.
        v.topUpTonight = this.today(v.id, 3) < TOP_UP_SHARE;
      }
      if (
        v.duty !== 'parked' ||
        this.doneToday[v.id] ||
        now < this.outAt(v.id) ||
        now >= this.homeAt(v.id)
      )
        continue;
      if (v.depot === null) {
        if (this.roomAt(v.garageS)) this.setOut(v);
      } else if (this.roomAt(this.route.stops[v.depot]!.s)) this.leaveTerminal(v);
      else this.joinLine(v);
    }
  }

  /** A boundary driver out of the operator's terminal: at its kerb, taking whoever waits. */
  private leaveTerminal(v: FleetVehicle): void {
    const at = v.depot!;
    v.duty = 'service';
    v.s = this.route.stops[at]!.s;
    v.direction = this.route.loop || at < this.route.stops.length - 1 ? 1 : -1;
    v.nextStop = at;
    v.currentStop = at;
    v.dwellS = TERMINAL_DWELL_S;
    v.speedMps = 0;
    v.laneShiftM = 0;
    v.occupancy = 0;
    this.scanLeaders = true;
    this.passengerService?.pickUp(v, at);
  }

  /**
   * A boundary driver out while another loads at the terminal: at the back of
   * its line, on the road into the terminal (a loop's; a line's ends have no
   * road behind them, so there it waits for the kerb to clear).
   */
  private joinLine(v: FleetVehicle): void {
    if (!this.route.loop) return;
    const L = this.route.polyline.length;
    const at = this.route.stops[v.depot!]!.s;
    // Jeepneys standing in line before the terminal, nearest it first.
    const line = this.vehicles
      .filter((o) => o.duty !== 'parked' && o.speedMps < 0.5)
      .map((o) => aheadOf(this.route, o.s, at))
      .map((d) => (d > L - 1 ? 0 : d))
      .filter((d) => d < LINE_REACH_M)
      .sort((a, b) => a - b);
    let tail = -Infinity;
    for (const d of line) {
      if (tail > -Infinity && d > tail + MIN_GAP_M + 12) break;
      tail = Math.max(tail, d);
    }
    if (tail === -Infinity) return;
    // Just over a gap behind the last in line (roomAt asks for that much).
    const spot = (((at - tail - MIN_GAP_M - 9) % L) + L) % L;
    if (!this.roomAt(spot)) return;
    v.duty = 'service';
    v.s = spot;
    v.direction = 1;
    v.nextStop = v.depot!;
    v.currentStop = null;
    v.dwellS = 0;
    v.speedMps = 0;
    v.laneShiftM = 0;
    v.occupancy = 0;
    this.scanLeaders = true;
  }

  /** No jeepney on the road within a gap of along-route position `at`: room to pull out. */
  private roomAt(at: number): boolean {
    return this.vehicles.every((o) => o.duty === 'parked' || this.apartS(at, o.s) > MIN_GAP_M + 8);
  }

  /**
   * Out for the day: pulling out from the side of the road where it was kept,
   * empty, onto the route; its first trip starts from there, picking up
   * whoever is waiting on the way.
   */
  private setOut(v: FleetVehicle): void {
    v.duty = 'service';
    v.s = v.garageS;
    v.nextStop = this.nextStopIndex(v.garageS, v.direction);
    v.currentStop = null;
    v.dwellS = 0;
    v.speedMps = 0;
    v.laneShiftM = KERBSIDE_M; // eases into the lane (steerAround)
    v.occupancy = 0;
    this.scanLeaders = true;
  }

  /** In for the night where it is kept: off the road, not drawn. */
  private park(v: FleetVehicle): void {
    v.duty = 'parked';
    v.refuel = null;
    v.refuelLeftS = 0;
    v.yard = null;
    v.currentStop = null;
    v.dwellS = 0;
    v.speedMps = 0;
    v.laneShiftM = 0;
    v.occupancy = 0;
    this.doneToday[v.id] = true;
    this.heldS[v.id] = 0;
    this.dropOffOnly.delete(v.id);
    this.overtakes.delete(v.id);
    for (const [id, o] of this.overtakes) if (o.of === v.id) this.overtakes.delete(id);
    this.scanLeaders = true;
  }

  /** Diesel burnt: `metres` driven and `idleS` standing with the engine on. */
  private burn(v: FleetVehicle, metres: number, idleS: number): void {
    const used = Math.min(v.tankL, metres / 1000 / MOVING_KM_PER_L + (idleS / 3600) * IDLE_L_PER_H);
    v.tankL -= used;
    v.day.fuelUsedL += used;
  }

  /** Diesel to drive `metres`, with RANGE_MARGIN for traffic and idling. */
  private litresFor(metres: number): number {
    return (metres / 1000 / MOVING_KM_PER_L) * RANGE_MARGIN;
  }

  /**
   * Whether `v` should go for diesel at the next station: below
   * REFUEL_BELOW of its tank; or with too little to reach the station after
   * it (so it never passes the last one it could reach); or knocking off
   * tonight, its driver one who fills up then and the tank under TOP_UP_BELOW.
   */
  private wantsDiesel(v: FleetVehicle): boolean {
    if (v.tankL < REFUEL_BELOW * v.tankCapacityL) return true;
    if (v.duty === 'homebound' && v.topUpTonight && v.tankL < TOP_UP_BELOW * v.tankCapacityL)
      return true;
    const after = this.stationsAhead(v)[1];
    return v.tankL < this.litresFor(after?.d ?? STATION_LOOK_M);
  }

  /** How far ahead along-route position `at` is, in the jeepney's direction. */
  private ahead(v: FleetVehicle, at: number): number {
    return this.route.loop ? aheadOf(this.route, v.s, at) : (at - v.s) * v.direction;
  }

  /** The stations on its side of the road within STATION_LOOK_M ahead (to where it turns in), nearest first. */
  private stationsAhead(v: FleetVehicle): Array<{ at: FuelStopAt; d: number }> {
    const side = v.direction === 1 ? 'right' : 'left';
    const out: Array<{ at: FuelStopAt; d: number }> = [];
    for (const st of this.cfg.fuelStops?.() ?? []) {
      if (st.side !== side) continue;
      const d = this.ahead(v, st.inS);
      if (d > 30 && d < STATION_LOOK_M) out.push({ at: st, d });
    }
    return out.sort((a, b) => a.d - b.d);
  }

  /** The jeepneys in `stop`'s forecourt. */
  private inYard(stop: FuelStopAt): FleetVehicle[] {
    return this.vehicles.filter((o) => o.yard && o.yard.stop.inS === stop.inS);
  }

  /**
   * At the station's entrance: off the road into the lane of pumps with the
   * shortest line, unless the forecourt is full to its entrance (then it
   * waits in the road). Maybe a car or two at its pump before it.
   */
  private turnIn(v: FleetVehicle): boolean {
    // From its own lane only: not while swung out round a jeepney at a stop.
    if (v.laneShiftM < -0.5) return false;
    const stop = v.refuel!.at;
    const inside = this.inYard(stop);
    if (inside.some((o) => o.yard!.u < YARD_GAP_M)) return false;
    const line = (bay: number) => inside.filter((o) => o.yard!.bay === bay && !o.yard!.full);
    let bay = 0;
    for (let b = 1; b < baysOf(stop); b++) if (line(b).length < line(bay).length) bay = b;
    const cars =
      line(bay).length === 0 && this.driverRng() < BUSY_SHARE
        ? this.driverRng() < SECOND_CAR_SHARE
          ? 2
          : 1
        : 0;
    v.yard = {
      stop,
      bay,
      u: 0,
      cars,
      carLeftS: cars > 0 ? this.carTime() : 0,
      ahead: 0,
      full: false,
    };
    v.s = stop.inS;
    v.speedMps = Math.min(v.speedMps, YARD_MPS);
    this.overtakes.delete(v.id);
    return true;
  }

  /** Seconds a car takes at the pump. */
  private carTime(): number {
    return CAR_MIN_S + this.driverRng() * (CAR_MAX_S - CAR_MIN_S);
  }

  /**
   * In the forecourt: up to its pump (behind whoever is in front), waiting
   * its turn with the engine on, filling up with it off, then on to the
   * exit and back onto the road when nobody is coming.
   */
  private atStation(v: FleetVehicle, dtS: number): void {
    const y = v.yard!;
    const stop = y.stop;
    // The car at its pump.
    if (y.cars > 0) {
      y.carLeftS -= dtS;
      if (y.carLeftS <= 0) y.carLeftS = --y.cars > 0 ? this.carTime() : 0;
    }
    // Who is in front of it: in its lane of pumps, or in any while either is
    // turning in or out (across the other lanes).
    const turn = yardTurn(stop);
    const turning = (u: number) => u < turn - 0.1 || u > stop.lengthM - turn + 0.1;
    let next = Infinity;
    let jeepneys = 0;
    for (const o of this.inYard(stop)) {
      if (o === v || o.yard!.u <= y.u) continue;
      const lane = o.yard!.bay === y.bay;
      if (!lane && !turning(y.u) && !turning(o.yard!.u)) continue;
      next = Math.min(next, o.yard!.u);
      if (lane && !o.yard!.full) jeepneys++;
    }
    y.ahead = y.cars + jeepneys;
    const pump = pumpAt(stop);
    const goal = Math.min(
      y.full ? stop.lengthM : pump - y.cars * CAR_GAP_M,
      next - YARD_GAP_M,
      // Out onto the road only once nobody is coming.
      y.full && y.u < stop.lengthM - yardTurn(stop) && !this.roomAround(v)
        ? stop.lengthM - yardTurn(stop)
        : Infinity,
    );
    const left = goal - y.u;
    if (left > 0.05) {
      const target = Math.min(YARD_MPS, Math.max(CREEP_MPS, Math.sqrt(2 * BRAKE_MPS2 * left)));
      v.speedMps = target > v.speedMps ? Math.min(target, v.speedMps + ACCEL_MPS2 * dtS) : target;
      const step = Math.min(v.speedMps * dtS, left);
      y.u += step;
      v.day.metres += step;
      this.burn(v, step, 0);
    } else {
      v.speedMps = 0;
      if (!y.full && y.ahead === 0 && y.u >= pump - 0.05) this.fillUp(v, dtS);
      else {
        v.day.idleS += dtS;
        this.burn(v, 0, dtS);
      }
    }
    const L = this.route.polyline.length;
    const s = stop.inS + v.direction * y.u;
    v.s = this.route.loop ? ((s % L) + L) % L : Math.max(0, Math.min(L, s));
    v.laneShiftM = yardShift(stop, y.bay, y.u);
    if (y.full && y.u >= stop.lengthM - 0.05) {
      // Back on the road.
      v.yard = null;
      v.laneShiftM = 0;
      this.scanLeaders = true;
    }
  }

  /** At the pump, engine off: the attendant's time and the litres; full when done. */
  private fillUp(v: FleetVehicle, dtS: number): void {
    if (v.refuelLeftS === 0) {
      const litres = v.tankCapacityL - v.tankL;
      const handling = HANDLING_MIN_S + this.driverRng() * (HANDLING_MAX_S - HANDLING_MIN_S);
      v.refuelLeftS = Math.max(REFUEL_MIN_S, handling + (litres / PUMP_L_PER_MIN) * 60);
    }
    v.refuelLeftS = Math.max(0, v.refuelLeftS - dtS);
    if (v.refuelLeftS > 0) return;
    v.day.fuelBoughtL += v.tankCapacityL - v.tankL;
    v.day.refuels++;
    v.tankL = v.tankCapacityL;
    v.topUpTonight = false;
    v.refuel = null;
    v.yard!.full = true;
  }

  /**
   * Nobody else on the road within a gap of `v`: room to pull out into the
   * lane. One stopped just behind it has stopped for it (it treats `v` as
   * in the lane once `v` is half out): `v` goes, or both would wait for ever.
   */
  private roomAround(v: FleetVehicle): boolean {
    return this.vehicles.every((o) => {
      if (o === v || o.duty === 'parked' || o.laneShiftM > 0.5) return true;
      if (this.apartS(v.s, o.s) > MIN_GAP_M + 8 + Math.max(0, this.longer(v, o))) return true;
      const behind =
        o.direction === v.direction && this.ahead(o, v.s) < this.route.polyline.length / 2;
      return behind && o.speedMps < 0.5;
    });
  }

  /** Whether a jeepney driving home is there (it passes its spot within a tick's drive). */
  private reachedGarage(v: FleetVehicle): boolean {
    const L = this.route.polyline.length;
    const ahead = this.route.loop
      ? aheadOf(this.route, v.s, v.garageS)
      : (v.garageS - v.s) * v.direction;
    // Just past it (a tick overshoot), or within a couple of metres.
    return ahead <= 2 || (this.route.loop && ahead > L - 2) || (!this.route.loop && ahead < 0);
  }

  /** How far apart two along-route positions are, either way round. */
  private apartS(a: number, b: number): number {
    if (!this.route.loop) return Math.abs(b - a);
    const L = this.route.polyline.length;
    const d = (((b - a) % L) + L) % L;
    return Math.min(d, L - d);
  }

  /** A driver's pace now: their clear-road speed, slowed by the hour's traffic. */
  private paceOf(v: FleetVehicle): number {
    return v.cruiseMps * this.traffic;
  }

  /** Jeepney `id`'s moving pace now (paceOf): what its arrival times are worked out at. */
  pace(id: number): number {
    const v = this.vehicles[id];
    return v ? this.paceOf(v) : 0;
  }

  /**
   * Put jeepney i at along-route position s with this load and plate, as
   * if it had driven there: the hand-over from a network flow when its
   * route becomes the focused one. Before riders are seated (CrewState).
   */
  place(i: number, at: { s: number; occupancy: number; plate: string; inService?: boolean }): void {
    const v = this.vehicles[i]!;
    if (at.inService === false) {
      // Not on the road at this hour: parked where it is kept.
      v.plate = at.plate;
      v.s = v.garageS;
      v.nextStop = this.nextStopIndex(v.garageS, v.direction);
      this.park(v);
      // Knocked off already (night) or still to come out (before its departure).
      this.doneToday[v.id] = this.timeOfDay >= this.homeAt(v.id);
      return;
    }
    v.duty = 'service';
    const L = this.route.polyline.length;
    v.s = this.route.loop ? ((at.s % L) + L) % L : Math.max(0, Math.min(L, at.s));
    v.occupancy = Math.max(0, Math.min(v.capacity, Math.round(at.occupancy)));
    v.plate = at.plate;
    v.nextStop = this.nextStopIndex(v.s, v.direction);
    v.currentStop = null;
    v.dwellS = 0;
    v.laneShiftM = 0;
    v.refuel = null;
    v.refuelLeftS = 0;
    v.yard = null;
    this.scanLeaders = true;
  }

  step(dtS: number): void {
    // Route-wide arrivals this tick, shared out by stop (terminals draw more).
    // With a working day, riders only come while jeepneys run.
    const now = this.timeOfDay;
    const running = !this.cfg.dayCycle || (now >= SERVICE_FROM_S && now < LAST_RIDERS_S);
    const routeMean = !running
      ? 0
      : this.cfg.scenario
        ? expectedArrivals(this.cfg.scenario, this.elapsedS, dtS)
        : (this.cfg.demandPerStopPerMin / 60) * dtS * this.waiting.length;
    this.elapsedS += dtS;
    // The hour's traffic, as the network's flows have it: a clear road at
    // night, slowest in the rush hours.
    if (this.cfg.scenario) this.traffic = flowSpeedKmh(this.timeOfDay / 3600) / 20;
    if (this.cfg.dayCycle) {
      this.closeDays();
      this.changeDuties();
    }
    for (let i = 0; i < this.waiting.length; i++) {
      const arrivals = poisson(this.demandRng, routeMean * this.demandShare[i]!);
      this.generatedDemand += arrivals;
      if (this.passengerService) this.passengerService.demand(i, arrivals);
      else this.waiting[i]! += arrivals;
    }
    this.indexLeaders();
    for (const v of this.vehicles) this.stepVehicle(v, dtS);
  }

  private stepVehicle(v: FleetVehicle, dtS: number): void {
    if (v.duty === 'parked') return;
    if (v.yard) {
      this.atStation(v, dtS);
      return;
    }
    if (v.currentStop !== null) {
      v.day.idleS += dtS;
      this.burn(v, 0, dtS);
      v.dwellS = Math.max(0, v.dwellS - dtS);
      v.speedMps = 0;
      this.overtakes.delete(v.id);
      // In to the kerb, unless stopped beside one already there (double-parked).
      this.steerAround(v, dtS);
      if (v.dwellS > 0 || this.passengerService?.busy(v.id)) return;
      // The last trip done at a terminal, everyone off. A jeepney the
      // operator keeps at a terminal stays there; the rest drive back to
      // the home or garage they came out of.
      if (
        v.duty === 'homebound' &&
        this.terminalFor(v, v.currentStop) &&
        !this.dropOffOnly.has(v.id)
      ) {
        if (v.depot !== null) {
          v.depot = v.currentStop;
          v.garageS = this.route.stops[v.currentStop]!.s;
          this.park(v);
          return;
        }
        // Home the short way: wherever the route next passes the house.
        const ways = this.homeSpots[v.id]!.length > 0 ? this.homeSpots[v.id]! : [v.garageS];
        v.garageS = ways.reduce((best, w) => (this.ahead(v, w) < this.ahead(v, best) ? w : best));
        v.duty = 'returning';
        v.nextStop = this.stopAfter(v.currentStop, v.direction);
        v.currentStop = null;
        return;
      }
      if (this.waitsForGap(v, dtS)) return;
      // On a line, turn around at a terminal once everyone is clear of the
      // vehicle. A loop never turns around: the road takes it back.
      if (!this.passengerService && !this.route.loop && this.terminalFor(v, v.currentStop)) {
        v.direction = v.direction === 1 ? -1 : 1;
        this.scanLeaders = true;
      }
      // The stop after the one served (it may have been served from short of
      // it). Riders let off in a queue: the stop itself is still to come.
      v.nextStop = this.dropOffOnly.delete(v.id)
        ? v.currentStop
        : this.stopAfter(v.currentStop, v.direction);
      v.currentStop = null;
      return;
    }

    const route = this.route;
    const stop = route.stops[v.nextStop];
    const isTerminalNext = this.terminalFor(v, v.nextStop);
    const service = this.passengerService;
    // Driving home, empty: past every stop, and in for the night on reaching home.
    const returning = v.duty === 'returning';
    if (returning && this.reachedGarage(v)) {
      this.park(v);
      return;
    }
    // At the side of the road (out from home):
    // into the lane only once nobody is coming past.
    if (v.laneShiftM > 0.5 && !this.roomAround(v)) {
      v.speedMps = 0;
      v.day.idleS += dtS;
      this.burn(v, 0, dtS);
      return;
    }
    // Diesel needed (see wantsDiesel): the next station on the way (looked
    // at every FUEL_LOOK_S, not every tick).
    if (!v.refuel && this.elapsedS >= (this.fuelLookAt[v.id] ?? 0)) {
      this.fuelLookAt[v.id] = this.elapsedS + FUEL_LOOK_S;
      if (this.wantsDiesel(v)) {
        const next = this.stationsAhead(v)[0];
        v.refuel = next ? { s: next.at.inS, name: next.at.name, at: next.at } : null;
      }
    }
    // Distance to the station it is filling up at (Infinity when not going to one).
    const toFuel = v.refuel ? this.ahead(v, v.refuel.s) : Infinity;
    // Slow for the stop only if someone gets on or off there (or it is a terminal).
    const mayStop =
      !returning &&
      !!stop &&
      (service
        ? service.wantsStop(v, v.nextStop)
        : isTerminalNext || (this.waiting[v.nextStop] ?? 0) > 0 || v.occupancy > 0);
    // Distance still to drive to the stop (around the loop, on a loop).
    const toStop = stop
      ? route.loop
        ? aheadOf(route, v.s, stop.s)
        : Math.abs(stop.s - v.s)
      : Infinity;

    this.overtake(v, mayStop ? toStop : Infinity, dtS);
    // Speed the jeepney wants: cruise (a bit more while overtaking), but able
    // to brake in time for the stop and for the jeepney ahead (v² = 2·a·d).
    const pace = this.overtakes.has(v.id)
      ? Math.min(PASS_TOP_MPS, this.paceOf(v) + PASS_BOOST_MPS)
      : this.hangsBack(v)
        ? this.paceOf(v) * HANG_BACK_PACE
        : this.paceOf(v);
    const room = Math.max(0, this.gapAhead(v) - MIN_GAP_M);
    let target = Math.min(pace, Math.sqrt(2 * BRAKE_MPS2 * room));
    if (mayStop) {
      target = Math.min(target, Math.max(CREEP_MPS, Math.sqrt(2 * BRAKE_MPS2 * toStop)));
    }
    if (toFuel < toStop || (!mayStop && toFuel < Infinity)) {
      target = Math.min(target, Math.max(CREEP_MPS, Math.sqrt(2 * BRAKE_MPS2 * toFuel)));
    }
    // Accelerate gently; braking follows the curve above, which is smooth.
    v.speedMps = target > v.speedMps ? Math.min(target, v.speedMps + ACCEL_MPS2 * dtS) : target;
    // Never drive through the jeepney ahead in the same direction.
    const step = Math.min(v.speedMps * dtS, room);
    v.day.metres += step;
    const standing = step < 0.1 * dtS;
    if (standing) v.day.idleS += dtS; // standing in a queue
    this.burn(v, step, standing ? dtS : 0);
    // At the station: in to the pumps (or, its forecourt full, waiting in the road at it).
    if (v.refuel && step >= toFuel) {
      if (!this.turnIn(v)) {
        v.speedMps = 0;
        this.steerAround(v, dtS);
      }
      return;
    }

    this.steerAround(v, dtS);
    const advance = () => {
      v.s = route.loop ? (v.s + step) % route.polyline.length : v.s + v.direction * step;
    };

    if (step < toStop) {
      advance();
      // Held up behind another jeepney: close enough to the stop for riders
      // to walk to it, open the door here instead of waiting in the queue;
      // further back, let off whoever gets off there.
      const heldUp = room < toStop && v.speedMps < CREEP_MPS;
      if (service && heldUp) {
        const gap = toStop - step;
        if (mayStop && gap <= STOP_ZONE_M) this.serveHere(v, false);
        else if (gap <= ALIGHT_ZONE_M && service.dropsAt(v, v.nextStop)) this.serveHere(v, true);
      }
      return;
    }

    if (!stop) return;
    // Nobody to set down or pick up: drive on past it.
    if (service && !mayStop) {
      advance();
      v.nextStop = this.stopAfter(v.nextStop, v.direction);
      return;
    }
    v.s = stop.s;
    v.speedMps = 0;
    v.currentStop = v.nextStop;
    if (this.passengerService) {
      v.dwellS = isTerminalNext ? TERMINAL_DWELL_S : 3;
      this.passengerService.arrive(v, v.currentStop);
    } else if (isTerminalNext) {
      // Everyone gets off at the terminal; the jeepney turns around.
      v.occupancy = 0;
      v.dwellS = TERMINAL_DWELL_S;
    } else {
      const remaining = stopsAhead(route, v.nextStop, v.direction).length;
      const alighting = binomial(this.rng, v.occupancy, 1 / Math.max(1, remaining));
      v.occupancy -= alighting;
      const boarding = Math.min(this.waiting[v.nextStop]!, v.capacity - v.occupancy);
      this.waiting[v.nextStop]! -= boarding;
      v.occupancy += boarding;
      if (alighting + boarding > 0) v.dwellS = 3 + 1.4 * (alighting + boarding);
    }
  }

  /** Open the door where `v` stands, short of its next stop (see stepVehicle). */
  private serveHere(v: FleetVehicle, dropOffOnly: boolean): void {
    v.speedMps = 0;
    v.currentStop = v.nextStop;
    v.dwellS = dropOffOnly ? 1 : 3;
    if (dropOffOnly) this.dropOffOnly.add(v.id);
    this.passengerService!.arrive(v, v.currentStop, dropOffOnly);
  }

  /** The stop after stop `i` in `direction` (wrapping round a loop, held at a line's ends). */
  private stopAfter(i: number, direction: 1 | -1): number {
    const n = this.route.stops.length;
    if (this.route.loop) return (i + 1) % n;
    return Math.max(0, Math.min(n - 1, i + direction));
  }

  /** Who is behind whom, sorted once per tick instead of scanning N² pairs. */
  private indexLeaders(): void {
    this.scanLeaders = false;
    this.followers.length = 0;
    this.lanes[0].length = this.lanes[1].length = 0;
    // The spacing the whole fleet would have, parked ones included: a
    // morning terminal spaces its departures for everyone still to come out.
    const L = this.route.polyline.length;
    const all = [0, 0];
    for (const v of this.vehicles) {
      all[v.direction === 1 ? 0 : 1]!++;
      if (v.duty !== 'parked') this.lanes[v.direction === 1 ? 0 : 1].push(v);
    }
    for (const k of [0, 1] as const) this.spacing[k] = all[k]! > 1 ? L / all[k]! : Infinity;
    for (const lane of this.lanes) {
      lane.sort((a, b) => (a.s - b.s) * a.direction);
      for (let i = 0; i < lane.length; i++) {
        const v = lane[i]!;
        const next = lane[i + 1] ?? (this.route.loop && lane.length > 1 ? lane[0]! : null);
        this.leaders[v.id] = next;
        if (next) this.followers[next.id] = v;
        // Imported/edited states can contain overlaps. Preserve the strict
        // positive-distance rule until those vehicles separate again.
        if (next && next.s === v.s) this.scanLeaders = true;
      }
    }
  }

  /**
   * Whether `v` can drive round `o`: `o` is stopped at a stop where `v` has
   * nobody to set down or pick up. A jeepney swings out past one loading at
   * the kerb rather than queue behind it for a stop it does not need.
   */
  private canPass(v: FleetVehicle, o: FleetVehicle): boolean {
    return (
      o !== v &&
      o.currentStop !== null &&
      // Double-parked, it already takes the space a passer would swing into.
      o.laneShiftM > -0.5 &&
      !!this.passengerService &&
      !this.passengerService.wantsStop(v, o.currentStop)
    );
  }

  /**
   * Whether `v` need not keep behind `o`: it is driving round `o` stopped
   * at a stop, or overtaking it, or `o` is still out in the road
   * overtaking `v` (the one passed never brakes for the one passing it).
   */
  private ignores(v: FleetVehicle, o: FleetVehicle): boolean {
    // Going round `o` only once swung out clear of it: before that, `v`
    // keeps behind it (a jeepney that stops just in front is braked for).
    const clear = v.laneShiftM <= -SWUNG_OUT_M;
    if (o.laneShiftM >= SWUNG_OUT_M) return true; // at the side of the road, out of the lane
    // Overtaking one only while it keeps to its lane: one that has pulled out
    // too (to overtake someone itself) is in the outer lane, in the way.
    return (
      (clear && this.canPass(v, o)) ||
      (clear && this.overtakes.get(v.id)?.of === o.id && o.laneShiftM > -SWUNG_OUT_M) ||
      (this.overtakes.get(o.id)?.of === v.id && v.laneShiftM > -SWUNG_OUT_M)
    );
  }

  /**
   * Whether `v`, done at its stop, waits on there for the jeepney in front
   * to get further away (see ABANG_S, DISPATCH_SHARE). Not when only letting
   * riders off in a queue, short of the stop.
   */
  private waitsForGap(v: FleetVehicle, dtS: number): boolean {
    const stop = v.currentStop!;
    const terminal = this.terminalFor(v, stop);
    const held = this.heldS[v.id] ?? 0;
    const o = this.leaders[v.id];
    const close =
      this.cfg.hangBack !== false &&
      !!o &&
      o !== v &&
      this.distance(v, o) <
        (terminal ? DISPATCH_SHARE : HANG_BACK_SHARE) * this.spacing[v.direction === 1 ? 0 : 1];
    const filling = terminal && !!this.cfg.dayCycle && v.occupancy < PILA_FILL * v.capacity;
    if (held === 0)
      this.pilaWaitS[v.id] =
        PILA_WAIT_MIN_S + this.driverRng() * (PILA_WAIT_MAX_S - PILA_WAIT_MIN_S);
    // A long line behind: the dispatcher keeps it moving rather than let the
    // head fill (else the last in a line of 30 waits over an hour, and the
    // road goes without jeepneys).
    const limit = terminal
      ? this.lineBehind(v) >= LONG_LINE
        ? Math.min(this.pilaWaitS[v.id]!, LINE_DISPATCH_S)
        : this.pilaWaitS[v.id]!
      : ABANG_S;
    if (
      v.duty !== 'service' ||
      this.dropOffOnly.has(v.id) ||
      !(close || filling) ||
      held >= limit
    ) {
      this.heldS[v.id] = 0;
      return false;
    }
    this.heldS[v.id] = held + dtS;
    // Newcomers get on.
    const due = Math.floor((held + dtS) / REBOARD_EVERY_S) > Math.floor(held / REBOARD_EVERY_S);
    if (due && v.occupancy < v.capacity && (this.waiting[stop] ?? 0) > 0)
      this.passengerService?.pickUp(v, stop);
    return true;
  }

  /** How many jeepneys stand in line right behind `v` (each within a car length or so of the next). */
  private lineBehind(v: FleetVehicle): number {
    let n = 0;
    let front = v;
    for (let u = this.followers[v.id]; u && u !== v && n < LONG_LINE; u = this.followers[u.id]) {
      if (u.speedMps > 0.5 || this.distance(u, front) > MIN_GAP_M + 12) break;
      n++;
      front = u;
    }
    return n;
  }

  /**
   * Whether `v`'s driver hangs back: the jeepney in front is close (see
   * HANG_BACK_SHARE) and going at a normal pace. One crawling well below
   * `v`'s pace is for overtaking instead.
   */
  private hangsBack(v: FleetVehicle): boolean {
    if (this.cfg.hangBack === false || v.duty !== 'service') return false;
    const o = this.leaders[v.id];
    if (!o || o === v) return false;
    if (o.currentStop === null && o.speedMps < this.paceOf(v) - SLOWER_BY_MPS) return false;
    return this.distance(v, o) < HANG_BACK_SHARE * this.spacing[v.direction === 1 ? 0 : 1];
  }

  /**
   * Start, finish or give up overtaking a slower moving jeepney (stopped
   * ones are canPass's). `toOwnStop`: how far the stop `v` will stop at is.
   */
  private overtake(v: FleetVehicle, toOwnStop: number, dtS: number): void {
    const on = this.overtakes.get(v.id);
    if (on) {
      const o = this.vehicles[on.of]!;
      const ahead = this.distance(o, v);
      // Past it with room to cut in (ahead of it, not a lap behind it).
      const past =
        ahead >= MERGE_AHEAD_M + this.longer(v, o) && ahead < this.route.polyline.length / 2;
      const stuck = this.elapsedS - on.sinceS > PASS_GIVE_UP_S || o.currentStop !== null;
      // Never give up alongside it: once level, the overtake is finished.
      if (past || (stuck && this.apart(v, o) >= ALONGSIDE_M + this.longer(v, o))) {
        this.overtakes.delete(v.id);
        this.calmUntil[v.id] = this.elapsedS + CALM_S * (1.5 - v.boldness);
      }
      return;
    }
    if (this.cfg.overtaking === false || (this.calmUntil[v.id] ?? 0) > this.elapsedS) return;
    const o = this.leaders[v.id];
    if (!o || o === v || o.currentStop !== null || this.overtakes.has(o.id)) return;
    // Not while someone is passing this one: it would pull out into them.
    for (const x of this.overtakes.values()) if (x.of === v.id) return;
    if (this.distance(v, o) > CATCH_UP_M) return;
    if (o.speedMps > this.paceOf(v) - SLOWER_BY_MPS) return;
    if (toOwnStop < OWN_STOP_CLEAR_M) return;
    for (const x of this.overtakes.values()) if (x.of === o.id) return;
    const beyond = this.leaders[o.id];
    if (beyond && beyond !== v && this.distance(o, beyond) < ROOM_AHEAD_M) return;
    if (!this.straightAhead(v)) return;
    // The driver: most sit behind for a while, the bold pull out at once.
    if (this.driverRng() >= v.boldness * v.boldness * PULL_OUT_PER_S * dtS) return;
    this.overtakes.set(v.id, { of: o.id, sinceS: this.elapsedS });
  }

  /** Whether the road ahead of `v` is straight enough to overtake on. */
  private straightAhead(v: FleetVehicle): boolean {
    const line = this.route.polyline;
    const L = line.length;
    const far = v.s + v.direction * STRAIGHT_M;
    if (!this.route.loop && (far < 0 || far > L)) return false;
    const turn = line.headingAt((far + L) % L, 10) - line.headingAt(v.s, 10);
    return Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))) < STRAIGHT_RAD;
  }

  /** The jeepney `v` must keep behind: the one ahead, skipping any it can pass. */
  private leaderOf(v: FleetVehicle): FleetVehicle | null {
    let leader = this.leaders[v.id] ?? null;
    for (let hops = 0; leader && hops < PASS_AT_MOST && this.ignores(v, leader); hops++)
      leader = this.leaders[leader.id] ?? null;
    return leader === v ? null : leader;
  }

  /** Half the extra length of `a` and `b` over two jeepneys (negative for a van). */
  private longer(a: FleetVehicle, b: FleetVehicle): number {
    return (lengthOf(a.kind) + lengthOf(b.kind)) / 2 - JEEPNEY_LENGTH_M;
  }

  /**
   * Distance to the one ahead `v` keeps behind, as if both were jeepneys
   * (less the extra length of a longer one): what MIN_GAP_M is kept from.
   */
  private gapAhead(v: FleetVehicle): number {
    if (!this.scanLeaders) {
      const leader = this.leaderOf(v);
      if (!leader) return Infinity;
      // Read the live position, retaining the existing sequential step order.
      const d = this.route.loop
        ? aheadOf(this.route, v.s, leader.s)
        : (leader.s - v.s) * v.direction;
      return d - this.longer(v, leader);
    }
    let gap = Number.POSITIVE_INFINITY;
    for (const o of this.vehicles) {
      if (o === v || o.duty === 'parked' || o.direction !== v.direction || this.ignores(v, o))
        continue;
      const d = this.route.loop ? aheadOf(this.route, v.s, o.s) : (o.s - v.s) * v.direction;
      if (d > 0 && d - this.longer(v, o) < gap) gap = d - this.longer(v, o);
    }
    return gap;
  }

  /**
   * Swing out while overtaking, or going past a stopped jeepney (from just
   * before it to just after), and back in once clear, smoothly. Back in
   * only where the lane is free: a jeepney that had to stop beside another
   * stays double-parked rather than drive onto it.
   */
  private steerAround(v: FleetVehicle, dtS: number): void {
    const moving = v.currentStop === null;
    let passing = moving && this.overtakes.has(v.id);
    const ahead = this.leaders[v.id];
    if (moving && !passing && ahead && this.canPass(v, ahead))
      passing = this.distance(v, ahead) < PASS_WINDOW_AHEAD_M;
    const behind = this.followers[v.id];
    if (moving && !passing && behind && behind.currentStop !== null)
      passing = this.distance(behind, v) < PASS_WINDOW_BEHIND_M && v.laneShiftM < -0.1;
    let target = passing ? -PASS_SHIFT_M : 0;
    if (target > v.laneShiftM && !this.laneFree(v)) target = v.laneShiftM;
    if (target < v.laneShiftM && !this.outerFree(v)) target = v.laneShiftM;
    const step = LANE_SHIFT_MPS * dtS;
    v.laneShiftM += Math.max(-step, Math.min(step, target - v.laneShiftM));
  }

  /**
   * Whether `v` can move out towards the middle of the road: no jeepney
   * further out is alongside it, or coming up behind it within COMING_UP_M
   * (one overtaking, say). It waits, as a driver checks the mirror.
   */
  private outerFree(v: FleetVehicle): boolean {
    for (const [next, reach] of [
      [this.leaders, ALONGSIDE_M],
      [this.followers, ALONGSIDE_M + COMING_UP_M],
    ] as const) {
      let u = next[v.id];
      for (let hop = 0; u && u !== v && hop < PASS_AT_MOST; hop++, u = next[u.id]) {
        if (this.apart(v, u) >= reach + this.longer(v, u)) break;
        if (u.direction === v.direction && u.laneShiftM < v.laneShiftM - 0.05) return false;
      }
    }
    return true;
  }

  /**
   * Whether `v` can move in towards the kerb: no jeepney alongside it is
   * further in than it is. Only neighbours in driving order can be alongside.
   */
  private laneFree(v: FleetVehicle): boolean {
    for (const next of [this.leaders, this.followers]) {
      let u = next[v.id];
      for (let hop = 0; u && u !== v && hop < PASS_AT_MOST; hop++, u = next[u.id]) {
        if (this.apart(v, u) >= ALONGSIDE_M + this.longer(v, u)) break;
        if (u.direction === v.direction && u.laneShiftM > v.laneShiftM - 0.05) return false;
      }
    }
    return true;
  }

  /** How far apart `a` and `b` are along the road, whichever is in front. */
  private apart(a: FleetVehicle, b: FleetVehicle): number {
    if (!this.route.loop) return Math.abs(b.s - a.s);
    return Math.min(aheadOf(this.route, a.s, b.s), aheadOf(this.route, b.s, a.s));
  }

  /** How far `b` is ahead of `a` along their direction of travel. */
  private distance(a: FleetVehicle, b: FleetVehicle): number {
    return this.route.loop ? aheadOf(this.route, a.s, b.s) : (b.s - a.s) * a.direction;
  }

  private nextStopIndex(s: number, direction: 1 | -1): number {
    const stops = this.route.stops;
    if (direction === 1) {
      const i = stops.findIndex((st) => st.s >= s);
      // Past the last stop: on a loop the next one is the first, round again.
      return i === -1 ? (this.route.loop ? 0 : stops.length - 1) : i;
    }
    for (let i = stops.length - 1; i >= 0; i--) if (stops[i]!.s <= s) return i;
    return 0;
  }
}

function binomial(rng: Rng, n: number, p: number): number {
  let k = 0;
  for (let i = 0; i < n; i++) if (rng() < p) k++;
  return k;
}
