import { describe, it, expect } from "vitest";
import { clampSeek, formatTime, formatTimeLeft, formatPercent, timeLabel, SKIP_BACK_LARGE, SKIP_FWD_LARGE, SKIP_BACK_SMALL, SKIP_FWD_SMALL, nextSpeed, formatSpeed, SPEEDS, formatScrubPreview, nextChapterLabel } from "./playback";

describe("clampSeek", () => {
  it("adds the delta within bounds", () => {
    expect(clampSeek(30, 15, 120)).toBe(45);
    expect(clampSeek(30, -15, 120)).toBe(15);
  });
  it("clamps to 0 at the low end", () => {
    expect(clampSeek(10, -30, 120)).toBe(0);
  });
  it("clamps to duration at the high end", () => {
    expect(clampSeek(110, 30, 120)).toBe(120);
  });
  it("does not clamp high when duration is unknown (0)", () => {
    expect(clampSeek(110, 30, 0)).toBe(140);
  });
});

describe("formatTime", () => {
  it("formats minutes and zero-padded seconds", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(600)).toBe("10:00");
  });
  it("treats non-finite or negative as 0:00", () => {
    expect(formatTime(NaN)).toBe("0:00");
    expect(formatTime(-5)).toBe("0:00");
  });
});

describe("skip constants", () => {
  it("are the expected ±15/±30 values", () => {
    expect([SKIP_BACK_LARGE, SKIP_BACK_SMALL, SKIP_FWD_SMALL, SKIP_FWD_LARGE]).toEqual([-30, -15, 15, 30]);
  });
});

describe("formatTimeLeft", () => {
  it("returns remaining as -m:ss", () => {
    expect(formatTimeLeft(30, 120)).toBe("-1:30");
  });
  it("returns full duration when currentTime is 0", () => {
    expect(formatTimeLeft(0, 120)).toBe("-2:00");
  });
  it("returns 0:00 (not -0:00) when at end (PL-9 fix)", () => {
    expect(formatTimeLeft(120, 120)).toBe("0:00");
  });
  it("returns 0:00 for zero duration", () => {
    expect(formatTimeLeft(10, 0)).toBe("0:00");
  });
});

describe("formatPercent", () => {
  it("returns 25% at quarter through", () => {
    expect(formatPercent(30, 120)).toBe("25%");
  });
  it("returns 0% at start", () => {
    expect(formatPercent(0, 120)).toBe("0%");
  });
  it("returns 100% at end", () => {
    expect(formatPercent(120, 120)).toBe("100%");
  });
  it("returns 0% for zero duration", () => {
    expect(formatPercent(10, 0)).toBe("0%");
  });
});

describe("timeLabel", () => {
  it("elapsed mode returns formatTime result", () => {
    expect(timeLabel("elapsed", 30, 120)).toBe("0:30");
  });
  it("remaining mode returns formatTimeLeft result", () => {
    expect(timeLabel("remaining", 30, 120)).toBe("-1:30");
  });
  it("percent mode returns formatPercent result", () => {
    expect(timeLabel("percent", 30, 120)).toBe("25%");
  });
});

describe("formatTimeLeft (PL-9 no -0:00)", () => {
  it("renders 0:00 (not -0:00) when at/after the end", () => {
    expect(formatTimeLeft(60, 60)).toBe("0:00");
    expect(formatTimeLeft(61, 60)).toBe("0:00");
    expect(formatTimeLeft(59.6, 60)).toBe("0:00"); // <1s left
  });
  it("renders negative remaining mid-chapter", () => {
    expect(formatTimeLeft(30, 90)).toBe("-1:00");
  });
});

describe("formatScrubPreview", () => {
  it("renders elapsed / total at the hovered position", () => {
    expect(formatScrubPreview(65, 600)).toBe("1:05 / 10:00");
  });
  it("clamps to bounds and never shows negative", () => {
    expect(formatScrubPreview(-5, 600)).toBe("0:00 / 10:00");
    expect(formatScrubPreview(605, 600)).toBe("10:00 / 10:00");
  });
});

describe("nextChapterLabel", () => {
  it("includes the upcoming chapter title", () => {
    expect(nextChapterLabel("Chapter 3 — The Cave")).toBe("Play next — Chapter 3 — The Cave");
  });
  it("falls back when no title is known", () => {
    expect(nextChapterLabel("")).toBe("Play next chapter");
    expect(nextChapterLabel(undefined)).toBe("Play next chapter");
  });
});

describe("speed helpers (PL-1)", () => {
  it("cycles through SPEEDS and wraps", () => {
    expect(nextSpeed(0.75)).toBe(1);
    expect(nextSpeed(2)).toBe(SPEEDS[0]);
    expect(nextSpeed(999)).toBe(SPEEDS[0]); // unknown → first
  });
  it("formats a multiplier", () => {
    expect(formatSpeed(1.25)).toBe("1.25×");
  });
});
