# M10 — Richer Browsing UI (AudioShelf)

> **Written for Sonnet execution.** Every task lists exact files, complete code, exact
> commands, and expected output. **If something doesn't match what you find on disk
> (a function moved, a signature differs, a test asserts different text), STOP and
> report rather than guess.** The plan was written from a verbatim digest of the repo
> at planning time; small drift is possible.

## Goal

Add browsing controls to the library so a large collection is navigable:

- **Sort the author list** by **A–Z** (default), **Length** (total duration, longest first), **Played %** (most-played first).
- **Filter the author list** by **tag** (an author's own tags ∪ its works' tags) and by **played status** (All / Has unplayed / Fully played / Not started).
- **Per-author counts** on each row: works · chapters · unplayed · % played (already mostly there — enrich `summarizeAuthor`).
- **Author detail:** **collapse/expand-all** for works, plus **sort works** (A–Z / Length / Played %).
- **Persist** the chosen author-sort, filters, and work-sort across restarts via the existing `settings` table (M6).

### Explicit scope decisions (locked with the user 2026-06-12)

- **"Recently-added" sort is DROPPED from M10.** The schema has no `added_at`/`created_at`/`scanned_at` column anywhere, and we are **not** adding a schema migration (preserving the M8/M9 no-migration streak). Recently-added may return in a later milestone if a timestamp lands for another reason.
- **Filters = tag + played-status only** (no "has cover art" filter).
- **Author-detail = collapse/expand-all + work sort** (no per-chapter reordering; chapters stay in chapter-number order).
- **Preferences persist** via `settings` (one JSON blob under key `browse_prefs`).

### Non-negotiable invariants (carry over from M1–M9)

