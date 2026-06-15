# M32 — Query & Index Performance

> **Written for Sonnet execution. If something in the codebase does not match what this
> plan describes (a line number moved, a string differs, a struct field changed), STOP
> and report rather than guess.** Line numbers are from a 2026-06-14 read and may drift —
> always match on the quoted code text, not the line number.

## Milestone goal

Make AudioShelf's **read queries** fast on a real 10k+ file library. Today every query is
only ever exercised on the 43/44/47 tiny fixtures, so the structural costs (correlated
subqueries, un-indexed joins) are invisible. M30 made the scan robust/incremental; M31 made
the scan **write** path fast. M32 makes the hot **read** paths fast via four additive,
low-risk levers:

1. **Add the two genuinely-missing indices** (additive `v12` migration): a *covering* index on
   `chapters(work_id, status, played, duration_secs)` and an FK index on `play_events(chapter_id)`.
2. **Rewrite `query_authors`** from 4 per-author correlated subqueries to a single `GROUP BY`.
3. **Bound `compute_insights`** — fold its per-work correlated subqueries into a `GROUP BY`
   (keep the existing, tested Rust date/streak/heatmap math unchanged).
4. **Add query PRAGMAs** (`cache_size`, `temp_store`, `mmap_size`) to the file-backed `open()`.

**Explicitly OUT of scope (owner decision 2026-06-14):**
- **FTS5 full-text search is DEFERRED to its own dedicated milestone (next).** `search_library`
  is **not modified** in M32 — it simply gets faster from the new indices (its EXISTS subqueries
  and metadata joins benefit). Do not touch `search_library`'s SQL.
- **No full SQL rewrite of `compute_insights`** — only the per-work subquery becomes a `GROUP BY`;
  the Rust aggregation (`build_insights`) is untouched.

## Scope corrections baked in (read before writing the migration)

The owner's provisional arc listed four "missing indices." Two are **already covered** by
existing `UNIQUE` auto-indexes — adding them would be redundant. **Do NOT add these:**

- ❌ `works(author_id)` — already covered by `UNIQUE(author_id, base_title)` (SQLite's
  `sqlite_autoindex_works_*` is leading on `author_id`, so `WHERE author_id=?` already uses it).
- ❌ `metadata_terms(facet, value)` — already covered by `UNIQUE(facet, value)` (leading on `facet`,
  so `facet='tag'` prefix lookups already use it).
- ❌ `chapter_metadata(chapter_id)` / `author_metadata(author_id)` / `work_metadata(work_id)` —
  each table's PRIMARY KEY is `(chapter_id, term_id)` / `(author_id, term_id)` / `(work_id, term_id)`,
  i.e. the PK auto-index is **leading** on the owner-id column, so "terms for this chapter/author/work"
  lookups are already indexed; the existing `idx_*_metadata_term` indices cover the reverse direction.

**The only two genuinely-missing, useful indices are `chapters(work_id, …)` and `play_events(chapter_id)`.**
This mirrors M31's correction (the "O(n²) fix" was already done by M30). Keeping the index set minimal
avoids slowing the M30/M31 scan-write path with redundant indices.

## Hard invariants (gates — verify at the end)

- **No new dependency.** `git diff --stat main -- src-tauri/Cargo.toml src-tauri/Cargo.lock package.json package-lock.json tools/gen-fixture/Cargo.toml` must be **EMPTY**. (FTS5 deferred → bundled SQLite already has everything; no `rayon`.)
- **Schema bumps v11 → v12, additively, on the M16 runner.** Only `CREATE INDEX IF NOT EXISTS`
  statements in the new migration step — no table rebuild, no `ALTER`, `SCHEMA_V1` untouched.
- **Read-only-on-disk preserved.** Indices/PRAGMAs are DB-internal; no `fs::write`/`remove`/`rename`
  on library files. WAL `-wal`/`-shm` sidecars are app-data (pre-existing from M30).
- **Backend-only. ZERO frontend change.** `query_authors` → `AuthorRow`, `compute_insights` →
  `InsightsData`, and all command signatures are **byte-identical** in shape. `git diff --stat main -- src/`
  must be **EMPTY**. No screenshot walkthrough (M31 precedent — backend-only perf milestone).
- **Default fixture stays 43/44/47.** `fixture_scan.rs` counts unchanged.

