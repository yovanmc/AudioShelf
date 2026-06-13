//! M19 backup/restore. Export = identity-keyed JSON + VACUUM-INTO DB snapshot.
//! Import = strictly additive merge. Restore = crash-safe staged swap at bootstrap.

use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde_json::{json, Value};
use crate::model::ImportReport;

pub fn build_curation_export(conn: &Connection, exported_at: i64) -> rusqlite::Result<Value> {
    // authors
    let mut astmt = conn.prepare(
        "SELECT id, folder_name, COALESCE(display_name,'') FROM authors WHERE status='active' ORDER BY folder_name",
    )?;
    let authors_raw: Vec<(i64, String, String)> = astmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<rusqlite::Result<_>>()?;

    let mut author_tags = conn.prepare(
        "SELECT tag FROM author_tags WHERE author_id=?1 ORDER BY tag",
    )?;
    let mut works_stmt = conn.prepare(
        "SELECT id, base_title, re_entry_note, completion_rating, chapter_sort FROM works WHERE author_id=?1 AND status='active' ORDER BY base_title",
    )?;
    let mut work_tags = conn.prepare(
        "SELECT tag FROM work_tags WHERE work_id=?1 ORDER BY tag",
    )?;
    let mut chapters_stmt = conn.prepare(
        "SELECT id, raw_filename, played, is_favorite, user_summary, takeaway FROM chapters WHERE work_id=?1 AND status='active' ORDER BY chapter_no",
    )?;
    let mut chapter_tags = conn.prepare(
        "SELECT tag FROM chapter_tags WHERE chapter_id=?1 ORDER BY tag",
    )?;
    let mut notes_stmt = conn.prepare(
        "SELECT position_secs, body, created_at FROM chapter_notes WHERE chapter_id=?1 ORDER BY created_at",
    )?;
    let mut bm_stmt = conn.prepare(
        "SELECT position_secs, label, created_at FROM chapter_bookmarks WHERE chapter_id=?1 ORDER BY created_at",
    )?;

    let collect_tags =
        |stmt: &mut rusqlite::Statement, id: i64| -> rusqlite::Result<Vec<String>> {
            stmt.query_map(params![id], |r| r.get::<_, String>(0))?
                .collect()
        };

    let mut authors_json: Vec<Value> = Vec::new();
    for (aid, folder_name, display_name) in authors_raw {
        let atags = collect_tags(&mut author_tags, aid)?;
        let works_raw: Vec<(i64, String, String, String, String)> = works_stmt
            .query_map(params![aid], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                ))
            })?
            .collect::<rusqlite::Result<_>>()?;
        let mut works_json: Vec<Value> = Vec::new();
        for (wid, base_title, re_entry, rating, csort) in works_raw {
            let wtags = collect_tags(&mut work_tags, wid)?;
            let chs_raw: Vec<(i64, String, bool, bool, String, String)> = chapters_stmt
                .query_map(params![wid], |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get::<_, i64>(2)? != 0,
                        r.get::<_, i64>(3)? != 0,
                        r.get(4)?,
                        r.get(5)?,
                    ))
                })?
                .collect::<rusqlite::Result<_>>()?;
            let mut chs_json: Vec<Value> = Vec::new();
            for (cid, raw_filename, played, fav, summary, takeaway) in chs_raw {
                let ctags = collect_tags(&mut chapter_tags, cid)?;
                let notes: Vec<Value> = notes_stmt
                    .query_map(params![cid], |r| {
                        Ok(json!({
                            "positionSecs": r.get::<_,i64>(0)?,
                            "body": r.get::<_,String>(1)?,
                            "createdAt": r.get::<_,i64>(2)?
                        }))
                    })?
                    .collect::<rusqlite::Result<_>>()?;
                let bookmarks: Vec<Value> = bm_stmt
                    .query_map(params![cid], |r| {
                        Ok(json!({
                            "positionSecs": r.get::<_,i64>(0)?,
                            "label": r.get::<_,String>(1)?,
                            "createdAt": r.get::<_,i64>(2)?
                        }))
                    })?
                    .collect::<rusqlite::Result<_>>()?;
                chs_json.push(json!({
                    "rawFilename": raw_filename,
                    "played": played,
                    "isFavorite": fav,
                    "userSummary": summary,
                    "takeaway": takeaway,
                    "tags": ctags,
                    "notes": notes,
                    "bookmarks": bookmarks
                }));
            }
            works_json.push(json!({
                "baseTitle": base_title,
                "tags": wtags,
                "reEntryNote": re_entry,
                "completionRating": rating,
                "chapterSort": csort,
                "chapters": chs_json
            }));
        }
        authors_json.push(json!({
            "folderName": folder_name,
            "displayName": display_name,
            "tags": atags,
            "works": works_json
        }));
    }

    let aliases: Vec<Value> = conn
        .prepare("SELECT alias, canonical FROM tag_aliases ORDER BY alias")?
        .query_map([], |r| {
            Ok(json!({
                "alias": r.get::<_,String>(0)?,
                "canonical": r.get::<_,String>(1)?
            }))
        })?
        .collect::<rusqlite::Result<_>>()?;
    let parents: Vec<Value> = conn
        .prepare("SELECT child, parent FROM tag_parents ORDER BY child")?
        .query_map([], |r| {
            Ok(json!({
                "child": r.get::<_,String>(0)?,
                "parent": r.get::<_,String>(1)?
            }))
        })?
        .collect::<rusqlite::Result<_>>()?;
    let collections: Vec<Value> = conn
        .prepare("SELECT name, query, position FROM smart_collections ORDER BY position")?
        .query_map([], |r| {
            Ok(json!({
                "name": r.get::<_,String>(0)?,
                "query": r.get::<_,String>(1)?,
                "position": r.get::<_,i64>(2)?
            }))
        })?
        .collect::<rusqlite::Result<_>>()?;
    let searches: Vec<Value> = conn
        .prepare("SELECT name, query FROM saved_searches ORDER BY name")?
        .query_map([], |r| {
            Ok(json!({
                "name": r.get::<_,String>(0)?,
                "query": r.get::<_,String>(1)?
            }))
        })?
        .collect::<rusqlite::Result<_>>()?;

    Ok(json!({
        "schemaVersion": 7,
        "exportedAt": exported_at,
        "authors": authors_json,
        "tagAliases": aliases,
        "tagParents": parents,
        "collections": collections,
        "savedSearches": searches
    }))
}

