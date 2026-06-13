# M21 — Metadata & Discovery (narrator + per-audio) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Written for Sonnet execution. If something in the codebase does NOT match what this plan describes (a signature changed, a struct gained a field, a file moved), STOP and report rather than guessing.** The plan was authored against the post-M20 tree (schema v7, `LATEST = 7`).

**Goal:** Add a faceted, user-defined metadata system — **narrator / language / mood** — applied manually to files (chapters) and creators (authors), aggregated to works, and surfaced across **browse + search + Discover**.

**Architecture:** A new vocabulary table `metadata_terms(facet, value)` (user creates values; the 3 facets are fixed) plus two attach tables `chapter_metadata` and `author_metadata` (additive **migration v8** on the existing `run_step`/`user_version` runner). Works aggregate their chapters' terms at query time. The M19 search DSL (`parse_query`/`run_scoped_query`) gains `narrator:`/`language:`/`mood:` filters; a new `discovery_for_metadata` powers "more by this narrator". Frontend adds a vocabulary manager (in Settings), a per-entity metadata editor (Author Detail), a first-class **Narrators** browse route, a Discover facet picker, and metadata chips.

**Tech Stack:** Rust (rusqlite, Tauri 2 commands), React 18 + TypeScript, existing CSS design system. **No new crate or npm dependency.** **No embedded-tag ingestion** — values are entered manually (the only file-derived facts remain duration; `lofty` is untouched).

## Hard invariants (the "done" gate — verify every one before claiming complete)

1. **Schema = additive migration v8 only.** `metadata_terms` + `chapter_metadata` + `author_metadata` added via a new `migration_v8_metadata` step on the existing runner; `LATEST` 7→8; `open_at_version` extended. **No existing table altered, no FK-off table-rebuild, `SCHEMA_V1` untouched.** Legacy DBs upgrade cleanly.
2. **No new dependency.** `git diff --stat main -- src-tauri/Cargo.toml src-tauri/Cargo.lock package.json package-lock.json` must be **empty**.
3. **Read-only-on-disk.** Every new write targets SQLite. **No new filesystem write of any kind** (no file export in this milestone). The Rename tool stays the sole audio-file mutator. No embedded-tag reading added.
4. **Fixtures stay 43 / 44 / 47** (authors/works/chapters). `src-tauri/tests/fixture_scan.rs` is **untouched**; all M21 metadata is seeded at runtime in the new `m21` walkthrough.
5. **Both pillars, broad:** narrator browse + search + Discover, AND language/mood as configurable facets surfaced in search + Discover + chips.

## Out of scope (do NOT build — flagged so the executor doesn't expand scope)

- **No embedded-tag ingestion** of narrator/language/mood (owner: "ignore any tags on the actual files; only care about our tags"). Do not touch `read_embedded_meta`/`preview_metadata`/`apply_metadata` (the M16 "Import tags" view stays exactly as-is).
- **No file-size capture/column.** The owner mentioned "duration and size" only to contrast against metadata ingestion; size is not a facet and is deferred. Do not add a `size` column or scan change.
- **No quoted/multi-word values in the search DSL.** Like the existing `tag:`, the `narrator:`/`language:`/`mood:` filters match a **single whitespace-delimited token** (multi-word narrators are reached precisely via the Narrators browse page and the Discover facet picker, which pass exact values). Note this limitation in code comments; do not build a quote tokenizer.

## File structure

**Rust (`src-tauri/src/`)** — all backend tasks edit these shared files, so backend tasks are **serial**:
- `metadata.rs` — **NEW** module: fixed facet list + scope→table mapping + pure helpers (unit-tested).
- `db.rs` — add `migration_v8_metadata`, bump `LATEST`, extend `migrate`/`open_at_version`.
- `model.rs` — add `MetaTag`/`MetaTerm` structs; add `metadata: Vec<MetaTag>` to `ChapterRow`, `WorkRow`, `AuthorDetail`.
- `commands.rs` — vocabulary CRUD, attach/detach, read helpers, `discovery_for_metadata`; wire reads into `query_author_detail`; fix `load_chapter_row` fan-out.
- `query.rs` — `MetaFilter` struct + `meta` field on `ParsedQuery` + parse arms.
- `scoped.rs` — metadata EXISTS clauses in `run_scoped_query`.
- `lib.rs` — register new commands.

**Frontend (`src/`)**:
- `lib/api.ts` — interfaces + wrappers; add `metadata` to row interfaces.
- `components/Icon.tsx` — add a `voice` glyph.
- `components/AppShell.tsx` — add `narrators` route + nav item.
- `components/MetadataEditor.tsx` — **NEW** reusable per-entity facet editor (chapter + author scope).
- `views/MetadataManagerView.tsx` — **NEW** vocabulary manager (mirrors `TagManagerView`); shown in Settings.
- `views/NarratorsView.tsx` — **NEW** first-class narrator browse.
- `views/DiscoveryView.tsx` — add a facet picker section.
- `components/WorkCard.tsx` — show metadata chips (optional prop).
- `views/SettingsView.tsx`, `views/AuthorDetailView.tsx`, `App.tsx` — wire the new components + handlers.
- `harness/walkthroughs.ts`, `harness/runner.test.ts`, `App.tsx` harness hooks — the `m21` walkthrough.

---

## Task 1: Migration v8 + facet/scope helper module

**Files:**
- Create: `src-tauri/src/metadata.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod metadata;`)
- Modify: `src-tauri/src/db.rs` (LATEST, migrate, open_at_version, new migration fn)
- Test: inline `#[cfg(test)]` in `metadata.rs`; upgrade test in `db.rs`'s existing test module

- [ ] **Step 1: Create the `metadata` helper module with failing tests**

Create `src-tauri/src/metadata.rs`:

```rust
//! Faceted, user-defined metadata (narrator / language / mood) applied to chapters
//! (files) and authors (creators). Works aggregate their chapters' terms at query
//! time. The set of *facets* is fixed; the *values* within each facet are created by
//! the user. No embedded-tag ingestion — values are entered manually.

/// The three supported metadata facets. Fixed; user-created values live in `metadata_terms`.
pub const FACETS: [&str; 3] = ["narrator", "language", "mood"];

/// True iff `facet` is one of the supported facets.
pub fn is_valid_facet(facet: &str) -> bool {
    FACETS.contains(&facet)
}

/// Map an entity scope keyword to its `(attach_table, key_column)`. Returns `None`
/// for unknown scopes so callers reject untrusted input. The table/column are only
/// ever taken from this fixed mapping — never interpolated from raw user strings.
pub fn scope_table(scope: &str) -> Option<(&'static str, &'static str)> {
    match scope {
        "chapter" => Some(("chapter_metadata", "chapter_id")),
        "author" => Some(("author_metadata", "author_id")),
        _ => None,
    }
}

/// Human label for a facet (used in Discover reason text).
pub fn facet_label(facet: &str) -> &'static str {
    match facet {
        "narrator" => "Narrator",
        "language" => "Language",
        "mood" => "Mood",
        _ => "Metadata",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_facets_recognized_unknown_rejected() {
        assert!(is_valid_facet("narrator"));
        assert!(is_valid_facet("language"));
        assert!(is_valid_facet("mood"));
        assert!(!is_valid_facet("genre"));
        assert!(!is_valid_facet(""));
    }

    #[test]
    fn scope_table_maps_known_scopes_only() {
        assert_eq!(scope_table("chapter"), Some(("chapter_metadata", "chapter_id")));
        assert_eq!(scope_table("author"), Some(("author_metadata", "author_id")));
        assert_eq!(scope_table("work"), None);
        assert_eq!(scope_table("'; DROP TABLE works;--"), None);
    }
}
```

- [ ] **Step 2: Register the module**

In `src-tauri/src/lib.rs`, add `mod metadata;` next to the other `mod` declarations (e.g. beside `mod query;` / `mod scoped;`). Run: `cmd /c "tools\dev-env.cmd cargo test -p audioshelf metadata:: --lib"` from the repo root (FOREGROUND). Expected: the two new tests FAIL to compile only if `mod metadata;` is missing; once added they PASS.

- [ ] **Step 3: Add the v8 migration function in `db.rs`**

Immediately after `migration_v7_power_scale` (around db.rs:151), add:

```rust
/// Add the metadata_terms vocabulary + chapter_metadata / author_metadata attach
/// tables (migration v8). Faceted user-defined metadata (narrator / language / mood)
/// applied to files and creators. Additive only — no existing table touched.
fn migration_v8_metadata(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS metadata_terms (
           id    INTEGER PRIMARY KEY,
           facet TEXT NOT NULL,
           value TEXT NOT NULL,
           UNIQUE(facet, value)
         );
         CREATE TABLE IF NOT EXISTS chapter_metadata (
           chapter_id INTEGER NOT NULL REFERENCES chapters(id),
           term_id    INTEGER NOT NULL REFERENCES metadata_terms(id),
           PRIMARY KEY (chapter_id, term_id)
         );
         CREATE TABLE IF NOT EXISTS author_metadata (
           author_id INTEGER NOT NULL REFERENCES authors(id),
           term_id   INTEGER NOT NULL REFERENCES metadata_terms(id),
           PRIMARY KEY (author_id, term_id)
         );
         CREATE INDEX IF NOT EXISTS idx_chapter_metadata_term ON chapter_metadata(term_id);
         CREATE INDEX IF NOT EXISTS idx_author_metadata_term  ON author_metadata(term_id);",
    )
}
```

- [ ] **Step 4: Bump `LATEST` and wire the step into both runners**

In `db.rs`: change the constant (db.rs:62) from `pub(crate) const LATEST: i64 = 7;` to `pub(crate) const LATEST: i64 = 8;`.

In `migrate(conn)` (after the `if current < 7 { ... }` block, before the `INSERT OR REPLACE INTO settings(...schema_version...)` line) add:

```rust
    if current < 8 {
        run_step(conn, 8, migration_v8_metadata)?;
    }
```

In `open_at_version(version)` (after the `if version >= 7 { ... }` block, before `Ok(conn)`) add:

```rust
    if version >= 8 {
        run_step(&conn, 8, migration_v8_metadata)?;
    }
```

- [ ] **Step 5: Add an upgrade test in `db.rs`'s test module**

Find the existing `#[cfg(test)] mod tests` in `db.rs` (it already has migration/upgrade tests — mirror their style). Add:

