import type { Step } from "./types";

/**
 * Build the "browse" walkthrough. The caller supplies navigation callbacks so
 * this stays free of React/DOM imports (and unit-testable). Each step leaves the
 * app on a distinct screen so the screenshot after it is meaningful.
 */
export function browseSteps(nav: {
  seed: () => Promise<void>;
  showLibrarySorted: () => Promise<void>;
  showLibraryFiltered: () => Promise<void>;
  openFirstAuthor: () => Promise<void>;
}): Step[] {
  return [
    { name: "seed", run: nav.seed },
    { name: "library-sorted", run: nav.showLibrarySorted },
    { name: "library-filtered", run: nav.showLibraryFiltered },
    { name: "author-detail", run: nav.openFirstAuthor },
  ];
}

/**
 * Build the "home" walkthrough: the empty personal home (nothing played), then — after
 * seeding two finished chapters across two days at runtime — the populated home showing
 * "Jump back in" + a 2-day streak. Seeding is runtime-only, so on-disk fixtures are untouched.
 */
export function homeSteps(nav: {
  showEmptyHome: () => Promise<void>;
  seedAndShow: () => Promise<void>;
}): Step[] {
  return [
    { name: "home-empty", run: nav.showEmptyHome },
    { name: "home", run: nav.seedAndShow },
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

export const walkthroughs = ["home", "browse", "player", "discovery", "rename", "grouping", "settings", "m7", "covers", "tags", "m12"] as const;
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

/**
 * Build the "covers" walkthrough: the author list (showing real cover images for
 * Jane Doe & Sam Smith) and then Jane Doe's author-detail (showing per-work covers).
 */
export function coversSteps(nav: {
  showLibrary: () => Promise<void>;
  openFirstAuthor: () => Promise<void>;
}): Step[] {
  return [
    { name: "library", run: nav.showLibrary },
    { name: "author-detail", run: nav.openFirstAuthor },
  ];
}

/**
 * Build the "tags" walkthrough: seed an author/work/chapter tag on the first
 * author, open its detail (showing all three tag levels — the chapter editor is
 * open-by-default because the chapter is tagged), then search the unique work tag
 * "mystery" to prove tags are searchable.
 */
export function tagsSteps(nav: {
  seed: () => Promise<void>;
  openDetail: () => Promise<void>;
  searchByTag: () => Promise<void>;
}): Step[] {
  return [
    { name: "seed", run: nav.seed },
    { name: "detail", run: nav.openDetail },
    { name: "search-by-tag", run: nav.searchByTag },
  ];
}

export function m12Steps(nav: {
  showEmptyHome: () => Promise<void>;
  showHome: () => Promise<void>;
  collapseSidebar: () => Promise<void>;
  showLibrary: () => Promise<void>;
  showSearch: () => Promise<void>;
  showAuthorDetail: () => Promise<void>;
  showDiscovery: () => Promise<void>;
  showDiscoveryByTag: () => Promise<void>;
  showRename: () => Promise<void>;
  showSettings: () => Promise<void>;
  showPlayerCompact: () => Promise<void>;
  showPlayerExpanded: () => Promise<void>;
  showPlayerChapters: () => Promise<void>;
  showContextMenu: () => Promise<void>;
}): Step[] {
  return [
    { name: "home-empty", run: nav.showEmptyHome },
    { name: "home", run: nav.showHome },
    { name: "home-sidebar-collapsed", run: nav.collapseSidebar },
    { name: "library", run: nav.showLibrary },
    { name: "search", run: nav.showSearch },
    { name: "author-detail", run: nav.showAuthorDetail },
    { name: "discovery", run: nav.showDiscovery },
    { name: "discovery-by-tag", run: nav.showDiscoveryByTag },
    { name: "rename-preview", run: nav.showRename },
    { name: "settings", run: nav.showSettings },
    { name: "player-compact", run: nav.showPlayerCompact },
    { name: "player-expanded", run: nav.showPlayerExpanded },
    { name: "player-chapters", run: nav.showPlayerChapters },
    { name: "context-menu", run: nav.showContextMenu },
  ];
}