## Environment / build runbook (from M30/M31 decision log — do not deviate)

- **Run cargo via the PowerShell tool** (the Bash-tool `cmd /c "tools\dev-env.cmd cargo …"` form
  silently no-ops in this session). Exact form that works:
  ```
  cmd /c '"C:\Agent Projects\AudioShelf\tools\dev-env.cmd" cargo test --manifest-path "C:\Agent Projects\AudioShelf\src-tauri\Cargo.toml" <filter>'
  ```
  Package is **`audioshelf`** (lib target `audioshelf_lib`) → use `cargo test` / `--test <name>`,
  **never** `-p audioshelf_lib`.
- **`verify.ps1 -Measure` from the Bash tool needs a forward-slash path**: `pwsh -File tools/verify.ps1 -Measure`
  (a backslash `tools\verify.ps1` gets eaten → "toolsverify.ps1 not found").
- No FE build / no frozen Tauri build / no screenshots are required this milestone (backend-only).
  Still run `npx tsc --noEmit` + `npm test` at the end to prove FE is untouched.

---

## Task 1 — v12 migration: the two missing indices + version bump

**File:** `src-tauri/src/db.rs`

### 1a. Add the migration function

Add a new migration function next to `migration_v11_scan_tracking` (which currently reads):

```rust
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

Add immediately **after** it:

```rust
/// v12 — query performance: the two genuinely-missing indices.
/// `idx_chapters_work` is a COVERING index for the work-grouped aggregations in
/// `query_authors` and `compute_insights` (work_id join + status/played/duration read
/// entirely from the index → index-only scan). `idx_play_events_chapter` is the FK
/// index for per-chapter event lookups. (works.author_id and metadata_terms(facet,value)
/// are intentionally NOT added — already covered by their UNIQUE auto-indexes; see the
/// M32 plan "Scope corrections" section.)
fn migration_v12_query_indices(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_chapters_work
             ON chapters(work_id, status, played, duration_secs);
         CREATE INDEX IF NOT EXISTS idx_play_events_chapter
             ON play_events(chapter_id);",
    )?;
    Ok(())
}
```

### 1b. Register the step in `migrate()`

In `migrate()`, the last step is currently:

```rust
    if current < 11 { run_step(conn, 11, migration_v11_scan_tracking)? }
    conn.execute("INSERT OR REPLACE INTO settings(key, value) VALUES ('schema_version', ?1)", [LATEST.to_string()])?;
```

Insert the v12 step **before** the `INSERT OR REPLACE INTO settings` line:

```rust
    if current < 11 { run_step(conn, 11, migration_v11_scan_tracking)? }
    if current < 12 { run_step(conn, 12, migration_v12_query_indices)? }
    conn.execute("INSERT OR REPLACE INTO settings(key, value) VALUES ('schema_version', ?1)", [LATEST.to_string()])?;
```

### 1c. Mirror in `open_at_version()`

`open_at_version()` mirrors `migrate()` with `if version >= N` gates and ends with the v11 step
then `Ok(conn)`. Its last step currently reads:

```rust
    if version >= 11 { run_step(&conn, 11, migration_v11_scan_tracking)? }
    Ok(conn)
```

Change to:

```rust
    if version >= 11 { run_step(&conn, 11, migration_v11_scan_tracking)? }
    if version >= 12 { run_step(&conn, 12, migration_v12_query_indices)? }
    Ok(conn)
```

### 1d. Bump `LATEST`

```rust
pub(crate) const LATEST: i64 = 11;
```
→
```rust
pub(crate) const LATEST: i64 = 12;
```

### 1e. Bump the "reaches LATEST" version asserts in db.rs tests

In `src-tauri/src/db.rs`'s `#[cfg(test)] mod tests`, several tests assert the schema reaches the
latest version. Bump **only** the assertions that check a *full open / current version*. Known sites
(match on context, not just the number):

- `migrate_sets_user_version`: `assert_eq!(ver, 11);` → `12`
- `migrate_from_v1_is_noop_when_current` (or similar): `assert_eq!(ver, 11);` → `12`
- `legacy_db_with_v1_tables_user_version_0_upgrades`: `assert_eq!(post, 11);` → `12`
- `open_in_memory_has_..._and_user_version_11` (rename the test if its name hardcodes `11` is optional;
  the assert `assert_eq!(ver, 11);` → `12`)
