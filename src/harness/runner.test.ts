import { describe, it, expect, vi } from "vitest";
import { runSteps } from "./runner";
import type { Step } from "./types";
import { m12Steps, m16Steps, journalSteps, insightsSteps } from "./walkthroughs";

describe("runSteps", () => {
  it("runs every step in order and captures a numbered shot per step", async () => {
    const order: string[] = [];
    const steps: Step[] = [
      { name: "first", run: async () => { order.push("first"); } },
      { name: "second", run: async () => { order.push("second"); } },
    ];
    const shots: string[] = [];
    await runSteps(steps, "C:/shots", async (p) => { shots.push(p); });
    expect(order).toEqual(["first", "second"]);
    expect(shots).toEqual(["C:/shots/01-first.png", "C:/shots/02-second.png"]);
  });

  it("skips capture when shotsDir is null", async () => {
    const capture = vi.fn();
    await runSteps([{ name: "x", run: async () => {} }], null, capture);
    expect(capture).not.toHaveBeenCalled();
  });
});

describe("m12Steps", () => {
  it("captures the complete M12 interface in order", () => {
    const noop = async () => {};
    expect(m12Steps({
      showEmptyHome: noop, showHome: noop, showHomeShelves: noop, collapseSidebar: noop,
      showLibrary: noop,
      showSearch: noop, showAuthorDetail: noop, showDiscovery: noop, showDiscoveryByTag: noop,
      showRename: noop, showSettings: noop, showPlayerCompact: noop, showPlayerExpanded: noop,
      showPlayerChapters: noop,
      showContextMenu: noop,
    }).map((step) => step.name)).toEqual([
      "home-empty", "home", "home-shelves", "home-sidebar-collapsed", "library", "search",
      "author-detail", "discovery", "discovery-by-tag", "rename-preview",
      "settings", "player-compact", "player-expanded", "player-chapters", "context-menu",
    ]);
  });
});

describe("m16Steps", () => {
  it("captures the six new M16 surfaces in order", () => {
    const noop = async () => {};
    expect(m16Steps({
      showManageTags: noop,
      showMetadataDiff: noop,
      showSeriesSpine: noop,
      showTranscriptSearch: noop,
      showForgottenShelf: noop,
      showDiscoverReasons: noop,
    }).map((step) => step.name)).toEqual([
      "manage-tags",
      "metadata-diff",
      "series-spine",
      "transcript-search",
      "forgotten-shelf",
      "discover-reasons",
    ]);
  });
});

describe("journalSteps", () => {
  it("captures the six M17 journal surfaces in order", () => {
    const noop = async () => {};
    expect(journalSteps({
      showJournalEmpty: noop,
      showChapterJournalDialog: noop,
      showWorkMeta: noop,
      showJournalBrowse: noop,
      showJournalSearch: noop,
      showNowPlayingBookmarks: noop,
    }).map((step) => step.name)).toEqual([
      "journal-empty",
      "journal-chapter-edit",
      "journal-work-meta",
      "journal-browse",
      "journal-search",
      "now-playing-bookmarks",
    ]);
  });
});

describe("insightsSteps", () => {
  it("captures the four M18 insights surfaces in order", () => {
    const noop = async () => {};
    expect(insightsSteps({
      showInsightsEmpty: noop,
      showInsightsOverview: noop,
      showInsightsTrends: noop,
      showInsightsRecap: noop,
    }).map((step) => step.name)).toEqual([
      "insights-empty",
      "insights-overview",
      "insights-trends",
      "insights-recap",
    ]);
  });
});
