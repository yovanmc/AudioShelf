# M30 — Robust, Observable, Incremental Scan + Scale-Test Foundation

> **Written for Sonnet execution.** Follow the tasks **in order**. Every task lists exact files, exact
> code/transforms, exact commands, and the expected result. **If something in the codebase does not
> match what this plan describes, STOP and report rather than guessing** — the plan was written from a
> verbatim read of the current `main`, but drift is possible.
>
> This is the **foundation of v8 (Real-Scale Hardening)**. The owner chose to **lead with scan
> robustness** (not raw throughput) and a **silent-WAV structural fixture**. Raw-throughput work
> (the O(n²) `files.iter().find` fix beyond what falls out here, batched-statement micro-opt,
> parallelism via `rayon`) is **deferred to M31**; query indices/FTS5/GROUP-BY rewrites to **M32**;
> list virtualization to **M33**. Do **not** pull those forward.

## Invariants (hard gates — verify at the end)

1. **No new dependency.** `git diff --stat main -- src-tauri/Cargo.toml src-tauri/Cargo.lock package.json package-lock.json tools/gen-fixture/Cargo.toml` must be **EMPTY**. (`rayon` stays out — that's M31.) The only allowed new capability/schema artifacts are listed per-task.
2. **Read-only on disk.** The scan must never create, move, rename, or delete an audio file. **Deletion detection is a DB `status` flip only (soft-delete, recoverable) — never an `fs::remove`.** Rename stays the sole disk mutation in the app. Audit every new `std::fs` call: only `read_dir` / `metadata` / `read_to_string` (reads) are allowed in the scan path.
3. **Default fixture stays 43 / 44 / 47.** `tools/gen-fixture/src/lib.rs::generate(root)` and `src-tauri/tests/fixture_scan.rs` keep producing/asserting exactly 43 authors, 44 works, 47 chapters. The large fixture is a **separate, opt-in** entry point.
4. **Schema migration is additive (v11) on the existing runner.** One `run_step(conn, 11, …)` adding three columns + one index to `chapters`. `SCHEMA_V1` is **not** edited; no FK-off table rebuild.
5. **Existing tests stay green** (with the few explicitly-noted updates). `cargo test` all green; `npx tsc --noEmit` clean; `npm test` green.

## Build / verify environment (read before running anything)

- Cargo goes through `tools\dev-env.cmd`. In the **Bash tool** use `cmd //c "..."` (double slash), in **PowerShell** use `cmd /c "..."`.
- **FROZEN BUILD RULE:** `verify.ps1 -SkipBuild` runs the **embedded** debug exe. After ANY FE change you must rebuild the frozen exe: `npm run build` **then** `cargo tauri build --debug --no-bundle`. Running `cargo test` / `tauri dev` between the frozen build and a `-SkipBuild` capture re-creates a **dev-mode** exe that shows "localhost refused to connect". Simplest: run the first capture **without** `-SkipBuild`.
- Do **not** call `getCurrentWindow().setSize()` (not permitted under current capabilities) — scroll for tall shots.
- Screenshots are reviewed by a **Sonnet subagent that returns a TEXT verdict** (PASS/FAIL + observations + the absolute PNG paths). Never load PNGs into the controller context unless the user explicitly asks.

---

## Architecture overview (what we're building and why)

The scan today (`src-tauri/src/scan.rs::scan_into`) walks `Author/` dirs, and **for every file on every
scan** does: a `lofty` full read for duration, a per-statement autocommit UPSERT, and an O(n²)
`files.iter().find()` to match a chapter back to its file. It swallows `read_dir` errors with
`.flatten()`, never detects deleted files, and reports only final totals with no progress or way to cancel.

M30 makes the scan **robust, observable, and incremental** without changing the read-only-on-disk
contract:

- **Incremental skip** — store each chapter's `file_mtime` + `file_size`; on rescan, a file whose
  mtime+size are unchanged is **not** re-probed with `lofty` and **not** re-upserted (just "touched"
  for the generation stamp). Rescanning an unchanged library becomes near-instant.
- **Deletion detection** — a monotonic `scan_generation` counter (in `settings`) stamps every
  on-disk file's row (`last_seen_scan`); after the walk, active rows **not** stamped this generation
  are flipped to `status='inactive'` (recoverable), cascading to works/authors with no active children.
  A returning file is re-upserted `status='active'` automatically.
- **Per-author transaction** — each author folder is scanned inside one `BEGIN…COMMIT`. This gives
  crash/cancel **atomicity** (a cancelled or crashed author rolls back cleanly; completed authors
  persist) and, as a side benefit, batches that author's writes.
- **Progress + cancel** — `scan_library` emits `scan:progress` events (`tauri::Emitter`) between
  authors; a new `cancel_scan` command sets an `AtomicBool` that the loop checks. `cancel_scan`
  touches **only** the flag (never `DbState`), so it runs on a separate worker thread while
  `scan_library` holds the DB mutex. The webview stays responsive (renders progress, cancel works).
  *Honest scope:* other DB-touching commands still block on the `DbState` mutex during a scan — the
  user is on the scan screen, so that's acceptable for M30.
- **Error tolerance** — `read_dir`/`metadata`/per-file failures are **captured** into a
  `Vec<ScanError>` and the scan continues; one bad file/dir never aborts. The silent `.flatten()` is
  replaced with explicit error capture.
- **Scan-diff summary** — `ScanResult` gains `added` / `updated` / `removed` / `skipped` counts plus
  the captured errors, surfaced in `ScanView` ("12 added · 3 updated · 1 removed · 4 skipped").

**Scale-test foundation (the ruler):** `gen-fixture` gets a `generate_scaled` entry point
(thousands of silent WAVs) and `verify.ps1` gets a `-Measure` path that times scan / rescan /
`getAuthors` / `searchLibrary` at scale and writes a metrics JSON — so M31/M32 can show before/after.

---

## Task list (do in order)

- **T1** — Schema v11 migration (columns + index) + scale PRAGMAs scoped to robustness
- **T2** — `model.rs`: extend `ScanResult`, add `ScanProgress` / `ScanError`
- **T3** — `scan.rs`: refactor to `scan_into_with` (incremental skip, deletion sweep, per-author txn, error capture) + tests
- **T4** — `commands.rs` + `lib.rs`: `ScanControl` state, `cancel_scan`, progress-emitting `scan_library`
- **T5** — `gen-fixture`: `generate_scaled` (keep `generate` unchanged)
- **T6** — `api.ts`: types + `cancelScan` wrapper + `scan:progress` event type
- **T7** — `App.tsx`: listen to progress, wire cancel, pass summary down
- **T8** — `ScanView.tsx`: progress UI + scan-diff summary
- **T9** — Measurement harness: `generate_scaled` test + `verify.ps1 -Measure` + metrics
- **T10** — `m30` screenshot walkthrough (register name, keep step names stable)
- **T11** — Verify (gates + frozen build + subagent verdict + measurement run)
- **T12** — PR → watch CI → merge → roadmap docs PR

---

### T1 — Schema v11 migration

**File:** `src-tauri/src/db.rs`

1. Bump the latest version. Change line 62:
```rust
pub(crate) const LATEST: i64 = 10;
```
to:
```rust
pub(crate) const LATEST: i64 = 11;
```

2. In `migrate()` (after the `if current < 10 { … }` line ~309), add the v11 step:
```rust
    if current < 11 { run_step(conn, 11, migration_v11_scan_tracking)?; }
```

3. Add the migration function (place it next to `migration_v10_label_types`, following the same style):
```rust
/// Add per-file scan-tracking columns to `chapters` (migration v11). Additive only —
/// three ADD COLUMN + one index; SCHEMA_V1 untouched, no FK-off rebuild. These power
/// incremental mtime/size skip and generation-stamped deletion detection.
///   file_mtime     — file modified time, seconds since unix epoch (0 = unknown)
///   file_size      — file size in bytes (0 = unknown)
///   last_seen_scan — the scan_generation that last observed this file on disk
fn migration_v11_scan_tracking(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "ALTER TABLE chapters ADD COLUMN file_mtime INTEGER NOT NULL DEFAULT 0;
         ALTER TABLE chapters ADD COLUMN file_size INTEGER NOT NULL DEFAULT 0;
         ALTER TABLE chapters ADD COLUMN last_seen_scan INTEGER NOT NULL DEFAULT 0;
         CREATE INDEX IF NOT EXISTS idx_chapters_last_seen ON chapters(last_seen_scan);",
    )?;
    Ok(())
}
```

4. **Robustness PRAGMAs.** In `open()` (lines 65–71) change the pragma line so a long scan can be
read-concurrently and waits on locks instead of erroring. **Do NOT add these to `open_in_memory()`**
(WAL is meaningless for `:memory:` and `busy_timeout` is irrelevant there). Replace, in `open()` only:
```rust
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
```
with:
```rust
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA busy_timeout = 5000;",
    )?;
```
> `cache_size` and the broader query-perf PRAGMAs are **M32** — do not add them here. These three are
> the robustness-minimum (concurrent read during a long write + lock-wait instead of immediate error).
> `journal_mode = WAL` returns a row; `execute_batch` tolerates that.

5. **Migration tests.** In the `db.rs` test module, find the existing latest-version test (it will be
named like `open_at_version_10_reaches_latest` or assert `LATEST == 10` / `user_version == 10`).
**Grep first**, then update:
```
# from repo root, Bash tool:
cmd //c "tools\dev-env.cmd grep -rn \"= 10\|== 10\|_10\|version(10)\|version, 10\" src-tauri\src\db.rs"
```
- Rename `open_at_version_10_reaches_latest` → `open_at_version_11_reaches_latest` (and its body's `11`).
- Bump any `assert_eq!(LATEST, 10)` / `user_version … 10` to `11`.
- Add a v11-additive test mirroring the v9/v10 additive tests:
```rust
    #[test]
    fn migration_v11_adds_scan_tracking_columns_and_is_additive() {
        let conn = open_in_memory().unwrap();
        // columns exist and default to 0
        let (m, s, l): (i64, i64, i64) = {
            // insert a chapter via a minimal author/work/chapter chain
            conn.execute("INSERT INTO authors(folder_name,status) VALUES('A','active')", []).unwrap();
            let aid: i64 = conn.query_row("SELECT id FROM authors WHERE folder_name='A'", [], |r| r.get(0)).unwrap();
            conn.execute("INSERT INTO works(author_id,base_title,sort_key,status) VALUES(?1,'W','w','active')", [aid]).unwrap();
            let wid: i64 = conn.query_row("SELECT id FROM works WHERE author_id=?1", [aid], |r| r.get(0)).unwrap();
            conn.execute(
                "INSERT INTO chapters(work_id,file_path,raw_filename,chapter_no,format,duration_secs,status)
                 VALUES(?1,'/x/a.wav','a.wav',1,'wav',0,'active')", [wid]).unwrap();
            conn.query_row(
                "SELECT file_mtime, file_size, last_seen_scan FROM chapters LIMIT 1",
                [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap()
        };
        assert_eq!((m, s, l), (0, 0, 0));
        // the index exists
        let idx: i64 = conn.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='index' AND name='idx_chapters_last_seen'",
            [], |r| r.get(0)).unwrap();
        assert_eq!(idx, 1);
    }
```
- Also grep **`commands.rs`** for hardcoded `user_version` asserts (M21/M26 added several `== 8` → `== 10` over time):
```
cmd //c "tools\dev-env.cmd grep -rn \"user_version\|open_at_version\|= 10\b\" src-tauri\src\commands.rs"
```
Bump any `user_version == 10` / `open_at_version(10)` assertion to `11`. If none exist, fine.

**Verify T1:**
```
cmd //c "tools\dev-env.cmd cargo test -p audioshelf_lib db:: -- --nocapture"
```
Expect: all `db::` tests green, including the new v11 test.

---

### T2 — `model.rs`: extend `ScanResult`, add progress/error types

**File:** `src-tauri/src/model.rs`

Replace the existing `ScanResult` (lines 1–11) with the extended version **plus** the new types.
Keep `authors/works/chapters` (existing tests + FE read them); add the diff/diagnostic fields with
`#[serde(default)]` so any deserialization stays backward-compatible.

```rust
#[derive(Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    /// Active row totals after the scan (unchanged meaning; FE + existing tests rely on these).
    pub authors: usize,
    pub works: usize,
    pub chapters: usize,
    /// Scan-diff diagnostics (this scan only).
    #[serde(default)]
    pub added: usize,
    #[serde(default)]
    pub updated: usize,
    #[serde(default)]
    pub removed: usize,
    #[serde(default)]
    pub skipped: usize,
    /// Files/folders that could not be read this scan (skipped, not fatal).
    #[serde(default)]
    pub errors: Vec<ScanError>,
    /// True if the scan stopped early because the user cancelled it.
    #[serde(default)]
    pub cancelled: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScanError {
    pub path: String,
    pub reason: String,
}

/// Progress payload emitted as the `scan:progress` event during a scan.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    /// Author folders processed so far (including the current one).
    pub authors_done: usize,
    /// Total author folders discovered for this scan.
    pub authors_total: usize,
    /// Display name of the author folder currently being scanned.
    pub current: String,
    /// Running tallies so the UI can show live numbers.
    pub added: usize,
    pub updated: usize,
    pub skipped: usize,
}
```

> If `ScanError`/`ScanProgress` names collide with anything already in `model.rs`, STOP and report.
> They should not — grep `grep -n "struct Scan" src-tauri/src/model.rs` first.

---

### T3 — `scan.rs`: incremental, transactional, error-tolerant scan

**File:** `src-tauri/src/scan.rs`

This is the core change. Replace the body of `scan_into` and add the new machinery. Keep the public
`scan_into(conn, root)` signature as a thin wrapper so **every existing test and `fixture_scan.rs`
keeps compiling and passing**.

**3a. Imports & new option type.** At the top, extend the `use` block and add `ScanOpts`:
```rust
use crate::grouping::{group_author, Work};
use crate::model::{ScanError, ScanProgress, ScanResult};
use crate::natsort::natural_cmp;
use crate::regroup::regroup_author;
use crate::transcripts::parse_srt_vtt;
use rusqlite::{params, Connection};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

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
```

**3b. Keep the old entry point as a wrapper.** Replace the current `pub fn scan_into(...)` signature
line with a wrapper, and rename the real implementation to `scan_into_with`:
```rust
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
    // ... new body (3c) ...
}
```

**3c. New `scan_into_with` body.** Replace the entire old loop body with the following. Read it
carefully — it preserves the existing grouping/sidecar logic and only adds the new behavior.

```rust
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
            // Root unreadable: record and return an empty-but-valid result rather than aborting.
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

        // Each author folder is scanned in its own transaction: crash/cancel-safe
        // (a failed author rolls back; completed authors persist) and batched.
        if let Err(e) = conn.execute_batch("BEGIN") {
            errors.push(ScanError { path: folder.clone(), reason: format!("begin: {e}") });
            continue;
        }
        let author_res = scan_author(conn, &author_path, &folder, generation, &mut added, &mut updated, &mut skipped, &mut errors);
        match author_res {
            Ok(()) => { let _ = conn.execute_batch("COMMIT"); }
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

    // Deletion sweep: any active chapter NOT stamped this generation no longer exists on disk
    // (or its author folder is gone). Soft-delete to inactive (recoverable), then cascade.
    // Only run a full sweep when the scan completed; a cancelled scan leaves untouched authors
    // un-stamped and must NOT mass-deactivate them.
    let mut removed = 0usize;
    if !cancelled {
        removed = sweep_deleted(conn, generation)?;
    }

    Ok(finish_result(conn, added, updated, removed, skipped, errors, cancelled))
}
```

**3d. Supporting functions.** Add these. `sorted_dirs` must change to return a `Result` so a
permission error on the root is captured rather than silently dropped.

```rust
/// Read + naturally-sort the author subfolders. Returns an io::Error if the root is unreadable.
fn sorted_dirs(root: &Path) -> std::io::Result<Vec<std::path::PathBuf>> {
    let mut dirs: Vec<std::path::PathBuf> = Vec::new();
    for entry in std::fs::read_dir(root)? {
        let entry = match entry { Ok(e) => e, Err(_) => continue };
        let p = entry.path();
        if p.is_dir() {
            dirs.push(p);
        }
    }
    dirs.sort_by(|a, b| natural_cmp(&a.to_string_lossy(), &b.to_string_lossy()));
    Ok(dirs)
}

/// Monotonic scan counter persisted in `settings`. Incremented once per scan; used to stamp
/// `chapters.last_seen_scan` so the deletion sweep can find rows not observed this scan.
fn next_scan_generation(conn: &Connection) -> rusqlite::Result<i64> {
    let current: i64 = conn
        .query_row("SELECT value FROM settings WHERE key='scan_generation'", [], |r| {
            let v: String = r.get(0)?;
            Ok(v.parse::<i64>().unwrap_or(0))
        })
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

    // Collect audio files (top-level only), capturing a read error rather than silently dropping.
    let mut files: Vec<std::path::PathBuf> = Vec::new();
    match std::fs::read_dir(author_path) {
        Ok(rd) => {
            for entry in rd {
                let entry = match entry { Ok(e) => e, Err(_) => continue };
                let p = entry.path();
                if p.is_file()
                    && p.extension().map(|x| is_audio(&x.to_string_lossy())).unwrap_or(false)
                {
                    files.push(p);
                }
            }
        }
        Err(e) => {
            errors.push(ScanError { path: folder.to_string(), reason: e.to_string() });
            return Ok(()); // author row stays; no files this pass
        }
    }
    files.sort_by(|a, b| natural_cmp(&a.to_string_lossy(), &b.to_string_lossy()));

    // O(1) stem -> path lookup (replaces the per-chapter files.iter().find()). NOTE: the deeper
    // throughput work is M31; this HashMap is required here only because the chapter loop below
    // needs file metadata, and is a strict correctness/clarity improvement, not the perf milestone.
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

    let mut author_changed = false;

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
            let Some(file) = by_stem.get(chapter.original_stem.as_str()).copied() else { continue };
            let path_str = file.to_string_lossy().to_string();

            // File stats for the incremental decision (cheap; no audio decode).
            let (mtime, size) = file_stats(file);

            // Is this file already in the DB, unchanged since last scan?
            let existing: Option<(i64, i64, i64)> = conn
                .query_row(
                    "SELECT id, file_mtime, file_size FROM chapters WHERE file_path=?1",
                    params![path_str],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .ok();

            let chapter_id: i64 = match existing {
                Some((id, old_mtime, old_size)) if old_mtime == mtime && old_size == size && mtime != 0 => {
                    // Unchanged: skip the lofty probe + full upsert; just stamp generation.
                    conn.execute(
                        "UPDATE chapters SET last_seen_scan=?1, status='active' WHERE id=?2",
                        params![generation, id],
                    )?;
                    *skipped += 1;
                    id
                }
                other => {
                    // New or changed: full work (probe duration, upsert, stamp).
                    let raw = file_name(file);
                    let format = file
                        .extension()
                        .map(|x| x.to_string_lossy().to_ascii_lowercase())
                        .unwrap_or_default();
                    let duration = probe_duration_secs(file);
                    upsert_chapter(
                        conn, work_id, &path_str, &raw, chapter.chapter_no, &format, duration,
                        mtime, size, generation,
                    )?;
                    if other.is_some() { *updated += 1; } else { *added += 1; }
                    author_changed = true;
                    conn.query_row(
                        "SELECT id FROM chapters WHERE file_path=?1",
                        params![path_str],
                        |r| r.get(0),
                    )?
                }
            };

            // Sidecar transcript ingest is cheap and idempotent; keep it on every pass.
            ingest_sidecar_transcript(conn, chapter_id, file)?;
        }
    }

    // Re-apply grouping overrides only when something in this author changed (override edits go
    // through their own command path, not scan).
    if author_changed {
        regroup_author(conn, author_id)?;
    }
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

/// Soft-delete (status='inactive') every active chapter not observed this generation, then cascade
/// to works/authors with no remaining active children. NEVER deletes rows or files (recoverable).
fn sweep_deleted(conn: &Connection, generation: i64) -> rusqlite::Result<usize> {
    let removed = conn.execute(
        "UPDATE chapters SET status='inactive' WHERE status='active' AND last_seen_scan < ?1",
        params![generation],
    )?;
    // Works with zero active chapters -> inactive.
    conn.execute(
        "UPDATE works SET status='inactive'
         WHERE status='active'
           AND NOT EXISTS (SELECT 1 FROM chapters c WHERE c.work_id=works.id AND c.status='active')",
        [],
    )?;
    // Authors with zero active works -> inactive.
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
```

**3e. Update `upsert_chapter`** to write the new columns. Replace the existing function with:
```rust
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
    // On conflict, update every column EXCEPT `played` (and the journal columns), so re-scanning
    // preserves listening progress and annotations.
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
```

**3f. Keep** `is_audio`, `file_name`, `probe_duration_secs`, `ingest_sidecar_transcript`, and `count`
as they are (no change). The old `sorted_dirs` is replaced by the `Result`-returning one in 3d.

**3g. Tests.** Existing tests in `scan.rs`:
- `scan_groups_files_into_works_and_chapters`, `scan_reapplies_grouping_overrides`,
  `sidecar_*`, `srt_and_vtt_files_alone_do_not_add_chapters` — these assert only `authors/works/chapters`
  totals and **stay green** (the new fields default; `scan_into` wrapper is used).
- `rescan_is_idempotent` asserts `assert_eq!(first, second)`. **This will now FAIL** because `first`
  reports everything `added` and `second` reports everything `skipped`. **Update it** to compare the
  stable totals (which is its real intent):
```rust
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
        // Totals are stable across rescans...
        assert_eq!((first.authors, first.works, first.chapters),
                   (second.authors, second.works, second.chapters));
        assert_eq!(second.chapters, 2);
        // ...and the second pass skips the unchanged files rather than re-adding them.
        assert_eq!(second.added, 0);
        assert_eq!(second.skipped, 2);
    }
```
> Note: `touch()` creates 0-byte files, so `file_size == 0` and `file_mtime` may be the same on a fast
> machine — but the incremental "unchanged" branch requires `mtime != 0`. A 0-byte test file with
> mtime 0 would therefore take the full-work path twice. To make the skip assertion deterministic,
> change `touch` in the scan test module to also set a known size/mtime, OR write a byte. Use this
> drop-in replacement for the test-module `touch`:
```rust
    fn touch(path: &std::path::Path) {
        if let Some(p) = path.parent() {
            fs::create_dir_all(p).unwrap();
        }
        // Write a byte so size>0; metadata().modified() will be a real (non-zero) time.
        std::fs::write(path, b"x").unwrap();
    }
```
> (`File::create` import may become unused — drop it from the test `use` if the compiler warns.)

- **Add** these new tests:
```rust
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

        // Delete one file on disk, rescan.
        std::fs::remove_file(author.join("Tale 2.mp3")).unwrap();
        let second = scan_into(&conn, root).unwrap();
        assert_eq!(second.removed, 1, "one chapter removed");
        assert_eq!(second.chapters, 1, "active count drops to 1");

        // The row is soft-deleted (recoverable), not gone.
        let total: i64 = conn.query_row("SELECT count(*) FROM chapters", [], |r| r.get(0)).unwrap();
        assert_eq!(total, 2, "row retained (inactive), not deleted");

        // Returning the file reactivates it.
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
        // Cancel as soon as the first author's progress callback fires.
        let mut first_seen = false;
        let mut cb = |_p: crate::model::ScanProgress| {
            if !first_seen { first_seen = true; flag.store(true, Ordering::Relaxed); }
        };
        let mut opts = ScanOpts { cancel: Some(&flag), progress: Some(&mut cb) };
        let res = scan_into_with(&conn, root, &mut opts).unwrap();
        assert!(res.cancelled, "scan reports cancelled");
        // No deletion sweep ran (cancelled), and at least the first author persisted.
        assert!(res.authors >= 1);
        assert_eq!(res.removed, 0);
    }
```

**Verify T3:**
```
cmd //c "tools\dev-env.cmd cargo test -p audioshelf_lib scan:: -- --nocapture"
```
Expect: all `scan::` tests green (including the 4 new ones).

---

### T4 — `commands.rs` + `lib.rs`: cancel state, `cancel_scan`, progress-emitting `scan_library`

**File:** `src-tauri/src/commands.rs`

1. Add a managed cancel-flag state near `DbState` (line ~25):
```rust
pub struct ScanControl(pub std::sync::Arc<std::sync::atomic::AtomicBool>);
```

2. Replace the `scan_library` command (lines 40–48) with the progress-emitting, cancellable version.
It resets the cancel flag, builds a progress closure that emits `scan:progress`, runs the scan, and
returns the extended `ScanResult`:
```rust
#[tauri::command]
pub fn scan_library(
    app: tauri::AppHandle,
    state: tauri::State<DbState>,
    control: tauri::State<ScanControl>,
    root: String,
) -> Result<ScanResult, String> {
    use std::sync::atomic::Ordering;
    use tauri::{Emitter, Manager};

    // Fresh scan: clear any stale cancel request.
    control.0.store(false, Ordering::Relaxed);

    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let cancel = control.0.clone();
    let app_for_progress = app.clone();
    let mut emit = move |p: crate::model::ScanProgress| {
        let _ = app_for_progress.emit("scan:progress", p);
    };
    let mut opts = crate::scan::ScanOpts {
        cancel: Some(&cancel),
        progress: Some(&mut emit),
    };
    let report = crate::scan::scan_into_with(&conn, std::path::Path::new(&root), &mut opts)
        .map_err(|e| e.to_string())?;

    // Allow the WebView <audio> element to read files under the library root only.
    let _ = app.asset_protocol_scope().allow_directory(&root, true);
    Ok(report)
}

/// Request cancellation of an in-progress scan. Touches ONLY the cancel flag (never the DB mutex),
/// so it runs on a separate worker thread while `scan_library` holds `DbState`.
#[tauri::command]
pub fn cancel_scan(control: tauri::State<ScanControl>) {
    control.0.store(true, std::sync::atomic::Ordering::Relaxed);
}
```
> The `cancel`/`emit` borrows live only for the duration of `scan_into_with`, which is fine — the
> closure and `Arc` clone are dropped before the function returns. `emit` is `FnMut` capturing an
> owned `AppHandle` clone, matching `ScanOpts.progress: Option<&mut dyn FnMut(...)>`.

**File:** `src-tauri/src/lib.rs`

3. In `.setup(...)` (after `app.manage(DbState(...))`, line ~? near `app.manage(DbPathState(...))`),
manage the cancel flag:
```rust
            app.manage(commands::ScanControl(std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false))));
```

4. Register `cancel_scan` in the `invoke_handler!` list (right after `commands::scan_library,`):
```rust
            commands::scan_library,
            commands::cancel_scan,
```

**Verify T4:**
```
cmd //c "tools\dev-env.cmd cargo build -p audioshelf_lib -q"
cmd //c "tools\dev-env.cmd cargo test -p audioshelf_lib -q"
```
Expect: builds clean; all Rust tests green; fixtures integration still 43/44/47.

> If the borrow checker objects to `Some(&mut emit)` while `emit` also needs `&cancel`, ensure
> `emit` does NOT capture `cancel` (it captures only `app_for_progress`). They are independent.

---

### T5 — `gen-fixture`: `generate_scaled` (keep `generate` unchanged)

**File:** `tools/gen-fixture/src/lib.rs`

Add a parameterized generator **alongside** the existing `generate` (do not touch `generate`, so
`fixture_scan.rs` stays 43/44/47). Append:
```rust
/// Generate a large synthetic library for scale testing: `authors` author folders, each with
/// `works_per` works of `chapters_per` chapters (all 1-second silent WAVs). Deterministic.
/// Produces authors*works_per*chapters_per chapters. Author folders are named "Scale Author NNNN"
/// (zero-padded) so they sort deterministically.
pub fn generate_scaled(
    root: &Path,
    authors: u32,
    works_per: u32,
    chapters_per: u32,
) -> std::io::Result<()> {
    std::fs::create_dir_all(root)?;
    for a in 1..=authors {
        let dir = root.join(format!("Scale Author {a:04}"));
        for w in 1..=works_per {
            // Multi-chapter works use the "<base> <n>" numbering the grouper recognizes.
            for c in 1..=chapters_per {
                let name = if c == 1 {
                    format!("Story {w:03}.wav")
                } else {
                    format!("Story {w:03} {c}.wav")
                };
                write_silence(&dir.join(name), 1)?;
            }
        }
    }
    Ok(())
}
```

**File:** `tools/gen-fixture/src/main.rs`

Replace with an arg-parsing main that keeps the default behavior and adds a `--scale` mode:
```rust
use std::path::PathBuf;

fn main() {
    let mut args = std::env::args().skip(1);
    let out = args.next().expect("usage: gen-fixture <output-dir> [--scale AUTHORS WORKS_PER CHAPTERS_PER]");
    let out = PathBuf::from(out);

    match args.next().as_deref() {
        Some("--scale") => {
            let authors: u32 = args.next().expect("AUTHORS").parse().expect("AUTHORS int");
            let works_per: u32 = args.next().expect("WORKS_PER").parse().expect("WORKS_PER int");
            let chapters_per: u32 = args.next().expect("CHAPTERS_PER").parse().expect("CHAPTERS_PER int");
            gen_fixture::generate_scaled(&out, authors, works_per, chapters_per).expect("generate scaled fixture");
            eprintln!("scaled fixture: {authors} authors x {works_per} works x {chapters_per} chapters");
        }
        _ => {
            gen_fixture::generate(&out).expect("generate fixture");
        }
    }
}
```

**Add a test** in `tools/gen-fixture/src/lib.rs` (or a `#[cfg(test)]` module) is optional; instead
the count assertion lives in T9's Rust test against the real scanner (more meaningful).

**Verify T5:**
```
cmd //c "tools\dev-env.cmd cargo build --manifest-path tools\gen-fixture\Cargo.toml -q"
```
Expect: clean build. (`fixture_scan.rs` untouched and still passing from T4.)

---

### T6 — `api.ts`: types + `cancelScan` + progress event type

**File:** `src/lib/api.ts`

1. Replace the `ScanResult` interface (line 1) with the extended shape:
```ts
export interface ScanError { path: string; reason: string; }
export interface ScanResult {
  authors: number;
  works: number;
  chapters: number;
  added?: number;
  updated?: number;
  removed?: number;
  skipped?: number;
  errors?: ScanError[];
  cancelled?: boolean;
}
export interface ScanProgress {
  authorsDone: number;
  authorsTotal: number;
  current: string;
  added: number;
  updated: number;
  skipped: number;
}
```

2. Add the cancel wrapper next to `scanLibrary`:
```ts
export const cancelScan = () => invoke("cancel_scan");
```

**Verify T6:** `npx tsc --noEmit` (will be exercised after T7/T8).

---

### T7 — `App.tsx`: listen for progress, wire cancel, pass summary down

**File:** `src/App.tsx`

1. Add a scan-progress state near the other scan state (`scan`, `scanError`, `busy`):
```ts
const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
```
(Import `ScanProgress`, `cancelScan` from `./lib/api`.)

2. Subscribe to the `scan:progress` event — copy the existing `miniplayer:command` listen pattern
(App.tsx ~line 3000). Add a new effect:
```ts
useEffect(() => {
  const un = listen<ScanProgress>("scan:progress", (e) => setScanProgress(e.payload));
  return () => { void un.then((f) => f()); };
}, []);
```
(`listen` is already imported at App.tsx line 77.)

3. In `scanRoot` (lines ~807–828), **clear progress on entry and exit** so a finished scan stops
showing a stale bar. Set it at the start and null it in `finally`:
```ts
async function scanRoot(root: string, persist: boolean) {
  setBusy(true);
  setScanError(null);
  setScanProgress(null);
  try {
    const result = await scanLibrary(root);
    if (persist) await setSetting("library_root", root);
    setLibraryRoot(root);
    setScan(result);
    await loadAuthors();
    await refreshTags();
    await loadMetaTerms();
    return true;
  } catch (e) {
    setScanError(String(e));
    setLibraryRoot(root);
    return false;
  } finally {
    setBusy(false);
    setScanProgress(null);
  }
}
```

4. Add a cancel handler:
```ts
function requestScanCancel() { void cancelScan(); }
```

5. Pass progress + cancel into `ScanView` (route render, ~line 3071). Change:
```ts
if (route.kind === "scan") return <ScanView result={scan} onOpenLibrary={() => setRoute({ kind: "library" })} onOpenHome={openHome} />;
```
to:
```ts
if (route.kind === "scan") return <ScanView result={scan} progress={scanProgress} onCancel={requestScanCancel} onOpenLibrary={() => setRoute({ kind: "library" })} onOpenHome={openHome} />;
```

> Keep all new props OPTIONAL on `ScanView` so existing `ScanView` tests (if any) still compile.

---

### T8 — `ScanView.tsx`: progress UI + scan-diff summary

**File:** `src/views/ScanView.tsx`

Rewrite to show: (a) a live progress state while scanning (`progress != null && result == null`),
with author count, current folder, and a **Cancel** button; (b) the result panel with the scan-diff
summary (added/updated/removed/skipped) and a collapsible error list when present. Keep the
first-run reassurance copy.

```tsx
import type { ScanResult, ScanProgress } from "../lib/api";
import { Button, Card, StatCard } from "../components/ui";

export function ScanView(props: {
  result: ScanResult | null;
  progress?: ScanProgress | null;
  onCancel?: () => void;
  onOpenLibrary?: () => void;
  onOpenHome?: () => void;
}) {
  // Scanning in progress (no result yet).
  if (!props.result) {
    const p = props.progress;
    const pct = p && p.authorsTotal > 0 ? Math.round((p.authorsDone / p.authorsTotal) * 100) : 0;
    return (
      <Card className="scan empty-state">
        <h1>Scanning your library</h1>
        <p className="muted">Reading your folders and grouping chapters into works. We never move, rename, or change your files — this just builds your shelf.</p>
        {p && (
          <div className="scan-progress" aria-live="polite">
            <div className="scan-progress__track"><div className="scan-progress__fill" style={{ width: `${pct}%` }} /></div>
            <p className="muted">{p.authorsDone} / {p.authorsTotal} creators · {p.added} added · {p.updated} updated · {p.skipped} unchanged</p>
            <p className="muted scan-progress__current">{p.current}</p>
          </div>
        )}
        {props.onCancel && <Button variant="secondary" onClick={props.onCancel}>Cancel scan</Button>}
      </Card>
    );
  }

  const { authors, works, chapters, added = 0, updated = 0, removed = 0, skipped = 0, errors = [], cancelled = false } = props.result;
  return (
    <Card className="scan" style={{ padding: 24 }}>
      <h1>{cancelled ? "Scan cancelled" : "Library scanned"}</h1>
      {cancelled && <p className="muted">Stopped early — what was scanned so far is kept. Re-scan any time to finish.</p>}
      <div className="stats-grid"><StatCard label="Creators" value={authors} /><StatCard label="Works" value={works} /><StatCard label="Chapters" value={chapters} /></div>
      <p className="muted scan-diff">{added} added · {updated} updated · {removed} removed · {skipped} unchanged</p>
      {errors.length > 0 && (
        <details className="scan-errors">
          <summary>{errors.length} item{errors.length === 1 ? "" : "s"} skipped (unreadable)</summary>
          <ul>{errors.slice(0, 50).map((e, i) => <li key={i} className="muted"><code>{e.path}</code> — {e.reason}</li>)}</ul>
        </details>
      )}
      <div className="scan-cta" style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 16 }}>
        {props.onOpenLibrary && <Button variant="primary" onClick={props.onOpenLibrary}>Browse library</Button>}
        {props.onOpenHome && <Button variant="secondary" onClick={props.onOpenHome}>Go to Home</Button>}
      </div>
    </Card>
  );
}
```

**CSS** — add to `src/styles/components.css` (use the design tokens; the progress track/fill mirror
the M12 ProgressBar pattern — a 3px bar is invisible, so use ~8px). Use `--color-divider` (M28) for
borders that must read on dark:
```css
.scan-progress { margin: 16px 0; }
.scan-progress__track { height: 8px; border-radius: 999px; background: var(--color-surface-2, #1a2535); overflow: hidden; }
.scan-progress__fill { height: 100%; background: var(--color-accent); transition: width 120ms linear; }
.scan-progress__current { font-variant-numeric: tabular-nums; opacity: 0.8; }
.scan-diff { margin-top: 8px; }
.scan-errors { margin-top: 12px; text-align: left; }
.scan-errors ul { margin: 8px 0 0; padding-left: 18px; }
```
> If `--color-surface-2` isn't a defined token, use an existing surface token (grep `--color-surface`
> in `tokens.css`); do not invent a hardcoded hex outside the fallback.

**Add/extend tests** — `src/views/ScanView.test.tsx` (create if absent):
```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ScanView } from "./ScanView";

describe("ScanView", () => {
  it("shows the scan-diff summary on completion", () => {
    render(<ScanView result={{ authors: 3, works: 4, chapters: 7, added: 2, updated: 1, removed: 1, skipped: 3 }} />);
    expect(screen.getByText(/2 added · 1 updated · 1 removed · 3 unchanged/)).toBeInTheDocument();
  });
  it("shows progress + cancel while scanning", () => {
    const onCancel = vi.fn();
    render(<ScanView result={null} progress={{ authorsDone: 2, authorsTotal: 10, current: "Jane Doe", added: 1, updated: 0, skipped: 1 }} onCancel={onCancel} />);
    expect(screen.getByText(/2 \/ 10 creators/)).toBeInTheDocument();
    screen.getByText("Cancel scan").click();
    expect(onCancel).toHaveBeenCalled();
  });
  it("lists skipped errors when present", () => {
    render(<ScanView result={{ authors: 1, works: 1, chapters: 1, errors: [{ path: "C:/x/bad.mp3", reason: "denied" }] }} />);
    expect(screen.getByText(/1 item skipped/)).toBeInTheDocument();
  });
});
```

**Verify T6–T8:**
```
npx tsc --noEmit
npm test
```
Expect: tsc clean; all FE tests green including new ScanView tests.

---

### T9 — Measurement harness: scaled-fixture test + `verify.ps1 -Measure`

**9a. A Rust test proving the scaled generator scans correctly** (gives a real count anchor without
touching `fixture_scan.rs`). Create `src-tauri/tests/scaled_scan.rs`:
```rust
use audioshelf_lib::testing::{open_in_memory, scan_into};

#[test]
fn scaled_fixture_scans_to_expected_counts_and_rescan_skips() {
    let tmp = tempfile::tempdir().unwrap();
    // Small but structurally identical to the large fixture: 5 authors x 2 works x 3 chapters.
    gen_fixture::generate_scaled(tmp.path(), 5, 2, 3).unwrap();

    let conn = open_in_memory().unwrap();
    let first = scan_into(&conn, tmp.path()).unwrap();
    assert_eq!(first.authors, 5);
    assert_eq!(first.works, 10);
    assert_eq!(first.chapters, 30);
    assert_eq!(first.added, 30);

    // A second scan with nothing changed skips everything (incremental).
    let second = scan_into(&conn, tmp.path()).unwrap();
    assert_eq!(second.added, 0);
    assert_eq!(second.updated, 0);
    assert_eq!(second.removed, 0);
    assert_eq!(second.skipped, 30);
}
```
> `testing` must re-export `scan_into`. The existing `fixture_scan.rs` already imports
> `audioshelf_lib::testing::{open_in_memory, query_authors, scan_into}`, so the re-export exists.
> `gen_fixture` is already a dev-dependency. If `generate_scaled` isn't visible, confirm it's `pub`.

**9b. `verify.ps1` measurement path.** Add a `-Measure` switch with scale parameters. The cleanest,
lowest-risk measurement is a **standalone Rust timing harness** (no FE/webview needed), so add a tiny
bin and call it from `verify.ps1`. Create `tools/gen-fixture/src/bin/measure.rs`:
```rust
// Scale measurement: generate a large fixture, time a full scan + an incremental rescan.
// Usage: measure <fixture-dir> <authors> <works_per> <chapters_per>
use std::path::PathBuf;
use std::time::Instant;

fn main() {
    let mut a = std::env::args().skip(1);
    let dir = PathBuf::from(a.next().expect("fixture dir"));
    let authors: u32 = a.next().expect("authors").parse().unwrap();
    let works: u32 = a.next().expect("works_per").parse().unwrap();
    let chapters: u32 = a.next().expect("chapters_per").parse().unwrap();

    let t = Instant::now();
    gen_fixture::generate_scaled(&dir, authors, works, chapters).expect("gen");
    let gen_ms = t.elapsed().as_millis();

    let conn = audioshelf_lib::testing::open_in_memory().expect("db");
    let t = Instant::now();
    let first = audioshelf_lib::testing::scan_into(&conn, &dir).expect("scan");
    let scan_ms = t.elapsed().as_millis();

    let t = Instant::now();
    let second = audioshelf_lib::testing::scan_into(&conn, &dir).expect("rescan");
    let rescan_ms = t.elapsed().as_millis();

    println!("{{\"authors\":{},\"works\":{},\"chapters\":{},\"genMs\":{},\"scanMs\":{},\"rescanMs\":{},\"rescanSkipped\":{}}}",
        first.authors, first.works, first.chapters, gen_ms, scan_ms, rescan_ms, second.skipped);
}
```
> This bin lives in the `gen-fixture` crate, which already depends on nothing extra — BUT it needs
> `audioshelf_lib`. **Do NOT add `audioshelf_lib` as a dependency of `gen-fixture`** (would create a
> dependency cycle / invariant break). Instead place the measure bin under **`src-tauri/src/bin/measure.rs`**
> (the `audioshelf_lib` crate already builds it and `gen-fixture` is a dev-dep there) — adjust the
> `use` to `gen_fixture::generate_scaled` + `audioshelf_lib::testing::*`. **If `gen_fixture` is only a
> `[dev-dependencies]` of `src-tauri`, a `src/bin` cannot see it.** In that case, keep the measurement
> as a **`#[test]` that prints timings** (run with `--nocapture`) instead of a bin — simpler and
> invariant-safe. Choose whichever compiles without adding a non-dev dependency; **if neither is clean,
> STOP and report** rather than adding a dependency.

The robust, invariant-safe choice (recommended): make the measurement a `#[ignore]`d timing test in
`src-tauri/tests/scaled_scan.rs` that runs only when explicitly named:
```rust
#[test]
#[ignore = "scale measurement; run explicitly with --ignored --nocapture"]
fn measure_scan_at_scale() {
    let tmp = tempfile::tempdir().unwrap();
    let (authors, works, chapters) = (1000u32, 3, 4); // ~12k chapters
    let t = std::time::Instant::now();
    gen_fixture::generate_scaled(tmp.path(), authors, works, chapters).unwrap();
    let gen_ms = t.elapsed().as_millis();
    let conn = open_in_memory().unwrap();
    let t = std::time::Instant::now();
    let first = scan_into(&conn, tmp.path()).unwrap();
    let scan_ms = t.elapsed().as_millis();
    let t = std::time::Instant::now();
    let second = scan_into(&conn, tmp.path()).unwrap();
    let rescan_ms = t.elapsed().as_millis();
    println!("SCALE-METRICS {{\"chapters\":{},\"genMs\":{},\"scanMs\":{},\"rescanMs\":{},\"rescanSkipped\":{}}}",
        first.chapters, gen_ms, scan_ms, rescan_ms, second.skipped);
    assert_eq!(second.skipped, first.chapters); // incremental rescan skips everything
}
```
Then add a `-Measure` branch to `verify.ps1` that runs it and prints the line. Add near the top of
`verify.ps1` (after `param(...)`), a new switch param `[switch]$Measure` and, early in the body:
```powershell
if ($Measure) {
  cmd /c "`"$devenv`" cargo test -p audioshelf_lib --test scaled_scan measure_scan_at_scale -- --ignored --nocapture"
  exit $LASTEXITCODE
}
```
> Document in the plan report the printed `SCALE-METRICS` line as the **baseline** for M31/M32.

**Verify T9:**
```
cmd //c "tools\dev-env.cmd cargo test -p audioshelf_lib --test scaled_scan -q"        # the non-ignored count+skip test
cmd //c "tools\dev-env.cmd cargo test -p audioshelf_lib --test scaled_scan measure_scan_at_scale -- --ignored --nocapture"  # prints SCALE-METRICS
```
Expect: count test green; the ignored test prints a `SCALE-METRICS {…}` line and passes its skip assertion. **Record the printed numbers in the T11/PR report.**

---

### T10 — `m30` screenshot walkthrough

Progress + cancel are transient; capture **deterministic seeded states** rather than racing the live
scan. We screenshot: (1) the ScanView **summary** after a normal scan (added/updated/skipped read 0
on a stable fixture — that's fine, it proves the summary line renders), and (2) the **progress**
state by rendering ScanView with a seeded `progress` prop via a harness-only path, and (3) a
**removed** summary by mutating state. Because the harness drives the real app (not isolated
component renders), keep it simple: show the post-scan ScanView summary + the in-progress card by
navigating to the scan route while a synthetic progress is set.

**File:** `src/harness/walkthroughs.ts`

1. Add `"m30"` to the `walkthroughs` array (keep it last):
```ts
export const walkthroughs = ["home", "browse", "player", "discovery", "rename", "grouping", "settings", "m7", "covers", "tags", "m12", "m16", "journal", "insights", "m19", "m20", "m21", "m24", "m25", "m26", "m27", "m28", "m29", "m30"] as const;
```

2. Add the builder (3 steps; **keep these step names stable** — `runner.test.ts` references the
builder import list):
```ts
/**
 * Build the "m30" walkthrough (v8 Real-Scale Hardening — robust incremental scan):
 *  01 scan-summary   — ScanView after a normal scan (scan-diff line + stats)
 *  02 scan-progress  — ScanView in-progress card (seeded progress + Cancel button)
 *  03 scan-removed   — ScanView summary reflecting a soft-deleted item (removed > 0)
 * Progress/removed states are seeded deterministically (the live scan of the tiny fixture is
 * instantaneous, so these states are otherwise un-screenshotable).
 */
