# M9 — Work & Chapter Tags

**Written for Sonnet execution. If something doesn't match what's described here (a signature, a line, a struct), STOP and report rather than guess — the codebase may have drifted.**

## Goal

Extend tagging beyond author-level (M3) down to **works** and **chapters**:

1. **Schema:** two new tables `work_tags` / `chapter_tags` (idempotent `CREATE TABLE IF NOT EXISTS`, same pattern as `author_tags`).
2. **Editing UI:** reuse the existing generic `<TagEditor>` — an always-visible work-level editor under each work heading, and a **toggle-to-reveal** chapter-level editor per chapter (open-by-default when a chapter already has tags, so untagged chapters stay uncluttered).
3. **Discovery (union semantics):** a work matches a picked tag if **its author OR the work itself** carries that tag; `sharedTags` = the union. Chapter tags do **not** feed Discover. "For you" also seeds from recent authors' works' work-tags.
4. **Search:** a work/chapter also becomes a search hit when one of its **tags** contains the query substring (folded into the existing works/chapters buckets).
5. **Tag list:** `get_all_tags` returns the union of distinct tags across all three tables.

**Constraints / invariants (do not violate):**
- **No audio-file mutation.** The only new writes are SQLite rows in `work_tags`/`chapter_tags`. Read-only-on-disk stays intact.
- **Fixture counts unchanged.** Tags are seeded at **runtime** (like the M3 discovery walkthrough seeds author tags), NOT via on-disk fixtures. `src-tauri/tests/fixture_scan.rs` must stay **43 / 44 / 47** — do not touch it.
- **Backward compatible discovery.** The refactor of `discovery_for_tags` must keep the existing test `discovery_by_tags_ranks_shared_then_unplayed` green (author-tagged works surface identically; work tags only *add* matches).
- App ships **no stylesheet** — don't add CSS files; reuse existing `className`s and inline patterns already in the views.
- Commit identity & trailer per ROADMAP Conventions. `cargo` runs in the **FOREGROUND** via `tools\dev-env.cmd`.

---

## Task 1 — Schema: add `work_tags` + `chapter_tags`

**File:** `src-tauri/src/db.rs`. Inside the `SCHEMA_V1` constant, the `author_tags` table is defined like:

```rust
CREATE TABLE IF NOT EXISTS author_tags (
  author_id INTEGER NOT NULL REFERENCES authors(id),
  tag TEXT NOT NULL,
  PRIMARY KEY (author_id, tag)
);
```

**Immediately after** that `author_tags` block (still inside the same `SCHEMA_V1` raw string), add:

```rust
CREATE TABLE IF NOT EXISTS work_tags (
  work_id INTEGER NOT NULL REFERENCES works(id),
  tag TEXT NOT NULL,
  PRIMARY KEY (work_id, tag)
);
CREATE TABLE IF NOT EXISTS chapter_tags (
  chapter_id INTEGER NOT NULL REFERENCES chapters(id),
  tag TEXT NOT NULL,
  PRIMARY KEY (chapter_id, tag)
);
```

No migration-version bump, no runner change — `migrate()` already executes the whole `SCHEMA_V1` batch idempotently for both file-backed and in-memory connections. Old DBs pick the new tables up via `IF NOT EXISTS` on next open.

---

## Task 2 — Models: add `tags` to `WorkRow` and `ChapterRow`

**File:** `src-tauri/src/model.rs`.

`WorkRow` (currently):
```rust
pub struct WorkRow {
    pub id: i64,
    pub base_title: String,
    pub chapters: Vec<ChapterRow>,
}
```
→ add a `tags` field:
```rust
pub struct WorkRow {
    pub id: i64,
    pub base_title: String,
    pub tags: Vec<String>,
    pub chapters: Vec<ChapterRow>,
}
```

`ChapterRow` (currently ends `pub played: bool,`) → add `tags`:
```rust
pub struct ChapterRow {
    pub id: i64,
    pub title: String,
    pub chapter_no: i64,
    pub format: String,
    pub duration_secs: i64,
    pub file_path: String,
    pub played: bool,
    pub tags: Vec<String>,
}
```

Both derive `Serialize, Debug, PartialEq` with `#[serde(rename_all = "camelCase")]` — `tags` serializes as `tags` (no rename needed). Adding these fields will break the two struct-literal construction sites in `commands.rs` (`query_author_detail`); Task 3 fixes them.

---

## Task 3 — Backend commands (`src-tauri/src/commands.rs`)

### 3a. Generic tag-replace helper + work/chapter commands

