# AudioShelf — Milestone 5: Grouping-Override Review UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.
>
> **This plan is written to be executed entirely by Sonnet.** Every task gives exact file paths, full code, exact commands, and expected output. Do not improvise — if something doesn't match, STOP and report rather than guessing.

**Goal:** Let the user review and correct the heuristic filename→work grouping inline on the Author Detail view: per-chapter editable **Work title** and **Chapter #** fields (plus a **Reset to auto** button) that write to `grouping_overrides` and immediately re-group that author. Merge = type a matching work title on two chapters; split = type a new unique title; reassign = change the number. Overrides are stored in the DB, applied on top of the heuristic, re-applied on every scan, and **never written to disk**.

**Architecture:** A new DB-only `regroup.rs::regroup_author(conn, author_id)` recomputes each chapter's heuristic baseline from its raw filename (reusing `grouping::group_author`), overlays any `grouping_overrides` row (base_title / chapter_no), then rewrites work assignments in SQLite — no disk access, no duration re-probe, idempotent. It is called both by the new `set_grouping_override` / `clear_grouping_override` commands (which return the fresh `AuthorDetail`) and at the end of each author's `scan_into` pass (so overrides survive re-scans). The front-end adds inline edit controls to `AuthorDetailView`. A `grouping` harness walkthrough does a merge→reset round-trip.

**Tech Stack:** Rust (rusqlite), React 18 + TS, Vitest. No new dependencies. No schema change (`grouping_overrides(chapter_path TEXT PRIMARY KEY, base_title TEXT, chapter_no INTEGER)` already exists, currently unused).

**Reference (existing shapes this builds on):**
- `src-tauri/src/db.rs` — `grouping_overrides(chapter_path PRIMARY KEY, base_title, chapter_no)`; `works(id, author_id, base_title, sort_key, status, UNIQUE(author_id, base_title))`; `chapters(id, work_id, file_path UNIQUE, raw_filename, chapter_no, format, duration_secs, played, status)`.
- `src-tauri/src/grouping.rs` — `group_author(&[String]) -> Vec<Work>`; `Work { base_title, chapters: Vec<Chapter> }`; `Chapter { stem, original_stem, chapter_no: u32 }`. `original_stem` is the verbatim input stem.
- `src-tauri/src/scan.rs` — `scan_into(conn, root)`; per-author loop upserts works (UPSERT ON CONFLICT(author_id, base_title) … SET status='active') then chapters; `count(conn, table)` counts `status='active'`.
- `src-tauri/src/commands.rs` — `DbState`, `query_author_detail(conn, author_id) -> AuthorDetail`, `#[tauri::command]` returning `Result<_, String>`, `#[cfg(test)] mod tests` using `tempfile::tempdir()` + `db::open_in_memory()` + `scan::scan_into` + `touch()`.
- `src-tauri/src/model.rs` — `AuthorDetail { id, name, tags, works }`, `WorkRow { id, base_title, chapters }`, `ChapterRow { id, title, chapter_no, format, duration_secs, file_path, played }` (serde camelCase). **No model change in M5.**
- `src-tauri/src/lib.rs` — module list, `invoke_handler![...]`, `pub mod testing { ... }`.
- `src/lib/api.ts` — `invoke<T>(cmd,args)` wrappers; `AuthorDetail`/`ChapterRow`/`WorkRow` types.
- `src/views/AuthorDetailView.tsx` — props `{ detail, onTogglePlayed, onPlayChapter, onSetTags, allTags, onBack }`; renders `TagEditor` + works→chapters. `src/views/AuthorDetailView.test.tsx`.
- `src/App.tsx` — `openAuthor` loads detail via `getAuthorDetail`; `togglePlayed` pattern refreshes `setDetail` + `loadAuthors`; harness dispatch ternary keyed on `args.walkthrough` (browse/player/discovery/rename); `settle()` before capture.
- `src/harness/walkthroughs.ts` — `walkthroughs` tuple + per-walkthrough `*Steps` builders. `src/harness/types.ts` — `Step { name, run }`.

