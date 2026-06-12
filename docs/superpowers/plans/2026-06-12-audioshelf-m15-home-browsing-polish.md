# M15 — Home & Browsing Polish — Implementation Plan

> **Written for Sonnet execution.** Every path, symbol, and snippet below was read from the live
> tree on 2026-06-12 (post-M14) via a thorough digest. If something doesn't match (a renamed
> symbol, a moved line, a different prop shape), **STOP and report** rather than guessing. Run each
> task's verify step before moving on. Keep all new component props **optional with defaults** —
> the view test files build props inline and a new *required* prop breaks them.

## Scope & constraints

Four items from the v4 roadmap, building on M13's primitives. **Frontend-only — no Rust, no schema,
no new deps, no `Cargo.lock` change.** `cargo test` stays **47** (regression only). Read-only on
disk; fixtures stay 43/44/47. Test count is **161** today — add tests, never let it drop.

The digest established that **three of the four items are mostly already present** and need only
polish, and the one substantial new feature (configurable Home shelves) is achievable FE-only:

1. **Configurable Home shelves** *(the substantial new work)* — user-defined named horizontal rows
   on Home. Three shelf **kinds**, each populated by an EXISTING command (no new Rust):
   - `tag` → `getDiscoveryByTags([tag])` → work cards
   - `creator` → `getAuthorDetail(authorId).works` → work cards
   - `status` → `getAuthors()` + existing `filterAuthors`/`authorMatchesStatus` → creator cards
   Persisted as ONE JSON setting `home_shelves` (following the exact `browse_prefs` failsafe
   pattern). Managed in **Settings** (add / remove / reorder / rename). Default config is **empty**
   → Home renders exactly as today until the user adds shelves (backward-compatible, no empty-Home
   regression).
2. **Played-status Library tabs** — promote the existing `PlayedStatus` filter (today a `<select>`
   inside `SortFilterBar`) to a top-level **tab bar** above the author list. Reuses the existing
   `filterStatus` state + `filterAuthors`. FE-only.
3. **Richer creator hub** — `AuthorDetailView` ALREADY shows total duration + per-work `ProgressBar`
   (digest §3a). The fix: the author total uses `formatDuration` (→ `"125:30"` for long authors);
   switch the **author total + per-work totals to `formatLong`** (→ `"2h 5m"`). Small, clear win.
4. **Recent-history surfacing** — Home ALREADY renders a "Recently listened" list (`stats.recent`,
   digest §1d). The enhancement: make each recent row **clickable to open that author** (today it's
   display-only). FE-only, reuses the existing `onOpenAuthor`.

### Design decisions (made during planning; FE-only is the controlling constraint)
- **Shelf data is fetched in `App.tsx` (an effect) and passed down as props** — HomeView and the new
  `Shelf` component stay **pure** (no `invoke`), matching the digest's "all views are pure" pattern
  and keeping them test-friendly without API mocks. The kind→command mapping lives in a testable
  `src/lib/shelves.ts` helper.
- **Shelf management lives in Settings**, not inline on Home. Lower risk, concentrates editing in the
  existing settings surface; Home stays a pure render. (Inline-Home editing is a possible future
  enhancement — note, do not build.)
- **A `status` shelf renders creator cards** (not work cards) because a cross-author works-by-status
  list would need a new Rust command; author-granularity status filtering is already FE-only via
  `getAuthors()`+`filterAuthors`. This is the FE-only way to honor the "played-status" shelf kind.

Gates: `npx tsc --noEmit` · `npm test` (≥161) · `cargo test` (47 regression) · before/after
`m12` screenshot matrix (Home shelves, Library tabs, AuthorDetail hours) via a subagent verdict.