The existing author helper is:
```rust
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

**Replace that whole `set_tags` fn** with a generic helper plus a thin author alias (keeps existing tests that call `super::set_tags` working). `table`/`key_col` are compile-time `&'static str` literals supplied only by our own code — never user input — so the `format!` interpolation is injection-safe:

```rust
/// Replace an entity's tag set in `table` (deduped, blanks dropped, trimmed).
/// `table`/`key_col` are caller-provided compile-time constants (never user input).
pub(crate) fn replace_tags(
    conn: &rusqlite::Connection,
    table: &'static str,
    key_col: &'static str,
    id: i64,
    tags: &[String],
) -> rusqlite::Result<()> {
    conn.execute(&format!("DELETE FROM {table} WHERE {key_col}=?1"), params![id])?;
    let mut seen = std::collections::BTreeSet::new();
    for raw in tags {
        let t = raw.trim();
        if t.is_empty() || !seen.insert(t.to_string()) { continue; }
        conn.execute(
            &format!("INSERT OR IGNORE INTO {table}({key_col}, tag) VALUES (?1, ?2)"),
            params![id, t],
        )?;
    }
    Ok(())
}

/// Replace an author's tag set. Kept as a named alias for existing call sites/tests.
pub(crate) fn set_tags(conn: &rusqlite::Connection, author_id: i64, tags: &[String]) -> rusqlite::Result<()> {
    replace_tags(conn, "author_tags", "author_id", id_eq(author_id), tags)
}
```

> ⚠️ Correction — do **not** write `id_eq(...)`; that helper does not exist. The alias body is simply:
> ```rust
> pub(crate) fn set_tags(conn: &rusqlite::Connection, author_id: i64, tags: &[String]) -> rusqlite::Result<()> {
>     replace_tags(conn, "author_tags", "author_id", author_id, tags)
> }
> ```

**Add two new Tauri commands** next to the existing `set_author_tags` command:
```rust
#[tauri::command]
pub fn set_work_tags(state: tauri::State<DbState>, work_id: i64, tags: Vec<String>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    replace_tags(&conn, "work_tags", "work_id", work_id, &tags).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_chapter_tags(state: tauri::State<DbState>, chapter_id: i64, tags: Vec<String>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    replace_tags(&conn, "chapter_tags", "chapter_id", chapter_id, &tags).map_err(|e| e.to_string())
}
```

### 3b. `get_all_tags` — union across all three tables

Replace the prepared statement in `get_all_tags`:
```rust
let mut stmt = conn.prepare("SELECT DISTINCT tag FROM author_tags ORDER BY tag").map_err(|e| e.to_string())?;
```
with:
```rust
let mut stmt = conn.prepare(
    "SELECT tag FROM author_tags
     UNION SELECT tag FROM work_tags
     UNION SELECT tag FROM chapter_tags
     ORDER BY tag",
).map_err(|e| e.to_string())?;
```
(`UNION` already de-duplicates.)

### 3c. `query_author_detail` — populate `work.tags` and `chapter.tags`

In `query_author_detail`:

(i) The `WorkRow` literal currently reads:
```rust
Ok(WorkRow { id: r.get(0)?, base_title: r.get(1)?, chapters: Vec::new() })
```
→ add the new field:
```rust
Ok(WorkRow { id: r.get(0)?, base_title: r.get(1)?, tags: Vec::new(), chapters: Vec::new() })
```

(ii) The `ChapterRow` literal currently ends `played: r.get::<_, i64>(6)? != 0,` — add `tags: Vec::new(),` as the last field:
```rust
Ok(ChapterRow {
    id: r.get(0)?,
    title,
    chapter_no: r.get(2)?,
    format: r.get(3)?,
    duration_secs: r.get(4)?,
    file_path: r.get(5)?,
    played: r.get::<_, i64>(6)? != 0,
    tags: Vec::new(),
})
```

(iii) Inside the `for work in &mut works { ... }` loop, **after** `work.chapters = chapters;`, populate tags for the work and each chapter:
```rust
        work.chapters = chapters;

        // Work-level tags.
        let mut wt = conn.prepare("SELECT tag FROM work_tags WHERE work_id=?1 ORDER BY tag")?;
        work.tags = wt
            .query_map(params![work.id], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<_>>()?;

        // Chapter-level tags.
        for ch in &mut work.chapters {
            let mut ct = conn.prepare("SELECT tag FROM chapter_tags WHERE chapter_id=?1 ORDER BY tag")?;
            ch.tags = ct
                .query_map(params![ch.id], |r| r.get::<_, String>(0))?
                .collect::<rusqlite::Result<_>>()?;
        }
```

