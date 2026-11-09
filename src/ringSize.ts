// Minimal-mode ring size. 50% is the original 180px ring in a 200px window and
// the size scales linearly, but never below a ring whose controls stay usable.
export const DEFAULT_RING_SCALE = 50;
export const MIN_RING_SCALE = 1;
export const MAX_RING_SCALE = 100;
const BASE_RING_PX = 180;
const BASE_WINDOW_PX = 200;
const MIN_RING_PX = 72;

export function normalizeRingScale(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_RING_SCALE;
  return Math.min(MAX_RING_SCALE, Math.max(MIN_RING_SCALE, Math.round(value)));
}

/** Zoom factor applied to the 180px minimal ring layout. */
export function minimalRingZoom(scale: number): number {
  return Math.max(MIN_RING_PX / BASE_RING_PX, normalizeRingScale(scale) / DEFAULT_RING_SCALE);
}

export function minimalRingPx(scale: number): number {
  return Math.round(BASE_RING_PX * minimalRingZoom(scale));
}

export function minimalWindowPx(scale: number): number {
  return Math.round(BASE_WINDOW_PX * minimalRingZoom(scale));
}
