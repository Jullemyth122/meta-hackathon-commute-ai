import { describe, expect, it } from 'vitest';
import { SPEEDS, useApp } from './store';

describe('simulation speeds', () => {
  it('takes every speed offered, up to 300×, and nothing else', () => {
    for (const speed of SPEEDS) {
      useApp.getState().setSimulationSpeed(speed);
      expect(useApp.getState().simulationSpeed).toBe(speed);
    }
    useApp.getState().setSimulationSpeed(7);
    expect(useApp.getState().simulationSpeed).toBe(1);
    expect(SPEEDS).toContain(300);
  });
});
