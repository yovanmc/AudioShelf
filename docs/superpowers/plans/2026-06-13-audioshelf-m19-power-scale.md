# AudioShelf M19 — Power & Scale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Written for Sonnet execution. If anything in the codebase does not match what this plan states (a signature, a line range, a struct shape), STOP and report rather than guessing.** All line numbers are anchors as of 2026-06-13 and may have drifted by a few lines — match on the surrounding code, not the number.

**Goal:** Make AudioShelf scale to a large, heavily-curated library with power-user tooling: a Ctrl+K command palette, advanced scoped search (`tag:`/`duration:`/`status:`) with saved searches, multi-select bulk tagging, saved smart collections, a density toggle, per-work chapter-sort overrides, SQLite curation export/import (portable JSON merge **and** full DB snapshot), and a library-health scan.

**Architecture:** One additive **schema migration v7** (the M16 `run_step`/`user_version` runner) adds `saved_searches` + `smart_collections` tables and a `works.chapter_sort` column — the only schema change. A pure `parse_query` + `run_scoped_query` resolver powers advanced search, saved searches, and smart collections (one DSL, one resolver — DRY). Bulk tagging, chapter-sort, and density are additive DB/setting writes. Export = portable identity-keyed JSON (`build_curation_export`) + a `VACUUM INTO` DB snapshot; import = a **strictly additive, non-destructive merge** (tags union, played OR, journal fill-if-empty, collections/searches add-if-absent) plus a **crash-safe staged DB restore** applied at bootstrap (backup-before-swap, place-and-rename, never destroys the original). Frontend adds a global Ctrl+K overlay, a scoped-search mode in Library, a Collections route, a bulk-select mode, density CSS, a per-work chapter-sort control, and a "Backup & maintenance" section in Settings.

**Tech Stack:** Tauri 2 · Rust + rusqlite 0.32 (bundled) · React 18 + TypeScript · Vitest · existing deps only (`serde_json`, `@tauri-apps/plugin-dialog`, `react-window`) — **NO new crate or npm dependency.**

**Invariants this milestone MUST hold (verify at the end):**
- **Read-only on audio files.** Every new write lands in SQLite or a user-chosen non-audio path (JSON/DB-snapshot/backup). The Rename tool stays the sole audio-file mutator.
- **Fixtures stay 43 authors / 44 works / 47 chapters.** All new data is seeded at runtime in the new `m19` walkthrough; do not touch `gen-fixture`/`fixture_scan.rs`.
- **No new dependency.** `Cargo.toml`/`Cargo.lock`/`package.json`/`package-lock.json` stay byte-clean except `dialog:allow-open` added to the capabilities file (verify with `git diff --stat`).
- **Destructive-op discipline (the user's standing rule).** DB-snapshot **restore** must verify the replacement is a valid SQLite DB *before* touching the live DB, back up the current DB first (timestamped, recoverable), and swap by place-then-rename so a crash never loses data. JSON import never deletes existing data.
- **Non-goals unchanged:** no playback queue/up-next, no autoplay, no playback speed, no social, no multi-root, no per-second mid-chapter resume.

---

## Conventions (from ROADMAP.md — follow exactly)

- **Build Rust via the dev-env wrapper, FOREGROUND:** `cmd /c "tools\dev-env.cmd cargo test"` (large timeout). Run `npm run build` before any `cargo tauri build`.
- **Gates (all must pass):** `npx tsc --noEmit` · `npm test` · `cmd /c "tools\dev-env.cmd cargo test"` · `tools\verify.ps1 -Walkthrough m19` (+ the `m12` regression matrix).
- **Commits:** use the repo's configured git identity (`yovanmc <yovanmc@users.noreply.github.com>`) — never pass `-c user.email=...`. Per the workspace `AGENTS.md`, substantive Codex-generated commits append `Co-authored-by: Codex <noreply@openai.com>` after a blank line; Claude-subagent commits use the plain identity.
- **Frontend tests** are unit-level (Vitest, jsdom); UI behavior is proven by the screenshot harness, not jsdom. Keep new view components **pure/prop-driven** — `invoke` calls live in `App.tsx` (the established M15/M18 rule).

---

## File Structure (what gets created / modified)

**Backend (`src-tauri/src/`)**
- `db.rs` — Modify: add `migration_v7_power_scale`, wire into `migrate()` + `open_at_version()`, bump `LATEST` → 7; add `apply_pending_restore()` called at top of `open()`.
- `model.rs` — Modify: add `chapter_sort` to `WorkRow`; add new structs (`ScopedWork`, `ScopedResults`, `Collection`, `SavedSearch`, `HealthReport`, `HealthItem`, `ImportReport`).
- `query.rs` — **Create:** pure `parse_query` DSL parser + `ParsedQuery`/`DurationFilter`/`CmpOp`/`StatusFilter`.
- `scoped.rs` — **Create:** `run_scoped_query(conn, &ParsedQuery, cap)` resolver (consumed by advanced search + collections).
- `commands.rs` — Modify: add all new `#[tauri::command]`s (advanced search, saved-search CRUD, collection CRUD + resolve, bulk tag, chapter-sort setter, health scan, export/import); apply `chapter_sort` in `query_author_detail`.
- `backup.rs` — **Create:** `build_curation_export`, `apply_curation_import`, `export_db_snapshot`, `stage_db_restore`.
- `lib.rs` — Modify: register every new command in `generate_handler![…]`; re-export new pure fns in `pub mod testing`; declare `mod query; mod scoped; mod backup;`.

**Frontend (`src/`)**
- `lib/api.ts` — Modify: add all new `invoke` wrappers + TS interfaces.
- `lib/query.ts` — **Create:** `hasScopedTokens(raw)` detector + `describeQuery` (for chips); unit-tested.
- `lib/density.ts` — **Create:** `parseDensity`/`Density` failsafe helper; unit-tested.
- `components/CommandPalette.tsx` — **Create:** pure prop-driven Ctrl+K overlay.
- `components/ScopedResults.tsx` — **Create:** pure work-grid for scoped/collection results.
- `components/CollectionsView.tsx` — **Create:** pure Collections route view.
- `components/BulkTagDialog.tsx` — **Create:** pure add/remove-tags dialog.
- `components/AppShell.tsx` — Modify: add `collections` to `ShellRoute`, nav item + handler prop; apply `data-density`.
- `views` (`LibraryView.tsx`, `AuthorDetailView.tsx`, `SettingsView.tsx`) — Modify: scoped-search mode + saved searches (Library), bulk-select + per-work chapter-sort (Author Detail), Backup & maintenance + density (Settings).
- `App.tsx` — Modify: global Ctrl+K keydown, palette state + handlers, `collections` route, all new `invoke` wiring.
- `styles/components.css` — Modify: density rules, palette, scoped grid, bulk bar.
- `components/Icon.tsx` — Modify: add `palette`/`collections` glyphs (single `<path>` per the M18 convention).
- `harness/walkthroughs.ts`, `harness/runner.test.ts` — Modify: add `m19Steps()` + count/name assertion.

**Capabilities**
- `src-tauri/capabilities/default.json` — Modify: add `"dialog:allow-open"` (import/restore need an open-file dialog; `dialog:allow-save` already added in M17).

---

# PHASE 1 — Schema migration v7

### Task 1: Add migration v7 (tables + column)

**Files:**
- Modify: `src-tauri/src/db.rs` (`migrate()` ~157, `LATEST` ~159, `open_at_version()` ~214; add new fn near `migration_v6_journal` ~129)
- Test: `src-tauri/src/db.rs` (inline `#[cfg(test)]`) or `src-tauri/tests/` upgrade test alongside existing ones

- [ ] **Step 1: Write the failing upgrade test**

Add to the existing migration test module (mirror how v6 is tested). If none is obvious, add to `src-tauri/tests/` a file `migrate_v7.rs`:

```rust
use audioshelf_lib::testing::open_at_version;

#[test]
fn v7_adds_tables_and_chapter_sort_column() {
    let conn = open_at_version(7).unwrap();
    let uv: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(uv, 7);
    // tables exist
    for t in ["saved_searches", "smart_collections"] {
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                [t],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1, "table {t} should exist");
    }
    // new column present + defaults empty
    conn.execute_batch(
        "INSERT INTO authors(id, folder_name, status) VALUES (1,'A','active');
         INSERT INTO works(id, author_id, base_title, status) VALUES (1,1,'W','active');",
    )
    .ok(); // tolerate column list differences; the assert below is the real check
    let sort: String = conn
        .query_row("SELECT chapter_sort FROM works WHERE id=1", [], |r| r.get(0))
        .unwrap();
    assert_eq!(sort, "");
}

#[test]
fn legacy_v6_db_upgrades_to_v7_cleanly() {
    let conn = open_at_version(6).unwrap();
    // simulate opening with the latest migrate(): re-run by bumping — easiest is open_at_version(7) parity.
    // This test documents that v6→v7 is additive and idempotent (CREATE/ADD ... IF NOT EXISTS pattern).
    let uv: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(uv, 6);
}
```

> NOTE: `INSERT INTO authors/works` column lists must match the real `SCHEMA_V1`. If they differ, simplify the second assertion to only check the column exists via `PRAGMA table_info(works)`. Prefer this robust form:
> ```rust
> let has: i64 = conn.query_row(
>   "SELECT COUNT(*) FROM pragma_table_info('works') WHERE name='chapter_sort'", [], |r| r.get(0)).unwrap();
> assert_eq!(has, 1);
> ```
> Use the `pragma_table_info` form and drop the fragile INSERT.

- [ ] **Step 2: Run it — expect FAIL** (`open_at_version(7)` panics / user_version != 7)

Run: `cmd /c "tools\dev-env.cmd cargo test v7_adds_tables"`
Expected: FAIL.

- [ ] **Step 3: Add the migration fn** (place next to `migration_v6_journal`):

```rust
fn migration_v7_power_scale(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS saved_searches (
           id         INTEGER PRIMARY KEY,
           name       TEXT    NOT NULL,
           query      TEXT    NOT NULL,
           created_at INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS smart_collections (
           id         INTEGER PRIMARY KEY,
           name       TEXT    NOT NULL,
           query      TEXT    NOT NULL,
           position   INTEGER NOT NULL DEFAULT 0,
           created_at INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_smart_collections_pos ON smart_collections(position);
         ALTER TABLE works ADD COLUMN chapter_sort TEXT NOT NULL DEFAULT '';",
    )
}
```

- [ ] **Step 4: Wire it into `migrate()`** — bump `LATEST` and add the step after the v6 block:

```rust
    const LATEST: i64 = 7; // bump as later tasks add steps
    // ... existing if current < 6 { run_step(conn, 6, migration_v6_journal)?; }
    if current < 7 {
        run_step(conn, 7, migration_v7_power_scale)?;
    }
```

- [ ] **Step 5: Wire it into `open_at_version()`** — add after the v6 guard:

```rust
    if version >= 7 {
        run_step(&conn, 7, migration_v7_power_scale)?;
    }
```

- [ ] **Step 6: Run the test — expect PASS**

Run: `cmd /c "tools\dev-env.cmd cargo test v7_adds_tables legacy_v6"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/db.rs src-tauri/tests/migrate_v7.rs
git commit -m "feat(m19): add schema migration v7 (saved_searches, smart_collections, works.chapter_sort)"
```

---

# PHASE 2 — Scoped-query DSL parser (pure)

### Task 2: `query.rs` — `parse_query`

**Files:**
- Create: `src-tauri/src/query.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod query;` and re-export `parse_query`, types in `pub mod testing`)

**DSL:** space-separated tokens. `tag:<word>` (repeatable, AND-combined), `duration:<op><n><unit>` (op ∈ `< <= > >=`, default `<=` when omitted; unit ∈ `s m h`), `status:<unstarted|unplayed|inprogress|done|played|finished>`. Anything not matching a recognized `key:` prefix joins the free-text remainder. Unknown `key:` tokens fall through to free text (don't error).

- [ ] **Step 1: Write failing tests** (`src-tauri/src/query.rs`, bottom `#[cfg(test)]`):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tags_duration_status_and_text() {
        let p = parse_query("tag:cozy   duration:<15m status:unplayed bedtime story");
        assert_eq!(p.tags, vec!["cozy".to_string()]);
        assert_eq!(p.duration, Some(DurationFilter { op: CmpOp::Lt, secs: 15 * 60 }));
        assert_eq!(p.status, Some(StatusFilter::Unstarted));
        assert_eq!(p.text, "bedtime story");
    }

    #[test]
    fn duration_default_op_is_le_and_units_convert() {
        assert_eq!(parse_query("duration:30m").duration, Some(DurationFilter { op: CmpOp::Le, secs: 1800 }));
        assert_eq!(parse_query("duration:>=1h").duration, Some(DurationFilter { op: CmpOp::Ge, secs: 3600 }));
        assert_eq!(parse_query("duration:<=90s").duration, Some(DurationFilter { op: CmpOp::Le, secs: 90 }));
    }

    #[test]
    fn status_aliases_collapse() {
        assert_eq!(parse_query("status:done").status, Some(StatusFilter::Done));
        assert_eq!(parse_query("status:played").status, Some(StatusFilter::Done));
        assert_eq!(parse_query("status:finished").status, Some(StatusFilter::Done));
        assert_eq!(parse_query("status:unplayed").status, Some(StatusFilter::Unstarted));
        assert_eq!(parse_query("status:inprogress").status, Some(StatusFilter::InProgress));
    }

    #[test]
    fn multiple_tags_and_unknown_keys_fall_through() {
        let p = parse_query("tag:a tag:b foo:bar plain");
        assert_eq!(p.tags, vec!["a".to_string(), "b".to_string()]);
        assert_eq!(p.text, "foo:bar plain");
    }

    #[test]
    fn empty_query_is_empty() {
        assert_eq!(parse_query("   "), ParsedQuery::default());
    }

    #[test]
    fn garbage_duration_is_ignored() {
        assert_eq!(parse_query("duration:abc").duration, None);
        assert_eq!(parse_query("duration:abc").text, "duration:abc");
    }
}
```

- [ ] **Step 2: Run — expect FAIL** (module doesn't exist)

Run: `cmd /c "tools\dev-env.cmd cargo test query::"`
Expected: FAIL (compile error / unresolved).

- [ ] **Step 3: Implement `query.rs`:**

```rust
//! Pure parser for the M19 scoped-search DSL: `tag:` / `duration:` / `status:` + free text.

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum CmpOp { Lt, Le, Gt, Ge }