**Conventions:** Windows; cargo via `cmd /c "tools\dev-env.cmd cargo ..."` in the FOREGROUND with a LARGE timeout (300000 ms); `npm run build` before any `cargo tauri build`; commit per task, human author (`yovanmc <yovanmc@users.noreply.github.com>`) + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`, **no Codex trailer**.

**App ships NO stylesheet in v1** — render plain HTML controls, consistent with the rest of the app. Do not add CSS.

---

## Core semantics (read this first)

- **Heuristic baseline** for a chapter = run `group_author` on the author's current raw-filename stems; this maps each `original_stem → (base_title, chapter_no)`. This is recomputed fresh every regroup, so clearing an override always returns to the pristine heuristic.
- **Override** = a `grouping_overrides` row keyed by the chapter's **current `file_path`**. `base_title` (nullable) and `chapter_no` (nullable) overlay the heuristic: `final_base = override.base_title (if non-empty) else heuristic_base`; `final_no = override.chapter_no (if present) else heuristic_no`.
- **Regroup** = assign every chapter to the work named by its `final_base` (creating/reactivating that work, deactivating works left empty), and set `chapter_no = final_no`. DB-only, idempotent.
- **UI contract:** the per-chapter form always sends BOTH the intended work title and chapter number together (so `set_grouping_override` always receives the full intended pair). **Reset** clears the row → back to heuristic.
- **Known v1 limitation (document, don't fix):** overrides are keyed on `file_path`, so running the M4 rename tool on an overridden chapter orphans its override row. Acceptable for v1.

---

## File Structure

- **Create** `src-tauri/src/regroup.rs` — `regroup_author(conn, author_id)` + unit tests (merge / split / reset).
- **Modify** `src-tauri/src/scan.rs` — call `regroup_author` at the end of each author's pass so overrides survive re-scans; add a test.
- **Modify** `src-tauri/src/commands.rs` — `set_grouping_override`, `clear_grouping_override` commands (write the table, regroup, return fresh `AuthorDetail`) + tests.
- **Modify** `src-tauri/src/lib.rs` — `mod regroup;`, register the 2 commands, export `regroup_author` under `pub mod testing`.
- **Modify** `src/lib/api.ts` — `setGroupingOverride` / `clearGroupingOverride` wrappers.
- **Modify** `src/views/AuthorDetailView.tsx` (+ test) — per-chapter Work/Ch# edit form + Reset; new props `onSetGrouping`, `onClearGrouping`.
- **Modify** `src/App.tsx` — `setGrouping` / `clearGrouping` handlers; pass to `AuthorDetailView`; `grouping` harness branch.
- **Modify** `src/harness/walkthroughs.ts` — `groupingSteps`, add `"grouping"` to `walkthroughs`.
- **Create** `src-tauri/tests/grouping_roundtrip.rs` — end-to-end merge → reset via regroup.
- **Modify** `README.md` — Grouping review section; `grouping` walkthrough; mark M5 Shipped.

---

## Task 1: `regroup.rs` — `regroup_author`

**Files:**
- Create: `src-tauri/src/regroup.rs`
- Test: same file, `#[cfg(test)] mod tests`

- [ ] **Step 1: Add the module.** In `src-tauri/src/lib.rs` add `mod regroup;` in the module list (keep alphabetical-ish, e.g. after `mod natsort;`).

- [ ] **Step 2: Write the implementation.**

```rust
//! regroup.rs — apply per-chapter grouping overrides on top of the heuristic.
//! DB-only: reads each chapter's raw filename, recomputes the heuristic grouping,
//! overlays `grouping_overrides`, and rewrites work assignments. No disk access,
//! no duration re-probe. Idempotent. The ONLY override-aware regrouping path.

use crate::grouping::group_author;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;

fn stem_of(raw: &str) -> String {
    std::path::Path::new(raw)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// Recompute `author_id`'s work grouping from the heuristic + overrides.
pub fn regroup_author(conn: &Connection, author_id: i64) -> rusqlite::Result<()> {
    // 1. Load this author's active chapters.
    struct Ch { id: i64, path: String, raw: String }
    let chapters: Vec<Ch> = {
        let mut stmt = conn.prepare(
            "SELECT c.id, c.file_path, c.raw_filename
             FROM chapters c JOIN works w ON c.work_id = w.id
             WHERE w.author_id = ?1 AND c.status='active'",
        )?;
        let rows = stmt
            .query_map(params![author_id], |r| {
                Ok(Ch { id: r.get(0)?, path: r.get(1)?, raw: r.get(2)? })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    if chapters.is_empty() {
        return Ok(());
    }

    // 2. Heuristic baseline: original_stem -> (base_title, chapter_no).
    let stems: Vec<String> = chapters.iter().map(|c| stem_of(&c.raw)).collect();
    let mut heuristic: HashMap<String, (String, i64)> = HashMap::new();
    for w in group_author(&stems) {
        for ch in w.chapters {
            heuristic.insert(ch.original_stem.clone(), (w.base_title.clone(), ch.chapter_no as i64));
        }
    }

    // 3. Compute final (base, chapter_no) per chapter, overlaying overrides.
    struct Final { id: i64, base: String, no: i64 }
    let mut finals: Vec<Final> = Vec::with_capacity(chapters.len());
    {
        let mut ostmt =
            conn.prepare("SELECT base_title, chapter_no FROM grouping_overrides WHERE chapter_path=?1")?;
        for c in &chapters {
            let stem = stem_of(&c.raw);
            let (mut base, mut no) = heuristic.get(&stem).cloned().unwrap_or((stem.clone(), 1));
            let row: Option<(Option<String>, Option<i64>)> = ostmt
                .query_row(params![c.path], |r| Ok((r.get(0)?, r.get(1)?)))
                .optional()?;
            if let Some((ob, on)) = row {
                if let Some(b) = ob {
                    if !b.trim().is_empty() {
                        base = b.trim().to_string();
                    }
                }
                if let Some(n) = on {
                    no = n;
                }
            }
            finals.push(Final { id: c.id, base, no });
        }
    }

    // 4. Deactivate all the author's works, then reactivate the needed ones and
    //    reassign chapters. Works left with no active chapters stay inactive.
    conn.execute("UPDATE works SET status='inactive' WHERE author_id=?1", params![author_id])?;
    let mut base_to_work: HashMap<String, i64> = HashMap::new();
    for f in &finals {
        if !base_to_work.contains_key(&f.base) {
            conn.execute(
                "INSERT INTO works(author_id, base_title, sort_key, status)
                 VALUES (?1, ?2, ?3, 'active')
                 ON CONFLICT(author_id, base_title) DO UPDATE SET status='active'",
                params![author_id, f.base, f.base.to_lowercase()],
            )?;
            let id: i64 = conn.query_row(
                "SELECT id FROM works WHERE author_id=?1 AND base_title=?2",
                params![author_id, f.base],
                |r| r.get(0),
            )?;
            base_to_work.insert(f.base.clone(), id);
        }
        let wid = base_to_work[&f.base];
        conn.execute(
            "UPDATE chapters SET work_id=?2, chapter_no=?3 WHERE id=?1",
            params![f.id, wid, f.no],
        )?;
    }
    Ok(())
}
```

