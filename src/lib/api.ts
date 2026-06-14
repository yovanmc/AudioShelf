import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface ScanError { path: string; reason: string; }
export interface ScanResult {
  authors: number;
  works: number;
  chapters: number;
  added?: number;
  updated?: number;
  removed?: number;
  skipped?: number;
  errors?: ScanError[];
  cancelled?: boolean;
}
export interface ScanProgress {
  authorsDone: number;
  authorsTotal: number;
  current: string;
  added: number;
  updated: number;
  skipped: number;
}
export interface AuthorRow {
  id: number; name: string; workCount: number; chapterCount: number; unplayedCount: number;
  totalSecs: number; tags: string[];
}
export interface ChapterRow {
  id: number; title: string; chapterNo: number; format: string;
  durationSecs: number; filePath: string; played: boolean; tags: string[];
  userSummary: string; takeaway: string; isFavorite: boolean; metadata: MetaTag[];
  playbackPositionSecs: number; labels: MetaTag[];
  hasJournal: boolean;
}
export interface WorkRow {
  id: number; baseTitle: string; tags: string[]; chapters: ChapterRow[];
  reEntryNote: string; completionRating: string; chapterSort: string; metadata: MetaTag[];
  labels: MetaTag[];
}

export interface ChapterNote { id: number; chapterId: number; positionSecs: number; body: string; createdAt: number; }
export interface ChapterBookmark { id: number; chapterId: number; positionSecs: number; label: string; createdAt: number; }
export interface ChapterJournal { notes: ChapterNote[]; bookmarks: ChapterBookmark[]; }
export interface JournalEntry {
  kind: "note" | "bookmark" | "summary" | "takeaway" | "favorite" | "re_entry" | "rating";
  authorId: number; authorName: string; workId: number; workTitle: string;
  chapterId: number | null; chapterTitle: string | null;
  positionSecs: number | null; body: string; createdAt: number | null;
}
export interface JournalResults { entries: JournalEntry[]; }
export interface JournalExportReport { path: string; format: string; entryCount: number; }
export interface AuthorDetail { id: number; name: string; tags: string[]; works: WorkRow[]; metadata: MetaTag[]; labels: MetaTag[]; }

export interface AuthorHit { authorId: number; authorName: string; }
export interface WorkHit { workId: number; baseTitle: string; authorId: number; authorName: string; }
export interface ChapterHit {
  chapterId: number; title: string; workId: number; baseTitle: string;
  authorId: number; authorName: string;
}
export interface SearchResults { authors: AuthorHit[]; works: WorkHit[]; chapters: ChapterHit[]; }

export interface DiscoveryWork {
  workId: number; baseTitle: string; authorId: number; authorName: string;
  unplayedCount: number; sharedTags: string[];
  /** Human-readable reason this work was surfaced. Empty string when unavailable. */
  reason?: string;
}

export interface DormantWork {
  workId: number;
  baseTitle: string;
  authorId: number;
  authorName: string;
  lastPlayedAt: number;
  /** Fraction (0–1) of the work's chapters that have been played. */
  playedFraction: number;
}
export interface MoreWork { workId: number; baseTitle: string; unplayedCount: number; }

export interface ContinueItem {
  authorId: number;
  authorName: string;
  workId: number;
  workTitle: string;
  nextChapter: ChapterRow;
  remainingUnplayed: number;
  totalChapters: number;
  playedChapters: number;
  lastPlayedAt: number;
}
export interface RecommendationWork {
  workId: number;
  baseTitle: string;
  authorId: number;
  authorName: string;
  totalChapters: number;
  unplayedCount: number;
  tags: string[];
  matchedTags: string[];
  reason: string;
}
export interface RecentItem {
  chapterId: number;
  chapterTitle: string;
  workId: number;
  workTitle: string;
  authorId: number;
  authorName: string;
  playedAt: number;
}
export interface ListeningStats {
  totalSecs: number;
  chaptersFinished: number;
  streakDays: number;
  recent: RecentItem[];
}