### 3d. `search` — also match work/chapter **tags**

In `search`, the works query currently has:
```rust
        "SELECT w.id, w.base_title, a.id, COALESCE(a.display_name, a.folder_name)
         FROM works w JOIN authors a ON w.author_id=a.id
         WHERE w.status='active' AND a.status='active' AND w.base_title LIKE ?1 ESCAPE '\\'
         ORDER BY w.base_title LIMIT ?2",
```
Replace the `WHERE` line's title-only predicate with a title-OR-tag predicate:
```rust
        "SELECT w.id, w.base_title, a.id, COALESCE(a.display_name, a.folder_name)
         FROM works w JOIN authors a ON w.author_id=a.id
         WHERE w.status='active' AND a.status='active'
               AND (w.base_title LIKE ?1 ESCAPE '\\'
                    OR EXISTS (SELECT 1 FROM work_tags wt WHERE wt.work_id=w.id AND wt.tag LIKE ?1 ESCAPE '\\'))
         ORDER BY w.base_title LIMIT ?2",
```

The chapters query currently has:
```rust
        "SELECT c.id, c.raw_filename, w.id, w.base_title, a.id, COALESCE(a.display_name, a.folder_name)
         FROM chapters c JOIN works w ON c.work_id=w.id JOIN authors a ON w.author_id=a.id
         WHERE c.status='active' AND w.status='active' AND a.status='active'
               AND c.raw_filename LIKE ?1 ESCAPE '\\'
         ORDER BY c.raw_filename LIMIT ?2",
```
Replace the `c.raw_filename LIKE ...` predicate with raw-filename-OR-tag:
```rust
        "SELECT c.id, c.raw_filename, w.id, w.base_title, a.id, COALESCE(a.display_name, a.folder_name)
         FROM chapters c JOIN works w ON c.work_id=w.id JOIN authors a ON w.author_id=a.id
         WHERE c.status='active' AND w.status='active' AND a.status='active'
               AND (c.raw_filename LIKE ?1 ESCAPE '\\'
                    OR EXISTS (SELECT 1 FROM chapter_tags ct WHERE ct.chapter_id=c.id AND ct.tag LIKE ?1 ESCAPE '\\'))
         ORDER BY c.raw_filename LIMIT ?2",
```
(The `?1`/`?2` bindings are unchanged — `like` is already bound once and reused by SQLite for every `?1`.)

### 3e. `discovery_for_tags` — union author + work tags (work-centric refactor)

**Replace the entire body** of `discovery_for_tags` (keep the exact same `pub(crate) fn discovery_for_tags(conn, tags, exclude_authors, cap) -> rusqlite::Result<Vec<DiscoveryWork>>` signature) with this work-centric version. It iterates active works with ≥1 unplayed chapter and matches each on the **union** of its author's tags and its own work tags:

```rust
/// Works (with unplayed chapters) whose author OR the work itself carries any of
/// `tags`, ranked by shared-tag count then unplayed count. `exclude_authors` are
/// filtered out. `sharedTags` is the union of matching author- and work-level tags.
pub(crate) fn discovery_for_tags(
    conn: &rusqlite::Connection,
    tags: &[String],
    exclude_authors: &[i64],
    cap: usize,
) -> rusqlite::Result<Vec<DiscoveryWork>> {
    if tags.is_empty() {
        return Ok(Vec::new());
    }
    let mut works: Vec<DiscoveryWork> = Vec::new();

    // All active works (with their author) that have >=1 unplayed chapter.
    let mut wstmt = conn.prepare(
        "SELECT w.id, w.base_title, a.id, COALESCE(a.display_name, a.folder_name),
                (SELECT count(*) FROM chapters c WHERE c.work_id=w.id AND c.status='active' AND c.played=0)
         FROM works w JOIN authors a ON w.author_id=a.id
         WHERE w.status='active' AND a.status='active'",
    )?;
    let rows: Vec<(i64, String, i64, String, i64)> = wstmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?
        .collect::<rusqlite::Result<_>>()?;

    for (work_id, base_title, author_id, author_name, unplayed) in rows {
        if unplayed == 0 || exclude_authors.contains(&author_id) {
            continue;
        }
        // Union of this work's author tags and its own work tags.
        let mut owned: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
        let mut atstmt = conn.prepare("SELECT tag FROM author_tags WHERE author_id=?1")?;
        for t in atstmt.query_map(params![author_id], |r| r.get::<_, String>(0))? {
            owned.insert(t?);
        }
        let mut wtstmt = conn.prepare("SELECT tag FROM work_tags WHERE work_id=?1")?;
        for t in wtstmt.query_map(params![work_id], |r| r.get::<_, String>(0))? {
            owned.insert(t?);
        }
        // Intersect with the requested tags. BTreeSet keeps `shared` sorted.
        let shared: Vec<String> = owned.into_iter().filter(|t| tags.contains(t)).collect();
        if shared.is_empty() {
            continue;
        }
        works.push(DiscoveryWork {
            work_id,
            base_title,
            author_id,
            author_name,
            unplayed_count: unplayed,
            shared_tags: shared,
        });
    }

    works.sort_by(|a, b| {
        b.shared_tags.len().cmp(&a.shared_tags.len())
            .then(b.unplayed_count.cmp(&a.unplayed_count))
            .then(a.base_title.to_lowercase().cmp(&b.base_title.to_lowercase()))
    });
    works.truncate(cap);
    Ok(works)
}
```

