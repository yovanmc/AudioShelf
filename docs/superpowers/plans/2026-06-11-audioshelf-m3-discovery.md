# AudioShelf — Milestone 3: Tags & Discovery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let the user tag authors and discover what to listen to next: a tag editor on the author view, plus a Discovery panel with "For you" (works by authors that share tags with recently-played authors), "Pick a tag" (multi-select → similar-tagged, mostly-unplayed works), and "More from this author".

**Architecture:** New read-only Rust query helpers + commands compute discovery from the existing `author_tags` and `play_events` tables (no schema change). Pure ranking logic is unit-tested in Rust against the WAV fixture (after seeding tags + play events). The front-end adds a presentational `TagEditor` and `DiscoveryView` (both unit-tested) wired through `App.tsx`. A `discovery` harness walkthrough screenshots the panel.

**Tech Stack:** Rust (rusqlite), React 18 + TS, Vitest. No new dependencies.

**Reference (existing shapes this builds on):**
- `src-tauri/src/db.rs` — `author_tags(author_id, tag)` and `play_events(id, chapter_id, played_at)` already exist. **No schema change.**
- `src-tauri/src/model.rs` — `AuthorDetail { id, name, works }`, `WorkRow { id, baseTitle, chapters }`. `commands.rs` — `query_author_detail`, `pub` helpers, `DbState`, test module with `touch()`.
- `src/lib/api.ts` — `AuthorDetail { id, name, works }`, invoke wrappers. `src/App.tsx` — routes `loading|scan|library|author`, player state, harness dispatch. `src/views/LibraryView.tsx` — `{ authors, onOpenAuthor }`. `src/views/AuthorDetailView.tsx` — `{ detail, onTogglePlayed, onPlayChapter, onBack }`. `src/harness/walkthroughs.ts` — `browseSteps`, `playerSteps`, `walkthroughs`.

**Conventions:** Windows; cargo via `cmd /c "tools\dev-env.cmd cargo ..."` in the FOREGROUND; `npm run build` before cargo; commit per task, human author + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

**Tags are author-level only (per spec).** Out of scope: per-work/chapter tags; the rename tool (M4).

---

## Data model & discovery semantics (read this first)

- A **tag** is a free-text string attached to an author (`author_tags`). `set_author_tags(authorId, tags)` replaces the author's whole tag set (dedupe, drop blanks). `get_all_tags()` returns the distinct sorted tag list.
- **"Recently played" authors** = distinct authors of chapters in `play_events`, most recent first (by max `played_at`).
- **DiscoveryWork** (returned to the UI): `{ workId, baseTitle, authorId, authorName, unplayedCount, sharedTags: string[] }`. Only works with `unplayedCount > 0` are suggested.
- **get_discovery() ("For you")**: collect tags of recently-played authors; find *other* authors (not recently played) sharing ≥1 of those tags; emit their unplayed works with `sharedTags` = intersection; rank by `sharedTags.len()` desc, then `unplayedCount` desc; cap 20. Empty if there is no play history or no tags.
- **get_discovery_by_tags(tags)**: authors having ≥1 of `tags`; emit their unplayed works with `sharedTags` = intersection with `tags`; rank by `sharedTags.len()` desc, then `unplayedCount` desc; cap 50.
- **get_more_from_author(authorId)**: that author's works (all), `{ workId, baseTitle, unplayedCount }`, ordered by `sort_key`.

---

## File Structure

- Modify `src-tauri/src/model.rs` — add `tags` to `AuthorDetail`; add `DiscoveryWork`, `MoreWork`.
- Modify `src-tauri/src/commands.rs` — tag commands (`get_all_tags`, `set_author_tags`), discovery helpers + commands (`get_discovery`, `get_discovery_by_tags`, `get_more_from_author`), `tags` in `query_author_detail`; tests.
- Modify `src-tauri/src/lib.rs` — register new commands; export helpers for tests.
- Modify `src/lib/api.ts` — `DiscoveryWork`/`MoreWork` types, `AuthorDetail.tags`, wrappers.
- Create `src/views/TagEditor.tsx` (+ test) — presentational tag chips + add/remove + datalist autocomplete.
- Modify `src/views/AuthorDetailView.tsx` (+ test) — render `TagEditor`, new props `allTags`, `onSetTags`.
- Create `src/views/DiscoveryView.tsx` (+ test) — For-you list, Pick-a-tag multi-select, More-from-author section.
- Modify `src/views/LibraryView.tsx` (+ test) — a "Discover" button (`onOpenDiscovery`).
- Modify `src/harness/walkthroughs.ts` (+ keep runner test green) — `discoverySteps`, extend list.
- Modify `src/App.tsx` — `discovery` route, tag wiring, discovery data, `discovery` walkthrough.

