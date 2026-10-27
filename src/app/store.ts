/**
 * UI state that React should re-render on. Low-frequency only: which view is
 * open, which sessions exist, which route is loaded. Per-frame values live in
 * the runtimes (twinRuntime.ts, doorwayRuntime.ts).
 */

import { create } from 'zustand';
import { defaultRoute, type Route } from '@/core/geo/routes';
import type { SessionMeta, TripPhase } from '@/core/tracking/types';
import type { TransportKind } from '@/net/transport';

export type View = 'twin' | 'doorway';
export type Backend = 'WebGPU' | 'WebGL2';

export interface SessionSummary {
  meta: SessionMeta;
  trip: TripPhase;
  lastFixAt: number;
}

/**
 * What the camera rides along with: a phone-driven jeepney or a simulated one,
 * seen from behind (chase) or from the rear step inside the cabin (inside).
 */
export type FollowTarget = ({ kind: 'live'; id: string } | { kind: 'sim'; index: number }) & {
  view?: 'chase' | 'inside' | 'pov';
};

/** A one-off camera move. `seq` changes on every request so repeats still fire. */
export interface CameraShot {
  kind: 'overview' | 'street';
  seq: number;
}

export interface MapStatus {
  state: 'off' | 'loading' | 'ready' | 'partial' | 'error';
  loaded: number;
  total: number;
  message?: string;
}

interface AppState {
  view: View;
  backend: Backend | null;
  transport: TransportKind | null;
  route: Route;
  sessions: Record<string, SessionSummary>;
  follow: FollowTarget | null;
  trackedRiderId: number | null;
  showFov: boolean;
  shot: CameraShot;
  map: MapStatus;

  setView(view: View): void;
  setBackend(backend: Backend): void;
  setTransport(kind: TransportKind): void;
  setRoute(route: Route): void;
  upsertSession(summary: SessionSummary): void;
  setFollow(target: FollowTarget | null): void;
  trackRider(id: number | null): void;
  setShowFov(show: boolean): void;
  requestShot(kind: CameraShot['kind']): void;
  setMap(status: MapStatus): void;
}

export const useApp = create<AppState>((set) => ({
  view: 'twin',
  backend: null,
  transport: null,
  route: defaultRoute(),
  sessions: {},
  follow: null,
  trackedRiderId: null,
  showFov: true,
  shot: { kind: 'street', seq: 0 },
  map: { state: 'off', loaded: 0, total: 0 },

  setView: (view) => set({ view }),
  setBackend: (backend) => set({ backend }),
  setTransport: (transport) => set({ transport }),
  // A new route invalidates whatever the camera was following.
  setRoute: (route) => set({ route, follow: null, trackedRiderId: null }),
  upsertSession: (summary) =>
    set((s) => ({ sessions: { ...s.sessions, [summary.meta.sessionId]: summary } })),
  setFollow: (follow) => set({ follow, trackedRiderId: null }),
  trackRider: (trackedRiderId) => set({ trackedRiderId, follow: null }),
  setShowFov: (showFov) => set({ showFov }),
  requestShot: (kind) =>
    set((s) => ({ shot: { kind, seq: s.shot.seq + 1 }, follow: null, trackedRiderId: null })),
  setMap: (map) => set({ map }),
}));

export function sameTarget(a: FollowTarget | null, b: FollowTarget | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind === 'live') return b.kind === 'live' && a.id === b.id;
  return b.kind === 'sim' && a.index === b.index;
}
