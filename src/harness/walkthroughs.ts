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

export const walkthroughs = ["home", "browse", "player", "discovery", "rename", "grouping", "settings", "m7", "covers", "tags", "m12", "m16", "journal", "insights", "m19", "m20", "m21", "m24", "m25", "m26", "m27", "m28", "m29", "m30"] as const;
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

/**
 * Build the "m16" walkthrough: six new surfaces introduced in M16 — manage-tags
 * (Settings tag manager with seeded tag stats), metadata diff-preview
 * (MetadataView in its empty/honest state), series spine (AuthorDetail — empty
 * when no numeric series detected in fixtures), transcript search (Library search
 * with a transcript bucket, empty because no sidecar fixtures), forgotten shelf
 * (Home with a dormant work seeded via a far-past play event), and discover reasons
 * (DiscoveryView cards showing the reason string after seeding play history + tags).
 */
export function m16Steps(nav: {
  showManageTags: () => Promise<void>;
  showMetadataDiff: () => Promise<void>;
  showSeriesSpine: () => Promise<void>;
  showTranscriptSearch: () => Promise<void>;
  showForgottenShelf: () => Promise<void>;
  showDiscoverReasons: () => Promise<void>;
}): Step[] {
  return [
    { name: "manage-tags", run: nav.showManageTags },
    { name: "metadata-diff", run: nav.showMetadataDiff },
    { name: "series-spine", run: nav.showSeriesSpine },
    { name: "transcript-search", run: nav.showTranscriptSearch },
    { name: "forgotten-shelf", run: nav.showForgottenShelf },
    { name: "discover-reasons", run: nav.showDiscoverReasons },
  ];
}

/**
 * Build the "journal" walkthrough: six surfaces introduced in M17 — the empty
 * journal state, the chapter journal dialog (summary/takeaway/favorite/note/bookmark),
 * the work-level meta fields (re-entry note + rating), the populated journal browse
 * view, filtered journal search, and the now-playing bookmarks panel with jump-to.
 * All data is seeded at runtime so on-disk fixtures stay 43/44/47.
 */
export function journalSteps(nav: {
  showJournalEmpty: () => Promise<void>;
  showChapterJournalDialog: () => Promise<void>;
  showWorkMeta: () => Promise<void>;
  showJournalBrowse: () => Promise<void>;
  showJournalSearch: () => Promise<void>;
  showNowPlayingBookmarks: () => Promise<void>;
}): Step[] {
  return [
    { name: "journal-empty", run: nav.showJournalEmpty },
    { name: "journal-chapter-edit", run: nav.showChapterJournalDialog },
    { name: "journal-work-meta", run: nav.showWorkMeta },
    { name: "journal-browse", run: nav.showJournalBrowse },
    { name: "journal-search", run: nav.showJournalSearch },
    { name: "now-playing-bookmarks", run: nav.showNowPlayingBookmarks },
  ];
}

export function insightsSteps(nav: {
  showInsightsEmpty: () => Promise<void>;
  showInsightsOverview: () => Promise<void>;
  showInsightsTrends: () => Promise<void>;
  showInsightsRecap: () => Promise<void>;
}): Step[] {
  return [
    { name: "insights-empty", run: nav.showInsightsEmpty },
    { name: "insights-overview", run: nav.showInsightsOverview },
    { name: "insights-trends", run: nav.showInsightsTrends },
    { name: "insights-recap", run: nav.showInsightsRecap },
  ];
}

/**
 * Build the "m19" walkthrough: nine new surfaces introduced in M19 (Power & Scale) —
 * command palette (Ctrl+K overlay with search results), scoped search (duration/tag
 * tokens with parsed chips), saved searches (a recall-able named search), collections
 * (the Collections route listing a seeded collection), bulk select (select mode active
 * with ≥1 work checked and the bulk bar), density spacious (visibly looser grid),
 * chapter sort (per-work sort control in AuthorDetail), backup & maintenance (the five
 * Settings actions), and health report (counts + schema version banner).
 * All data is seeded at runtime so on-disk fixtures stay 43/44/47.
 */
export function m19Steps(nav: {
  showCommandPalette: () => Promise<void>;
  showScopedSearch: () => Promise<void>;
  showSavedSearches: () => Promise<void>;
  showCollections: () => Promise<void>;
  showBulkSelect: () => Promise<void>;
  showDensitySpacious: () => Promise<void>;
  showChapterSort: () => Promise<void>;
  showBackupMaintenance: () => Promise<void>;
  showHealthReport: () => Promise<void>;
}): Step[] {
  return [
    { name: "command-palette", run: nav.showCommandPalette },
    { name: "scoped-search", run: nav.showScopedSearch },
    { name: "saved-searches", run: nav.showSavedSearches },
    { name: "collections", run: nav.showCollections },
    { name: "bulk-select", run: nav.showBulkSelect },
    { name: "density-spacious", run: nav.showDensitySpacious },
    { name: "chapter-sort", run: nav.showChapterSort },
    { name: "backup-maintenance", run: nav.showBackupMaintenance },
    { name: "health-report", run: nav.showHealthReport },
  ];
}

