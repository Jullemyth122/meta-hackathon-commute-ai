/**
 * How OpenStreetMap features look in the 3D map. Keys are OpenMapTiles
 * `class` values (https://openmaptiles.org/schema/), which is the schema that
 * OpenFreeMap serves.
 *
 * Kept apart from the decoding code so the look can be tuned in one place.
 * Palette: a light "paper map" so jeepneys, stops and the route stand out.
 */

import type { Rgb } from './meshBuilder';

/**
 * '#rrggbb' (sRGB, as designers write it) -> linear 0..255 bytes, because
 * three.js treats vertex colours as linear. Skipping this washes every colour
 * out toward white.
 */
function hex(h: string): Rgb {
  const linear = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    const l = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    return Math.round(l * 255);
  };
  return [linear(1), linear(3), linear(5)];
}

export const LAND_COLOR = '#ece7dd';

/** Flat areas, drawn in this order (later covers earlier). */
export const AREA_PRIORITY = ['landcover', 'landuse', 'aeroway', 'park'] as const;

const LANDCOVER: Record<string, Rgb> = {
  wood: hex('#bfdaa9'),
  forest: hex('#bfdaa9'),
  grass: hex('#d3e8c0'),
  meadow: hex('#d3e8c0'),
  park: hex('#cfe6ba'),
  farmland: hex('#ebe9cf'),
  wetland: hex('#cfe3dc'),
  sand: hex('#f3e8c8'),
  rock: hex('#e3e0da'),
  ice: hex('#f4f6f7'),
};

const LANDUSE: Record<string, Rgb> = {
  residential: hex('#e7e2d8'),
  suburb: hex('#e7e2d8'),
  neighbourhood: hex('#e7e2d8'),
  commercial: hex('#eee2dc'),
  retail: hex('#eee2dc'),
  industrial: hex('#e4dfe6'),
  garages: hex('#e4dfe6'),
  railway: hex('#e3e0dc'),
  school: hex('#f0e7cf'),
  college: hex('#f0e7cf'),
  university: hex('#f0e7cf'),
  kindergarten: hex('#f0e7cf'),
  hospital: hex('#f2e0de'),
  cemetery: hex('#d6e3d0'),
  stadium: hex('#cde7c2'),
  pitch: hex('#cde7c2'),
  playground: hex('#cde7c2'),
  bus_station: hex('#e2dfe6'),
};

const DEFAULT_AREA = hex('#e7e2d8');

export function areaColor(layer: string, cls: string): Rgb {
  if (layer === 'park') return hex('#c9e4b4');
  if (layer === 'aeroway') return hex('#e2e0e8');
  if (layer === 'landcover') return LANDCOVER[cls] ?? DEFAULT_AREA;
  return LANDUSE[cls] ?? DEFAULT_AREA;
}

export const WATER = hex('#9fcbec');

/** Waterway line widths in metres. */
export const WATERWAY_WIDTH: Record<string, number> = {
  river: 10,
  canal: 7,
  stream: 3,
  drain: 1.6,
  ditch: 1.6,
};

/**
 * Road widths come from typical Philippine lane counts at ~3.3 m per lane plus
 * shoulders. OpenMapTiles has no lane data, but it does say `oneway`: a big
 * road mapped as two one-way lines (Quirino Highway, Commonwealth) is a
 * divided highway, and each line is one carriageway.
 */
export interface RoadStyle {
  /** Two-way road, kerb to kerb, metres. */
  width: number;
  /** One carriageway of a divided road (major classes only), metres. */
  carriageway?: number;
  fill: Rgb;
  casing: Rgb;
}

const MAJOR_CASING = hex('#d7a84f');
const MINOR_CASING = hex('#cdc6b9');
const WHITE = hex('#ffffff');

export const ROADS: Record<string, RoadStyle> = {
  // 3–4 lanes each way (NLEX, Skyway).
  motorway: { width: 26, carriageway: 14, fill: hex('#f5c766'), casing: MAJOR_CASING },
  // 3 lanes each way (EDSA-class national roads).
  trunk: { width: 22, carriageway: 12, fill: hex('#f8d27c'), casing: MAJOR_CASING },
  // 2–3 lanes each way: Quirino Highway, Regalado Avenue.
  primary: { width: 18, carriageway: 11, fill: hex('#fbdd90'), casing: MAJOR_CASING },
  // 2 lanes each way or a wide two-lane road.
  secondary: { width: 13, carriageway: 8, fill: hex('#fde9b3'), casing: MINOR_CASING },
  tertiary: { width: 9, fill: WHITE, casing: MINOR_CASING },
  busway: { width: 8, fill: WHITE, casing: MINOR_CASING },
  minor: { width: 6.5, fill: WHITE, casing: MINOR_CASING },
  service: { width: 4, fill: WHITE, casing: MINOR_CASING },
  track: { width: 3, fill: hex('#f6f1e6'), casing: MINOR_CASING },
  path: { width: 1.6, fill: hex('#f6f1e6'), casing: MINOR_CASING },
};

/** Casing is this much wider than the fill (0.9 m of kerb line each side). */
export const CASING_EXTRA_M = 1.8;

/** Visual clearance beyond rendered road edges; not a surveyed setback. */
export const BUILDING_ROAD_CLEARANCE_M = 1.5;
/** Physical fallback road width; also protects the complete driven route across tiles. */
export const ROUTE_ROAD_WIDTH_M = 9;

export const RAIL = { width: 1.8, color: hex('#9a948c') };
export const RAIL_CLASSES = new Set(['rail', 'transit']);

/** Draw order of road classes: minor roads first, so highways sit on top. */
export const ROAD_ORDER = Object.keys(ROADS).reverse();

/** Paved width of one road feature, metres. */
export function roadWidth(style: RoadStyle, oneway: boolean): number {
  return oneway && style.carriageway ? style.carriageway : style.width;
}

/** `class` values for roads; `_construction` and `_ramp` variants map to these. */
export function roadClass(cls: string): string {
  return cls.replace(/_construction$/, '');
}

const WALLS = ['#e4ddd0', '#ddd8cf', '#e8dfcc', '#d9d6d1', '#e6dccb'].map(hex);

/**
 * Roofs as seen from above in a Philippine neighbourhood: mostly painted
 * GI sheet (red oxide, blue, green) and bare grey, kept muted so the route
 * and jeepneys still stand out. Weighted toward the common ones by repetition.
 */
const ROOFS = [
  '#b8644f',
  '#b8644f',
  '#a95a49', // red oxide
  '#6f8fae',
  '#5f80a3', // blue
  '#7d9c80', // green
  '#a7a9a8',
  '#a7a9a8',
  '#b9b5ad', // bare / grey
  '#d9d2c4',
  '#d9d2c4', // concrete deck
].map(hex);

function pick<T>(list: readonly T[], seed: number, salt: number): T {
  const h = Math.imul(Math.floor(seed) ^ salt, 2654435761) >>> 0;
  return list[h % list.length]!;
}

/**
 * Wall and roof colours for one building, chosen by a hash of its position:
 * stable between reloads, varied between neighbours.
 */
export function buildingColors(seed: number): { wall: Rgb; roof: Rgb } {
  return { wall: pick(WALLS, seed, 0x9e37), roof: pick(ROOFS, seed, 0x51ed) };
}

/** OpenMapTiles fills unknown heights, but be defensive: 2 floors. */
export const DEFAULT_BUILDING_HEIGHT_M = 6;

/** Place labels shown on the map, by OpenMapTiles `place` class. */
export const LABEL_PLACES = new Set(['city', 'town', 'suburb', 'quarter', 'village']);