### Live-tree facts to rely on (verify before editing)
- **HomeView** (`src/views/HomeView.tsx`): props `{ home: HomeData|null; nowMs; onPlay; onOpenAuthor;
  onOpenLibrary; onOpenSettings?; onPlayNextOfWork?; featureMenuOpen? }` (lines 8–17). Sections in
  order: Welcome `EmptyState` (when `noHistory`), "Keep listening" (`WorkCard featured`, ~L51–68),
  "You May Like" (`.card-grid` of up to 6 `WorkCard`, ~L70–94), "Recently listened" (`<ul
  className="recent-list card">` of `CreatorIdentity` rows, ~L95–107), "Your listening" (3
  `StatCard`, ~L108–115). `noHistory` = `!keepListening && stats.recent.length===0 &&
  stats.chaptersFinished===0` (~L24).
- **App.tsx**: `loadHome()` (~L148) sets `home` via `queryHome(now, tzOffset)`. `browsePrefs`
  state (~L95) with `persistPrefs(update)` (~L221–231) = `setSetting("browse_prefs",
  JSON.stringify(next))`. Startup loads: `parseBrowsePrefs(await getSetting("browse_prefs"))`
  (~L404), `sidebar_collapsed` (~L405). `m12Steps` nav callbacks defined inline in a `useEffect`
  (~L413–530). Library view state includes `filterStatus`/`onFilterStatusChange` wired from
  `browsePrefs.filterStatus`.
- **`src/lib/browse.ts`**: `type PlayedStatus = "all"|"unplayed"|"done"|"unstarted"` (L5);
  `interface BrowsePrefs {authorSort; filterTag: string|null; filterStatus: PlayedStatus; workSort}`;
  `DEFAULT_BROWSE_PREFS`; `parseBrowsePrefs(raw)` failsafe (L27–40); `filterAuthors(authors, {tag,
  status})` (L97–103) using `authorMatchesStatus(a, status)` (L82–95: `unplayed`→`unplayedCount>0`;
  `done`→`chapterCount>0 && unplayedCount===0`; `unstarted`→`chapterCount>0 && (chapterCount-
  unplayedCount)===0`; `all`→true).
- **LibraryView** (`src/views/LibraryView.tsx`): props (L14–22) include `filterStatus: PlayedStatus;
  onFilterStatusChange`. Renders search input, then `<SearchResultsPanel>` (when `query.trim()!==""`)
  else `<SortFilterBar>` + a `react-window FixedSizeList` of author rows.
- **SortFilterBar** (`src/views/SortFilterBar.tsx`): `<div className="sort-filter-bar toolbar card">`
  with three `<select>`: Sort, Tag, Status (Status options L44–50: All/Has unlistened chapters/Fully
  played/Not started → `all`/`unplayed`/`done`/`unstarted`).
- **AuthorDetailView** (`src/views/AuthorDetailView.tsx`): FE aggregates (L80–83) `chapters`,
  `played`, `totalSecs`, `progress`. Header line (~L107): `{works.length} works · {chapters.length}
  chapters · {formatDuration(totalSecs)} · {progress}% played`. Per-work (L138–196): `WorkArtwork`,
  `<h2>{baseTitle} ({chapters.length})</h2>`, chapter/unplayed counts, `<ProgressBar>` (~L152), tags,
  chapter rows with `formatDuration(c.durationSecs)`.
- **`src/lib/time.ts`**: `formatDuration(secs)→"m:ss"` (L1); `formatLong(secs)→"2h 5m"|"5m"` (L8);
  `formatRelative(fromMs, nowMs)→"x ago"` (L15).
- **`src/lib/api.ts`** types: `ChapterRow{id,title,chapterNo,format,durationSecs,played,filePath?,tags}`;
  `WorkRow{id,baseTitle,tags,chapters:ChapterRow[]}` (no aggregates); `AuthorRow{id,name,workCount,
  chapterCount,unplayedCount,totalSecs,tags}`; `AuthorDetail{id,name,tags,works}`; `DiscoveryWork
  {workId,baseTitle,authorId,authorName,unplayedCount,sharedTags:string[]}`; `RecentItem{chapterId,
  chapterTitle,workId,workTitle,authorId,authorName,playedAt}`. Commands: `getAuthors()→AuthorRow[]`,
  `getAuthorDetail(id)→AuthorDetail`, `getDiscoveryByTags(tags:string[])→DiscoveryWork[]`,
  `getSetting(key)→string|null`, `setSetting(key,value)`.
