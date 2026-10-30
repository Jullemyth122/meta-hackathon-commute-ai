// Offline accounting experiment; no paid API calls or rendered passenger objects.
import { createServer } from 'vite';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { DEFAULT_EXPERIMENT, MODEL_VERSION, validate, runDay, summarize, ledgerCsv } =
    await server.ssrLoadModule('/src/core/economics/model.ts');
  const { economicCorridor } = await server.ssrLoadModule('/src/core/economics/routes.ts');
  const input = value('config', null);
  const config = input
    ? JSON.parse(await readFile(input, 'utf8'))
    : structuredClone(DEFAULT_EXPERIMENT);
  for (const [flag, key] of [
    ['days', 'days'],
    ['runs', 'repetitions'],
    ['seed', 'seed'],
    ['trips', 'dailyTrips'],
    ['vehicles', 'vehicles'],
    ['muse-adoption', 'museAdoption'],
    ['cache', 'cacheHitShare'],
  ]) {
    const v = value(flag, null);
    if (v !== null) config[key] = Number(v);
  }
  const destination = value('route', 'fairview');
  if (!['fairview', 'lagro'].includes(destination))
    throw new Error('Route must be fairview or lagro');
  const route = economicCorridor(destination);
  validate(config, route);
  const out = resolve(
    value(
      'output',
      `docs/simulation-results/${destination}-${config.dailyTrips}-${config.vehicles}`,
    ),
  );
  const result = { version: MODEL_VERSION, config, route, days: [] };
  const started = performance.now();
  for (let repetition = 0; repetition < config.repetitions; repetition++)
    for (let day = 0; day < config.days; day++) {
      result.days.push(
        runDay(config, route, repetition, day, repetition === 0 && day === 0 ? 40 : 0),
      );
      if (day + 1 === config.days || result.days.length % 100 === 0)
        console.log(
          `${result.days.length}/${config.days * config.repetitions} days; ${((performance.now() - started) / 1000).toFixed(1)}s`,
        );
    }
  const summary = summarize(result);
  await mkdir(out, { recursive: true });
  await writeFile(resolve(out, 'audit.json'), JSON.stringify(result));
  await writeFile(resolve(out, 'inputs.json'), JSON.stringify(config, null, 2) + '\n');
  await writeFile(resolve(out, 'daily-ledger.csv'), ledgerCsv(result) + '\n');
  await writeFile(
    resolve(out, 'summary.json'),
    JSON.stringify(
      {
        version: MODEL_VERSION,
        elapsedSeconds: (performance.now() - started) / 1000,
        config,
        route,
        summary,
      },
      null,
      2,
    ) + '\n',
  );
  console.table(
    summary.map((s) => ({
      mode: s.mode,
      cashPerVehicleDay: s.dailyPerVehicle.toFixed(2),
      cashPerVehicleMonth: s.monthlyPerVehicle.toFixed(2),
      servedPct: ((100 * s.completed) / s.requested).toFixed(1),
      waitBoardedMin: s.meanWaitMin.toFixed(1),
      aiPhpFleetDay: (s.aiPhp / s.days).toFixed(2),
    })),
  );
  console.log(
    `Saved reproducible inputs, complete daily accounts, per-vehicle accounts and passenger samples to ${out}`,
  );
} finally {
  await server.close();
}
