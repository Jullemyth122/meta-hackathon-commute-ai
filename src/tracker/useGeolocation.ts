/**
 * Browser Geolocation as a hook. Requires a secure origin (HTTPS or localhost).
 *
 * Mobile browsers pause GPS when the screen turns off or the tab goes to the
 * background, so the tracker also holds a screen Wake Lock while running.
 */

import { useEffect, useRef, useState } from 'react';
import type { GpsFix } from '@/core/tracking/types';

export type GeoError = 'unsupported' | 'insecure' | 'denied' | 'unavailable' | 'timeout' | null;

export function useGeolocation(active: boolean, onFix: (fix: GpsFix) => void) {
  const [error, setError] = useState<GeoError>(null);
  const handler = useRef(onFix);
  handler.current = onFix;

  useEffect(() => {
    if (!active) return;
    if (!window.isSecureContext) return setError('insecure');
    if (!('geolocation' in navigator)) return setError('unsupported');

    setError(null);
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setError(null);
        handler.current({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
          speedMps: pos.coords.speed,
          headingDeg: pos.coords.heading,
          timestamp: pos.timestamp,
        });
      },
      (err) => setError(err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable'),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [active]);

  return error;
}

/** Keep the screen on while tracking; silently does nothing where unsupported. */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const acquire = () =>
      navigator.wakeLock
        .request('screen')
        .then((l) => (lock = l))
        .catch(() => undefined);
    // The lock is dropped whenever the page is hidden; re-acquire on return.
    const onVisible = () => document.visibilityState === 'visible' && void acquire();
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release();
    };
  }, [active]);
}