> Why this stays backward-compatible: for a work whose author has a matching tag but the work has none, `shared = author_tags ∩ tags` — identical to the old author-centric result. Work tags only *add* matches. The existing `discovery_by_tags_ranks_shared_then_unplayed` test (Alice cozy+calm → `["calm","cozy"]`, Bob cozy → `["cozy"]`) still passes.

### 3f. `discovery_for_you` — also seed from recent authors' work-tags

In `discovery_for_you`, the tag-collection loop currently is:
```rust
    for id in &recent {
        let mut stmt = conn.prepare("SELECT tag FROM author_tags WHERE author_id=?1")?;
        for t in stmt.query_map(params![id], |r| r.get::<_, String>(0))? {
            tags.insert(t?);
        }
    }
```
Append a second gather so work-level tags of recent authors' works also seed "For you":
```rust
    for id in &recent {
        let mut stmt = conn.prepare("SELECT tag FROM author_tags WHERE author_id=?1")?;
        for t in stmt.query_map(params![id], |r| r.get::<_, String>(0))? {
            tags.insert(t?);
        }
        let mut wstmt = conn.prepare(
            "SELECT wt.tag FROM work_tags wt JOIN works w ON wt.work_id=w.id WHERE w.author_id=?1",
        )?;
        for t in wstmt.query_map(params![id], |r| r.get::<_, String>(0))? {
            tags.insert(t?);
        }
    }
```

---

## Task 4 — Register the new commands

**File:** `src-tauri/src/lib.rs`. In the `tauri::generate_handler![ ... ]` list, the line `set_author_tags,` exists. Add the two new commands right after it:
```rust
            set_author_tags,
            set_work_tags,
            set_chapter_tags,
```
(They are `pub` in `commands.rs` and already brought into scope by the existing `use commands::*;` / explicit imports — match however `set_author_tags` is imported at the top of `lib.rs`; if commands are imported by explicit name, add `set_work_tags, set_chapter_tags` to that `use` list too. If `set_author_tags` resolves via a glob import, nothing else is needed.)

---

## Task 5 — Rust tests (`src-tauri/src/commands.rs` test module)

The test module already contains `tags_round_trip_and_dedupe` and `discovery_by_tags_ranks_shared_then_unplayed`, plus a `touch(...)` helper and uses `open_in_memory()`, `scan::scan_into`, `query_authors`, `query_author_detail`. Add the following tests **in that same `#[cfg(test)] mod tests` block**, mirroring that style:

