/**
 * R3F runs lower priorities first. Keep simulation ahead of drei controls
 * (-1), then settle the camera before meshes, shadows and feeds (0).
 * Negative priorities preserve R3F's default rendering when no PiP is mounted.
 */
export const FRAME_ORDER = { simulation: -2, camera: -0.5 } as const;