---

## Task 1: Rust — author tags (model + commands)

**Files:** `src-tauri/src/model.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1: Extend `AuthorDetail` in `model.rs`.** Add a `tags` field:
```rust
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuthorDetail {
    pub id: i64,
    pub name: String,
    pub tags: Vec<String>,
    pub works: Vec<WorkRow>,
}
```

- [ ] **Step 2: Populate tags + add tag commands in `commands.rs`.**

In `query_author_detail`, before `Ok(AuthorDetail { ... })`, load the author's tags:
```rust
    let mut tstmt = conn.prepare("SELECT tag FROM author_tags WHERE author_id=?1 ORDER BY tag")?;
    let tags: Vec<String> = tstmt
        .query_map(params![author_id], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<_>>()?;
```
and change the return to `Ok(AuthorDetail { id: author_id, name, tags, works })`.

Add these commands + a `pub(crate)` helper:
```rust
#[tauri::command]
pub fn get_all_tags(state: tauri::State<DbState>) -> Result<Vec<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT DISTINCT tag FROM author_tags ORDER BY tag").map_err(|e| e.to_string())?;
    let tags = stmt
        .query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<String>>>().map_err(|e| e.to_string())?;
    Ok(tags)
}

#[tauri::command]
pub fn set_author_tags(state: tauri::State<DbState>, author_id: i64, tags: Vec<String>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    set_tags(&conn, author_id, &tags).map_err(|e| e.to_string())
}

/// Replace an author's tag set (deduped, blanks dropped, trimmed).
pub(crate) fn set_tags(conn: &rusqlite::Connection, author_id: i64, tags: &[String]) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM author_tags WHERE author_id=?1", params![author_id])?;
    let mut seen = std::collections::BTreeSet::new();
    for raw in tags {
        let t = raw.trim();
        if t.is_empty() || !seen.insert(t.to_string()) { continue; }
        conn.execute(
            "INSERT OR IGNORE INTO author_tags(author_id, tag) VALUES (?1, ?2)",
            params![author_id, t],
        )?;
    }
    Ok(())
}
```

Add a test in the `commands.rs` test module:
```rust
    #[test]
    fn tags_round_trip_and_dedupe() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("A").join("X.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();
        let id = query_authors(&conn).unwrap()[0].id;

        super::set_tags(&conn, id, &["cozy".into(), " cozy ".into(), "".into(), "thriller".into()]).unwrap();
        let detail = query_author_detail(&conn, id).unwrap();
        assert_eq!(detail.tags, vec!["cozy".to_string(), "thriller".to_string()]);

        // Replace-all semantics.
        super::set_tags(&conn, id, &["calm".into()]).unwrap();
        assert_eq!(query_author_detail(&conn, id).unwrap().tags, vec!["calm".to_string()]);
    }
```

- [ ] **Step 3: Register the commands** in `lib.rs` `generate_handler![...]`: add `commands::get_all_tags` and `commands::set_author_tags`. Add `query_author_detail` is already exported; no change needed for these (tests use `super::set_tags`).

- [ ] **Step 4: Run tests (FOREGROUND).**
`cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml commands"`
Expected: existing + `tags_round_trip_and_dedupe` pass.

- [ ] **Step 5: Commit.**
```powershell
git add -A; git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "feat: author tags (model + get_all_tags/set_author_tags commands)"
```

---

## Task 2: Rust — discovery model + queries

