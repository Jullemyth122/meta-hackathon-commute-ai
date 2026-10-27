/**
 * Map-style symbol scaling: a 7 m jeepney is under a pixel when you look at a
 * 6 km route, so vehicles and stop pins grow as the camera pulls back.
 * Close up (street view, ride-along) everything is true to scale.
 */

import type { RootState } from '@react-three/fiber';
import type { Vector3 } from 'three';

/**
 * Camera distance (m) below which symbols are drawn at true size. Street
 * level and closer is always true scale, so jeepneys sit correctly in their
 * lanes next to real-width roads.
 */
const TRUE_SCALE_WITHIN_M = 250;
/** At the whole-route overview a jeepney is then ~140 m: a readable 20–30 px symbol. */
const MAX_SCALE = 20;

export function viewScale(state: RootState): number {
  const target = (state.controls as { target?: Vector3 } | null)?.target;
  if (!target) return 1;
  const d = state.camera.position.distanceTo(target);
  return Math.min(MAX_SCALE, Math.max(1, d / TRUE_SCALE_WITHIN_M));
}
