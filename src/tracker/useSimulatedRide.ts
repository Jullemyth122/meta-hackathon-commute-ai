/**
 * The simulated ride (simulatedRide.ts) as a stand-in for useGeolocation: a
 * fix about once a second while active. The route is loaded only when a ride
 * is simulated, so the tracker stays light for real sessions.
 */

import { useEffect, useRef, useState } from 'react';
import type { GpsFix } from '@/core/tracking/types';

const FIX_EVERY_MS = 1000;

export interface SimulatedRideState {
  /** What the ride is doing, or null before it starts. */
  status: string | null;
  error: string | null;
}

export function useSimulatedRide(
  active: boolean,
  onFix: (fix: GpsFix) => void,
): SimulatedRideState {
  const [state, setState] = useState<SimulatedRideState>({ status: null, error: null });
  const handler = useRef(onFix);
  handler.current = onFix;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer = 0;
    setState({ status: 'Loading the route…', error: null });
    Promise.all([import('@/core/geo/routes'), import('./simulatedRide')])
      .then(([{ defaultRoute }, { SimulatedRide }]) => {
        if (cancelled) return;
        const ride = new SimulatedRide(defaultRoute());
        let last = performance.now();
        const tick = () => {
          const now = performance.now();
          // Real elapsed time, so a throttled background tab still keeps pace.
          const fix = ride.advance((now - last) / 1000, Date.now());
          last = now;
          handler.current(fix);
          setState({ status: ride.describe(), error: null });
        };
        tick();
        timer = window.setInterval(tick, FIX_EVERY_MS);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setState({ status: null, error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active]);

  return state;
}
