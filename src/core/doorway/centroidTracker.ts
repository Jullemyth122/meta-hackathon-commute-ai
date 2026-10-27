/**
 * Centroid tracker: gives each detected person a stable ID across frames.
 *
 * This is the same logic the driver's phone would run after COCO-SSD / YOLO:
 * the detector returns anonymous boxes, and counting needs to know that the
 * box at frame n+1 is the same person as the box at frame n.
 *
 * Greedy nearest-neighbour matching. With a top-down camera and a doorway
 * one or two people wide, that is enough; Hungarian matching would be overkill.
 */

export interface Box {
  /** Centre and size in pixels of the 320×240 camera frame. */
  cx: number;
  cy: number;
  w: number;
  h: number;
  score: number;
}

export interface Track extends Box {
  id: number;
  /** Consecutive frames without a matching detection. */
  missed: number;
}

export interface TrackerConfig {
  /** Farthest a centroid may move between frames and stay the same person. */
  maxJumpPx: number;
  /** Frames a track survives without a detection (covers brief misses). */
  maxMissedFrames: number;
  /**
   * Largest size change (bigger / smaller box width) between frames. A near
   * and a far person can line up in the image; their sizes still differ.
   */
  maxSizeRatio: number;
}

export const DEFAULT_TRACKER: TrackerConfig = {
  maxJumpPx: 48,
  maxMissedFrames: 5,
  maxSizeRatio: Infinity,
};

export class CentroidTracker {
  private readonly tracks = new Map<number, Track>();
  private nextId = 1;
  private readonly cfg: TrackerConfig;

  constructor(cfg: TrackerConfig = DEFAULT_TRACKER) {
    this.cfg = cfg;
  }

  /**
   * Update with one frame of detections.
   * Returns IDs of tracks that were dropped this frame.
   */
  update(detections: readonly Box[]): number[] {
    // Every (track, detection) pair within reach, closest first.
    const pairs: Array<{ id: number; det: number; d: number }> = [];
    for (const t of this.tracks.values()) {
      detections.forEach((b, det) => {
        const d = Math.hypot(b.cx - t.cx, b.cy - t.cy);
        const sizeRatio = Math.max(b.w, t.w) / Math.max(1e-6, Math.min(b.w, t.w));
        if (d > this.cfg.maxJumpPx || sizeRatio > this.cfg.maxSizeRatio) return;
        // Prefer the candidate of similar size when two are equally close.
        pairs.push({ id: t.id, det, d: d + Math.abs(b.w - t.w) });
      });
    }
    pairs.sort((a, b) => a.d - b.d);

    const usedTracks = new Set<number>();
    const usedDets = new Set<number>();
    for (const { id, det } of pairs) {
      if (usedTracks.has(id) || usedDets.has(det)) continue;
      usedTracks.add(id);
      usedDets.add(det);
      Object.assign(this.tracks.get(id)!, detections[det]!, { missed: 0 });
    }

    const dropped: number[] = [];
    for (const t of this.tracks.values()) {
      if (usedTracks.has(t.id)) continue;
      if (++t.missed > this.cfg.maxMissedFrames) {
        this.tracks.delete(t.id);
        dropped.push(t.id);
      }
    }

    detections.forEach((b, det) => {
      if (usedDets.has(det)) return;
      const id = this.nextId++;
      this.tracks.set(id, { ...b, id, missed: 0 });
    });
    return dropped;
  }

  /** Tracks seen this frame (missed === 0). */
  visible(): Track[] {
    return [...this.tracks.values()].filter((t) => t.missed === 0);
  }
}