export function m30Steps(nav: {
  showScanSummary: () => Promise<void>;
  showScanProgress: () => Promise<void>;
  showScanRemoved: () => Promise<void>;
}): Step[] {
  return [
    { name: "01-scan-summary", run: nav.showScanSummary },
    { name: "02-scan-progress", run: nav.showScanProgress },
    { name: "03-scan-removed", run: nav.showScanRemoved },
  ];
}
```

**File:** `src/harness/runner.test.ts` — add `m30Steps` to the import list and (if the test asserts on
the builders) include it the same way `m29Steps` is referenced, so the list stays in sync.

**File:** `src/App.tsx` — in the walkthrough-dispatch block (where other `*Steps` are wired with nav
callbacks), add the `m30` case. Implement the three nav callbacks using **existing state setters**:
```ts
// m30 nav callbacks
const showScanSummary = async () => {
  // The boot scan already populated `scan`; just route to it.
  setScanProgress(null);
  setRoute({ kind: "scan" });
  await settle();
};
const showScanProgress = async () => {
  setScanProgress({ authorsDone: 18, authorsTotal: 43, current: "Sam Smith", added: 6, updated: 2, skipped: 10 });
  // Force the in-progress branch by clearing the result while this shot is captured.
  setScan(null);
  setRoute({ kind: "scan" });
  await settle();
};
const showScanRemoved = async () => {
  setScanProgress(null);
  setScan({ authors: 42, works: 43, chapters: 46, added: 0, updated: 0, removed: 1, skipped: 46, errors: [] });
  setRoute({ kind: "scan" });
  await settle();
};
```
Then dispatch `runSteps(m30Steps({ showScanSummary, showScanProgress, showScanRemoved }), …)`.
> `setScan(null)` for the progress shot is a harness-only display toggle; the real `scan` is restored
> on the next route. This mirrors how other walkthroughs seed transient UI. After the walkthrough,
> nothing persists (no DB writes here). `settle` is the existing double-rAF helper used by all steps.

**Verify T10:** covered by T11's run.

---

### T11 — Verify

1. **Gates (run all):**
```
npx tsc --noEmit
npm test
cmd //c "tools\dev-env.cmd cargo test -p audioshelf_lib"
```
Expect: tsc clean; FE green; Rust green; `fixture_scan.rs` still **43/44/47**.

2. **Invariant diff gate** — must be EMPTY:
```
cmd //c "git -C \"C:\Agent Projects\AudioShelf\" diff --stat main -- src-tauri/Cargo.toml src-tauri/Cargo.lock package.json package-lock.json tools/gen-fixture/Cargo.toml"
```
> A NEW capability is NOT expected (no new plugin/window perm — `emit`/`listen` need none under
> `core:default`). If `gen/schemas/capabilities.json` regenerates, that's acceptable (Tauri codegen),
> but `Cargo.*`/`package*.json` must be byte-clean.

3. **Read-only-on-disk audit:**
```
cmd //c "tools\dev-env.cmd grep -rn \"fs::remove\|fs::rename\|fs::write\|File::create\|OpenOptions\" src-tauri\src\scan.rs src-tauri\src\commands.rs"
```
Expect: **no `remove`/`rename`/`write`/`create`** in the scan path (only reads). The only writers in
the app remain `rename.rs` and the explicit export commands (unchanged).

4. **Frozen build + walkthroughs.** Build once, then capture `m30` + the `m12` regression matrix:
```
cmd //c "tools\dev-env.cmd npm run build"
cmd //c "tools\dev-env.cmd cargo tauri build --debug --no-bundle"
powershell -File tools\verify.ps1 -Walkthrough m30 -SkipBuild
powershell -File tools\verify.ps1 -Walkthrough m12 -SkipBuild
```
> Do not run `cargo test` between the frozen build and these `-SkipBuild` captures (re-creates a
> dev-mode exe). If you must, rebuild the frozen exe first.

5. **Measurement baseline:**
```
powershell -File tools\verify.ps1 -Measure
```
Record the `SCALE-METRICS {…}` line (chapters / genMs / scanMs / rescanMs / rescanSkipped). **This is
the v8 baseline** — include it verbatim in the PR body and the roadmap decision log.

6. **Screenshot verdict (Sonnet subagent).** Dispatch a Sonnet subagent to Read the `m30` (3 shots)
and `m12` (15 shots) PNGs and return a TEXT verdict against these criteria:
   - `01-scan-summary`: stats grid + a "N added · N updated · N removed · N unchanged" line render.
   - `02-scan-progress`: a progress bar, "18 / 43 creators · …" text, current folder, and a
     **Cancel scan** button render; copy is legible on dark.
   - `03-scan-removed`: summary line shows "1 removed".
   - `m12` 15-shot matrix: no regressions vs the existing baseline (sole expected diff: none — M30
     does not change those screens; large pixel diffs would be baseline drift from M26–M29, note but
     don't fail).
   Controller **directly reviews** the progress-bar / cancel-button shot if the subagent is uncertain
   (thin-element/low-contrast — the documented single-subagent-unreliable case).

7. **Manual-ish robustness gates that screenshots can't show** (assert via the Rust tests already
written; note in the report as "covered by unit tests, not screenshot"): incremental skip, deletion
soft-delete + cascade + reactivation, cancel-between-authors, error capture. These are gated by the
T3/T9 tests, not the harness.

---

### T12 — PR → CI → merge → roadmap docs PR

1. Branch, commit per task (or logically grouped), push:
```
git -C "C:\Agent Projects\AudioShelf" switch -c m30-robust-incremental-scan
# ... commits ...
git -C "C:\Agent Projects\AudioShelf" push -u origin m30-robust-incremental-scan
```
Commit author = repo identity (`yovanmc <yovanmc@users.noreply.github.com>`); do NOT pass `-c user.email`. If a commit is substantively Codex-generated, append `Co-authored-by: Codex <noreply@openai.com>` after a blank line per `AGENTS.md`.

2. Open the PR (body: summary, invariants held, the `SCALE-METRICS` baseline, test counts, verdict).
Then **foreground** watch CI (sleep ~20s first to dodge "no checks reported"):
```
gh pr checks <PR#> --watch
```
3. On green, merge from main and delete the branch:
```
gh pr merge <PR#> --merge --delete-branch
git -C "C:\Agent Projects\AudioShelf" switch main && git -C "C:\Agent Projects\AudioShelf" pull
```
4. **Roadmap update via a docs PR** (AudioShelf blocks direct-to-main): flip the M30 row to
`✅ Merged` with the PR link + a one-line summary; append a decision-log entry (the `SCALE-METRICS`
baseline, the soft-delete/incremental/cancel design, gotchas hit). Open + merge the docs PR.

5. **Ping** the user with the next handoff (plan M31).

---

## Notes, risks, and explicit deferrals

- **Throughput is M31, not here.** The per-author transaction + the stem→path `HashMap` land in M30
  only because they are *required for correctness/atomicity* of the robustness features. Do **not**
  add `rayon`, prepared-statement caching, or other pure-throughput work — that's M31 (and parallelism
  needs an explicit no-new-dep waiver the owner hasn't granted).
- **Moved/renamed files** appear as delete(old)+add(new): the old row goes inactive (its journal/
  progress preserved but hidden), the new row starts fresh. True content-hash move-detection is out
  of scope — note it as a known limitation, don't build it.
- **WAL side effects:** WAL creates `-wal`/`-shm` sidecar files next to `audioshelf.db` in app-data
  (not the library) — that's expected and not a library write. The crash-safe restore path
  (`backup.rs::apply_pending_restore`) operates on the DB file before `open()`; WAL is enabled inside
  `open()` after restore, so ordering is unaffected. If `apply_pending_restore` assumes a non-WAL
  file shape, STOP and report (it shouldn't — it does a file-level place-then-rename before open).
- **`open_in_memory()` deliberately stays non-WAL** so unit tests are unaffected.
- **First-run-only states**: the configured fixture is non-first-run; the `m30` progress/removed shots
  are seeded explicitly (see T10), which is the sanctioned approach for un-screenshotable states.
- If any existing command asserts `user_version == 10` and you miss it, `cargo test` will catch it —
  fix to `11`. If a test elsewhere constructs a `ScanResult { authors, works, chapters }` literal
  (without the new fields), the `#[serde(default)]` doesn't help struct literals — add `..Default::default()`
  or the new fields. Grep `ScanResult {` across `src-tauri` before finishing.
```
cmd //c "tools\dev-env.cmd grep -rn \"ScanResult {\" src-tauri\src"
```
