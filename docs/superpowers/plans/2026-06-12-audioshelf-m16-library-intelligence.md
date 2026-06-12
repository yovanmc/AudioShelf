# M16 — Library Intelligence — Implementation Plan

> **Written for Sonnet execution.** Every path, symbol, struct, and line ref below was read from the
> live tree on 2026-06-12 (post-M15) via a thorough backend digest. If something doesn't match (a
> renamed symbol, a moved line, a different column), **STOP and report** rather than guessing. Run
> each task's verify step before moving on. This is the project's **first backend/schema milestone**
> after a long frontend-only streak — treat the migration framework (Task 1) as the load-bearing
> foundation; everything else depends on it.

## Scope

The **broad** M16 (all 8 backlog sub-features, user-confirmed 2026-06-12) plus the app's first
versioned migration runner. This is a large, mixed Rust+React milestone. It is sequenced so the
migration runner is proven on the **smallest, dependency-free schema change first (tag taxonomy)**,
then heavier schema is layered on. Tasks are independently verifiable so the build can checkpoint.

**The 8 sub-features** (backlog): embedded-metadata ingestion · series/reading-order detection · tag
taxonomy (rename/merge/alias) · auto-tag suggestions · "more like this" within-library graph ·
calmer Discover with visible reasoning · dormancy/"Forgotten" surfacing · transcripts/search-within.

### Key facts the digest established (these de-risk the milestone — rely on them, but verify)
- **No migrations exist.** `migrate()` (`src-tauri/src/db.rs:77-81`) just runs `SCHEMA_V1` (all
  `CREATE TABLE IF NOT EXISTS`) + `INSERT OR IGNORE INTO settings('schema_version','1')`. No
  `PRAGMA user_version`. **This is the insertion point for the runner.**
