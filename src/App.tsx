import { useEffect, useMemo, useRef, useState } from "react";
import { save, open } from "@tauri-apps/plugin-dialog";
import {
  getLaunchArgs, scanLibrary, getAuthors, getAuthorDetail,
  setChapterPlayed, markChapterFinished, captureWindow, finishWalkthrough, fileUrl,
  getAllTags, setAuthorTags, setWorkTags, setChapterTags, getDiscovery, getDiscoveryByTags,
  getDormantWorks, getMoreLikeThis, suggestTags,
  previewRenames, applyRenames, undoRenames,
  previewMetadata, applyMetadata,
  setGroupingOverride, clearGroupingOverride,
  getSetting, setSetting, pickFolder, searchLibrary, queryHome, resetPlayHistory,
  listTagsWithCounts, renameTag, mergeTags, setTagAlias, clearTagAlias,
  detectSeries, applySeries, getAuthorSeries,
  searchTranscripts, getChapterTranscript,
  savePlaybackPosition,
  setChapterSummary, setChapterTakeaway, setChapterFavorite,
  setWorkReEntryNote, setWorkRating,
  getChapterJournal, addChapterNote, deleteChapterNote, addBookmark, deleteBookmark,
  queryJournal, exportJournal,
  queryInsights, exportRecapPng, seedPlayEvents,
  advancedSearch, listSavedSearches, createSavedSearch, deleteSavedSearch,
  listCollections, createCollection, deleteCollection, reorderCollections, resolveCollection,
  bulkSetWorkTags, setWorkChapterSort,
  exportCurationJson, exportDbSnapshot, importCurationJson, stageDbRestore, libraryHealthScan,
  openMiniPlayer,
  listMetadataTerms, createMetadataTerm, renameMetadataTerm, deleteMetadataTerm, mergeMetadataTerms,
  addMetadataValue, removeMetadataValue, getDiscoveryByMetadata,
  type AuthorRow, type AuthorDetail, type ScanResult, type DiscoveryWork, type DormantWork,
  type RenameItem, type RenameResult, type SearchResults, type HomeData, type PlaybackContext,
  type ChapterRow, type TagStat, type MetadataProposal, type MetadataApplyReport,
  type SeriesView, type TranscriptHit, type ChapterJournal, type JournalResults, type ChapterBookmark,
  type InsightsData, type ScopedResults, type SavedSearch, type Collection,
  type ImportReport, type HealthReport, type MetaTerm,
} from "./lib/api";
import { hasScopedTokens } from "./lib/query";
import { buildRecapSvg } from "./lib/recap";
import { HomeView } from "./views/HomeView";
import { InsightsView } from "./views/InsightsView";
import { JournalView } from "./views/JournalView";
import { LibraryView } from "./views/LibraryView";
import { AuthorDetailView } from "./views/AuthorDetailView";
import { DiscoveryView } from "./views/DiscoveryView";
import { RenameView } from "./views/RenameView";
import { MetadataView } from "./views/MetadataView";
import { SettingsView } from "./views/SettingsView";
import { ScanView } from "./views/ScanView";
import { CollectionsView } from "./components/CollectionsView";
import { BulkTagDialog } from "./components/BulkTagDialog";
import { PlayerBar } from "./player/PlayerBar";
import { MiniPlayer } from "./player/MiniPlayer";
import { NowPlayingPanel } from "./player/NowPlayingPanel";
import { AppShell, type ShellRoute } from "./components/AppShell";
import { CommandPalette } from "./components/CommandPalette";
import { clampSeek, nextSpeed, type TimeLabelMode } from "./player/playback";
import { runSteps } from "./harness/runner";
import { homeSteps, browseSteps, playerSteps, discoverySteps, renameSteps, groupingSteps, settingsSteps, m7Steps, coversSteps, tagsSteps, m12Steps, m16Steps, journalSteps, insightsSteps, m19Steps, m20Steps, m21Steps, m24Steps } from "./harness/walkthroughs";
import {
  parseBrowsePrefs,
  type BrowsePrefs,
  type AuthorSort,
  type PlayedStatus,
  type WorkSort,
} from "./lib/browse";
import { parseDensity, type Density } from "./lib/density";
import { parseA11yPrefs, DEFAULT_A11Y, type A11yPrefs } from "./lib/a11y";
import {
  parseHomeShelves,
  serializeHomeShelves,
  loadShelfItems,
  type HomeShelf,
  type ShelfItem,
} from "./lib/shelves";
import { applyMediaSession, updatePosition, type NowPlayingMeta } from "./lib/mediaSession";
import { emit, listen } from "@tauri-apps/api/event";

// Wait for React to commit and the browser to paint before a harness screenshot.
function settle(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 60))),
  );
}

// Wait for any <img> (e.g. cover art served via the asset protocol) to finish loading,
// so a screenshot taken after settle() doesn't capture half-loaded covers.
function imagesSettled(): Promise<void> {
  const imgs = Array.from(document.images);
  return Promise.all(
    imgs.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          }),
    ),
  ).then(() => undefined);
}

type Route =
  | { kind: "loading" }
  | { kind: "scan" }
  | { kind: "home" }
  | { kind: "library" }
  | { kind: "author" }
  | { kind: "discovery" }
  | { kind: "rename" }
  | { kind: "metadata" }
  | { kind: "settings"; firstRun: boolean }
  | { kind: "journal" }
  | { kind: "insights" }
  | { kind: "collections" };

function shellRoute(route: Route): ShellRoute {
  if (route.kind === "home") return "home";
  if (route.kind === "discovery") return "discovery";
  if (route.kind === "rename") return "settings";
  if (route.kind === "metadata") return "settings";
  if (route.kind === "settings") return "settings";
  if (route.kind === "journal") return "journal";
  if (route.kind === "insights") return "insights";
  if (route.kind === "collections") return "collections";
  return "library";
}

