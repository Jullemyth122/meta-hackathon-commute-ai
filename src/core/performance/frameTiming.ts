export interface FrameReport {
  fps: number;
  p95Ms: number;
  longestMs: number;
  frames: number;
}

/** Main-view frame intervals, including stutters; independent of detector FPS. */
export class FrameTiming {
  report: FrameReport | null = null;
  private samples: number[] = [];
  private seconds = 0;

  reset(): void {
    this.report = null;
    this.samples.length = 0;
    this.seconds = 0;
  }

  add(dtS: number): void {
    if (!(dtS > 0) || !Number.isFinite(dtS)) return;
    this.samples.push(dtS * 1000);
    this.seconds += dtS;
    if (this.seconds < 2) return;
    this.samples.sort((a, b) => a - b);
    this.report = {
      fps: this.samples.length / this.seconds,
      p95Ms: this.samples[Math.ceil(this.samples.length * 0.95) - 1]!,
      longestMs: this.samples[this.samples.length - 1]!,
      frames: this.samples.length,
    };
    this.samples.length = 0;
    this.seconds = 0;
  }
}

export const viewTiming = new FrameTiming();