- [ ] **Step 3: Write the tests** (append `#[cfg(test)] mod tests`).

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::{query_author_detail, query_authors};
    use crate::db::open_in_memory;
    use crate::scan::scan_into;
    use std::fs::{self, File};
    use std::path::Path;

    fn touch(path: &Path) {
        if let Some(p) = path.parent() { fs::create_dir_all(p).unwrap(); }
        File::create(path).unwrap();
    }

    fn setup() -> (tempfile::TempDir, rusqlite::Connection, i64) {
        let tmp = tempfile::tempdir().unwrap();
        let author = tmp.path().join("Jane Doe");
        touch(&author.join("Cool Story.mp3"));
        touch(&author.join("Cool Story 2 the sequel.mp3"));
        touch(&author.join("Cool Story 3 finale.mp3"));
        touch(&author.join("Another Standalone Tale.mp3"));
        let conn = open_in_memory().unwrap();
        scan_into(&conn, tmp.path()).unwrap();
        let id = query_authors(&conn).unwrap()[0].id;
        (tmp, conn, id)
    }

    fn chapter_path(conn: &rusqlite::Connection, raw_like: &str) -> String {
        conn.query_row(
            "SELECT file_path FROM chapters WHERE raw_filename=?1",
            params![raw_like], |r| r.get(0)).unwrap()
    }

    #[test]
    fn baseline_grouping_is_two_works() {
        let (_t, conn, id) = setup();
        let d = query_author_detail(&conn, id).unwrap();
        assert_eq!(d.works.len(), 2);
    }

    #[test]
    fn override_merges_standalone_into_existing_work() {
        let (_t, conn, id) = setup();
        let path = chapter_path(&conn, "Another Standalone Tale.mp3");
        conn.execute(
            "INSERT INTO grouping_overrides(chapter_path, base_title, chapter_no) VALUES (?1,'Cool Story',4)",
            params![path]).unwrap();
        regroup_author(&conn, id).unwrap();

        let d = query_author_detail(&conn, id).unwrap();
        assert_eq!(d.works.len(), 1);
        let cool = &d.works[0];
        assert_eq!(cool.base_title, "Cool Story");
        assert_eq!(cool.chapters.len(), 4);
        assert_eq!(cool.chapters.last().unwrap().chapter_no, 4);
    }

    #[test]
    fn override_splits_a_chapter_into_a_new_work() {
        let (_t, conn, id) = setup();
        let path = chapter_path(&conn, "Cool Story 2 the sequel.mp3");
        conn.execute(
            "INSERT INTO grouping_overrides(chapter_path, base_title, chapter_no) VALUES (?1,'Sidequel',1)",
            params![path]).unwrap();
        regroup_author(&conn, id).unwrap();

        let d = query_author_detail(&conn, id).unwrap();
        // Cool Story (now 2), Another Standalone Tale (1), Sidequel (1) = 3 works.
        assert_eq!(d.works.len(), 3);
        let cool = d.works.iter().find(|w| w.base_title == "Cool Story").unwrap();
        assert_eq!(cool.chapters.len(), 2);
        assert!(d.works.iter().any(|w| w.base_title == "Sidequel" && w.chapters.len() == 1));
    }

    #[test]
    fn clearing_override_returns_to_heuristic() {
        let (_t, conn, id) = setup();
        let path = chapter_path(&conn, "Another Standalone Tale.mp3");
        conn.execute(
            "INSERT INTO grouping_overrides(chapter_path, base_title, chapter_no) VALUES (?1,'Cool Story',4)",
            params![path]).unwrap();
        regroup_author(&conn, id).unwrap();
        assert_eq!(query_author_detail(&conn, id).unwrap().works.len(), 1);

        conn.execute("DELETE FROM grouping_overrides WHERE chapter_path=?1", params![path]).unwrap();
        regroup_author(&conn, id).unwrap();
        let d = query_author_detail(&conn, id).unwrap();
        assert_eq!(d.works.len(), 2);
        let cool = d.works.iter().find(|w| w.base_title == "Cool Story").unwrap();
        assert_eq!(cool.chapters.len(), 3);
    }
}
```

> Note: the test imports `query_author_detail`/`query_authors` from `crate::commands` — they are already `pub`. If the compiler reports they are not visible, confirm their `pub` status in commands.rs (do not change their visibility unless needed).

- [ ] **Step 4: Run, expect PASS.**

Run: `cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml regroup::"`
Expected: 4 passing.

