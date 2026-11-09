// Minimal-mode ring size. 50% is the original 180px ring in a 200px window and
// 100% doubles it. Below 50% the range is spread over 72-180px instead of
// shrinking proportionally, so 1% is the smallest ring whose controls stay
// usable and every setting still changes the size.
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
  const value = normalizeRingScale(scale);
  if (value >= DEFAULT_RING_SCALE) return value / DEFAULT_RING_SCALE;
  const minZoom = MIN_RING_PX / BASE_RING_PX;
  return minZoom + (value - MIN_RING_SCALE) * (1 - minZoom) / (DEFAULT_RING_SCALE - MIN_RING_SCALE);
}

export function minimalRingPx(scale: number): number {
  return Math.round(BASE_RING_PX * minimalRingZoom(scale));
}

export function minimalWindowPx(scale: number): number {
  return Math.round(BASE_WINDOW_PX * minimalRingZoom(scale));
}
