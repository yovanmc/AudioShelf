# AudioShelf — Milestone 4: Opt-in Rename Tool — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A separate, explicitly-triggered screen that previews a diff of current → canonical filenames, renames the selected files defensively on confirmation, writes a crash-safe undo manifest, and can roll the batch back — all opt-in, with the app fully usable without it.

**Architecture:** A new pure-core Rust module `rename.rs` computes the rename plan (canonical name per chapter + conflict classification) from the existing DB, then executes renames defensively: it appends each intended op to a JSONL manifest *before* touching disk, performs `fs::rename`, then updates `chapters.file_path`/`raw_filename`. Undo is **tolerant** (only reverses an entry when the new path exists and the original is free), so a crash in any order is recoverable. The front-end adds a presentational `RenameView` (preview table, conflict badges, confirm, post-apply Undo) wired through `App.tsx`. A `rename` harness walkthrough performs a full apply→undo round-trip, leaving the fixture pristine.

**Tech Stack:** Rust (rusqlite, serde, serde_json), React 18 + TS, Vitest. **New dependency:** `serde_json` (for the manifest) — already transitively present via Tauri, add as a direct dep.

**Reference (existing shapes this builds on):**
- `src-tauri/src/db.rs` — `chapters(id, work_id, file_path UNIQUE, raw_filename, chapter_no, format, duration_secs, played, status)`, `works(id, author_id, base_title, ...)`, `authors(id, folder_name, display_name)`. **No schema change.**
- `src-tauri/src/commands.rs` — `DbState(pub Mutex<Connection>)`, `init_db`, `#[tauri::command]` pattern returning `Result<_, String>`, `pub(crate)` helpers + `#[cfg(test)] mod tests` using `tempfile::tempdir()` + `db::open_in_memory()` + `scan::scan_into` + a `touch()` helper.
- `src-tauri/src/model.rs` — serde `#[serde(rename_all = "camelCase")]` structs returned to JS.
- `src-tauri/src/lib.rs` — module list, `invoke_handler![...]`, `pub mod testing { ... }`.
- `src/lib/api.ts` — `invoke<T>(cmd, args)` wrappers; camelCase types.
- `src/App.tsx` — `Route = loading|scan|library|author|discovery`; harness dispatch in `useEffect` keyed on `args.walkthrough`; `settle()` before capture; `runSteps`.
- `src/views/LibraryView.tsx` — `{ authors, onOpenAuthor, onOpenDiscovery }`, has a `Discover` button.
- `src/harness/walkthroughs.ts` — `browseSteps`/`playerSteps`/`discoverySteps`, `walkthroughs` tuple. `src/harness/runner.ts` — `runSteps(steps, dir, capture)`. `src/harness/types.ts` — `Step { name, run }`.
- `tools/verify.ps1` — `-Walkthrough <name>`; generic, needs no change for a new walkthrough.

**Conventions:** Windows; cargo via `cmd /c "tools\dev-env.cmd cargo ..."` in the FOREGROUND with a large timeout; `npm run build` before cargo; commit per task, human author (`Yovan <yovanfly@gmail.com>`) + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`, **no Codex trailer**.

**Out of scope (M5, separate plan):** the grouping-override review UI that writes `grouping_overrides` (merge/split/reassign/set-base-title). M4 renames files to match the *current* detected grouping; correcting wrong grouping is M5.

---

## Core semantics (read this first)

- **Canonical filename** for a chapter = `sanitize(base_title)` + (`chapter_no ≥ 2` ? ` <chapter_no>` : ``) + the file's **original extension** (verbatim from the on-disk name, preserving its case — we normalize names, not extensions).
  - `sanitize` replaces each Windows-illegal char (`< > : " / \ | ? *`) and control char with a space, then collapses runs of whitespace to single spaces and trims.
  - Examples: `Cool Story.mp3` → `Cool Story.mp3` (noop); `Cool Story 2 the sequel.mp3` → `Cool Story 2.mp3`; `Another Standalone Tale.wav` → noop; `Area 51.wav` (base_title "Area 51", chapter_no 1) → `Area 51.wav` (noop).
- **Item status:**
  - **Noop** — proposed name equals current name (case-insensitive). Excluded from execution.
  - **Conflict** — the proposed name (≠ current) would collide: either two chapters in the same directory propose the same target (case-insensitive), or a file already exists on disk at the target path that is not this chapter's own source. Conflicts are **never** renamed (we never overwrite, never swap in v1 — conservative and lossless).
  - **Ok** — a real, safe rename.