export interface DayCell { day: number; dateMs: number; count: number; }
export interface PeriodSummary { label: string; chapters: number; secs: number; activeDays: number; }
export interface WeekPoint { weekStartDay: number; weekStartMs: number; chapters: number; }
export interface CreatorStat { authorId: number; authorName: string; chapters: number; secs: number; }
export interface InsightTagStat { tag: string; owned: number; finished: number; }
export interface RecapData {
  year: number;
  totalSecs: number;
  totalChapters: number;
  activeDays: number;
  longestStreak: number;
  topCreator: string | null;
  topCreatorChapters: number;
  topTag: string | null;
  busiestMonth: string | null;
  busiestWeekday: string | null;
  firstPlayMs: number | null;
  lastPlayMs: number | null;
}
export interface InsightsData {
  generatedAt: number;
  totalSecs: number;
  totalChapters: number;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  heatmap: DayCell[];
  byWeekday: number[];
  byHour: number[];
  thisMonth: PeriodSummary;
  lastMonth: PeriodSummary;
  rhythm: WeekPoint[];
  topCreators: CreatorStat[];
  topTags: InsightTagStat[];
  recap: RecapData;
  /** CUR-10: works with a non-empty completion_rating. */
  worksRated: number;
  /** CUR-10: works with a non-empty re_entry_note. */
  worksReEntered: number;
}
export interface HomeData {
  keepListening: ContinueItem | null;
  recommendations: RecommendationWork[];
  stats: ListeningStats;
}

export interface PlaybackContext {
  chapter: ChapterRow;
  authorId: number;
  authorName: string;
  workId: number;
  workTitle: string;
  workTotalChapters: number;
  workPlayedChapters: number;
}

export interface RenameItem {
  chapterId: number; authorName: string; baseTitle: string;
  fromName: string; toName: string;
  status: "ok" | "noop" | "conflict"; conflictReason: string | null;
}
export interface RenameResult { renamedCount: number; failures: string[]; manifestPath: string; }
export interface UndoResult { revertedCount: number; failures: string[]; }

export interface SeriesMemberProposal {
  workId: number;
  baseTitle: string;
  position: number;
}
export interface SeriesProposal {
  title: string;
  members: SeriesMemberProposal[];
}
export interface SeriesMemberView {
  workId: number;
  baseTitle: string;
  position: number;
  playedChapters: number;
  totalChapters: number;
}
export interface SeriesView {
  id: number;
  title: string;
  members: SeriesMemberView[];
}

export interface MetadataProposal {
  chapterId: number;
  workId: number;
  field: "title" | "order" | "tag";
  current: string;
  proposed: string;
  source: "embedded";
}
export interface MetadataApplyReport { applied: number; skipped: number; }

export interface LaunchArgs {
  library: string | null;
  autostart: boolean;
  walkthrough: string | null;
  shots: string | null;
  doneSignal: string | null;
  exitWhenDone: boolean;
}

export interface TranscriptHit {
  chapterId: number;
  chapterTitle: string;
  workId: number;
  workTitle: string;
  authorId: number;
  authorName: string;
  snippet: string;
}

export const getLaunchArgs = () => invoke<LaunchArgs>("get_launch_args");
export const scanLibrary = (root: string) => invoke<ScanResult>("scan_library", { root });
export const cancelScan = () => invoke("cancel_scan");
export const getAuthors = () => invoke<AuthorRow[]>("get_authors");
export const getAuthorDetail = (authorId: number) =>
  invoke<AuthorDetail>("get_author_detail", { authorId });
export const searchLibrary = (query: string) =>
  invoke<SearchResults>("search_library", { query });
export const getWorkCover = (workId: number) =>
  invoke<string | null>("get_work_cover", { workId });
export const getAuthorCover = (authorId: number) =>
  invoke<string | null>("get_author_cover", { authorId });
export const setChapterPlayed = (chapterId: number, played: boolean) =>
  invoke("set_chapter_played", { chapterId, played });
export const markChapterFinished = (chapterId: number, nowMs: number) =>
  invoke("mark_chapter_finished", { chapterId, nowMs });
export async function savePlaybackPosition(chapterId: number, secs: number): Promise<void> {
  await invoke("save_playback_position", { chapterId, secs });
}
export const setAuthorDisplayName = (authorId: number, name: string | null) =>
  invoke("set_author_display_name", { authorId, name });