```rust
    #[test]
    fn migration_v8_adds_metadata_tables_and_is_additive() {
        // A DB migrated to v7 has no metadata tables; upgrading to v8 adds them and
        // bumps user_version, leaving all earlier tables intact.
        let conn = open_at_version(7).unwrap();
        let v7: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v7, 7);
        run_step(&conn, 8, migration_v8_metadata).unwrap();
        let v8: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v8, 8);
        // The three new tables exist and are empty.
        for t in ["metadata_terms", "chapter_metadata", "author_metadata"] {
            let n: i64 = conn
                .query_row(&format!("SELECT count(*) FROM {t}"), [], |r| r.get(0))
                .unwrap();
            assert_eq!(n, 0, "{t} should exist and be empty");
        }
        // Earlier tables still present (additive).
        let _: i64 = conn.query_row("SELECT count(*) FROM works", [], |r| r.get(0)).unwrap();
        let _: i64 = conn.query_row("SELECT count(*) FROM saved_searches", [], |r| r.get(0)).unwrap();
    }

    #[test]
    fn open_at_version_8_reaches_latest() {
        let conn = open_at_version(8).unwrap();
        let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 8);
        assert_eq!(v, LATEST);
    }
```

- [ ] **Step 6: Run backend tests**

Run: `cmd /c "tools\dev-env.cmd cargo test -p audioshelf --lib"` (FOREGROUND, large timeout). Expected: all PASS including the two new `db` tests and the two `metadata` tests.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/metadata.rs src-tauri/src/lib.rs src-tauri/src/db.rs
git commit -m "feat(m21): schema v8 metadata tables + facet/scope helpers"
```

---

## Task 2: `MetaTag`/`MetaTerm` structs + `metadata` field on rows

**Files:**
- Modify: `src-tauri/src/model.rs`
- Modify: `src-tauri/src/commands.rs` (fix struct-literal fan-out: `query_author_detail`, `load_chapter_row`)

**Note on fan-out:** Adding `metadata` to `ChapterRow`/`WorkRow` breaks every literal constructing them. Confirmed sites: `query_author_detail` (commands.rs:288-372, builds both) and `load_chapter_row` (the M11 home helper — `grep -n "load_chapter_row" src-tauri/src/commands.rs` and find its `ChapterRow {` literal). Also `AuthorDetail { ... }` at the end of `query_author_detail`. If `grep -rn "ChapterRow {" src-tauri/src` or `"WorkRow {" ` or `"AuthorDetail {"` reveals **any other** literal (e.g. in a test), update it too. In this task we add the field defaulting to `Vec::new()` everywhere; Task 4 fills the real values in `query_author_detail`.

- [ ] **Step 1: Add the two new structs to `model.rs`**

After the `ScopedWork` struct (model.rs:~390), add:

```rust
/// A single applied metadata value (a narrator / language / mood term attached to an
/// entity). `facet` is one of metadata::FACETS.
#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MetaTag {
    pub term_id: i64,
    pub facet: String,
    pub value: String,
}

/// A vocabulary term plus usage counts (for the metadata manager UI).
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MetaTerm {
    pub id: i64,
    pub facet: String,
    pub value: String,
    pub chapter_count: i64,
    pub author_count: i64,
}
```

- [ ] **Step 2: Add `metadata` to `ChapterRow`, `WorkRow`, `AuthorDetail`**

In `ChapterRow` (model.rs:26-39) add as the last field:

```rust
    pub metadata: Vec<MetaTag>,
```

In `WorkRow` (model.rs:42-51) add as the last field:

```rust
    pub metadata: Vec<MetaTag>,
```

In `AuthorDetail` (model.rs:89-95) add as the last field:

```rust
    pub metadata: Vec<MetaTag>,