/**
 * Build the "m20" walkthrough: eleven accessibility surfaces introduced in M20 —
 * light theme, high-contrast theme, large text, dyslexia font, reduced motion (settings
 * toggle visible on), colorblind-safe status icons (author detail), skip-link focused,
 * screen-reader tree (author detail role=tree), RTL layout, inline mini-player overlay,
 * and the Accessibility settings section with controls visible.
 * All state is forced via local setA11y() (no persistence) so nothing leaks across runs.
 */
export function m20Steps(nav: {
  showThemeLight: () => Promise<void>;
  showThemeHighContrast: () => Promise<void>;
  showTextLarge: () => Promise<void>;
  showDyslexiaFont: () => Promise<void>;
  showReducedMotion: () => Promise<void>;
  showColorblindStatus: () => Promise<void>;
  showSkipLinkFocus: () => Promise<void>;
  showSrTree: () => Promise<void>;
  showRtlLayout: () => Promise<void>;
  showMiniPlayer: () => Promise<void>;
  showAccessibilitySettings: () => Promise<void>;
}): Step[] {
  return [
    { name: "theme-light", run: nav.showThemeLight },
    { name: "theme-high-contrast", run: nav.showThemeHighContrast },
    { name: "text-large", run: nav.showTextLarge },
    { name: "dyslexia-font", run: nav.showDyslexiaFont },
    { name: "reduced-motion", run: nav.showReducedMotion },
    { name: "colorblind-status", run: nav.showColorblindStatus },
    { name: "skip-link-focus", run: nav.showSkipLinkFocus },
    { name: "sr-tree", run: nav.showSrTree },
    { name: "rtl-layout", run: nav.showRtlLayout },
    { name: "mini-player", run: nav.showMiniPlayer },
    { name: "a11y-settings", run: nav.showAccessibilitySettings },
  ];
}

/**
 * Build the "m21" walkthrough: five surfaces introduced in M21 (Metadata & Discovery) —
 * runtime seed (narrator "Jane Roe" + mood "cozy" on first chapter, language "English" on
 * first author), metadata vocabulary manager in Settings, the per-chapter MetadataEditor
 * inside the "Edit tags" dialog, the Narrators browse view with Jane Roe selected, and
 * the Discover facet picker showing works for mood "cozy".
 * All data is seeded at runtime so on-disk fixtures stay 43/44/47.
 */
export function m21Steps(nav: {
  seedMetadata: () => Promise<void>;
  showMetadataManager: () => Promise<void>;
  showChapterMetadataEditor: () => Promise<void>;
  showNarratorsBrowse: () => Promise<void>;
  showDiscoverByFacet: () => Promise<void>;
}): Step[] {
  return [
    { name: "seed", run: nav.seedMetadata },
    { name: "metadata-manager", run: nav.showMetadataManager },
    { name: "chapter-metadata-edit", run: nav.showChapterMetadataEditor },
    { name: "narrators-browse", run: nav.showNarratorsBrowse },
    { name: "discover-by-facet", run: nav.showDiscoverByFacet },
  ];
}

/**
 * Build the "m24" walkthrough: seven surfaces introduced in M24 (Listening Loop) —
 * compact player bar with speed/mute/sleep controls, speed cycled to 1.25×, expanded
 * Now Playing panel (speed seg + volume row + sleep row), chapter-end action for a
 * non-last chapter ("Play next chapter →"), chapter-end action for the last chapter
 * ("Mark work complete" + "More by …"), the "In this work" chapter list with
 * current/played/new states, and the sleep countdown label after setting a 15-min timer.
 * Transient UI (expanded panel, sleep, speed) is reset between steps so nothing leaks.
 */
export function m24Steps(nav: {
  showCompactPlayer: () => Promise<void>;
  showSpeedCycled: () => Promise<void>;
  showNowPlaying: () => Promise<void>;
  showNextAction: () => Promise<void>;
  showLastAction: () => Promise<void>;
  showChapterStates: () => Promise<void>;
  showSleepCountdown: () => Promise<void>;
}): Step[] {
  return [
    { name: "01-player-compact", run: nav.showCompactPlayer },
    { name: "02-speed", run: nav.showSpeedCycled },
    { name: "03-now-playing", run: nav.showNowPlaying },
    { name: "04-next-action", run: nav.showNextAction },
    { name: "05-last-action", run: nav.showLastAction },
    { name: "06-chapter-states", run: nav.showChapterStates },
    { name: "07-sleep-countdown", run: nav.showSleepCountdown },
  ];
}

