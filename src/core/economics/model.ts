import { createRng } from '../math/random';
import { fareFor, PH_TRADITIONAL_JEEPNEY, type FareRule } from '../fare';
import { OWNER_SHARE } from '../fleet/scenario';
import { calibrate, drawKind, mixAt, schoolStop } from '../people/riderMix';

export const MODEL_VERSION = 'roi-events-4';
export const MODES = ['baseline', 'planner', 'muse'] as const;
export type Mode = (typeof MODES)[number];
export const GROUPS = ['regular', 'student', 'pwd', 'senior', 'pregnant'] as const;
export type Group = (typeof GROUPS)[number];
export interface Corridor {
  name: string;
  stops: { name: string; km: number }[];
  note: string;
}
export interface Experiment {
  days: number;
  repetitions: number;
  seed: number;
  dailyTrips: number;
  vehicles: number;
  hours: number;
  startHour: number;
  capacity: number;
  speedKmh: number;
  peakSpeedFactor: number;
  movingKmPerL: number;
  idleLPerHour: number;
  startLitres: number;
  dieselPhp: number;
  serviceSeconds: number;
  passengerSeconds: number;
  terminalSeconds: number;
  emptyStopProbability: number;
  emptyStopSeconds: number;
  extraTerminalSeconds: number;
  /**
   * Demand-aware dispatch (what advice-following drivers do at a terminal):
   * leave once this share of seats is taken; while the terminal is quieter,
   * wait for riders in steps of holdStepSeconds, up to maxHoldSeconds,
   * rather than drive a near-empty trip. Drivers without advice keep their
   * fixed habit (extraTerminalSeconds) whatever the demand.
   */
  fillShare: number;
  maxHoldSeconds: number;
  holdStepSeconds: number;
  plannerAdoption: number;
  museAdoption: number;
  boundaryPhp: number;
  /**
   * Owner-drivers: this share of the fleet (0–1) pays no boundary but its
   * own upkeep (repairs, tyres, registration, insurance) a day instead.
   */
  ownerShare: number;
  ownerUpkeepPhp: number;
  otherDailyPhp: number;
  maintenancePhpPerKm: number;
  dataPhpPerVehicleDay: number;
  serverPhpPerDay: number;
  hardwarePhpPerVehicleDay: number;
  driverQuestionsPerDay: number;
  commuterQuestionShare: number;
  inputTokens: number;
  outputTokens: number;
  cacheHitShare: number;
  voiceShare: number;
  audioSeconds: number;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  transcriptionUsdPerHour: number;
  phpPerUsd: number;
  groups: Record<Group, number>;
  fare: FareRule;
}
/**
 * Calibrated to what traditional (boundary) drivers report earning, ₱400–800
 * a day after diesel and boundary (IBON; news reports 2026): about 250
 * riders per jeepney a day, and drivers already queueing ~10 minutes at the
 * terminal to fill up. With these the no-app driver nets ~₱530/day.
 */
export const RIDERS_PER_JEEPNEY_DAY = 250;
export const DEFAULT_EXPERIMENT: Experiment = {
  days: 30,
  repetitions: 1,
  seed: 41,
  // One jeepney about every minute past a stop (a regular rider's field
  // estimate, 28 Oct 2026): a round trip of SM Tungko–SM Fairview takes
  // 80–110 minutes here, so about 100 on the corridor.
  dailyTrips: 100 * RIDERS_PER_JEEPNEY_DAY,
  vehicles: 100,
  hours: 14,
  startHour: 6,
  capacity: 22,
  speedKmh: 18,
  peakSpeedFactor: 0.65,
  movingKmPerL: 6,
  idleLPerHour: 0.8,
  startLitres: 0.02,
  dieselPhp: 94.55,
  serviceSeconds: 5,
  passengerSeconds: 1.5,
  terminalSeconds: 60,
  emptyStopProbability: 0.15,
  emptyStopSeconds: 22,
  extraTerminalSeconds: 600,
  fillShare: 0.9,
  maxHoldSeconds: 900,
  holdStepSeconds: 60,
  plannerAdoption: 0.5,
  museAdoption: 0.5,
  boundaryPhp: 700,
  // An assumption: no published figure for an owner-driver's daily upkeep.
  ownerShare: OWNER_SHARE,
  ownerUpkeepPhp: 200,
  otherDailyPhp: 100,
  maintenancePhpPerKm: 0,
  dataPhpPerVehicleDay: 5,
  serverPhpPerDay: 40,
  hardwarePhpPerVehicleDay: 1,
  driverQuestionsPerDay: 10,
  commuterQuestionShare: 0.02,
  inputTokens: 1000,
  outputTokens: 200,
  cacheHitShare: 0,
  voiceShare: 0.5,
  audioSeconds: 5,
  inputUsdPerMillion: 1.25,
  outputUsdPerMillion: 4.25,
  transcriptionUsdPerHour: 0.18,
  phpPerUsd: 58,
  groups: { regular: 0.65, student: 0.2, pwd: 0.05, senior: 0.08, pregnant: 0.02 },
  fare: { ...PH_TRADITIONAL_JEEPNEY },
};

