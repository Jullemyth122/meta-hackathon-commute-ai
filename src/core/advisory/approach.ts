import type { ApproachMode, TwinState } from './model';

/** A person still getting to the stop, not yet part of its waiting queue. */
export interface IncomingPassenger {
  passenger: number;
  mode: ApproachMode;
  distanceM: number;
  etaS: number;
}

export const INCOMING_RADIUS_M = 500;

/** Only report known approaches within 500 m; absent estimates are not zero. */
export function incomingAtStop(
  state: TwinState,
  stop: number,
  direction?: 1 | -1,
): IncomingPassenger[] {
  return state.passengers
    .flatMap((p): IncomingPassenger[] => {
      if (
        p.phase !== 'approaching' ||
        p.vehicle !== null ||
        p.originStop !== stop ||
        (direction !== undefined && p.direction !== direction) ||
        p.distanceToStopM === undefined ||
        !Number.isFinite(p.distanceToStopM) ||
        p.distanceToStopM < 0 ||
        p.distanceToStopM > INCOMING_RADIUS_M ||
        p.arrivalInS === undefined ||
        !Number.isFinite(p.arrivalInS) ||
        p.arrivalInS < 0
      )
        return [];
      return [
        {
          passenger: p.id,
          mode: p.approachMode ?? 'walk',
          distanceM: p.distanceToStopM,
          etaS: p.arrivalInS,
        },
      ];
    })
    .sort((a, b) => a.etaS - b.etaS || a.passenger - b.passenger);
}
