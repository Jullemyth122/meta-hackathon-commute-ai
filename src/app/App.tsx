/**
 * Laptop dashboard. Owns the runtimes, wires the phone transport into them,
 * and lays out header / 3D viewport / side panel.
 */

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { getTransport } from '@/net';
import { DoorwayScene } from '@/scene/DoorwayScene';
import { Renderer } from '@/scene/Renderer';
import { TwinScene } from '@/scene/TwinScene';
import { DoorwayPanel } from '@/ui/DoorwayPanel';
import { Header } from '@/ui/Header';
import { PipOverlay } from '@/ui/PipOverlay';
import { TwinPanel } from '@/ui/TwinPanel';
import { ViewControls } from '@/ui/ViewControls';
import { ViewportError } from '@/ui/ViewportError';
import { DoorwayRuntime, type CameraFeed } from './doorwayRuntime';
import { RuntimeContext, type Runtimes } from './runtimeContext';
import { useApp } from './store';
import { TwinRuntime } from './twinRuntime';

export function App() {
  const view = useApp((s) => s.view);
  const route = useApp((s) => s.route);
  const setBackend = useApp((s) => s.setBackend);
  const viewport = useRef<HTMLDivElement>(null);
  // Bumped when the GPU device is lost: remounting the canvas gets a new one.
  const [gpuGeneration, setGpuGeneration] = useState(0);

  // A new route rebuilds the twin; GPS history carries over and is re-matched.
  const twinRef = useRef<TwinRuntime | null>(null);
  const twin = useMemo(() => {
    twinRef.current = new TwinRuntime(route, twinRef.current ?? undefined);
    return twinRef.current;
  }, [route]);
  const doorway = useMemo(() => new DoorwayRuntime(), []);
  const runtimes = useMemo<Runtimes>(() => ({ twin, doorway }), [twin, doorway]);

  useLiveTelemetry(twinRef);

  // Dev only: inspect the live simulation from the browser console.
  if (import.meta.env.DEV) Object.assign(window, { __commute: { runtimes, store: useApp } });

  return (
    <RuntimeContext.Provider value={runtimes}>
      <div className="app">
        <Header />
        <main className="stage">
          <div className="viewport" ref={viewport}>
            <ViewportError key={`${view}-${gpuGeneration}`}>
              <Renderer
                camera={
                  view === 'twin'
                    ? // Far enough to see a whole route plus horizon; CameraRig places it.
                      { position: [0, 2000, 2000], near: 1, far: 30_000 }
                    : { position: [-7.5, 3, 5.5], near: 0.05, far: 200 }
                }
                onBackend={setBackend}
                onLost={() => setGpuGeneration((g) => g + 1)}
              >
                {view === 'twin' ? <TwinScene /> : <DoorwayScene />}
              </Renderer>
            </ViewportError>
            {view === 'twin' && <ViewControls />}
            {view === 'doorway' && <PipOverlay container={viewport} feed={doorway} />}
            {view === 'twin' && <RideCameraOverlay container={viewport} feed={twin.cabinFeed} />}
          </div>
          <aside className="panel">{view === 'twin' ? <TwinPanel /> : <DoorwayPanel />}</aside>
        </main>
      </div>
    </RuntimeContext.Provider>
  );
}

/** The ridden jeepney's camera feed, only while riding a simulated one. */
function RideCameraOverlay({
  container,
  feed,
}: {
  container: RefObject<HTMLElement | null>;
  feed: CameraFeed;
}) {
  const riding = useApp((s) => s.follow?.kind === 'sim');
  return riding ? <PipOverlay container={container} feed={feed} /> : null;
}

/** Subscribe once to the transport and feed every phone update into the twin. */
function useLiveTelemetry(twinRef: RefObject<TwinRuntime | null>) {
  const setTransport = useApp((s) => s.setTransport);
  const upsertSession = useApp((s) => s.upsertSession);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    void getTransport().then((t) => {
      if (cancelled) return;
      setTransport(t.kind);
      unsubscribe = t.subscribe((update) => {
        twinRef.current?.ingest(update);
        upsertSession({ meta: update.meta, trip: update.trip, lastFixAt: update.fix.timestamp });
      });
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [twinRef, setTransport, upsertSession]);
}