- [ ] **Step 5: Commit.**

```powershell
git add src-tauri/src/regroup.rs src-tauri/src/lib.rs
git commit -m "feat(grouping): regroup_author applies per-chapter overrides on the heuristic"
```

---

## Task 2: `scan.rs` — apply overrides during scan

**Files:**
- Modify: `src-tauri/src/scan.rs`

- [ ] **Step 1: Write the failing test** (append to scan.rs `#[cfg(test)] mod tests`).

```rust
    #[test]
    fn scan_reapplies_grouping_overrides() {
        let tmp = tempfile::tempdir().unwrap();
        let author = tmp.path().join("A");
        touch(&author.join("Tale.mp3"));
        touch(&author.join("Other.mp3"));
        let conn = open_in_memory().unwrap();
        scan_into(&conn, tmp.path()).unwrap();
        // Two standalone works initially.
        assert_eq!(count(&conn, "works"), 2);

        // Override "Other.mp3" to merge into "Tale".
        let path: String = conn.query_row(
            "SELECT file_path FROM chapters WHERE raw_filename='Other.mp3'", [], |r| r.get(0)).unwrap();
        conn.execute(
            "INSERT INTO grouping_overrides(chapter_path, base_title, chapter_no) VALUES (?1,'Tale',2)",
            params![path]).unwrap();

        // A fresh scan must re-apply the override (not just the regroup command).
        scan_into(&conn, tmp.path()).unwrap();
        assert_eq!(count(&conn, "works"), 1);
    }
```

