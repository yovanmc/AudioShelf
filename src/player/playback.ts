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

/** Time remaining as "-m:ss" (e.g. "-1:30"); non-positive duration → "0:00". */
export function formatTimeLeft(currentTime: number, duration: number): string {
  if (!Number.isFinite(duration) || duration <= 0) return "0:00";
  const left = Math.max(0, duration - currentTime);
  return `-${formatTime(left)}`;
}

/** Whole-percent progress as "NN%"; non-positive duration → "0%". */
export function formatPercent(currentTime: number, duration: number): string {
  if (!Number.isFinite(duration) || duration <= 0) return "0%";
  const pct = Math.min(100, Math.max(0, Math.round((currentTime / duration) * 100)));
  return `${pct}%`;
}

export type TimeLabelMode = "elapsed" | "remaining" | "percent";

export function timeLabel(mode: TimeLabelMode, currentTime: number, duration: number): string {
  if (mode === "remaining") return formatTimeLeft(currentTime, duration);
  if (mode === "percent") return formatPercent(currentTime, duration);
  return formatTime(currentTime);
}
