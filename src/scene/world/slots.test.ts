import { describe, expect, it } from 'vitest';
import { keepSlots, type Slotted } from './slots';

describe('drawing slots for the nearest jeepneys', () => {
  it('keeps each jeepney in its slot (so in its colour) while it stays near; newcomers fill the gaps', () => {
    const a: Slotted = [1, 0];
    const b: Slotted = [1, 1];
    const c: Slotted = [2, 5];
    const d: Slotted = [3, 2];
    let slots = keepSlots([null, null, null], [a, b, c]);
    expect(slots).toEqual([a, b, c]);
    // The order by distance changes: nobody moves.
    slots = keepSlots(slots, [c, a, b]);
    expect(slots).toEqual([a, b, c]);
    // b drives off, d comes near: d takes b's slot, a and c stay.
    slots = keepSlots(slots, [d, c, a, b]);
    expect(slots).toEqual([a, d, c]);
    // Fewer near than slots: the rest are empty.
    expect(keepSlots(slots, [c])).toEqual([null, null, c]);
  });

  it('paints a jeepney the same whichever slot it is in, over many refills', () => {
    // As NetworkLayer: a flow jeepney's livery by its own number.
    const livery = (s: Slotted): string => ['red', 'yellow', 'green'][s[1] % 3]!;
    const fleet: Slotted[] = Array.from({ length: 30 }, (_, i) => [i % 4, i]);
    const seen = new Map<string, string>();
    let slots: Array<Slotted | null> = Array(8).fill(null);
    for (let t = 0; t < 50; t++) {
      // The nearest eight change every refill.
      const nearest = [...fleet].sort(
        (x, y) => ((x[1] * 7 + t * 3) % 30) - ((y[1] * 7 + t * 3) % 30),
      );
      const before = new Map<string, number>(
        slots.flatMap((s, k) => (s ? [[`${s[0]}:${s[1]}`, k] as [string, number]] : [])),
      );
      slots = keepSlots(slots, nearest);
      slots.forEach((s, k) => {
        if (!s) return;
        const id = `${s[0]}:${s[1]}`;
        // Still near: same slot as before.
        if (before.has(id)) expect(before.get(id)).toBe(k);
        const colour = livery(s);
        expect(seen.get(id) ?? colour).toBe(colour);
        seen.set(id, colour);
      });
    }
  });
});
