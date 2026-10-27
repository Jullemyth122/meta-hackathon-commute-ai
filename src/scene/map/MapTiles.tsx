/**
 * The 3D map around the route: OpenStreetMap land use, water, roads and
 * extruded buildings, streamed as vector tiles and built in Web Workers.
 *
 * Cost: ≤ 5 draw calls per tile, tiles outside the view are frustum-culled,
 * and nothing here changes per frame.
 */

import { useEffect, useMemo } from 'react';
import { Group, Mesh, MeshLambertMaterial } from 'three';
import { useApp } from '@/app/store';
import { config } from '@/config';
import { stopClearancePaths } from '@/core/people/stopLayout';
import type { Route } from '@/core/geo/routes';
import { FLAT_LAYERS, type MapLabel, type TileMeshes } from '@/core/map/buildTile';
import { tilesAround } from '@/core/map/tiles';
import { loadTiles, MAP_ZOOM } from '@/map/tileSource';
import { FLAT_ORDER, flatMapMaterial, toGeometry } from './flatLayers';

/** Map shown this far either side of the route. */
const MAP_MARGIN_M = 900;

export function MapTiles({
  route,
  onLabels,
}: {
  route: Route;
  onLabels: (labels: MapLabel[]) => void;
}) {
  const setMap = useApp((s) => s.setMap);
  const group = useMemo(() => new Group(), []);
  const materials = useMemo(
    () => ({
      ...Object.fromEntries(FLAT_LAYERS.map((l) => [l, flatMapMaterial()])),
      buildings: new MeshLambertMaterial({ vertexColors: true }),
    }),
    [],
  );

  useEffect(() => () => Object.values(materials).forEach((m) => m.dispose()), [materials]);

  useEffect(() => {
    const projection = route.projection;
    if (!projection || config.mapTiles === 'off') {
      setMap({ state: 'off', loaded: 0, total: 0 });
      return;
    }

    const tiles = tilesAround(route.polyline.points, projection, MAP_MARGIN_M, MAP_ZOOM);
    const labels: MapLabel[] = [];
    let loaded = 0;
    setMap({ state: 'loading', loaded, total: tiles.length });

    const addTile = (t: TileMeshes) => {
      for (const [layer, data] of Object.entries(t.layers)) {
        if (!data) continue;
        const mesh = new Mesh(toGeometry(data), materials[layer as keyof typeof materials]);
        mesh.matrixAutoUpdate = false; // static: never re-derive its matrix
        if (layer === 'buildings') {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        } else {
          mesh.renderOrder = FLAT_ORDER[layer as keyof typeof FLAT_ORDER];
          mesh.receiveShadow = true;
        }
        group.add(mesh);
      }
      labels.push(...t.labels);
      onLabels([...labels]);
      setMap({ state: 'loading', loaded: ++loaded, total: tiles.length });
    };

    const handle = loadTiles(
      tiles,
      projection.origin,
      addTile,
      (failed) => {
        if (failed.length === 0) setMap({ state: 'ready', loaded, total: tiles.length });
        else {
          console.warn('Map tiles failed:', failed);
          setMap({
            state: loaded > 0 ? 'partial' : 'error',
            loaded,
            total: tiles.length,
            message: failed[0]!.error,
          });
        }
      },
      route.polyline.points,
      stopClearancePaths(route),
    );

    return () => {
      handle.cancel();
      for (const child of [...group.children]) {
        (child as Mesh).geometry.dispose();
        group.remove(child);
      }
      onLabels([]);
    };
  }, [route, group, materials, setMap, onLabels]);

  return <primitive object={group} />;
}
