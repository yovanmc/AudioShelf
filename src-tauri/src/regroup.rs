//! regroup.rs — apply per-chapter grouping overrides on top of the heuristic.
//! DB-only: reads each chapter's raw filename, recomputes the heuristic grouping,
//! overlays `grouping_overrides`, and rewrites work assignments. No disk access,
//! no duration re-probe. Idempotent. The ONLY override-aware regrouping path.

use crate::grouping::group_author;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;

fn stem_of(raw: &str) -> String {
    std::path::Path::new(raw)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// Recompute `author_id`'s work grouping from the heuristic + overrides.
pub fn regroup_author(conn: &Connection, author_id: i64) -> rusqlite::Result<()> {
    // 1. Load this author's active chapters.
    struct Ch { id: i64, path: String, raw: String }
    let chapters: Vec<Ch> = {
        let mut stmt = conn.prepare(
            "SELECT c.id, c.file_path, c.raw_filename
             FROM chapters c JOIN works w ON c.work_id = w.id
             WHERE w.author_id = ?1 AND c.status='active'",
        )?;
        let rows = stmt
            .query_map(params![author_id], |r| {
                Ok(Ch { id: r.get(0)?, path: r.get(1)?, raw: r.get(2)? })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    if chapters.is_empty() {
        return Ok(());
    }

    // 2. Heuristic baseline: original_stem -> (base_title, chapter_no).
    let stems: Vec<String> = chapters.iter().map(|c| stem_of(&c.raw)).collect();
    let mut heuristic: HashMap<String, (String, i64)> = HashMap::new();
    for w in group_author(&stems) {
        for ch in w.chapters {
            heuristic.insert(ch.original_stem.clone(), (w.base_title.clone(), ch.chapter_no as i64));
        }
    }

    // 3. Compute final (base, chapter_no) per chapter, overlaying overrides.
    struct Final { id: i64, base: String, no: i64 }
    let mut finals: Vec<Final> = Vec::with_capacity(chapters.len());
    {
        let mut ostmt =
            conn.prepare("SELECT base_title, chapter_no FROM grouping_overrides WHERE chapter_path=?1")?;
        for c in &chapters {
            let stem = stem_of(&c.raw);
            let (mut base, mut no) = heuristic.get(&stem).cloned().unwrap_or((stem.clone(), 1));
            let row: Option<(Option<String>, Option<i64>)> = ostmt
                .query_row(params![c.path], |r| Ok((r.get(0)?, r.get(1)?)))
                .optional()?;
            if let Some((ob, on)) = row {
                if let Some(b) = ob {
                    if !b.trim().is_empty() {
                        base = b.trim().to_string();
                    }
                }
                if let Some(n) = on {
                    no = n;
                }
            }
            finals.push(Final { id: c.id, base, no });
        }
    }

    // 4. Deactivate all the author's works, then reactivate the needed ones and
    //    reassign chapters. Works left with no active chapters stay inactive.
    conn.execute("UPDATE works SET status='inactive' WHERE author_id=?1", params![author_id])?;
    let mut base_to_work: HashMap<String, i64> = HashMap::new();
    for f in &finals {
        if !base_to_work.contains_key(&f.base) {
            conn.execute(
                "INSERT INTO works(author_id, base_title, sort_key, status)
                 VALUES (?1, ?2, ?3, 'active')
                 ON CONFLICT(author_id, base_title) DO UPDATE SET status='active'",
                params![author_id, f.base, f.base.to_lowercase()],
            )?;
            let id: i64 = conn.query_row(
                "SELECT id FROM works WHERE author_id=?1 AND base_title=?2",
                params![author_id, f.base],
                |r| r.get(0),
            )?;
            base_to_work.insert(f.base.clone(), id);
        }
        let wid = base_to_work[&f.base];
        conn.execute(
            "UPDATE chapters SET work_id=?2, chapter_no=?3 WHERE id=?1",
            params![f.id, wid, f.no],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::{query_author_detail, query_authors};
    use crate::db::open_in_memory;
    use crate::scan::scan_into;
    use std::fs::{self, File};
    use std::path::Path;

    fn touch(path: &Path) {
        if let Some(p) = path.parent() { fs::create_dir_all(p).unwrap(); }
        File::create(path).unwrap();
    }

    fn setup() -> (tempfile::TempDir, rusqlite::Connection, i64) {
        let tmp = tempfile::tempdir().unwrap();
        let author = tmp.path().join("Jane Doe");
        touch(&author.join("Cool Story.mp3"));
        touch(&author.join("Cool Story 2 the sequel.mp3"));
        touch(&author.join("Cool Story 3 finale.mp3"));
        touch(&author.join("Another Standalone Tale.mp3"));
        let conn = open_in_memory().unwrap();
        scan_into(&conn, tmp.path()).unwrap();
        let id = query_authors(&conn).unwrap()[0].id;
        (tmp, conn, id)
    }

    fn chapter_path(conn: &rusqlite::Connection, raw_like: &str) -> String {
        conn.query_row(
            "SELECT file_path FROM chapters WHERE raw_filename=?1",
            params![raw_like], |r| r.get(0)).unwrap()
    }

    #[test]
    fn baseline_grouping_is_two_works() {
        let (_t, conn, id) = setup();
        let d = query_author_detail(&conn, id).unwrap();
        assert_eq!(d.works.len(), 2);
    }

    #[test]
    fn override_merges_standalone_into_existing_work() {
        let (_t, conn, id) = setup();
        let path = chapter_path(&conn, "Another Standalone Tale.mp3");
        conn.execute(
            "INSERT INTO grouping_overrides(chapter_path, base_title, chapter_no) VALUES (?1,'Cool Story',4)",
            params![path]).unwrap();
        regroup_author(&conn, id).unwrap();

        let d = query_author_detail(&conn, id).unwrap();
        assert_eq!(d.works.len(), 1);
        let cool = &d.works[0];
        assert_eq!(cool.base_title, "Cool Story");
        assert_eq!(cool.chapters.len(), 4);
        assert_eq!(cool.chapters.last().unwrap().chapter_no, 4);
    }

    #[test]
    fn override_splits_a_chapter_into_a_new_work() {
        let (_t, conn, id) = setup();
        let path = chapter_path(&conn, "Cool Story 2 the sequel.mp3");
        conn.execute(
            "INSERT INTO grouping_overrides(chapter_path, base_title, chapter_no) VALUES (?1,'Sidequel',1)",
            params![path]).unwrap();
        regroup_author(&conn, id).unwrap();

        let d = query_author_detail(&conn, id).unwrap();
        // Cool Story (now 2), Another Standalone Tale (1), Sidequel (1) = 3 works.
        assert_eq!(d.works.len(), 3);
        let cool = d.works.iter().find(|w| w.base_title == "Cool Story").unwrap();
        assert_eq!(cool.chapters.len(), 2);
        assert!(d.works.iter().any(|w| w.base_title == "Sidequel" && w.chapters.len() == 1));
    }

    #[test]
    fn clearing_override_returns_to_heuristic() {
        let (_t, conn, id) = setup();
        let path = chapter_path(&conn, "Another Standalone Tale.mp3");
        conn.execute(
            "INSERT INTO grouping_overrides(chapter_path, base_title, chapter_no) VALUES (?1,'Cool Story',4)",
            params![path]).unwrap();
        regroup_author(&conn, id).unwrap();
        assert_eq!(query_author_detail(&conn, id).unwrap().works.len(), 1);

        conn.execute("DELETE FROM grouping_overrides WHERE chapter_path=?1", params![path]).unwrap();
        regroup_author(&conn, id).unwrap();
        let d = query_author_detail(&conn, id).unwrap();
        assert_eq!(d.works.len(), 2);
        let cool = d.works.iter().find(|w| w.base_title == "Cool Story").unwrap();
        assert_eq!(cool.chapters.len(), 3);
    }
}
