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
import { CommuterPanel } from '@/ui/phone/CommuterPanel';
import { DriverPanel } from '@/ui/phone/DriverPanel';
import { MirrorFrame } from '@/ui/MirrorFrame';
import { PipOverlay } from '@/ui/PipOverlay';
import { TwinPanel } from '@/ui/TwinPanel';
import { SimDock, ViewControls } from '@/ui/ViewControls';
import { ViewportError } from '@/ui/ViewportError';
import { DoorwayRuntime, type CameraFeed } from './doorwayRuntime';
import { RuntimeContext, type Runtimes } from './runtimeContext';
import { useApp } from './store';
import { MAX_FRAME_DT_S, TwinRuntime } from './twinRuntime';
import { loadFuel, loadNetwork } from './network';
import { defaultRoute } from '@/core/geo/routes';
import { EconomicsLab } from '@/ui/EconomicsLab';

export function App() {
  const view = useApp((s) => s.view);
  const route = useApp((s) => s.route);
  const scenario = useApp((s) => s.scenario);
  const fleetStart = useApp((s) => s.fleetStart);
  const setBackend = useApp((s) => s.setBackend);
  const viewport = useRef<HTMLDivElement>(null);
  // Bumped when the GPU device is lost: remounting the canvas gets a new one.
  const [gpuGeneration, setGpuGeneration] = useState(0);

  // A new route rebuilds the twin; GPS history carries over and is re-matched.
  const twinRef = useRef<TwinRuntime | null>(null);
  const twin = useMemo(() => {
    twinRef.current = new TwinRuntime(
      route,
      twinRef.current ?? undefined,
      scenario,
      fleetStart ?? undefined,
    );
    return twinRef.current;
  }, [route, scenario, fleetStart]);
  const doorway = useMemo(() => new DoorwayRuntime(), []);
  const runtimes = useMemo<Runtimes>(() => ({ twin, doorway }), [twin, doorway]);

  useLiveTelemetry(twinRef);
  useNetwork();

  // Dev only: inspect the live simulation from the browser console.
  if (import.meta.env.DEV) Object.assign(window, { __commute: { runtimes, store: useApp } });

  // The driver and commuter apps look at the same twin, so switching between
  // them and the live twin keeps the 3D scene (and its loaded map).
  const onTwin = view !== 'doorway';
  const labVehicle = useApp((s) => s.labVehicle);
  // The Profit & service lab covers the twin rather than replacing it: the
  // canvas stays mounted (and stops drawing), so the map is not loaded again
  // on the way back.
  const economics = view === 'economics';
  // Without the twin's scene there is no frame loop to run its clock.
  useBackgroundClock(twin, !onTwin || economics);

  return (
    <RuntimeContext.Provider value={runtimes}>
      <div className="app">
        <Header />
        {economics && <EconomicsLab />}
        <main className="stage" hidden={economics}>
          <div className="viewport" ref={viewport}>
            <ViewportError key={`${onTwin ? 'twin' : 'doorway'}-${gpuGeneration}`}>
              <Renderer
                camera={
                  onTwin
                    ? // Far enough to see a whole route plus horizon; CameraRig places it.
                      { position: [0, 2000, 2000], near: 1, far: 150_000 }
                    : { position: [-7.5, 3, 5.5], near: 0.05, far: 200 }
                }
                paused={economics}
                onBackend={setBackend}
                onLost={() => setGpuGeneration((g) => g + 1)}
              >
                {onTwin ? <TwinScene /> : <DoorwayScene />}
              </Renderer>
            </ViewportError>
            {view === 'twin' && <ViewControls />}
            {(view === 'driver' || view === 'commuter') && <SimDock fuel={view === 'driver'} />}
            {view === 'doorway' && labVehicle === 'jeepney' && (
              <PipOverlay container={viewport} feed={doorway} />
            )}
            {(view === 'twin' || view === 'driver') && (
              <RideCameraOverlay container={viewport} feed={twin.cabinFeed} />
            )}
            {(view === 'twin' || view === 'driver') && <MirrorFrame container={viewport} />}
          </div>
          {!economics && (
            <aside className="panel">
              {view === 'twin' ? (
                <TwinPanel />
              ) : view === 'driver' ? (
                <DriverPanel />
              ) : view === 'commuter' ? (
                <CommuterPanel />
              ) : (
                <DoorwayPanel />
              )}
            </aside>
          )}
        </main>
      </div>
    </RuntimeContext.Provider>
  );
}

/**
 * Run the twin's clock while its scene is not drawing (the sensor lab, the
 * Profit & service lab), at the chosen speed, so the simulated day goes on
 * as it does on screen. TwinScene runs it from its frame loop otherwise.
 */
function useBackgroundClock(twin: TwinRuntime, active: boolean) {
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const { simulationSpeed, skipNight } = useApp.getState();
      const dt = Math.min((now - last) / 1000, MAX_FRAME_DT_S);
      last = now;
      twin.advance(dt, Date.now(), simulationSpeed, skipNight);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [twin, active]);
}

/** Load the Metro Manila network once, in the background; the bundled route leads it. */
function useNetwork() {
  const setNetwork = useApp((s) => s.setNetwork);
  useEffect(() => {
    let cancelled = false;
    setNetwork({ state: 'loading', routes: 0 });
    loadNetwork(defaultRoute())
      .then(async (n) => {
        if (cancelled) return;
        setNetwork({ state: 'ready', routes: n.routes.length });
        // Then every gas station in Metro Manila, for drivers on any route.
        const fuel = await loadFuel().catch(() => false);
        if (!cancelled && fuel) setNetwork({ state: 'ready', routes: n.routes.length, fuel: true });
      })
      .catch(
        (err: unknown) =>
          !cancelled && setNetwork({ state: 'error', routes: 0, message: String(err) }),
      );
    return () => {
      cancelled = true;
    };
  }, [setNetwork]);
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