export interface TagStat { tag: string; workCount: number; chapterCount: number; authorCount: number; }
export interface MetaTag { termId: number; facet: string; value: string; }
export interface MetaTerm { id: number; facet: string; value: string; chapterCount: number; authorCount: number; }

export const getAllTags = () => invoke<string[]>("get_all_tags");
export const listTagsWithCounts = () => invoke<TagStat[]>("list_tags_with_counts");
export const renameTag = (from: string, to: string) => invoke("rename_tag", { from, to });
export const mergeTags = (sources: string[], target: string) => invoke("merge_tags", { sources, target });
export const setTagAlias = (alias: string, canonical: string) => invoke("set_tag_alias", { alias, canonical });
export const clearTagAlias = (alias: string) => invoke("clear_tag_alias", { alias });
export const setTagParent = (child: string, parent: string) => invoke("set_tag_parent", { child, parent });
export const clearTagParent = (child: string) => invoke("clear_tag_parent", { child });
export const setAuthorTags = (authorId: number, tags: string[]) =>
  invoke("set_author_tags", { authorId, tags });
export const setWorkTags = (workId: number, tags: string[]) =>
  invoke("set_work_tags", { workId, tags });
export const setChapterTags = (chapterId: number, tags: string[]) =>
  invoke("set_chapter_tags", { chapterId, tags });
export const getDiscovery = () => invoke<DiscoveryWork[]>("get_discovery");
export const getDiscoveryByTags = (tags: string[]) =>
  invoke<DiscoveryWork[]>("get_discovery_by_tags", { tags });
export const getMoreFromAuthor = (authorId: number) =>
  invoke<MoreWork[]>("get_more_from_author", { authorId });
export const getDormantWorks = (nowMs: number, days: number) =>
  invoke<DormantWork[]>("get_dormant_works", { nowMs, days });
export const getMoreLikeThis = (workId: number, cap: number) =>
  invoke<DiscoveryWork[]>("get_more_like_this", { workId, cap });
export const suggestTags = (workId: number) =>
  invoke<string[]>("suggest_tags", { workId });
export const queryHome = (nowMs: number, tzOffsetMinutes: number) =>
  invoke<HomeData>("query_home", { nowMs, tzOffsetMinutes });

export const queryInsights = (nowMs: number, tzOffsetMinutes: number) =>
  invoke<InsightsData>("query_insights", { nowMs, tzOffsetMinutes });

export const exportRecapPng = (path: string, bytes: number[]) =>
  invoke<string>("export_recap_png", { path, bytes });

export const seedPlayEvents = (events: { chapterId: number; playedAt: number }[]) =>
  invoke<void>("seed_play_events", { events });

export const previewRenames = () => invoke<RenameItem[]>("preview_renames");
export const applyRenames = (chapterIds: number[], nowMs: number) =>
  invoke<RenameResult>("apply_renames", { chapterIds, nowMs });
export const undoRenames = (manifestPath: string) =>
  invoke<UndoResult>("undo_renames", { manifestPath });

export const detectSeries = (authorId: number) =>
  invoke<SeriesProposal[]>("detect_series", { authorId });
export const applySeries = (authorId: number, proposals: SeriesProposal[]) =>
  invoke("apply_series", { authorId, proposals });
export const getAuthorSeries = (authorId: number) =>
  invoke<SeriesView[]>("get_author_series", { authorId });

export const previewMetadata = (authorId?: number) =>
  invoke<MetadataProposal[]>("preview_metadata", { authorId: authorId ?? null });
export const applyMetadata = (proposals: MetadataProposal[]) =>
  invoke<MetadataApplyReport>("apply_metadata", { proposals });

export const setGroupingOverride = (chapterId: number, baseTitle: string | null, chapterNo: number | null) =>
  invoke<AuthorDetail>("set_grouping_override", { chapterId, baseTitle, chapterNo });
export const clearGroupingOverride = (chapterId: number) =>
  invoke<AuthorDetail>("clear_grouping_override", { chapterId });

export const captureWindow = (path: string) => invoke("capture_window", { path });
export const finishWalkthrough = (doneSignal: string | null, exitWhenDone: boolean) =>
  invoke("finish_walkthrough", { doneSignal, exitWhenDone });

