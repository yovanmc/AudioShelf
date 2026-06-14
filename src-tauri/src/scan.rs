//! Scan a single root folder of `Author/` directories full of loose audio files
//! into the DB. Idempotent: re-scanning updates rather than duplicating.
//! Incremental: files whose mtime+size are unchanged are skipped (no re-probe).
//! Transactional: each author folder is committed or rolled back independently.
//! Observable: progress callbacks + cancellation flag supported via `ScanOpts`.

use crate::grouping::{group_author, Work};
use crate::model::{ScanError, ScanProgress, ScanResult};
use crate::natsort::natural_cmp;
use crate::regroup::regroup_author;
use crate::transcripts::parse_srt_vtt;
use rusqlite::{params, Connection};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

const AUDIO_EXTS: &[&str] = &["mp3", "m4a", "aac", "mp4", "opus", "ogg", "flac", "wav"];

fn is_audio(ext: &str) -> bool {
    AUDIO_EXTS.contains(&ext.to_ascii_lowercase().as_str())
}

/// Read + naturally-sort the author subfolders. Returns an io::Error if the root is unreadable.
fn sorted_dirs(root: &Path) -> std::io::Result<Vec<std::path::PathBuf>> {
    let mut dirs: Vec<std::path::PathBuf> = Vec::new();
    for entry in std::fs::read_dir(root)? {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let p = entry.path();
        if p.is_dir() {
            dirs.push(p);
        }
    }
    dirs.sort_by(|a, b| natural_cmp(&a.to_string_lossy(), &b.to_string_lossy()));
    Ok(dirs)
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

/// Hooks the command layer passes in. Defaults make `scan_into` (tests) behave as before:
/// never cancel, no progress callback.
pub struct ScanOpts<'a> {
    /// Checked between authors; when true the scan stops early (cancelled).
    pub cancel: Option<&'a AtomicBool>,
    /// Called between authors with live progress (the command layer emits a Tauri event).
    pub progress: Option<&'a mut dyn FnMut(ScanProgress)>,
}

impl<'a> Default for ScanOpts<'a> {
    fn default() -> Self {
        ScanOpts { cancel: None, progress: None }
    }
}

/// Back-compat entry point used by tests and `fixture_scan.rs`: a full scan with no
/// cancellation and no progress reporting.
pub fn scan_into(conn: &Connection, root: &Path) -> rusqlite::Result<ScanResult> {
    scan_into_with(conn, root, &mut ScanOpts::default())
}

pub fn scan_into_with(
    conn: &Connection,
    root: &Path,
    opts: &mut ScanOpts,
) -> rusqlite::Result<ScanResult> {
    let generation = next_scan_generation(conn)?;
    let mut errors: Vec<ScanError> = Vec::new();
    let mut added = 0usize;
    let mut updated = 0usize;
    let mut skipped = 0usize;
    let mut cancelled = false;

    let author_dirs = match sorted_dirs(root) {
        Ok(d) => d,
        Err(e) => {
            errors.push(ScanError { path: root.to_string_lossy().to_string(), reason: e.to_string() });
            return Ok(finish_result(conn, added, updated, 0, skipped, errors, false));
        }
    };
    let authors_total = author_dirs.len();

    for (i, author_path) in author_dirs.into_iter().enumerate() {
        if let Some(flag) = opts.cancel.as_ref() {
            if flag.load(Ordering::Relaxed) {
                cancelled = true;
                break;
            }
        }
        let folder = file_name(&author_path);

        if let Err(e) = conn.execute_batch("BEGIN") {
            errors.push(ScanError { path: folder.clone(), reason: format!("begin: {e}") });
            continue;
        }
        let author_res = scan_author(
            conn,
            &author_path,
            &folder,
            generation,
            &mut added,
            &mut updated,
            &mut skipped,
            &mut errors,
        );
        match author_res {
            Ok(()) => {
                let _ = conn.execute_batch("COMMIT");
            }
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK");
                errors.push(ScanError { path: folder.clone(), reason: e.to_string() });
            }
        }

        if let Some(cb) = opts.progress.as_mut() {
            cb(ScanProgress {
                authors_done: i + 1,
                authors_total,
                current: folder.clone(),
                added,
                updated,
                skipped,
            });
        }
    }

    let mut removed = 0usize;
    if !cancelled {
        removed = sweep_deleted(conn, generation)?;
    }

    Ok(finish_result(conn, added, updated, removed, skipped, errors, cancelled))
}