/** Most seeded runs per experiment: 50 × 31 days × 200k trips is already minutes of work. */
export const MAX_REPETITIONS = 50;

/** Something wrong with an experiment: in plain words, and the setting it is about. */
export interface Problem {
  key: keyof Experiment | 'route';
  message: string;
}

/** Shares (0–1) whose sum is checked to be 1. */
export const groupTotal = (c: Experiment) => GROUPS.reduce((s, g) => s + c.groups[g], 0);

/** Every problem with an experiment, so the lab can show them all at once; empty when it can run. */
export function problems(c: Experiment, r: Corridor): Problem[] {
  const out: Problem[] = [];
  const check = (wrong: boolean, key: Problem['key'], message: string) => {
    if (wrong) out.push({ key, message });
  };
  for (const [key, value] of Object.entries(c))
    check(
      typeof value === 'number' && (!Number.isFinite(value) || value < 0),
      key as keyof Experiment,
      `${key} must be a number, zero or more`,
    );
  for (const key of ['days', 'repetitions', 'seed', 'dailyTrips', 'vehicles', 'capacity'] as const)
    check(!Number.isInteger(c[key]), key, `${key} must be a whole number`);
  check(c.days < 1 || c.days > 31, 'days', `Operating days: 1–31 (now ${c.days})`);
  check(
    c.repetitions < 1 || c.repetitions > MAX_REPETITIONS,
    'repetitions',
    `Seeded runs: 1–${MAX_REPETITIONS} (now ${c.repetitions})`,
  );
  check(
    c.vehicles < 1 || c.vehicles > 300,
    'vehicles',
    `Jeepneys on this one corridor: 1–300 (now ${c.vehicles}). A district's jeepneys run on many routes: simulate one route's share and scale the totals to the district.`,
  );
  check(
    c.dailyTrips > 200_000,
    'dailyTrips',
    `Trips per day: at most 200,000 (now ${c.dailyTrips})`,
  );
  check(c.capacity < 1 || c.capacity > 40, 'capacity', `Seats: 1–40 (now ${c.capacity})`);
  check(c.seed < 1 || c.seed > 2147483647, 'seed', 'Seed: a positive whole number');
  check(c.startHour > 23, 'startHour', 'Start hour: 0–23');
  check(c.hours < 1 || c.hours > 18, 'hours', `Operating hours: 1–18 (now ${c.hours})`);
  check(
    c.startHour + c.hours > 24,
    'hours',
    `The day must end by midnight: ${c.startHour}:00 + ${c.hours} h is past 24:00`,
  );
  check(c.speedKmh < 1 || c.speedKmh > 80, 'speedKmh', 'Speed: 1–80 km/h');
  check(c.movingKmPerL < 1 || c.movingKmPerL > 30, 'movingKmPerL', 'Fuel efficiency: 1–30 km/L');
  check(
    c.peakSpeedFactor <= 0 || c.peakSpeedFactor > 1,
    'peakSpeedFactor',
    'Peak speed multiplier: more than 0, at most 1',
  );
  for (const key of [
    'plannerAdoption',
    'museAdoption',
    'emptyStopProbability',
    'cacheHitShare',
    'voiceShare',
    'commuterQuestionShare',
    'fillShare',
    'ownerShare',
  ] as const)
    check(c[key] > 1, key, `${key} is a share: 0–1 (now ${c[key]})`);
  check(
    c.maxHoldSeconds > 0 && c.holdStepSeconds < 1,
    'holdStepSeconds',
    'A terminal hold needs a re-check of at least 1 second',
  );
  const total = groupTotal(c);
  check(
    GROUPS.some((g) => !Number.isFinite(c.groups[g]) || c.groups[g] < 0) ||
      Math.abs(total - 1) > 1e-8,
    'groups',
    `Passenger shares add up to ${Math.round(total * 1000) / 10}%; they must add up to 100%`,
  );
  check(
    Object.values(c.fare).some((v) => !Number.isFinite(v) || v < 0) || c.fare.discountPct > 100,
    'fare',
    'Invalid fare rule',
  );
  check(
    r.stops.length < 2 ||
      r.stops[0]!.km !== 0 ||
      r.stops.some((s, i) => !Number.isFinite(s.km) || (i > 0 && s.km <= r.stops[i - 1]!.km)),
    'route',
    'Route stops must have increasing distances starting at zero',
  );
  return out;
}