```

- [ ] **Step 3: Patch the constructors to default the new field (compile fix)**

In `commands.rs` `query_author_detail`, the chapter row closure (the `Ok(ChapterRow { ... })` around commands.rs:330-345): add `metadata: Vec::new(),` as the last field. The work row closure (`Ok(WorkRow { ... })` around commands.rs:300-310): add `metadata: Vec::new(),`. The final return `Ok(AuthorDetail { id: author_id, name, tags, works })`: change to `Ok(AuthorDetail { id: author_id, name, tags, works, metadata: Vec::new() })`.

In `load_chapter_row` (grep for it): its `ChapterRow { ... }` literal currently sets `tags: Vec::new()` (or similar). Add `metadata: Vec::new(),` alongside. **If `load_chapter_row` populates `tags` non-trivially, still set `metadata: Vec::new()` — home does not render metadata chips.**

- [ ] **Step 4: Compile**

Run: `cmd /c "tools\dev-env.cmd cargo build -p audioshelf -v minimal"` (FOREGROUND). Expected: clean build. If the compiler reports another `ChapterRow {`/`WorkRow {`/`AuthorDetail {` literal missing the field, add `metadata: Vec::new(),` there and rebuild. **Report any literal outside the three named sites before fixing, in case it signals a structure you didn't expect.**

- [ ] **Step 5: Run tests**

Run: `cmd /c "tools\dev-env.cmd cargo test -p audioshelf --lib"` (FOREGROUND). Expected: PASS (Rust tests don't assert on the new field yet).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/model.rs src-tauri/src/commands.rs
git commit -m "feat(m21): MetaTag/MetaTerm models + metadata field on rows"
```

---

## Task 3: Vocabulary CRUD commands

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Test: a new `#[cfg(test)]` block in `commands.rs` (mirror existing tag tests) OR `src-tauri/tests/` integration — use the in-module test style already present for tags.

At the top of `commands.rs`, ensure the helpers are in scope: `use crate::metadata::{is_valid_facet, scope_table, facet_label};` and `use crate::model::{MetaTag, MetaTerm};` (add to the existing `use crate::model::...` line if there is one; otherwise add a fresh `use`).

- [ ] **Step 1: Write failing tests for the vocabulary helpers**

Add to `commands.rs` test module (find the existing `#[cfg(test)] mod tests` that tests tags — it opens an in-memory DB via a helper; mirror it). If the module uses a local `fn mem() -> Connection` helper, reuse it; otherwise use `crate::db::open_at_version(8).unwrap()`.

```rust
    #[test]
    fn upsert_term_is_idempotent_and_validates_facet() {
        let conn = crate::db::open_at_version(8).unwrap();
        let a = upsert_term(&conn, "narrator", "  Jane Roe  ").unwrap();
        assert_eq!(a.value, "Jane Roe"); // trimmed
        let b = upsert_term(&conn, "narrator", "Jane Roe").unwrap();
        assert_eq!(a.id, b.id); // same row, no duplicate
        let n: i64 = conn.query_row("SELECT count(*) FROM metadata_terms", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        assert!(upsert_term(&conn, "genre", "x").is_err()); // invalid facet
        assert!(upsert_term(&conn, "mood", "   ").is_err()); // empty value
    }

    #[test]
    fn list_terms_reports_usage_counts() {
        let conn = crate::db::open_at_version(8).unwrap();
        // seed a minimal author + work + chapter so attachments are valid.
        conn.execute("INSERT INTO authors(id, folder_name, display_name, status) VALUES (1,'a','A','active')", []).unwrap();
        conn.execute("INSERT INTO works(id, author_id, base_title, sort_key, status) VALUES (1,1,'W','w','active')", []).unwrap();
        conn.execute("INSERT INTO chapters(id, work_id, file_path, raw_filename, chapter_no, format, duration_secs, played, status) VALUES (1,1,'/x.wav','x.wav',1,'wav',5,0,'active')", []).unwrap();
        let t = upsert_term(&conn, "mood", "cozy").unwrap();
        conn.execute("INSERT INTO chapter_metadata(chapter_id, term_id) VALUES (1, ?1)", params![t.id]).unwrap();
        conn.execute("INSERT INTO author_metadata(author_id, term_id) VALUES (1, ?1)", params![t.id]).unwrap();
        let terms = query_metadata_terms(&conn).unwrap();
        assert_eq!(terms.len(), 1);
        assert_eq!(terms[0].chapter_count, 1);
        assert_eq!(terms[0].author_count, 1);
    }
```

> **STOP-and-check:** the column list in the `chapters` INSERT above must match the real `chapters` schema (id, work_id, file_path, raw_filename, chapter_no, format, duration_secs, played, status, …). If `SCHEMA_V1` requires NOT NULL columns not listed here, add them. Read `db.rs` SCHEMA_V1 for the `chapters` table before running.

- [ ] **Step 2: Run tests — expect FAIL (functions undefined)**

Run: `cmd /c "tools\dev-env.cmd cargo test -p audioshelf upsert_term --lib"`. Expected: FAIL to compile (`upsert_term`, `query_metadata_terms` not found).

- [ ] **Step 3: Implement the vocabulary helpers + commands**

Add to `commands.rs` (near the tag commands, ~line 1672):

```rust
/// Create-or-fetch a metadata term. Idempotent on UNIQUE(facet, value). Trims the
/// value and rejects unknown facets / blank values.
pub(crate) fn upsert_term(conn: &rusqlite::Connection, facet: &str, value: &str) -> rusqlite::Result<MetaTerm> {
    if !is_valid_facet(facet) {
        return Err(rusqlite::Error::InvalidParameterName(format!("unknown facet: {facet}")));
    }
    let v = value.trim();
    if v.is_empty() {
        return Err(rusqlite::Error::InvalidParameterName("empty metadata value".into()));
    }
    conn.execute(
        "INSERT OR IGNORE INTO metadata_terms(facet, value) VALUES (?1, ?2)",
        params![facet, v],
    )?;
    let id: i64 = conn.query_row(
        "SELECT id FROM metadata_terms WHERE facet=?1 AND value=?2",
        params![facet, v],
        |r| r.get(0),
    )?;
    Ok(MetaTerm { id, facet: facet.to_string(), value: v.to_string(), chapter_count: 0, author_count: 0 })
}

/// All vocabulary terms with usage counts, ordered by facet then value.
pub(crate) fn query_metadata_terms(conn: &rusqlite::Connection) -> rusqlite::Result<Vec<MetaTerm>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.facet, t.value,
                (SELECT count(*) FROM chapter_metadata cm WHERE cm.term_id=t.id),
                (SELECT count(*) FROM author_metadata am WHERE am.term_id=t.id)
         FROM metadata_terms t
         ORDER BY t.facet, lower(t.value)",
    )?;
    stmt.query_map([], |r| Ok(MetaTerm {
        id: r.get(0)?, facet: r.get(1)?, value: r.get(2)?,
        chapter_count: r.get(3)?, author_count: r.get(4)?,
    }))?.collect()
}

#[tauri::command]
pub fn create_metadata_term(state: tauri::State<DbState>, facet: String, value: String) -> Result<MetaTerm, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    upsert_term(&conn, &facet, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_metadata_terms(state: tauri::State<DbState>) -> Result<Vec<MetaTerm>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    query_metadata_terms(&conn).map_err(|e| e.to_string())
}

/// Rename a term's value (within its facet). A collision with an existing
/// (facet,value) surfaces the UNIQUE error to the caller — use merge to combine.
#[tauri::command]
pub fn rename_metadata_term(state: tauri::State<DbState>, id: i64, value: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let v = value.trim();
    if v.is_empty() { return Err("empty metadata value".into()); }
    conn.execute("UPDATE metadata_terms SET value=?1 WHERE id=?2", params![v, id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Delete a term and all its attachments (transactional).
#[tauri::command]
pub fn delete_metadata_term(state: tauri::State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM chapter_metadata WHERE term_id=?1", params![id]).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM author_metadata WHERE term_id=?1", params![id]).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM metadata_terms WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

/// Merge source terms into a target term: re-point chapter + author attachments
/// (INSERT OR IGNORE dedups), then delete the sources. Transactional.
#[tauri::command]
pub fn merge_metadata_terms(state: tauri::State<DbState>, source_ids: Vec<i64>, target_id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for sid in &source_ids {
        if *sid == target_id { continue; }
        tx.execute(
            "INSERT OR IGNORE INTO chapter_metadata(chapter_id, term_id) SELECT chapter_id, ?1 FROM chapter_metadata WHERE term_id=?2",
            params![target_id, sid],
        ).map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM chapter_metadata WHERE term_id=?1", params![sid]).map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT OR IGNORE INTO author_metadata(author_id, term_id) SELECT author_id, ?1 FROM author_metadata WHERE term_id=?2",
            params![target_id, sid],
        ).map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM author_metadata WHERE term_id=?1", params![sid]).map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM metadata_terms WHERE id=?1", params![sid]).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `cmd /c "tools\dev-env.cmd cargo test -p audioshelf --lib"`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "feat(m21): metadata vocabulary CRUD commands"
```

---

## Task 4: Attach/detach commands + read integration into Author Detail

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Test: `commands.rs` test module

- [ ] **Step 1: Write failing tests**

```rust
    #[test]
    fn add_and_remove_chapter_metadata_roundtrip() {
        let conn = crate::db::open_at_version(8).unwrap();
        conn.execute("INSERT INTO authors(id, folder_name, display_name, status) VALUES (1,'a','A','active')", []).unwrap();
        conn.execute("INSERT INTO works(id, author_id, base_title, sort_key, status) VALUES (1,1,'W','w','active')", []).unwrap();
        conn.execute("INSERT INTO chapters(id, work_id, file_path, raw_filename, chapter_no, format, duration_secs, played, status) VALUES (1,1,'/x.wav','x.wav',1,'wav',5,0,'active')", []).unwrap();
        // attach via the shared helper (the command wraps this).
        let term = attach_value(&conn, "chapter", 1, "narrator", "Jane Roe").unwrap();
        assert_eq!(term.facet, "narrator");
        let got = chapter_metadata(&conn, 1).unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].value, "Jane Roe");
        // idempotent attach.
        attach_value(&conn, "chapter", 1, "narrator", "Jane Roe").unwrap();
        assert_eq!(chapter_metadata(&conn, 1).unwrap().len(), 1);
        // detach.
        detach_value(&conn, "chapter", 1, term.term_id).unwrap();
        assert_eq!(chapter_metadata(&conn, 1).unwrap().len(), 0);
    }

    #[test]
    fn invalid_scope_is_rejected() {
        let conn = crate::db::open_at_version(8).unwrap();
        assert!(attach_value(&conn, "work", 1, "mood", "cozy").is_err());
    }
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cmd /c "tools\dev-env.cmd cargo test -p audioshelf add_and_remove_chapter_metadata --lib"`. Expected: compile FAIL (`attach_value`/`detach_value`/`chapter_metadata` undefined).

- [ ] **Step 3: Implement attach/detach + read helpers + commands**

Add to `commands.rs`:

```rust
/// Read all metadata terms attached to a chapter.
pub(crate) fn chapter_metadata(conn: &rusqlite::Connection, chapter_id: i64) -> rusqlite::Result<Vec<MetaTag>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.facet, t.value FROM chapter_metadata cm
         JOIN metadata_terms t ON cm.term_id=t.id
         WHERE cm.chapter_id=?1 ORDER BY t.facet, lower(t.value)",
    )?;
    stmt.query_map(params![chapter_id], |r| Ok(MetaTag { term_id: r.get(0)?, facet: r.get(1)?, value: r.get(2)? }))?
        .collect()
}

/// Read all metadata terms attached to an author.
pub(crate) fn author_metadata(conn: &rusqlite::Connection, author_id: i64) -> rusqlite::Result<Vec<MetaTag>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.facet, t.value FROM author_metadata am
         JOIN metadata_terms t ON am.term_id=t.id
         WHERE am.author_id=?1 ORDER BY t.facet, lower(t.value)",
    )?;
    stmt.query_map(params![author_id], |r| Ok(MetaTag { term_id: r.get(0)?, facet: r.get(1)?, value: r.get(2)? }))?
        .collect()
}

/// Create-or-fetch the term, then attach it to `(scope, id)`. Idempotent.
pub(crate) fn attach_value(conn: &rusqlite::Connection, scope: &str, id: i64, facet: &str, value: &str) -> rusqlite::Result<MetaTag> {
    let (table, key_col) = scope_table(scope)
        .ok_or_else(|| rusqlite::Error::InvalidParameterName(format!("unknown scope: {scope}")))?;
    let term = upsert_term(conn, facet, value)?;
    conn.execute(
        &format!("INSERT OR IGNORE INTO {table}({key_col}, term_id) VALUES (?1, ?2)"),
        params![id, term.id],
    )?;
    Ok(MetaTag { term_id: term.id, facet: term.facet, value: term.value })
}

/// Detach `term_id` from `(scope, id)`. The term itself is left in the vocabulary.
pub(crate) fn detach_value(conn: &rusqlite::Connection, scope: &str, id: i64, term_id: i64) -> rusqlite::Result<()> {
    let (table, key_col) = scope_table(scope)
        .ok_or_else(|| rusqlite::Error::InvalidParameterName(format!("unknown scope: {scope}")))?;
    conn.execute(
        &format!("DELETE FROM {table} WHERE {key_col}=?1 AND term_id=?2"),
        params![id, term_id],
    )?;
    Ok(())
}

#[tauri::command]
pub fn add_metadata_value(state: tauri::State<DbState>, scope: String, id: i64, facet: String, value: String) -> Result<MetaTag, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    attach_value(&conn, &scope, id, &facet, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_metadata_value(state: tauri::State<DbState>, scope: String, id: i64, term_id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    detach_value(&conn, &scope, id, term_id).map_err(|e| e.to_string())
}
```

- [ ] **Step 4: Wire reads into `query_author_detail`**

In `query_author_detail` (commands.rs:288-372): inside the per-chapter tag loop (`for ch in &mut work.chapters { ... ch.tags = ...; }`), after assigning `ch.tags`, add:

```rust
            ch.metadata = chapter_metadata(conn, ch.id)?;
```

After the chapter loop completes for a work (right after `work.tags = ...` is set, still inside `for work in &mut works`), compute the work-level aggregate (union of its chapters' metadata, deduped by term_id):

```rust
        // Work metadata = union of its chapters' metadata (per-audio rolls up to work).
        let mut seen_terms = std::collections::BTreeSet::new();
        let mut wm: Vec<MetaTag> = Vec::new();
        for ch in &work.chapters {
            for m in &ch.metadata {
                if seen_terms.insert(m.term_id) { wm.push(m.clone()); }
            }
        }
        wm.sort_by(|a, b| a.facet.cmp(&b.facet).then(a.value.to_lowercase().cmp(&b.value.to_lowercase())));
        work.metadata = wm;
```

> **Ordering caveat:** the work-aggregate block must run **after** `ch.metadata` is populated for every chapter of that work. If the existing code sets `ch.tags`/`ch.metadata` in a separate inner loop, place the aggregate block after that inner loop but still inside the `for work in &mut works` body.

Replace the final return to populate author metadata:

```rust
    let author_meta = author_metadata(conn, author_id)?;
    Ok(AuthorDetail { id: author_id, name, tags, works, metadata: author_meta })
```

- [ ] **Step 5: Add a `query_author_detail` metadata assertion test**

```rust
    #[test]
    fn author_detail_surfaces_chapter_and_work_metadata() {
        let conn = crate::db::open_at_version(8).unwrap();
        conn.execute("INSERT INTO authors(id, folder_name, display_name, status) VALUES (1,'a','A','active')", []).unwrap();
        conn.execute("INSERT INTO works(id, author_id, base_title, sort_key, status) VALUES (1,1,'W','w','active')", []).unwrap();
        conn.execute("INSERT INTO chapters(id, work_id, file_path, raw_filename, chapter_no, format, duration_secs, played, status) VALUES (1,1,'/x.wav','x.wav',1,'wav',5,0,'active')", []).unwrap();
        attach_value(&conn, "chapter", 1, "narrator", "Jane Roe").unwrap();
        attach_value(&conn, "author", 1, "language", "English").unwrap();
        let d = query_author_detail(&conn, 1).unwrap();
        assert_eq!(d.metadata.iter().filter(|m| m.facet == "language").count(), 1);
        assert_eq!(d.works[0].chapters[0].metadata[0].value, "Jane Roe");
        assert_eq!(d.works[0].metadata[0].value, "Jane Roe"); // aggregated to the work
    }
```

- [ ] **Step 6: Build + test**

Run: `cmd /c "tools\dev-env.cmd cargo test -p audioshelf --lib"`. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "feat(m21): attach/detach metadata + surface on author detail"
```

---

## Task 5: Search DSL — `narrator:`/`language:`/`mood:` filters

**Files:**
- Modify: `src-tauri/src/query.rs`
- Test: `query.rs` test module (it already has `parse_query` tests — mirror them)

- [ ] **Step 1: Write failing tests**

In `query.rs`'s `#[cfg(test)] mod tests`:

```rust
    #[test]
    fn parses_metadata_facet_filters() {
        let p = parse_query("narrator:Roe mood:cozy language:English ghosts");
        assert_eq!(p.meta, vec![
            MetaFilter { facet: "narrator".into(), value: "Roe".into() },
            MetaFilter { facet: "mood".into(), value: "cozy".into() },
            MetaFilter { facet: "language".into(), value: "English".into() },
        ]);
        assert_eq!(p.text, "ghosts");
    }

    #[test]
    fn empty_facet_value_falls_through_to_text() {
        let p = parse_query("narrator:");
        assert!(p.meta.is_empty());
        assert_eq!(p.text, "narrator:");
    }
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cmd /c "tools\dev-env.cmd cargo test -p audioshelf parses_metadata_facet_filters --lib"`. Expected: compile FAIL (`MetaFilter` and `p.meta` undefined).

- [ ] **Step 3: Add `MetaFilter` + `meta` field + parse arms**

In `query.rs`, after the `StatusFilter` enum (query.rs:~10), add:

```rust
/// A single metadata facet filter from the search DSL (e.g. `narrator:Roe`).
/// Matches a single whitespace-delimited token value (no quoting), like `tag:`.
#[derive(Debug, PartialEq, Eq, Clone)]
pub struct MetaFilter {
    pub facet: String,
    pub value: String,
}
```

In `ParsedQuery` (query.rs:12-18) add field `pub meta: Vec<MetaFilter>,`.

In `parse_query` (query.rs:20-42), add these arms in the `if/else if` chain **before** the final `else { text_parts.push(tok); }`:

```rust
        } else if let Some(v) = tok.strip_prefix("narrator:") {
            if !v.is_empty() { out.meta.push(MetaFilter { facet: "narrator".into(), value: v.to_string() }); }
            else { text_parts.push(tok); }
        } else if let Some(v) = tok.strip_prefix("language:") {
            if !v.is_empty() { out.meta.push(MetaFilter { facet: "language".into(), value: v.to_string() }); }
            else { text_parts.push(tok); }
        } else if let Some(v) = tok.strip_prefix("mood:") {
            if !v.is_empty() { out.meta.push(MetaFilter { facet: "mood".into(), value: v.to_string() }); }
            else { text_parts.push(tok); }
```

> Note: `ParsedQuery` derives `Default`, and `Vec<MetaFilter>` is `Default` — no other change needed for the derive.

- [ ] **Step 4: Run — expect PASS**

Run: `cmd /c "tools\dev-env.cmd cargo test -p audioshelf --lib query"`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/query.rs
git commit -m "feat(m21): narrator/language/mood search DSL filters"
```

---

## Task 6: `run_scoped_query` honors metadata filters

**Files:**
- Modify: `src-tauri/src/scoped.rs`
- Test: `scoped.rs` test module (mirror existing scoped tests; they build an in-memory DB)

- [ ] **Step 1: Write a failing test**

In `scoped.rs` tests (use `crate::db::open_at_version(8)`):

```rust
    #[test]
    fn scoped_query_filters_by_narrator() {
        let conn = crate::db::open_at_version(8).unwrap();
        conn.execute("INSERT INTO authors(id, folder_name, display_name, status) VALUES (1,'a','A','active')", []).unwrap();
        // two works; only work 1's chapter carries the narrator.
        for w in 1..=2 {
            conn.execute("INSERT INTO works(id, author_id, base_title, sort_key, status) VALUES (?1,1,?2,?3,'active')",
                rusqlite::params![w, format!("W{w}"), format!("w{w}")]).unwrap();
            conn.execute("INSERT INTO chapters(id, work_id, file_path, raw_filename, chapter_no, format, duration_secs, played, status) VALUES (?1,?1,?2,'x.wav',1,'wav',5,0,'active')",
                rusqlite::params![w, format!("/{w}.wav")]).unwrap();
        }
        let t = crate::commands::attach_value(&conn, "chapter", 1, "narrator", "Roe").unwrap();
        let _ = t;
        let p = crate::query::parse_query("narrator:Roe");
        let out = run_scoped_query(&conn, &p, 50).unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].work_id, 1);
    }
```

> `attach_value` is `pub(crate)` in `commands.rs`; reach it as `crate::commands::attach_value`. If the visibility blocks the test, leave the helper `pub(crate)` and ensure the test is inside the crate (it is — `scoped.rs` is part of the lib crate).

- [ ] **Step 2: Run — expect FAIL**

Run: `cmd /c "tools\dev-env.cmd cargo test -p audioshelf scoped_query_filters_by_narrator --lib"`. Expected: FAIL (no metadata filtering yet → returns 2 works, or compile error if `p.meta` unused warning-as-error; it should return 2).

- [ ] **Step 3: Add the metadata EXISTS clauses**

In `run_scoped_query` (scoped.rs:8-100), **after** the `for tag in &p.tags { ... }` loop that appends tag EXISTS clauses (and before `sql.push_str(" ORDER BY w.base_title");`), add:

```rust
    for mf in &p.meta {
        sql.push_str(
            " AND EXISTS (SELECT 1 FROM metadata_terms mt WHERE mt.facet=? AND mt.value=? AND (
                 EXISTS (SELECT 1 FROM chapter_metadata cm JOIN chapters mc ON cm.chapter_id=mc.id
                         WHERE mc.work_id=w.id AND cm.term_id=mt.id)
                 OR EXISTS (SELECT 1 FROM author_metadata am WHERE am.author_id=a.id AND am.term_id=mt.id)))",
        );
        binds.push(mf.facet.clone().into());
        binds.push(mf.value.clone().into());
    }
