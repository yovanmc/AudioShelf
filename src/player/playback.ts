export const SKIP_BACK_LARGE = -30;
export const SKIP_BACK_SMALL = -15;
export const SKIP_FWD_SMALL = 15;
export const SKIP_FWD_LARGE = 30;

/** Add `delta` seconds to `current`, clamped to [0, duration]. Duration <= 0 means unknown (no upper clamp). */
export function clampSeek(current: number, delta: number, duration: number): number {
  const t = current + delta;
  if (t < 0) return 0;
  if (duration > 0 && t > duration) return duration;
  return t;
}

/** Format seconds as "m:ss". Non-finite or negative inputs render as "0:00". */
export function formatTime(secs: number): string {
  const v = isFinite(secs) && secs > 0 ? secs : 0;
  const m = Math.floor(v / 60);
  const s = Math.floor(v % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
