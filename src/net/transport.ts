/**
 * How a phone's GPS reaches the dashboard.
 *
 *   firebase  phone and laptop on different networks (the real demo).
 *   loopback  two tabs in one browser, no setup (development).
 *
 * Both implement the same interface, so nothing above this layer knows or
 * cares which one is in use.
 */

import type { SessionUpdate } from '@/core/tracking/types';

export type TransportKind = 'firebase' | 'loopback';

export interface Transport {
  readonly kind: TransportKind;
  publish(update: SessionUpdate): Promise<void>;
  /** Called for every update on any session. Returns an unsubscribe function. */
  subscribe(onUpdate: (update: SessionUpdate) => void): () => void;
}

/** Basic shape check: anything from the network is untrusted until it passes. */
export function isSessionUpdate(v: unknown): v is SessionUpdate {
  const u = v as SessionUpdate | null;
  return (
    !!u &&
    typeof u.meta?.sessionId === 'string' &&
    typeof u.meta.vehicleId === 'string' &&
    typeof u.fix?.lat === 'number' &&
    typeof u.fix.lng === 'number' &&
    typeof u.fix.timestamp === 'number' &&
    typeof u.trip === 'string'
  );
}