```

> The subquery aliases (`mt`, `cm`, `mc`, `am`) are distinct from the outer `w`/`a` and from the tag-subquery aliases, so there is no collision. Binds are appended in the same `?`-order they appear in the SQL — keep this block after the tag binds.

- [ ] **Step 4: Run — expect PASS**

Run: `cmd /c "tools\dev-env.cmd cargo test -p audioshelf --lib scoped"`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/scoped.rs
git commit -m "feat(m21): scoped search honors metadata facet filters"
```

---

## Task 7: `discovery_for_metadata` + command ("more by this narrator")

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Test: `commands.rs` test module

- [ ] **Step 1: Write a failing test**

```rust
    #[test]
    fn discovery_for_metadata_finds_works_with_unplayed_chapters() {
        let conn = crate::db::open_at_version(8).unwrap();
        conn.execute("INSERT INTO authors(id, folder_name, display_name, status) VALUES (1,'a','A','active')", []).unwrap();
        conn.execute("INSERT INTO works(id, author_id, base_title, sort_key, status) VALUES (1,1,'W','w','active')", []).unwrap();
        conn.execute("INSERT INTO chapters(id, work_id, file_path, raw_filename, chapter_no, format, duration_secs, played, status) VALUES (1,1,'/x.wav','x.wav',1,'wav',5,0,'active')", []).unwrap();
        attach_value(&conn, "chapter", 1, "narrator", "Jane Roe").unwrap();
        let out = discovery_for_metadata(&conn, "narrator", "Jane Roe", 50).unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].work_id, 1);
        assert!(out[0].reason.contains("Narrator"));
        // a fully-played work is excluded.
        conn.execute("UPDATE chapters SET played=1 WHERE id=1", []).unwrap();
        assert_eq!(discovery_for_metadata(&conn, "narrator", "Jane Roe", 50).unwrap().len(), 0);
    }
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cmd /c "tools\dev-env.cmd cargo test -p audioshelf discovery_for_metadata --lib"`. Expected: compile FAIL.

- [ ] **Step 3: Implement**

Add to `commands.rs` (near `discovery_for_tags`, ~line 587). `DiscoveryWork` and `facet_label` are already in scope (model + metadata `use`s).

```rust
/// Works (with >=1 unplayed chapter) carrying the metadata term `facet`/`value` on
/// any chapter OR on their author, ranked by unplayed count. Mirrors
/// discovery_for_tags but matches a single facet value (e.g. a narrator).
pub(crate) fn discovery_for_metadata(
    conn: &rusqlite::Connection,
    facet: &str,
    value: &str,
    cap: usize,
) -> rusqlite::Result<Vec<DiscoveryWork>> {
    let mut stmt = conn.prepare(
        "SELECT w.id, w.base_title, a.id, COALESCE(a.display_name, a.folder_name),
                (SELECT count(*) FROM chapters c WHERE c.work_id=w.id AND c.status='active' AND c.played=0)
         FROM works w JOIN authors a ON w.author_id=a.id
         WHERE w.status='active' AND a.status='active'
           AND EXISTS (
             SELECT 1 FROM metadata_terms mt WHERE mt.facet=?1 AND mt.value=?2 AND (
               EXISTS (SELECT 1 FROM chapter_metadata cm JOIN chapters mc ON cm.chapter_id=mc.id
                       WHERE mc.work_id=w.id AND cm.term_id=mt.id)
               OR EXISTS (SELECT 1 FROM author_metadata am WHERE am.author_id=a.id AND am.term_id=mt.id)))
         ORDER BY w.base_title",
    )?;
    let label = facet_label(facet);
    let mut works: Vec<DiscoveryWork> = stmt
        .query_map(params![facet, value], |r| {
            Ok(DiscoveryWork {
                work_id: r.get(0)?,
                base_title: r.get(1)?,
                author_id: r.get(2)?,
                author_name: r.get(3)?,
                unplayed_count: r.get(4)?,
                shared_tags: vec![value.to_string()],
                reason: format!("{label}: {value}"),
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    works.retain(|w| w.unplayed_count > 0);
    works.sort_by(|a, b| {
        b.unplayed_count.cmp(&a.unplayed_count)
            .then(a.base_title.to_lowercase().cmp(&b.base_title.to_lowercase()))
    });
    works.truncate(cap);
    Ok(works)
}

#[tauri::command]
pub fn get_discovery_by_metadata(state: tauri::State<DbState>, facet: String, value: String) -> Result<Vec<DiscoveryWork>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    discovery_for_metadata(&conn, &facet, &value, 50).map_err(|e| e.to_string())
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cmd /c "tools\dev-env.cmd cargo test -p audioshelf --lib"`. Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "feat(m21): discovery_for_metadata (more by this narrator)"
```

---

## Task 8: Register all new commands

**Files:**
- Modify: `src-tauri/src/lib.rs` (the `tauri::generate_handler![...]` list, lib.rs:49-129)

- [ ] **Step 1: Add the new command names**

Insert before the closing `])` of `generate_handler!` (after `commands::close_mini_player`, adding a comma to that line):

```rust
    commands::create_metadata_term,
    commands::list_metadata_terms,
    commands::rename_metadata_term,
    commands::delete_metadata_term,
    commands::merge_metadata_terms,
    commands::add_metadata_value,
    commands::remove_metadata_value,
    commands::get_discovery_by_metadata