- `upgrade_from_v1_to_v2` trailing `assert_eq!(post, 11);` → `12`
- `upgrade_from_v2` trailing `assert_eq!(post, 11);` → `12`
- `legacy_db_upgrades_through_v6` trailing `assert_eq!(v, 11);` → `12`
- `open_at_version_11_reaches_latest`: `assert_eq!(v, 11); assert_eq!(v, LATEST);`
  — the **first** assert checks the step `11` ran; the `LATEST` assert is now `12`, so this test name
  is misleading. **Action:** change the call to `open_at_version(12)` and the asserts to
  `assert_eq!(v, 12); assert_eq!(v, LATEST);` **OR** add a new sibling test `open_at_version_12_reaches_latest`
  and leave `open_at_version_11_…` testing that opening at 11 then migrating reaches LATEST=12. Prefer
  the latter (add a new test) so the v11 path stays covered. If the existing test does
  `open_at_version(11)` and asserts `v == LATEST`, it will now expect `12` — update its `LATEST`-side assert.

> **⚠ Do NOT blindly bump every `11` in the test module.** Any assert that specifically tests the
> **v11 step** (e.g. "opening at v10 then running one step reaches v11", or a guard "requires v11")
> must stay `11`. Only the asserts that mean "the DB reached the *latest* schema" become `12`.
> When in doubt about a given `11`, STOP and report it rather than guess.

### 1f. Run db.rs tests to catch missed asserts

```
cmd /c '"C:\Agent Projects\AudioShelf\tools\dev-env.cmd" cargo test --manifest-path "C:\Agent Projects\AudioShelf\src-tauri\Cargo.toml" --lib db::'
```
Fix any remaining `assert_eq!(…, 11)` the compiler/test run flags as a "reaches latest" assertion.
**(M30 lesson: `cargo test` is the gate that catches missed version asserts.)**

---

## Task 2 — Query PRAGMAs in the file-backed `open()`

**File:** `src-tauri/src/db.rs`

`open()` currently sets robustness PRAGMAs (added in M30). Extend with three read-perf PRAGMAs.
Current:

```rust
pub fn open(path: &str) -> rusqlite::Result<Connection> {
    crate::backup::apply_pending_restore(path); // best-effort, crash-safe staged restore
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA busy_timeout = 5000;",
    )?;
    migrate(&conn)?;
    Ok(conn)
}
```

Change the `execute_batch` string to:

```rust
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA busy_timeout = 5000;
         PRAGMA cache_size = -16384;
         PRAGMA temp_store = MEMORY;
         PRAGMA mmap_size = 134217728;",
    )?;
```

- `cache_size = -16384` → 16 MB page cache (negative = KiB; default is ~2 MB). Bigger working set
  stays hot across the aggregation queries.
- `temp_store = MEMORY` → `GROUP BY`/`ORDER BY` scratch tables/indices live in RAM, not a temp file.
- `mmap_size = 134217728` → 128 MB memory-mapped reads (read-heavy win). **This is the one PRAGMA to
  drop first if any instability shows on Windows + WAL; cache_size + temp_store are the safe core.**

**Do NOT change `open_in_memory()`** — in-memory DBs (used by tests) already hold everything in RAM,
so these PRAGMAs are moot there and changing it would only risk test nondeterminism.

---

## Task 3 — Rewrite `query_authors` to a single `GROUP BY`

**File:** `src-tauri/src/commands.rs` (function `query_authors`, ~line 273)

Replace **only** the main `conn.prepare(...)` SQL string (the one with the four correlated
subqueries). The current statement is:

```rust
    let mut stmt = conn.prepare(
        "SELECT a.id,
                COALESCE(a.display_name, a.folder_name) AS name,
                (SELECT count(*) FROM works w WHERE w.author_id=a.id AND w.status='active'),
                (SELECT count(*) FROM chapters c JOIN works w ON c.work_id=w.id
                   WHERE w.author_id=a.id AND c.status='active'),
                (SELECT count(*) FROM chapters c JOIN works w ON c.work_id=w.id
                   WHERE w.author_id=a.id AND c.status='active' AND c.played=0),
                (SELECT COALESCE(sum(c.duration_secs), 0) FROM chapters c JOIN works w ON c.work_id=w.id
                   WHERE w.author_id=a.id AND c.status='active')
         FROM authors a WHERE a.status='active'",
    )?;
```