- **Components**: `WorkCard` (`src/components/WorkCard.tsx`) props include `workId,title,authorId,
  authorName,tags?,reason?,reasonTone?,progress?,meta?,actionLabel?,onAction?,onOpenAuthor?,onPlay?,
  menuItems?,featured?,menuOpen?`. `CreatorIdentity` (`src/components/CreatorIdentity.tsx`):
  `{authorId,authorName,secondary?,size?,onOpen?}`. `ProgressBar` (`src/components/ui.tsx` L18):
  `{value:number,label?:string}`. `.card-grid` is a wrapping grid (`src/styles/layout.css` L23) —
  **there is no horizontal-scroll row component; you will add one.**
- **Tests**: `HomeView.test.tsx` + `LibraryView.test.tsx` use a `baseProps(over?)` helper (inline
  fixture + `vi.fn()` callbacks, `over` spread last); `AuthorDetailView.test.tsx` builds props
  inline per-test (no helper). **None mock the API module** — views are pure.
- **Harness** (`src/harness/walkthroughs.ts`): `walkthroughs` tuple (L51) includes `"m12"`.
  `m12Steps` (L158–190) step names incl. `home`, `library`, `author-detail`. App wires `m12Steps`
  nav inline (~L413–530). `runner.test.ts` asserts `m12Steps` order/names.

---

## Task 1 — Shelf config model, persistence & data-loader (`src/lib/shelves.ts`) + tests

**Create `src/lib/shelves.ts`:**
```ts
import { getAuthors, getAuthorDetail, getDiscoveryByTags } from "./api";
import { filterAuthors, type PlayedStatus } from "./browse";

export type ShelfKind = "tag" | "creator" | "status";

export interface HomeShelf {
  id: string;            // stable unique id (e.g. `s${counter}` minted at add-time)
  title: string;         // user-facing row title
  kind: ShelfKind;
  tag?: string;          // kind === "tag"
  authorId?: number;     // kind === "creator"
  status?: PlayedStatus; // kind === "status"
}

export interface HomeShelvesConfig {
  shelves: HomeShelf[];
}

export const DEFAULT_HOME_SHELVES: HomeShelvesConfig = { shelves: [] };

/** Failsafe parse — mirrors parseBrowsePrefs. Drops malformed shelves; never throws. */
export function parseHomeShelves(raw: string | null): HomeShelvesConfig {
  if (!raw) return { shelves: [] };
  try {
    const o = JSON.parse(raw) as Partial<HomeShelvesConfig>;
    const shelves = Array.isArray(o.shelves) ? o.shelves : [];
    const clean = shelves.filter(
      (s): s is HomeShelf =>
        !!s && typeof s.id === "string" && typeof s.title === "string" &&
        (s.kind === "tag" || s.kind === "creator" || s.kind === "status"),
    );
    return { shelves: clean };
  } catch {
    return { shelves: [] };
  }
}

export function serializeHomeShelves(config: HomeShelvesConfig): string {
  return JSON.stringify(config);
}

/** Normalized shelf item — work shelves yield "work", status shelves yield "creator". */
export type ShelfItem =
  | { kind: "work"; workId: number; title: string; authorId: number; authorName: string; unplayedCount: number; tags: string[] }
  | { kind: "creator"; authorId: number; authorName: string; workCount: number; unplayedCount: number };

/** Fetch a shelf's items using EXISTING commands only (no new Rust). */
export async function loadShelfItems(shelf: HomeShelf): Promise<ShelfItem[]> {
  if (shelf.kind === "tag" && shelf.tag) {
    const works = await getDiscoveryByTags([shelf.tag]);
    return works.map((w) => ({
      kind: "work", workId: w.workId, title: w.baseTitle, authorId: w.authorId,
      authorName: w.authorName, unplayedCount: w.unplayedCount, tags: w.sharedTags,
    }));
  }
  if (shelf.kind === "creator" && shelf.authorId != null) {
    const detail = await getAuthorDetail(shelf.authorId);
    return detail.works.map((w) => ({
      kind: "work", workId: w.id, title: w.baseTitle, authorId: detail.id,
      authorName: detail.name, unplayedCount: w.chapters.filter((c) => !c.played).length,
      tags: w.tags,
    }));
  }
  if (shelf.kind === "status" && shelf.status) {
    const authors = await getAuthors();
    return filterAuthors(authors, { tag: null, status: shelf.status }).map((a) => ({
      kind: "creator", authorId: a.id, authorName: a.name,
      workCount: a.workCount, unplayedCount: a.unplayedCount,
    }));
  }
  return [];
}
```
> Confirm `filterAuthors` accepts `{ tag: string|null; status: PlayedStatus }` (digest §2b says its
> arg is `{tag, status}`). If its signature differs, adapt the call and report.