- **All M16 migrations are ADDITIVE** (new tables + `ADD COLUMN`) → **no FK-off table-rebuild
  needed**; crash-safety = wrap each migration in a transaction and bump `user_version` atomically
  inside it. (Include a documented table-rebuild helper for future use, but M16 doesn't exercise it.)
- **`lofty = "0.21"` is ALREADY a dependency** (`src-tauri/Cargo.toml`), already used in `scan.rs`
  (`probe_duration_secs`, ~`scan.rs:34-42`, called at `scan.rs:107`) and `covers.rs`
  (`primary_tag()`). **Embedded-metadata ingestion needs NO new crate** — extend the existing
  `lofty::read_from_path` call to also read `.primary_tag()`. The env is standard online cargo
  (`Cargo.lock` committed, no vendored/offline config) so a new crate *could* be added if ever
  needed — but M16 needs none.
- **Tags are denormalized strings** in `author_tags`/`work_tags`/`chapter_tags` (`(entity_id, tag
  TEXT)`, composite PK). No normalized tags table. Rename = `UPDATE {table} SET tag=? WHERE tag=?`
  across all 3; merge = same with a delete of the source rows; **no FK hazard** (tag rows have no
  dependents). The tag write helper is `replace_tags(conn, table, key_col, id, tags)`
  (`commands.rs:126-144`); read is `get_all_tags` (`commands.rs:104-116`).
- **Series detection backbone exists**: `grouping::parse_stem` (`grouping.rs:20-36`) extracts
  `(base_title, chapter_no)`; `group_author` (`grouping.rs:54-109`) clusters by base. M16 surfaces
  a higher-level *series* grouping of WORKS; reuse `parse_stem` for spine ordering.
- **Discovery/Home backbone**: `discovery_for_tags(conn, &tags, &exclude_authors, cap)`
  (`commands.rs:394-452`, ranks by shared-tag count then unplayed) and `recommendation_reason`
  (`commands.rs:654-661`, already emits reason strings for Home) are reusable for "more like this"
  and "calmer Discover with reasons". `discovery_for_tags` currently DROPS the reason — expose it.
- **Dormancy data exists**: `play_events(id, chapter_id, played_at INTEGER ms)`. Per-work recency =
  `MAX(pe.played_at)` joined via chapters. No dormancy query yet — add one.
- **DB/state**: `DbState(pub Mutex<rusqlite::Connection>)` (`commands.rs:12`); commands lock via
  `state.0.lock()`. `db::open_in_memory()` (`db.rs:70-75`) for tests. Schema in `SCHEMA_V1` const
  (`db.rs:7-59`). Commands registered in `tauri::generate_handler![...]` (`lib.rs:42-71`).
- **Tests**: 47 today, mostly inline `#[cfg(test)]` modules + 4 integration tests in
  `src-tauri/tests/`. **`tests/fixture_scan.rs:12-17` hardcodes `authors=43, works=44, chapters=47`**
  — M16 must keep these unchanged (metadata ingestion is **preview/apply, NOT auto-applied at scan**,
  and series rows don't change work/chapter counts). The cargo test count WILL grow (new tests) — the
  gate is "all green + fixture counts still 43/44/47", not "stays 47".
- **FE patterns to reuse**: the Rename tool's **preview→apply→undo** flow
  (`preview_renames`/`apply_renames`/`undo_renames` commands + RenameView) is the model for metadata
  ingestion's diff-preview-before-apply. Shared FE primitives from M13 (`Dialog`, `SectionHeading`,
  `TagGroup`, `PageHeader`, `Button`, `IconButton`, `Notice`, `EmptyState`) are in
  `src/components/ui.tsx`. The settings/JSON-setting pattern (`get_setting`/`set_setting`,
  `parseBrowsePrefs`) is the model for any new persisted FE state.

### Gates
`cargo test` (all green; **fixture_scan counts stay 43/44/47**) · `cargo clippy` clean if the repo
runs it in CI (check `.github/workflows`) · `npx tsc --noEmit` · `npm test` (≥210; add tests) ·
before/after `m12` screenshot matrix + new M16 surfaces via a subagent verdict. **No regression of
the existing 47 Rust tests.**

---

## PHASE 1 — Migration framework (foundation; do FIRST)

### Task 1 — Versioned, crash-safe migration runner

**File:** `src-tauri/src/db.rs`. Refactor `migrate()` (currently `db.rs:77-81`) into a
`PRAGMA user_version`-gated runner. The existing `SCHEMA_V1` becomes migration **v1**.

1. Keep `const SCHEMA_V1: &str` as-is (it's the v1 body).
2. Replace `fn migrate` with:
```rust
/// Ordered, idempotent migration runner. Each step bumps user_version inside its own
/// transaction so a crash mid-migration leaves the DB at the last fully-applied version.
fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    // (migration_no, apply-fn)
    const LATEST: i64 = 1; // bump as you add steps below
    if current < 1 { run_step(conn, 1, |c| { c.execute_batch(SCHEMA_V1)?; Ok(()) })?; }
    // Task 2 adds: if current < 2 { run_step(conn, 2, migration_v2_tag_taxonomy)?; }
    // Task 4 adds: if current < 3 { run_step(conn, 3, migration_v3_metadata_source)?; }
    // Task 6 adds: if current < 4 { run_step(conn, 4, migration_v4_series)?; }
    // Task 8 adds: if current < 5 { run_step(conn, 5, migration_v5_transcripts)?; }
    // keep the legacy sentinel for human-readable cross-check
    conn.execute(
        "INSERT OR IGNORE INTO settings(key, value) VALUES ('schema_version', ?1)",
        [LATEST.to_string()],
    )?;
    let _ = current; // silence if no steps run
    Ok(())
}

/// Run one migration step in a transaction, bumping user_version atomically.
fn run_step(conn: &Connection, version: i64, body: impl FnOnce(&Connection) -> rusqlite::Result<()>) -> rusqlite::Result<()> {
    conn.execute_batch("BEGIN")?;
    let result = (|| {
        body(conn)?;
        conn.execute_batch(&format!("PRAGMA user_version = {version}"))?;
        Ok(())
    })();
    match result {
        Ok(()) => { conn.execute_batch("COMMIT")?; Ok(()) }
        Err(e) => { let _ = conn.execute_batch("ROLLBACK"); Err(e) }
    }
}
```
> NOTE: `PRAGMA user_version = N` cannot be parameterized — the `format!` with a validated integer
> `version` is correct and safe (not user input). Confirm `execute_batch("BEGIN")`/`COMMIT` works on
> this rusqlite version (0.32); if a `Transaction` handle is cleaner given the borrow of `conn`, use
> `conn.unchecked_transaction()` instead and report. The `Connection` is borrowed `&`, so prefer the
> `execute_batch` BEGIN/COMMIT style to avoid `&mut` requirements.
3. **Update the `schema_version` sentinel write to `INSERT OR REPLACE`** so it tracks LATEST (the old
   `INSERT OR IGNORE` would freeze it at '1'); use `INSERT OR REPLACE INTO settings(...)`.
4. **Test helper** for migration tests — add to the `testing` module (`lib.rs:77-87`) or `db.rs`:
```rust
/// Open an in-memory DB and apply migrations only up to `version` (for upgrade tests).
pub fn open_at_version(version: i64) -> Connection { /* run steps 1..=version, set user_version */ }
```
   Implement by running the same step bodies guarded by `if version >= n`. Keep it `#[cfg(test)]` or
   under `testing`.
5. **Tests** (`db.rs` `#[cfg(test)]`): keep `migrate_is_idempotent`; add: `migrate_sets_user_version`
   (after `open_in_memory`, `PRAGMA user_version` == LATEST); `migrate_from_v1_is_noop_when_current`
   (open, run migrate twice, user_version stable, no error). As later tasks add steps, they add
   `upgrade_from_vN` tests using `open_at_version`.

**Verify:** `cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml"` — all green,
fixture counts unchanged. `npx tsc --noEmit` (no FE change yet, sanity).

> **Critical:** existing real DBs in the wild have `user_version = 0` but already have all v1 tables
> (created by the old `CREATE TABLE IF NOT EXISTS migrate()`). Running step 1 on them re-runs
> `SCHEMA_V1` (idempotent — `IF NOT EXISTS`) and sets `user_version = 1`. That's correct and
> harmless. Confirm a DB that already has v1 tables but `user_version=0` upgrades cleanly — add a
> test that pre-creates the v1 tables, sets `user_version=0`, then runs `migrate()` and asserts it
> reaches LATEST without error.

---

## PHASE 2 — Tag taxonomy (anchor schema feature)

### Task 2 — Migration v2 + tag-taxonomy backend

**Migration v2** (`db.rs`, add `migration_v2_tag_taxonomy` and wire `if current < 2` in `migrate`,
bump `LATEST` to 2):
```sql
CREATE TABLE IF NOT EXISTS tag_aliases (
  alias     TEXT PRIMARY KEY,   -- the deprecated/alternate spelling
  canonical TEXT NOT NULL       -- resolves to this tag
);
CREATE TABLE IF NOT EXISTS tag_parents (
  child  TEXT PRIMARY KEY,      -- optional hierarchy: child tag → parent tag
  parent TEXT NOT NULL
);
```
**Rust commands** (`commands.rs`; register each in `lib.rs:42-71`):
- `list_tags_with_counts(state) -> Vec<TagStat>` where `TagStat { tag: String, work_count: i64,
  chapter_count: i64, author_count: i64 }`. SQL: per distinct tag across the 3 tables, count usages.
- `rename_tag(state, from: String, to: String) -> Result<(), String>`: `UPDATE author_tags SET
  tag=?to WHERE tag=?from` (+ work_tags, chapter_tags). Use `INSERT OR IGNORE`-safe semantics — if a
  row `(id, to)` already exists the composite PK would conflict on UPDATE; do it as: for each table,
  `INSERT OR IGNORE INTO t(key, tag) SELECT key, ?to FROM t WHERE tag=?from;` then `DELETE FROM t
  WHERE tag=?from;` (this merges cleanly if `to` already present). Wrap all in one transaction.
- `merge_tags(state, sources: Vec<String>, target: String)`: same INSERT-OR-IGNORE-then-DELETE for
  each source → target, in one transaction.
- `set_tag_alias(state, alias: String, canonical: String)` / `clear_tag_alias(state, alias: String)`:
  upsert/delete in `tag_aliases`.
- `set_tag_parent(state, child: String, parent: String)` / `clear_tag_parent(...)`: optional
  hierarchy.
- **Alias resolution in discovery:** in `discovery_for_tags` (`commands.rs:394-452`), before
  intersecting, map each owned tag through `tag_aliases` (alias→canonical) so an aliased tag matches
  its canonical. Add a small `resolve_aliases(conn, tags) -> Vec<String>` helper and apply it to both
  the work's owned tags and the requested tags. Keep it a pure helper for unit testing.
- **Tests** (`commands.rs` `#[cfg(test)]`): seed tags via scan or direct inserts; assert
  `rename_tag` moves usages and dedupes when target exists; `merge_tags` collapses; `set_tag_alias` +
  discovery resolves an aliased tag; `list_tags_with_counts` returns correct counts. Add an
  `upgrade_from_v1` migration test (`open_at_version(1)` → `migrate` → `tag_aliases` exists).

**Verify:** cargo test green; fixture counts 43/44/47.

### Task 3 — Tag-taxonomy management UI (frontend)

A new **"Manage tags"** surface. Recommended: a dedicated view reachable from the sidebar (follow how
existing routes/nav work in `App.tsx` + the sidebar) OR a section in Settings if simpler — read the
current nav/route setup and pick the lower-friction option; report which.
- **API wrappers** (`src/lib/api.ts`): `listTagsWithCounts()`, `renameTag(from,to)`,
  `mergeTags(sources,target)`, `setTagAlias(alias,canonical)`, `clearTagAlias(alias)`,
  `setTagParent`/`clearTagParent`, with matching TS types (`TagStat`).
- **View** (`src/views/TagManagerView.tsx` or a Settings section): list tags with usage counts; a
  rename action (inline edit → `renameTag`); multi-select + "Merge into…" → `mergeTags`; an
  alias editor (alias → canonical); optional parent assignment. Use M13 primitives (`TagGroup`,
  `Dialog`, `Button`, `Notice`). Confirmations for merge (it's bulk + irreversible without a manual
  re-edit) via `Dialog`. Pure component; App fetches/refreshes the tag list and passes data down.
- **Tests** (`*.test.tsx`): list renders counts; rename calls `renameTag`; merge calls `mergeTags`;
  alias form calls `setTagAlias`. Follow the existing `baseProps(over?)` test pattern.

**Verify:** `npx tsc --noEmit`; `npm test`.

---

## PHASE 3 — Embedded-metadata ingestion (diff-preview → apply; mirrors the Rename tool)

### Task 4 — Migration v3 + scan-time metadata read + preview/apply backend

**Migration v3** (`migration_v3_metadata_source`, wire `if current < 3`, bump LATEST to 3):
```sql
ALTER TABLE works    ADD COLUMN metadata_source TEXT NOT NULL DEFAULT 'filename';
ALTER TABLE chapters ADD COLUMN metadata_source TEXT NOT NULL DEFAULT 'filename';
```
> `ALTER TABLE ADD COLUMN` with a constant default is fully supported by SQLite and is additive
> (no rebuild). Existing rows get `'filename'`.

**Scan read (read-only on disk):** extend the existing lofty call site (`scan.rs`, near
`probe_duration_secs` ~`scan.rs:34-42` / call at `scan.rs:107`) so that when reading a file you also
capture `tagged.primary_tag()` fields you care about: `title`, `artist`/`album_artist`, `album`,
`track` (number), `genre`. Return them alongside duration (extend the per-file struct). **Do NOT
change grouping or auto-apply** — scanning still groups by filename (fixture counts stay 43/44/47).
The embedded values are used only to compute a *proposed* diff.

**Preview/apply commands** (mirror `preview_renames`/`apply_renames`/`undo_renames`):
- `preview_metadata(state, author_id: Option<i64>) -> Vec<MetadataProposal>` where
  `MetadataProposal { chapter_id, work_id, field: String /* "title"|"order"|"tag" */, current:
  String, proposed: String, source: String /* "embedded" */ }`. Re-read the files (or use cached
  scan data) via lofty, diff embedded tags vs current DB values, emit only the differences.
- `apply_metadata(state, proposals: Vec<MetadataProposalId>) -> Result<MetadataApplyReport, String>`:
  apply the accepted proposals — update `works.base_title`/`chapters.chapter_no`/tags as chosen,
  set the affected rows' `metadata_source = 'embedded'`. **Read-only on disk** (DB only). Wrap in a
  transaction. Return counts.
- (Optional) `undo_metadata` symmetric to `undo_renames` if low-cost; else note as deferred.
- **Tests**: build a temp library with a file whose embedded title differs from its filename; assert
  `preview_metadata` surfaces the diff; `apply_metadata` updates the DB + sets `metadata_source`.
  Use real small fixture files with tags if the fixture generator supports it (check
  `tools/gen-fixture`); if it can't write tags, unit-test the diff logic with a seeded DB +
  mocked/edge inputs and note the limitation.

**Verify:** cargo test green; **fixture_scan still 43/44/47** (scan unchanged); the new columns exist.

### Task 5 — Metadata diff-preview UI (frontend)

Mirror RenameView's preview/apply UX. A surface (reuse the Rename view's location/flow or a new
"Import metadata" view) that: calls `previewMetadata`, lists proposals grouped by work with
current→proposed, checkboxes to accept per-row (default the safe set), an "Apply selected" button →
`applyMetadata`, and a result `Notice`. **Diff-preview-before-apply is mandatory** (never auto-write).
- API wrappers + TS types (`MetadataProposal`, `MetadataApplyReport`) in `src/lib/api.ts`.
- Tests following the RenameView test style.

**Verify:** tsc; npm test.

---

## PHASE 4 — Series / reading-order detection

### Task 6 — Migration v4 + series backend

**Migration v4** (`migration_v4_series`, wire `if current < 4`, bump LATEST to 4):
```sql
CREATE TABLE IF NOT EXISTS series (
  id        INTEGER PRIMARY KEY,
  author_id INTEGER NOT NULL REFERENCES authors(id),
  title     TEXT NOT NULL,
  sort_key  TEXT NOT NULL,
  UNIQUE(author_id, title)
);
CREATE TABLE IF NOT EXISTS work_series_membership (
  work_id   INTEGER PRIMARY KEY REFERENCES works(id),  -- a work belongs to at most one series
  series_id INTEGER NOT NULL REFERENCES series(id),
  position  INTEGER NOT NULL
);
```
**Detection** — a command `detect_series(state, author_id) -> Vec<SeriesProposal>` that groups the
author's WORKS whose `base_title` shares a common prefix/stem (reuse `grouping::parse_stem` logic to
strip trailing numerics and compare stems), ordering members by the numeric. This is **proposal-only**
(like metadata) OR auto-built — choose proposal+apply to stay safe and reversible. Add
`apply_series(state, proposals)` to write `series` + `work_series_membership` rows. Add
`get_author_series(state, author_id) -> Vec<SeriesView>` for the FE (series + ordered members +
per-member progress).
- **Tests**: seed an author with works "Cool Story", "Cool Story 2", "Cool Story 3"; assert
  `detect_series` proposes one ordered series; `apply_series` writes membership; `get_author_series`
  returns ordered members. Migration `upgrade_from_v3` test.

