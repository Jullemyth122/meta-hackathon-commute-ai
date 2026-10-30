/**
 * Sensor lab: which vehicle is at the kerb, and for the modern jeepney, UV
 * Express and bus, their spec sheet (sizes, doors, seats, where they run),
 * the door camera shown, and where every figure comes from.
 */

import { useApp } from '@/app/store';
import { VEHICLES, type VehicleKind } from '@/core/vehicles/specs';
import { vehicleGeometry } from '@/scene/vehicles/vehicleGeometry';

const CHOICES: Array<['jeepney' | VehicleKind, string]> = [
  ['jeepney', 'Jeepney'],
  ['modern', 'Modern jeepney'],
  ['uv', 'UV Express'],
  ['bus', 'Bus'],
];

const m = (x: number) => `${x.toFixed(2)} m`;

export function VehiclePicker() {
  const vehicle = useApp((s) => s.labVehicle);
  const setVehicle = useApp((s) => s.setLabVehicle);
  return (
    <section className="section">
      <h3 className="section__title">Vehicle</h3>
      <div className="row">
        {CHOICES.map(([kind, label]) => (
          <button
            key={kind}
            type="button"
            className="btn"
            aria-pressed={vehicle === kind}
            onClick={() => setVehicle(kind)}
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

export function VehicleSpecPanel({ kind }: { kind: VehicleKind }) {
  const S = VEHICLES[kind];
  const door = useApp((s) => s.labDoor);
  const setDoor = useApp((s) => s.setLabDoor);
  const showFov = useApp((s) => s.showFov);
  const setShowFov = useApp((s) => s.setShowFov);
  const drawn = vehicleGeometry(kind).seats.length;
  return (
    <>
      <section className="section">
        <h3 className="section__title">{S.name}</h3>
        <p className="muted">{S.basis}</p>
        <div className="kv">
          <span>Length × width</span>
          <span className="mono">
            {m(S.lengthM)} × {m(S.widthM)}
          </span>
          <span>Height</span>
          <span className="mono">{m(S.heightM)}</span>
          <span>Wheelbase</span>
          <span className="mono">{m(S.wheelbaseM)}</span>
          <span>Tyres</span>
          <span className="mono">{S.tyre}</span>
          <span>Floor</span>
          <span className="mono">
            {m(S.floorM)} up · {m(S.headroomM)} headroom
          </span>
          <span>Riders</span>
          <span className="mono">
            {S.seats} seated{S.standing ? ` + ${S.standing} standing` : ', no standing'}
            {drawn !== S.seats && ` (${drawn} drawn)`}
          </span>
          <span>Doors</span>
          <span>
            {S.doors
              .map((d) => `${d.name}: ${m(d.x1 - d.x0)} wide, ${m(d.y1 - d.y0)} high, ${d.opens}`)
              .join(' · ')}
          </span>
          <span>Runs</span>
          <span>{S.service}</span>
        </div>
      </section>

      <section className="section">
        <h3 className="section__title">Door camera</h3>
        <p className="muted">
          An ESP32-S3-CAM in the header over each door, just inside, looking down at the steps, as
          overhead people counters are mounted: everyone getting on or off passes under it, and from
          above nobody hides behind anyone. The picture bottom right is the camera chosen here.
          {kind === 'uv' &&
            " The van's camera is only just above a ducking rider's head, so it has the module's wide-angle lens."}
        </p>
        {S.doors.length > 1 && (
          <div className="row">
            {S.doors.map((d, k) => (
              <button
                key={d.name}
                type="button"
                className="btn"
                aria-pressed={door === k}
                onClick={() => setDoor(k)}
              >
                {d.name}
              </button>
            ))}
          </div>
        )}
        <label className="toggle">
          <input type="checkbox" checked={showFov} onChange={(e) => setShowFov(e.target.checked)} />
          <span>Show what each camera sees</span>
        </label>
      </section>

      <section className="section">
        <h3 className="section__title">Where the figures come from</h3>
        <ul className="fine">
          {S.sources.map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.label}
              </a>
            </li>
          ))}
        </ul>
        <p className="fine">Not published, typical values used: {S.assumed.join('; ')}.</p>
      </section>
    </>
  );
}