/**
 * Build the "m25" walkthrough: three surfaces introduced in M25 (Visual Polish) that
 * the m12 before/after matrix does not isolate — the styled Select trigger (Library sort
 * control rendered by SortFilterBar), the saved-search overflow strip (several chips),
 * and the Library grid showing large cover-art placeholders (glyph + initials tiles).
 * Saved searches are seeded at runtime; fixtures stay 43/44/47.
 */
export function m25Steps(nav: {
  showLibrarySortOpen: () => Promise<void>;
  showSavedSearches: () => Promise<void>;
  showCoverPlaceholders: () => Promise<void>;
}): Step[] {
  return [
    { name: "01-library-sort-open", run: nav.showLibrarySortOpen },
    { name: "02-saved-searches", run: nav.showSavedSearches },
    { name: "03-cover-placeholders", run: nav.showCoverPlaceholders },
  ];
}

/**
 * Build the "m26" walkthrough: five surfaces introduced in M26 (Unified Types & Labels) —
 * the Types & Labels manager in Settings (after creating a user type "show-format" / "Show
 * format" and adding the value "Talk show"), the LabelEditor in an author's chapter "Edit
 * tags" dialog showing Tag + Narrator + the new "Show format" type rows with chips, a plain
 * Library search for "talk show" returning the labelled work, the unified Discover picker
 * with "Talk show" selected and its work results, and a Library label-filter showing works
 * filtered by type/value.
 * All data is seeded at runtime (the "Talk show" label is attached to an UNPLAYED chapter
 * so the Discover unplayed-only backend returns results) — on-disk fixtures stay 43/44/47.
 */
export function m26Steps(nav: {
  seedLabels: () => Promise<void>;
  showLabelManager: () => Promise<void>;
  showLabelEditorOnChapter: () => Promise<void>;
  showSearchByLabel: () => Promise<void>;
  showDiscoverByLabel: () => Promise<void>;
  showLibraryLabelFilter: () => Promise<void>;
}): Step[] {
  return [
    { name: "01-seed", run: nav.seedLabels },
    { name: "02-label-manager", run: nav.showLabelManager },
    { name: "03-label-editor-chapter", run: nav.showLabelEditorOnChapter },
    { name: "04-search-by-label", run: nav.showSearchByLabel },
    { name: "05-discover-by-label", run: nav.showDiscoverByLabel },
    { name: "06-library-label-filter", run: nav.showLibraryLabelFilter },
  ];
}

/**
 * Build the "m27" walkthrough: ten surfaces introduced in M27 (Reflection that Connects) —
 * runtime seed (note + bookmark + rating + re-entry note + play_events on Jane Doe's first
 * chapter so the heatmap/rhythm have activity), journal with play affordance, insights
 * Reflections stat, played-range drill-down, tag-to-library drill, author-detail journal
 * affordance on the seeded chapter, back-nav on Journal & Insights, and nav grouping
 * showing Collections under Browse + Journal/Insights under My listening.
 * All data is seeded at runtime (idempotently) so on-disk fixtures stay 43/44/47.
 */
export function m27Steps(nav: {
  seedJournalAndEvents: () => Promise<void>;
  showJournalPlayable: () => Promise<void>;
  showJournalPlay: () => Promise<void>;
  showInsightsReflections: () => Promise<void>;
  showPlayedRange: () => Promise<void>;
  showInsightsTagToLibrary: () => Promise<void>;
  showChapterJournalAffordance: () => Promise<void>;
  showJournalBack: () => Promise<void>;
  showInsightsBack: () => Promise<void>;
  showNavGroups: () => Promise<void>;
}): Step[] {
  return [
    { name: "01-seed", run: nav.seedJournalAndEvents },
    { name: "02-journal-playable", run: nav.showJournalPlayable },
    { name: "03-journal-play", run: nav.showJournalPlay },
    { name: "04-insights-reflections", run: nav.showInsightsReflections },
    { name: "05-played-range", run: nav.showPlayedRange },
    { name: "06-insights-tag-to-library", run: nav.showInsightsTagToLibrary },
    { name: "07-chapter-journal-affordance", run: nav.showChapterJournalAffordance },
    { name: "08-journal-back", run: nav.showJournalBack },
    { name: "09-insights-back", run: nav.showInsightsBack },
    { name: "10-nav-groups", run: nav.showNavGroups },
  ];
}

