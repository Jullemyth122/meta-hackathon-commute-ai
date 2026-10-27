import { describe, expect, it } from 'vitest';
import { createRng } from '../math/random';
import { DoorTransitions, PassengerCounter, SteadyCount } from './occupancy';
import { CabinPipeline, cabinSide, type CabinView } from './pipeline';

const VIEW: CabinView = { door: { x0: 140, y0: 40, x1: 180, y1: 100 }, doorHeadWidthPx: 20 };
const box = (cx: number, cy: number, w: number) => ({ cx, cy, w, h: w, score: 0.9 });

describe('cabin side', () => {
  it('treats a small head inside the door opening as outside', () => {
    expect(cabinSide(box(160, 70, 18), VIEW)).toBe('out');
  });
  it('counts a head in front of the opening, or anywhere else, as inside', () => {
    expect(cabinSide(box(160, 70, 40), VIEW)).toBe('in'); // nearer: wider
    expect(cabinSide(box(60, 150, 18), VIEW)).toBe('in');
  });
  it('is unsure about a head just in front of the doorway', () => {
    expect(cabinSide(box(160, 70, 24), VIEW)).toBe('unsure');
  });
});

describe('steady head count', () => {
  it('ignores single-frame dropouts', () => {
    const s = new SteadyCount(5);
    for (let f = 0; f < 200; f++) s.push(f * 42, f % 7 === 0 ? 4 : 5);
    expect(s.value).toBe(5);
  });

  it('accepts a change that holds', () => {
    const s = new SteadyCount(5);
    for (let f = 0; f < 60; f++) s.push(f * 42, 7);
    expect(s.value).toBe(7);
  });
});

describe('door transitions', () => {
  it('counts a track that walks in, and one that walks out', () => {
    const d = new DoorTransitions();
    const seq = (...s: Array<'in' | 'out' | 'unsure'>) => s;
    const events = seq('out', 'out', 'unsure', 'in', 'in', 'in').map((s) => d.observe(1, s));
    expect(events.filter((e) => e === 'board')).toHaveLength(1);
    const out = seq('in', 'out', 'out', 'out').map((s) => d.observe(2, s));
    expect(out.filter((e) => e === 'alight')).toHaveLength(1);
  });

  it('ignores a one-frame misclassification', () => {
    const d = new DoorTransitions();
    const events = (['out', 'out', 'in', 'out', 'out'] as const).map((s) => d.observe(1, s));
    expect(events.every((e) => e === null)).toBe(true);
  });
});

describe('passenger counter', () => {
  it('raises the count when more heads are in view than the door count allows', () => {
    const c = new PassengerCounter(2);
    const four = [1, 2, 3, 4].map((id) => ({ id, side: 'in' as const }));
    for (let f = 0; f < 60; f++) c.frame(f * 42, four, 4);
    expect(c.counts).toMatchObject({ current: 4, boarded: 0, corrections: 1 });
  });
});

describe('pipeline telemetry', () => {
  it('reports the camera frame rate even when polled while a frame is in flight', () => {
    const pipeline = new CabinPipeline(createRng(3), 0, VIEW);
    // 60 fps render loop for two seconds; poll telemetry every frame, the way
    // a panel might, which is always partway through some inference.
    let t = 0;
    for (; t < 2000; t += 1000 / 60) {
      pipeline.tick(t, () => []);
      pipeline.telemetry(t);
    }
    const stats = pipeline.telemetry(t);
    expect(stats.fps).toBeGreaterThanOrEqual(22);
    expect(stats.latencyMs).toBeGreaterThan(20);
  });
});