```

- [ ] **Step 2: Build the full app (debug) — confirms commands resolve + frontend embed**

First build the frontend so `generate_context!` embeds it, then the debug app:

```
npm run build
cmd /c "tools\dev-env.cmd cargo build -p audioshelf -v minimal"
```

Expected: clean build, no "command not found in handler" macro errors.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(m21): register metadata commands"
```

---

## Task 9: Frontend api.ts — interfaces + wrappers + row fields

**Files:**
- Modify: `src/lib/api.ts`
- Modify: any TS test fixtures that build `ChapterRow`/`WorkRow`/`AuthorDetail` literals (grep below)

- [ ] **Step 1: Add interfaces + extend row interfaces**

In `src/lib/api.ts`, after the `TagStat` interface add:

```typescript
export interface MetaTag { termId: number; facet: string; value: string; }
export interface MetaTerm { id: number; facet: string; value: string; chapterCount: number; authorCount: number; }
```

Add `metadata: MetaTag[];` to the `ChapterRow`, `WorkRow`, and `AuthorDetail` interfaces (last field of each).

- [ ] **Step 2: Add wrappers**

Add near the other tag wrappers in `api.ts`:

```typescript
export const listMetadataTerms = () => invoke<MetaTerm[]>("list_metadata_terms");
export const createMetadataTerm = (facet: string, value: string) =>
  invoke<MetaTerm>("create_metadata_term", { facet, value });
export const renameMetadataTerm = (id: number, value: string) =>
  invoke("rename_metadata_term", { id, value });
export const deleteMetadataTerm = (id: number) => invoke("delete_metadata_term", { id });
export const mergeMetadataTerms = (sourceIds: number[], targetId: number) =>
  invoke("merge_metadata_terms", { sourceIds, targetId });
export const addMetadataValue = (scope: "chapter" | "author", id: number, facet: string, value: string) =>
  invoke<MetaTag>("add_metadata_value", { scope, id, facet, value });
export const removeMetadataValue = (scope: "chapter" | "author", id: number, termId: number) =>
  invoke("remove_metadata_value", { scope, id, termId });
export const getDiscoveryByMetadata = (facet: string, value: string) =>
  invoke<DiscoveryWork[]>("get_discovery_by_metadata", { facet, value });
```

- [ ] **Step 3: Fix TS literal fan-out**

Run: `grep -rn "metadata:" src --include=*.test.tsx` is NOT the check. Instead grep for literals that now need the field: search for builders of these rows in tests/fixtures:

Run (PowerShell): `Select-String -Path src -Pattern "chapters: \[\{|baseTitle:|userSummary:" -Recurse` — but the reliable check is the compiler. Add `metadata: []` to any object literal typed as `ChapterRow`/`WorkRow`/`AuthorDetail` that tsc flags. Proceed to Step 4 and let tsc enumerate them.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`. Expected: tsc lists every test/fixture literal missing `metadata`. Add `metadata: []` to each (chapters get `metadata: []` too). Re-run until clean.

- [ ] **Step 5: Run FE tests**

Run: `npm test`. Expected: PASS (no behavior change yet).

- [ ] **Step 6: Commit**

```bash
git add src/lib/api.ts src
git commit -m "feat(m21): api wrappers + metadata on row interfaces"
```

---

## Task 10: Icon glyph + Narrators nav route scaffold

**Files:**
- Modify: `src/components/Icon.tsx`
- Modify: `src/components/AppShell.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add a `voice` glyph**

In `src/components/Icon.tsx`: add `"voice"` to the `IconName` union (next to `"collections"`), and add to the `glyphs` record:

```typescript
  voice:       { d: "M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" },
```

- [ ] **Step 2: Add the `narrators` route to AppShell**

In `src/components/AppShell.tsx`: add `"narrators"` to the `ShellRoute` union. Add `onNarrators: () => void;` to the props type and destructure `onNarrators` in the signature. Add a nav item to the `items` array (place it right after the `discovery` item):

```typescript
    { key: "narrators", label: "Narrators", icon: "voice", action: onNarrators },
```

- [ ] **Step 3: Wire the route through App.tsx (scaffold only — view added in Task 13)**

In `src/App.tsx`:
- Find the route discriminated-union type (`type Route = ... | { kind: "collections" } | ...`) and add `| { kind: "narrators" }`.
- Find `shellRoute(route)` (maps `route.kind` → `ShellRoute`) and add a case mapping `"narrators"` → `"narrators"`.
- Add an opener near `openCollections`: `const openNarrators = () => setRoute({ kind: "narrators" });` (match the existing opener style — some are `async` and load data; a plain setter is fine here, data loads in Task 13).
- In the `<AppShell ... />` props, add `onNarrators={openNarrators}`.
- In `routedView()`, add a temporary branch so it compiles (replaced in Task 13):

```tsx
    if (route.kind === "narrators") {
      return <div className="view" />;
    }
```

- [ ] **Step 4: Typecheck + tests**

Run: `npx tsc --noEmit` then `npm test`. Expected: PASS. (AppShell test may assert nav item count — if `AppShell.test.tsx` enumerates items or requires the new `onNarrators` prop, add `onNarrators: () => {}` to its props and bump any nav-count assertion by 1.)

- [ ] **Step 5: Commit**

```bash
git add src/components/Icon.tsx src/components/AppShell.tsx src/App.tsx src/components/AppShell.test.tsx
git commit -m "feat(m21): voice icon + Narrators nav route scaffold"
```

---

## Task 11: Metadata vocabulary manager (Settings)

**Files:**
- Create: `src/views/MetadataManagerView.tsx`
- Create: `src/views/MetadataManagerView.test.tsx`
- Modify: `src/views/SettingsView.tsx` (render it)
- Modify: `src/App.tsx` (load terms + handlers)

- [ ] **Step 1: Write the component test (failing)**

Create `src/views/MetadataManagerView.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MetadataManagerView } from "./MetadataManagerView";
import type { MetaTerm } from "../lib/api";

const terms: MetaTerm[] = [
  { id: 1, facet: "narrator", value: "Jane Roe", chapterCount: 3, authorCount: 0 },
  { id: 2, facet: "mood", value: "cozy", chapterCount: 1, authorCount: 0 },
];

describe("MetadataManagerView", () => {
  it("groups terms by facet and creates a new value", () => {
    const onCreate = vi.fn();
    render(
      <MetadataManagerView terms={terms} onCreate={onCreate} onRename={vi.fn()} onDelete={vi.fn()} onMerge={vi.fn()} />,
    );
    expect(screen.getByText("Jane Roe")).toBeInTheDocument();
    expect(screen.getByText("cozy")).toBeInTheDocument();
    // Headings for all three facets render even when empty (language has none).
    expect(screen.getByText(/Narrator/i)).toBeInTheDocument();
    expect(screen.getByText(/Language/i)).toBeInTheDocument();
    expect(screen.getByText(/Mood/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("New narrator value"), { target: { value: "John Doe" } });
    fireEvent.click(screen.getByText("Add narrator"));
    expect(onCreate).toHaveBeenCalledWith("narrator", "John Doe");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- MetadataManagerView`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement the component**

Create `src/views/MetadataManagerView.tsx`:

```tsx
import { useState } from "react";
import type { MetaTerm } from "../lib/api";
import { Button, EmptyState, Notice, SectionHeading } from "../components/ui";

const FACETS: { key: string; label: string }[] = [
  { key: "narrator", label: "Narrator" },
  { key: "language", label: "Language" },
  { key: "mood", label: "Mood" },
];

export interface MetadataManagerViewProps {
  terms: MetaTerm[];
  onCreate: (facet: string, value: string) => void;
  onRename: (id: number, value: string) => void;
  onDelete: (id: number) => void;
  onMerge: (sourceIds: number[], targetId: number) => void;
}

export function MetadataManagerView({ terms, onCreate, onRename, onDelete, onMerge }: MetadataManagerViewProps) {
  return (
    <div>
      <SectionHeading title="Metadata" eyebrow="Narrator · language · mood — your own values, applied to files and creators" />
      {FACETS.map((f) => (
        <FacetSection
          key={f.key}
          facet={f.key}
          label={f.label}
          terms={terms.filter((t) => t.facet === f.key)}
          onCreate={onCreate}
          onRename={onRename}
          onDelete={onDelete}
          onMerge={onMerge}
        />
      ))}
    </div>
  );
}

function FacetSection({ facet, label, terms, onCreate, onRename, onDelete, onMerge }: {
  facet: string; label: string; terms: MetaTerm[];
  onCreate: (facet: string, value: string) => void;
  onRename: (id: number, value: string) => void;
  onDelete: (id: number) => void;
  onMerge: (sourceIds: number[], targetId: number) => void;
}) {
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function submit() {
    const v = draft.trim();
    if (!v) return;
    onCreate(facet, v);
    setDraft("");
  }
  function mergeSelected() {
    const ids = Array.from(selected);
    if (ids.length < 2) return;
    // Merge the rest into the first selected (by display order).
    const [target, ...sources] = ids;
    onMerge(sources, target);
    setSelected(new Set());
  }

  return (
    <section className="view-section" style={{ marginBottom: 20 }}>
      <h3 style={{ margin: "8px 0" }}>{label}</h3>
      <div className="toolbar card" style={{ padding: 12, gap: 8, display: "flex", alignItems: "center" }}>
        <input
          aria-label={`New ${facet} value`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder={`Add a ${facet}…`}
        />
        <Button variant="primary" onClick={submit}>Add {facet}</Button>
        {selected.size >= 2 && (
          <Button variant="secondary" onClick={mergeSelected}>Merge {selected.size}…</Button>
        )}
      </div>
      {terms.length === 0 ? (
        <Notice tone="info">No {facet} values yet.</Notice>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
          <thead>
            <tr style={{ textAlign: "left" }}>
              <th style={{ width: 28 }} />
              <th style={{ padding: "6px 8px" }}>Value</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Files</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Creators</th>
              <th style={{ padding: "6px 8px" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {terms.map((t) => (
              <TermRow key={t.id} term={t} selected={selected.has(t.id)} onToggle={() => toggle(t.id)} onRename={onRename} onDelete={onDelete} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function TermRow({ term, selected, onToggle, onRename, onDelete }: {
  term: MetaTerm; selected: boolean; onToggle: () => void;
  onRename: (id: number, value: string) => void; onDelete: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(term.value);
  return (
    <tr style={{ borderTop: "1px solid var(--border, #2a2a2a)" }}>
      <td style={{ textAlign: "center" }}>
        <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select ${term.value}`} />
      </td>
      <td style={{ padding: "6px 8px", fontWeight: 500 }}>
        {editing ? (
          <input value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={`Rename ${term.value}`} />
        ) : (
          term.value
        )}
      </td>
      <td style={{ padding: "6px 8px", textAlign: "right" }}>{term.chapterCount}</td>
      <td style={{ padding: "6px 8px", textAlign: "right" }}>{term.authorCount}</td>
      <td style={{ padding: "6px 8px", display: "flex", gap: 4 }}>
        {editing ? (
          <>
            <Button variant="primary" onClick={() => { const v = draft.trim(); if (v) onRename(term.id, v); setEditing(false); }}>Save</Button>
            <Button variant="ghost" onClick={() => { setDraft(term.value); setEditing(false); }}>Cancel</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setEditing(true)}>Rename</Button>
            <Button variant="ghost" onClick={() => onDelete(term.id)}>Delete</Button>
          </>
        )}
      </td>
    </tr>
  );
}
```

> **Check `ui.tsx` exports.** `Button`, `EmptyState`, `Notice`, `SectionHeading` are imported from `../components/ui` per existing views (TagManagerView, MetadataView). If `SectionHeading` does not accept an `eyebrow` prop, drop it (it's optional polish). Confirm `Button`'s `variant` values (`"primary" | "secondary" | "ghost"`) against `ui.tsx` and adjust if the names differ.

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- MetadataManagerView`. Expected: PASS.

