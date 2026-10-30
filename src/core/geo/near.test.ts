import { describe, expect, it } from 'vitest';
import { passesNear } from './near';
import { Polyline } from './polyline';

describe('where a route passes a place', () => {
  it('finds both passes of a loop that goes out and back along one road, once each', () => {
    // Out 2 km east along z = 0, back west along z = 20 (the other carriageway).
    const loop = new Polyline([
      { x: 0, z: 0 },
      { x: 2000, z: 0 },
      { x: 2000, z: 20 },
      { x: 0, z: 20 },
      { x: 0, z: 0 },
    ]);
    const house = { x: 700, z: 50 };
    const passes = passesNear(loop, house, 80);
    expect(passes).toHaveLength(2);
    expect(passes[0]).toBeCloseTo(700, 0); // on the way out
    expect(passes[1]).toBeCloseTo(2000 + 20 + 1300, 0); // on the way back
    expect(passesNear(loop, { x: 700, z: 500 }, 80)).toEqual([]);
  });
});
