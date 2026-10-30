import { useRuntimes } from '@/app/runtimeContext';
import { twinState } from '@/app/twinState';
import { approachTime, incomingMapData } from '@/scene/world/incomingMap';
import { useTicker } from './useTicker';
import '@/styles/incoming.scss';

export function IncomingStopsPanel() {
  useTicker(2);
  const { twin } = useRuntimes();
  const state = twinState(twin);
  const stops = incomingMapData(state, { view: 'twin' });
  const incoming = stops.reduce((sum, s) => sum + s.incoming.length, 0);
  const waiting = state.passengers.filter((p) => p.phase === 'waiting').length;
  return (
    <section className="section">
      <h3 className="section__title">People heading to stops</h3>
      <p>
        <strong>{waiting}</strong> waiting · <strong>{incoming}</strong> approaching within 500 m
      </p>
      <ul className="incoming-stops">
        {stops
          .filter((s) => s.incoming.length > 0)
          .slice(0, 6)
          .map((entry) => {
            const first = entry.incoming[0]!;
            const tricycles = entry.incoming.filter((p) => p.mode === 'tricycle').length;
            return (
              <li key={`${entry.stop}-${entry.direction}`}>
                <strong>
                  {state.route.stops[entry.stop]!.name}
                  {!state.route.loop && ` · ${entry.direction === 1 ? 'outbound' : 'inbound'}`}
                </strong>
                <span>
                  {entry.waiting} waiting · {entry.incoming.length} approaching
                </span>
                <span className="muted">
                  Nearest arrival in {approachTime(first.etaS)} · {Math.round(first.distanceM)} m
                </span>
                <span className="fine">
                  {entry.incoming.length - tricycles} walking · {tricycles} by tricycle
                </span>
              </li>
            );
          })}
      </ul>
      {incoming === 0 && <p className="muted">No commuters approaching within 500 m right now.</p>}
      <p className="fine">
        Simulated journeys. Teal map labels show stop counts; amber labels follow approaching
        commuters; purple labels follow people walking home from the jeepney in the evening.
        Approaching riders join the queue when they reach the stop.
      </p>
    </section>
  );
}
