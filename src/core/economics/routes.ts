import { defaultRoute, type Route } from '../geo/routes';
import type { Corridor } from './model';

export function economicCorridor(destination: 'fairview' | 'lagro'): Corridor {
  const source = defaultRoute();
  const start = source.stops.findIndex((s) => /SM City San Jose del Monte/.test(s.name));
  const end = source.stops.findIndex(
    (s, i) =>
      i > start &&
      (destination === 'fairview'
        ? /SM City Fairview Jeepney Terminal/.test(s.name)
        : s.name === 'Lagro'),
  );
  if (start < 0 || end <= start) throw new Error('The mapped SM Tungko corridor was not found');
  const offset = source.stops[start]!.s;
  return {
    name: `SM Tungko ↔ ${destination === 'fairview' ? 'SM Fairview' : 'Lagro'}`,
    stops: source.stops
      .slice(start, end + 1)
      .map((s) => ({ name: s.name, km: (s.s - offset) / 1000 })),
    note: 'Outbound distances from the bundled OSM route. Return service uses the same stop distances in reverse as a simplifying assumption; actual return roads differ. No validated corridor ridership, fleet size, traffic or passenger mix.',
  };
}

/**
 * Any loop route as a corridor for the profit model: its stops from the
 * start terminal to the far one, in order (the model runs the way back over
 * the same distances).
 */
export function corridorFromRoute(route: Route): Corridor {
  const far = route.stops.findIndex((s, i) => i > 0 && s.terminal);
  const end = far > 0 ? far : route.stops.length - 1;
  const stops: Corridor['stops'] = [];
  for (const s of route.stops.slice(0, end + 1)) {
    const km = (s.s - route.stops[0]!.s) / 1000;
    if (stops.length === 0 || km > stops[stops.length - 1]!.km + 0.05)
      stops.push({ name: s.name, km });
  }
  return {
    name: `${stops[0]!.name} ↔ ${stops[stops.length - 1]!.name}`,
    stops,
    note: 'Outbound stops of the mapped route; the way back uses the same distances.',
  };
}
