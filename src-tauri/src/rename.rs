//! rename.rs — opt-in, defensive batch rename of audio files to canonical names.
//! Pure planning + crash-safe execution + tolerant undo. The ONLY module that
//! mutates the user's audio files, and only when explicitly invoked.

/// Replace Windows-illegal and control characters with spaces, collapse runs of
/// whitespace, and trim. Never returns a name with leading/trailing spaces.
pub fn sanitize(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| if "<>:\"/\\|?*".contains(c) || c.is_control() { ' ' } else { c })
        .collect();
    cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Canonical filename: sanitized base title, a space + chapter number when >= 2,
/// then `.<ext>` using the original extension verbatim (case preserved).
pub fn canonical_name(base_title: &str, chapter_no: i64, ext: &str) -> String {
    let safe = sanitize(base_title);
    let stem = if chapter_no >= 2 { format!("{safe} {chapter_no}") } else { safe };
    if ext.is_empty() { stem } else { format!("{stem}.{ext}") }
}

use rusqlite::Connection;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ItemStatus {
    Ok,
    Noop,
    Conflict,
}

#[derive(Debug, Clone)]
pub struct PlanItem {
    pub chapter_id: i64,
    pub author_name: String,
    pub base_title: String,
    pub dir: String,        // directory holding the file
    pub from_path: String,  // current absolute path
    pub from_name: String,  // current filename (with ext)
    pub to_name: String,    // proposed filename (with ext)
    pub to_path: String,    // proposed absolute path (dir + to_name)
    pub status: ItemStatus,
    pub conflict_reason: Option<String>,
}