/** Throw the first problem, if any (the worker and the CLI). */
export function validate(c: Experiment, r: Corridor): void {
  const first = problems(c, r)[0];
  if (first) throw new Error(first.message);
}

export function fareCentavos(km: number, group: Group, rule = PH_TRADITIONAL_JEEPNEY): number {
  if (!Number.isFinite(km) || km < 0) throw new Error('Invalid fare distance');
  // Categories are mutually exclusive eligibility buckets. Pregnant with student/PWD
  // eligibility belongs in that eligible bucket; discounts never stack.
  return Math.round(
    fareFor(km, group === 'student' || group === 'pwd' || group === 'senior', rule) * 100,
  );
}
export interface Rider {
  id: number;
  at: number;
  origin: number;
  destination: number;
  group: Group;
  fare: number;
  km: number;
}
export interface Demand {
  queues: Rider[][];
  groupCounts: Record<Group, number>;
  hash: string;
  count: number;
}
const groupRecord = () => Object.fromEntries(GROUPS.map((g) => [g, 0])) as Record<Group, number>;
const queueKey = (stop: number, direction: number) => stop * 2 + (direction === 1 ? 0 : 1);

/** Exact requested one-way trips; sorted stratified arrivals with random OD and
 * eligibility. This is synthetic demand, NOT a population estimate. Who rides
 * changes by hour, stop and day (riderMix.ts): `c.groups` is a weekday's mix
 * as a whole; `day` (0 = a Monday) sets the weekend and the day's swing. */
export function generateDemand(c: Experiment, route: Corridor, seed: number, day = 0): Demand {
  const rng = createRng(seed);
  const n = route.stops.length;
  const queues: Rider[][] = Array.from({ length: n * 2 }, () => []);
  const groupCounts = groupRecord();
  const weights = Array.from({ length: Math.ceil(c.hours) }, (_, i) => {
    const hour = c.startHour + i;
    return (
      ((hour >= 7 && hour < 10) || (hour >= 16 && hour < 19) ? 2.5 : 1) * Math.min(1, c.hours - i)
    );
  });
  const total = weights.reduce((a, b) => a + b, 0);
  // Where riders set out, by hour (the draws below): mostly the first stop
  // of their direction, else any but the last.
  const schools = route.stops.map((s) => schoolStop(s.name));
  const fromLocal = (i: number) => (i === 0 ? 0.4 : 0) + (i < n - 1 ? 0.6 / (n - 1) : 0);
  const cal = calibrate(
    c.groups,
    weights.flatMap((weight, i) => {
      const hour = c.startHour + i;
      const outward = hour < 12 ? 0.65 : 0.35;
      return route.stops.map((_, stop) => ({
        weight: weight * (outward * fromLocal(stop) + (1 - outward) * fromLocal(n - 1 - stop)),
        hour,
        school: schools[stop]!,
      }));
    }),
  );
  let bin = 0,
    before = 0,
    hash = 2166136261;
  for (let id = 0; id < c.dailyTrips; id++) {
    const quantile = ((id + rng()) / c.dailyTrips) * total;
    while (bin < weights.length - 1 && quantile >= before + weights[bin]!)
      before += weights[bin++]!;
    const at = (bin + ((quantile - before) / weights[bin]!) * Math.min(1, c.hours - bin)) * 3600;
    const hour = c.startHour + at / 3600;
    const direction = rng() < (hour < 12 ? 0.65 : 0.35) ? 1 : -1;
    const localOrigin = rng() < 0.4 ? 0 : Math.floor(rng() * (n - 1));
    const localDest =
      rng() < 0.5 ? n - 1 : localOrigin + 1 + Math.floor(rng() * (n - localOrigin - 1));
    const origin = direction === 1 ? localOrigin : n - 1 - localOrigin;
    const destination = direction === 1 ? localDest : n - 1 - localDest;
    const group: Group = drawKind(
      mixAt(c.groups, { hour, day, school: schools[origin]! }, cal, c.seed),
      rng(),
    );
    const km = Math.abs(route.stops[destination]!.km - route.stops[origin]!.km);
    const fare = fareCentavos(km, group, c.fare);
    queues[queueKey(origin, direction)]!.push({ id, at, origin, destination, group, fare, km });
    groupCounts[group]++;
    hash =
      Math.imul(
        hash ^ Math.round(at * 1000) ^ origin ^ (destination << 8) ^ fare ^ GROUPS.indexOf(group),
        16777619,
      ) >>> 0;
  }
  return { queues, groupCounts, count: c.dailyTrips, hash: hash.toString(16) };
}