> The fixture author "Jane Doe / Cool Story" (multi-chapter) is a single WORK, not multiple works. For
> a SERIES (multiple works) you may need works like "Cool Story" + "Cool Story 2" as separate works.
> Check the fixtures (`tools/gen-fixture`, `tests/fixture_scan.rs`) for an author with multiple
> numerically-related WORKS; if none exists, unit-test `detect_series` with a seeded DB rather than
> the scan fixtures (do NOT change fixture counts). Report what you used.

### Task 7 — Series view (frontend)

`AuthorDetailView` gains a series section (or a dedicated series view): show detected/auto series as
an ordered spine with per-work progress and a "continue the series" action (play the next unplayed
chapter of the next unfinished work — reuse `playNextChapterOfWork`). API wrappers + types. Tests.

**Verify:** tsc; npm test.

---

## PHASE 5 — Transcripts / search-within-audio (the one genuinely-new subsystem)

### Task 8 — Migration v5 + transcript ingestion + search backend

**Migration v5** (`migration_v5_transcripts`, wire `if current < 5`, bump LATEST to 5):
```sql
CREATE TABLE IF NOT EXISTS transcripts (
  chapter_id  INTEGER PRIMARY KEY REFERENCES chapters(id),
  source_path TEXT NOT NULL,   -- the sidecar .srt/.vtt path
  content     TEXT NOT NULL    -- plain-text concatenation for search/display
);
```
> **FTS decision:** rusqlite is `bundled` (`Cargo.toml`), which normally compiles FTS5 in. **Verify
> FTS5 is available** (try `CREATE VIRTUAL TABLE t USING fts5(x)` in a throwaway test; if it errors,
> FALL BACK to a plain `content` column + `LIKE '%term%'` search and note it). If FTS5 works, add
> `CREATE VIRTUAL TABLE transcripts_fts USING fts5(content, content='transcripts',
> content_rowid='chapter_id');` plus triggers, OR just query `transcripts` with `LIKE` for v1 (simpler
> and adequate for a local library — recommend LIKE for M16, note FTS5 as a future optimization).