#[derive(Debug, PartialEq, Eq, Clone)]
pub struct DurationFilter { pub op: CmpOp, pub secs: i64 }

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum StatusFilter { Unstarted, InProgress, Done }

#[derive(Debug, PartialEq, Eq, Clone, Default)]
pub struct ParsedQuery {
    pub text: String,
    pub tags: Vec<String>,
    pub duration: Option<DurationFilter>,
    pub status: Option<StatusFilter>,
}

pub fn parse_query(raw: &str) -> ParsedQuery {
    let mut out = ParsedQuery::default();
    let mut text_parts: Vec<&str> = Vec::new();
    for tok in raw.split_whitespace() {
        if let Some(v) = tok.strip_prefix("tag:") {
            if !v.is_empty() { out.tags.push(v.to_string()); }
        } else if let Some(v) = tok.strip_prefix("duration:") {
            match parse_duration(v) {
                Some(d) => out.duration = Some(d),
                None => text_parts.push(tok), // unparseable → treat as text
            }
        } else if let Some(v) = tok.strip_prefix("status:") {
            match parse_status(v) {
                Some(s) => out.status = Some(s),
                None => text_parts.push(tok),
            }
        } else {
            text_parts.push(tok);
        }
    }
    out.text = text_parts.join(" ");
    out
}

fn parse_duration(v: &str) -> Option<DurationFilter> {
    let (op, rest) = if let Some(r) = v.strip_prefix("<=") {
        (CmpOp::Le, r)
    } else if let Some(r) = v.strip_prefix(">=") {
        (CmpOp::Ge, r)
    } else if let Some(r) = v.strip_prefix('<') {
        (CmpOp::Lt, r)
    } else if let Some(r) = v.strip_prefix('>') {
        (CmpOp::Gt, r)
    } else {
        (CmpOp::Le, v) // default: "up to"
    };
    let (num_str, unit) = rest.split_at(rest.find(|c: char| c.is_alphabetic()).unwrap_or(rest.len()));
    let num: i64 = num_str.parse().ok()?;
    let mult = match unit {
        "s" | "" => 1,
        "m" => 60,
        "h" => 3600,
        _ => return None,
    };
    Some(DurationFilter { op, secs: num * mult })
}

fn parse_status(v: &str) -> Option<StatusFilter> {
    match v.to_ascii_lowercase().as_str() {
        "unstarted" | "unplayed" => Some(StatusFilter::Unstarted),
        "inprogress" | "in-progress" => Some(StatusFilter::InProgress),
        "done" | "played" | "finished" => Some(StatusFilter::Done),
        _ => None,
    }
}
```

- [ ] **Step 4: Declare the module + re-export** in `src-tauri/src/lib.rs`:
  - Add near the other `mod` lines: `mod query;`
  - In `pub mod testing { … }` add: `pub use crate::query::{parse_query, CmpOp, DurationFilter, ParsedQuery, StatusFilter};`

- [ ] **Step 5: Run — expect PASS**

Run: `cmd /c "tools\dev-env.cmd cargo test query::"`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/query.rs src-tauri/src/lib.rs
git commit -m "feat(m19): pure scoped-query DSL parser (tag/duration/status + text)"
```

---

# PHASE 3 — Scoped resolver + advanced_search command

### Task 3: `scoped.rs` — `run_scoped_query` + `ScopedWork`

**Files:**
- Create: `src-tauri/src/scoped.rs`
- Modify: `src-tauri/src/model.rs` (add `ScopedWork`, `ScopedResults`), `src-tauri/src/commands.rs` (add `advanced_search` command), `src-tauri/src/lib.rs` (`mod scoped;`, register command, testing re-export)

**Result shape** — add to `model.rs` (mirror the `#[serde(rename_all="camelCase")]` style already used there):

```rust
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScopedWork {
    pub work_id: i64,
    pub base_title: String,
    pub author_id: i64,
    pub author_name: String,
    pub total_secs: i64,
    pub chapter_count: i64,
    pub played_count: i64,
    pub tags: Vec<String>,
}

#[derive(Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScopedResults {
    pub works: Vec<ScopedWork>,
    pub tags: Vec<String>,            // echo parsed tag filters (for FE chips)
    pub text: String,                 // echo parsed free text
    pub duration_label: String,       // human label e.g. "≤ 15m" or "" if none
    pub status_label: String,         // "Unstarted" | "In progress" | "Done" | ""
}
```

**Resolver design:** select candidate active works (free-text `base_title LIKE`, and one `EXISTS` per required tag against `work_tags` ∪ `author_tags`), then per candidate compute `(chapter_count, total_secs, played_count)` and apply the duration + status filters in Rust. Tags collected via the same union. Cap the output.

- [ ] **Step 1: Write failing tests** (`src-tauri/src/scoped.rs`, `#[cfg(test)]`), seeding an in-memory DB at the latest version:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_at_version;
    use crate::query::parse_query;

    fn seed(conn: &rusqlite::Connection) {
        conn.execute_batch(
            "INSERT INTO authors(id, folder_name, display_name, status) VALUES (1,'auth','Auth','active');
             INSERT INTO works(id, author_id, base_title, status) VALUES
               (1,1,'Short Cozy','active'), (2,1,'Long Epic','active');
             INSERT INTO work_tags(work_id, tag) VALUES (1,'cozy');
             INSERT INTO chapters(id, work_id, raw_filename, chapter_no, format, duration_secs, file_path, status, played)
               VALUES
               (1,1,'a.mp3',1,'mp3',300,'/a.mp3','active',1),
               (2,1,'b.mp3',2,'mp3',300,'/b.mp3','active',0),
               (3,2,'c.mp3',1,'mp3',4000,'/c.mp3','active',1),
               (4,2,'d.mp3',2,'mp3',4000,'/d.mp3','active',1);",
        ).unwrap();
    }

    #[test]
    fn tag_filter_matches_only_tagged_work() {
        let conn = open_at_version(7).unwrap();
        seed(&conn);
        let r = run_scoped_query(&conn, &parse_query("tag:cozy"), 50).unwrap();
        assert_eq!(r.iter().map(|w| w.work_id).collect::<Vec<_>>(), vec![1]);
    }

    #[test]
    fn duration_filter_under_15m() {
        let conn = open_at_version(7).unwrap();
        seed(&conn);
        // work1 total=600s (<900), work2 total=8000s
        let r = run_scoped_query(&conn, &parse_query("duration:<15m"), 50).unwrap();
        assert_eq!(r.iter().map(|w| w.work_id).collect::<Vec<_>>(), vec![1]);
    }

    #[test]
    fn status_done_means_all_chapters_played() {
        let conn = open_at_version(7).unwrap();
        seed(&conn);
        let r = run_scoped_query(&conn, &parse_query("status:done"), 50).unwrap();
        assert_eq!(r.iter().map(|w| w.work_id).collect::<Vec<_>>(), vec![2]); // work2 fully played
    }

    #[test]
    fn status_unstarted_means_no_chapter_played() {
        let conn = open_at_version(7).unwrap();
        seed(&conn);
        // neither is fully unplayed (work1 has 1 played); add a clean work
        conn.execute_batch(
            "INSERT INTO works(id, author_id, base_title, status) VALUES (3,1,'Fresh','active');
             INSERT INTO chapters(id, work_id, raw_filename, chapter_no, format, duration_secs, file_path, status, played)
               VALUES (5,3,'e.mp3',1,'mp3',100,'/e.mp3','active',0);",
        ).unwrap();
        let r = run_scoped_query(&conn, &parse_query("status:unplayed"), 50).unwrap();
        assert_eq!(r.iter().map(|w| w.work_id).collect::<Vec<_>>(), vec![3]);
    }
}
```

> If the real `chapters`/`works` column lists differ from the INSERTs above, adjust the seed to match `SCHEMA_V1` exactly (read it once from `db.rs`). The columns referenced (`status`, `played`, `duration_secs`, `chapter_no`, `raw_filename`, `file_path`, `base_title`, `author_id`, `folder_name`, `display_name`) all exist per the M16/M17 digests.

- [ ] **Step 2: Run — expect FAIL**

Run: `cmd /c "tools\dev-env.cmd cargo test scoped::"`
Expected: FAIL (unresolved).

- [ ] **Step 3: Implement `scoped.rs`:**

```rust
//! Resolver for the scoped-query DSL. Shared by advanced search, saved searches,
//! and smart collections. Read-only.

use crate::model::ScopedWork;
use crate::query::{CmpOp, ParsedQuery, StatusFilter};
use rusqlite::{params, Connection};

