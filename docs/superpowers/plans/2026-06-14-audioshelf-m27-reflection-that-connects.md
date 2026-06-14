# M27 — Reflection that Connects (Plan)

> **Written for Sonnet execution.** If anything in the real code doesn't match what this plan
> says (a signature, a line range, a field name, a table shape), **STOP and report** rather than
> guess. Line numbers are approximate locators from a digest, not exact — search for the quoted
> symbol/string to find the real site. Every task ends with a concrete verification command and
> its expected output; do not advance past a failed gate.

## Milestone goal

Make AudioShelf's **records** (Journal, Insights) *actionable* — they currently display data that
dead-ends. M27 wires them back into the listening loop and into discovery:

- **CUR-2** — Journal notes/bookmarks become clickable → **play from that exact moment**.
- **CUR-5** — Insights heatmap days / rhythm weeks become clickable → a focused **"Played in <range>"**
  results list (reuses `ScopedResults`); top-tag bars → jump to **Library pre-filtered** by that label.
- **CUR-10** — ratings + "where I left off" (re-entry) notes **feed Discover** (seed/boost + a reason)
  and surface a small **"Reflections"** stat on Insights.
- **IA7-3** — **back-navigation** added to Journal & Insights (they have none; every other view does).
- **IA7-6** — move **Collections** out of "My listening" (records) into "Browse" (it's a query interface).
- **IA7-7** — show a **journal affordance** on chapter rows that already have notes/bookmarks/summary.

### Scope decisions (locked with owner 2026-06-14 — do not re-litigate)

- **CUR-5 depth = "Focused results panel."** A lightweight read-only "Played in <range>" results view
  reusing the existing `ScopedResults` grid; **no** new date-filter control on LibraryView, **no**
  author-range query. Tag drill-down reuses the existing M26 Library label filter.
- **CUR-10 reach = "Discover + small Insights stat."** Feed Discover from rated/re-entered works
  (with a reason string) + add one "Reflections" stat to Insights. **Do not** touch Collections.

### Invariants (verify each holds at the end — these are gates, not aspirations)

- **NO schema migration.** `db::LATEST` stays **10**. Every M27 change is a read-only query, a
  computed field on an existing query, or UI wiring. `git diff main -- src-tauri/src/db.rs` should be
  **empty** (or touch only comments). If you think you need a migration, STOP and report — you don't.
- **Read-only-on-disk.** No new `std::fs` writes. The only writes remain the existing SQLite
  `settings` / `play_events` / journal-table rows. `git grep` introduces no new `fs::write`/`File::create`.
- **No new dependency.** `git diff main -- src-tauri/Cargo.toml src-tauri/Cargo.lock package.json package-lock.json` empty.
- **Fixtures held at 43 / 44 / 47.** Do **not** touch `src-tauri/tests/fixture_scan.rs` or the
  fixture generator. M27 walkthrough data (notes, bookmarks, ratings, play_events) is seeded **at
  runtime** inside the walkthrough, exactly like M9 seeded tags at runtime.
- **Dark-first M12 design system.** Use existing tokens (`--color-*`), `SectionHeading`, `PageHeader`,
  `Chip`, the `Select` primitive, existing icon set. No raw hex, no new color.

## Conventions (from ROADMAP.md — follow exactly)

- Cargo via `cmd /c "tools\dev-env.cmd cargo ..."` in the **foreground** (large timeout).
  `npm run build` before any `cargo tauri build`.
- Gates per task: `npx tsc --noEmit` · `npm test` · `cmd /c "tools\dev-env.cmd cargo test"`.
- Final screenshot gate: a **frozen** `npm run build` then `cargo tauri build --debug`, then
  `tools\verify.ps1 -Walkthrough <name> -SkipBuild`. **A Sonnet subagent reads the PNGs and returns a
  text verdict** — never load PNGs into the controller context unless the owner explicitly asks.
- Commits: repo identity `yovanmc <yovanmc@users.noreply.github.com>` (never `-c user.email=...`).
  Per workspace `AGENTS.md`, substantive Codex-generated commits append, after a blank line,
  `Co-authored-by: Codex <noreply@openai.com>`.
- Branch: `m27-reflection-that-connects`. One commit per task below. CI job `build-and-test` on
  windows-latest; merge `--merge --delete-branch` after a **foreground** `gh pr checks <PR#> --watch`.

---

## Key files (verified locations — search the quoted symbol to confirm before editing)

| Area | File | Anchor |
|------|------|--------|
| FE API types | `src/lib/api.ts` | `ChapterNote`/`ChapterBookmark`/`JournalEntry` (~21-30), `InsightsData` (~98-133), `PlaybackContext`/`ChapterRow` (~9-14,140-148) |
| App shell/routing | `src/App.tsx` | `type Route` (~102-126), `shellRoute()` (~same), `playChapter()` (~892-914), `playChapterById()` (~640-658), `pendingSeekRef`, `seek()` |
| Sidebar nav | `src/components/AppShell.tsx` | `groups` array (~27-38), `ShellRoute` (~7) |
| Journal view | `src/views/JournalView.tsx` | props (~34-39) |
| Insights view | `src/views/InsightsView.tsx` | props (~1-186) |
| Author detail (chapter rows) | `src/views/AuthorDetailView.tsx` | chapter row render (~404-433) |
| Scoped results grid | `src/components/ScopedResults.tsx` | props (~8-48) |
| Rust commands | `src-tauri/src/commands.rs` | `load_chapter_row` (~824-861), `query_author_detail` (~323-333), discovery (`discovery_for_tags` ~625, `home_recommendations` ~991, `get_discovery` ~1218), journal (~2379-2601) |
| Insights compute | `src-tauri/src/insights.rs` | `build_insights`/`compute_insights` |
| Rust model | `src-tauri/src/model.rs` | `ChapterRow`, `DiscoveryWork` (~60-70), `ScopedResults`/`ScopedWork` (~432-438), `InsightsData` |
| Command registration | `src-tauri/src/lib.rs` (or `main.rs`) | `tauri::generate_handler![...]` invoke list |
| Walkthroughs | `src/harness/walkthroughs.ts` + import in `App.tsx` (~58) | step arrays |

> Before writing any code, **read** each file you will touch once, in full, and confirm the anchors
> above. If an anchor is wrong, find the real one; if the *shape* is materially different from this
> plan's assumptions, STOP and report.

---

## Task 0 — Branch + baseline

1. `git checkout main && git pull`.
2. `git checkout -b m27-reflection-that-connects`.
3. Record baseline test counts so you can prove deltas later:
   - `npm test` → note the FE test total (digest said ~464).
   - `cmd /c "tools\dev-env.cmd cargo test"` → note the Rust total (digest said ~166).
   - `npx tsc --noEmit` → clean.

**Verify:** all three green on a clean branch. If `main` is red, STOP and report — do not build on red.

---

## Task 1 — CUR-2: clickable Journal note/bookmark → play from that moment

**Goal:** In `JournalView`, note & bookmark entries (those with a non-null `positionSecs` and a
non-null `chapterId`) get a play affordance that starts that chapter seeking to the stored second.

**No backend change.** Reuse the in-memory resolution already used by `playChapterById`.

### 1a. App-level handler (`src/App.tsx`)

Add a handler that resolves the chapter from the already-loaded `authors` list and plays it seeking
to a specific position. Model it on the existing `playChapterById` (~640-658) but allow a seek target:

```tsx
// Play a journal entry's chapter starting at its captured position (CUR-2).
function playJournalEntry(chapterId: number, positionSecs: number) {
  for (const d of authors) {
    for (const w of d.works) {
      const ch = w.chapters.find((c) => c.id === chapterId);
      if (ch) {
        // Give the note position precedence over the chapter's own resume point,
        // exactly as a bookmark seek does (playChapter only seeds from
        // playbackPositionSecs when pendingSeekRef is still null).
        pendingSeekRef.current = Math.max(0, Math.floor(positionSecs));
        playChapter({
          chapter: ch,
          authorId: d.id,
          authorName: d.name,
          workId: w.id,
          workTitle: w.baseTitle,
          workTotalChapters: w.chapters.length,
          workPlayedChapters: w.chapters.filter((c) => c.played).length,
        });
        return;
      }
    }
  }
  // Chapter not in the loaded set (shouldn't happen — all authors load at startup).
  // Fail safe: do nothing rather than throw.
}
```

> Confirm `pendingSeekRef` and `playChapter` exist with these shapes (digest: `playChapter` at
> ~892-914 already does `if (pendingSeekRef.current == null && resumeAt > 1) pendingSeekRef.current = resumeAt;`).
> Setting `pendingSeekRef.current` *before* calling `playChapter` is what gives the note precedence.
> If `playChapter`'s precedence logic differs, STOP and report.

Pass it to `JournalView` where it's rendered (search `<JournalView`):

```tsx
<JournalView
  /* ...existing props... */
  onPlayEntry={(entry) => {
    if (entry.chapterId != null && entry.positionSecs != null) {
      playJournalEntry(entry.chapterId, entry.positionSecs);
    }
  }}
/>
```

### 1b. JournalView (`src/views/JournalView.tsx`)

Add the optional prop and a play affordance on time-anchored entries only.

```tsx
function JournalView(props: {
  journal: JournalResults | null;
  exportStatus: string | null;
  onSearch: (query: string) => void;
  onExport: (format: "markdown" | "json") => void;
  onPlayEntry?: (entry: JournalEntry) => void;   // CUR-2
}) {
```

Where each entry renders its `chapterTitle` + position, add a button when it's playable. Find the
existing position/chapterTitle render (digest: ~lines 203-207). Render a small text/icon button:

```tsx
{entry.chapterId != null && entry.positionSecs != null && props.onPlayEntry && (
  <button
    type="button"
    className="journal-entry__play"
    onClick={() => props.onPlayEntry!(entry)}
    aria-label={`Play ${entry.chapterTitle ?? "chapter"} from ${formatTimecode(entry.positionSecs)}`}
  >
    {/* reuse the existing play icon component used elsewhere; e.g. <Icon name="play" /> */}
    ▶ Play from {formatTimecode(entry.positionSecs)}
  </button>
)}
```

- Use the project's existing timecode formatter (search for one used in the PlayerBar / scrubber,
  e.g. `formatTimecode` / `formatSecs` — reuse it, do **not** add a new one). If none is importable,
  STOP and report rather than inline a duplicate.