**Ingestion:** at scan (in `scan_into`, after chapter insert), look for a sidecar file next to the
audio with the same stem and `.srt`/`.vtt` extension; if present, parse it to plain text and upsert
into `transcripts`. Add a small `transcript::parse_srt_vtt(text) -> String` pure function (strip
timestamps/cue numbers, join cue text). **This must NOT change author/work/chapter counts** — it only
populates `transcripts`. Confirm `tests/fixture_scan.rs` still asserts 43/44/47.
**Search command:** `search_transcripts(state, query: String) -> Vec<TranscriptHit>` where
`TranscriptHit { chapter_id, chapter_title, work_id, work_title, author_id, author_name, snippet:
String }`. Optionally fold transcript hits into the existing `search_library` (`commands.rs`) as a
new bucket — but a separate command is cleaner; pick one and report.
- **Tests**: `parse_srt_vtt` strips timestamps correctly (unit, several cue formats); a scan with a
  sidecar `.srt` populates `transcripts`; `search_transcripts` finds a term. Add a sidecar fixture
  ONLY if it doesn't change the 43/44/47 audio counts (a `.srt` is not an audio ext, so it won't —
  but confirm the scan ignores it for counting and only uses it for transcripts). Migration
  `upgrade_from_v4` test.

### Task 9 — Transcript display + search (frontend)

