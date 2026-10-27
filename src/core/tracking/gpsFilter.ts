/**
 * Turns raw fixes into "how fast is this phone really moving".
 *
 * The trap this avoids: two fixes 3 s apart, each ±10 m, can show 10 m of
 * movement for a phone lying on a table. That is 12 km/h of fake speed. So a
 * displacement only counts when it is larger than the combined uncertainty.
 */

import { haversineM } from '../geo/projection';
import type { GpsFix } from './types';

export interface FilterConfig {
  /** Fixes worse than this are ignored entirely. */
  maxAccuracyM: number;
  /** How far back the speed estimate looks. */
  windowMs: number;
}

export const DEFAULT_FILTER: FilterConfig = {
  maxAccuracyM: 35,
  windowMs: 15_000,
};

export interface MotionEstimate {
  /** Best speed estimate, m/s. 0 when movement is within GPS noise. */
  speedMps: number;
  /** Good fixes inside the window. */
  goodFixes: number;
  /** Time span the window actually covers, ms. */
  spanMs: number;
  /** True when displacement over the window exceeds the noise floor. */
  significant: boolean;
}

export class GpsFilter {
  private readonly window: GpsFix[] = [];
  private readonly config: FilterConfig;

  constructor(config: FilterConfig = DEFAULT_FILTER) {
    this.config = config;
  }

  /** Returns false when the fix was rejected (inaccurate, invalid, or out of order). */
  push(fix: GpsFix): boolean {
    if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return false;
    if (fix.accuracyM > this.config.maxAccuracyM) return false;
    const last = this.window[this.window.length - 1];
    if (last && fix.timestamp <= last.timestamp) return false;

    this.window.push(fix);
    const cutoff = fix.timestamp - this.config.windowMs;
    while (this.window.length && this.window[0]!.timestamp < cutoff) this.window.shift();
    return true;
  }

  estimate(): MotionEstimate {
    const n = this.window.length;
    if (n < 2) return { speedMps: 0, goodFixes: n, spanMs: 0, significant: false };

    const first = this.window[0]!;
    const last = this.window[n - 1]!;
    const spanMs = last.timestamp - first.timestamp;
    const displacement = haversineM(first, last);
    const significant = displacement > Math.hypot(first.accuracyM, last.accuracyM);

    // Prefer the median device speed when the platform provides it for most
    // fixes: it is Doppler-derived and far less noisy than differencing.
    const deviceSpeeds = this.window
      .map((f) => f.speedMps)
      .filter((v): v is number => v !== null && Number.isFinite(v))
      .sort((a, b) => a - b);
    const deviceSpeed =
      deviceSpeeds.length >= n / 2 ? deviceSpeeds[Math.floor(deviceSpeeds.length / 2)]! : null;

    const derivedSpeed = significant && spanMs > 0 ? displacement / (spanMs / 1000) : 0;
    return { speedMps: deviceSpeed ?? derivedSpeed, goodFixes: n, spanMs, significant };
  }

  reset(): void {
    this.window.length = 0;
  }
}
