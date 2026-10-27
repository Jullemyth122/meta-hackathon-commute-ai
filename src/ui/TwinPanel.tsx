/** Side panel for the live twin: route, phone sessions, fleet, assistant. */

import type { ChangeEvent } from 'react';
import { useRuntimes } from '@/app/runtimeContext';
import { sameTarget, useApp } from '@/app/store';
import {
  DEFAULT_ROUTE_ID,
  defaultRoute,
  geographicRoute,
  parseGeoJsonRoute,
  routeToGeoJson,
  syntheticDemoRoute,
} from '@/core/geo/routes';
import type { LiveVehicle } from '@/core/tracking/liveVehicle';
import { AssistPanel } from './AssistPanel';
import { useTicker } from './useTicker';
import { PassengerPanel } from './PassengerPanel';

const ROUTE_SOURCE_LABEL = {
  synthetic: 'Synthetic, not a real road',
  osm: 'OpenStreetMap',
  recorded: 'Recorded GPS trace',
} as const;

export function TwinPanel() {
  useTicker(2);
  const { twin } = useRuntimes();
  const route = useApp((s) => s.route);
  const setRoute = useApp((s) => s.setRoute);
  const sessions = useApp((s) => s.sessions);
  const follow = useApp((s) => s.follow);
  const setFollow = useApp((s) => s.setFollow);
  const now = Date.now();

  async function loadGeoJson(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setRoute(parseGeoJsonRoute(JSON.parse(await file.text()), file.name));
    } catch (err) {
      alert(`Could not load route: ${err instanceof Error ? err.message : err}`);
    }
    e.target.value = '';
  }

  function adoptTraceAsRoute(id: string, v: LiveVehicle) {
    const proj = v.projectionInUse;
    if (!proj || v.trace.length < 2) return;
    // 4 m tolerance removes GPS wobble but keeps every real corner.
    setRoute(
      geographicRoute(
        `rec-${id}`,
        `Recorded: ${sessions[id]?.meta.vehicleId ?? id}`,
        'recorded',
        v.trace.map(proj.toGeo),
        4,
      ),
    );
  }

  const onBoard = twin.fleet.vehicles.reduce((n, v) => n + v.occupancy, 0);
  const seats = twin.fleet.vehicles.reduce((n, v) => n + v.capacity, 0);
  const waiting = twin.fleet.waiting.reduce((n, w) => n + w, 0);

  return (
    <div className="panel__body">
      <PassengerPanel />
      <section className="section">
        <h3 className="section__title">Route</h3>
        <p className="route__name">{route.name}</p>
        <div className="kv">
          <span>Source</span>
          <span className={`chip ${route.source === 'synthetic' ? 'chip--warn' : 'chip--good'}`}>
            {ROUTE_SOURCE_LABEL[route.source]}
          </span>
          <span>Length</span>
          <span className="mono">{(route.polyline.length / 1000).toFixed(2)} km</span>
          <span>Stops</span>
          <span className="mono">
            {route.stops.length}{' '}
            {route.stopsSource === 'osm'
              ? '(OpenStreetMap bus stops)'
              : '(evenly spaced placeholders)'}
          </span>
        </div>
        {route.stopsSource === 'osm' && (
          <ol className="stop-list">
            {route.stops.map((stop) => (
              <li key={stop.s}>
                <span>{stop.name}</span>
                <span className="mono">{(stop.s / 1000).toFixed(1)} km</span>
              </li>
            ))}
          </ol>
        )}
        {route.note && <p className="fine">{route.note}</p>}
        <div className="row">
          <label className="btn">
            Load route file…
            <input
              type="file"
              accept=".json,.geojson,application/geo+json"
              hidden
              onChange={loadGeoJson}
            />
          </label>
          {route.source !== 'synthetic' && (
            <button
              type="button"
              className="btn"
              onClick={() => download(`${route.id}.geojson`, routeToGeoJson(route))}
            >
              Download
            </button>
          )}
          {route.id !== DEFAULT_ROUTE_ID ? (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setRoute(defaultRoute())}
            >
              Malaria – Fairview
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setRoute(syntheticDemoRoute())}
            >
              Offline demo road
            </button>
          )}
        </div>
        {route.source === 'synthetic' && (
          <p className="fine">
            Offline demo: no map and no real road, so live GPS cannot be matched. Switch back to
            Malaria – Fairview, load a route file, or ride once and use the trace as the route.
          </p>
        )}
      </section>

      <section className="section">
        <h3 className="section__title">Phones on the road</h3>
        {Object.keys(sessions).length === 0 && (
          <p className="empty">
            No phone connected. Open{' '}
            <a href="/track.html" target="_blank" rel="noreferrer">
              the phone tracker
            </a>{' '}
            on a phone and start a session.
          </p>
        )}
        {Object.entries(sessions).map(([id, s]) => {
          const v = twin.live.get(id);
          if (!v) return null;
          const status = v.status(now);
          const ageS = v.lastFix ? Math.round((now - v.lastFix.timestamp) / 1000) : null;
          return (
            <article key={id} className={`session session--${status}`}>
              <header className="session__head">
                <b className="mono">{s.meta.vehicleId}</b>
                <span
                  className={`chip chip--${status === 'live' ? 'good' : status === 'stale' ? 'warn' : 'neutral'}`}
                >
                  {status === 'live'
                    ? 'Live'
                    : `${status === 'stale' ? 'Stale' : 'Lost'} · ${ageS}s ago`}
                </span>
              </header>
              <div className="kv">
                <span>Trip</span>
                <span>{s.trip.replace('_', ' ').toLowerCase()}</span>
                <span>Speed</span>
                <span className="mono">{(v.speedMps * 3.6).toFixed(0)} km/h</span>
                <span>GPS accuracy</span>
                <span className="mono">±{v.lastFix?.accuracyM.toFixed(0) ?? '–'} m</span>
                <span>On route</span>
                <span className="mono">
                  {route.projection
                    ? v.matched
                      ? `yes, ${v.offsetM.toFixed(0)} m off centre`
                      : 'no'
                    : 'no geographic route'}
                </span>
                <span>Fixes</span>
                <span className="mono">{v.trace.length}</span>
              </div>
              <p className="fine">
                {s.meta.source === 'passenger-consented'
                  ? 'Phone-observed: shows where this phone is. Which jeepney it is in is the rider’s confirmation, not a measurement.'
                  : 'Driver device registered to this vehicle.'}
              </p>
              <div className="row">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() =>
                    setFollow(
                      sameTarget(follow, { kind: 'live', id }) ? null : { kind: 'live', id },
                    )
                  }
                >
                  {sameTarget(follow, { kind: 'live', id }) ? 'Stop following' : 'Follow'}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={v.trace.length < 10}
                  onClick={() => adoptTraceAsRoute(id, v)}
                >
                  Use trace as route
                </button>
              </div>
            </article>
          );
        })}
      </section>

      <section className="section">
        <h3 className="section__title">Simulated fleet</h3>
        <div className="kv">
          <span>Jeepneys</span>
          <span className="mono">{twin.fleet.vehicles.length}</span>
          <span>Load factor</span>
          <span className="mono">{Math.round((100 * onBoard) / Math.max(1, seats))}%</span>
          <span>Waiting at stops</span>
          <span className="mono">{waiting}</span>
        </div>
        <div className="fleet-grid" role="list" aria-label="Simulated jeepneys">
          {twin.fleet.vehicles.map((v, index) => {
            const active = follow?.kind === 'sim' && follow.index === index;
            return (
              <button
                key={v.id}
                type="button"
                className={`btn fleet-item ${active ? 'btn--primary' : ''}`}
                aria-pressed={active}
                onClick={() =>
                  setFollow(active ? null : { kind: 'sim', index, view: follow?.view ?? 'chase' })
                }
              >
                <i className={`livery livery--${v.livery}`} aria-hidden="true" />
                <span className="mono">{v.plate}</span>
                <span className="mono fleet-item__occ">
                  {v.occupancy}/{v.capacity}
                </span>
              </button>
            );
          })}
        </div>
        <p className="fine">
          Click any jeepney on the 3D road or above to monitor it. Simulated backdrop with a fixed
          seed.
        </p>
      </section>

      <AssistPanel snapshot={() => twin.snapshot(Date.now())} />
    </div>
  );
}

function download(filename: string, data: object): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/geo+json' }),
  );
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
