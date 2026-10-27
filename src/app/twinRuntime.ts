/**
 * Everything the live twin simulates, kept outside React.
 *
 * React renders structure; this object holds state that changes every frame
 * (vehicle positions, interpolation). The 3D components read from it inside
 * useFrame, so a moving fleet causes zero React re-renders.
 *
 * Raw GPS history is kept per session, so swapping the route (e.g. after
 * recording one) re-matches every trace against the new road.
 */

import { FleetSim } from '@/core/fleet/fleetSim';
import { CrewState } from '@/scene/jeepney/crewState';
import type { CameraFeed } from './doorwayRuntime';
import type { Route } from '@/core/geo/routes';
import { LiveVehicle } from '@/core/tracking/liveVehicle';
import type { GpsFix, SessionUpdate } from '@/core/tracking/types';

const MAX_HISTORY = 4_000;

export class TwinRuntime {
  readonly route: Route;
  readonly fleet: FleetSim;
  /** Riders in each simulated jeepney, animated boarding and alighting. */
  readonly crew: CrewState;
  /** Cabin camera of the jeepney being ridden along with (null when none). */
  readonly cabinFeed: CameraFeed = { pipeline: null, clockMs: 0 };
  readonly live = new Map<string, LiveVehicle>();
  private readonly history = new Map<string, GpsFix[]>();

  constructor(route: Route, previous?: TwinRuntime) {
    this.route = route;
    this.fleet = new FleetSim(route);
    this.crew = new CrewState(this.fleet);
    previous?.history.forEach((fixes, id) => fixes.forEach((fix) => this.ingestFix(id, fix)));
  }

  ingest(update: SessionUpdate): void {
    this.ingestFix(update.meta.sessionId, update.fix);
  }

  step(dtS: number, nowMs: number): void {
    this.fleet.step(dtS);
    this.crew.update(dtS);
    for (const v of this.live.values()) v.update(dtS, nowMs);
  }

  /** Compact, number-only view of the twin for the assistant (/api/assist). */
  snapshot(nowMs: number): object {
    const { fleet, route } = this;
    return {
      route: {
        name: route.name,
        source: route.source,
        lengthKm: +(route.polyline.length / 1000).toFixed(2),
      },
      simulatedFleet: fleet.vehicles.map((v) => ({
        plate: v.plate,
        occupancy: v.occupancy,
        capacity: v.capacity,
        kmh: Math.round(v.speedMps * 3.6),
        nextStop: route.stops[v.nextStop]?.name,
      })),
      waitingAtStops: Object.fromEntries(route.stops.map((s, i) => [s.name, fleet.waiting[i]])),
      liveSessions: [...this.live.entries()].map(([id, v]) => ({
        sessionId: id,
        link: v.status(nowMs),
        matchedToRoute: v.matched,
        offsetFromRoadM: Number.isNaN(v.offsetM) ? null : Math.round(v.offsetM),
        kmh: Math.round(v.speedMps * 3.6),
        accuracyM: v.lastFix?.accuracyM ?? null,
      })),
    };
  }

  private ingestFix(sessionId: string, fix: GpsFix): void {
    let vehicle = this.live.get(sessionId);
    if (!vehicle) {
      vehicle = new LiveVehicle(this.route);
      this.live.set(sessionId, vehicle);
      this.history.set(sessionId, []);
    }
    const fixes = this.history.get(sessionId)!;
    fixes.push(fix);
    if (fixes.length > MAX_HISTORY) fixes.shift();
    vehicle.ingest(fix);
  }
}