/// Monotonic scan counter persisted in `settings`. Incremented once per scan; used to stamp
/// `chapters.last_seen_scan` so the deletion sweep can find rows not observed this scan.
fn next_scan_generation(conn: &Connection) -> rusqlite::Result<i64> {
    let current: i64 = conn
        .query_row(
            "SELECT value FROM settings WHERE key='scan_generation'",
            [],
            |r| {
                let v: String = r.get(0)?;
                Ok(v.parse::<i64>().unwrap_or(0))
            },
        )
        .unwrap_or(0);
    let next = current + 1;
    conn.execute(
        "INSERT OR REPLACE INTO settings(key, value) VALUES('scan_generation', ?1)",
        params![next.to_string()],
    )?;
    Ok(next)
}

/// Scan one author folder. Errors here roll back only this author's transaction.
#[allow(clippy::too_many_arguments)]
fn scan_author(
    conn: &Connection,
    author_path: &Path,
    folder: &str,
    generation: i64,
    added: &mut usize,
    updated: &mut usize,
    skipped: &mut usize,
    errors: &mut Vec<ScanError>,
) -> rusqlite::Result<()> {
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

    let mut files: Vec<std::path::PathBuf> = Vec::new();
    match std::fs::read_dir(author_path) {
        Ok(rd) => {
            for entry in rd {
                let entry = match entry {
                    Ok(e) => e,
                    Err(_) => continue,
                };
                let p = entry.path();
                if p.is_file()
                    && p.extension()
                        .map(|x| is_audio(&x.to_string_lossy()))
                        .unwrap_or(false)
                {
                    files.push(p);
                }
            }
        }
        Err(e) => {
            errors.push(ScanError { path: folder.to_string(), reason: e.to_string() });
            return Ok(());
        }
    }
    files.sort_by(|a, b| natural_cmp(&a.to_string_lossy(), &b.to_string_lossy()));

    use std::collections::HashMap;
    let mut by_stem: HashMap<String, &std::path::PathBuf> = HashMap::with_capacity(files.len());
    for p in &files {
        if let Some(s) = p.file_stem() {
            by_stem.insert(s.to_string_lossy().to_string(), p);
        }
    }

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
            let Some(file) = by_stem.get(chapter.original_stem.as_str()).copied() else {
                continue;
            };
            let path_str = file.to_string_lossy().to_string();

            let (mtime, size) = file_stats(file);

            let existing: Option<(i64, i64, i64)> = conn
                .query_row(
                    "SELECT id, file_mtime, file_size FROM chapters WHERE file_path=?1",
                    params![path_str],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .ok();

            let chapter_id: i64 = match existing {
                Some((id, old_mtime, old_size))
                    if old_mtime == mtime && old_size == size && mtime != 0 =>
                {
                    conn.execute(
                        "UPDATE chapters SET last_seen_scan=?1, status='active' WHERE id=?2",
                        params![generation, id],
                    )?;
                    *skipped += 1;
                    id
                }
                other => {
                    let raw = file_name(file);
                    let format = file
                        .extension()
                        .map(|x| x.to_string_lossy().to_ascii_lowercase())
                        .unwrap_or_default();
                    let duration = probe_duration_secs(file);
                    upsert_chapter(
                        conn,
                        work_id,
                        &path_str,
                        &raw,
                        chapter.chapter_no,
                        &format,
                        duration,
                        mtime,
                        size,
                        generation,
                    )?;
                    if other.is_some() {
                        *updated += 1;
                    } else {
                        *added += 1;
                    }
                    conn.query_row(
                        "SELECT id FROM chapters WHERE file_path=?1",
                        params![path_str],
                        |r| r.get(0),
                    )?
                }
            };

            ingest_sidecar_transcript(conn, chapter_id, file)?;
        }
    }

    // Always regroup: grouping_overrides may have changed between scans even if no
    // files changed on disk. This is DB-only (no disk access) so it's cheap.
    regroup_author(conn, author_id)?;
    Ok(())
}