- **No schema migration. No DDL change.** `SCHEMA_V1` is untouched.
- **Read-only on disk.** The only writes are SQLite rows: the new `browse_prefs` setting. No audio-file mutation; no new on-disk fixtures.
- **Fixture counts stay 43 / 44 / 47.** Do **not** edit `src-tauri/tests/fixture_scan.rs`. The `browse` walkthrough seeds tags + played state **at runtime** (mirroring M3/M9), so no on-disk fixture changes.
- **No new crate deps** (no `Cargo.lock` churn).
- **Sorting/filtering is client-side** on the already-in-memory `authors` array (it's already fully fetched and virtualized per M7). The backend change is minimal: expose two extra fields on `AuthorRow` so the FE can sort by length and filter by tag.

---

## Conventions (from ROADMAP.md — follow exactly)

- Cargo via `cmd /c "tools\dev-env.cmd cargo ..."` in the **FOREGROUND** (large timeout). `npm run build` before any `cargo tauri build`.
- Gates: `npx tsc --noEmit` · `npm test` · `cmd /c "tools\dev-env.cmd cargo test"` · `tools\verify.ps1 -Walkthrough browse`.
- Commit with the repo's configured identity (`yovanmc <yovanmc@users.noreply.github.com>`) — **never** pass `-c user.email=…`. Trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. **No Codex trailer.**
- CI: `build-and-test` on windows-latest. Merge `--merge --delete-branch` from main; **FOREGROUND** `gh pr checks <PR#> --watch` (sleep ~20s first).
- App ships **no stylesheet** — all visuals are inline `style={{…}}`; `className`s are inert hooks. Don't add a CSS file.
- **Tauri debug rebuild gotcha:** after a frontend-only change, force a relink (touch a Rust file or `cargo clean`) before re-running the screenshot harness, or a stale binary runs old JS and the harness hangs.

---

## Task 0 — Branch

```
git -C "C:\Agent Projects\AudioShelf" switch -c m10-browsing-ui
```

Verify you start from an up-to-date `main` (the planning commit that flipped the ROADMAP row to 📝 Plan ready should already be present).

---

## Task 1 — Backend: enrich `AuthorRow` (total duration + tags)

**Why:** the FE needs each author's total duration (to sort by Length) and the author's tag set (to filter by tag). Both are derivable in `query_authors` with no schema change.

### 1a. `src-tauri/src/model.rs` — add two fields to `AuthorRow`

Find (verbatim, ~lines 13–21):

```rust
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuthorRow {
    pub id: i64,
    pub name: String,        // display_name if set, else folder_name
    pub work_count: i64,
    pub chapter_count: i64,
    pub unplayed_count: i64,
}
```

Replace with:

```rust
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuthorRow {
    pub id: i64,
    pub name: String,        // display_name if set, else folder_name
    pub work_count: i64,
    pub chapter_count: i64,
    pub unplayed_count: i64,
    pub total_secs: i64,     // SUM(duration_secs) over active chapters — for Length sort
    pub tags: Vec<String>,   // author_tags ∪ work_tags for this author — for tag filter
}
```

### 1b. `src-tauri/src/commands.rs` — populate the new fields in `query_authors`

Find (verbatim, ~lines 175–199):

```rust
pub fn query_authors(conn: &rusqlite::Connection) -> rusqlite::Result<Vec<AuthorRow>> {
    let mut stmt = conn.prepare(
        "SELECT a.id,
                COALESCE(a.display_name, a.folder_name) AS name,
                (SELECT count(*) FROM works w WHERE w.author_id=a.id AND w.status='active'),
                (SELECT count(*) FROM chapters c JOIN works w ON c.work_id=w.id
                   WHERE w.author_id=a.id AND c.status='active'),
                (SELECT count(*) FROM chapters c JOIN works w ON c.work_id=w.id
                   WHERE w.author_id=a.id AND c.status='active' AND c.played=0)
         FROM authors a WHERE a.status='active'",
    )?;
    let mut rows: Vec<AuthorRow> = stmt
        .query_map([], |r| {
            Ok(AuthorRow {
                id: r.get(0)?,
                name: r.get(1)?,
                work_count: r.get(2)?,
                chapter_count: r.get(3)?,
                unplayed_count: r.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    rows.sort_by(|a, b| natural_cmp(&a.name, &b.name));
    Ok(rows)
}
```

Replace with:

```rust
pub fn query_authors(conn: &rusqlite::Connection) -> rusqlite::Result<Vec<AuthorRow>> {
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
    let mut rows: Vec<AuthorRow> = stmt
        .query_map([], |r| {
            Ok(AuthorRow {
                id: r.get(0)?,
                name: r.get(1)?,
                work_count: r.get(2)?,
                chapter_count: r.get(3)?,
                unplayed_count: r.get(4)?,
                total_secs: r.get(5)?,
                tags: Vec::new(),
            })
        })?
        .collect::<rusqlite::Result<_>>()?;

    // Per-author tag set = author_tags ∪ that author's work_tags (chapter tags excluded
    // by design, mirroring M9 Discover). Two grouped passes into a map, then assign.
    use std::collections::{BTreeSet, HashMap};
    let mut tag_map: HashMap<i64, BTreeSet<String>> = HashMap::new();
    {
        let mut s = conn.prepare("SELECT author_id, tag FROM author_tags")?;
        let mut q = s.query([])?;
        while let Some(r) = q.next()? {
            let id: i64 = r.get(0)?;
            let tag: String = r.get(1)?;
            tag_map.entry(id).or_default().insert(tag);
        }
    }
    {
        let mut s = conn.prepare(
            "SELECT w.author_id, t.tag FROM work_tags t JOIN works w ON t.work_id=w.id
               WHERE w.status='active'",
        )?;
        let mut q = s.query([])?;
        while let Some(r) = q.next()? {
            let id: i64 = r.get(0)?;
            let tag: String = r.get(1)?;
            tag_map.entry(id).or_default().insert(tag);
        }
    }
    for row in rows.iter_mut() {
        if let Some(set) = tag_map.remove(&row.id) {
            row.tags = set.into_iter().collect();
        }
    }

    rows.sort_by(|a, b| natural_cmp(&a.name, &b.name));
    Ok(rows)
}
```

> If `BTreeSet`/`HashMap` are already imported at the top of `commands.rs`, drop the inner `use` line to avoid an unused/duplicate-import warning. Check the top of the file first.

### 1c. Update Rust tests for the new `AuthorRow` shape

Search the backend for every place that **constructs** an `AuthorRow { … }` literal or asserts on `query_authors` output:

```
grep -rn "AuthorRow {" src-tauri
grep -rn "query_authors" src-tauri
```

For each constructed literal in tests/fixtures, add `total_secs: <n>, tags: vec![...]` (use `0` and `vec![]` where the value is irrelevant). **Add one new assertion** to the existing `query_authors` test (or create `query_authors_reports_total_secs_and_tags` near it) proving:

- `total_secs` equals the sum of the author's active chapter `duration_secs` (seed a couple of chapters with known durations via the existing test DB helper used by the other `commands.rs` tests — mirror that helper exactly), and
- `tags` contains a tag set on the author via `set_author_tags`/`replace_tags` **and** a tag set on one of the author's works via `set_work_tags`, sorted and de-duplicated.

Match the existing test module's construction style (look at the current `query_authors` test for the in-memory DB setup helper name — reuse it; do not invent a new harness).

### 1d. Gate

```
cmd /c "tools\dev-env.cmd cargo test" 2>&1
```

Expected: all Rust tests pass (was 45; you've added ≥1). If a constructed `AuthorRow` literal anywhere was missed, the compiler will name the file/line — fix and re-run.

---

## Task 2 — FE types + shared duration formatter

### 2a. `src/lib/api.ts` — extend the `AuthorRow` interface

Find:

```typescript
export interface AuthorRow {
  id: number; name: string; workCount: number; chapterCount: number; unplayedCount: number;
}
```

Replace with:

```typescript
export interface AuthorRow {
  id: number; name: string; workCount: number; chapterCount: number; unplayedCount: number;
  totalSecs: number; tags: string[];
}
```

### 2b. Ensure a shared `formatDuration`

`AuthorDetailView.tsx` already calls `formatDuration(c.durationSecs)`. Locate its definition:

```
grep -rn "function formatDuration\|formatDuration =" src
```

- If it lives in a shared module already (e.g. `src/lib/time.ts` or similar) and is **exported**, reuse it — no change.
- If it is **local** to `AuthorDetailView.tsx` (not exported), **move it** to `src/lib/time.ts` as `export function formatDuration(secs: number): string { … }` (keep the exact existing implementation), and update `AuthorDetailView.tsx` to import it. This lets `browse.ts` and `library.ts` share it.

Run `npx tsc --noEmit` after this refactor to confirm imports resolve before continuing.

---

## Task 3 — FE: pure browse logic (`src/lib/browse.ts` + test)

Create **`src/lib/browse.ts`**:

```typescript
import type { AuthorRow, WorkRow } from "./api";

export type AuthorSort = "az" | "length" | "played";
export type WorkSort = "az" | "length" | "played";
export type PlayedStatus = "all" | "unplayed" | "done" | "unstarted";

export interface AuthorFilter {
  tag: string | null; // null = no tag filter
  status: PlayedStatus; // "all" = no status filter
}

export interface BrowsePrefs {
  authorSort: AuthorSort;
  filterTag: string | null;
  filterStatus: PlayedStatus;
  workSort: WorkSort;
}

export const DEFAULT_BROWSE_PREFS: BrowsePrefs = {
  authorSort: "az",
  filterTag: null,
  filterStatus: "all",
  workSort: "az",
};

// Defensive: any malformed/absent stored value falls back to defaults (fail safe).
export function parseBrowsePrefs(raw: string | null): BrowsePrefs {
  if (!raw) return { ...DEFAULT_BROWSE_PREFS };
  try {
    const o = JSON.parse(raw) as Partial<BrowsePrefs>;
    return {
      authorSort: o.authorSort ?? "az",
      filterTag: o.filterTag ?? null,
      filterStatus: o.filterStatus ?? "all",
      workSort: o.workSort ?? "az",
    };
  } catch {
    return { ...DEFAULT_BROWSE_PREFS };
  }
}

// played fraction in [0,1]; 0 when there are no chapters.
export function authorPlayedFraction(a: AuthorRow): number {
  if (a.chapterCount <= 0) return 0;
  return (a.chapterCount - a.unplayedCount) / a.chapterCount;
}

export function workTotalSecs(w: WorkRow): number {
  return w.chapters.reduce((s, c) => s + c.durationSecs, 0);
}

export function workPlayedFraction(w: WorkRow): number {
  const total = w.chapters.length;
  if (total === 0) return 0;
  return w.chapters.filter((c) => c.played).length / total;
}

// Case-insensitive, numeric-aware name compare for stable display ordering.
function nameCmp(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function sortAuthors(authors: AuthorRow[], key: AuthorSort): AuthorRow[] {
  const copy = authors.slice();
  switch (key) {
    case "length":
      copy.sort((a, b) => b.totalSecs - a.totalSecs || nameCmp(a.name, b.name));
      break;
    case "played":
      copy.sort(
        (a, b) => authorPlayedFraction(b) - authorPlayedFraction(a) || nameCmp(a.name, b.name),
      );
      break;
    case "az":
    default:
      copy.sort((a, b) => nameCmp(a.name, b.name));
      break;
  }
  return copy;
}

export function authorMatchesStatus(a: AuthorRow, status: PlayedStatus): boolean {
  const played = a.chapterCount - a.unplayedCount;
  switch (status) {
    case "unplayed":
      return a.unplayedCount > 0;
    case "done":
      return a.chapterCount > 0 && a.unplayedCount === 0;
    case "unstarted":
      return a.chapterCount > 0 && played === 0;
    case "all":
    default:
      return true;
  }
}

export function filterAuthors(authors: AuthorRow[], filter: AuthorFilter): AuthorRow[] {
  return authors.filter((a) => {
    if (filter.tag && !a.tags.includes(filter.tag)) return false;
    if (!authorMatchesStatus(a, filter.status)) return false;
    return true;
  });
}

export function sortWorks(works: WorkRow[], key: WorkSort): WorkRow[] {
  const copy = works.slice();
  switch (key) {
    case "length":
      copy.sort((a, b) => workTotalSecs(b) - workTotalSecs(a) || nameCmp(a.baseTitle, b.baseTitle));
      break;
    case "played":
      copy.sort(
        (a, b) => workPlayedFraction(b) - workPlayedFraction(a) || nameCmp(a.baseTitle, b.baseTitle),
      );
      break;
    case "az":
    default:
      copy.sort((a, b) => nameCmp(a.baseTitle, b.baseTitle));
      break;
  }
  return copy;
}
```

Create **`src/lib/browse.test.ts`** (vitest, mirroring the existing `src/lib/*.test.ts` style — check an existing lib test for the import form). Cover at minimum:

- `sortAuthors` orders correctly for each key, with name as tiebreak (length desc, played desc, az asc). Build small `AuthorRow[]` fixtures with explicit `totalSecs`, `chapterCount`, `unplayedCount`, `tags`.
- `filterAuthors`: tag filter narrows to authors whose `tags` include the tag; status filter for each of `unplayed`/`done`/`unstarted`/`all`; tag + status compose (AND).
- `authorPlayedFraction` / `workPlayedFraction` edge cases (0 chapters → 0).
- `sortWorks` for each key with `WorkRow` fixtures (varying chapter durations / played flags).
- `parseBrowsePrefs`: `null` → defaults; valid JSON → parsed; malformed JSON → defaults; partial object → filled with defaults.

### Gate

```
npx tsc --noEmit
npm test
```

Expected: new browse tests pass; nothing else breaks yet.

---

## Task 4 — FE: `SortFilterBar` component (`src/views/SortFilterBar.tsx` + test)

Create **`src/views/SortFilterBar.tsx`** (controlled; inline-styled, no CSS file):

```typescript
import type { AuthorSort, PlayedStatus } from "../lib/browse";

export function SortFilterBar(props: {
  sort: AuthorSort;
  onSortChange: (s: AuthorSort) => void;
  filterTag: string | null;
  onFilterTagChange: (t: string | null) => void;
  filterStatus: PlayedStatus;
  onFilterStatusChange: (s: PlayedStatus) => void;
  allTags: string[];
}) {
  return (
    <div className="sort-filter-bar" style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <label>
        Sort:{" "}
        <select
          aria-label="Sort authors"
          value={props.sort}
          onChange={(e) => props.onSortChange(e.target.value as AuthorSort)}
        >
          <option value="az">A–Z</option>
          <option value="length">Length (longest)</option>
          <option value="played">Played %</option>
        </select>
      </label>
      <label>
        Tag:{" "}
        <select
          aria-label="Filter by tag"
          value={props.filterTag ?? ""}
          onChange={(e) => props.onFilterTagChange(e.target.value === "" ? null : e.target.value)}
        >
          <option value="">All tags</option>
          {props.allTags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label>
        Status:{" "}
        <select
          aria-label="Filter by status"
          value={props.filterStatus}
          onChange={(e) => props.onFilterStatusChange(e.target.value as PlayedStatus)}
        >
          <option value="all">All</option>
          <option value="unplayed">Has unplayed</option>
          <option value="done">Fully played</option>
          <option value="unstarted">Not started</option>
        </select>
      </label>
    </div>
  );
}
```

Create **`src/views/SortFilterBar.test.tsx`** (testing-library + vitest, mirror `LibraryView.test.tsx`):

- Renders all three `<select>`s with the expected options (query by `aria-label`).
- Changing each select fires the matching callback with the right value (`"length"`, a chosen tag, `null` when "All tags" picked, `"unplayed"`, …). Use `userEvent.selectOptions`.

### Gate

```
npx tsc --noEmit
npm test
```

---

## Task 5 — FE: integrate sort/filter + richer counts into `LibraryView`

### 5a. `src/lib/library.ts` — enrich `summarizeAuthor`

Find:

```typescript
export function summarizeAuthor(a: AuthorRow): string {
  return `${a.workCount} works · ${a.chapterCount} chapters · ${a.unplayedCount} unplayed`;
}
```

Replace with (add played% and total length; reuse the shared `formatDuration` from Task 2b):

```typescript
import { formatDuration } from "./time";

export function summarizeAuthor(a: AuthorRow): string {
  const played = a.chapterCount - a.unplayedCount;
  const pct = a.chapterCount > 0 ? Math.round((played / a.chapterCount) * 100) : 0;
  return `${a.workCount} works · ${a.chapterCount} chapters · ${a.unplayedCount} unplayed · ${pct}% played · ${formatDuration(a.totalSecs)}`;
}
```

> Put the `import` at the top of `library.ts` with the other imports (it already imports the `AuthorRow` type). If `formatDuration` ended up in a module other than `./time`, fix the path.

### 5b. `src/views/LibraryView.tsx` — add controls + apply sort/filter

Replace the **entire** `LibraryView` function (the exported component; leave `SearchResultsPanel` below it unchanged) with:

```typescript
import { FixedSizeList as List, type ListChildComponentProps } from "react-window";
import type { AuthorRow, SearchResults } from "../lib/api";
import { summarizeAuthor } from "../lib/library";
import { Cover } from "../components/Cover";
import { SortFilterBar } from "./SortFilterBar";
import { filterAuthors, sortAuthors, type AuthorSort, type PlayedStatus } from "../lib/browse";

const ROW_HEIGHT = 56;
const LIST_HEIGHT = 600;

export function LibraryView(props: {
  authors: AuthorRow[];
  query: string;
  results: SearchResults | null;
  sort: AuthorSort;
  onSortChange: (s: AuthorSort) => void;
  filterTag: string | null;
  onFilterTagChange: (t: string | null) => void;
  filterStatus: PlayedStatus;
  onFilterStatusChange: (s: PlayedStatus) => void;
  allTags: string[];
  onQueryChange: (q: string) => void;
  onOpenAuthor: (id: number) => void;
  onOpenDiscovery: () => void;
  onOpenRename: () => void;
  onOpenSettings: () => void;
}) {
  const searching = props.query.trim() !== "";

  // Sort then filter the in-memory author list (M7 fetched all authors up front).
  const visible = filterAuthors(sortAuthors(props.authors, props.sort), {
    tag: props.filterTag,
    status: props.filterStatus,
  });

  // One virtualized author row. react-window supplies `style` for positioning;
  // it MUST be applied to the outer element.
  const Row = ({ index, style }: ListChildComponentProps) => {
    const a = visible[index];
    return (
      <div style={style}>
        <button
          onClick={() => props.onOpenAuthor(a.id)}
          style={{ display: "flex", alignItems: "center", width: "100%", textAlign: "left" }}
        >
          <Cover kind="author" id={a.id} name={a.name} />
          <span>
            <span className="author-name">{a.name}</span>
            {" — "}
            <span className="author-summary">{summarizeAuthor(a)}</span>
          </span>
        </button>
      </div>
    );
  };

  return (
    <div className="library">
      <button onClick={props.onOpenDiscovery}>Discover</button>
      <button onClick={props.onOpenRename}>Rename tool</button>
      <button onClick={props.onOpenSettings}>Settings</button>
      <input
        placeholder="Search authors, works, chapters"
        value={props.query}
        onChange={(e) => props.onQueryChange(e.target.value)}
      />
      {searching ? (
        <SearchResultsPanel results={props.results} onOpenAuthor={props.onOpenAuthor} />
      ) : (
        <>
          <SortFilterBar
            sort={props.sort}
            onSortChange={props.onSortChange}
            filterTag={props.filterTag}
            onFilterTagChange={props.onFilterTagChange}
            filterStatus={props.filterStatus}
            onFilterStatusChange={props.onFilterStatusChange}
            allTags={props.allTags}
          />
          {visible.length === 0 ? (
            <p className="empty-filter">No authors match the current filter.</p>
          ) : (
            <List height={LIST_HEIGHT} width="100%" itemCount={visible.length} itemSize={ROW_HEIGHT}>
              {Row}
            </List>
          )}
        </>
      )}
    </div>
  );
}
```

> Note: `Row` now reads from `visible`, and `itemCount` is `visible.length`. The sort/filter bar only shows when **not** searching (search has its own results panel; sort/filter intentionally apply to the browse list, not search results).

### 5c. `src/views/LibraryView.test.tsx` — update + extend

The existing `baseProps()` factory must gain the new props. Add to it:

```typescript
sort: "az" as const,
onSortChange: vi.fn(),
filterTag: null,
onFilterTagChange: vi.fn(),
filterStatus: "all" as const,
onFilterStatusChange: vi.fn(),
allTags: [],
```

Also update author fixtures used in this test to include `totalSecs` and `tags` (TypeScript will flag missing fields — add `totalSecs: <n>, tags: []` to each `AuthorRow` literal). Update the **summary-text assertion** (it currently expects `"N works · N chapters · N unplayed"`) to the new format including `% played` and the formatted duration, OR assert on a stable substring (e.g. `getByText(/works ·/)`). Add new tests:

- Choosing "Length (longest)" via the bar reorders rows (give two authors with different `totalSecs`; assert order; you may assert via the order of rendered author names — but mind virtualization: keep the fixture small, <20, so all render).
- Tag filter narrows the list (author with tag `"x"` shown, author without hidden).
- Status filter `"done"` hides authors with `unplayedCount > 0`.
- Empty filter result renders the "No authors match" message.

### Gate

```
npx tsc --noEmit
npm test
```

---

## Task 6 — FE: work sort + collapse/expand-all in `AuthorDetailView`

### 6a. Props + state + controls

In `src/views/AuthorDetailView.tsx`:

1. Add to the **props interface** (after `allTags: string[];`):

```typescript
  workSort: import("../lib/browse").WorkSort;
  onWorkSortChange: (s: import("../lib/browse").WorkSort) => void;
```

   (Or add a top-of-file `import { sortWorks, type WorkSort } from "../lib/browse";` and use the bare `WorkSort` type — preferred. Also import `useState` from `react` if not already imported.)

2. Inside the component body, add collapse state and the sorted work list:

```typescript
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const works = sortWorks(detail.works, props.workSort);
  const allCollapsed = works.length > 0 && works.every((w) => collapsed.has(w.id));
  const toggleWork = (id: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => setCollapsed(new Set(works.map((w) => w.id)));
```

   > `detail` is destructured from `props` in the existing code (it uses `detail.works` directly). If it's referenced as `props.detail`, keep that style — match what's there.

3. Add a control bar **above** the works loop (just before `{detail.works.map(...)}`):

```typescript
      <div className="work-controls" style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <label>
          Sort works:{" "}
          <select
            aria-label="Sort works"
            value={props.workSort}
            onChange={(e) => props.onWorkSortChange(e.target.value as WorkSort)}
          >
            <option value="az">A–Z</option>
            <option value="length">Length (longest)</option>
            <option value="played">Played %</option>
          </select>
        </label>
        <button onClick={allCollapsed ? expandAll : collapseAll}>
          {allCollapsed ? "Expand all" : "Collapse all"}
        </button>
      </div>
```

### 6b. Make works collapsible

Change the works loop to iterate the **sorted** `works` and gate each chapter `<ul>` on collapse state. Find:

```typescript
      {detail.works.map((w) => (
        <section key={w.id} className="work">
          <h2 style={{ display: "flex", alignItems: "center" }}>
            <Cover kind="work" id={w.id} name={w.baseTitle} size={40} />
            <span className="work-title">{w.baseTitle}{" "}({w.chapters.length})</span>
          </h2>
```

Replace the opening of the map and the `<h2>` with:

```typescript
      {works.map((w) => (
        <section key={w.id} className="work">
          <h2 style={{ display: "flex", alignItems: "center" }}>
            <button
              aria-label={`${collapsed.has(w.id) ? "Expand" : "Collapse"} '${w.baseTitle}'`}
              onClick={() => toggleWork(w.id)}
              style={{ marginRight: 4 }}
            >
              {collapsed.has(w.id) ? "▸" : "▾"}
            </button>
            <Cover kind="work" id={w.id} name={w.baseTitle} size={40} />
            <span className="work-title">{w.baseTitle}{" "}({w.chapters.length})</span>
          </h2>
```

Then find the chapters list opening `<ul>` (right after the `work-tags` div) and wrap it so it only renders when the work is expanded. The existing structure is:

```typescript
          <ul>
            {w.chapters.map((c) => (
```

Replace with:

```typescript
          {!collapsed.has(w.id) && (
          <ul>
            {w.chapters.map((c) => (
```

…and close the conditional after the chapters `</ul>`. Find the closing of that list:

```typescript
            ))}
          </ul>
        </section>
      ))}
```

Replace with:

```typescript
            ))}
          </ul>
          )}
        </section>
      ))}
```

> Keep the `work-tags` `<TagEditor>` block **outside** the collapse gate (tags stay visible even when chapters are hidden) — i.e. only the chapter `<ul>` collapses. Verify the brace/paren balance with `npx tsc --noEmit`.

### 6c. `src/views/AuthorDetailView.test.tsx` — update + extend

- Add the two new props to the render calls: `workSort: "az"`, `onWorkSortChange: vi.fn()` (or via the test's prop factory / `noop`).
- New tests:
  - "Collapse all" hides chapter list items (assert a known chapter title is **not** in the document after clicking), and the button then reads "Expand all"; clicking it brings chapters back.
  - Per-work collapse toggle hides only that work's chapters.
  - Changing "Sort works" to "Length (longest)" reorders the rendered work sections (fixture: two works with different total chapter durations; assert order of `work-title` text).

### Gate

```
npx tsc --noEmit
npm test
```

---

## Task 7 — App wiring + persistence (`src/App.tsx`)

### 7a. State + persist handlers

Add imports at the top of `App.tsx`:

```typescript
import {
  parseBrowsePrefs,
  type BrowsePrefs,
  type AuthorSort,
  type PlayedStatus,
  type WorkSort,
} from "./lib/browse";
```

Add state near the other `useState`s (e.g. alongside `query`/`results`):

```typescript
  const [browsePrefs, setBrowsePrefs] = useState<BrowsePrefs>({
    authorSort: "az",
    filterTag: null,
    filterStatus: "all",
    workSort: "az",
  });
```

Add persist handlers (place with the other handler functions; `setSetting` is already imported per M6):

```typescript
  const persistPrefs = (next: BrowsePrefs) => {
    setBrowsePrefs(next);
    void setSetting("browse_prefs", JSON.stringify(next));
  };
  const setAuthorSort = (s: AuthorSort) => persistPrefs({ ...browsePrefs, authorSort: s });
  const setFilterTag = (t: string | null) => persistPrefs({ ...browsePrefs, filterTag: t });
  const setFilterStatus = (s: PlayedStatus) => persistPrefs({ ...browsePrefs, filterStatus: s });
  const setWorkSort = (s: WorkSort) => persistPrefs({ ...browsePrefs, workSort: s });
```

### 7b. Seed prefs on startup

In the initial-load `useEffect`, read the persisted prefs once the DB is reachable. Add this line **immediately after** the library root is resolved/scanned and **before** the `if (args.autostart && args.walkthrough)` block (i.e. once we know the DB exists):

```typescript
      setBrowsePrefs(parseBrowsePrefs(await getSetting("browse_prefs")));
```

> Placement: it must run after a successful scan (DB ready) on the `--library` path **and** the persisted-root path, but it's harmless if `browse_prefs` is absent (→ defaults). The cleanest single insertion point is right before `if (args.autostart && args.walkthrough) {`. Do **not** put it on the onboarding (`firstRun`) early-return path — there's no library yet.

### 7c. Pass props through

Update the `<LibraryView … />` render to add:

```typescript
        sort={browsePrefs.authorSort}
        onSortChange={setAuthorSort}
        filterTag={browsePrefs.filterTag}
        onFilterTagChange={setFilterTag}
        filterStatus={browsePrefs.filterStatus}
        onFilterStatusChange={setFilterStatus}
        allTags={allTags}
```

(`allTags` is already a state value in App, used by Discovery/TagEditor — reuse it.)

Update the `<AuthorDetailView … />` render to add:

```typescript
          workSort={browsePrefs.workSort}
          onWorkSortChange={setWorkSort}
```

### Gate

```
npx tsc --noEmit
npm test
```

---

## Task 8 — Extend the `browse` walkthrough

A `browse` walkthrough already exists (`browseSteps` in `src/harness/walkthroughs.ts`, wired as the fallback branch in App.tsx). Extend it to exercise M10.

### 8a. `src/harness/walkthroughs.ts` — replace `browseSteps`

Find the current `browseSteps` export and replace it with:

```typescript
export function browseSteps(nav: {
  seed: () => Promise<void>;
  showLibrarySorted: () => Promise<void>;
  showLibraryFiltered: () => Promise<void>;
  openFirstAuthor: () => Promise<void>;
}): Step[] {
  return [
    { name: "seed", run: nav.seed },
    { name: "library-sorted", run: nav.showLibrarySorted },
    { name: "library-filtered", run: nav.showLibraryFiltered },
    { name: "author-detail", run: nav.openFirstAuthor },
  ];
}
```

> If the existing `browseSteps` had a different nav shape (e.g. `showScanResult`), you are replacing it wholesale — just make sure the App.tsx call site (8b) matches the new shape exactly.

### 8b. `src/App.tsx` — update the `browse` fallback wiring

Replace the final `: browseSteps({ … })` branch (the fallback at the end of the walkthrough `?:` chain) with:

```typescript
            : browseSteps({
                // Seed tags on a few authors + a played chapter so sort-by-length,
                // played%, the tag filter, and the status filter all have signal.
                seed: async () => {
                  const list = await getAuthors();
                  for (const a of list.slice(0, 3)) await setAuthorTags(a.id, ["cozy"]);
                  if (list.length > 0) {
                    const d = await getAuthorDetail(list[0].id);
                    const ch = d.works[0]?.chapters[0];
                    if (ch) await markChapterFinished(ch.id, Date.now());
                  }
                  await refreshTags();
                  setAuthors(await getAuthors()); // refresh counts/tags after seeding
                },
                showLibrarySorted: async () => {
                  setRoute({ kind: "library" });
                  setAuthorSort("length");
                },
                showLibraryFiltered: async () => {
                  setFilterTag("cozy");
                  setFilterStatus("unplayed");
                },
                openFirstAuthor: async () => {
                  const list = await getAuthors();
                  if (list.length > 0) await openAuthor(list[0].id);
                },
              });
```

> **Adapt to existing names:** this assumes App already has `setAuthors` (the authors-list state setter), `openAuthor`, `getAuthorDetail`, `markChapterFinished`, `setAuthorTags`, `refreshTags` — all referenced by other walkthroughs in the same file. If the authors-state setter has a different name, use it. If any referenced helper doesn't exist under these names, **STOP and report** (don't invent).

### 8c. Build the debug binary and run the walkthrough

Because this is a frontend + Rust change, the Rust crate changed in Task 1, so the debug binary will relink. Build the frontend first, then the app:

```
npm run build
cmd /c "tools\dev-env.cmd cargo tauri build --debug" 2>&1 | tail
```

Run the `browse` walkthrough plus regressions:

```
powershell -File tools\verify.ps1 -Walkthrough browse
powershell -File tools\verify.ps1 -Walkthrough m7
powershell -File tools\verify.ps1 -Walkthrough tags
powershell -File tools\verify.ps1 -Walkthrough covers
```

(Use the exact `verify.ps1` invocation form the runbook `docs/superpowers/WORKFLOW-execution.md` documents if it differs — e.g. it may take `-Folder`/`-Shots`. Match how prior milestones ran it.)

### 8d. Screenshot verdict — dispatch a subagent (do NOT load PNGs here)

Dispatch a **Sonnet subagent** that Reads the PNGs written by the four walkthroughs (under the harness shots output dir, e.g. `.shots\`) and returns a **text verdict** (PASS/FAIL + observations + absolute paths). Tell it the acceptance criteria:

- **browse/seed** and **library-sorted**: library list shows the new Sort/Tag/Status controls; rows show the enriched summary (`… unplayed · NN% played · <duration>`).
- **library-sorted**: sort = "Length (longest)" selected; list is ordered by total duration (authors with more/longer chapters first) — at minimum the control reflects "length" and the list re-rendered without error. (Exact duration ordering is covered deterministically by unit tests; the screenshot just confirms the UI wired up.)
- **library-filtered**: Tag = "cozy" and Status = "Has unplayed" selected; only matching authors visible (the 3 seeded `cozy` authors, minus any now fully played).
- **author-detail**: the "Sort works" select + "Collapse all" button are present above the works; works render; tags still visible.
- **m7 / tags / covers**: visually unchanged from their known-good baselines (no regression to search, tag editors, or covers).

Act on the returned text. On FAIL, fix and re-run; only surface a PNG to the user if they explicitly ask to see it.

---

## Task 9 — Full gate, PR, CI, merge

### 9a. Full local gate

```
npx tsc --noEmit
npm test
cmd /c "tools\dev-env.cmd cargo test" 2>&1
```

All green. Confirm `git status` shows **no** unintended changes — especially **no** edits to `src-tauri/tests/fixture_scan.rs`, **no** new files under the fixtures dir, and **no** `Cargo.lock` churn (Task 1 added no deps; if `Cargo.lock` changed, investigate before committing).

### 9b. Commit

```
git -C "C:\Agent Projects\AudioShelf" add -A
git -C "C:\Agent Projects\AudioShelf" commit
```

Commit message:

```
feat(browse): richer browsing UI — sort/filter authors, sort/collapse works (M10)

Author list: sort by A–Z / Length / Played %; filter by tag and played status;
enriched per-author summary (played % + total length). Author detail: sort works
and collapse/expand-all. Preferences persist via the settings table (browse_prefs).

AuthorRow gains totalSecs (SUM duration_secs) and tags (author ∪ work tags) — no
schema change, no migration. Sorting/filtering is client-side on the in-memory list.
Read-only on disk; fixture counts unchanged (43/44/47); no new crate deps.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

### 9c. Push + PR + CI watch + merge

```
git -C "C:\Agent Projects\AudioShelf" push -u origin m10-browsing-ui
gh pr create --repo yovanmc/AudioShelf --base main --head m10-browsing-ui --title "M10 — Richer Browsing UI" --body "<summary>"
```

Then (sleep ~20s first to dodge "no checks reported"):

```
gh pr checks <PR#> --watch
```

When `build-and-test` is green:

```
gh pr merge <PR#> --merge --delete-branch
git -C "C:\Agent Projects\AudioShelf" switch main
git -C "C:\Agent Projects\AudioShelf" pull
```

---

## Task 10 — Update ROADMAP.md

Flip the M10 row to ✅ Merged with the PR number and a one-line summary, and append a decision-log entry capturing the durable facts:

- `AuthorRow` gained `totalSecs` + `tags` (author ∪ work tags); **no schema change** (recently-added was dropped precisely to avoid a migration).
- Sort/filter is **client-side** on the in-memory author list; persisted as a single `browse_prefs` JSON setting (M6 settings table).
- Played% / length for works derived FE-side from `WorkRow.chapters`; collapse state is session-only (not persisted).
- `browse` walkthrough extended (seed tags+played → sorted → filtered → detail); fixtures unchanged (43/44/47).

Commit + push to main:

```
git -C "C:\Agent Projects\AudioShelf" add ROADMAP.md
git -C "C:\Agent Projects\AudioShelf" commit -m "docs(roadmap): M10 Richer Browsing UI merged (#<PR#>)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git -C "C:\Agent Projects\AudioShelf" push
```

---

## Done criteria

- [ ] `AuthorRow` exposes `totalSecs` + `tags`; `query_authors` populates both; Rust tests green (no schema/DDL change).
- [ ] Author list: working A–Z / Length / Played % sort + tag filter + status filter; enriched per-row summary; empty-filter message.
- [ ] Author detail: work sort (A–Z / Length / Played %) + collapse/expand-all + per-work collapse.
- [ ] Sort/filter/work-sort persist across restarts via `browse_prefs`; malformed/absent value falls back to defaults.
- [ ] `tsc`, `npm test`, `cargo test` all green; `browse` walkthrough + m7/tags/covers regressions screenshot-verified (via subagent text verdict).
- [ ] Read-only on disk; fixture counts 43/44/47; no `Cargo.lock` churn; no new on-disk fixtures.
- [ ] PR merged green; ROADMAP.md flipped to ✅ Merged with decision-log entry.