**Create `src/lib/shelves.test.ts`** (Vitest; mock `./api` with `vi.mock`):
- `parseHomeShelves(null)` → `{shelves: []}`; `parseHomeShelves("not json")` → `{shelves: []}`;
  a payload with one valid + one malformed shelf keeps only the valid one; a valid round-trip via
  `serializeHomeShelves` re-parses equal.
- `loadShelfItems` for each kind with a mocked api: `tag` calls `getDiscoveryByTags(["cozy"])` and
  maps to `kind:"work"` items; `creator` calls `getAuthorDetail(id)` and computes `unplayedCount`
  from chapters; `status` calls `getAuthors` and filters (seed authors so e.g. `"unstarted"` keeps
  only the unstarted one), mapping to `kind:"creator"` items. An incomplete shelf (e.g. `kind:"tag"`
  with no `tag`) returns `[]`.

**Verify:** `npx tsc --noEmit` && `npm test`.

---

## Task 2 — `Shelf` component + horizontal-scroll CSS + tests

**Create `src/components/Shelf.tsx`** — a PURE component (no `invoke`); receives items as props:
```tsx
import { WorkCard } from "./WorkCard";
import { CreatorIdentity } from "./CreatorIdentity";
import { SectionHeading } from "./ui";
import type { HomeShelf, ShelfItem } from "../lib/shelves";

export function Shelf({
  shelf, items, onOpenAuthor, onPlayNextOfWork,
}: {
  shelf: HomeShelf;
  items: ShelfItem[];
  onOpenAuthor: (id: number) => void;
  onPlayNextOfWork?: (workId: number, authorId: number) => void;
}) {
  if (items.length === 0) return null; // empty shelves render nothing
  return (
    <section className="view-section shelf" aria-label={shelf.title}>
      <SectionHeading>{shelf.title}</SectionHeading>
      <div className="card-row">
        {items.map((item) =>
          item.kind === "work" ? (
            <WorkCard
              key={`w${item.workId}`}
              workId={item.workId}
              title={item.title}
              authorId={item.authorId}
              authorName={item.authorName}
              tags={item.tags}
              meta={item.unplayedCount > 0 ? `${item.unplayedCount} unplayed` : "All played"}
              onOpenAuthor={() => onOpenAuthor(item.authorId)}
              onPlay={onPlayNextOfWork ? () => onPlayNextOfWork(item.workId, item.authorId) : undefined}
            />
          ) : (
            <div key={`c${item.authorId}`} className="shelf-creator card">
              <CreatorIdentity
                authorId={item.authorId}
                authorName={item.authorName}
                secondary={`${item.workCount} works · ${item.unplayedCount} unplayed`}
                onOpen={() => onOpenAuthor(item.authorId)}
              />
            </div>
          ),
        )}
      </div>
    </section>
  );
}
```
> Confirm `SectionHeading` is exported from `src/components/ui.tsx` (M13 added it). If the
> `WorkCard`/`CreatorIdentity` prop names differ from the digest, adapt and report.