- **Manifest** — one JSONL file per apply batch at `<app_data>/rename-manifests/<nowMs>.jsonl`. Each line is a completed-intent record `{chapterId, fromPath, toPath, fromName, toName}`, appended **before** the `fs::rename` and flushed, so the manifest is a superset of what actually happened on disk.
- **Execution order per Ok item:** (1) re-validate (source exists, target absent); (2) append manifest line + flush; (3) `fs::rename(from → to)`; (4) `UPDATE chapters SET file_path=?, raw_filename=? WHERE id=?`. Each item is independent — a failure records the error and continues to the next (partial success is fully recoverable via the manifest).
- **Undo (tolerant):** read the manifest, iterate **in reverse**, and for each entry reverse the rename **only if** `toPath` exists and `fromPath` does not; then restore the DB row. Entries that don't meet the condition (never executed, or already undone) are skipped. This makes a crash between any two steps safe.

---

## File Structure

- **Create** `src-tauri/src/rename.rs` — pure `sanitize`/`canonical_name`, `build_plan(conn)`, conflict classification, `execute(conn, items, manifest_dir, now_ms)`, `undo(conn, manifest_path)`; full unit/integration tests against temp dirs.
- **Modify** `src-tauri/src/model.rs` — add `RenameItem`, `RenameResult`, `UndoResult`.
- **Modify** `src-tauri/src/commands.rs` — add `preview_renames`, `apply_renames`, `undo_renames` commands + a `rename_manifest_dir(app)` helper.
- **Modify** `src-tauri/src/lib.rs` — `mod rename;`, register the 3 commands, export rename helpers under `pub mod testing`.
- **Modify** `src-tauri/Cargo.toml` — add `serde_json` dependency.
- **Modify** `src/lib/api.ts` — `RenameItem`/`RenameResult`/`UndoResult` types + `previewRenames`/`applyRenames`/`undoRenames` wrappers.
- **Create** `src/views/RenameView.tsx` (+ `RenameView.test.tsx`) — preview table grouped by author, conflict/noop badges, "Rename N files" confirm, post-apply summary + Undo.
- **Modify** `src/views/LibraryView.tsx` (+ `LibraryView.test.tsx`) — add a "Rename tool" button (`onOpenRename`).
- **Modify** `src/App.tsx` — `rename` route, `openRename`/`applyRenames`/`undoRenames` handlers, `rename` harness branch.
- **Modify** `src/harness/walkthroughs.ts` — `renameSteps`, add `"rename"` to `walkthroughs`.
- **Create** `src-tauri/tests/rename_roundtrip.rs` — end-to-end rename + undo against a temp library.
- **Modify** `README.md` — Rename tool section + walkthrough; mark M4 Shipped.

---

## Task 1: `rename.rs` — `sanitize` + `canonical_name` (pure)

**Files:**
- Create: `src-tauri/src/rename.rs`
- Test: same file, `#[cfg(test)] mod tests`

- [ ] **Step 1: Write the failing tests.**

```rust
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
```

- [ ] **Step 2: Add the module + dep.** In `src-tauri/src/lib.rs` add `mod rename;` after `mod natsort;`. In `src-tauri/Cargo.toml`, under `[dependencies]`, add `serde_json = "1"` (used in later tasks; add now so the crate compiles once).

- [ ] **Step 3: Run the tests, expect PASS.**

Run: `cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml rename::"`
Expected: 2 passing.

- [ ] **Step 4: Commit.**

```powershell
git add src-tauri/src/rename.rs src-tauri/src/lib.rs src-tauri/Cargo.toml
git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "feat(rename): canonical_name + sanitize pure helpers"
```

---

## Task 2: `rename.rs` — `build_plan` + conflict classification

**Files:**
- Modify: `src-tauri/src/rename.rs`

- [ ] **Step 1: Write the failing test** (append to `mod tests`). It builds a real temp library, scans it, and asserts the plan.

