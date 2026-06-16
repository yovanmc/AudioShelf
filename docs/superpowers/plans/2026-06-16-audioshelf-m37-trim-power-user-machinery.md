# M37 — Trim Power-User Machinery (deletion milestone)

> **Written for Sonnet execution. If something doesn't match this plan — a symbol is missing, a name differs, a grep finds an unexpected caller — STOP and report rather than guess.** This is a *removal* milestone; the safety rule is: delete only what this plan names, verify the KEEP boundary before each deletion, and let `cargo test` / `tsc` / `npm test` catch every dangling reference. **One difference from M36: this milestone DOES change the schema** (drops the `works.chapter_sort` column via a v14 migration) — that is the single sanctioned schema change; everything else is removal-only.

## Context

AudioShelf v9 is a **Simplification arc** — the owner audited the full feature surface (M1–M35) and chose to cut 11 peripheral features across three stacked deletion milestones. **M36 (Trim Insights & Reflection) shipped (PR #95).** M37 is the **second** cut: the **Settings / Library-Tools power-user admin toolbox** (M16 + M19 era). M38 (player & home) follows last.

**This milestone removes exactly five features:**
1. **Curation export/import + DB snapshot/restore** (M19) — the JSON curation export/import and the `VACUUM INTO` DB snapshot + crash-safe staged restore.
2. **Embedded-metadata import** (M16, orphaned) — the "preview/apply embedded audio-tag proposals" flow and its proposal-review view. M21's manual-only metadata orphaned it; M26's `LabelEditor`/`LabelManagerView` is the kept editing surface.
3. **Auto-series detection** (M16) — `detect_series` / `apply_series` (the silent auto-detect-and-apply on first author open). ⚠ **Series _display_ stays** (see KEEP boundary).
4. **Library health check** (M19) — `library_health_scan` and its Settings results panel.
5. **Per-work chapter-sort override** (M19) — `set_work_chapter_sort`, the AuthorDetail sort `<Select>`, the reorder logic in `query_author_detail`, **and the `works.chapter_sort` column** (dropped via a v14 migration — owner decision 2026-06-16).

### 🔴 MUST KEEP — do NOT remove (verify before deleting)
- **Series _display_**: `get_author_series` (command) + `query_author_series` (query) + the `series` / `work_series_membership` tables + the `SeriesView` / `SeriesMemberView` types + the AuthorDetail series-spine UI. Only the **detection/apply** path (`detect_series` / `apply_series` / `SeriesProposal` / `SeriesMemberProposal`) goes. The owner cut "auto-series detection," NOT series display. **🔴 If grepping shows that `detect_series`/`apply_series` was the ONLY way a series ever gets created (no manual-create path remains), STOP and report** — whether to retire the now-unpopulated display is a separate owner decision, not in M37's scope.
- **`MetadataView.tsx`** verdict (verified): its **only** consumer is the embedded-import route (`App.tsx` `openMetadata()` → `previewMetadata()`). Kept per-audio / vocab editing goes through M26's `LabelEditor` / `LabelManagerView` (different components). So `MetadataView.tsx` + its test **are wholesale-deletable** — the ROADMAP's "MetadataView is SHARED" note was imprecise; the shared-editing surface is `LabelEditor`, which is untouched. **Before deleting, re-grep `MetadataView` to confirm `App.tsx` is the only importer; if any other view renders it, STOP.**
- The **scan probe's `lofty` usage** (duration probing) is unrelated to embedded-metadata import — removing `read_embedded_meta` must not touch `scan.rs`. `lofty` stays a used dependency.
- **`works.completion_rating` / `works.re_entry_note`** + `discovery_for_you` (the Discover "Reflections" reasons) — untouched (they live in the same `works` row as the dropped `chapter_sort`; the v14 migration drops ONLY `chapter_sort`).
- Core listening loop, journal/notes/bookmarks, tags + metadata vocab manager, Discover, saved-searches/smart-collections, rename tool, search, themes/keyboard a11y, design system.

### Invariants (hard gates — a violation means STOP)
- **Schema change is ALLOWED and EXPECTED — exactly one:** drop `works.chapter_sort` via a new `migration_v14_drop_chapter_sort` on the M16 `run_step` runner; `db::LATEST` **13 → 14**. No other schema change (no new table/column, no other drop). The `series` / `work_series_membership` / `metadata_terms` / journal / `works.completion_rating` / `works.re_entry_note` schema is **untouched**.
- **No new dependency.** Removal-only on deps — `git diff --stat` of `Cargo.toml`/`Cargo.lock`/`package.json`/`package-lock.json` must be **EMPTY**. (A dep that becomes unused may be left; do not touch manifests. `lofty`/`image`/`hound` stay used by scan/covers.)
- **Read-only-on-disk preserved — in fact strengthened.** Removing export/snapshot/restore deletes the app's main file-WRITE paths (export JSON, `VACUUM INTO`, staged DB swap). After M37 the app writes only its own SQLite DB. No new `fs::` write paths.
- **Default fixtures `43/44/47` unchanged** — `src-tauri/src/fixture_scan.rs` and `gen-fixture` are untouched (`chapter_sort` is not in any fixture).
- **Dark-first M12 design system** unchanged.

## Conventions (repeat of ROADMAP — follow exactly)
- **Build via the PowerShell tool**, not the Bash tool: `Set-Location "C:\Agent Projects\AudioShelf"` each call (cwd resets to `C:\Agent Zone` every call) then `& "C:\Agent Projects\AudioShelf\tools\dev-env.cmd" <cmd>`. The Bash-tool `cmd /c "tools\dev-env.cmd …"` form silently no-ops. `dev-env.cmd` prints a harmless `'vswhere.exe' is not recognized` line — MSVC linking still succeeds.
- Gates: `npx tsc --noEmit` · `npm test` · `cargo test` (all via `dev-env.cmd`) · `tools\verify.ps1 -Walkthrough <name> -SkipBuild` for screenshots.
- **Locate code by SYMBOL NAME, not the line numbers in this plan** — line numbers drift as deletions land. Use Grep for the fn/const/import/type names. After each deletion the compiler / test run is the authoritative catch for anything missed.
- **FROZEN build before `verify.ps1 -SkipBuild`** — never run `cargo test` / `tauri dev` between the frozen build and the screenshot capture (dev-mode = "localhost refused").
- Commits: repo identity (`yovanmc <yovanmc@users.noreply.github.com>`), plain `git commit`, no `-c user.email` override. Per workspace `AGENTS.md`, substantive Codex-generated commits append `Co-authored-by: Codex <noreply@openai.com>` after a blank line.
- CI: `build-and-test` on windows-latest; merge `--merge --delete-branch` from main; FOREGROUND `gh pr checks <PR#> --watch` (sleep ~20s first).

> **🔴 M36 durable lesson — `pub` orphans don't warn.** In a Rust deletion milestone a green `cargo test` does NOT prove a feature's `pub` types are gone: orphaned `pub` structs/fns emit **no `dead_code` warning**. So in the residue audit (Task 5) grep the **type/struct names**, not just the command fn names. Symbols at risk this milestone: `SeriesProposal`, `SeriesMemberProposal`, `HealthReport`, `HealthItem`, `ImportReport`, `MetadataProposal`, `MetadataApplyReport`, `DbPathState`.

---

## Task 1 — Backend removal: curation/snapshot/restore, embedded-metadata, series-detection, health

**Goal:** remove the four non-schema admin features from Rust + deregister their commands. (Chapter-sort + schema drop is isolated in Task 2.) End state after this task: `cargo test` green at a lower count, no dangling refs.

### 1a. Curation export/import + DB snapshot/restore (`src-tauri/src/backup.rs`)
- `Grep backup` and `apply_pending_restore` across `src-tauri/src/` first. **Confirm `src-tauri/src/backup.rs` contains ONLY** `build_curation_export`, `apply_curation_import`, `stage_db_restore`, `apply_pending_restore`, their helpers (e.g. `fill_if_empty`), and the 3 tests (`import_merges_additively_without_deleting`, `pending_restore_backs_up_then_swaps`, `export_captures_tags_played_and_collections`). If so, **delete the whole file** and remove `mod backup;` (or `pub mod backup;`) from `lib.rs`. **If `backup.rs` holds anything a kept feature uses, STOP and report.**
- **`src-tauri/src/db.rs` — remove the restore hook:** `Grep apply_pending_restore`. It is called at the **top of `db::open()`** (stages a `restore_pending.db` swap before opening). Remove that call (and any `use crate::backup::…`). Confirm `open()` still opens the live DB normally. This is the one non-obvious cross-file edit — do not miss it.
- **`src-tauri/src/commands.rs` — remove the command wrappers + their state:** `export_curation_json`, `import_curation_json`, `export_db_snapshot`, `stage_db_restore`, and the `DbPathState` struct (holds the resolved live-DB path for restore). `Grep DbPathState` — it is registered via `.manage(DbPathState…)` in `lib.rs` setup; remove that `.manage()` call too. Remove now-unused `use` imports the compiler flags.

### 1b. Embedded-metadata import (`src-tauri/src/commands.rs`)
- Remove: `preview_metadata` + `apply_metadata` (commands), `build_metadata_proposals` + `apply_metadata_proposals` (logic), `read_embedded_meta` (helper), and the types `MetadataProposal` / `MetadataApplyReport`. Remove the 3 tests: `build_metadata_proposals_reads_embedded_tags_and_emits_differences`, `apply_metadata_proposals_updates_work_title_and_source`, `apply_metadata_proposals_skips_empty_proposals`.
- **🔴 Do NOT touch `scan.rs`** or `lofty` imports there — `read_embedded_meta` is import-only; scan's duration probe keeps `lofty`.

### 1c. Auto-series detection (`src-tauri/src/commands.rs`)
- Remove: `detect_series` + `apply_series` (commands), `detect_series_for_author` + `apply_series_proposals` (logic), and the types `SeriesProposal` / `SeriesMemberProposal`.
- **🔴 KEEP**: `get_author_series` (command), `query_author_series` (query), `SeriesView`, `SeriesMemberView`, and any `crate::grouping` stem-parsing used elsewhere (grep `crate::grouping` — if `parse_stem` is used only by the removed `detect_series_for_author`, it may also be removed; if `grouping` is used by the rename tool / scan grouping, KEEP it — verify, don't assume).
- **Tests — preserve kept-query coverage:** the test `apply_series_writes_membership_and_get_returns_ordered_members_with_progress` exercises BOTH the removed `apply_series` AND the kept `query_author_series`. Removing `apply_series` breaks it. **Replace it** with a slimmer test that seeds `series` + `work_series_membership` **via direct SQL INSERT** (not via `apply_series`) then asserts `query_author_series` returns ordered members with progress — so the kept query keeps coverage. Remove the detection-only tests `detect_series_proposes_group_of_three` and `detect_series_standalone_yields_no_proposal`.
- **`src-tauri/src/lib.rs` testing re-exports:** `Grep` the `testing` module / `pub use crate::commands::{…}` for `SeriesMemberProposal`, `SeriesProposal` — remove those two; **keep `SeriesView`** (and `SeriesMemberView` if re-exported).

### 1d. Library health check (`src-tauri/src/commands.rs`)
- Remove: `library_health_scan` (command), `library_health_scan_rows` (logic), the types `HealthReport` / `HealthItem`, and the test `health_scan_flags_missing_and_zero_byte`.

### 1e. Deregister commands (`src-tauri/src/lib.rs`)
- Remove from `tauri::generate_handler![ … ]`: `export_curation_json`, `export_db_snapshot`, `import_curation_json`, `stage_db_restore`, `preview_metadata`, `apply_metadata`, `detect_series`, `apply_series`, `library_health_scan`. **🔴 Keep `get_author_series`.** (`set_work_chapter_sort` is deregistered in Task 2.)

### Run (PowerShell tool)
```
Set-Location "C:\Agent Projects\AudioShelf"
& "C:\Agent Projects\AudioShelf\tools\dev-env.cmd" cargo test
```
Expect green at a lower count (≈ −3 backup −3 metadata −2 detection +1 replacement series-query −1 health ≈ net −8 lib; let `cargo test` report the real number — a drop is expected, not a regression). `fixture_scan` 43/44/47 still green. If the compiler flags a dangling reference to any removed symbol, remove that reference (it belongs to this feature) — **unless it's in a KEEP-list surface (series display, Discover, journal, Library, scan, rename), in which case STOP.**

**Commit:** `M37 Task 1: remove curation/snapshot/restore, embedded-metadata import, series-detection, health-scan (Rust)`.

---

## Task 2 — Backend schema: remove chapter-sort override + drop `works.chapter_sort` (v14)

**Goal:** remove the per-work chapter-sort override end-to-end on the Rust side and drop the now-unused column via a v14 migration. Isolated in its own task/commit because it is the only schema change — easy to review and revert.

1. **`src-tauri/src/commands.rs` — remove the command + reorder logic:**
   - Delete `set_work_chapter_sort` (the command validating against `["", "number_desc", "title_asc", "title_desc", "duration_asc", "duration_desc"]` and `UPDATE works SET chapter_sort=…`).
   - In `query_author_detail`: the SELECT building `WorkRow` names `chapter_sort` (e.g. `SELECT id, base_title, re_entry_note, completion_rating, chapter_sort FROM works …`). **Remove `chapter_sort` from that SELECT and from the row mapping**, and delete the `match work.chapter_sort.as_str() { … }` block that reorders chapters — chapters revert to their default order (the order they're already SELECTed in; confirm the chapter SELECT has a stable `ORDER BY` — typically `chapter_no` / `position`; if removing the match leaves chapters unordered, add the default `ORDER BY` the match's `""`/default arm used).
   - Remove the test `chapter_sort_override_reorders_in_detail`.

2. **`src-tauri/src/db.rs` — v14 migration (drop the column):**
   - Add, next to `migration_v13_drop_transcripts`:
     ```rust
     fn migration_v14_drop_chapter_sort(conn: &Connection) -> rusqlite::Result<()> {
         // M37: the per-work chapter-sort override feature is removed. After the
         // override command + reorder logic are gone, nothing reads this column
         // (curation export/import, its only other reader, was removed in Task 1).
         // SQLite 3.35+ supports DROP COLUMN; the bundled rusqlite SQLite is newer.
         conn.execute_batch("ALTER TABLE works DROP COLUMN chapter_sort;")?;
         Ok(())
     }
     ```
   - In `migrate()`, after the `if current < 13 { run_step(conn, 13, migration_v13_drop_transcripts)?; }` step, add:
     ```rust
     if current < 14 {
         run_step(conn, 14, migration_v14_drop_chapter_sort)?;
     }
     ```
   - Bump the constant: `pub(crate) const LATEST: i64 = 13;` → `= 14;`.

3. **Version-assert bumps (the M33 "let cargo test catch them" lesson — bump in BOTH `db.rs` AND `commands.rs`):**
   - After bumping `LATEST`, run `cargo test`. Every test that does a **full `migrate()` and asserts the resulting `user_version`/`schema_version` is `13`** must become `14` (or, preferably, assert against `LATEST`). These are the "reaches latest / after full migrate" asserts — e.g. in `db.rs`: `migrate_sets_user_version`, `migrate_is_idempotent`, `legacy_db_with_v1_tables…upgrades`, `open_in_memory_has_v2_tables_and_user_version_11`, the `open_at_version_N…reaches_latest` family, the v1/v11/v13-then-migrate tests; in `commands.rs`: the `assert_eq!(full_ver, 13)` / `assert_eq!(ver, 13)` after-migrate asserts (≈ 3 sites) and the `schema_version` settings assert (`get_setting_value(&conn, "schema_version")` — it stores `LATEST.to_string()`, so it becomes `"14"`; prefer asserting against `crate::db::LATEST.to_string()`).
   - **🔴 Do NOT blindly replace every `13`.** Leave unchanged: `open_at_version(13)` **opening anchors** (13 is still a real historical version you can open AT), and the **v13 transcript-drop asserts** (`assert_eq!(has_transcripts, 0, …)` / `assert_eq!(at13, 0, "transcripts should be dropped at v13")`). The rule: bump a `13` **only** when it means "the latest version after a full migrate." When unsure, assert against `LATEST` and let the test's intent guide you. `cargo test` failures pinpoint each site; fix them one by one.
   - Rename `open_at_version_13_reaches_latest` → `open_at_version_14_reaches_latest` (and update its body to `open_at_version(14)` + `assert_eq!(v, LATEST)`), mirroring the existing `_reaches_latest` naming.

4. **Add a v14 migration test** (mirror the v13 transcripts-dropped test pattern at the bottom of `db.rs`):
   ```rust
   #[test]
   fn migration_v14_drops_chapter_sort_column() {
       // Open at v13 (column present from v7), run full migrate to LATEST (v14),
       // and confirm works.chapter_sort is gone.
       let conn = open_at_version(13).unwrap();
       let pre = column_exists(&conn, "works", "chapter_sort"); // helper: PRAGMA table_info
       assert!(pre, "chapter_sort must exist at v13");
       crate::db::migrate(&conn).unwrap();
       let post = column_exists(&conn, "works", "chapter_sort");
       assert!(!post, "chapter_sort must be dropped by v14 migration");
       let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
       assert_eq!(v, LATEST);
   }
   ```
   If there is no existing `column_exists` helper, query `PRAGMA table_info(works)` inline and check no row has `name == "chapter_sort"` (the v13 transcript test uses a `SELECT count(*) FROM sqlite_master` pattern — mirror whichever helper already exists for table/column existence).

5. **`src-tauri/src/lib.rs`:** remove `commands::set_work_chapter_sort` from `tauri::generate_handler!`.

### Run (PowerShell tool)
```
Set-Location "C:\Agent Projects\AudioShelf"
& "C:\Agent Projects\AudioShelf\tools\dev-env.cmd" cargo test
```
Expect green. Net lib delta for this task ≈ −1 (chapter-sort override test) +1 (v14 migration test) = ~0, plus the version-assert edits. **If any `13` assert still fails after your edits, read what the test asserts** — bump it to `14`/`LATEST` only if it means "after full migrate"; otherwise it's a real signal you changed something you shouldn't have (STOP).

**Commit:** `M37 Task 2: remove chapter-sort override + drop works.chapter_sort (schema v14)`.

---

## Task 3 — Frontend removal

**Goal:** delete the embedded-metadata import view, remove all API wrappers/types/UI/wiring for the five features, and strip the series auto-detect logic from `openAuthor`. End state: `npx tsc --noEmit` clean, `npm test` green at a lower count.

### 3a. Delete files wholesale
- `src/views/MetadataView.tsx` and `src/views/MetadataView.test.tsx` (verified sole-consumer = embedded import; re-grep `MetadataView` first to confirm `App.tsx` is the only importer — if any other view renders it, STOP).

### 3b. `src/lib/api.ts` — remove wrappers + types
- **Wrappers:** `exportCurationJson`, `exportDbSnapshot`, `importCurationJson`, `stageDbRestore`, `previewMetadata`, `applyMetadata`, `detectSeries`, `applySeries`, `libraryHealthScan`, `setWorkChapterSort`. **🔴 KEEP `getAuthorSeries`.**
- **Types:** `ImportReport`, `HealthReport`, `HealthItem`, `MetadataProposal`, `MetadataApplyReport`, `SeriesProposal`, `SeriesMemberProposal`. **🔴 KEEP `SeriesView`, `SeriesMemberView`.**
- **`WorkRow`:** remove the `chapterSort: string;` field.

### 3c. `src/views/SettingsView.tsx` — remove the admin toolbox
- Remove the `className="backup-maintenance"` section (export-JSON / export-snapshot / import-JSON / restore-snapshot / health-scan buttons), the `importReport` display block, and the `healthReport` display block (the schema-drift banner + missing/zero-byte/unreadable lists).
- Remove the now-unused props from `SettingsView`'s prop type and signature: `healthReport`, `restoreStaged`, `importReport`, and the callbacks `onExportJson`, `onExportSnapshot`, `onImportJson`, `onRestoreSnapshot`, `onHealthScan`, `onOpenMetadata` (the embedded-import entry). Remove any now-dead CSS class refs if they become unused (leave CSS file rules; tsc won't flag unused CSS — optional cleanup only).

### 3d. `src/views/AuthorDetailView.tsx` — remove the chapter-sort control
- Remove the chapter-sort `<Select<string>>` in **both** the virtualized and non-virtualized render paths (the `label={\`Chapter sort for ${w.baseTitle}\`}` / `value={w.chapterSort}` / `options={CHAPTER_SORT_OPTIONS}` block, ~2 sites).
- Remove the `CHAPTER_SORT_OPTIONS` const and the `onChapterSortChange?: (workId, sort) => void` prop from the prop type. Remove any now-unused `Select` import only if `Select` is used nowhere else in the file (grep first — it likely is used elsewhere; if so keep the import).

### 3e. `src/App.tsx` — remove wiring
- Remove the import of `MetadataView` and the removed `lib/api` symbols (keep the rest of each import line, incl. `getAuthorSeries`).
- Remove state: `healthReport`, `restoreStaged`, `importReport`, `metadataProposals`, `metadataResult`.
- Remove functions/handlers: `openMetadata`, `doApplyMetadata`, `onChapterSortChange`, `onExportJson`, `onImportJson`, `onRestoreSnapshot`, `onHealthScan`, and any `onExportSnapshot` (grep all). Remove the `route.kind === "metadata"` render branch and the `{ kind: "metadata" }` route variant.
- **`openAuthor` — strip the silent auto-detect:** replace the block that does `getAuthorSeries(id)` → if empty `detectSeries(id)` → `applySeries(id, …)` → re-fetch, with just:
  ```ts
  const series = await getAuthorSeries(id);
  setAuthorSeries(series);
  ```
  (Keep the rest of `openAuthor` — `getAuthorDetail`, `setDetail`, route set — intact.)
- Remove the `onChapterSortChange={…}` and `onOpenMetadata={…}` props passed to `AuthorDetailView` / `SettingsView`, and the `healthReport`/`importReport`/`restoreStaged` props passed to `SettingsView`.

### 3f. `src/components/AppShell.tsx` (or wherever Settings nav lives)
- If there is a nav entry or Settings sub-link that opens the embedded-metadata view, remove it. (The digest found no separate nav button for it beyond the Settings `onOpenMetadata` prop — grep `onOpenMetadata` / `openMetadata` to be sure none remain.)

### Run (PowerShell tool)
```
Set-Location "C:\Agent Projects\AudioShelf"
& "C:\Agent Projects\AudioShelf\tools\dev-env.cmd" npx tsc --noEmit
& "C:\Agent Projects\AudioShelf\tools\dev-env.cmd" npm test
```
Expect: `tsc` clean (it flags any missed reference — remove it, it belongs to this feature). `npm test` green; vitest count **drops** (MetadataView.test + any others). Let the runner report the real number.

**Commit:** `M37 Task 3: remove admin-toolbox FE (MetadataView, Settings backup/health, chapter-sort control, App wiring + series auto-detect)`.

---

## Task 4 — Walkthroughs & runner tests

**Goal:** prune the harness steps that drove the removed surfaces so screenshots/tests reflect the trimmed app.

**Edit `src/harness/walkthroughs.ts` (+ the step implementations in `App.tsx` if the steps call removed APIs):**
- **`m16Steps`:** remove `showMetadataDiff` (drove the deleted MetadataView via `openMetadata()`) and `showSeriesSpine` (relied on auto-detect to populate a spine at fixture scale — with detection gone there is nothing to show). Renumber/rename remaining `m16` step output filenames to stay contiguous, following the existing pattern. **🔴 If `m16Steps` becomes empty after removing both, remove `"m16"` from the `walkthroughs` array and its registry entry** (a walkthrough with zero steps is dead) — and update `runner.test.ts` accordingly.
- **`m19Steps`:** remove `showBackupMaintenance`, `showHealthReport`, and `showChapterSort` (all three drove removed features). Renumber remaining steps; if `m19Steps` becomes empty, remove `"m19"` from the array + registry like above.
- Remove the corresponding step **implementations** in `App.tsx` (the walkthrough arms that call `openMetadata`, `setWorkChapterSort`, `libraryHealthScan`, `stageDbRestore`, etc.) — `tsc` will already have forced most of these out in Task 3; this step is the cleanup + the step-list deregistration.

**Edit `src/harness/runner.test.ts`:**
- Drop any `describe`/assertions for the removed steps, and update the global walkthrough-name list assertion (if present) to match the trimmed `walkthroughs` array.

### Run (PowerShell tool)
```
Set-Location "C:\Agent Projects\AudioShelf"
& "C:\Agent Projects\AudioShelf\tools\dev-env.cmd" npm test
```
Expect green. If a `runner.test.ts` assertion still names a removed step/walkthrough, update it to reality.

**Commit:** `M37 Task 4: prune m16/m19 walkthrough steps + runner assertions for removed admin tools`.

---

## Task 5 — Verify (controller-driven, after Tasks 1–4 are on the branch)

Controller + one screenshot subagent — **no new walkthrough authored** (M37 is a removal; verification is a regression pass proving neighbours still render and the KEEP boundary held).

1. **FROZEN build** (never `cargo test` / `tauri dev` between build and verify):
   ```
   Set-Location "C:\Agent Projects\AudioShelf"
   & "C:\Agent Projects\AudioShelf\tools\dev-env.cmd" npm run build
   & "C:\Agent Projects\AudioShelf\tools\dev-env.cmd" cargo tauri build --debug --no-bundle
   ```
2. **Regression walkthroughs** with `-SkipBuild` — capture the surfaces that neighbour the removed code: **Settings** (no backup/maintenance section, no health panel, no "Import metadata" entry — renders cleanly), **AuthorDetail** (`m24` or `browse` — no per-work chapter-sort `<Select>`; series spine still renders for any persisted series; chapters in default order), and **Discover** (`discovery`/`m12` — the "Because you rated…/You came back to…" reasons still appear, proving the `works.completion_rating`/`re_entry_note` columns survived the v14 `works` migration). Use existing walkthrough names that render those surfaces; pick a `settings` walkthrough if one exists, else the page that shows Settings.
   ```
   tools\verify.ps1 -Walkthrough settings -SkipBuild     # or the closest existing one
   tools\verify.ps1 -Walkthrough m24 -SkipBuild
   tools\verify.ps1 -Walkthrough discovery -SkipBuild
   ```
3. **Screenshot verdict via a Sonnet subagent** (never load PNGs into the controller): dispatch a subagent to Read the captured PNGs and return a **text verdict** — PASS/FAIL + observations + absolute paths. Acceptance: (a) Settings shows no export/import/snapshot/restore/health/import-metadata controls; (b) AuthorDetail shows no chapter-sort selector and chapters render in default order; (c) series spine still renders where a series exists (no crash from the removed detect path); (d) Discover still shows rating/re-entry reasons; (e) journal/notes/bookmarks unchanged; (f) no console/asset errors. `.shots` is gitignored → verify.ps1's pixel-diff flags everything "CHANGED" (stale-baseline drift) — the **visual verdict is the gate**, not the pixel diff.

## Invariant audit (controller, before PR)
Run and confirm:
- `git diff --stat -- src-tauri/Cargo.toml src-tauri/Cargo.lock package.json package-lock.json` → **EMPTY** (no new dep).
- `Grep db::LATEST` → now **14**; confirm the v14 migration + test exist and `migrate()` runs the v14 step.
- `git diff --stat -- src-tauri/src/fixture_scan.rs` → **EMPTY** (fixtures 43/44/47 untouched).
- **Residue grep (M36 lesson — grep TYPE names, not just fn names):** `Grep -ri` across `src` + `src-tauri/src` for each of: `export_curation_json|export_db_snapshot|import_curation_json|stage_db_restore|apply_pending_restore|build_curation_export|DbPathState|preview_metadata|apply_metadata|build_metadata_proposals|read_embedded_meta|MetadataProposal|MetadataApplyReport|detect_series|apply_series|SeriesProposal|SeriesMemberProposal|library_health_scan|HealthReport|HealthItem|set_work_chapter_sort|chapter_sort|chapterSort|MetadataView` → expect **zero live code paths**. KEEP-list hits that are allowed: `get_author_series`/`query_author_series`/`SeriesView`/`SeriesMemberView` (series display), `LabelEditor`/`LabelManagerView` (kept editing), and the v7 `chapter_sort` ADD-COLUMN line in `db.rs` history is GONE (dropped by v14) — but the v14 migration fn naturally still contains the string `chapter_sort`; that's the only sanctioned `chapter_sort` residue. Report any other hit.
- No new `fs::` write paths added (removal-only; export/snapshot/restore write paths are GONE).

## PR & merge
Push the branch → open a PR (title `M37 — Trim Power-User Machinery`) summarizing the five removed features, the KEEP boundary (series display, MetadataView-was-not-actually-shared, Discover reasons), the **v14 schema drop** of `works.chapter_sort`, the no-new-dep / read-only-strengthened invariants, and the test-count deltas → `gh pr checks <PR#> --watch` (FOREGROUND, sleep ~20s first) → merge `--merge --delete-branch` from main → sync main → update `ROADMAP.md` (flip M37 to ✅ Merged with PR # + a one-line summary; append a decision-log entry incl. the v14 migration, the MetadataView "not actually shared" correction, and the series-display KEEP; note **NEXT: plan M38 — Trim Player & Home**) → ping the handoff.

## Expected end state
- Five features gone: curation export/import + snapshot/restore, embedded-metadata import, auto-series detection, library health check, per-work chapter-sort override.
- Series **display** intact; Discover reasons intact; journal/Library/Home/Player intact; `LabelEditor`/vocab editing intact.
- `MetadataView.tsx` deleted; Settings admin toolbox gone; AuthorDetail sort selector gone.
- `db::LATEST` = **14**; `works.chapter_sort` dropped; all other schema unchanged.
- `cargo test` green (~8 fewer lib tests net), `tsc` clean, `npm test` green (fewer vitest), CI green.
- Dep manifests untouched; read-only-on-disk strengthened; fixtures 43/44/47 untouched.
- Screenshot subagent verdict PASS.