- [ ] **Step 5: Wire into Settings + App.tsx**

In `src/App.tsx`:
- Add state + load: `const [metaTerms, setMetaTerms] = useState<MetaTerm[]>([]);` and a loader `const loadMetaTerms = async () => setMetaTerms(await listMetadataTerms());`. Call `loadMetaTerms()` where other library data loads (e.g. alongside `setTagStats`/`loadAllTags` after a scan/route change). Import `listMetadataTerms, createMetadataTerm, renameMetadataTerm, deleteMetadataTerm, mergeMetadataTerms, type MetaTerm` from `./lib/api`.
- Add handlers:

```tsx
  const handleCreateMetaTerm = async (facet: string, value: string) => { await createMetadataTerm(facet, value); await loadMetaTerms(); };
  const handleRenameMetaTerm = async (id: number, value: string) => { await renameMetadataTerm(id, value); await loadMetaTerms(); };
  const handleDeleteMetaTerm = async (id: number) => { await deleteMetadataTerm(id); await loadMetaTerms(); };
  const handleMergeMetaTerms = async (sourceIds: number[], targetId: number) => { await mergeMetadataTerms(sourceIds, targetId); await loadMetaTerms(); };
```

- Pass to `SettingsView` (add to the existing `<SettingsView ... />` props): `metaTerms={metaTerms} onCreateMetaTerm={handleCreateMetaTerm} onRenameMetaTerm={handleRenameMetaTerm} onDeleteMetaTerm={handleDeleteMetaTerm} onMergeMetaTerms={handleMergeMetaTerms}`.

In `src/views/SettingsView.tsx`:
- Add the five props to the props type (`metaTerms: MetaTerm[]`, the four `on*` callbacks) and destructure them. Import `MetadataManagerView` and `type MetaTerm`.
- Render `<MetadataManagerView terms={metaTerms} onCreate={onCreateMetaTerm} onRename={onRenameMetaTerm} onDelete={onDeleteMetaTerm} onMerge={onMergeMetaTerms} />` in a new section, placed right after the existing Tag-manager (`TagManagerView`) section.

- [ ] **Step 6: Typecheck + tests**

Run: `npx tsc --noEmit` then `npm test`. Expected: PASS. (If `SettingsView.test.tsx` constructs the view, add the five new props with stub values.)

- [ ] **Step 7: Commit**

```bash
git add src/views/MetadataManagerView.tsx src/views/MetadataManagerView.test.tsx src/views/SettingsView.tsx src/App.tsx
git commit -m "feat(m21): metadata vocabulary manager in Settings"
```

---

## Task 12: Per-entity metadata editor (Author Detail)

**Files:**
- Create: `src/components/MetadataEditor.tsx`
- Create: `src/components/MetadataEditor.test.tsx`
- Modify: `src/views/AuthorDetailView.tsx` (render editor for author + each chapter)
- Modify: `src/App.tsx` (handlers + refresh)

- [ ] **Step 1: Write the component test (failing)**

Create `src/components/MetadataEditor.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MetadataEditor } from "./MetadataEditor";
import type { MetaTag } from "../lib/api";

const applied: MetaTag[] = [{ termId: 1, facet: "narrator", value: "Jane Roe" }];

describe("MetadataEditor", () => {
  it("shows applied values and adds a new one", () => {
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    render(<MetadataEditor applied={applied} suggestions={["English"]} onAdd={onAdd} onRemove={onRemove} />);
    expect(screen.getByText("Jane Roe")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Add mood value"), { target: { value: "cozy" } });
    fireEvent.keyDown(screen.getByLabelText("Add mood value"), { key: "Enter" });
    expect(onAdd).toHaveBeenCalledWith("mood", "cozy");
  });

  it("removes an applied value", () => {
    const onRemove = vi.fn();
    render(<MetadataEditor applied={applied} suggestions={[]} onAdd={vi.fn()} onRemove={onRemove} />);
    fireEvent.click(screen.getByLabelText("Remove Jane Roe"));
    expect(onRemove).toHaveBeenCalledWith(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- MetadataEditor`. Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/components/MetadataEditor.tsx`:

```tsx
import { useId, useState } from "react";
import type { MetaTag } from "../lib/api";

const FACETS: { key: string; label: string }[] = [
  { key: "narrator", label: "Narrator" },
  { key: "language", label: "Language" },
  { key: "mood", label: "Mood" },
];

/** Reusable facet editor for one entity (a chapter or an author). Pure/prop-driven:
 *  it renders the applied terms grouped by facet and emits add/remove intents. */
