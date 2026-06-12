# AudioShelf — M7: Scale & Search Polish (implementation plan)

> **Written for Sonnet execution.** Follow it exactly, in order. Each task lists the
> exact files, complete code, exact commands, and the expected output. **If something
> doesn't match what's described here (a file's contents differ, a command fails in a
> way not anticipated, a test you didn't change goes red), STOP and report rather than
> guess or improvise.** Honor the repo's destructive-op discipline: this milestone adds
> only DB-read code and a fixture; it must not alter any audio file.

## Goal

Finish the v1 spec (§4 scale, §6 search, §13 cover placeholders). After M7 the v1
spec is fully implemented. Three deliverables:

1. **Virtualize the author list** so it handles 300+ authors / 10k+ files without
   rendering every row (spec §4/§6). Use `react-window`'s `FixedSizeList`.
2. **Search across authors, works, and chapters** (today: authors only, client-side).
   New backend `search_library` Tauri command running indexed SQLite `LIKE` queries
   (spec §4 "search runs off indexed SQLite queries"; §6 "Search box filters across
   authors, works, and chapters").
3. **Generated cover placeholders** — a deterministic colour + initials swatch per
   author (spec §13: "simple generated placeholders (color + initials per author)").

### Design decisions (already made — implement as written, do not redesign)

- **Search is backend SQL, not client filtering.** The frontend never loads all
  works/chapters (that would defeat the scale target). `search_library(query)` returns
  three capped buckets (authors / works / chapters). All result rows navigate to the
  author-detail screen (deep-linking to a specific work/chapter is out of scope for v1).
- **`LibraryView` becomes fully controlled & presentational.** `App` owns the search
  `query` + `results` state and the debounce; `LibraryView` receives them as props plus
  `onQueryChange`. This keeps the view free of `invoke` (matching the existing codebase
  convention) and makes it unit-testable without Tauri.
- **Virtualization uses `FixedSizeList`** (explicit `height`/`itemSize`, *not* a
  DOM-measuring virtualizer). This renders a bounded window even in jsdom, so a unit
  test can deterministically prove "1000 authors → a small number of DOM rows".
- **Cover swatches use inline `style`** (the app ships no stylesheet, so a CSS class
  would be inert — colour must be inline to be visible).
- **Fixture gains 40 filler authors named `Zz Sample Author NN`** so the list actually
  scrolls (a real virtualization screenshot). They are named to sort **after** the three
  real authors (`Jane Doe`, `Sam Smith`, `Trap Author`) precisely so walkthroughs that
  open the *first* author (`player`, `grouping`) are unaffected. This is re-verified.

---

## Conventions (from ROADMAP.md — follow exactly)

- Work on a branch off `main`: `git switch -c m7-scale-search`.
- Cargo runs in the **FOREGROUND** via the dev-env wrapper:
  `cmd /c '"tools\dev-env.cmd" cargo ... --manifest-path "src-tauri\Cargo.toml"'`.
- **`npm run build` must precede any `cargo` build/test** (the Rust crate embeds `dist/`).
- Gates (all must pass): `npx tsc --noEmit` · `npm test` · `npm run build` ·
  `cargo test` · screenshot walkthroughs.
- Commit author is the repo's configured identity (`yovanmc <yovanmc@users.noreply.github.com>`);
  **never** pass `-c user.email=...`. Add the trailer
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. **No Codex trailer.**
- CI (`build-and-test`, windows-latest) runs `npm ci` → so **`package-lock.json` MUST be
  committed and in sync** after adding the new dependency, or CI fails.
- Merge the PR `--merge --delete-branch` from `main` after FOREGROUND
  `gh pr checks <PR#> --watch`.

---

## Task list (do in order)

- **T1** — Add the `react-window` dependency (updates `package-lock.json`).
- **T2** — Cover-placeholder helpers + unit tests (`src/lib/avatar.ts`).
- **T3** — Backend search: model structs + `search` helper + `search_library` command + Rust test + handler registration.
- **T4** — Frontend API: search types + `searchLibrary` wrapper.
- **T5** — Rewrite `LibraryView` (virtualized list + controlled search-results panel + swatches).
- **T6** — Wire `App`: search state + debounce + controlled props + `m7` walkthrough branch.
- **T7** — Add the `m7` walkthrough builder.
- **T8** — Add 40 filler authors to the fixture generator.
- **T9** — Rewrite `LibraryView` tests (controlled API, virtualization bound, swatches).
- **T10** — Full verification (gates + 3 walkthroughs), then update `ROADMAP.md`, PR, CI, merge.

---

## T1 — Add `react-window`

Run these from the repo root (`C:\Agent Projects\AudioShelf`). Use `npm install` (NOT a
hand-edit) so `package-lock.json` is regenerated in sync — CI's `npm ci` depends on it.

```powershell
npm install react-window@^1.8.10
npm install -D @types/react-window@^1.8.8
```

**Expected:** `package.json` now lists `"react-window": "^1.8.10"` under `dependencies`
and `"@types/react-window": "^1.8.8"` under `devDependencies`; `package-lock.json` is
modified. Both files will be committed in T10.

If the exact version is unavailable, install the latest `1.x` (`react-window@^1.8`) and
its matching `@types/react-window@^1.8`. Do **not** install `react-window` v2+ (different
API). If only v2 is available, STOP and report.

---

## T2 — Cover-placeholder helpers

### New file: `src/lib/avatar.ts`

```ts
/**
 * Deterministic, stylesheet-free author "cover" placeholder primitives (spec §13).
 * Same name always yields the same initials and colour, so the UI is stable across
 * renders and screenshots.
 */

/** 1–2 uppercase initials for a display name. Falls back to "?" for blank names. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** A stable, readable HSL background colour derived from the name (FNV-ish hash). */
export function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 55% 45%)`;
}
```

### New file: `src/lib/avatar.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { initials, colorFor } from "./avatar";

describe("avatar placeholders", () => {
  it("derives initials from one- and two-word names", () => {
    expect(initials("Jane Doe")).toBe("JD");
    expect(initials("Sam Smith")).toBe("SS");
    expect(initials("Cher")).toBe("CH");
    expect(initials("  ")).toBe("?");
    expect(initials("Ann Marie Q")).toBe("AQ"); // first + last word
  });

  it("produces a stable colour for the same name and an hsl() string", () => {
    expect(colorFor("Jane Doe")).toBe(colorFor("Jane Doe"));
    expect(colorFor("Jane Doe")).toMatch(/^hsl\(\d+ 55% 45%\)$/);
  });

  it("varies colour across different names (not all identical)", () => {
    const names = ["Jane Doe", "Sam Smith", "Trap Author", "Zz Sample Author 01"];
    const hues = new Set(names.map(colorFor));
    expect(hues.size).toBeGreaterThan(1);
  });
});
```

---

## T3 — Backend search

### `src-tauri/src/model.rs` — append these structs at the end of the file

```rust
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuthorHit {
    pub author_id: i64,
    pub author_name: String,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkHit {
    pub work_id: i64,
    pub base_title: String,
    pub author_id: i64,
    pub author_name: String,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChapterHit {
    pub chapter_id: i64,
    pub title: String,
    pub work_id: i64,
    pub base_title: String,
    pub author_id: i64,
    pub author_name: String,
}

#[derive(Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub authors: Vec<AuthorHit>,
    pub works: Vec<WorkHit>,
    pub chapters: Vec<ChapterHit>,
}
```

### `src-tauri/src/commands.rs`

**(a)** Extend the `use crate::model::{...}` line (currently line 4) to also import the
new types. Replace:

```rust
use crate::model::{AuthorDetail, AuthorRow, ChapterRow, DiscoveryWork, MoreWork, RenameItem, RenameResult, ScanResult, UndoResult, WorkRow};
```

with:

```rust
use crate::model::{AuthorDetail, AuthorHit, AuthorRow, ChapterHit, ChapterRow, DiscoveryWork, MoreWork, RenameItem, RenameResult, ScanResult, SearchResults, UndoResult, WorkHit, WorkRow};
```

**(b)** Add the search helper + command. Insert this block **immediately after**
`query_author_detail` (i.e. after its closing `}` near line 222, before the
`discovery_for_tags` doc-comment):

```rust
const SEARCH_CAP: usize = 50;

/// Escape LIKE wildcards in a user query and wrap it as a contains-pattern.
/// Pairs with `... LIKE ?1 ESCAPE '\'` so a typed `%` or `_` is matched literally.
fn like_contains(query: &str) -> String {
    let escaped = query
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

/// Case-insensitive substring search across active authors, works, and chapters.
/// Each bucket is independently capped at `cap`. A blank query yields empty results.
pub fn search(conn: &rusqlite::Connection, query: &str, cap: usize) -> rusqlite::Result<SearchResults> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(SearchResults::default());
    }
    let like = like_contains(q);

    let mut astmt = conn.prepare(
        "SELECT id, COALESCE(display_name, folder_name) AS name
         FROM authors
         WHERE status='active' AND COALESCE(display_name, folder_name) LIKE ?1 ESCAPE '\\'
         ORDER BY name LIMIT ?2",
    )?;
    let authors: Vec<AuthorHit> = astmt
        .query_map(params![like, cap as i64], |r| {
            Ok(AuthorHit { author_id: r.get(0)?, author_name: r.get(1)? })
        })?
        .collect::<rusqlite::Result<_>>()?;

    let mut wstmt = conn.prepare(
        "SELECT w.id, w.base_title, a.id, COALESCE(a.display_name, a.folder_name)
         FROM works w JOIN authors a ON w.author_id=a.id
         WHERE w.status='active' AND a.status='active' AND w.base_title LIKE ?1 ESCAPE '\\'
         ORDER BY w.base_title LIMIT ?2",
    )?;
    let works: Vec<WorkHit> = wstmt
        .query_map(params![like, cap as i64], |r| {
            Ok(WorkHit {
                work_id: r.get(0)?,
                base_title: r.get(1)?,
                author_id: r.get(2)?,
                author_name: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;

    let mut cstmt = conn.prepare(
        "SELECT c.id, c.raw_filename, w.id, w.base_title, a.id, COALESCE(a.display_name, a.folder_name)
         FROM chapters c JOIN works w ON c.work_id=w.id JOIN authors a ON w.author_id=a.id
         WHERE c.status='active' AND w.status='active' AND a.status='active'
               AND c.raw_filename LIKE ?1 ESCAPE '\\'
         ORDER BY c.raw_filename LIMIT ?2",
    )?;
    let chapters: Vec<ChapterHit> = cstmt
        .query_map(params![like, cap as i64], |r| {
            let raw: String = r.get(1)?;
            let title = std::path::Path::new(&raw)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or(raw);
            Ok(ChapterHit {
                chapter_id: r.get(0)?,
                title,
                work_id: r.get(2)?,
                base_title: r.get(3)?,
                author_id: r.get(4)?,
                author_name: r.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;

    Ok(SearchResults { authors, works, chapters })
}

#[tauri::command]
pub fn search_library(state: tauri::State<DbState>, query: String) -> Result<SearchResults, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    search(&conn, &query, SEARCH_CAP).map_err(|e| e.to_string())
}
```

**(c)** Add a Rust test. Inside the existing `#[cfg(test)] mod tests { ... }` block
(append it just before that module's final closing `}` near line 637):

```rust
    #[test]
    fn search_matches_authors_works_and_chapters() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let jane = root.join("Jane Doe");
        touch(&jane.join("Cool Story.mp3"));
        touch(&jane.join("Cool Story 2.mp3"));
        touch(&root.join("Sam Smith").join("Night Walk.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();

        // "cool" hits the work and its chapters (not the author).
        let res = super::search(&conn, "cool", 50).unwrap();
        assert!(res.works.iter().any(|w| w.base_title == "Cool Story"));
        assert!(!res.chapters.is_empty());
        assert!(res.chapters.iter().all(|c| c.title.to_lowercase().contains("cool")));

        // "sam" hits the author.
        let res = super::search(&conn, "sam", 50).unwrap();
        assert!(res.authors.iter().any(|a| a.author_name == "Sam Smith"));

        // Blank query -> all buckets empty.
        let res = super::search(&conn, "   ", 50).unwrap();
        assert!(res.authors.is_empty() && res.works.is_empty() && res.chapters.is_empty());

        // Cap is honoured per bucket.
        let res = super::search(&conn, "o", 1).unwrap();
        assert!(res.authors.len() <= 1 && res.works.len() <= 1 && res.chapters.len() <= 1);
    }
```

### `src-tauri/src/lib.rs` — register the command

In the `tauri::generate_handler![ ... ]` list, after `commands::clear_grouping_override`
add a comma and the new command. Replace:

```rust
            commands::set_grouping_override,
            commands::clear_grouping_override
        ])
```

with:

```rust
            commands::set_grouping_override,
            commands::clear_grouping_override,
            commands::search_library
        ])
```

---

## T4 — Frontend API

### `src/lib/api.ts`

**(a)** Add the search result types. Insert after the `AuthorDetail` interface
(after line 13):

```ts
export interface AuthorHit { authorId: number; authorName: string; }
export interface WorkHit { workId: number; baseTitle: string; authorId: number; authorName: string; }
export interface ChapterHit {
  chapterId: number; title: string; workId: number; baseTitle: string;
  authorId: number; authorName: string;
}
export interface SearchResults { authors: AuthorHit[]; works: WorkHit[]; chapters: ChapterHit[]; }
```

**(b)** Add the invoke wrapper. Insert right after the `getAuthorDetail` export
(after line 42):

```ts
export const searchLibrary = (query: string) =>
  invoke<SearchResults>("search_library", { query });
```

---

## T5 — Rewrite `LibraryView`

Replace the **entire** contents of `src/views/LibraryView.tsx` with:

```tsx
import { FixedSizeList as List, type ListChildComponentProps } from "react-window";
import type { AuthorRow, SearchResults } from "../lib/api";
import { summarizeAuthor } from "../lib/library";
import { initials, colorFor } from "../lib/avatar";

const ROW_HEIGHT = 56;
const LIST_HEIGHT = 600;

/** Inline-styled colour+initials placeholder (the app ships no stylesheet). */
function Swatch({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        borderRadius: 6,
        marginRight: 8,
        flex: "0 0 auto",
        background: colorFor(name),
        color: "#fff",
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {initials(name)}
    </span>
  );
}

export function LibraryView(props: {
  authors: AuthorRow[];
  query: string;
  results: SearchResults | null;
  onQueryChange: (q: string) => void;
  onOpenAuthor: (id: number) => void;
  onOpenDiscovery: () => void;
  onOpenRename: () => void;
  onOpenSettings: () => void;
}) {
  const searching = props.query.trim() !== "";

  // One virtualized author row. react-window supplies `style` for positioning;
  // it MUST be applied to the outer element.
  const Row = ({ index, style }: ListChildComponentProps) => {
    const a = props.authors[index];
    return (
      <div style={style}>
        <button
          onClick={() => props.onOpenAuthor(a.id)}
          style={{ display: "flex", alignItems: "center", width: "100%", textAlign: "left" }}
        >
          <Swatch name={a.name} />
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
        <List height={LIST_HEIGHT} width="100%" itemCount={props.authors.length} itemSize={ROW_HEIGHT}>
          {Row}
        </List>
      )}
    </div>
  );
}

function SearchResultsPanel(props: {
  results: SearchResults | null;
  onOpenAuthor: (id: number) => void;
}) {
  const r = props.results;
  if (!r) return <p>Searching…</p>;
  const empty = r.authors.length === 0 && r.works.length === 0 && r.chapters.length === 0;
  if (empty) return <p>No matches.</p>;
  return (
    <div className="search-results">
      {r.authors.length > 0 && (
        <section>
          <h3>Authors</h3>
          <ul>
            {r.authors.map((a) => (
              <li key={`a${a.authorId}`}>
                <button onClick={() => props.onOpenAuthor(a.authorId)}>
                  <Swatch name={a.authorName} />
                  {a.authorName}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {r.works.length > 0 && (
        <section>
          <h3>Works</h3>
          <ul>
            {r.works.map((w) => (
              <li key={`w${w.workId}`}>
                <button onClick={() => props.onOpenAuthor(w.authorId)}>
                  {w.baseTitle} <span className="muted">— {w.authorName}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {r.chapters.length > 0 && (
        <section>
          <h3>Chapters</h3>
          <ul>
            {r.chapters.map((c) => (
              <li key={`c${c.chapterId}`}>
                <button onClick={() => props.onOpenAuthor(c.authorId)}>
                  {c.title} <span className="muted">— {c.baseTitle} · {c.authorName}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
```

> Note: `matchesSearch` in `src/lib/library.ts` is now unused by `LibraryView` but is
> left in place (it is harmless and may have its own test). Do **not** delete it.

---

## T6 — Wire `App`

Edit `src/App.tsx`:

**(a)** Add `searchLibrary` and the `SearchResults` type to the api import. In the import
block (lines 2–11), add `searchLibrary,` to the value imports and `type SearchResults,`
to the type imports. Concretely, change:

```ts
  getSetting, setSetting, pickFolder,
  type AuthorRow, type AuthorDetail, type ChapterRow, type ScanResult, type DiscoveryWork,
  type RenameItem, type RenameResult,
} from "./lib/api";
```

to:

```ts
  getSetting, setSetting, pickFolder, searchLibrary,
  type AuthorRow, type AuthorDetail, type ChapterRow, type ScanResult, type DiscoveryWork,
  type RenameItem, type RenameResult, type SearchResults,
} from "./lib/api";
```

**(b)** Add `m7Steps` to the walkthroughs import (line 21). Change:

```ts
import { browseSteps, playerSteps, discoverySteps, renameSteps, groupingSteps, settingsSteps } from "./harness/walkthroughs";
```

to:

```ts
import { browseSteps, playerSteps, discoverySteps, renameSteps, groupingSteps, settingsSteps, m7Steps } from "./harness/walkthroughs";
```

**(c)** Add search state. Right after the `const [busy, setBusy] = useState(false);` line
(line 50), add:

```ts
  // ---- library search (controlled; spans authors/works/chapters) ----
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
```

**(d)** Add the debounce effect. Insert this **immediately before** `function routedView() {`
(line 348):

```ts
  // Debounced backend search. Empty query clears results (list shows instead).
  useEffect(() => {
    const q = query.trim();
    if (q === "") {
      setResults(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await searchLibrary(q);
      if (!cancelled) setResults(r);
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

```

**(e)** Pass the controlled props to `LibraryView`. Replace the final return of
`routedView()` (line 404):

```tsx
    return <LibraryView authors={authors} onOpenAuthor={openAuthor} onOpenDiscovery={openDiscovery} onOpenRename={openRename} onOpenSettings={openSettings} />;
```

with:

```tsx
    return (
      <LibraryView
        authors={authors}
        query={query}
        results={results}
        onQueryChange={setQuery}
        onOpenAuthor={openAuthor}
        onOpenDiscovery={openDiscovery}
        onOpenRename={openRename}
        onOpenSettings={openSettings}
      />
    );
```

**(f)** Add the `m7` walkthrough branch. In the `const steps = ...` ternary chain, insert a
new branch **immediately before** the `: args.walkthrough === "settings"` branch
(line 330). That is, change:

```ts
            : args.walkthrough === "settings"
            ? settingsSteps({
```

to:

```ts
            : args.walkthrough === "m7"
            ? m7Steps({
                showLibrary: async () => setRoute({ kind: "library" }),
                // Set the query AND fetch results synchronously here (bypassing the
                // debounce) so the screenshot after this step is deterministic.
                search: async (q: string) => {
                  setRoute({ kind: "library" });
                  setQuery(q);
                  setResults(await searchLibrary(q));
                },
              })
            : args.walkthrough === "settings"
            ? settingsSteps({
```

---

## T7 — Add the `m7` walkthrough builder

Edit `src/harness/walkthroughs.ts`:

**(a)** Add `"m7"` to the walkthroughs tuple (line 34). Change:

```ts
export const walkthroughs = ["browse", "player", "discovery", "rename", "grouping", "settings"] as const;
```

to:

```ts
export const walkthroughs = ["browse", "player", "discovery", "rename", "grouping", "settings", "m7"] as const;
```

**(b)** Append this builder at the end of the file:

```ts
/**
 * Build the "m7" walkthrough: the virtualized author list (with cover swatches and
 * enough filler authors to scroll), then two searches that prove cross-level matching
 * — "cool" hits a work + its chapters, "sam" hits an author.
 */
export function m7Steps(nav: {
  showLibrary: () => Promise<void>;
  search: (q: string) => Promise<void>;
}): Step[] {
  return [
    { name: "library", run: nav.showLibrary },
    { name: "search-cool", run: () => nav.search("cool") },
    { name: "search-sam", run: () => nav.search("sam") },
  ];
}
```

---

## T8 — Filler authors in the fixture

Edit `tools/gen-fixture/src/lib.rs`. Inside `pub fn generate(root: &Path) -> ...`, insert
the following **immediately before** the final `Ok(())` (after the "Trap Author" block,
around line 49):

```rust
    // Filler authors so the virtualized author list has enough rows to scroll —
    // this is what the `m7` walkthrough screenshots to prove virtualization.
    // CRITICAL: they are named "Zz Sample Author NN" to sort AFTER the three real
    // authors above, so walkthroughs that open the *first* author (player, grouping)
    // keep opening "Jane Doe" and are unaffected. The base title is non-numbered so
    // grouping treats each file as one standalone work.
    for n in 1..=40 {
        let dir = root.join(format!("Zz Sample Author {n:02}"));
        write_silence(&dir.join("Quiet Hours.wav"), 1)?;
    }

```

---

## T9 — Rewrite `LibraryView` tests

Replace the **entire** contents of `src/views/LibraryView.test.tsx` with:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LibraryView } from "./LibraryView";
import type { AuthorRow, SearchResults } from "../lib/api";

const authors: AuthorRow[] = [
  { id: 1, name: "Alice", workCount: 1, chapterCount: 2, unplayedCount: 1 },
  { id: 2, name: "Bob", workCount: 2, chapterCount: 4, unplayedCount: 0 },
];

const emptyResults: SearchResults = { authors: [], works: [], chapters: [] };

function baseProps(over: Partial<React.ComponentProps<typeof LibraryView>> = {}) {
  return {
    authors,
    query: "",
    results: null as SearchResults | null,
    onQueryChange: vi.fn(),
    onOpenAuthor: vi.fn(),
    onOpenDiscovery: vi.fn(),
    onOpenRename: vi.fn(),
    onOpenSettings: vi.fn(),
    ...over,
  };
}

describe("LibraryView", () => {
  it("renders the (virtualized) author list with cover initials when query is empty", () => {
    render(<LibraryView {...baseProps()} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    // Cover swatch initials are present.
    expect(screen.getByText("AL")).toBeInTheDocument();
    expect(screen.getByText("BO")).toBeInTheDocument();
  });

  it("opens an author when a list row is clicked", async () => {
    const onOpenAuthor = vi.fn();
    render(<LibraryView {...baseProps({ onOpenAuthor })} />);
    await userEvent.click(screen.getByText("Bob"));
    expect(onOpenAuthor).toHaveBeenCalledWith(2);
  });

  it("forwards typing to onQueryChange", async () => {
    const onQueryChange = vi.fn();
    render(<LibraryView {...baseProps({ onQueryChange })} />);
    await userEvent.type(screen.getByPlaceholderText("Search authors, works, chapters"), "x");
    expect(onQueryChange).toHaveBeenCalled();
  });

  it("virtualizes: a huge author list renders only a small DOM window", () => {
    const many: AuthorRow[] = Array.from({ length: 1000 }, (_, i) => ({
      id: i + 1,
      name: `Author ${i + 1}`,
      workCount: 1,
      chapterCount: 1,
      unplayedCount: 0,
    }));
    render(<LibraryView {...baseProps({ authors: many })} />);
    // 3 toolbar buttons + at most a windowful of author rows — never 1000.
    expect(screen.getAllByRole("button").length).toBeLessThan(40);
  });

  it("shows grouped search results (authors/works/chapters) when searching", () => {
    const results: SearchResults = {
      authors: [{ authorId: 1, authorName: "Alice" }],
      works: [{ workId: 9, baseTitle: "Cool Story", authorId: 1, authorName: "Alice" }],
      chapters: [
        { chapterId: 7, title: "Cool Story 2", workId: 9, baseTitle: "Cool Story", authorId: 1, authorName: "Alice" },
      ],
    };
    render(<LibraryView {...baseProps({ query: "cool", results })} />);
    expect(screen.getByText("Authors")).toBeInTheDocument();
    expect(screen.getByText("Works")).toBeInTheDocument();
    expect(screen.getByText("Chapters")).toBeInTheDocument();
    expect(screen.getByText("Cool Story")).toBeInTheDocument();
    // The plain author list is NOT shown while searching.
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
  });

  it("navigates to the author from a work search hit", async () => {
    const onOpenAuthor = vi.fn();
    const results: SearchResults = {
      authors: [],
      works: [{ workId: 9, baseTitle: "Cool Story", authorId: 42, authorName: "Alice" }],
      chapters: [],
    };
    render(<LibraryView {...baseProps({ query: "cool", results, onOpenAuthor })} />);
    await userEvent.click(screen.getByText(/Cool Story/));
    expect(onOpenAuthor).toHaveBeenCalledWith(42);
  });

  it("shows a no-matches message when results are all empty", () => {
    render(<LibraryView {...baseProps({ query: "zzz", results: emptyResults })} />);
    expect(screen.getByText("No matches.")).toBeInTheDocument();
  });

  it("fires the toolbar callbacks", async () => {
    const onOpenDiscovery = vi.fn();
    const onOpenRename = vi.fn();
    const onOpenSettings = vi.fn();
    render(<LibraryView {...baseProps({ onOpenDiscovery, onOpenRename, onOpenSettings })} />);
    await userEvent.click(screen.getByRole("button", { name: "Discover" }));
    await userEvent.click(screen.getByRole("button", { name: "Rename tool" }));
    await userEvent.click(screen.getByRole("button", { name: /settings/i }));
    expect(onOpenDiscovery).toHaveBeenCalled();
    expect(onOpenRename).toHaveBeenCalled();
    expect(onOpenSettings).toHaveBeenCalled();
  });
});
```

> If `React.ComponentProps` triggers a "React is not defined" type error under the
> project's tsconfig, add `import type React from "react";` at the top of the test file.

---

## T10 — Verify, then ship

### Gates (run from repo root, in this order)

```powershell
npx tsc --noEmit
npm test
npm run build
cmd /c '"tools\dev-env.cmd" cargo test --manifest-path "src-tauri\Cargo.toml"'
```

**Expected:** `tsc` clean; vitest all green (the new avatar tests + the rewritten
LibraryView tests, including the virtualization-bound test); `npm run build` succeeds and
regenerates `dist/`; `cargo test` all green including `search_matches_authors_works_and_chapters`.

### Screenshot walkthroughs

Run the new `m7` walkthrough first (full build), then re-verify the two walkthroughs that
depend on the first author's identity — this is the regression check for the fixture
change (T8). `-SkipBuild` on the latter two is safe because no source changes between runs.

```powershell
powershell -ExecutionPolicy Bypass -File tools\verify.ps1 -Walkthrough m7 -TimeoutSec 300
powershell -ExecutionPolicy Bypass -File tools\verify.ps1 -Walkthrough player -TimeoutSec 300 -SkipBuild
powershell -ExecutionPolicy Bypass -File tools\verify.ps1 -Walkthrough grouping -TimeoutSec 300 -SkipBuild
```

**Read every produced PNG** (use the Read tool — they render on the user's iOS app) and
confirm:

- `.shots\m7\01-library.png` — author list shows colour+initials swatches and is clearly
  scrollable (filler authors present; only a window of rows, not all 43, is laid out).
- `.shots\m7\02-search-cool.png` — a **Works** section with "Cool Story" and a
  **Chapters** section with the Cool Story files. (Author section absent — "cool" doesn't
  match an author name.)
- `.shots\m7\03-search-sam.png` — an **Authors** section with "Sam Smith".
- `.shots\player\02-player.png` — the now-playing bar for **Jane Doe**'s first chapter
  (proves the first author is still Jane Doe → fixture change didn't reorder).
- `.shots\grouping\01-before.png`, `02-merged.png`, `03-reset.png` — the merge→reset
  round-trip on **Jane Doe** still works.

If any screenshot is wrong (e.g. `player`/`grouping` opened a filler author, meaning the
sort order changed), STOP and report — do not merge.

> **Build gotcha reminder:** `cargo tauri build --debug` is a cache hit if no *Rust*
> source changed. M7 changes Rust (search command) and the fixture crate, so the first
> `m7` run rebuilds correctly. If you later re-run the harness after a *frontend-only*
> tweak, touch a Rust file (or `cargo clean`) first so the embedded JS is refreshed.

### Update `ROADMAP.md`

1. Flip the M7 row's **Status** from `[ ] Not started` to `✅ Merged`, set **Plan** to
   `[M7](docs/superpowers/plans/2026-06-11-audioshelf-m7-scale-search.md)`, set **PR** to
   the merged PR link, and replace the **Notes** with a one-line shipped summary, e.g.:
   *"Virtualized author list (react-window FixedSizeList, 300+/10k); backend `search_library`
   SQL search across authors/works/chapters (debounced, capped 50); inline color+initials
   cover placeholders. Finishes the v1 spec. NN FE + NN Rust tests; m7 walkthrough +
   player/grouping regression-verified."* (Fill in real test counts.)
2. Append to **Decision log & gotchas**:
   - *"M7 search is a backend `search_library` SQL command (indexed `LIKE`, per-bucket cap
     50, debounced 150ms client-side); `LibraryView` is fully controlled by App (query +
     results props). Author list virtualized with `react-window` `FixedSizeList` (explicit
     height/itemSize → deterministic in jsdom, enabling a 1000-author bound test). Cover
     placeholders are inline-styled (no stylesheet). Fixture gained 40 `Zz Sample Author NN`
     authors named to sort AFTER the real three so first-author walkthroughs are unaffected."*
3. Optionally add a closing note that **the v1 spec is now fully implemented**.

### PR + CI + merge

```powershell
git add -A
git commit  # message below; commit body via here-string
git push -u origin m7-scale-search
gh pr create --fill --base main
```

Commit message:

```
M7: scale & search polish — virtualized author list, cross-level search, cover placeholders

Finishes the v1 spec (§4/§6/§13):
- Virtualize the author list with react-window FixedSizeList (300+/10k target).
- Backend search_library SQL command across authors/works/chapters; LibraryView is
  now controlled, App owns the debounced query+results.
- Deterministic inline color+initials cover placeholders.
- Fixture: 40 filler authors (sorted last) to exercise virtualization; m7 walkthrough
  added; player/grouping regression-verified.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

Then watch CI in the FOREGROUND (sleep ~20s first so checks register):

```powershell
Start-Sleep -Seconds 20
gh pr checks <PR#> --watch
```

When `build-and-test` is green, merge and clean up:

```powershell
gh pr merge <PR#> --merge --delete-branch
git checkout main
git pull
```

Commit the `ROADMAP.md` update (if not already in the PR) on `main` and push.

Finally, **ping the user** with the Phase-B handoff (the roadmap workflow's
`PushNotification`): M7 merged & CI-green; v1 spec complete.

---

## Definition of done

- [ ] `react-window` added; `package-lock.json` committed and in sync (CI `npm ci` passes).
- [ ] `npx tsc --noEmit`, `npm test`, `npm run build`, `cargo test` all green.
- [ ] New tests pass: `avatar.test.ts`, rewritten `LibraryView.test.tsx` (incl. the
      1000-author virtualization bound), Rust `search_matches_authors_works_and_chapters`.
- [ ] `m7` walkthrough screenshots verified (list+swatches+scroll, cool→works/chapters,
      sam→author); `player` + `grouping` screenshots confirm Jane Doe is still first.
- [ ] No audio file mutated by this milestone (search is read-only; fixture is test data).
- [ ] PR merged from green CI; `ROADMAP.md` M7 flipped to ✅ Merged with PR link + summary
      and decision-log entry; v1 spec noted complete.
- [ ] User pinged with the handoff.
```
