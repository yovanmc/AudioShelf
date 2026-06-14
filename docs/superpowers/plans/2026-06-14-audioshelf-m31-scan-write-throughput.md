# M31 — Scan & Write Throughput Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Written for Sonnet execution; if something doesn't match what's described here, STOP and report rather than guess.** This plan was authored against the live code at `src-tauri/src/scan.rs` as of 2026-06-14 (post-M30, PR #77).

**Goal:** Cut AudioShelf's scan write time at scale by eliminating per-row SQL re-compilation and redundant `SELECT id` round-trips in the scan write path — with zero new dependencies, zero schema change, and no weakening of M30's crash-safety.

**Architecture:** The scan write path in `scan_author()` (`src-tauri/src/scan.rs`) currently calls `conn.execute(...)` / `conn.query_row(...)` for every work and every chapter, which re-prepares (re-compiles) the SQL on each call, and follows each `INSERT … ON CONFLICT` with a separate `SELECT id`. This plan (1) switches the hot per-row statements to `conn.prepare_cached(...)`, so each distinct SQL string is compiled once and reused from rusqlite's statement cache, and (2) appends `RETURNING id` to the work and chapter upserts so the trailing `SELECT id` round-trips disappear. Everything stays inside M30's existing **per-author transaction** (atomicity preserved) and behind M30's **incremental mtime+size skip** (unchanged). The `lofty` duration probe stays single-threaded — **parallelism is explicitly deferred** (see Non-Goals).

**Tech Stack:** Rust, rusqlite 0.32 (`bundled` → SQLite ≥ 3.46, so `RETURNING` and `prepare_cached` are available), no new crates.

---

## Context the executor needs

- **The O(n²) `files.iter().find()` item from the original M31 sketch is ALREADY DONE.** M30's scan rewrite replaced it with a `by_stem: HashMap` built once per author (`scan.rs:218–224`) and an O(1) `by_stem.get(...)` lookup (`scan.rs:246`). **Do not look for or "fix" an O(n²) lookup — there isn't one.** This plan does not touch grouping or file→chapter matching.
- **No schema migration.** `db::LATEST` stays **11**. This plan adds/edits no columns, tables, or indices. If you find yourself editing `db.rs`, STOP — you've gone off-plan.
- **No new dependency.** Do not add `rayon`, `crossbeam`, `parking_lot`, `threadpool`, or anything else. `Cargo.toml` / `Cargo.lock` must have an empty diff at the end. If a step seems to need a new crate, STOP and report.
- **Read-only on disk.** This plan adds no `std::fs` writes. All writes remain SQLite.
- **Default fixtures stay 43/44/47.** Do not touch `src-tauri/tests/fixture_scan.rs` or the default `gen-fixture::generate`. The scale fixture is the separate `generate_scaled` (1000×3×4 = 12 000 chapters), already used by `tests/scaled_scan.rs::measure_scan_at_scale`.
- **Behavior must not change.** `played` preservation on rescan, incremental skip semantics, deletion sweep, error capture, progress events, and cancellation are all untouched. The existing scan tests are the spec; they must stay green throughout.

## Non-Goals (explicitly deferred)

