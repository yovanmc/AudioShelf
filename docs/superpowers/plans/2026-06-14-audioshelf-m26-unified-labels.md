# M26 — Discovery & Curation Coherence: One Unified "Types & Labels" System

> **Written for Sonnet execution. If something in the codebase doesn't match what this plan
> describes, STOP and report rather than guessing.** Follow the repo runbook
> [`docs/superpowers/WORKFLOW-execution.md`](../WORKFLOW-execution.md). Execute tasks **in order**
> (backend first — shared `db.rs`/`model.rs`/`commands.rs` — then FE), committing after each.

## Goal (owner's words, 2026-06-14)

Collapse the app's **six overlapping organizing systems** into **one simple, user-defined
"Types & Labels" system** that drives everything. *"If I type 'talk show' on an audio (or in a
config), it becomes a filter available wherever filters are offered, and plain search surfaces that
audio among everything else that matches. Keep collections and more-like-this, but let simple
user-added metadata drive all of it. Narrator and Language are distinct types; mood is just a
simple type/label like everything else. One unified system — simple and straightforward."*

## The key insight (why this is additive, not a rebuild)

The M21 **metadata** model is *already* a general system: `metadata_terms(id, facet, value)` +
attach tables `chapter_metadata`/`author_metadata`. A **"facet" is exactly a "type"**, a
`(facet, value)` is exactly a **label**. Only three things make it special-cased today:
1. A hardcoded `FACETS = ["narrator","language","mood"]` const + `is_valid_facet()` validation.
2. No **work-level** attach table (works aggregate from chapters; tags had `work_tags`).
3. The free-form **tags** (`author_tags`/`work_tags`/`chapter_tags`) live in a parallel system.

So M26 = **generalize M21** (user-definable types via a new `label_types` table; add
`work_metadata`) + **migrate the tags into it** (copy each tag → a term under a built-in `tag`
type) + **repoint every consumer** (search, Discover, collections, more-like-this, the editor, the
manager) at the unified model. **Reuses** M21's terms table, attach/detach, DSL, and discovery.

## Architecture decisions (locked — do not re-litigate)

1. **Substrate = the M21 metadata tables, generalized.** New `label_types` table holds the
   user-definable types. `metadata_terms.facet` is the type name. Built-in types seeded:
   `narrator` (Narrator), `language` (Language), `tag` (Tag — the default/"typeless" bucket that
   migrated free-form tags land in). `mood` is seeded as a **regular, deletable** type (not
   built-in) so existing mood data keeps working but it's "just a label like everything else".
2. **Additive, crash-safe migration v10** on the M16 `run_step`/`user_version` runner
   (`LATEST` 9→10). It (a) creates `label_types` + seeds built-ins, (b) creates `work_metadata`,
   (c) **copies** `author_tags`/`work_tags`/`chapter_tags` rows into `metadata_terms(facet='tag')`
   + the matching attach tables via `INSERT OR IGNORE`. `SCHEMA_V1` untouched; no FK-off rebuild;
   **the legacy tag tables are NOT dropped** — they stay dormant and unread so the migration is
   fully recoverable (honors the project's destructive-op discipline; a later milestone may drop
   them once proven). Idempotent (re-running the copy is a no-op).
3. **Model exposes a new `labels: Vec<MetaTag>` field** (every attached term, **all** facets incl.
   `tag`) on `ChapterRow`/`WorkRow`/`AuthorDetail`. `tags` and `metadata` are **kept and derived**
   for back-compat (`tags` = `labels` where `facet=="tag"` mapped to value strings; `metadata` =
   `labels` where `facet!="tag"`). One system underneath; convenience views on top. This keeps
   existing components/tests alive while the FE migrates to `labels`.
