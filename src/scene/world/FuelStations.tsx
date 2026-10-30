/**
 * Gas stations on the map: each forecourt as mapped in OpenStreetMap, in its
 * brand's colour, flat on the ground. Their names are labels (see
 * TwinScene), which shrink to ⛽ when zoomed out so every station stays
 * findable on the whole map. One mesh, one draw call, for all of them.
 */

import { useEffect, useMemo } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  ShapeUtils,
  Vector2,
} from 'three';
import type { FuelStation } from '@/core/fuel/stations';
import { LAND_COLOR } from '@/core/map/style';
import { flat, FLAT_ORDER } from '../map/flatLayers';

/** Colours drivers recognise from the canopies (a key, not a logo). */
export const BRAND_COLOUR: Record<string, string> = {
  Petron: '#1f5fbf',
  Shell: '#e9b800',
  Caltex: '#d7262e',
  Phoenix: '#f07c1b',
  Seaoil: '#1497a8',
  'Flying V': '#b5172f',
  Unioil: '#2e9e48',
  PTT: '#2b59c3',
  Total: '#e8352b',
  Cleanfuel: '#3fae49',
  'Jade Blue': '#2f8fd8',
};
export const OTHER_COLOUR = '#6b7280';
export const brandColour = (brand: string) => BRAND_COLOUR[brand] ?? OTHER_COLOUR;

/** How much of the ground colour shows through a forecourt's brand colour. */
const TINT_OF_LAND = 0.45;

/** A station mapped only as a point gets a forecourt this size. */
const POINT_RADIUS_M = 9;

/** The forecourt as a ring of points: the mapped outline, or a circle round the point. */
function ring(st: FuelStation): Vector2[] {
  if (st.outline && st.outline.length >= 3) {
    const pts = st.outline.map((p) => new Vector2(p.x, p.z));
    // OSM closes rings by repeating the first point.
    if (pts.length > 3 && pts[0]!.equals(pts[pts.length - 1]!)) pts.pop();
    return pts;
  }
  return Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    return new Vector2(
      st.at.x + Math.cos(a) * POINT_RADIUS_M,
      st.at.z + Math.sin(a) * POINT_RADIUS_M,
    );
  });
}

function forecourts(stations: readonly FuelStation[]): BufferGeometry {
  const position: number[] = [];
  const color: number[] = [];
  const c = new Color();
  const land = new Color(LAND_COLOR);
  for (const st of stations) {
    const pts = ring(st);
    // A tint of the brand on the ground, mixed here rather than blended:
    // see the material below.
    c.set(brandColour(st.brand)).lerp(land, TINT_OF_LAND);
    for (const tri of ShapeUtils.triangulateShape(pts, [])) {
      for (const i of tri) {
        position.push(pts[i]!.x, 0, pts[i]!.y);
        color.push(c.r, c.g, c.b);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(color), 3));
  g.computeBoundingSphere();
  return g;
}

export function FuelStations({ stations }: { stations: readonly FuelStation[] }) {
  const geometry = useMemo(() => forecourts(stations), [stations]);
  // Opaque on purpose. A flat layer skips depth testing and relies on being
  // drawn before everything standing on it; a transparent material would be
  // moved to the transparent pass, drawn after the jeepneys and people, and
  // paint over them.
  const material = useMemo(
    () => flat(new MeshBasicMaterial({ vertexColors: true, side: DoubleSide })),
    [],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  if (stations.length === 0) return null;
  return <mesh geometry={geometry} material={material} renderOrder={FLAT_ORDER.fuel} />;
}