interface Vehicle {
  id: number;
  /**
   * Who goes first when two reach a stop at the same moment: its place in
   * the day's start order, so the riders there go to a different jeepney
   * each day, not always to jeepney 0.
   */
  rank: number;
  time: number;
  stop: number;
  direction: number;
  visits: number;
  aboard: { rider: Rider; boardedAt: number }[];
  revenue: number;
  km: number;
  litres: number;
  boarded: number;
  completed: number;
  /** Seconds held at the current terminal waiting for riders (demand-aware dispatch). */
  held: number;
  /** For its own ledger: one-way trips finished, seconds held, its riders' waiting, seconds driving. */
  trips: number;
  holdS: number;
  waitS: number;
  driveS: number;
  /** Whether the driver follows the advice on this terminal visit (drawn on arrival). */
  follows: boolean;
}
/** Stable min-heap: timestamp, then the day's rank. */
class Heap {
  a: Vehicle[] = [];
  before(x: Vehicle, y: Vehicle) {
    return x.time < y.time || (x.time === y.time && x.rank < y.rank);
  }
  push(v: Vehicle) {
    const a = this.a;
    a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.before(v, a[p]!)) break;
      a[i] = a[p]!;
      i = p;
    }
    a[i] = v;
  }
  pop() {
    const a = this.a,
      first = a[0]!,
      last = a.pop()!;
    if (a.length) {
      let i = 0;
      while (i * 2 + 1 < a.length) {
        let ch = i * 2 + 1;
        if (ch + 1 < a.length && this.before(a[ch + 1]!, a[ch]!)) ch++;
        if (!this.before(a[ch]!, last)) break;
        a[i] = a[ch]!;
        i = ch;
      }
      a[i] = last;
    }
    return first;
  }
}
export interface PassengerLog {
  id: number;
  group: Group;
  from: string;
  to: string;
  km: number;
  farePhp: number;
  arrivedS: number;
  boardedS: number;
  completedS: number;
  vehicle: number;
}
export interface DayResult {
  mode: Mode;
  requested: number;
  boarded: number;
  completed: number;
  unserved: number;
  revenueCentavos: number;
  groups: Record<Group, number>;
  groupRevenueCentavos: Record<Group, number>;
  waitSeconds: number;
  maxWaitSeconds: number;
  unservedWaitSeconds: number;
  journeySeconds: number;
  km: number;
  passengerKm: number;
  fuelLitres: number;
  idleSeconds: number;
  serviceStops: number;
  extraStops: number;
  extraIdleSeconds: number;
  /** Seconds advice-following drivers waited at terminals for riders. */
  holdSeconds: number;
  /** Seconds the fleet spent moving (the rest of its hours it stood: idleSeconds). */
  driveSeconds: number;
  overtimeSeconds: number;
  fuelPhp: number;
  /** Boundary paid by the drivers who do not own their jeepney. */
  boundaryPhp: number;
  /** Upkeep paid by owner-drivers instead. */
  upkeepPhp: number;
  otherPhp: number;
  appPhp: number;
  aiPhp: number;
  profitPhp: number;
  questions: number;
  apiCalls: number;
  logs: PassengerLog[];
  vehicleProfitPhp: number[];
  /** Each jeepney's own day, when asked for (the driver app); empty otherwise. */
  vehicleDays: VehicleDay[];
}