```rust
    use crate::db::open_in_memory;
    use std::fs::{self, File};
    use std::path::Path;

    fn touch(path: &Path) {
        if let Some(p) = path.parent() { fs::create_dir_all(p).unwrap(); }
        File::create(path).unwrap();
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
        // Two distinct multi-chapter members that would both normalize to "Saga 2.mp3"
        // only if grouping made them chapter 2 of the same base — instead craft a real
        // duplicate: two singletons whose sanitized names coincide.
        touch(&author.join("My: Tale.mp3"));   // sanitize -> "My Tale.mp3"
        touch(&author.join("My Tale.mp3"));     // already canonical
        let conn = open_in_memory().unwrap();
        crate::scan::scan_into(&conn, root).unwrap();

        let plan = super::build_plan(&conn).unwrap();
        // "My: Tale.mp3" wants "My Tale.mp3" which already exists on disk -> conflict.
        let item = plan.iter().find(|i| i.from_name == "My: Tale.mp3").unwrap();
        assert_eq!(item.status, super::ItemStatus::Conflict);
    }
```

- [ ] **Step 2: Run, expect FAIL** (types/functions missing).

Run: `cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml rename::"`
Expected: compile errors (`build_plan`, `ItemStatus` not found).

- [ ] **Step 3: Implement** (add above `#[cfg(test)]`).

```rust
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
```

- [ ] **Step 4: Run, expect PASS** (4 tests in `rename::` now).

Run: `cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml rename::"`
Expected: all passing.

- [ ] **Step 5: Commit.**

```powershell
git add src-tauri/src/rename.rs
git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "feat(rename): build_plan with noop/conflict classification"
```

---

## Task 3: `rename.rs` — defensive `execute` + crash-safe manifest

**Files:**
- Modify: `src-tauri/src/rename.rs`

- [ ] **Step 1: Write the failing test** (append to `mod tests`).

```rust
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
```

- [ ] **Step 2: Run, expect FAIL** (`execute` missing).

- [ ] **Step 3: Implement** (add to `rename.rs`).

```rust
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
```

- [ ] **Step 4: Run, expect PASS.**

Run: `cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml rename::"`

- [ ] **Step 5: Commit.**

```powershell
git add src-tauri/src/rename.rs
git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "feat(rename): defensive crash-safe execute with JSONL manifest"
```

---

## Task 4: `rename.rs` — tolerant `undo`

**Files:**
- Modify: `src-tauri/src/rename.rs`

- [ ] **Step 1: Write the failing test** (append to `mod tests`).

```rust
    #[test]
    fn undo_reverses_completed_renames_and_restores_db() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let author = root.join("Jane Doe");
        touch(&author.join("Cool Story.mp3"));
        touch(&author.join("Cool Story 2 the sequel.mp3"));
        let conn = open_in_memory().unwrap();
        crate::scan::scan_into(&conn, root).unwrap();

        let manifests = tmp.path().join("manifests");
        let plan = super::build_plan(&conn).unwrap();
        let ok_ids: Vec<i64> =
            plan.iter().filter(|i| i.status == super::ItemStatus::Ok).map(|i| i.chapter_id).collect();
        let res = super::execute(&conn, &ok_ids, &manifests, 1_700_000_000_000).unwrap();
        assert!(author.join("Cool Story 2.mp3").exists());

        let undo = super::undo(&conn, Path::new(&res.manifest_path)).unwrap();
        assert_eq!(undo.reverted_count, 1);
        // Disk restored.
        assert!(author.join("Cool Story 2 the sequel.mp3").exists());
        assert!(!author.join("Cool Story 2.mp3").exists());
        // DB restored.
        let raw: String = conn.query_row(
            "SELECT raw_filename FROM chapters WHERE raw_filename='Cool Story 2 the sequel.mp3'",
            [], |r| r.get(0)).unwrap();
        assert_eq!(raw, "Cool Story 2 the sequel.mp3");

        // Idempotent: undoing again reverts nothing.
        let again = super::undo(&conn, Path::new(&res.manifest_path)).unwrap();
        assert_eq!(again.reverted_count, 0);
    }
```

- [ ] **Step 2: Run, expect FAIL** (`undo` missing).

- [ ] **Step 3: Implement.**

```rust
#[derive(Debug)]
pub struct UndoOutcome {
    pub reverted_count: usize,
    pub failures: Vec<(String, String)>,
}

/// Reverse a rename batch. Tolerant: only reverses an entry when the new path
/// exists and the original path is free, so a crash in any prior step is safe
/// and a second undo is a no-op.
pub fn undo(conn: &Connection, manifest_path: &Path) -> rusqlite::Result<UndoOutcome> {
    let text = std::fs::read_to_string(manifest_path).unwrap_or_default();
    let mut entries: Vec<ManifestEntry> = text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<ManifestEntry>(l).ok())
        .collect();
    entries.reverse();

    let mut reverted_count = 0usize;
    let mut failures: Vec<(String, String)> = Vec::new();
    for e in entries {
        let to = Path::new(&e.to_path);
        let from = Path::new(&e.from_path);
        if !to.exists() || from.exists() {
            continue; // never executed, or already undone
        }
        if let Err(err) = std::fs::rename(to, from) {
            failures.push((e.to_path.clone(), format!("undo rename failed: {err}")));
            continue;
        }
        conn.execute(
            "UPDATE chapters SET file_path=?2, raw_filename=?3 WHERE id=?1",
            rusqlite::params![e.chapter_id, e.from_path, e.from_name],
        )?;
        reverted_count += 1;
    }
    Ok(UndoOutcome { reverted_count, failures })
}
```

