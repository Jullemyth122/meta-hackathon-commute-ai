import { describe, expect, it } from 'vitest';
import { FrameTiming } from './frameTiming';

describe('main-view frame timing', () => {
  it('measures frame cadence rather than detector throughput', () => {
    const timing = new FrameTiming();
    for (let i = 0; i < 121; i++) timing.add(1 / 60);
    expect(timing.report?.fps).toBeCloseTo(60);
    expect(timing.report?.p95Ms).toBeCloseTo(1000 / 60);
  });
  it('includes stalls and resets after the tab is hidden', () => {
    const timing = new FrameTiming();
    for (let i = 0; i < 100; i++) timing.add(0.01);
    timing.add(1);
    expect(timing.report?.fps).toBeCloseTo(50.5);
    expect(timing.report?.longestMs).toBe(1000);
    timing.reset();
    expect(timing.report).toBeNull();
    timing.add(NaN);
    timing.add(0);
    expect(timing.report).toBeNull();
  });
});