**Files:** `src-tauri/src/model.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1: Add discovery structs to `model.rs`.**
```rust
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryWork {
    pub work_id: i64,
    pub base_title: String,
    pub author_id: i64,
    pub author_name: String,
    pub unplayed_count: i64,
    pub shared_tags: Vec<String>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MoreWork {
    pub work_id: i64,
    pub base_title: String,
    pub unplayed_count: i64,
}
```

- [ ] **Step 2: Add discovery helpers + commands to `commands.rs`.** Import the new models in the `use crate::model::{...}` line (add `DiscoveryWork, MoreWork`).

```rust
/// Works (with unplayed chapters) by authors having any of `tags`, ranked by
/// shared-tag count then unplayed count. `exclude_authors` are filtered out.
pub(crate) fn discovery_for_tags(
    conn: &rusqlite::Connection,
    tags: &[String],
    exclude_authors: &[i64],
    cap: usize,
) -> rusqlite::Result<Vec<DiscoveryWork>> {
    if tags.is_empty() {
        return Ok(Vec::new());
    }
    // Candidate authors: those sharing >=1 tag, not excluded.
    let mut works: Vec<DiscoveryWork> = Vec::new();
    let mut astmt = conn.prepare("SELECT id, COALESCE(display_name, folder_name) FROM authors WHERE status='active'")?;
    let authors: Vec<(i64, String)> = astmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    for (author_id, author_name) in authors {
        if exclude_authors.contains(&author_id) {
            continue;
        }
        let mut tstmt = conn.prepare("SELECT tag FROM author_tags WHERE author_id=?1")?;
        let author_tags: Vec<String> = tstmt
            .query_map(params![author_id], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<_>>()?;
        let mut shared: Vec<String> = author_tags.iter().filter(|t| tags.contains(t)).cloned().collect();
        shared.sort();
        if shared.is_empty() {
            continue;
        }
        // This author's works that have >=1 unplayed chapter.
        let mut wstmt = conn.prepare(
            "SELECT w.id, w.base_title,
                    (SELECT count(*) FROM chapters c WHERE c.work_id=w.id AND c.status='active' AND c.played=0)
             FROM works w WHERE w.author_id=?1 AND w.status='active'",
        )?;
        let rows: Vec<(i64, String, i64)> = wstmt
            .query_map(params![author_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<rusqlite::Result<_>>()?;
        for (work_id, base_title, unplayed) in rows {
            if unplayed > 0 {
                works.push(DiscoveryWork {
                    work_id,
                    base_title,
                    author_id,
                    author_name: author_name.clone(),
                    unplayed_count: unplayed,
                    shared_tags: shared.clone(),
                });
            }
        }
    }
    works.sort_by(|a, b| {
        b.shared_tags.len().cmp(&a.shared_tags.len())
            .then(b.unplayed_count.cmp(&a.unplayed_count))
            .then(a.base_title.to_lowercase().cmp(&b.base_title.to_lowercase()))
    });
    works.truncate(cap);
    Ok(works)
}

/// Authors of chapters in play_events, most-recent first.
pub(crate) fn recent_authors(conn: &rusqlite::Connection, limit: usize) -> rusqlite::Result<Vec<i64>> {
    let mut stmt = conn.prepare(
        "SELECT w.author_id, MAX(pe.played_at) AS last
         FROM play_events pe
         JOIN chapters c ON pe.chapter_id=c.id
         JOIN works w ON c.work_id=w.id
         GROUP BY w.author_id ORDER BY last DESC",
    )?;
    let ids: Vec<i64> = stmt
        .query_map([], |r| r.get::<_, i64>(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(ids.into_iter().take(limit).collect())
}

pub(crate) fn discovery_for_you(conn: &rusqlite::Connection) -> rusqlite::Result<Vec<DiscoveryWork>> {
    let recent = recent_authors(conn, 10)?;
    if recent.is_empty() {
        return Ok(Vec::new());
    }
    // Tags of recently-played authors.
    let mut tags: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for id in &recent {
        let mut stmt = conn.prepare("SELECT tag FROM author_tags WHERE author_id=?1")?;
        for t in stmt.query_map(params![id], |r| r.get::<_, String>(0))? {
            tags.insert(t?);
        }
    }
    let tag_vec: Vec<String> = tags.into_iter().collect();
    discovery_for_tags(conn, &tag_vec, &recent, 20)
}

pub(crate) fn more_from_author(conn: &rusqlite::Connection, author_id: i64) -> rusqlite::Result<Vec<MoreWork>> {
    let mut stmt = conn.prepare(
        "SELECT w.id, w.base_title,
                (SELECT count(*) FROM chapters c WHERE c.work_id=w.id AND c.status='active' AND c.played=0)
         FROM works w WHERE w.author_id=?1 AND w.status='active' ORDER BY w.sort_key",
    )?;
    let rows = stmt
        .query_map(params![author_id], |r| Ok(MoreWork { work_id: r.get(0)?, base_title: r.get(1)?, unplayed_count: r.get(2)? }))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn get_discovery(state: tauri::State<DbState>) -> Result<Vec<DiscoveryWork>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    discovery_for_you(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_discovery_by_tags(state: tauri::State<DbState>, tags: Vec<String>) -> Result<Vec<DiscoveryWork>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    discovery_for_tags(&conn, &tags, &[], 50).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_more_from_author(state: tauri::State<DbState>, author_id: i64) -> Result<Vec<MoreWork>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    more_from_author(&conn, author_id).map_err(|e| e.to_string())
}
```

- [ ] **Step 3: Test the discovery logic.** Add to the `commands.rs` test module:
```rust
    #[test]
    fn discovery_by_tags_ranks_shared_then_unplayed() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("Alice").join("Tale.mp3"));
        touch(&root.join("Bob").join("Saga.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();
        let ids: std::collections::HashMap<String, i64> =
            query_authors(&conn).unwrap().into_iter().map(|a| (a.name, a.id)).collect();
        super::set_tags(&conn, ids["Alice"], &["cozy".into(), "calm".into()]).unwrap();
        super::set_tags(&conn, ids["Bob"], &["cozy".into()]).unwrap();

        let res = super::discovery_for_tags(&conn, &["cozy".into(), "calm".into()], &[], 50).unwrap();
        // Alice shares 2 tags, Bob shares 1 -> Alice ranks first.
        assert_eq!(res[0].author_name, "Alice");
        assert_eq!(res[0].shared_tags, vec!["calm".to_string(), "cozy".to_string()]);
        assert_eq!(res[1].author_name, "Bob");
        // All works here have 1 unplayed chapter.
        assert!(res.iter().all(|w| w.unplayed_count == 1));
    }

    #[test]
    fn for_you_uses_recent_play_tags_and_excludes_recent_author() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("Alice").join("Tale.mp3"));
        touch(&root.join("Bob").join("Saga.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();
        let ids: std::collections::HashMap<String, i64> =
            query_authors(&conn).unwrap().into_iter().map(|a| (a.name, a.id)).collect();
        super::set_tags(&conn, ids["Alice"], &["cozy".into()]).unwrap();
        super::set_tags(&conn, ids["Bob"], &["cozy".into()]).unwrap();
        // Play Alice's chapter -> Alice is "recent"; For-you should suggest Bob (shares "cozy"), not Alice.
        let alice_detail = query_author_detail(&conn, ids["Alice"]).unwrap();
        let ch = alice_detail.works[0].chapters[0].id;
        super::mark_finished(&conn, ch, 1_700_000_000_000).unwrap();

        let res = super::discovery_for_you(&conn).unwrap();
        assert!(res.iter().any(|w| w.author_name == "Bob"));
        assert!(res.iter().all(|w| w.author_name != "Alice"));
    }
```

- [ ] **Step 4: Register the 3 commands** in `lib.rs`: add `commands::get_discovery`, `commands::get_discovery_by_tags`, `commands::get_more_from_author`.

- [ ] **Step 5: Run the full Rust suite (FOREGROUND).**
`cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml"`
Expected: all pass (M1+M2 tests + the new discovery tests).

- [ ] **Step 6: Commit.**
```powershell
git add -A; git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "feat: discovery queries (for-you, by-tags, more-from-author)"
```

---

## Task 3: api.ts — types + wrappers

**Files:** `src/lib/api.ts`

- [ ] **Step 1: Add types and wrappers.** Add `tags: string[]` to the `AuthorDetail` interface; add the new interfaces and wrappers:
```ts
export interface DiscoveryWork {
  workId: number; baseTitle: string; authorId: number; authorName: string;
  unplayedCount: number; sharedTags: string[];
}
export interface MoreWork { workId: number; baseTitle: string; unplayedCount: number; }

export const getAllTags = () => invoke<string[]>("get_all_tags");
export const setAuthorTags = (authorId: number, tags: string[]) =>
  invoke("set_author_tags", { authorId, tags });
export const getDiscovery = () => invoke<DiscoveryWork[]>("get_discovery");
export const getDiscoveryByTags = (tags: string[]) =>
  invoke<DiscoveryWork[]>("get_discovery_by_tags", { tags });
export const getMoreFromAuthor = (authorId: number) =>
  invoke<MoreWork[]>("get_more_from_author", { authorId });
```
And update the `AuthorDetail` interface to:
```ts
export interface AuthorDetail { id: number; name: string; tags: string[]; works: WorkRow[]; }
```

- [ ] **Step 2: Type-check.** `npx tsc --noEmit` → clean.

- [ ] **Step 3: Commit.**
```powershell
git add -A; git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "feat: tags + discovery api wrappers and types"
```

---

## Task 4: TagEditor component (TDD)

**Files:** `src/views/TagEditor.tsx`, `src/views/TagEditor.test.tsx`

- [ ] **Step 1: Write the failing test** (`src/views/TagEditor.test.tsx`):
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TagEditor } from "./TagEditor";

describe("TagEditor", () => {
  it("shows existing tags", () => {
    render(<TagEditor tags={["cozy", "thriller"]} allTags={["cozy", "thriller", "calm"]} onChange={() => {}} />);
    expect(screen.getByText("cozy")).toBeInTheDocument();
    expect(screen.getByText("thriller")).toBeInTheDocument();
  });

  it("adds a tag via the input", async () => {
    const onChange = vi.fn();
    render(<TagEditor tags={["cozy"]} allTags={["cozy", "calm"]} onChange={onChange} />);
    const input = screen.getByPlaceholderText("Add tag");
    await userEvent.type(input, "calm{enter}");
    expect(onChange).toHaveBeenCalledWith(["cozy", "calm"]);
  });

  it("does not add a duplicate or blank tag", async () => {
    const onChange = vi.fn();
    render(<TagEditor tags={["cozy"]} allTags={["cozy"]} onChange={onChange} />);
    const input = screen.getByPlaceholderText("Add tag");
    await userEvent.type(input, "cozy{enter}");
    await userEvent.type(input, "   {enter}");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("removes a tag", async () => {
    const onChange = vi.fn();
    render(<TagEditor tags={["cozy", "calm"]} allTags={["cozy", "calm"]} onChange={onChange} />);
    await userEvent.click(screen.getByLabelText("Remove tag cozy"));
    expect(onChange).toHaveBeenCalledWith(["calm"]);
  });
});
```

- [ ] **Step 2: Run it → FAIL.** `npm test -- TagEditor`

- [ ] **Step 3: Implement** (`src/views/TagEditor.tsx`):
```tsx
import { useState } from "react";

export function TagEditor(props: {
  tags: string[];
  allTags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [value, setValue] = useState("");

  function add() {
    const t = value.trim();
    if (t === "" || props.tags.includes(t)) {
      setValue("");
      return;
    }
    props.onChange([...props.tags, t]);
    setValue("");
  }

  function remove(tag: string) {
    props.onChange(props.tags.filter((t) => t !== tag));
  }

  return (
    <div className="tag-editor">
      <ul className="tag-list">
        {props.tags.map((t) => (
          <li key={t} className="tag-chip">
            <span>{t}</span>
            <button aria-label={`Remove tag ${t}`} onClick={() => remove(t)}>×</button>
          </li>
        ))}
      </ul>
      <input
        list="all-tags"
        placeholder="Add tag"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
      />
      <datalist id="all-tags">
        {props.allTags.map((t) => <option key={t} value={t} />)}
      </datalist>
    </div>
  );
}
```

- [ ] **Step 4: Run it → PASS (4 tests).** `npm test -- TagEditor`

- [ ] **Step 5: Commit.**
```powershell
git add -A; git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "feat: TagEditor component with autocomplete"
```

---

## Task 5: AuthorDetailView — integrate TagEditor (TDD)

**Files:** `src/views/AuthorDetailView.tsx`, `src/views/AuthorDetailView.test.tsx`

- [ ] **Step 1: Update the test.** Add the new props to existing renders and a tag test. Append this test and add `allTags={[]} onSetTags={() => {}}` to the three existing `render(<AuthorDetailView .../>)` calls. New test:
```tsx
  it("renders the tag editor and reports tag changes", async () => {
    const onSetTags = vi.fn();
    const withTags = { ...detail, tags: ["cozy"] };
    render(<AuthorDetailView detail={withTags} onTogglePlayed={() => {}} onPlayChapter={() => {}} onSetTags={onSetTags} allTags={["cozy", "calm"]} onBack={() => {}} />);
    expect(screen.getByText("cozy")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Remove tag cozy"));
    expect(onSetTags).toHaveBeenCalledWith([]);
  });
```
(Also update the `detail` fixture object to include `tags: []` so it satisfies the `AuthorDetail` type.)

- [ ] **Step 2: Run it → FAIL.** `npm test -- AuthorDetailView`

- [ ] **Step 3: Implement.** Update `AuthorDetailView` to accept `allTags: string[]` and `onSetTags: (tags: string[]) => void`, and render `<TagEditor>` under the `<h1>`:
```tsx
import type { AuthorDetail, ChapterRow } from "../lib/api";
import { TagEditor } from "./TagEditor";

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function AuthorDetailView(props: {
  detail: AuthorDetail;
  onTogglePlayed: (chapterId: number, played: boolean) => void;
  onPlayChapter: (chapter: ChapterRow) => void;
  onSetTags: (tags: string[]) => void;
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
                  <input type="checkbox" checked={c.played} onChange={(e) => props.onTogglePlayed(c.id, e.target.checked)} />
                </label>
                <span className="chapter-title">{c.title}</span>{" — "}
                <span className="chapter-duration">{formatDuration(c.durationSecs)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run it → PASS.** `npm test -- AuthorDetailView`

- [ ] **Step 5: Commit.**
```powershell
git add -A; git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "feat: author tag editing in the author view"
```

---

## Task 6: DiscoveryView component (TDD)

**Files:** `src/views/DiscoveryView.tsx`, `src/views/DiscoveryView.test.tsx`

- [ ] **Step 1: Write the failing test** (`src/views/DiscoveryView.test.tsx`):
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiscoveryView } from "./DiscoveryView";
import type { DiscoveryWork } from "../lib/api";

const forYou: DiscoveryWork[] = [
  { workId: 1, baseTitle: "Night Walk", authorId: 2, authorName: "Sam Smith", unplayedCount: 2, sharedTags: ["cozy"] },
];

describe("DiscoveryView", () => {
  it("shows the For You suggestions", () => {
    render(<DiscoveryView forYou={forYou} allTags={["cozy", "calm"]} byTags={[]} onPickTags={() => {}} onOpenAuthor={() => {}} onBack={() => {}} />);
    expect(screen.getByText("Night Walk")).toBeInTheDocument();
    expect(screen.getByText(/Sam Smith/)).toBeInTheDocument();
  });

  it("requests by-tag discovery when tags are picked", async () => {
    const onPick = vi.fn();
    render(<DiscoveryView forYou={forYou} allTags={["cozy", "calm"]} byTags={[]} onPickTags={onPick} onOpenAuthor={() => {}} onBack={() => {}} />);
    await userEvent.click(screen.getByLabelText("Filter by tag cozy"));
    expect(onPick).toHaveBeenCalledWith(["cozy"]);
  });

  it("opens an author from a suggestion", async () => {
    const onOpen = vi.fn();
    render(<DiscoveryView forYou={forYou} allTags={["cozy"]} byTags={[]} onPickTags={() => {}} onOpenAuthor={onOpen} onBack={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Open Sam Smith" }));
    expect(onOpen).toHaveBeenCalledWith(2);
  });
});
```

- [ ] **Step 2: Run it → FAIL.** `npm test -- DiscoveryView`

- [ ] **Step 3: Implement** (`src/views/DiscoveryView.tsx`):
```tsx
import { useState } from "react";
import type { DiscoveryWork } from "../lib/api";

function WorkList(props: { works: DiscoveryWork[]; onOpenAuthor: (id: number) => void }) {
  if (props.works.length === 0) return <p className="discovery-empty">Nothing to suggest yet.</p>;
  return (
    <ul className="discovery-list">
      {props.works.map((w) => (
        <li key={w.workId}>
          <span className="discovery-title">{w.baseTitle}</span>
          {" — "}
          <button aria-label={`Open ${w.authorName}`} onClick={() => props.onOpenAuthor(w.authorId)}>{w.authorName}</button>
          {" · "}
          <span className="discovery-meta">{w.unplayedCount} unplayed{w.sharedTags.length > 0 ? ` · ${w.sharedTags.join(", ")}` : ""}</span>
        </li>
      ))}
    </ul>
  );
}

export function DiscoveryView(props: {
  forYou: DiscoveryWork[];
  allTags: string[];
  byTags: DiscoveryWork[];
  onPickTags: (tags: string[]) => void;
  onOpenAuthor: (id: number) => void;
  onBack: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);

  function toggleTag(tag: string) {
    const next = picked.includes(tag) ? picked.filter((t) => t !== tag) : [...picked, tag];
    setPicked(next);
    props.onPickTags(next);
  }

  return (
    <div className="discovery">
      <button onClick={props.onBack}>← Library</button>
      <h1>Discover</h1>

      <section>
        <h2>For you</h2>
        <WorkList works={props.forYou} onOpenAuthor={props.onOpenAuthor} />
      </section>

      <section>
        <h2>Pick a tag</h2>
        <div className="tag-picker">
          {props.allTags.map((t) => (
            <label key={t} aria-label={`Filter by tag ${t}`}>
              <input type="checkbox" checked={picked.includes(t)} onChange={() => toggleTag(t)} /> {t}
            </label>
          ))}
        </div>
        {picked.length > 0 && <WorkList works={props.byTags} onOpenAuthor={props.onOpenAuthor} />}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run it → PASS (3 tests).** `npm test -- DiscoveryView`

- [ ] **Step 5: Commit.**
```powershell
git add -A; git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "feat: DiscoveryView (For you + Pick a tag)"
```

---

## Task 7: LibraryView — Discover entry (TDD)

**Files:** `src/views/LibraryView.tsx`, `src/views/LibraryView.test.tsx`

- [ ] **Step 1: Update the test.** Add `onOpenDiscovery` to existing renders and a new test. Add `onOpenDiscovery={() => {}}` to the two existing `render(<LibraryView .../>)` calls, and append:
```tsx
  it("opens discovery", async () => {
    const onDisc = vi.fn();
    render(<LibraryView authors={authors} onOpenAuthor={() => {}} onOpenDiscovery={onDisc} />);
    await userEvent.click(screen.getByRole("button", { name: "Discover" }));
    expect(onDisc).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run it → FAIL.** `npm test -- LibraryView`

- [ ] **Step 3: Implement.** Add the `onOpenDiscovery` prop and a Discover button above the search input:
```tsx
import { useMemo, useState } from "react";
import type { AuthorRow } from "../lib/api";
import { matchesSearch, summarizeAuthor } from "../lib/library";

export function LibraryView(props: {
  authors: AuthorRow[];
  onOpenAuthor: (id: number) => void;
  onOpenDiscovery: () => void;
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(
    () => props.authors.filter((a) => matchesSearch(a, query)),
    [props.authors, query],
  );
  return (
    <div className="library">
      <button onClick={props.onOpenDiscovery}>Discover</button>
      <input placeholder="Search authors" value={query} onChange={(e) => setQuery(e.target.value)} />
      <ul>
        {shown.map((a) => (
          <li key={a.id}>
            <button onClick={() => props.onOpenAuthor(a.id)}>
              <span className="author-name">{a.name}</span>{" — "}
              <span className="author-summary">{summarizeAuthor(a)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run it → PASS.** `npm test -- LibraryView`

- [ ] **Step 5: Commit.**
```powershell
git add -A; git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "feat: Discover entry point in the library view"
```

---

## Task 8: Harness — discovery walkthrough

**Files:** `src/harness/walkthroughs.ts`

- [ ] **Step 1: Add `discoverySteps` and extend the list.** Append to `walkthroughs.ts`:
```ts
export function discoverySteps(nav: {
  seed: () => Promise<void>;
  openDiscovery: () => Promise<void>;
  pickFirstTag: () => Promise<void>;
}): Step[] {
  return [
    { name: "seed", run: nav.seed },
    { name: "discovery", run: nav.openDiscovery },
    { name: "by-tag", run: nav.pickFirstTag },
  ];
}
```
and change the `walkthroughs` constant to:
```ts
export const walkthroughs = ["browse", "player", "discovery"] as const;
```

- [ ] **Step 2: tsc + runner tests.** `npx tsc --noEmit` (App not yet using `discoverySteps` is fine — additive export). `npm test -- runner` → green.

- [ ] **Step 3: Commit.**
```powershell
git add -A; git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "feat: discovery harness walkthrough steps"
```

---

## Task 9: App.tsx — discovery route + tag wiring + walkthrough

**Files:** `src/App.tsx`

- [ ] **Step 1: Edit `src/App.tsx`** to add the discovery route, tag editing, discovery data loading, and the `discovery` walkthrough. Apply these changes to the current file:

1. Extend imports from `./lib/api`: add `getAllTags, setAuthorTags, getDiscovery, getDiscoveryByTags, type DiscoveryWork`.
2. Add imports: `import { DiscoveryView } from "./views/DiscoveryView";` and add `discoverySteps` to the `./harness/walkthroughs` import.
3. Add the `"discovery"` variant to the `Route` union.
4. Add state: `const [allTags, setAllTags] = useState<string[]>([]);`, `const [forYou, setForYou] = useState<DiscoveryWork[]>([]);`, `const [byTags, setByTags] = useState<DiscoveryWork[]>([]);`.
5. Add helpers:
```tsx
  async function refreshTags() { setAllTags(await getAllTags()); }

  async function setTags(tags: string[]) {
    if (!detailRef.current) return;
    await setAuthorTags(detailRef.current.id, tags);
    setDetail(await getAuthorDetail(detailRef.current.id));
    await refreshTags();
  }

  async function openDiscovery() {
    setForYou(await getDiscovery());
    await refreshTags();
    setByTags([]);
    setRoute({ kind: "discovery" });
  }

  async function pickTags(tags: string[]) {
    setByTags(tags.length === 0 ? [] : await getDiscoveryByTags(tags));
  }
```
6. In the initial `loadAuthors()` path (after `await loadAuthors();` in both branches) also call `await refreshTags();` once — simplest: add `await refreshTags();` right after the `if (args.library) { ... } else { ... }` block.
7. In `routedView()`, add before the final `return <LibraryView .../>`:
```tsx
    if (route.kind === "discovery") {
      return (
        <DiscoveryView
          forYou={forYou}
          allTags={allTags}
          byTags={byTags}
          onPickTags={pickTags}
          onOpenAuthor={openAuthor}
          onBack={() => setRoute({ kind: "library" })}
        />
      );
    }
```
8. Pass the new props to `AuthorDetailView`: add `onSetTags={setTags}` and `allTags={allTags}`.
9. Pass the new prop to `LibraryView`: add `onOpenDiscovery={openDiscovery}`.
10. In the harness dispatch, add a `discovery` branch. Replace the `const steps = args.walkthrough === "player" ? ... : browseSteps(...)` selection with a three-way choice:
```tsx
        const steps =
          args.walkthrough === "player"
            ? playerSteps({ openFirstAuthor, playFirstChapter: async () => {
                const list = await getAuthors();
                if (list.length === 0) return;
                const d = await getAuthorDetail(list[0].id);
                const first = d.works[0]?.chapters[0];
                if (first) playChapter(first);
              } })
            : args.walkthrough === "discovery"
            ? discoverySteps({
                // Seed tags + a play event so For-you and Pick-a-tag have data.
                seed: async () => {
                  const list = await getAuthors();
                  for (const a of list) await setAuthorTags(a.id, ["cozy"]);
                  if (list.length > 0) {
                    const d = await getAuthorDetail(list[0].id);
                    const ch = d.works[0]?.chapters[0];
                    if (ch) { await markChapterFinished(ch.id, Date.now()); }
                  }
                  await refreshTags();
                },
                openDiscovery,
                pickFirstTag: async () => { await pickTags(["cozy"]); },
              })
            : browseSteps({
                showScanResult: async () => setRoute({ kind: "scan" }),
                showLibrary: async () => setRoute({ kind: "library" }),
                openFirstAuthor,
              });
```
(Keep the existing `openFirstAuthor` const defined above this block; keep `markChapterFinished` imported — it already is from M2.)

- [ ] **Step 2: Type-check, test, build (FOREGROUND).**
```powershell
npx tsc --noEmit; npm test; npm run build
```
Expected: tsc clean; all Vitest tests pass; vite build succeeds. If tsc flags a missing import or prop, fix minimally to match the signatures defined in Tasks 3–8.

- [ ] **Step 3: Commit.**
```powershell
git add -A; git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "feat: wire discovery route, tag editing, and discovery walkthrough into App"
```

---

## Task 10: Visual self-verification

**Files:** none (controller verification; fixes go to the relevant file).

- [ ] **Step 1: Run all three walkthroughs.**
```powershell
powershell -ExecutionPolicy Bypass -File tools\verify.ps1 -Walkthrough browse
powershell -ExecutionPolicy Bypass -File tools\verify.ps1 -Walkthrough discovery -SkipBuild
powershell -ExecutionPolicy Bypass -File tools\verify.ps1 -Walkthrough player -SkipBuild
```
- [ ] **Step 2: Inspect screenshots.** `browse/03-author-detail.png` now shows the **tag editor** under the author name. `discovery/02-discovery.png` shows the **For you** list (seeded "cozy" suggestions) and the **Pick a tag** checkboxes. `discovery/03-by-tag.png` shows by-tag results after picking "cozy". `player/02-player.png` still shows the now-playing bar.
- [ ] **Step 3: Fix any defect** (e.g. empty For-you because seeding excluded all authors, controls missing) and re-run the affected walkthrough until clean.
- [ ] **Step 4: Commit** any fixes (skip if none).

---

## Task 11: README + finish

**Files:** `README.md`

- [ ] **Step 1: Update README** — move M3 to Shipped; add a "Tags & Discovery" section (tag authors; For-you / Pick-a-tag / discovery); mention the `discovery` walkthrough; link the M3 plan.
- [ ] **Step 2: Commit.**
```powershell
git add -A; git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "docs: README tags & discovery (M3) update"
```
- [ ] **Step 3: Finish per the runbook** (controller): final gates (tsc, npm test, cargo test) → push `m3-discovery` → `gh pr create` → **foreground** `gh pr checks <PR#> --watch` → merge from main with `--merge --delete-branch` → sync main → update the runbook Progress Log.

---

## Self-Review (against spec §7–8)

- Author tags assigned from author view, autocomplete from existing → `TagEditor` + `set_author_tags`/`get_all_tags` (Tasks 1,3,4,5). ✓
- "For you" from tags of recently-played authors → `discovery_for_you` (Task 2), `getDiscovery` → DiscoveryView For-you (Tasks 3,6,9). ✓
- "Pick a tag" multi-select → similar-tagged, mostly-unplayed → `discovery_for_tags` (only `unplayed_count>0`, ranked by shared tags) + DiscoveryView tag picker (Tasks 2,6,9). ✓
- "More from this author" → `more_from_author`/`get_more_from_author` command (Task 2). Surfaced contextually via `onOpenAuthor` from suggestions (the author view already lists all their works). ✓
- Tags author-level only; no schema change (reused `author_tags`, `play_events`). ✓
- Read-only on audio files preserved (only DB writes). ✓

**Placeholder scan:** none. **Type consistency:** `DiscoveryWork`/`MoreWork` fields match Rust camelCase ↔ api.ts; `AuthorDetail.tags` added in both Rust and TS; new props (`onSetTags`, `allTags`, `onOpenDiscovery`, DiscoveryView props) match call sites in App (Task 9).

> Note (Task 9 seeding): the `discovery` walkthrough tags ALL authors "cozy" and plays one author's chapter, so "For you" excludes that one author but the others share "cozy" → non-empty. If verification shows an empty For-you, adjust the seed to tag only a subset.
