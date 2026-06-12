import type { Step } from "./types";

/**
 * Build the "browse" walkthrough. The caller supplies navigation callbacks so
 * this stays free of React/DOM imports (and unit-testable). Each step leaves the
 * app on a distinct screen so the screenshot after it is meaningful.
 */
export function browseSteps(nav: {
  showScanResult: () => Promise<void>;
  showLibrary: () => Promise<void>;
  openFirstAuthor: () => Promise<void>;
}): Step[] {
  return [
    { name: "scan-result", run: nav.showScanResult },
    { name: "library", run: nav.showLibrary },
    { name: "author-detail", run: nav.openFirstAuthor },
  ];
}

/**
 * Build the "player" walkthrough: open the first author, then start playback of
 * its first chapter so the now-playing bar is captured.
 */
export function playerSteps(nav: {
  openFirstAuthor: () => Promise<void>;
  playFirstChapter: () => Promise<void>;
}): Step[] {
  return [
    { name: "author-detail", run: nav.openFirstAuthor },
    { name: "player", run: nav.playFirstChapter },
  ];
}

export const walkthroughs = ["browse", "player", "discovery", "rename", "grouping", "settings", "m7"] as const;
export type WalkthroughName = (typeof walkthroughs)[number];

export function discoverySteps(nav: {
  seed: () => Promise<void>;
  openDiscovery: () => Promise<void>;
  pickFirstTag: () => Promise<void>;
}): Step[] {
  return [
    { name: "seed", run: nav.seed },
    { name: "discovery", run: nav.openDiscovery },
    { name: "by-tag", run: nav.pickFirstTag },
  ];
}

/**
 * Build the "rename" walkthrough: preview the diff, apply all Ok renames, then
 * undo — a full round-trip that leaves the fixture on disk exactly as it began.
 */
export function renameSteps(nav: {
  openRename: () => Promise<void>;
  applyAll: () => Promise<void>;
  undoLast: () => Promise<void>;
}): Step[] {
  return [
    { name: "preview", run: nav.openRename },
    { name: "applied", run: nav.applyAll },
    { name: "undone", run: nav.undoLast },
  ];
}

/**
 * Build the "grouping" walkthrough: open the first author, merge its standalone
 * work into "Cool Story" via an override, then reset — a round-trip that leaves
 * the DB grouping as it began.
 */
export function groupingSteps(nav: {
  openFirstAuthor: () => Promise<void>;
  mergeDemo: () => Promise<void>;
  resetDemo: () => Promise<void>;
}): Step[] {
  return [
    { name: "before", run: nav.openFirstAuthor },
    { name: "merged", run: nav.mergeDemo },
    { name: "reset", run: nav.resetDemo },
  ];
}

/**
 * Build the "settings" walkthrough: open the Settings screen (with the fixture
 * library root already loaded) so the current-root + scan-summary state is
 * captured. The OS folder picker is not driven headlessly.
 */
export function settingsSteps(nav: {
  openSettings: () => Promise<void>;
}): Step[] {
  return [{ name: "settings", run: nav.openSettings }];
}

/**
 * Build the "m7" walkthrough: the virtualized author list (with cover swatches and
 * enough filler authors to scroll), then two searches that prove cross-level matching
 * — "cool" hits a work + its chapters, "sam" hits an author.
 */
export function m7Steps(nav: {
  showLibrary: () => Promise<void>;
  search: (q: string) => Promise<void>;
}): Step[] {
  return [
    { name: "library", run: nav.showLibrary },
    { name: "search-cool", run: () => nav.search("cool") },
    { name: "search-sam", run: () => nav.search("sam") },
  ];
}
