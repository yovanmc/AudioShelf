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
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkRow {
    pub id: i64,
    pub base_title: String,
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
