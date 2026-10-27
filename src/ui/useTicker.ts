import { useEffect, useState } from 'react';

/**
 * Re-render a component `hz` times per second. Panels that display fast
 * simulation values poll with this instead of subscribing per frame: a human
 * cannot read a number that changes 60 times a second anyway.
 */
export function useTicker(hz: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000 / hz);
    return () => window.clearInterval(id);
  }, [hz]);
  return tick;
}
