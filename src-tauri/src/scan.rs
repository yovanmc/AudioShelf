//! Scan a single root folder of `Author/` directories full of loose audio files
//! into the DB. Idempotent: re-scanning updates rather than duplicating.

use crate::grouping::{group_author, Work};
use crate::model::ScanResult;
use crate::natsort::natural_cmp;
use rusqlite::{params, Connection};
use std::path::Path;

const AUDIO_EXTS: &[&str] = &["mp3", "m4a", "aac", "mp4", "opus", "ogg", "flac", "wav"];

fn is_audio(ext: &str) -> bool {
    AUDIO_EXTS.contains(&ext.to_ascii_lowercase().as_str())
}

fn sorted_dirs(root: &Path) -> Vec<std::path::PathBuf> {
    let mut dirs: Vec<_> = std::fs::read_dir(root)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    dirs.sort_by(|a, b| natural_cmp(&a.to_string_lossy(), &b.to_string_lossy()));
    dirs
}

fn file_name(p: &Path) -> String {
    p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()
}

/// Probe duration in whole seconds; 0 on any failure.
fn probe_duration_secs(path: &Path) -> i64 {
    match lofty::read_from_path(path) {
        Ok(tagged) => {
            use lofty::file::AudioFile;
            tagged.properties().duration().as_secs() as i64
        }
        Err(_) => 0,
    }
}

pub fn scan_into(conn: &Connection, root: &Path) -> rusqlite::Result<ScanResult> {
    for author_path in sorted_dirs(root) {
        let folder = file_name(&author_path);
        conn.execute(
            "INSERT INTO authors(folder_name, status) VALUES (?1, 'active')
             ON CONFLICT(folder_name) DO UPDATE SET status='active'",
            params![folder],
        )?;
        let author_id: i64 = conn.query_row(
            "SELECT id FROM authors WHERE folder_name=?1",
            params![folder],
            |r| r.get(0),
        )?;

        // Collect audio files in this author dir (top-level only).
        let mut files: Vec<std::path::PathBuf> = std::fs::read_dir(&author_path)
            .into_iter()
            .flatten()
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.is_file()
                    && p.extension()
                        .map(|x| is_audio(&x.to_string_lossy()))
                        .unwrap_or(false)
            })
            .collect();
        files.sort_by(|a, b| natural_cmp(&a.to_string_lossy(), &b.to_string_lossy()));

        let stems: Vec<String> = files
            .iter()
            .map(|p| p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default())
            .collect();
        let works: Vec<Work> = group_author(&stems);

        for work in works {
            conn.execute(
                "INSERT INTO works(author_id, base_title, sort_key, status)
                 VALUES (?1, ?2, ?3, 'active')
                 ON CONFLICT(author_id, base_title) DO UPDATE SET status='active'",
                params![author_id, work.base_title, work.base_title.to_lowercase()],
            )?;
            let work_id: i64 = conn.query_row(
                "SELECT id FROM works WHERE author_id=?1 AND base_title=?2",
                params![author_id, work.base_title],
                |r| r.get(0),
            )?;

            for chapter in work.chapters {
                // Find the on-disk file whose stem matches this chapter.
                // Use original_stem (the verbatim input stem) for accurate lookup.
                let file = files.iter().find(|p| {
                    p.file_stem()
                        .map(|s| s.to_string_lossy() == chapter.original_stem)
                        .unwrap_or(false)
                });
                let Some(file) = file else { continue };
                let path_str = file.to_string_lossy().to_string();
                let raw = file_name(file);
                let format = file
                    .extension()
                    .map(|x| x.to_string_lossy().to_ascii_lowercase())
                    .unwrap_or_default();
                let duration = probe_duration_secs(file);
                upsert_chapter(conn, work_id, &path_str, &raw, chapter.chapter_no, &format, duration)?;
            }
        }
    }

    Ok(ScanResult {
        authors: count(conn, "authors"),
        works: count(conn, "works"),
        chapters: count(conn, "chapters"),
    })
}

fn upsert_chapter(
    conn: &Connection,
    work_id: i64,
    path: &str,
    raw: &str,
    chapter_no: u32,
    format: &str,
    duration: i64,
) -> rusqlite::Result<()> {
    // The UPSERT below is self-sufficient: on conflict it updates every column
    // EXCEPT `played`, so re-scanning preserves listening progress.
    conn.execute(
        "INSERT INTO chapters(work_id, file_path, raw_filename, chapter_no, format, duration_secs, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active')
         ON CONFLICT(file_path) DO UPDATE SET
           work_id=excluded.work_id,
           raw_filename=excluded.raw_filename,
           chapter_no=excluded.chapter_no,
           format=excluded.format,
           duration_secs=excluded.duration_secs,
           status='active'",
        params![work_id, path, raw, chapter_no as i64, format, duration],
    )?;
    Ok(())
}

fn count(conn: &Connection, table: &str) -> usize {
    conn.query_row(&format!("SELECT count(*) FROM {table} WHERE status='active'"), [], |r| {
        r.get::<_, i64>(0)
    })
    .unwrap_or(0) as usize
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
    fn scan_groups_files_into_works_and_chapters() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let author = root.join("Some Author");
        touch(&author.join("Cool Story.mp3"));
        touch(&author.join("Cool Story 2 the sequel.mp3"));
        touch(&author.join("Cool Story 3 finale.mp3"));
        touch(&author.join("Another Standalone Tale.wav"));

        let conn = open_in_memory().unwrap();
        let report = scan_into(&conn, root).unwrap();
        assert_eq!(report.authors, 1);
        assert_eq!(report.works, 2);
        assert_eq!(report.chapters, 4);
    }

    #[test]
    fn rescan_is_idempotent() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let author = root.join("A");
        touch(&author.join("Tale.mp3"));
        touch(&author.join("Tale 2.mp3"));

        let conn = open_in_memory().unwrap();
        let first = scan_into(&conn, root).unwrap();
        let second = scan_into(&conn, root).unwrap();
        assert_eq!(first, second);
        assert_eq!(second.chapters, 2);
    }
}