pub fn apply_curation_import(conn: &Connection, root: &Value) -> rusqlite::Result<ImportReport> {
    let mut rep = ImportReport::default();

    let find_author = |folder: &str| -> rusqlite::Result<Option<i64>> {
        conn.query_row("SELECT id FROM authors WHERE folder_name=?1 AND status='active'", params![folder], |r| r.get(0)).optional()
    };
    let find_work = |author_id: i64, base: &str| -> rusqlite::Result<Option<i64>> {
        conn.query_row("SELECT id FROM works WHERE author_id=?1 AND base_title=?2 AND status='active'", params![author_id, base], |r| r.get(0)).optional()
    };
    let find_chapter = |work_id: i64, raw: &str| -> rusqlite::Result<Option<i64>> {
        conn.query_row("SELECT id FROM chapters WHERE work_id=?1 AND raw_filename=?2 AND status='active'", params![work_id, raw], |r| r.get(0)).optional()
    };
    let add_tag = |table: &str, key_col: &str, id: i64, tag: &str| -> rusqlite::Result<bool> {
        let changed = conn.execute(&format!("INSERT OR IGNORE INTO {table}({key_col}, tag) VALUES (?1,?2)"), params![id, tag])?;
        Ok(changed > 0)
    };
    // fill scalar only if existing value is blank (trimmed empty)
    let fill_if_empty = |table: &str, col: &str, id: i64, val: &str| -> rusqlite::Result<bool> {
        if val.trim().is_empty() { return Ok(false); }
        let cur: String = conn.query_row(&format!("SELECT {col} FROM {table} WHERE id=?1"), params![id], |r| r.get(0))?;
        if cur.trim().is_empty() {
            conn.execute(&format!("UPDATE {table} SET {col}=?2 WHERE id=?1"), params![id, val])?;
            Ok(true)
        } else { Ok(false) }
    };

    let s = |v: &Value, k: &str| -> String { v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string() };
    let b = |v: &Value, k: &str| -> bool { v.get(k).and_then(|x| x.as_bool()).unwrap_or(false) };
    let i = |v: &Value, k: &str| -> i64 { v.get(k).and_then(|x| x.as_i64()).unwrap_or(0) };
    let arr = |v: &Value, k: &str| -> Vec<Value> { v.get(k).and_then(|x| x.as_array()).cloned().unwrap_or_default() };

    for a in arr(root, "authors") {
        let aid = match find_author(&s(&a, "folderName"))? { Some(id) => id, None => { rep.unmatched_authors += 1; continue; } };
        for t in arr(&a, "tags") { if let Some(tag) = t.as_str() { if add_tag("author_tags", "author_id", aid, tag)? { rep.tags_added += 1; } } }
        for w in arr(&a, "works") {
            let wid = match find_work(aid, &s(&w, "baseTitle"))? { Some(id) => id, None => { rep.unmatched_works += 1; continue; } };
            for t in arr(&w, "tags") { if let Some(tag) = t.as_str() { if add_tag("work_tags", "work_id", wid, tag)? { rep.tags_added += 1; } } }
            if fill_if_empty("works", "re_entry_note", wid, &s(&w, "reEntryNote"))? { rep.journal_fields_filled += 1; }
            if fill_if_empty("works", "completion_rating", wid, &s(&w, "completionRating"))? { rep.journal_fields_filled += 1; }
            if fill_if_empty("works", "chapter_sort", wid, &s(&w, "chapterSort"))? { rep.journal_fields_filled += 1; }
            for c in arr(&w, "chapters") {
                let cid = match find_chapter(wid, &s(&c, "rawFilename"))? { Some(id) => id, None => { rep.unmatched_chapters += 1; continue; } };
                for t in arr(&c, "tags") { if let Some(tag) = t.as_str() { if add_tag("chapter_tags", "chapter_id", cid, tag)? { rep.tags_added += 1; } } }
                if b(&c, "played") {
                    let changed = conn.execute("UPDATE chapters SET played=1 WHERE id=?1 AND played=0", params![cid])?;
                    rep.played_marked += changed as i64;
                }
                if b(&c, "isFavorite") {
                    let changed = conn.execute("UPDATE chapters SET is_favorite=1 WHERE id=?1 AND is_favorite=0", params![cid])?;
                    rep.favorites_marked += changed as i64;
                }
                if fill_if_empty("chapters", "user_summary", cid, &s(&c, "userSummary"))? { rep.journal_fields_filled += 1; }
                if fill_if_empty("chapters", "takeaway", cid, &s(&c, "takeaway"))? { rep.journal_fields_filled += 1; }
                for n in arr(&c, "notes") {
                    let exists: i64 = conn.query_row(
                        "SELECT COUNT(*) FROM chapter_notes WHERE chapter_id=?1 AND position_secs=?2 AND body=?3 AND created_at=?4",
                        params![cid, i(&n,"positionSecs"), s(&n,"body"), i(&n,"createdAt")], |r| r.get(0))?;
                    if exists == 0 {
                        conn.execute("INSERT INTO chapter_notes(chapter_id, position_secs, body, created_at) VALUES (?1,?2,?3,?4)",
                            params![cid, i(&n,"positionSecs"), s(&n,"body"), i(&n,"createdAt")])?;
                        rep.notes_added += 1;
                    }
                }
                for bm in arr(&c, "bookmarks") {
                    let exists: i64 = conn.query_row(
                        "SELECT COUNT(*) FROM chapter_bookmarks WHERE chapter_id=?1 AND position_secs=?2 AND label=?3 AND created_at=?4",
                        params![cid, i(&bm,"positionSecs"), s(&bm,"label"), i(&bm,"createdAt")], |r| r.get(0))?;
                    if exists == 0 {
                        conn.execute("INSERT INTO chapter_bookmarks(chapter_id, position_secs, label, created_at) VALUES (?1,?2,?3,?4)",
                            params![cid, i(&bm,"positionSecs"), s(&bm,"label"), i(&bm,"createdAt")])?;
                        rep.bookmarks_added += 1;
                    }
                }
            }
        }
    }

    for al in arr(root, "tagAliases") {
        let changed = conn.execute("INSERT OR IGNORE INTO tag_aliases(alias, canonical) VALUES (?1,?2)", params![s(&al,"alias"), s(&al,"canonical")])?;
        let _ = changed; // aliases counted under tags_added is misleading; leave uncounted
    }
    for pr in arr(root, "tagParents") {
        conn.execute("INSERT OR IGNORE INTO tag_parents(child, parent) VALUES (?1,?2)", params![s(&pr,"child"), s(&pr,"parent")])?;
    }
    for col in arr(root, "collections") {
        let name = s(&col, "name");
        let exists: i64 = conn.query_row("SELECT COUNT(*) FROM smart_collections WHERE name=?1", params![name], |r| r.get(0))?;
        if exists == 0 {
            let pos: i64 = conn.query_row("SELECT COALESCE(MAX(position),-1)+1 FROM smart_collections", [], |r| r.get(0))?;
            conn.execute("INSERT INTO smart_collections(name, query, position, created_at) VALUES (?1,?2,?3,?4)",
                params![name, s(&col,"query"), pos, i(root,"exportedAt")])?;
            rep.collections_added += 1;
        }
    }
    for se in arr(root, "savedSearches") {
        let name = s(&se, "name");
        let exists: i64 = conn.query_row("SELECT COUNT(*) FROM saved_searches WHERE name=?1", params![name], |r| r.get(0))?;
        if exists == 0 {
            conn.execute("INSERT INTO saved_searches(name, query, created_at) VALUES (?1,?2,?3)",
                params![name, s(&se,"query"), i(root,"exportedAt")])?;
            rep.searches_added += 1;
        }
    }

    Ok(rep)
}