- **Parallel `lofty` probing.** Deferred to a later v8 milestone. When it lands it must use `std::thread::scope` (no new dep), and it can only parallelize the **read-only probe phase** (compute a `path → duration` map off-thread), because `rusqlite::Connection` is not `Sync` — writes stay single-threaded. **Do not implement parallelism in M31.**
- **Cross-author commit batching.** M30 deliberately commits one transaction **per author** for crash/cancel atomicity. Under WAL + `synchronous=NORMAL` (set in M30's `open()`), those commits are already cheap. **Keep per-author transactions exactly as they are.** Do not widen the transaction to span multiple authors — that would trade away crash-safety for a marginal, unmeasured gain.

## File Structure

| File | Change |
|------|--------|
| `src-tauri/src/scan.rs` | **Modify.** `scan_author()` works loop + chapters loop → `prepare_cached` + `RETURNING`; `upsert_chapter()` → returns `i64` via `RETURNING id`; `ingest_sidecar_transcript()` INSERT → `prepare_cached`. Add one guard test in the `#[cfg(test)] mod tests` block. |

No other files change. No FE change. No command-signature change (`scan_into` / `scan_into_with` signatures are untouched).

> **A note on TDD for this milestone:** this is a pure performance refactor — observable behavior is unchanged, so there is no honest red→green cycle. The discipline here is **"lock the behavior under tests, then refactor under green."** Task 2 adds a guard test that passes *before and after* the refactor; Tasks 3–6 must keep the entire scan test suite green at every step. The performance proof is the before/after `SCALE-METRICS` numbers (Tasks 1 and 7), not a CI assertion (wall-clock thresholds are too machine-dependent to assert reliably).

---

## Task 1: Capture the pre-change baseline

**Files:** none (measurement only).

- [ ] **Step 1: Run the scale measurement on THIS machine, before any code change**

Run (foreground, allow several minutes — it generates a 12 000-file fixture, scans, then rescans):

```
pwsh -File tools\verify.ps1 -Measure
```

(Run from the repo root `C:\Agent Projects\AudioShelf`. `verify.ps1 -Measure` invokes `cargo test --test scaled_scan measure_scan_at_scale -- --ignored --nocapture` through `dev-env.cmd`.)

Expected: a line on stdout of the form

```
SCALE-METRICS {"chapters":12000,"genMs":...,"scanMs":...,"rescanMs":...,"rescanSkipped":12000}
```

- [ ] **Step 2: Record the baseline**

Copy the exact `SCALE-METRICS {...}` line into your working notes / the eventual PR description as **"M31 baseline (pre-change, this machine)"**. The two numbers that matter are `scanMs` (cold first scan) and `rescanMs` (incremental rescan). You will compare against these in Task 7 **on the same machine** (absolute ms varies by hardware, so a cross-machine comparison to M30's recorded baseline is not valid — capture your own).

No commit (no file changed).

---

## Task 2: Add a guard test that locks the upsert / update behavior

**Files:**
- Modify (add test): `src-tauri/src/scan.rs` — inside the existing `#[cfg(test)] mod tests { … }` block (the module starts at `scan.rs:454`).

- [ ] **Step 1: Add the guard test**

Add this test function inside `mod tests` (place it after the existing `rescan_is_idempotent` test). It uses the existing `touch()` helper (writes a 1-byte file) already defined in that module, and `params!` / `scan_into` / `open_in_memory` already in scope via `use super::*;` and `use crate::db::open_in_memory;`.

```rust
    #[test]
    fn changed_file_counts_as_update_and_preserves_chapter_identity() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let author = root.join("Author X");
        touch(&author.join("Tale.mp3"));
        touch(&author.join("Tale 2.mp3"));

        let conn = open_in_memory().unwrap();
        let first = scan_into(&conn, root).unwrap();
        assert_eq!(first.chapters, 2);
        assert_eq!(first.added, 2);

        // Capture the row id of Tale.mp3 so we can prove the update path reuses it.
        let path1 = author.join("Tale.mp3").to_string_lossy().to_string();
        let id_before: i64 = conn
            .query_row(
                "SELECT id FROM chapters WHERE file_path=?1",
                params![path1],
                |r| r.get(0),
            )
            .unwrap();

        // Change Tale.mp3's content so its size differs -> detected as UPDATED, not skipped.
        // Tale 2.mp3 is unchanged -> must be skipped.
        std::fs::write(author.join("Tale.mp3"), b"xxxxxxxxxx").unwrap();
        let second = scan_into(&conn, root).unwrap();
        assert_eq!(second.added, 0, "no new files");
        assert_eq!(second.updated, 1, "Tale.mp3 changed size -> updated");
        assert_eq!(second.skipped, 1, "Tale 2.mp3 unchanged -> skipped");

        let id_after: i64 = conn
            .query_row(
                "SELECT id FROM chapters WHERE file_path=?1",
                params![path1],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            id_before, id_after,
            "the upsert update path must preserve chapter identity (same row id)"
        );
    }
```

- [ ] **Step 2: Run the new test — it must PASS against the current (unmodified) code**

Run:

```
cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml changed_file_counts_as_update_and_preserves_chapter_identity"
```

Expected: `test scan::tests::changed_file_counts_as_update_and_preserves_chapter_identity ... ok` (1 passed). This green result is the baseline behavior we will hold invariant through the refactor.

- [ ] **Step 3: Commit**

```
git add src-tauri/src/scan.rs
git commit -m "test(scan): guard chapter update path identity before M31 refactor"
```

---

## Task 3: Works loop → `prepare_cached` + `RETURNING id`

**Files:**
- Modify: `src-tauri/src/scan.rs` — the works loop inside `scan_author()` (currently `scan.rs:232–243`).

- [ ] **Step 1: Replace the work INSERT + separate SELECT with one cached `RETURNING` statement**

Find this block (`scan.rs:232–243`):

```rust
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
```

Replace it with (note: the `for work in works {` line stays; only the body's two statements collapse into one):

```rust
    for work in works {
        // Single cached round-trip: ON CONFLICT DO UPDATE always runs the update, so
        // RETURNING id yields the row id whether the work was just inserted or already existed.
        let work_id: i64 = conn
            .prepare_cached(
                "INSERT INTO works(author_id, base_title, sort_key, status)
                 VALUES (?1, ?2, ?3, 'active')
                 ON CONFLICT(author_id, base_title) DO UPDATE SET status='active'
                 RETURNING id",
            )?
            .query_row(
                params![author_id, work.base_title, work.base_title.to_lowercase()],
                |r| r.get(0),
            )?;
```

Leave everything after `let work_id` (the `for chapter in work.chapters {` loop) unchanged in this task.

- [ ] **Step 2: Run the scan test suite — all green**

```
cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml scan"
```

Expected: all `scan::tests::*` pass, including `changed_file_counts_as_update_and_preserves_chapter_identity` from Task 2. (This runs the in-crate scan module tests; integration tests run in Task 7.)

- [ ] **Step 3: Commit**

```
git add src-tauri/src/scan.rs
git commit -m "perf(scan): prepare_cached + RETURNING for works upsert"
```

---

## Task 4: Chapters upsert → `prepare_cached` + `RETURNING id` (drop the trailing SELECT)

**Files:**
- Modify: `src-tauri/src/scan.rs` — `upsert_chapter()` (currently `scan.rs:413–445`) and the chapter-upsert arm inside `scan_author()` (currently `scan.rs:272–301`).

- [ ] **Step 1: Change `upsert_chapter` to return the row id via `RETURNING`**

Replace the entire `upsert_chapter` function (`scan.rs:413–445`):

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
) -> rusqlite::Result<i64> {
    // The UPSERT updates every column EXCEPT `played`, so re-scanning preserves listening
    // progress. RETURNING id hands back the row id for both INSERT and UPDATE, so callers no
    // longer need a follow-up `SELECT id`. prepare_cached compiles this SQL once per connection.
    conn.prepare_cached(
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
           last_seen_scan=excluded.last_seen_scan
         RETURNING id",
    )?
    .query_row(
        params![work_id, path, raw, chapter_no as i64, format, duration, mtime, size, generation],
        |r| r.get(0),
    )
}
```

(The signature's return type changed from `rusqlite::Result<()>` to `rusqlite::Result<i64>`, and the body now returns the id from `RETURNING` instead of `Ok(())`.)

- [ ] **Step 2: Update the call site to use the returned id and drop the separate `SELECT id`**

Find the `other =>` arm of the `match existing` in `scan_author()` (`scan.rs:272–301`):

```rust
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
```

Replace it with (the trailing `conn.query_row("SELECT id …")` is gone — `upsert_chapter` now returns the id directly):

```rust
                other => {
                    let raw = file_name(file);
                    let format = file
                        .extension()
                        .map(|x| x.to_string_lossy().to_ascii_lowercase())
                        .unwrap_or_default();
                    // M31: parallelism deferred (see ROADMAP M32+); the probe stays single-threaded.
                    let duration = probe_duration_secs(file);
                    let id = upsert_chapter(
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
                    id
                }
```

- [ ] **Step 3: Run the scan test suite — all green**

```
cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml scan"
```

Expected: all `scan::tests::*` pass (added/updated/skipped tallies and chapter-identity guard unchanged).

- [ ] **Step 4: Commit**

```
git add src-tauri/src/scan.rs
git commit -m "perf(scan): chapter upsert returns id via RETURNING, drop trailing SELECT"
```

---

## Task 5: Cache the existing-row probe and the skip UPDATE

**Files:**
- Modify: `src-tauri/src/scan.rs` — the existing-row `SELECT` and the skip-path `UPDATE` inside `scan_author()` (currently `scan.rs:253–268`).

- [ ] **Step 1: Switch the existing-row SELECT to `prepare_cached`**

Find (`scan.rs:253–259`):

```rust
            let existing: Option<(i64, i64, i64)> = conn
                .query_row(
                    "SELECT id, file_mtime, file_size FROM chapters WHERE file_path=?1",
                    params![path_str],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .ok();
```

Replace with:

```rust
            let existing: Option<(i64, i64, i64)> = conn
                .prepare_cached("SELECT id, file_mtime, file_size FROM chapters WHERE file_path=?1")
                .and_then(|mut stmt| {
                    stmt.query_row(params![path_str], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                })
                .ok();
```

(The `.ok()` still turns "no row" / any prepare error into `None`, matching the original semantics: a missing row means "new file → upsert".)

- [ ] **Step 2: Switch the skip-path UPDATE to `prepare_cached`**

Find the skip arm (`scan.rs:262–270`):

```rust
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
```

Replace with:

```rust
                Some((id, old_mtime, old_size))
                    if old_mtime == mtime && old_size == size && mtime != 0 =>
                {
                    conn.prepare_cached(
                        "UPDATE chapters SET last_seen_scan=?1, status='active' WHERE id=?2",
                    )?
                    .execute(params![generation, id])?;
                    *skipped += 1;
                    id
                }
```

- [ ] **Step 3: Run the scan test suite — all green**

```
cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml scan"
```

Expected: all `scan::tests::*` pass. The rescan-idempotent test exercises the cached skip UPDATE across every chapter.

- [ ] **Step 4: Commit**

```
git add src-tauri/src/scan.rs
git commit -m "perf(scan): prepare_cached for existing-row probe and skip update"
```

---

## Task 6: Cache the transcript sidecar INSERT

**Files:**
- Modify: `src-tauri/src/scan.rs` — `ingest_sidecar_transcript()` (currently the INSERT at `scan.rs:401–405`).

- [ ] **Step 1: Switch the transcripts INSERT to `prepare_cached`**

Find (`scan.rs:401–405`):

```rust
            conn.execute(
                "INSERT OR REPLACE INTO transcripts(chapter_id, source_path, content)
                 VALUES (?1, ?2, ?3)",
                params![chapter_id, source_path, content],
            )?;
```

Replace with:

```rust
            conn.prepare_cached(
                "INSERT OR REPLACE INTO transcripts(chapter_id, source_path, content)
                 VALUES (?1, ?2, ?3)",
            )?
            .execute(params![chapter_id, source_path, content])?;
```

- [ ] **Step 2: Run the scan test suite — all green (transcript ingest test included)**

```
cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml scan"
```

Expected: all `scan::tests::*` pass, including `sidecar_srt_is_ingested_and_audio_counts_unchanged`.

- [ ] **Step 3: Commit**

```
git add src-tauri/src/scan.rs
git commit -m "perf(scan): prepare_cached for transcript sidecar insert"
```

---

## Task 7: Full gate + after-measurement + speedup record

**Files:** none (verification + measurement only).

- [ ] **Step 1: Full Rust test suite (lib + integration) — all green**

```
cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml"
```

Expected: the full lib test count from the M30 baseline (178 lib tests) **plus 1** (the Task 2 guard test) = **179 lib tests**, all passing, plus all integration tests (`fixture_scan.rs` asserting 43/44/47, `scaled_scan.rs` correctness test). If any count or fixture assertion changed unexpectedly, STOP and report — behavior must be identical.

- [ ] **Step 2: Confirm no dependency / schema / FE drift**

Run:

```
git diff --stat main -- src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/db.rs
```

Expected: **empty output** (no change to `Cargo.toml`, `Cargo.lock`, or `db.rs`). If any of these show changes, STOP — you've violated the no-new-dep / no-schema-change invariants.

- [ ] **Step 3: Re-run the scale measurement on the SAME machine as Task 1**

```
pwsh -File tools\verify.ps1 -Measure
```

Expected: another `SCALE-METRICS {...}` line. Record it as **"M31 after (this machine)"**.

- [ ] **Step 4: Compute and record the speedup**

Compare `scanMs` and `rescanMs` against the Task 1 baseline captured on this same machine:

```
cold-scan speedup  = baseline.scanMs   / after.scanMs
rescan speedup     = baseline.rescanMs / after.rescanMs
```

Both should be ≥ 1.0 (faster). Note the percentage reduction for the PR description. **This is observational, not a hard gate** — if there is no measurable improvement, do NOT fail the build; instead report the before/after numbers so the owner can decide whether the milestone delivered. (A regression, however, should be investigated before merge.)

- [ ] **Step 5 (recommended): skip the screenshot walkthrough — backend-only change**

M31 changes no FE, no Tauri command signature, and no visual output, so the `m12`/`m21`/etc. screenshot matrices would be byte-identical to baseline. A `cargo tauri build --debug` + screenshot pass is **not required** for this milestone; the Rust test suite + the `SCALE-METRICS` numbers are the gate. (If the controller wants belt-and-suspenders, a single launch-and-scan smoke is sufficient — but it is optional.)

No commit in this task (handled by the controller's ROADMAP update + PR flow).

---

## Self-Review (author's checklist — completed)

1. **Spec coverage:** Original M31 sketch = {O(n²) `files.iter().find()` fix, batched statements, parallelism}. (a) O(n²) — confirmed already done in M30 (`by_stem` HashMap), documented as out-of-scope. (b) batched statements — Tasks 3–6 (`prepare_cached` on all hot per-row SQL + `RETURNING` to drop trailing `SELECT id`s). (c) parallelism — explicitly deferred per owner decision (no rayon waiver granted), documented in Non-Goals with the future `std::thread::scope` constraint. ✅
2. **Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". Every code step shows full before/after code. ✅
3. **Type consistency:** `upsert_chapter` return type changes `Result<()>` → `Result<i64>` in Task 4 Step 1, and the sole call site is updated in Task 4 Step 2 to bind `let id = upsert_chapter(...)?;` and drop the trailing SELECT — consistent. `prepare_cached` returns `CachedStatement` (chained `.query_row`/`.execute`, dropped at the statement boundary, returned to the connection's statement cache) — used identically across Tasks 3–6. Distinct cached SQL strings in the scan path total ~6 (works upsert, chapter upsert, existing-row SELECT, skip UPDATE, transcript INSERT, plus any one-offs left on `conn.execute`), well under rusqlite's default 16-statement cache capacity. ✅
