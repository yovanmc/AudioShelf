# M17 — The Listening Journal (plan)

> **Written for Sonnet execution.** Every task lists exact files, complete code, exact
> commands, and expected output. **If something doesn't match what you find in the repo
> (a signature, a line, a struct), STOP and report rather than guess.** Line numbers are
> approximate — locate code by the quoted anchor text/pattern, not the line number.

## What this milestone is

AudioShelf's **signature** v5 feature: a private, local, **searchable** and **exportable**
record built on spoken audio's natural unit — the chapter. Seven sub-features, shipped broad
(one milestone, mirroring M16), unified into one Journal surface:

1. **Timestamped chapter notes** — annotate a passage; each note stores the position (seconds into the chapter) + a wall-clock `created_at`.
2. **Positional bookmarks** — seconds-into-chapter, optional label, **jump-to** (manual seek; never auto-resume).
3. **Per-chapter user summary** — one editable summary per chapter (searchable).
4. **Post-chapter takeaway** — one optional one-line reflection per chapter.
5. **Per-work "where I left off" note** — re-entry note, surfaced on the chapter/work UI (and optionally Home's Keep-listening card).
6. **Work-completion ritual** — one-word rating per work.
7. **"Listen again" favorites** — chapter-grain favorite flag, a Favorites section in the Journal.

Plus the unifying surface: a **Journal view** (browse + search + filter + **export Markdown/JSON**).

### Decisions locked at planning (do not re-litigate)

- **Scope = all 7** (broad single milestone, like M16).
- **Bookmarks are positional** — store integer seconds captured from the live `<audio>` element; user **manually jumps** to a bookmark. This does **NOT** auto-resume mid-chapter, so it stays within the standing **"no per-second mid-chapter resume"** non-goal. (It does introduce the app's first sub-chapter *seek*, used only on explicit jump.)
- **Export = Markdown + JSON** — Markdown for reading/sharing; JSON for structured backup. A save-file dialog (`@tauri-apps/plugin-dialog` `save()`, already a dep) picks the path; **Rust** writes the file via `std::fs::write` (consistent with the app writing only to user-chosen / app-private paths).

## Hard invariants (carry the streak forward correctly)

- **This milestone introduces migration v6** — additive only (2 new tables + 5 `ADD COLUMN`). Use the M16 runner exactly (`run_step` + atomic `PRAGMA user_version`). **No FK-off table-rebuild needed** (all additive). Do **not** edit `SCHEMA_V1`.
- **Read-only on disk for audio is preserved.** All new writes are SQLite rows. The **only** file the app writes is the user-chosen **export** file (a non-audio path the user picks) — call this out; it is not an audio mutation and the Rename tool remains the sole audio-file mutator.
- **Fixtures stay 43/44/47.** All journal data is seeded **at runtime** in the walkthrough (mirrors M9/M11). Do **not** touch `src-tauri/tests/fixture_scan.rs` or the on-disk fixtures.
- **Cargo-test gate** = "all green + fixture counts 43/44/47" (new Rust tests expected; the prior count grew to 95+ in M16).
- `serde_json` is used for JSON export. It is already in `Cargo.lock` (tauri depends on it). If it is **not** a direct entry in `src-tauri/Cargo.toml [dependencies]`, add `serde_json = "1"` — this reuses the already-locked version (no new transitive tree). Verify with `git diff --stat Cargo.lock` that only the lockfile's direct-dep marker (if anything) changed, not a fresh dependency subtree.
- **Subagents run cargo in the FOREGROUND** (`cmd /c "tools\dev-env.cmd cargo ..."`, large timeout). `npm run build` before any `cargo tauri build`. After a **frontend-only** change, force a Rust relink (`cargo clean -p audioshelf` or touch a Rust file) before re-running the screenshot harness (the debug-rebuild cache-hit gotcha).

## Schema — migration v6 (`journal`)

Single cohesive migration step (atomic transaction):

```sql
CREATE TABLE IF NOT EXISTS chapter_notes (
  id            INTEGER PRIMARY KEY,
  chapter_id    INTEGER NOT NULL REFERENCES chapters(id),
  position_secs INTEGER NOT NULL DEFAULT 0,
  body          TEXT    NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chapter_notes_chapter ON chapter_notes(chapter_id);

CREATE TABLE IF NOT EXISTS chapter_bookmarks (
  id            INTEGER PRIMARY KEY,
  chapter_id    INTEGER NOT NULL REFERENCES chapters(id),
  position_secs INTEGER NOT NULL,
  label         TEXT    NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chapter_bookmarks_chapter ON chapter_bookmarks(chapter_id);

ALTER TABLE chapters ADD COLUMN user_summary TEXT    NOT NULL DEFAULT '';
ALTER TABLE chapters ADD COLUMN takeaway     TEXT    NOT NULL DEFAULT '';
ALTER TABLE chapters ADD COLUMN is_favorite  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE works    ADD COLUMN re_entry_note     TEXT NOT NULL DEFAULT '';
ALTER TABLE works    ADD COLUMN completion_rating TEXT NOT NULL DEFAULT '';
```

Design notes:
- **Summary, takeaway, favorite are one-per-chapter** → columns on `chapters` (symmetric, cheap to read in the existing chapter SELECT). **Notes and bookmarks are many-per-chapter** → their own tables.
- **Re-entry note and completion rating are one-per-work** → columns on `works`.
- `position_secs` is an **integer** (floor of the player's float `currentTime`); seconds granularity is ample for chapter-at-a-time jump-to.

---

## Phase 1 — Migration v6 + upgrade tests  *(backend foundation)*

**File:** `src-tauri/src/db.rs`

**Task 1.1 — Add the migration step.** Find `migration_v5_transcripts` and the `migrate()` body
(the `if current < N { run_step(conn, N, ...)?; }` ladder) and the `const LATEST: i64 = 5;`.

Add, next to `migration_v5_transcripts`:

```rust
fn migration_v6_journal(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS chapter_notes (
           id            INTEGER PRIMARY KEY,
           chapter_id    INTEGER NOT NULL REFERENCES chapters(id),
           position_secs INTEGER NOT NULL DEFAULT 0,
           body          TEXT    NOT NULL,
           created_at    INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_chapter_notes_chapter ON chapter_notes(chapter_id);
         CREATE TABLE IF NOT EXISTS chapter_bookmarks (
           id            INTEGER PRIMARY KEY,
           chapter_id    INTEGER NOT NULL REFERENCES chapters(id),
           position_secs INTEGER NOT NULL,
           label         TEXT    NOT NULL DEFAULT '',
           created_at    INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_chapter_bookmarks_chapter ON chapter_bookmarks(chapter_id);
         ALTER TABLE chapters ADD COLUMN user_summary TEXT    NOT NULL DEFAULT '';
         ALTER TABLE chapters ADD COLUMN takeaway     TEXT    NOT NULL DEFAULT '';
         ALTER TABLE chapters ADD COLUMN is_favorite  INTEGER NOT NULL DEFAULT 0;
         ALTER TABLE works    ADD COLUMN re_entry_note     TEXT NOT NULL DEFAULT '';
         ALTER TABLE works    ADD COLUMN completion_rating TEXT NOT NULL DEFAULT '';",
    )
}
```

In `migrate()`, after the `if current < 5 { run_step(conn, 5, migration_v5_transcripts)?; }` line add:

```rust
    if current < 6 {
        run_step(conn, 6, migration_v6_journal)?;
    }
```

Bump `const LATEST: i64 = 5;` → `const LATEST: i64 = 6;`.

**Task 1.2 — Extend `open_at_version`.** In `pub fn open_at_version(version: i64)` find the
`if version >= 5 { migration_v5_transcripts(&conn)?; }` guard and append:

```rust
    if version >= 6 {
        migration_v6_journal(&conn)?;
    }
```

**Task 1.3 — Tests** (add to `db.rs` `#[cfg(test)] mod tests`, mirroring the existing
`open_at_version` / legacy-upgrade tests):

```rust
#[test]
fn migration_v6_adds_journal_tables_and_columns() {
    let conn = open_at_version(6).unwrap();
    // new tables exist
    for t in ["chapter_notes", "chapter_bookmarks"] {
        let n: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
                [t], |r| r.get(0),
            ).unwrap();
        assert_eq!(n, 1, "missing table {t}");
    }
    // new columns exist (PRAGMA table_info)
    let has_col = |table: &str, col: &str| -> bool {
        let mut s = conn.prepare(&format!("PRAGMA table_info({table})")).unwrap();
        s.query_map([], |r| r.get::<_, String>(1)).unwrap()
            .filter_map(Result::ok).any(|c| c == col)
    };
    assert!(has_col("chapters", "user_summary"));
    assert!(has_col("chapters", "takeaway"));
    assert!(has_col("chapters", "is_favorite"));
    assert!(has_col("works", "re_entry_note"));
    assert!(has_col("works", "completion_rating"));
    let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(v, 6);
}

#[test]
fn legacy_db_upgrades_through_v6() {
    // Open at v1 (legacy), run full migrate(), expect LATEST and journal columns present.
    let conn = open_at_version(1).unwrap();
    migrate(&conn).unwrap();
    let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(v, 6);
}
```

> If the existing legacy-upgrade test already asserts a specific `LATEST`, update that
> assertion to `6` too.

**Gate (Phase 1):** `cmd /c "tools\dev-env.cmd cargo test -p audioshelf --manifest-path src-tauri/Cargo.toml migration"` (and the two new tests) → all pass.

---

## Phase 2 — Scalar journal fields + their setter commands

**Task 2.1 — Models** (`src-tauri/src/model.rs`).

Extend `ChapterRow` (add after `pub tags: Vec<String>,`):

```rust
    pub user_summary: String,
    pub takeaway: String,
    pub is_favorite: bool,
```

Extend `WorkRow` (add after `pub tags: Vec<String>,`):

```rust
    pub re_entry_note: String,
    pub completion_rating: String,
```

> Every site that constructs a `ChapterRow`/`WorkRow` literal must now set these fields.
> Search the crate for `ChapterRow {` and `WorkRow {` and update each. Most are in
> `commands.rs` query builders and in `#[cfg(test)]` fixtures — set defaults
> (`String::new()`, `false`) where the value isn't under test. **If you find a constructor
> you can't confidently update, STOP and report.**

**Task 2.2 — Populate scalars in `query_author_detail`** (`commands.rs`).

Find the chapter SELECT inside `query_author_detail` (the one that fills `ChapterRow`
`id/title/chapter_no/format/duration_secs/file_path/played`). Add the three new columns to
the `SELECT` and the row mapping:

```rust
// add to the SELECT column list:  user_summary, takeaway, is_favorite
// in the row closure, map:
user_summary: r.get::<_, String>("user_summary").unwrap_or_default(),
takeaway:     r.get::<_, String>("takeaway").unwrap_or_default(),
is_favorite:  r.get::<_, i64>("is_favorite").unwrap_or(0) != 0,
// (tags Vec is still populated by the existing per-chapter loop)
```

> Match the existing access style (positional `r.get(n)` vs named `r.get("col")`). If the
> query uses positional indices, append the new columns at the end of the SELECT and use the
> next indices. Keep `tags` population (the separate `chapter_tags` loop) unchanged.

Likewise, in the work query that builds `WorkRow`, add `re_entry_note, completion_rating` to
the SELECT and map:

```rust
re_entry_note:     r.get::<_, String>("re_entry_note").unwrap_or_default(),
completion_rating: r.get::<_, String>("completion_rating").unwrap_or_default(),
```

**Task 2.3 — Setter commands** (`commands.rs`). Add (mirroring `set_work_tags`' lock+map style):

```rust
#[tauri::command]
pub fn set_chapter_summary(state: tauri::State<DbState>, chapter_id: i64, summary: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE chapters SET user_summary=?2 WHERE id=?1", params![chapter_id, summary.trim()])
        .map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_chapter_takeaway(state: tauri::State<DbState>, chapter_id: i64, takeaway: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE chapters SET takeaway=?2 WHERE id=?1", params![chapter_id, takeaway.trim()])
        .map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_chapter_favorite(state: tauri::State<DbState>, chapter_id: i64, favorite: bool) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE chapters SET is_favorite=?2 WHERE id=?1", params![chapter_id, favorite as i64])
        .map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_work_re_entry_note(state: tauri::State<DbState>, work_id: i64, note: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE works SET re_entry_note=?2 WHERE id=?1", params![work_id, note.trim()])
        .map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_work_rating(state: tauri::State<DbState>, work_id: i64, rating: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE works SET completion_rating=?2 WHERE id=?1", params![work_id, rating.trim()])
        .map(|_| ()).map_err(|e| e.to_string())
}
```

**Task 2.4 — Register** all five in `lib.rs` `invoke_handler![ ... ]` (append after the existing
`set_chapter_tags` group).

**Task 2.5 — Rust tests** (`commands.rs` tests): seed an author/work/chapter (use the existing
test-DB helper), call each setter, re-`query_author_detail`, assert the scalar round-trips
(e.g. `set_chapter_favorite(.., true)` → `chapter.is_favorite == true`; summary/takeaway/
re_entry/rating string round-trip).

**Gate (Phase 2):** `cargo test -p audioshelf` green; `cargo build` clean.

---

## Phase 3 — Notes & bookmarks (tables) — CRUD commands

**Task 3.1 — Models** (`model.rs`):

```rust
#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChapterNote {
    pub id: i64,
    pub chapter_id: i64,
    pub position_secs: i64,
    pub body: String,
    pub created_at: i64,
}

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChapterBookmark {
    pub id: i64,
    pub chapter_id: i64,
    pub position_secs: i64,
    pub label: String,
    pub created_at: i64,
}

#[derive(Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChapterJournal {
    pub notes: Vec<ChapterNote>,
    pub bookmarks: Vec<ChapterBookmark>,
}
```

**Task 3.2 — Commands** (`commands.rs`). `now_ms` is passed from the FE (the app already passes
`now_ms` to `query_home`; reuse that convention so timestamps stay deterministic in tests/harness):

```rust
#[tauri::command]
pub fn get_chapter_journal(state: tauri::State<DbState>, chapter_id: i64) -> Result<ChapterJournal, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    journal_for_chapter(&conn, chapter_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_chapter_note(state: tauri::State<DbState>, chapter_id: i64, position_secs: i64, body: String, now_ms: i64) -> Result<ChapterNote, String> {
    let body = body.trim().to_string();
    if body.is_empty() { return Err("note body is empty".into()); }
    let pos = position_secs.max(0);
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO chapter_notes(chapter_id, position_secs, body, created_at) VALUES (?1,?2,?3,?4)",
        params![chapter_id, pos, body, now_ms],
    ).map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    Ok(ChapterNote { id, chapter_id, position_secs: pos, body, created_at: now_ms })
}

#[tauri::command]
pub fn delete_chapter_note(state: tauri::State<DbState>, note_id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM chapter_notes WHERE id=?1", params![note_id]).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_bookmark(state: tauri::State<DbState>, chapter_id: i64, position_secs: i64, label: String, now_ms: i64) -> Result<ChapterBookmark, String> {
    let label = label.trim().to_string();
    let pos = position_secs.max(0);
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO chapter_bookmarks(chapter_id, position_secs, label, created_at) VALUES (?1,?2,?3,?4)",
        params![chapter_id, pos, label, now_ms],
    ).map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    Ok(ChapterBookmark { id, chapter_id, position_secs: pos, label, created_at: now_ms })
}

#[tauri::command]
pub fn delete_bookmark(state: tauri::State<DbState>, bookmark_id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM chapter_bookmarks WHERE id=?1", params![bookmark_id]).map(|_| ()).map_err(|e| e.to_string())
}
```

Helper (place near other `pub(crate)` query helpers):

```rust
pub(crate) fn journal_for_chapter(conn: &rusqlite::Connection, chapter_id: i64) -> rusqlite::Result<ChapterJournal> {
    let mut ns = conn.prepare(
        "SELECT id, chapter_id, position_secs, body, created_at
           FROM chapter_notes WHERE chapter_id=?1 ORDER BY position_secs, id")?;
    let notes = ns.query_map(params![chapter_id], |r| Ok(ChapterNote {
        id: r.get(0)?, chapter_id: r.get(1)?, position_secs: r.get(2)?, body: r.get(3)?, created_at: r.get(4)?,
    }))?.collect::<rusqlite::Result<Vec<_>>>()?;
    let mut bs = conn.prepare(
        "SELECT id, chapter_id, position_secs, label, created_at
           FROM chapter_bookmarks WHERE chapter_id=?1 ORDER BY position_secs, id")?;
    let bookmarks = bs.query_map(params![chapter_id], |r| Ok(ChapterBookmark {
        id: r.get(0)?, chapter_id: r.get(1)?, position_secs: r.get(2)?, label: r.get(3)?, created_at: r.get(4)?,
    }))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(ChapterJournal { notes, bookmarks })
}
```

**Task 3.3 — Register** all five commands in `lib.rs`.

**Task 3.4 — Rust tests:** add a note + a bookmark to a seeded chapter, `get_chapter_journal`
returns them ordered by `position_secs`; delete each → empty. Assert `add_chapter_note` with a
whitespace-only body returns `Err`.

**Gate (Phase 3):** `cargo test -p audioshelf` green.

---

## Phase 4 — Unified Journal query + Markdown/JSON export

**Task 4.1 — Models** (`model.rs`):

```rust
#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct JournalEntry {
    pub kind: String,            // "note" | "bookmark" | "summary" | "takeaway" | "favorite" | "re_entry" | "rating"
    pub author_id: i64,
    pub author_name: String,
    pub work_id: i64,
    pub work_title: String,
    pub chapter_id: Option<i64>,
    pub chapter_title: Option<String>,
    pub position_secs: Option<i64>,
    pub body: String,            // note/summary/takeaway text, bookmark label, rating word, etc.
    pub created_at: Option<i64>,
}

#[derive(Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct JournalResults {
    pub entries: Vec<JournalEntry>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JournalExportReport {
    pub path: String,
    pub format: String,
    pub entry_count: usize,
}
```

**Task 4.2 — `collect_journal` helper** (`commands.rs`). One pure function that gathers every
journal artifact across the library into a flat `Vec<JournalEntry>`, joined to author/work/
chapter context. Build it from these sources (all read-only):

- `chapter_notes` → kind `"note"` (body = note body, `position_secs`, `created_at`).
- `chapter_bookmarks` → kind `"bookmark"` (body = label or `""`, `position_secs`, `created_at`).
- `chapters.user_summary` (non-empty) → kind `"summary"`.
- `chapters.takeaway` (non-empty) → kind `"takeaway"`.
- `chapters.is_favorite = 1` → kind `"favorite"` (body = chapter title).
- `works.re_entry_note` (non-empty) → kind `"re_entry"` (no chapter).
- `works.completion_rating` (non-empty) → kind `"rating"` (no chapter).

Join shape (reuse the author→work→chapter join used elsewhere):
`authors a JOIN works w ON w.author_id=a.id JOIN chapters c ON c.work_id=w.id` for chapter-level
sources; `authors a JOIN works w` for the two work-level sources. Order entries by
`author_name, work_title, chapter_no, position_secs` (stable, deterministic). Use the existing
author display-name resolution (the `set_author_display_name` override) the same way
`query_authors` does — **if there's a helper for resolved author name, reuse it; otherwise use
`authors.display_name`/`name` exactly as `query_authors` does.**

```rust
pub(crate) fn collect_journal(conn: &rusqlite::Connection) -> rusqlite::Result<Vec<JournalEntry>> {
    let mut out: Vec<JournalEntry> = Vec::new();
    // notes
    {
        let mut s = conn.prepare(
            "SELECT a.id, <author_name_expr>, w.id, w.base_title, c.id, c.raw_filename,
                    n.position_secs, n.body, n.created_at
               FROM chapter_notes n
               JOIN chapters c ON c.id=n.chapter_id
               JOIN works    w ON w.id=c.work_id
               JOIN authors  a ON a.id=w.author_id")?;
        let rows = s.query_map([], |r| Ok(JournalEntry {
            kind: "note".into(),
            author_id: r.get(0)?, author_name: r.get(1)?,
            work_id: r.get(2)?, work_title: r.get(3)?,
            chapter_id: Some(r.get(4)?), chapter_title: Some(strip_ext(r.get::<_,String>(5)?)),
            position_secs: Some(r.get(6)?), body: r.get(7)?, created_at: Some(r.get(8)?),
        }))?;
        for e in rows { out.push(e?); }
    }
    // ... bookmarks (kind "bookmark", body = label), summaries, takeaways, favorites,
    //     re_entry (work-level, chapter_id None), rating (work-level) — same shape.
    out.sort_by(|x, y| (&x.author_name, &x.work_title, x.chapter_id, x.position_secs)
        .cmp(&(&y.author_name, &y.work_title, y.chapter_id, y.position_secs)));
    Ok(out)
}
```

> `<author_name_expr>` and `strip_ext` / chapter-title derivation must match how the rest of
> `commands.rs` derives them (the digest shows `ChapterRow.title` = `raw_filename` without
> extension). Reuse the existing helper if one exists; otherwise inline the same `rsplit('.')`
> logic already used to build `ChapterRow.title`. **If you cannot find how `title` is derived,
> STOP and report** rather than inventing a second convention.

**Task 4.3 — `query_journal` command** (browse + search). Empty/whitespace query → all entries
(browsable). Non-empty → keep entries whose `body`, `work_title`, `chapter_title`, or
`author_name` contains the query (case-insensitive `LIKE`-style, reuse the existing
`like_contains`/`to_lowercase` approach — do the filter **in Rust** over the collected vec to
avoid 7 parameterized LIKE queries):

```rust
#[tauri::command]
pub fn query_journal(state: tauri::State<DbState>, query: String) -> Result<JournalResults, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let all = collect_journal(&conn).map_err(|e| e.to_string())?;
    let q = query.trim().to_lowercase();
    let entries = if q.is_empty() {
        all
    } else {
        all.into_iter().filter(|e| {
            e.body.to_lowercase().contains(&q)
                || e.work_title.to_lowercase().contains(&q)
                || e.author_name.to_lowercase().contains(&q)
                || e.chapter_title.as_deref().map_or(false, |t| t.to_lowercase().contains(&q))
        }).collect()
    };
    Ok(JournalResults { entries })
}
```

**Task 4.4 — Export builders** (`commands.rs`, pure + unit-testable):

```rust
pub(crate) fn build_journal_markdown(entries: &[JournalEntry]) -> String {
    // Group by author → work; within a work list chapter-level entries then work-level.
    // Example shape:
    // # AudioShelf — Listening Journal
    //
    // ## <Author>
    // ### <Work>  [rating: <word>]
    // _Where I left off:_ <re_entry>
    // - **Note** (Ch <chapter_title> @ m:ss): <body>
    // - **Bookmark** (Ch <chapter_title> @ m:ss): <label>
    // - **Summary** (Ch <chapter_title>): <body>
    // - **Takeaway** (Ch <chapter_title>): <body>
    // - **★ Favorite**: <chapter_title>
    // Use a small fmt_pos(secs)->"m:ss" helper (reuse src player formatting convention).
    // Deterministic ordering (entries already sorted).
    unimplemented!("implement per the shape above")
}

pub(crate) fn build_journal_json(entries: &[JournalEntry]) -> Result<String, String> {
    serde_json::to_string_pretty(entries).map_err(|e| e.to_string())
}
```

**Task 4.5 — `export_journal` command** (writes the file; the path comes from the FE save
dialog):

```rust
#[tauri::command]
pub fn export_journal(state: tauri::State<DbState>, path: String, format: String) -> Result<JournalExportReport, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let entries = collect_journal(&conn).map_err(|e| e.to_string())?;
    let contents = match format.as_str() {
        "markdown" => build_journal_markdown(&entries),
        "json" => build_journal_json(&entries)?,
        other => return Err(format!("unknown export format: {other}")),
    };
    std::fs::write(&path, contents).map_err(|e| format!("write failed: {e}"))?;
    Ok(JournalExportReport { path, format, entry_count: entries.len() })
}
```

> **Read-only-on-disk note for the PR description:** `export_journal` is the only new file
> write; it writes to a **user-chosen non-audio path** (from the save dialog), never an audio
> file. The Rename tool remains the sole audio-file mutator.

**Task 4.6 — Register** `query_journal` and `export_journal` in `lib.rs`.

**Task 4.7 — `serde_json` availability.** Build; if `serde_json` is unresolved, add
`serde_json = "1"` to `src-tauri/Cargo.toml [dependencies]` and rebuild. Confirm
`git diff --stat src-tauri/Cargo.lock` shows no new dependency subtree (only, at most, the
direct-dep line) — `serde_json` is already transitively locked by tauri.

**Task 4.8 — Rust tests:** seed a chapter with a note, a bookmark, summary, takeaway, favorite,
and a work re-entry note + rating; assert `collect_journal` returns all 7 kinds;
`query_journal("")` returns all, `query_journal(<word in a note>)` narrows to it;
`build_journal_json` round-trips via `serde_json::from_str::<Vec<JournalEntry>>`;
`build_journal_markdown` contains the author/work headings and each kind's marker.

**Gate (Phase 4):** `cargo test -p audioshelf` green; `cargo build` clean; lockfile check done.

---

## Phase 5 — Frontend API + chapter/work journal editing UI

**Task 5.1 — API wrappers + types** (`src/lib/api.ts`). Add types mirroring the Rust structs
(camelCase) and `invoke` wrappers (pass `nowMs` where the command takes `now_ms`; the FE already
computes `Date.now()` for `queryHome` — reuse that):

```typescript
export interface ChapterNote { id: number; chapterId: number; positionSecs: number; body: string; createdAt: number; }
export interface ChapterBookmark { id: number; chapterId: number; positionSecs: number; label: string; createdAt: number; }
export interface ChapterJournal { notes: ChapterNote[]; bookmarks: ChapterBookmark[]; }
export interface JournalEntry {
  kind: "note"|"bookmark"|"summary"|"takeaway"|"favorite"|"re_entry"|"rating";
  authorId: number; authorName: string; workId: number; workTitle: string;
  chapterId: number | null; chapterTitle: string | null;
  positionSecs: number | null; body: string; createdAt: number | null;
}
export interface JournalResults { entries: JournalEntry[]; }
export interface JournalExportReport { path: string; format: string; entryCount: number; }

// extend ChapterRow / WorkRow interfaces:
//   ChapterRow += userSummary: string; takeaway: string; isFavorite: boolean;
//   WorkRow    += reEntryNote: string; completionRating: string;

export const setChapterSummary = (chapterId: number, summary: string) => invoke("set_chapter_summary", { chapterId, summary });
export const setChapterTakeaway = (chapterId: number, takeaway: string) => invoke("set_chapter_takeaway", { chapterId, takeaway });
export const setChapterFavorite = (chapterId: number, favorite: boolean) => invoke("set_chapter_favorite", { chapterId, favorite });
export const setWorkReEntryNote = (workId: number, note: string) => invoke("set_work_re_entry_note", { workId, note });
export const setWorkRating = (workId: number, rating: string) => invoke("set_work_rating", { workId, rating });
export const getChapterJournal = (chapterId: number) => invoke<ChapterJournal>("get_chapter_journal", { chapterId });
export const addChapterNote = (chapterId: number, positionSecs: number, body: string) =>
  invoke<ChapterNote>("add_chapter_note", { chapterId, positionSecs, body, nowMs: Date.now() });
export const deleteChapterNote = (noteId: number) => invoke("delete_chapter_note", { noteId });
export const addBookmark = (chapterId: number, positionSecs: number, label: string) =>
  invoke<ChapterBookmark>("add_bookmark", { chapterId, positionSecs, label, nowMs: Date.now() });
export const deleteBookmark = (bookmarkId: number) => invoke("delete_bookmark", { bookmarkId });
export const queryJournal = (query: string) => invoke<JournalResults>("query_journal", { query });
export const exportJournal = (path: string, format: "markdown"|"json") => invoke<JournalExportReport>("export_journal", { path, format });
```

> Any test helper / mock that constructs a `ChapterRow`/`WorkRow` literal in TS must add the new
> fields. Search `src/**` for inline `ChapterRow`/`WorkRow`-shaped fixtures and update them
> (use `userSummary: ""`, `takeaway: ""`, `isFavorite: false`, `reEntryNote: ""`,
> `completionRating: ""`).

**Task 5.2 — Chapter Journal dialog** (`AuthorDetailView`). The M13 per-chapter overflow menu
already opens editors in a `Dialog`. Add a **"Journal"** menu item that opens a
`ChapterJournalDialog` (new pure component, App supplies data + handlers):

- **Summary** — a `<textarea>` bound to `chapter.userSummary`, "Save" → `onSetSummary(chapterId, text)`.
- **Takeaway** — a one-line `<input>` bound to `chapter.takeaway`, "Save" → `onSetTakeaway`.
- **Favorite** — a ★ toggle button (`aria-pressed`), `onSetFavorite(chapterId, !isFavorite)`.
- **Notes** — list (each: `m:ss` position · body · Delete) + an "Add note" row (position input
  defaulting to 0, body input) → `onAddNote(chapterId, positionSecs, body)`.
- **Bookmarks** — list (each: `m:ss` · label · Delete) + add row → `onAddBookmark`.

The dialog receives `journal: ChapterJournal` (notes/bookmarks) fetched by App via
`getChapterJournal(chapterId)` when the dialog opens (keep the component pure — App owns the
fetch + refresh-after-mutation, exactly like M13's edit dialogs own state in App).

**Task 5.3 — Work-level UI** (`AuthorDetailView`, per-work header). Under each work heading add:
- a compact **"Where I left off"** editable note (`reEntryNote`) → `onSetReEntryNote(workId, text)`.
- a **one-word rating** input/select (`completionRating`) → `onSetWorkRating(workId, word)`.

Keep these inline + token-styled, consistent with the existing work `TagEditor` placement.

**Task 5.4 — App wiring** (`App.tsx`). Add the handler functions (each `invoke`s then refreshes
the open author detail — reuse the existing `getAuthorDetail` refresh pattern after tag edits)
and `journal`/dialog state. After any chapter-journal mutation, re-fetch
`getChapterJournal(chapterId)` to refresh the dialog and re-fetch author detail so the chapter's
scalar fields (favorite star, summary presence) update.

**Task 5.5 — FE tests** (`*.test.tsx`): `ChapterJournalDialog` renders seeded notes/bookmarks,
fires `onAddNote`/`onAddBookmark`/`onSetFavorite`/`onSetSummary` with the right args; favorite
toggle reflects `isFavorite`. Work-level: rating + re-entry inputs fire their callbacks.

**Gate (Phase 5):** `npx tsc --noEmit` clean; `npm test` green.

---

## Phase 6 — Journal view (route) + player capture + jump-to-bookmark

**Task 6.1 — Route + nav** (`App.tsx`, sidebar). Add `"journal"` to the `Route` union; add a
**Journal** sidebar nav item (use an existing book/journal-ish local SVG from `Icon.tsx`; if
none fits, add one small icon following the M12 `Icon` pattern — local SVG, no dep). App holds
`journal: JournalResults | null` + `journalQuery` and `loadJournal(query)`.

**Task 6.2 — `JournalView.tsx`** (pure renderer, App supplies data):
- A search `<input>` (debounced ~150ms like Library search) → `onSearch(query)` → App calls `queryJournal`.
- **Filter chips** by kind (All · Notes · Bookmarks · Summaries · Takeaways · Favorites · Ratings) — client-side filter over `entries`.
- Entries grouped by author → work (reuse `CreatorIdentity`/`WorkCard` chrome where natural);
  each entry shows its kind badge, chapter title + `m:ss` position when present, and body.
- A **Favorites** affordance (chips already cover it; ensure favorites render as a clear section/filter).
- **Export** control: a small menu "Export ▾" → "Markdown" / "JSON" → `onExport(format)`.

**Task 6.3 — Export save flow** (`App.tsx`). Use `@tauri-apps/plugin-dialog` `save()`:

```typescript
import { save } from "@tauri-apps/plugin-dialog";

async function handleExportJournal(format: "markdown" | "json") {
  const path = await save({
    defaultPath: format === "markdown" ? "audioshelf-journal.md" : "audioshelf-journal.json",
    filters: [{ name: format === "markdown" ? "Markdown" : "JSON", extensions: [format === "markdown" ? "md" : "json"] }],
  });
  if (!path) return; // user cancelled
  const report = await exportJournal(path, format);
  // surface a small confirmation (reuse whatever toast/inline-status pattern exists; else console + a transient message)
}
```

> **Capability:** the dialog plugin's `save` needs a permission. Open
> `src-tauri/capabilities/default.json` (the M6 file that grants `dialog:default` for the
> folder picker). If `save` is not already permitted, add `"dialog:allow-save"` to the
> `permissions` array. Rebuild; if `save()` throws a "not allowed" error at runtime, this is the
> fix. **No `fs` plugin is needed** — the file write happens in Rust (`export_journal`).

**Task 6.4 — Player capture + jump-to** (`App.tsx` + `NowPlayingPanel.tsx`).

In `NowPlayingPanel`, add (only when a chapter is playing):
- **"Add note here"** → `onAddNoteHere(Math.floor(currentTime))` (opens a tiny inline body
  input, or prompts; App inserts via `addChapterNote(current.chapter.id, pos, body)`).
- **"Bookmark this moment"** → `onAddBookmarkHere(Math.floor(currentTime))` (optional label) →
  `addBookmark(current.chapter.id, pos, label)`.
- **★ Favorite** toggle for the current chapter.
- The current chapter's **bookmarks list** (fetched by App via `getChapterJournal` keyed on
  `current.chapter.id`, mirroring the M14 chapters-in-this-work effect) — each row shows
  `m:ss` + label and a **Jump** button.

**Jump-to-bookmark** (the one new sub-chapter *seek* — manual only, never auto-resume):

```typescript
const pendingSeekRef = useRef<number | null>(null);

// audio element:
onLoadedMetadata={(e) => {
  setDuration(e.currentTarget.duration || 0);
  if (pendingSeekRef.current != null) {
    try { e.currentTarget.currentTime = pendingSeekRef.current; } catch {}
    pendingSeekRef.current = null;
  }
}}

function jumpToBookmark(b: ChapterBookmark) {
  const cur = currentRef.current;
  if (cur && cur.chapter.id === b.chapterId && audioRef.current) {
    audioRef.current.currentTime = b.positionSecs;       // same chapter → seek directly
    return;
  }
  pendingSeekRef.current = b.positionSecs;                // different chapter → load then seek
  void playChapterById(b.chapterId);                      // resolve context via getAuthorDetail (reuse M14 jumpToChapter's pattern)
}
```

> `playChapterById` mirrors M14's `jumpToChapter`: fetch `getAuthorDetail(authorId)` to rebuild a
> `PlaybackContext`, then call the existing `playChapter`. If you must resolve the author from the
> chapter id (the Journal "Jump" is outside author-detail), have the relevant `JournalEntry` /
> `ChapterBookmark` carry enough context, or add a thin lookup. Keep the **chapter-at-a-time** model
> intact — the seek is applied only after `loadedmetadata`, and only on explicit jump.

**Task 6.5 — FE tests:** `JournalView` renders grouped entries, kind filter narrows them, the
search input fires `onSearch`, the Export menu fires `onExport("markdown"|"json")`.
`NowPlayingPanel`: "Add note here"/"Bookmark this moment" fire with `Math.floor(currentTime)`;
bookmark "Jump" fires `onJump(bookmark)`. Mock `@tauri-apps/plugin-dialog` `save` in the export
test (`vi.mock`).

**Gate (Phase 6):** `npx tsc --noEmit` clean; `npm test` green.

---

## Phase 7 — Harness walkthrough + gates + screenshot verification

**Task 7.1 — `journal` walkthrough** (`src/harness/walkthroughs.ts` + the nav glue). Add
`"journal"` to the `walkthroughs` tuple and `runner.test.ts` order. Steps (seed everything at
**runtime**, so fixtures stay 43/44/47):

1. `journal-empty` — open the Journal view before seeding → "Nothing in your journal yet" empty state.
2. `journal-chapter-edit` — open an author, open a chapter's **Journal dialog**, seed a summary +
   takeaway + favorite + one note (position 12s) + one bookmark (position 30s, label "key idea"),
   capture the dialog.
3. `journal-work-meta` — set a work's **re-entry note** + **one-word rating**, capture the work header.
4. `journal-browse` — open the Journal view (now populated): entries grouped, kind chips visible.
5. `journal-search` — type a word from the seeded note → filtered results.
6. `now-playing-bookmarks` — play the seeded chapter, open Now Playing, show the **bookmarks list +
   Jump** and the "Add note here"/"Bookmark this moment" controls.

> Reuse the runtime-seeding approach from the `home`/`tags` walkthroughs (call the new `invoke`
> wrappers directly in the step `run`). Use the harness-only `reset_play_history` for the empty
> state if play-events leak across runs (the known shared-DB gotcha).

**Task 7.2 — Run all gates** (FOREGROUND):
- `cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri/Cargo.toml"` → all green, and the
  `fixture_scan` test still reads **43/44/47**.
- `npx tsc --noEmit` → clean.
- `npm test` → green.
- `npm run build` then a forced Rust relink (`cargo clean -p audioshelf` **or** touch a Rust file),
  then `cargo tauri build --debug`.
- `tools\verify.ps1 -Walkthrough journal` (then regression: `m16`, `m12`).

**Task 7.3 — Screenshot verification (in a Sonnet subagent, text verdict only).** Dispatch a
subagent to Read the `journal` PNGs **plus** the `m16` + `m12` regression shots and return a
PASS/FAIL text verdict with the absolute paths it viewed. Acceptance criteria:
- `journal-empty` shows a real empty state (no entries, no crash).
- The chapter Journal dialog shows summary + takeaway + ★ favorite + the seeded note (at `0:12`)
  and bookmark (`0:30` "key idea").
- The work header shows the re-entry note + rating word.
- `journal-browse` groups entries by author→work with kind badges; `journal-search` narrows.
- `now-playing-bookmarks` shows the bookmark with a **Jump** control + the capture buttons.
- `m16` + `m12` matrices unregressed (only the new **Journal** sidebar nav item is an expected
  cross-screen change).

> **Do not load PNGs into the controller context.** Act on the subagent's text verdict; only Read
> a PNG into the main session if the user explicitly asks to see one.

**Task 7.4 — Finish:** push branch → open PR → `gh pr checks <PR#> --watch` (sleep ~20s first) →
merge `--merge --delete-branch` from main → sync main → flip the ROADMAP M17 row to ✅ Merged with
the PR # + a one-line summary → append a decision-log entry (schema v6, the 3 locked decisions,
any gotchas) → commit/push → ping the user with the paste-ready next-milestone (M18) handoff.

---

## Acceptance criteria (definition of done)

- Migration **v6** applies cleanly on fresh + legacy DBs; `PRAGMA user_version = 6`; all additive.
- All seven sub-features work end-to-end: per-chapter notes (positional) · positional bookmarks
  with **jump-to** · per-chapter summary · takeaway · favorite · per-work re-entry note ·
  one-word completion rating.
- A unified **Journal view** browses + searches every artifact and **exports Markdown + JSON**
  to a user-chosen path.
- Bookmarks store integer seconds and jump-to seeks **only on explicit user action** (no
  auto-resume) — the "no per-second mid-chapter resume" non-goal is intact.
- **Read-only on disk for audio preserved** (only new file write is the user-chosen export).
- **Fixtures 43/44/47**; `fixture_scan.rs` untouched; no unexpected `Cargo.lock` subtree churn.
- Gates: `cargo test` all green · `tsc` clean · `npm test` green · `journal` walkthrough +
  `m16`/`m12` regression subagent-verified **PASS**.

## Risks & gotchas

- **Struct-literal fan-out:** adding fields to `ChapterRow`/`WorkRow` breaks every literal
  constructor (Rust + TS test fixtures). Grep and fix all; STOP if a constructor is unclear.
- **Author-name / chapter-title derivation:** `collect_journal` must reuse the *existing*
  resolved-author-name and `raw_filename`→title conventions, not invent new ones.
- **Dialog `save` capability:** if export throws "not allowed", add `dialog:allow-save` to
  `capabilities/default.json` (gated plugin commands, per the M6 note).
- **Debug-rebuild cache hit:** force a Rust relink after the FE-heavy Phase 6 before the harness.
- **Shared app-data DB across harness runs:** use `reset_play_history` for the empty-journal shot
  if prior play-events leak.
- **`serde_json`:** reuse the already-locked version; verify no new dependency subtree.