```rust
#[test]
fn work_and_chapter_tags_round_trip() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    touch(&root.join("A").join("X.mp3"));
    let conn = open_in_memory().unwrap();
    scan::scan_into(&conn, root).unwrap();
    let author_id = query_authors(&conn).unwrap()[0].id;
    let detail = query_author_detail(&conn, author_id).unwrap();
    let work_id = detail.works[0].id;
    let chapter_id = detail.works[0].chapters[0].id;

    super::replace_tags(&conn, "work_tags", "work_id", work_id,
        &["epic".into(), " epic ".into(), "".into(), "saga".into()]).unwrap();
    super::replace_tags(&conn, "chapter_tags", "chapter_id", chapter_id,
        &["intro".into()]).unwrap();

    let d = query_author_detail(&conn, author_id).unwrap();
    assert_eq!(d.works[0].tags, vec!["epic".to_string(), "saga".to_string()]); // sorted, deduped, trimmed
    assert_eq!(d.works[0].chapters[0].tags, vec!["intro".to_string()]);

    // Replace-all semantics.
    super::replace_tags(&conn, "work_tags", "work_id", work_id, &["calm".into()]).unwrap();
    assert_eq!(query_author_detail(&conn, author_id).unwrap().works[0].tags, vec!["calm".to_string()]);
}

#[test]
fn get_all_tags_unions_all_levels() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    touch(&root.join("A").join("X.mp3"));
    let conn = open_in_memory().unwrap();
    scan::scan_into(&conn, root).unwrap();
    let author_id = query_authors(&conn).unwrap()[0].id;
    let detail = query_author_detail(&conn, author_id).unwrap();
    let work_id = detail.works[0].id;
    let chapter_id = detail.works[0].chapters[0].id;

    super::set_tags(&conn, author_id, &["cozy".into()]).unwrap();
    super::replace_tags(&conn, "work_tags", "work_id", work_id, &["cozy".into(), "epic".into()]).unwrap();
    super::replace_tags(&conn, "chapter_tags", "chapter_id", chapter_id, &["intro".into()]).unwrap();

    // get_all_tags is a #[tauri::command] needing State; assert the underlying union SQL instead.
    let mut stmt = conn.prepare(
        "SELECT tag FROM author_tags
         UNION SELECT tag FROM work_tags
         UNION SELECT tag FROM chapter_tags
         ORDER BY tag",
    ).unwrap();
    let all: Vec<String> = stmt.query_map([], |r| r.get::<_, String>(0)).unwrap()
        .collect::<rusqlite::Result<_>>().unwrap();
    assert_eq!(all, vec!["cozy".to_string(), "epic".to_string(), "intro".to_string()]);
}

#[test]
fn discovery_unions_author_and_work_tags() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    touch(&root.join("Alice").join("Tale.mp3"));
    touch(&root.join("Bob").join("Saga.mp3"));
    let conn = open_in_memory().unwrap();
    scan::scan_into(&conn, root).unwrap();
    let ids: std::collections::HashMap<String, i64> =
        query_authors(&conn).unwrap().into_iter().map(|a| (a.name, a.id)).collect();

    // Bob has NO author tags, but his work "Saga" carries "cozy" at the work level.
    let bob_detail = query_author_detail(&conn, ids["Bob"]).unwrap();
    let saga_id = bob_detail.works[0].id;
    super::replace_tags(&conn, "work_tags", "work_id", saga_id, &["cozy".into()]).unwrap();
    // Alice has author tag "cozy".
    super::set_tags(&conn, ids["Alice"], &["cozy".into()]).unwrap();

    let res = super::discovery_for_tags(&conn, &["cozy".into()], &[], 50).unwrap();
    let titles: Vec<&str> = res.iter().map(|w| w.base_title.as_str()).collect();
    assert!(titles.contains(&"Tale"), "author-tag match should surface");
    assert!(titles.contains(&"Saga"), "work-tag match should surface (union)");
    assert!(res.iter().all(|w| w.shared_tags == vec!["cozy".to_string()]));
}

#[test]
fn search_matches_work_and_chapter_tags() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    touch(&root.join("A").join("Quiet One.mp3"));
    let conn = open_in_memory().unwrap();
    scan::scan_into(&conn, root).unwrap();
    let author_id = query_authors(&conn).unwrap()[0].id;
    let detail = query_author_detail(&conn, author_id).unwrap();
    let work_id = detail.works[0].id;
    let chapter_id = detail.works[0].chapters[0].id;

    super::replace_tags(&conn, "work_tags", "work_id", work_id, &["mystery".into()]).unwrap();
    super::replace_tags(&conn, "chapter_tags", "chapter_id", chapter_id, &["cliffhanger".into()]).unwrap();

    // "mystery" matches no title/filename, only the work tag.
    let r1 = super::search(&conn, "mystery", 50).unwrap();
    assert_eq!(r1.works.len(), 1);
    assert_eq!(r1.works[0].work_id, work_id);

    // "cliffhanger" matches only the chapter tag.
    let r2 = super::search(&conn, "cliffhanger", 50).unwrap();
    assert_eq!(r2.chapters.len(), 1);
    assert_eq!(r2.chapters[0].chapter_id, chapter_id);
}
```

> If `query_author_detail`, `search`, `discovery_for_tags`, `set_tags`, `replace_tags`, or `query_authors` are referenced as `super::name` vs bare `name` differently from the existing tests, **match the existing tests' call convention** in that module (they already call e.g. `super::set_tags` and bare `query_author_detail` / `query_authors`).

---

## Task 6 — Frontend API (`src/lib/api.ts`)

