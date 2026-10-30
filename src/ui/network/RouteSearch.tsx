/**
 * Search the network's routes by name and focus one: the twin takes it over
 * from its flow (app/network.ts), and the phone views follow onto it.
 */

import { useMemo, useState } from 'react';
import { flowOf, focusRoute, getNetwork, routeIndex } from '@/app/network';
import { useRuntimes } from '@/app/runtimeContext';
import { useApp } from '@/app/store';
import { searchRoutes } from '@/core/network/search';

export function RouteSearch({
  placeholder = 'Search routes (e.g. Cubao, Fairview)',
}: {
  placeholder?: string;
}) {
  const { twin } = useRuntimes();
  const setFocus = useApp((s) => s.setFocus);
  const requestShot = useApp((s) => s.requestShot);
  const ready = useApp((s) => s.network.state === 'ready');
  const [query, setQuery] = useState('');
  const network = ready ? getNetwork() : null;
  const results = useMemo(() => (network ? searchRoutes(network, query, 8) : []), [network, query]);

  if (!network) return null;

  const focus = (i: number) => {
    // Already focused: keep its live jeepneys, just look at it.
    if (routeIndex(twin.route.id) !== i) setFocus(focusRoute(i, twin));
    if (useApp.getState().view === 'twin') requestShot('overview');
    setQuery('');
  };

  return (
    <div className="route-search">
      <input
        type="search"
        className="input"
        placeholder={placeholder}
        aria-label="Search routes"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {results.length > 0 && (
        <ul className="route-search__results">
          {results.map((i) => {
            const r = network.routes[i]!;
            return (
              <li key={r.route.id}>
                <button type="button" className="route-search__item" onClick={() => focus(i)}>
                  <span>{r.route.name}</span>
                  <span className="mono">
                    {(r.route.polyline.length / 1000).toFixed(0)} km · {flowOf(i).count} jeepneys
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {query.trim() !== '' && results.length === 0 && (
        <p className="fine">No route by that name.</p>
      )}
    </div>
  );
}