- [ ] **Step 4: Run, expect PASS** (6 tests in `rename::`).

- [ ] **Step 5: Commit.**

```powershell
git add src-tauri/src/rename.rs
git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "feat(rename): tolerant idempotent undo from manifest"
```

---

## Task 5: `model.rs` — UI-facing structs

**Files:**
- Modify: `src-tauri/src/model.rs`

- [ ] **Step 1: Append the structs.**

```rust
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RenameItem {
    pub chapter_id: i64,
    pub author_name: String,
    pub base_title: String,
    pub from_name: String,
    pub to_name: String,
    pub status: String,            // "ok" | "noop" | "conflict"
    pub conflict_reason: Option<String>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RenameResult {
    pub renamed_count: usize,
    pub failures: Vec<String>,     // human-readable "<file>: <error>"
    pub manifest_path: String,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UndoResult {
    pub reverted_count: usize,
    pub failures: Vec<String>,
}
```

- [ ] **Step 2: Verify it compiles.**

Run: `cmd /c "tools\dev-env.cmd cargo build --manifest-path src-tauri\Cargo.toml"`
Expected: builds (warnings about unused structs are fine until Task 6).

- [ ] **Step 3: Commit.**

```powershell
git add src-tauri/src/model.rs
git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "feat(rename): model structs RenameItem/RenameResult/UndoResult"
```

---

## Task 6: `commands.rs` — preview/apply/undo commands

**Files:**
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Add imports.** At the top of `commands.rs`, extend the model import and add rename:

```rust
use crate::model::{AuthorDetail, AuthorRow, ChapterRow, DiscoveryWork, MoreWork, RenameItem, RenameResult, ScanResult, UndoResult, WorkRow};
use crate::rename;
```

- [ ] **Step 2: Add the manifest-dir helper + three commands** (append before `#[cfg(test)] mod tests`).

```rust
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
```

- [ ] **Step 3: Verify it compiles.**

Run: `cmd /c "tools\dev-env.cmd cargo build --manifest-path src-tauri\Cargo.toml"`

- [ ] **Step 4: Commit.**

```powershell
git add src-tauri/src/commands.rs
git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "feat(rename): preview/apply/undo Tauri commands"
```

---

## Task 7: `lib.rs` — register commands + test exports

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Register the three commands** in `invoke_handler![...]` after `commands::get_more_from_author` (add a comma after it):

```rust
            commands::get_more_from_author,
            commands::preview_renames,
            commands::apply_renames,
            commands::undo_renames
```

- [ ] **Step 2: Export rename helpers for the integration test.** Extend `pub mod testing`:

```rust
pub mod testing {
    pub use crate::commands::{query_author_detail, query_authors};
    pub use crate::db::open_in_memory;
    pub use crate::rename::{build_plan, execute, undo, ItemStatus};
    pub use crate::scan::scan_into;
}
```

- [ ] **Step 3: Verify the whole crate builds.**

Run: `cmd /c "tools\dev-env.cmd cargo build --manifest-path src-tauri\Cargo.toml"`

- [ ] **Step 4: Commit.**

```powershell
git add src-tauri/src/lib.rs
git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "feat(rename): register commands and export test helpers"
```

---

## Task 8: `api.ts` — types + wrappers

**Files:**
- Modify: `src/lib/api.ts`

- [ ] **Step 1: Add types** (after `MoreWork`):

```ts
export interface RenameItem {
  chapterId: number; authorName: string; baseTitle: string;
  fromName: string; toName: string;
  status: "ok" | "noop" | "conflict"; conflictReason: string | null;
}
export interface RenameResult { renamedCount: number; failures: string[]; manifestPath: string; }
export interface UndoResult { revertedCount: number; failures: string[]; }
```

- [ ] **Step 2: Add wrappers** (after `getMoreFromAuthor`):

