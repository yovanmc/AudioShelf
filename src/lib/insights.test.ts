import { describe, expect, it } from "vitest";
import { heatColumns, heatLevel, maxCount, weekdayOfDay } from "./insights";
import type { DayCell } from "./api";

const cell = (day: number, count: number): DayCell => ({ day, dateMs: day * 86_400_000, count });

describe("insights helpers", () => {
  it("heatLevel buckets by ratio", () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(1, 10)).toBe(1);
    expect(heatLevel(3, 10)).toBe(2);
    expect(heatLevel(6, 10)).toBe(3);
    expect(heatLevel(9, 10)).toBe(4);
    expect(heatLevel(5, 0)).toBe(0);
  });
  it("weekdayOfDay anchors Sunday at day 3", () => {
    expect(weekdayOfDay(3)).toBe(0);
    expect(weekdayOfDay(0)).toBe(4); // Thursday
  });
  it("maxCount finds the peak", () => {
    expect(maxCount([cell(1, 2), cell(2, 5), cell(3, 1)])).toBe(5);
    expect(maxCount([])).toBe(0);
  });
  it("heatColumns pads the first column to the correct weekday", () => {
    // day 4 = Monday (weekday 1) ⇒ one null pad at top.
    const cols = heatColumns([cell(4, 1), cell(5, 2)]);
    expect(cols).toHaveLength(1);
    expect(cols[0][0]).toBeNull();
    expect(cols[0][1]?.day).toBe(4);
    expect(cols[0][2]?.day).toBe(5);
  });
  it("heatColumns splits into 7-row columns", () => {
    const cells = Array.from({ length: 10 }, (_, i) => cell(3 + i, 1)); // start Sunday
    const cols = heatColumns(cells);
    expect(cols).toHaveLength(2);
    expect(cols[0].every((c) => c !== null)).toBe(true);
    expect(cols[1].slice(3).every((c) => c === null)).toBe(true);
  });
});
