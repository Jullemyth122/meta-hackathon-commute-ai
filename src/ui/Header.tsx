import { useApp, type View } from '@/app/store';
import { ViewPerformance } from './ViewPerformance';

const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'twin', label: 'Live twin' },
  { id: 'driver', label: 'Driver app' },
  { id: 'commuter', label: 'Commuter app' },
  { id: 'doorway', label: 'Sensor lab' },
];

/** The Profit & service lab is the operator's: opened from the live twin, and part of it. */
const tabOf = (view: View): View => (view === 'economics' ? 'twin' : view);

export function Header() {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const backend = useApp((s) => s.backend);
  const transport = useApp((s) => s.transport);

  return (
    <header className="header">
      <div className="brand">
        <span className="brand__mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <div>
          <h1>CommuteAI</h1>
          <span className="brand__sub">GPS-anchored jeepney digital twin</span>
        </div>
      </div>

      <nav className="tabs" aria-label="Views">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            className={tabOf(view) === v.id ? 'is-on' : ''}
            aria-current={tabOf(view) === v.id ? 'page' : undefined}
            onClick={() => setView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </nav>

      <div className="header__status">
        <ViewPerformance />
        <span className="chip" title="Rendering backend">
          {backend ?? 'Starting renderer…'}
        </span>
        <span className="chip" title="How phone GPS reaches this screen">
          {transport === 'firebase'
            ? 'Firebase Realtime'
            : transport === 'loopback'
              ? 'Same-browser loopback'
              : '…'}
        </span>
        <a className="chip chip--link" href="/track.html" target="_blank" rel="noreferrer">
          Open phone tracker ↗
        </a>
      </div>
    </header>
  );
}