```ts
export const previewRenames = () => invoke<RenameItem[]>("preview_renames");
export const applyRenames = (chapterIds: number[], nowMs: number) =>
  invoke<RenameResult>("apply_renames", { chapterIds, nowMs });
export const undoRenames = (manifestPath: string) =>
  invoke<UndoResult>("undo_renames", { manifestPath });
```

- [ ] **Step 3: Verify types.**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit.**

```powershell
git add src/lib/api.ts
git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "feat(rename): api types and command wrappers"
```

---

## Task 9: `RenameView.tsx` (+ test)

**Files:**
- Create: `src/views/RenameView.tsx`
- Test: `src/views/RenameView.test.tsx`

- [ ] **Step 1: Write the failing test.**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RenameView } from "./RenameView";
import type { RenameItem } from "../lib/api";

const items: RenameItem[] = [
  { chapterId: 1, authorName: "Jane Doe", baseTitle: "Cool Story", fromName: "Cool Story 2 the sequel.mp3", toName: "Cool Story 2.mp3", status: "ok", conflictReason: null },
  { chapterId: 2, authorName: "Jane Doe", baseTitle: "Cool Story", fromName: "Cool Story.mp3", toName: "Cool Story.mp3", status: "noop", conflictReason: null },
  { chapterId: 3, authorName: "Jane Doe", baseTitle: "Tale", fromName: "Tale 2 part two.mp3", toName: "Tale 2.mp3", status: "conflict", conflictReason: "a file with the target name already exists" },
];