**CSS** — append to `src/styles/components.css`:
```css
.card-row { display: flex; gap: var(--space-4); overflow-x: auto; padding-bottom: var(--space-2); scroll-snap-type: x proximity; }
.card-row > * { flex: 0 0 220px; scroll-snap-align: start; }
.shelf-creator { display: flex; align-items: center; padding: var(--space-3); }
```
> Confirm `--space-2/3/4` exist in `src/styles/tokens.css` (they do per the M14 digest). If a
> WorkCard has its own width, `flex: 0 0 220px` may need tuning — keep cards a consistent width.

**Create `src/components/Shelf.test.tsx`:** render with 2 `kind:"work"` items → asserts both titles
render inside a `.card-row` and the `SectionHeading` shows `shelf.title`; clicking a card's Play
calls `onPlayNextOfWork`; render with `kind:"creator"` items → renders `CreatorIdentity` rows;
render with `items: []` → renders nothing (`container` empty).

**Verify:** `npx tsc --noEmit` && `npm test`.

---

## Task 3 — Render shelves on Home + App state/fetch wiring + tests

**3a. HomeView** — add optional props and render the shelves between "Keep listening" and "You May
Like":
- Add to the props interface: `shelves?: HomeShelf[]; shelfItems?: Record<string, ShelfItem[]>;
  onPlayNextOfWork?` (already present per digest). Import `Shelf` + the shelf types.
- After the "Keep listening" `</section>` (~L68), insert:
```tsx
{(props.shelves ?? []).map((shelf) => (
  <Shelf
    key={shelf.id}
    shelf={shelf}
    items={props.shelfItems?.[shelf.id] ?? []}
    onOpenAuthor={props.onOpenAuthor}
    onPlayNextOfWork={props.onPlayNextOfWork}
  />
))}
```
- Default both new props so existing HomeView tests (which omit them) render unchanged.

**3b. App.tsx** — state, load, persist, fetch:
```ts
// near browsePrefs state
const [homeShelves, setHomeShelves] = useState<HomeShelf[]>([]);
const [shelfItems, setShelfItems] = useState<Record<string, ShelfItem[]>>({});

const persistShelves = (update: (prev: HomeShelf[]) => HomeShelf[]) => {
  setHomeShelves((prev) => {
    const next = update(prev);
    void setSetting("home_shelves", serializeHomeShelves({ shelves: next }));
    return next;
  });
};
```
- At startup (next to the `parseBrowsePrefs` load, ~L404):
  `setHomeShelves(parseHomeShelves(await getSetting("home_shelves")).shelves);`
- Fetch shelf items in an effect keyed on the shelves config AND the library generation (so shelves
  refresh after a scan / played-toggle that already triggers `loadHome`). Reuse whatever signal
  `loadHome` keys on; if there's a `libraryVersion`/refresh counter, depend on it, else depend on
  `homeShelves` + the same trigger `loadHome` uses:
```ts
useEffect(() => {
  let cancelled = false;
  void (async () => {
    const entries = await Promise.all(
      homeShelves.map(async (s) => [s.id, await loadShelfItems(s).catch(() => [])] as const),
    );
    if (!cancelled) setShelfItems(Object.fromEntries(entries));
  })();
  return () => { cancelled = true; };
}, [homeShelves /*, libraryVersion if one exists */]);
```
- Pass to `<HomeView>`: `shelves={homeShelves} shelfItems={shelfItems}`.

**3c. Tests** (`HomeView.test.tsx`): extend `baseProps` to accept (and default) `shelves`/`shelfItems`.
Add: given one `tag` shelf in `shelves` with matching `shelfItems`, HomeView renders the shelf
title + its cards; given `shelves: []`, no `.shelf` section renders (Home unchanged). (Shelf data
fetching itself is covered by `shelves.test.ts`; HomeView stays pure.)

**Verify:** `npx tsc --noEmit` && `npm test`.

---

## Task 4 — Shelf management UI in Settings + App wiring + tests