- Use the existing play **Icon** component (search how the Library row play button renders its icon);
  the `▶` glyph above is a placeholder — match the real icon usage for visual consistency.
- Style `.journal-entry__play` with existing tokens (transparent bg, `--color-accent` text on hover,
  small). Reuse an existing button class if one fits; only add a class if needed.

### 1c. Tests (`src/views/JournalView.test.tsx`)

Add tests:
1. A note entry (chapterId + positionSecs set) renders a play button; clicking it calls `onPlayEntry`
   with that entry.
2. A summary entry (chapterId null / positionSecs null) renders **no** play button.

**Verify:** `npx tsc --noEmit` clean · `npm test` green, FE count = baseline **+2**.
Commit: `m27: clickable journal notes play from captured position (CUR-2)`.

---

## Task 2 — IA7-3: back-navigation on Journal & Insights

**Goal:** Both views get a back affordance consistent with `AuthorDetailView`/`SettingsView`'s
`onBack` pattern. Back target = Home (their parent surface).

### 2a. JournalView + InsightsView

Add `onBack?: () => void` to each component's props and render a back control in the `PageHeader`.
Find how `AuthorDetailView`/`SettingsView` render their back button (search `onBack` in those files)
and **replicate that exact affordance** (same component, same placement, same label style) so it's
visually consistent. If `PageHeader` already supports a `onBack`/`back` prop, use it; otherwise pass
a back button via the existing header `actions`/leading slot — match the prior-art view.

