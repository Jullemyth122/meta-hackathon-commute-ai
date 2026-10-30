import type { TripBudgetInputs } from '@/core/advisory/tripBudget';

const FIELDS: {
  key: Exclude<keyof TripBudgetInputs, 'stopsPerLeg'>;
  label: string;
  min: number;
  step: number;
}[] = [
  { key: 'dieselPhpPerL', label: 'Diesel price (₱/L)', min: 0.01, step: 0.1 },
  { key: 'movingKmPerL', label: 'Moving, loaded efficiency (km/L)', min: 0.1, step: 0.1 },
  { key: 'dwellSecondsPerStop', label: 'Boarding/drop-off wait (sec/stop)', min: 0, step: 1 },
  { key: 'trafficIdleMinutesPerLeg', label: 'Traffic idle (min/one-way leg)', min: 0, step: 1 },
  { key: 'terminalIdleMinutesPerLeg', label: 'Terminal idle (min/one-way leg)', min: 0, step: 1 },
  { key: 'idleLPerHour', label: 'Engine-on idle (L/hour)', min: 0, step: 0.1 },
  {
    key: 'startLitresPerStop',
    label: 'Stop/start fuel, excluding idle (L/stop)',
    min: 0,
    step: 0.001,
  },
  { key: 'otherCostsPhp', label: 'Other costs for entire run (₱)', min: 0, step: 10 },
];

export function TripBudgetSettings({
  value,
  onChange,
}: {
  value: TripBudgetInputs;
  onChange: (value: TripBudgetInputs) => void;
}) {
  return (
    <details className="trip-budget-settings">
      <summary>Trip cost assumptions</summary>
      <p className="fine">
        Illustrative inputs, not measured consumption. Replace with your loaded jeepney's
        observations and actual pump price. Waiting counts only while the engine is on.
      </p>
      <div className="trip-picker">
        {FIELDS.map((f) => (
          <label key={f.key}>
            {f.label}
            <input
              type="number"
              min={f.min}
              step={f.step}
              value={value[f.key]}
              onChange={(e) => onChange({ ...value, [f.key]: Number(e.target.value) })}
            />
          </label>
        ))}
        <label>
          Stops per one-way leg (blank = mapped stops)
          <input
            type="number"
            min={0}
            step={1}
            value={value.stopsPerLeg ?? ''}
            onChange={(e) =>
              onChange({
                ...value,
                stopsPerLeg: e.target.value === '' ? null : Number(e.target.value),
              })
            }
          />
        </label>
      </div>
      <p className="fine">
        If your measured km/L already includes stops and idling, set the extra stop/start and idle
        rates to zero. Other costs are added once for the whole run. Fare revenue is not assumed.
      </p>
    </details>
  );
}
