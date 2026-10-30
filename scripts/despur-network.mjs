// Clean the network file's road paths of the router's out-and-back spurs
// once (src/core/network/spurs.ts), so the app does not redo it on every load.
//
//   node scripts/despur-network.mjs [public/data/metro-manila-network.json]
//
// Each path is rewritten without its spurs, its stops moved onto the clean
// path and its length updated; the file is marked spursRemoved. Running it
// again changes nothing. Writes beside the file and then renames, so a dev
// server reading it never sees half a file.

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const file = process.argv[2] ?? 'public/data/metro-manila-network.json';
const data = JSON.parse(readFileSync(file, 'utf8'));
if (data.spursRemoved) {
  console.log(`${file}: spurs already removed`);
  process.exit(0);
}

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});
const net = await server.ssrLoadModule('/src/core/network/network.ts');
const { defaultRoute } = await server.ssrLoadModule('/src/core/geo/routes.ts');
// The network shares the bundled route's projection (as the app builds it).
const projection = defaultRoute().projection;

let before = 0;
let after = 0;
for (const meta of data.routes) {
  const route = net.networkRoute(meta, projection, true);
  before += meta.length;
  meta.path = net.encodePath(route.polyline.points.map((p) => projection.toGeo(p)));
  meta.length = Math.round(route.polyline.length);
  meta.stops = meta.stops.map(([name], i) => [name, Math.round(route.stops[i].s * 10) / 10]);
  after += meta.length;
}
data.spursRemoved = true;
writeFileSync(`${file}.tmp`, JSON.stringify(data));
renameSync(`${file}.tmp`, file);
console.log(
  `${file}: ${data.routes.length} routes, ${(before / 1000).toFixed(0)} km of path → ` +
    `${(after / 1000).toFixed(0)} km (${(100 * (1 - after / before)).toFixed(1)}% was spurs)`,
);
await server.close();
