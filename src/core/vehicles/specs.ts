/**
 * The other public utility vehicles of Metro Manila, as built: the modern
 * jeepney (PUJ Class 2), the UV Express van and the city bus. Sizes from the
 * standards and makers' sheets cited in `sources`; where a figure was not
 * published (a door's width, a floor's height), the value is a typical one
 * for that body and says so in `assumed`.
 *
 * Frame for every number here: metres, ground at y = 0, +x towards the front,
 * +z the kerb side (the right: Philippine traffic keeps right, so every
 * passenger door is on +z).
 */

export type VehicleKind = 'modern' | 'uv' | 'bus';
/** Every kind in a fleet: the traditional jeepney and the others. */
export type FleetKind = 'jeepney' | VehicleKind;

export const KIND_NAME: Record<FleetKind, string> = {
  jeepney: 'Jeepney',
  modern: 'Modern jeepney',
  uv: 'UV Express',
  bus: 'Bus',
};

/**
 * The vehicles of a route's fleet of `count`. A bus or UV Express route
 * (Route.kind): all of them that kind; they run routes of their own, from
 * their own terminals. A jeepney route: jeepneys, about MODERN_SHARE of them
 * modern jeepneys (at least one in a fleet of ten or more), spread through
 * the fleet so they come out at different times and places.
 */
export function fleetKinds(count: number, routeKind: FleetKind = 'jeepney'): FleetKind[] {
  if (routeKind !== 'jeepney') return Array.from({ length: count }, () => routeKind);
  const kinds: FleetKind[] = Array.from({ length: count }, () => 'jeepney');
  if (count < 10) return kinds;
  const modern = Math.max(1, Math.round(count * MODERN_SHARE));
  for (let j = 0; j < modern; j++) kinds[Math.floor(((j + 0.5) * count) / modern)] = 'modern';
  return kinds;
}

/** Share of a jeepney route's fleet that is modern jeepneys (an assumption: the program is partway). */
export const MODERN_SHARE = 0.12;

export interface DoorSpec {
  name: string;
  /** Along the body, rear edge to front edge of the opening. */
  x0: number;
  x1: number;
  /** Bottom step and top of the opening. */
  y0: number;
  y1: number;
  /** How it opens: folding leaves, a sliding panel, or hinged (a van's front door). */
  opens: 'folding' | 'sliding' | 'hinged';
}

export interface VehicleSpec {
  kind: VehicleKind;
  name: string;
  /** What it is based on (a typical build, not one maker's product). */
  basis: string;
  lengthM: number;
  widthM: number;
  /** To the top of the roof unit. */
  heightM: number;
  wheelbaseM: number;
  /** Front and rear axle, along the body. */
  axles: readonly [number, number];
  wheelRadiusM: number;
  tyre: string;
  /** Passenger floor above the ground. */
  floorM: number;
  /** Inside, floor to ceiling. */
  headroomM: number;
  seats: number;
  /** Standing riders allowed (0 when standing is not allowed). */
  standing: number;
  doors: readonly DoorSpec[];
  /** Where it runs and what it costs, in a line. */
  service: string;
  /** Figures not published for this class of vehicle: typical values used. */
  assumed: string[];
  sources: Array<{ label: string; url: string }>;
}

/**
 * Modern jeepney, Class 2: PNS 2126:2017 caps it at 7 m × 2.35 m with 1.75 m
 * floor to ceiling; side-facing seats, standing allowed, the door on the kerb
 * side. Built on a light-truck chassis (Isuzu, Hino, Fuso, Hyundai) with a
 * minibus body: the driver over the front axle, the door just behind the
 * front wheel, an emergency door at the back.
 */
const MODERN: VehicleSpec = {
  kind: 'modern',
  name: 'Modern jeepney (Class 2)',
  basis: 'Minibus body on a light-truck chassis (PNS 2126:2017 Class 2 limits)',
  lengthM: 6.9,
  widthM: 2.2,
  heightM: 2.95,
  wheelbaseM: 3.36,
  axles: [2.35, -1.01],
  wheelRadiusM: 0.38,
  tyre: '205/85 R16, dual at the rear',
  floorM: 0.85,
  headroomM: 1.75,
  seats: 22,
  standing: 10,
  doors: [{ name: 'Door', x0: 1.0, x1: 1.85, y0: 0.42, y1: 2.45, opens: 'folding' }],
  service:
    'City routes with many stops, like the traditional jeepney; ₱17 for 4 km, then ₱2.40 a km.',
  assumed: [
    'Width 2.2 m and length 6.9 m: within the 2.35 m and 7 m limits, as typical bodies are',
    'Floor 0.85 m (two steps) and the door 0.85 m wide',
    'Wheelbase 3.36 m, a typical light-truck chassis',
  ],
  sources: [
    {
      label: 'CarGuide.ph: DTI and body makers settle on modern PUV dimensions (PNS 2126:2017)',
      url: 'https://www.carguide.ph/2018/01/dti-body-makers-settle-on-standardized.html',
    },
    {
      label: 'Wikipedia: List of modern jeepney models (Class II capacities)',
      url: 'https://en.wikipedia.org/wiki/List_of_modern_jeepney_models',
    },
    {
      label: 'Centro Manufacturing: Hino Class II modern jeepney',
      url: 'https://www.centromanufacturing.com/?p=2829',
    },
  ],
};

