/**
 * Overlay on the twin viewport: camera shots, ride-along, map status and the
 * map data credit (required by OpenStreetMap's licence and OpenFreeMap's terms).
 */

import { useRuntimes } from '@/app/runtimeContext';
import { useApp } from '@/app/store';
import { useTicker } from './useTicker';

export function ViewControls() {
  const { twin } = useRuntimes();
  const follow = useApp((s) => s.follow);
  const setFollow = useApp((s) => s.setFollow);
  const showFov = useApp((s) => s.showFov);
  const setShowFov = useApp((s) => s.setShowFov);
  const requestShot = useApp((s) => s.requestShot);
  const hasMap = useApp((s) => s.map.state !== 'off');
  const count = twin.fleet.vehicles.length;

  const view = follow?.view ?? 'chase';
  const rideNext = () =>
    setFollow({
      kind: 'sim',
      index: follow?.kind === 'sim' ? (follow.index + 1) % count : 0,
      view,
    });

  return (
    <>
      <div className="view-controls" role="toolbar" aria-label="Camera">
        <button type="button" className="btn" onClick={() => requestShot('overview')}>
          Whole route
        </button>
        <button type="button" className="btn" onClick={() => requestShot('street')}>
          Street view
        </button>
        <select
          className="btn view-controls__select"
          aria-label="Choose a jeepney to monitor"
          value={follow?.kind === 'sim' ? String(follow.index) : ''}
          onChange={(e) => {
            const val = e.target.value;
            if (val === '') setFollow(null);
            else setFollow({ kind: 'sim', index: Number(val), view });
          }}
        >
          <option value="">Choose jeepney (or click in 3D)…</option>
          {twin.fleet.vehicles.map((v, i) => (
            <option key={v.id} value={i}>
              {v.plate} ({v.occupancy}/{v.capacity})
            </option>
          ))}
        </select>
        <button type="button" className="btn btn--primary" onClick={rideNext}>
          {follow?.kind === 'sim' ? 'Next jeepney' : 'Ride a jeepney'}
        </button>
        {follow && (
          <button
            type="button"
            className="btn"
            aria-pressed={view === 'pov'}
            onClick={() => setFollow({ ...follow, view: view === 'pov' ? 'chase' : 'pov' })}
          >
            {view === 'pov' ? 'Outside view' : 'Front POV'}
          </button>
        )}
        {follow && (
          <button
            type="button"
            className="btn"
            aria-pressed={view === 'inside'}
            onClick={() => setFollow({ ...follow, view: view === 'inside' ? 'chase' : 'inside' })}
          >
            {view === 'inside' ? 'Outside view' : 'Inside view'}
          </button>
        )}
        {follow?.kind === 'sim' && view === 'chase' && (
          <button
            type="button"
            className="btn"
            aria-pressed={showFov}
            onClick={() => setShowFov(!showFov)}
          >
            {showFov ? 'Hide FOV cone' : 'Show FOV cone'}
          </button>
        )}
        {follow && (
          <button type="button" className="btn" onClick={() => setFollow(null)}>
            Stop following
          </button>
        )}
      </div>
      {follow?.kind === 'sim' && <RideCard index={follow.index} />}
      <MapStatusChip />
      {hasMap && (
        <div className="map-credit">
          ©{' '}
          <a href="https://openfreemap.org" target="_blank" rel="noreferrer">
            OpenFreeMap
          </a>{' '}
          ©{' '}
          <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">
            OpenMapTiles
          </a>{' '}
          Data ©{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            OpenStreetMap contributors
          </a>
        </div>
      )}
    </>
  );
}

/** What the followed simulated jeepney is doing right now. */
function RideCard({ index }: { index: number }) {
  useTicker(4);
  const { twin } = useRuntimes();
  const v = twin.fleet.vehicles[index];
  if (!v) return null;
  const next = twin.route.stops[v.nextStop];
  const feed = twin.cabinFeed;
  const camera = feed.pipeline?.telemetry(feed.clockMs);
  return (
    <div className="ride-card">
      <span className="ride-card__title">
        <i className={`livery livery--${v.livery}`} aria-hidden="true" />
        <b className="mono">{v.plate}</b>
        <span className="chip chip--warn">Simulated</span>
      </span>
      <span className="kv">
        <span>Speed</span>
        <span className="mono">{(v.speedMps * 3.6).toFixed(0)} km/h</span>
        <span>On board</span>
        <span className="mono">
          {v.occupancy} / {v.capacity}
        </span>
        <span>Camera estimate</span>
        <span className={`mono ${camera && camera.counts.current !== v.occupancy ? 'warn' : ''}`}>
          {camera ? `${camera.counts.current} (sees ${camera.seenNow} heads)` : '–'}
        </span>
        <span>Status</span>
        <span>{twin.crew.status(index)}</span>
        <span>{v.currentStop === null ? 'Next stop' : 'At stop'}</span>
        <span>
          {v.currentStop === null ? (next?.name ?? '–') : twin.route.stops[v.currentStop]?.name}
        </span>
      </span>
      <small className="ride-card__hint">
        Drag to rotate · Scroll to zoom · Right-drag to move · Click any jeepney
      </small>
    </div>
  );
}

function MapStatusChip() {
  const map = useApp((s) => s.map);
  if (map.state === 'ready' || map.state === 'off') return null;
  const text =
    map.state === 'loading'
      ? `Loading 3D map ${map.loaded}/${map.total}`
      : map.state === 'partial'
        ? `Map partly loaded (${map.loaded}/${map.total})`
        : 'Map unavailable (offline?). The route and fleet still work.';
  return (
    <div
      className={`map-status chip ${map.state === 'loading' ? '' : 'chip--warn'}`}
      title={map.message}
    >
      {text}
    </div>
  );
}