/// Validate `src` is a healthy SQLite DB no newer than we understand, then stage it
/// next to the live DB as `restore_pending.db`. The actual swap happens at the next
/// `db::open()` (see `apply_pending_restore`). NEVER touches the live DB here.
pub fn stage_db_restore(live_db_path: &str, src: &str) -> Result<(), String> {
    // 1. validate source (open read-only).
    let probe = Connection::open_with_flags(src, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("source is not a readable database: {e}"))?;
    let integrity: String = probe.query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|e| format!("integrity check failed: {e}"))?;
    if integrity != "ok" {
        return Err(format!("source failed integrity check: {integrity}"));
    }
    let uv: i64 = probe.query_row("PRAGMA user_version", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if uv > 7 {
        return Err(format!("source schema v{uv} is newer than this app (v7); upgrade the app first"));
    }
    drop(probe);
    // 2. stage beside the live DB (do NOT replace yet).
    let pending = pending_path(live_db_path);
    std::fs::copy(src, &pending).map_err(|e| format!("could not stage restore: {e}"))?;
    Ok(())
}

fn pending_path(live_db_path: &str) -> std::path::PathBuf {
    let p = std::path::Path::new(live_db_path);
    p.with_file_name("restore_pending.db")
}

/// Called at the TOP of db::open(), before any Connection is opened on the live DB.
/// If a staged restore exists, back up the current live DB (timestamped, recoverable)
/// then atomically rename the pending file into place. Best-effort + crash-safe:
/// the original is only renamed away AFTER the backup succeeds, and the pending file
/// is only removed by the successful rename — a crash at any point leaves a recoverable state.
pub fn apply_pending_restore(live_db_path: &str) {
    let pending = pending_path(live_db_path);
    if !pending.exists() {
        return;
    }
    let live = std::path::Path::new(live_db_path);
    // back up the current live DB first (only if it exists).
    if live.exists() {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let backup = live.with_file_name(format!("audioshelf.db.bak-{ts}"));
        if std::fs::rename(live, &backup).is_err() {
            // could not back up → DO NOT proceed (never destroy the original).
            return;
        }
    }
    // place the pending file as the live DB.
    if std::fs::rename(&pending, live).is_err() {
        // rename failed; leave pending in place for a future attempt. The backup (if made)
        // is still on disk and recoverable by the user.
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn import_merges_additively_without_deleting() {
        // source: a DB with curation
        let src = crate::db::open_at_version(7).unwrap();
        src.execute_batch(
            "INSERT INTO authors(id, folder_name, display_name, status) VALUES (1,'Jane','Jane','active');
             INSERT INTO works(id, author_id, base_title, sort_key, status) VALUES (1,1,'Cool','cool','active');
             INSERT INTO chapters(id, work_id, raw_filename, chapter_no, format, duration_secs, file_path, status, played, user_summary, takeaway, is_favorite) VALUES (1,1,'01.mp3',1,'mp3',60,'/01.mp3','active',1,'imported summary','',1);
             INSERT INTO work_tags(work_id, tag) VALUES (1,'cozy');
             INSERT INTO smart_collections(name, query, position, created_at) VALUES ('C','tag:cozy',0,1);",
        ).unwrap();
        let export = build_curation_export(&src, 1700000000000).unwrap();

        // dest: same library identities, no curation, plus a pre-existing summary that must NOT be clobbered
        let dest = crate::db::open_at_version(7).unwrap();
        dest.execute_batch(
            "INSERT INTO authors(id, folder_name, display_name, status) VALUES (1,'Jane','Jane','active');
             INSERT INTO works(id, author_id, base_title, sort_key, status) VALUES (1,1,'Cool','cool','active');
             INSERT INTO chapters(id, work_id, raw_filename, chapter_no, format, duration_secs, file_path, status, played, user_summary, takeaway, is_favorite) VALUES (1,1,'01.mp3',1,'mp3',60,'/01.mp3','active',0,'EXISTING',' ',0);",
        ).unwrap();

        let rep = apply_curation_import(&dest, &export).unwrap();
        assert_eq!(rep.tags_added, 1);
        assert_eq!(rep.played_marked, 1);
        assert_eq!(rep.favorites_marked, 1);
        assert_eq!(rep.collections_added, 1);
        // existing summary preserved (fill-if-empty did NOT clobber)
        let summary: String = dest.query_row("SELECT user_summary FROM chapters WHERE id=1", [], |r| r.get(0)).unwrap();
        assert_eq!(summary, "EXISTING");
        // played flipped to true (OR), never back to false
        let played: i64 = dest.query_row("SELECT played FROM chapters WHERE id=1", [], |r| r.get(0)).unwrap();
        assert_eq!(played, 1);
    }

    #[test]
    fn pending_restore_backs_up_then_swaps() {
        let dir = std::env::temp_dir().join(format!("ashm19r_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let live = dir.join("audioshelf.db");
        std::fs::write(&live, b"OLD").unwrap();
        let pending = dir.join("restore_pending.db");
        std::fs::write(&pending, b"NEW").unwrap();

        apply_pending_restore(live.to_str().unwrap());

        assert_eq!(std::fs::read(&live).unwrap(), b"NEW");      // swapped in
        assert!(!pending.exists());                              // consumed
        // a timestamped backup of OLD exists
        let has_backup = std::fs::read_dir(&dir).unwrap().filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().starts_with("audioshelf.db.bak-"));
        assert!(has_backup, "old DB should be backed up, not destroyed");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn export_captures_tags_played_and_collections() {
        let conn = crate::db::open_at_version(7).unwrap();
        conn.execute_batch(
            "INSERT INTO authors(id, folder_name, display_name, status) VALUES (1,'Jane','Jane Doe','active');
             INSERT INTO works(id, author_id, base_title, sort_key, status, chapter_sort) VALUES (1,1,'Cool','cool','active','title_asc');
             INSERT INTO work_tags(work_id, tag) VALUES (1,'cozy');
             INSERT INTO chapters(id, work_id, raw_filename, chapter_no, format, duration_secs, file_path, status, played, user_summary, takeaway, is_favorite) VALUES (1,1,'01.mp3',1,'mp3',60,'/01.mp3','active',1,'sum','take',1);
             INSERT INTO smart_collections(name, query, position, created_at) VALUES ('C','tag:cozy',0,1);",
        )
        .unwrap();
        let v = build_curation_export(&conn, 1700000000000).unwrap();
        let s = serde_json::to_string(&v).unwrap();
        assert!(s.contains("\"folderName\":\"Jane\""));
        assert!(s.contains("\"chapterSort\":\"title_asc\""));
        assert!(s.contains("\"played\":true"));
        assert!(s.contains("\"cozy\""));
        assert!(s.contains("\"query\":\"tag:cozy\""));
    }
}