fn ext_of(name: &str) -> String {
    Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// Build the rename plan for every active chapter in the library.
pub fn build_plan(conn: &Connection) -> rusqlite::Result<Vec<PlanItem>> {
    let mut stmt = conn.prepare(
        "SELECT c.id, c.file_path, c.raw_filename, c.chapter_no,
                w.base_title, COALESCE(a.display_name, a.folder_name)
         FROM chapters c
         JOIN works w ON c.work_id = w.id
         JOIN authors a ON w.author_id = a.id
         WHERE c.status='active'",
    )?;
    let mut items: Vec<PlanItem> = stmt
        .query_map([], |r| {
            let file_path: String = r.get(1)?;
            let raw: String = r.get(2)?;
            let chapter_no: i64 = r.get(3)?;
            let base_title: String = r.get(4)?;
            let author_name: String = r.get(5)?;
            let dir = Path::new(&file_path)
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let to_name = canonical_name(&base_title, chapter_no, &ext_of(&raw));
            let to_path = Path::new(&dir).join(&to_name).to_string_lossy().to_string();
            Ok(PlanItem {
                chapter_id: r.get(0)?,
                author_name,
                base_title,
                dir,
                from_path: file_path,
                from_name: raw,
                to_name,
                to_path,
                status: ItemStatus::Ok,
                conflict_reason: None,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;

    classify(&mut items);
    Ok(items)
}

/// Assign Noop/Conflict/Ok. Pure given the items + the on-disk existence check.
fn classify(items: &mut [PlanItem]) {
    use std::collections::HashMap;
    // Count proposed targets per (dir, lowercased name) to detect in-batch duplicates.
    let mut target_counts: HashMap<(String, String), usize> = HashMap::new();
    for it in items.iter() {
        let key = (it.dir.to_lowercase(), it.to_name.to_lowercase());
        *target_counts.entry(key).or_insert(0) += 1;
    }
    // Set of current source paths (lowercased) so a target that maps onto another
    // file's source is treated as occupied.
    let sources: std::collections::HashSet<String> =
        items.iter().map(|i| i.from_path.to_lowercase()).collect();

    for it in items.iter_mut() {
        if it.to_name.eq_ignore_ascii_case(&it.from_name) {
            it.status = ItemStatus::Noop;
            continue;
        }
        let dup = target_counts
            .get(&(it.dir.to_lowercase(), it.to_name.to_lowercase()))
            .copied()
            .unwrap_or(0)
            > 1;
        if dup {
            it.status = ItemStatus::Conflict;
            it.conflict_reason = Some("two files would share this name".into());
            continue;
        }
        // Occupied on disk by a file that is not this item's own source.
        let occupied_on_disk = Path::new(&it.to_path).exists()
            && !it.to_path.eq_ignore_ascii_case(&it.from_path);
        // Occupied by another chapter's current source path (covers files the plan
        // is also moving but not via this exact target).
        let occupied_by_source = sources.contains(&it.to_path.to_lowercase())
            && !it.to_path.eq_ignore_ascii_case(&it.from_path);
        if occupied_on_disk || occupied_by_source {
            it.status = ItemStatus::Conflict;
            it.conflict_reason = Some("a file with the target name already exists".into());
            continue;
        }
        it.status = ItemStatus::Ok;
    }
}

use serde::Serialize;
use std::io::Write;

/// One completed-intent record in the JSONL manifest.
#[derive(Serialize, serde::Deserialize, Debug, Clone)]
pub struct ManifestEntry {
    pub chapter_id: i64,
    pub from_path: String,
    pub to_path: String,
    pub from_name: String,
    pub to_name: String,
}

#[derive(Debug)]
pub struct ExecOutcome {
    pub renamed_count: usize,
    pub failures: Vec<(String, String)>, // (from_path, error)
    pub manifest_path: String,
}

/// Rename the given chapter ids (only those still classified Ok). Crash-safe:
/// each intended op is appended+flushed to the manifest BEFORE the disk rename,
/// so undo can recover regardless of where a crash lands. Items are independent;
/// a failure is recorded and the batch continues.
pub fn execute(
    conn: &Connection,
    chapter_ids: &[i64],
    manifest_dir: &Path,
    now_ms: i64,
) -> rusqlite::Result<ExecOutcome> {
    let plan = build_plan(conn)?;
    let wanted: std::collections::HashSet<i64> = chapter_ids.iter().copied().collect();
    let todo: Vec<PlanItem> = plan
        .into_iter()
        .filter(|i| i.status == ItemStatus::Ok && wanted.contains(&i.chapter_id))
        .collect();

    std::fs::create_dir_all(manifest_dir).ok();
    let manifest_path = manifest_dir.join(format!("{now_ms}.jsonl"));
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&manifest_path)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

    let mut renamed_count = 0usize;
    let mut failures: Vec<(String, String)> = Vec::new();

    for it in todo {
        // Re-validate at execution time (TOCTOU guard).
        if !Path::new(&it.from_path).exists() {
            failures.push((it.from_path.clone(), "source no longer exists".into()));
            continue;
        }
        if Path::new(&it.to_path).exists() {
            failures.push((it.from_path.clone(), "target appeared before rename".into()));
            continue;
        }
        // 1) record intent + flush
        let entry = ManifestEntry {
            chapter_id: it.chapter_id,
            from_path: it.from_path.clone(),
            to_path: it.to_path.clone(),
            from_name: it.from_name.clone(),
            to_name: it.to_name.clone(),
        };
        let line = serde_json::to_string(&entry).unwrap();
        if let Err(e) = writeln!(file, "{line}").and_then(|_| file.flush()) {
            failures.push((it.from_path.clone(), format!("manifest write failed: {e}")));
            continue;
        }
        // 2) rename on disk
        if let Err(e) = std::fs::rename(&it.from_path, &it.to_path) {
            failures.push((it.from_path.clone(), format!("rename failed: {e}")));
            continue;
        }
        // 3) update DB
        conn.execute(
            "UPDATE chapters SET file_path=?2, raw_filename=?3 WHERE id=?1",
            rusqlite::params![it.chapter_id, it.to_path, it.to_name],
        )?;
        renamed_count += 1;
    }

    Ok(ExecOutcome {
        renamed_count,
        failures,
        manifest_path: manifest_path.to_string_lossy().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use std::fs::{self, File};
    use std::path::Path;

    fn touch(path: &Path) {
        if let Some(p) = path.parent() { fs::create_dir_all(p).unwrap(); }
        File::create(path).unwrap();
    }

    #[test]
    fn sanitize_strips_illegal_and_collapses_space() {
        assert_eq!(sanitize("Cool: Story"), "Cool Story");
        assert_eq!(sanitize("a/b\\c"), "a b c");
        assert_eq!(sanitize("  pad  me  "), "pad me");
    }

    #[test]
    fn canonical_name_uses_chapter_and_ext() {
        assert_eq!(canonical_name("Cool Story", 1, "mp3"), "Cool Story.mp3");
        assert_eq!(canonical_name("Cool Story", 2, "mp3"), "Cool Story 2.mp3");
        assert_eq!(canonical_name("Area 51", 1, "wav"), "Area 51.wav");
        assert_eq!(canonical_name("Cool Story", 3, "MP3"), "Cool Story 3.MP3");
    }

    #[test]
    fn build_plan_classifies_ok_noop_and_conflict() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let author = root.join("Jane Doe");
        touch(&author.join("Cool Story.mp3"));                 // -> noop
        touch(&author.join("Cool Story 2 the sequel.mp3"));    // -> "Cool Story 2.mp3" (ok)
        // A pre-existing file occupying a future target makes a conflict:
        touch(&author.join("Tale 2 part two.mp3"));            // -> wants "Tale 2.mp3"
        touch(&author.join("Tale 2.mp3"));                     // already exists -> "Tale 2 part two" conflicts
        let conn = open_in_memory().unwrap();
        crate::scan::scan_into(&conn, root).unwrap();

        let plan = super::build_plan(&conn).unwrap();
        let by_from = |name: &str| plan.iter().find(|i| i.from_name == name).unwrap().clone();

        assert_eq!(by_from("Cool Story.mp3").status, super::ItemStatus::Noop);
        let ok = by_from("Cool Story 2 the sequel.mp3");
        assert_eq!(ok.status, super::ItemStatus::Ok);
        assert_eq!(ok.to_name, "Cool Story 2.mp3");
        assert_eq!(by_from("Tale 2 part two.mp3").status, super::ItemStatus::Conflict);
    }

    #[test]
    fn build_plan_flags_duplicate_targets_in_same_dir_as_conflict() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let author = root.join("A");
        // Two singletons whose sanitized names coincide.
        // "My  Tale.mp3" (double-space) sanitizes to "My Tale.mp3", which already
        // exists on disk -> conflict via occupied_on_disk.
        // (Windows NTFS: colons denote ADS so we use double-space instead.)
        touch(&author.join("My  Tale.mp3"));   // sanitize -> "My Tale.mp3"
        touch(&author.join("My Tale.mp3"));     // already canonical
        let conn = open_in_memory().unwrap();
        crate::scan::scan_into(&conn, root).unwrap();

        let plan = super::build_plan(&conn).unwrap();
        // "My  Tale.mp3" wants "My Tale.mp3" which already exists on disk -> conflict.
        let item = plan.iter().find(|i| i.from_name == "My  Tale.mp3").unwrap();
        assert_eq!(item.status, super::ItemStatus::Conflict);
    }

    #[test]
    fn execute_renames_ok_items_writes_manifest_and_updates_db() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let author = root.join("Jane Doe");
        touch(&author.join("Cool Story.mp3"));
        touch(&author.join("Cool Story 2 the sequel.mp3"));
        let conn = open_in_memory().unwrap();
        crate::scan::scan_into(&conn, root).unwrap();

        let manifests = tmp.path().join("manifests");
        let plan = super::build_plan(&conn).unwrap();
        let ok_ids: Vec<i64> = plan.iter()
            .filter(|i| i.status == super::ItemStatus::Ok)
            .map(|i| i.chapter_id).collect();

        let result = super::execute(&conn, &ok_ids, &manifests, 1_700_000_000_000).unwrap();
        assert_eq!(result.renamed_count, 1);
        assert!(result.failures.is_empty());

        // Disk: new name exists, old name gone.
        assert!(author.join("Cool Story 2.mp3").exists());
        assert!(!author.join("Cool Story 2 the sequel.mp3").exists());
        // DB: file_path/raw_filename updated.
        let raw: String = conn.query_row(
            "SELECT raw_filename FROM chapters WHERE raw_filename='Cool Story 2.mp3'",
            [], |r| r.get(0)).unwrap();
        assert_eq!(raw, "Cool Story 2.mp3");
        // Manifest exists and has one line.
        let manifest = std::fs::read_to_string(&result.manifest_path).unwrap();
        assert_eq!(manifest.lines().count(), 1);
    }
}
