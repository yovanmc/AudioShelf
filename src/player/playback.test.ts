import { describe, it, expect } from "vitest";
import { clampSeek, formatTime, SKIP_BACK_LARGE, SKIP_FWD_LARGE, SKIP_BACK_SMALL, SKIP_FWD_SMALL } from "./playback";

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
