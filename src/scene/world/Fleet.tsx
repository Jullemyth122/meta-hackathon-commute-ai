/** The simulated jeepneys and their riders, drawn from FleetSim state every frame. */

import { useCallback, useMemo } from 'react';
import { useApp } from '@/app/store';
import type { FleetSim } from '@/core/fleet/fleetSim';
import type { CrewState } from '../jeepney/crewState';
import { JeepneyInstances, type GroundPose } from '../jeepney/JeepneyInstances';
import { fleetPose } from './lanes';

export function Fleet({ fleet, crew }: { fleet: FleetSim; crew: CrewState }) {
  const setFollow = useApp((s) => s.setFollow);
  const liveries = useMemo(() => fleet.vehicles.map((v) => v.livery), [fleet]);
  const poseAt = useCallback((i: number, out: GroundPose) => fleetPose(fleet, i, out), [fleet]);
  const handleSelect = useCallback(
    (index: number, part: 'front' | 'body') => {
      const cur = useApp.getState().follow;
      const same = cur?.kind === 'sim' && cur.index === index;
      const view = part === 'front' && (same || cur !== null) ? 'pov' : 'chase';
      setFollow({ kind: 'sim', index, view });
    },
    [setFollow],
  );

  return (
    <JeepneyInstances
      count={fleet.vehicles.length}
      liveries={liveries}
      poseAt={poseAt}
      crew={crew}
      scaleWithView
      onSelect={handleSelect}
    />
  );
}
