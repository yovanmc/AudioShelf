import { describe, expect, it } from "vitest";
import { buildRecapSvg } from "./recap";
import type { RecapData } from "./api";

const base: RecapData = {
  year: 2026,
  totalSecs: 7500,
  totalChapters: 42,
  activeDays: 30,
  longestStreak: 5,
  topCreator: "Jane Doe",
  topCreatorChapters: 12,
  topTag: "mystery",
  busiestMonth: "June 2026",
  busiestWeekday: "Sunday",
  firstPlayMs: 1,
  lastPlayMs: 2,
};

describe("buildRecapSvg", () => {
  it("is a well-formed self-contained svg with the headline numbers", () => {
    const svg = buildRecapSvg(base);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
    expect(svg).not.toContain("<image"); // no external refs ⇒ no canvas taint
    expect(svg).toContain("2026");
    expect(svg).toContain("2h 5m"); // formatLong(7500)
    expect(svg).toContain("42");
    expect(svg).toContain("Jane Doe");
    expect(svg).toContain("mystery");
    expect(svg).toContain("5 days");
  });
  it("escapes creator names and omits absent fields", () => {
    const svg = buildRecapSvg({ ...base, topCreator: "A & B", topTag: null, busiestMonth: null });
    expect(svg).toContain("A &amp; B");
    // "Top tag" / "Busiest month" rows are skipped when null
    expect(svg).not.toContain("Busiest month");
  });
  it("singularizes a one-day run", () => {
    expect(buildRecapSvg({ ...base, longestStreak: 1 })).toContain("1 day<");
  });
});