4. **Work-level labels are direct** (`work_metadata`), matching how `work_tags` worked. (Intentional
   simplification: a label lives where you put it. Discovery still considers chapter+work+author
   attachments so narrator-on-work recs don't regress.)
5. **Plain search matches label values.** `search_library` (bare term) gains label-value matching;
   `parse_query` gains a generic `type:value` token and keeps `tag:`/`narrator:`/`language:`/
   `mood:` working; `run_scoped_query`'s tag-EXISTS clauses repoint at the unified attach tables.
   Collections store DSL strings → they keep resolving unchanged because the DSL is repointed.
6. **One editor** (`LabelEditor`) replaces `TagEditor` + `MetadataEditor`. **One manager**
   (`LabelManagerView`, "Types & Labels") replaces `TagManagerView` + `MetadataManagerView`.
   **One Discover picker** over all types replaces the tag-picker + facet-picker split.

## Hard invariants (gate at verify)
- **Additive migration only:** v10 = `CREATE TABLE`s + `INSERT`s, `SCHEMA_V1` untouched, no
  `DROP`, no FK-off rebuild. Legacy tag tables remain.
- **No new dependency:** `git diff --stat main` of `Cargo.toml`/`Cargo.lock`/`package.json`/
  `package-lock.json` must be **empty**.
- **Read-only-on-disk:** every write hits SQLite (terms/types/attach/settings). Rename stays the
  sole audio-file mutation. No new export path.
- **Fixtures 43/44/47** (`src-tauri/src/fixture_scan.rs` untouched; all M26 state seeded at
  runtime in the new walkthrough).
- **Dark-first M12 system**, light + high-contrast themes preserved.

## Gotchas baked in for the executor
- **Bash tool mangles `cmd /c`** → use **`cmd //c`** (MSYS rewrites `/c` to `C:/`). Cargo runs as
  `cmd //c "tools\dev-env.cmd cargo <args> --manifest-path src-tauri\Cargo.toml"` in the FOREGROUND.
  PowerShell tool is an alternative.
- **Do NOT run `cargo test` or `tauri dev` between the frozen `cargo tauri build --debug` and
  `verify.ps1 -SkipBuild`** — that re-creates a dev-mode exe that loads `devUrl` → "localhost
  refused to connect". Simplest: run the first walkthrough WITHOUT `-SkipBuild` (it does its own
  frozen build), then `-SkipBuild` for the rest with no cargo/dev in between.
- **Version asserts:** after bumping `LATEST` to 10, `grep` for hardcoded `== 9`, `_9_`, and
  `open_at_version(9)` assertions in `src-tauri/src/db.rs` **and** `src-tauri/src/commands.rs` and
  bump each to 10 (M24 had ~13 such asserts across the two files). Add the two new v10 tests below.
  The table-count assert increases by **2** (label_types + work_metadata).
- **`metadata_terms` has `UNIQUE(facet,value)`** — the tag-copy can't create duplicate `(tag, X)`
  terms; rely on `INSERT OR IGNORE`. A tag value equal to a narrator value won't collide (different
  facet).