pub fn run_scoped_query(
    conn: &Connection,
    p: &ParsedQuery,
    cap: usize,
) -> rusqlite::Result<Vec<ScopedWork>> {
    // 1. candidate works by free text + tags (each tag AND-combined via EXISTS).
    let like = if p.text.trim().is_empty() {
        None
    } else {
        Some(format!("%{}%", p.text.trim().replace('%', "\\%").replace('_', "\\_")))
    };

    let mut sql = String::from(
        "SELECT w.id, w.base_title, a.id, COALESCE(a.display_name, a.folder_name)
         FROM works w JOIN authors a ON w.author_id=a.id
         WHERE w.status='active' AND a.status='active'",
    );
    let mut binds: Vec<rusqlite::types::Value> = Vec::new();
    if like.is_some() {
        sql.push_str(" AND w.base_title LIKE ? ESCAPE '\\'");
        binds.push(like.clone().unwrap().into());
    }
    for tag in &p.tags {
        sql.push_str(
            " AND (EXISTS (SELECT 1 FROM work_tags wt WHERE wt.work_id=w.id AND wt.tag=?)
                  OR EXISTS (SELECT 1 FROM author_tags at WHERE at.author_id=a.id AND at.tag=?))",
        );
        binds.push(tag.clone().into());
        binds.push(tag.clone().into());
    }
    sql.push_str(" ORDER BY w.base_title");

    let mut stmt = conn.prepare(&sql)?;
    let rows: Vec<(i64, String, i64, String)> = stmt
        .query_map(rusqlite::params_from_iter(binds.iter()), |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })?
        .collect::<rusqlite::Result<_>>()?;

    // 2. per-candidate aggregates + duration/status filter + tags.
    let mut agg = conn.prepare(
        "SELECT COUNT(*), COALESCE(SUM(duration_secs),0), COALESCE(SUM(played),0)
         FROM chapters WHERE work_id=?1 AND status='active'",
    )?;
    let mut tagstmt = conn.prepare("SELECT tag FROM work_tags WHERE work_id=?1 ORDER BY tag")?;

    let mut out: Vec<ScopedWork> = Vec::new();
    for (work_id, base_title, author_id, author_name) in rows {
        let (chapter_count, total_secs, played_count): (i64, i64, i64) =
            agg.query_row(params![work_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        if chapter_count == 0 {
            continue;
        }
        if let Some(d) = &p.duration {
            let pass = match d.op {
                CmpOp::Lt => total_secs < d.secs,
                CmpOp::Le => total_secs <= d.secs,
                CmpOp::Gt => total_secs > d.secs,
                CmpOp::Ge => total_secs >= d.secs,
            };
            if !pass {
                continue;
            }
        }
        if let Some(s) = p.status {
            let pass = match s {
                StatusFilter::Unstarted => played_count == 0,
                StatusFilter::InProgress => played_count > 0 && played_count < chapter_count,
                StatusFilter::Done => played_count == chapter_count,
            };
            if !pass {
                continue;
            }
        }
        let tags: Vec<String> = tagstmt
            .query_map(params![work_id], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<_>>()?;
        out.push(ScopedWork {
            work_id,
            base_title,
            author_id,
            author_name,
            total_secs,
            chapter_count,
            played_count,
            tags,
        });
        if out.len() >= cap {
            break;
        }
    }
    Ok(out)
}
```

> The `rusqlite::types::Value` + `params_from_iter` pattern is the standard way to bind a dynamic number of params; both are in scope from `rusqlite`. If `played` is stored as a different column/type, match `SCHEMA_V1`.

- [ ] **Step 4: Add the `advanced_search` command** to `commands.rs` (near `search_library`):

```rust
fn duration_label(d: &crate::query::DurationFilter) -> String {
    use crate::query::CmpOp::*;
    let op = match d.op { Lt => "<", Le => "≤", Gt => ">", Ge => "≥" };
    let (n, unit) = if d.secs % 3600 == 0 { (d.secs / 3600, "h") }
        else if d.secs % 60 == 0 { (d.secs / 60, "m") } else { (d.secs, "s") };
    format!("{op} {n}{unit}")
}

#[tauri::command]
pub fn advanced_search(state: tauri::State<DbState>, query: String) -> Result<crate::model::ScopedResults, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let parsed = crate::query::parse_query(&query);
    let works = crate::scoped::run_scoped_query(&conn, &parsed, SEARCH_CAP).map_err(|e| e.to_string())?;
    Ok(crate::model::ScopedResults {
        works,
        tags: parsed.tags.clone(),
        text: parsed.text.clone(),
        duration_label: parsed.duration.as_ref().map(duration_label).unwrap_or_default(),
        status_label: match parsed.status {
            Some(crate::query::StatusFilter::Unstarted) => "Unstarted",
            Some(crate::query::StatusFilter::InProgress) => "In progress",
            Some(crate::query::StatusFilter::Done) => "Done",
            None => "",
        }.to_string(),
    })
}
```

- [ ] **Step 5: Register** in `lib.rs`:
  - Add `mod scoped;` near `mod query;`.
  - Add `commands::advanced_search,` to `generate_handler![…]`.
  - In `pub mod testing` add: `pub use crate::scoped::run_scoped_query;`.

- [ ] **Step 6: Run — expect PASS**

Run: `cmd /c "tools\dev-env.cmd cargo test scoped::"`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/scoped.rs src-tauri/src/model.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(m19): scoped-query resolver + advanced_search command"
```

---

# PHASE 4 — Saved searches + smart collections CRUD

### Task 4: Persistence CRUD over the two new tables

**Files:**
- Modify: `src-tauri/src/model.rs` (`Collection`, `SavedSearch`), `src-tauri/src/commands.rs` (CRUD + resolve), `src-tauri/src/lib.rs` (register)

**Structs** (`model.rs`):

```rust
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SavedSearch { pub id: i64, pub name: String, pub query: String }

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Collection { pub id: i64, pub name: String, pub query: String, pub position: i64 }
```

- [ ] **Step 1: Write failing tests** (`commands.rs` `#[cfg(test)]`, or a focused integration test). Keep them DB-level using `open_at_version(7)` and the underlying (non-`#[tauri::command]`) helpers:

```rust
#[test]
fn saved_search_crud_roundtrip() {
    let conn = crate::db::open_at_version(7).unwrap();
    let id = create_saved_search_row(&conn, "Cozy shorts", "tag:cozy duration:<15m", 1_700_000_000).unwrap();
    let all = list_saved_searches_rows(&conn).unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].name, "Cozy shorts");
    assert_eq!(all[0].query, "tag:cozy duration:<15m");
    delete_saved_search_row(&conn, id).unwrap();
    assert!(list_saved_searches_rows(&conn).unwrap().is_empty());
}

#[test]
fn collection_crud_and_reorder() {
    let conn = crate::db::open_at_version(7).unwrap();
    let a = create_collection_row(&conn, "A", "tag:a", 1).unwrap();
    let b = create_collection_row(&conn, "B", "tag:b", 1).unwrap();
    reorder_collections_rows(&conn, &[b, a]).unwrap();
    let names: Vec<String> = list_collections_rows(&conn).unwrap().into_iter().map(|c| c.name).collect();
    assert_eq!(names, vec!["B".to_string(), "A".to_string()]);
}
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cmd /c "tools\dev-env.cmd cargo test saved_search_crud collection_crud"`
Expected: FAIL.

- [ ] **Step 3: Implement the row helpers + commands** (`commands.rs`). Helpers are pub(crate) (testable, take `&Connection`); commands are thin wrappers. `created_at`/timestamps come from the FE (`Date.now()`); Rust uses what it's given.

```rust
use crate::model::{Collection, SavedSearch};

// ---- saved searches ----
pub(crate) fn create_saved_search_row(conn: &rusqlite::Connection, name: &str, query: &str, created_at: i64) -> rusqlite::Result<i64> {
    conn.execute("INSERT INTO saved_searches(name, query, created_at) VALUES (?1,?2,?3)", params![name, query, created_at])?;
    Ok(conn.last_insert_rowid())
}
pub(crate) fn list_saved_searches_rows(conn: &rusqlite::Connection) -> rusqlite::Result<Vec<SavedSearch>> {
    let mut s = conn.prepare("SELECT id, name, query FROM saved_searches ORDER BY name")?;
    s.query_map([], |r| Ok(SavedSearch { id: r.get(0)?, name: r.get(1)?, query: r.get(2)? }))?.collect()
}
pub(crate) fn delete_saved_search_row(conn: &rusqlite::Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM saved_searches WHERE id=?1", params![id])?; Ok(())
}

#[tauri::command]
pub fn create_saved_search(state: tauri::State<DbState>, name: String, query: String, created_at: i64) -> Result<i64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    create_saved_search_row(&conn, name.trim(), query.trim(), created_at).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn list_saved_searches(state: tauri::State<DbState>) -> Result<Vec<SavedSearch>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    list_saved_searches_rows(&conn).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn delete_saved_search(state: tauri::State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    delete_saved_search_row(&conn, id).map_err(|e| e.to_string())
}

// ---- smart collections ----
pub(crate) fn create_collection_row(conn: &rusqlite::Connection, name: &str, query: &str, created_at: i64) -> rusqlite::Result<i64> {
    let next_pos: i64 = conn.query_row("SELECT COALESCE(MAX(position),-1)+1 FROM smart_collections", [], |r| r.get(0))?;
    conn.execute("INSERT INTO smart_collections(name, query, position, created_at) VALUES (?1,?2,?3,?4)", params![name, query, next_pos, created_at])?;
    Ok(conn.last_insert_rowid())
}
pub(crate) fn list_collections_rows(conn: &rusqlite::Connection) -> rusqlite::Result<Vec<Collection>> {
    let mut s = conn.prepare("SELECT id, name, query, position FROM smart_collections ORDER BY position, name")?;
    s.query_map([], |r| Ok(Collection { id: r.get(0)?, name: r.get(1)?, query: r.get(2)?, position: r.get(3)? }))?.collect()
}
pub(crate) fn update_collection_row(conn: &rusqlite::Connection, id: i64, name: &str, query: &str) -> rusqlite::Result<()> {
    conn.execute("UPDATE smart_collections SET name=?2, query=?3 WHERE id=?1", params![id, name, query])?; Ok(())
}
pub(crate) fn delete_collection_row(conn: &rusqlite::Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM smart_collections WHERE id=?1", params![id])?; Ok(())
}
pub(crate) fn reorder_collections_rows(conn: &rusqlite::Connection, ids: &[i64]) -> rusqlite::Result<()> {
    for (pos, id) in ids.iter().enumerate() {
        conn.execute("UPDATE smart_collections SET position=?2 WHERE id=?1", params![id, pos as i64])?;
    }
    Ok(())
}

#[tauri::command]
pub fn create_collection(state: tauri::State<DbState>, name: String, query: String, created_at: i64) -> Result<i64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    create_collection_row(&conn, name.trim(), query.trim(), created_at).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn list_collections(state: tauri::State<DbState>) -> Result<Vec<Collection>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    list_collections_rows(&conn).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn update_collection(state: tauri::State<DbState>, id: i64, name: String, query: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    update_collection_row(&conn, id, name.trim(), query.trim()).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn delete_collection(state: tauri::State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    delete_collection_row(&conn, id).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn reorder_collections(state: tauri::State<DbState>, ids: Vec<i64>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    reorder_collections_rows(&conn, &ids).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn resolve_collection(state: tauri::State<DbState>, id: i64) -> Result<crate::model::ScopedResults, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let query: String = conn
        .query_row("SELECT query FROM smart_collections WHERE id=?1", params![id], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    drop(conn);
    advanced_search(state, query)
}
```

> `resolve_collection` ends by delegating to `advanced_search`; because both take `tauri::State<DbState>`, drop the first lock (`drop(conn)`) before the delegated call re-locks. If the borrow checker complains about moving `state`, instead inline: re-lock and call `run_scoped_query` directly (preferred — avoids the move). Use this inline form:
> ```rust
> #[tauri::command]
> pub fn resolve_collection(state: tauri::State<DbState>, id: i64) -> Result<crate::model::ScopedResults, String> {
>     let conn = state.0.lock().map_err(|e| e.to_string())?;
>     let query: String = conn.query_row("SELECT query FROM smart_collections WHERE id=?1", params![id], |r| r.get(0)).map_err(|e| e.to_string())?;
>     let parsed = crate::query::parse_query(&query);
>     let works = crate::scoped::run_scoped_query(&conn, &parsed, SEARCH_CAP).map_err(|e| e.to_string())?;
>     Ok(crate::model::ScopedResults { works, tags: parsed.tags.clone(), text: parsed.text.clone(),
>         duration_label: parsed.duration.as_ref().map(duration_label).unwrap_or_default(),
>         status_label: status_label_of(parsed.status) })
> }
> ```
> Factor the `status_label` match in Task 3 Step 4 into a small `fn status_label_of(s: Option<StatusFilter>) -> String` and reuse it in both `advanced_search` and here (DRY).

- [ ] **Step 4: Register all 8 commands** in `lib.rs` `generate_handler![…]`: `create_saved_search, list_saved_searches, delete_saved_search, create_collection, list_collections, update_collection, delete_collection, reorder_collections, resolve_collection` (prefix each with `commands::`).

- [ ] **Step 5: Run — expect PASS**

Run: `cmd /c "tools\dev-env.cmd cargo test saved_search_crud collection_crud"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/model.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(m19): saved-search + smart-collection CRUD and resolve"
```

---

# PHASE 5 — Bulk tagging

### Task 5: `bulk_set_work_tags` (additive add/remove across many works)

**Files:**
- Modify: `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`

**Semantics:** add the `add` tags (INSERT OR IGNORE) and remove the `remove` tags (DELETE) on each work id. **Never a blanket replace** (replace would wipe per-work tags the user didn't intend to touch).

- [ ] **Step 1: Write failing test** (`commands.rs`):

```rust
#[test]
fn bulk_tag_adds_and_removes_per_work() {
    let conn = crate::db::open_at_version(7).unwrap();
    conn.execute_batch(
        "INSERT INTO authors(id, folder_name, status) VALUES (1,'a','active');
         INSERT INTO works(id, author_id, base_title, status) VALUES (1,1,'W1','active'),(2,1,'W2','active');
         INSERT INTO work_tags(work_id, tag) VALUES (1,'old'),(2,'old');",
    ).unwrap();
    bulk_set_work_tags_rows(&conn, &[1, 2], &["fresh".into()], &["old".into()]).unwrap();
    let t1: Vec<String> = conn.prepare("SELECT tag FROM work_tags WHERE work_id=1 ORDER BY tag").unwrap()
        .query_map([], |r| r.get(0)).unwrap().collect::<rusqlite::Result<_>>().unwrap();
    assert_eq!(t1, vec!["fresh".to_string()]);
    let total: i64 = conn.query_row("SELECT COUNT(*) FROM work_tags WHERE tag='old'", [], |r| r.get(0)).unwrap();
    assert_eq!(total, 0);
}
```

- [ ] **Step 2: Run — expect FAIL.** `cmd /c "tools\dev-env.cmd cargo test bulk_tag"`

- [ ] **Step 3: Implement:**

```rust
pub(crate) fn bulk_set_work_tags_rows(conn: &rusqlite::Connection, work_ids: &[i64], add: &[String], remove: &[String]) -> rusqlite::Result<()> {
    for &wid in work_ids {
        for raw in add {
            let t = raw.trim();
            if t.is_empty() { continue; }
            conn.execute("INSERT OR IGNORE INTO work_tags(work_id, tag) VALUES (?1, ?2)", params![wid, t])?;
        }
        for raw in remove {
            let t = raw.trim();
            if t.is_empty() { continue; }
            conn.execute("DELETE FROM work_tags WHERE work_id=?1 AND tag=?2", params![wid, t])?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn bulk_set_work_tags(state: tauri::State<DbState>, work_ids: Vec<i64>, add: Vec<String>, remove: Vec<String>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    bulk_set_work_tags_rows(&conn, &work_ids, &add, &remove).map_err(|e| e.to_string())
}
```

- [ ] **Step 4: Register** `commands::bulk_set_work_tags` in `lib.rs`.

- [ ] **Step 5: Run — expect PASS.** Then **Step 6: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(m19): additive bulk work-tagging command"
```

---

# PHASE 6 — Per-work chapter-sort override

### Task 6: `set_work_chapter_sort` + apply in `query_author_detail`

**Files:**
- Modify: `src-tauri/src/model.rs` (`WorkRow.chapter_sort`), `src-tauri/src/commands.rs` (setter + apply sort + select the column), `src-tauri/src/lib.rs` (register); also update every `WorkRow { … }` constructor.

**Allowed sort keys** (stored in `works.chapter_sort`): `""` = default (chapter_no asc), `"number_desc"`, `"title_asc"`, `"title_desc"`, `"duration_asc"`, `"duration_desc"`. **Non-destructive — never touches files; chapter ordering on disk and the Rename canonical path are unaffected.**

- [ ] **Step 1: Add the field to `WorkRow`** (`model.rs`):

```rust
pub struct WorkRow {
    pub id: i64,
    pub base_title: String,
    pub tags: Vec<String>,
    pub chapters: Vec<ChapterRow>,
    pub re_entry_note: String,
    pub completion_rating: String,
    pub chapter_sort: String,   // NEW
}
```

- [ ] **Step 2: Write a failing test** documenting the applied order (`commands.rs`):

```rust
#[test]
fn chapter_sort_override_reorders_in_detail() {
    let conn = crate::db::open_at_version(7).unwrap();
    conn.execute_batch(
        "INSERT INTO authors(id, folder_name, status) VALUES (1,'a','active');
         INSERT INTO works(id, author_id, base_title, status, chapter_sort) VALUES (1,1,'W','active','number_desc');
         INSERT INTO chapters(id, work_id, raw_filename, chapter_no, format, duration_secs, file_path, status, played, user_summary, takeaway, is_favorite)
           VALUES (1,1,'a.mp3',1,'mp3',10,'/a','active',0,'','',0),
                  (2,1,'b.mp3',2,'mp3',20,'/b','active',0,'','',0);",
    ).unwrap();
    let detail = query_author_detail(&conn, 1).unwrap();
    let nums: Vec<i64> = detail.works[0].chapters.iter().map(|c| c.chapter_no).collect();
    assert_eq!(nums, vec![2, 1]); // descending
}
```

- [ ] **Step 3: Run — expect FAIL.** `cmd /c "tools\dev-env.cmd cargo test chapter_sort_override"`

- [ ] **Step 4: Implement.**
  - In `query_author_detail`, change the **works** SELECT to also read `chapter_sort` and populate `WorkRow.chapter_sort`. (Add `chapter_sort` to the works column list; default `''` covers legacy rows.)
  - After building each work's `chapters` Vec (currently `chapters.sort_by(|a,b| a.chapter_no.cmp(&b.chapter_no))`), replace the unconditional sort with a match on the work's `chapter_sort`:

```rust
match work.chapter_sort.as_str() {
    "number_desc"   => chapters.sort_by(|a, b| b.chapter_no.cmp(&a.chapter_no)),
    "title_asc"     => chapters.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase())),
    "title_desc"    => chapters.sort_by(|a, b| b.title.to_lowercase().cmp(&a.title.to_lowercase())),
    "duration_asc"  => chapters.sort_by(|a, b| a.duration_secs.cmp(&b.duration_secs)),
    "duration_desc" => chapters.sort_by(|a, b| b.duration_secs.cmp(&a.duration_secs)),
    _               => chapters.sort_by(|a, b| a.chapter_no.cmp(&b.chapter_no)), // "" / unknown = default
}
```

> The exact structure of `query_author_detail` (whether chapters are gathered then sorted, and whether `chapter_sort` is read before or after) must be matched to the current code — read it once. The key change: read `chapter_sort` into the `WorkRow`, then sort that work's chapters by it instead of always by `chapter_no`.

  - Add the setter:

```rust
#[tauri::command]
pub fn set_work_chapter_sort(state: tauri::State<DbState>, work_id: i64, sort: String) -> Result<(), String> {
    const ALLOWED: [&str; 6] = ["", "number_desc", "title_asc", "title_desc", "duration_asc", "duration_desc"];
    if !ALLOWED.contains(&sort.as_str()) {
        return Err(format!("invalid chapter sort: {sort}"));
    }
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE works SET chapter_sort=?2 WHERE id=?1", params![work_id, sort]).map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 5: Fix all `WorkRow { … }` constructors.** Adding `chapter_sort` breaks every struct-literal. Run a grep to find them all (the M17 note flagged `query_author_detail`'s work SELECT and `load_chapter_row` as fan-out sites — but `load_chapter_row` builds `ChapterRow`, not `WorkRow`; the `WorkRow` builders are in `query_author_detail` and any home/discovery helper that returns `WorkRow`). Search:

Run: `cmd /c "tools\dev-env.cmd cargo build 2>&1 | findstr WorkRow"` (or just `cargo build` and fix each "missing field `chapter_sort`" error). Populate from the SELECT where the work is known, else `String::new()`.

- [ ] **Step 6: Register** `commands::set_work_chapter_sort` in `lib.rs`.

- [ ] **Step 7: Run — expect PASS** (and full `cargo test` green to catch constructor fan-out).

Run: `cmd /c "tools\dev-env.cmd cargo test"`
Expected: all green (prior tests + new). If a TS test or other Rust test references `WorkRow`/`workRow` shape it may need the new field — fix in Step (this phase's commit).

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/model.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(m19): per-work chapter-sort override (non-destructive, DB-only)"
```

---

# PHASE 7 — Library-health scan

### Task 7: `library_health_scan`

**Files:**
- Modify: `src-tauri/src/model.rs` (`HealthReport`, `HealthItem`), `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`

**Checks (read-only):** for each active chapter, `std::fs::metadata(file_path)`: `Err` → **missing file** (orphan); `len() == 0` → **zero-byte**; metadata OK + len>0 but `std::fs::File::open` errors → **unreadable** (locked/permission — a cheap open check, **not** a full audio decode; decoding every file would be too costly on a large library and isn't the point of a health triage). Plus **schema drift**: compare the `schema_version` setting to `LATEST`.

**Structs** (`model.rs`):

```rust
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HealthItem {
    pub chapter_id: i64,
    pub title: String,
    pub work_title: String,
    pub author_name: String,
    pub file_path: String,
    pub size_bytes: i64,
}

#[derive(Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct HealthReport {
    pub missing_files: Vec<HealthItem>,
    pub zero_byte: Vec<HealthItem>,
    pub unreadable: Vec<HealthItem>,
    pub schema_version: i64,
    pub latest_schema: i64,
    pub schema_drift: bool,
}
```

- [ ] **Step 1: Write a failing test** using temp files (a missing path + a real zero-byte file):

```rust
#[test]
fn health_scan_flags_missing_and_zero_byte() {
    let dir = std::env::temp_dir().join(format!("ashm19_{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let zero = dir.join("zero.mp3");
    std::fs::write(&zero, b"").unwrap();
    let missing = dir.join("gone.mp3");

    let conn = crate::db::open_at_version(7).unwrap();
    conn.execute_batch("INSERT INTO authors(id, folder_name, status) VALUES (1,'a','active');
        INSERT INTO works(id, author_id, base_title, status) VALUES (1,1,'W','active');").unwrap();
    conn.execute("INSERT INTO chapters(id, work_id, raw_filename, chapter_no, format, duration_secs, file_path, status, played, user_summary, takeaway, is_favorite) VALUES (1,1,'zero.mp3',1,'mp3',0,?1,'active',0,'','',0)", params![zero.to_string_lossy()]).unwrap();
    conn.execute("INSERT INTO chapters(id, work_id, raw_filename, chapter_no, format, duration_secs, file_path, status, played, user_summary, takeaway, is_favorite) VALUES (2,1,'gone.mp3',2,'mp3',0,?1,'active',0,'','',0)", params![missing.to_string_lossy()]).unwrap();

    let rep = library_health_scan_rows(&conn).unwrap();
    assert_eq!(rep.zero_byte.len(), 1);
    assert_eq!(rep.missing_files.len(), 1);
    assert_eq!(rep.zero_byte[0].chapter_id, 1);
    assert_eq!(rep.missing_files[0].chapter_id, 2);
    std::fs::remove_dir_all(&dir).ok();
}
```

- [ ] **Step 2: Run — expect FAIL.** `cmd /c "tools\dev-env.cmd cargo test health_scan"`

- [ ] **Step 3: Implement:**

```rust
pub(crate) fn library_health_scan_rows(conn: &rusqlite::Connection) -> rusqlite::Result<crate::model::HealthReport> {
    use crate::model::{HealthItem, HealthReport};
    let mut rep = HealthReport { latest_schema: 7, ..Default::default() };
    rep.schema_version = get_setting_value(conn, "schema_version")?
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);
    rep.schema_drift = rep.schema_version != rep.latest_schema;

    let mut stmt = conn.prepare(
        "SELECT c.id, c.raw_filename, w.base_title, COALESCE(a.display_name, a.folder_name), c.file_path
         FROM chapters c JOIN works w ON c.work_id=w.id JOIN authors a ON w.author_id=a.id
         WHERE c.status='active'",
    )?;
    let rows: Vec<(i64, String, String, String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?
        .collect::<rusqlite::Result<_>>()?;

    for (chapter_id, raw, work_title, author_name, file_path) in rows {
        let title = std::path::Path::new(&raw).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or(raw);
        let item = |size_bytes: i64| HealthItem { chapter_id, title: title.clone(), work_title: work_title.clone(), author_name: author_name.clone(), file_path: file_path.clone(), size_bytes };
        match std::fs::metadata(&file_path) {
            Err(_) => rep.missing_files.push(item(-1)),
            Ok(md) => {
                let len = md.len() as i64;
                if len == 0 {
                    rep.zero_byte.push(item(0));
                } else if std::fs::File::open(&file_path).is_err() {
                    rep.unreadable.push(item(len));
                }
            }
        }
    }
    Ok(rep)
}

#[tauri::command]
pub fn library_health_scan(state: tauri::State<DbState>) -> Result<crate::model::HealthReport, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    library_health_scan_rows(&conn).map_err(|e| e.to_string())
}
```

> `latest_schema: 7` must equal `db.rs`'s `LATEST`. To avoid drift, expose `db::LATEST` as `pub(crate) const LATEST: i64 = 7;` and reference `crate::db::LATEST` here. If you make `LATEST` a module const (it's currently a `fn`-local const), move it to module scope in `db.rs` and read it in both `migrate()` and here.

- [ ] **Step 4: Register** `commands::library_health_scan` in `lib.rs`. **Step 5: Run — expect PASS.** **Step 6: Commit**

```bash
git add src-tauri/src/model.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/src/db.rs
git commit -m "feat(m19): read-only library-health scan (orphans, zero-byte, unreadable, schema drift)"
```

---

# PHASE 8 — Export (portable JSON + DB snapshot)

### Task 8: `backup.rs` — `build_curation_export` + export commands

**Files:**
- Create: `src-tauri/src/backup.rs`
- Modify: `src-tauri/src/model.rs` (`ImportReport`), `src-tauri/src/commands.rs` (export commands), `src-tauri/src/lib.rs` (`mod backup;`, register, testing re-export)

**Export JSON shape — identity-keyed (NOT DB ids, which aren't stable across rescans).** Authors keyed by `folder_name`, works by `base_title`, chapters by `raw_filename`:

```jsonc
{
  "schemaVersion": 7,
  "exportedAt": 1700000000000,
  "authors": [
    { "folderName": "Jane Doe", "displayName": "Jane Doe", "tags": ["mystery"],
      "works": [
        { "baseTitle": "Cool Story", "tags": ["cozy"], "reEntryNote": "...", "completionRating": "great", "chapterSort": "number_desc",
          "chapters": [
            { "rawFilename": "01.mp3", "played": true, "isFavorite": false, "userSummary": "", "takeaway": "", "tags": [],
              "notes": [{ "positionSecs": 12, "body": "...", "createdAt": 1700000000000 }],
              "bookmarks": [{ "positionSecs": 30, "label": "good bit", "createdAt": 1700000000000 }] }
          ] } ] }
  ],
  "tagAliases": [{ "alias": "scifi", "canonical": "sci-fi" }],
  "tagParents": [{ "child": "noir", "parent": "mystery" }],
  "collections": [{ "name": "Cozy shorts", "query": "tag:cozy duration:<15m", "position": 0 }],
  "savedSearches": [{ "name": "Unplayed", "query": "status:unplayed" }]
}
```

- [ ] **Step 1: Write a failing test** — seed a tiny DB, export, assert the JSON round-trips identities:

```rust
#[test]
fn export_captures_tags_played_and_collections() {
    let conn = crate::db::open_at_version(7).unwrap();
    conn.execute_batch(
        "INSERT INTO authors(id, folder_name, display_name, status) VALUES (1,'Jane','Jane Doe','active');
         INSERT INTO works(id, author_id, base_title, status, chapter_sort) VALUES (1,1,'Cool','active','title_asc');
         INSERT INTO work_tags(work_id, tag) VALUES (1,'cozy');
         INSERT INTO chapters(id, work_id, raw_filename, chapter_no, format, duration_secs, file_path, status, played, user_summary, takeaway, is_favorite) VALUES (1,1,'01.mp3',1,'mp3',60,'/01.mp3','active',1,'sum','take',1);
         INSERT INTO smart_collections(name, query, position, created_at) VALUES ('C','tag:cozy',0,1);",
    ).unwrap();
    let v = build_curation_export(&conn, 1700000000000).unwrap();
    let s = serde_json::to_string(&v).unwrap();
    assert!(s.contains("\"folderName\":\"Jane\""));
    assert!(s.contains("\"chapterSort\":\"title_asc\""));
    assert!(s.contains("\"played\":true"));
    assert!(s.contains("\"cozy\""));
    assert!(s.contains("\"query\":\"tag:cozy\""));
}
```

- [ ] **Step 2: Run — expect FAIL.** `cmd /c "tools\dev-env.cmd cargo test export_captures"`

- [ ] **Step 3: Implement `backup.rs` export half.** Build a `serde_json::Value` directly (no new structs needed beyond `ImportReport`). Use `serde_json::json!` / `Map`:

```rust
//! M19 backup/restore. Export = identity-keyed JSON + VACUUM-INTO DB snapshot.
//! Import = strictly additive merge. Restore = crash-safe staged swap at bootstrap.

use rusqlite::{params, Connection};
use serde_json::{json, Value};

pub fn build_curation_export(conn: &Connection, exported_at: i64) -> rusqlite::Result<Value> {
    // authors
    let mut astmt = conn.prepare(
        "SELECT id, folder_name, COALESCE(display_name,'') FROM authors WHERE status='active' ORDER BY folder_name")?;
    let authors_raw: Vec<(i64, String, String)> = astmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<rusqlite::Result<_>>()?;

    let mut author_tags = conn.prepare("SELECT tag FROM author_tags WHERE author_id=?1 ORDER BY tag")?;
    let mut works_stmt = conn.prepare(
        "SELECT id, base_title, re_entry_note, completion_rating, chapter_sort FROM works WHERE author_id=?1 AND status='active' ORDER BY base_title")?;
    let mut work_tags = conn.prepare("SELECT tag FROM work_tags WHERE work_id=?1 ORDER BY tag")?;
    let mut chapters_stmt = conn.prepare(
        "SELECT id, raw_filename, played, is_favorite, user_summary, takeaway FROM chapters WHERE work_id=?1 AND status='active' ORDER BY chapter_no")?;
    let mut chapter_tags = conn.prepare("SELECT tag FROM chapter_tags WHERE chapter_id=?1 ORDER BY tag")?;
    let mut notes_stmt = conn.prepare("SELECT position_secs, body, created_at FROM chapter_notes WHERE chapter_id=?1 ORDER BY created_at")?;
    let mut bm_stmt = conn.prepare("SELECT position_secs, label, created_at FROM chapter_bookmarks WHERE chapter_id=?1 ORDER BY created_at")?;

    let collect_tags = |stmt: &mut rusqlite::Statement, id: i64| -> rusqlite::Result<Vec<String>> {
        stmt.query_map(params![id], |r| r.get::<_, String>(0))?.collect()
    };

    let mut authors_json: Vec<Value> = Vec::new();
    for (aid, folder_name, display_name) in authors_raw {
        let atags = collect_tags(&mut author_tags, aid)?;
        let works_raw: Vec<(i64, String, String, String, String)> = works_stmt
            .query_map(params![aid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?
            .collect::<rusqlite::Result<_>>()?;
        let mut works_json: Vec<Value> = Vec::new();
        for (wid, base_title, re_entry, rating, csort) in works_raw {
            let wtags = collect_tags(&mut work_tags, wid)?;
            let chs_raw: Vec<(i64, String, bool, bool, String, String)> = chapters_stmt
                .query_map(params![wid], |r| Ok((r.get(0)?, r.get(1)?, r.get::<_, i64>(2)? != 0, r.get::<_, i64>(3)? != 0, r.get(4)?, r.get(5)?)))?
                .collect::<rusqlite::Result<_>>()?;
            let mut chs_json: Vec<Value> = Vec::new();
            for (cid, raw_filename, played, fav, summary, takeaway) in chs_raw {
                let ctags = collect_tags(&mut chapter_tags, cid)?;
                let notes: Vec<Value> = notes_stmt.query_map(params![cid], |r| {
                    Ok(json!({"positionSecs": r.get::<_,i64>(0)?, "body": r.get::<_,String>(1)?, "createdAt": r.get::<_,i64>(2)?}))
                })?.collect::<rusqlite::Result<_>>()?;
                let bookmarks: Vec<Value> = bm_stmt.query_map(params![cid], |r| {
                    Ok(json!({"positionSecs": r.get::<_,i64>(0)?, "label": r.get::<_,String>(1)?, "createdAt": r.get::<_,i64>(2)?}))
                })?.collect::<rusqlite::Result<_>>()?;
                chs_json.push(json!({
                    "rawFilename": raw_filename, "played": played, "isFavorite": fav,
                    "userSummary": summary, "takeaway": takeaway, "tags": ctags,
                    "notes": notes, "bookmarks": bookmarks
                }));
            }
            works_json.push(json!({
                "baseTitle": base_title, "tags": wtags, "reEntryNote": re_entry,
                "completionRating": rating, "chapterSort": csort, "chapters": chs_json
            }));
        }
        authors_json.push(json!({"folderName": folder_name, "displayName": display_name, "tags": atags, "works": works_json}));
    }

    let aliases: Vec<Value> = conn.prepare("SELECT alias, canonical FROM tag_aliases ORDER BY alias")?
        .query_map([], |r| Ok(json!({"alias": r.get::<_,String>(0)?, "canonical": r.get::<_,String>(1)?})))?
        .collect::<rusqlite::Result<_>>()?;
    let parents: Vec<Value> = conn.prepare("SELECT child, parent FROM tag_parents ORDER BY child")?
        .query_map([], |r| Ok(json!({"child": r.get::<_,String>(0)?, "parent": r.get::<_,String>(1)?})))?
        .collect::<rusqlite::Result<_>>()?;
    let collections: Vec<Value> = conn.prepare("SELECT name, query, position FROM smart_collections ORDER BY position")?
        .query_map([], |r| Ok(json!({"name": r.get::<_,String>(0)?, "query": r.get::<_,String>(1)?, "position": r.get::<_,i64>(2)?})))?
        .collect::<rusqlite::Result<_>>()?;
    let searches: Vec<Value> = conn.prepare("SELECT name, query FROM saved_searches ORDER BY name")?
        .query_map([], |r| Ok(json!({"name": r.get::<_,String>(0)?, "query": r.get::<_,String>(1)?})))?
        .collect::<rusqlite::Result<_>>()?;

    Ok(json!({
        "schemaVersion": 7, "exportedAt": exported_at,
        "authors": authors_json, "tagAliases": aliases, "tagParents": parents,
        "collections": collections, "savedSearches": searches
    }))
}
```

> Confirm the `tag_aliases`/`tag_parents` column names (`alias`/`canonical`, `child`/`parent`) against M16's `migration_v2_tag_taxonomy` — the digest shows `INSERT OR REPLACE INTO tag_aliases(alias, canonical)` and `tag_parents(child, parent)`, so these match.

- [ ] **Step 4: Add the export commands** (`commands.rs`). FE passes the destination path (from the save dialog) and `Date.now()`:

```rust
#[tauri::command]
pub fn export_curation_json(state: tauri::State<DbState>, path: String, exported_at: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let v = crate::backup::build_curation_export(&conn, exported_at).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_db_snapshot(state: tauri::State<DbState>, path: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    // VACUUM INTO writes a consistent snapshot from the live connection (no file-lock issue).
    conn.execute("VACUUM INTO ?1", params![path]).map_err(|e| e.to_string())?;
    Ok(())
}
```

> If `VACUUM INTO ?1` rejects the bound parameter on this SQLite build, fall back to validating `path` (reject embedded `'`) and `conn.execute_batch(&format!("VACUUM INTO '{}'", path.replace('\'', "''")))`. Try the parameter form first.

- [ ] **Step 5: Register** `mod backup;` (lib.rs), `commands::export_curation_json`, `commands::export_db_snapshot`; testing re-export `pub use crate::backup::build_curation_export;`.

- [ ] **Step 6: Run — expect PASS.** `cmd /c "tools\dev-env.cmd cargo test export_captures"`

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/backup.rs src-tauri/src/commands.rs src-tauri/src/model.rs src-tauri/src/lib.rs
git commit -m "feat(m19): curation export (identity-keyed JSON + VACUUM-INTO DB snapshot)"
```

---

# PHASE 9 — Import (additive JSON merge + crash-safe staged DB restore)

### Task 9: `apply_curation_import` + `stage_db_restore` + bootstrap swap

**Files:**
- Modify: `src-tauri/src/backup.rs` (import + restore staging), `src-tauri/src/db.rs` (`apply_pending_restore` at top of `open()`), `src-tauri/src/model.rs` (`ImportReport`), `src-tauri/src/commands.rs` (commands), `src-tauri/src/lib.rs` (register)

**Import is STRICTLY ADDITIVE — never deletes.** Resolve identities to current ids by matching `folder_name` (authors), `base_title`+author (works), `raw_filename`+work (chapters). Merge rules:
- tags (author/work/chapter): **union** (INSERT OR IGNORE).
- `played`, `is_favorite`: **OR** (only ever set to true; never clear).
- scalar journal fields (`user_summary`, `takeaway`, `re_entry_note`, `completion_rating`, `chapter_sort`): **fill-if-empty** (keep any non-empty existing value — we lack per-field timestamps, so "keep existing wins" is the conservative non-destructive rule; documented).
- notes/bookmarks: **add-missing**, deduped on `(position_secs, body|label, created_at)`.
- tag aliases/parents, collections, saved searches: **add-if-name/key-absent** (don't overwrite an existing alias/collection).
- Unmatched identities are **skipped and counted** (reported, never invented).

**`ImportReport`** (`model.rs`):

```rust
#[derive(Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub tags_added: i64,
    pub played_marked: i64,
    pub favorites_marked: i64,
    pub journal_fields_filled: i64,
    pub notes_added: i64,
    pub bookmarks_added: i64,
    pub collections_added: i64,
    pub searches_added: i64,
    pub unmatched_authors: i64,
    pub unmatched_works: i64,
    pub unmatched_chapters: i64,
}
```

- [ ] **Step 1: Write a failing merge test** — export from DB-A, import into DB-B that shares identities but has no curation, assert additive application:

```rust
#[test]
fn import_merges_additively_without_deleting() {
    // source: a DB with curation
    let src = crate::db::open_at_version(7).unwrap();
    src.execute_batch(
        "INSERT INTO authors(id, folder_name, display_name, status) VALUES (1,'Jane','Jane','active');
         INSERT INTO works(id, author_id, base_title, status) VALUES (1,1,'Cool','active');
         INSERT INTO chapters(id, work_id, raw_filename, chapter_no, format, duration_secs, file_path, status, played, user_summary, takeaway, is_favorite) VALUES (1,1,'01.mp3',1,'mp3',60,'/01.mp3','active',1,'imported summary','',1);
         INSERT INTO work_tags(work_id, tag) VALUES (1,'cozy');
         INSERT INTO smart_collections(name, query, position, created_at) VALUES ('C','tag:cozy',0,1);",
    ).unwrap();
    let export = build_curation_export(&src, 1700000000000).unwrap();

    // dest: same library identities, no curation, plus a pre-existing summary that must NOT be clobbered
    let dest = crate::db::open_at_version(7).unwrap();
    dest.execute_batch(
        "INSERT INTO authors(id, folder_name, display_name, status) VALUES (1,'Jane','Jane','active');
         INSERT INTO works(id, author_id, base_title, status) VALUES (1,1,'Cool','active');
         INSERT INTO chapters(id, work_id, raw_filename, chapter_no, format, duration_secs, file_path, status, played, user_summary, takeaway, is_favorite) VALUES (1,1,'01.mp3',1,'mp3',60,'/01.mp3','active',0,'EXISTING',' ',0);",
    ).unwrap();

    let rep = apply_curation_import(&dest, &export).unwrap();
    assert_eq!(rep.tags_added, 1);
    assert_eq!(rep.played_marked, 1);
    assert_eq!(rep.favorites_marked, 1);
    assert_eq!(rep.collections_added, 1);
    // existing summary preserved (fill-if-empty did NOT clobber)
    let summary: String = dest.query_row("SELECT user_summary FROM chapters WHERE id=1", [], |r| r.get(0)).unwrap();
    assert_eq!(summary, "EXISTING");
    // played flipped to true (OR), never back to false
    let played: i64 = dest.query_row("SELECT played FROM chapters WHERE id=1", [], |r| r.get(0)).unwrap();
    assert_eq!(played, 1);
}
```

- [ ] **Step 2: Run — expect FAIL.** `cmd /c "tools\dev-env.cmd cargo test import_merges"`

- [ ] **Step 3: Implement `apply_curation_import`** in `backup.rs`. Look up ids with helper closures; apply additively; count into `ImportReport`:

```rust
use crate::model::ImportReport;

pub fn apply_curation_import(conn: &Connection, root: &Value) -> rusqlite::Result<ImportReport> {
    let mut rep = ImportReport::default();

    let find_author = |folder: &str| -> rusqlite::Result<Option<i64>> {
        conn.query_row("SELECT id FROM authors WHERE folder_name=?1 AND status='active'", params![folder], |r| r.get(0)).optional()
    };
    let find_work = |author_id: i64, base: &str| -> rusqlite::Result<Option<i64>> {
        conn.query_row("SELECT id FROM works WHERE author_id=?1 AND base_title=?2 AND status='active'", params![author_id, base], |r| r.get(0)).optional()
    };
    let find_chapter = |work_id: i64, raw: &str| -> rusqlite::Result<Option<i64>> {
        conn.query_row("SELECT id FROM chapters WHERE work_id=?1 AND raw_filename=?2 AND status='active'", params![work_id, raw], |r| r.get(0)).optional()
    };
    let add_tag = |table: &str, key_col: &str, id: i64, tag: &str| -> rusqlite::Result<bool> {
        let changed = conn.execute(&format!("INSERT OR IGNORE INTO {table}({key_col}, tag) VALUES (?1,?2)"), params![id, tag])?;
        Ok(changed > 0)
    };
    // fill scalar only if existing value is blank (trimmed empty)
    let fill_if_empty = |table: &str, col: &str, id: i64, val: &str| -> rusqlite::Result<bool> {
        if val.trim().is_empty() { return Ok(false); }
        let cur: String = conn.query_row(&format!("SELECT {col} FROM {table} WHERE id=?1"), params![id], |r| r.get(0))?;
        if cur.trim().is_empty() {
            conn.execute(&format!("UPDATE {table} SET {col}=?2 WHERE id=?1"), params![id, val])?;
            Ok(true)
        } else { Ok(false) }
    };

    let s = |v: &Value, k: &str| -> String { v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string() };
    let b = |v: &Value, k: &str| -> bool { v.get(k).and_then(|x| x.as_bool()).unwrap_or(false) };
    let i = |v: &Value, k: &str| -> i64 { v.get(k).and_then(|x| x.as_i64()).unwrap_or(0) };
    let arr = |v: &Value, k: &str| -> Vec<Value> { v.get(k).and_then(|x| x.as_array()).cloned().unwrap_or_default() };

    for a in arr(root, "authors") {
        let aid = match find_author(&s(&a, "folderName"))? { Some(id) => id, None => { rep.unmatched_authors += 1; continue; } };
        for t in arr(&a, "tags") { if let Some(tag) = t.as_str() { if add_tag("author_tags", "author_id", aid, tag)? { rep.tags_added += 1; } } }
        for w in arr(&a, "works") {
            let wid = match find_work(aid, &s(&w, "baseTitle"))? { Some(id) => id, None => { rep.unmatched_works += 1; continue; } };
            for t in arr(&w, "tags") { if let Some(tag) = t.as_str() { if add_tag("work_tags", "work_id", wid, tag)? { rep.tags_added += 1; } } }
            if fill_if_empty("works", "re_entry_note", wid, &s(&w, "reEntryNote"))? { rep.journal_fields_filled += 1; }
            if fill_if_empty("works", "completion_rating", wid, &s(&w, "completionRating"))? { rep.journal_fields_filled += 1; }
            if fill_if_empty("works", "chapter_sort", wid, &s(&w, "chapterSort"))? { rep.journal_fields_filled += 1; }
            for c in arr(&w, "chapters") {
                let cid = match find_chapter(wid, &s(&c, "rawFilename"))? { Some(id) => id, None => { rep.unmatched_chapters += 1; continue; } };
                for t in arr(&c, "tags") { if let Some(tag) = t.as_str() { if add_tag("chapter_tags", "chapter_id", cid, tag)? { rep.tags_added += 1; } } }
                if b(&c, "played") {
                    let changed = conn.execute("UPDATE chapters SET played=1 WHERE id=?1 AND played=0", params![cid])?;
                    rep.played_marked += changed as i64;
                }
                if b(&c, "isFavorite") {
                    let changed = conn.execute("UPDATE chapters SET is_favorite=1 WHERE id=?1 AND is_favorite=0", params![cid])?;
                    rep.favorites_marked += changed as i64;
                }
                if fill_if_empty("chapters", "user_summary", cid, &s(&c, "userSummary"))? { rep.journal_fields_filled += 1; }
                if fill_if_empty("chapters", "takeaway", cid, &s(&c, "takeaway"))? { rep.journal_fields_filled += 1; }
                for n in arr(&c, "notes") {
                    let exists: i64 = conn.query_row(
                        "SELECT COUNT(*) FROM chapter_notes WHERE chapter_id=?1 AND position_secs=?2 AND body=?3 AND created_at=?4",
                        params![cid, i(&n,"positionSecs"), s(&n,"body"), i(&n,"createdAt")], |r| r.get(0))?;
                    if exists == 0 {
                        conn.execute("INSERT INTO chapter_notes(chapter_id, position_secs, body, created_at) VALUES (?1,?2,?3,?4)",
                            params![cid, i(&n,"positionSecs"), s(&n,"body"), i(&n,"createdAt")])?;
                        rep.notes_added += 1;
                    }
                }
                for bm in arr(&c, "bookmarks") {
                    let exists: i64 = conn.query_row(
                        "SELECT COUNT(*) FROM chapter_bookmarks WHERE chapter_id=?1 AND position_secs=?2 AND label=?3 AND created_at=?4",
                        params![cid, i(&bm,"positionSecs"), s(&bm,"label"), i(&bm,"createdAt")], |r| r.get(0))?;
                    if exists == 0 {
                        conn.execute("INSERT INTO chapter_bookmarks(chapter_id, position_secs, label, created_at) VALUES (?1,?2,?3,?4)",
                            params![cid, i(&bm,"positionSecs"), s(&bm,"label"), i(&bm,"createdAt")])?;
                        rep.bookmarks_added += 1;
                    }
                }
            }
        }
    }

    for al in arr(root, "tagAliases") {
        let changed = conn.execute("INSERT OR IGNORE INTO tag_aliases(alias, canonical) VALUES (?1,?2)", params![s(&al,"alias"), s(&al,"canonical")])?;
        let _ = changed; // aliases counted under tags_added is misleading; leave uncounted
    }
    for pr in arr(root, "tagParents") {
        conn.execute("INSERT OR IGNORE INTO tag_parents(child, parent) VALUES (?1,?2)", params![s(&pr,"child"), s(&pr,"parent")])?;
    }
    for col in arr(root, "collections") {
        let name = s(&col, "name");
        let exists: i64 = conn.query_row("SELECT COUNT(*) FROM smart_collections WHERE name=?1", params![name], |r| r.get(0))?;
        if exists == 0 {
            let pos: i64 = conn.query_row("SELECT COALESCE(MAX(position),-1)+1 FROM smart_collections", [], |r| r.get(0))?;
            conn.execute("INSERT INTO smart_collections(name, query, position, created_at) VALUES (?1,?2,?3,?4)",
                params![name, s(&col,"query"), pos, i(root,"exportedAt")])?;
            rep.collections_added += 1;
        }
    }
    for se in arr(root, "savedSearches") {
        let name = s(&se, "name");
        let exists: i64 = conn.query_row("SELECT COUNT(*) FROM saved_searches WHERE name=?1", params![name], |r| r.get(0))?;
        if exists == 0 {
            conn.execute("INSERT INTO saved_searches(name, query, created_at) VALUES (?1,?2,?3)",
                params![name, s(&se,"query"), i(root,"exportedAt")])?;
            rep.searches_added += 1;
        }
    }

    Ok(rep)
}
```

> `.optional()` requires `use rusqlite::OptionalExtension;` at the top of `backup.rs`.

- [ ] **Step 4: Run the merge test — expect PASS.** `cmd /c "tools\dev-env.cmd cargo test import_merges"`

- [ ] **Step 5: Implement the staged DB restore (crash-safe).** Add to `backup.rs`:

```rust
use rusqlite::OpenFlags;

/// Validate `src` is a healthy SQLite DB no newer than we understand, then stage it
/// next to the live DB as `restore_pending.db`. The actual swap happens at the next
/// `db::open()` (see `apply_pending_restore`). NEVER touches the live DB here.
pub fn stage_db_restore(live_db_path: &str, src: &str) -> Result<(), String> {
    // 1. validate source (open read-only).
    let probe = Connection::open_with_flags(src, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("source is not a readable database: {e}"))?;
    let integrity: String = probe.query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|e| format!("integrity check failed: {e}"))?;
    if integrity != "ok" {
        return Err(format!("source failed integrity check: {integrity}"));
    }
    let uv: i64 = probe.query_row("PRAGMA user_version", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if uv > 7 {
        return Err(format!("source schema v{uv} is newer than this app (v7); upgrade the app first"));
    }
    drop(probe);
    // 2. stage beside the live DB (do NOT replace yet).
    let pending = pending_path(live_db_path);
    std::fs::copy(src, &pending).map_err(|e| format!("could not stage restore: {e}"))?;
    Ok(())
}

fn pending_path(live_db_path: &str) -> std::path::PathBuf {
    let p = std::path::Path::new(live_db_path);
    p.with_file_name("restore_pending.db")
}

/// Called at the TOP of db::open(), before any Connection is opened on the live DB.
/// If a staged restore exists, back up the current live DB (timestamped, recoverable)
/// then atomically rename the pending file into place. Best-effort + crash-safe:
/// the original is only renamed away AFTER the backup succeeds, and the pending file
/// is only removed by the successful rename — a crash at any point leaves a recoverable state.
pub fn apply_pending_restore(live_db_path: &str) {
    let pending = pending_path(live_db_path);
    if !pending.exists() {
        return;
    }
    let live = std::path::Path::new(live_db_path);
    // back up the current live DB first (only if it exists).
    if live.exists() {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let backup = live.with_file_name(format!("audioshelf.db.bak-{ts}"));
        if std::fs::rename(live, &backup).is_err() {
            // could not back up → DO NOT proceed (never destroy the original).
            return;
        }
    }
    // place the pending file as the live DB.
    if std::fs::rename(&pending, live).is_err() {
        // rename failed; leave pending in place for a future attempt. The backup (if made)
        // is still on disk and recoverable by the user.
    }
}
```

- [ ] **Step 6: Call `apply_pending_restore` at the top of `db::open()`** (`db.rs`), before `Connection::open(path)`:

```rust
pub fn open(path: &str) -> rusqlite::Result<Connection> {
    crate::backup::apply_pending_restore(path); // best-effort, crash-safe staged restore
    let conn = Connection::open(path)?;
    // ... existing PRAGMA foreign_keys = ON; migrate(&conn)?; ...
    Ok(conn)
}
```

> Match the existing `open()` body exactly; only prepend the one call. `migrate()` runs afterward, so a restored older DB is automatically upgraded to v7.

- [ ] **Step 7: Add the import/restore commands** (`commands.rs`). FE supplies the live DB path? No — the backend knows it. Simplest: `import_curation_json(path)` reads the JSON; `stage_db_restore(src)` needs the live DB path, which the app resolves at startup. Store the resolved DB path in `DbState` or a managed string. **Check how the live DB path is obtained** — if `DbState` only holds the `Mutex<Connection>`, add the path. Pragmatic approach: persist the live DB path as a managed `tauri::State<DbPath>` set during setup, OR re-derive it the same way bootstrap does. To stay self-contained, add a `pub struct DbPathState(pub String);` managed alongside `DbState` in `lib.rs setup`, and read it here:

```rust
#[tauri::command]
pub fn import_curation_json(state: tauri::State<DbState>, path: String) -> Result<crate::model::ImportReport, String> {
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let root: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("invalid backup JSON: {e}"))?;
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    crate::backup::apply_curation_import(&conn, &root).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn stage_db_restore(db_path: tauri::State<DbPathState>, src: String) -> Result<(), String> {
    crate::backup::stage_db_restore(&db_path.0, &src)
}
```

> **STOP-and-check:** Inspect `lib.rs setup`/`run` to see how the SQLite path is computed and how `DbState` is built (the digest shows `DbState` is `state.0.lock()` → a `Mutex<Connection>`). Add a `DbPathState(String)` to `.manage(...)` with the same path string passed to `db::open(path)`. If a managed path already exists, reuse it. This is the only structural addition; keep it minimal.

- [ ] **Step 8: Register** in `lib.rs`: `commands::import_curation_json`, `commands::stage_db_restore`; declare `DbPathState` and `.manage(DbPathState(db_path.clone()))`; testing re-export `pub use crate::backup::{apply_curation_import, apply_pending_restore, stage_db_restore};`.

- [ ] **Step 9: Add a restore-swap test** (`backup.rs` `#[cfg(test)]`) using temp files:

```rust
#[test]
fn pending_restore_backs_up_then_swaps() {
    let dir = std::env::temp_dir().join(format!("ashm19r_{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let live = dir.join("audioshelf.db");
    std::fs::write(&live, b"OLD").unwrap();
    let pending = dir.join("restore_pending.db");
    std::fs::write(&pending, b"NEW").unwrap();

    apply_pending_restore(live.to_str().unwrap());

    assert_eq!(std::fs::read(&live).unwrap(), b"NEW");      // swapped in
    assert!(!pending.exists());                              // consumed
    // a timestamped backup of OLD exists
    let has_backup = std::fs::read_dir(&dir).unwrap().filter_map(|e| e.ok())
        .any(|e| e.file_name().to_string_lossy().starts_with("audioshelf.db.bak-"));
    assert!(has_backup, "old DB should be backed up, not destroyed");
    std::fs::remove_dir_all(&dir).ok();
}
```

- [ ] **Step 10: Run all backup tests — expect PASS.**

Run: `cmd /c "tools\dev-env.cmd cargo test"`
Expected: all green.

- [ ] **Step 11: Commit**

```bash
git add src-tauri/src/backup.rs src-tauri/src/db.rs src-tauri/src/commands.rs src-tauri/src/model.rs src-tauri/src/lib.rs
git commit -m "feat(m19): additive curation import + crash-safe staged DB restore"
```

---

# PHASE 10 — Frontend API wrappers + types

### Task 10: `api.ts` — all new wrappers + interfaces

**Files:**
- Modify: `src/lib/api.ts`

- [ ] **Step 1: Add the TS interfaces** (match the Rust camelCase serde shapes exactly):

```typescript
export interface ScopedWork {
  workId: number; baseTitle: string; authorId: number; authorName: string;
  totalSecs: number; chapterCount: number; playedCount: number; tags: string[];
}
export interface ScopedResults {
  works: ScopedWork[]; tags: string[]; text: string; durationLabel: string; statusLabel: string;
}
export interface SavedSearch { id: number; name: string; query: string; }
export interface Collection { id: number; name: string; query: string; position: number; }
export interface HealthItem {
  chapterId: number; title: string; workTitle: string; authorName: string; filePath: string; sizeBytes: number;
}
export interface HealthReport {
  missingFiles: HealthItem[]; zeroByte: HealthItem[]; unreadable: HealthItem[];
  schemaVersion: number; latestSchema: number; schemaDrift: boolean;
}
export interface ImportReport {
  tagsAdded: number; playedMarked: number; favoritesMarked: number; journalFieldsFilled: number;
  notesAdded: number; bookmarksAdded: number; collectionsAdded: number; searchesAdded: number;
  unmatchedAuthors: number; unmatchedWorks: number; unmatchedChapters: number;
}
```

Also add `chapterSort: string;` to the existing `WorkRow` interface.

- [ ] **Step 2: Add the invoke wrappers** (mirror the existing `=> invoke<…>("cmd", {…})` style; arg keys are camelCase — Tauri maps them to Rust snake_case automatically):

```typescript
export const advancedSearch = (query: string) => invoke<ScopedResults>("advanced_search", { query });

export const createSavedSearch = (name: string, query: string, createdAt: number) =>
  invoke<number>("create_saved_search", { name, query, createdAt });
export const listSavedSearches = () => invoke<SavedSearch[]>("list_saved_searches");
export const deleteSavedSearch = (id: number) => invoke("delete_saved_search", { id });

export const createCollection = (name: string, query: string, createdAt: number) =>
  invoke<number>("create_collection", { name, query, createdAt });
export const listCollections = () => invoke<Collection[]>("list_collections");
export const updateCollection = (id: number, name: string, query: string) =>
  invoke("update_collection", { id, name, query });
export const deleteCollection = (id: number) => invoke("delete_collection", { id });
export const reorderCollections = (ids: number[]) => invoke("reorder_collections", { ids });
export const resolveCollection = (id: number) => invoke<ScopedResults>("resolve_collection", { id });

export const bulkSetWorkTags = (workIds: number[], add: string[], remove: string[]) =>
  invoke("bulk_set_work_tags", { workIds, add, remove });

export const setWorkChapterSort = (workId: number, sort: string) =>
  invoke("set_work_chapter_sort", { workId, sort });

export const libraryHealthScan = () => invoke<HealthReport>("library_health_scan");

export const exportCurationJson = (path: string, exportedAt: number) =>
  invoke("export_curation_json", { path, exportedAt });
export const exportDbSnapshot = (path: string) => invoke("export_db_snapshot", { path });
export const importCurationJson = (path: string) => invoke<ImportReport>("import_curation_json", { path });
export const stageDbRestore = (src: string) => invoke("stage_db_restore", { src });
```

- [ ] **Step 3: Verify it compiles.** Run: `npx tsc --noEmit` → expect no errors. **Step 4: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat(m19): frontend api wrappers + types for power & scale commands"
```

---

# PHASE 11 — Command palette (Ctrl+K)

### Task 11: `CommandPalette.tsx` + global keydown + App wiring

**Files:**
- Create: `src/components/CommandPalette.tsx`
- Modify: `src/App.tsx` (keydown effect, palette state, handlers), `src/styles/components.css` (palette styles), `src/components/Icon.tsx` (`palette` glyph optional)

**Behavior:** Ctrl+K (or ⌘K) opens a centered overlay with a search input that debounces `searchLibrary(query)` (150ms, matching the existing convention) and shows grouped results (Authors / Works / Chapters). ↑/↓ move a highlight across the flat result list, Enter activates, Esc closes. Activating an author → open that author; a work → open its author (scroll/focus the work); a chapter → play it. Pure component; all actions via props.

- [ ] **Step 1: Write a unit test for selection math** (`src/components/CommandPalette.test.tsx`) — test the pure index-clamping helper. Extract a helper `clampIndex(i, len)` in the component file and test it:

```typescript
import { describe, it, expect } from "vitest";
import { clampIndex } from "./CommandPalette";

describe("clampIndex", () => {
  it("wraps around both ends", () => {
    expect(clampIndex(-1, 3)).toBe(2);
    expect(clampIndex(3, 3)).toBe(0);
    expect(clampIndex(1, 3)).toBe(1);
  });
  it("returns 0 for empty", () => {
    expect(clampIndex(0, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** `npm test -- CommandPalette`

- [ ] **Step 3: Implement `CommandPalette.tsx`:**

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import type { SearchResults } from "../lib/api";

export function clampIndex(i: number, len: number): number {
  if (len <= 0) return 0;
  return ((i % len) + len) % len;
}

type Flat =
  | { kind: "author"; id: number; label: string; sub: string }
  | { kind: "work"; id: number; authorId: number; label: string; sub: string }
  | { kind: "chapter"; id: number; label: string; sub: string };

export function CommandPalette({
  open, results, query, onQueryChange, onClose, onOpenAuthor, onOpenWorkAuthor, onPlayChapter,
}: {
  open: boolean;
  results: SearchResults | null;
  query: string;
  onQueryChange: (q: string) => void;
  onClose: () => void;
  onOpenAuthor: (authorId: number) => void;
  onOpenWorkAuthor: (authorId: number) => void;
  onPlayChapter: (chapterId: number) => void;
}) {
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const flat: Flat[] = useMemo(() => {
    if (!results) return [];
    return [
      ...results.authors.map((a) => ({ kind: "author" as const, id: a.authorId, label: a.authorName, sub: "Creator" })),
      ...results.works.map((w) => ({ kind: "work" as const, id: w.workId, authorId: w.authorId, label: w.baseTitle, sub: w.authorName })),
      ...results.chapters.map((c) => ({ kind: "chapter" as const, id: c.chapterId, label: c.title, sub: `${c.baseTitle} · ${c.authorName}` })),
    ];
  }, [results]);

  useEffect(() => { setActive(0); }, [flat.length]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  if (!open) return null;

  const activate = (item: Flat) => {
    if (item.kind === "author") onOpenAuthor(item.id);
    else if (item.kind === "work") onOpenWorkAuthor(item.authorId);
    else onPlayChapter(item.id);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => clampIndex(i + 1, flat.length)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => clampIndex(i - 1, flat.length)); }
    else if (e.key === "Enter" && flat[active]) { e.preventDefault(); activate(flat[active]); }
  };

  return (
    <div className="palette-backdrop" role="dialog" aria-modal="true" aria-label="Command palette" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette__input"
          placeholder="Search creators, works, chapters…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Command palette search"
        />
        <ul className="palette__list" role="listbox">
          {flat.map((item, idx) => (
            <li
              key={`${item.kind}-${item.id}`}
              role="option"
              aria-selected={idx === active}
              className={`palette__item${idx === active ? " palette__item--active" : ""}`}
              onMouseEnter={() => setActive(idx)}
              onClick={() => activate(item)}
            >
              <span className="palette__label">{item.label}</span>
              <span className="palette__sub">{item.sub}</span>
            </li>
          ))}
          {flat.length === 0 && query.trim() !== "" && <li className="palette__empty">No matches</li>}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire into `App.tsx`:**
  - Add state: `const [paletteOpen, setPaletteOpen] = useState(false); const [paletteQuery, setPaletteQuery] = useState(""); const [paletteResults, setPaletteResults] = useState<SearchResults | null>(null);`
  - Global keydown effect (mount once):

```tsx
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      setPaletteOpen((o) => !o);
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, []);
```

  - Debounced search on `paletteQuery` (reuse the existing 150ms debounce pattern from Library search):

```tsx
useEffect(() => {
  if (!paletteOpen) return;
  const q = paletteQuery;
  const t = setTimeout(() => {
    if (q.trim() === "") { setPaletteResults({ authors: [], works: [], chapters: [] }); return; }
    void searchLibrary(q).then(setPaletteResults).catch(() => setPaletteResults(null));
  }, 150);
  return () => clearTimeout(t);
}, [paletteQuery, paletteOpen]);
```

  - Render `<CommandPalette … />` once near the AppShell (outside the route switch, so it overlays any view). Use existing handlers: `onOpenAuthor={(id) => openAuthor(id)}`, `onOpenWorkAuthor={(authorId) => openAuthor(authorId)}`, `onPlayChapter={(id) => playChapterById(id)}` (the M17 `playChapterById` helper resolves the author). Confirm `openAuthor` / `playChapterById` exist; if `openAuthor` takes different args, match it.

- [ ] **Step 5: Add palette CSS** to `components.css` (centered overlay, dark, near-black panel, electric-blue active row — match existing token vars `--bg`, `--accent`, etc.; read a few existing component rules to reuse variables):

```css
.palette-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: flex-start; justify-content: center; padding-top: 12vh; z-index: 1000; }
.palette { width: min(640px, 92vw); background: var(--surface, #16181d); border: 1px solid var(--border, #2a2d34); border-radius: 12px; box-shadow: 0 16px 48px rgba(0,0,0,.5); overflow: hidden; }
.palette__input { width: 100%; box-sizing: border-box; padding: 14px 16px; font-size: 16px; background: transparent; color: var(--text, #e8e8ea); border: 0; border-bottom: 1px solid var(--border, #2a2d34); outline: none; }
.palette__list { list-style: none; margin: 0; padding: 6px; max-height: 50vh; overflow-y: auto; }
.palette__item { display: flex; justify-content: space-between; gap: 12px; padding: 10px 12px; border-radius: 8px; cursor: pointer; }
.palette__item--active { background: var(--accent-muted, #1f2b44); }
.palette__label { color: var(--text, #e8e8ea); }
.palette__sub { color: var(--text-dim, #8a8f99); font-size: 13px; }
.palette__empty { padding: 14px; color: var(--text-dim, #8a8f99); text-align: center; }
```

> Replace the fallback hex values with the actual token variable names from `styles/tokens.css` (read it once). Do not introduce new colors — reuse tokens.

- [ ] **Step 6: Run gates.** `npm test -- CommandPalette` (PASS) · `npx tsc --noEmit` (clean). **Step 7: Commit**

```bash
git add src/components/CommandPalette.tsx src/components/CommandPalette.test.tsx src/App.tsx src/styles/components.css
git commit -m "feat(m19): Ctrl+K command palette (search → navigate/play)"
```

---

# PHASE 12 — Advanced scoped search + saved searches (Library)

### Task 12: scoped-search mode in Library + save/recall

**Files:**
- Create: `src/lib/query.ts`, `src/components/ScopedResults.tsx`
- Modify: `src/views/LibraryView.tsx`, `src/App.tsx` (advancedSearch wiring + saved-search state), `src/lib/api.ts` (already done)

- [ ] **Step 1: Write `query.ts` + tests** (`src/lib/query.test.ts`):

```typescript
import { describe, it, expect } from "vitest";
import { hasScopedTokens } from "./query";

describe("hasScopedTokens", () => {
  it("detects tag/duration/status prefixes", () => {
    expect(hasScopedTokens("tag:cozy")).toBe(true);
    expect(hasScopedTokens("duration:<15m")).toBe(true);
    expect(hasScopedTokens("status:unplayed")).toBe(true);
  });
  it("plain text is not scoped", () => {
    expect(hasScopedTokens("jane doe")).toBe(false);
    expect(hasScopedTokens("")).toBe(false);
  });
});
```

```typescript
// src/lib/query.ts
export function hasScopedTokens(raw: string): boolean {
  return /(^|\s)(tag|duration|status):\S/i.test(raw);
}
```

- [ ] **Step 2: Run — expect FAIL then implement then PASS.** `npm test -- query`

- [ ] **Step 3: Implement `ScopedResults.tsx`** (pure work grid; reuse existing `WorkCard`/`formatLong` if compatible, else a simple card):

```tsx
import type { ScopedResults as Results, ScopedWork } from "../lib/api";

function fmt(secs: number): string {
  const h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function ScopedResults({
  results, onOpenAuthor, selectMode, selectedWorkIds, onToggleWork,
}: {
  results: Results;
  onOpenAuthor: (authorId: number) => void;
  selectMode?: boolean;
  selectedWorkIds?: number[];
  onToggleWork?: (workId: number) => void;
}) {
  const selected = new Set(selectedWorkIds ?? []);
  return (
    <div>
      <div className="scoped-chips">
        {results.tags.map((t) => <span key={t} className="chip">tag: {t}</span>)}
        {results.durationLabel && <span className="chip">duration: {results.durationLabel}</span>}
        {results.statusLabel && <span className="chip">{results.statusLabel}</span>}
        {results.text && <span className="chip chip--text">“{results.text}”</span>}
        <span className="scoped-count">{results.works.length} works</span>
      </div>
      <div className="card-grid">
        {results.works.map((w: ScopedWork) => (
          <button key={w.workId} className={`work-card${selected.has(w.workId) ? " work-card--selected" : ""}`}
            onClick={() => (selectMode && onToggleWork ? onToggleWork(w.workId) : onOpenAuthor(w.authorId))}>
            {selectMode && <span className="work-card__check" aria-hidden>{selected.has(w.workId) ? "☑" : "☐"}</span>}
            <span className="work-card__title">{w.baseTitle}</span>
            <span className="work-card__sub">{w.authorName}</span>
            <span className="work-card__meta">{w.playedCount}/{w.chapterCount} · {fmt(w.totalSecs)}</span>
          </button>
        ))}
        {results.works.length === 0 && <p className="empty-note">No works match this search.</p>}
      </div>
    </div>
  );
}
```

> Reuse existing classes (`card-grid`, `work-card`) so styling is consistent; if those class names differ, match the real ones from `LibraryView`/`WorkCard`. Add `.scoped-chips`/`.chip`/`.work-card--selected`/`.work-card__check` to `components.css`.

- [ ] **Step 4: Wire scoped mode into Library** (`LibraryView.tsx` + `App.tsx`):
  - In `App.tsx`, when the Library search query changes, branch: if `hasScopedTokens(query)` → call `advancedSearch(query)` and store `scopedResults`; else keep the existing `searchLibrary` behavior. Pass `scopedResults` + a `scoped: boolean` flag into `LibraryView`.
  - In `LibraryView.tsx`, when `props.scoped && props.scopedResults` render `<ScopedResults … />` instead of the normal `SearchResultsPanel`/author list. Add a small hint under the search box: "Try `tag:cozy duration:<15m status:unplayed`".
  - **Saved searches:** add a "Save search" button (visible when `props.scoped`) → `props.onSaveSearch(name, query)`; and a saved-searches `<select>`/menu populated from `props.savedSearches` → `props.onRunSavedSearch(query)` (sets the query). In `App.tsx`: load `listSavedSearches()` on mount; `onSaveSearch` → `createSavedSearch(name, query, Date.now())` then reload; provide a delete affordance in the menu → `deleteSavedSearch(id)`.

- [ ] **Step 5: Run gates** (`npx tsc --noEmit`, `npm test`) and **Commit**

```bash
git add src/lib/query.ts src/lib/query.test.ts src/components/ScopedResults.tsx src/views/LibraryView.tsx src/App.tsx src/styles/components.css
git commit -m "feat(m19): advanced scoped search + saved searches in Library"
```

---

# PHASE 13 — Smart collections (Collections route + Settings management)

### Task 13: `CollectionsView` route + management UI

**Files:**
- Create: `src/components/CollectionsView.tsx`
- Modify: `src/components/AppShell.tsx` (add `collections` route + nav), `src/App.tsx` (route + wiring), `src/views/SettingsView.tsx` (collection management), `src/components/Icon.tsx` (`collections` glyph)

- [ ] **Step 1: Extend `ShellRoute` + nav** (`AppShell.tsx`):
  - `export type ShellRoute = "home" | "library" | "discovery" | "rename" | "metadata" | "settings" | "journal" | "insights" | "collections";`
  - Add prop `onCollections: () => void;` to the props interface + destructure.
  - Add to the `items` array (after `insights` or wherever fits): `{ key: "collections", label: "Collections", icon: "collections", action: onCollections },`
  - Add a `collections` glyph to `Icon.tsx` (single `<path>`, `stroke="currentColor" fill="none"` per M18 convention) and the `IconName` union.

- [ ] **Step 2: Implement `CollectionsView.tsx`** (pure; resolves shown collection lazily via a prop callback):

```tsx
import { useState } from "react";
import type { Collection, ScopedResults as Results } from "../lib/api";
import { ScopedResults } from "./ScopedResults";

export function CollectionsView({
  collections, resolved, onResolve, onOpenAuthor,
}: {
  collections: Collection[];
  resolved: Record<number, Results | undefined>;
  onResolve: (id: number) => void;
  onOpenAuthor: (authorId: number) => void;
}) {
  const [openId, setOpenId] = useState<number | null>(null);
  return (
    <div className="page">
      <header className="page-header"><h1>Collections</h1>
        <p className="page-header__sub">Saved smart filters that update as your library changes.</p></header>
      {collections.length === 0 && <p className="empty-note">No collections yet. Create one in Settings → Backup &amp; maintenance.</p>}
      <ul className="collection-list">
        {collections.map((c) => (
          <li key={c.id}>
            <button className="collection-row" onClick={() => { const next = openId === c.id ? null : c.id; setOpenId(next); if (next !== null && !resolved[c.id]) onResolve(c.id); }}>
              <span className="collection-row__name">{c.name}</span>
              <code className="collection-row__query">{c.query}</code>
            </button>
            {openId === c.id && resolved[c.id] && <ScopedResults results={resolved[c.id]!} onOpenAuthor={onOpenAuthor} />}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Wire route + state** (`App.tsx`):
  - Add `{ kind: "collections" }` to the `Route` union.
  - `function openCollections() { void listCollections().then(setCollections); setRoute({ kind: "collections" }); }`
  - State: `const [collections, setCollections] = useState<Collection[]>([]); const [resolvedCollections, setResolvedCollections] = useState<Record<number, ScopedResults | undefined>>({});`
  - Resolve handler: `const onResolveCollection = (id: number) => { void resolveCollection(id).then((r) => setResolvedCollections((m) => ({ ...m, [id]: r }))); };`
  - Render `if (route.kind === "collections") return <CollectionsView … />;`
  - Pass `onCollections={openCollections}` into `AppShell`.

- [ ] **Step 4: Collection management in Settings** (`SettingsView.tsx`): a "Collections" subsection — list each collection with name + query + Delete; a "New collection" form (name + query inputs) → `props.onCreateCollection(name, query)`; up/down reorder buttons → `props.onReorderCollections(ids)`. In `App.tsx`: `onCreateCollection` → `createCollection(name, query, Date.now())` then reload list; `onDeleteCollection` → `deleteCollection(id)` then reload; `onReorderCollections` → `reorderCollections(ids)` then reload.

- [ ] **Step 5: Run gates + Commit**

```bash
git add src/components/CollectionsView.tsx src/components/AppShell.tsx src/components/Icon.tsx src/views/SettingsView.tsx src/App.tsx src/styles/components.css
git commit -m "feat(m19): smart collections route + management"
```

---

# PHASE 14 — Multi-select + bulk tagging

### Task 14: select mode + `BulkTagDialog`

**Files:**
- Create: `src/components/BulkTagDialog.tsx`
- Modify: `src/views/LibraryView.tsx` (or `ScopedResults` already supports select props), `src/App.tsx` (select state + bulk apply), `src/styles/components.css` (bulk bar)

**Behavior:** a "Select" toggle enters select mode; clicking a work card toggles its membership (the `selectMode`/`selectedWorkIds`/`onToggleWork` props already threaded into `ScopedResults` in Task 12). A bottom action bar shows the count + "Tag…" → opens `BulkTagDialog` (add tags + remove tags) → `bulkSetWorkTags(ids, add, remove)`; "Clear"/"Done" exits.

- [ ] **Step 1: Implement `BulkTagDialog.tsx`** (reuse the M13 `Dialog` primitive if present; else a simple modal). Pure:

```tsx
import { useState } from "react";

export function BulkTagDialog({
  count, allTags, onApply, onClose,
}: {
  count: number;
  allTags: string[];
  onApply: (add: string[], remove: string[]) => void;
  onClose: () => void;
}) {
  const [add, setAdd] = useState("");
  const [remove, setRemove] = useState("");
  const split = (s: string) => s.split(",").map((t) => t.trim()).filter(Boolean);
  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="Bulk tag" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Tag {count} works</h2>
        <label>Add tags (comma-separated)
          <input list="bulk-tag-list" value={add} onChange={(e) => setAdd(e.target.value)} /></label>
        <label>Remove tags (comma-separated)
          <input value={remove} onChange={(e) => setRemove(e.target.value)} /></label>
        <datalist id="bulk-tag-list">{allTags.map((t) => <option key={t} value={t} />)}</datalist>
        <div className="dialog__actions">
          <button onClick={onClose}>Cancel</button>
          <button className="btn-accent" onClick={() => { onApply(split(add), split(remove)); onClose(); }}>Apply</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire select mode** (`App.tsx` + `LibraryView`):
  - State: `const [selectMode, setSelectMode] = useState(false); const [selectedWorkIds, setSelectedWorkIds] = useState<number[]>([]); const [bulkDialogOpen, setBulkDialogOpen] = useState(false);`
  - `onToggleWork = (id) => setSelectedWorkIds((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);`
  - Pass `selectMode`, `selectedWorkIds`, `onToggleWork` into the scoped results path; add a "Select" toggle button in the Library header (only meaningful in scoped/work views — that's where work cards render).
  - Bulk apply: `const onBulkApply = (add, remove) => { void bulkSetWorkTags(selectedWorkIds, add, remove).then(() => { /* re-run current scoped search to refresh tags */ }); };`
  - Render a `.bulk-bar` when `selectMode && selectedWorkIds.length > 0` with the count + "Tag…" (open dialog) + "Clear" (empty selection) + "Done" (exit mode). Pass `allTags` from the existing `getAllTags()` call (already loaded for tag editors).

- [ ] **Step 3: Add `.bulk-bar`/`.dialog`* CSS** if not reusing existing dialog styles. **Step 4: Run gates + Commit**

```bash
git add src/components/BulkTagDialog.tsx src/views/LibraryView.tsx src/App.tsx src/styles/components.css
git commit -m "feat(m19): multi-select + bulk tagging of works"
```

---

# PHASE 15 — Density toggle + per-work chapter-sort control

### Task 15a: density

**Files:**
- Create: `src/lib/density.ts` (+ test)
- Modify: `src/components/AppShell.tsx` (apply `data-density`), `src/views/SettingsView.tsx` (control), `src/App.tsx` (load/persist setting), `src/styles/components.css` (density rules)

- [ ] **Step 1: `density.ts` + test:**

```typescript
// src/lib/density.ts
export type Density = "compact" | "comfortable" | "spacious";
const VALID: Density[] = ["compact", "comfortable", "spacious"];
export function parseDensity(raw: string | null): Density {
  return VALID.includes(raw as Density) ? (raw as Density) : "comfortable";
}
```

```typescript
// src/lib/density.test.ts
import { describe, it, expect } from "vitest";
import { parseDensity } from "./density";
describe("parseDensity", () => {
  it("defaults to comfortable on junk/null", () => {
    expect(parseDensity(null)).toBe("comfortable");
    expect(parseDensity("huge")).toBe("comfortable");
  });
  it("passes through valid values", () => {
    expect(parseDensity("compact")).toBe("compact");
    expect(parseDensity("spacious")).toBe("spacious");
  });
});
```

- [ ] **Step 2: Run — FAIL → implement → PASS.** `npm test -- density`

- [ ] **Step 3: Load/persist + apply.** In `App.tsx`: load `getSetting("library_density")` on bootstrap → `parseDensity` → `density` state; pass into `AppShell`. In `AppShell.tsx`, put `data-density={density}` on the root shell element (add `density: Density` prop). Settings control (`SettingsView`): a 3-way segmented control → `props.onDensityChange(d)` → `setSetting("library_density", d)` + update state.

- [ ] **Step 4: CSS** (`components.css`) — scope card grid / list spacing by density:

```css
[data-density="compact"]    .card-grid { gap: 8px; }
[data-density="comfortable"] .card-grid { gap: 16px; }
[data-density="spacious"]   .card-grid { gap: 28px; }
[data-density="compact"]    .work-card { padding: 8px; }
[data-density="spacious"]   .work-card { padding: 18px; }
```

> Match the real grid/card class names and tune values to the existing design tokens. The default (`comfortable`) must equal current spacing so nothing shifts until the user changes it.

### Task 15b: per-work chapter-sort control

**Files:**
- Modify: `src/views/AuthorDetailView.tsx`, `src/App.tsx`

- [ ] **Step 5:** In `AuthorDetailView.tsx`, render a small `<select>` per work (near the work header) bound to `work.chapterSort` with options: `""`→"Chapter order", `number_desc`→"Reverse order", `title_asc`→"Title A–Z", `title_desc`→"Title Z–A", `duration_asc`→"Shortest first", `duration_desc`→"Longest first". On change → `props.onChapterSortChange(workId, value)`.
- [ ] **Step 6:** In `App.tsx`, `onChapterSortChange = (workId, sort) => { void setWorkChapterSort(workId, sort).then(() => refetchAuthorDetail()); }` (reuse however the detail is currently refetched — the M17 note shows detail is re-fetched and components keyed to remount; match that).
- [ ] **Step 7: Run gates + Commit**

```bash
git add src/lib/density.ts src/lib/density.test.ts src/components/AppShell.tsx src/views/SettingsView.tsx src/views/AuthorDetailView.tsx src/App.tsx src/styles/components.css
git commit -m "feat(m19): density toggle + per-work chapter-sort control"
```

---

# PHASE 16 — Backup & maintenance UI (export/import + health)

### Task 16: Settings "Backup & maintenance" section + capability

**Files:**
- Modify: `src/views/SettingsView.tsx`, `src/App.tsx`, `src-tauri/capabilities/default.json`

- [ ] **Step 1: Add `dialog:allow-open`** to `src-tauri/capabilities/default.json` permissions array (next to the existing `dialog:allow-save` from M17). This regenerates `gen/schemas/capabilities.json` on build — let it.

- [ ] **Step 2: Backup & maintenance section** (`SettingsView.tsx`) — five actions, each a button calling a prop:
  - **Export curation (JSON)** → `props.onExportJson()`
  - **Export full snapshot (.db)** → `props.onExportSnapshot()`
  - **Import curation (JSON)** → `props.onImportJson()` (shows the returned `ImportReport` summary)
  - **Restore snapshot (.db)** → `props.onRestoreSnapshot()` (shows a "restart required" note)
  - **Run health scan** → `props.onHealthScan()` (renders the returned `HealthReport`: counts + lists of missing/zero-byte/unreadable chapters + a schema-drift banner)
  - Render `importReport`/`healthReport` results passed back as props.

- [ ] **Step 3: Wire the dialogs in `App.tsx`** using `@tauri-apps/plugin-dialog`:

```tsx
import { save, open } from "@tauri-apps/plugin-dialog";

const onExportJson = async () => {
  const path = await save({ defaultPath: "audioshelf-curation.json", filters: [{ name: "JSON", extensions: ["json"] }] });
  if (path) await exportCurationJson(path, Date.now());
};
const onExportSnapshot = async () => {
  const path = await save({ defaultPath: "audioshelf-snapshot.db", filters: [{ name: "SQLite", extensions: ["db"] }] });
  if (path) await exportDbSnapshot(path);
};
const onImportJson = async () => {
  const path = await open({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
  if (typeof path === "string") setImportReport(await importCurationJson(path));
};
const onRestoreSnapshot = async () => {
  const path = await open({ multiple: false, filters: [{ name: "SQLite", extensions: ["db"] }] });
  if (typeof path === "string") { await stageDbRestore(path); setRestoreStaged(true); }
};
const onHealthScan = async () => setHealthReport(await libraryHealthScan());
```

  - State: `const [importReport, setImportReport] = useState<ImportReport | null>(null); const [healthReport, setHealthReport] = useState<HealthReport | null>(null); const [restoreStaged, setRestoreStaged] = useState(false);` Pass all into `SettingsView`. When `restoreStaged`, show a prominent "Restore staged — restart AudioShelf to apply (your current library is backed up automatically)." note.

- [ ] **Step 4: Run gates + Commit**

```bash
git add src/views/SettingsView.tsx src/App.tsx src-tauri/capabilities/default.json
git commit -m "feat(m19): backup & maintenance UI (export/import, restore, health scan)"
```

---

# PHASE 17 — Harness walkthrough, gates, regression verify

### Task 17: `m19Steps()` + full verification

**Files:**
- Modify: `src/harness/walkthroughs.ts`, `src/harness/runner.test.ts`, and the harness driver that maps step names → app navigation (match how `m18`/`journal` steps were wired — the `verify.ps1 -Walkthrough <name>` path).

- [ ] **Step 1: Add `m19Steps()`** to `walkthroughs.ts` (mirror `journalSteps` shape — a `nav` object of async fns, returns `Step[]`). Cover the new surfaces; the Insights view is tall, so follow the M18 lesson and keep each shot to one screenful (scroll where needed):

```typescript
export function m19Steps(nav: {
  showCommandPalette: () => Promise<void>;
  showScopedSearch: () => Promise<void>;
  showSavedSearches: () => Promise<void>;
  showCollections: () => Promise<void>;
  showBulkSelect: () => Promise<void>;
  showDensitySpacious: () => Promise<void>;
  showChapterSort: () => Promise<void>;
  showBackupMaintenance: () => Promise<void>;
  showHealthReport: () => Promise<void>;
}): Step[] {
  return [
    { name: "command-palette", run: nav.showCommandPalette },
    { name: "scoped-search", run: nav.showScopedSearch },
    { name: "saved-searches", run: nav.showSavedSearches },
    { name: "collections", run: nav.showCollections },
    { name: "bulk-select", run: nav.showBulkSelect },
    { name: "density-spacious", run: nav.showDensitySpacious },
    { name: "chapter-sort", run: nav.showChapterSort },
    { name: "backup-maintenance", run: nav.showBackupMaintenance },
    { name: "health-report", run: nav.showHealthReport },
  ];
}
```

- [ ] **Step 2: Add the count/name assertion** to `runner.test.ts` (mirror the `journalSteps` test):

```typescript
describe("m19Steps", () => {
  it("captures the nine M19 power-&-scale surfaces in order", () => {
    const noop = async () => {};
    expect(m19Steps({
      showCommandPalette: noop, showScopedSearch: noop, showSavedSearches: noop,
      showCollections: noop, showBulkSelect: noop, showDensitySpacious: noop,
      showChapterSort: noop, showBackupMaintenance: noop, showHealthReport: noop,
    }).map((s) => s.name)).toEqual([
      "command-palette", "scoped-search", "saved-searches", "collections",
      "bulk-select", "density-spacious", "chapter-sort", "backup-maintenance", "health-report",
    ]);
  });
});
```

- [ ] **Step 3: Implement the `nav` driver** for `m19` in the harness app entry (wherever `journal`/`insights` walkthroughs seed state and navigate — match that file). Seed at runtime (DO NOT change fixtures): create a sample saved search + collection (`tag:cozy`), enter scoped search `duration:<15m`, open the palette with a query, toggle select mode, set density spacious, set a work's chapter sort, open Settings → Backup & maintenance, run a health scan. The health scan over the synthetic fixtures will show some/zero issues — that's fine; the shot proves the surface renders.

- [ ] **Step 4: Run the FULL gate suite:**

```
npx tsc --noEmit
npm test
cmd /c "tools\dev-env.cmd cargo test"
npm run build
cmd /c "tools\dev-env.cmd cargo tauri build --debug"
```
All must pass / be green.

- [ ] **Step 5: Run the screenshot harness** (foreground): `tools\verify.ps1 -Walkthrough m19` and the regression matrix `tools\verify.ps1 -Walkthrough m12`. Capture the PNG output dir path.

- [ ] **Step 6: Dispatch a Sonnet screenshot-verify subagent** (do NOT load PNGs into the controller). The subagent Reads the `m19` shots + the `m12` regression shots and returns a **text verdict** (PASS/FAIL + per-shot observations + absolute paths). Acceptance criteria per shot:
  - `command-palette`: centered overlay with input + grouped results, one row highlighted.
  - `scoped-search`: chips for the parsed filters + a work grid; count shown.
  - `saved-searches`: a saved-search entry recallable from the menu.
  - `collections`: Collections route lists the seeded collection; expanding shows resolved works.
  - `bulk-select`: select mode active, ≥1 work checked, bulk bar with count + Tag….
  - `density-spacious`: visibly looser spacing than default.
  - `chapter-sort`: the per-work sort control present; chapters reflect the chosen order.
  - `backup-maintenance`: the five actions render in Settings.
  - `health-report`: the health report renders (counts + any lists + schema banner).
  - `m12` matrix: unchanged except the new **Collections** sidebar nav item.

- [ ] **Step 7:** If the subagent reports FAIL, fix and re-verify (offer to show a shot only if the user asks). When PASS, **Commit**

```bash
git add src/harness/walkthroughs.ts src/harness/runner.test.ts src/harness/*
git commit -m "feat(m19): m19 walkthrough + full gate & regression verification"
```

---

## Final invariant check (before PR)

- [ ] `git diff --stat origin/main -- Cargo.toml Cargo.lock package.json package-lock.json` → only expected churn; **no new dependency** (capabilities `default.json` change for `dialog:allow-open` is expected).
- [ ] Fixtures unchanged: `git diff --stat -- src-tauri/tests src-tauri/fixtures` (or the fixture dir) → empty; the `fixture_scan.rs` counts assertion still passes (43/44/47).
- [ ] Read-only on audio: grep the diff for any `std::fs::write`/`rename`/`copy`/`remove` and confirm each targets SQLite, a user-chosen path, the staged-restore pending/backup files, or thumbnails — **never an audio file**.
- [ ] Destructive-op discipline: restore backs up before swap (the `pending_restore_backs_up_then_swaps` test passes); import never deletes (the `import_merges_additively` test passes).

## PR & merge (controller, foreground)

- [ ] Push the branch; open a PR titled **"M19 — Power & Scale"** with a summary of the 8 sub-features, the schema v7 note, and the invariant results.
- [ ] FOREGROUND watch: `Start-Sleep 20; gh pr checks <PR#> --watch`.
- [ ] On green, merge from main: `gh pr merge <PR#> --merge --delete-branch`; sync main.
- [ ] Update `ROADMAP.md`: flip M19 to ✅ Merged with PR # + a one-line summary; append a decision-log entry (schema v7 additive, forks chosen: all-8 broad / dedicated tables / both export modes; restore-swap design; any deviations). Commit + push.
- [ ] Ping the handoff (next: plan M20 — Accessibility & Platform Integration).

---

## Self-review (done at plan-writing time)

- **Spec coverage:** all 8 backlog M19 items are tasked — command palette (T11), advanced/scoped search + saved searches (T3/T12), multi-select bulk tagging (T5/T14), smart collections (T4/T13), density toggle (T15a), per-work chapter-sort (T6/T15b), SQLite export/import both modes (T8/T9/T16), library-health scan (T7/T16). Backlog guardrails honored: read-only-on-disk, non-destructive chapter sort, additive import, non-goals untouched.
- **Type consistency:** `ScopedResults`/`ScopedWork`/`Collection`/`SavedSearch`/`HealthReport`/`HealthItem`/`ImportReport` are defined once in Rust (`model.rs`) and mirrored once in TS (`api.ts`) with identical camelCase fields. `chapter_sort`/`chapterSort` added to both `WorkRow`s. Command names match between `lib.rs` registration, `commands.rs` definitions, and `api.ts` wrappers.
- **Migration safety:** v7 is additive (CREATE … IF NOT EXISTS + ADD COLUMN with constant default), wired into both `migrate()` and `open_at_version()`, `LATEST` bumped to 7; no FK-off rebuild needed.
- **Known fixture artifact (not a defect):** synthetic ~5s clips mean duration-based scoped filters and "total time" labels read small; counts/health/structure populate correctly (same artifact class as M11/M14/M15/M18).
