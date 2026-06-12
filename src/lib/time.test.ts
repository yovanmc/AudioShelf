import { describe, it, expect } from "vitest";
import { formatLong, formatRelative } from "./time";

describe("formatLong", () => {
  it("formats sub-hour and multi-hour totals", () => {
    expect(formatLong(0)).toBe("0m");
    expect(formatLong(300)).toBe("5m");
    expect(formatLong(3600)).toBe("1h 0m");
    expect(formatLong(7_530)).toBe("2h 5m");
  });
});

describe("formatRelative", () => {
  const now = 10_000_000_000;
  it("buckets by minute/hour/day/week", () => {
    expect(formatRelative(now, now)).toBe("just now");
    expect(formatRelative(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(formatRelative(now - 2 * 3_600_000, now)).toBe("2 hours ago");
    expect(formatRelative(now - 1 * 3_600_000, now)).toBe("1 hour ago");
    expect(formatRelative(now - 3 * 86_400_000, now)).toBe("3 days ago");
    expect(formatRelative(now - 14 * 86_400_000, now)).toBe("2 weeks ago");
  });
});
