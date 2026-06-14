import { describe, it, expect, vi } from "vitest";
import { runSteps } from "./runner";
import type { Step } from "./types";
import { m12Steps, m16Steps, journalSteps, insightsSteps, m19Steps, m20Steps, m21Steps, m24Steps, m25Steps } from "./walkthroughs";

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

describe("m19Steps", () => {
  it("captures the nine M19 power-&-scale surfaces in order", () => {
    const noop = async () => {};
    expect(m19Steps({
      showCommandPalette: noop, showScopedSearch: noop, showSavedSearches: noop,
      showCollections: noop, showBulkSelect: noop, showDensitySpacious: noop,
      showChapterSort: noop, showBackupMaintenance: noop, showHealthReport: noop,
    }).map((s) => s.name)).toEqual([
      "command-palette", "scoped-search", "saved-searches", "collections",
      "bulk-select", "density-spacious", "chapter-sort", "backup-maintenance", "health-report",
    ]);
  });
});

describe("m20Steps", () => {
  it("captures the eleven M20 accessibility surfaces in order", () => {
    const noop = async () => {};
    expect(m20Steps({
      showThemeLight: noop, showThemeHighContrast: noop, showTextLarge: noop,
      showDyslexiaFont: noop, showReducedMotion: noop, showColorblindStatus: noop,
      showSkipLinkFocus: noop, showSrTree: noop, showRtlLayout: noop,
      showMiniPlayer: noop, showAccessibilitySettings: noop,
    }).map((s) => s.name)).toEqual([
      "theme-light", "theme-high-contrast", "text-large", "dyslexia-font",
      "reduced-motion", "colorblind-status", "skip-link-focus", "sr-tree",
      "rtl-layout", "mini-player", "a11y-settings",
    ]);
  });
});

describe("m21Steps", () => {
  it("captures the five M21 metadata-discovery surfaces in order", () => {
    const noop = async () => {};
    expect(m21Steps({
      seedMetadata: noop,
      showMetadataManager: noop,
      showChapterMetadataEditor: noop,
      showNarratorsBrowse: noop,
      showDiscoverByFacet: noop,
    }).map((s) => s.name)).toEqual([
      "seed",
      "metadata-manager",
      "chapter-metadata-edit",
      "narrators-browse",
      "discover-by-facet",
    ]);
  });
});

describe("m24Steps", () => {
  it("captures the seven M24 listening-loop player surfaces in order", () => {
    const noop = async () => {};
    expect(m24Steps({
      showCompactPlayer: noop,
      showSpeedCycled: noop,
      showNowPlaying: noop,
      showNextAction: noop,
      showLastAction: noop,
      showChapterStates: noop,
      showSleepCountdown: noop,
    }).map((s) => s.name)).toEqual([
      "01-player-compact",
      "02-speed",
      "03-now-playing",
      "04-next-action",
      "05-last-action",
      "06-chapter-states",
      "07-sleep-countdown",
    ]);
  });
});

describe("m25Steps", () => {
  it("captures the three M25 visual-polish surfaces in order", () => {
    const noop = async () => {};
    expect(m25Steps({
      showLibrarySortOpen: noop,
      showSavedSearches: noop,
      showCoverPlaceholders: noop,
    }).map((s) => s.name)).toEqual([
      "01-library-sort-open",
      "02-saved-searches",
      "03-cover-placeholders",
    ]);
  });
});