/** Harness-only: wipe all play history so the empty-home shot is genuinely clean. */
export const resetPlayHistory = () => invoke("reset_play_history");

export const searchTranscripts = (query: string) =>
  invoke<TranscriptHit[]>("search_transcripts", { query });
export const getChapterTranscript = (chapterId: number) =>
  invoke<string | null>("get_chapter_transcript", { chapterId });

export const setChapterSummary = (chapterId: number, summary: string) =>
  invoke("set_chapter_summary", { chapterId, summary });
export const setChapterTakeaway = (chapterId: number, takeaway: string) =>
  invoke("set_chapter_takeaway", { chapterId, takeaway });
export const setChapterFavorite = (chapterId: number, favorite: boolean) =>
  invoke("set_chapter_favorite", { chapterId, favorite });
export const setWorkReEntryNote = (workId: number, note: string) =>
  invoke("set_work_re_entry_note", { workId, note });
export const setWorkRating = (workId: number, rating: string) =>
  invoke("set_work_rating", { workId, rating });
export const getChapterJournal = (chapterId: number) =>
  invoke<ChapterJournal>("get_chapter_journal", { chapterId });
export const addChapterNote = (chapterId: number, positionSecs: number, body: string) =>
  invoke<ChapterNote>("add_chapter_note", { chapterId, positionSecs, body, nowMs: Date.now() });
export const deleteChapterNote = (noteId: number) =>
  invoke("delete_chapter_note", { noteId });
export const addBookmark = (chapterId: number, positionSecs: number, label: string) =>
  invoke<ChapterBookmark>("add_bookmark", { chapterId, positionSecs, label, nowMs: Date.now() });
export const deleteBookmark = (bookmarkId: number) =>
  invoke("delete_bookmark", { bookmarkId });
export const queryJournal = (query: string) =>
  invoke<JournalResults>("query_journal", { query });
export const exportJournal = (path: string, format: "markdown" | "json") =>
  invoke<JournalExportReport>("export_journal", { path, format });

export const fileUrl = (p: string) => convertFileSrc(p);

export const getSetting = (key: string) => invoke<string | null>("get_setting", { key });
export const setSetting = (key: string, value: string) =>
  invoke("set_setting", { key, value });

// M19 Power & Scale — interfaces
export interface ScopedWork {
  workId: number; baseTitle: string; authorId: number; authorName: string;
  totalSecs: number; chapterCount: number; playedCount: number; tags: string[];
}
export interface ScopedResults {
  works: ScopedWork[]; tags: string[]; text: string; durationLabel: string; statusLabel: string;
}
export interface SavedSearch { id: number; name: string; query: string; }
export interface Collection { id: number; name: string; query: string; position: number; }
export interface HealthItem {
  chapterId: number; title: string; workTitle: string; authorName: string; filePath: string; sizeBytes: number;
}
export interface HealthReport {
  missingFiles: HealthItem[]; zeroByte: HealthItem[]; unreadable: HealthItem[];
  schemaVersion: number; latestSchema: number; schemaDrift: boolean;
}
export interface ImportReport {
  tagsAdded: number; playedMarked: number; favoritesMarked: number; journalFieldsFilled: number;
  notesAdded: number; bookmarksAdded: number; collectionsAdded: number; searchesAdded: number;
  unmatchedAuthors: number; unmatchedWorks: number; unmatchedChapters: number;
}

// M19 Power & Scale — invoke wrappers
export const advancedSearch = (query: string) => invoke<ScopedResults>("advanced_search", { query });

export const createSavedSearch = (name: string, query: string, createdAt: number) =>
  invoke<number>("create_saved_search", { name, query, createdAt });
export const listSavedSearches = () => invoke<SavedSearch[]>("list_saved_searches");
export const deleteSavedSearch = (id: number) => invoke("delete_saved_search", { id });

export const createCollection = (name: string, query: string, createdAt: number) =>
  invoke<number>("create_collection", { name, query, createdAt });
export const listCollections = () => invoke<Collection[]>("list_collections");
export const updateCollection = (id: number, name: string, query: string) =>
  invoke("update_collection", { id, name, query });
