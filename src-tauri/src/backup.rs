//! M19 backup/restore. Export = identity-keyed JSON + VACUUM-INTO DB snapshot.
//! Import = strictly additive merge. Restore = crash-safe staged swap at bootstrap.

use rusqlite::{params, Connection};
use serde_json::{json, Value};

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

#[cfg(test)]
mod tests {
    use super::*;

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