/// (mtime_secs_since_epoch, size_bytes); (0, 0) if metadata is unreadable.
fn file_stats(path: &Path) -> (i64, i64) {
    match std::fs::metadata(path) {
        Ok(md) => {
            let size = md.len() as i64;
            let mtime = md
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            (mtime, size)
        }
        Err(_) => (0, 0),
    }
}

/// Soft-delete (status='inactive') every active chapter not observed this generation, then
/// cascade to works/authors with no remaining active children. NEVER deletes rows or files
/// (recoverable).
fn sweep_deleted(conn: &Connection, generation: i64) -> rusqlite::Result<usize> {
    let removed = conn.execute(
        "UPDATE chapters SET status='inactive' WHERE status='active' AND last_seen_scan < ?1",
        params![generation],
    )?;
    conn.execute(
        "UPDATE works SET status='inactive'
         WHERE status='active'
           AND NOT EXISTS (SELECT 1 FROM chapters c WHERE c.work_id=works.id AND c.status='active')",
        [],
    )?;
    conn.execute(
        "UPDATE authors SET status='inactive'
         WHERE status='active'
           AND NOT EXISTS (SELECT 1 FROM works w WHERE w.author_id=authors.id AND w.status='active')",
        [],
    )?;
    Ok(removed)
}

fn finish_result(
    conn: &Connection,
    added: usize,
    updated: usize,
    removed: usize,
    skipped: usize,
    errors: Vec<ScanError>,
    cancelled: bool,
) -> ScanResult {
    ScanResult {
        authors: count(conn, "authors"),
        works: count(conn, "works"),
        chapters: count(conn, "chapters"),
        added,
        updated,
        removed,
        skipped,
        errors,
        cancelled,
    }
}