### 2b. Wire in `App.tsx`

```tsx
<JournalView /* ... */ onBack={() => setRoute({ kind: "home" })} />
<InsightsView /* ... */ onBack={() => setRoute({ kind: "home" })} />
```

### 2c. Tests

In `JournalView.test.tsx` and `InsightsView.test.tsx` (create the latter if it doesn't exist): the
back control renders and calls `onBack` on click.

**Verify:** `tsc` clean · `npm test` green (+≥2). Commit: `m27: back-nav on Journal & Insights (IA7-3)`.

---

## Task 3 — IA7-6: move Collections from "My listening" to "Browse"

**Goal:** Collections is a query interface, not a listening record. Move it into the "Browse" group so
"My listening" holds only records (Journal, Insights).

### `src/components/AppShell.tsx`

In the `groups` array (~27-38), move the `collections` `NavItem` from the "My listening" group into
the "Browse" group (after `discovery`):

```tsx
const groups: Array<{ label: string; items: NavItem[] }> = [
  { label: "Browse", items: [
    { key: "home", label: "Home", icon: "home", action: onHome },
    { key: "library", label: "Library", icon: "library", action: onLibrary },
    { key: "discovery", label: "Discover", icon: "discover", action: onDiscovery },
    { key: "collections", label: "Collections", icon: "collections", action: onCollections },
  ] },
  { label: "My listening", items: [
    { key: "journal", label: "Journal", icon: "journal", action: onJournal },
    { key: "insights", label: "Insights", icon: "insights", action: onInsights },
  ] },
];
```

- Don't change `ShellRoute`, route names, props, or `onCollections` — only the item's group membership.
- Update any test that asserts the group membership (search `AppShell.test` for "My listening" /
  "Collections"). If a walkthrough step asserts Collections' position, fix it in Task 8.

**Verify:** `tsc` clean · `npm test` green. Commit: `m27: move Collections into Browse group (IA7-6)`.

---

## Task 4 — IA7-7: journal affordance on chapter rows

**Goal:** A chapter row in Author Detail shows a small indicator when the chapter already has journal
data, so users discover that entries exist. Clicking it opens the existing `ChapterJournalDialog`.

**"Has journal data"** = any of: a `chapter_notes` row, a `chapter_bookmarks` row, a non-empty
`user_summary`, a non-empty `takeaway`, or `is_favorite = 1`. This needs a **computed boolean** on the
chapter query — **no schema change**.

### 4a. Model (`src-tauri/src/model.rs`)

Add a field to `ChapterRow` (additive; serde renames to camelCase per existing convention — match how
`playback_position_secs` → `playbackPositionSecs` is done in this struct):

```rust
pub has_journal: bool,
```

> Put it adjacent to `user_summary`/`takeaway`/`is_favorite`. Confirm the struct's serde rename style
> (likely `#[serde(rename_all = "camelCase")]` on the struct) so it serializes as `hasJournal`.

### 4b. Query (`src-tauri/src/commands.rs`, `load_chapter_row` ~824-861)

`load_chapter_row` builds a `ChapterRow` from a chapters-table SELECT. Add `has_journal` computed via
EXISTS subqueries against the same `conn`, OR'd with the summary/takeaway/favorite columns it already
reads. Prefer doing it in SQL so it stays one round-trip:

```sql
-- extend the existing SELECT's projection (keep all current columns), adding:
,
(   c.user_summary <> ''
 OR c.takeaway     <> ''
 OR c.is_favorite  = 1
 OR EXISTS (SELECT 1 FROM chapter_notes     n WHERE n.chapter_id = c.id)
 OR EXISTS (SELECT 1 FROM chapter_bookmarks b WHERE b.chapter_id = c.id)
) AS has_journal
```

Map the new column to `has_journal: row.get::<_, bool>(<new index>)?` (rusqlite reads SQLite 0/1 as
`bool`). **Adjust every other positional `row.get(i)` index** in that mapping if you append the column
in the middle — appending it **last** in the projection is safest. If `load_chapter_row` builds the
SQL string in a shared helper used by multiple queries, ensure all callers still compile.

> If chapter rows are loaded somewhere **other** than `load_chapter_row` (e.g. a second query path in
> `query_author_detail`), update that path too so `has_journal` is always populated. Search for every
> construction of `ChapterRow { ... }` and make sure all set the new field. STOP and report if there's
> a construction site you can't satisfy without a schema change.

### 4c. FE type (`src/lib/api.ts`)

Add to `ChapterRow`:

```ts
hasJournal: boolean;
```

### 4d. AuthorDetailView (`src/views/AuthorDetailView.tsx`, chapter row ~404-433)

When `chapter.hasJournal`, render a small journal/note icon button on the chapter row that opens the
existing `ChapterJournalDialog` (the dialog is already wired — find the existing
"open journal for chapter" handler this view uses; reuse it). Use an existing icon (e.g. a
note/bookmark glyph from the icon set). Tooltip/aria: "View your notes & bookmarks".

> Do not add a new dialog or new open path — reuse whatever currently opens `ChapterJournalDialog`.
> If the dialog open handler isn't already plumbed into the chapter row, plumb the existing one
> through (don't invent a new command).

### 4e. Tests

- **Rust** (in `commands.rs` `#[cfg(test)]` or a `tests/*.rs`): seed a chapter, assert `has_journal`
  is `false`; insert a `chapter_notes` row for it; assert it becomes `true`. Also assert
  non-empty `user_summary` alone flips it `true`.
- **FE** (`AuthorDetailView.test.tsx`): a chapter with `hasJournal: true` renders the affordance;
  `false` does not.

**Verify:** `tsc` clean · `npm test` green · `cargo test` green (Rust +≥1). Confirm
`git diff main -- src-tauri/src/db.rs` is **empty**. Commit:
`m27: journal affordance on chapter rows via computed has_journal (IA7-7)`.

---

## Task 5 — CUR-5 (backend): "works played in a time range" query

**Goal:** A read-only command returning the works played within `[start_ms, end_ms)`, shaped for the
existing `ScopedResults` grid. No schema change — pure query over `play_events`.

### 5a. Command (`src-tauri/src/commands.rs`)

```rust
/// Works the user played within [start_ms, end_ms). Read-only drill-down for Insights (CUR-5).
#[tauri::command]
pub fn query_played_in_range(
    state: tauri::State<DbState>,
    start_ms: i64,
    end_ms: i64,
) -> Result<crate::model::ScopedResults, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    played_in_range(&conn, start_ms, end_ms).map_err(|e| e.to_string())
}
```

Implement `played_in_range(conn, start_ms, end_ms) -> rusqlite::Result<ScopedResults>`:

- Join `play_events pe` → `chapters c` → `works w` → `authors a`, filter
  `pe.played_at >= ?start AND pe.played_at < ?end` and `w.status = 'active'`.
- Group by `w.id`; produce one `ScopedWork` per work. **Match the exact `ScopedWork` field set** that
  `run_scoped_query` already produces (open `model.rs` ~432-438 and the existing scoped-query builder
  in `commands.rs` and **reuse the same construction** — same fields: workId, author, chapter/duration
  summary, etc.). Do not invent a new result shape; if `ScopedWork` needs a field you can't derive
  from this join, STOP and report.
- Order by most-recent play within the range (e.g. `MAX(pe.played_at) DESC`), then title — pick a
  stable deterministic order so screenshots are reproducible.

> If there's already a helper that turns a set of work-ids into `Vec<ScopedWork>` (the scoped-query
> path almost certainly has one), **call that helper** with the work-ids found in range, instead of
> re-deriving the per-work summary. Prefer reuse.

### 5b. Register the command

Add `query_played_in_range` to the `tauri::generate_handler![...]` list in `src-tauri/src/lib.rs`
(or `main.rs` — wherever the existing handlers are registered).

### 5c. FE binding (`src/lib/api.ts`)

```ts
export function queryPlayedInRange(startMs: number, endMs: number) {
  return invoke<ScopedResults>("query_played_in_range", { startMs, endMs });
}
```

> Match the existing `invoke<...>` wrapper style in this file (camelCase arg keys — Tauri maps
> `start_ms` ⇄ `startMs` automatically; confirm against another command that takes `_ms` args, e.g.
> `query_insights` uses `nowMs`/`tzOffsetMinutes`).

### 5d. Tests (Rust)

Seed authors/works/chapters + `play_events` rows at known `played_at` timestamps; assert
`played_in_range` returns exactly the works whose plays fall in the window, none outside, deduped per
work. Use the existing test DB setup helper used by other `commands.rs`/`tests` cases.

**Verify:** `cargo test` green (+≥1) · `tsc` clean. `git diff main -- src-tauri/src/db.rs` empty.
Commit: `m27: query_played_in_range backend for Insights drill-down (CUR-5)`.

---

## Task 6 — CUR-5 (frontend): make Insights drillable

**Goal:** Heatmap days and rhythm weeks become clickable → a "Played in <range>" results view; top-tag
bars → jump to Library pre-filtered by that label.

### 6a. New route + results view

Add a route variant in `src/App.tsx` `type Route`:

```ts
| { kind: "played-range"; startMs: number; endMs: number; label: string }
```

Map it in `shellRoute()` to `"insights"` (so the Insights nav item stays highlighted and back makes
sense):

```ts
if (route.kind === "played-range") return "insights";
```

Create a thin view `src/views/PlayedRangeView.tsx` that fetches once and renders `ScopedResults`:

```tsx
export function PlayedRangeView(props: {
  startMs: number;
  endMs: number;
  label: string;            // e.g. "Tue, Jun 10" or "Week of Jun 9"
  onOpenAuthor: (authorId: number) => void;
  onBack: () => void;
}) {
  const [results, setResults] = useState<ScopedResults | null>(null);
  useEffect(() => {
    let live = true;
    queryPlayedInRange(props.startMs, props.endMs).then((r) => { if (live) setResults(r); });
    return () => { live = false; };
  }, [props.startMs, props.endMs]);

  return (
    <div>
      <PageHeader
        /* match the back affordance used by AuthorDetailView */
        eyebrow="Insights"
        title={`Played · ${props.label}`}
        /* onBack={props.onBack} — wire the same way Task 2 wires Journal/Insights back */
      />
      {results == null ? (
        <p>Loading…</p>
      ) : results.works.length === 0 ? (    /* confirm the ScopedResults field name (works?) */
        <EmptyState>Nothing played in this period.</EmptyState>  /* reuse existing empty-state component/copy style */
      ) : (
        <ScopedResults results={results} onOpenAuthor={props.onOpenAuthor} />
      )}
    </div>
  );
}
```

- Confirm `ScopedResults`'s results prop field name and the empty-state component the codebase uses
  (M23 added context-aware empty states — reuse that component/pattern, don't hand-roll).
- Render `<PlayedRangeView>` in App's route switch with
  `onBack={() => setRoute({ kind: "insights" })}` and the same `onOpenAuthor` used elsewhere.

### 6b. InsightsView callbacks (`src/views/InsightsView.tsx`)

Add optional callbacks:

```ts
onDrillRange?: (startMs: number, endMs: number, label: string) => void;  // heatmap day / rhythm week
onFilterTag?: (tag: string) => void;                                     // top-tag bar
```

Wire them:

- **Heatmap cells** (the `DayCell` grid): when `cell.count > 0`, make the cell a `<button>` that calls
  `onDrillRange(cell.dateMs, cell.dateMs + 86_400_000, formatDayLabel(cell.dateMs))`. Cells with
  `count === 0` stay non-interactive (no pointer cursor). Keep current visuals; add hover/focus
  affordance using existing tokens.
- **Rhythm bars** (`WeekPoint[]`, each has `weekStartDay`): clicking a bar calls
  `onDrillRange(weekStartMs, weekStartMs + 7*86_400_000, "Week of " + formatDayLabel(weekStartMs))`.
  Derive `weekStartMs` from `weekStartDay`. **Check the unit of `weekStartDay`** — the digest says
  insights uses a local-day **index** (days since epoch), not ms. If it's a day index, convert:
  `weekStartMs = weekStartDay * 86_400_000` is only correct for UTC-day indices; the insights module
  computes **local** day with `tz_offset_minutes`. To stay correct, prefer passing the day index back
  to the backend, OR reconstruct ms using the same `tzOffsetMinutes` the view already has via `now`.
  **If you cannot reconstruct an exact ms window from the available data, STOP and report** — do not
  ship an off-by-a-day drill-down. (A clean option: add the absolute `weekStartMs`/`dateMs` to the
  backend `WeekPoint`/`DayCell` payload — `DayCell` already carries `dateMs`; if `WeekPoint` lacks an
  absolute ms, add `weekStartMs` to it in `insights.rs` + model + api.ts as an additive field. This is
  still **no DB schema change** — it's a computed field on the insights payload.)
- **Top-tag bars** (`InsightTagStat[]`): clicking calls `onFilterTag(tag.tag)`.

Use semantic `<button>`s for accessibility (keyboard-focusable), styled to look like the current
cells/bars.

### 6c. App wiring for the two drill paths

```tsx
<InsightsView
  /* ...existing... */
  onBack={() => setRoute({ kind: "home" })}
  onDrillRange={(startMs, endMs, label) => setRoute({ kind: "played-range", startMs, endMs, label })}
  onFilterTag={(tag) => {
    // Reuse the existing M26 Library label-filter mechanism.
    // Set whatever state LibraryView reads as its active label filter, THEN route to library.
    applyLibraryLabelFilter(tag);          // <-- use the real setter; see note below
    setRoute({ kind: "library" });
  }}
/>
```

> **Library pre-filter:** find how LibraryView's label filter is currently driven (digest: an
> `onLabelFilter` callback / a filter held in App or in LibraryView state). If the filter lives inside
> LibraryView's own state, lift the initial value via a prop (e.g. `initialLabelFilter?: string`) or a
> small App-held `pendingLibraryFilter` state that LibraryView consumes on mount and then clears.
> **Reuse the M26 filter path — do not build a second filtering mechanism.** If the cleanest seam
> isn't obvious from the code, STOP and report with what you found rather than duplicating filter logic.

### 6d. Tests (FE)

- `InsightsView.test.tsx`: a heatmap cell with `count>0` is a button and calls `onDrillRange` with the
  right `[start,end)`; a `count===0` cell is not clickable. A rhythm bar calls `onDrillRange`. A
  top-tag bar calls `onFilterTag` with the tag value.
- `PlayedRangeView.test.tsx`: renders `ScopedResults` when the query resolves with works; renders the
  empty state when it resolves empty; calls `onBack`.

**Verify:** `tsc` clean · `npm test` green (+≥4). Commit:
`m27: Insights heatmap/rhythm/tag drill-downs (CUR-5)`.

---

## Task 7 — CUR-10: ratings + re-entry feed Discover, plus a Reflections stat

**Goal:** (a) Discover recommendations are seeded/boosted from highly-rated and re-entered works with
an explicit reason; (b) Insights gains a small "Reflections" stat (counts of works rated / re-entered).
No schema change — both use the existing `works.completion_rating` and `works.re_entry_note` columns.

### 7a. Discover seeding/boost (`src-tauri/src/commands.rs`)

Find `home_recommendations()` (~991-1048) and/or `discovery_for_you()` (~781) — the path behind
`get_discovery()` (~1218). Today it seeds the tag search from a "featured work" or recent play history.

Change the seed selection to **prefer works that carry a signal of affection**: a non-empty
`completion_rating` (especially a high one) or a non-empty `re_entry_note`. Concretely:

1. Query candidate seed works: `SELECT id, completion_rating, re_entry_note FROM works
   WHERE status='active' AND (completion_rating <> '' OR re_entry_note <> '')`.
2. If any exist, pick the seed from this set (prefer the one with the strongest rating; if ratings are
   free-form text, treat any non-empty rating as a positive signal and rank
   re-entered-and-rated > rated > re-entered; tie-break deterministically by work id so output is
   stable for screenshots). Use that seed's tags to drive `discovery_for_tags(...)`.
3. Set the resulting `DiscoveryWork.reason` to reflect the signal, e.g.
   `"Because you rated <seed title>"` or `"You came back to <seed title>"`. Match the existing reason
   string style (`reason: "matches 'x', 'y'"`). Keep it short.
4. If **no** rated/re-entered works exist, fall back to the **current** behavior unchanged (featured /
   recent). Do not regress the cold-start path.

> Keep this surgical: it's a change to **seed selection + reason text**, not a rewrite of the scoring
> engine. Do not change `DiscoveryWork`'s shape. Do not exclude the seed work itself from results in a
> way that differs from current behavior — match how the existing path handles the seed.

### 7b. Reflections stat (`src-tauri/src/insights.rs` + model + FE)

Add two counts to the insights payload (additive fields — **no DB schema change**, computed in
`compute_insights`):

- `worksRated`: count of `works` with `completion_rating <> ''` and `status='active'`.
- `worksReEntered`: count of `works` with `re_entry_note <> ''` and `status='active'`.

Steps:
1. `model.rs` `InsightsData`: add `pub works_rated: i64, pub works_re_entered: i64,` (serde camelCase →
   `worksRated`/`worksReEntered`).
2. `insights.rs`: `compute_insights` runs two `SELECT COUNT(*)` queries (or one with conditional sums)
   against `works` and sets the fields. `build_insights` is pure over play_events, so add the counts in
   `compute_insights` where it has the `conn`, **or** thread them in — match the existing structure;
   if `build_insights` is where the struct is finalized, pass the two counts into it. STOP and report
   if the pure/IO split makes this awkward rather than forcing it.
3. `src/lib/api.ts` `InsightsData`: add `worksRated: number; worksReEntered: number;`.
4. `InsightsView.tsx`: add a "Reflections" item to the existing stat row (the one showing total time /
   chapters / active days / streaks). Copy: e.g. **"Reflections — N rated · M revisited"**. Use the
   existing stat-tile component/markup; no new styling.

### 7c. Tests

- **Rust:** seed works with/without ratings & re-entry notes; assert `compute_insights` returns the
  right `works_rated`/`works_re_entered`. Assert the discovery seed path: with a rated work present,
  `get_discovery`/`home_recommendations` returns results whose `reason` reflects the rating (and that
  the cold-start fallback still works when none exist).
- **FE:** `InsightsView.test.tsx` renders the Reflections stat from `worksRated`/`worksReEntered`.

**Verify:** `tsc` clean · `npm test` green · `cargo test` green. `git diff main -- src-tauri/src/db.rs`
empty. Commit: `m27: ratings & re-entry feed Discover + Reflections stat (CUR-10)`.

---

## Task 8 — Walkthrough + harness (`m27` screenshots)

**Goal:** A deterministic `m27` walkthrough that seeds journal/ratings/play_events **at runtime**
(fixtures stay 43/44/47) and captures the new surfaces, plus add `m27Steps` to the harness.

### 8a. Add `m27Steps` (`src/harness/walkthroughs.ts`)

Author a step sequence (mirror the structure of `m26Steps`/`journalSteps`/`insightsSteps`). It must:

1. **Seed at runtime** (use the same runtime-seed approach M9/journal walkthroughs use — call the
   journal/rating/bookmark commands via the app, or a harness seed helper): for one known fixture work
   (e.g. Jane Doe's first work/chapter), add a note at a known position, a bookmark, a `user_summary`,
   a `completion_rating`, and a `re_entry_note`; insert a couple of `play_events` at known timestamps
   so the heatmap/rhythm have a clickable day/week. **Clean determinism:** seed → screenshot →
   (the DB persists across runs, per the AudioShelf gotcha) so make the seed **idempotent** (insert-or-
   ignore / set, not blind insert) to avoid drift on re-runs.
2. Navigate **Journal** → assert the note shows a "Play from <time>" affordance; capture shot
   `journal-playable`. Click it; capture `journal-play` (PlayerBar visible / playing).
3. Navigate **Insights** → capture `insights-reflections` (Reflections stat visible). Click a heatmap
   day with activity → capture `played-range` (ScopedResults grid + "Played · <label>" header + back).
   Go back; click a **top-tag** bar → capture `insights-tag-to-library` (Library filtered by that tag).
4. **Author detail** → capture `chapter-journal-affordance` (the seeded chapter shows the journal icon).
5. **Back-nav**: capture `journal-back` and `insights-back` showing the back control present.
6. **Nav grouping**: capture `nav-groups` showing Collections under "Browse", Journal/Insights under
   "My listening".

Use the existing `settle()` + `imagesSettled()` helpers before each shot (AudioShelf gotcha). Tall
views (Insights) need a scrolled multi-shot at 1280×860 if content runs below fold.

### 8b. Register the walkthrough

Add `m27Steps` to the import in `App.tsx` (~58) and to the launch-arg → steps switch (mirror how
`m26Steps` is registered). Add `m27` to `tools/verify.ps1`'s known walkthrough list if it enumerates
them (check how `m26` was added).

### 8c. Runner test

If `src/harness/runner.test.ts` enumerates walkthroughs, add `m27` so it stays green (mirror m26).

**Verify:** `tsc` clean · `npm test` green. Commit: `m27: add m27 walkthrough + harness wiring`.

---

## Task 9 — Full verification (frozen build + screenshots + regression)

1. Final static gates:
   - `npx tsc --noEmit` → clean.
   - `npm test` → green; record final FE count (= baseline + all added).
   - `cmd /c "tools\dev-env.cmd cargo test"` → green; record final Rust count.
2. **Invariant proof** (paste outputs into the PR body):
   - `git diff --stat main -- src-tauri/src/db.rs` → **empty** (no schema change; `LATEST` still 10).
   - `git diff --stat main -- src-tauri/Cargo.toml src-tauri/Cargo.lock package.json package-lock.json`
     → **empty** (no new dep).
   - `git diff --stat main -- src-tauri/tests/fixture_scan.rs` → **empty** (fixtures 43/44/47).
   - `git grep -nE "fs::write|File::create" src-tauri/src` shows **no new** call sites vs main
     (read-only-on-disk).
3. **Frozen build for screenshots:** `npm run build` then
   `cmd /c "tools\dev-env.cmd cargo tauri build --debug"`.
4. Run walkthroughs against the frozen build with `-SkipBuild`:
   - `tools\verify.ps1 -Walkthrough m27 -SkipBuild`
   - Regression: `m12`, `m21`, `m24`, `m25`, `m26` (the prior-art set this milestone touches Insights,
     Journal, Discover, nav, author-detail — so re-run all of these).
5. **Screenshot verdict via a Sonnet subagent:** dispatch a subagent to Read the PNGs that `verify.ps1`
   wrote and return a **text** PASS/FAIL verdict against the acceptance criteria below + the absolute
   PNG paths it viewed. Do **not** load PNGs into the controller context. Act on the verdict; if FAIL,
   fix and re-run (systematic-debugging), do not paper over it.

### Acceptance criteria (the verdict must confirm all)

- **CUR-2:** Journal note shows "Play from <time>"; clicking it starts playback (PlayerBar shows the
  right chapter, playing).
- **CUR-5:** Heatmap day / rhythm week click → "Played · <label>" results list (correct works, correct
  period); top-tag click → Library filtered by that tag; both reachable and back-navigable.
- **CUR-10:** Insights shows the Reflections stat (rated/revisited counts); Discover shows at least one
  recommendation with a "Because you rated…/You came back to…" reason when a rated/re-entered work
  exists.
- **IA7-3:** Journal and Insights each show a back control that returns to Home.
- **IA7-6:** Sidebar shows Collections under **Browse**; Journal + Insights under **My listening**.
- **IA7-7:** The seeded chapter row shows a journal affordance; un-annotated chapters do not.
- **No regressions** in m12/m21/m24/m25/m26 shots.

**Verify:** subagent verdict = PASS on every criterion + no regression. Commit any fixes.

---

## Task 10 — PR, CI, merge, ROADMAP update

1. Push branch; open PR titled **"M27 — Reflection that Connects"** with a body that:
   - Summarizes each item (CUR-2/5/10, IA7-3/6/7) and what shipped.
   - Pastes the **invariant proofs** from Task 9.2 (empty diffs, no new dep, fixtures held,
     read-only-on-disk, `LATEST` still 10).
   - States final FE/Rust test counts (baseline → final) and the screenshot verdict (PASS).
   - Ends with the standard footer.
2. **Foreground** `gh pr checks <PR#> --watch` (sleep ~20s first to dodge "no checks reported").
3. On green: `gh pr merge <PR#> --merge --delete-branch`; then `git checkout main && git pull`.
4. **Update `C:\Agent Projects\AudioShelf\ROADMAP.md`:**
   - Flip the M27 row to `✅ Merged`, link this plan and the PR, and write a one-line shipped summary
     (mirror the density of the M26 row: items shipped, invariant proofs, schema stayed v10/LATEST 10,
     fixtures 43/44/47, test counts, walkthrough verdict, any verification-caught fixes).
   - Append any durable gotchas discovered to the v7 decision-log/gotchas area (e.g. the heatmap
     day-index→ms reconstruction, the Library pre-filter seam, the discovery seed-precedence rule).
   - Commit `m27: mark M27 merged in ROADMAP` + push to main.
5. **Ping the owner** (Phase B handoff) with the paste-ready next-milestone prompt naming the absolute
   ROADMAP path and the next milestone (**M28 — Visual Consistency II**).

---

## Notes / risks the implementer should watch

- **The heatmap/rhythm time math is the one real trap.** Insights computes **local** day indices using
  `tz_offset_minutes`; a naive `dayIndex * 86_400_000` is wrong for non-UTC users. `DayCell` already
  carries an absolute `dateMs` — use it. For `WeekPoint`, if there's no absolute ms, add one in the
  backend payload (additive, no DB schema change). **Do not ship an off-by-a-day drill-down** — STOP
  and report if you can't get an exact window.
- **Reuse, don't duplicate:** the scoped-work builder (Task 5), the Library label-filter path (Task 6),
  the timecode formatter and play-icon (Task 1), the empty-state component (Task 6), the back-button
  affordance (Tasks 2/6), and the stat-tile markup (Task 7) **all already exist**. Find and reuse them.
  A new duplicate of any of these is a review-reject.
- **`has_journal` positional-index hazard:** appending the computed column to a SELECT shifts no
  existing indices only if you append it **last**. Double-check every `row.get(i)` in `load_chapter_row`
  (and any sibling chapter loader) after editing.
- **Determinism:** the app-data DB persists across walkthrough runs (AudioShelf gotcha). Make all M27
  seed steps **idempotent** (set / insert-or-ignore) so re-runs don't accumulate duplicates and shift
  screenshots.
- **If any task reveals that an item genuinely needs a schema change**, that contradicts this plan's
  core assumption — **STOP and report** before adding a migration; do not silently bump `LATEST`.
