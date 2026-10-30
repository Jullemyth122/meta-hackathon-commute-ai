import { describe, expect, it } from 'vitest';
import { useApp } from './store';

describe('opening the commuter’s phone', () => {
  it('leaves the camera where it is, until there is a rider to follow', () => {
    const s = useApp.getState();
    s.setView('twin');
    s.requestShot('overview');
    const shot = useApp.getState().shot;
    // Not sent to the first stop (Tungko): look around, pick a spot or someone to be.
    s.setView('commuter');
    expect(useApp.getState().shot).toEqual(shot);
    expect(useApp.getState().trackedRiderId).toBeNull();
    // Someone already in the twin, chosen to be: the camera follows them…
    s.setCommuter({ passenger: 718, chosen: true });
    expect(useApp.getState().trackedRiderId).toBe(718);
    // …and coming back to the phone later still does.
    s.setView('twin');
    s.setView('commuter');
    expect(useApp.getState().trackedRiderId).toBe(718);
  });
});