- **Discovery is unplayed-only** (`discovery_for_metadata`/`discovery_for_tags` return works with
  ≥1 unplayed chapter). The `m26` walkthrough must seed labels onto a work with an **unplayed**
  chapter or the Discover shots come back empty (M21's exact trap).
- **`MetaTag` shape** stays `{ termId, facet, value }` and is reused verbatim for labels.

---

## Tasks

### T1 — Migration v10: `label_types` + `work_metadata` + tag→label data copy (additive)
**File:** `src-tauri/src/db.rs`.
1. Bump `LATEST` (db.rs:62) `9` → `10`.
2. Add a `migration_v10(tx)` step wired into `migrate()` exactly like prior steps
   (`if current < 10 { run_step(conn, 10, migration_v10)?; }`). The step body (single
   `execute_batch`, then the copy `execute`s — all inside the txn `run_step` provides):
   ```sql
   -- (a) user-definable types
   CREATE TABLE IF NOT EXISTS label_types (
     name    TEXT PRIMARY KEY,
     display TEXT NOT NULL,
     builtin INTEGER NOT NULL DEFAULT 0,
     sort    INTEGER NOT NULL DEFAULT 0
   );
   INSERT OR IGNORE INTO label_types(name, display, builtin, sort) VALUES
     ('narrator','Narrator',1,0),
     ('language','Language',1,1),
     ('tag','Tag',1,2),
     ('mood','Mood',0,3);
   -- (b) work-level attach (parity with the old work_tags)
   CREATE TABLE IF NOT EXISTS work_metadata (
     work_id INTEGER NOT NULL REFERENCES works(id),
     term_id INTEGER NOT NULL REFERENCES metadata_terms(id),
     PRIMARY KEY (work_id, term_id)
   );
   CREATE INDEX IF NOT EXISTS idx_work_metadata_term ON work_metadata(term_id);
   ```
   Then the **data copy** (each as an `execute`, idempotent):
   ```sql
   -- materialize a 'tag'-facet term for every distinct existing tag value
   INSERT OR IGNORE INTO metadata_terms(facet, value)
     SELECT 'tag', tag FROM author_tags
     UNION SELECT 'tag', tag FROM work_tags
     UNION SELECT 'tag', tag FROM chapter_tags;
   -- attach them at each level
   INSERT OR IGNORE INTO author_metadata(author_id, term_id)
     SELECT at.author_id, mt.id FROM author_tags at
     JOIN metadata_terms mt ON mt.facet='tag' AND mt.value=at.tag;
   INSERT OR IGNORE INTO work_metadata(work_id, term_id)
     SELECT wt.work_id, mt.id FROM work_tags wt
     JOIN metadata_terms mt ON mt.facet='tag' AND mt.value=wt.tag;
   INSERT OR IGNORE INTO chapter_metadata(chapter_id, term_id)
     SELECT ct.chapter_id, mt.id FROM chapter_tags ct
     JOIN metadata_terms mt ON mt.facet='tag' AND mt.value=ct.tag;
   ```
   **Do NOT drop `author_tags`/`work_tags`/`chapter_tags`.**
3. Extend `open_at_version` (db.rs:279–311) with an `if version >= 10 { migration_v10(...) }` arm
   mirroring the existing arms.
4. Tests (db.rs `#[cfg(test)]`): add
   - `migration_v10_is_additive_and_migrates_tags`: open at v9, seed a couple of `*_tags`, run
     migrate, assert `user_version==10`, assert `label_types` has the 4 seeds, assert the seeded
     tags now appear as `metadata_terms(facet='tag')` with matching attach rows, **and the legacy
     `*_tags` rows still exist** (recoverable).
   - `open_at_version_10_reaches_latest`.
   - Bump the table-count assertion by 2.
5. **Grep & bump** every hardcoded `== 9` / `_9_` / `open_at_version(9)` assert in db.rs to 10
   (rename `open_at_version_9_reaches_latest` → `_10_` if present, keep a v9 intermediate test).

**Gate:** `cmd //c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml"` green.

### T2 — Generalize facet validation + type CRUD + `scope_table` work-level
**File:** `src-tauri/src/metadata.rs` (+ `commands.rs`).
1. Replace the `FACETS` const + `is_valid_facet()` (metadata.rs:7) with a DB-backed check:
   `fn is_valid_facet(conn, facet) -> bool` = `EXISTS(SELECT 1 FROM label_types WHERE name=?)`.
   (Keep a `pub const BUILTIN_FACETS: [&str;3] = ["narrator","language","tag"]` for guards.)
2. Extend `scope_table()` (metadata.rs:17–23) with `"work" => Some(("work_metadata","work_id"))`.
3. New commands in `commands.rs` (mirror the existing term CRUD style, @-param safe):
   - `list_label_types() -> Vec<LabelType>` (`SELECT name, display, builtin, sort FROM label_types
     ORDER BY sort, name`); `LabelType { name, display, builtin, sort }` (new struct in model.rs).
   - `create_label_type(name, display)` — slug the `name` (lowercase, trim), `INSERT OR IGNORE`
     `(name, display, builtin=0, sort = max(sort)+1)`.
   - `rename_label_type(name, display)` — `UPDATE label_types SET display=? WHERE name=?`
     (display only; `name` is the stable key).
   - `delete_label_type(name)` — **block if `builtin=1`** (return an error); else txn-delete its
     `metadata_terms` (and their attach rows in all three attach tables) then the type row.
   - `reorder_label_types(names: Vec<String>)` — set `sort` by index.
4. Register all new commands in the `invoke_handler!`/`generate_handler!` list (`lib.rs`).

**Gate:** cargo test green.

### T3 — Model: unified `labels` field + work-level read
**Files:** `src-tauri/src/model.rs`, `commands.rs`.
1. Add `pub labels: Vec<MetaTag>` to `ChapterRow` (model.rs:27–41), `WorkRow` (45–54),
   `AuthorDetail` (93–99). (`AuthorRow` keeps `tags` only — list view; optional `labels` not needed.)
2. In `query_author_detail` (commands.rs ~304–403):
   - Chapter: after building `metadata` via `chapter_metadata()` (commands.rs:382), build
     `labels` = the full term list for that chapter (same JOIN but **without** excluding `tag`).
     Set `tags` = `labels.iter().filter(facet=="tag").map(value)`, `metadata` =
     `labels.iter().filter(facet!="tag")`. (Replace the old separate `chapter_tags` SELECT.)
   - Work: add a `work_metadata()` reader (mirror `chapter_metadata()` but table `work_metadata`,
     key `work_id`); `labels` = work-level terms; derive `tags`/`metadata` as above. (Replaces the
     old `work_tags` SELECT at 371–374 and the chapter-union metadata at 385–394 — work labels are
     now direct.)
   - Author: `labels` = `author_metadata()` full list; derive `tags`/`metadata`.
3. `query_authors` (commands.rs:242–301): keep `AuthorRow.tags` but source it from the unified
   attach — `tags` = author_metadata ∪ work_metadata values where `facet='tag'` (so the Library
   list's tag filter keeps working post-migration). Grep-verify no other `*_tags` reads feed the
   list.

**Gate:** cargo test green (update any Rust test asserting old tag/metadata separation).

### T4 — Search: plain-term label match + generic `type:value` DSL + repointed scoped EXISTS
**Files:** `src-tauri/src/query.rs`, `scoped.rs`, `commands.rs`.
1. `parse_query` (query.rs:31–62): add a generic `type:value` token (any `label_types.name` other
   than the reserved `duration`/`status`) → push a `MetaFilter{facet,value}`. **Keep** `tag:`,
   `narrator:`, `language:`, `mood:` working (they're just specific facets now — `tag:` →
   `MetaFilter{facet:"tag",value}`). Net effect: drop the special `tags: Vec<String>` path in favor
   of `meta` carrying `facet="tag"` (or keep `tags` and treat it as `facet='tag'` in scoped — pick
   the smaller diff; **document which** in the commit).
2. `run_scoped_query` (scoped.rs:8–110): the per-tag EXISTS clauses must now hit the **unified**
   attach. A `facet='tag'` (or any facet) filter →
   ```sql
   EXISTS (SELECT 1 FROM metadata_terms mt
           WHERE mt.facet=? AND mt.value=? AND (
             EXISTS (SELECT 1 FROM work_metadata wm WHERE wm.work_id=w.id AND wm.term_id=mt.id)
             OR EXISTS (SELECT 1 FROM chapter_metadata cm JOIN chapters mc ON cm.chapter_id=mc.id
                        WHERE mc.work_id=w.id AND cm.term_id=mt.id)
             OR EXISTS (SELECT 1 FROM author_metadata am WHERE am.author_id=a.id AND am.term_id=mt.id)))
   ```
   (This generalizes the old separate tag-EXISTS and metadata-EXISTS into one shape covering
   work+chapter+author.)
3. `search_library` (commands.rs:487–491): for the works & chapters buckets, the bare term must
   also match label **values** — add an EXISTS on `metadata_terms.value LIKE ?` via the attach
   tables (so typing "talk show" surfaces works/chapters carrying that label, per the owner's
   requirement). Keep the 50/bucket cap.
4. Tests: extend `query.rs`/`scoped.rs` unit tests for `type:value`, and a `search_library` test
   proving a label value matches a bare term.

**Gate:** cargo test green.

### T5 — Discovery + more-like-this over the unified model
**File:** `src-tauri/src/commands.rs`.
1. Generalize `discovery_for_metadata` (619–732) to read the unified attach incl. `work_metadata`
   (chapter OR work OR author carries the term; unplayed-only rule preserved). Keep the
   `get_discovery_by_metadata(facet,value)` command entry point.
2. `discovery_for_tags`/`get_discovery_by_tags` (619–688): repoint to the unified attach with
   `facet='tag'` (so existing "pick a tag" Discover keeps working over migrated tags). It may
   simply delegate to the generalized function with `facet='tag'`.
3. `more_like_this` (2114–2144): collect the source work's shared labels from the unified attach
   (work ∪ author, all facets) and rank candidates by shared-label count, excluding the source
   author — same algorithm, unified source. Keep `get_more_like_this`.

**Gate:** cargo test green.

### T6 — API layer: label-type + unified label wrappers (+ keep old aliases)
**File:** `src/lib/api.ts` (the digest's wrapper module).
1. New TS types: `LabelType { name: string; display: string; builtin: boolean; sort: number }`;
   reuse `MetaTag { termId; facet; value }` as the `Label` shape; add `labels: MetaTag[]` to the
   `ChapterRow`/`WorkRow`/`AuthorDetail` interfaces.
2. New wrappers: `listLabelTypes()`, `createLabelType(name, display)`, `renameLabelType(name,
   display)`, `deleteLabelType(name)`, `reorderLabelTypes(names)`. Add `"work"` to the scope union
   of `addMetadataValue`/`removeMetadataValue` and add convenience `addLabel(scope, id, type,
   value)` / `removeLabel(scope, id, termId)` aliases.
3. **Keep** `setAuthorTags`/`setWorkTags`/`setChapterTags`/`getAllTags`/`listMetadataTerms`/etc. as
   thin existing wrappers so nothing breaks mid-refactor; the new editor uses the label wrappers.

### T7 — `LabelEditor` (merge `TagEditor` + `MetadataEditor`)
**New file:** `src/components/LabelEditor.tsx`. **Read** `src/views/TagEditor.tsx` and
`src/components/MetadataEditor.tsx` first, then build one editor:
- Props: `{ applied: MetaTag[]; labelTypes: LabelType[]; suggestions: string[];
  onAdd: (type: string, value: string) => void; onRemove: (termId: number) => void }`.
- Render **one row per type** (from `labelTypes`, in `sort` order) showing that type's applied
  chips (filtered by `facet===type.name`) + an inline add input with a datalist of `suggestions`
  for that type. The built-in `tag` type renders first-class (it's the "just type a word" bucket).
  An "Add type…" affordance is **not** here — type creation lives in the manager (T8); the editor
  only attaches values to existing types, but a value typed under `tag` needs no setup.
- Replace usages of `TagEditor`/`MetadataEditor` in `AuthorDetailView.tsx` (the author-header
  editor, the per-chapter "Edit tags & metadata" dialog, and add a per-work editor) with
  `LabelEditor`. Keep the M23 point-of-use `.field-hint` microcopy, simplified to describe the one
  system. Update `MetadataEditor.test.tsx` → `LabelEditor.test.tsx` (port the add/remove assertions).

### T8 — `LabelManagerView` (merge `TagManagerView` + `MetadataManagerView`)
**New file:** `src/views/LabelManagerView.tsx`. **Read** both existing managers first. One
"Types & Labels" screen:
- **Types section:** list `labelTypes`; add a type (name+display), rename display, delete
  (disabled for `builtin`), reorder. Wire to T2 commands.
- **Labels section:** the existing term table (Value · Files · Creators · Actions) grouped by type,
  with rename / merge / delete reusing the existing term commands (`renameMetadataTerm`,
  `mergeMetadataTerms`, `deleteMetadataTerm`). Carry over the tag manager's multi-select-merge UX.
- Mount as **one** Settings route ("Narrator, Language & Mood" + "Tags" cards collapse into a
  single **"Types & Labels"** card per the M23 de-jargon direction). Remove the separate
  `TagManagerView`/`MetadataManagerView` routes (delete the files + tests once ported).

### T9 — Discover: one picker over all types
**File:** `src/views/DiscoveryView.tsx` (+ App wiring in T11).
- Replace the fixed `narratorTerms`/`languageTerms`/`moodTerms` props and the separate "pick a tag"
  + facet rows with **one labelled picker driven by `labelTypes` + `termsByType`**: a row per type
  (Tag, Narrator, Language, Mood, + any user types), each showing its values as toggle chips with
  `· count` labels. Picking a value drives the unified discovery result (`getDiscoveryByMetadata`).
  Keep "For You". This is the M22 facet-picker pattern generalized to all types.

### T10 — Library filter by type/value
**File:** `src/views/SortFilterBar.tsx`, `LibraryView.tsx`.
- Generalize the single "Filter by tag" Select into **type → value** filtering driven by
  `labelTypes` + their values (a type Select + a value Select, or a flat "Filter by label" list
  spanning all types). Plain-search label matching is already wired (T3/T4) — confirm the
  Library search box surfaces label-matched works. Keep the saved-search strip + scoped chips
  (they keep working via the repointed DSL). **Trimmable if scope balloons:** the saved-search
  management view (IA7-8) and the "save search as collection" CTA (CUR-4) — note any cut in the
  commit + ROADMAP.

### T11 — App.tsx wiring
**File:** `src/App.tsx` (use the digest's anchors; do NOT read the whole file).
- Add `labelTypes` state + `loadLabelTypes()` (call alongside `loadMetaTerms`). Replace the
  `narratorTerms`/`languageTerms`/`moodTerms` memos (App.tsx ~391–428) with a generic
  `termsByType = useMemo(() => groupBy(metaTerms, t => t.facet), [metaTerms])`.
- Repoint editor handlers (App.tsx ~430–449) to the unified `addLabel`/`removeLabel` (scope
  author/work/chapter); keep refreshing `detail` after writes.
- Update routes: the metadata-manager + tag-manager routes → one `labels` manager route; Discover
  route passes `labelTypes`/`termsByType` (T9); Settings passes the type-CRUD callbacks.
- **Grep `chapterNo:` / `tags:` across `src/**/*.test.tsx` and the harness** and add `labels: []`
  to every `ChapterRow`/`WorkRow`/`AuthorDetail` literal (same mechanical pattern M24 used for
  `playbackPositionSecs: 0`).

### T12 — Walkthrough `m26` + repoint `m21`
**File:** the harness (`src/harness/walkthroughs.ts`, digest anchors ~302–316).
- New `m26` steps capturing: (1) the **Types & Labels manager** (a user type "Show format" created
  + a "Talk show" value), (2) the **LabelEditor** on a chapter showing Tag + Narrator + the new
  type together, (3) **plain search** "talk show" surfacing the labelled work among results,
  (4) **Discover** picking the "Talk show" value, (5) **Library filter** by a type/value. Seed
  labels onto a work with an **unplayed** chapter (Discover is unplayed-only).
- Repoint the `m21` steps whose targets moved (`showMetadataManager` →
  the unified manager; `showChapterMetadataEditor` → `LabelEditor`). **Keep each step's exported
  name** so `runner.test.ts` stays green (M22's lesson).

### T13 — Verify
1. `npx tsc --noEmit` clean; `npm test` green (update ported tests).
2. `cmd //c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml"` green — including
   the new v10 additive-migration + `open_at_version_10` tests.
3. **Dependency gate:** `git diff --stat main` of `Cargo.toml`/`Cargo.lock`/`package.json`/
   `package-lock.json` is **empty**. Confirm `fixture_scan.rs` untouched (fixtures 43/44/47).
4. Frozen build: `cargo tauri build --debug` (via `dev-env.cmd`), then run walkthroughs **without
   `-SkipBuild` first** (it rebuilds), then `-SkipBuild` for the rest with no `cargo test`/`tauri
   dev` in between: `m26`, `m12` (15-shot regression matrix), `m21`, `m24`, `m25`.
5. **Dispatch a Sonnet subagent to view the PNGs and return a TEXT verdict** (PASS/FAIL + paths) —
   never load screenshots into the controller. Acceptance: one editor/one manager/one Discover
   picker visible; a user-created type + value works end-to-end; plain search "talk show" matches a
   labelled item; the migrated tags still appear (as `tag`-type labels); no `m12`/`m21`/`m24`/`m25`
   regression beyond the new "Types & Labels" nav/label-chip changes.
6. Confirm read-only-on-disk by diff-auditing every new `std::fs`/SQLite write (all SQLite).

## Done = PR + CI
Push branch → open PR → `sleep 20` → FOREGROUND `gh pr checks <PR#> --watch` → merge from main
`--merge --delete-branch` → sync main → flip the ROADMAP M26 row to ✅ Merged with the PR # and a
one-line summary + a decision-log entry (note the dormant legacy tag tables and the v10 schema).