export const deleteCollection = (id: number) => invoke("delete_collection", { id });
export const reorderCollections = (ids: number[]) => invoke("reorder_collections", { ids });
export const resolveCollection = (id: number) => invoke<ScopedResults>("resolve_collection", { id });

export const bulkSetWorkTags = (workIds: number[], add: string[], remove: string[]) =>
  invoke("bulk_set_work_tags", { workIds, add, remove });

export const setWorkChapterSort = (workId: number, sort: string) =>
  invoke("set_work_chapter_sort", { workId, sort });

export const libraryHealthScan = () => invoke<HealthReport>("library_health_scan");

export const exportCurationJson = (path: string, exportedAt: number) =>
  invoke("export_curation_json", { path, exportedAt });
export const exportDbSnapshot = (path: string) => invoke("export_db_snapshot", { path });
export const importCurationJson = (path: string) => invoke<ImportReport>("import_curation_json", { path });
export const stageDbRestore = (src: string) => invoke("stage_db_restore", { src });

export const openMiniPlayer = () => invoke("open_mini_player");
export const closeMiniPlayer = () => invoke("close_mini_player");

// M21 Metadata & Discovery — invoke wrappers
export const listMetadataTerms = () => invoke<MetaTerm[]>("list_metadata_terms");
export const createMetadataTerm = (facet: string, value: string) =>
  invoke<MetaTerm>("create_metadata_term", { facet, value });
export const renameMetadataTerm = (id: number, value: string) =>
  invoke("rename_metadata_term", { id, value });
export const deleteMetadataTerm = (id: number) => invoke("delete_metadata_term", { id });
export const mergeMetadataTerms = (sourceIds: number[], targetId: number) =>
  invoke("merge_metadata_terms", { sourceIds, targetId });
export const addMetadataValue = (scope: "chapter" | "author" | "work", id: number, facet: string, value: string) =>
  invoke<MetaTag>("add_metadata_value", { scope, id, facet, value });
export const removeMetadataValue = (scope: "chapter" | "author" | "work", id: number, termId: number) =>
  invoke("remove_metadata_value", { scope, id, termId });
export const getDiscoveryByMetadata = (facet: string, value: string) =>
  invoke<DiscoveryWork[]>("get_discovery_by_metadata", { facet, value });

// M26 Unified Labels — types
export interface LabelType { name: string; display: string; builtin: boolean; sort: number; }
/** A label attached to an entity; same shape as MetaTag. */
export type Label = MetaTag;

// M26 Unified Labels — label-type management wrappers
export const listLabelTypes = () => invoke<LabelType[]>("list_label_types");
export const createLabelType = (name: string, display: string) =>
  invoke<void>("create_label_type", { name, display });
export const renameLabelType = (name: string, display: string) =>
  invoke<void>("rename_label_type", { name, display });
export const deleteLabelType = (name: string) =>
  invoke<void>("delete_label_type", { name });
export const reorderLabelTypes = (names: string[]) =>
  invoke<void>("reorder_label_types", { names });

// M27 CUR-5 — "Played in range" drill-down
export const queryPlayedInRange = (startMs: number, endMs: number) =>
  invoke<ScopedResults>("query_played_in_range", { startMs, endMs });

// M26 Unified Labels — convenience aliases for attaching/detaching labels
/** Attach a label (facet/value pair) to an entity. Delegates to addMetadataValue. */
export const addLabel = (scope: "chapter" | "author" | "work", id: number, type: string, value: string) =>
  addMetadataValue(scope, id, type, value);
/** Remove a label from an entity by term ID. Delegates to removeMetadataValue. */
export const removeLabel = (scope: "chapter" | "author" | "work", id: number, termId: number) =>
  removeMetadataValue(scope, id, termId);

/**
 * Open the OS folder picker. Resolves to the chosen absolute path, or `null` if
 * the user cancelled. `directory: true` + default `multiple: false` yields a
 * single path string (never an array) or null.
 */
export async function pickFolder(): Promise<string | null> {
  const picked = await open({
    directory: true,
    multiple: false,
    title: "Choose your audio library folder",
  });
  return typeof picked === "string" ? picked : null;
}