/** One jeepney's day: what its driver would see in a ledger. */
export interface VehicleDay {
  /** Riders carried to their stop (each paid at alighting). */
  riders: number;
  /** One-way trips finished, terminal to terminal. */
  trips: number;
  km: number;
  litres: number;
  fareCentavos: number;
  /** Total seconds its riders waited for it at their stops. */
  waitS: number;
  /** Seconds it waited at terminals for riders on advice. */
  holdS: number;
  /** Seconds it spent moving. */
  driveS: number;
  /** Cash after diesel, boundary, other costs and its share of app and AI costs. */
  profitPhp: number;
}

/** Whether jeepney `id` is driven by its owner in experiment `c` (fixed for the whole run). */
export function isOwner(c: Experiment, id: number): boolean {
  return hashUnit(c.seed ^ 0x6f776e72, id, 0) < c.ownerShare;
}

export function aiCost(c: Experiment, questions: number) {
  const apiCalls = questions * (1 - c.cacheHitShare);
  const text =
    (apiCalls * (c.inputTokens * c.inputUsdPerMillion + c.outputTokens * c.outputUsdPerMillion)) /
    1e6;
  // A response cache hit still needs transcription when the user speaks.
  const voice = ((questions * c.voiceShare * c.audioSeconds) / 3600) * c.transcriptionUsdPerHour;
  return { apiCalls, php: (text + voice) * c.phpPerUsd };
}
function hashUnit(seed: number, vehicle: number, visit: number) {
  let h = Math.imul(
    seed ^ Math.imul(vehicle + 1, 0x45d9f3b) ^ Math.imul(visit + 1, 0x27d4eb2d),
    0x45d9f3b,
  );
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Independent event model: no rendering, no external API calls. Modes share
 * exact passenger queues, traffic, fleet and behavioral random numbers. The
 * ONLY operational treatment is adoption reducing discretionary stops/holding. */
export function simulateDay(
  c: Experiment,
  route: Corridor,
  demand: Demand,
  seed: number,
  mode: Mode,
  logLimit = 0,
  vehicleDetail = false,
): DayResult {
  const close = c.hours * 3600,
    n = route.stops.length,
    length = route.stops[n - 1]!.km;
  const adopted = mode === 'baseline' ? 0 : mode === 'planner' ? c.plannerAdoption : c.museAdoption;
  const heads = new Int32Array(n * 2);
  const heap = new Heap();
  const result: DayResult = {
    mode,
    requested: demand.count,
    boarded: 0,
    completed: 0,
    unserved: 0,
    revenueCentavos: 0,
    groups: groupRecord(),
    groupRevenueCentavos: groupRecord(),
    waitSeconds: 0,
    maxWaitSeconds: 0,
    unservedWaitSeconds: 0,
    journeySeconds: 0,
    km: 0,
    passengerKm: 0,
    fuelLitres: 0,
    idleSeconds: 0,
    serviceStops: 0,
    extraStops: 0,
    extraIdleSeconds: 0,
    holdSeconds: 0,
    driveSeconds: 0,
    overtimeSeconds: 0,
    fuelPhp: 0,
    boundaryPhp: 0,
    upkeepPhp: 0,
    otherPhp: 0,
    appPhp: 0,
    aiPhp: 0,
    profitPhp: 0,
    questions: 0,
    apiCalls: 0,
    logs: [],
    vehicleProfitPhp: [],
    vehicleDays: [],
  };
  const fleet: Vehicle[] = [];
  const nominalLeg =
    (length / c.speedKmh) * 3600 +
    (n - 1) * c.serviceSeconds +
    c.terminalSeconds +
    c.extraTerminalSeconds;
  // The order jeepneys start in changes every day, as a terminal's line does,
  // so nobody is always the one right behind another. Same in every mode.
  const slots = Array.from({ length: c.vehicles }, (_, i) => i);
  const shuffle = createRng(seed ^ 0x2f6b9a1d);
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(shuffle() * (i + 1));
    [slots[i], slots[j]] = [slots[j]!, slots[i]!];
  }
  for (let id = 0; id < c.vehicles; id++) {
    const slot = slots[id]!;
    const direction = slot % 2 === 0 ? 1 : -1;
    const sideCount = direction === 1 ? Math.ceil(c.vehicles / 2) : Math.floor(c.vehicles / 2);
    const v: Vehicle = {
      id,
      rank: slot,
      time: (Math.floor(slot / 2) / sideCount) * nominalLeg,
      stop: direction === 1 ? 0 : n - 1,
      direction,
      visits: 0,
      aboard: [],
      revenue: 0,
      km: 0,
      litres: 0,
      boarded: 0,
      completed: 0,
      held: 0,
      follows: false,
      trips: 0,
      holdS: 0,
      driveS: 0,
      waitS: 0,
    };
    fleet.push(v);
    if (v.time < close) heap.push(v);
  }
  while (heap.a.length) {
    const v = heap.pop();
    const t = v.time;
    let off = 0,
      on = 0;
    v.aboard = v.aboard.filter(({ rider: p, boardedAt }) => {
      if (p.destination !== v.stop) return true;
      off++;
      result.completed++;
      v.completed++;
      result.revenueCentavos += p.fare;
      v.revenue += p.fare;
      result.groups[p.group]++;
      result.groupRevenueCentavos[p.group] += p.fare;
      result.passengerKm += p.km;
      result.journeySeconds += t - p.at;
      if (result.logs.length < logLimit)
        result.logs.push({
          id: p.id,
          group: p.group,
          from: route.stops[p.origin]!.name,
          to: route.stops[p.destination]!.name,
          km: p.km,
          farePhp: p.fare / 100,
          arrivedS: p.at,
          boardedS: boardedAt,
          completedS: t,
          vehicle: v.id,
        });
      return false;
    });
    if (v.stop === 0) v.direction = 1;
    else if (v.stop === n - 1) v.direction = -1;
    if (t < close) {
      const key = queueKey(v.stop, v.direction),
        q = demand.queues[key]!;
      while (v.aboard.length < c.capacity && heads[key]! < q.length && q[heads[key]!]!.at <= t) {
        const p = q[heads[key]!]!;
        heads[key] = heads[key]! + 1;
        v.aboard.push({ rider: p, boardedAt: t });
        on++;
        v.boarded++;
        result.boarded++;
        const wait = t - p.at;
        v.waitS += wait;
        result.waitSeconds += wait;
        result.maxWaitSeconds = Math.max(result.maxWaitSeconds, wait);
      }
    }
    const terminal = v.stop === 0 || v.stop === n - 1;
    // A re-check during a terminal hold: only the riders who came meanwhile board.
    const recheck = terminal && v.held > 0;
    // Arriving at a terminal after driving there ends a one-way trip.
    if (terminal && !recheck && v.visits > 0) v.trips++;
    const needed = off + on > 0 || terminal;
    const extra =
      !needed &&
      t < close &&
      hashUnit(seed, v.id, v.visits) < c.emptyStopProbability * (1 - adopted);
    v.visits++;
    let dwell = recheck
      ? on > 0
        ? c.serviceSeconds + on * c.passengerSeconds
        : 0
      : needed
        ? c.serviceSeconds + (on + off) * c.passengerSeconds
        : extra
          ? c.emptyStopSeconds
          : 0;
    if (needed && !recheck) result.serviceStops++;
    if (extra) {
      result.extraStops++;
      result.extraIdleSeconds += c.emptyStopSeconds;
    }
    if (terminal && t < close) {
      // On arrival (not on a re-check): the required dwell, and whether this
      // driver follows the advice this time.
      if (!recheck) {
        v.follows = hashUnit(seed ^ 0x5bd1e995, v.id, v.visits) < adopted;
        dwell += c.terminalSeconds;
      }
      if (!v.follows) {
        // The habit: the same wait whatever the demand.
        dwell += c.extraTerminalSeconds;
        result.extraIdleSeconds += c.extraTerminalSeconds;
      } else if (
        v.aboard.length < c.fillShare * c.capacity &&
        v.held + c.holdStepSeconds <= c.maxHoldSeconds
      ) {
        // Demand-aware: a quiet terminal, so wait a step for riders rather
        // than drive a near-empty trip. A busy one fills it and it leaves.
        const wait = dwell + c.holdStepSeconds;
        v.held += c.holdStepSeconds;
        v.holdS += c.holdStepSeconds;
        result.holdSeconds += c.holdStepSeconds;
        result.idleSeconds += wait;
        const holdFuel = (wait / 3600) * c.idleLPerHour;
        result.fuelLitres += holdFuel;
        v.litres += holdFuel;
        v.time = t + wait;
        heap.push(v);
        continue;
      }
    }
    // Leaving after a hold is moving off from a stop, even with nobody new.
    const wasStopped = dwell > 0 || recheck;
    v.held = 0;
    result.idleSeconds += dwell;
    // Start fuel is added only if the stopped vehicle actually departs again.
    const depart = t + dwell;
    const continues = depart < close || v.aboard.length > 0;
    const idleFuel = (dwell / 3600) * c.idleLPerHour;
    result.fuelLitres += idleFuel;
    v.litres += idleFuel;
    if (!continues) {
      result.overtimeSeconds += Math.max(0, depart - close);
      continue;
    }
    const next = v.stop + v.direction;
    const km = Math.abs(route.stops[next]!.km - route.stops[v.stop]!.km);
    const hour = (c.startHour + depart / 3600) % 24;
    const speed =
      c.speedKmh * ((hour >= 7 && hour < 10) || (hour >= 16 && hour < 19) ? c.peakSpeedFactor : 1);
    const fuel = km / c.movingKmPerL + (wasStopped ? c.startLitres : 0);
    v.litres += fuel;
    v.km += km;
    result.fuelLitres += fuel;
    result.km += km;
    const driveS = (km / speed) * 3600;
    v.driveS += driveS;
    result.driveSeconds += driveS;
    v.stop = next;
    v.time = depart + driveS;
    heap.push(v);
  }
  result.unserved = demand.count - result.boarded;
  for (let k = 0; k < demand.queues.length; k++)
    for (let i = heads[k]!; i < demand.queues[k]!.length; i++)
      result.unservedWaitSeconds += Math.max(0, close - demand.queues[k]![i]!.at);
  result.fuelPhp = result.fuelLitres * c.dieselPhp;
  // Who owns their jeepney: the same jeepneys every day of the experiment.
  const owners = fleet.map((v) => isOwner(c, v.id));
  const fixedOf = (i: number) => (owners[i] ? c.ownerUpkeepPhp : c.boundaryPhp);
  owners.forEach((owner, i) => {
    if (owner) result.upkeepPhp += fixedOf(i);
    else result.boundaryPhp += fixedOf(i);
  });
  result.otherPhp = c.otherDailyPhp * c.vehicles + result.km * c.maintenancePhpPerKm;
  result.appPhp =
    mode === 'baseline'
      ? 0
      : (c.dataPhpPerVehicleDay + c.hardwarePhpPerVehicleDay) * c.vehicles + c.serverPhpPerDay;
  if (mode === 'muse') {
    // Budgeted queries scale with attempted trips, including riders never served.
    result.questions =
      c.driverQuestionsPerDay * c.vehicles + demand.count * c.commuterQuestionShare;
    const cost = aiCost(c, result.questions);
    result.apiCalls = cost.apiCalls;
    result.aiPhp = cost.php;
  }
  result.profitPhp =
    result.revenueCentavos / 100 -
    result.fuelPhp -
    result.boundaryPhp -
    result.upkeepPhp -
    result.otherPhp -
    result.appPhp -
    result.aiPhp;
  result.vehicleProfitPhp = fleet.map(
    (v, i) =>
      v.revenue / 100 -
      v.litres * c.dieselPhp -
      fixedOf(i) -
      c.otherDailyPhp -
      v.km * c.maintenancePhpPerKm -
      (result.appPhp + result.aiPhp) / c.vehicles,
  );
  if (vehicleDetail)
    result.vehicleDays = fleet.map((v, i) => ({
      riders: v.completed,
      trips: v.trips,
      km: v.km,
      litres: v.litres,
      fareCentavos: v.revenue,
      waitS: v.waitS,
      holdS: v.holdS,
      driveS: v.driveS,
      profitPhp: result.vehicleProfitPhp[i]!,
    }));
  if (result.boarded !== result.completed)
    throw new Error('Passenger conservation failed: riders still aboard');
  if (result.completed + result.unserved !== demand.count)
    throw new Error('Demand conservation failed');
  if (Math.abs(result.vehicleProfitPhp.reduce((a, b) => a + b, 0) - result.profitPhp) > 0.01)
    throw new Error('Vehicle ledger does not reconcile');
  return result;
}

