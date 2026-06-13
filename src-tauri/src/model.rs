//! Data returned to the front-end. All camelCase for JS consumption.

use serde::Serialize;

#[derive(Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub authors: usize,
    pub works: usize,
    pub chapters: usize,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuthorRow {
    pub id: i64,
    pub name: String,        // display_name if set, else folder_name
    pub work_count: i64,
    pub chapter_count: i64,
    pub unplayed_count: i64,
    pub total_secs: i64,     // SUM(duration_secs) over active chapters — for Length sort
    pub tags: Vec<String>,   // author_tags ∪ work_tags for this author — for tag filter
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChapterRow {
    pub id: i64,
    pub title: String,       // raw_filename without extension
    pub chapter_no: i64,
    pub format: String,
    pub duration_secs: i64,
    pub file_path: String,
    pub played: bool,
    pub tags: Vec<String>,
    pub user_summary: String,
    pub takeaway: String,
    pub is_favorite: bool,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkRow {
    pub id: i64,
    pub base_title: String,
    pub tags: Vec<String>,
    pub chapters: Vec<ChapterRow>,
    pub re_entry_note: String,
    pub completion_rating: String,
    pub chapter_sort: String,   // NEW: per-work chapter ordering preference
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryWork {
    pub work_id: i64,
    pub base_title: String,
    pub author_id: i64,
    pub author_name: String,
    pub unplayed_count: i64,
    pub shared_tags: Vec<String>,
    /// Human-readable reason this work was surfaced (empty string if unavailable).
    #[serde(default)]
    pub reason: String,
}

/// A work that was played at some point but not touched for `days` days.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DormantWork {
    pub work_id: i64,
    pub base_title: String,
    pub author_id: i64,
    pub author_name: String,
    pub last_played_at: i64,
    /// Fraction of the work's chapters that have been played (0.0–1.0).
    pub played_fraction: f64,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MoreWork {
    pub work_id: i64,
    pub base_title: String,
    pub unplayed_count: i64,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuthorDetail {
    pub id: i64,
    pub name: String,
    pub tags: Vec<String>,
    pub works: Vec<WorkRow>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RenameItem {
    pub chapter_id: i64,
    pub author_name: String,
    pub base_title: String,
    pub from_name: String,
    pub to_name: String,
    pub status: String,            // "ok" | "noop" | "conflict"
    pub conflict_reason: Option<String>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RenameResult {
    pub renamed_count: usize,
    pub failures: Vec<String>,     // human-readable "<file>: <error>"
    pub manifest_path: String,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UndoResult {
    pub reverted_count: usize,
    pub failures: Vec<String>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuthorHit {
    pub author_id: i64,
    pub author_name: String,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkHit {
    pub work_id: i64,
    pub base_title: String,
    pub author_id: i64,
    pub author_name: String,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChapterHit {
    pub chapter_id: i64,
    pub title: String,
    pub work_id: i64,
    pub base_title: String,
    pub author_id: i64,
    pub author_name: String,
}

#[derive(Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub authors: Vec<AuthorHit>,
    pub works: Vec<WorkHit>,
    pub chapters: Vec<ChapterHit>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContinueItem {
    pub author_id: i64,
    pub author_name: String,
    pub work_id: i64,
    pub work_title: String,
    pub next_chapter: ChapterRow,
    pub remaining_unplayed: i64,
    pub total_chapters: i64,
    pub played_chapters: i64,
    pub last_played_at: i64,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationWork {
    pub work_id: i64,
    pub base_title: String,
    pub author_id: i64,
    pub author_name: String,
    pub total_chapters: i64,
    pub unplayed_count: i64,
    pub tags: Vec<String>,
    pub matched_tags: Vec<String>,
    pub reason: String,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecentItem {
    pub chapter_id: i64,
    pub chapter_title: String,
    pub work_id: i64,
    pub work_title: String,
    pub author_id: i64,
    pub author_name: String,
    pub played_at: i64,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ListeningStats {
    pub total_secs: i64,
    pub chapters_finished: i64,
    pub streak_days: i64,
    pub recent: Vec<RecentItem>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HomeData {
    pub keep_listening: Option<ContinueItem>,
    pub recommendations: Vec<RecommendationWork>,
    pub stats: ListeningStats,
}

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChapterNote {
    pub id: i64,
    pub chapter_id: i64,
    pub position_secs: i64,
    pub body: String,
    pub created_at: i64,
}

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChapterBookmark {
    pub id: i64,
    pub chapter_id: i64,
    pub position_secs: i64,
    pub label: String,
    pub created_at: i64,
}

#[derive(Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChapterJournal {
    pub notes: Vec<ChapterNote>,
    pub bookmarks: Vec<ChapterBookmark>,
}

#[derive(Serialize, serde::Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct JournalEntry {
    pub kind: String,            // "note" | "bookmark" | "summary" | "takeaway" | "favorite" | "re_entry" | "rating"
    pub author_id: i64,
    pub author_name: String,
    pub work_id: i64,
    pub work_title: String,
    pub chapter_id: Option<i64>,
    pub chapter_title: Option<String>,
    pub position_secs: Option<i64>,
    pub body: String,            // note/summary/takeaway text, bookmark label, rating word, etc.
    pub created_at: Option<i64>,
}

#[derive(Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct JournalResults {
    pub entries: Vec<JournalEntry>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JournalExportReport {
    pub path: String,
    pub format: String,
    pub entry_count: usize,
}

/// One field proposed to change based on embedded audio metadata.
/// `field` is one of: "title" (work base_title), "order" (chapter_no), "tag" (genre).
#[derive(Serialize, serde::Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MetadataProposal {
    pub chapter_id: i64,
    pub work_id: i64,
    pub field: String,      // "title" | "order" | "tag"
    pub current: String,
    pub proposed: String,
    pub source: String,     // always "embedded"
}

/// Result of applying a set of metadata proposals.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MetadataApplyReport {
    pub applied: i64,
    pub skipped: i64,
}

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DayCell {
    pub day: i64,      // local-day index (days since 1970-01-01, local)
    pub date_ms: i64,  // UTC ms of local midnight (FE labels with getUTC*)
    pub count: i64,    // chapters finished that local day
}

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PeriodSummary {
    pub label: String, // e.g. "June 2026"
    pub chapters: i64,
    pub secs: i64,
    pub active_days: i64,
}

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WeekPoint {
    pub week_start_day: i64, // local-day index of the week's Sunday
    pub chapters: i64,
}

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CreatorStat {
    pub author_id: i64,
    pub author_name: String,
    pub chapters: i64, // chapters finished (play_events)
    pub secs: i64,
}

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TagStat {
    pub tag: String,
    pub owned: i64,    // works carrying the tag (work_tags ∪ author_tags)
    pub finished: i64, // those fully played
}

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RecapData {
    pub year: i64,
    pub total_secs: i64,
    pub total_chapters: i64,
    pub active_days: i64,
    pub longest_streak: i64,
    pub top_creator: Option<String>,
    pub top_creator_chapters: i64,
    pub top_tag: Option<String>,
    pub busiest_month: Option<String>,
    pub busiest_weekday: Option<String>,
    pub first_play_ms: Option<i64>,
    pub last_play_ms: Option<i64>,
}

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InsightsData {
    pub generated_at: i64,
    pub total_secs: i64,     // activity total (replays included) — "time listened"
    pub total_chapters: i64, // total play_events
    pub active_days: i64,
    pub current_streak: i64,
    pub longest_streak: i64,
    pub heatmap: Vec<DayCell>,   // 371 cells (53 weeks) ending today, oldest→newest
    pub by_weekday: Vec<i64>,    // 7 (Sun=0..Sat=6)
    pub by_hour: Vec<i64>,       // 24 (local hour)
    pub this_month: PeriodSummary,
    pub last_month: PeriodSummary,
    pub rhythm: Vec<WeekPoint>,  // last 16 weeks ending current week
    pub top_creators: Vec<CreatorStat>, // ≤8
    pub top_tags: Vec<TagStat>,         // ≤8 by owned
    pub recap: RecapData,
}

// Harness-only seeding payload (insights walkthrough). Deserialize from camelCase JS.
#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SeedPlayEvent {
    pub chapter_id: i64,
    pub played_at: i64,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScopedWork {
    pub work_id: i64,
    pub base_title: String,
    pub author_id: i64,
    pub author_name: String,
    pub total_secs: i64,
    pub chapter_count: i64,
    pub played_count: i64,
    pub tags: Vec<String>,
}

#[derive(Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScopedResults {
    pub works: Vec<ScopedWork>,
    pub tags: Vec<String>,           // echo parsed tag filters (for FE chips)
    pub text: String,                // echo parsed free text
    pub duration_label: String,      // human label e.g. "≤ 15m" or "" if none
    pub status_label: String,        // "Unstarted" | "In progress" | "Done" | ""
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SavedSearch { pub id: i64, pub name: String, pub query: String }

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Collection { pub id: i64, pub name: String, pub query: String, pub position: i64 }

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HealthItem {
    pub chapter_id: i64,
    pub title: String,
    pub work_title: String,
    pub author_name: String,
    pub file_path: String,
    pub size_bytes: i64,
}

#[derive(Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct HealthReport {
    pub missing_files: Vec<HealthItem>,
    pub zero_byte: Vec<HealthItem>,
    pub unreadable: Vec<HealthItem>,
    pub schema_version: i64,
    pub latest_schema: i64,
    pub schema_drift: bool,
}

#[derive(Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub tags_added: i64,
    pub played_marked: i64,
    pub favorites_marked: i64,
    pub journal_fields_filled: i64,
    pub notes_added: i64,
    pub bookmarks_added: i64,
    pub collections_added: i64,
    pub searches_added: i64,
    pub unmatched_authors: i64,
    pub unmatched_works: i64,
    pub unmatched_chapters: i64,
}