(i) Extend the two interfaces:
```ts
export interface ChapterRow {
  id: number; title: string; chapterNo: number; format: string;
  durationSecs: number; filePath: string; played: boolean; tags: string[];
}
export interface WorkRow { id: number; baseTitle: string; tags: string[]; chapters: ChapterRow[]; }
```

(ii) Add invoke wrappers right after `setAuthorTags` (camelCase keys match the Rust command params `workId`/`chapterId`/`tags`):
```ts
export const setWorkTags = (workId: number, tags: string[]) =>
  invoke("set_work_tags", { workId, tags });
export const setChapterTags = (chapterId: number, tags: string[]) =>
  invoke("set_chapter_tags", { chapterId, tags });
```

---

## Task 7 — Author Detail UI (`src/views/AuthorDetailView.tsx`)

(i) **New props** on `AuthorDetailView` — add to the props object type:
```ts
  onSetWorkTags: (workId: number, tags: string[]) => void;
  onSetChapterTags: (chapterId: number, tags: string[]) => void;
```

(ii) **Work-level editor (always visible).** In the `detail.works.map((w) => ...)` `<section>`, immediately **after** the `</h2>` and before `<ul>`, insert a labelled work TagEditor:
```tsx
          </h2>
          <div className="work-tags">
            <span className="work-tags-label">Tags:</span>
            <TagEditor
              tags={w.tags}
              allTags={props.allTags}
              onChange={(t) => props.onSetWorkTags(w.id, t)}
            />
          </div>
          <ul>
```

(iii) **Chapter-level editor (toggle-to-reveal, open-by-default when tagged).** Add a small component above `AuthorDetailView` (e.g. right after `ChapterGroupingForm`):
```tsx
function ChapterTags(props: {
  chapter: ChapterRow;
  allTags: string[];
  onSetChapterTags: (chapterId: number, tags: string[]) => void;
}) {
  const { chapter } = props;
  const [open, setOpen] = useState(chapter.tags.length > 0);
  return (
    <span className="chapter-tags">
      <button
        aria-label={`Toggle tags for '${chapter.title}'`}
        onClick={() => setOpen((o) => !o)}
      >
        🏷 Tags{chapter.tags.length > 0 ? ` (${chapter.tags.length})` : ""}
      </button>
      {open && (
        <TagEditor
          tags={chapter.tags}
          allTags={props.allTags}
          onChange={(t) => props.onSetChapterTags(chapter.id, t)}
        />
      )}
    </span>
  );
}
```
Then inside the chapter `<li>`, **after** the `<ChapterGroupingForm ... />` element, render it:
```tsx
                <ChapterGroupingForm
                  work={w}
                  chapter={c}
                  onSetGrouping={props.onSetGrouping}
                  onClearGrouping={props.onClearGrouping}
                />
                <ChapterTags
                  chapter={c}
                  allTags={props.allTags}
                  onSetChapterTags={props.onSetChapterTags}
                />
```
`ChapterRow` is already imported in this file; `useState` is already imported.

---

## Task 8 — App wiring (`src/App.tsx`)

(i) **Imports.** Add `setWorkTags, setChapterTags` to the `import { ... } from "./lib/api"` group that already includes `setAuthorTags`. Add `tagsSteps` to the `import { ... } from "./harness/walkthroughs"` line.

(ii) **Handlers.** Right after the existing `async function setTags(...)`, add two handlers that mirror it (write tags, then re-fetch the detail so the view reflects the change, then refresh the global tag list for autocomplete):
```ts
  async function setWorkTagsFor(workId: number, tags: string[]) {
    if (!detailRef.current) return;
    await setWorkTags(workId, tags);
    setDetail(await getAuthorDetail(detailRef.current.id));
    await refreshTags();
  }

  async function setChapterTagsFor(chapterId: number, tags: string[]) {
    if (!detailRef.current) return;
    await setChapterTags(chapterId, tags);
    setDetail(await getAuthorDetail(detailRef.current.id));
    await refreshTags();
  }
```

(iii) **Pass the props** to `<AuthorDetailView>` (in `routedView`), alongside `onSetTags={setTags}`:
```tsx
          onSetTags={setTags}
          onSetWorkTags={setWorkTagsFor}
          onSetChapterTags={setChapterTagsFor}
```