A search surface for transcripts (extend the Library search UI with a transcript bucket, or a
dedicated search) and a transcript panel in the player/now-playing (show the current chapter's
transcript if present). API wrappers + types. Tests.

**Verify:** tsc; npm test.

---

## PHASE 6 — No-schema intelligence (dormancy · more-like-this · calmer Discover · auto-tag)

### Task 10 — Backend: dormancy, more-like-this, calmer Discover reasons, auto-tag suggestions

All **no new schema**. Add commands + register in `lib.rs`:
- **Dormancy:** `get_dormant_works(state, now_ms: i64, days: i64) -> Vec<DormantWork>` where
  `DormantWork { work_id, base_title, author_id, author_name, last_played_at, played_fraction }`.
  SQL over `play_events` joined to chapters/works: works with ≥1 played chapter AND
  `MAX(played_at) < now_ms - days*86_400_000`, sorted by how far through (`played_fraction DESC`).
- **More like this:** `get_more_like_this(state, work_id: i64, cap: usize) -> Vec<RecommendationWork>`
  — extract the work's tags (author_tags ∪ work_tags, alias-resolved), call the existing
  `discovery_for_tags` excluding that work + author, return ranked results. Reuse the existing
  `RecommendationWork`/`DiscoveryWork` shape — pick the one already serialized and keep it consistent.
