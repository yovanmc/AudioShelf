//! Resolver for the scoped-query DSL. Shared by advanced search, saved searches,
//! and smart collections. Read-only.

use crate::model::ScopedWork;
use crate::query::{CmpOp, ParsedQuery, StatusFilter};
use rusqlite::{params, Connection};

pub fn run_scoped_query(
    conn: &Connection,
    p: &ParsedQuery,
    cap: usize,
) -> rusqlite::Result<Vec<ScopedWork>> {
    // 1. candidate works by free text + tags (each tag AND-combined via EXISTS).
    let like = if p.text.trim().is_empty() {
        None
    } else {
        Some(format!("%{}%", p.text.trim().replace('%', "\\%").replace('_', "\\_")))
    };

    let mut sql = String::from(
        "SELECT w.id, w.base_title, a.id, COALESCE(a.display_name, a.folder_name)
         FROM works w JOIN authors a ON w.author_id=a.id
         WHERE w.status='active' AND a.status='active'",
    );
    let mut binds: Vec<rusqlite::types::Value> = Vec::new();
    if like.is_some() {
        sql.push_str(" AND w.base_title LIKE ? ESCAPE '\\'");
        binds.push(like.clone().unwrap().into());
    }
    // Each tag filter is treated as facet='tag' and resolved against the unified attach tables.
    for tag in &p.tags {
        sql.push_str(
            " AND EXISTS (SELECT 1 FROM metadata_terms mt
                          WHERE mt.facet='tag' AND mt.value=? AND (
                            EXISTS (SELECT 1 FROM work_metadata wm WHERE wm.work_id=w.id AND wm.term_id=mt.id)
                            OR EXISTS (SELECT 1 FROM chapter_metadata cm JOIN chapters mc ON cm.chapter_id=mc.id
                                       WHERE mc.work_id=w.id AND cm.term_id=mt.id)
                            OR EXISTS (SELECT 1 FROM author_metadata am WHERE am.author_id=a.id AND am.term_id=mt.id)))",
        );
        binds.push(tag.clone().into());
    }
    // Generic MetaFilter: each filter emits one EXISTS covering work, chapter, and author attach.
    for mf in &p.meta {
        sql.push_str(
            " AND EXISTS (SELECT 1 FROM metadata_terms mt
                          WHERE mt.facet=? AND mt.value=? AND (
                            EXISTS (SELECT 1 FROM work_metadata wm WHERE wm.work_id=w.id AND wm.term_id=mt.id)
                            OR EXISTS (SELECT 1 FROM chapter_metadata cm JOIN chapters mc ON cm.chapter_id=mc.id
                                       WHERE mc.work_id=w.id AND cm.term_id=mt.id)
                            OR EXISTS (SELECT 1 FROM author_metadata am WHERE am.author_id=a.id AND am.term_id=mt.id)))",
        );
        binds.push(mf.facet.clone().into());
        binds.push(mf.value.clone().into());
    }
    sql.push_str(" ORDER BY w.base_title");

    let mut stmt = conn.prepare(&sql)?;
    let rows: Vec<(i64, String, i64, String)> = stmt
        .query_map(rusqlite::params_from_iter(binds.iter()), |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })?
        .collect::<rusqlite::Result<_>>()?;

    // 2. per-candidate aggregates + duration/status filter + tags.
    let mut agg = conn.prepare(
        "SELECT COUNT(*), COALESCE(SUM(duration_secs),0), COALESCE(SUM(played),0)
         FROM chapters WHERE work_id=?1 AND status='active'",
    )?;
    let mut tagstmt = conn.prepare("SELECT tag FROM work_tags WHERE work_id=?1 ORDER BY tag")?;

    let mut out: Vec<ScopedWork> = Vec::new();
    for (work_id, base_title, author_id, author_name) in rows {
        let (chapter_count, total_secs, played_count): (i64, i64, i64) =
            agg.query_row(params![work_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        if chapter_count == 0 {
            continue;
        }
        if let Some(d) = &p.duration {
            let pass = match d.op {
                CmpOp::Lt => total_secs < d.secs,
                CmpOp::Le => total_secs <= d.secs,
                CmpOp::Gt => total_secs > d.secs,
                CmpOp::Ge => total_secs >= d.secs,
            };
            if !pass {
                continue;
            }
        }
        if let Some(s) = p.status {
            let pass = match s {
                StatusFilter::Unstarted => played_count == 0,
                StatusFilter::InProgress => played_count > 0 && played_count < chapter_count,
                StatusFilter::Done => played_count == chapter_count,
            };
            if !pass {
                continue;
            }
        }
        let tags: Vec<String> = tagstmt
            .query_map(params![work_id], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<_>>()?;
        out.push(ScopedWork {
            work_id,
            base_title,
            author_id,
            author_name,
            total_secs,
            chapter_count,
            played_count,
            tags,
        });
        if out.len() >= cap {
            break;
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::query::parse_query;

    /// Seed basic author/works/chapters using the current full schema (open_in_memory → v10).
    /// Tags are inserted into the unified metadata_terms+work_metadata tables (not legacy work_tags).
    fn seed(conn: &rusqlite::Connection) {
        conn.execute_batch(
            "INSERT INTO authors(id, folder_name, display_name, status) VALUES (1,'auth','Auth','active');
             INSERT INTO works(id, author_id, base_title, sort_key, status) VALUES
               (1,1,'Short Cozy','short cozy','active'), (2,1,'Long Epic','long epic','active');
             INSERT INTO chapters(id, work_id, raw_filename, chapter_no, format, duration_secs, file_path, status, played)
               VALUES
               (1,1,'a.mp3',1,'mp3',300,'/a.mp3','active',1),
               (2,1,'b.mp3',2,'mp3',300,'/b.mp3','active',0),
               (3,2,'c.mp3',1,'mp3',4000,'/c.mp3','active',1),
               (4,2,'d.mp3',2,'mp3',4000,'/d.mp3','active',1);",
        ).unwrap();
        // Attach a 'cozy' tag to work 1 via the unified tables.
        crate::commands::attach_value(conn, "work", 1, "tag", "cozy").unwrap();
    }

    #[test]
    fn tag_filter_matches_only_tagged_work() {
        // Uses open_in_memory (v10) because the unified EXISTS queries work_metadata.
        let conn = crate::db::open_in_memory().unwrap();
        seed(&conn);
        let r = run_scoped_query(&conn, &parse_query("tag:cozy"), 50).unwrap();
        assert_eq!(r.iter().map(|w| w.work_id).collect::<Vec<_>>(), vec![1]);
    }

    #[test]
    fn duration_filter_under_15m() {
        let conn = crate::db::open_in_memory().unwrap();
        seed(&conn);
        // work1 total=600s (<900), work2 total=8000s
        let r = run_scoped_query(&conn, &parse_query("duration:<15m"), 50).unwrap();
        assert_eq!(r.iter().map(|w| w.work_id).collect::<Vec<_>>(), vec![1]);
    }

    #[test]
    fn status_done_means_all_chapters_played() {
        let conn = crate::db::open_in_memory().unwrap();
        seed(&conn);
        let r = run_scoped_query(&conn, &parse_query("status:done"), 50).unwrap();
        assert_eq!(r.iter().map(|w| w.work_id).collect::<Vec<_>>(), vec![2]); // work2 fully played
    }

    #[test]
    fn status_unstarted_means_no_chapter_played() {
        let conn = crate::db::open_in_memory().unwrap();
        seed(&conn);
        // neither is fully unplayed (work1 has 1 played); add a clean work
        conn.execute_batch(
            "INSERT INTO works(id, author_id, base_title, sort_key, status) VALUES (3,1,'Fresh','fresh','active');
             INSERT INTO chapters(id, work_id, raw_filename, chapter_no, format, duration_secs, file_path, status, played)
               VALUES (5,3,'e.mp3',1,'mp3',100,'/e.mp3','active',0);",
        ).unwrap();
        let r = run_scoped_query(&conn, &parse_query("status:unplayed"), 50).unwrap();
        assert_eq!(r.iter().map(|w| w.work_id).collect::<Vec<_>>(), vec![3]);
    }

    #[test]
    fn scoped_query_filters_by_narrator() {
        // Requires v10 for label_types (is_valid_facet is DB-backed).
        let conn = crate::db::open_in_memory().unwrap();
        conn.execute("INSERT INTO authors(id, folder_name, display_name, status) VALUES (1,'a','A','active')", []).unwrap();
        // two works; only work 1's chapter carries the narrator.
        for w in 1..=2 {
            conn.execute("INSERT INTO works(id, author_id, base_title, sort_key, status) VALUES (?1,1,?2,?3,'active')",
                rusqlite::params![w, format!("W{w}"), format!("w{w}")]).unwrap();
            conn.execute("INSERT INTO chapters(id, work_id, file_path, raw_filename, chapter_no, format, duration_secs, played, status) VALUES (?1,?1,?2,'x.wav',1,'wav',5,0,'active')",
                rusqlite::params![w, format!("/{w}.wav")]).unwrap();
        }
        let t = crate::commands::attach_value(&conn, "chapter", 1, "narrator", "Roe").unwrap();
        let _ = t;
        let p = crate::query::parse_query("narrator:Roe");
        let out = run_scoped_query(&conn, &p, 50).unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].work_id, 1);
    }

    // ---- T4: unified EXISTS tests ----

    #[test]
    fn tag_filter_via_work_metadata_matches_tagged_work() {
        // Proves tag:x filter hits work_metadata (unified attach), not legacy work_tags.
        let conn = crate::db::open_in_memory().unwrap();
        conn.execute("INSERT INTO authors(id, folder_name, display_name, status) VALUES (1,'a','A','active')", []).unwrap();
        for w in 1..=2i64 {
            conn.execute("INSERT INTO works(id, author_id, base_title, sort_key, status) VALUES (?1,1,?2,?3,'active')",
                rusqlite::params![w, format!("W{w}"), format!("w{w}")]).unwrap();
            conn.execute("INSERT INTO chapters(id, work_id, file_path, raw_filename, chapter_no, format, duration_secs, played, status) VALUES (?1,?1,?2,'x.mp3',1,'mp3',100,0,'active')",
                rusqlite::params![w, format!("/{w}.mp3")]).unwrap();
        }
        // Attach tag 'cozy' to work 1 via unified model.
        crate::commands::attach_value(&conn, "work", 1, "tag", "cozy").unwrap();

        let out = run_scoped_query(&conn, &parse_query("tag:cozy"), 50).unwrap();
        assert_eq!(out.iter().map(|w| w.work_id).collect::<Vec<_>>(), vec![1]);
    }

    #[test]
    fn tag_filter_via_chapter_metadata_matches_parent_work() {
        // Proves tag:x filter on chapter_metadata surfaces the parent work.
        let conn = crate::db::open_in_memory().unwrap();
        conn.execute("INSERT INTO authors(id, folder_name, display_name, status) VALUES (1,'a','A','active')", []).unwrap();
        for w in 1..=2i64 {
            conn.execute("INSERT INTO works(id, author_id, base_title, sort_key, status) VALUES (?1,1,?2,?3,'active')",
                rusqlite::params![w, format!("W{w}"), format!("w{w}")]).unwrap();
            conn.execute("INSERT INTO chapters(id, work_id, file_path, raw_filename, chapter_no, format, duration_secs, played, status) VALUES (?1,?1,?2,'x.mp3',1,'mp3',100,0,'active')",
                rusqlite::params![w, format!("/{w}.mp3")]).unwrap();
        }
        // Attach tag 'intro' to chapter 1 (belongs to work 1) via unified model.
        crate::commands::attach_value(&conn, "chapter", 1, "tag", "intro").unwrap();

        let out = run_scoped_query(&conn, &parse_query("tag:intro"), 50).unwrap();
        assert_eq!(out.iter().map(|w| w.work_id).collect::<Vec<_>>(), vec![1]);
    }

    #[test]
    fn tag_filter_via_author_metadata_matches_all_works_by_author() {
        // Proves tag:x on author_metadata surfaces that author's works.
        let conn = crate::db::open_in_memory().unwrap();
        conn.execute("INSERT INTO authors(id, folder_name, display_name, status) VALUES (1,'a','A','active')", []).unwrap();
        conn.execute("INSERT INTO authors(id, folder_name, display_name, status) VALUES (2,'b','B','active')", []).unwrap();
        // Author 1 has work 1; author 2 has work 2.
        for (w, auth) in [(1i64, 1i64), (2, 2)] {
            conn.execute("INSERT INTO works(id, author_id, base_title, sort_key, status) VALUES (?1,?2,?3,?4,'active')",
                rusqlite::params![w, auth, format!("W{w}"), format!("w{w}")]).unwrap();
            conn.execute("INSERT INTO chapters(id, work_id, file_path, raw_filename, chapter_no, format, duration_secs, played, status) VALUES (?1,?1,?2,'x.mp3',1,'mp3',100,0,'active')",
                rusqlite::params![w, format!("/{w}.mp3")]).unwrap();
        }
        // Attach tag 'featured' to author 1 only.
        crate::commands::attach_value(&conn, "author", 1, "tag", "featured").unwrap();

        let out = run_scoped_query(&conn, &parse_query("tag:featured"), 50).unwrap();
        assert_eq!(out.iter().map(|w| w.work_id).collect::<Vec<_>>(), vec![1]);
    }

    #[test]
    fn generic_type_value_filter_matches_work_metadata() {
        // Proves a generic `format:podcast` MetaFilter hits work_metadata via unified EXISTS.
        let conn = crate::db::open_in_memory().unwrap();
        conn.execute("INSERT INTO authors(id, folder_name, display_name, status) VALUES (1,'a','A','active')", []).unwrap();
        for w in 1..=2i64 {
            conn.execute("INSERT INTO works(id, author_id, base_title, sort_key, status) VALUES (?1,1,?2,?3,'active')",
                rusqlite::params![w, format!("W{w}"), format!("w{w}")]).unwrap();
            conn.execute("INSERT INTO chapters(id, work_id, file_path, raw_filename, chapter_no, format, duration_secs, played, status) VALUES (?1,?1,?2,'x.mp3',1,'mp3',100,0,'active')",
                rusqlite::params![w, format!("/{w}.mp3")]).unwrap();
        }
        // Attach a custom facet 'format'='podcast' to work 1; this facet may not be in label_types
        // (insert it directly into metadata_terms + work_metadata to simulate a user-created type).
        conn.execute("INSERT OR IGNORE INTO metadata_terms(facet, value) VALUES ('format','podcast')", []).unwrap();
        let term_id: i64 = conn.query_row(
            "SELECT id FROM metadata_terms WHERE facet='format' AND value='podcast'", [], |r| r.get(0)).unwrap();
        conn.execute("INSERT OR IGNORE INTO work_metadata(work_id, term_id) VALUES (1, ?1)", rusqlite::params![term_id]).unwrap();

        let out = run_scoped_query(&conn, &parse_query("format:podcast"), 50).unwrap();
        assert_eq!(out.iter().map(|w| w.work_id).collect::<Vec<_>>(), vec![1]);
    }
}