**Read `src/views/SettingsView.tsx` first** to learn its prop interface + section/card conventions
(it's the `m12` step-10 view). Match its existing patterns. If its shape differs materially from the
assumptions below, adapt and report.

**4a. SettingsView** — add a "Home shelves" section that lists current shelves and offers add /
remove / reorder / rename. Add optional props (defaulted so existing Settings tests don't break):
```ts
shelves?: HomeShelf[];
allTags?: string[];
authors?: { id: number; name: string }[];
onAddShelf?: (shelf: Omit<HomeShelf, "id">) => void;
onRemoveShelf?: (id: string) => void;
onMoveShelf?: (id: string, dir: -1 | 1) => void;
onRenameShelf?: (id: string, title: string) => void;
```
- Render each shelf: title (inline-editable or a rename input), a kind/target summary, ▲/▼ move
  buttons (disabled at ends), and a Remove button.
- An "Add shelf" form: a kind `<select>` (Tag / Creator / Played status); a dependent target control
  (tag `<select>` from `allTags`; creator `<select>` from `authors`; status `<select>` with the
  four `PlayedStatus` labels reused from `SortFilterBar`); a title `<input>` (default the title from
  the chosen target, e.g. the tag name); an "Add" button that calls `onAddShelf({kind, tag|authorId|
  status, title})`. Keep markup consistent with the existing Settings cards.

**4b. App.tsx** — mint ids and wire the callbacks via `persistShelves`:
```ts
const shelfIdRef = useRef(0);
const onAddShelf = (s: Omit<HomeShelf, "id">) =>
  persistShelves((prev) => [...prev, { ...s, id: `s${(shelfIdRef.current += 1)}_${prev.length}` }]);
const onRemoveShelf = (id: string) => persistShelves((prev) => prev.filter((s) => s.id !== id));
const onRenameShelf = (id: string, title: string) =>
  persistShelves((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
const onMoveShelf = (id: string, dir: -1 | 1) =>
  persistShelves((prev) => {
    const i = prev.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= prev.length) return prev;
    const next = [...prev];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
```
> Ids must be **stable and unique** (used as React keys and the `shelfItems` map key). The
> `s{counter}_{len}` scheme avoids collisions across a session. When loading persisted shelves at
> startup, bump `shelfIdRef.current` past any numeric suffix you can parse, or just rely on the
> counter (collisions only matter within a session and the counter is monotonic). Keep it simple;
> report if you change the scheme.
- Pass `shelves`, `allTags` (already in App for the tag filter), an `authors` minimal list (map the
  existing `authors` state to `{id,name}`), and the four callbacks to `<SettingsView>`.

**4c. Tests** (`SettingsView.test.tsx` — read it first for the existing pattern): add tests that the
shelves section lists provided shelves; clicking Remove calls `onRemoveShelf` with the id; the Add
form calls `onAddShelf` with the assembled shelf; ▲/▼ call `onMoveShelf`. Keep new props optional so
prior Settings tests pass untouched.

**Verify:** `npx tsc --noEmit` && `npm test`.

---

## Task 5 — Played-status Library tabs

Promote the status filter from the `SortFilterBar` `<select>` to a top-level tab bar in
`LibraryView` (only when not searching).

**5a. LibraryView** — above the `<SortFilterBar>` (in the non-search branch), render a tab bar:
```tsx
<div className="tabs" role="tablist" aria-label="Played status">
  {([
    ["all", "All"], ["unplayed", "Has unplayed"], ["done", "Fully played"], ["unstarted", "Not started"],
  ] as const).map(([value, label]) => (
    <button
      key={value}
      type="button"
      role="tab"
      aria-selected={props.filterStatus === value}
      className={`tab${props.filterStatus === value ? " tab--active" : ""}`}
      onClick={() => props.onFilterStatusChange(value)}
    >
      {label}
    </button>
  ))}
</div>
```
**5b. SortFilterBar** — REMOVE the Status `<select>` (lines ~44–50) and its label so status isn't
duplicated; keep Sort + Tag selects. Update `SortFilterBar`'s props if `filterStatus`/
`onFilterStatusChange` were passed to it (drop them there). Confirm no other caller relies on the
Status select.

**5c. CSS** — append to `src/styles/components.css` (reuse M13's `chip--toggle` look if present;
otherwise):
```css
.tabs { display: flex; gap: var(--space-2); margin-bottom: var(--space-3); flex-wrap: wrap; }
.tab { background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-muted); border-radius: var(--radius-pill); padding: var(--space-2) var(--space-3); cursor: pointer; font: inherit; }
.tab--active { background: var(--color-accent-soft); color: var(--color-text); border-color: var(--color-accent); }
```
> Verify these token names against `tokens.css`; substitute the real names if any differ and report.
> If M13 already shipped a `.chip--toggle` pill style, prefer reusing it over new `.tab` classes for
> visual consistency — your call, note which you did.

**5d. Tests** (`LibraryView.test.tsx`): the four tabs render; the active one has `aria-selected`;
clicking a tab calls `onFilterStatusChange` with the right value. Update any `SortFilterBar` test
that asserted the Status select (it's moved).

**Verify:** `npx tsc --noEmit` && `npm test`.

---

## Task 6 — Richer creator hub (hours) + clickable recent history

**6a. AuthorDetailView** — switch the author total and add per-work hours to `formatLong`:
- Header (~L107): change `{formatDuration(totalSecs)}` → `{formatLong(totalSecs)}` so long authors
  read "2h 5m" not "125:30". Ensure `formatLong` is imported from `../lib/time`.
- Per work: add the work's total duration in hours next to its chapter count, e.g. compute
  `const workSecs = w.chapters.reduce((s,c)=>s+c.durationSecs,0);` and show `formatLong(workSecs)`
  in the per-work meta line (near the existing chapter/unplayed counts ~L150). Keep the existing
  per-work `ProgressBar`. Leave the per-chapter `formatDuration(c.durationSecs)` (m:ss) as-is — short
  chapter times are correct in m:ss.

**6b. HomeView "Recently listened"** — make each row open its author. In the `recent-list` map
(~L95–107), wrap the row content in the existing `CreatorIdentity` `onOpen` (it already takes
`onOpen`), or make the `<li>` a button calling `props.onOpenAuthor(item.authorId)`. Use
`CreatorIdentity`'s `onOpen={() => props.onOpenAuthor(item.authorId)}` so it's keyboard-accessible.
No new prop needed (`onOpenAuthor` already in HomeView props).

**6c. Tests:**
- `AuthorDetailView.test.tsx`: assert the header shows an hours-formatted total (seed a multi-hour
  author and assert the `formatLong` output substring, e.g. `"h "` or the exact string); assert a
  per-work hours label renders.
- `HomeView.test.tsx`: assert clicking a recent-listened row calls `onOpenAuthor` with that author
  id.

**Verify:** `npx tsc --noEmit` && `npm test`.

---

## Task 7 — Harness: show the new Home/Library/AuthorDetail states

Extend the **`m12`** walkthrough (keeps one comprehensive matrix; don't fork an `m15` walkthrough
unless wiring into `m12` proves infeasible — report if so).

- Add a step **`home-shelves`** AFTER the existing `home` step: its App callback seeds a small
  `homeShelves` config (e.g. one `tag` shelf for an existing fixture tag like `"cozy"` and one
  `status` shelf `"unstarted"` titled "Haven't started"), fetches their items (await the same
  `loadShelfItems` flow or set `shelfItems` directly), ensures the Home route, then lets the shot
  capture. Keep it self-contained; if seeding the effect-driven fetch is awkward in the harness,
  set `shelfItems` directly for the two seeded shelves so the shot is deterministic.
- The existing **`library`** step will now show the status **tabs** automatically (Task 5) — no new
  step needed; the shot updates.
- The existing **`author-detail`** step will now show **hours** automatically (Task 6) — shot updates.
- Update `runner.test.ts` to include `home-shelves` in the expected `m12Steps` order/names.

> If a fixture tag other than `"cozy"` is needed, pick one that exists in the fixtures (the digest
> notes discovery uses tags like `"cozy"`); STOP and report if no multi-work tag exists.

**Verify:** `npx tsc --noEmit` && `npm test`.

---

## Task 8 — Gates + before/after screenshot verification

1. Gates:
   ```
   npx tsc --noEmit
   npm test
   cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml"   # 47, FE-only
   ```
2. Build + capture:
   ```
   npm run build
   powershell -ExecutionPolicy Bypass -File tools\verify.ps1 -Walkthrough m12
   ```
   New/updated shots: a `home-shelves` shot, updated `library` (tabs) and `author-detail` (hours).
3. **Screenshot verification in a Sonnet subagent** (do NOT load PNGs into the controller) returning
   a text verdict against:
   - The `home-shelves` shot shows the configured shelves as **horizontal card rows** with their
     titles (a tag shelf of work cards + a status shelf of creator cards), scrollable, dark theme
     intact, sitting below "Keep listening".
   - The `library` shot shows a **played-status tab bar** (All / Has unplayed / Fully played / Not
     started) with one active tab; the Status `<select>` is gone from the sort/filter bar.
   - The `author-detail` shot shows the author total in **hours** ("Nh Mm") and per-work progress
     bars intact.
   - No layout breakage anywhere; the rest of the `m12` matrix unregressed.
4. Fix any FAIL and re-capture.

**Only if the user explicitly asks to see a shot** do you Read a PNG into the session.

---

## Definition of done

- `npx tsc --noEmit` clean; `npm test` green (≥161 — `shelves`, `Shelf`, Home/Library/Settings/
  AuthorDetail tests added); `cargo test` 47 (no Rust touched).
- Configurable Home shelves: add/remove/reorder/rename in Settings, persisted as `home_shelves` JSON
  (failsafe parse), rendered as horizontal rows on Home via existing commands only; default empty →
  Home unchanged until customized.
- Library has a top-level played-status tab bar (status removed from the sort/filter select).
- AuthorDetail shows hours; Home recent-listened rows open their author.
- `git status`: no `Cargo.lock`/`src-tauri/**`/fixture change; no committed screenshots.
- Subagent before/after verdict PASS; `m12` matrix unregressed.

## PR

- Branch `m15-home-browsing-polish`; commit as `yovanmc <yovanmc@users.noreply.github.com>` +
  trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` (no Codex trailer).
- Open PR; FOREGROUND `gh pr checks <PR#> --watch` (sleep ~20s first); merge from main
  `--merge --delete-branch`; sync main.
- **Update `ROADMAP.md` via a docs PR** (AudioShelf rule): flip M15 to ✅ Merged with the PR # +
  one-line summary; decision-log entry (FE-only; configurable shelves via existing commands —
  `getDiscoveryByTags`/`getAuthorDetail`/`getAuthors`+`filterAuthors`, no new Rust; shelf data
  fetched in App and passed to pure HomeView/Shelf; management in Settings; status shelves render
  creator cards; Library tabs; AuthorDetail hours via `formatLong`; recent rows clickable).

## Notes / gotchas

- **Keep every new prop OPTIONAL with a default** — HomeView/LibraryView/SettingsView/AuthorDetail
  tests build props inline; a new *required* prop breaks them.
- **Views stay pure** — do NOT call `invoke` inside HomeView/Shelf/SettingsView; App fetches shelf
  data and passes it down. The kind→command mapping lives in `src/lib/shelves.ts` (the only place
  that imports `api`), keeping it unit-testable with `vi.mock("./api")`.
- **Default `home_shelves` is empty** — this is deliberate so Home is unchanged until the user adds
  shelves (no empty-Home regression, no fixture dependency in the default path).
- **Status shelves render creator cards, not work cards** — a cross-author works-by-status list would
  need a new Rust command; this is the FE-only path. Do not add a backend command.
- **No new Rust / no schema / no migration** — if you find yourself wanting a new Tauri command,
  STOP and report; the milestone is explicitly FE-only and `cargo test` must stay 47.
- The shelf-items effect should not run on every player tick — key it on the shelves config (and a
  library-refresh signal if one exists), not on `currentTime`.
- If `verify.ps1` shots look stale after FE edits, force a relink:
  `cmd /c "tools\dev-env.cmd cargo clean -p audioshelf"` then re-run.
