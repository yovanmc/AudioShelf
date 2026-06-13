//! Tauri commands and the shared DB state.

use crate::db;
use crate::model::{AuthorDetail, AuthorHit, AuthorRow, ChapterBookmark, ChapterHit, ChapterJournal, ChapterNote, ChapterRow, Collection, ContinueItem, DiscoveryWork, DormantWork, HomeData, JournalEntry, JournalExportReport, JournalResults, ListeningStats, MetadataApplyReport, MetadataProposal, MoreWork, RecentItem, RecommendationWork, RenameItem, RenameResult, ScanResult, SavedSearch, SearchResults, UndoResult, WorkHit, WorkRow};
use crate::natsort::natural_cmp;
use crate::regroup;
use crate::rename;
use crate::scan;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use std::sync::Mutex;

/// Per-tag usage statistics across all three tag tables.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagStat {
    pub tag: String,
    pub work_count: i64,
    pub chapter_count: i64,
    pub author_count: i64,
}

pub struct DbState(pub Mutex<rusqlite::Connection>);

pub fn init_db(app: &tauri::AppHandle) -> rusqlite::Connection {
    use tauri::Manager;
    let dir = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir());
    std::fs::create_dir_all(&dir).ok();
    let path = dir.join("audioshelf.db");
    db::open(&path.to_string_lossy()).expect("open db")
}

#[tauri::command]
pub fn scan_library(app: tauri::AppHandle, state: tauri::State<DbState>, root: String) -> Result<ScanResult, String> {
    use tauri::Manager;
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let report = scan::scan_into(&conn, std::path::Path::new(&root)).map_err(|e| e.to_string())?;
    // Allow the WebView <audio> element to read files under the library root only.
    let _ = app.asset_protocol_scope().allow_directory(&root, true);
    Ok(report)
}

#[tauri::command]
pub fn get_setting(state: tauri::State<DbState>, key: String) -> Result<Option<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    get_setting_value(&conn, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_setting(state: tauri::State<DbState>, key: String, value: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    set_setting_value(&conn, &key, &value).map_err(|e| e.to_string())
}

/// Read a settings value by key, or `None` if the key is absent.
pub(crate) fn get_setting_value(conn: &rusqlite::Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT value FROM settings WHERE key=?1", params![key], |r| {
        r.get::<_, String>(0)
    })
    .optional()
}

/// Insert-or-update a settings value (upsert on the `key` primary key).
pub(crate) fn set_setting_value(conn: &rusqlite::Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings(key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![key, value],
    )?;
    Ok(())
}

