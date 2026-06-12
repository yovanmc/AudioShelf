//! Tauri commands and the shared DB state.

use crate::db;
use crate::model::{AuthorDetail, AuthorHit, AuthorRow, ChapterHit, ChapterRow, DiscoveryWork, MoreWork, RenameItem, RenameResult, ScanResult, SearchResults, UndoResult, WorkHit, WorkRow};
use crate::natsort::natural_cmp;
use crate::regroup;
use crate::rename;
use crate::scan;
use rusqlite::{params, OptionalExtension};
use std::sync::Mutex;

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
        "SELECT id, base_title FROM works WHERE author_id=?1 AND status='active'",
    )?;
    let mut works: Vec<WorkRow> = wstmt
        .query_map(params![author_id], |r| {
            Ok(WorkRow { id: r.get(0)?, base_title: r.get(1)?, tags: Vec::new(), chapters: Vec::new() })
        })?
        .collect::<rusqlite::Result<_>>()?;
    works.sort_by(|a, b| natural_cmp(&a.base_title, &b.base_title));

    for work in &mut works {
        let mut cstmt = conn.prepare(
            "SELECT id, raw_filename, chapter_no, format, duration_secs, file_path, played
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
                })
            })?
            .collect::<rusqlite::Result<_>>()?;
        chapters.sort_by(|a, b| a.chapter_no.cmp(&b.chapter_no));
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
        // Union of this work's author tags and its own work tags.
        let mut owned: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
        let mut atstmt = conn.prepare("SELECT tag FROM author_tags WHERE author_id=?1")?;
        for t in atstmt.query_map(params![author_id], |r| r.get::<_, String>(0))? {
            owned.insert(t?);
        }
        let mut wtstmt = conn.prepare("SELECT tag FROM work_tags WHERE work_id=?1")?;
        for t in wtstmt.query_map(params![work_id], |r| r.get::<_, String>(0))? {
            owned.insert(t?);
        }
        // Intersect with the requested tags. BTreeSet keeps `shared` sorted.
        let shared: Vec<String> = owned.into_iter().filter(|t| tags.contains(t)).collect();
        if shared.is_empty() {
            continue;
        }
        works.push(DiscoveryWork {
            work_id,
            base_title,
            author_id,
            author_name,
            unplayed_count: unplayed,
            shared_tags: shared,
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
        // The pre-seeded schema_version key is untouched.
        assert_eq!(
            get_setting_value(&conn, "schema_version").unwrap(),
            Some("1".to_string())
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
