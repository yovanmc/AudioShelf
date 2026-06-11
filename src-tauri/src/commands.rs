//! Tauri commands and the shared DB state.

use crate::db;
use crate::model::{AuthorDetail, AuthorRow, ChapterRow, DiscoveryWork, MoreWork, ScanResult, WorkRow};
use crate::natsort::natural_cmp;
use crate::scan;
use rusqlite::params;
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
    let mut stmt = conn.prepare("SELECT DISTINCT tag FROM author_tags ORDER BY tag").map_err(|e| e.to_string())?;
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

/// Replace an author's tag set (deduped, blanks dropped, trimmed).
pub(crate) fn set_tags(conn: &rusqlite::Connection, author_id: i64, tags: &[String]) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM author_tags WHERE author_id=?1", params![author_id])?;
    let mut seen = std::collections::BTreeSet::new();
    for raw in tags {
        let t = raw.trim();
        if t.is_empty() || !seen.insert(t.to_string()) { continue; }
        conn.execute(
            "INSERT OR IGNORE INTO author_tags(author_id, tag) VALUES (?1, ?2)",
            params![author_id, t],
        )?;
    }
    Ok(())
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
                   WHERE w.author_id=a.id AND c.status='active' AND c.played=0)
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
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
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
            Ok(WorkRow { id: r.get(0)?, base_title: r.get(1)?, chapters: Vec::new() })
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
                })
            })?
            .collect::<rusqlite::Result<_>>()?;
        chapters.sort_by(|a, b| a.chapter_no.cmp(&b.chapter_no));
        work.chapters = chapters;
    }

    let mut tstmt = conn.prepare("SELECT tag FROM author_tags WHERE author_id=?1 ORDER BY tag")?;
    let tags: Vec<String> = tstmt
        .query_map(params![author_id], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<_>>()?;

    Ok(AuthorDetail { id: author_id, name, tags, works })
}

/// Works (with unplayed chapters) by authors having any of `tags`, ranked by
/// shared-tag count then unplayed count. `exclude_authors` are filtered out.
pub(crate) fn discovery_for_tags(
    conn: &rusqlite::Connection,
    tags: &[String],
    exclude_authors: &[i64],
    cap: usize,
) -> rusqlite::Result<Vec<DiscoveryWork>> {
    if tags.is_empty() {
        return Ok(Vec::new());
    }
    // Candidate authors: those sharing >=1 tag, not excluded.
    let mut works: Vec<DiscoveryWork> = Vec::new();
    let mut astmt = conn.prepare("SELECT id, COALESCE(display_name, folder_name) FROM authors WHERE status='active'")?;
    let authors: Vec<(i64, String)> = astmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    for (author_id, author_name) in authors {
        if exclude_authors.contains(&author_id) {
            continue;
        }
        let mut tstmt = conn.prepare("SELECT tag FROM author_tags WHERE author_id=?1")?;
        let author_tags: Vec<String> = tstmt
            .query_map(params![author_id], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<_>>()?;
        let mut shared: Vec<String> = author_tags.iter().filter(|t| tags.contains(t)).cloned().collect();
        shared.sort();
        if shared.is_empty() {
            continue;
        }
        // This author's works that have >=1 unplayed chapter.
        let mut wstmt = conn.prepare(
            "SELECT w.id, w.base_title,
                    (SELECT count(*) FROM chapters c WHERE c.work_id=w.id AND c.status='active' AND c.played=0)
             FROM works w WHERE w.author_id=?1 AND w.status='active'",
        )?;
        let rows: Vec<(i64, String, i64)> = wstmt
            .query_map(params![author_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<rusqlite::Result<_>>()?;
        for (work_id, base_title, unplayed) in rows {
            if unplayed > 0 {
                works.push(DiscoveryWork {
                    work_id,
                    base_title,
                    author_id,
                    author_name: author_name.clone(),
                    unplayed_count: unplayed,
                    shared_tags: shared.clone(),
                });
            }
        }
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
}
