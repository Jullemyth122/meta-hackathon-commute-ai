import { viewTiming } from '@/core/performance/frameTiming';
import { useTicker } from './useTicker';

export function ViewPerformance() {
  useTicker(1);
  const r = viewTiming.report;
  return (
    <span
      className="chip"
      aria-label="3D view performance"
      title={
        r
          ? `Main 3D view, last ${r.frames} frames. 95% of frames: ${r.p95Ms.toFixed(1)} ms or faster. Longest: ${r.longestMs.toFixed(1)} ms. 60 FPS needs 16.7 ms; 120 FPS needs 8.3 ms. Detector FPS is separate.`
          : 'Measuring the main 3D view while this tab is active. Detector FPS is separate.'
      }
    >
      {r ? `View ${Math.round(r.fps)} FPS · p95 ${r.p95Ms.toFixed(1)} ms` : 'View FPS: measuring…'}
    </span>
  );
}
