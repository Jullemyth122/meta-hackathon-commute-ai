/**
 * The sensor lab's state: ground-truth riders (DoorwaySim) and the counting
 * pipeline that only sees the virtual cabin camera. Comparing the two is the
 * point.
 */

import { DoorwaySim } from '@/core/doorway/doorwaySim';
import { CabinPipeline } from '@/core/doorway/pipeline';
import { createRng } from '@/core/math/random';
import { CABIN, SEATS_AT } from '@/scene/jeepney/crew';
import { cabinViewFor, createCabinCamera } from '@/scene/doorway/cabinCamera';

/** What a picture-in-picture camera feed shows: a pipeline and its clock. */
export interface CameraFeed {
  pipeline: CabinPipeline | null;
  /** Simulation clock in ms. Not wall time, so a hidden tab does not skew FPS. */
  clockMs: number;
}

export class DoorwayRuntime implements CameraFeed {
  readonly sim: DoorwaySim;
  readonly pipeline: CabinPipeline;
  clockMs = 0;

  constructor(seed = 7) {
    this.sim = new DoorwaySim(createRng(seed), CABIN, SEATS_AT);
    this.pipeline = new CabinPipeline(
      createRng(seed + 1),
      this.sim.truth.inside,
      cabinViewFor(createCabinCamera()),
    );
  }
}