/**
 * UV Express: a high-roof 15-seater van (most are Nissan NV350 Urvan or
 * Toyota HiAce). Sliding door on the kerb side; fixed routes, few stops.
 */
const UV: VehicleSpec = {
  kind: 'uv',
  name: 'UV Express (15-seater van)',
  basis: 'High-roof 15-seater van, NV350 Urvan Premium figures',
  lengthM: 5.23,
  widthM: 1.88,
  heightM: 2.285,
  wheelbaseM: 2.94,
  axles: [1.665, -1.275],
  wheelRadiusM: 0.327,
  tyre: '195/70 R15',
  floorM: 0.6,
  headroomM: 1.55,
  seats: 14,
  standing: 0,
  doors: [
    { name: 'Sliding door', x0: -0.35, x1: 0.75, y0: 0.4, y1: 1.98, opens: 'sliding' },
    // The cab door, for the two seats beside the driver: over the front
    // wheel (its sill above the arch), a step outside behind the wheel.
    { name: 'Front door', x0: 1.28, x1: 1.92, y0: 0.75, y1: 1.75, opens: 'hinged' },
  ],
  service:
    'Longer point-to-point trips: loads at the terminal, drops off on the way; ₱2.60 a km. Not a Camarin route.',
  assumed: [
    'Sliding door opening 1.1 m wide (its 1.58 m height is published)',
    'Floor 0.6 m above the ground',
  ],
  sources: [
    {
      label: 'Philkotse: NV350 Urvan Premium 15-seater (5,230 × 1,880 × 2,285 mm)',
      url: 'https://philkotse.com/nissan-nv350-urvan-premium-25-15-seater-mt-price-philippines-vsid7706',
    },
    {
      label: 'Carmudi: NV350 Urvan Premium 15-seater (wheelbase 2,940 mm)',
      url: 'https://www.carmudi.com.ph/used-cars/nissan/nv350-urvan/premium-mt-15-seater-42425/',
    },
    {
      label: 'Inquirer Motoring: Urvan sliding door opening 1,580 mm high',
      url: 'https://motioncars.inquirer.net/?p=49282',
    },
    {
      label: 'Zigwheels: 15-seater, 195/70 R15 tyres',
      url: 'https://www.zigwheels.ph/new-cars/nissan/nv350-urvan/standard-15-seater',
    },
  ],
};

/**
 * City bus: a 12 m, 2.5 m wide high-floor bus, two doors on the kerb side
 * (board at the front, get off at the middle, as on EDSA), engine at the
 * back, 2+2 forward-facing seats.
 */
const BUS: VehicleSpec = {
  kind: 'bus',
  name: 'City bus (12 m)',
  basis: 'High-floor 12 m city bus, two kerb-side doors',
  lengthM: 12,
  widthM: 2.5,
  heightM: 3.45,
  wheelbaseM: 6,
  axles: [3.5, -2.5],
  wheelRadiusM: 0.53,
  tyre: '11R22.5, dual at the rear',
  floorM: 0.95,
  headroomM: 2.1,
  seats: 49,
  standing: 20,
  doors: [
    { name: 'Front door (in)', x0: 4.3, x1: 5.3, y0: 0.38, y1: 2.75, opens: 'folding' },
    { name: 'Middle door (out)', x0: -0.6, x1: 0.5, y0: 0.38, y1: 2.75, opens: 'folding' },
  ],
  service:
    'Long runs on the main roads (EDSA, Commonwealth); in at the front, out at the middle; ₱18 for 5 km, then ₱2.98 a km (air-con).',
  assumed: [
    'Sizes are those of a typical 12 m city bus (12 × 2.5 m, roof unit to 3.45 m): no official sheet for the Metro Manila fleet was found',
    'Seats 49 (2+2) and 20 standing',
  ],
  sources: [
    {
      label: 'Wikipedia: EDSA Carousel (board at the front, exit at the rear)',
      url: 'https://en.wikipedia.org/wiki/EDSA_Carousel',
    },
    {
      label: 'Autodeal: buses with left-side doors on EDSA',
      url: 'https://autodeal.com.ph/articles/car-news-philippines/buses-left-facing-doors-will-soon-become-common-sight-edsa',
    },
    {
      label: 'GTFS for Metro Manila (sakayph/gtfs): bus routes, LTFRB_PUB…',
      url: 'https://github.com/sakayph/gtfs',
    },
  ],
};

export const VEHICLES: Record<VehicleKind, VehicleSpec> = { modern: MODERN, uv: UV, bus: BUS };

/** Seats of each kind (a traditional jeepney: two facing benches of 11). */
export const seatsOf = (kind: FleetKind): number =>
  kind === 'jeepney' ? 22 : VEHICLES[kind].seats;
