import {
  MODEL_VERSION,
  runDay,
  validate,
  type Experiment,
  type Corridor,
  type RunResult,
} from './model';

/** `vehicleDetail`: keep every jeepney's own day (the driver app; small fleets only). */
self.onmessage = (
  event: MessageEvent<{ config: Experiment; route: Corridor; vehicleDetail?: boolean }>,
) => {
  const { config, route, vehicleDetail = false } = event.data;
  try {
    validate(config, route);
    const result: RunResult = { version: MODEL_VERSION, config, route, days: [] };
    for (let repetition = 0; repetition < config.repetitions; repetition++)
      for (let day = 0; day < config.days; day++) {
        const row = runDay(
          config,
          route,
          repetition,
          day,
          repetition === 0 && day === 0 ? 40 : 0,
          vehicleDetail,
        );
        result.days.push(row);
        self.postMessage({
          type: 'progress',
          done: result.days.length,
          total: config.repetitions * config.days,
          row,
        });
      }
    self.postMessage({ type: 'complete', result });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