/// Check for a `.srt` or `.vtt` sidecar next to the audio file (same stem), parse it,
/// and upsert the plain text into the `transcripts` table. READ-ONLY on disk.
fn ingest_sidecar_transcript(
    conn: &Connection,
    chapter_id: i64,
    audio_path: &Path,
) -> rusqlite::Result<()> {
    let stem = match audio_path.file_stem() {
        Some(s) => s.to_string_lossy().to_string(),
        None => return Ok(()),
    };
    let parent = match audio_path.parent() {
        Some(p) => p,
        None => return Ok(()),
    };

    for ext in &["srt", "vtt"] {
        let candidate = parent.join(format!("{stem}.{ext}"));
        if candidate.is_file() {
            let raw = match std::fs::read_to_string(&candidate) {
                Ok(s) => s,
                Err(_) => continue, // skip unreadable sidecar
            };
            let content = parse_srt_vtt(&raw);
            let source_path = candidate.to_string_lossy().to_string();
            conn.execute(
                "INSERT OR REPLACE INTO transcripts(chapter_id, source_path, content)
                 VALUES (?1, ?2, ?3)",
                params![chapter_id, source_path, content],
            )?;
            // Use the first sidecar found (prefer .srt over .vtt).
            break;
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn upsert_chapter(
    conn: &Connection,
    work_id: i64,
    path: &str,
    raw: &str,
    chapter_no: u32,
    format: &str,
    duration: i64,
    mtime: i64,
    size: i64,
    generation: i64,
) -> rusqlite::Result<()> {
    // The UPSERT below is self-sufficient: on conflict it updates every column
    // EXCEPT `played`, so re-scanning preserves listening progress.
    conn.execute(
        "INSERT INTO chapters(work_id, file_path, raw_filename, chapter_no, format, duration_secs,
                              status, file_mtime, file_size, last_seen_scan)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, ?8, ?9)
         ON CONFLICT(file_path) DO UPDATE SET
           work_id=excluded.work_id,
           raw_filename=excluded.raw_filename,
           chapter_no=excluded.chapter_no,
           format=excluded.format,
           duration_secs=excluded.duration_secs,
           status='active',
           file_mtime=excluded.file_mtime,
           file_size=excluded.file_size,
           last_seen_scan=excluded.last_seen_scan",
        params![work_id, path, raw, chapter_no as i64, format, duration, mtime, size, generation],
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
    use std::fs;

    fn touch(path: &std::path::Path) {
        if let Some(p) = path.parent() {
            fs::create_dir_all(p).unwrap();
        }
        std::fs::write(path, b"x").unwrap();
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
    fn scan_reapplies_grouping_overrides() {
        let tmp = tempfile::tempdir().unwrap();
        let author = tmp.path().join("A");
        touch(&author.join("Tale.mp3"));
        touch(&author.join("Other.mp3"));
        let conn = open_in_memory().unwrap();
        scan_into(&conn, tmp.path()).unwrap();
        // Two standalone works initially.
        assert_eq!(count(&conn, "works"), 2);

        // Override "Other.mp3" to merge into "Tale".
        let path: String = conn
            .query_row(
                "SELECT file_path FROM chapters WHERE raw_filename='Other.mp3'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        conn.execute(
            "INSERT INTO grouping_overrides(chapter_path, base_title, chapter_no) VALUES (?1,'Tale',2)",
            params![path],
        )
        .unwrap();

        // A fresh scan must re-apply the override (not just the regroup command).
        scan_into(&conn, tmp.path()).unwrap();
        assert_eq!(count(&conn, "works"), 1);
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
        assert_eq!(
            (first.authors, first.works, first.chapters),
            (second.authors, second.works, second.chapters)
        );
        assert_eq!(second.chapters, 2);
        assert_eq!(second.added, 0);
        assert_eq!(second.skipped, 2);
    }

    /// Write a small text file with the given content.
    fn write_file(path: &std::path::Path, content: &str) {
        if let Some(p) = path.parent() {
            fs::create_dir_all(p).unwrap();
        }
        std::fs::write(path, content).unwrap();
    }

    #[test]
    fn sidecar_srt_is_ingested_and_audio_counts_unchanged() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let author = root.join("Author A");
        // Audio file.
        touch(&author.join("Chapter One.mp3"));
        // Sidecar SRT next to it.
        write_file(
            &author.join("Chapter One.srt"),
            "1\n00:00:01,000 --> 00:00:04,000\nHello from SRT.\n\n2\n00:00:05,000 --> 00:00:08,000\nSecond line.\n",
        );

        let conn = open_in_memory().unwrap();
        let report = scan_into(&conn, root).unwrap();
        // Counts must be unchanged (.srt must NOT be counted as a chapter).
        assert_eq!(report.authors, 1, "authors");
        assert_eq!(report.works, 1, "works");
        assert_eq!(report.chapters, 1, "chapters — .srt must not add a chapter");

        // Transcript row must exist.
        let content: String = conn
            .query_row("SELECT content FROM transcripts LIMIT 1", [], |r| r.get(0))
            .unwrap();
        assert!(content.contains("Hello from SRT."), "transcript content: {content}");
        assert!(content.contains("Second line."), "transcript content: {content}");
        // Timestamps must be stripped.
        assert!(!content.contains("-->"), "timestamps must be stripped: {content}");
    }

    #[test]
    fn sidecar_vtt_is_ingested() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let author = root.join("Author B");
        touch(&author.join("Part One.mp3"));
        write_file(
            &author.join("Part One.vtt"),
            "WEBVTT\n\n00:00.000 --> 00:04.000\nVTT cue text.\n",
        );

        let conn = open_in_memory().unwrap();
        let report = scan_into(&conn, root).unwrap();
        assert_eq!(report.chapters, 1, "chapters — .vtt must not add a chapter");

        let content: String = conn
            .query_row("SELECT content FROM transcripts LIMIT 1", [], |r| r.get(0))
            .unwrap();
        assert!(content.contains("VTT cue text."), "transcript content: {content}");
    }

    #[test]
    fn no_sidecar_leaves_transcripts_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let author = root.join("Author C");
        touch(&author.join("Solo.mp3"));

        let conn = open_in_memory().unwrap();
        let report = scan_into(&conn, root).unwrap();
        assert_eq!(report.chapters, 1);

        let tc: i64 = conn
            .query_row("SELECT count(*) FROM transcripts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(tc, 0, "no transcript row when no sidecar exists");
    }

    #[test]
    fn srt_and_vtt_files_alone_do_not_add_chapters() {
        // Drop .srt and .vtt files into an author dir with no audio — the scan should
        // produce 0 chapters (those extensions are not audio).
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let author = root.join("Author D");
        write_file(&author.join("Transcript.srt"), "1\n00:00:00,000 --> 00:00:01,000\nText.\n");
        write_file(&author.join("Transcript.vtt"), "WEBVTT\n\n00:00.000 --> 00:01.000\nText.\n");

        let conn = open_in_memory().unwrap();
        let report = scan_into(&conn, root).unwrap();
        assert_eq!(report.chapters, 0, "srt/vtt alone must not add chapters");
    }

    #[test]
    fn deletion_marks_chapters_inactive_recoverably() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let author = root.join("A");
        touch(&author.join("Tale.mp3"));
        touch(&author.join("Tale 2.mp3"));
        let conn = open_in_memory().unwrap();
        let first = scan_into(&conn, root).unwrap();
        assert_eq!(first.chapters, 2);

        std::fs::remove_file(author.join("Tale 2.mp3")).unwrap();
        let second = scan_into(&conn, root).unwrap();
        assert_eq!(second.removed, 1, "one chapter removed");
        assert_eq!(second.chapters, 1, "active count drops to 1");

        let total: i64 =
            conn.query_row("SELECT count(*) FROM chapters", [], |r| r.get(0)).unwrap();
        assert_eq!(total, 2, "row retained (inactive), not deleted");

        touch(&author.join("Tale 2.mp3"));
        let third = scan_into(&conn, root).unwrap();
        assert_eq!(third.chapters, 2, "reappeared file reactivates");
    }

    #[test]
    fn whole_author_deletion_cascades_to_inactive() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("Gone").join("Only.mp3"));
        touch(&root.join("Stays").join("Keep.mp3"));
        let conn = open_in_memory().unwrap();
        let first = scan_into(&conn, root).unwrap();
        assert_eq!(first.authors, 2);

        std::fs::remove_dir_all(root.join("Gone")).unwrap();
        let second = scan_into(&conn, root).unwrap();
        assert_eq!(second.authors, 1, "deleted author folder cascades to inactive");
        assert_eq!(second.works, 1);
        assert_eq!(second.chapters, 1);
    }

    #[test]
    fn unchanged_rescan_skips_without_reprobe() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let author = root.join("A");
        touch(&author.join("Tale.mp3"));
        let conn = open_in_memory().unwrap();
        scan_into(&conn, root).unwrap();
        let second = scan_into(&conn, root).unwrap();
        assert_eq!(second.added, 0);
        assert_eq!(second.updated, 0);
        assert_eq!(second.skipped, 1);
    }

    #[test]
    fn cancel_between_authors_stops_early_and_keeps_done_work() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("A").join("a.mp3"));
        touch(&root.join("B").join("b.mp3"));
        let conn = open_in_memory().unwrap();
        let flag = AtomicBool::new(false);
        let mut first_seen = false;
        let mut cb = |_p: crate::model::ScanProgress| {
            if !first_seen {
                first_seen = true;
                flag.store(true, Ordering::Relaxed);
            }
        };
        let mut opts = ScanOpts { cancel: Some(&flag), progress: Some(&mut cb) };
        let res = scan_into_with(&conn, root, &mut opts).unwrap();
        assert!(res.cancelled, "scan reports cancelled");
        assert!(res.authors >= 1);
        assert_eq!(res.removed, 0);
    }
}