export function MetadataEditor({ applied, suggestions, onAdd, onRemove }: {
  applied: MetaTag[];
  suggestions: string[];           // existing values across facets, for the datalist
  onAdd: (facet: string, value: string) => void;
  onRemove: (termId: number) => void;
}) {
  const listId = useId();
  return (
    <div className="metadata-editor">
      <datalist id={listId}>
        {suggestions.map((s) => <option key={s} value={s} />)}
      </datalist>
      {FACETS.map((f) => (
        <FacetRow
          key={f.key}
          facet={f.key}
          label={f.label}
          datalistId={listId}
          values={applied.filter((m) => m.facet === f.key)}
          onAdd={onAdd}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}

function FacetRow({ facet, label, datalistId, values, onAdd, onRemove }: {
  facet: string; label: string; datalistId: string; values: MetaTag[];
  onAdd: (facet: string, value: string) => void; onRemove: (termId: number) => void;
}) {
  const [draft, setDraft] = useState("");
  function commit() {
    const v = draft.trim();
    if (!v) return;
    onAdd(facet, v);
    setDraft("");
  }
  return (
    <div className="metadata-editor__row" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", margin: "4px 0" }}>
      <span className="muted" style={{ minWidth: 72 }}>{label}</span>
      {values.map((m) => (
        <span key={m.termId} className="chip">
          {m.value}
          <button type="button" className="chip__x" aria-label={`Remove ${m.value}`} onClick={() => onRemove(m.termId)}>×</button>
        </span>
      ))}
      <input
        aria-label={`Add ${facet} value`}
        list={datalistId}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
        placeholder={`+ ${facet}`}
        style={{ width: 120 }}
      />
    </div>
  );
}
```

> The `chip` / `chip__x` classes already exist in the design system (DiscoveryView uses `chip`). If `chip__x` is not styled, the `×` button still works; add a minimal rule in `components.css` only if it looks broken in the screenshot pass.

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- MetadataEditor`. Expected: PASS.

- [ ] **Step 5: Wire handlers in App.tsx**

In `src/App.tsx`, import `addMetadataValue, removeMetadataValue` from `./lib/api`. Add a flat list of all known values for the datalist suggestions: `const metaSuggestions = useMemo(() => Array.from(new Set(metaTerms.map((t) => t.value))).sort(), [metaTerms]);` (import `useMemo` if not already).

Add handlers that refresh the open author detail after a change (mirror how `setChapterTagsFor` refreshes `detail` — find that function and reuse its refresh path, e.g. it calls `openAuthor(detail.id)` or re-fetches `getAuthorDetail`):

```tsx
  const handleAddChapterMeta = async (chapterId: number, facet: string, value: string) => {
    await addMetadataValue("chapter", chapterId, facet, value);
    await loadMetaTerms();
    if (detail) await openAuthor(detail.id);
  };
  const handleRemoveChapterMeta = async (chapterId: number, termId: number) => {
    await removeMetadataValue("chapter", chapterId, termId);
    if (detail) await openAuthor(detail.id);
  };
  const handleAddAuthorMeta = async (authorId: number, facet: string, value: string) => {
    await addMetadataValue("author", authorId, facet, value);
    await loadMetaTerms();
    if (detail) await openAuthor(detail.id);
  };
  const handleRemoveAuthorMeta = async (authorId: number, termId: number) => {
    await removeMetadataValue("author", authorId, termId);
    if (detail) await openAuthor(detail.id);
  };
```

> **STOP-and-check:** confirm `openAuthor(id)` re-fetches and sets `detail` (it does in the existing flow — `setChapterTagsFor` and the journal handlers refresh this way). If the refresh helper is named differently (e.g. `reloadDetail`), use that instead. Do not introduce a new fetch pattern.

Pass to `AuthorDetailView` (add to the existing `<AuthorDetailView ... />` props):

```tsx
          metaSuggestions={metaSuggestions}
          onAddChapterMeta={handleAddChapterMeta}
          onRemoveChapterMeta={handleRemoveChapterMeta}
          onAddAuthorMeta={handleAddAuthorMeta}
          onRemoveAuthorMeta={handleRemoveAuthorMeta}
```

- [ ] **Step 6: Render the editor in AuthorDetailView**

In `src/views/AuthorDetailView.tsx`:
- Add the five props to the props type and destructure them. Import `MetadataEditor` and `type MetaTag`.
- **Author scope:** in the author header region (where `detail.tags` / the author TagEditor renders), add below it:

```tsx
        <MetadataEditor
          applied={detail.metadata}
          suggestions={metaSuggestions}
          onAdd={(facet, value) => onAddAuthorMeta(detail.id, facet, value)}
          onRemove={(termId) => onRemoveAuthorMeta(detail.id, termId)}
        />
```

- **Chapter scope:** in the per-chapter editing surface. The chapter journal/tag editing is already isolated in a `Dialog` opened from the per-chapter overflow menu (M13). Render the chapter `MetadataEditor` inside that same Dialog body (near the chapter TagEditor), using the dialog's current chapter `ch`:

```tsx
            <MetadataEditor
              applied={ch.metadata}
              suggestions={metaSuggestions}
              onAdd={(facet, value) => onAddChapterMeta(ch.id, facet, value)}
              onRemove={(termId) => onRemoveChapterMeta(ch.id, termId)}
            />
```

> **STOP-and-check:** AuthorDetailView is large. Read it first and locate (a) where author-level tags render and (b) the per-chapter editing `Dialog` body and the in-scope chapter variable name (it may be `ch`, `chapter`, or read from `editState`). Place the two editors at those exact spots; do not restructure the component. If the chapter editing Dialog keys off `editState.chapterId`, resolve the chapter object the same way the existing tag editor in that Dialog does.

- [ ] **Step 7: Typecheck + tests**

Run: `npx tsc --noEmit` then `npm test`. Expected: PASS. (Update `AuthorDetailView.test.tsx` props if it renders the view directly — add the five new props as stubs and `metadata: []` on any fixture rows, already covered by Task 9.)

- [ ] **Step 8: Commit**

```bash
git add src/components/MetadataEditor.tsx src/components/MetadataEditor.test.tsx src/views/AuthorDetailView.tsx src/App.tsx
git commit -m "feat(m21): per-chapter + per-author metadata editor"
```

---

## Task 13: Narrators browse view

**Files:**
- Create: `src/views/NarratorsView.tsx`
- Create: `src/views/NarratorsView.test.tsx`
- Modify: `src/App.tsx` (replace the Task 10 scaffold branch + load data)

- [ ] **Step 1: Write the test (failing)**

Create `src/views/NarratorsView.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { NarratorsView } from "./NarratorsView";
import type { MetaTerm, DiscoveryWork } from "../lib/api";

const narrators: MetaTerm[] = [
  { id: 1, facet: "narrator", value: "Jane Roe", chapterCount: 3, authorCount: 0 },
];
const works: DiscoveryWork[] = [
  { workId: 7, baseTitle: "Cool Story", authorId: 2, authorName: "Jane Doe", unplayedCount: 2, sharedTags: ["Jane Roe"], reason: "Narrator: Jane Roe" },
];

describe("NarratorsView", () => {
  it("lists narrators and resolves works on click", () => {
    const onSelect = vi.fn();
    render(<NarratorsView narrators={narrators} selected={null} works={[]} onSelect={onSelect} onOpenAuthor={vi.fn()} onPlayNextOfWork={vi.fn()} />);
    fireEvent.click(screen.getByText("Jane Roe"));
    expect(onSelect).toHaveBeenCalledWith("Jane Roe");
  });

  it("renders resolved works for the selected narrator", () => {
    render(<NarratorsView narrators={narrators} selected="Jane Roe" works={works} onSelect={vi.fn()} onOpenAuthor={vi.fn()} onPlayNextOfWork={vi.fn()} />);
    expect(screen.getByText("Cool Story")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- NarratorsView`. Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/views/NarratorsView.tsx`:

```tsx
import type { MetaTerm, DiscoveryWork } from "../lib/api";
import { WorkCard } from "../components/WorkCard";
import { EmptyState, PageHeader, SectionHeading } from "../components/ui";

export function NarratorsView(props: {
  narrators: MetaTerm[];
  selected: string | null;
  works: DiscoveryWork[];
  onSelect: (value: string) => void;
  onOpenAuthor: (id: number) => void;
  onPlayNextOfWork?: (workId: number, authorId: number) => void;
}) {
  return (
    <main className="view narrators">
      <PageHeader eyebrow="Browse your library by who reads it" title="Narrators" />
      <section className="view-section">
        <SectionHeading title="Pick a narrator" />
        {props.narrators.length === 0 ? (
          <EmptyState title="No narrators yet">Add a narrator to any file or creator from its page, then browse here.</EmptyState>
        ) : (
          <div className="toolbar card" style={{ padding: 12 }}>
            {props.narrators.map((n) => {
              const on = props.selected === n.value;
              return (
                <button
                  key={n.id}
                  type="button"
                  className={`chip chip--toggle${on ? " chip--on" : ""}`}
                  aria-pressed={on}
                  onClick={() => props.onSelect(n.value)}
                >
                  {n.value} <span className="muted">· {n.chapterCount}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>
      {props.selected && (
        <section className="view-section">
          <SectionHeading title={`Read by ${props.selected}`} />
          {props.works.length === 0 ? (
            <EmptyState title="Nothing unplayed">No works with unplayed chapters for this narrator.</EmptyState>
          ) : (
            <div className="card-grid">
              {props.works.map((work) => (
                <WorkCard
                  key={work.workId}
                  workId={work.workId}
                  title={work.baseTitle}
                  authorId={work.authorId}
                  authorName={work.authorName}
                  reason={work.reason}
                  tags={work.sharedTags}
                  meta={`${work.unplayedCount} unplayed`}
                  actionLabel="View creator"
                  onAction={() => props.onOpenAuthor(work.authorId)}
                  onOpenAuthor={() => props.onOpenAuthor(work.authorId)}
                  onPlay={props.onPlayNextOfWork ? () => props.onPlayNextOfWork!(work.workId, work.authorId) : undefined}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
```

> Confirm `WorkCard`'s prop names against `src/components/WorkCard.tsx` (DiscoveryView uses exactly these: `workId,title,authorId,authorName,reason,tags,meta,actionLabel,onAction,onOpenAuthor,onPlay`). They match — but verify before relying on it.

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- NarratorsView`. Expected: PASS.

- [ ] **Step 5: Wire data + replace scaffold in App.tsx**

In `src/App.tsx`:
- State: `const [selectedNarrator, setSelectedNarrator] = useState<string | null>(null);` and `const [narratorWorks, setNarratorWorks] = useState<DiscoveryWork[]>([]);` (import `type DiscoveryWork` if not already).
- Derive narrator terms from `metaTerms`: `const narratorTerms = useMemo(() => metaTerms.filter((t) => t.facet === "narrator"), [metaTerms]);`
- Selection handler (import `getDiscoveryByMetadata`):

```tsx
  const selectNarrator = async (value: string) => {
    setSelectedNarrator(value);
    setNarratorWorks(await getDiscoveryByMetadata("narrator", value));
  };
```

- Make `openNarrators` also refresh terms: change it to `const openNarrators = async () => { await loadMetaTerms(); setRoute({ kind: "narrators" }); };`
- Replace the Task 10 placeholder branch in `routedView()`:

```tsx
    if (route.kind === "narrators") {
      return (
        <NarratorsView
          narrators={narratorTerms}
          selected={selectedNarrator}
          works={narratorWorks}
          onSelect={selectNarrator}
          onOpenAuthor={openAuthor}
          onPlayNextOfWork={playNextChapterOfWork}
        />
      );
    }
```

- Import `NarratorsView` from `./views/NarratorsView`.

- [ ] **Step 6: Typecheck + tests**

Run: `npx tsc --noEmit` then `npm test`. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/views/NarratorsView.tsx src/views/NarratorsView.test.tsx src/App.tsx
git commit -m "feat(m21): Narrators browse view"
```

---

## Task 14: Discover facet picker + metadata chips

**Files:**
- Modify: `src/views/DiscoveryView.tsx` (a facet picker section)
- Modify: `src/App.tsx` (facet pick state + handler)
- Test: extend `src/views/DiscoveryView.test.tsx` (if present) or add one

- [ ] **Step 1: Add a facet-pick section to DiscoveryView**

In `src/views/DiscoveryView.tsx`, extend the props with:

```typescript
  narratorOptions: string[]; languageOptions: string[]; moodOptions: string[];
  pickedFacet: { facet: string; value: string } | null;
  byFacet: DiscoveryWork[];
  onPickFacet: (facet: string, value: string) => void;
```

Add a new `<section>` directly under the existing "Pick a tag" section, before "For You":

```tsx
      <section className="view-section">
        <SectionHeading title="By narrator, language, or mood" />
        <div className="toolbar card" style={{ padding: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {([["narrator", props.narratorOptions], ["language", props.languageOptions], ["mood", props.moodOptions]] as const).flatMap(([facet, opts]) =>
            opts.map((value) => {
              const on = props.pickedFacet?.facet === facet && props.pickedFacet?.value === value;
              return (
                <button
                  key={`${facet}:${value}`}
                  type="button"
                  className={`chip chip--toggle${on ? " chip--on" : ""}`}
                  aria-pressed={on}
                  onClick={() => props.onPickFacet(facet, value)}
                >{value}</button>
              );
            }),
          )}
        </div>
        {props.pickedFacet && <WorkList works={props.byFacet} onOpenAuthor={props.onOpenAuthor} onPlayNext={props.onPlayNextOfWork} />}
      </section>
```

> `WorkList` is the helper already defined at the top of DiscoveryView — reuse it.

- [ ] **Step 2: Wire App.tsx**

In `src/App.tsx`:
- State: `const [pickedFacet, setPickedFacet] = useState<{ facet: string; value: string } | null>(null);` and `const [byFacet, setByFacet] = useState<DiscoveryWork[]>([]);`
- Option lists from `metaTerms`:

```tsx
  const narratorOptions = useMemo(() => metaTerms.filter(t => t.facet === "narrator").map(t => t.value), [metaTerms]);
  const languageOptions = useMemo(() => metaTerms.filter(t => t.facet === "language").map(t => t.value), [metaTerms]);
  const moodOptions = useMemo(() => metaTerms.filter(t => t.facet === "mood").map(t => t.value), [metaTerms]);
```

- Handler:

```tsx
  const pickFacet = async (facet: string, value: string) => {
    setPickedFacet({ facet, value });
    setByFacet(await getDiscoveryByMetadata(facet, value));
  };
```

- Ensure `openDiscovery` (or wherever discovery data loads) also calls `loadMetaTerms()` so the option chips are populated.
- Pass the new props into `<DiscoveryView ... />`:

```tsx
          narratorOptions={narratorOptions}
          languageOptions={languageOptions}
          moodOptions={moodOptions}
          pickedFacet={pickedFacet}
          byFacet={byFacet}
          onPickFacet={pickFacet}
```

- [ ] **Step 3: Metadata chips on Author Detail works (lightweight surfacing)**

In `src/views/AuthorDetailView.tsx`, where a work's `tags` are rendered as chips, also render its `work.metadata` values as chips (read-only, distinct style). Add next to the tag chips:

```tsx
              {work.metadata.map((m) => (
                <span key={`m-${m.termId}`} className="chip chip--meta" title={m.facet}>{m.value}</span>
              ))}
```

Add a minimal style to `src/styles/components.css`:

```css
.chip--meta { opacity: 0.85; border-style: dashed; }
```

- [ ] **Step 4: Typecheck + tests**

Run: `npx tsc --noEmit` then `npm test`. Expected: PASS. (If `DiscoveryView.test.tsx` renders the view, add the six new props as stubs: empty arrays + `pickedFacet={null}` + `byFacet={[]}` + `onPickFacet={() => {}}`.)

- [ ] **Step 5: Commit**

```bash
git add src/views/DiscoveryView.tsx src/App.tsx src/views/AuthorDetailView.tsx src/styles/components.css
git commit -m "feat(m21): Discover facet picker + work metadata chips"
```

---

## Task 15: `m21` walkthrough + gates + regression verification

**Files:**
- Modify: `src/harness/walkthroughs.ts` (add `m21Steps`)
- Modify: `src/harness/runner.test.ts` (assert the new step names, if it enumerates them)
- Modify: `src/App.tsx` (harness nav functions that seed + navigate)
- Reference: `tools/verify.ps1`

> The harness drives the real app: each step navigates/sets up a screen, then the runner captures a screenshot after `settle()` + `imagesSettled()`. All M21 metadata must be **seeded at runtime** here so `fixture_scan.rs` and the on-disk fixtures stay 43/44/47.

- [ ] **Step 1: Add the `m21` step list**

In `src/harness/walkthroughs.ts`, mirroring `discoverySteps`/`journalSteps`:

```typescript
export function m21Steps(nav: {
  seedMetadata: () => Promise<void>;
  showMetadataManager: () => Promise<void>;
  showChapterMetadataEditor: () => Promise<void>;
  showNarratorsBrowse: () => Promise<void>;
  showDiscoverByFacet: () => Promise<void>;
}): Step[] {
  return [
    { name: "seed", run: nav.seedMetadata },
    { name: "metadata-manager", run: nav.showMetadataManager },
    { name: "chapter-metadata-edit", run: nav.showChapterMetadataEditor },
    { name: "narrators-browse", run: nav.showNarratorsBrowse },
    { name: "discover-by-facet", run: nav.showDiscoverByFacet },
  ];
}
```

Register `m21` wherever the walkthrough names are dispatched (find the `switch`/map keyed on the walkthrough string in the harness entry — likely in `App.tsx` harness wiring or a `runWalkthrough` switch; mirror how `journal`/`discovery` are registered). If `runner.test.ts` asserts the set of step names per walkthrough, add a `m21` case with the five names above.

- [ ] **Step 2: Implement the harness nav functions in App.tsx**

Where the other harness nav objects are built (search App.tsx for `discoverySteps(` / `journalSteps(` to find the harness section), add an `m21Steps({...})` wiring. The `seedMetadata` function creates terms + attaches them via the real api so the DB has data (then refreshes UI state):

```tsx
      const seedMetadata = async () => {
        // Seed at runtime — keeps on-disk fixtures at 43/44/47.
        const authors = await getAuthors();
        const jane = authors.find((a) => a.name === "Jane Doe") ?? authors[0];
        const d = await getAuthorDetail(jane.id);
        const firstChapter = d.works[0]?.chapters[0];
        if (firstChapter) {
          await addMetadataValue("chapter", firstChapter.id, "narrator", "Jane Roe");
          await addMetadataValue("chapter", firstChapter.id, "mood", "cozy");
        }
        await addMetadataValue("author", jane.id, "language", "English");
        await loadMetaTerms();
        await openAuthor(jane.id);
      };
      const showMetadataManager = async () => { await loadMetaTerms(); openSettings(); };
      const showChapterMetadataEditor = async () => {
        const authors = await getAuthors();
        const jane = authors.find((a) => a.name === "Jane Doe") ?? authors[0];
        await openAuthor(jane.id);
        // open the per-chapter editing Dialog for the first chapter (use the same
        // hook the journal walkthrough uses to open it — e.g. setJournalChapterId or
        // the overflow-menu open state).
        // <-- mirror journal-chapter-edit's open mechanism here -->
      };
      const showNarratorsBrowse = async () => { await loadMetaTerms(); await selectNarrator("Jane Roe"); setRoute({ kind: "narrators" }); };
      const showDiscoverByFacet = async () => { await loadMetaTerms(); await pickFacet("mood", "cozy"); openDiscovery(); };
```

> **STOP-and-check:** `showChapterMetadataEditor` must open the same per-chapter Dialog that hosts the new chapter `MetadataEditor` (Task 12). The journal walkthrough already opens this Dialog (`journal-chapter-edit` via `openJournalForChapterId`/`setEditState`). Reuse that exact mechanism so the editor is visible in the shot. If you cannot open it deterministically, report it rather than capturing the closed page.

- [ ] **Step 3: Build the debug app and run the walkthrough**

```
npm run build
cmd /c "tools\dev-env.cmd cargo tauri build --debug --no-bundle"
pwsh -File tools\verify.ps1 -Walkthrough m21 -SkipBuild
```

(Use `-SkipBuild` only after the debug exe is freshly built above; otherwise omit it. The known gotcha: a stale exe under `-SkipBuild` captures old UI.)

Expected: PNGs written to `.shots\m21\` for the five steps, and `.shots\m21.done` created.

- [ ] **Step 4: Run all gates**

```
npx tsc --noEmit
npm test
cmd /c "tools\dev-env.cmd cargo test -p audioshelf"
```

Expected: tsc clean; all FE tests pass; all Rust unit + integration tests pass (including `fixture_scan` still asserting 43/44/47 — **do not modify it**).

- [ ] **Step 5: Screenshot verification (Sonnet subagent — text verdict only)**

Dispatch a Sonnet subagent to Read the `.shots\m21\*.png` files and the `.shots\m12\*.png` regression set (re-run `verify.ps1 -Walkthrough m12 -SkipBuild` first), and return a **text verdict** (PASS/FAIL per shot + observations + the absolute paths viewed). Acceptance criteria:
- `metadata-manager`: three facet sections (Narrator/Language/Mood) with the seeded values and counts; add-value input present.
- `chapter-metadata-edit`: the per-chapter Dialog shows the MetadataEditor with the seeded narrator (`Jane Roe`) and mood (`cozy`) chips.
- `narrators-browse`: a "Narrators" page with a `Jane Roe` chip selected and at least one work card under "Read by Jane Roe".
- `discover-by-facet`: the Discover page with the facet picker and works for `mood: cozy`.
- `m12` regression: every prior screen unchanged except the **new "Narrators" sidebar nav item** (the only expected cross-screen difference).

Do **not** load the PNGs into the controller context — act on the subagent's text verdict. If a shot FAILS, fix and re-verify (watch for the documented gotchas: stale exe, persisted-setting leak across runs, modal bleed into later shots — reset transient UI between steps).

- [ ] **Step 6: Confirm invariants**

```
git diff --stat main -- src-tauri/Cargo.toml src-tauri/Cargo.lock package.json package-lock.json
```

Expected: **empty** (no dep change). Spot-audit that every new `fs`-touching path is SQLite-only (this milestone adds none). Confirm `fixture_scan.rs` unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/harness/walkthroughs.ts src/harness/runner.test.ts src/App.tsx
git commit -m "test(m21): m21 walkthrough + gates + regression verify"
```

---

## Self-review (run before opening the PR)

1. **Spec coverage:** Pillar 1 (narrator) → Tasks 4,7,13 (browse) + 5,6 (search) + 14 (Discover). Pillar 2 (per-audio metadata: language/mood) → Tasks 1–4 (schema+attach), 11 (vocab manager), 12 (editor), 14 (Discover/chips). Manual-only (no ingestion) → enforced by Out-of-scope. User-defined values → `metadata_terms` vocabulary + create flow (Task 11). Per-audio + works-aggregate → Task 4. All four product-fork answers covered.
2. **Placeholder scan:** the only deliberately-deferred-to-read spots are the AuthorDetailView insertion points (Task 12) and the chapter-Dialog open mechanism (Tasks 12/15) — each marked **STOP-and-check** with the exact existing pattern to mirror, because that file is too large to quote verbatim and must be read in place. No "TBD"/"add error handling"/"similar to" placeholders.
3. **Type consistency:** `MetaTag {termId,facet,value}` and `MetaTerm {id,facet,value,chapterCount,authorCount}` are identical across Rust (camelCase serde) and TS. Commands: `create_metadata_term`, `list_metadata_terms`, `rename_metadata_term`, `delete_metadata_term`, `merge_metadata_terms`, `add_metadata_value`, `remove_metadata_value`, `get_discovery_by_metadata` — names match registration (Task 8), wrappers (Task 9), and call sites. Scope strings `"chapter"`/`"author"` match `scope_table`. Facet strings `"narrator"/"language"/"mood"` match `FACETS`, the DSL arms, and the FE facet lists.

## Execution note

This is a **build-phase** plan. The executing session should implement Tasks 1–15 in order via Sonnet subagents (backend tasks are strictly serial — shared files), run all gates, verify screenshots in a Sonnet subagent (text verdict), open a PR, watch CI in the foreground, merge `--merge --delete-branch`, update `ROADMAP.md` (flip M21 to ✅ Merged with the PR # and a one-line summary; append a decision-log entry), and ping the user.