export function m12Steps(nav: {
  showEmptyHome: () => Promise<void>;
  showHome: () => Promise<void>;
  showHomeShelves: () => Promise<void>;
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
    { name: "home-shelves", run: nav.showHomeShelves },
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

/**
 * Build the "m28" walkthrough: six surfaces that exercise the Visual Consistency II
 * border/spacing/sizing pass — sidebar+search borders, the rename data-table dividers,
 * a dialog's title+context spacing, a chip-row's rhythm, the work-card grid resting
 * borders, and the expanded-player two-column layout. CSS-only milestone, so these
 * just navigate to existing surfaces; no runtime data seeding beyond what each view needs.
 */
export function m28Steps(nav: {
  showSearchAndSidebar: () => Promise<void>;
  showDataTable: () => Promise<void>;
  showDialogContext: () => Promise<void>;
  showChipRow: () => Promise<void>;
  showCardGrid: () => Promise<void>;
  showExpandedPlayer: () => Promise<void>;
}): Step[] {
  return [
    { name: "01-search-sidebar-borders", run: nav.showSearchAndSidebar },
    { name: "02-data-table-dividers", run: nav.showDataTable },
    { name: "03-dialog-context", run: nav.showDialogContext },
    { name: "04-chip-row-rhythm", run: nav.showChipRow },
    { name: "05-card-grid", run: nav.showCardGrid },
    { name: "06-expanded-player", run: nav.showExpandedPlayer },
  ];
}

/**
 * Build the "m29" walkthrough: eleven surfaces that exercise the Player &
 * Onboarding Micro-Polish pass (M29) — always-visible scrubber thumb, resume-cue
 * tick, chapter-end play-next label + cross-fade, speed-pill/mute/mini-skip compact
 * transport, keyboard-shortcuts dialog, home empty/populated states, scan-complete
 * CTA, Settings anchor sub-nav, collapsed-sidebar caption labels, and the Ctrl+K
 * palette with Authors/Works/Chapters section headers.
 *
 * Steps 06-home-empty and 08-scan-complete represent first-run-only states that are
 * not reachable via the pre-configured fixture; those steps drive the closest
 * reachable state (populated library, or the scan view via direct route navigation)
 * and are marked SOURCE-CONFIRM in the controller review — see Task 14 report.
 *
 * All runtime seeding is idempotent (DB persists across runs). Fixtures stay 43/44/47.
 */
export function m29Steps(nav: {
  showScrubberRest: () => Promise<void>;
  showScrubberCue: () => Promise<void>;
  showChapterEnd: () => Promise<void>;
  showTransport: () => Promise<void>;
  showShortcuts: () => Promise<void>;
  showHomeEmpty: () => Promise<void>;
  showHomeShelves: () => Promise<void>;
  showScanComplete: () => Promise<void>;
  showSettingsSubnav: () => Promise<void>;
  showSidebarCollapsed: () => Promise<void>;
  showPaletteSections: () => Promise<void>;
}): Step[] {
  return [
    { name: "01-scrubber-rest", run: nav.showScrubberRest },
    { name: "02-scrubber-cue", run: nav.showScrubberCue },
    { name: "03-chapter-end", run: nav.showChapterEnd },
    { name: "04-transport", run: nav.showTransport },
    { name: "05-shortcuts", run: nav.showShortcuts },
    { name: "06-home-empty", run: nav.showHomeEmpty },
    { name: "07-home-shelves", run: nav.showHomeShelves },
    { name: "08-scan-complete", run: nav.showScanComplete },
    { name: "09-settings-subnav", run: nav.showSettingsSubnav },
    { name: "10-sidebar-collapsed", run: nav.showSidebarCollapsed },
    { name: "11-palette-sections", run: nav.showPaletteSections },
  ];
}

/**
 * Build the "m30" walkthrough (v8 Real-Scale Hardening — robust incremental scan):
 *  01 scan-summary   — ScanView after a normal scan (scan-diff line + stats)
 *  02 scan-progress  — ScanView in-progress card (seeded progress + Cancel button)
 *  03 scan-removed   — ScanView summary reflecting a soft-deleted item (removed > 0)
 * Progress/removed states are seeded deterministically (the live scan of the tiny fixture is
 * instantaneous, so these states are otherwise un-screenshotable).
 */
export function m30Steps(nav: {
  showScanSummary: () => Promise<void>;
  showScanProgress: () => Promise<void>;
  showScanRemoved: () => Promise<void>;
}): Step[] {
  return [
    { name: "01-scan-summary", run: nav.showScanSummary },
    { name: "02-scan-progress", run: nav.showScanProgress },
    { name: "03-scan-removed", run: nav.showScanRemoved },
  ];
}