- **Calmer Discover reasons:** modify `discovery_for_tags` to ALSO return a `reason` string per item
  (reuse `recommendation_reason` at `commands.rs:654-661`); thread it into the `DiscoveryWork` struct
  (add a `reason: String` field) so Discover can show *why* a card surfaced. Update the existing
  Discovery FE consumer to display it (and its tests).
- **Auto-tag suggestions:** `suggest_tags(state, work_id: i64) -> Vec<String>` — candidate tags from
  the work's folder/filename tokens (split on separators, drop numerics/stopwords) intersected-with
  or unioned-against the user's existing tag vocabulary (`get_all_tags`), returning tags the user has
  used elsewhere that match tokens, plus novel tokens. Pure, no schema.
- **Tests** for each: seed data and assert dormancy threshold, more-like-this excludes self, the new
  `reason` field is populated, suggest_tags returns vocabulary matches.

> Changing the `DiscoveryWork` struct shape touches its existing FE consumer + tests — update them in
> this task or Task 11. Keep the new `reason` field additive; default to "" so older call sites and
> tests don't break (make the FE display conditional on a non-empty reason).

### Task 11 — Frontend: dormancy shelf, more-like-this, Discover reasons, auto-tag chips

- **Dormancy:** a Home "Forgotten" shelf (reuse the M15 `Shelf`/`.card-row`; add a `dormant` shelf
  source fed by `getDormantWorks`) OR a row on Home. Keep it calm (no nagging).
