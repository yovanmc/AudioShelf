import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InsightsView } from "./InsightsView";
import type { InsightsData } from "../lib/api";

const empty: InsightsData = {
  generatedAt: 0, totalSecs: 0, totalChapters: 0, activeDays: 0, currentStreak: 0, longestStreak: 0,
  heatmap: [], byWeekday: new Array(7).fill(0), byHour: new Array(24).fill(0),
  thisMonth: { label: "June 2026", chapters: 0, secs: 0, activeDays: 0 },
  lastMonth: { label: "May 2026", chapters: 0, secs: 0, activeDays: 0 },
  rhythm: [], topCreators: [], topTags: [],
  recap: { year: 2026, totalSecs: 0, totalChapters: 0, activeDays: 0, longestStreak: 0, topCreator: null, topCreatorChapters: 0, topTag: null, busiestMonth: null, busiestWeekday: null, firstPlayMs: null, lastPlayMs: null },
  worksRated: 0, worksReEntered: 0,
};

const filled: InsightsData = {
  ...empty,
  totalSecs: 7500, totalChapters: 42, activeDays: 30, currentStreak: 3, longestStreak: 5,
  heatmap: [{ day: 3, dateMs: 3 * 86_400_000, count: 2 }],
  byHour: Array.from({ length: 24 }, (_, h) => (h === 9 ? 5 : 0)),
  byWeekday: [1, 2, 3, 4, 5, 6, 7],
  rhythm: [{ weekStartDay: 3, weekStartMs: 3 * 86_400_000, chapters: 4 }],
  topCreators: [{ authorId: 1, authorName: "Jane Doe", chapters: 12, secs: 3600 }],
  topTags: [{ tag: "mystery", owned: 4, finished: 2 }],
  recap: { ...empty.recap, totalChapters: 42, totalSecs: 7500, topCreator: "Jane Doe", topTag: "mystery" },
};

describe("InsightsView", () => {
  it("shows an empty state with no history", () => {
    render(<InsightsView data={empty} now={0} onExportRecap={() => {}} recapStatus={null} />);
    expect(screen.getByText("No listening history yet")).toBeTruthy();
  });
  it("renders stats, breakdowns, and a recap export button when populated", () => {
    const onExport = vi.fn();
    render(<InsightsView data={filled} now={0} onExportRecap={onExport} recapStatus={null} />);
    // "2h 5m" appears both in the Time-listened stat card and inside the recap SVG text.
    expect(screen.getAllByText("2h 5m").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Jane Doe").length).toBeGreaterThan(0);
    expect(screen.getAllByText("mystery").length).toBeGreaterThan(0);
    expect(screen.getByText("Export PNG")).toBeTruthy();
  });

  it("renders a back button when onBack is provided (empty state)", () => {
    const onBack = vi.fn();
    render(<InsightsView data={empty} now={0} onExportRecap={() => {}} recapStatus={null} onBack={onBack} />);
    expect(screen.getByRole("button", { name: /Home/i })).toBeInTheDocument();
  });

  it("calls onBack when the back button is clicked (empty state)", async () => {
    const onBack = vi.fn();
    render(<InsightsView data={empty} now={0} onExportRecap={() => {}} recapStatus={null} onBack={onBack} />);
    await userEvent.click(screen.getByRole("button", { name: /Home/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("renders a back button when onBack is provided (populated)", () => {
    const onBack = vi.fn();
    render(<InsightsView data={filled} now={0} onExportRecap={() => {}} recapStatus={null} onBack={onBack} />);
    expect(screen.getByRole("button", { name: /Home/i })).toBeInTheDocument();
  });

  it("calls onBack when the back button is clicked (populated)", async () => {
    const onBack = vi.fn();
    render(<InsightsView data={filled} now={0} onExportRecap={() => {}} recapStatus={null} onBack={onBack} />);
    await userEvent.click(screen.getByRole("button", { name: /Home/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  // CUR-5: heatmap drill-down
  it("heatmap cell with count>0 is a button when onDrillRange is provided", () => {
    const onDrillRange = vi.fn();
    render(<InsightsView data={filled} now={0} onExportRecap={() => {}} recapStatus={null} onDrillRange={onDrillRange} />);
    // The filled fixture has one heatmap cell with dateMs=3*86_400_000, count=2
    const btn = screen.getByRole("button", { name: /1970-01-04.*click to see played works/i });
    expect(btn).toBeInTheDocument();
  });

  it("clicking a heatmap cell with count>0 calls onDrillRange with correct [start,end) window", async () => {
    const onDrillRange = vi.fn();
    render(<InsightsView data={filled} now={0} onExportRecap={() => {}} recapStatus={null} onDrillRange={onDrillRange} />);
    const btn = screen.getByRole("button", { name: /1970-01-04.*click to see played works/i });
    await userEvent.click(btn);
    const dateMs = 3 * 86_400_000;
    expect(onDrillRange).toHaveBeenCalledWith(dateMs, dateMs + 86_400_000, expect.any(String));
  });

  it("heatmap cell with count===0 is not a button (non-interactive)", () => {
    const dataWithZeroCell: InsightsData = {
      ...filled,
      heatmap: [{ day: 3, dateMs: 3 * 86_400_000, count: 0 }],
    };
    const onDrillRange = vi.fn();
    render(<InsightsView data={dataWithZeroCell} now={0} onExportRecap={() => {}} recapStatus={null} onDrillRange={onDrillRange} />);
    // No heatmap drill button for a zero-count cell — only the rhythm button may exist
    const heatmapBtns = screen.queryAllByRole("button", { name: /1970-01-04.*click to see played works/i });
    expect(heatmapBtns).toHaveLength(0);
  });

  // CUR-5: rhythm bar drill-down
  it("rhythm bar calls onDrillRange with correct 7-day window when clicked", async () => {
    const onDrillRange = vi.fn();
    render(<InsightsView data={filled} now={0} onExportRecap={() => {}} recapStatus={null} onDrillRange={onDrillRange} />);
    // filled.rhythm has weekStartMs = 3 * 86_400_000
    const weekBtn = screen.getByRole("button", { name: /Week of .* — click to see played works/i });
    await userEvent.click(weekBtn);
    const weekStartMs = 3 * 86_400_000;
    expect(onDrillRange).toHaveBeenCalledWith(weekStartMs, weekStartMs + 7 * 86_400_000, expect.stringContaining("Week of"));
  });

  // CUR-5: top-tag drill to library
  it("top-tag bar calls onFilterTag with the tag value when clicked", async () => {
    const onFilterTag = vi.fn();
    render(<InsightsView data={filled} now={0} onExportRecap={() => {}} recapStatus={null} onFilterTag={onFilterTag} />);
    const tagBtn = screen.getByRole("button", { name: /Filter library by tag "mystery"/i });
    await userEvent.click(tagBtn);
    expect(onFilterTag).toHaveBeenCalledWith("mystery");
  });

  // CUR-10: Reflections stat tile
  it("renders Reflections stat with worksRated and worksReEntered counts", () => {
    const data: InsightsData = { ...filled, worksRated: 3, worksReEntered: 2 };
    render(<InsightsView data={data} now={0} onExportRecap={() => {}} recapStatus={null} />);
    expect(screen.getByText("3 rated · 2 revisited")).toBeTruthy();
  });

  it("renders Reflections stat tile label", () => {
    render(<InsightsView data={filled} now={0} onExportRecap={() => {}} recapStatus={null} />);
    expect(screen.getByText("Reflections")).toBeTruthy();
  });
});