(iv) **Walkthrough dispatch.** In the big `args.walkthrough === ...` chain, add a `tags` branch (place it right after the `covers` branch, before the final `: browseSteps({...})`):
```tsx
            : args.walkthrough === "tags"
            ? tagsSteps({
                // Seed an author tag, a work tag, and a chapter tag on the first author.
                seed: async () => {
                  const list = await getAuthors();
                  if (list.length === 0) return;
                  await setAuthorTags(list[0].id, ["cozy"]);
                  const d = await getAuthorDetail(list[0].id);
                  const w = d.works[0];
                  if (w) {
                    await setWorkTags(w.id, ["mystery"]);
                    const ch = w.chapters[0];
                    if (ch) await setChapterTags(ch.id, ["intro"]);
                  }
                  await refreshTags();
                },
                openDetail: async () => {
                  const list = await getAuthors();
                  if (list.length > 0) await openAuthor(list[0].id);
                },
                searchByTag: async () => {
                  setRoute({ kind: "library" });
                  setQuery("mystery");
                  setResults(await searchLibrary("mystery"));
                },
              })
```
(`setAuthorTags`, `setWorkTags`, `setChapterTags`, `getAuthors`, `getAuthorDetail`, `openAuthor`, `refreshTags`, `setRoute`, `setQuery`, `setResults`, `searchLibrary` are all already in scope in this effect — confirm against the `discovery`/`m7` branches which use the same names.)

---

## Task 9 — Harness walkthrough (`src/harness/walkthroughs.ts`)

(i) Add `"tags"` to the `walkthroughs` tuple:
```ts
export const walkthroughs = ["browse", "player", "discovery", "rename", "grouping", "settings", "m7", "covers", "tags"] as const;
```

(ii) Add the step-builder (place near the other builders):
```ts
/**
 * Build the "tags" walkthrough: seed an author/work/chapter tag on the first
 * author, open its detail (showing all three tag levels — the chapter editor is
 * open-by-default because the chapter is tagged), then search the unique work tag
 * "mystery" to prove tags are searchable.
 */
export function tagsSteps(nav: {
  seed: () => Promise<void>;
  openDetail: () => Promise<void>;
  searchByTag: () => Promise<void>;
}): Step[] {
  return [
    { name: "seed", run: nav.seed },
    { name: "detail", run: nav.openDetail },
    { name: "search-by-tag", run: nav.searchByTag },
  ];
}
```

---

## Task 10 — Frontend tests

Add `src/views/AuthorDetailView.test.tsx` (mirror the existing `TagEditor.test.tsx` style — React Testing Library, `vitest`; check the exact imports used by `TagEditor.test.tsx` and match them). It must build a minimal `AuthorDetail` with one work (one tag) and one chapter (one tag) and assert:

1. The work-level TagEditor shows the work's tag, and adding a tag calls `onSetWorkTags(workId, [...])`.
2. The chapter tag toggle button renders; because the seeded chapter **has** a tag, its editor is open by default and shows the chapter tag; clicking the toggle hides it.
3. Removing a chapter tag calls `onSetChapterTags(chapterId, [])`.

Sketch (adapt imports/matchers to whatever `TagEditor.test.tsx` uses — do not invent a testing API):
```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { AuthorDetailView } from "./AuthorDetailView";
import type { AuthorDetail } from "../lib/api";

function detail(): AuthorDetail {
  return {
    id: 1, name: "Jane Doe", tags: ["cozy"],
    works: [{
      id: 10, baseTitle: "Cool Story", tags: ["mystery"],
      chapters: [{
        id: 100, title: "Ch 1", chapterNo: 1, format: "mp3",
        durationSecs: 65, filePath: "/x/Ch 1.mp3", played: false, tags: ["intro"],
      }],
    }],
  };
}

const noop = () => {};

test("work tag editor edits work tags", () => {
  const onSetWorkTags = vi.fn();
  render(
    <AuthorDetailView
      detail={detail()}
      onTogglePlayed={noop} onPlayChapter={noop} onSetTags={noop}
      onSetGrouping={noop} onClearGrouping={noop}
      onSetWorkTags={onSetWorkTags} onSetChapterTags={noop}
      allTags={["cozy", "mystery", "intro"]} onBack={noop}
    />
  );
  // "mystery" appears (work tag); add "epic" via the work editor's input.
  // (Disambiguate inputs by their position/placeholder; there are multiple "Add tag" inputs.)
  // ...assert onSetWorkTags called with [ "mystery", "epic" ].
});
```
Keep assertions robust to there being **multiple** "Add tag" inputs (author + each work + open chapter editors) — query by container/scope (e.g. `within(section)`), not a bare global `getByPlaceholderText`. If disambiguation gets awkward, it's acceptable to assert: (a) the chapter editor is open by default for a tagged chapter, (b) the toggle hides it, and (c) removing the visible chapter tag chip calls `onSetChapterTags(100, [])` — which uniquely exercises the new wiring without input ambiguity. Prioritize a **green, meaningful** test over coverage of every path.