- [ ] **Step 2: Run, expect FAIL** (works=2 after re-scan, because overrides aren't applied yet).

Run: `cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml scan::tests::scan_reapplies_grouping_overrides"`

- [ ] **Step 3: Implement.** At the top of `scan.rs`, add `use crate::regroup::regroup_author;`. Then, inside `scan_into`, at the END of the per-author loop (right after the `for work in works { … }` block closes, still inside `for author_path in sorted_dirs(root)`), add:

```rust
        // Re-apply any saved grouping overrides for this author (DB-only).
        regroup_author(conn, author_id)?;
```

- [ ] **Step 4: Run, expect PASS**, then run the whole scan module to confirm no regression (the existing `scan_groups_files_into_works_and_chapters` and `rescan_is_idempotent` must still pass — with no overrides, regroup reproduces the heuristic exactly).

Run: `cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml scan::"`

- [ ] **Step 5: Commit.**

```powershell
git add src-tauri/src/scan.rs
git commit -m "feat(grouping): scan re-applies saved grouping overrides per author"
```

---

## Task 3: `commands.rs` — set/clear override commands

**Files:**
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Add `use crate::regroup;`** near the other `use crate::…;` lines.

- [ ] **Step 2: Add the two commands** (append before `#[cfg(test)] mod tests`).

```rust
/// Resolve a chapter's current file path and its author id.
fn chapter_path_and_author(conn: &rusqlite::Connection, chapter_id: i64) -> rusqlite::Result<(String, i64)> {
    conn.query_row(
        "SELECT c.file_path, w.author_id FROM chapters c JOIN works w ON c.work_id=w.id WHERE c.id=?1",
        params![chapter_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
}

#[tauri::command]
pub fn set_grouping_override(
    state: tauri::State<DbState>,
    chapter_id: i64,
    base_title: Option<String>,
    chapter_no: Option<i64>,
) -> Result<AuthorDetail, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let (path, author_id) = chapter_path_and_author(&conn, chapter_id).map_err(|e| e.to_string())?;
    if base_title.is_none() && chapter_no.is_none() {
        conn.execute("DELETE FROM grouping_overrides WHERE chapter_path=?1", params![path])
            .map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "INSERT INTO grouping_overrides(chapter_path, base_title, chapter_no) VALUES (?1, ?2, ?3)
             ON CONFLICT(chapter_path) DO UPDATE SET base_title=excluded.base_title, chapter_no=excluded.chapter_no",
            params![path, base_title, chapter_no],
        )
        .map_err(|e| e.to_string())?;
    }
    regroup::regroup_author(&conn, author_id).map_err(|e| e.to_string())?;
    query_author_detail(&conn, author_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_grouping_override(
    state: tauri::State<DbState>,
    chapter_id: i64,
) -> Result<AuthorDetail, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let (path, author_id) = chapter_path_and_author(&conn, chapter_id).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM grouping_overrides WHERE chapter_path=?1", params![path])
        .map_err(|e| e.to_string())?;
    regroup::regroup_author(&conn, author_id).map_err(|e| e.to_string())?;
    query_author_detail(&conn, author_id).map_err(|e| e.to_string())
}
```

- [ ] **Step 3: Add tests** (inside the existing `#[cfg(test)] mod tests`). These call the pure helpers directly (the `set_grouping_override` command needs `tauri::State`, so test via the same DB primitives the command uses + `regroup_author`, mirroring how existing tests exercise `set_tags`).

```rust
    #[test]
    fn grouping_override_merges_then_clears() {
        let tmp = tempfile::tempdir().unwrap();
        let author = tmp.path().join("Jane Doe");
        touch(&author.join("Cool Story.mp3"));
        touch(&author.join("Cool Story 2 the sequel.mp3"));
        touch(&author.join("Another Standalone Tale.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, tmp.path()).unwrap();
        let id = query_authors(&conn).unwrap()[0].id;

        let path: String = conn.query_row(
            "SELECT file_path FROM chapters WHERE raw_filename='Another Standalone Tale.mp3'",
            [], |r| r.get(0)).unwrap();

        // Merge: emulate set_grouping_override's DB write + regroup.
        conn.execute(
            "INSERT INTO grouping_overrides(chapter_path, base_title, chapter_no) VALUES (?1,'Cool Story',3)
             ON CONFLICT(chapter_path) DO UPDATE SET base_title=excluded.base_title, chapter_no=excluded.chapter_no",
            params![path]).unwrap();
        crate::regroup::regroup_author(&conn, id).unwrap();
        assert_eq!(query_author_detail(&conn, id).unwrap().works.len(), 1);

        // Clear: emulate clear_grouping_override.
        conn.execute("DELETE FROM grouping_overrides WHERE chapter_path=?1", params![path]).unwrap();
        crate::regroup::regroup_author(&conn, id).unwrap();
        assert_eq!(query_author_detail(&conn, id).unwrap().works.len(), 2);
    }
```

- [ ] **Step 4: Run, expect PASS.**

Run: `cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml commands::"`

- [ ] **Step 5: Commit.**

```powershell
git add src-tauri/src/commands.rs
git commit -m "feat(grouping): set/clear_grouping_override commands return fresh AuthorDetail"
```

---

## Task 4: `lib.rs` — register commands + test export

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Register the commands** in `invoke_handler![...]` after `commands::undo_renames` (add a comma after it):

```rust
            commands::undo_renames,
            commands::set_grouping_override,
            commands::clear_grouping_override
```

- [ ] **Step 2: Export `regroup_author`** for the integration test. Extend `pub mod testing`:

```rust
pub mod testing {
    pub use crate::commands::{query_author_detail, query_authors};
    pub use crate::db::open_in_memory;
    pub use crate::regroup::regroup_author;
    pub use crate::rename::{build_plan, execute, undo, ItemStatus};
    pub use crate::scan::scan_into;
}
```

- [ ] **Step 3: Build the whole crate + run all Rust tests.**

Run: `cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml"`
Expected: everything green (existing + new regroup/scan/commands tests).

- [ ] **Step 4: Commit.**

```powershell
git add src-tauri/src/lib.rs
git commit -m "feat(grouping): register override commands + export regroup_author for tests"
```

---

## Task 5: `api.ts` — wrappers

**Files:**
- Modify: `src/lib/api.ts`

- [ ] **Step 1: Add wrappers** (after `setAuthorDisplayName`, near the other author commands):

```ts
export const setGroupingOverride = (chapterId: number, baseTitle: string | null, chapterNo: number | null) =>
  invoke<AuthorDetail>("set_grouping_override", { chapterId, baseTitle, chapterNo });
export const clearGroupingOverride = (chapterId: number) =>
  invoke<AuthorDetail>("clear_grouping_override", { chapterId });
```

- [ ] **Step 2: Verify types.**

Run: `npx tsc --noEmit`
Expected: clean (App.tsx not wired yet, but these wrappers don't break anything).

- [ ] **Step 3: Commit.**

```powershell
git add src/lib/api.ts
git commit -m "feat(grouping): api wrappers set/clearGroupingOverride"
```

---

## Task 6: `AuthorDetailView` — inline grouping editor

**Files:**
- Modify: `src/views/AuthorDetailView.tsx`
- Test: `src/views/AuthorDetailView.test.tsx`

- [ ] **Step 1: Write the failing tests.** First read the existing `AuthorDetailView.test.tsx` to see how it builds a `detail` fixture and which props it passes. Add `onSetGrouping={() => {}}` and `onClearGrouping={() => {}}` to every existing `render(<AuthorDetailView .../>)` call (so TS stays satisfied), then add:

```tsx
  it("submits a grouping override with the typed work title and chapter number", async () => {
    const onSetGrouping = vi.fn();
    render(
      <AuthorDetailView
        detail={detail}
        onTogglePlayed={() => {}}
        onPlayChapter={() => {}}
        onSetTags={() => {}}
        onSetGrouping={onSetGrouping}
        onClearGrouping={() => {}}
        allTags={[]}
        onBack={() => {}}
      />,
    );
    const firstChapter = detail.works[0].chapters[0];
    const workInput = screen.getByLabelText(`Work title for '${firstChapter.title}'`);
    await userEvent.clear(workInput);
    await userEvent.type(workInput, "Merged Work");
    await userEvent.click(screen.getByLabelText(`Save grouping for '${firstChapter.title}'`));
    expect(onSetGrouping).toHaveBeenCalledWith(firstChapter.id, "Merged Work", firstChapter.chapterNo);
  });

  it("clears a grouping override via Reset", async () => {
    const onClearGrouping = vi.fn();
    render(
      <AuthorDetailView
        detail={detail}
        onTogglePlayed={() => {}}
        onPlayChapter={() => {}}
        onSetTags={() => {}}
        onSetGrouping={() => {}}
        onClearGrouping={onClearGrouping}
        allTags={[]}
        onBack={() => {}}
      />,
    );
    const firstChapter = detail.works[0].chapters[0];
    await userEvent.click(screen.getByLabelText(`Reset grouping for '${firstChapter.title}'`));
    expect(onClearGrouping).toHaveBeenCalledWith(firstChapter.id);
  });
```

> If the existing test file has no `userEvent` import, add `import userEvent from "@testing-library/user-event";`. The existing fixture `detail` must have at least one work with one chapter that has `id`, `title`, `chapterNo` — confirm and adjust the fixture if needed.

- [ ] **Step 2: Run, expect FAIL.**

Run: `npx vitest run src/views/AuthorDetailView.test.tsx`

- [ ] **Step 3: Implement.** Add the two props and a small per-chapter controlled form. Replace the component with:

```tsx
import { useState } from "react";
import type { AuthorDetail, ChapterRow, WorkRow } from "../lib/api";
import { TagEditor } from "./TagEditor";

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function ChapterGroupingForm(props: {
  work: WorkRow;
  chapter: ChapterRow;
  onSetGrouping: (chapterId: number, baseTitle: string, chapterNo: number) => void;
  onClearGrouping: (chapterId: number) => void;
}) {
  const { work, chapter } = props;
  const [title, setTitle] = useState(work.baseTitle);
  const [no, setNo] = useState(String(chapter.chapterNo));
  return (
    <span className="chapter-grouping">
      {" · "}
      <input
        aria-label={`Work title for '${chapter.title}'`}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <input
        aria-label={`Chapter number for '${chapter.title}'`}
        type="number"
        value={no}
        onChange={(e) => setNo(e.target.value)}
      />
      <button
        aria-label={`Save grouping for '${chapter.title}'`}
        onClick={() => props.onSetGrouping(chapter.id, title.trim(), Number(no) || 1)}
      >
        Save grouping
      </button>
      <button
        aria-label={`Reset grouping for '${chapter.title}'`}
        onClick={() => props.onClearGrouping(chapter.id)}
      >
        Reset
      </button>
    </span>
  );
}

export function AuthorDetailView(props: {
  detail: AuthorDetail;
  onTogglePlayed: (chapterId: number, played: boolean) => void;
  onPlayChapter: (chapter: ChapterRow) => void;
  onSetTags: (tags: string[]) => void;
  onSetGrouping: (chapterId: number, baseTitle: string, chapterNo: number) => void;
  onClearGrouping: (chapterId: number) => void;
  allTags: string[];
  onBack: () => void;
}) {
  const { detail } = props;
  return (
    <div className="author-detail">
      <button onClick={props.onBack}>← Library</button>
      <h1>{detail.name}</h1>
      <TagEditor tags={detail.tags} allTags={props.allTags} onChange={props.onSetTags} />
      {detail.works.map((w) => (
        <section key={w.id} className="work">
          <h2><span className="work-title">{w.baseTitle}{" "}({w.chapters.length})</span></h2>
          <ul>
            {w.chapters.map((c) => (
              <li key={c.id} data-played={c.played ? "true" : "false"}>
                <button aria-label={`Play '${c.title}'`} onClick={() => props.onPlayChapter(c)}>▶</button>
                <label aria-label={`Mark '${c.title}' played`}>
                  <input
                    type="checkbox"
                    checked={c.played}
                    onChange={(e) => props.onTogglePlayed(c.id, e.target.checked)}
                  />
                </label>
                <span className="chapter-title">{c.title}</span>{" — "}
                <span className="chapter-duration">{formatDuration(c.durationSecs)}</span>
                <ChapterGroupingForm
                  work={w}
                  chapter={c}
                  onSetGrouping={props.onSetGrouping}
                  onClearGrouping={props.onClearGrouping}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
```

> `WorkRow` must be exported from `src/lib/api.ts` (it is — `export interface WorkRow`). Import it as shown.

- [ ] **Step 4: Run, expect PASS** (all AuthorDetailView tests).

Run: `npx vitest run src/views/AuthorDetailView.test.tsx`

- [ ] **Step 5: Commit.**

```powershell
git add src/views/AuthorDetailView.tsx src/views/AuthorDetailView.test.tsx
git commit -m "feat(grouping): inline per-chapter work/chapter override editor"
```

---

## Task 7: `App.tsx` — wiring + harness branch

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Extend the api import** to add `setGroupingOverride, clearGroupingOverride`. Add `groupingSteps` to the `./harness/walkthroughs` import.

- [ ] **Step 2: Add handlers** (near `togglePlayed`):

```tsx
  async function setGrouping(chapterId: number, baseTitle: string, chapterNo: number) {
    const d = await setGroupingOverride(chapterId, baseTitle, chapterNo);
    setDetail(d);
    await loadAuthors();
  }
  async function clearGrouping(chapterId: number) {
    const d = await clearGroupingOverride(chapterId);
    setDetail(d);
    await loadAuthors();
  }
```

- [ ] **Step 3: Pass the new props** to `<AuthorDetailView … />` in `routedView()`:

```tsx
          onSetTags={setTags}
          onSetGrouping={setGrouping}
          onClearGrouping={clearGrouping}
          allTags={allTags}
```

- [ ] **Step 4: Add the harness branch.** In the `useEffect` walkthrough dispatch ternary, add a `grouping` case (mirrors discovery/rename). It opens the first author, merges the standalone into "Cool Story", screenshots, then resets:

```tsx
            : args.walkthrough === "grouping"
            ? groupingSteps({
                openFirstAuthor,
                mergeDemo: async () => {
                  const list = await getAuthors();
                  if (list.length === 0) return;
                  const d = await getAuthorDetail(list[0].id);
                  const standalone = d.works.find((w) => w.baseTitle === "Another Standalone Tale");
                  const ch = standalone?.chapters[0];
                  if (ch) setDetail(await setGroupingOverride(ch.id, "Cool Story", 4));
                },
                resetDemo: async () => {
                  const list = await getAuthors();
                  if (list.length === 0) return;
                  // The merged chapter now lives under "Cool Story"; find it by title.
                  const d = await getAuthorDetail(list[0].id);
                  const cool = d.works.find((w) => w.baseTitle === "Cool Story");
                  const merged = cool?.chapters.find((c) => c.title === "Another Standalone Tale");
                  if (merged) setDetail(await clearGroupingOverride(merged.id));
                },
              })
```

> `openFirstAuthor` already exists in the effect (used by browse/player). Reuse it. `getAuthorDetail`/`getAuthors`/`setGroupingOverride`/`clearGroupingOverride` are imported. Each step re-fetches state (the established "self-contained harness step" gotcha from M2).

- [ ] **Step 5: Front-end gates.**

Run: `npx tsc --noEmit` then `npm test`
Expected: tsc clean; all tests pass.

- [ ] **Step 6: Commit.**

```powershell
git add src/App.tsx
git commit -m "feat(grouping): wire AuthorDetailView override handlers + grouping harness branch"
```

---

## Task 8: `walkthroughs.ts` — `groupingSteps`

**Files:**
- Modify: `src/harness/walkthroughs.ts`

- [ ] **Step 1: Add `"grouping"` to the tuple and the builder.**

```ts
export const walkthroughs = ["browse", "player", "discovery", "rename", "grouping"] as const;
```

```ts
/**
 * Build the "grouping" walkthrough: open the first author, merge its standalone
 * work into "Cool Story" via an override, then reset — a round-trip that leaves
 * the DB grouping as it began.
 */
export function groupingSteps(nav: {
  openFirstAuthor: () => Promise<void>;
  mergeDemo: () => Promise<void>;
  resetDemo: () => Promise<void>;
}): Step[] {
  return [
    { name: "before", run: nav.openFirstAuthor },
    { name: "merged", run: nav.mergeDemo },
    { name: "reset", run: nav.resetDemo },
  ];
}
```

- [ ] **Step 2: Verify types.**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit.**

```powershell
git add src/harness/walkthroughs.ts
git commit -m "feat(grouping): grouping harness walkthrough (before/merged/reset)"
```

> Order note: Task 7 imports `groupingSteps`, which this task defines. If you implement Task 7 before Task 8, `tsc` will error until Task 8 lands — that's fine; do them back-to-back and run the gates after Task 8.

---

## Task 9: Integration test — `grouping_roundtrip.rs`

**Files:**
- Create: `src-tauri/tests/grouping_roundtrip.rs`

- [ ] **Step 1: Write the test** (uses the exported `testing` helpers; match the crate path used by `tests/rename_roundtrip.rs` — likely `audioshelf_lib`).

```rust
//! End-to-end: scan, merge a standalone work into another via an override + regroup, then reset.

use audioshelf_lib::testing::{open_in_memory, query_author_detail, query_authors, regroup_author, scan_into};
use rusqlite::params;
use std::fs::{self, File};
use std::path::Path;

fn touch(path: &Path) {
    if let Some(p) = path.parent() { fs::create_dir_all(p).unwrap(); }
    File::create(path).unwrap();
}

#[test]
fn grouping_override_merge_then_reset() {
    let tmp = tempfile::tempdir().unwrap();
    let author = tmp.path().join("Jane Doe");
    touch(&author.join("Cool Story.mp3"));
    touch(&author.join("Cool Story 2 the sequel.mp3"));
    touch(&author.join("Another Standalone Tale.mp3"));
    let conn = open_in_memory().unwrap();
    scan_into(&conn, tmp.path()).unwrap();
    let id = query_authors(&conn).unwrap()[0].id;
    assert_eq!(query_author_detail(&conn, id).unwrap().works.len(), 2);

    let path: String = conn.query_row(
        "SELECT file_path FROM chapters WHERE raw_filename='Another Standalone Tale.mp3'",
        [], |r| r.get(0)).unwrap();

    conn.execute(
        "INSERT INTO grouping_overrides(chapter_path, base_title, chapter_no) VALUES (?1,'Cool Story',3)",
        params![path]).unwrap();
    regroup_author(&conn, id).unwrap();
    let merged = query_author_detail(&conn, id).unwrap();
    assert_eq!(merged.works.len(), 1);
    assert_eq!(merged.works[0].chapters.len(), 3);

    conn.execute("DELETE FROM grouping_overrides WHERE chapter_path=?1", params![path]).unwrap();
    regroup_author(&conn, id).unwrap();
    assert_eq!(query_author_detail(&conn, id).unwrap().works.len(), 2);
}
```

- [ ] **Step 2: Run, expect PASS.**

Run: `cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml --test grouping_roundtrip"`

- [ ] **Step 3: Commit.**

```powershell
git add src-tauri/tests/grouping_roundtrip.rs
git commit -m "test(grouping): end-to-end merge + reset round-trip"
```

---

## Task 10: README + finish

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README** — add a "Grouping Review (Milestone 5)" section (per-chapter Work/Chapter# editing on the author view; merge by typing a matching work title, split by typing a new one, reassign by changing the number; Reset to auto; overrides stored in DB, re-applied on scan, never written to disk; known limit: renaming an overridden file via the M4 tool orphans its override). Add the `grouping` walkthrough to the harness list and the walkthroughs sentence. Flip the M5 roadmap row to **Shipped** (the runbook progress log already has an M5 row; add the README roadmap row if missing) and link this plan.

- [ ] **Step 2: Commit.**

```powershell
git add README.md
git commit -m "docs(grouping): README M5 grouping review section"
```

- [ ] **Step 3: Visual self-verification** (controller). Run the grouping walkthrough and inspect the three screenshots:

```powershell
.\tools\verify.ps1 -Walkthrough grouping
```
Confirm: `01-before` shows Jane Doe with **Cool Story (3)** and **Another Standalone Tale (1)** plus the inline Work/Ch# edit controls on each chapter; `02-merged` shows **Cool Story (4)** (the standalone merged in, no separate standalone work); `03-reset` shows the original two works restored. Fix any defect before finishing.

- [ ] **Step 4: Finish per the runbook** (controller): final gates (`npx tsc --noEmit`, `npm test`, full `cargo test`) → push `m5-grouping` → `gh pr create` → **foreground** `gh pr checks <PR#> --watch` → merge from main with `--merge --delete-branch` → sync main → update the runbook Progress Log (flip M5 to ✅ Merged).

---

## Self-Review (against spec §4 + chosen UX)

- Grouping reviewable/overridable in the UI → inline per-chapter Work/Ch# editor on Author Detail (Task 6). ✓
- Merge / split / reassign chapter / set base title → all expressible via the per-chapter (base_title, chapter_no) override + regroup (Tasks 1,6). ✓
- Overrides stored in DB, never written to disk → `grouping_overrides` table only; `regroup_author` is DB-only, audio files untouched (Task 1). ✓
- Re-applied during scan → `scan_into` calls `regroup_author` per author (Task 2). ✓
- Reset to heuristic → `clear_grouping_override` / Reset button; heuristic recomputed fresh each regroup so clearing fully restores (Tasks 1,3,6). ✓
- Read-only-on-audio preserved; crash-safety not applicable (no disk mutation, single SQLite transaction-per-statement) → ✓.

**Placeholder scan:** none. **Type consistency:** commands return `AuthorDetail` (matches `getAuthorDetail` consumers); wrapper arg names (`chapterId`, `baseTitle`, `chapterNo`) match the `#[tauri::command]` signatures (`chapter_id`, `base_title`, `chapter_no`); `null` from TS maps to `Option::None` in Rust (both-null = clear). No model/schema changes, so no cross-file struct drift.
