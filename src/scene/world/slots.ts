/**
 * Handing a fixed number of drawing slots to whichever things are nearest,
 * a few times a second, without shuffling them: a thing already in a slot
 * keeps it while it stays among the nearest, and only newcomers take the
 * slots set free. A slot's look (a jeepney's livery) then never jumps from
 * one jeepney to another, and nothing flickers as the order changes.
 */

/** A thing drawn: route and number. */
export type Slotted = readonly [number, number];

/** The slots after a refill: `prev` kept where still `nearest`, the rest of `nearest` in the gaps. */
export function keepSlots(
  prev: ReadonlyArray<Slotted | null>,
  nearest: ReadonlyArray<Slotted>,
): Array<Slotted | null> {
  const key = (s: Slotted) => `${s[0]}:${s[1]}`;
  const wanted = new Set(nearest.slice(0, prev.length).map(key));
  const next = prev.map((s) => (s && wanted.has(key(s)) ? s : null));
  const drawn = new Set(next.flatMap((s) => (s ? [key(s)] : [])));
  let free = 0;
  for (const s of nearest.slice(0, prev.length)) {
    if (drawn.has(key(s))) continue;
    while (next[free]) free++;
    next[free] = s;
  }
  return next;
}
