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
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkRow {
    pub id: i64,
    pub base_title: String,
    pub tags: Vec<String>,
    pub chapters: Vec<ChapterRow>,
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
