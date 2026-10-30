import { useState } from 'react';
import { useRuntimes } from '@/app/runtimeContext';
import { useApp } from '@/app/store';
import { MAX_DAYS } from '@/app/twinRuntime';
import { normalizeScenario, SCENARIOS, type SimulationScenario } from '@/core/fleet/scenario';
import { useTicker } from './useTicker';

export function SimulationPanel() {
  useTicker(2);
  const { twin } = useRuntimes();
  const active = useApp((s) => s.scenario);
  const apply = useApp((s) => s.setScenario);
  const [draft, setDraft] = useState<SimulationScenario>(active);
  const change = (key: 'vehicles' | 'dailyTrips' | 'startHour' | 'seed', value: string) =>
    // A start hour typed in starts on the hour (the presets may start at 4:30).
    setDraft({ ...draft, [key]: Number(value), ...(key === 'startHour' && { startOffsetS: 0 }) });
  const clock = Math.floor(twin.fleet.timeOfDay);
  const waiting = twin.fleet.waiting.reduce((a, b) => a + b, 0);
  const onboard = twin.fleet.vehicles.reduce((n, v) => n + v.occupancy, 0);
  const seats = twin.fleet.vehicles.reduce((n, v) => n + v.capacity, 0);
  const stats = twin.crew.metrics;
  const longest = [...twin.crew.passengers.values()].reduce(
    (max, r) =>
      r.phase === 'waiting'
        ? Math.max(
            max,
            twin.fleet.elapsedS - (r.history.find((h) => h.phase === 'waiting')?.at ?? 0),
          )
        : max,
    0,
  );
  return (
    <section className="section simulation-panel" aria-label="Simulation scenario">
      <h3 className="section__title">Single-route simulation</h3>
      <p className="fine">
        Test demand and fleet capacity on {twin.route.name}. Presets are synthetic assumptions, not
        measured traffic.
      </p>
      <div className="row">
        {SCENARIOS.map((p) => (
          <button key={p.name} className="btn" onClick={() => setDraft({ ...p.values })}>
            {p.name}
          </button>
        ))}
      </div>
      <div className="simulation-fields">
        <label>
          Jeepneys
          <input
            type="number"
            min={1}
            max={200}
            value={draft.vehicles}
            onChange={(e) => change('vehicles', e.target.value)}
          />
        </label>
        <label>
          Expected trips / day
          <input
            type="number"
            min={0}
            max={120000}
            step={1000}
            value={draft.dailyTrips}
            onChange={(e) => change('dailyTrips', e.target.value)}
          />
        </label>
        <label className="simulation-fields__wide">
          Demand pattern
          <select
            value={draft.profile}
            onChange={(e) =>
              setDraft({ ...draft, profile: e.target.value as SimulationScenario['profile'] })
            }
          >
            <option value="commute">Morning &amp; evening peaks</option>
            <option value="flat">Uniform all day</option>
          </select>
        </label>
        <label>
          Start hour (0–23)
          <input
            type="number"
            min={0}
            max={23}
            value={draft.startHour}
            onChange={(e) => change('startHour', e.target.value)}
          />
        </label>
        <label>
          Random seed
          <input
            type="number"
            min={1}
            max={2147483647}
            value={draft.seed}
            onChange={(e) => change('seed', e.target.value)}
          />
        </label>
      </div>
      <button
        className="btn btn--primary"
        onClick={() => {
          const next = normalizeScenario(draft);
          setDraft(next);
          apply(next);
        }}
      >
        Start / restart scenario
      </button>
      <small className="fine">
        Restarts simulated trips and metrics. Arrivals follow the time of day, terminals draw three
        times an ordinary stop, and the first five minutes of riders are already waiting. Presets
        are sized to the 10–15 riders on board seen on Metro Manila jeepneys.
      </small>
      <p className="fine">Speed, pause and skipping nights: under the map, bottom left.</p>
      <div className="kv">
        <span>Simulation clock</span>
        <span className="mono">
          Day {Math.min(twin.fleet.dayNumber, MAX_DAYS)} ·{' '}
          {String(Math.floor(clock / 3600)).padStart(2, '0')}:
          {String(Math.floor(clock / 60) % 60).padStart(2, '0')}
        </span>
        <span>Active scenario</span>
        <span>
          {twin.fleet.vehicles.length} jeepneys · {active.dailyTrips.toLocaleString()} trips/day
        </span>
        <span>New arrivals</span>
        <span>{twin.fleet.generatedDemand}</span>
        <span>Waiting / approaching</span>
        <span>{waiting}</span>
        <span>Longest current wait</span>
        <span>{(longest / 60).toFixed(1)} min</span>
        <span>Average wait to board</span>
        <span>
          {stats.boarded
            ? `${(stats.waitSeconds / stats.boarded / 60).toFixed(1)} min`
            : 'No boardings yet'}
        </span>
        <span>Boarded / got off</span>
        <span>
          {stats.boarded} / {stats.alighted}
        </span>
        <span>Reached destination</span>
        <span>{stats.completed}</span>
        <span>Seats occupied</span>
        <span>
          {onboard} / {seats} ({seats ? Math.round((onboard / seats) * 100) : 0}%)
        </span>
      </div>
      <small className="fine">
        Queues are not capped. Average wait covers boarded passengers; longest wait shows people
        still waiting. Live GPS stays on real time.
      </small>
    </section>
  );
}