- **More like this:** on a work's context (AuthorDetail work row or Now Playing), a "More like this"
  action that lists `getMoreLikeThis` results.
- **Calmer Discover:** show the `reason` string on Discover cards (the `WorkCard` already has a
  `reason`/`reasonTone` prop — wire the new field through).
- **Auto-tag:** in the tag editor, surface `suggestTags(workId)` as one-click suggestion chips.
- API wrappers + types; tests for each (follow existing view test patterns).

**Verify:** tsc; npm test.

---

## PHASE 7 — Harness + gates + ship

### Task 12 — Harness coverage for new surfaces

Extend the `m12` walkthrough (or add focused steps) to capture the new M16 surfaces that have UI:
Manage-tags, metadata diff-preview, series view, transcript search, Home "Forgotten" shelf, Discover
reasons. Add steps with deterministic seeding (mirror how M15's `home-shelves` step seeded data).
Update `src/harness/runner.test.ts` for any new step names. Keep steps self-contained.

### Task 13 — Gates, screenshot verdict, PR, roadmap

1. Gates:
   ```
   cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml"   # all green; fixture_scan still 43/44/47
   npx tsc --noEmit
   npm test
   ```
   (If CI runs clippy/fmt — check `.github/workflows/` — run `cargo clippy`/`cargo fmt --check` too.)
2. Build + capture: `npm run build`; `powershell -ExecutionPolicy Bypass -File tools\verify.ps1
   -Walkthrough m12`.
3. **Screenshot verification in a Sonnet subagent** (no PNGs in the controller) returning a text
   verdict: the new surfaces render (Manage-tags with counts; metadata diff-preview; series spine;
   transcript search; Forgotten shelf; Discover reasons), migrations didn't break any existing
   screen, dark theme intact, `m12` matrix unregressed.
4. Fix any FAIL and re-capture.

**Verify:** all gates green.

---

## Definition of done

- Versioned migration runner in place (`PRAGMA user_version`-gated, transactional, atomic bump);
  `open_at_version` test helper; upgrade tests for each step. Existing real DBs (v1 tables,
  `user_version=0`) upgrade cleanly.
- All 8 sub-features implemented: tag taxonomy (rename/merge/alias + counts + alias-aware Discover),
  embedded-metadata ingestion (read-only diff-preview → apply, `metadata_source` tracked), series
  detection (proposal → apply → series view + continue-series), transcripts (sidecar `.srt`/`.vtt`
  ingest + search + display), dormancy "Forgotten" surfacing, more-like-this, calmer Discover with
  reasons, auto-tag suggestions.
- `cargo test` all green; **`tests/fixture_scan.rs` still asserts 43/44/47**; the prior 47 tests
  unregressed (count grew with new tests). `npx tsc --noEmit` clean; `npm test` green (≥210 + new).
- Read-only on disk preserved (metadata/series/transcripts only READ files; all writes are DB-only).
- `git status`: `Cargo.lock` may change ONLY if a dependency was genuinely added (it should NOT be —
  lofty already present); if `Cargo.lock` changed, explain why. No committed screenshots.
- Subagent before/after verdict PASS; `m12` matrix unregressed.

## PR

- Branch `m16-library-intelligence`; commit as `yovanmc <yovanmc@users.noreply.github.com>` + trailer
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` (no Codex trailer). Commit per task/phase.
- Open PR; FOREGROUND `gh pr checks <PR#> --watch` (sleep ~20s first); merge from main
  `--merge --delete-branch`; sync main.
- **Update `ROADMAP.md` via a docs PR** (AudioShelf rule): flip M16 to ✅ Merged with PR # + summary;
  decision-log entry capturing: **v5's first migration framework** (user_version-gated, additive
  migrations v2–v5, no table-rebuild needed), lofty-already-present (no new crate), tags-denormalized
  rename/merge approach, series reuses `parse_stem`, transcripts new subsystem (LIKE vs FTS5
  decision), fixture counts held at 43/44/47.

