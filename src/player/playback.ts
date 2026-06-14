export const SKIP_BACK_LARGE = -30;
export const SKIP_BACK_SMALL = -15;
export const SKIP_FWD_SMALL = 15;
export const SKIP_FWD_LARGE = 30;

/** Selectable playback speeds (PL-1). 1 is normal. */
export const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;

/** Next speed in the cycle, wrapping back to the first. */
export function nextSpeed(current: number): number {
  const i = SPEEDS.findIndex((s) => s === current);
  return SPEEDS[(i + 1) % SPEEDS.length] ?? 1;
}

/** Format a speed multiplier, e.g. 1 → "1×", 1.25 → "1.25×". */
export function formatSpeed(v: number): string {
  return `${v}×`;
}

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

/** Time remaining as "-m:ss" (e.g. "-1:30"); non-positive duration OR zero remaining → "0:00" (never "-0:00"). */
export function formatTimeLeft(currentTime: number, duration: number): string {
  if (!Number.isFinite(duration) || duration <= 0) return "0:00";
  const left = Math.max(0, duration - currentTime);
  if (left < 1) return "0:00"; // PL-9: never render "-0:00"
  return `-${formatTime(left)}`;
}

/** Whole-percent progress as "NN%"; non-positive duration → "0%". */
export function formatPercent(currentTime: number, duration: number): string {
  if (!Number.isFinite(duration) || duration <= 0) return "0%";
  const pct = Math.min(100, Math.max(0, Math.round((currentTime / duration) * 100)));
  return `${pct}%`;
}

/** Sleep-timer "End of chapter" option label with remaining minutes preview (PL7-8). */
export function endOfChapterPreview(totalSecs: number, currentSecs: number): string {
  const remaining = Math.max(0, totalSecs - currentSecs);
  const mins = Math.ceil(remaining / 60);
  return remaining < 60 ? "End of chapter · <1 min left" : `End of chapter · ~${mins} min left`;
}

/** Play-next button label — includes the upcoming chapter title if known (PL7-7). */
export function nextChapterLabel(nextTitle?: string): string {
  const t = (nextTitle ?? "").trim();
  return t ? `Play next — ${t}` : "Play next chapter";
}

/** Scrub-preview label: "elapsed / total" at a hovered position, clamped to [0, total] (PL7-2). */
export function formatScrubPreview(posSecs: number, totalSecs: number): string {
  const clamped = Math.max(0, Math.min(posSecs, totalSecs));
  return `${formatTime(clamped)} / ${formatTime(totalSecs)}`;
}

export type TimeLabelMode = "elapsed" | "remaining" | "percent";

export function timeLabel(mode: TimeLabelMode, currentTime: number, duration: number): string {
  if (mode === "remaining") return formatTimeLeft(currentTime, duration);
  if (mode === "percent") return formatPercent(currentTime, duration);
  return formatTime(currentTime);
}