export interface DayLedger {
  repetition: number;
  day: number;
  seed: number;
  demandHash: string;
  results: DayResult[];
}
export interface RunResult {
  version: string;
  config: Experiment;
  route: Corridor;
  days: DayLedger[];
}
export function daySeed(c: Experiment, repetition: number, day: number) {
  return (c.seed + repetition * 100003 + day * 1009) >>> 0;
}
export function runDay(
  c: Experiment,
  route: Corridor,
  repetition: number,
  day: number,
  logLimit = 0,
  vehicleDetail = false,
): DayLedger {
  validate(c, route);
  const seed = daySeed(c, repetition, day);
  const demand = generateDemand(c, route, seed, day);
  return {
    repetition,
    day,
    seed,
    demandHash: demand.hash,
    results: MODES.map((m) => simulateDay(c, route, demand, seed, m, logLimit, vehicleDetail)),
  };
}
export function summarize(run: RunResult) {
  return MODES.map((mode) => {
    const days = run.days.flatMap((d) => d.results.filter((r) => r.mode === mode));
    const sum = (key: keyof DayResult) =>
      days.reduce((s, r) => s + (typeof r[key] === 'number' ? (r[key] as number) : 0), 0);
    const repeats = new Map<number, number>();
    for (const day of run.days)
      repeats.set(
        day.repetition,
        (repeats.get(day.repetition) ?? 0) + day.results.find((r) => r.mode === mode)!.profitPhp,
      );
    const months = [...repeats.values()].map((v) => v / run.config.vehicles).sort((a, b) => a - b);
    const q = (p: number) =>
      months[Math.min(months.length - 1, Math.floor((months.length - 1) * p))] ?? 0;
    return {
      mode,
      days: days.length,
      requested: sum('requested'),
      completed: sum('completed'),
      unserved: sum('unserved'),
      revenuePhp: sum('revenueCentavos') / 100,
      fuelPhp: sum('fuelPhp'),
      fuelLitres: sum('fuelLitres'),
      appPhp: sum('appPhp'),
      aiPhp: sum('aiPhp'),
      boundaryPhp: sum('boundaryPhp'),
      upkeepPhp: sum('upkeepPhp'),
      otherPhp: sum('otherPhp'),
      profitPhp: sum('profitPhp'),
      km: sum('km'),
      driveSeconds: sum('driveSeconds'),
      idleSeconds: sum('idleSeconds'),
      holdSeconds: sum('holdSeconds'),
      waitSeconds: sum('waitSeconds'),
      dailyPerVehicle: days.length ? sum('profitPhp') / days.length / run.config.vehicles : 0,
      meanWaitMin: sum('completed') ? sum('waitSeconds') / sum('completed') / 60 : 0,
      unservedWaitHours: sum('unservedWaitSeconds') / 3600,
      monthlyPerVehicle: months.length ? months.reduce((a, b) => a + b, 0) / months.length : 0,
      p10: q(0.1),
      p90: q(0.9),
    };
  });
}

