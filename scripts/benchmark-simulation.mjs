// CPU simulation timing only; GPU rendering and browser FPS must be measured in the app.
import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { TwinRuntime } = await server.ssrLoadModule('/src/app/twinRuntime.ts');
  const { defaultRoute } = await server.ssrLoadModule('/src/core/geo/routes.ts');
  const { DEFAULT_SCENARIO } = await server.ssrLoadModule('/src/core/fleet/scenario.ts');
  const rows = [];
  for (const vehicles of [10, 60, 120]) {
    for (const speed of [1, 30]) {
      const twin = new TwinRuntime(defaultRoute(), undefined, {
        ...DEFAULT_SCENARIO,
        vehicles,
        dailyTrips: vehicles === 120 ? 16000 : 8000,
      });
      for (let i = 0; i < 60; i++) twin.advance(1 / 60, (i * 1000) / 60, speed);
      const samples = [];
      for (let i = 0; i < 300; i++) {
        const started = performance.now();
        twin.advance(1 / 60, ((i + 60) * 1000) / 60, speed);
        samples.push(performance.now() - started);
      }
      samples.sort((a, b) => a - b);
      rows.push({
        vehicles,
        speed,
        people: twin.crew.passengers.size,
        meanMs: +(samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(3),
        p95Ms: +samples[Math.ceil(samples.length * 0.95) - 1].toFixed(3),
      });
    }
  }
  console.table(rows);
  if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(rows, null, 2) + '\n');
} finally {
  await server.close();
}
