/**
 * The live digital twin: the 3D map, the route, the simulated fleet, and the
 * jeepneys driven by real phones.
 */

import { MapControls } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useState } from 'react';
import { MOUSE, TOUCH } from 'three';
import { useRuntimes } from '@/app/runtimeContext';
import { useApp } from '@/app/store';
import type { MapLabel } from '@/core/map/buildTile';
import type { LiveVehicle } from '@/core/tracking/liveVehicle';
import { CameraRig } from './CameraRig';
import { FRAME_ORDER } from './frameOrder';
import { MapTiles } from './map/MapTiles';
import { Environment } from './world/Environment';
import { Fleet } from './world/Fleet';
import { Labels, type SceneLabel } from './world/Labels';
import { LiveVehicles } from './world/LiveVehicles';
import { RouteLine } from './world/RouteLine';
import { Stops } from './world/Stops';
import { CabinCameraFeed } from './world/CabinCameraFeed';

const MAX_FRAME_DT_S = 0.1;
/** Labels float above what they name: place names over rooftops, stop names over the pin. */
const PLACE_LABEL_Y = 30;
const STOP_LABEL_Y = 7.5;

const MAP_MOUSE = { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE };
const ORBIT_MOUSE = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
const MAP_TOUCHES = { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_ROTATE };
const ORBIT_TOUCHES = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };

export function TwinScene() {
  const { twin } = useRuntimes();
  const route = twin.route;
  const sessionIds = useApp((s) => Object.keys(s.sessions).join('|'));
  const mapState = useApp((s) => s.map.state);
  const follow = useApp((s) => s.follow);
  const tracked = useApp((s) => s.trackedRiderId);
  const [placeLabels, setPlaceLabels] = useState<MapLabel[]>([]);
  const following = follow !== null || tracked !== null;

  const liveEntries = useMemo(
    () =>
      sessionIds
        .split('|')
        .filter(Boolean)
        .map((id) => ({ id, vehicle: twin.live.get(id) }))
        .filter((e): e is { id: string; vehicle: LiveVehicle } => !!e.vehicle),
    [sessionIds, twin],
  );
  const liveVehicles = useMemo(() => liveEntries.map((e) => e.vehicle), [liveEntries]);
  const liveIds = useMemo(() => liveEntries.map((e) => e.id), [liveEntries]);

  const labels = useMemo<SceneLabel[]>(() => {
    const last = route.stops.length - 1;
    const stops = route.stops.map((stop, i) => {
      const p = route.polyline.pointAt(stop.s);
      return {
        text: stop.name,
        kind: i === 0 || i === last ? 'terminal' : 'stop',
        x: p.x + Math.sin(p.heading) * 8,
        y: STOP_LABEL_Y,
        z: p.z + Math.cos(p.heading) * 8,
        scaleWithView: true,
      };
    });
    const places = placeLabels.map((l) => ({ ...l, y: PLACE_LABEL_Y }));
    return [...places, ...stops];
  }, [route, placeLabels]);

  useFrame((_, dt) => twin.step(Math.min(dt, MAX_FRAME_DT_S), Date.now()), FRAME_ORDER.simulation);

  // Draw our own road only when there is no map underneath to provide one.
  const mapShowsRoads = route.projection !== null && mapState !== 'off' && mapState !== 'error';

  return (
    <>
      <Environment />
      <MapControls
        makeDefault
        enabled={follow?.view !== 'inside'}
        enableDamping={follow?.view !== 'inside'}
        maxPolarAngle={following ? Math.PI / 2.02 : Math.PI / 2.15}
        minDistance={follow?.view === 'pov' ? 0.08 : following ? 0.35 : 2}
        maxDistance={follow?.view === 'pov' ? 0.45 : 9_000}
        zoomToCursor={!following}
        mouseButtons={following ? ORBIT_MOUSE : MAP_MOUSE}
        touches={following ? ORBIT_TOUCHES : MAP_TOUCHES}
      />
      <CameraRig />
      {route.projection && <MapTiles route={route} onLabels={setPlaceLabels} />}
      <RouteLine line={route.polyline} withRoad={!mapShowsRoads} />
      <Stops fleet={twin.fleet} crew={twin.crew} />
      <Fleet fleet={twin.fleet} crew={twin.crew} />
      <LiveVehicles vehicles={liveVehicles} ids={liveIds} />
      {/* Map labels would show through the cabin walls from inside. */}
      <Labels labels={labels} hidden={follow?.view === 'inside' || follow?.view === 'pov'} />
      {follow?.kind === 'sim' && <CabinCameraFeed index={follow.index} />}
    </>
  );
}