export function ledgerCsv(run: RunResult): string {
  const header = [
    'model',
    'repetition',
    'day',
    'seed',
    'demand_hash',
    'mode',
    'requested',
    'completed',
    'unserved',
    'fare_php',
    'fuel_litres',
    'fuel_php',
    'boundary_php',
    'owner_upkeep_php',
    'other_php',
    'app_php',
    'ai_php',
    'cash_after_listed_costs_php',
    'cash_per_vehicle_php',
    'km',
    'mean_wait_boarded_min',
    'unserved_wait_hours',
    'extra_stops',
    'terminal_hold_min',
  ];
  const rows = run.days.flatMap((d) =>
    d.results.map((r) => [
      run.version,
      d.repetition + 1,
      d.day + 1,
      d.seed,
      d.demandHash,
      r.mode,
      r.requested,
      r.completed,
      r.unserved,
      r.revenueCentavos / 100,
      r.fuelLitres,
      r.fuelPhp,
      r.boundaryPhp,
      r.upkeepPhp,
      r.otherPhp,
      r.appPhp,
      r.aiPhp,
      r.profitPhp,
      r.profitPhp / run.config.vehicles,
      r.km,
      r.completed ? r.waitSeconds / r.completed / 60 : 0,
      r.unservedWaitSeconds / 3600,
      r.extraStops,
      r.holdSeconds / 60,
    ]),
  );
  return [header, ...rows].map((row) => row.join(',')).join('\n');
}