Replace with:

```rust
    let mut stmt = conn.prepare(
        "SELECT a.id,
                COALESCE(a.display_name, a.folder_name) AS name,
                COUNT(DISTINCT w.id) AS work_count,
                COUNT(c.id) AS chapter_count,
                COALESCE(SUM(CASE WHEN c.played = 0 THEN 1 ELSE 0 END), 0) AS unplayed_count,
                COALESCE(SUM(c.duration_secs), 0) AS total_secs
         FROM authors a
         LEFT JOIN works w    ON w.author_id = a.id AND w.status = 'active'
         LEFT JOIN chapters c ON c.work_id  = w.id AND c.status = 'active'
         WHERE a.status = 'active'
         GROUP BY a.id",
    )?;
```

**Do not change anything else in the function.** The `query_map` closure already reads columns
0–5 in this exact order (`id`, `name`, `work_count`, `chapter_count`, `unplayed_count`, `total_secs`),
and the two follow-up tag-aggregation queries + the final `natural_cmp` sort are unchanged.

### Why this is equivalent (and the correctness risk to test)

- Status filters live in the **JOIN ON** clauses (not `WHERE`) so an author with no active works
  still appears with zeros (preserves the correlated-subquery semantics).
- `COUNT(DISTINCT w.id)` is required because the chapter join fans out work rows.
- `COUNT(c.id)` ignores the NULL rows produced for works-with-no-chapters / authors-with-no-works.
- Each active chapter belongs to exactly one work → appears once in the fan-out → `SUM(duration_secs)`
  and the played/unplayed `CASE` sums are each counted once.
- The covering index `idx_chapters_work` (Task 1) makes the chapters join+aggregate an index-only scan;
  `works.author_id` join uses the existing `UNIQUE(author_id, base_title)` auto-index.

The **fan-out double-counting** is the one real risk — Task 5 adds a multi-work/mixed-played test that
locks it.

---

## Task 4 — Bound `compute_insights`'s per-work subqueries with a `GROUP BY`

**File:** `src-tauri/src/insights.rs` (function `compute_insights`, the `works` block ~line 372)

Replace **only** the per-work `conn.prepare(...)` SQL (the one with two correlated `count(*)`
subqueries). Current:

```rust
        let mut s = conn.prepare(
            "SELECT w.id, w.author_id,
                    (SELECT count(*) FROM chapters c WHERE c.work_id=w.id AND c.status='active'),
                    (SELECT count(*) FROM chapters c WHERE c.work_id=w.id AND c.status='active' AND c.played=1)
             FROM works w",
        )?;
```

Replace with:

```rust
        let mut s = conn.prepare(
            "SELECT w.id, w.author_id,
                    COALESCE(SUM(CASE WHEN c.status = 'active' THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN c.status = 'active' AND c.played = 1 THEN 1 ELSE 0 END), 0)
             FROM works w
             LEFT JOIN chapters c ON c.work_id = w.id
             GROUP BY w.id",
        )?;
```

**Do not change anything else** — the row reader (`work_id`, `author_id`, `total`, `done`),
the `fully_played = total > 0 && done == total` logic, the tag-union maps, and the trailing
`build_insights(...)` call are all unchanged. This keeps the over-ALL-works semantics (no
`status` filter on `works`) identical and folds the two subqueries into one indexed
`GROUP BY` over `idx_chapters_work`.

The events query (`play_events JOIN chapters JOIN works`) and the rest of `compute_insights`
are **not** modified (the play_events scan is inherent to streak/heatmap math; its joins use PKs).

---

## Task 5 — Tests: index existence, query equivalence, and EXPLAIN-QUERY-PLAN proof

**File:** `src-tauri/src/commands.rs` `#[cfg(test)] mod tests` (and `insights.rs` tests as noted).

### 5a. Grep `commands.rs` for stray "reaches latest" version asserts

**(M30 T1 lesson: 4 such asserts were missed in `commands.rs`.)** Search `commands.rs` for
`user_version == 11`, `assert_eq!(.*, 11)`, `open_at_version(11`, and any `requires v11`/`_11_`.
Bump only the ones meaning "the DB reached the latest schema" to `12`; leave v11-step-specific
guards at `11`. Re-run `cargo test --lib` to confirm.