describe("RenameView", () => {
  it("shows the diff and only counts Ok items in the confirm button", () => {
    render(<RenameView items={items} result={null} onApply={() => {}} onUndo={() => {}} onBack={() => {}} onReload={() => {}} />);
    expect(screen.getByText("Cool Story 2 the sequel.mp3")).toBeInTheDocument();
    expect(screen.getByText("Cool Story 2.mp3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Rename 1 file/i })).toBeInTheDocument();
  });

  it("calls onApply with only Ok chapter ids", async () => {
    const onApply = vi.fn();
    render(<RenameView items={items} result={null} onApply={onApply} onUndo={() => {}} onBack={() => {}} onReload={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /Rename 1 file/i }));
    expect(onApply).toHaveBeenCalledWith([1]);
  });

  it("disables the confirm button when there are no Ok items", () => {
    const onlyNoop: RenameItem[] = [items[1]];
    render(<RenameView items={onlyNoop} result={null} onApply={() => {}} onUndo={() => {}} onBack={() => {}} onReload={() => {}} />);
    expect(screen.getByRole("button", { name: /Rename 0 files/i })).toBeDisabled();
  });

  it("after a result, shows the summary and an Undo button", async () => {
    const onUndo = vi.fn();
    render(<RenameView items={items} result={{ renamedCount: 1, failures: [], manifestPath: "m.jsonl" }} onApply={() => {}} onUndo={onUndo} onBack={() => {}} onReload={() => {}} />);
    expect(screen.getByText(/Renamed 1 file/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Undo/i }));
    expect(onUndo).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

Run: `npx vitest run src/views/RenameView.test.tsx`

- [ ] **Step 3: Implement.**

```tsx
import type { RenameItem, RenameResult } from "../lib/api";

function pluralFiles(n: number): string {
  return `${n} file${n === 1 ? "" : "s"}`;
}

export function RenameView(props: {
  items: RenameItem[];
  result: RenameResult | null;
  onApply: (chapterIds: number[]) => void;
  onUndo: () => void;
  onBack: () => void;
  onReload: () => void;
}) {
  const okItems = props.items.filter((i) => i.status === "ok");
  const okIds = okItems.map((i) => i.chapterId);

  return (
    <div className="rename">
      <button onClick={props.onBack}>← Library</button>
      <h1>Rename tool</h1>
      <p className="rename-blurb">
        Preview canonical filenames below. Only <strong>{pluralFiles(okItems.length)}</strong> will
        change; conflicts and already-clean files are skipped. Renames are reversible — an Undo
        button appears after you apply.
      </p>

      {props.result ? (
        <div className="rename-result" role="status">
          <p>Renamed {pluralFiles(props.result.renamedCount)}.</p>
          {props.result.failures.length > 0 && (
            <ul className="rename-failures">
              {props.result.failures.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          )}
          <button onClick={props.onUndo}>Undo this rename</button>
          <button onClick={props.onReload}>Refresh preview</button>
        </div>
      ) : (
        <button disabled={okIds.length === 0} onClick={() => props.onApply(okIds)}>
          Rename {pluralFiles(okItems.length)}
        </button>
      )}

      <table className="rename-table">
        <thead>
          <tr><th>Author</th><th>Current</th><th>Proposed</th><th>Status</th></tr>
        </thead>
        <tbody>
          {props.items.map((i) => (
            <tr key={i.chapterId} className={`rename-row rename-${i.status}`}>
              <td>{i.authorName}</td>
              <td>{i.fromName}</td>
              <td>{i.status === "noop" ? "—" : i.toName}</td>
              <td>
                {i.status === "ok" && <span className="badge badge-ok">rename</span>}
                {i.status === "noop" && <span className="badge badge-noop">already clean</span>}
                {i.status === "conflict" && (
                  <span className="badge badge-conflict" title={i.conflictReason ?? ""}>conflict</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Run, expect PASS.**

Run: `npx vitest run src/views/RenameView.test.tsx`

- [ ] **Step 5: Commit.**

```powershell
git add src/views/RenameView.tsx src/views/RenameView.test.tsx
git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "feat(rename): RenameView preview/confirm/undo component"
```

---

## Task 10: `LibraryView` — "Rename tool" button

**Files:**
- Modify: `src/views/LibraryView.tsx`
- Test: `src/views/LibraryView.test.tsx`

- [ ] **Step 1: Add a failing test** (append inside the existing `describe`; check the existing test file for its imports — it already renders `LibraryView`).

```tsx
  it("opens the rename tool", async () => {
    const onOpenRename = vi.fn();
    render(<LibraryView authors={[]} onOpenAuthor={() => {}} onOpenDiscovery={() => {}} onOpenRename={onOpenRename} />);
    await userEvent.click(screen.getByRole("button", { name: "Rename tool" }));
    expect(onOpenRename).toHaveBeenCalled();
  });
```

> If existing `LibraryView.test.tsx` render calls omit `onOpenRename`, add `onOpenRename={() => {}}` to each so TS is satisfied.

- [ ] **Step 2: Run, expect FAIL.**

Run: `npx vitest run src/views/LibraryView.test.tsx`

- [ ] **Step 3: Implement.** Add `onOpenRename: () => void;` to the props type and render the button next to `Discover`:

```tsx
      <button onClick={props.onOpenDiscovery}>Discover</button>
      <button onClick={props.onOpenRename}>Rename tool</button>
```

- [ ] **Step 4: Run, expect PASS** (all LibraryView tests).

Run: `npx vitest run src/views/LibraryView.test.tsx`

- [ ] **Step 5: Commit.**

```powershell
git add src/views/LibraryView.tsx src/views/LibraryView.test.tsx
git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "feat(rename): Rename tool entry button in LibraryView"
```

---

## Task 11: `walkthroughs.ts` — `renameSteps`

**Files:**
- Modify: `src/harness/walkthroughs.ts`

- [ ] **Step 1: Add `"rename"` to the tuple and a `renameSteps` builder.**

```ts
export const walkthroughs = ["browse", "player", "discovery", "rename"] as const;
```

```ts
/**
 * Build the "rename" walkthrough: preview the diff, apply all Ok renames, then
 * undo — a full round-trip that leaves the fixture on disk exactly as it began.
 */
export function renameSteps(nav: {
  openRename: () => Promise<void>;
  applyAll: () => Promise<void>;
  undoLast: () => Promise<void>;
}): Step[] {
  return [
    { name: "preview", run: nav.openRename },
    { name: "applied", run: nav.applyAll },
    { name: "undone", run: nav.undoLast },
  ];
}
```

- [ ] **Step 2: Verify types.**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit.**

```powershell
git add src/harness/walkthroughs.ts
git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "feat(rename): rename harness walkthrough (preview/apply/undo)"
```

---

## Task 12: `App.tsx` — route + wiring + harness branch

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Extend imports.** Add to the `./lib/api` import: `previewRenames, applyRenames, undoRenames, type RenameItem, type RenameResult`. Add `import { RenameView } from "./views/RenameView";` and `renameSteps` to the `./harness/walkthroughs` import.

- [ ] **Step 2: Add the route + state.** Add `| { kind: "rename" }` to `Route`. Add state:

```tsx
  const [renameItems, setRenameItems] = useState<RenameItem[]>([]);
  const [renameResult, setRenameResult] = useState<RenameResult | null>(null);
```

- [ ] **Step 3: Add handlers** (near `openDiscovery`):

```tsx
  async function openRename() {
    setRenameResult(null);
    setRenameItems(await previewRenames());
    setRoute({ kind: "rename" });
  }
  async function reloadRenamePreview() {
    setRenameResult(null);
    setRenameItems(await previewRenames());
  }
  async function doApplyRenames(chapterIds: number[]) {
    const res = await applyRenames(chapterIds, Date.now());
    setRenameResult(res);
    setRenameItems(await previewRenames()); // reflect new on-disk names
  }
  async function doUndoRenames() {
    if (!renameResult) return;
    await undoRenames(renameResult.manifestPath);
    setRenameResult(null);
    setRenameItems(await previewRenames());
  }
```

- [ ] **Step 4: Render the route** (add before the final `return <LibraryView ... />`):

```tsx
    if (route.kind === "rename") {
      return (
        <RenameView
          items={renameItems}
          result={renameResult}
          onApply={doApplyRenames}
          onUndo={doUndoRenames}
          onReload={reloadRenamePreview}
          onBack={() => setRoute({ kind: "library" })}
        />
      );
    }
```

- [ ] **Step 5: Pass `onOpenRename` to LibraryView** in the fallthrough return:

```tsx
    return <LibraryView authors={authors} onOpenAuthor={openAuthor} onOpenDiscovery={openDiscovery} onOpenRename={openRename} />;
```

- [ ] **Step 6: Add the harness branch.** In the `useEffect` walkthrough dispatch, add a `rename` case to the chain (mirrors the discovery branch):

```tsx
          : args.walkthrough === "rename"
          ? renameSteps({
              openRename,
              applyAll: async () => {
                const items = await previewRenames();
                const okIds = items.filter((i) => i.status === "ok").map((i) => i.chapterId);
                const res = await applyRenames(okIds, Date.now());
                setRenameResult(res);
                setRenameItems(await previewRenames());
                setRoute({ kind: "rename" });
              },
              undoLast: async () => {
                // Re-derive the manifest from state captured by applyAll.
                const res = await previewRenames(); // ensure view is on rename route
                setRenameItems(res);
              },
            })
```

> **Important harness note:** `undoLast` needs the manifest path produced by `applyAll`. React state set inside the walkthrough may not be readable synchronously in the next step's closure. Use a ref to thread it. Add near the player refs:
> ```tsx
> const lastManifestRef = useRef<string | null>(null);
> ```
> In `doApplyRenames` and the harness `applyAll`, set `lastManifestRef.current = res.manifestPath;` right after getting `res`. Then implement `undoLast`:
> ```tsx
> undoLast: async () => {
>   if (lastManifestRef.current) await undoRenames(lastManifestRef.current);
>   setRenameResult(null);
>   setRenameItems(await previewRenames());
> },
> ```

- [ ] **Step 7: Run the front-end gates.**

Run: `npx tsc --noEmit` then `npm test`
Expected: tsc clean; all tests pass.

- [ ] **Step 8: Commit.**

```powershell
git add src/App.tsx
git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "feat(rename): wire RenameView route, handlers, and harness branch"
```

---

## Task 13: Integration test — `rename_roundtrip.rs`

**Files:**
- Create: `src-tauri/tests/rename_roundtrip.rs`

- [ ] **Step 1: Write the test** (uses the exported `testing` helpers; mirrors `tests/fixture_scan.rs` style).

```rust
//! End-to-end: scan a temp library, apply canonical renames on disk, then undo.

use audioshelf_lib::testing::{build_plan, execute, open_in_memory, scan_into, undo, ItemStatus};
use std::fs::{self, File};
use std::path::Path;

fn touch(path: &Path) {
    if let Some(p) = path.parent() { fs::create_dir_all(p).unwrap(); }
    File::create(path).unwrap();
}

#[test]
fn rename_then_undo_leaves_disk_unchanged() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    let author = root.join("Jane Doe");
    touch(&author.join("Cool Story.mp3"));
    touch(&author.join("Cool Story 2 the sequel.mp3"));
    touch(&author.join("Cool Story 3 finale.mp3"));
    let conn = open_in_memory().unwrap();
    scan_into(&conn, root).unwrap();

    let manifests = tmp.path().join("manifests");
    let plan = build_plan(&conn).unwrap();
    let ok_ids: Vec<i64> =
        plan.iter().filter(|i| i.status == ItemStatus::Ok).map(|i| i.chapter_id).collect();
    assert_eq!(ok_ids.len(), 2); // chapters 2 and 3 normalize; chapter 1 is a noop

    let res = execute(&conn, &ok_ids, &manifests, 1_700_000_000_000).unwrap();
    assert_eq!(res.renamed_count, 2);
    assert!(author.join("Cool Story 2.mp3").exists());
    assert!(author.join("Cool Story 3.mp3").exists());

    let undo_out = undo(&conn, Path::new(&res.manifest_path)).unwrap();
    assert_eq!(undo_out.reverted_count, 2);
    assert!(author.join("Cool Story 2 the sequel.mp3").exists());
    assert!(author.join("Cool Story 3 finale.mp3").exists());
    assert!(!author.join("Cool Story 2.mp3").exists());
}
```

> The integration test crate name is `audioshelf_lib` (matches `tests/fixture_scan.rs`). If that file uses a different crate path, match it.

- [ ] **Step 2: Run, expect PASS.**

Run: `cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml --test rename_roundtrip"`

- [ ] **Step 3: Commit.**

```powershell
git add src-tauri/tests/rename_roundtrip.rs
git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "test(rename): end-to-end rename + undo round-trip"
```

---

## Task 14: README + finish

**Files:**
- Modify: `README.md`

> **Note:** the app ships **no stylesheet** in v1 — every view (library, discovery, author) renders with default browser styling, and `RenameView`'s classNames follow that same intentionally-unstyled convention. Do **not** introduce a CSS file; the diff table and badges render as plain HTML, consistent with the rest of the app.

- [ ] **Step 1: Update README** — add an "Opt-in Rename Tool (Milestone 4)" section (canonical names; preview diff; conflicts/noops skipped; defensive crash-safe rename + reversible undo manifest; opt-in, app fully usable without it); add the `rename` walkthrough to the harness list and walkthroughs sentence; flip the M4 roadmap row to **Shipped**; link the M4 plan.

- [ ] **Step 2: Commit.**

```powershell
git add README.md
git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "docs(rename): README M4 rename tool section"
```

- [ ] **Step 3: Visual self-verification** (controller). Run the rename walkthrough and inspect all three screenshots:

```powershell
.\tools\verify.ps1 -Walkthrough rename
```
Confirm: `01-preview` shows the diff table with an Ok rename + a noop ("already clean"); `02-applied` shows "Renamed N files" + Undo; `03-undone` shows the preview restored (original names back, the previously-Ok rows Ok again). Fix any defect before finishing.

- [ ] **Step 4: Finish per the runbook** (controller): final gates (`npx tsc --noEmit`, `npm test`, full `cargo test`) → push `m4-rename` → `gh pr create` → **foreground** `gh pr checks <PR#> --watch` → merge from main with `--merge --delete-branch` → sync main → update the runbook Progress Log (flip M4 to ✅ Merged).

---

## Self-Review (against spec §10 + principles §2)

- Separate, explicitly-triggered screen, off by default; app fully usable without it → `RenameView` reached via the LibraryView "Rename tool" button only (Tasks 9,10,12). ✓
- Preview diff of current → proposed clean filenames → `preview_renames`/`build_plan` + RenameView table (Tasks 2,6,9). ✓
- Explicit confirmation before any disk change → "Rename N files" button; no rename happens on preview (Tasks 9,12). ✓
- Defensive renames (verify target, fail safe) → TOCTOU re-validation, never overwrite, conflicts excluded, per-item failures don't abort the batch (Tasks 2,3). ✓
- Undo manifest enabling rollback → JSONL manifest written before each disk op; tolerant idempotent `undo` (Tasks 3,4). ✓
- Crash-safe / recoverable (standing user principle) → manifest-before-rename + tolerant undo recover from a crash at any step; round-trip test proves restoration (Tasks 3,4,13). ✓
- Read-only-by-default preserved everywhere else → the only disk writes are inside `rename::execute`/`undo`, invoked only by `apply_renames`/`undo_renames` (Tasks 3,4,6). ✓
- DB stays consistent with disk → `chapters.file_path`/`raw_filename` updated on rename and restored on undo (Tasks 3,4). ✓

**Placeholder scan:** none. **Type consistency:** `RenameItem`/`RenameResult`/`UndoResult` fields match Rust camelCase ↔ api.ts; `status` is `"ok"|"noop"|"conflict"` in both; command arg names (`chapterIds`, `nowMs`, `manifestPath`) match the `invoke` wrappers and `#[tauri::command]` signatures.