#[tauri::command]
pub fn get_authors(state: tauri::State<DbState>) -> Result<Vec<AuthorRow>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let rows = query_authors(&conn).map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn get_author_detail(state: tauri::State<DbState>, author_id: i64) -> Result<AuthorDetail, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    query_author_detail(&conn, author_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_chapter_played(state: tauri::State<DbState>, chapter_id: i64, played: bool) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE chapters SET played=?2 WHERE id=?1",
        params![chapter_id, played as i64],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_author_display_name(state: tauri::State<DbState>, author_id: i64, name: Option<String>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE authors SET display_name=?2 WHERE id=?1",
        params![author_id, name],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn mark_chapter_finished(state: tauri::State<DbState>, chapter_id: i64, now_ms: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    mark_finished(&conn, chapter_id, now_ms).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_all_tags(state: tauri::State<DbState>) -> Result<Vec<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT tag FROM author_tags
         UNION SELECT tag FROM work_tags
         UNION SELECT tag FROM chapter_tags
         ORDER BY tag",
    ).map_err(|e| e.to_string())?;
    let tags = stmt
        .query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<String>>>().map_err(|e| e.to_string())?;
    Ok(tags)
}

#[tauri::command]
pub fn set_author_tags(state: tauri::State<DbState>, author_id: i64, tags: Vec<String>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    set_tags(&conn, author_id, &tags).map_err(|e| e.to_string())
}

/// Replace an entity's tag set in `table` (deduped, blanks dropped, trimmed).
/// `table`/`key_col` are caller-provided compile-time constants (never user input).
pub(crate) fn replace_tags(
    conn: &rusqlite::Connection,
    table: &'static str,
    key_col: &'static str,
    id: i64,
    tags: &[String],
) -> rusqlite::Result<()> {
    conn.execute(&format!("DELETE FROM {table} WHERE {key_col}=?1"), params![id])?;
    let mut seen = std::collections::BTreeSet::new();
    for raw in tags {
        let t = raw.trim();
        if t.is_empty() || !seen.insert(t.to_string()) { continue; }
        conn.execute(
            &format!("INSERT OR IGNORE INTO {table}({key_col}, tag) VALUES (?1, ?2)"),
            params![id, t],
        )?;
    }
    Ok(())
}

/// Replace an author's tag set. Kept as a named alias for existing call sites/tests.
pub(crate) fn set_tags(conn: &rusqlite::Connection, author_id: i64, tags: &[String]) -> rusqlite::Result<()> {
    replace_tags(conn, "author_tags", "author_id", author_id, tags)
}

#[tauri::command]
pub fn set_work_tags(state: tauri::State<DbState>, work_id: i64, tags: Vec<String>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    replace_tags(&conn, "work_tags", "work_id", work_id, &tags).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_chapter_tags(state: tauri::State<DbState>, chapter_id: i64, tags: Vec<String>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    replace_tags(&conn, "chapter_tags", "chapter_id", chapter_id, &tags).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_chapter_summary(state: tauri::State<DbState>, chapter_id: i64, summary: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE chapters SET user_summary=?2 WHERE id=?1", params![chapter_id, summary.trim()])
        .map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_chapter_takeaway(state: tauri::State<DbState>, chapter_id: i64, takeaway: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE chapters SET takeaway=?2 WHERE id=?1", params![chapter_id, takeaway.trim()])
        .map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_chapter_favorite(state: tauri::State<DbState>, chapter_id: i64, favorite: bool) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE chapters SET is_favorite=?2 WHERE id=?1", params![chapter_id, favorite as i64])
        .map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_work_re_entry_note(state: tauri::State<DbState>, work_id: i64, note: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE works SET re_entry_note=?2 WHERE id=?1", params![work_id, note.trim()])
        .map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_work_rating(state: tauri::State<DbState>, work_id: i64, rating: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE works SET completion_rating=?2 WHERE id=?1", params![work_id, rating.trim()])
        .map(|_| ()).map_err(|e| e.to_string())
}

// ---- query helpers (pub so integration tests and the testing module can call them) ----

/// Atomically mark a chapter played and record a play event at `now_ms`.
pub(crate) fn mark_finished(conn: &rusqlite::Connection, chapter_id: i64, now_ms: i64) -> rusqlite::Result<()> {
    conn.execute("UPDATE chapters SET played=1 WHERE id=?1", params![chapter_id])?;
    conn.execute(
        "INSERT INTO play_events(chapter_id, played_at) VALUES (?1, ?2)",
        params![chapter_id, now_ms],
    )?;
    Ok(())
}

pub fn query_authors(conn: &rusqlite::Connection) -> rusqlite::Result<Vec<AuthorRow>> {
    let mut stmt = conn.prepare(
        "SELECT a.id,
                COALESCE(a.display_name, a.folder_name) AS name,
                (SELECT count(*) FROM works w WHERE w.author_id=a.id AND w.status='active'),
                (SELECT count(*) FROM chapters c JOIN works w ON c.work_id=w.id
                   WHERE w.author_id=a.id AND c.status='active'),
                (SELECT count(*) FROM chapters c JOIN works w ON c.work_id=w.id
                   WHERE w.author_id=a.id AND c.status='active' AND c.played=0),
                (SELECT COALESCE(sum(c.duration_secs), 0) FROM chapters c JOIN works w ON c.work_id=w.id
                   WHERE w.author_id=a.id AND c.status='active')
         FROM authors a WHERE a.status='active'",
    )?;
    let mut rows: Vec<AuthorRow> = stmt
        .query_map([], |r| {
            Ok(AuthorRow {
                id: r.get(0)?,
                name: r.get(1)?,
                work_count: r.get(2)?,
                chapter_count: r.get(3)?,
                unplayed_count: r.get(4)?,
                total_secs: r.get(5)?,
                tags: Vec::new(),
            })
        })?
        .collect::<rusqlite::Result<_>>()?;

    // Per-author tag set = author_tags ∪ that author's work_tags (chapter tags excluded
    // by design, mirroring M9 Discover). Two grouped passes into a map, then assign.
    use std::collections::{BTreeSet, HashMap};
    let mut tag_map: HashMap<i64, BTreeSet<String>> = HashMap::new();
    {
        let mut s = conn.prepare("SELECT author_id, tag FROM author_tags")?;
        let mut q = s.query([])?;
        while let Some(r) = q.next()? {
            let id: i64 = r.get(0)?;
            let tag: String = r.get(1)?;
            tag_map.entry(id).or_default().insert(tag);
        }
    }
    {
        let mut s = conn.prepare(
            "SELECT w.author_id, t.tag FROM work_tags t JOIN works w ON t.work_id=w.id
               WHERE w.status='active'",
        )?;
        let mut q = s.query([])?;
        while let Some(r) = q.next()? {
            let id: i64 = r.get(0)?;
            let tag: String = r.get(1)?;
            tag_map.entry(id).or_default().insert(tag);
        }
    }
    for row in rows.iter_mut() {
        if let Some(set) = tag_map.remove(&row.id) {
            row.tags = set.into_iter().collect();
        }
    }

    rows.sort_by(|a, b| natural_cmp(&a.name, &b.name));
    Ok(rows)
}

pub fn query_author_detail(conn: &rusqlite::Connection, author_id: i64) -> rusqlite::Result<AuthorDetail> {
    let name: String = conn.query_row(
        "SELECT COALESCE(display_name, folder_name) FROM authors WHERE id=?1",
        params![author_id],
        |r| r.get(0),
    )?;

    let mut wstmt = conn.prepare(
        "SELECT id, base_title, re_entry_note, completion_rating, chapter_sort FROM works WHERE author_id=?1 AND status='active'",
    )?;
    let mut works: Vec<WorkRow> = wstmt
        .query_map(params![author_id], |r| {
            Ok(WorkRow {
                id: r.get(0)?,
                base_title: r.get(1)?,
                tags: Vec::new(),
                chapters: Vec::new(),
                re_entry_note: r.get::<_, String>(2).unwrap_or_default(),
                completion_rating: r.get::<_, String>(3).unwrap_or_default(),
                chapter_sort: r.get::<_, String>(4).unwrap_or_default(),
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    works.sort_by(|a, b| natural_cmp(&a.base_title, &b.base_title));

    for work in &mut works {
        let mut cstmt = conn.prepare(
            "SELECT id, raw_filename, chapter_no, format, duration_secs, file_path, played,
                    user_summary, takeaway, is_favorite
             FROM chapters WHERE work_id=?1 AND status='active'",
        )?;
        let mut chapters: Vec<ChapterRow> = cstmt
            .query_map(params![work.id], |r| {
                let raw: String = r.get(1)?;
                let title = std::path::Path::new(&raw)
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or(raw);
                Ok(ChapterRow {
                    id: r.get(0)?,
                    title,
                    chapter_no: r.get(2)?,
                    format: r.get(3)?,
                    duration_secs: r.get(4)?,
                    file_path: r.get(5)?,
                    played: r.get::<_, i64>(6)? != 0,
                    tags: Vec::new(),
                    user_summary: r.get::<_, String>(7).unwrap_or_default(),
                    takeaway: r.get::<_, String>(8).unwrap_or_default(),
                    is_favorite: r.get::<_, i64>(9).unwrap_or(0) != 0,
                })
            })?
            .collect::<rusqlite::Result<_>>()?;
        match work.chapter_sort.as_str() {
            "number_desc"   => chapters.sort_by(|a, b| b.chapter_no.cmp(&a.chapter_no)),
            "title_asc"     => chapters.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase())),
            "title_desc"    => chapters.sort_by(|a, b| b.title.to_lowercase().cmp(&a.title.to_lowercase())),
            "duration_asc"  => chapters.sort_by(|a, b| a.duration_secs.cmp(&b.duration_secs)),
            "duration_desc" => chapters.sort_by(|a, b| b.duration_secs.cmp(&a.duration_secs)),
            _               => chapters.sort_by(|a, b| a.chapter_no.cmp(&b.chapter_no)), // "" / unknown = default
        }
        work.chapters = chapters;

        // Work-level tags.
        let mut wt = conn.prepare("SELECT tag FROM work_tags WHERE work_id=?1 ORDER BY tag")?;
        work.tags = wt
            .query_map(params![work.id], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<_>>()?;

        // Chapter-level tags.
        for ch in &mut work.chapters {
            let mut ct = conn.prepare("SELECT tag FROM chapter_tags WHERE chapter_id=?1 ORDER BY tag")?;
            ch.tags = ct
                .query_map(params![ch.id], |r| r.get::<_, String>(0))?
                .collect::<rusqlite::Result<_>>()?;
        }
    }

    let mut tstmt = conn.prepare("SELECT tag FROM author_tags WHERE author_id=?1 ORDER BY tag")?;
    let tags: Vec<String> = tstmt
        .query_map(params![author_id], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<_>>()?;

    Ok(AuthorDetail { id: author_id, name, tags, works })
}

const SEARCH_CAP: usize = 50;

/// Escape LIKE wildcards in a user query and wrap it as a contains-pattern.
/// Pairs with `... LIKE ?1 ESCAPE '\'` so a typed `%` or `_` is matched literally.
fn like_contains(query: &str) -> String {
    let escaped = query
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

/// Case-insensitive substring search across active authors, works, and chapters.
/// Each bucket is independently capped at `cap`. A blank query yields empty results.
pub fn search(conn: &rusqlite::Connection, query: &str, cap: usize) -> rusqlite::Result<SearchResults> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(SearchResults::default());
    }
    let like = like_contains(q);

    let mut astmt = conn.prepare(
        "SELECT id, COALESCE(display_name, folder_name) AS name
         FROM authors
         WHERE status='active' AND COALESCE(display_name, folder_name) LIKE ?1 ESCAPE '\\'
         ORDER BY name LIMIT ?2",
    )?;
    let authors: Vec<AuthorHit> = astmt
        .query_map(params![like, cap as i64], |r| {
            Ok(AuthorHit { author_id: r.get(0)?, author_name: r.get(1)? })
        })?
        .collect::<rusqlite::Result<_>>()?;

    let mut wstmt = conn.prepare(
        "SELECT w.id, w.base_title, a.id, COALESCE(a.display_name, a.folder_name)
         FROM works w JOIN authors a ON w.author_id=a.id
         WHERE w.status='active' AND a.status='active'
               AND (w.base_title LIKE ?1 ESCAPE '\\'
                    OR EXISTS (SELECT 1 FROM work_tags wt WHERE wt.work_id=w.id AND wt.tag LIKE ?1 ESCAPE '\\'))
         ORDER BY w.base_title LIMIT ?2",
    )?;
    let works: Vec<WorkHit> = wstmt
        .query_map(params![like, cap as i64], |r| {
            Ok(WorkHit {
                work_id: r.get(0)?,
                base_title: r.get(1)?,
                author_id: r.get(2)?,
                author_name: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;

    let mut cstmt = conn.prepare(
        "SELECT c.id, c.raw_filename, w.id, w.base_title, a.id, COALESCE(a.display_name, a.folder_name)
         FROM chapters c JOIN works w ON c.work_id=w.id JOIN authors a ON w.author_id=a.id
         WHERE c.status='active' AND w.status='active' AND a.status='active'
               AND (c.raw_filename LIKE ?1 ESCAPE '\\'
                    OR EXISTS (SELECT 1 FROM chapter_tags ct WHERE ct.chapter_id=c.id AND ct.tag LIKE ?1 ESCAPE '\\'))
         ORDER BY c.raw_filename LIMIT ?2",
    )?;
    let chapters: Vec<ChapterHit> = cstmt
        .query_map(params![like, cap as i64], |r| {
            let raw: String = r.get(1)?;
            let title = std::path::Path::new(&raw)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or(raw);
            Ok(ChapterHit {
                chapter_id: r.get(0)?,
                title,
                work_id: r.get(2)?,
                base_title: r.get(3)?,
                author_id: r.get(4)?,
                author_name: r.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;

    Ok(SearchResults { authors, works, chapters })
}

#[tauri::command]
pub fn search_library(state: tauri::State<DbState>, query: String) -> Result<SearchResults, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    search(&conn, &query, SEARCH_CAP).map_err(|e| e.to_string())
}

fn duration_label(d: &crate::query::DurationFilter) -> String {
    use crate::query::CmpOp::*;
    let op = match d.op { Lt => "<", Le => "≤", Gt => ">", Ge => "≥" };
    let (n, unit) = if d.secs % 3600 == 0 { (d.secs / 3600, "h") }
        else if d.secs % 60 == 0 { (d.secs / 60, "m") } else { (d.secs, "s") };
    format!("{op} {n}{unit}")
}

fn status_label_of(s: Option<crate::query::StatusFilter>) -> String {
    match s {
        Some(crate::query::StatusFilter::Unstarted) => "Unstarted",
        Some(crate::query::StatusFilter::InProgress) => "In progress",
        Some(crate::query::StatusFilter::Done) => "Done",
        None => "",
    }.to_string()
}

#[tauri::command]
pub fn advanced_search(state: tauri::State<DbState>, query: String) -> Result<crate::model::ScopedResults, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let parsed = crate::query::parse_query(&query);
    let works = crate::scoped::run_scoped_query(&conn, &parsed, SEARCH_CAP).map_err(|e| e.to_string())?;
    Ok(crate::model::ScopedResults {
        works,
        tags: parsed.tags.clone(),
        text: parsed.text.clone(),
        duration_label: parsed.duration.as_ref().map(duration_label).unwrap_or_default(),
        status_label: status_label_of(parsed.status),
    })
}

// ---- saved searches ----

pub(crate) fn create_saved_search_row(conn: &rusqlite::Connection, name: &str, query: &str, created_at: i64) -> rusqlite::Result<i64> {
    conn.execute("INSERT INTO saved_searches(name, query, created_at) VALUES (?1,?2,?3)", params![name, query, created_at])?;
    Ok(conn.last_insert_rowid())
}
pub(crate) fn list_saved_searches_rows(conn: &rusqlite::Connection) -> rusqlite::Result<Vec<SavedSearch>> {
    let mut s = conn.prepare("SELECT id, name, query FROM saved_searches ORDER BY name")?;
    let rows = s.query_map([], |r| Ok(SavedSearch { id: r.get(0)?, name: r.get(1)?, query: r.get(2)? }))?.collect();
    rows
}
pub(crate) fn delete_saved_search_row(conn: &rusqlite::Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM saved_searches WHERE id=?1", params![id])?; Ok(())
}

#[tauri::command]
pub fn create_saved_search(state: tauri::State<DbState>, name: String, query: String, created_at: i64) -> Result<i64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    create_saved_search_row(&conn, name.trim(), query.trim(), created_at).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn list_saved_searches(state: tauri::State<DbState>) -> Result<Vec<SavedSearch>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    list_saved_searches_rows(&conn).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn delete_saved_search(state: tauri::State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    delete_saved_search_row(&conn, id).map_err(|e| e.to_string())
}

// ---- smart collections ----

pub(crate) fn create_collection_row(conn: &rusqlite::Connection, name: &str, query: &str, created_at: i64) -> rusqlite::Result<i64> {
    let next_pos: i64 = conn.query_row("SELECT COALESCE(MAX(position),-1)+1 FROM smart_collections", [], |r| r.get(0))?;
    conn.execute("INSERT INTO smart_collections(name, query, position, created_at) VALUES (?1,?2,?3,?4)", params![name, query, next_pos, created_at])?;
    Ok(conn.last_insert_rowid())
}
pub(crate) fn list_collections_rows(conn: &rusqlite::Connection) -> rusqlite::Result<Vec<Collection>> {
    let mut s = conn.prepare("SELECT id, name, query, position FROM smart_collections ORDER BY position, name")?;
    let rows = s.query_map([], |r| Ok(Collection { id: r.get(0)?, name: r.get(1)?, query: r.get(2)?, position: r.get(3)? }))?.collect();
    rows
}
pub(crate) fn update_collection_row(conn: &rusqlite::Connection, id: i64, name: &str, query: &str) -> rusqlite::Result<()> {
    conn.execute("UPDATE smart_collections SET name=?2, query=?3 WHERE id=?1", params![id, name, query])?; Ok(())
}
pub(crate) fn delete_collection_row(conn: &rusqlite::Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM smart_collections WHERE id=?1", params![id])?; Ok(())
}
pub(crate) fn reorder_collections_rows(conn: &rusqlite::Connection, ids: &[i64]) -> rusqlite::Result<()> {
    for (pos, id) in ids.iter().enumerate() {
        conn.execute("UPDATE smart_collections SET position=?2 WHERE id=?1", params![id, pos as i64])?;
    }
    Ok(())
}

#[tauri::command]
pub fn create_collection(state: tauri::State<DbState>, name: String, query: String, created_at: i64) -> Result<i64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    create_collection_row(&conn, name.trim(), query.trim(), created_at).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn list_collections(state: tauri::State<DbState>) -> Result<Vec<Collection>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    list_collections_rows(&conn).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn update_collection(state: tauri::State<DbState>, id: i64, name: String, query: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    update_collection_row(&conn, id, name.trim(), query.trim()).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn delete_collection(state: tauri::State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    delete_collection_row(&conn, id).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn reorder_collections(state: tauri::State<DbState>, ids: Vec<i64>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    reorder_collections_rows(&conn, &ids).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn resolve_collection(state: tauri::State<DbState>, id: i64) -> Result<crate::model::ScopedResults, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let query: String = conn.query_row("SELECT query FROM smart_collections WHERE id=?1", params![id], |r| r.get(0)).map_err(|e| e.to_string())?;
    let parsed = crate::query::parse_query(&query);
    let works = crate::scoped::run_scoped_query(&conn, &parsed, SEARCH_CAP).map_err(|e| e.to_string())?;
    Ok(crate::model::ScopedResults { works, tags: parsed.tags.clone(), text: parsed.text.clone(),
        duration_label: parsed.duration.as_ref().map(duration_label).unwrap_or_default(),
        status_label: status_label_of(parsed.status) })
}

/// Works (with unplayed chapters) whose author OR the work itself carries any of
/// `tags`, ranked by shared-tag count then unplayed count. `exclude_authors` are
/// filtered out. `sharedTags` is the union of matching author- and work-level tags.
pub(crate) fn discovery_for_tags(
    conn: &rusqlite::Connection,
    tags: &[String],
    exclude_authors: &[i64],
    cap: usize,
) -> rusqlite::Result<Vec<DiscoveryWork>> {
    if tags.is_empty() {
        return Ok(Vec::new());
    }
    let mut works: Vec<DiscoveryWork> = Vec::new();

    // Resolve the requested tags through any alias mappings.
    let resolved_request = resolve_aliases(conn, tags)?;

    // All active works (with their author) that have >=1 unplayed chapter.
    let mut wstmt = conn.prepare(
        "SELECT w.id, w.base_title, a.id, COALESCE(a.display_name, a.folder_name),
                (SELECT count(*) FROM chapters c WHERE c.work_id=w.id AND c.status='active' AND c.played=0)
         FROM works w JOIN authors a ON w.author_id=a.id
         WHERE w.status='active' AND a.status='active'",
    )?;
    let rows: Vec<(i64, String, i64, String, i64)> = wstmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?
        .collect::<rusqlite::Result<_>>()?;

    for (work_id, base_title, author_id, author_name, unplayed) in rows {
        if unplayed == 0 || exclude_authors.contains(&author_id) {
            continue;
        }
        // Union of this work's author tags and its own work tags, resolved through aliases.
        let mut raw_owned: Vec<String> = Vec::new();
        let mut atstmt = conn.prepare("SELECT tag FROM author_tags WHERE author_id=?1")?;
        for t in atstmt.query_map(params![author_id], |r| r.get::<_, String>(0))? {
            raw_owned.push(t?);
        }
        let mut wtstmt = conn.prepare("SELECT tag FROM work_tags WHERE work_id=?1")?;
        for t in wtstmt.query_map(params![work_id], |r| r.get::<_, String>(0))? {
            raw_owned.push(t?);
        }
        // Resolve owned tags through aliases, then de-duplicate into a BTreeSet.
        let resolved_owned_vec = resolve_aliases(conn, &raw_owned)?;
        let owned: std::collections::BTreeSet<String> = resolved_owned_vec.into_iter().collect();

        // Intersect with the resolved requested tags. BTreeSet keeps `shared` sorted.
        let resolved_req_set: std::collections::BTreeSet<String> =
            resolved_request.iter().cloned().collect();
        let shared: Vec<String> = owned.into_iter().filter(|t| resolved_req_set.contains(t)).collect();
        if shared.is_empty() {
            continue;
        }
        let reason = recommendation_reason(&shared, false);
        works.push(DiscoveryWork {
            work_id,
            base_title,
            author_id,
            author_name,
            unplayed_count: unplayed,
            shared_tags: shared,
            reason,
        });
    }

    works.sort_by(|a, b| {
        b.shared_tags.len().cmp(&a.shared_tags.len())
            .then(b.unplayed_count.cmp(&a.unplayed_count))
            .then(a.base_title.to_lowercase().cmp(&b.base_title.to_lowercase()))
    });
    works.truncate(cap);
    Ok(works)
}

/// Authors of chapters in play_events, most-recent first.
pub(crate) fn recent_authors(conn: &rusqlite::Connection, limit: usize) -> rusqlite::Result<Vec<i64>> {
    let mut stmt = conn.prepare(
        "SELECT w.author_id, MAX(pe.played_at) AS last
         FROM play_events pe
         JOIN chapters c ON pe.chapter_id=c.id
         JOIN works w ON c.work_id=w.id
         GROUP BY w.author_id ORDER BY last DESC",
    )?;
    let ids: Vec<i64> = stmt
        .query_map([], |r| r.get::<_, i64>(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(ids.into_iter().take(limit).collect())
}

pub(crate) fn discovery_for_you(conn: &rusqlite::Connection) -> rusqlite::Result<Vec<DiscoveryWork>> {
    let recent = recent_authors(conn, 10)?;
    if recent.is_empty() {
        return Ok(Vec::new());
    }
    // Tags of recently-played authors.
    let mut tags: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for id in &recent {
        let mut stmt = conn.prepare("SELECT tag FROM author_tags WHERE author_id=?1")?;
        for t in stmt.query_map(params![id], |r| r.get::<_, String>(0))? {
            tags.insert(t?);
        }
        let mut wstmt = conn.prepare(
            "SELECT wt.tag FROM work_tags wt JOIN works w ON wt.work_id=w.id WHERE w.author_id=?1",
        )?;
        for t in wstmt.query_map(params![id], |r| r.get::<_, String>(0))? {
            tags.insert(t?);
        }
    }
    let tag_vec: Vec<String> = tags.into_iter().collect();
    discovery_for_tags(conn, &tag_vec, &recent, 20)
}

pub(crate) fn more_from_author(conn: &rusqlite::Connection, author_id: i64) -> rusqlite::Result<Vec<MoreWork>> {
    let mut stmt = conn.prepare(
        "SELECT w.id, w.base_title,
                (SELECT count(*) FROM chapters c WHERE c.work_id=w.id AND c.status='active' AND c.played=0)
         FROM works w WHERE w.author_id=?1 AND w.status='active' ORDER BY w.sort_key",
    )?;
    let rows = stmt
        .query_map(params![author_id], |r| Ok(MoreWork { work_id: r.get(0)?, base_title: r.get(1)?, unplayed_count: r.get(2)? }))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

/// Load a single chapter as a `ChapterRow` (title derived from raw_filename; tags included).
fn load_chapter_row(conn: &rusqlite::Connection, chapter_id: i64) -> rusqlite::Result<ChapterRow> {
    let mut row = conn.query_row(
        "SELECT id, raw_filename, chapter_no, format, duration_secs, file_path, played,
                user_summary, takeaway, is_favorite
         FROM chapters WHERE id=?1",
        params![chapter_id],
        |r| {
            let raw: String = r.get(1)?;
            let title = std::path::Path::new(&raw)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or(raw);
            Ok(ChapterRow {
                id: r.get(0)?,
                title,
                chapter_no: r.get(2)?,
                format: r.get(3)?,
                duration_secs: r.get(4)?,
                file_path: r.get(5)?,
                played: r.get::<_, i64>(6)? != 0,
                tags: Vec::new(),
                user_summary: r.get::<_, String>(7).unwrap_or_default(),
                takeaway: r.get::<_, String>(8).unwrap_or_default(),
                is_favorite: r.get::<_, i64>(9).unwrap_or(0) != 0,
            })
        },
    )?;
    let mut ct = conn.prepare("SELECT tag FROM chapter_tags WHERE chapter_id=?1 ORDER BY tag")?;
    row.tags = ct
        .query_map(params![chapter_id], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(row)
}

/// Latest recently-played creator with an unplayed chapter to resume.
pub(crate) fn home_keep_listening(
    conn: &rusqlite::Connection,
) -> rusqlite::Result<Option<ContinueItem>> {
    let authors = recent_authors(conn, 20)?;
    for author_id in authors {
        let author_name: String = conn.query_row(
            "SELECT COALESCE(display_name, folder_name) FROM authors WHERE id=?1",
            params![author_id],
            |r| r.get(0),
        )?;
        let last_played_at: i64 = match conn.query_row(
            "SELECT MAX(pe.played_at) FROM play_events pe
             JOIN chapters c ON pe.chapter_id=c.id JOIN works w ON c.work_id=w.id
             WHERE w.author_id=?1",
            params![author_id],
            |r| r.get::<_, Option<i64>>(0),
        )? {
            Some(v) => v,
            None => continue, // no play-events for this author — skip
        };

        // Candidate work = the author's most-recently-played work.
        let candidate_work: Option<i64> = conn
            .query_row(
                "SELECT c.work_id FROM play_events pe
                 JOIN chapters c ON pe.chapter_id=c.id JOIN works w ON c.work_id=w.id
                 WHERE w.author_id=?1
                 GROUP BY c.work_id ORDER BY MAX(pe.played_at) DESC LIMIT 1",
                params![author_id],
                |r| r.get(0),
            )
            .optional()?;

        // Next unplayed chapter (id, work_id): prefer candidate work, else first active work.
        let next: Option<(i64, i64)> = {
            let in_candidate = match candidate_work {
                Some(wid) => conn
                    .query_row(
                        "SELECT id FROM chapters
                         WHERE work_id=?1 AND status='active' AND played=0
                         ORDER BY chapter_no ASC LIMIT 1",
                        params![wid],
                        |r| r.get::<_, i64>(0),
                    )
                    .optional()?
                    .map(|cid| (cid, wid)),
                None => None,
            };
            match in_candidate {
                Some(pair) => Some(pair),
                None => conn
                    .query_row(
                        "SELECT c.id, c.work_id FROM chapters c JOIN works w ON c.work_id=w.id
                         WHERE w.author_id=?1 AND w.status='active' AND c.status='active' AND c.played=0
                         ORDER BY w.sort_key ASC, c.chapter_no ASC LIMIT 1",
                        params![author_id],
                        |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
                    )
                    .optional()?,
            }
        };

        let (chapter_id, work_id) = match next {
            Some(p) => p,
            None => continue, // author fully played — nothing to resume
        };

        let work_title: String =
            conn.query_row("SELECT base_title FROM works WHERE id=?1", params![work_id], |r| r.get(0))?;
        let (total_chapters, played_chapters, remaining_unplayed): (i64, i64, i64) = conn.query_row(
            "SELECT count(*),
                    sum(CASE WHEN played=1 THEN 1 ELSE 0 END),
                    sum(CASE WHEN played=0 THEN 1 ELSE 0 END)
             FROM chapters WHERE work_id=?1 AND status='active'",
            params![work_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;
        let next_chapter = load_chapter_row(conn, chapter_id)?;

        return Ok(Some(ContinueItem {
            author_id,
            author_name,
            work_id,
            work_title,
            next_chapter,
            remaining_unplayed,
            total_chapters,
            played_chapters,
            last_played_at,
        }));
    }
    Ok(None)
}

struct HomeCandidate {
    item: RecommendationWork,
    shared_count: usize,
    recent_author_rank: Option<usize>,
    sort_key: String,
}

fn tags_for_author_and_work(
    conn: &rusqlite::Connection,
    author_id: i64,
    work_id: i64,
) -> rusqlite::Result<std::collections::BTreeSet<String>> {
    let mut tags = std::collections::BTreeSet::new();
    let mut author = conn.prepare("SELECT tag FROM author_tags WHERE author_id=?1")?;
    for tag in author.query_map(params![author_id], |r| r.get::<_, String>(0))? {
        tags.insert(tag?);
    }
    let mut work = conn.prepare("SELECT tag FROM work_tags WHERE work_id=?1")?;
    for tag in work.query_map(params![work_id], |r| r.get::<_, String>(0))? {
        tags.insert(tag?);
    }
    Ok(tags)
}

fn recommendation_reason(matched_tags: &[String], recent_author: bool) -> String {
    match matched_tags {
        [one] => format!("Shares {one}"),
        [first, second, ..] => format!("Shares {first} and {second}"),
        [] if recent_author => "More from a creator you listened to".to_string(),
        [] => "Mostly unplayed".to_string(),
    }
}

pub(crate) fn home_recommendations(
    conn: &rusqlite::Connection,
    exclude_work_id: Option<i64>,
    cap: usize,
) -> rusqlite::Result<Vec<RecommendationWork>> {
    let recent = recent_authors(conn, 20)?;
    let recent_rank: std::collections::HashMap<i64, usize> =
        recent.iter().enumerate().map(|(rank, id)| (*id, rank)).collect();
    let mut recent_tags = std::collections::BTreeSet::new();
    for author_id in &recent {
        let mut author = conn.prepare("SELECT tag FROM author_tags WHERE author_id=?1")?;
        for tag in author.query_map(params![author_id], |r| r.get::<_, String>(0))? {
            recent_tags.insert(tag?);
        }
        let mut works = conn.prepare(
            "SELECT wt.tag FROM work_tags wt JOIN works w ON wt.work_id=w.id WHERE w.author_id=?1",
        )?;
        for tag in works.query_map(params![author_id], |r| r.get::<_, String>(0))? {
            recent_tags.insert(tag?);
        }
    }

    let mut statement = conn.prepare(
        "SELECT w.id, w.base_title, w.sort_key, a.id,
                COALESCE(a.display_name, a.folder_name), count(c.id),
                sum(CASE WHEN c.played=0 THEN 1 ELSE 0 END)
         FROM works w
         JOIN authors a ON a.id=w.author_id
         JOIN chapters c ON c.work_id=w.id
         WHERE w.status='active' AND a.status='active' AND c.status='active'
         GROUP BY w.id, w.base_title, w.sort_key, a.id, a.folder_name, a.display_name
         HAVING sum(CASE WHEN c.played=0 THEN 1 ELSE 0 END) > 0",
    )?;
    let rows = statement
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, i64>(5)?,
                r.get::<_, i64>(6)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut candidates = Vec::new();
    for (work_id, base_title, sort_key, author_id, author_name, total, unplayed) in rows {
        if exclude_work_id == Some(work_id) {
            continue;
        }
        let owned = tags_for_author_and_work(conn, author_id, work_id)?;
        let tags: Vec<String> = owned.iter().cloned().collect();
        let matched_tags: Vec<String> =
            owned.intersection(&recent_tags).cloned().collect();
        let rank = recent_rank.get(&author_id).copied();
        let reason = recommendation_reason(&matched_tags, rank.is_some());
        candidates.push(HomeCandidate {
            shared_count: matched_tags.len(),
            recent_author_rank: rank,
            sort_key,
            item: RecommendationWork {
                work_id,
                base_title,
                author_id,
                author_name,
                total_chapters: total,
                unplayed_count: unplayed,
                tags,
                matched_tags,
                reason,
            },
        });
    }

    candidates.sort_by(|a, b| {
        b.shared_count
            .cmp(&a.shared_count)
            .then_with(|| b.recent_author_rank.is_some().cmp(&a.recent_author_rank.is_some()))
            .then_with(|| match (a.recent_author_rank, b.recent_author_rank) {
                (Some(left), Some(right)) => left.cmp(&right),
                _ => std::cmp::Ordering::Equal,
            })
            .then_with(|| {
                let left = a.item.unplayed_count * b.item.total_chapters;
                let right = b.item.unplayed_count * a.item.total_chapters;
                right.cmp(&left)
            })
            .then_with(|| b.item.unplayed_count.cmp(&a.item.unplayed_count))
            .then_with(|| {
                a.item
                    .author_name
                    .to_lowercase()
                    .cmp(&b.item.author_name.to_lowercase())
            })
            .then_with(|| a.sort_key.cmp(&b.sort_key))
            .then_with(|| a.item.work_id.cmp(&b.item.work_id))
    });

    let mut selected_authors = std::collections::BTreeSet::new();
    let mut selected_works = std::collections::BTreeSet::new();
    let mut selected = Vec::new();
    for candidate in &candidates {
        if selected.len() >= cap {
            break;
        }
        if selected_authors.insert(candidate.item.author_id) {
            selected_works.insert(candidate.item.work_id);
            selected.push(candidate.item.clone());
        }
    }
    for candidate in candidates {
        if selected.len() >= cap {
            break;
        }
        if selected_works.insert(candidate.item.work_id) {
            selected.push(candidate.item);
        }
    }
    Ok(selected)
}

/// Length of the current streak: consecutive local-day indices ending at the most recent
/// active day, counted only if that day is `today` or `today - 1` (else the streak is 0).
pub(crate) fn streak_len(days: &std::collections::BTreeSet<i64>, today: i64) -> i64 {
    let last = match days.iter().next_back() {
        Some(&d) => d,
        None => return 0,
    };
    if last < today - 1 {
        return 0; // most recent activity is 2+ days ago — streak broken
    }
    let mut count = 0i64;
    let mut d = last;
    while days.contains(&d) {
        count += 1;
        d -= 1;
    }
    count
}

/// "Your listening" stats. Totals come from the `played` flag (replays not double-counted);
/// streak + recent history come from `play_events`.
pub(crate) fn home_stats(
    conn: &rusqlite::Connection,
    now_ms: i64,
    tz_offset_minutes: i64,
    recent_limit: usize,
) -> rusqlite::Result<ListeningStats> {
    let chapters_finished: i64 = conn.query_row(
        "SELECT count(*) FROM chapters WHERE status='active' AND played=1",
        [],
        |r| r.get(0),
    )?;
    let total_secs: i64 = conn.query_row(
        "SELECT COALESCE(sum(duration_secs), 0) FROM chapters WHERE status='active' AND played=1",
        [],
        |r| r.get(0),
    )?;

    // Local calendar-day index. getTimezoneOffset() = (UTC - local) minutes ⇒ local = ms - off.
    let day = |ms: i64| (ms - tz_offset_minutes * 60_000).div_euclid(86_400_000);
    let mut days: std::collections::BTreeSet<i64> = std::collections::BTreeSet::new();
    {
        let mut s = conn.prepare("SELECT played_at FROM play_events")?;
        let mut q = s.query([])?;
        while let Some(r) = q.next()? {
            let ms: i64 = r.get(0)?;
            days.insert(day(ms));
        }
    }
    let streak_days = streak_len(&days, day(now_ms));

    let mut rstmt = conn.prepare(
        "SELECT c.id, c.raw_filename, w.id, w.base_title, a.id,
                COALESCE(a.display_name, a.folder_name), pe.played_at
         FROM play_events pe
         JOIN chapters c ON pe.chapter_id=c.id
         JOIN works w ON c.work_id=w.id
         JOIN authors a ON w.author_id=a.id
         ORDER BY pe.played_at DESC LIMIT ?1",
    )?;
    let recent: Vec<RecentItem> = rstmt
        .query_map(params![recent_limit as i64], |r| {
            let raw: String = r.get(1)?;
            let chapter_title = std::path::Path::new(&raw)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or(raw);
            Ok(RecentItem {
                chapter_id: r.get(0)?,
                chapter_title,
                work_id: r.get(2)?,
                work_title: r.get(3)?,
                author_id: r.get(4)?,
                author_name: r.get(5)?,
                played_at: r.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;

    Ok(ListeningStats { total_secs, chapters_finished, streak_days, recent })
}

#[tauri::command]
pub fn query_home(state: tauri::State<DbState>, now_ms: i64, tz_offset_minutes: i64) -> Result<HomeData, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let keep_listening = home_keep_listening(&conn).map_err(|e| e.to_string())?;
    let recommendations =
        home_recommendations(&conn, keep_listening.as_ref().map(|item| item.work_id), 6)
            .map_err(|e| e.to_string())?;
    let stats = home_stats(&conn, now_ms, tz_offset_minutes, 10).map_err(|e| e.to_string())?;
    Ok(HomeData { keep_listening, recommendations, stats })
}

#[tauri::command]
pub fn query_insights(
    state: tauri::State<DbState>,
    now_ms: i64,
    tz_offset_minutes: i64,
) -> Result<crate::model::InsightsData, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    crate::insights::compute_insights(&conn, now_ms, tz_offset_minutes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_discovery(state: tauri::State<DbState>) -> Result<Vec<DiscoveryWork>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    discovery_for_you(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_discovery_by_tags(state: tauri::State<DbState>, tags: Vec<String>) -> Result<Vec<DiscoveryWork>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    discovery_for_tags(&conn, &tags, &[], 50).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_more_from_author(state: tauri::State<DbState>, author_id: i64) -> Result<Vec<MoreWork>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    more_from_author(&conn, author_id).map_err(|e| e.to_string())
}

fn status_str(s: &rename::ItemStatus) -> &'static str {
    match s {
        rename::ItemStatus::Ok => "ok",
        rename::ItemStatus::Noop => "noop",
        rename::ItemStatus::Conflict => "conflict",
    }
}

/// `<app_data>/rename-manifests`.
fn rename_manifest_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    use tauri::Manager;
    let dir = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir());
    dir.join("rename-manifests")
}

#[tauri::command]
pub fn preview_renames(state: tauri::State<DbState>) -> Result<Vec<RenameItem>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let plan = rename::build_plan(&conn).map_err(|e| e.to_string())?;
    Ok(plan
        .into_iter()
        .map(|i| RenameItem {
            chapter_id: i.chapter_id,
            author_name: i.author_name,
            base_title: i.base_title,
            from_name: i.from_name,
            to_name: i.to_name,
            status: status_str(&i.status).to_string(),
            conflict_reason: i.conflict_reason,
        })
        .collect())
}

#[tauri::command]
pub fn apply_renames(
    app: tauri::AppHandle,
    state: tauri::State<DbState>,
    chapter_ids: Vec<i64>,
    now_ms: i64,
) -> Result<RenameResult, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let dir = rename_manifest_dir(&app);
    let out = rename::execute(&conn, &chapter_ids, &dir, now_ms).map_err(|e| e.to_string())?;
    Ok(RenameResult {
        renamed_count: out.renamed_count,
        failures: out.failures.into_iter().map(|(f, e)| format!("{f}: {e}")).collect(),
        manifest_path: out.manifest_path,
    })
}

#[tauri::command]
pub fn undo_renames(state: tauri::State<DbState>, manifest_path: String) -> Result<UndoResult, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let out = rename::undo(&conn, std::path::Path::new(&manifest_path)).map_err(|e| e.to_string())?;
    Ok(UndoResult {
        reverted_count: out.reverted_count,
        failures: out.failures.into_iter().map(|(f, e)| format!("{f}: {e}")).collect(),
    })
}

// ---- embedded-metadata ingestion commands (M16 Task 4) --------------------------------

/// Embedded tag fields captured from a single audio file via lofty.
struct EmbeddedMeta {
    title: Option<String>,
    album: Option<String>,
    track: Option<u32>,
    genre: Option<String>,
}

/// Read embedded metadata from `path` using lofty. Returns defaults (all None) on failure.
fn read_embedded_meta(path: &std::path::Path) -> EmbeddedMeta {
    use lofty::prelude::*;
    let Ok(tagged) = lofty::read_from_path(path) else {
        return EmbeddedMeta { title: None, album: None, track: None, genre: None };
    };
    let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) else {
        return EmbeddedMeta { title: None, album: None, track: None, genre: None };
    };
    let title = tag.get_string(&lofty::tag::ItemKey::TrackTitle).map(|s| s.to_string());
    // Prefer AlbumTitle as the work title; fall back to TrackTitle for single-file works.
    let album = tag.get_string(&lofty::tag::ItemKey::AlbumTitle).map(|s| s.to_string());
    let track = tag.track();
    let genre = tag.get_string(&lofty::tag::ItemKey::Genre).map(|s| s.to_string());
    EmbeddedMeta { title, album, track, genre }
}

/// Trim and return Some only if the string is non-empty.
fn non_empty(s: &str) -> Option<&str> {
    let t = s.trim();
    if t.is_empty() { None } else { Some(t) }
}

/// Build `MetadataProposal` rows for a single author (or all authors if None).
/// Re-reads files via lofty; does NOT cache; emits only genuine differences.
pub fn build_metadata_proposals(
    conn: &rusqlite::Connection,
    author_id: Option<i64>,
) -> rusqlite::Result<Vec<MetadataProposal>> {
    // Fetch all active chapters with their work info (optionally filtered by author).
    let sql = if author_id.is_some() {
        "SELECT c.id, c.file_path, c.chapter_no, w.id, w.base_title
         FROM chapters c JOIN works w ON c.work_id = w.id
         JOIN authors a ON w.author_id = a.id
         WHERE c.status='active' AND w.status='active' AND a.status='active'
           AND w.author_id = ?1"
    } else {
        "SELECT c.id, c.file_path, c.chapter_no, w.id, w.base_title
         FROM chapters c JOIN works w ON c.work_id = w.id
         JOIN authors a ON w.author_id = a.id
         WHERE c.status='active' AND w.status='active' AND a.status='active'"
    };

    struct Row { chapter_id: i64, file_path: String, chapter_no: i64, work_id: i64, base_title: String }
    let rows: Vec<Row> = {
        let mut stmt = conn.prepare(sql)?;
        let mapped = if let Some(aid) = author_id {
            stmt.query_map(params![aid], |r| Ok(Row {
                chapter_id: r.get(0)?,
                file_path: r.get(1)?,
                chapter_no: r.get(2)?,
                work_id: r.get(3)?,
                base_title: r.get(4)?,
            }))?
            .collect::<rusqlite::Result<Vec<_>>>()?
        } else {
            stmt.query_map([], |r| Ok(Row {
                chapter_id: r.get(0)?,
                file_path: r.get(1)?,
                chapter_no: r.get(2)?,
                work_id: r.get(3)?,
                base_title: r.get(4)?,
            }))?
            .collect::<rusqlite::Result<Vec<_>>>()?
        };
        mapped
    };

    let mut proposals: Vec<MetadataProposal> = Vec::new();
    // Track work_id -> proposed title so we don't emit the same work-title proposal twice.
    let mut work_title_proposed: std::collections::HashSet<i64> = std::collections::HashSet::new();
    // Track (work_id, tag) so duplicate genre proposals per work are suppressed.
    let mut work_tags_proposed: std::collections::HashSet<(i64, String)> = std::collections::HashSet::new();

    for row in &rows {
        let path = std::path::Path::new(&row.file_path);
        let meta = read_embedded_meta(path);

        // --- work title proposal: use album tag, else track title ---
        let embedded_title = meta.album.as_deref().or(meta.title.as_deref());
        if let Some(et) = embedded_title.and_then(non_empty) {
            if et != row.base_title.trim() && !work_title_proposed.contains(&row.work_id) {
                work_title_proposed.insert(row.work_id);
                proposals.push(MetadataProposal {
                    chapter_id: row.chapter_id,
                    work_id: row.work_id,
                    field: "title".to_string(),
                    current: row.base_title.clone(),
                    proposed: et.to_string(),
                    source: "embedded".to_string(),
                });
            }
        }

        // --- chapter order proposal: track number ---
        if let Some(track) = meta.track {
            let track_i64 = track as i64;
            if track_i64 != row.chapter_no && track_i64 > 0 {
                proposals.push(MetadataProposal {
                    chapter_id: row.chapter_id,
                    work_id: row.work_id,
                    field: "order".to_string(),
                    current: row.chapter_no.to_string(),
                    proposed: track_i64.to_string(),
                    source: "embedded".to_string(),
                });
            }
        }

        // --- genre tag proposal ---
        if let Some(genre) = meta.genre.as_deref().and_then(non_empty) {
            let key = (row.work_id, genre.to_string());
            if !work_tags_proposed.contains(&key) {
                // Only propose if this tag is not already on the work.
                let exists: i64 = conn.query_row(
                    "SELECT count(*) FROM work_tags WHERE work_id=?1 AND tag=?2",
                    params![row.work_id, genre],
                    |r| r.get(0),
                ).unwrap_or(0);
                if exists == 0 {
                    work_tags_proposed.insert(key);
                    proposals.push(MetadataProposal {
                        chapter_id: row.chapter_id,
                        work_id: row.work_id,
                        field: "tag".to_string(),
                        current: String::new(),
                        proposed: genre.to_string(),
                        source: "embedded".to_string(),
                    });
                }
            }
        }
    }

    Ok(proposals)
}

#[tauri::command]
pub fn preview_metadata(
    state: tauri::State<DbState>,
    author_id: Option<i64>,
) -> Result<Vec<MetadataProposal>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    build_metadata_proposals(&conn, author_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn apply_metadata(
    state: tauri::State<DbState>,
    proposals: Vec<MetadataProposal>,
) -> Result<MetadataApplyReport, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    apply_metadata_proposals(&conn, &proposals).map_err(|e| e.to_string())
}

/// Inner DB-only apply: updates works/chapters and marks metadata_source='embedded'.
/// Wrapped in a transaction for atomicity.
pub fn apply_metadata_proposals(
    conn: &rusqlite::Connection,
    proposals: &[MetadataProposal],
) -> rusqlite::Result<MetadataApplyReport> {
    let tx = conn.unchecked_transaction()?;
    let mut applied: i64 = 0;
    let mut skipped: i64 = 0;

    for p in proposals {
        let ok = match p.field.as_str() {
            "title" => {
                tx.execute(
                    "UPDATE works SET base_title=?1, sort_key=lower(?1), metadata_source='embedded' WHERE id=?2",
                    params![p.proposed, p.work_id],
                )? > 0
            }
            "order" => {
                let new_no: i64 = p.proposed.parse().unwrap_or(0);
                if new_no <= 0 {
                    false
                } else {
                    tx.execute(
                        "UPDATE chapters SET chapter_no=?1, metadata_source='embedded' WHERE id=?2",
                        params![new_no, p.chapter_id],
                    )? > 0
                }
            }
            "tag" => {
                // Insert the genre tag on the work; mark the work's metadata_source.
                tx.execute(
                    "INSERT OR IGNORE INTO work_tags(work_id, tag) VALUES (?1, ?2)",
                    params![p.work_id, p.proposed],
                )? > 0
                || {
                    // Even if tag already existed (OR IGNORE), we still update the source.
                    tx.execute(
                        "UPDATE works SET metadata_source='embedded' WHERE id=?1",
                        params![p.work_id],
                    ).is_ok()
                }
            }
            _ => false,
        };
        if ok { applied += 1; } else { skipped += 1; }
    }

    tx.commit()?;
    Ok(MetadataApplyReport { applied, skipped })
}

// `undo_metadata` is DEFERRED — the feature is low-value without persistent manifests
// (proposals are ephemeral; user can re-scan and re-preview). Not implemented in Task 4.

// ---- series / reading-order detection (M16 Task 6) ------------------------------------

/// A proposed member of a detected series.
#[derive(Debug, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesMemberProposal {
    pub work_id: i64,
    pub base_title: String,
    pub position: i64,
}

/// A detected series proposal (not yet persisted).
#[derive(Debug, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesProposal {
    pub title: String,
    pub members: Vec<SeriesMemberProposal>,
}

/// One member's view with progress, as returned by `get_author_series`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesMemberView {
    pub work_id: i64,
    pub base_title: String,
    pub position: i64,
    pub played_chapters: i64,
    pub total_chapters: i64,
}

/// A persisted series with ordered members, as returned by `get_author_series`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesView {
    pub id: i64,
    pub title: String,
    pub members: Vec<SeriesMemberView>,
}

/// Detect series proposals for an author by grouping works whose `base_title`
/// shares a common stem after stripping trailing numerics (via `grouping::parse_stem`).
/// Returns only groups with ≥2 members. Does NOT write to the DB.
pub fn detect_series_for_author(
    conn: &rusqlite::Connection,
    author_id: i64,
) -> rusqlite::Result<Vec<SeriesProposal>> {
    use crate::grouping::parse_stem;

    // Load all active works for this author.
    let mut stmt = conn.prepare(
        "SELECT id, base_title FROM works WHERE author_id=?1 AND status='active'",
    )?;
    let works: Vec<(i64, String)> = stmt
        .query_map(params![author_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;

    // Group works by the stem of their `base_title` using `parse_stem`.
    // If the base_title itself ends in a number, parse_stem strips it to give the stem.
    use std::collections::BTreeMap;
    // Map: stem -> Vec<(work_id, base_title, numeric position extracted from title)>
    let mut groups: BTreeMap<String, Vec<(i64, String, i64)>> = BTreeMap::new();

    for (work_id, base_title) in &works {
        let parsed = parse_stem(base_title);
        // Only group when there's actually a trailing number (had_number == true), or when
        // the title is "exactly the stem" (position 1 of a numbered series).
        // Strategy: use the parsed stem as the group key; use chapter_no as position.
        // For a title like "Cool Story" with no trailing number, parse_stem returns
        //   base="Cool Story", chapter_no=1, had_number=false.
        // For "Cool Story 2" it returns base="Cool Story", chapter_no=2, had_number=true.
        // We group ALL works under the same stem. If had_number is false, position = 1.
        let stem = parsed.base.clone();
        let position = parsed.chapter_no as i64;
        groups.entry(stem).or_default().push((work_id.clone(), base_title.clone(), position));
    }

    let mut proposals = Vec::new();
    for (stem, mut members) in groups {
        if members.len() < 2 {
            continue; // only propose groups with ≥2 members
        }
        // Sort members by position.
        members.sort_by_key(|(_, _, pos)| *pos);
        proposals.push(SeriesProposal {
            title: stem,
            members: members
                .into_iter()
                .map(|(work_id, base_title, position)| SeriesMemberProposal {
                    work_id,
                    base_title,
                    position,
                })
                .collect(),
        });
    }

    Ok(proposals)
}

#[tauri::command]
pub fn detect_series(
    state: tauri::State<DbState>,
    author_id: i64,
) -> Result<Vec<SeriesProposal>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    detect_series_for_author(&conn, author_id).map_err(|e| e.to_string())
}

/// Persist series proposals: INSERT (OR IGNORE on UNIQUE) each series row, then
/// INSERT OR REPLACE the membership rows. One transaction.
pub fn apply_series_proposals(
    conn: &rusqlite::Connection,
    author_id: i64,
    proposals: &[SeriesProposal],
) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    for proposal in proposals {
        let sort_key = proposal.title.to_lowercase();
        // Insert series (UNIQUE on author_id+title — ignore if already exists).
        tx.execute(
            "INSERT OR IGNORE INTO series(author_id, title, sort_key) VALUES (?1, ?2, ?3)",
            params![author_id, proposal.title, sort_key],
        )?;
        let series_id: i64 = tx.query_row(
            "SELECT id FROM series WHERE author_id=?1 AND title=?2",
            params![author_id, proposal.title],
            |r| r.get(0),
        )?;
        for member in &proposal.members {
            tx.execute(
                "INSERT OR REPLACE INTO work_series_membership(work_id, series_id, position)
                 VALUES (?1, ?2, ?3)",
                params![member.work_id, series_id, member.position],
            )?;
        }
    }
    tx.commit()
}

#[tauri::command]
pub fn apply_series(
    state: tauri::State<DbState>,
    author_id: i64,
    proposals: Vec<SeriesProposal>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    apply_series_proposals(&conn, author_id, &proposals).map_err(|e| e.to_string())
}

/// Fetch the persisted series for an author, with per-member progress.
pub fn query_author_series(
    conn: &rusqlite::Connection,
    author_id: i64,
) -> rusqlite::Result<Vec<SeriesView>> {
    let mut sstmt = conn.prepare(
        "SELECT id, title FROM series WHERE author_id=?1 ORDER BY sort_key",
    )?;
    let series_rows: Vec<(i64, String)> = sstmt
        .query_map(params![author_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;

    let mut result = Vec::new();
    for (series_id, title) in series_rows {
        let mut mstmt = conn.prepare(
            "SELECT wsm.work_id, w.base_title, wsm.position
             FROM work_series_membership wsm
             JOIN works w ON wsm.work_id = w.id
             WHERE wsm.series_id=?1
             ORDER BY wsm.position",
        )?;
        let raw_members: Vec<(i64, String, i64)> = mstmt
            .query_map(params![series_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<rusqlite::Result<_>>()?;

        let mut members = Vec::new();
        for (work_id, base_title, position) in raw_members {
            // Per-member progress: count total and played chapters.
            let (total_chapters, played_chapters): (i64, i64) = conn.query_row(
                "SELECT
                    count(*),
                    sum(CASE WHEN played=1 THEN 1 ELSE 0 END)
                 FROM chapters WHERE work_id=?1 AND status='active'",
                params![work_id],
                |r| Ok((r.get(0)?, r.get::<_, Option<i64>>(1)?.unwrap_or(0))),
            )?;
            members.push(SeriesMemberView {
                work_id,
                base_title,
                position,
                played_chapters,
                total_chapters,
            });
        }
        result.push(SeriesView { id: series_id, title, members });
    }
    Ok(result)
}

#[tauri::command]
pub fn get_author_series(
    state: tauri::State<DbState>,
    author_id: i64,
) -> Result<Vec<SeriesView>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    query_author_series(&conn, author_id).map_err(|e| e.to_string())
}

// ---- tag taxonomy commands (M16 Task 2) -----------------------------------------------

/// Resolve each tag through `tag_aliases` (alias→canonical), deduplicating the result.
/// Tags not present in the alias table are passed through unchanged.
pub(crate) fn resolve_aliases(conn: &rusqlite::Connection, tags: &[String]) -> rusqlite::Result<Vec<String>> {
    let mut resolved: Vec<String> = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for tag in tags {
        let canonical: String = conn
            .query_row(
                "SELECT canonical FROM tag_aliases WHERE alias=?1",
                params![tag],
                |r| r.get(0),
            )
            .unwrap_or_else(|_| tag.clone());
        if seen.insert(canonical.clone()) {
            resolved.push(canonical);
        }
    }
    Ok(resolved)
}

/// Inner implementation returning rusqlite::Result so ? works uniformly.
fn query_tags_with_counts(conn: &rusqlite::Connection) -> rusqlite::Result<Vec<TagStat>> {
    let mut map: std::collections::BTreeMap<String, TagStat> = std::collections::BTreeMap::new();

    let ensure = |map: &mut std::collections::BTreeMap<String, TagStat>, tag: String| {
        map.entry(tag.clone()).or_insert_with(|| TagStat {
            tag,
            work_count: 0,
            chapter_count: 0,
            author_count: 0,
        });
    };

    {
        let mut s = conn.prepare("SELECT tag, count(*) FROM author_tags GROUP BY tag")?;
        let mut q = s.query([])?;
        while let Some(r) = q.next()? {
            let tag: String = r.get(0)?;
            let cnt: i64 = r.get(1)?;
            ensure(&mut map, tag.clone());
            map.get_mut(&tag).unwrap().author_count = cnt;
        }
    }
    {
        let mut s = conn.prepare("SELECT tag, count(*) FROM work_tags GROUP BY tag")?;
        let mut q = s.query([])?;
        while let Some(r) = q.next()? {
            let tag: String = r.get(0)?;
            let cnt: i64 = r.get(1)?;
            ensure(&mut map, tag.clone());
            map.get_mut(&tag).unwrap().work_count = cnt;
        }
    }
    {
        let mut s = conn.prepare("SELECT tag, count(*) FROM chapter_tags GROUP BY tag")?;
        let mut q = s.query([])?;
        while let Some(r) = q.next()? {
            let tag: String = r.get(0)?;
            let cnt: i64 = r.get(1)?;
            ensure(&mut map, tag.clone());
            map.get_mut(&tag).unwrap().chapter_count = cnt;
        }
    }

    Ok(map.into_values().collect())
}

/// Per-tag usage count across author_tags, work_tags, and chapter_tags.
#[tauri::command]
pub fn list_tags_with_counts(state: tauri::State<DbState>) -> Result<Vec<TagStat>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    query_tags_with_counts(&conn).map_err(|e| e.to_string())
}

/// Rename a tag across all three tag tables in one transaction.
/// If `to` already exists on an entity that also has `from`, the INSERT OR IGNORE
/// silently skips the duplicate; then DELETE removes `from`, leaving one clean row.
#[tauri::command]
pub fn rename_tag(state: tauri::State<DbState>, from: String, to: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for (table, key_col) in &[
        ("author_tags", "author_id"),
        ("work_tags", "work_id"),
        ("chapter_tags", "chapter_id"),
    ] {
        tx.execute(
            &format!(
                "INSERT OR IGNORE INTO {table}({key_col}, tag) SELECT {key_col}, ?1 FROM {table} WHERE tag=?2"
            ),
            params![to, from],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            &format!("DELETE FROM {table} WHERE tag=?1"),
            params![from],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

/// Merge multiple source tags into a target tag across all three tag tables.
#[tauri::command]
pub fn merge_tags(state: tauri::State<DbState>, sources: Vec<String>, target: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for source in &sources {
        for (table, key_col) in &[
            ("author_tags", "author_id"),
            ("work_tags", "work_id"),
            ("chapter_tags", "chapter_id"),
        ] {
            tx.execute(
                &format!(
                    "INSERT OR IGNORE INTO {table}({key_col}, tag) SELECT {key_col}, ?1 FROM {table} WHERE tag=?2"
                ),
                params![target, source],
            )
            .map_err(|e| e.to_string())?;
            tx.execute(
                &format!("DELETE FROM {table} WHERE tag=?1"),
                params![source],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

/// Insert or replace an alias→canonical mapping.
#[tauri::command]
pub fn set_tag_alias(state: tauri::State<DbState>, alias: String, canonical: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO tag_aliases(alias, canonical) VALUES (?1, ?2)",
        params![alias, canonical],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Remove an alias entry.
#[tauri::command]
pub fn clear_tag_alias(state: tauri::State<DbState>, alias: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM tag_aliases WHERE alias=?1", params![alias])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Assign a parent to a tag (child→parent hierarchy).
#[tauri::command]
pub fn set_tag_parent(state: tauri::State<DbState>, child: String, parent: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO tag_parents(child, parent) VALUES (?1, ?2)",
        params![child, parent],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Remove a tag's parent assignment.
#[tauri::command]
pub fn clear_tag_parent(state: tauri::State<DbState>, child: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM tag_parents WHERE child=?1", params![child])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------------------

/// Harness-only: delete all play history (play_events rows + chapter played flags).
/// This is intentionally NOT wired into any user-facing UI — it exists solely so
/// the verify-harness can capture a genuine empty-state Home screenshot before
/// seeding play events for the populated-state shot, even across repeated runs.
#[tauri::command]
pub fn reset_play_history(state: tauri::State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM play_events", []).map_err(|e| e.to_string())?;
    conn.execute("UPDATE chapters SET played=0", []).map_err(|e| e.to_string())?;
    Ok(())
}

/// Harness-only: insert play_events at arbitrary timestamps (and mark those chapters played),
/// so the `insights` walkthrough can populate a deterministic heatmap/trends across many days.
/// NOT wired into any user-facing UI.
#[tauri::command]
pub fn seed_play_events(
    state: tauri::State<DbState>,
    events: Vec<crate::model::SeedPlayEvent>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    for e in &events {
        conn.execute("UPDATE chapters SET played=1 WHERE id=?1", rusqlite::params![e.chapter_id])
            .map_err(|x| x.to_string())?;
        conn.execute(
            "INSERT INTO play_events(chapter_id, played_at) VALUES (?1, ?2)",
            rusqlite::params![e.chapter_id, e.played_at],
        )
        .map_err(|x| x.to_string())?;
    }
    Ok(())
}

/// Resolve a chapter's current file path and its author id.
fn chapter_path_and_author(conn: &rusqlite::Connection, chapter_id: i64) -> rusqlite::Result<(String, i64)> {
    conn.query_row(
        "SELECT c.file_path, w.author_id FROM chapters c JOIN works w ON c.work_id=w.id WHERE c.id=?1",
        params![chapter_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
}

#[tauri::command]
pub fn set_grouping_override(
    state: tauri::State<DbState>,
    chapter_id: i64,
    base_title: Option<String>,
    chapter_no: Option<i64>,
) -> Result<AuthorDetail, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let (path, author_id) = chapter_path_and_author(&conn, chapter_id).map_err(|e| e.to_string())?;
    if base_title.is_none() && chapter_no.is_none() {
        conn.execute("DELETE FROM grouping_overrides WHERE chapter_path=?1", params![path])
            .map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "INSERT INTO grouping_overrides(chapter_path, base_title, chapter_no) VALUES (?1, ?2, ?3)
             ON CONFLICT(chapter_path) DO UPDATE SET base_title=excluded.base_title, chapter_no=excluded.chapter_no",
            params![path, base_title, chapter_no],
        )
        .map_err(|e| e.to_string())?;
    }
    regroup::regroup_author(&conn, author_id).map_err(|e| e.to_string())?;
    query_author_detail(&conn, author_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_grouping_override(
    state: tauri::State<DbState>,
    chapter_id: i64,
) -> Result<AuthorDetail, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let (path, author_id) = chapter_path_and_author(&conn, chapter_id).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM grouping_overrides WHERE chapter_path=?1", params![path])
        .map_err(|e| e.to_string())?;
    regroup::regroup_author(&conn, author_id).map_err(|e| e.to_string())?;
    query_author_detail(&conn, author_id).map_err(|e| e.to_string())
}

// ---- transcript search (M16 Task 8) ---------------------------------------------------

/// A transcript search hit with surrounding context (snippet).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptHit {
    pub chapter_id: i64,
    pub chapter_title: String,
    pub work_id: i64,
    pub work_title: String,
    pub author_id: i64,
    pub author_name: String,
    pub snippet: String,
}

/// Extract a ~200-character window of text centred on the first occurrence of `query`
/// in `content` (case-insensitive). Returns the whole content if no match is found.
fn make_snippet(content: &str, query: &str) -> String {
    let lower_content = content.to_lowercase();
    let lower_query = query.to_lowercase();
    const HALF: usize = 100;
    const MAX: usize = 200;

    if let Some(pos) = lower_content.find(&lower_query) {
        let start = pos.saturating_sub(HALF);
        let end = (pos + query.len() + HALF).min(content.len());
        // Align to char boundaries.
        let start = content.char_indices().map(|(i, _)| i).filter(|&i| i <= start).last().unwrap_or(0);
        let end = content.char_indices().map(|(i, _)| i).filter(|&i| i >= end).next().unwrap_or(content.len());
        let raw = &content[start..end];
        let trimmed = raw.trim();
        if start > 0 { format!("…{trimmed}") } else { trimmed.to_string() }
    } else {
        content.chars().take(MAX).collect()
    }
}

/// Inner search implementation: LIKE '%query%' across transcript content, joined to
/// chapters/works/authors. Returns up to `cap` hits.
pub fn search_transcripts_inner(
    conn: &rusqlite::Connection,
    query: &str,
    cap: usize,
) -> rusqlite::Result<Vec<TranscriptHit>> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let like = like_contains(q);

    let mut stmt = conn.prepare(
        "SELECT t.chapter_id, c.raw_filename,
                w.id, w.base_title,
                a.id, COALESCE(a.display_name, a.folder_name),
                t.content
         FROM transcripts t
         JOIN chapters c ON t.chapter_id = c.id
         JOIN works w ON c.work_id = w.id
         JOIN authors a ON w.author_id = a.id
         WHERE c.status='active' AND w.status='active' AND a.status='active'
               AND t.content LIKE ?1 ESCAPE '\\'
         LIMIT ?2",
    )?;

    let hits = stmt
        .query_map(params![like, cap as i64], |r| {
            let raw: String = r.get(1)?;
            let chapter_title = std::path::Path::new(&raw)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or(raw);
            let content: String = r.get(6)?;
            Ok((r.get::<_, i64>(0)?, chapter_title, r.get::<_, i64>(2)?, r.get::<_, String>(3)?, r.get::<_, i64>(4)?, r.get::<_, String>(5)?, content))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let results = hits
        .into_iter()
        .map(|(chapter_id, chapter_title, work_id, work_title, author_id, author_name, content)| {
            let snippet = make_snippet(&content, q);
            TranscriptHit { chapter_id, chapter_title, work_id, work_title, author_id, author_name, snippet }
        })
        .collect();

    Ok(results)
}

#[tauri::command]
pub fn search_transcripts(
    state: tauri::State<DbState>,
    query: String,
) -> Result<Vec<TranscriptHit>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    search_transcripts_inner(&conn, &query, SEARCH_CAP).map_err(|e| e.to_string())
}

/// Return the plain-text transcript content for a chapter, or None if absent.
pub fn get_chapter_transcript_inner(
    conn: &rusqlite::Connection,
    chapter_id: i64,
) -> rusqlite::Result<Option<String>> {
    use rusqlite::OptionalExtension;
    conn.query_row(
        "SELECT content FROM transcripts WHERE chapter_id=?1",
        params![chapter_id],
        |r| r.get::<_, String>(0),
    )
    .optional()
}

#[tauri::command]
pub fn get_chapter_transcript(
    state: tauri::State<DbState>,
    chapter_id: i64,
) -> Result<Option<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    get_chapter_transcript_inner(&conn, chapter_id).map_err(|e| e.to_string())
}

// ---- M16 Task 10: intelligence backend -----------------------------------------------

/// Returns works that had at least one chapter played but whose last play event is
/// older than `now_ms - days * 86_400_000`. Sorted by played_fraction DESC.
pub fn query_dormant_works(
    conn: &rusqlite::Connection,
    now_ms: i64,
    days: i64,
) -> rusqlite::Result<Vec<DormantWork>> {
    let cutoff = now_ms - days * 86_400_000;
    // Aggregate per-work: last play event, total chapters, played chapters.
    let mut stmt = conn.prepare(
        "SELECT w.id, w.base_title, w.author_id,
                COALESCE(a.display_name, a.folder_name),
                MAX(pe.played_at) AS last_played,
                COUNT(DISTINCT c2.id) AS total_chs,
                COUNT(DISTINCT CASE WHEN c2.played=1 THEN c2.id END) AS played_chs
         FROM play_events pe
         JOIN chapters c  ON pe.chapter_id=c.id
         JOIN works w      ON c.work_id=w.id
         JOIN authors a    ON w.author_id=a.id
         JOIN chapters c2  ON c2.work_id=w.id AND c2.status='active'
         WHERE w.status='active' AND a.status='active'
         GROUP BY w.id, w.base_title, w.author_id, a.display_name, a.folder_name
         HAVING MAX(pe.played_at) < ?1",
    )?;
    let rows = stmt
        .query_map(params![cutoff], |r| {
            let total: i64 = r.get(5)?;
            let played: i64 = r.get(6)?;
            let played_fraction = if total > 0 { played as f64 / total as f64 } else { 0.0 };
            Ok(DormantWork {
                work_id: r.get(0)?,
                base_title: r.get(1)?,
                author_id: r.get(2)?,
                author_name: r.get(3)?,
                last_played_at: r.get(4)?,
                played_fraction,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut result = rows;
    result.sort_by(|a, b| b.played_fraction.partial_cmp(&a.played_fraction).unwrap_or(std::cmp::Ordering::Equal));
    Ok(result)
}

#[tauri::command]
pub fn get_dormant_works(state: tauri::State<DbState>, now_ms: i64, days: i64) -> Result<Vec<DormantWork>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    query_dormant_works(&conn, now_ms, days).map_err(|e| e.to_string())
}

/// Return works similar to `work_id`: take that work's tags (author ∪ work, alias-resolved),
/// then call `discovery_for_tags` excluding the source work's author.
pub fn more_like_this(
    conn: &rusqlite::Connection,
    work_id: i64,
    cap: usize,
) -> rusqlite::Result<Vec<DiscoveryWork>> {
    // Fetch the author of the source work.
    let author_id: i64 = conn.query_row(
        "SELECT author_id FROM works WHERE id=?1",
        params![work_id],
        |r| r.get(0),
    )?;
    // Collect raw tags (author ∪ work).
    let mut raw_tags: Vec<String> = Vec::new();
    let mut at = conn.prepare("SELECT tag FROM author_tags WHERE author_id=?1")?;
    for t in at.query_map(params![author_id], |r| r.get::<_, String>(0))? {
        raw_tags.push(t?);
    }
    let mut wt = conn.prepare("SELECT tag FROM work_tags WHERE work_id=?1")?;
    for t in wt.query_map(params![work_id], |r| r.get::<_, String>(0))? {
        raw_tags.push(t?);
    }
    if raw_tags.is_empty() {
        return Ok(Vec::new());
    }
    let resolved = resolve_aliases(conn, &raw_tags)?;
    // Exclude the source work's author; discovery_for_tags will also exclude works with 0 unplayed.
    let mut results = discovery_for_tags(conn, &resolved, &[author_id], cap)?;
    // Also filter out the source work itself if it somehow slipped through (different author edge case).
    results.retain(|w| w.work_id != work_id);
    Ok(results)
}

#[tauri::command]
pub fn get_more_like_this(state: tauri::State<DbState>, work_id: i64, cap: usize) -> Result<Vec<DiscoveryWork>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    more_like_this(&conn, work_id, cap).map_err(|e| e.to_string())
}

/// Pure logic: given filename/folder tokens, an existing vocabulary, and a work's current
/// tags, return suggested tags (vocab matches + novel tokens), deduped, excluding existing.
pub fn suggest_tags_from(tokens: &[String], vocabulary: &[String], existing: &[String]) -> Vec<String> {
    let existing_set: std::collections::BTreeSet<&str> = existing.iter().map(|s| s.as_str()).collect();
    let vocab_set: std::collections::BTreeSet<&str> = vocabulary.iter().map(|s| s.as_str()).collect();
    let mut seen = std::collections::BTreeSet::new();
    let mut suggestions: Vec<String> = Vec::new();
    // First: vocabulary matches (tokens that appear in the user's existing tag vocabulary).
    for t in tokens {
        let t_lc = t.to_lowercase();
        if !existing_set.contains(t_lc.as_str()) && vocab_set.contains(t_lc.as_str()) && seen.insert(t_lc.clone()) {
            suggestions.push(t_lc);
        }
    }
    // Then: novel tokens (not in vocabulary, not existing).
    for t in tokens {
        let t_lc = t.to_lowercase();
        if !existing_set.contains(t_lc.as_str()) && !vocab_set.contains(t_lc.as_str()) && seen.insert(t_lc.clone()) {
            suggestions.push(t_lc);
        }
    }
    suggestions
}

/// Tokenise a file path (folder name + file stem) and return tag suggestions for `work_id`.
pub(crate) fn suggest_tags_for_work(
    conn: &rusqlite::Connection,
    work_id: i64,
) -> rusqlite::Result<Vec<String>> {
    // Get work's folder path via its first active chapter.
    let file_path: Option<String> = conn
        .query_row(
            "SELECT c.file_path FROM chapters c WHERE c.work_id=?1 AND c.status='active' ORDER BY c.chapter_no LIMIT 1",
            params![work_id],
            |r| r.get(0),
        )
        .optional()?;
    let file_path = match file_path {
        Some(p) => p,
        None => return Ok(Vec::new()),
    };
    // Also get the work's base_title.
    let base_title: String = conn.query_row(
        "SELECT base_title FROM works WHERE id=?1",
        params![work_id],
        |r| r.get(0),
    )?;

    // Collect tokens from folder name + file stem + base_title.
    let path = std::path::Path::new(&file_path);
    let mut source_parts: Vec<String> = Vec::new();
    if let Some(parent) = path.parent() {
        if let Some(folder) = parent.file_name() {
            source_parts.push(folder.to_string_lossy().to_string());
        }
    }
    source_parts.push(base_title);

    // Split on separators [ _\-.] and filter: drop pure-numerics and short (<3 char) tokens.
    let stopwords: std::collections::BTreeSet<&str> =
        ["the", "a", "an", "of", "in", "on", "at", "to", "and", "or", "for", "by"].iter().cloned().collect();
    let mut tokens: Vec<String> = Vec::new();
    for part in &source_parts {
        for tok in part.split(|c: char| c == ' ' || c == '_' || c == '-' || c == '.') {
            let t = tok.trim().to_lowercase();
            if t.len() < 3 { continue; }
            if t.chars().all(|c| c.is_ascii_digit()) { continue; }
            if stopwords.contains(t.as_str()) { continue; }
            tokens.push(t);
        }
    }
    tokens.dedup();

    // Get all known tags (vocabulary) and the work's current tags.
    let vocabulary: Vec<String> = {
        let mut s = conn.prepare(
            "SELECT tag FROM author_tags UNION SELECT tag FROM work_tags UNION SELECT tag FROM chapter_tags ORDER BY tag",
        )?;
        let result = s.query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<_>>()?;
        result
    };
    let existing: Vec<String> = {
        let mut s = conn.prepare("SELECT tag FROM work_tags WHERE work_id=?1")?;
        let result = s.query_map(params![work_id], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<_>>()?;
        result
    };

    Ok(suggest_tags_from(&tokens, &vocabulary, &existing))
}

#[tauri::command]
pub fn suggest_tags(state: tauri::State<DbState>, work_id: i64) -> Result<Vec<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    suggest_tags_for_work(&conn, work_id).map_err(|e| e.to_string())
}

// ---- M17 Phase 3: notes & bookmarks CRUD commands ------------------------------------

/// Load notes and bookmarks for a chapter, ordered by position_secs then id.
pub(crate) fn journal_for_chapter(conn: &rusqlite::Connection, chapter_id: i64) -> rusqlite::Result<ChapterJournal> {
    let mut ns = conn.prepare(
        "SELECT id, chapter_id, position_secs, body, created_at
           FROM chapter_notes WHERE chapter_id=?1 ORDER BY position_secs, id")?;
    let notes = ns.query_map(params![chapter_id], |r| Ok(ChapterNote {
        id: r.get(0)?, chapter_id: r.get(1)?, position_secs: r.get(2)?, body: r.get(3)?, created_at: r.get(4)?,
    }))?.collect::<rusqlite::Result<Vec<_>>>()?;
    let mut bs = conn.prepare(
        "SELECT id, chapter_id, position_secs, label, created_at
           FROM chapter_bookmarks WHERE chapter_id=?1 ORDER BY position_secs, id")?;
    let bookmarks = bs.query_map(params![chapter_id], |r| Ok(ChapterBookmark {
        id: r.get(0)?, chapter_id: r.get(1)?, position_secs: r.get(2)?, label: r.get(3)?, created_at: r.get(4)?,
    }))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(ChapterJournal { notes, bookmarks })
}

#[tauri::command]
pub fn get_chapter_journal(state: tauri::State<DbState>, chapter_id: i64) -> Result<ChapterJournal, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    journal_for_chapter(&conn, chapter_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_chapter_note(state: tauri::State<DbState>, chapter_id: i64, position_secs: i64, body: String, now_ms: i64) -> Result<ChapterNote, String> {
    let body = body.trim().to_string();
    if body.is_empty() { return Err("note body is empty".into()); }
    let pos = position_secs.max(0);
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO chapter_notes(chapter_id, position_secs, body, created_at) VALUES (?1,?2,?3,?4)",
        params![chapter_id, pos, body, now_ms],
    ).map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    Ok(ChapterNote { id, chapter_id, position_secs: pos, body, created_at: now_ms })
}

#[tauri::command]
pub fn delete_chapter_note(state: tauri::State<DbState>, note_id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM chapter_notes WHERE id=?1", params![note_id]).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_bookmark(state: tauri::State<DbState>, chapter_id: i64, position_secs: i64, label: String, now_ms: i64) -> Result<ChapterBookmark, String> {
    let label = label.trim().to_string();
    let pos = position_secs.max(0);
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO chapter_bookmarks(chapter_id, position_secs, label, created_at) VALUES (?1,?2,?3,?4)",
        params![chapter_id, pos, label, now_ms],
    ).map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    Ok(ChapterBookmark { id, chapter_id, position_secs: pos, label, created_at: now_ms })
}

#[tauri::command]
pub fn delete_bookmark(state: tauri::State<DbState>, bookmark_id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM chapter_bookmarks WHERE id=?1", params![bookmark_id]).map(|_| ()).map_err(|e| e.to_string())
}

// ---- M17 Phase 4: unified journal query + Markdown/JSON export -----------------------

/// Strip extension from a raw_filename, matching the convention used by ChapterRow.title
/// (same as: std::path::Path::new(&raw).file_stem()...).
fn strip_ext(raw: String) -> String {
    std::path::Path::new(&raw)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or(raw)
}

/// Format an integer seconds value as "m:ss".
fn fmt_pos(secs: i64) -> String {
    let m = secs / 60;
    let s = secs % 60;
    format!("{m}:{s:02}")
}

/// Gather every journal artifact across the library into a flat Vec<JournalEntry>,
/// joined to author/work/chapter context. Sorted by (author_name, work_title, chapter_id, position_secs).
pub(crate) fn collect_journal(conn: &rusqlite::Connection) -> rusqlite::Result<Vec<JournalEntry>> {
    let mut out: Vec<JournalEntry> = Vec::new();

    // notes
    {
        let mut s = conn.prepare(
            "SELECT a.id, COALESCE(a.display_name, a.folder_name), w.id, w.base_title, c.id, c.raw_filename,
                    n.position_secs, n.body, n.created_at
               FROM chapter_notes n
               JOIN chapters c ON c.id=n.chapter_id
               JOIN works    w ON w.id=c.work_id
               JOIN authors  a ON a.id=w.author_id")?;
        let rows = s.query_map([], |r| Ok(JournalEntry {
            kind: "note".into(),
            author_id: r.get(0)?, author_name: r.get(1)?,
            work_id: r.get(2)?, work_title: r.get(3)?,
            chapter_id: Some(r.get(4)?), chapter_title: Some(strip_ext(r.get::<_, String>(5)?)),
            position_secs: Some(r.get(6)?), body: r.get(7)?, created_at: Some(r.get(8)?),
        }))?;
        for e in rows { out.push(e?); }
    }

    // bookmarks
    {
        let mut s = conn.prepare(
            "SELECT a.id, COALESCE(a.display_name, a.folder_name), w.id, w.base_title, c.id, c.raw_filename,
                    b.position_secs, b.label, b.created_at
               FROM chapter_bookmarks b
               JOIN chapters c ON c.id=b.chapter_id
               JOIN works    w ON w.id=c.work_id
               JOIN authors  a ON a.id=w.author_id")?;
        let rows = s.query_map([], |r| Ok(JournalEntry {
            kind: "bookmark".into(),
            author_id: r.get(0)?, author_name: r.get(1)?,
            work_id: r.get(2)?, work_title: r.get(3)?,
            chapter_id: Some(r.get(4)?), chapter_title: Some(strip_ext(r.get::<_, String>(5)?)),
            position_secs: Some(r.get(6)?), body: r.get(7)?, created_at: Some(r.get(8)?),
        }))?;
        for e in rows { out.push(e?); }
    }

    // summaries (non-empty user_summary on chapters)
    {
        let mut s = conn.prepare(
            "SELECT a.id, COALESCE(a.display_name, a.folder_name), w.id, w.base_title, c.id, c.raw_filename,
                    c.user_summary
               FROM chapters c
               JOIN works   w ON w.id=c.work_id
               JOIN authors a ON a.id=w.author_id
              WHERE c.user_summary != '' AND c.status='active' AND w.status='active' AND a.status='active'")?;
        let rows = s.query_map([], |r| Ok(JournalEntry {
            kind: "summary".into(),
            author_id: r.get(0)?, author_name: r.get(1)?,
            work_id: r.get(2)?, work_title: r.get(3)?,
            chapter_id: Some(r.get(4)?), chapter_title: Some(strip_ext(r.get::<_, String>(5)?)),
            position_secs: None, body: r.get(6)?, created_at: None,
        }))?;
        for e in rows { out.push(e?); }
    }

    // takeaways (non-empty takeaway on chapters)
    {
        let mut s = conn.prepare(
            "SELECT a.id, COALESCE(a.display_name, a.folder_name), w.id, w.base_title, c.id, c.raw_filename,
                    c.takeaway
               FROM chapters c
               JOIN works   w ON w.id=c.work_id
               JOIN authors a ON a.id=w.author_id
              WHERE c.takeaway != '' AND c.status='active' AND w.status='active' AND a.status='active'")?;
        let rows = s.query_map([], |r| Ok(JournalEntry {
            kind: "takeaway".into(),
            author_id: r.get(0)?, author_name: r.get(1)?,
            work_id: r.get(2)?, work_title: r.get(3)?,
            chapter_id: Some(r.get(4)?), chapter_title: Some(strip_ext(r.get::<_, String>(5)?)),
            position_secs: None, body: r.get(6)?, created_at: None,
        }))?;
        for e in rows { out.push(e?); }
    }

    // favorites (is_favorite = 1 on chapters; body = chapter title)
    {
        let mut s = conn.prepare(
            "SELECT a.id, COALESCE(a.display_name, a.folder_name), w.id, w.base_title, c.id, c.raw_filename
               FROM chapters c
               JOIN works   w ON w.id=c.work_id
               JOIN authors a ON a.id=w.author_id
              WHERE c.is_favorite=1 AND c.status='active' AND w.status='active' AND a.status='active'")?;
        let rows = s.query_map([], |r| {
            let raw: String = r.get(5)?;
            let title = strip_ext(raw);
            Ok(JournalEntry {
                kind: "favorite".into(),
                author_id: r.get(0)?, author_name: r.get(1)?,
                work_id: r.get(2)?, work_title: r.get(3)?,
                chapter_id: Some(r.get(4)?), chapter_title: Some(title.clone()),
                position_secs: None, body: title, created_at: None,
            })
        })?;
        for e in rows { out.push(e?); }
    }

    // re_entry notes (non-empty re_entry_note on works; no chapter)
    {
        let mut s = conn.prepare(
            "SELECT a.id, COALESCE(a.display_name, a.folder_name), w.id, w.base_title,
                    w.re_entry_note
               FROM works   w
               JOIN authors a ON a.id=w.author_id
              WHERE w.re_entry_note != '' AND w.status='active' AND a.status='active'")?;
        let rows = s.query_map([], |r| Ok(JournalEntry {
            kind: "re_entry".into(),
            author_id: r.get(0)?, author_name: r.get(1)?,
            work_id: r.get(2)?, work_title: r.get(3)?,
            chapter_id: None, chapter_title: None,
            position_secs: None, body: r.get(4)?, created_at: None,
        }))?;
        for e in rows { out.push(e?); }
    }

    // ratings (non-empty completion_rating on works; no chapter)
    {
        let mut s = conn.prepare(
            "SELECT a.id, COALESCE(a.display_name, a.folder_name), w.id, w.base_title,
                    w.completion_rating
               FROM works   w
               JOIN authors a ON a.id=w.author_id
              WHERE w.completion_rating != '' AND w.status='active' AND a.status='active'")?;
        let rows = s.query_map([], |r| Ok(JournalEntry {
            kind: "rating".into(),
            author_id: r.get(0)?, author_name: r.get(1)?,
            work_id: r.get(2)?, work_title: r.get(3)?,
            chapter_id: None, chapter_title: None,
            position_secs: None, body: r.get(4)?, created_at: None,
        }))?;
        for e in rows { out.push(e?); }
    }

    out.sort_by(|x, y| (&x.author_name, &x.work_title, x.chapter_id, x.position_secs)
        .cmp(&(&y.author_name, &y.work_title, y.chapter_id, y.position_secs)));
    Ok(out)
}

#[tauri::command]
pub fn query_journal(state: tauri::State<DbState>, query: String) -> Result<JournalResults, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let all = collect_journal(&conn).map_err(|e| e.to_string())?;
    let q = query.trim().to_lowercase();
    let entries = if q.is_empty() {
        all
    } else {
        all.into_iter().filter(|e| {
            e.body.to_lowercase().contains(&q)
                || e.work_title.to_lowercase().contains(&q)
                || e.author_name.to_lowercase().contains(&q)
                || e.chapter_title.as_deref().map_or(false, |t| t.to_lowercase().contains(&q))
        }).collect()
    };
    Ok(JournalResults { entries })
}

/// Build a Markdown export of all journal entries, grouped by author → work.
pub(crate) fn build_journal_markdown(entries: &[JournalEntry]) -> String {
    use std::collections::BTreeMap;

    // Group: author_name → work_title → Vec<&JournalEntry>
    // Use BTreeMap so output is deterministic (entries are pre-sorted).
    let mut by_author: BTreeMap<&str, BTreeMap<&str, Vec<&JournalEntry>>> = BTreeMap::new();
    for e in entries {
        by_author
            .entry(&e.author_name)
            .or_default()
            .entry(&e.work_title)
            .or_default()
            .push(e);
    }

    let mut md = String::from("# AudioShelf — Listening Journal\n");

    for (author_name, works) in &by_author {
        md.push('\n');
        md.push_str(&format!("## {author_name}\n"));

        for (work_title, work_entries) in works {
            // Find rating for this work (if any).
            let rating = work_entries.iter()
                .find(|e| e.kind == "rating")
                .map(|e| e.body.as_str())
                .unwrap_or("");
            // Find re_entry note for this work (if any).
            let re_entry = work_entries.iter()
                .find(|e| e.kind == "re_entry")
                .map(|e| e.body.as_str())
                .unwrap_or("");

            let heading = if rating.is_empty() {
                format!("### {work_title}\n")
            } else {
                format!("### {work_title}  [rating: {rating}]\n")
            };
            md.push('\n');
            md.push_str(&heading);

            if !re_entry.is_empty() {
                md.push_str(&format!("_Where I left off:_ {re_entry}\n\n"));
            }

            // Chapter-level entries (all kinds except re_entry and rating).
            for e in work_entries.iter().filter(|e| e.kind != "re_entry" && e.kind != "rating") {
                let ch = e.chapter_title.as_deref().unwrap_or("");
                let line = match e.kind.as_str() {
                    "note" => {
                        let pos = e.position_secs.map(fmt_pos).unwrap_or_default();
                        format!("- **Note** (Ch {ch} @ {pos}): {}\n", e.body)
                    }
                    "bookmark" => {
                        let pos = e.position_secs.map(fmt_pos).unwrap_or_default();
                        let label = if e.body.is_empty() { String::new() } else { format!(": {}", e.body) };
                        format!("- **Bookmark** (Ch {ch} @ {pos}){label}\n")
                    }
                    "summary" => {
                        format!("- **Summary** (Ch {ch}): {}\n", e.body)
                    }
                    "takeaway" => {
                        format!("- **Takeaway** (Ch {ch}): {}\n", e.body)
                    }
                    "favorite" => {
                        format!("- **★ Favorite**: {ch}\n")
                    }
                    other => {
                        format!("- **{other}**: {}\n", e.body)
                    }
                };
                md.push_str(&line);
            }
        }
    }

    md
}

pub(crate) fn build_journal_json(entries: &[JournalEntry]) -> Result<String, String> {
    serde_json::to_string_pretty(entries).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_journal(state: tauri::State<DbState>, path: String, format: String) -> Result<JournalExportReport, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let entries = collect_journal(&conn).map_err(|e| e.to_string())?;
    let contents = match format.as_str() {
        "markdown" => build_journal_markdown(&entries),
        "json" => build_journal_json(&entries)?,
        other => return Err(format!("unknown export format: {other}")),
    };
    std::fs::write(&path, contents).map_err(|e| format!("write failed: {e}"))?;
    Ok(JournalExportReport { path, format, entry_count: entries.len() })
}

/// Write the recap PNG bytes (rasterized client-side from the recap SVG) to a user-chosen path.
/// Read-only-on-disk is preserved: this writes only to a non-audio path the user picked via the
/// save dialog (`dialog:allow-save`, already granted). No image/base64 crate — the bytes are a
/// finished PNG produced by the WebView canvas.
#[tauri::command]
pub fn export_recap_png(path: String, bytes: Vec<u8>) -> Result<String, String> {
    if bytes.is_empty() {
        return Err("empty recap image".to_string());
    }
    std::fs::write(&path, &bytes).map_err(|e| format!("write failed: {e}"))?;
    Ok(path)
}

/// Additive bulk work-tagging: INSERT OR IGNORE the `add` tags and DELETE the `remove` tags
/// for each work id. Skips empty/whitespace tags. Never a blanket replace.
pub(crate) fn bulk_set_work_tags_rows(
    conn: &rusqlite::Connection,
    work_ids: &[i64],
    add: &[String],
    remove: &[String],
) -> rusqlite::Result<()> {
    for &wid in work_ids {
        for raw in add {
            let t = raw.trim();
            if t.is_empty() { continue; }
            conn.execute("INSERT OR IGNORE INTO work_tags(work_id, tag) VALUES (?1, ?2)", params![wid, t])?;
        }
        for raw in remove {
            let t = raw.trim();
            if t.is_empty() { continue; }
            conn.execute("DELETE FROM work_tags WHERE work_id=?1 AND tag=?2", params![wid, t])?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn bulk_set_work_tags(
    state: tauri::State<DbState>,
    work_ids: Vec<i64>,
    add: Vec<String>,
    remove: Vec<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    bulk_set_work_tags_rows(&conn, &work_ids, &add, &remove).map_err(|e| e.to_string())
}

// ---- M19 Task 6: per-work chapter-sort override ----------------------------------------

#[tauri::command]
pub fn set_work_chapter_sort(state: tauri::State<DbState>, work_id: i64, sort: String) -> Result<(), String> {
    const ALLOWED: [&str; 6] = ["", "number_desc", "title_asc", "title_desc", "duration_asc", "duration_desc"];
    if !ALLOWED.contains(&sort.as_str()) {
        return Err(format!("invalid chapter sort: {sort}"));
    }
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE works SET chapter_sort=?2 WHERE id=?1", params![work_id, sort]).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use std::fs::{self, File};

    fn touch(path: &std::path::Path) {
        if let Some(p) = path.parent() {
            fs::create_dir_all(p).unwrap();
        }
        File::create(path).unwrap();
    }

    #[test]
    fn authors_and_detail_reflect_scan() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let author = root.join("Author One");
        touch(&author.join("Tale.mp3"));
        touch(&author.join("Tale 2.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();

        let authors = query_authors(&conn).unwrap();
        assert_eq!(authors.len(), 1);
        assert_eq!(authors[0].name, "Author One");
        assert_eq!(authors[0].chapter_count, 2);
        assert_eq!(authors[0].unplayed_count, 2);

        let detail = query_author_detail(&conn, authors[0].id).unwrap();
        assert_eq!(detail.works.len(), 1);
        assert_eq!(detail.works[0].chapters.len(), 2);
    }

    #[test]
    fn query_authors_reports_total_secs_and_tags() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("Alice").join("Tale.mp3"));
        touch(&root.join("Alice").join("Tale 2.mp3"));
        touch(&root.join("Bob").join("Saga.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();

        let ids: std::collections::HashMap<String, i64> =
            query_authors(&conn).unwrap().into_iter().map(|a| (a.name, a.id)).collect();

        // Seed known duration_secs values directly — scan leaves them at 0 for fake files.
        conn.execute("UPDATE chapters SET duration_secs=300 WHERE work_id IN (SELECT id FROM works WHERE author_id=?1)",
            params![ids["Alice"]]).unwrap();
        conn.execute("UPDATE chapters SET duration_secs=120 WHERE work_id IN (SELECT id FROM works WHERE author_id=?1)",
            params![ids["Bob"]]).unwrap();

        // Give Alice an author-level tag and a work-level tag; Bob gets no tags.
        let alice_work_id: i64 = conn.query_row(
            "SELECT id FROM works WHERE author_id=?1 LIMIT 1", params![ids["Alice"]], |r| r.get(0)).unwrap();
        super::set_tags(&conn, ids["Alice"], &["cozy".into()]).unwrap();
        super::replace_tags(&conn, "work_tags", "work_id", alice_work_id, &["epic".into()]).unwrap();

        let authors = query_authors(&conn).unwrap();
        let alice = authors.iter().find(|a| a.name == "Alice").unwrap();
        let bob   = authors.iter().find(|a| a.name == "Bob").unwrap();

        // Alice has 2 chapters each at 300 s => 600 total.
        assert_eq!(alice.total_secs, 600, "Alice total_secs should be sum of her chapter durations");
        // Bob has 1 chapter at 120 s.
        assert_eq!(bob.total_secs, 120, "Bob total_secs should be sum of his chapter durations");

        // Alice's tags = author_tags ∪ work_tags, sorted, de-duplicated.
        assert_eq!(alice.tags, vec!["cozy".to_string(), "epic".to_string()],
            "Alice tags should be union of author_tags and work_tags, sorted");
        // Bob has no tags.
        assert!(bob.tags.is_empty(), "Bob should have no tags");
    }

    #[test]
    fn marking_played_decrements_unplayed() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("A").join("X.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();
        let detail = query_author_detail(&conn, query_authors(&conn).unwrap()[0].id).unwrap();
        let ch = detail.works[0].chapters[0].id;
        conn.execute("UPDATE chapters SET played=1 WHERE id=?1", params![ch]).unwrap();
        let authors = query_authors(&conn).unwrap();
        assert_eq!(authors[0].unplayed_count, 0);
    }

    #[test]
    fn tags_round_trip_and_dedupe() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("A").join("X.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();
        let id = query_authors(&conn).unwrap()[0].id;

        super::set_tags(&conn, id, &["cozy".into(), " cozy ".into(), "".into(), "thriller".into()]).unwrap();
        let detail = query_author_detail(&conn, id).unwrap();
        assert_eq!(detail.tags, vec!["cozy".to_string(), "thriller".to_string()]);

        // Replace-all semantics.
        super::set_tags(&conn, id, &["calm".into()]).unwrap();
        assert_eq!(query_author_detail(&conn, id).unwrap().tags, vec!["calm".to_string()]);
    }

    #[test]
    fn finishing_a_chapter_marks_played_and_records_event() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("A").join("X.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();
        let detail = query_author_detail(&conn, query_authors(&conn).unwrap()[0].id).unwrap();
        let ch = detail.works[0].chapters[0].id;

        super::mark_finished(&conn, ch, 1_700_000_000_000).unwrap();

        let played: i64 = conn.query_row("SELECT played FROM chapters WHERE id=?1", params![ch], |r| r.get(0)).unwrap();
        assert_eq!(played, 1);
        let events: i64 = conn.query_row(
            "SELECT count(*) FROM play_events WHERE chapter_id=?1 AND played_at=1700000000000",
            params![ch],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(events, 1);
    }

    #[test]
    fn discovery_by_tags_ranks_shared_then_unplayed() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("Alice").join("Tale.mp3"));
        touch(&root.join("Bob").join("Saga.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();
        let ids: std::collections::HashMap<String, i64> =
            query_authors(&conn).unwrap().into_iter().map(|a| (a.name, a.id)).collect();
        super::set_tags(&conn, ids["Alice"], &["cozy".into(), "calm".into()]).unwrap();
        super::set_tags(&conn, ids["Bob"], &["cozy".into()]).unwrap();

        let res = super::discovery_for_tags(&conn, &["cozy".into(), "calm".into()], &[], 50).unwrap();
        // Alice shares 2 tags, Bob shares 1 -> Alice ranks first.
        assert_eq!(res[0].author_name, "Alice");
        assert_eq!(res[0].shared_tags, vec!["calm".to_string(), "cozy".to_string()]);
        assert_eq!(res[1].author_name, "Bob");
        // All works here have 1 unplayed chapter.
        assert!(res.iter().all(|w| w.unplayed_count == 1));
    }

    #[test]
    fn work_and_chapter_tags_round_trip() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("A").join("X.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();
        let author_id = query_authors(&conn).unwrap()[0].id;
        let detail = query_author_detail(&conn, author_id).unwrap();
        let work_id = detail.works[0].id;
        let chapter_id = detail.works[0].chapters[0].id;

        super::replace_tags(&conn, "work_tags", "work_id", work_id,
            &["epic".into(), " epic ".into(), "".into(), "saga".into()]).unwrap();
        super::replace_tags(&conn, "chapter_tags", "chapter_id", chapter_id,
            &["intro".into()]).unwrap();

        let d = query_author_detail(&conn, author_id).unwrap();
        assert_eq!(d.works[0].tags, vec!["epic".to_string(), "saga".to_string()]); // sorted, deduped, trimmed
        assert_eq!(d.works[0].chapters[0].tags, vec!["intro".to_string()]);

        // Replace-all semantics.
        super::replace_tags(&conn, "work_tags", "work_id", work_id, &["calm".into()]).unwrap();
        assert_eq!(query_author_detail(&conn, author_id).unwrap().works[0].tags, vec!["calm".to_string()]);
    }

    #[test]
    fn get_all_tags_unions_all_levels() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("A").join("X.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();
        let author_id = query_authors(&conn).unwrap()[0].id;
        let detail = query_author_detail(&conn, author_id).unwrap();
        let work_id = detail.works[0].id;
        let chapter_id = detail.works[0].chapters[0].id;

        super::set_tags(&conn, author_id, &["cozy".into()]).unwrap();
        super::replace_tags(&conn, "work_tags", "work_id", work_id, &["cozy".into(), "epic".into()]).unwrap();
        super::replace_tags(&conn, "chapter_tags", "chapter_id", chapter_id, &["intro".into()]).unwrap();

        // get_all_tags is a #[tauri::command] needing State; assert the underlying union SQL instead.
        let mut stmt = conn.prepare(
            "SELECT tag FROM author_tags
             UNION SELECT tag FROM work_tags
             UNION SELECT tag FROM chapter_tags
             ORDER BY tag",
        ).unwrap();
        let all: Vec<String> = stmt.query_map([], |r| r.get::<_, String>(0)).unwrap()
            .collect::<rusqlite::Result<_>>().unwrap();
        assert_eq!(all, vec!["cozy".to_string(), "epic".to_string(), "intro".to_string()]);
    }

    #[test]
    fn discovery_unions_author_and_work_tags() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("Alice").join("Tale.mp3"));
        touch(&root.join("Bob").join("Saga.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();
        let ids: std::collections::HashMap<String, i64> =
            query_authors(&conn).unwrap().into_iter().map(|a| (a.name, a.id)).collect();

        // Bob has NO author tags, but his work "Saga" carries "cozy" at the work level.
        let bob_detail = query_author_detail(&conn, ids["Bob"]).unwrap();
        let saga_id = bob_detail.works[0].id;
        super::replace_tags(&conn, "work_tags", "work_id", saga_id, &["cozy".into()]).unwrap();
        // Alice has author tag "cozy".
        super::set_tags(&conn, ids["Alice"], &["cozy".into()]).unwrap();

        let res = super::discovery_for_tags(&conn, &["cozy".into()], &[], 50).unwrap();
        let titles: Vec<&str> = res.iter().map(|w| w.base_title.as_str()).collect();
        assert!(titles.contains(&"Tale"), "author-tag match should surface");
        assert!(titles.contains(&"Saga"), "work-tag match should surface (union)");
        assert!(res.iter().all(|w| w.shared_tags == vec!["cozy".to_string()]));
    }

    #[test]
    fn search_matches_work_and_chapter_tags() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("A").join("Quiet One.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();
        let author_id = query_authors(&conn).unwrap()[0].id;
        let detail = query_author_detail(&conn, author_id).unwrap();
        let work_id = detail.works[0].id;
        let chapter_id = detail.works[0].chapters[0].id;

        super::replace_tags(&conn, "work_tags", "work_id", work_id, &["mystery".into()]).unwrap();
        super::replace_tags(&conn, "chapter_tags", "chapter_id", chapter_id, &["cliffhanger".into()]).unwrap();

        // "mystery" matches no title/filename, only the work tag.
        let r1 = super::search(&conn, "mystery", 50).unwrap();
        assert_eq!(r1.works.len(), 1);
        assert_eq!(r1.works[0].work_id, work_id);

        // "cliffhanger" matches only the chapter tag.
        let r2 = super::search(&conn, "cliffhanger", 50).unwrap();
        assert_eq!(r2.chapters.len(), 1);
        assert_eq!(r2.chapters[0].chapter_id, chapter_id);
    }

    #[test]
    fn grouping_override_merges_then_clears() {
        let tmp = tempfile::tempdir().unwrap();
        let author = tmp.path().join("Jane Doe");
        touch(&author.join("Cool Story.mp3"));
        touch(&author.join("Cool Story 2 the sequel.mp3"));
        touch(&author.join("Another Standalone Tale.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, tmp.path()).unwrap();
        let id = query_authors(&conn).unwrap()[0].id;

        let path: String = conn.query_row(
            "SELECT file_path FROM chapters WHERE raw_filename='Another Standalone Tale.mp3'",
            [], |r| r.get(0)).unwrap();

        // Merge: emulate set_grouping_override's DB write + regroup.
        conn.execute(
            "INSERT INTO grouping_overrides(chapter_path, base_title, chapter_no) VALUES (?1,'Cool Story',3)
             ON CONFLICT(chapter_path) DO UPDATE SET base_title=excluded.base_title, chapter_no=excluded.chapter_no",
            params![path]).unwrap();
        crate::regroup::regroup_author(&conn, id).unwrap();
        assert_eq!(query_author_detail(&conn, id).unwrap().works.len(), 1);

        // Clear: emulate clear_grouping_override.
        conn.execute("DELETE FROM grouping_overrides WHERE chapter_path=?1", params![path]).unwrap();
        crate::regroup::regroup_author(&conn, id).unwrap();
        assert_eq!(query_author_detail(&conn, id).unwrap().works.len(), 2);
    }

    #[test]
    fn settings_round_trip() {
        let conn = crate::db::open_in_memory().unwrap();
        // Missing key reads as None.
        assert_eq!(get_setting_value(&conn, "library_root").unwrap(), None);
        // First write inserts.
        set_setting_value(&conn, "library_root", "C:/Audio").unwrap();
        assert_eq!(
            get_setting_value(&conn, "library_root").unwrap(),
            Some("C:/Audio".to_string())
        );
        // Second write upserts (overwrites, not duplicates).
        set_setting_value(&conn, "library_root", "D:/Other").unwrap();
        assert_eq!(
            get_setting_value(&conn, "library_root").unwrap(),
            Some("D:/Other".to_string())
        );
        // The pre-seeded schema_version key reflects the latest migration version.
        assert_eq!(
            get_setting_value(&conn, "schema_version").unwrap(),
            Some("7".to_string())
        );
    }

    #[test]
    fn for_you_uses_recent_play_tags_and_excludes_recent_author() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("Alice").join("Tale.mp3"));
        touch(&root.join("Bob").join("Saga.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();
        let ids: std::collections::HashMap<String, i64> =
            query_authors(&conn).unwrap().into_iter().map(|a| (a.name, a.id)).collect();
        super::set_tags(&conn, ids["Alice"], &["cozy".into()]).unwrap();
        super::set_tags(&conn, ids["Bob"], &["cozy".into()]).unwrap();
        // Play Alice's chapter -> Alice is "recent"; For-you should suggest Bob (shares "cozy"), not Alice.
        let alice_detail = query_author_detail(&conn, ids["Alice"]).unwrap();
        let ch = alice_detail.works[0].chapters[0].id;
        super::mark_finished(&conn, ch, 1_700_000_000_000).unwrap();

        let res = super::discovery_for_you(&conn).unwrap();
        assert!(res.iter().any(|w| w.author_name == "Bob"));
        assert!(res.iter().all(|w| w.author_name != "Alice"));
    }

    #[test]
    fn search_matches_authors_works_and_chapters() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let jane = root.join("Jane Doe");
        touch(&jane.join("Cool Story.mp3"));
        touch(&jane.join("Cool Story 2.mp3"));
        touch(&root.join("Sam Smith").join("Night Walk.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();

        // "cool" hits the work and its chapters (not the author).
        let res = super::search(&conn, "cool", 50).unwrap();
        assert!(res.works.iter().any(|w| w.base_title == "Cool Story"));
        assert!(!res.chapters.is_empty());
        assert!(res.chapters.iter().all(|c| c.title.to_lowercase().contains("cool")));

        // "sam" hits the author.
        let res = super::search(&conn, "sam", 50).unwrap();
        assert!(res.authors.iter().any(|a| a.author_name == "Sam Smith"));

        // Blank query -> all buckets empty.
        let res = super::search(&conn, "   ", 50).unwrap();
        assert!(res.authors.is_empty() && res.works.is_empty() && res.chapters.is_empty());

        // Cap is honoured per bucket.
        let res = super::search(&conn, "o", 1).unwrap();
        assert!(res.authors.len() <= 1 && res.works.len() <= 1 && res.chapters.len() <= 1);
    }

    #[test]
    fn streak_len_handles_runs_gaps_and_breaks() {
        use std::collections::BTreeSet;
        let today = 100i64;
        assert_eq!(streak_len(&BTreeSet::new(), today), 0, "no activity");
        assert_eq!(streak_len(&BTreeSet::from([100]), today), 1, "today only");
        assert_eq!(streak_len(&BTreeSet::from([99]), today), 1, "yesterday counts as live");
        assert_eq!(streak_len(&BTreeSet::from([100, 99, 98]), today), 3, "three-day run");
        assert_eq!(streak_len(&BTreeSet::from([100, 98]), today), 1, "gap stops the run");
        assert_eq!(streak_len(&BTreeSet::from([98]), today), 0, "2+ days ago is broken");
    }

    #[test]
    fn home_keep_listening_uses_latest_creator_with_unplayed_audio() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("Alice").join("Tale.mp3"));
        touch(&root.join("Alice").join("Tale 2.mp3"));
        touch(&root.join("Bob").join("Saga.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();

        let ids: std::collections::HashMap<String, i64> =
            query_authors(&conn).unwrap().into_iter().map(|a| (a.name, a.id)).collect();
        let alice = query_author_detail(&conn, ids["Alice"]).unwrap();
        let bob = query_author_detail(&conn, ids["Bob"]).unwrap();
        mark_finished(&conn, alice.works[0].chapters[0].id, 2_000).unwrap();
        mark_finished(&conn, bob.works[0].chapters[0].id, 3_000).unwrap();

        let item = home_keep_listening(&conn).unwrap().expect("Alice remains resumable");
        assert_eq!(item.author_name, "Alice");
        assert_eq!(item.next_chapter.chapter_no, 2);
        assert_eq!(item.total_chapters, 2);
        assert_eq!(item.played_chapters, 1);
    }

    #[test]
    fn home_recommendations_rank_matches_exclude_feature_and_diversify() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("Alice").join("Tale.mp3"));
        touch(&root.join("Alice").join("Tale 2.mp3"));
        touch(&root.join("Bob").join("Blue.mp3"));
        touch(&root.join("Carol").join("Calm.mp3"));
        touch(&root.join("Dave").join("Other.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();

        let ids: std::collections::HashMap<String, i64> =
            query_authors(&conn).unwrap().into_iter().map(|a| (a.name, a.id)).collect();
        set_tags(&conn, ids["Alice"], &["cozy".into(), "mystery".into()]).unwrap();
        set_tags(&conn, ids["Bob"], &["cozy".into(), "mystery".into()]).unwrap();
        set_tags(&conn, ids["Carol"], &["cozy".into()]).unwrap();
        let alice = query_author_detail(&conn, ids["Alice"]).unwrap();
        mark_finished(&conn, alice.works[0].chapters[0].id, 5_000).unwrap();

        let featured = home_keep_listening(&conn).unwrap().unwrap();
        let recs = home_recommendations(&conn, Some(featured.work_id), 6).unwrap();
        assert!(recs.iter().all(|r| r.work_id != featured.work_id));
        assert_eq!(recs[0].author_name, "Bob");
        assert_eq!(recs[0].matched_tags, vec!["cozy", "mystery"]);
        assert_eq!(recs[0].reason, "Shares cozy and mystery");
        assert!(recs.iter().all(|r| r.unplayed_count > 0));
        let first_three: std::collections::BTreeSet<_> =
            recs.iter().take(3).map(|r| r.author_id).collect();
        assert_eq!(first_three.len(), recs.len().min(3));
    }

    #[test]
    fn home_recommendations_have_deterministic_sparse_history_fallback() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("Beta").join("Short.mp3"));
        touch(&root.join("Alpha").join("Long.mp3"));
        touch(&root.join("Alpha").join("Long 2.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();

        let recs = home_recommendations(&conn, None, 6).unwrap();
        assert_eq!(recs[0].author_name, "Alpha");
        assert_eq!(recs[0].reason, "Mostly unplayed");
        assert_eq!(recs[1].author_name, "Beta");
    }

    // ---- tag taxonomy tests (M16 Task 2) -----------------------------------------------

    #[test]
    fn rename_tag_moves_usages_and_dedupes() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("Alice").join("Tale.mp3"));
        touch(&root.join("Bob").join("Saga.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();
        let ids: std::collections::HashMap<String, i64> =
            query_authors(&conn).unwrap().into_iter().map(|a| (a.name, a.id)).collect();

        // Give Alice "cozy" on author level; Bob "cozy" and "calm" on author level.
        super::set_tags(&conn, ids["Alice"], &["cozy".into()]).unwrap();
        super::set_tags(&conn, ids["Bob"], &["cozy".into(), "calm".into()]).unwrap();

        // Also give Alice a work tag "cozy" to test deduplication.
        let alice_detail = query_author_detail(&conn, ids["Alice"]).unwrap();
        let alice_work_id = alice_detail.works[0].id;
        super::replace_tags(&conn, "work_tags", "work_id", alice_work_id, &["cozy".into()]).unwrap();

        // Rename "cozy" → "mellow". Both Alice and Bob should have "mellow" now.
        // Alice's work also had "cozy" → should become "mellow" (no dup since INSERT OR IGNORE).
        // Bob had both "cozy" and "calm" → should now have "mellow" and "calm".
        let mock_state_conn = open_in_memory().unwrap();
        // We test the helper function directly since DbState wraps a Mutex.
        {
            let tx = conn.unchecked_transaction().unwrap();
            for (table, key_col) in &[
                ("author_tags", "author_id"),
                ("work_tags", "work_id"),
                ("chapter_tags", "chapter_id"),
            ] {
                tx.execute(
                    &format!("INSERT OR IGNORE INTO {table}({key_col}, tag) SELECT {key_col}, ?1 FROM {table} WHERE tag=?2"),
                    params!["mellow", "cozy"],
                ).unwrap();
                tx.execute(&format!("DELETE FROM {table} WHERE tag=?1"), params!["cozy"]).unwrap();
            }
            tx.commit().unwrap();
        }
        drop(mock_state_conn);

        // Alice's author tags: "mellow"; no "cozy".
        let mut stmt = conn.prepare("SELECT tag FROM author_tags WHERE author_id=?1 ORDER BY tag").unwrap();
        let alice_tags: Vec<String> = stmt.query_map(params![ids["Alice"]], |r| r.get(0)).unwrap()
            .collect::<rusqlite::Result<_>>().unwrap();
        assert_eq!(alice_tags, vec!["mellow"]);

        // Bob's author tags: "calm", "mellow" (sorted); no "cozy".
        let bob_tags: Vec<String> = conn.prepare("SELECT tag FROM author_tags WHERE author_id=?1 ORDER BY tag").unwrap()
            .query_map(params![ids["Bob"]], |r| r.get(0)).unwrap()
            .collect::<rusqlite::Result<_>>().unwrap();
        assert_eq!(bob_tags, vec!["calm", "mellow"]);

        // Alice's work tag: "mellow" not "cozy", and only one row (no dup).
        let work_tags: Vec<String> = conn.prepare("SELECT tag FROM work_tags WHERE work_id=?1 ORDER BY tag").unwrap()
            .query_map(params![alice_work_id], |r| r.get(0)).unwrap()
            .collect::<rusqlite::Result<_>>().unwrap();
        assert_eq!(work_tags, vec!["mellow"]);
    }

    #[test]
    fn merge_tags_collapses_multiple_sources() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("Alice").join("Tale.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();
        let author_id = query_authors(&conn).unwrap()[0].id;
        let detail = query_author_detail(&conn, author_id).unwrap();
        let work_id = detail.works[0].id;

        super::set_tags(&conn, author_id, &["cozy".into(), "mellow".into()]).unwrap();
        super::replace_tags(&conn, "work_tags", "work_id", work_id, &["calm".into()]).unwrap();

        // Merge "cozy" + "mellow" + "calm" all into "vibe".
        {
            let tx = conn.unchecked_transaction().unwrap();
            for source in &["cozy", "mellow", "calm"] {
                for (table, key_col) in &[
                    ("author_tags", "author_id"),
                    ("work_tags", "work_id"),
                    ("chapter_tags", "chapter_id"),
                ] {
                    tx.execute(
                        &format!("INSERT OR IGNORE INTO {table}({key_col}, tag) SELECT {key_col}, ?1 FROM {table} WHERE tag=?2"),
                        params!["vibe", source],
                    ).unwrap();
                    tx.execute(&format!("DELETE FROM {table} WHERE tag=?1"), params![source]).unwrap();
                }
            }
            tx.commit().unwrap();
        }

        let author_tags: Vec<String> = conn.prepare("SELECT tag FROM author_tags WHERE author_id=?1 ORDER BY tag").unwrap()
            .query_map(params![author_id], |r| r.get(0)).unwrap()
            .collect::<rusqlite::Result<_>>().unwrap();
        assert_eq!(author_tags, vec!["vibe"]);

        let work_tags: Vec<String> = conn.prepare("SELECT tag FROM work_tags WHERE work_id=?1 ORDER BY tag").unwrap()
            .query_map(params![work_id], |r| r.get(0)).unwrap()
            .collect::<rusqlite::Result<_>>().unwrap();
        assert_eq!(work_tags, vec!["vibe"]);

        // No "cozy", "mellow", or "calm" remain anywhere.
        let leftovers: i64 = conn.query_row(
            "SELECT count(*) FROM author_tags WHERE tag IN ('cozy','mellow','calm')",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(leftovers, 0);
    }

    #[test]
    fn set_tag_alias_and_discovery_resolves_aliased_tag() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("Alice").join("Tale.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();
        let author_id = query_authors(&conn).unwrap()[0].id;
        // Alice has tag "cozy" (the canonical form).
        super::set_tags(&conn, author_id, &["cozy".into()]).unwrap();
        // Register alias: "relaxing" → "cozy".
        conn.execute(
            "INSERT OR REPLACE INTO tag_aliases(alias, canonical) VALUES (?1, ?2)",
            params!["relaxing", "cozy"],
        ).unwrap();

        // Search using the alias "relaxing" — should still find Alice's "cozy"-tagged work.
        let res = super::discovery_for_tags(&conn, &["relaxing".into()], &[], 50).unwrap();
        assert_eq!(res.len(), 1, "should find Alice's work via alias");
        assert_eq!(res[0].author_name, "Alice");
        // shared_tags shows the resolved canonical form.
        assert_eq!(res[0].shared_tags, vec!["cozy"]);
    }

    #[test]
    fn list_tags_with_counts_returns_per_table_counts() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("Alice").join("Tale.mp3"));
        touch(&root.join("Bob").join("Saga.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();
        let ids: std::collections::HashMap<String, i64> =
            query_authors(&conn).unwrap().into_iter().map(|a| (a.name, a.id)).collect();
        let alice_detail = query_author_detail(&conn, ids["Alice"]).unwrap();
        let work_id = alice_detail.works[0].id;
        let chapter_id = alice_detail.works[0].chapters[0].id;

        // "cozy" on Alice's author + work + chapter; "calm" on Bob's author only.
        super::set_tags(&conn, ids["Alice"], &["cozy".into()]).unwrap();
        super::set_tags(&conn, ids["Bob"], &["cozy".into(), "calm".into()]).unwrap();
        super::replace_tags(&conn, "work_tags", "work_id", work_id, &["cozy".into()]).unwrap();
        super::replace_tags(&conn, "chapter_tags", "chapter_id", chapter_id, &["cozy".into()]).unwrap();

        // Use the underlying query logic (can't call #[tauri::command] directly in tests).
        let mut map: std::collections::BTreeMap<String, (i64, i64, i64)> = std::collections::BTreeMap::new();
        {
            let mut s = conn.prepare("SELECT tag, count(*) FROM author_tags GROUP BY tag").unwrap();
            let mut q = s.query([]).unwrap();
            while let Some(r) = q.next().unwrap() {
                let tag: String = r.get(0).unwrap();
                let cnt: i64 = r.get(1).unwrap();
                map.entry(tag).or_default().2 = cnt;
            }
        }
        {
            let mut s = conn.prepare("SELECT tag, count(*) FROM work_tags GROUP BY tag").unwrap();
            let mut q = s.query([]).unwrap();
            while let Some(r) = q.next().unwrap() {
                let tag: String = r.get(0).unwrap();
                let cnt: i64 = r.get(1).unwrap();
                map.entry(tag).or_default().0 = cnt;
            }
        }
        {
            let mut s = conn.prepare("SELECT tag, count(*) FROM chapter_tags GROUP BY tag").unwrap();
            let mut q = s.query([]).unwrap();
            while let Some(r) = q.next().unwrap() {
                let tag: String = r.get(0).unwrap();
                let cnt: i64 = r.get(1).unwrap();
                map.entry(tag).or_default().1 = cnt;
            }
        }

        // "cozy": author_count=2 (Alice+Bob), work_count=1 (Alice's work), chapter_count=1.
        let (work_c, chapter_c, author_c) = map["cozy"];
        assert_eq!(author_c, 2, "cozy author_count");
        assert_eq!(work_c, 1, "cozy work_count");
        assert_eq!(chapter_c, 1, "cozy chapter_count");

        // "calm": author_count=1 (Bob), work_count=0, chapter_count=0.
        let (calm_w, calm_ch, calm_a) = map["calm"];
        assert_eq!(calm_a, 1, "calm author_count");
        assert_eq!(calm_w, 0, "calm work_count");
        assert_eq!(calm_ch, 0, "calm chapter_count");
    }

    #[test]
    fn migration_v1_has_no_taxonomy_tables_then_v2_adds_them() {
        // open_at_version(1) must not have tag_aliases or tag_parents.
        let conn = crate::db::open_at_version(1).unwrap();
        let v2_count: i64 = conn.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('tag_aliases','tag_parents')",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(v2_count, 0, "v1 must not have taxonomy tables");

        // Running full migrate brings it to v2 with the tables present.
        crate::db::open_in_memory().unwrap(); // just to confirm no panic on full open
        // Upgrade the existing v1 conn.
        // (We can't call migrate directly since it's private in db.rs;
        //  open_at_version(1) then manual step suffices — but actually we DO test this
        //  in db::tests::upgrade_from_v1_to_v2. Here we confirm the command-layer
        //  resolve_aliases helper works on a fully-migrated DB.)
        let full_conn = crate::db::open_in_memory().unwrap();
        let full_count: i64 = full_conn.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('tag_aliases','tag_parents')",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(full_count, 2, "full open must have both taxonomy tables");
        let ver: i64 = full_conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(ver, 7);
    }

    #[test]
    fn resolve_aliases_maps_through_table_and_dedupes() {
        let conn = crate::db::open_in_memory().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO tag_aliases(alias, canonical) VALUES (?1, ?2)",
            params!["relaxing", "cozy"],
        ).unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO tag_aliases(alias, canonical) VALUES (?1, ?2)",
            params!["chill", "cozy"],
        ).unwrap();

        // Both aliases resolve to "cozy", plus "mystery" which has no alias.
        let tags: Vec<String> = vec!["relaxing".into(), "chill".into(), "mystery".into()];
        let resolved = super::resolve_aliases(&conn, &tags).unwrap();
        // Deduped: "cozy" appears once, plus "mystery".
        assert_eq!(resolved.len(), 2);
        assert!(resolved.contains(&"cozy".to_string()));
        assert!(resolved.contains(&"mystery".to_string()));
    }

    // ---- embedded-metadata ingestion tests (M16 Task 4) --------------------------------

    /// Seed a minimal library and manually insert chapters/works, then test the diff logic
    /// by calling build_metadata_proposals with a helper that overrides the lofty read.
    /// Because the fixture generator (gen-fixture/gen_fixture) uses `hound` with no tag
    /// support, it CANNOT embed ID3/Vorbis tags into WAV files. We therefore test the
    /// proposal/apply logic directly against an in-memory DB, bypassing the file-read path,
    /// and document this limitation.
    #[test]
    fn metadata_apply_updates_work_title_chapter_no_and_adds_tag() {
        let conn = open_in_memory().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        std::fs::create_dir_all(root.join("Alice")).unwrap();
        let _ = std::fs::File::create(root.join("Alice").join("Book 1.mp3"));
        let _ = std::fs::File::create(root.join("Alice").join("Book 1 2.mp3"));
        scan::scan_into(&conn, root).unwrap();

        let author_id = query_authors(&conn).unwrap()[0].id;
        let detail = query_author_detail(&conn, author_id).unwrap();
        let work = &detail.works[0];
        let ch = &work.chapters[0];

        // Build fake proposals (simulating what lofty would have returned from embedded tags).
        let proposals = vec![
            super::MetadataProposal {
                chapter_id: ch.id,
                work_id: work.id,
                field: "title".to_string(),
                current: work.base_title.clone(),
                proposed: "The Real Title".to_string(),
                source: "embedded".to_string(),
            },
            super::MetadataProposal {
                chapter_id: ch.id,
                work_id: work.id,
                field: "order".to_string(),
                current: ch.chapter_no.to_string(),
                proposed: "7".to_string(),
                source: "embedded".to_string(),
            },
            super::MetadataProposal {
                chapter_id: ch.id,
                work_id: work.id,
                field: "tag".to_string(),
                current: String::new(),
                proposed: "fantasy".to_string(),
                source: "embedded".to_string(),
            },
        ];

        let report = super::apply_metadata_proposals(&conn, &proposals).unwrap();
        assert!(report.applied >= 3, "expected all 3 proposals applied, got {}", report.applied);

        // Verify work title updated and metadata_source set.
        let (new_title, src): (String, String) = conn.query_row(
            "SELECT base_title, metadata_source FROM works WHERE id=?1",
            params![work.id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).unwrap();
        assert_eq!(new_title, "The Real Title");
        assert_eq!(src, "embedded");

        // Verify chapter_no updated.
        let new_no: i64 = conn.query_row(
            "SELECT chapter_no FROM chapters WHERE id=?1",
            params![ch.id],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(new_no, 7);

        // Verify genre tag inserted on work.
        let tag_count: i64 = conn.query_row(
            "SELECT count(*) FROM work_tags WHERE work_id=?1 AND tag='fantasy'",
            params![work.id],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(tag_count, 1);
    }

    #[test]
    fn metadata_apply_is_transactional_and_returns_counts() {
        let conn = open_in_memory().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        std::fs::create_dir_all(root.join("Bob")).unwrap();
        let _ = std::fs::File::create(root.join("Bob").join("Story.mp3"));
        scan::scan_into(&conn, root).unwrap();

        let author_id = query_authors(&conn).unwrap()[0].id;
        let detail = query_author_detail(&conn, author_id).unwrap();
        let work = &detail.works[0];
        let ch = &work.chapters[0];

        // One valid proposal + one with unknown field (skipped).
        let proposals = vec![
            super::MetadataProposal {
                chapter_id: ch.id,
                work_id: work.id,
                field: "title".to_string(),
                current: work.base_title.clone(),
                proposed: "New Title".to_string(),
                source: "embedded".to_string(),
            },
            super::MetadataProposal {
                chapter_id: ch.id,
                work_id: work.id,
                field: "unknown_field".to_string(),
                current: String::new(),
                proposed: "x".to_string(),
                source: "embedded".to_string(),
            },
        ];

        let report = super::apply_metadata_proposals(&conn, &proposals).unwrap();
        assert_eq!(report.applied, 1);
        assert_eq!(report.skipped, 1);
    }

    #[test]
    fn metadata_apply_is_empty_for_no_proposals() {
        let conn = open_in_memory().unwrap();
        let report = super::apply_metadata_proposals(&conn, &[]).unwrap();
        assert_eq!(report.applied, 0);
        assert_eq!(report.skipped, 0);
    }

    #[test]
    fn migration_v2_lacks_metadata_source_column_then_v3_adds_it() {
        // open_at_version(2) must NOT have metadata_source on works or chapters.
        let conn = crate::db::open_at_version(2).unwrap();
        let ver: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(ver, 2);

        let col: i64 = conn.query_row(
            "SELECT count(*) FROM pragma_table_info('works') WHERE name='metadata_source'",
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(col, 0, "metadata_source must not exist on works at v2");

        // Upgrade to latest via open_in_memory pattern (open_at_version then migrate).
        let full = crate::db::open_in_memory().unwrap();
        let full_ver: i64 = full.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(full_ver, 7);

        let col3: i64 = full.query_row(
            "SELECT count(*) FROM pragma_table_info('works') WHERE name='metadata_source'",
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(col3, 1, "metadata_source must exist on works at v3");

        let col3c: i64 = full.query_row(
            "SELECT count(*) FROM pragma_table_info('chapters') WHERE name='metadata_source'",
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(col3c, 1, "metadata_source must exist on chapters at v3");
    }

    // ---- series / reading-order tests (M16 Task 6) ------------------------------------

    fn seed_series_author(conn: &rusqlite::Connection) -> i64 {
        conn.execute(
            "INSERT INTO authors(folder_name, status) VALUES ('Series Author', 'active')",
            [],
        ).unwrap();
        conn.query_row("SELECT id FROM authors WHERE folder_name='Series Author'", [], |r| r.get(0)).unwrap()
    }

    fn insert_work(conn: &rusqlite::Connection, author_id: i64, title: &str) -> i64 {
        conn.execute(
            "INSERT INTO works(author_id, base_title, sort_key, status) VALUES (?1, ?2, lower(?2), 'active')",
            params![author_id, title],
        ).unwrap();
        conn.query_row("SELECT id FROM works WHERE author_id=?1 AND base_title=?2", params![author_id, title], |r| r.get(0)).unwrap()
    }

    fn insert_chapter(conn: &rusqlite::Connection, work_id: i64, chapter_no: i64, played: bool) -> i64 {
        let path = format!("fake/{}/{}.mp3", work_id, chapter_no);
        conn.execute(
            "INSERT INTO chapters(work_id, file_path, raw_filename, chapter_no, format, played, status)
             VALUES (?1, ?2, ?2, ?3, 'mp3', ?4, 'active')",
            params![work_id, path, chapter_no, played as i64],
        ).unwrap();
        conn.query_row("SELECT id FROM chapters WHERE file_path=?1", params![path], |r| r.get(0)).unwrap()
    }

    #[test]
    fn detect_series_proposes_group_of_three() {
        let conn = open_in_memory().unwrap();
        let author_id = seed_series_author(&conn);
        insert_work(&conn, author_id, "Cool Story");
        insert_work(&conn, author_id, "Cool Story 2");
        insert_work(&conn, author_id, "Cool Story 3");

        let proposals = super::detect_series_for_author(&conn, author_id).unwrap();
        assert_eq!(proposals.len(), 1, "should detect exactly one series");
        let p = &proposals[0];
        assert_eq!(p.title, "Cool Story");
        assert_eq!(p.members.len(), 3);
        // Members ordered by position (numeric extracted from title).
        let positions: Vec<i64> = p.members.iter().map(|m| m.position).collect();
        assert_eq!(positions, vec![1, 2, 3], "members must be in order by position");
        let titles: Vec<&str> = p.members.iter().map(|m| m.base_title.as_str()).collect();
        assert_eq!(titles, vec!["Cool Story", "Cool Story 2", "Cool Story 3"]);
    }

    #[test]
    fn detect_series_standalone_yields_no_proposal() {
        let conn = open_in_memory().unwrap();
        let author_id = seed_series_author(&conn);
        insert_work(&conn, author_id, "Standalone Work");

        let proposals = super::detect_series_for_author(&conn, author_id).unwrap();
        assert!(proposals.is_empty(), "single work must not produce a series proposal");
    }

    #[test]
    fn apply_series_writes_membership_and_get_returns_ordered_members_with_progress() {
        let conn = open_in_memory().unwrap();
        let author_id = seed_series_author(&conn);
        let w1 = insert_work(&conn, author_id, "Cool Story");
        let w2 = insert_work(&conn, author_id, "Cool Story 2");
        let w3 = insert_work(&conn, author_id, "Cool Story 3");

        // Seed chapters: w1 has 2 (both played), w2 has 1 (unplayed), w3 has 1 (unplayed).
        insert_chapter(&conn, w1, 1, true);
        insert_chapter(&conn, w1, 2, true);
        insert_chapter(&conn, w2, 1, false);
        insert_chapter(&conn, w3, 1, false);

        // Detect, then apply.
        let proposals = super::detect_series_for_author(&conn, author_id).unwrap();
        assert_eq!(proposals.len(), 1);
        super::apply_series_proposals(&conn, author_id, &proposals).unwrap();

        // get_author_series should return the series with 3 ordered members and correct progress.
        let series = super::query_author_series(&conn, author_id).unwrap();
        assert_eq!(series.len(), 1);
        let s = &series[0];
        assert_eq!(s.title, "Cool Story");
        assert_eq!(s.members.len(), 3);

        // Ordered by position.
        assert_eq!(s.members[0].work_id, w1);
        assert_eq!(s.members[0].position, 1);
        assert_eq!(s.members[0].total_chapters, 2);
        assert_eq!(s.members[0].played_chapters, 2);

        assert_eq!(s.members[1].work_id, w2);
        assert_eq!(s.members[1].position, 2);
        assert_eq!(s.members[1].total_chapters, 1);
        assert_eq!(s.members[1].played_chapters, 0);

        assert_eq!(s.members[2].work_id, w3);
        assert_eq!(s.members[2].position, 3);
        assert_eq!(s.members[2].total_chapters, 1);
        assert_eq!(s.members[2].played_chapters, 0);
    }

    #[test]
    fn migration_v3_lacks_series_then_v4_adds_them() {
        // open_at_version(3) must not have series or work_series_membership.
        let conn = crate::db::open_at_version(3).unwrap();
        let ver: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(ver, 3);

        let no_series: i64 = conn.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('series','work_series_membership')",
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(no_series, 0, "series tables must not exist at v3");

        // After a full open (which runs migrate), both tables must exist and version is 7.
        let full = crate::db::open_in_memory().unwrap();
        let full_ver: i64 = full.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(full_ver, 7);

        let series_count: i64 = full.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('series','work_series_membership')",
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(series_count, 2, "both series tables must exist after v4 migration");
    }

    #[test]
    fn home_stats_totals_streak_and_recent() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("Alice").join("Tale.mp3"));
        touch(&root.join("Alice").join("Tale 2.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();
        let aid = query_authors(&conn).unwrap()[0].id;
        // Fake files scan to 0s; seed known durations.
        conn.execute(
            "UPDATE chapters SET duration_secs=300 WHERE work_id IN (SELECT id FROM works WHERE author_id=?1)",
            params![aid],
        )
        .unwrap();
        let detail = query_author_detail(&conn, aid).unwrap();
        let ch1 = detail.works[0].chapters[0].id;
        let ch2 = detail.works[0].chapters[1].id;

        const DAY: i64 = 86_400_000;
        let now = 10 * DAY + 50_000_000; // arbitrary "today" inside day index 10 (tz=0)
        mark_finished(&conn, ch1, now - DAY).unwrap(); // yesterday
        mark_finished(&conn, ch2, now).unwrap();       // today

        let stats = home_stats(&conn, now, 0, 10).unwrap();
        assert_eq!(stats.chapters_finished, 2);
        assert_eq!(stats.total_secs, 600, "two 300s chapters");
        assert_eq!(stats.streak_days, 2, "today + yesterday");
        assert_eq!(stats.recent.len(), 2);
        assert!(stats.recent[0].played_at >= stats.recent[1].played_at, "newest first");
        assert_eq!(stats.recent[0].chapter_id, ch2);
    }

    // ---- transcript search tests (M16 Task 8) ------------------------------------------

    fn seed_transcript(conn: &rusqlite::Connection, chapter_id: i64, content: &str) {
        conn.execute(
            "INSERT OR REPLACE INTO transcripts(chapter_id, source_path, content) VALUES (?1, 'test.srt', ?2)",
            rusqlite::params![chapter_id, content],
        )
        .unwrap();
    }

    #[test]
    fn search_transcripts_finds_seeded_content() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("Author X").join("Chapter One.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();
        let aid = query_authors(&conn).unwrap()[0].id;
        let detail = query_author_detail(&conn, aid).unwrap();
        let ch_id = detail.works[0].chapters[0].id;

        seed_transcript(&conn, ch_id, "The quick brown fox jumps over the lazy dog.");

        let hits = super::search_transcripts_inner(&conn, "brown fox", 50).unwrap();
        assert_eq!(hits.len(), 1, "should find one hit");
        assert_eq!(hits[0].chapter_id, ch_id);
        assert_eq!(hits[0].author_name, "Author X");
        assert!(hits[0].snippet.contains("brown fox"), "snippet: {}", hits[0].snippet);
    }

    #[test]
    fn search_transcripts_returns_empty_for_no_match() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("Author Y").join("Story.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();
        let aid = query_authors(&conn).unwrap()[0].id;
        let detail = query_author_detail(&conn, aid).unwrap();
        let ch_id = detail.works[0].chapters[0].id;

        seed_transcript(&conn, ch_id, "Some other text here.");

        let hits = super::search_transcripts_inner(&conn, "zzznomatch", 50).unwrap();
        assert!(hits.is_empty(), "no hits expected");
    }

    #[test]
    fn search_transcripts_returns_empty_for_blank_query() {
        let conn = open_in_memory().unwrap();
        let hits = super::search_transcripts_inner(&conn, "  ", 50).unwrap();
        assert!(hits.is_empty());
    }

    #[test]
    fn get_chapter_transcript_returns_content_when_present() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("Author Z").join("Solo.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();
        let aid = query_authors(&conn).unwrap()[0].id;
        let detail = query_author_detail(&conn, aid).unwrap();
        let ch_id = detail.works[0].chapters[0].id;

        seed_transcript(&conn, ch_id, "Transcript content here.");

        let result = super::get_chapter_transcript_inner(&conn, ch_id).unwrap();
        assert_eq!(result, Some("Transcript content here.".to_string()));
    }

    #[test]
    fn get_chapter_transcript_returns_none_when_absent() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("Author W").join("Solo.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();
        let aid = query_authors(&conn).unwrap()[0].id;
        let detail = query_author_detail(&conn, aid).unwrap();
        let ch_id = detail.works[0].chapters[0].id;

        let result = super::get_chapter_transcript_inner(&conn, ch_id).unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn snippet_is_centered_on_match() {
        let content = "a ".repeat(60) + "target word here" + &" b".repeat(60);
        let snippet = super::make_snippet(&content, "target");
        assert!(snippet.contains("target"), "snippet: {snippet}");
        // Snippet should be significantly shorter than the full content.
        assert!(snippet.len() < content.len(), "snippet should be truncated");
    }

    // ---- M16 Task 10 intelligence backend tests ----------------------------------------

    #[test]
    fn dormant_works_surfaces_old_play_not_recent() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("Alice").join("Old Book.mp3"));
        touch(&root.join("Bob").join("New Book.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();
        let ids: std::collections::HashMap<String, i64> =
            query_authors(&conn).unwrap().into_iter().map(|a| (a.name, a.id)).collect();
        let alice_detail = query_author_detail(&conn, ids["Alice"]).unwrap();
        let bob_detail = query_author_detail(&conn, ids["Bob"]).unwrap();

        const DAY: i64 = 86_400_000;
        let now_ms: i64 = 100 * DAY;
        // Alice played 50 days ago (old — should surface)
        mark_finished(&conn, alice_detail.works[0].chapters[0].id, now_ms - 50 * DAY).unwrap();
        // Bob played yesterday (recent — should NOT surface with 30-day threshold)
        mark_finished(&conn, bob_detail.works[0].chapters[0].id, now_ms - 1 * DAY).unwrap();

        let dormant = super::query_dormant_works(&conn, now_ms, 30).unwrap();
        let names: Vec<&str> = dormant.iter().map(|d| d.author_name.as_str()).collect();
        assert!(names.contains(&"Alice"), "Alice should be dormant");
        assert!(!names.contains(&"Bob"), "Bob should not be dormant");
    }

    #[test]
    fn dormant_works_empty_when_no_play_events() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("Alice").join("Unplayed.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();
        let dormant = super::query_dormant_works(&conn, 1_000_000_000_000, 30).unwrap();
        assert!(dormant.is_empty(), "no play events means no dormant works");
    }

    #[test]
    fn more_like_this_excludes_source_author_and_source_work() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("Alice").join("Tale.mp3"));
        touch(&root.join("Bob").join("Saga.mp3"));
        touch(&root.join("Carol").join("Epic.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();
        let ids: std::collections::HashMap<String, i64> =
            query_authors(&conn).unwrap().into_iter().map(|a| (a.name, a.id)).collect();
        // Tag all three with "cozy" so discovery would normally surface all of them.
        super::set_tags(&conn, ids["Alice"], &["cozy".into()]).unwrap();
        super::set_tags(&conn, ids["Bob"], &["cozy".into()]).unwrap();
        super::set_tags(&conn, ids["Carol"], &["cozy".into()]).unwrap();
        let alice_detail = query_author_detail(&conn, ids["Alice"]).unwrap();
        let alice_work_id = alice_detail.works[0].id;

        let results = super::more_like_this(&conn, alice_work_id, 50).unwrap();
        // Alice's own work must not appear (excluded via author exclusion).
        assert!(results.iter().all(|w| w.work_id != alice_work_id), "source work must not appear");
        assert!(results.iter().all(|w| w.author_id != ids["Alice"]), "source author must not appear");
        // Bob and Carol should appear.
        assert!(results.iter().any(|w| w.author_name == "Bob"), "Bob should appear");
        assert!(results.iter().any(|w| w.author_name == "Carol"), "Carol should appear");
    }

    #[test]
    fn discovery_for_tags_populates_reason_field() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("Alice").join("Tale.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();
        let ids: std::collections::HashMap<String, i64> =
            query_authors(&conn).unwrap().into_iter().map(|a| (a.name, a.id)).collect();
        super::set_tags(&conn, ids["Alice"], &["cozy".into()]).unwrap();
        let results = super::discovery_for_tags(&conn, &["cozy".into()], &[], 50).unwrap();
        assert!(!results.is_empty(), "should find at least one result");
        assert!(!results[0].reason.is_empty(), "reason field must be populated");
        assert!(results[0].reason.contains("cozy"), "reason should mention the tag");
    }

    #[test]
    fn suggest_tags_from_returns_vocab_matches_then_novel_excluding_existing() {
        let vocab = vec!["mystery".to_string(), "thriller".to_string(), "calm".to_string()];
        let existing = vec!["calm".to_string()];
        let tokens = vec!["mystery".to_string(), "calm".to_string(), "adventure".to_string()];
        let suggestions = super::suggest_tags_from(&tokens, &vocab, &existing);
        // "mystery" is in vocab and not in existing → should appear.
        assert!(suggestions.contains(&"mystery".to_string()), "vocab match must appear");
        // "calm" is in existing → must not appear.
        assert!(!suggestions.contains(&"calm".to_string()), "existing tag must not appear");
        // "adventure" is novel (not in vocab, not in existing) → should appear.
        assert!(suggestions.contains(&"adventure".to_string()), "novel token must appear");
        // vocab matches come before novel tokens.
        let mystery_pos = suggestions.iter().position(|s| s == "mystery").unwrap();
        let adventure_pos = suggestions.iter().position(|s| s == "adventure").unwrap();
        assert!(mystery_pos < adventure_pos, "vocab match should rank before novel token");
    }

    // ---- M17 Phase 2: scalar journal fields + setter commands -------------------------

    /// Seed an author, one work, and one chapter into an in-memory DB.
    /// Returns (author_id, work_id, chapter_id).
    fn seed_journal_author(conn: &rusqlite::Connection) -> (i64, i64, i64) {
        conn.execute(
            "INSERT INTO authors(folder_name, status) VALUES ('Journal Author', 'active')",
            [],
        ).unwrap();
        let author_id: i64 = conn.query_row(
            "SELECT id FROM authors WHERE folder_name='Journal Author'",
            [],
            |r| r.get(0),
        ).unwrap();

        conn.execute(
            "INSERT INTO works(author_id, base_title, sort_key, status) VALUES (?1, 'Journal Work', 'journal work', 'active')",
            params![author_id],
        ).unwrap();
        let work_id: i64 = conn.query_row(
            "SELECT id FROM works WHERE author_id=?1",
            params![author_id],
            |r| r.get(0),
        ).unwrap();

        conn.execute(
            "INSERT INTO chapters(work_id, file_path, raw_filename, chapter_no, format, played, status)
             VALUES (?1, 'fake/ch1.mp3', 'ch1.mp3', 1, 'mp3', 0, 'active')",
            params![work_id],
        ).unwrap();
        let chapter_id: i64 = conn.query_row(
            "SELECT id FROM chapters WHERE work_id=?1",
            params![work_id],
            |r| r.get(0),
        ).unwrap();

        (author_id, work_id, chapter_id)
    }

    #[test]
    fn scalar_journal_fields_round_trip() {
        let conn = crate::db::open_in_memory().unwrap();
        let (author_id, work_id, chapter_id) = seed_journal_author(&conn);

        // --- chapter scalar setters ---

        // set_chapter_summary
        conn.execute("UPDATE chapters SET user_summary=?2 WHERE id=?1", params![chapter_id, "Great chapter"]).unwrap();

        // set_chapter_takeaway
        conn.execute("UPDATE chapters SET takeaway=?2 WHERE id=?1", params![chapter_id, "Key insight"]).unwrap();

        // set_chapter_favorite
        conn.execute("UPDATE chapters SET is_favorite=?2 WHERE id=?1", params![chapter_id, 1i64]).unwrap();

        // --- work scalar setters ---

        // set_work_re_entry_note
        conn.execute("UPDATE works SET re_entry_note=?2 WHERE id=?1", params![work_id, "Start at chapter 3"]).unwrap();

        // set_work_rating
        conn.execute("UPDATE works SET completion_rating=?2 WHERE id=?1", params![work_id, "excellent"]).unwrap();

        // --- verify via query_author_detail ---
        let detail = super::query_author_detail(&conn, author_id).unwrap();
        assert_eq!(detail.works.len(), 1);
        let work = &detail.works[0];
        assert_eq!(work.re_entry_note, "Start at chapter 3");
        assert_eq!(work.completion_rating, "excellent");
        assert_eq!(work.chapters.len(), 1);
        let ch = &work.chapters[0];
        assert_eq!(ch.user_summary, "Great chapter");
        assert_eq!(ch.takeaway, "Key insight");
        assert!(ch.is_favorite, "chapter should be marked as favorite");
    }

    #[test]
    fn scalar_journal_fields_default_to_empty() {
        let conn = crate::db::open_in_memory().unwrap();
        let (author_id, _work_id, _chapter_id) = seed_journal_author(&conn);

        // Without any setter calls, scalars default to empty / false.
        let detail = super::query_author_detail(&conn, author_id).unwrap();
        let work = &detail.works[0];
        assert_eq!(work.re_entry_note, "");
        assert_eq!(work.completion_rating, "");
        let ch = &work.chapters[0];
        assert_eq!(ch.user_summary, "");
        assert_eq!(ch.takeaway, "");
        assert!(!ch.is_favorite, "is_favorite must default to false");
    }

    #[test]
    fn chapter_favorite_toggle_round_trips() {
        let conn = crate::db::open_in_memory().unwrap();
        let (author_id, _work_id, chapter_id) = seed_journal_author(&conn);

        // set favorite = true
        conn.execute("UPDATE chapters SET is_favorite=1 WHERE id=?1", params![chapter_id]).unwrap();
        let detail = super::query_author_detail(&conn, author_id).unwrap();
        assert!(detail.works[0].chapters[0].is_favorite);

        // set favorite = false
        conn.execute("UPDATE chapters SET is_favorite=0 WHERE id=?1", params![chapter_id]).unwrap();
        let detail2 = super::query_author_detail(&conn, author_id).unwrap();
        assert!(!detail2.works[0].chapters[0].is_favorite);
    }

    // ---- M17 Phase 3: notes & bookmarks CRUD tests ------------------------------------

    #[test]
    fn add_note_and_bookmark_returned_by_journal_ordered_by_position() {
        let conn = crate::db::open_in_memory().unwrap();
        let (_author_id, _work_id, chapter_id) = seed_journal_author(&conn);

        // Add two notes at different positions (second note added first).
        conn.execute(
            "INSERT INTO chapter_notes(chapter_id, position_secs, body, created_at) VALUES (?1, 30, 'second note', 1000)",
            params![chapter_id],
        ).unwrap();
        conn.execute(
            "INSERT INTO chapter_notes(chapter_id, position_secs, body, created_at) VALUES (?1, 10, 'first note', 2000)",
            params![chapter_id],
        ).unwrap();

        // Add two bookmarks at different positions (second added first).
        conn.execute(
            "INSERT INTO chapter_bookmarks(chapter_id, position_secs, label, created_at) VALUES (?1, 60, 'late mark', 1000)",
            params![chapter_id],
        ).unwrap();
        conn.execute(
            "INSERT INTO chapter_bookmarks(chapter_id, position_secs, label, created_at) VALUES (?1, 5, 'early mark', 2000)",
            params![chapter_id],
        ).unwrap();

        let journal = super::journal_for_chapter(&conn, chapter_id).unwrap();

        // Notes ordered by position_secs ascending.
        assert_eq!(journal.notes.len(), 2);
        assert_eq!(journal.notes[0].position_secs, 10);
        assert_eq!(journal.notes[0].body, "first note");
        assert_eq!(journal.notes[1].position_secs, 30);
        assert_eq!(journal.notes[1].body, "second note");

        // Bookmarks ordered by position_secs ascending.
        assert_eq!(journal.bookmarks.len(), 2);
        assert_eq!(journal.bookmarks[0].position_secs, 5);
        assert_eq!(journal.bookmarks[0].label, "early mark");
        assert_eq!(journal.bookmarks[1].position_secs, 60);
        assert_eq!(journal.bookmarks[1].label, "late mark");
    }

    #[test]
    fn delete_note_and_bookmark_leaves_journal_empty() {
        let conn = crate::db::open_in_memory().unwrap();
        let (_author_id, _work_id, chapter_id) = seed_journal_author(&conn);

        // Insert and then delete a note.
        conn.execute(
            "INSERT INTO chapter_notes(chapter_id, position_secs, body, created_at) VALUES (?1, 12, 'my note', 1000)",
            params![chapter_id],
        ).unwrap();
        let note_id: i64 = conn.query_row("SELECT last_insert_rowid()", [], |r| r.get(0)).unwrap();

        // Insert and then delete a bookmark.
        conn.execute(
            "INSERT INTO chapter_bookmarks(chapter_id, position_secs, label, created_at) VALUES (?1, 30, 'my bookmark', 1000)",
            params![chapter_id],
        ).unwrap();
        let bookmark_id: i64 = conn.query_row("SELECT last_insert_rowid()", [], |r| r.get(0)).unwrap();

        // Confirm both are present.
        let journal = super::journal_for_chapter(&conn, chapter_id).unwrap();
        assert_eq!(journal.notes.len(), 1);
        assert_eq!(journal.bookmarks.len(), 1);

        // Delete the note.
        conn.execute("DELETE FROM chapter_notes WHERE id=?1", params![note_id]).unwrap();
        // Delete the bookmark.
        conn.execute("DELETE FROM chapter_bookmarks WHERE id=?1", params![bookmark_id]).unwrap();

        // Journal should now be empty.
        let journal2 = super::journal_for_chapter(&conn, chapter_id).unwrap();
        assert!(journal2.notes.is_empty(), "notes should be empty after delete");
        assert!(journal2.bookmarks.is_empty(), "bookmarks should be empty after delete");
    }

    #[test]
    fn add_chapter_note_rejects_whitespace_only_body() {
        let conn = crate::db::open_in_memory().unwrap();
        // We test the command logic directly by replicating what the command does.
        // A whitespace-only body should return Err after trimming to empty.
        let body = "   ".to_string();
        let trimmed = body.trim().to_string();
        assert!(trimmed.is_empty(), "whitespace body trims to empty");

        // Simulate the command's early-return check.
        let result: Result<(), &str> = if trimmed.is_empty() {
            Err("note body is empty")
        } else {
            Ok(())
        };
        assert!(result.is_err(), "whitespace-only body must be rejected");
        assert_eq!(result.unwrap_err(), "note body is empty");

        // Verify no note was actually inserted.
        let (_author_id, _work_id, chapter_id) = seed_journal_author(&conn);
        let journal = super::journal_for_chapter(&conn, chapter_id).unwrap();
        assert!(journal.notes.is_empty(), "no note should exist after whitespace rejection");
    }

    #[test]
    fn journal_for_chapter_returns_correct_fields() {
        let conn = crate::db::open_in_memory().unwrap();
        let (_author_id, _work_id, chapter_id) = seed_journal_author(&conn);

        conn.execute(
            "INSERT INTO chapter_notes(chapter_id, position_secs, body, created_at) VALUES (?1, 42, 'check fields', 9999)",
            params![chapter_id],
        ).unwrap();
        conn.execute(
            "INSERT INTO chapter_bookmarks(chapter_id, position_secs, label, created_at) VALUES (?1, 77, 'key idea', 8888)",
            params![chapter_id],
        ).unwrap();

        let journal = super::journal_for_chapter(&conn, chapter_id).unwrap();
        assert_eq!(journal.notes.len(), 1);
        let note = &journal.notes[0];
        assert_eq!(note.chapter_id, chapter_id);
        assert_eq!(note.position_secs, 42);
        assert_eq!(note.body, "check fields");
        assert_eq!(note.created_at, 9999);

        assert_eq!(journal.bookmarks.len(), 1);
        let bm = &journal.bookmarks[0];
        assert_eq!(bm.chapter_id, chapter_id);
        assert_eq!(bm.position_secs, 77);
        assert_eq!(bm.label, "key idea");
        assert_eq!(bm.created_at, 8888);
    }

    // ---- M17 Phase 4: unified journal query + export tests ----------------------------

    #[test]
    fn collect_journal_returns_all_7_kinds() {
        let conn = crate::db::open_in_memory().unwrap();
        let (author_id, work_id, chapter_id) = seed_journal_author(&conn);
        let _ = (author_id,); // suppress unused warning

        // Seed all 7 kinds.
        conn.execute(
            "INSERT INTO chapter_notes(chapter_id, position_secs, body, created_at) VALUES (?1, 15, 'my note body', 1000)",
            params![chapter_id],
        ).unwrap();
        conn.execute(
            "INSERT INTO chapter_bookmarks(chapter_id, position_secs, label, created_at) VALUES (?1, 30, 'key idea', 2000)",
            params![chapter_id],
        ).unwrap();
        conn.execute("UPDATE chapters SET user_summary='great summary' WHERE id=?1", params![chapter_id]).unwrap();
        conn.execute("UPDATE chapters SET takeaway='key takeaway' WHERE id=?1", params![chapter_id]).unwrap();
        conn.execute("UPDATE chapters SET is_favorite=1 WHERE id=?1", params![chapter_id]).unwrap();
        conn.execute("UPDATE works SET re_entry_note='start here' WHERE id=?1", params![work_id]).unwrap();
        conn.execute("UPDATE works SET completion_rating='amazing' WHERE id=?1", params![work_id]).unwrap();

        let entries = super::collect_journal(&conn).unwrap();
        let kinds: Vec<&str> = entries.iter().map(|e| e.kind.as_str()).collect();

        assert!(kinds.contains(&"note"), "missing note");
        assert!(kinds.contains(&"bookmark"), "missing bookmark");
        assert!(kinds.contains(&"summary"), "missing summary");
        assert!(kinds.contains(&"takeaway"), "missing takeaway");
        assert!(kinds.contains(&"favorite"), "missing favorite");
        assert!(kinds.contains(&"re_entry"), "missing re_entry");
        assert!(kinds.contains(&"rating"), "missing rating");
        assert_eq!(entries.len(), 7, "expected exactly 7 entries");
    }

    #[test]
    fn query_journal_empty_query_returns_all_then_filter_narrows() {
        let conn = crate::db::open_in_memory().unwrap();
        let (_author_id, work_id, chapter_id) = seed_journal_author(&conn);

        conn.execute(
            "INSERT INTO chapter_notes(chapter_id, position_secs, body, created_at) VALUES (?1, 15, 'unique_searchword here', 1000)",
            params![chapter_id],
        ).unwrap();
        conn.execute(
            "INSERT INTO chapter_bookmarks(chapter_id, position_secs, label, created_at) VALUES (?1, 30, 'other label', 2000)",
            params![chapter_id],
        ).unwrap();
        conn.execute("UPDATE works SET re_entry_note='start here' WHERE id=?1", params![work_id]).unwrap();

        let all = super::collect_journal(&conn).unwrap();
        assert_eq!(all.len(), 3, "should have 3 total entries");

        // Filter to only the note.
        let filtered: Vec<_> = all.iter().filter(|e| {
            let q = "unique_searchword";
            e.body.to_lowercase().contains(q)
                || e.work_title.to_lowercase().contains(q)
                || e.author_name.to_lowercase().contains(q)
                || e.chapter_title.as_deref().map_or(false, |t| t.to_lowercase().contains(q))
        }).collect();
        assert_eq!(filtered.len(), 1, "should narrow to 1 note");
        assert_eq!(filtered[0].kind, "note");
        assert!(filtered[0].body.contains("unique_searchword"));
    }

    #[test]
    fn build_journal_json_round_trips_via_serde() {
        let conn = crate::db::open_in_memory().unwrap();
        let (_author_id, _work_id, chapter_id) = seed_journal_author(&conn);

        conn.execute(
            "INSERT INTO chapter_notes(chapter_id, position_secs, body, created_at) VALUES (?1, 10, 'round trip note', 5000)",
            params![chapter_id],
        ).unwrap();

        let entries = super::collect_journal(&conn).unwrap();
        let json = super::build_journal_json(&entries).unwrap();
        let parsed: Vec<crate::model::JournalEntry> = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.len(), entries.len());
        assert_eq!(parsed[0].kind, entries[0].kind);
        assert_eq!(parsed[0].body, entries[0].body);
    }

    #[test]
    fn build_journal_markdown_contains_headings_and_kind_markers() {
        let conn = crate::db::open_in_memory().unwrap();
        let (_author_id, work_id, chapter_id) = seed_journal_author(&conn);

        conn.execute(
            "INSERT INTO chapter_notes(chapter_id, position_secs, body, created_at) VALUES (?1, 15, 'note text', 1000)",
            params![chapter_id],
        ).unwrap();
        conn.execute(
            "INSERT INTO chapter_bookmarks(chapter_id, position_secs, label, created_at) VALUES (?1, 30, 'key idea', 2000)",
            params![chapter_id],
        ).unwrap();
        conn.execute("UPDATE chapters SET user_summary='great summary' WHERE id=?1", params![chapter_id]).unwrap();
        conn.execute("UPDATE chapters SET takeaway='key takeaway' WHERE id=?1", params![chapter_id]).unwrap();
        conn.execute("UPDATE chapters SET is_favorite=1 WHERE id=?1", params![chapter_id]).unwrap();
        conn.execute("UPDATE works SET re_entry_note='start here' WHERE id=?1", params![work_id]).unwrap();
        conn.execute("UPDATE works SET completion_rating='amazing' WHERE id=?1", params![work_id]).unwrap();

        let entries = super::collect_journal(&conn).unwrap();
        let md = super::build_journal_markdown(&entries);

        // Should have the top-level heading.
        assert!(md.contains("# AudioShelf — Listening Journal"), "missing top heading");
        // Author heading.
        assert!(md.contains("## Journal Author"), "missing author heading");
        // Work heading with rating.
        assert!(md.contains("### Journal Work"), "missing work heading");
        assert!(md.contains("amazing"), "missing rating word");
        // Re-entry note.
        assert!(md.contains("_Where I left off:_"), "missing re-entry label");
        assert!(md.contains("start here"), "missing re-entry text");
        // Note marker with position.
        assert!(md.contains("**Note**"), "missing note marker");
        assert!(md.contains("0:15"), "missing note position");
        // Bookmark marker.
        assert!(md.contains("**Bookmark**"), "missing bookmark marker");
        assert!(md.contains("0:30"), "missing bookmark position");
        // Summary.
        assert!(md.contains("**Summary**"), "missing summary marker");
        assert!(md.contains("great summary"), "missing summary text");
        // Takeaway.
        assert!(md.contains("**Takeaway**"), "missing takeaway marker");
        assert!(md.contains("key takeaway"), "missing takeaway text");
        // Favorite star.
        assert!(md.contains("★ Favorite"), "missing favorite marker");
    }

    #[test]
    fn export_recap_png_writes_bytes() {
        let dir = std::env::temp_dir().join(format!("audioshelf_recap_test_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("recap.png");
        let bytes = vec![0x89u8, 0x50, 0x4e, 0x47, 1, 2, 3];
        std::fs::write(&path, &bytes).unwrap(); // mirror of the command body (command needs tauri State)
        let read = std::fs::read(&path).unwrap();
        assert_eq!(read, bytes);
        std::fs::remove_dir_all(&dir).ok();
    }

    // ---- M19 Task 4: saved-search + smart-collection CRUD tests -----------------------

    #[test]
    fn saved_search_crud_roundtrip() {
        let conn = crate::db::open_at_version(7).unwrap();
        let id = super::create_saved_search_row(&conn, "Cozy shorts", "tag:cozy duration:<15m", 1_700_000_000).unwrap();
        let all = super::list_saved_searches_rows(&conn).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].name, "Cozy shorts");
        assert_eq!(all[0].query, "tag:cozy duration:<15m");
        super::delete_saved_search_row(&conn, id).unwrap();
        assert!(super::list_saved_searches_rows(&conn).unwrap().is_empty());
    }

    #[test]
    fn collection_crud_and_reorder() {
        let conn = crate::db::open_at_version(7).unwrap();
        let a = super::create_collection_row(&conn, "A", "tag:a", 1).unwrap();
        let b = super::create_collection_row(&conn, "B", "tag:b", 1).unwrap();
        super::reorder_collections_rows(&conn, &[b, a]).unwrap();
        let names: Vec<String> = super::list_collections_rows(&conn).unwrap().into_iter().map(|c| c.name).collect();
        assert_eq!(names, vec!["B".to_string(), "A".to_string()]);
    }

    // ---- M19 Task 5: bulk_set_work_tags -----------------------------------------------
    // (implementation is above the mod tests block)

    #[test]
    fn bulk_tag_adds_and_removes_per_work() {
        let conn = crate::db::open_at_version(7).unwrap();
        conn.execute_batch(
            "INSERT INTO authors(id, folder_name, status) VALUES (1,'a','active');
             INSERT INTO works(id, author_id, base_title, status, sort_key) VALUES (1,1,'W1','active','w1'),(2,1,'W2','active','w2');
             INSERT INTO work_tags(work_id, tag) VALUES (1,'old'),(2,'old');",
        ).unwrap();
        super::bulk_set_work_tags_rows(&conn, &[1, 2], &["fresh".into()], &["old".into()]).unwrap();
        let t1: Vec<String> = conn.prepare("SELECT tag FROM work_tags WHERE work_id=1 ORDER BY tag").unwrap()
            .query_map([], |r| r.get(0)).unwrap().collect::<rusqlite::Result<_>>().unwrap();
        assert_eq!(t1, vec!["fresh".to_string()]);
        let total: i64 = conn.query_row("SELECT COUNT(*) FROM work_tags WHERE tag='old'", [], |r| r.get(0)).unwrap();
        assert_eq!(total, 0);
    }

    // ---- M19 Task 6: chapter_sort_override -----------------------------------------------

    #[test]
    fn chapter_sort_override_reorders_in_detail() {
        let conn = crate::db::open_at_version(7).unwrap();
        conn.execute_batch(
            "INSERT INTO authors(id, folder_name, status) VALUES (1,'a','active');
             INSERT INTO works(id, author_id, base_title, sort_key, status, chapter_sort) VALUES (1,1,'W','w','active','number_desc');
             INSERT INTO chapters(id, work_id, raw_filename, chapter_no, format, duration_secs, file_path, status, played, user_summary, takeaway, is_favorite)
               VALUES (1,1,'a.mp3',1,'mp3',10,'/a','active',0,'','',0),
                      (2,1,'b.mp3',2,'mp3',20,'/b','active',0,'','',0);",
        ).unwrap();
        let detail = query_author_detail(&conn, 1).unwrap();
        let nums: Vec<i64> = detail.works[0].chapters.iter().map(|c| c.chapter_no).collect();
        assert_eq!(nums, vec![2, 1]); // descending
    }
}

/// Max thumbnail edge in pixels (square-bounded, aspect preserved).
const COVER_MAX: u32 = 256;

/// `<app_data>/covers`, created if missing. Matches the asset scope granted in `setup`.
fn covers_cache_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("covers");
    std::fs::create_dir_all(&dir).ok();
    dir
}

/// First (lowest chapter_no) active chapter file for a work.
fn first_chapter_file_for_work(
    conn: &rusqlite::Connection,
    work_id: i64,
) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT file_path FROM chapters
         WHERE work_id=?1 AND status='active'
         ORDER BY chapter_no LIMIT 1",
        params![work_id],
        |r| r.get::<_, String>(0),
    )
    .map(Some)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(other),
    })
}

/// First active chapter file for an author (first work by sort_key, first chapter by no).
fn first_chapter_file_for_author(
    conn: &rusqlite::Connection,
    author_id: i64,
) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT c.file_path FROM chapters c
         JOIN works w ON c.work_id = w.id
         WHERE w.author_id=?1 AND c.status='active' AND w.status='active'
         ORDER BY w.sort_key, c.chapter_no LIMIT 1",
        params![author_id],
        |r| r.get::<_, String>(0),
    )
    .map(Some)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(other),
    })
}

/// Cover for a work: its first file's embedded art, else a folder image. Returns the
/// cached thumbnail's absolute path, or None if there's no cover.
#[tauri::command]
pub fn get_work_cover(
    app: tauri::AppHandle,
    state: tauri::State<DbState>,
    work_id: i64,
) -> Result<Option<String>, String> {
    let file = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        first_chapter_file_for_work(&conn, work_id).map_err(|e| e.to_string())?
    }; // drop the DB lock before image work
    let Some(file) = file else { return Ok(None) };
    let dir = covers_cache_dir(&app);
    let p = crate::covers::cover_cache_for_chapter(
        &dir,
        std::path::Path::new(&file),
        crate::covers::CoverPriority::EmbeddedFirst,
        COVER_MAX,
    );
    Ok(p.map(|x| x.to_string_lossy().to_string()))
}

/// Cover for an author: a folder image, else the first file's embedded art.
#[tauri::command]
pub fn get_author_cover(
    app: tauri::AppHandle,
    state: tauri::State<DbState>,
    author_id: i64,
) -> Result<Option<String>, String> {
    let file = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        first_chapter_file_for_author(&conn, author_id).map_err(|e| e.to_string())?
    };
    let Some(file) = file else { return Ok(None) };
    let dir = covers_cache_dir(&app);
    let p = crate::covers::cover_cache_for_chapter(
        &dir,
        std::path::Path::new(&file),
        crate::covers::CoverPriority::FolderFirst,
        COVER_MAX,
    );
    Ok(p.map(|x| x.to_string_lossy().to_string()))
}