### 5b. Index-existence test

Add to `commands.rs` tests:

```rust
#[test]
fn m32_indices_exist() {
    let conn = open_in_memory().unwrap();
    let has = |name: &str| -> bool {
        conn.query_row(
            "SELECT 1 FROM sqlite_master WHERE type='index' AND name=?1",
            [name],
            |_| Ok(()),
        )
        .optional()
        .unwrap()
        .is_some()
    };
    assert!(has("idx_chapters_work"), "covering chapters index missing");
    assert!(has("idx_play_events_chapter"), "play_events FK index missing");
}
```

> If `optional()` isn't already in scope, add `use rusqlite::OptionalExtension;` at the top of the
> test module (check whether it's already imported before adding).

### 5c. `query_authors` multi-work fan-out equivalence test

This locks the `GROUP BY` rewrite against double-counting. Use the existing test helpers
(`tempfile::tempdir`, `touch`, `open_in_memory`, `scan::scan_into`) — mirror the pattern in
`authors_and_detail_reflect_scan`:

```rust
#[test]
fn query_authors_aggregates_across_multiple_works() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    let author = root.join("Multi Work Author");
    // Work "Alpha": 2 chapters; Work "Beta": 3 chapters.
    touch(&author.join("Alpha 1.mp3"));
    touch(&author.join("Alpha 2.mp3"));
    touch(&author.join("Beta 1.mp3"));
    touch(&author.join("Beta 2.mp3"));
    touch(&author.join("Beta 3.mp3"));
    let conn = open_in_memory().unwrap();
    scan::scan_into(&conn, root).unwrap();

    // Mark exactly one chapter played so unplayed_count != chapter_count.
    conn.execute(
        "UPDATE chapters SET played = 1 WHERE id = (SELECT MIN(id) FROM chapters)",
        [],
    )
    .unwrap();

    let authors = query_authors(&conn).unwrap();
    assert_eq!(authors.len(), 1);
    let a = &authors[0];
    assert_eq!(a.work_count, 2, "two distinct works (no fan-out double-count)");
    assert_eq!(a.chapter_count, 5, "five active chapters total");
    assert_eq!(a.unplayed_count, 4, "one of five marked played");
}
```

> If the scanner groups "Alpha"/"Beta" differently than two works, adjust the filenames to whatever
> the grouping heuristic splits into two works (e.g. distinct base titles) — the assertion that matters
> is `work_count == 2`, `chapter_count == 5`, `unplayed_count == 4`. If you cannot get two works from
> the heuristic, seed `works`/`chapters` rows directly with `conn.execute` instead of scanning. STOP
> and report if neither approach yields the two-work shape.

### 5d. EXPLAIN QUERY PLAN proof the covering index is used (new prior-art)

Add a test asserting the optimizer chooses `idx_chapters_work` for the `query_authors` aggregation —
durable proof the index is doing its job (no `EXPLAIN QUERY PLAN` test exists in the repo today):

```rust
#[test]
fn query_authors_plan_uses_covering_index() {
    let conn = open_in_memory().unwrap();
    let plan: String = {
        let mut stmt = conn
            .prepare(
                "EXPLAIN QUERY PLAN
                 SELECT a.id,
                        COALESCE(a.display_name, a.folder_name) AS name,
                        COUNT(DISTINCT w.id),
                        COUNT(c.id),
                        COALESCE(SUM(CASE WHEN c.played = 0 THEN 1 ELSE 0 END), 0),
                        COALESCE(SUM(c.duration_secs), 0)
                 FROM authors a
                 LEFT JOIN works w    ON w.author_id = a.id AND w.status = 'active'
                 LEFT JOIN chapters c ON c.work_id  = w.id AND c.status = 'active'
                 WHERE a.status = 'active'
                 GROUP BY a.id",
            )
            .unwrap();
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(3))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        rows.join(" | ")
    };
    assert!(
        plan.contains("idx_chapters_work"),
        "query_authors should use idx_chapters_work; plan was: {plan}"
    );
}
```

> Column index `3` is EXPLAIN QUERY PLAN's `detail` text column in rusqlite 0.32 (columns are
> `id, parent, notused, detail`). If `r.get::<_, String>(3)` fails, the detail column index differs —
> read all columns and find the text one; STOP and report if unclear. Keep the SQL here **identical**
> to Task 3's so the test tracks the real query.