// SVG string → PNG bytes via the WebView canvas. The SVG is self-contained (no external
// images) so the canvas is never tainted and toBlob succeeds. Returns null on failure.
async function rasterizeSvgToPng(svg: string, w: number, h: number): Promise<Uint8Array | null> {
  try {
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("svg decode failed"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return null;
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

export default function App() {
  const [route, setRoute] = useState<Route>({ kind: "loading" });
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [authors, setAuthors] = useState<AuthorRow[]>([]);
  const [detail, setDetail] = useState<AuthorDetail | null>(null);
  const [authorSeries, setAuthorSeries] = useState<SeriesView[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [tagStats, setTagStats] = useState<TagStat[]>([]);
  const [forYou, setForYou] = useState<DiscoveryWork[]>([]);
  const [byTags, setByTags] = useState<DiscoveryWork[]>([]);
  const [pickedTags, setPickedTags] = useState<string[]>([]);
  const [libraryRoot, setLibraryRoot] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(false);
  const [harnessMenuOpen, setHarnessMenuOpen] = useState(false);
  const [density, setDensity] = useState<Density>("comfortable");
  const [a11y, setA11y] = useState<A11yPrefs>(DEFAULT_A11Y);

  // ---- library search (controlled; spans authors/works/chapters) ----
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [transcriptResults, setTranscriptResults] = useState<TranscriptHit[] | null>(null);

  // ---- M19 scoped search (tag/duration/status tokens) ----
  const [scopedResults, setScopedResults] = useState<ScopedResults | null>(null);

  // ---- M19 multi-select (scoped results) ----
  const [selectMode, setSelectMode] = useState(false);
  const [selectedWorkIds, setSelectedWorkIds] = useState<number[]>([]);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);

  // ---- M19 saved searches ----
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);

  // ---- M19 smart collections ----
  const [collections, setCollections] = useState<Collection[]>([]);
  const [resolvedCollections, setResolvedCollections] = useState<Record<number, ScopedResults | undefined>>({});
  const [collectionsInitialOpenId, setCollectionsInitialOpenId] = useState<number | null>(null);

  // ---- M19 backup & maintenance ----
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [healthReport, setHealthReport] = useState<HealthReport | null>(null);
  const [restoreStaged, setRestoreStaged] = useState(false);

  // ---- M21: metadata vocabulary terms ----
  const [metaTerms, setMetaTerms] = useState<MetaTerm[]>([]);

  // ---- M21: Discover facet picker state ----
  const [pickedFacet, setPickedFacet] = useState<{ facet: string; value: string } | null>(null);
  const [byFacet, setByFacet] = useState<DiscoveryWork[]>([]);

  // ---- command palette (Ctrl+K) ----
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteResults, setPaletteResults] = useState<SearchResults | null>(null);

  // ---- now-playing transcript (fetched per chapter) ----
  const [currentTranscript, setCurrentTranscript] = useState<string | null>(null);

  // ---- browse prefs (sort / filter / work sort) ----
  const [browsePrefs, setBrowsePrefs] = useState<BrowsePrefs>({
    authorSort: "az",
    filterTag: null,
    filterStatus: "all",
    workSort: "az",
  });

  // ---- home shelves (configurable rows) ----
  const [homeShelves, setHomeShelves] = useState<HomeShelf[]>([]);
  const [shelfItems, setShelfItems] = useState<Record<string, ShelfItem[]>>({});
  const shelfIdRef = useRef(0);

  // ---- rename state ----
  const [renameItems, setRenameItems] = useState<RenameItem[]>([]);
  const [renameResult, setRenameResult] = useState<RenameResult | null>(null);
  const lastManifestRef = useRef<string | null>(null);

  // ---- metadata import state ----
  const [metadataProposals, setMetadataProposals] = useState<MetadataProposal[]>([]);
  const [metadataResult, setMetadataResult] = useState<MetadataApplyReport | null>(null);

  // ---- player state ----
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sleepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailRef = useRef<AuthorDetail | null>(null);
  detailRef.current = detail;
  const [current, setCurrent] = useState<PlaybackContext | null>(null);
  const currentRef = useRef<PlaybackContext | null>(null);
  currentRef.current = current;
  const [playerExpanded, setPlayerExpanded] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [sleepMinutes, setSleepMinutes] = useState<number | null>(null);
  const [timeLabelMode, setTimeLabelMode] = useState<TimeLabelMode>("elapsed");
  const cycleTimeLabel = () =>
    setTimeLabelMode((m) => (m === "elapsed" ? "remaining" : m === "remaining" ? "percent" : "elapsed"));
  const [playbackSpeed, setPlaybackSpeedState] = useState(1);
  const playbackSpeedRef = useRef(1);
  playbackSpeedRef.current = playbackSpeed;
  const [muted, setMuted] = useState(false);
  const [sleepRemaining, setSleepRemaining] = useState<number | null>(null);
  const [sleepAtChapterEnd, setSleepAtChapterEnd] = useState(false);
  const sleepAtChapterEndRef = useRef(false);
  sleepAtChapterEndRef.current = sleepAtChapterEnd;
  const sleepIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPosSaveRef = useRef(0); // wall-clock ms of last persisted position
  const [currentWorkChapters, setCurrentWorkChapters] = useState<ChapterRow[]>([]);

  const [home, setHome] = useState<HomeData | null>(null);
  const [homeNow, setHomeNow] = useState(0);
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [insightsNow, setInsightsNow] = useState<number>(() => Date.now());
  const [recapStatus, setRecapStatus] = useState<string | null>(null);
  const routeRef = useRef<Route>(route);
  routeRef.current = route;

  // ---- M20: harness-only mini-player overlay ----
  const [harnessMiniPlayer, setHarnessMiniPlayer] = useState(false);

  // ---- M16 Task 11: intelligence UI state ----
  const [dormantWorks, setDormantWorks] = useState<DormantWork[]>([]);
  const [moreLikeThisMap, setMoreLikeThisMap] = useState<Record<number, DiscoveryWork[]>>({});
  const [workTagSuggestions, setWorkTagSuggestions] = useState<Record<number, string[]>>({});

  // ---- M17: chapter journal state ----
  const [openJournal, setOpenJournal] = useState<ChapterJournal | null>(null);
  const [journalChapterId, setJournalChapterId] = useState<number | null>(null);

  // ---- M21: harness-only state to programmatically open the per-chapter "Edit tags" dialog ----
  const [harnessTagsChapterId, setHarnessTagsChapterId] = useState<number | null>(null);

  // ---- M17: journal view state ----
  const [journal, setJournal] = useState<JournalResults | null>(null);
  const [journalQuery, setJournalQuery] = useState("");
  const [journalExportStatus, setJournalExportStatus] = useState<string | null>(null);

  // ---- M17: chapter journal for NowPlayingPanel (keyed on current chapter) ----
  const [currentChapterJournal, setCurrentChapterJournal] = useState<ChapterJournal | null>(null);

  // ---- M17: pending seek ref for jump-to-bookmark ----
  const pendingSeekRef = useRef<number | null>(null);


  useEffect(() => {
    const ctx = current;
    if (!ctx) { setCurrentWorkChapters([]); return; }
    let cancelled = false;
    void getAuthorDetail(ctx.authorId).then((d) => {
      if (cancelled) return;
      const work = d.works.find((w) => w.id === ctx.workId);
      setCurrentWorkChapters(work?.chapters ?? []);
    }).catch(() => { if (!cancelled) setCurrentWorkChapters([]); });
    return () => { cancelled = true; };
  }, [current?.workId, current?.authorId]);

  // Fetch chapter journal for the currently playing chapter (for NowPlayingPanel bookmarks).
  useEffect(() => {
    const chapterId = current?.chapter.id;
    if (!chapterId) { setCurrentChapterJournal(null); return; }
    let cancelled = false;
    void getChapterJournal(chapterId).then((j) => {
      if (!cancelled) setCurrentChapterJournal(j);
    }).catch(() => { if (!cancelled) setCurrentChapterJournal(null); });
    return () => { cancelled = true; };
  }, [current?.chapter.id]);

  function setSidebarCollapsed(collapsed: boolean) {
    setSidebarCollapsedState(collapsed);
    void setSetting("sidebar_collapsed", String(collapsed));
  }

  function onDensityChange(d: Density) {
    setDensity(d);
    void setSetting("library_density", d);
  }

  const updateA11y = (next: A11yPrefs) => { setA11y(next); void setSetting("a11y_prefs", JSON.stringify(next)); };

  async function loadHome() {
    const now = Date.now();
    setHomeNow(now);
    setHome(await queryHome(now, new Date().getTimezoneOffset()));
    // Load dormant works (>30 days) for the Forgotten shelf.
    getDormantWorks(now, 30).then(setDormantWorks).catch(() => setDormantWorks([]));
  }
  async function openHome() {
    await loadHome();
    setRoute({ kind: "home" });
  }

  async function loadInsights(nowMs?: number) {
    const now = nowMs ?? Date.now();
    setInsightsNow(now);
    const data = await queryInsights(now, new Date().getTimezoneOffset());
    setInsights(data);
  }
  function openInsights() {
    void loadInsights();
    setRoute({ kind: "insights" });
  }
  async function handleExportRecap() {
    if (!insights) return;
    const svg = buildRecapSvg(insights.recap);
    const bytes = await rasterizeSvgToPng(svg, 1080, 1350);
    if (!bytes) {
      setRecapStatus("Could not render the recap image.");
      setTimeout(() => setRecapStatus(null), 4000);
      return;
    }
    const path = await save({
      defaultPath: `audioshelf-year-in-listening-${insights.recap.year}.png`,
      filters: [{ name: "PNG image", extensions: ["png"] }],
    });
    if (!path) return;
    const saved = await exportRecapPng(path, Array.from(bytes));
    setRecapStatus(`Saved recap to ${saved}`);
    setTimeout(() => setRecapStatus(null), 4000);
  }

  async function requestMoreLikeThis(workId: number) {
    const results = await getMoreLikeThis(workId, 12).catch(() => [] as DiscoveryWork[]);
    setMoreLikeThisMap((prev) => ({ ...prev, [workId]: results }));
  }

  async function loadWorkTagSuggestions(workId: number) {
    const suggestions = await suggestTags(workId).catch(() => [] as string[]);
    setWorkTagSuggestions((prev) => ({ ...prev, [workId]: suggestions }));
  }

  async function loadAuthors() {
    setAuthors(await getAuthors());
  }

  async function refreshTags() {
    setAllTags(await getAllTags());
    setTagStats(await listTagsWithCounts());
  }

  const loadMetaTerms = async () => setMetaTerms(await listMetadataTerms().catch(() => [] as MetaTerm[]));

  const handleCreateMetaTerm = async (facet: string, value: string) => { await createMetadataTerm(facet, value); await loadMetaTerms(); };
  const handleRenameMetaTerm = async (id: number, value: string) => { await renameMetadataTerm(id, value); await loadMetaTerms(); };
  const handleDeleteMetaTerm = async (id: number) => { await deleteMetadataTerm(id); await loadMetaTerms(); };
  const handleMergeMetaTerms = async (sourceIds: number[], targetId: number) => { await mergeMetadataTerms(sourceIds, targetId); await loadMetaTerms(); };

  // Flat list of all known metadata values for the MetadataEditor datalist suggestions.
  const metaSuggestions = useMemo(() => Array.from(new Set(metaTerms.map((t) => t.value))).sort(), [metaTerms]);

  // Facet term lists for the Discover facet picker.
  const narratorTerms = useMemo(() => metaTerms.filter((t) => t.facet === "narrator"), [metaTerms]);
  const languageTerms = useMemo(() => metaTerms.filter((t) => t.facet === "language"), [metaTerms]);
  const moodTerms = useMemo(() => metaTerms.filter((t) => t.facet === "mood"), [metaTerms]);

  const pickFacet = async (facet: string, value: string) => {
    setPickedFacet({ facet, value });
    setByFacet(await getDiscoveryByMetadata(facet, value));
  };

  const handleAddChapterMeta = async (chapterId: number, facet: string, value: string) => {
    await addMetadataValue("chapter", chapterId, facet, value);
    await loadMetaTerms();
    if (detail) await openAuthor(detail.id);
  };
  const handleRemoveChapterMeta = async (chapterId: number, termId: number) => {
    await removeMetadataValue("chapter", chapterId, termId);
    if (detail) await openAuthor(detail.id);
  };
  const handleAddAuthorMeta = async (authorId: number, facet: string, value: string) => {
    await addMetadataValue("author", authorId, facet, value);
    await loadMetaTerms();
    if (detail) await openAuthor(detail.id);
  };
  const handleRemoveAuthorMeta = async (authorId: number, termId: number) => {
    await removeMetadataValue("author", authorId, termId);
    if (detail) await openAuthor(detail.id);
  };

  async function setTags(tags: string[]) {
    if (!detailRef.current) return;
    await setAuthorTags(detailRef.current.id, tags);
    setDetail(await getAuthorDetail(detailRef.current.id));
    await refreshTags();
  }

  async function setWorkTagsFor(workId: number, tags: string[]) {
    if (!detailRef.current) return;
    await setWorkTags(workId, tags);
    setDetail(await getAuthorDetail(detailRef.current.id));
    await refreshTags();
  }

  async function setChapterTagsFor(chapterId: number, tags: string[]) {
    if (!detailRef.current) return;
    await setChapterTags(chapterId, tags);
    setDetail(await getAuthorDetail(detailRef.current.id));
    await refreshTags();
  }

  // ---- M17 journal helpers ----

  async function refreshJournal(chapterId: number) {
    const j = await getChapterJournal(chapterId);
    setOpenJournal(j);
  }

  async function refreshDetailAfterJournalMutation() {
    if (detailRef.current) setDetail(await getAuthorDetail(detailRef.current.id));
  }

  async function handleOpenJournal(chapterId: number) {
    setJournalChapterId(chapterId);
    const j = await getChapterJournal(chapterId);
    setOpenJournal(j);
  }

  async function handleSetChapterSummary(chapterId: number, text: string) {
    await setChapterSummary(chapterId, text);
    await refreshDetailAfterJournalMutation();
    await refreshJournal(chapterId);
  }

  async function handleSetChapterTakeaway(chapterId: number, text: string) {
    await setChapterTakeaway(chapterId, text);
    await refreshDetailAfterJournalMutation();
    await refreshJournal(chapterId);
  }

  async function handleSetChapterFavorite(chapterId: number, isFavorite: boolean) {
    await setChapterFavorite(chapterId, isFavorite);
    await refreshDetailAfterJournalMutation();
    await refreshJournal(chapterId);
  }

  async function handleAddChapterNote(chapterId: number, positionSecs: number, body: string) {
    await addChapterNote(chapterId, positionSecs, body);
    await refreshJournal(chapterId);
  }

  async function handleDeleteChapterNote(noteId: number) {
    await deleteChapterNote(noteId);
    if (journalChapterId !== null) await refreshJournal(journalChapterId);
  }

  async function handleAddBookmark(chapterId: number, positionSecs: number, label: string) {
    await addBookmark(chapterId, positionSecs, label);
    await refreshJournal(chapterId);
  }

  async function handleDeleteBookmark(bookmarkId: number) {
    await deleteBookmark(bookmarkId);
    if (journalChapterId !== null) await refreshJournal(journalChapterId);
  }

  async function handleSetWorkReEntryNote(workId: number, note: string) {
    await setWorkReEntryNote(workId, note);
    await refreshDetailAfterJournalMutation();
  }

  async function handleSetWorkRating(workId: number, rating: string) {
    await setWorkRating(workId, rating);
    await refreshDetailAfterJournalMutation();
  }

  async function onChapterSortChange(workId: number, sort: string) {
    await setWorkChapterSort(workId, sort);
    if (detailRef.current) setDetail(await getAuthorDetail(detailRef.current.id));
  }

  // ---- M17: journal view helpers ----

  async function loadJournal(q: string) {
    setJournalQuery(q);
    const results = await queryJournal(q);
    setJournal(results);
  }

  async function openJournalView() {
    const results = await queryJournal(journalQuery);
    setJournal(results);
    setRoute({ kind: "journal" });
  }

  async function handleExportJournal(format: "markdown" | "json") {
    const path = await save({
      defaultPath: format === "markdown" ? "audioshelf-journal.md" : "audioshelf-journal.json",
      filters: [{ name: format === "markdown" ? "Markdown" : "JSON", extensions: [format === "markdown" ? "md" : "json"] }],
    });
    if (!path) return;
    const report = await exportJournal(path, format);
    setJournalExportStatus(`Exported ${report.entryCount} entries to ${report.path}`);
    setTimeout(() => setJournalExportStatus(null), 4000);
  }

  // ---- M17: NowPlayingPanel capture helpers ----

  async function handleAddNoteHere(positionSecs: number) {
    const ctx = currentRef.current;
    if (!ctx) return;
    const body = window.prompt("Add note:");
    if (!body || !body.trim()) return;
    await addChapterNote(ctx.chapter.id, positionSecs, body);
    const j = await getChapterJournal(ctx.chapter.id);
    setCurrentChapterJournal(j);
  }

  async function handleAddBookmarkHere(positionSecs: number) {
    const ctx = currentRef.current;
    if (!ctx) return;
    const label = window.prompt("Bookmark label (optional):") ?? "";
    await addBookmark(ctx.chapter.id, positionSecs, label);
    const j = await getChapterJournal(ctx.chapter.id);
    setCurrentChapterJournal(j);
  }

  async function handleToggleCurrentFavorite(isFavorite: boolean) {
    const ctx = currentRef.current;
    if (!ctx) return;
    await setChapterFavorite(ctx.chapter.id, isFavorite);
    if (detailRef.current) setDetail(await getAuthorDetail(detailRef.current.id));
  }

  function jumpToBookmark(b: ChapterBookmark) {
    const cur = currentRef.current;
    if (cur && cur.chapter.id === b.chapterId && audioRef.current) {
      audioRef.current.currentTime = b.positionSecs;
      return;
    }
    pendingSeekRef.current = b.positionSecs;
    void playChapterById(b.chapterId);
  }

  async function playChapterById(chapterId: number) {
    // Resolve the chapter's author and work via getAuthorDetail, mirroring the M14 jumpToChapter pattern.
    // We need the authorId — find it from the currentChapterJournal entries or look up all authors.
    // Since we have a chapterId, we scan all authors to find the one that owns this chapter.
    const allAuthors = await getAuthors();
    for (const a of allAuthors) {
      const d = await getAuthorDetail(a.id);
      for (const w of d.works) {
        const ch = w.chapters.find((c) => c.id === chapterId);
        if (ch) {
          playChapter({
            chapter: ch,
            authorId: d.id,
            authorName: d.name,
            workId: w.id,
            workTitle: w.baseTitle,
            workTotalChapters: w.chapters.length,
            workPlayedChapters: w.chapters.filter((c) => c.played).length,
          });
          return;
        }
      }
    }
  }

  async function doRenameTag(from: string, to: string) {
    await renameTag(from, to);
    await refreshTags();
  }

  async function doMergeTags(sources: string[], target: string) {
    await mergeTags(sources, target);
    await refreshTags();
  }

  async function doSetTagAlias(alias: string, canonical: string) {
    await setTagAlias(alias, canonical);
  }

  async function doClearTagAlias(alias: string) {
    await clearTagAlias(alias);
  }

  async function openRename() {
    setRenameResult(null);
    setRenameItems(await previewRenames());
    setRoute({ kind: "rename" });
  }
  async function reloadRenamePreview() {
    setRenameResult(null);
    setRenameItems(await previewRenames());
  }
  async function doApplyRenames(chapterIds: number[]) {
    const res = await applyRenames(chapterIds, Date.now());
    lastManifestRef.current = res.manifestPath;
    setRenameResult(res);
    setRenameItems(await previewRenames()); // reflect new on-disk names
  }
  async function doUndoRenames() {
    if (!renameResult) return;
    await undoRenames(renameResult.manifestPath);
    setRenameResult(null);
    setRenameItems(await previewRenames());
  }

  async function openMetadata() {
    setMetadataResult(null);
    setMetadataProposals(await previewMetadata());
    setRoute({ kind: "metadata" });
  }
  async function reloadMetadataPreview() {
    setMetadataResult(null);
    setMetadataProposals(await previewMetadata());
  }
  async function doApplyMetadata(accepted: MetadataProposal[]) {
    const res = await applyMetadata(accepted);
    setMetadataResult(res);
    setMetadataProposals(await previewMetadata()); // refresh to remove applied diffs
  }

  async function openDiscovery() {
    setForYou(await getDiscovery());
    await refreshTags();
    await loadMetaTerms();
    setByTags([]);
    setPickedTags([]);
    setRoute({ kind: "discovery" });
  }

  async function pickTags(tags: string[]) {
    setPickedTags(tags);
    setByTags(tags.length === 0 ? [] : await getDiscoveryByTags(tags));
  }

  // ---- browse prefs persistence ----
  const persistPrefs = (update: (prev: BrowsePrefs) => BrowsePrefs) => {
    setBrowsePrefs((prev) => {
      const next = update(prev);
      void setSetting("browse_prefs", JSON.stringify(next));
      return next;
    });
  };

  // ---- home shelves persistence ----
  const persistShelves = (update: (prev: HomeShelf[]) => HomeShelf[]) => {
    setHomeShelves((prev) => {
      const next = update(prev);
      void setSetting("home_shelves", serializeHomeShelves({ shelves: next }));
      return next;
    });
  };

  const onAddShelf = (s: Omit<HomeShelf, "id">) =>
    persistShelves((prev) => [...prev, { ...s, id: `s${(shelfIdRef.current += 1)}_${prev.length}` }]);
  const onRemoveShelf = (id: string) => persistShelves((prev) => prev.filter((s) => s.id !== id));
  const onRenameShelf = (id: string, title: string) =>
    persistShelves((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
  const onMoveShelf = (id: string, dir: -1 | 1) =>
    persistShelves((prev) => {
      const i = prev.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const setAuthorSort = (s: AuthorSort) => persistPrefs((p) => ({ ...p, authorSort: s }));
  const setFilterTag = (t: string | null) => persistPrefs((p) => ({ ...p, filterTag: t }));
  const setFilterStatus = (s: PlayedStatus) => persistPrefs((p) => ({ ...p, filterStatus: s }));
  const setWorkSort = (s: WorkSort) => persistPrefs((p) => ({ ...p, workSort: s }));

  // Persist the chosen root, scan it, and refresh the author list. Fails safe:
  // a bad/missing path leaves the user on Settings with an error, never crashes.
  async function scanRoot(root: string, persist: boolean) {
    setBusy(true);
    setScanError(null);
    try {
      const result = await scanLibrary(root);
      if (persist) await setSetting("library_root", root);
      setLibraryRoot(root);
      setScan(result);
      await loadAuthors();
      await refreshTags();
      await loadMetaTerms();
      return true;
    } catch (e) {
      setScanError(String(e));
      setLibraryRoot(root);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function openSettings() {
    setScanError(null);
    setRoute({ kind: "settings", firstRun: false });
  }

  async function chooseFolder() {
    const picked = await pickFolder();
    if (!picked) return; // user cancelled
    const ok = await scanRoot(picked, true);
    if (ok) await openHome();
  }

  async function rescan() {
    if (!libraryRoot) return;
    await scanRoot(libraryRoot, true);
  }

  async function openAuthor(id: number) {
    const d = await getAuthorDetail(id);
    setDetail(d);
    setRoute({ kind: "author" });
    // Load persisted series; if none yet, auto-detect-and-apply silently (low friction).
    let series = await getAuthorSeries(id);
    if (series.length === 0) {
      const proposals = await detectSeries(id);
      if (proposals.length > 0) {
        await applySeries(id, proposals);
        series = await getAuthorSeries(id);
      }
    }
    setAuthorSeries(series);
    // Load auto-tag suggestions for each of this author's works.
    for (const work of d.works) {
      void loadWorkTagSuggestions(work.id);
    }
  }

  async function togglePlayed(chapterId: number, played: boolean) {
    await setChapterPlayed(chapterId, played);
    if (detailRef.current) setDetail(await getAuthorDetail(detailRef.current.id));
    await loadAuthors();
    if (routeRef.current.kind === "home") await loadHome();
  }

  async function setGrouping(chapterId: number, baseTitle: string, chapterNo: number) {
    const d = await setGroupingOverride(chapterId, baseTitle, chapterNo);
    setDetail(d);
    await loadAuthors();
  }
  async function clearGrouping(chapterId: number) {
    const d = await clearGroupingOverride(chapterId);
    setDetail(d);
    await loadAuthors();
  }

  async function playNextChapterOfWork(workId: number, authorId: number) {
    const detail = await getAuthorDetail(authorId);
    const work = detail.works.find((w) => w.id === workId);
    if (!work) return;
    const next = work.chapters.find((c) => !c.played) ?? work.chapters[0];
    if (!next) return;
    const total = work.chapters.length;
    const played = work.chapters.filter((c) => c.played).length;
    playChapter({
      chapter: next, authorId: detail.id, authorName: detail.name,
      workId: work.id, workTitle: work.baseTitle,
      workTotalChapters: total, workPlayedChapters: played,
    });
  }

  async function playAuthorNext(authorId: number) {
    const d = await getAuthorDetail(authorId);
    for (const w of d.works) {
      const ch = w.chapters.find((c) => !c.played) ?? w.chapters[0];
      if (ch) {
        playChapter({
          chapter: ch, authorId: d.id, authorName: d.name,
          workId: w.id, workTitle: w.baseTitle,
          workTotalChapters: w.chapters.length,
          workPlayedChapters: w.chapters.filter((c) => c.played).length,
        });
        return;
      }
    }
  }

  function jumpToChapter(chapter: ChapterRow) {
    const ctx = currentRef.current;
    if (!ctx) return;
    const chapters = currentWorkChapters;
    playChapter({
      chapter, authorId: ctx.authorId, authorName: ctx.authorName,
      workId: ctx.workId, workTitle: ctx.workTitle,
      workTotalChapters: chapters.length || ctx.workTotalChapters,
      workPlayedChapters: chapters.filter((c) => c.played).length,
    });
  }

  function playChapter(context: PlaybackContext) {
    setCurrent(context);
    const audio = audioRef.current;
    if (audio) {
      // Per-second resume (M24): seed a resume seek only if no bookmark seek is already pending.
      const resumeAt = context.chapter.playbackPositionSecs;
      if (pendingSeekRef.current == null && resumeAt > 1) pendingSeekRef.current = resumeAt;
      audio.src = fileUrl(context.chapter.filePath);
      audio.load();
      void audio.play().catch(() => { /* autoplay may be blocked; bar still shows */ });
    }
  }

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => {});
    else audio.pause();
  }

  function seek(secs: number) {
    if (audioRef.current) audioRef.current.currentTime = secs;
  }

  function skip(delta: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = clampSeek(audio.currentTime, delta, audio.duration || 0);
  }

  function setVolume(v: number) {
    if (audioRef.current) audioRef.current.volume = v;
    setVolumeState(v);
  }

  function setPlaybackSpeed(v: number) {
    if (audioRef.current) audioRef.current.playbackRate = v;
    setPlaybackSpeedState(v);
    void setSetting("playback_speed", String(v));
  }

  function toggleMute() {
    const audio = audioRef.current;
    const next = !muted;
    setMuted(next);
    if (audio) audio.muted = next;
  }

  function setSleep(minutes: number | null, atChapterEnd = false) {
    if (sleepTimerRef.current) { clearTimeout(sleepTimerRef.current); sleepTimerRef.current = null; }
    if (sleepIntervalRef.current) { clearInterval(sleepIntervalRef.current); sleepIntervalRef.current = null; }
    setSleepAtChapterEnd(atChapterEnd);
    if (atChapterEnd) { setSleepMinutes(null); setSleepRemaining(null); return; }
    setSleepMinutes(minutes);
    if (minutes) {
      const deadline = Date.now() + minutes * 60_000;
      setSleepRemaining(minutes * 60);
      sleepTimerRef.current = setTimeout(() => {
        audioRef.current?.pause();
        setSleepMinutes(null);
        setSleepRemaining(null);
        if (sleepIntervalRef.current) { clearInterval(sleepIntervalRef.current); sleepIntervalRef.current = null; }
      }, minutes * 60_000);
      sleepIntervalRef.current = setInterval(() => {
        const rem = Math.max(0, Math.round((deadline - Date.now()) / 1000));
        setSleepRemaining(rem);
        if (rem <= 0 && sleepIntervalRef.current) { clearInterval(sleepIntervalRef.current); sleepIntervalRef.current = null; }
      }, 1000);
    } else {
      setSleepRemaining(null);
    }
  }

  async function handleEnded() {
    setIsPlaying(false);
    if (sleepAtChapterEndRef.current) {
      audioRef.current?.pause();
      setSleepAtChapterEnd(false);
    }
    const c = currentRef.current;
    if (!c) return;
    await markChapterFinished(c.chapter.id, Date.now());
    if (detailRef.current) setDetail(await getAuthorDetail(detailRef.current.id));
    await loadAuthors();
    if (routeRef.current.kind === "home") await loadHome();
    // Stop after each chapter — no auto-advance.
  }

  function onToggleWork(id: number) {
    setSelectedWorkIds((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  }

  async function onBulkApply(add: string[], remove: string[]) {
    await bulkSetWorkTags(selectedWorkIds, add, remove);
    // Re-run the current scoped search to refresh tags in the result set.
    const q = query.trim();
    if (q) {
      const sr = await advancedSearch(q);
      setScopedResults(sr);
    }
    await refreshTags();
  }

  async function refreshSavedSearches() {
    const list = await listSavedSearches().catch(() => [] as SavedSearch[]);
    setSavedSearches(list);
  }

  async function handleSaveSearch(name: string, q: string) {
    await createSavedSearch(name, q, Date.now());
    await refreshSavedSearches();
  }

  async function handleDeleteSavedSearch(id: number) {
    await deleteSavedSearch(id);
    await refreshSavedSearches();
  }

  async function refreshCollections() {
    const list = await listCollections().catch(() => [] as Collection[]);
    setCollections(list);
  }

  function openCollections() {
    void listCollections().then(setCollections);
    setRoute({ kind: "collections" });
  }

  const onResolveCollection = (id: number) => {
    void resolveCollection(id).then((r) => setResolvedCollections((m) => ({ ...m, [id]: r })));
  };

  async function handleCreateCollection(name: string, query: string) {
    await createCollection(name, query, Date.now());
    await refreshCollections();
  }

  async function handleDeleteCollection(id: number) {
    await deleteCollection(id);
    await refreshCollections();
  }

  async function handleReorderCollections(ids: number[]) {
    await reorderCollections(ids);
    await refreshCollections();
  }

  // ---- M19 backup & maintenance handlers ----
  const onExportJson = async () => {
    const path = await save({ defaultPath: "audioshelf-curation.json", filters: [{ name: "JSON", extensions: ["json"] }] });
    if (path) await exportCurationJson(path, Date.now());
  };
  const onExportSnapshot = async () => {
    const path = await save({ defaultPath: "audioshelf-snapshot.db", filters: [{ name: "SQLite", extensions: ["db"] }] });
    if (path) await exportDbSnapshot(path);
  };
  const onImportJson = async () => {
    const path = await open({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
    if (typeof path === "string") setImportReport(await importCurationJson(path));
  };
  const onRestoreSnapshot = async () => {
    const path = await open({ multiple: false, filters: [{ name: "SQLite", extensions: ["db"] }] });
    if (typeof path === "string") { await stageDbRestore(path); setRestoreStaged(true); }
  };
  const onHealthScan = async () => setHealthReport(await libraryHealthScan());

  useEffect(() => {
    void refreshSavedSearches();
    void refreshCollections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      const args = await getLaunchArgs();
      // Precedence: --library flag (harness/dev) → persisted root → first-run onboarding.
      if (args.library) {
        setRoute({ kind: "scan" });
        await scanRoot(args.library, false); // flag is ephemeral; don't persist it
      } else {
        const saved = await getSetting("library_root");
        if (saved) {
          setRoute({ kind: "scan" });
          const ok = await scanRoot(saved, false); // already persisted
          if (!ok) {
            // Saved root is gone/unreadable — fail safe to Settings with the error shown.
            setRoute({ kind: "settings", firstRun: false });
            return;
          }
        } else {
          await refreshTags();
          // No flag and nothing persisted → onboarding.
          setRoute({ kind: "settings", firstRun: true });
          return;
        }
      }

      setBrowsePrefs(parseBrowsePrefs(await getSetting("browse_prefs")));
      setSidebarCollapsedState((await getSetting("sidebar_collapsed")) === "true");
      setHomeShelves(parseHomeShelves(await getSetting("home_shelves")).shelves);
      setDensity(parseDensity(await getSetting("library_density")));
      setA11y(parseA11yPrefs(await getSetting("a11y_prefs")));
      { const s = parseFloat((await getSetting("playback_speed")) ?? ""); setPlaybackSpeedState(Number.isFinite(s) && s > 0 ? s : 1); }

      if (args.autostart && args.walkthrough) {
        const openFirstAuthor = async () => {
          const list = await getAuthors();
          if (list.length > 0) await openAuthor(list[0].id);
        };
        const steps =
          args.walkthrough === "m12"
            ? m12Steps({
                showEmptyHome: async () => {
                  await resetPlayHistory();
                  setSidebarCollapsedState(false);
                  setHarnessMenuOpen(false);
                  await loadHome();
                  setRoute({ kind: "home" });
                },
                showHome: async () => {
                  const list = await getAuthors();
                  for (const author of list.slice(0, 3)) await setAuthorTags(author.id, ["cozy"]);
                  if (list.length > 0) {
                    const creator = await getAuthorDetail(list[0].id);
                    const chapters = creator.works.flatMap((work) => work.chapters);
                    const day = 86_400_000;
                    if (chapters[0]) await markChapterFinished(chapters[0].id, Date.now() - day);
                    if (chapters[1]) await markChapterFinished(chapters[1].id, Date.now());
                  }
                  await refreshTags();
                  setAuthors(await getAuthors());
                  await loadHome();
                  setRoute({ kind: "home" });
                },
                showHomeShelves: async () => {
                  // Seed two shelves deterministically: one tag shelf ("cozy", tagged
                  // on the first 3 authors in showHome above) and one status shelf
                  // ("unstarted"). Directly set shelfItems so the shot is deterministic
                  // regardless of the async effect timing.
                  const tagShelf: HomeShelf = { id: "s_harness_tag", title: "Cozy picks", kind: "tag", tag: "cozy" };
                  const statusShelf: HomeShelf = { id: "s_harness_status", title: "Haven't started", kind: "status", status: "unstarted" };
                  setHomeShelves([tagShelf, statusShelf]);
                  const [tagItems, statusItems] = await Promise.all([
                    loadShelfItems(tagShelf).catch(() => [] as ShelfItem[]),
                    loadShelfItems(statusShelf).catch(() => [] as ShelfItem[]),
                  ]);
                  setShelfItems({ [tagShelf.id]: tagItems, [statusShelf.id]: statusItems });
                  setRoute({ kind: "home" });
                  await settle();
                },
                collapseSidebar: async () => { setSidebarCollapsedState(true); setRoute({ kind: "home" }); },
                showLibrary: async () => { setSidebarCollapsedState(false); setQuery(""); setResults(null); setRoute({ kind: "library" }); },
                showSearch: async () => {
                  setQuery("cool");
                  setResults(await searchLibrary("cool"));
                  setRoute({ kind: "library" });
                },
                showAuthorDetail: openFirstAuthor,
                showDiscovery: openDiscovery,
                showDiscoveryByTag: async () => {
                  // Self-contained: reset play history so "For You" is empty
                  // (discovery_for_you requires recent play events; with none it
                  // returns []), then open Discovery fresh and apply a tag filter.
                  // Without "For You" cards pushing it below the fold, the "Pick a
                  // tag" chip + by-tag result set are visible in the viewport.
                  await resetPlayHistory();
                  await openDiscovery();
                  await pickTags(["cozy"]);
                },
                showRename: openRename,
                showSettings: async () => { setRoute({ kind: "settings", firstRun: false }); },
                showPlayerCompact: async () => {
                  const list = await getAuthors();
                  if (!list.length) return;
                  const creator = await getAuthorDetail(list[0].id);
                  const work = creator.works[0];
                  const chapter = work?.chapters[0];
                  if (!work || !chapter) return;
                  setDetail(creator);
                  setRoute({ kind: "author" });
                  playChapter({
                    chapter,
                    authorId: creator.id,
                    authorName: creator.name,
                    workId: work.id,
                    workTitle: work.baseTitle,
                    workTotalChapters: work.chapters.length,
                    workPlayedChapters: work.chapters.filter((item) => item.played).length,
                  });
                  setPlayerExpanded(false);
                },
                showPlayerExpanded: async () => { setPlayerExpanded(true); },
                showPlayerChapters: async () => {
                  // Ensure the multi-chapter work (Jane Doe / "Cool Story", 3 ch)
                  // is in playback context, expand the panel, then cycle the time
                  // label once (elapsed → remaining) so the shot shows "-m:ss".
                  const list = await getAuthors();
                  if (!list.length) return;
                  const creator = await getAuthorDetail(list[0].id);
                  // Pick the work with the MOST chapters so the "In this work"
                  // list renders (works are title-ordered, so works[0] is the
                  // single-chapter "Another Standalone Tale", not "Cool Story").
                  const work = creator.works.reduce(
                    (best, w) => (w.chapters.length > best.chapters.length ? w : best),
                    creator.works[0],
                  );
                  const chapter = work?.chapters[0];
                  if (!work || !chapter) return;
                  setDetail(creator);
                  setRoute({ kind: "author" });
                  playChapter({
                    chapter,
                    authorId: creator.id,
                    authorName: creator.name,
                    workId: work.id,
                    workTitle: work.baseTitle,
                    workTotalChapters: work.chapters.length,
                    workPlayedChapters: work.chapters.filter((item) => item.played).length,
                  });
                  setPlayerExpanded(true);
                  // Let the currentWorkChapters useEffect (keyed on workId/authorId)
                  // resolve its getAuthorDetail fetch before the screenshot.
                  await settle();
                  cycleTimeLabel(); // elapsed → remaining
                },
                showContextMenu: async () => {
                  // showDiscoveryByTag (step 7) wiped play history; re-seed it
                  // so keepListening is non-null and the featured WorkCard renders
                  // with menuOpen={harnessMenuOpen} to demonstrate Menu layering.
                  setPlayerExpanded(false);
                  const list = await getAuthors();
                  if (list.length > 0) {
                    const creator = await getAuthorDetail(list[0].id);
                    const chapters = creator.works.flatMap((work) => work.chapters);
                    const day = 86_400_000;
                    if (chapters[0]) await markChapterFinished(chapters[0].id, Date.now() - day);
                    if (chapters[1]) await markChapterFinished(chapters[1].id, Date.now());
                  }
                  setSidebarCollapsedState(false);
                  await loadHome();
                  setRoute({ kind: "home" });
                  setHarnessMenuOpen(true);
                },
              })
            : args.walkthrough === "home"
            ? homeSteps({
                showEmptyHome: async () => {
                  // Wipe any play history left over from prior harness runs so
                  // this shot genuinely reflects the empty-state Home.
                  await resetPlayHistory();
                  await loadHome();
                  setRoute({ kind: "home" });
                },
                seedAndShow: async () => {
                  const list = await getAuthors();
                  if (list.length > 0) {
                    const d = await getAuthorDetail(list[0].id);
                    const chs = d.works.flatMap((w) => w.chapters);
                    const DAY = 86_400_000;
                    if (chs[0]) await markChapterFinished(chs[0].id, Date.now() - DAY);
                    if (chs[1]) await markChapterFinished(chs[1].id, Date.now());
                  }
                  await loadHome();
                  setRoute({ kind: "home" });
                },
              })
            : args.walkthrough === "player"
            ? playerSteps({ openFirstAuthor, playFirstChapter: async () => {
                const list = await getAuthors();
                if (list.length === 0) return;
                const d = await getAuthorDetail(list[0].id);
                const work = d.works[0];
                const first = work?.chapters[0];
                if (work && first) playChapter({
                  chapter: first,
                  authorId: d.id,
                  authorName: d.name,
                  workId: work.id,
                  workTitle: work.baseTitle,
                  workTotalChapters: work.chapters.length,
                  workPlayedChapters: work.chapters.filter((chapter) => chapter.played).length,
                });
              } })
            : args.walkthrough === "discovery"
            ? discoverySteps({
                // Seed tags + a play event so For-you and Pick-a-tag have data.
                seed: async () => {
                  const list = await getAuthors();
                  for (const a of list) await setAuthorTags(a.id, ["cozy"]);
                  if (list.length > 0) {
                    const d = await getAuthorDetail(list[0].id);
                    const ch = d.works[0]?.chapters[0];
                    if (ch) { await markChapterFinished(ch.id, Date.now()); }
                  }
                  await refreshTags();
                },
                openDiscovery,
                pickFirstTag: async () => { await pickTags(["cozy"]); },
              })
            : args.walkthrough === "rename"
            ? renameSteps({
                openRename,
                applyAll: async () => {
                  const items = await previewRenames();
                  const okIds = items.filter((i) => i.status === "ok").map((i) => i.chapterId);
                  const res = await applyRenames(okIds, Date.now());
                  lastManifestRef.current = res.manifestPath;
                  setRenameResult(res);
                  setRenameItems(await previewRenames());
                  setRoute({ kind: "rename" });
                },
                undoLast: async () => {
                  if (lastManifestRef.current) await undoRenames(lastManifestRef.current);
                  setRenameResult(null);
                  setRenameItems(await previewRenames());
                },
              })
            : args.walkthrough === "grouping"
            ? groupingSteps({
                openFirstAuthor,
                mergeDemo: async () => {
                  const list = await getAuthors();
                  if (list.length === 0) return;
                  const d = await getAuthorDetail(list[0].id);
                  const standalone = d.works.find((w) => w.baseTitle === "Another Standalone Tale");
                  const ch = standalone?.chapters[0];
                  if (ch) setDetail(await setGroupingOverride(ch.id, "Cool Story", 4));
                },
                resetDemo: async () => {
                  const list = await getAuthors();
                  if (list.length === 0) return;
                  // The merged chapter now lives under "Cool Story"; find it by title.
                  const d = await getAuthorDetail(list[0].id);
                  const cool = d.works.find((w) => w.baseTitle === "Cool Story");
                  const merged = cool?.chapters.find((c) => c.title === "Another Standalone Tale");
                  if (merged) setDetail(await clearGroupingOverride(merged.id));
                },
              })
            : args.walkthrough === "m7"
            ? m7Steps({
                showLibrary: async () => setRoute({ kind: "library" }),
                // Set the query AND fetch results synchronously here (bypassing the
                // debounce) so the screenshot after this step is deterministic.
                search: async (q: string) => {
                  setRoute({ kind: "library" });
                  setQuery(q);
                  setResults(await searchLibrary(q));
                },
              })
            : args.walkthrough === "settings"
            ? settingsSteps({
                openSettings: async () => setRoute({ kind: "settings", firstRun: false }),
              })
            : args.walkthrough === "covers"
            ? coversSteps({
                showLibrary: async () => setRoute({ kind: "library" }),
                openFirstAuthor,
              })
            : args.walkthrough === "tags"
            ? tagsSteps({
                // Seed an author tag, a work tag, and a chapter tag on the first author.
                seed: async () => {
                  const list = await getAuthors();
                  if (list.length === 0) return;
                  await setAuthorTags(list[0].id, ["cozy"]);
                  const d = await getAuthorDetail(list[0].id);
                  const w = d.works[0];
                  if (w) {
                    await setWorkTags(w.id, ["mystery"]);
                    const ch = w.chapters[0];
                    if (ch) await setChapterTags(ch.id, ["intro"]);
                  }
                  await refreshTags();
                },
                openDetail: async () => {
                  const list = await getAuthors();
                  if (list.length > 0) await openAuthor(list[0].id);
                },
                searchByTag: async () => {
                  setRoute({ kind: "library" });
                  setQuery("mystery");
                  setResults(await searchLibrary("mystery"));
                },
              })
            : args.walkthrough === "m16"
            ? m16Steps({
                // Surface 1: Settings tag manager — seed tags on a few authors/works so
                // tagStats has real usage counts before opening Settings.
                showManageTags: async () => {
                  const list = await getAuthors();
                  if (list.length > 0) {
                    await setAuthorTags(list[0].id, ["cozy", "drama"]);
                    const d = await getAuthorDetail(list[0].id);
                    if (d.works[0]) await setWorkTags(d.works[0].id, ["cozy"]);
                    if (d.works[0]?.chapters[0]) await setChapterTags(d.works[0].chapters[0].id, ["intro"]);
                  }
                  if (list.length > 1) await setAuthorTags(list[1].id, ["drama"]);
                  await refreshTags();
                  setRoute({ kind: "settings", firstRun: false });
                },
                // Surface 2: MetadataView — WAV fixtures carry no embedded tags so the
                // diff list will be empty (no proposals). Capture honest empty state.
                showMetadataDiff: async () => {
                  await openMetadata();
                },
                // Surface 3: Series spine in AuthorDetail — openAuthor already runs
                // detectSeries/applySeries; with the numeric fixtures the series may or
                // may not be detected. Either way the author detail renders correctly.
                showSeriesSpine: async () => {
                  const list = await getAuthors();
                  if (list.length > 0) await openAuthor(list[0].id);
                },
                // Surface 4: Transcript search bucket in Library — no sidecar .vtt
                // fixtures exist so transcriptResults will be empty. Capture the search
                // state (query entered, transcript section absent/empty) as the honest state.
                showTranscriptSearch: async () => {
                  const q = "cool";
                  setRoute({ kind: "library" });
                  setQuery(q);
                  const [r, tr] = await Promise.all([searchLibrary(q), searchTranscripts(q)]);
                  setResults(r);
                  setTranscriptResults(tr);
                },
                // Surface 5: Forgotten shelf on Home — seed a play event far in the past
                // (91 days ago) so getDormantWorks(now, 30) returns it, then open Home.
                // Self-contained: reset first, then seed exactly one old event.
                showForgottenShelf: async () => {
                  await resetPlayHistory();
                  const list = await getAuthors();
                  if (list.length > 0) {
                    const d = await getAuthorDetail(list[0].id);
                    const ch = d.works[0]?.chapters[0];
                    const ninetyOneDaysAgo = Date.now() - 91 * 86_400_000;
                    if (ch) await markChapterFinished(ch.id, ninetyOneDaysAgo);
                  }
                  // Re-fetch dormant works with the freshly seeded history before loading home.
                  const now = Date.now();
                  const dormant = await getDormantWorks(now, 30).catch(() => [] as DormantWork[]);
                  setDormantWorks(dormant);
                  setHomeNow(now);
                  setHome(await queryHome(now, new Date().getTimezoneOffset()));
                  setRoute({ kind: "home" });
                },
                // Surface 6: Discovery cards with reason strings — seed play history + tags
                // so getDiscovery returns cards with populated reason fields.
                showDiscoverReasons: async () => {
                  // Re-seed: reset first (step 5 wiped history), then mark two chapters
                  // finished and tag all authors "cozy" so the recommendation engine
                  // has both a played signal and a tag to generate reason strings.
                  const list = await getAuthors();
                  for (const a of list) await setAuthorTags(a.id, ["cozy"]);
                  if (list.length > 0) {
                    const d = await getAuthorDetail(list[0].id);
                    const chapters = d.works.flatMap((w) => w.chapters);
                    const day = 86_400_000;
                    if (chapters[0]) await markChapterFinished(chapters[0].id, Date.now() - day);
                    if (chapters[1]) await markChapterFinished(chapters[1].id, Date.now());
                  }
                  await refreshTags();
                  setForYou(await getDiscovery());
                  setByTags([]);
                  setPickedTags([]);
                  setRoute({ kind: "discovery" });
                },
              })
            : args.walkthrough === "journal"
            ? journalSteps({
                // Step 1: open Journal view before any seeding → empty state.
                showJournalEmpty: async () => {
                  await resetPlayHistory();
                  const results = await queryJournal("");
                  setJournal(results);
                  setRoute({ kind: "journal" });
                },
                // Step 2: open first author, open the first chapter's journal dialog,
                // seed summary + takeaway + favorite + note (12s) + bookmark (30s).
                showChapterJournalDialog: async () => {
                  const list = await getAuthors();
                  if (list.length === 0) return;
                  const d = await getAuthorDetail(list[0].id);
                  setDetail(d);
                  setRoute({ kind: "author" });
                  const work = d.works[0];
                  const ch = work?.chapters[0];
                  if (!ch) return;
                  await setChapterSummary(ch.id, "A compelling opening chapter that sets the tone for the whole work.");
                  await setChapterTakeaway(ch.id, "First impressions matter.");
                  await setChapterFavorite(ch.id, true);
                  await addChapterNote(ch.id, 12, "The narrator's voice really draws you in here.");
                  await addBookmark(ch.id, 30, "key idea");
                  // handleOpenJournal sets journalChapterId + openJournal in App state.
                  // openJournalForChapterId prop flows to AuthorDetailView and a useEffect
                  // there sets editState → { chapterId, mode: "journal" }, which renders
                  // the ChapterJournalDialog. Two settle() passes ensure both the prop
                  // re-render and the useEffect+editState re-render are committed before
                  // the outer runSteps settle() takes the screenshot.
                  await handleOpenJournal(ch.id);
                  await settle();
                  await settle();
                },
                // Step 3: set re-entry note + one-word rating on the first work, capture work header.
                showWorkMeta: async () => {
                  const list = await getAuthors();
                  if (list.length === 0) return;
                  // Seed the work-level meta values first.
                  const d0 = await getAuthorDetail(list[0].id);
                  const work = d0.works[0];
                  if (!work) return;
                  await setWorkReEntryNote(work.id, "Resume from the chapter about the journey.");
                  await setWorkRating(work.id, "captivating");
                  // Also close the journal dialog (clear journalChapterId) so the dialog
                  // does not overlap the work-header fields in the screenshot.
                  setJournalChapterId(null);
                  setOpenJournal(null);
                  // Navigate away then back via openAuthor so AuthorDetailView unmounts
                  // and remounts with fresh detail. WorkReEntryField / WorkRatingField are
                  // controlled via local useState initialised from props.value only on
                  // mount; remounting is the only way to show the freshly saved values
                  // without changing feature code.
                  setRoute({ kind: "library" });
                  await settle();
                  await openAuthor(list[0].id);
                },
                // Step 4: open Journal view (now populated) — grouped entries, kind chips.
                showJournalBrowse: async () => {
                  const results = await queryJournal("");
                  setJournal(results);
                  setRoute({ kind: "journal" });
                },
                // Step 5: type a word from the seeded note → filtered results.
                showJournalSearch: async () => {
                  const results = await queryJournal("narrator");
                  setJournal(results);
                  setJournalQuery("narrator");
                  setRoute({ kind: "journal" });
                },
                // Step 6: play the seeded chapter, open Now Playing, show bookmarks + jump + capture controls.
                showNowPlayingBookmarks: async () => {
                  const list = await getAuthors();
                  if (list.length === 0) return;
                  const d = await getAuthorDetail(list[0].id);
                  const work = d.works[0];
                  const ch = work?.chapters[0];
                  if (!work || !ch) return;
                  setDetail(d);
                  setRoute({ kind: "author" });
                  playChapter({
                    chapter: ch,
                    authorId: d.id,
                    authorName: d.name,
                    workId: work.id,
                    workTitle: work.baseTitle,
                    workTotalChapters: work.chapters.length,
                    workPlayedChapters: work.chapters.filter((c) => c.played).length,
                  });
                  setPlayerExpanded(true);
                  await settle();
                },
              })
            : args.walkthrough === "insights"
            ? insightsSteps({
                // Fixed anchor (UTC) so the heatmap/trends are identical every run.
                // 2026-06-12T18:00:00Z.
                showInsightsEmpty: async () => {
                  await resetPlayHistory();
                  await loadInsights(Date.UTC(2026, 5, 12, 18, 0, 0));
                  setRoute({ kind: "insights" });
                  document.querySelector(".app-main")?.scrollTo({ top: 0 });
                  await settle();
                },
                showInsightsOverview: async () => {
                  // Seed ~120 + streak events (same deterministic spread used previously).
                  const NOW = Date.UTC(2026, 5, 12, 18, 0, 0);
                  const DAY = 86_400_000;
                  const authors = await getAuthors();
                  // Collect a handful of real chapter ids to attribute events to.
                  const chapterIds: number[] = [];
                  for (const a of authors.slice(0, 3)) {
                    const d = await getAuthorDetail(a.id);
                    for (const w of d.works) for (const c of w.chapters) chapterIds.push(c.id);
                  }
                  if (chapterIds.length === 0) return;
                  // Deterministic spread: vary day offset (0..90), hour, and chapter — no RNG.
                  const events: { chapterId: number; playedAt: number }[] = [];
                  for (let i = 0; i < 120; i++) {
                    const dayOffset = (i * 7) % 90;            // spreads across ~13 weeks
                    const hour = 8 + (i % 12);                 // daytime/evening spread
                    const chapterId = chapterIds[i % chapterIds.length];
                    events.push({ chapterId, playedAt: NOW - dayOffset * DAY - hour * 3_600_000 });
                  }
                  // A short current streak ending "today".
                  for (let k = 0; k < 4; k++) {
                    events.push({ chapterId: chapterIds[k % chapterIds.length], playedAt: NOW - k * DAY - 3_600_000 });
                  }
                  await seedPlayEvents(events);
                  await loadInsights(NOW);
                  setRoute({ kind: "insights" });
                  // Scroll to top: stats + heatmap + month-vs-last are at the top.
                  document.querySelector(".app-main")?.scrollTo({ top: 0 });
                  await settle();
                },
                showInsightsTrends: async () => {
                  // Relies on the seeded state from showInsightsOverview — do NOT reset.
                  await loadInsights(Date.UTC(2026, 5, 12, 18, 0, 0));
                  setRoute({ kind: "insights" });
                  await settle();
                  // Scroll the first bar-chart's parent Card into view at the top of the
                  // viewport so all three bar-chart cards (time-of-day, day-of-week, rhythm)
                  // are visible.
                  const firstBarChart = document.querySelector(".bar-chart");
                  const barCard = firstBarChart?.closest(".card") ?? firstBarChart;
                  (barCard as HTMLElement | null)?.scrollIntoView({ block: "start" });
                  await settle();
                },
                showInsightsRecap: async () => {
                  // Relies on the seeded state from showInsightsOverview — do NOT reset.
                  await loadInsights(Date.UTC(2026, 5, 12, 18, 0, 0));
                  setRoute({ kind: "insights" });
                  await settle();
                  // Scroll the recap card to the bottom of the viewport so the breakdowns
                  // above it are visible and the Export PNG button is in frame.
                  document.querySelector(".recap-card")?.scrollIntoView({ block: "end" });
                  await settle();
                },
              })
            : args.walkthrough === "m19"
            ? m19Steps({
                // Step 1: open the command palette with a prefilled query ("cool") so
                // grouped results are visible (authors/works/chapters matching "cool").
                showCommandPalette: async () => {
                  setPaletteOpen(false);
                  setPaletteQuery("");
                  setPaletteResults(null);
                  setRoute({ kind: "library" });
                  setQuery("");
                  setResults(null);
                  setScopedResults(null);
                  await settle();
                  // Pre-fetch results, then open the palette so both state updates
                  // (results + open) commit together in a single React render.
                  const pr = await searchLibrary("cool").catch(() => ({ authors: [], works: [], chapters: [] } as SearchResults));
                  setPaletteQuery("cool");
                  setPaletteResults(pr);
                  setPaletteOpen(true);
                  // Two settle() passes: first to commit the open state, second to
                  // ensure the focused palette input doesn't race with the screenshot.
                  await settle();
                  await settle();
                },
                // Step 2: scoped search with a duration token — chips are rendered for
                // the parsed filter and the results grid shows matched works.
                // Explicitly reset density to "comfortable" so this shot is always at
                // the default density (providing a clear contrast with step 6 spacious).
                showScopedSearch: async () => {
                  setPaletteOpen(false);
                  setPaletteQuery("");
                  setPaletteResults(null);
                  setDensity("comfortable");
                  void setSetting("library_density", "comfortable");
                  const q = "duration:<15m";
                  setQuery(q);
                  const sr = await advancedSearch(q);
                  setScopedResults(sr);
                  setResults(null);
                  setTranscriptResults(null);
                  setSelectMode(false);
                  setSelectedWorkIds([]);
                  setRoute({ kind: "library" });
                  await settle();
                },
                // Step 3: show the saved-search recall row with one "Short reads" entry.
                // Rather than relying on DB cleanup (which may fail silently across runs),
                // we set the savedSearches STATE directly to exactly one mock entry so the
                // screenshot always shows a clean, single chip. The feature itself is
                // exercised by createSavedSearch; the shot proves the recall UI renders.
                showSavedSearches: async () => {
                  // Seed one real entry so the DB is consistent.
                  await createSavedSearch("Short reads", "duration:<15m", Date.now()).catch(() => {});
                  // Override the React state to exactly one entry regardless of DB accumulation.
                  setSavedSearches([{ id: -1, name: "Short reads", query: "duration:<15m" }]);
                  // Show scoped results so filter chips + saved-search row are both in frame.
                  const q = "duration:<15m";
                  setQuery(q);
                  const sr = await advancedSearch(q);
                  setScopedResults(sr);
                  setResults(null);
                  setRoute({ kind: "library" });
                  await settle();
                },
                // Step 4: seed a collection ("tag:cozy") and open the Collections view
                // with it expanded. We seed exactly one collection in the DB, then override
                // the React state to show only that one (ignoring any stale duplicates from
                // prior runs). A real DB entry is needed so resolveCollection works.
                showCollections: async () => {
                  // Ensure the "cozy" tag exists on some works before seeding the collection.
                  const list = await getAuthors();
                  for (const a of list.slice(0, 3)) await setAuthorTags(a.id, ["cozy"]);
                  await refreshTags();
                  // Create one collection (may add a duplicate if stale ones exist in DB,
                  // but we'll override state to show only the newly created one).
                  const newId = await createCollection("Cozy picks", "tag:cozy", Date.now());
                  // Resolve the newly created collection for the expanded result list.
                  const resolvedMap: Record<number, ScopedResults | undefined> = {};
                  const r = await resolveCollection(newId).catch(() => undefined);
                  resolvedMap[newId] = r;
                  // Override state: show exactly ONE collection (the fresh one).
                  const freshCol: Collection = { id: newId, name: "Cozy picks", query: "tag:cozy", position: 0 };
                  setCollections([freshCol]);
                  setResolvedCollections(resolvedMap);
                  // Auto-expand the collection so resolved works are visible.
                  setCollectionsInitialOpenId(newId);
                  setRoute({ kind: "collections" });
                  await settle();
                },
                // Step 5: enter scoped select mode with one work selected so the bulk bar
                // (count + "Tag…" button) is visible.
                showBulkSelect: async () => {
                  const q = "duration:<15m";
                  setQuery(q);
                  const sr = await advancedSearch(q);
                  setScopedResults(sr);
                  setResults(null);
                  setTranscriptResults(null);
                  setRoute({ kind: "library" });
                  await settle();
                  setSelectMode(true);
                  // Select the first work from the scoped results if any; fallback to first author's first work.
                  const firstId = sr.works[0]?.workId ?? null;
                  if (firstId !== null) {
                    setSelectedWorkIds([firstId]);
                  } else {
                    const authors2 = await getAuthors();
                    if (authors2.length > 0) {
                      const d = await getAuthorDetail(authors2[0].id);
                      if (d.works[0]) setSelectedWorkIds([d.works[0].id]);
                    }
                  }
                  await settle();
                },
                // Step 6: change density to "spacious" then show the scoped-results work
                // grid so the looser card gap is visible in the screenshot.
                showDensitySpacious: async () => {
                  setSelectMode(false);
                  setSelectedWorkIds([]);
                  // Set density synchronously first and flush it to the DOM before
                  // the advancedSearch await, so data-density="spacious" is committed
                  // on the AppShell root before the card-grid re-renders.
                  setDensity("spacious");
                  void setSetting("library_density", "spacious");
                  // Run a scoped search so the card-grid (work cards) is rendered —
                  // the author list doesn't use card-grid so density changes aren't visible there.
                  const q = "duration:<15m";
                  setQuery(q);
                  const sr = await advancedSearch(q);
                  setScopedResults(sr);
                  setResults(null);
                  setTranscriptResults(null);
                  setRoute({ kind: "library" });
                  await settle();
                },
                // Step 7: open the first author and set its first work's chapter sort to
                // "title-az" so the sort control is visible in AuthorDetail.
                // We navigate first (so the route is set), then set chapter sort and
                // refresh the detail — avoiding a second openAuthor call that re-runs
                // detectSeries (already applied in earlier steps).
                showChapterSort: async () => {
                  const list = await getAuthors();
                  if (list.length > 0) {
                    const d0 = await getAuthorDetail(list[0].id);
                    setDetail(d0);
                    setRoute({ kind: "author" });
                    const work = d0.works[0];
                    if (work) {
                      await setWorkChapterSort(work.id, "title_asc").catch(() => {});
                      const d1 = await getAuthorDetail(list[0].id);
                      setDetail(d1);
                    }
                  }
                  await settle();
                },
                // Step 8: open Settings with the Backup & maintenance section visible
                // (all five action buttons: export JSON, export snapshot, import JSON,
                // restore snapshot, health scan).
                showBackupMaintenance: async () => {
                  setHealthReport(null);
                  setImportReport(null);
                  setRestoreStaged(false);
                  setRoute({ kind: "settings", firstRun: false });
                  await settle();
                  // Scroll the backup section into view.
                  document.querySelector(".backup-maintenance")?.scrollIntoView({ block: "start" });
                  await settle();
                },
                // Step 9: run the health scan so the HealthReport panel renders (counts +
                // any issue lists + schema version banner). Over synthetic fixtures some
                // checks may return zero issues — the shot proves the surface renders.
                showHealthReport: async () => {
                  const report = await libraryHealthScan();
                  setHealthReport(report);
                  setRoute({ kind: "settings", firstRun: false });
                  await settle();
                  document.querySelector(".health-report")?.scrollIntoView({ block: "start" });
                  await settle();
                },
              })
            : args.walkthrough === "m20"
            ? m20Steps({
                // Step 1: force-reset a11y to known baseline, then switch to light theme.
                // Also reset dir to LTR in case any prior run left it as RTL.
                showThemeLight: async () => {
                  document.documentElement.dir = "ltr";
                  setA11y({ ...DEFAULT_A11Y, theme: "light" });
                  setHarnessMiniPlayer(false);
                  await loadHome();
                  setRoute({ kind: "home" });
                  await settle();
                },
                // Step 2: high-contrast theme.
                showThemeHighContrast: async () => {
                  setA11y({ ...DEFAULT_A11Y, theme: "high-contrast" });
                  setRoute({ kind: "home" });
                  await settle();
                },
                // Step 3: XLarge text size (most visible diff).
                showTextLarge: async () => {
                  setA11y({ ...DEFAULT_A11Y, textSize: "xlarge" });
                  setRoute({ kind: "home" });
                  await settle();
                },
                // Step 4: dyslexia font — navigate to Settings so the multi-line
                // card descriptions (section h2 + muted paragraphs) render in the
                // wider Verdana face with visibly looser letter-spacing and taller
                // line-height across several wrapped text rows.
                showDyslexiaFont: async () => {
                  setPlayerExpanded(false);
                  setA11y({ ...DEFAULT_A11Y, dyslexiaFont: true });
                  setRoute({ kind: "settings", firstRun: false });
                  await settle();
                },
                // Step 5: reduced-motion on; navigate to Settings so the toggle is visibly ON.
                showReducedMotion: async () => {
                  setA11y({ ...DEFAULT_A11Y, reducedMotion: true });
                  setRoute({ kind: "settings", firstRun: false });
                  await settle();
                  document.querySelector(".a11y-section")?.scrollIntoView({ block: "start" });
                  await settle();
                },
                // Step 6: colorblind-safe status icons — open the NowPlayingPanel "In
                // this work" chapter list, which uses explicit check/circle shape icons
                // (not color alone) for played vs. unplayed status.
                showColorblindStatus: async () => {
                  setA11y({ ...DEFAULT_A11Y });
                  const list = await getAuthors();
                  if (!list.length) return;
                  const creator = await getAuthorDetail(list[0].id);
                  // Pick the work with the most chapters so the list is populated.
                  const work = creator.works.reduce(
                    (best, w) => (w.chapters.length > best.chapters.length ? w : best),
                    creator.works[0],
                  );
                  const chapter = work?.chapters[0];
                  if (!work || !chapter) return;
                  setDetail(creator);
                  setRoute({ kind: "author" });
                  playChapter({
                    chapter,
                    authorId: creator.id,
                    authorName: creator.name,
                    workId: work.id,
                    workTitle: work.baseTitle,
                    workTotalChapters: work.chapters.length,
                    workPlayedChapters: work.chapters.filter((item) => item.played).length,
                  });
                  setPlayerExpanded(true);
                  await settle(); // let currentWorkChapters fetch resolve
                },
                // Step 7: focus the skip link so it slides into view (top: var(--space-3)).
                // Close the Now Playing panel opened by step 6 before navigating.
                showSkipLinkFocus: async () => {
                  setPlayerExpanded(false);
                  setA11y({ ...DEFAULT_A11Y });
                  await loadHome();
                  setRoute({ kind: "home" });
                  await settle();
                  document.querySelector<HTMLElement>(".skip-link")?.focus();
                  await settle();
                },
                // Step 8: navigate to Author/Creator Detail — the role="tree" work/chapter
                // browse tree is rendered there. Close the Now Playing panel first.
                showSrTree: async () => {
                  setPlayerExpanded(false);
                  setA11y({ ...DEFAULT_A11Y });
                  const list = await getAuthors();
                  if (list.length > 0) await openAuthor(list[0].id);
                  await settle();
                },
                // Step 9: RTL layout — proves nothing collapses under RTL.
                showRtlLayout: async () => {
                  setA11y({ ...DEFAULT_A11Y });
                  document.documentElement.dir = "rtl";
                  setRoute({ kind: "home" });
                  await settle();
                },
                // Step 10: show the inline MiniPlayer overlay, then restore dir + a11y.
                showMiniPlayer: async () => {
                  document.documentElement.dir = "ltr";
                  setA11y({ ...DEFAULT_A11Y });
                  setRoute({ kind: "home" });
                  setHarnessMiniPlayer(true);
                  await settle();
                },
                // Step 11: Accessibility settings section. Reset a11y to defaults first,
                // then show Settings so controls render in their default state.
                // Set harnessMiniPlayer false to remove the overlay.
                showAccessibilitySettings: async () => {
                  setHarnessMiniPlayer(false);
                  setA11y({ ...DEFAULT_A11Y });
                  setRoute({ kind: "settings", firstRun: false });
                  await settle();
                  document.querySelector(".a11y-section")?.scrollIntoView({ block: "start" });
                  await settle();
                },
              })
            : args.walkthrough === "m21"
            ? m21Steps({
                // Step 1: seed narrator "Jane Roe" + mood "cozy" on the first chapter
                // of the first author ("Jane Doe"), and language "English" on the author.
                // All via the real api — on-disk fixtures stay 43/44/47.
                seedMetadata: async () => {
                  const authors = await getAuthors();
                  const jane = authors.find((a) => a.name === "Jane Doe") ?? authors[0];
                  if (!jane) return;
                  const d = await getAuthorDetail(jane.id);
                  const firstChapter = d.works[0]?.chapters[0];
                  if (firstChapter) {
                    await addMetadataValue("chapter", firstChapter.id, "narrator", "Jane Roe");
                    await addMetadataValue("chapter", firstChapter.id, "mood", "cozy");
                  }
                  // Also attach narrator "Jane Roe" to the first unplayed chapter of any work
                  // so the Narrators browse page has ≥1 result even when works[0].chapters[0]
                  // has been marked played by a prior walkthrough (e.g. m12).
                  const unplayedWork = d.works.find((w) => w.chapters.some((c) => !c.played));
                  const uc = unplayedWork?.chapters.find((c) => !c.played);
                  if (uc) {
                    await addMetadataValue("chapter", uc.id, "narrator", "Jane Roe");
                  }
                  await addMetadataValue("author", jane.id, "language", "English");
                  await loadMetaTerms();
                  await openAuthor(jane.id);
                },
                // Step 2: open Settings — the MetadataManagerView is there with seeded terms.
                showMetadataManager: async () => {
                  await loadMetaTerms();
                  openSettings();
                },
                // Step 3: open the first author's detail, expand works so the first chapter
                // is visible, then programmatically open the "Edit tags" dialog (which hosts
                // the MetadataEditor) for the first chapter. Uses the same mechanism as the
                // overflow-menu "Edit tags" action: setEditState({ mode: "tags", chapterId }).
                // harnessTagsChapterId is passed as openTagsForChapterId to AuthorDetailView
                // where a useEffect mirrors the journal useEffect pattern.
                showChapterMetadataEditor: async () => {
                  const authors = await getAuthors();
                  const jane = authors.find((a) => a.name === "Jane Doe") ?? authors[0];
                  if (!jane) return;
                  const d = await getAuthorDetail(jane.id);
                  const firstChapter = d.works[0]?.chapters[0];
                  if (!firstChapter) return;
                  setHarnessTagsChapterId(null);
                  await openAuthor(jane.id);
                  await settle();
                  setHarnessTagsChapterId(firstChapter.id);
                  await settle();
                  await settle();
                },
                // Step 4: open the Discover view with the first narrator facet selected
                // so the merged narrator-browsing surface (with chapter counts) is captured.
                showNarratorsBrowse: async () => {
                  await openDiscovery();
                  const terms = await listMetadataTerms().catch(() => [] as MetaTerm[]);
                  const narrator = terms.find((t) => t.facet === "narrator")?.value;
                  if (narrator) await pickFacet("narrator", narrator);
                },
                // Step 5: open the Discover view with the "mood: cozy" facet picked so
                // the works list is populated.
                showDiscoverByFacet: async () => {
                  await loadMetaTerms();
                  await pickFacet("mood", "cozy");
                  openDiscovery();
                },
              })
            : args.walkthrough === "m24"
            ? m24Steps({
                // Step 1: compact bar — force-reset speed/sleep, start playing the
                // first chapter of the multi-chapter work, collapse the panel.
                showCompactPlayer: async () => {
                  setPlaybackSpeed(1);
                  setSleep(null);
                  const list = await getAuthors();
                  if (!list.length) return;
                  const creator = await getAuthorDetail(list[0].id);
                  const work = creator.works.reduce(
                    (best, w) => (w.chapters.length > best.chapters.length ? w : best),
                    creator.works[0],
                  );
                  const chapter = work?.chapters[0];
                  if (!work || !chapter) return;
                  setDetail(creator);
                  setRoute({ kind: "author" });
                  playChapter({
                    chapter,
                    authorId: creator.id,
                    authorName: creator.name,
                    workId: work.id,
                    workTitle: work.baseTitle,
                    workTotalChapters: work.chapters.length,
                    workPlayedChapters: work.chapters.filter((c) => c.played).length,
                  });
                  setPlayerExpanded(false);
                  await settle();
                },
                // Step 2: cycle speed once (1 → 1.25×); compact bar still collapsed.
                showSpeedCycled: async () => {
                  setPlaybackSpeed(nextSpeed(playbackSpeed));
                  setPlayerExpanded(false);
                  await settle();
                },
                // Step 3: expanded Now Playing panel — reset speed to 1 to avoid
                // carrying forward the cycled value, open the panel.
                showNowPlaying: async () => {
                  setPlaybackSpeed(1);
                  setPlayerExpanded(true);
                  await settle();
                },
                // Step 4: non-last chapter — pick the first chapter of the multi-chapter
                // work so "Play next chapter →" is shown. Keep panel expanded.
                showNextAction: async () => {
                  const list = await getAuthors();
                  if (!list.length) return;
                  const creator = await getAuthorDetail(list[0].id);
                  const work = creator.works.reduce(
                    (best, w) => (w.chapters.length > best.chapters.length ? w : best),
                    creator.works[0],
                  );
                  // chapters[0] is not the last chapter (work has ≥2 chapters).
                  const chapter = work?.chapters[0];
                  if (!work || !chapter) return;
                  playChapter({
                    chapter,
                    authorId: creator.id,
                    authorName: creator.name,
                    workId: work.id,
                    workTitle: work.baseTitle,
                    workTotalChapters: work.chapters.length,
                    workPlayedChapters: work.chapters.filter((c) => c.played).length,
                  });
                  setPlayerExpanded(true);
                  await settle(); // let currentWorkChapters fetch resolve
                },
                // Step 5: last chapter — drive playChapter to the final chapter of the
                // same multi-chapter work so "Mark work complete" + "More by …" appear.
                showLastAction: async () => {
                  const list = await getAuthors();
                  if (!list.length) return;
                  const creator = await getAuthorDetail(list[0].id);
                  const work = creator.works.reduce(
                    (best, w) => (w.chapters.length > best.chapters.length ? w : best),
                    creator.works[0],
                  );
                  const lastChapter = work?.chapters[work.chapters.length - 1];
                  if (!work || !lastChapter) return;
                  playChapter({
                    chapter: lastChapter,
                    authorId: creator.id,
                    authorName: creator.name,
                    workId: work.id,
                    workTitle: work.baseTitle,
                    workTotalChapters: work.chapters.length,
                    workPlayedChapters: work.chapters.filter((c) => c.played).length,
                  });
                  setPlayerExpanded(true);
                  await settle(); // let currentWorkChapters fetch resolve
                },
                // Step 6: "In this work" chapter list — revert to chapter[0] (non-last)
                // so the list has current + new states visible. Panel stays expanded.
                showChapterStates: async () => {
                  const list = await getAuthors();
                  if (!list.length) return;
                  const creator = await getAuthorDetail(list[0].id);
                  const work = creator.works.reduce(
                    (best, w) => (w.chapters.length > best.chapters.length ? w : best),
                    creator.works[0],
                  );
                  const chapter = work?.chapters[0];
                  if (!work || !chapter) return;
                  playChapter({
                    chapter,
                    authorId: creator.id,
                    authorName: creator.name,
                    workId: work.id,
                    workTitle: work.baseTitle,
                    workTotalChapters: work.chapters.length,
                    workPlayedChapters: work.chapters.filter((c) => c.played).length,
                  });
                  setPlayerExpanded(true);
                  await settle();
                },
                // Step 7: set a 15-min sleep timer and capture the countdown label.
                // Reset speed to 1 so no leftover state bleeds through. Collapse panel
                // after so subsequent sessions start clean.
                showSleepCountdown: async () => {
                  setPlaybackSpeed(1);
                  setSleep(15);
                  setPlayerExpanded(false);
                  await settle();
                },
              })
            : browseSteps({
                // Seed tags on a few authors + a played chapter so sort-by-length,
                // played%, the tag filter, and the status filter all have signal.
                seed: async () => {
                  const list = await getAuthors();
                  for (const a of list.slice(0, 3)) await setAuthorTags(a.id, ["cozy"]);
                  if (list.length > 0) {
                    const d = await getAuthorDetail(list[0].id);
                    const ch = d.works[0]?.chapters[0];
                    if (ch) await markChapterFinished(ch.id, Date.now());
                  }
                  await refreshTags();
                  setAuthors(await getAuthors()); // refresh counts/tags after seeding
                },
                showLibrarySorted: async () => {
                  setRoute({ kind: "library" });
                  setAuthorSort("length");
                },
                showLibraryFiltered: async () => {
                  setFilterTag("cozy");
                  setFilterStatus("unplayed");
                },
                openFirstAuthor: async () => {
                  const list = await getAuthors();
                  if (list.length > 0) await openAuthor(list[0].id);
                },
              });
        await runSteps(steps, args.shots, async (p) => {
          await settle();
          await imagesSettled();
          await settle(); // let the newly-painted covers commit a frame
          await captureWindow(p);
        });
        await finishWalkthrough(args.doneSignal, args.exitWhenDone);
      } else {
        await openHome();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch shelf items whenever the shelf config changes.
  useEffect(() => {
    if (homeShelves.length === 0) { setShelfItems({}); return; }
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        homeShelves.map(async (s) => [s.id, await loadShelfItems(s).catch(() => [])] as const),
      );
      if (!cancelled) setShelfItems(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [homeShelves]);

  // Global Ctrl+K / Cmd+K to open the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Global playback keyboard shortcuts (Space = toggle, ArrowLeft/Right = skip).
  // Uses refs so the empty-deps effect always sees the current values.
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  const skipRef = useRef(skip);
  skipRef.current = skip;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!currentRef.current) return;
      // Space natively activates buttons/links/interactive-role elements — don't hijack it from them.
      const role = t?.getAttribute("role");
      const activatable = !!t && (t.tagName === "BUTTON" || t.tagName === "A" ||
        role === "button" || role === "menuitem" || role === "tab" || role === "treeitem" || role === "option");
      if (e.key === " ") {
        if (activatable) return;          // let the focused control handle Space
        e.preventDefault(); toggleRef.current();
      } else if (e.key === "ArrowLeft")  { e.preventDefault(); skipRef.current(e.shiftKey ? -30 : -15); }
      else if (e.key === "ArrowRight") { e.preventDefault(); skipRef.current(e.shiftKey ?  30 :  15); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Media Session API — SMTC now-playing card + hardware media keys.
  // currentWorkChaptersRef keeps the chapter list stable across renders so the
  // prev/next handlers always see the current list without being in the dep array.
  const currentWorkChaptersRef = useRef<typeof currentWorkChapters>(currentWorkChapters);
  currentWorkChaptersRef.current = currentWorkChapters;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  // Stable refs for prev/next chapter — shared by Media Session and mini-player command listener.
  const playPrevChapterRef = useRef(() => {
    const ctx = currentRef.current;
    const chapters = currentWorkChaptersRef.current;
    if (!ctx || chapters.length === 0) return;
    const idx = chapters.findIndex((c) => c.id === ctx.chapter.id);
    const prev = idx > 0 ? chapters[idx - 1] : chapters[0];
    if (prev) {
      playChapter({
        chapter: prev,
        authorId: ctx.authorId, authorName: ctx.authorName,
        workId: ctx.workId, workTitle: ctx.workTitle,
        workTotalChapters: chapters.length,
        workPlayedChapters: chapters.filter((c) => c.played).length,
      });
    }
  });
  const playNextChapterRef = useRef(() => {
    const ctx = currentRef.current;
    const chapters = currentWorkChaptersRef.current;
    if (!ctx || chapters.length === 0) return;
    const idx = chapters.findIndex((c) => c.id === ctx.chapter.id);
    const next = idx >= 0 && idx < chapters.length - 1 ? chapters[idx + 1] : null;
    if (next) {
      playChapter({
        chapter: next,
        authorId: ctx.authorId, authorName: ctx.authorName,
        workId: ctx.workId, workTitle: ctx.workTitle,
        workTotalChapters: chapters.length,
        workPlayedChapters: chapters.filter((c) => c.played).length,
      });
    }
  });
  // Keep the refs current each render so they always close over the latest playChapter.
  playPrevChapterRef.current = () => {
    const ctx = currentRef.current;
    const chapters = currentWorkChaptersRef.current;
    if (!ctx || chapters.length === 0) return;
    const idx = chapters.findIndex((c) => c.id === ctx.chapter.id);
    const prev = idx > 0 ? chapters[idx - 1] : chapters[0];
    if (prev) {
      playChapter({
        chapter: prev,
        authorId: ctx.authorId, authorName: ctx.authorName,
        workId: ctx.workId, workTitle: ctx.workTitle,
        workTotalChapters: chapters.length,
        workPlayedChapters: chapters.filter((c) => c.played).length,
      });
    }
  };
  playNextChapterRef.current = () => {
    const ctx = currentRef.current;
    const chapters = currentWorkChaptersRef.current;
    if (!ctx || chapters.length === 0) return;
    const idx = chapters.findIndex((c) => c.id === ctx.chapter.id);
    const next = idx >= 0 && idx < chapters.length - 1 ? chapters[idx + 1] : null;
    if (next) {
      playChapter({
        chapter: next,
        authorId: ctx.authorId, authorName: ctx.authorName,
        workId: ctx.workId, workTitle: ctx.workTitle,
        workTotalChapters: chapters.length,
        workPlayedChapters: chapters.filter((c) => c.played).length,
      });
    }
  };

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    if (!current) {
      applyMediaSession(
        navigator.mediaSession as unknown as Parameters<typeof applyMediaSession>[0],
        null, false,
        { onPlay: () => {}, onPause: () => {}, onPrevChapter: () => {}, onNextChapter: () => {},
          onSeekBackward: () => {}, onSeekForward: () => {}, onSeekTo: () => {} },
      );
      return;
    }
    const nowPlayingMeta: NowPlayingMeta = {
      title: current.chapter.title,
      author: current.authorName,
      work: current.workTitle,
      // artwork omitted: resolving cover URL requires an async fetch not suitable here.
    };
    applyMediaSession(
      navigator.mediaSession as unknown as Parameters<typeof applyMediaSession>[0],
      nowPlayingMeta,
      isPlaying,
      {
        onPlay: () => { if (!isPlayingRef.current) toggleRef.current(); },
        onPause: () => { if (isPlayingRef.current) toggleRef.current(); },
        onPrevChapter: () => playPrevChapterRef.current(),
        onNextChapter: () => playNextChapterRef.current(),
        onSeekBackward: (s) => skipRef.current(-s),
        onSeekForward: (s) => skipRef.current(s),
        onSeekTo: (pos) => { if (audioRef.current) audioRef.current.currentTime = pos; },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, isPlaying]);

  // Mini-player: emit playback:state to the mini window.
  // Immediate emit on track/play-state change; throttled (~1/sec) position update.
  useEffect(() => {
    const payload = currentRef.current ? {
      title: currentRef.current.chapter.title,
      author: currentRef.current.authorName,
      artworkUrl: "",
      isPlaying: isPlayingRef.current,
      position: audioRef.current?.currentTime ?? 0,
      duration: audioRef.current?.duration ?? 0,
    } : null;
    void emit("playback:state", payload);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, isPlaying]);

  useEffect(() => {
    const id = setInterval(() => {
      const ctx = currentRef.current;
      if (!ctx) return;
      void emit("playback:state", {
        title: ctx.chapter.title,
        author: ctx.authorName,
        artworkUrl: "",
        isPlaying: isPlayingRef.current,
        position: audioRef.current?.currentTime ?? 0,
        duration: audioRef.current?.duration ?? 0,
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Mini-player: receive commands from the mini window.
  useEffect(() => {
    const un = listen<{ action: "toggle" | "prev" | "next" }>("miniplayer:command", (e) => {
      const a = e.payload.action;
      if (a === "toggle") toggleRef.current();
      else if (a === "prev") playPrevChapterRef.current();
      else if (a === "next") playNextChapterRef.current();
    });
    return () => { void un.then((f) => f()); };
  }, []);

  // Debounced command palette search (mirrors the 150ms library search pattern).
  useEffect(() => {
    if (!paletteOpen) return;
    const q = paletteQuery;
    const t = setTimeout(() => {
      if (q.trim() === "") { setPaletteResults({ authors: [], works: [], chapters: [] }); return; }
      void searchLibrary(q).then(setPaletteResults).catch(() => setPaletteResults(null));
    }, 150);
    return () => clearTimeout(t);
  }, [paletteQuery, paletteOpen]);

  // Debounced backend search. Empty query clears results (list shows instead).
  // When the query contains scoped tokens (tag:/duration:/status:) → advancedSearch;
  // otherwise → the existing searchLibrary + searchTranscripts path.
  useEffect(() => {
    const q = query.trim();
    if (q === "") {
      setResults(null);
      setTranscriptResults(null);
      setScopedResults(null);
      return;
    }
    let cancelled = false;
    if (hasScopedTokens(q)) {
      const t = setTimeout(async () => {
        const sr = await advancedSearch(q);
        if (!cancelled) {
          setScopedResults(sr);
          setResults(null);
          setTranscriptResults(null);
        }
      }, 150);
      return () => { cancelled = true; clearTimeout(t); };
    }
    setScopedResults(null);
    const t = setTimeout(async () => {
      const [r, tr] = await Promise.all([searchLibrary(q), searchTranscripts(q)]);
      if (!cancelled) {
        setResults(r);
        setTranscriptResults(tr);
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  // Fetch transcript for the currently playing chapter.
  useEffect(() => {
    const chapterId = current?.chapter.id;
    if (!chapterId) { setCurrentTranscript(null); return; }
    let cancelled = false;
    void getChapterTranscript(chapterId).then((t) => {
      if (!cancelled) setCurrentTranscript(t ?? null);
    }).catch(() => { if (!cancelled) setCurrentTranscript(null); });
    return () => { cancelled = true; };
  }, [current?.chapter.id]);

  function routedView() {
    if (route.kind === "loading") return <div>Loading…</div>;
    if (route.kind === "scan") return <ScanView result={scan} />;
    if (route.kind === "home") {
      return (
        <HomeView
          home={home}
          nowMs={homeNow}
          onPlay={playChapter}
          onOpenAuthor={openAuthor}
          onOpenLibrary={() => setRoute({ kind: "library" })}
          onOpenSettings={openSettings}
          onPlayNextOfWork={playNextChapterOfWork}
          featureMenuOpen={harnessMenuOpen}
          shelves={homeShelves}
          shelfItems={shelfItems}
          dormantWorks={dormantWorks}
        />
      );
    }
    if (route.kind === "author" && detail) {
      return (
        <AuthorDetailView
          detail={detail}
          onTogglePlayed={togglePlayed}
          onPlayChapter={playChapter}
          onSetTags={setTags}
          onSetWorkTags={setWorkTagsFor}
          onSetChapterTags={setChapterTagsFor}
          onSetGrouping={setGrouping}
          onClearGrouping={clearGrouping}
          allTags={allTags}
          onBack={() => setRoute({ kind: "library" })}
          workSort={browsePrefs.workSort}
          onWorkSortChange={setWorkSort}
          series={authorSeries}
          onPlayNextOfWork={playNextChapterOfWork}
          moreLikeThisMap={moreLikeThisMap}
          onRequestMoreLikeThis={requestMoreLikeThis}
          workTagSuggestions={workTagSuggestions}
          onOpenAuthor={openAuthor}
          openJournal={openJournal}
          onOpenJournal={handleOpenJournal}
          openJournalForChapterId={journalChapterId ?? undefined}
          onSetChapterSummary={handleSetChapterSummary}
          onSetChapterTakeaway={handleSetChapterTakeaway}
          onSetChapterFavorite={handleSetChapterFavorite}
          onAddChapterNote={handleAddChapterNote}
          onDeleteChapterNote={handleDeleteChapterNote}
          onAddBookmark={handleAddBookmark}
          onDeleteBookmark={handleDeleteBookmark}
          onSetWorkReEntryNote={handleSetWorkReEntryNote}
          onSetWorkRating={handleSetWorkRating}
          onChapterSortChange={onChapterSortChange}
          metaSuggestions={metaSuggestions}
          onAddChapterMeta={handleAddChapterMeta}
          onRemoveChapterMeta={handleRemoveChapterMeta}
          onAddAuthorMeta={handleAddAuthorMeta}
          onRemoveAuthorMeta={handleRemoveAuthorMeta}
          openTagsForChapterId={harnessTagsChapterId ?? undefined}
        />
      );
    }
    if (route.kind === "discovery") {
      return (
        <DiscoveryView
          forYou={forYou}
          allTags={allTags}
          byTags={byTags}
          picked={pickedTags}
          onPickTags={pickTags}
          onOpenAuthor={openAuthor}
          onPlayNextOfWork={playNextChapterOfWork}
          narratorTerms={narratorTerms}
          languageTerms={languageTerms}
          moodTerms={moodTerms}
          pickedFacet={pickedFacet}
          byFacet={byFacet}
          onPickFacet={pickFacet}
        />
      );
    }
    if (route.kind === "rename") {
      return (
        <RenameView
          items={renameItems}
          result={renameResult}
          onApply={doApplyRenames}
          onUndo={doUndoRenames}
          onReload={reloadRenamePreview}
          onBack={openSettings}
        />
      );
    }
    if (route.kind === "metadata") {
      return (
        <MetadataView
          proposals={metadataProposals}
          result={metadataResult}
          onApply={doApplyMetadata}
          onReload={reloadMetadataPreview}
          onBack={openSettings}
        />
      );
    }
    if (route.kind === "settings") {
      return (
        <SettingsView
          root={libraryRoot}
          lastScan={scan}
          scanError={scanError}
          busy={busy}
          firstRun={route.firstRun}
          onChooseFolder={chooseFolder}
          onRescan={rescan}
          shelves={homeShelves}
          allTags={allTags}
          authors={authors.map((a) => ({ id: a.id, name: a.name }))}
          onAddShelf={onAddShelf}
          onRemoveShelf={onRemoveShelf}
          onMoveShelf={onMoveShelf}
          onRenameShelf={onRenameShelf}
          tagStats={tagStats}
          onRenameTag={doRenameTag}
          onMergeTags={doMergeTags}
          onSetTagAlias={doSetTagAlias}
          onClearTagAlias={doClearTagAlias}
          collections={collections}
          onCreateCollection={handleCreateCollection}
          onDeleteCollection={handleDeleteCollection}
          onReorderCollections={handleReorderCollections}
          density={density}
          onDensityChange={onDensityChange}
          a11y={a11y}
          onA11yChange={updateA11y}
          onExportJson={onExportJson}
          onExportSnapshot={onExportSnapshot}
          onImportJson={onImportJson}
          onRestoreSnapshot={onRestoreSnapshot}
          onHealthScan={onHealthScan}
          importReport={importReport}
          healthReport={healthReport}
          restoreStaged={restoreStaged}
          metaTerms={metaTerms}
          onCreateMetaTerm={handleCreateMetaTerm}
          onRenameMetaTerm={handleRenameMetaTerm}
          onDeleteMetaTerm={handleDeleteMetaTerm}
          onMergeMetaTerms={handleMergeMetaTerms}
          onOpenRename={openRename}
          onOpenMetadata={openMetadata}
        />
      );
    }
    if (route.kind === "journal") {
      return (
        <JournalView
          journal={journal}
          exportStatus={journalExportStatus}
          onSearch={loadJournal}
          onExport={handleExportJournal}
        />
      );
    }
    if (route.kind === "insights") {
      return (
        <InsightsView
          data={insights}
          now={insightsNow}
          onExportRecap={handleExportRecap}
          recapStatus={recapStatus}
        />
      );
    }
    if (route.kind === "collections") {
      return (
        <CollectionsView
          collections={collections}
          resolved={resolvedCollections}
          onResolve={onResolveCollection}
          onOpenAuthor={openAuthor}
          initialOpenId={collectionsInitialOpenId}
        />
      );
    }
    const isScoped = hasScopedTokens(query);
    return (
      <>
        <LibraryView
          authors={authors}
          query={query}
          results={results}
          transcriptResults={transcriptResults}
          scopedResults={scopedResults}
          scoped={isScoped}
          savedSearches={savedSearches}
          onSaveSearch={handleSaveSearch}
          onRunSavedSearch={(q) => { setSelectMode(false); setSelectedWorkIds([]); setQuery(q); }}
          onDeleteSavedSearch={handleDeleteSavedSearch}
          onQueryChange={(q) => { setSelectMode(false); setSelectedWorkIds([]); setQuery(q); }}
          onOpenAuthor={openAuthor}
          sort={browsePrefs.authorSort}
          onSortChange={setAuthorSort}
          filterTag={browsePrefs.filterTag}
          onFilterTagChange={setFilterTag}
          filterStatus={browsePrefs.filterStatus}
          onFilterStatusChange={setFilterStatus}
          allTags={allTags}
          onPlayNextOfWork={playNextChapterOfWork}
          onPlayAuthor={(id) => void playAuthorNext(id)}
          selectMode={selectMode}
          onSelectModeChange={(on) => { setSelectMode(on); if (!on) setSelectedWorkIds([]); }}
          selectedWorkIds={selectedWorkIds}
          onToggleWork={onToggleWork}
        />
        {selectMode && selectedWorkIds.length > 0 && (
          <div className="bulk-bar">
            <span className="bulk-bar__count">{selectedWorkIds.length} selected</span>
            <button className="button button--accent" onClick={() => setBulkDialogOpen(true)}>Tag…</button>
            <button className="button button--ghost" onClick={() => setSelectedWorkIds([])}>Clear</button>
            <button className="button button--ghost" onClick={() => { setSelectMode(false); setSelectedWorkIds([]); }}>Done</button>
          </div>
        )}
        {bulkDialogOpen && (
          <BulkTagDialog
            count={selectedWorkIds.length}
            allTags={allTags}
            onApply={onBulkApply}
            onClose={() => setBulkDialogOpen(false)}
          />
        )}
      </>
    );
  }

  const player = (
    <PlayerBar
      context={current}
      isPlaying={isPlaying}
      currentTime={currentTime}
      duration={duration}
      volume={volume}
      sleepMinutes={sleepMinutes}
      onToggle={toggle}
      onSeek={seek}
      onSkip={skip}
      onVolume={setVolume}
      onSetSleep={setSleep}
      onExpand={() => setPlayerExpanded(true)}
      onOpenAuthor={openAuthor}
      timeLabelMode={timeLabelMode}
      onCycleTimeLabel={cycleTimeLabel}
      playbackSpeed={playbackSpeed}
      onCycleSpeed={() => setPlaybackSpeed(nextSpeed(playbackSpeed))}
      muted={muted}
      onToggleMute={toggleMute}
      sleepRemaining={sleepRemaining}
      sleepAtChapterEnd={sleepAtChapterEnd}
      onOpenChapters={() => setPlayerExpanded(true)}
    />
  );
  const view = routedView();
  const standalone = route.kind === "loading" || route.kind === "scan" ||
    (route.kind === "settings" && route.firstRun);

  return (
    <div className="app" style={{ height: "100%" }}>
      <audio
        ref={audioRef}
        onPlay={() => setIsPlaying(true)}
        onPause={() => {
          setIsPlaying(false);
          const cur = currentRef.current;
          const audio = audioRef.current;
          if (cur && audio && audio.currentTime > 0) {
            void savePlaybackPosition(cur.chapter.id, Math.floor(audio.currentTime));
          }
        }}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          setCurrentTime(t);
          if ("mediaSession" in navigator) {
            updatePosition(
              navigator.mediaSession as unknown as Parameters<typeof updatePosition>[0],
              e.currentTarget.duration || 0,
              t,
            );
          }
          const cur = currentRef.current;
          if (cur && t > 0 && Date.now() - lastPosSaveRef.current > 10_000) {
            lastPosSaveRef.current = Date.now();
            void savePlaybackPosition(cur.chapter.id, Math.floor(t));
          }
        }}
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration || 0);
          if (pendingSeekRef.current != null) {
            try { e.currentTarget.currentTime = pendingSeekRef.current; } catch {}
            pendingSeekRef.current = null;
          }
          e.currentTarget.playbackRate = playbackSpeedRef.current;
          e.currentTarget.muted = muted;
        }}
        onEnded={handleEnded}
      />
      {standalone ? <div className="standalone-view">{view}</div> : (
        <AppShell
          active={shellRoute(route)}
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
          onHome={openHome}
          onLibrary={() => setRoute({ kind: "library" })}
          onDiscovery={openDiscovery}
          onSettings={openSettings}
          onJournal={openJournalView}
          onInsights={openInsights}
          onCollections={openCollections}
          onOpenPalette={() => setPaletteOpen(true)}
          density={density}
          a11y={a11y}
          player={player}
        >
          {view}
        </AppShell>
      )}
      <CommandPalette
        open={paletteOpen}
        results={paletteResults}
        query={paletteQuery}
        onQueryChange={setPaletteQuery}
        onClose={() => { setPaletteOpen(false); setPaletteQuery(""); setPaletteResults(null); }}
        onOpenAuthor={(id) => { void openAuthor(id); }}
        onOpenWorkAuthor={(authorId) => { void openAuthor(authorId); }}
        onPlayChapter={(id) => { void playChapterById(id); }}
      />
      {harnessMiniPlayer && (
        <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, background: "rgba(0,0,0,0.6)" }}>
          <MiniPlayer
            title="Chapter 3 — The Arrival"
            author="Jane Doe"
            isPlaying={true}
            position={72}
            duration={300}
            onToggle={() => {}}
            onPrev={() => {}}
            onNext={() => {}}
          />
        </div>
      )}
      {current && playerExpanded && (
        <NowPlayingPanel
          context={current}
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          volume={volume}
          sleepMinutes={sleepMinutes}
          onClose={() => setPlayerExpanded(false)}
          onToggle={toggle}
          onSeek={seek}
          onSkip={skip}
          onVolume={setVolume}
          onSetSleep={setSleep}
          onOpenAuthor={(authorId) => {
            setPlayerExpanded(false);
            void openAuthor(authorId);
          }}
          timeLabelMode={timeLabelMode}
          onCycleTimeLabel={cycleTimeLabel}
          chapters={currentWorkChapters}
          onJumpToChapter={jumpToChapter}
          transcript={currentTranscript}
          chapterJournal={currentChapterJournal}
          onAddNoteHere={handleAddNoteHere}
          onAddBookmarkHere={handleAddBookmarkHere}
          onToggleFavorite={handleToggleCurrentFavorite}
          onJumpToBookmark={jumpToBookmark}
          onPopOut={() => { void openMiniPlayer(); }}
          playbackSpeed={playbackSpeed}
          onSetSpeed={setPlaybackSpeed}
          muted={muted}
          onToggleMute={toggleMute}
          sleepRemaining={sleepRemaining}
          sleepAtChapterEnd={sleepAtChapterEnd}
          onPlayNextChapter={() => playNextChapterRef.current()}
          onMarkComplete={() => { const c = currentRef.current; if (c) void markChapterFinished(c.chapter.id, Date.now()).then(() => { void loadAuthors(); }); }}
          canPlayNext={(() => {
            // Mirror playNextChapterRef exactly: a next chapter exists iff the current
            // chapter is not the last *position* in the work. chapterNo is unreliable here —
            // grouped works can repeat chapter numbers (1,2,2,3,3), so a position check is required.
            const c = currentRef.current;
            const chs = currentWorkChaptersRef.current;
            if (!c || chs.length === 0) return false;
            const idx = chs.findIndex((ch) => ch.id === c.chapter.id);
            return idx >= 0 && idx < chs.length - 1;
          })()}
        />
      )}
    </div>
  );
}