## Notes / gotchas

- **Sequence matters:** Task 1 (runner) MUST land before any migration-bearing task (2,4,6,8). The
  no-schema tasks (10/11) and tag-taxonomy can proceed once the runner exists.
- **Fixture counts 43/44/47 are sacred** — metadata ingestion is preview/apply (not auto-at-scan);
  series/transcripts add rows to NEW tables only; `.srt`/`.vtt` are not audio exts. If any scan
  change would move those counts, STOP and report — it means something auto-applied that shouldn't.
- **`metadata_source` / series / transcripts must never WRITE to disk** — read-only-on-disk is a hard
  invariant; the only disk-writer remains the opt-in Rename tool.
- **Keep new struct fields additive + new FE props optional** so existing tests/serialization don't
  break (esp. the `DiscoveryWork.reason` addition — default "").
- **Single `Mutex<Connection>`**: scan already probes every file with lofty; reading extra tags adds
  little. Don't introduce a second connection or background thread for M16 (out of scope; auto-tag is
  on-demand, not a background job).
- **If FTS5 is unavailable** in the bundled rusqlite, use `LIKE` search for transcripts and note it —
  do not add a new dependency for search.
- This is a big milestone; if any single feature proves materially harder than the digest implies
  (esp. transcripts or metadata apply), implement the rest and report the blocker rather than
  forcing it — partial-but-correct beats broken-but-complete.