---

## Task 11 — Verify (gates + screenshots)

Run from the repo root, in order. **cargo in the FOREGROUND** via `tools\dev-env.cmd`; build with `-v minimal`-equivalent quietness where possible.

1. `npx tsc --noEmit` → no errors.
2. `npm test` → all FE tests pass (existing + new `AuthorDetailView.test.tsx`).
3. `npm run build` (refreshes embedded `dist/`).
4. `cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri/Cargo.toml"` → all Rust tests pass, **including** the unchanged `fixture_scan` (43/44/47) and `discovery_by_tags_ranks_shared_then_unplayed`, plus the four new tag tests.
5. **Force a relink before the screenshot harness** (the documented Tauri debug-rebuild gotcha — a frontend-only change is a no-op cache hit): touch a Rust source file (e.g. add/remove a blank line in `src-tauri/src/lib.rs`) **or** `cargo clean`, so the debug binary re-embeds the new `dist/`. Since this milestone *does* change Rust, a normal `cargo tauri build --debug` will relink — but verify the binary is fresh.
6. `tools\verify.ps1 -Walkthrough tags` → produces `seed.png`, `detail.png`, `search-by-tag.png`.
7. **Regression walkthroughs** (the refactor touched discovery + search): `tools\verify.ps1 -Walkthrough discovery -SkipBuild` and `tools\verify.ps1 -Walkthrough m7 -SkipBuild`.

**Screenshot verdict via a Sonnet subagent (do NOT load PNGs into this controller session).** Dispatch a Sonnet subagent to `Read` the PNGs under the shots dir and return a **text** PASS/FAIL verdict + the absolute paths it viewed. Acceptance criteria for the subagent to check:
- `detail.png`: Jane Doe detail shows the **author** TagEditor with "cozy", a **work-level** "Tags:" editor showing **"mystery"** under the first work, and the first chapter's tag editor **open** showing **"intro"** (the 🏷 Tags toggle present on chapters).
- `search-by-tag.png`: searching **"mystery"** yields a Works (and/or Chapters) result for the tagged work — proving tag search works (no title contains "mystery").
- `discovery`/`m7` regression shots look unchanged from their established baselines (Jane Doe still first; discovery still lists works by tag; m7 search still matches).

Only if the user explicitly asks to see a shot, Read that one PNG path into the session.

---

## Task 12 — Ship

1. Branch (e.g. `m9-work-chapter-tags`), stage all changes. **Re-check `git status`** for an unstaged `Cargo.lock` churn (none expected this milestone — no new crate deps — but verify).
2. Commit with the repo identity (`yovanmc <yovanmc@users.noreply.github.com>`, no per-commit email override) and trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` (no Codex trailer).
3. Push, open a PR titled `M9 — Work & Chapter Tags` summarizing: new `work_tags`/`chapter_tags` tables, work/chapter TagEditors (chapter toggle), union-semantics discovery, tag-aware search, `tags` walkthrough; note **no audio-file mutation** and **fixture counts unchanged (43/44/47)**.
4. `Start-Sleep -Seconds 20; gh pr checks <PR#> --watch` in the **FOREGROUND** until `build-and-test` is green.
5. Merge from main `--merge --delete-branch`; sync local main.
6. **Update `ROADMAP.md`:** flip the M9 row to `✅ Merged` with the PR link + a one-line shipped summary; add a decision-log entry capturing: discovery refactored author-centric → **work-centric union** (author ∪ work tags; chapter tags excluded from Discover by design); search now matches work/chapter tags via `EXISTS` subqueries; tags seeded at runtime so fixture counts stayed 43/44/47; chapter tag editor is **toggle, open-by-default-when-tagged**; `replace_tags(table,key_col,…)` generic helper (constants only, injection-safe). Commit + push.
7. **Ping** the handoff (Phase-B template) naming **M10 — Richer Browsing UI** and the absolute ROADMAP path.

---

## Decisions baked in (from the planning Q&A)

- **Discovery = union of author + work tags** (chapter tags excluded — too granular for "discover a work").
- **Search matches work & chapter tags** (folded into existing buckets via `EXISTS` subquery; no new bucket types).
- **Chapter tag editor = toggle-to-reveal**, open-by-default when the chapter already has tags (keeps long, mostly-untagged chapter lists uncluttered while making tagged chapters visible — including in the walkthrough screenshot). Work-level editor is always visible (works are few per author).
