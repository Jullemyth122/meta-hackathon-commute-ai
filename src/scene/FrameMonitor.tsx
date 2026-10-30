import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { viewTiming } from '@/core/performance/frameTiming';

export function FrameMonitor() {
  const skip = useRef(true);
  useEffect(() => {
    const reset = () => {
      viewTiming.reset();
      skip.current = true;
    };
    reset();
    document.addEventListener('visibilitychange', reset);
    return () => {
      document.removeEventListener('visibilitychange', reset);
      viewTiming.reset();
    };
  }, []);
  useFrame((_, dt) => {
    if (document.hidden) return;
    if (skip.current) {
      skip.current = false;
      return;
    }
    viewTiming.add(dt);
  }, -100);
  return null;
}
