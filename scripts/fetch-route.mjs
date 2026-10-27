#!/usr/bin/env node
/**
 * Build a route GeoJSON from OpenStreetMap data, once, offline.
 *
 * Two ways to get the road geometry:
 *
 *   --relation <id>   An OSM route relation (when the jeepney route is mapped).
 *   --osrm <a;b;...>  Waypoints "lng,lat;lng,lat". The road path between them
 *                     is computed by OSRM on OSM roads. Use this when the route
 *                     is not mapped as a relation (Malaria–SM Fairview is not).
 *
 * Either way, the OSM bus stops within 30 m of the line are added as Point
 * features, so the twin uses real stop locations instead of placeholders.
 *
 *   npm run route:fetch -- --osrm "121.0797210,14.7696106;121.0566115,14.7349723" \
 *     --name "Malaria – SM City Fairview" --from Malaria --to "SM City Fairview" \
 *     --out src/data/malaria-fairview.route.json
 *
 * Overpass and the OSRM demo server are shared free services: run this once
 * and commit the output, never call them from the app. Data © OpenStreetMap
 * contributors (ODbL); keep the attribution wherever the map is shown.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const OSRM = 'https://router.project-osrm.org/route/v1/driving';
const USER_AGENT = 'CommuteAI hackathon prototype (route fetch script)';
const STOP_RADIUS_M = 30;

function args() {
  const out = {
    relation: null,
    osrm: null,
    name: null,
    from: null,
    to: null,
    out: 'public/data/route.geojson',
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    if (key in out) out[key] = argv[i + 1];
  }
  const validRelation = out.relation && /^\d+$/.test(out.relation);
  if (!validRelation && !out.osrm) {
    console.error(
      'Usage: npm run route:fetch -- (--relation <id> | --osrm "lng,lat;lng,lat") ' +
        '[--name ..] [--from ..] [--to ..] [--out path]',
    );
    process.exit(1);
  }
  return out;
}

async function overpass(query) {
  const res = await fetch(OVERPASS, {
    method: 'POST',
    body: new URLSearchParams({ data: query }),
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`Overpass responded ${res.status}`);
  return res.json();
}

/**
 * Chain the relation's ways into one continuous line. OSM ways can be stored
 * in either direction, so each next way is flipped if that makes it connect.
 */
function chainWays(ways) {
  const key = (p) => `${p.lat},${p.lon}`;
  const line = [...ways[0]];
  for (const way of ways.slice(1)) {
    const end = key(line[line.length - 1]);
    if (key(way[0]) === end) line.push(...way.slice(1));
    else if (key(way[way.length - 1]) === end) line.push(...way.reverse().slice(1));
    else if (line.length === ways[0].length && key(line[0]) === key(way[0])) {
      // The first way itself was reversed.
      line.reverse();
      line.push(...way.slice(1));
    } else {
      console.warn('Gap in relation geometry; joining with a straight segment.');
      line.push(...way);
    }
  }
  return line;
}

/** @returns {Promise<{coords: number[][], props: object}>} [lng, lat] pairs */
async function fromRelation(relation) {
  const data = await overpass(
    `[out:json][timeout:60];relation(${relation});way(r);out geom;relation(${relation});out tags;`,
  );
  const rel = data.elements.find((e) => e.type === 'relation');
  const ways = data.elements.filter((e) => e.type === 'way' && e.geometry).map((w) => w.geometry);
  if (!ways.length) throw new Error('Relation has no way geometry');
  return {
    coords: chainWays(ways).map((p) => [p.lon, p.lat]),
    props: {
      name: rel?.tags?.name ?? `OSM relation ${relation}`,
      from: rel?.tags?.from,
      to: rel?.tags?.to,
      osmRelation: Number(relation),
      geometry: 'OSM route relation',
    },
  };
}

async function fromOsrm(waypoints) {
  const res = await fetch(`${OSRM}/${waypoints}?overview=full&geometries=geojson`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`OSRM responded ${res.status}`);
  const data = await res.json();
  const route = data.routes?.[0];
  if (!route) throw new Error(`OSRM found no route: ${data.code}`);
  return {
    coords: route.geometry.coordinates,
    props: {
      geometry:
        'Road path between the endpoints computed by OSRM on OpenStreetMap roads. ' +
        'Not an official route record: verify by riding.',
    },
  };
}

/** OSM bus stops near the line, as GeoJSON Points. */
async function stopsAlong(coords) {
  // Every 4th vertex is plenty for a 30 m corridor and keeps the query short.
  const sample = coords.filter((_, i) => i % 4 === 0 || i === coords.length - 1);
  const around = sample.map(([lng, lat]) => `${lat.toFixed(6)},${lng.toFixed(6)}`).join(',');
  const data = await overpass(
    `[out:json][timeout:60];(` +
      `node[highway=bus_stop](around:${STOP_RADIUS_M},${around});` +
      `node[public_transport=platform](around:${STOP_RADIUS_M},${around});` +
      `);out;`,
  );
  return data.elements.map((n) => ({
    type: 'Feature',
    properties: { name: n.tags?.name ?? null, osmNode: n.id, kind: 'stop' },
    geometry: { type: 'Point', coordinates: [n.lon, n.lat] },
  }));
}

async function main() {
  const opts = args();
  const { coords, props } = opts.osrm
    ? await fromOsrm(opts.osrm)
    : await fromRelation(opts.relation);
  const stops = await stopsAlong(coords);

  const geojson = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          ...props,
          name: opts.name ?? props.name ?? 'Unnamed route',
          from: opts.from ?? props.from ?? null,
          to: opts.to ?? props.to ?? null,
          source: 'osm',
          attribution: '© OpenStreetMap contributors',
          fetchedAt: new Date().toISOString(),
        },
        geometry: { type: 'LineString', coordinates: coords },
      },
      ...stops,
    ],
  };
  await mkdir(dirname(opts.out), { recursive: true });
  await writeFile(opts.out, JSON.stringify(geojson, null, 1) + '\n');
  console.log(`Saved ${coords.length} points and ${stops.length} stops to ${opts.out}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