### 5e. Confirm existing insights tests still pass

`compute_insights`'s `fully_played` and totals are already exercised by the `insights.rs` tests.
Run them; they lock Task 4's equivalence. If there is **no** existing test that covers a work with a
mix of played/unplayed active chapters across multiple works, add a small one in `insights.rs` tests
asserting `fully_played` is true only when every active chapter is played (mirror an existing insights
test's setup).

### 5f. Run the full Rust suite

```
cmd /c '"C:\Agent Projects\AudioShelf\tools\dev-env.cmd" cargo test --manifest-path "C:\Agent Projects\AudioShelf\src-tauri\Cargo.toml"'
```
All lib + integration tests green, including `fixture_scan` (still 43/44/47) and `scaled_scan`.

---

## Task 6 — Scale measurement: `measure_queries_at_scale`

**File:** `src-tauri/tests/scaled_scan.rs` (alongside `measure_scan_at_scale`).

Add an `#[ignore]`d timing test that builds the 12k-chapter fixture, scans it, seeds some
play_events, then times the three hot read paths and emits a `QUERY-METRICS` JSON line (parallel to
M30's `SCALE-METRICS`). Mirror the imports/setup already used by `measure_scan_at_scale` in this file
(`gen_fixture::generate_scaled`, `open_in_memory`, `scan_into`, `std::time::Instant`).

```rust
#[test]
#[ignore = "scale measurement; run explicitly with --ignored --nocapture"]
fn measure_queries_at_scale() {
    use audioshelf_lib::commands::{query_authors, search_library_for_test};
    use audioshelf_lib::insights::compute_insights;

    let tmp = tempfile::tempdir().unwrap();
    let (authors, works, chapters) = (1000u32, 3, 4); // ~12k chapters
    gen_fixture::generate_scaled(tmp.path(), authors, works, chapters).unwrap();
    let conn = open_in_memory().unwrap();
    scan_into(&conn, tmp.path()).unwrap();

    // Seed a moderate number of play_events so compute_insights' event scan is non-trivial.
    conn.execute_batch(
        "INSERT INTO play_events(chapter_id, played_at)
         SELECT id, 1700000000000 + id * 1000 FROM chapters LIMIT 3000;",
    )
    .unwrap();

    let t = std::time::Instant::now();
    let _ = query_authors(&conn).unwrap();
    let qa_ms = t.elapsed().as_millis();

    let t = std::time::Instant::now();
    let _ = search_library_for_test(&conn, "story").unwrap();
    let search_ms = t.elapsed().as_millis();

    let t = std::time::Instant::now();
    let _ = compute_insights(&conn, 1700100000000, 0).unwrap();
    let insights_ms = t.elapsed().as_millis();

    println!(
        "QUERY-METRICS {{\"chapters\":{},\"queryAuthorsMs\":{},\"searchMs\":{},\"insightsMs\":{}}}",
        authors * works * chapters,
        qa_ms,
        search_ms,
        insights_ms
    );
}
```

> **Visibility/import note:** `query_authors` and `compute_insights` must be reachable from the
> integration-test crate. `compute_insights` is `pub fn` in `insights.rs`; confirm `insights` is a
> `pub mod` re-exported from the lib root (`audioshelf_lib`). `query_authors` is `pub fn` in `commands.rs`.
> For search, the public Tauri command `search_library(query)` takes Tauri `State`, not a `&Connection`,
> so it can't be called directly in a test. **Add a thin test-only accessor** next to `search_library`
> in `commands.rs` that wraps the existing internal `search` helper:
> ```rust
> #[doc(hidden)]
> pub fn search_library_for_test(conn: &rusqlite::Connection, query: &str) -> rusqlite::Result<SearchResults> {
>     search(conn, query) // the existing internal helper used by the search_library command
> }
> ```
> Match the real helper's name/signature (the digest calls it `search`); if it differs, adapt. If any of
> these three can't be reached without a larger refactor, STOP and report — do **not** make private items
> `pub` broadly or restructure modules to force it.

### Wire it into `verify.ps1 -Measure`

`tools/verify.ps1`'s `-Measure` branch currently runs the single test
`--test scaled_scan measure_scan_at_scale -- --ignored --nocapture`. Read the exact current line,
then broaden the test filter from `measure_scan_at_scale` to `measure_` so **both** `#[ignore]`d
timing tests run (cargo's test-name filter is a substring match):

```
... --test scaled_scan measure_ -- --ignored --nocapture
```

Both `SCALE-METRICS` and `QUERY-METRICS` lines will print. If the current `-Measure` line differs from
the digest's quoted form, match the real text and make the minimal change to broaden the filter.

---

## Task 7 — Verify (gates + observational A/B measurement)

1. **Rust:** full `cargo test` green (Task 5f) — lib + integration, `fixture_scan` 43/44/47.
2. **FE untouched:** `npx tsc --noEmit` clean and `npm test` green — and confirm
   `git diff --stat main -- src/` is **EMPTY** (no FE change this milestone).
3. **Invariant diffs EMPTY:**
   `git diff --stat main -- src-tauri/Cargo.toml src-tauri/Cargo.lock package.json package-lock.json tools/gen-fixture/Cargo.toml`
   → no output (no new dep). Confirm the only `db.rs` schema change is the additive v12 index step.
4. **Read-only audit:** grep `scan.rs` + `commands.rs` for `fs::remove`/`fs::write`/`fs::rename`/`File::create`
   → only `#[cfg(test)]` helpers or pre-existing export/backup commands (no new library-file writes).
5. **Observational perf (NOT a CI gate — M31 lesson):** measure **interleaved A/B in the same session**,
   never against an old baseline (`genMs` is the env-drift canary):
   - `git stash` or checkout `main` → `pwsh -File tools/verify.ps1 -Measure` → record `QUERY-METRICS`.
   - Checkout the branch → `pwsh -File tools/verify.ps1 -Measure` → record `QUERY-METRICS`.
   - Repeat the pair once more; report branch-vs-main `queryAuthorsMs` / `insightsMs` / `searchMs`.
   Expect `query_authors` + `insights` markedly faster on the branch (index-only aggregation). Record the
   numbers in the PR body + ROADMAP note. Do not fail the milestone on absolute numbers — the EXPLAIN
   QUERY PLAN test (5d) is the durable proof the index is used.

---

## Task 8 — PR, CI, merge, ROADMAP

1. Branch (e.g. `m32-query-index-performance`), commit per the repo identity
   (`yovanmc <yovanmc@users.noreply.github.com>`; append `Co-authored-by: Codex <noreply@openai.com>`
   after a blank line per `AGENTS.md` for substantive commits).
2. Push → open PR titled **"M32 — Query & Index Performance"**; body summarizes the four levers, the
   index scope-correction (only 2 indices genuinely needed), and the before/after `QUERY-METRICS`.
3. **FOREGROUND** CI watch: `gh pr checks <PR#> --watch` (sleep ~20s first to dodge "no checks reported").
4. Merge from main `--merge --delete-branch`; sync main.
5. **Update `ROADMAP.md`:** add the M32 row to the v8 table as `✅ Merged` with PR # and a one-line
   summary; append a decision-log entry (indices added, scope corrections, PRAGMAs, QUERY-METRICS
   baseline, FTS5 deferred to next milestone). Note the arc now reads:
   **M30 ✅ → M31 ✅ → M32 ✅ → M33 = FTS5 full-text search (deferred here) → M34 = rendering & memory at scale.**
6. Ping the handoff and STOP.

## Acceptance criteria

- Schema at **v12**; `idx_chapters_work` + `idx_play_events_chapter` exist (test 5b); no other index added.
- `query_authors` and `compute_insights` return **identical** results (existing tests + 5c green) via
  `GROUP BY` instead of correlated subqueries; EXPLAIN QUERY PLAN (5d) shows `idx_chapters_work` in use.
- Query PRAGMAs set in `open()` only.
- Full Rust suite green; `fixture_scan` still 43/44/47; FE untouched (`tsc`/`npm test` green, `src/` diff empty).
- No new dependency; read-only-on-disk preserved; `QUERY-METRICS` recorded (observational).
- FTS5 + `search_library` SQL **unchanged** (deferred to the next milestone).
