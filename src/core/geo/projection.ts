/**
 * Geographic <-> local scene coordinates.
 *
 * We use a local tangent plane (equirectangular) around an origin. Over the
 * ~10 km of a jeepney route the error is well under 0.1%, far below GPS noise,
 * and it is cheap enough to run per fix.
 *
 * Scene convention (Three.js): +X = east, -Z = north, +Y = up. Units: metres.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface LocalPoint {
  x: number;
  z: number;
}

export interface Projection {
  readonly origin: LatLng;
  toLocal(p: LatLng): LocalPoint;
  toGeo(p: LocalPoint): LatLng;
}

const EARTH_RADIUS_M = 6_371_008.8;
const DEG = Math.PI / 180;

export function createProjection(origin: LatLng): Projection {
  const metresPerDegLat = EARTH_RADIUS_M * DEG;
  const metresPerDegLng = metresPerDegLat * Math.cos(origin.lat * DEG);

  return {
    origin,
    toLocal: ({ lat, lng }) => ({
      x: (lng - origin.lng) * metresPerDegLng,
      z: -(lat - origin.lat) * metresPerDegLat,
    }),
    toGeo: ({ x, z }) => ({
      lat: origin.lat - z / metresPerDegLat,
      lng: origin.lng + x / metresPerDegLng,
    }),
  };
}

/** Great-circle distance in metres (haversine). Used for sanity checks. */
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}
