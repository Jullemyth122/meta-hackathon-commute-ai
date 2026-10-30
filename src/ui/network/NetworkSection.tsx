/**
 * The operator's view of the whole Metro Manila network: how many routes
 * and jeepneys, how full they run now (estimated from the flows), the
 * focused route, and a search to focus another.
 */

import { useEffect, useState } from 'react';
import { flowOf, getNetwork, routeIndex } from '@/app/network';
import { useRuntimes } from '@/app/runtimeContext';
import { useApp } from '@/app/store';
import { RouteSearch } from './RouteSearch';

/** How often the network-wide totals are worked out again (real time). */
const TOTALS_EVERY_MS = 5_000;

/** Network-wide totals at clock t: cheap enough every few seconds (flows are formulas). */
function totals(t: number) {
  const network = getNetwork();
  if (!network) return null;
  let jeepneys = 0;
  let out = 0;
  let riders = 0;
  let seats = 0;
  network.routes.forEach((_, i) => {
    const flow = flowOf(i);
    jeepneys += flow.count;
    for (const v of flow.vehicles(t)) {
      if (!v.inService) continue;
      out++;
      riders += v.occupancy;
      seats += v.capacity;
    }
  });
  return {
    /** The simulated time these totals are for. */
    at: t,
    routes: network.routes.length,
    inFeed: network.routesInFeed,
    jeepneys,
    out,
    riders,
    seatsPct: seats ? Math.round((100 * riders) / seats) : 0,
  };
}

export function NetworkSection() {
  const { twin } = useRuntimes();
  const status = useApp((s) => s.network);
  const ready = status.state === 'ready';
  // Totals over every route's jeepneys: worked out every TOTALS_EVERY_MS of
  // real time, whatever the simulation speed and however often the panel
  // around this re-renders.
  const [latest, setLatest] = useState<ReturnType<typeof totals>>(null);
  useEffect(() => {
    if (!ready) return;
    const update = () => setLatest(totals(twin.clockS));
    update();
    const id = window.setInterval(update, TOTALS_EVERY_MS);
    return () => window.clearInterval(id);
  }, [ready, twin]);
  const sum = ready ? latest : null;
  const focused = routeIndex(twin.route.id);
  const meta = focused >= 0 ? getNetwork()?.routes[focused]?.meta : undefined;
  const hour = Math.floor((sum?.at ?? twin.clockS) / 3600) % 24;
  const minute = Math.floor(((sum?.at ?? twin.clockS) % 3600) / 60);
  // How often one passes a stop: the loop shared out among the jeepneys on
  // the road, at the speed they are making now, standing ones included.
  const out = twin.fleet.vehicles.filter((v) => v.duty !== 'parked');
  const mps = Math.max(0.5, out.reduce((n, v) => n + v.speedMps, 0) / Math.max(1, out.length));
  const passEveryMin = twin.route.polyline.length / Math.max(1, out.length) / mps / 60;

  return (
    <section className="section">
      <h3 className="section__title">Metro Manila network</h3>
      {status.state === 'loading' && <p className="fine">Loading the jeepney network…</p>}
      {status.state === 'error' && <p className="error">Network not loaded: {status.message}</p>}
      {sum && (
        <>
          {meta && (
            <div className="kv">
              <span>This route</span>
              <span>
                <strong>{twin.route.name}</strong>
              </span>
              <span>Its jeepneys</span>
              <span className="mono">
                {twin.fleet.vehicles.length} ·{' '}
                {out.length === 0
                  ? 'none out at this hour'
                  : `${out.length} out now, one about every ${passEveryMin.toFixed(1)} min`}
              </span>
            </div>
          )}
          <p className="fine">
            Simulated in full, jeepney by jeepney: the numbers you set below. The rest of the map,
            estimated:
          </p>
          <div className="kv">
            <span>All routes on the map</span>
            <span className="mono">
              {sum.routes.toLocaleString()} (of {sum.inFeed.toLocaleString()} in the GTFS feed)
            </span>
            <span>Their jeepneys, together</span>
            <span className="mono">
              ~{sum.jeepneys.toLocaleString()} (about{' '}
              {Math.round(sum.jeepneys / Math.max(1, sum.routes))} a route) ·{' '}
              {sum.out.toLocaleString()} out now
            </span>
            <span>On board now, all routes</span>
            <span className="mono">
              ~{sum.riders.toLocaleString()} riders · {sum.seatsPct}% of seats
            </span>
            <span>As of</span>
            <span className="mono">
              {String(hour).padStart(2, '0')}:{String(minute).padStart(2, '0')}
            </span>
          </div>
          <p className="fine">
            Every other route runs as an estimated flow (sized from the GTFS feed’s one jeepney a
            minute, not from LTFRB counts, which are not published). Click any jeepney on the map to
            simulate its route in full instead.
          </p>
          <RouteSearch />
          <p className="fine">
            Routes and stops: DOTC Philippine Transit GTFS (2015), via Sakay.ph; road paths by OSRM
            on OpenStreetMap. Only routes whose road path fits their 2015 stops are shown; routes
            may have changed since. Not affiliated with or endorsed by DOTC.
          </p>
        </>
      )}
    </section>
  );
}
