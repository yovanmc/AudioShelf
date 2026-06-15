# M34 — Rendering & Memory at Scale (AudioShelf, v8 closer)

> **Written for Sonnet execution. If something in the codebase doesn't match what this plan
> describes (a file:line is off, a prop shape differs, a list is `<ul>`/`<table>` where the plan
> assumed `<div>`), STOP and report rather than guess.** This is the LAST v8 milestone — its job is
> to make rendering scale to a 10k+ library **without regressing the shipped UI at normal scale**.

## Context & owner decisions

v8 ("Real-Scale Hardening") shipped M30 (robust/incremental scan + scale-test foundation), M31
(scan-write throughput), M32 (query/index perf), M33 (remove transcripts, simplify search). M34 is
the final lever: **FE rendering & memory at scale.**

An Explore digest of the live build found that **only the LibraryView author list is virtualized**
(react-window `FixedSizeList`, M7). Every other large list renders all rows with `.map()`. The same
digest established the key scoping fact: **at a 10k-author library the JS arrays are only ~1–10 MB
(fine) — the real bottleneck is DOM node count, not memory.** So the fix is render-virtualization +
result caps, FE-only. Backend data-windowing was explicitly rejected by the owner (marginal memory
win, would move sort/filter server-side and break M10's in-memory client filtering).

**Owner decisions (batched AskUserQuestion, 2026-06-14):**
1. **Scope = all six surfaces, proportionate** — full virtualization for the unbounded HIGH ones
   (Home shelves, AuthorDetail chapters, Journal); caps + virtualize-only-above-threshold for the
   already-bounded ones (search, collections, LabelManager tables, discovery facets).
2. **FE-only** — react-window (already a dep) windows the DOM; result caps bound the rest. **No
   backend, no schema, no new dep.** `db::LATEST` stays **13**.
3. **Home shelves** — virtualize the vertical shelf stack + cap items per shelf (~20) with a
   "+N more" affordance; do **not** attempt fragile horizontal-carousel virtualization.

## Hard invariants (gates — verify at the end)

- **No new dependency.** `git diff --stat package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock gen-fixture/Cargo.toml` must be **EMPTY**. `react-window@^1.8.10` + `@types/react-window@^1.8.8` are already present — use only those.
- **FE-only.** `git diff --stat src-tauri/` must be **EMPTY** (no Rust/schema/command change). `db::LATEST` stays **13**.
- **Read-only-on-disk.** No new `fs::`/file writes (this is FE-only, so trivially held — but confirm no `tauri`/`invoke` write commands were added).
- **Default fixtures stay 43/44/47** (`fixture_scan.rs` untouched; the scale data the new walkthrough needs is **runtime-seeded**, the m27 precedent).
- **No visual/behavioral regression at normal scale.** This is the load-bearing safety property of the milestone — see "The no-regression strategy" below.

## The no-regression strategy (READ FIRST — this shapes every task)

react-window rows are absolutely-positioned `<div>`s (the `style` prop **must** be applied to each
row's outer element). Virtualizing a list therefore changes its markup (and, for `<ul>`/`<table>`
surfaces, its element types). To guarantee zero regression at fixture/normal scale, **every
virtualized surface uses an external threshold gate** — it renders the **existing, unchanged markup**
below the threshold and only switches to the virtualized renderer above it:

```tsx
{items.length > VIRTUALIZE_THRESHOLD
  ? <VirtualList items={rows} itemSize={...} renderItem={...} />
  : (/* the EXISTING markup, byte-for-byte unchanged */)}
```

Consequences (rely on these):
- At fixture scale (every surface is well below the threshold on 43/44/47) the **original render path
  runs unchanged** → **all existing component tests and all existing screenshot walkthroughs stay
  green with no edits.** Do not modify existing tests/walkthroughs except to add new ones.
- The virtualized path is **new, additive code**, exercised only by the new unit tests and the new
  `m34` walkthrough (which runtime-seeds enough data to cross the threshold).
- `VIRTUALIZE_THRESHOLD = 40` is above every per-surface count on the default fixtures (a fixture
  author has only a handful of works/chapters; journal/labels/collections are seeded tiny). **Confirm
  this** while implementing — if any surface already renders >40 rows on the default fixture, STOP and
  report (it would mean a screenshot baseline shift we must verify deliberately).

## Conventions (from ROADMAP + decision log)

- Cargo/build via the **PowerShell tool**, absolute-quoted `dev-env.cmd` form (the Bash-tool
  `cmd /c "tools\dev-env.cmd …"` form silently no-ops in this environment). For a frozen build:
  `npm run build` THEN `cargo tauri build --debug`; never `cargo test`/`tauri dev` between a frozen
  build and `verify.ps1 -SkipBuild` (→ dev-mode "localhost refused").
- FE gates: `npx tsc --noEmit` · `npm test` (vitest) · `tools\verify.ps1 -Walkthrough <name>` for
  screenshots. Screenshots are viewed by a **Sonnet subagent that returns a text verdict** — never
  load PNGs into the controller.
- Package is `audioshelf` (lib `audioshelf_lib`). Tests are co-located `*.test.ts(x)`, runner vitest.

---

## Task 1 — Reusable `VirtualList` component + unit test

**New file:** `src/components/VirtualList.tsx`. A pure virtualized renderer (always virtualizes — the
threshold gate lives in the call sites, per the no-regression strategy). Supports a fixed `itemSize`
(number → `FixedSizeList`) or a variable `itemSize` (function → `VariableSizeList`, with the required
`resetAfterIndex` on item-set change).

```tsx
import { useEffect, useRef, type ReactNode } from "react";
import {
  FixedSizeList,
  VariableSizeList,
  type ListChildComponentProps,
} from "react-window";

/** Surfaces render their existing markup at/below this count and only switch to
 *  VirtualList above it. Chosen above every per-surface count on the 43/44/47 fixtures,
 *  so existing tests + screenshots stay on the unchanged path. */
export const VIRTUALIZE_THRESHOLD = 40;

/** Default inner-scroll viewport height, mirroring LibraryView's `LIST_HEIGHT = 600`. */
const DEFAULT_HEIGHT = 600;

type Common<T> = {
  items: T[];
  /** Inner-scroll viewport height in px. Defaults to 600 (LibraryView precedent). */
  height?: number;
  width?: number | string;
  className?: string;
  overscanCount?: number;
  renderItem: (item: T, index: number) => ReactNode;
};

type Props<T> =
  | (Common<T> & { itemSize: number })
  | (Common<T> & { itemSize: (index: number) => number });

export function VirtualList<T>(props: Props<T>) {
  const {
    items,
    height = DEFAULT_HEIGHT,
    width = "100%",
    className,
    overscanCount = 6,
    renderItem,
  } = props;
  const variable = typeof props.itemSize === "function";
  const varRef = useRef<VariableSizeList>(null);

  // VariableSizeList memoizes measured offsets; reset when the row set changes
  // (e.g. a collapse toggle reorders the flattened rows).
  useEffect(() => {
    if (variable) varRef.current?.resetAfterIndex(0);
  }, [items, variable]);

  const Row = ({ index, style }: ListChildComponentProps) => (
    // The `style` MUST be applied to the row's outer element or layout breaks.
    <div style={style}>{renderItem(items[index], index)}</div>
  );

  if (variable) {
    return (
      <VariableSizeList
        ref={varRef}
        className={className}
        height={height}
        width={width}
        itemCount={items.length}
        itemSize={props.itemSize as (i: number) => number}
        overscanCount={overscanCount}
      >
        {Row}
      </VariableSizeList>
    );
  }
  return (
    <FixedSizeList
      className={className}
      height={height}
      width={width}
      itemCount={items.length}
      itemSize={props.itemSize as number}
      overscanCount={overscanCount}
    >
      {Row}
    </FixedSizeList>
  );
}
```

**New test:** `src/components/VirtualList.test.tsx`

- Render `<VirtualList items={Array.from({length: 500}, (_,i)=>i)} itemSize={40} height={400}
  renderItem={(n)=> <span data-testid="row">{n}</span>} />`; assert
  `screen.getAllByTestId("row").length` is **> 0 and far less than 500** (only the windowed subset +
  overscan render). This is the durable proof virtualization windows the DOM.
- Render the variable-size variant (`itemSize={(i)=> i % 2 ? 64 : 40}`, 500 items); assert again only
  a window renders and it does not throw.

**Verify:** `npx tsc --noEmit` clean; `npm test` green (new tests pass, all existing still pass).

---

## Task 2 — Flatten helpers for the grouped HIGH surfaces + unit tests

Journal and AuthorDetail are **nested/grouped** structures. To window them with a single list, flatten
to a flat array of typed rows. **Pure functions, fully unit-testable, no React.**

**New file:** `src/lib/flattenRows.ts`

> The exact field names below (`AuthorDetail`, `WorkRow.chapters`, `JournalResults` grouping) come from
> the digest. **Open the real types in `src/types.ts` / the view files and match them.** If the shapes
> differ from what's sketched here, adapt the helper to the real shapes and STOP-and-report only if a
> needed field is absent.

```ts
// Journal: flatten the author→work→entry grouping into a single row list.
export type JournalRow =
  | { kind: "author"; key: string; label: string }
  | { kind: "work"; key: string; label: string }
  | { kind: "entry"; key: string; entry: /* the existing journal entry type */ unknown };

// AuthorDetail: flatten works + (when expanded) their chapters into one row list.
export type AuthorDetailRow =
  | { kind: "work"; key: string; work: /* WorkRow */ unknown; collapsed: boolean }
  | { kind: "chapter"; key: string; chapter: /* ChapterRow */ unknown };
```

- `flattenJournal(grouped, opts)` → `JournalRow[]`, preserving the current author→work→entry order.
- `flattenAuthorDetail(works, collapsed: Set<number>)` → `AuthorDetailRow[]`: for each work emit a
  `work` row; **only if `!collapsed.has(work.id)`** emit its `chapter` rows after it. This makes
  collapse/expand a pure recompute of the flat array (and the VirtualList `useEffect` resets sizes).

**Row heights** (used by the VariableSizeList `itemSize` at the call sites — keep them as exported
constants here so tests and views agree):

```ts
export const ROW_H = {
  journalAuthor: 44,
  journalWork: 32,
  journalEntry: 68, // entries are CSS line-clamped to a fixed height — see Task 3
  adWork: 56,
  adChapter: 44,
} as const;
```

**New test:** `src/lib/flattenRows.test.ts`

- `flattenAuthorDetail` with 2 works (ids 1,2), `collapsed = new Set([2])` → rows =
  `[work#1, ...work#1 chapters, work#2]` (work#2's chapters omitted). Assert exact kind/order.
- `flattenJournal` over a small grouped fixture → assert author/work/entry rows appear in order and
  every entry is represented exactly once.

**Verify:** `npx tsc --noEmit` clean; `npm test` green.

---

## Task 3 — Virtualize the Journal view (HIGH)

**File:** `src/views/JournalView.tsx` (nested `.map()` at ~192–234 per the digest).

Recipe:
1. Compute the flat rows once with `flattenJournal(...)` (memoize with `useMemo` over the current
   grouped/filter state).
2. Gate on the **total entry count** (not group count): if `entries.length > VIRTUALIZE_THRESHOLD`,
   render a `<VirtualList items={rows} height={600} itemSize={(i)=> heightFor(rows[i].kind)} ... />`
   where `heightFor` maps the row kind to the `ROW_H` constants; the `renderItem` switches on
   `row.kind` and renders the **same visual row content** the existing nested map produces (extract the
   author-header / work-header / entry JSX into small components or inline switch arms so both paths
   share them). Else render the **existing nested markup unchanged**.
3. **Fixed entry-row height:** add a CSS clamp so entry rows are uniform (enables the fixed
   `journalEntry` height). In `src/styles/components.css` (or wherever the journal entry styles live),
   add to the entry's text element:
   ```css
   /* keep virtualized journal entry rows a predictable height */
   .journal-entry__text { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
   ```
   Apply this class so it affects **both** paths identically (so the below-threshold screenshots also
   show clamped text — keeping fixture screenshots stable means the clamp must already be benign on
   short fixture text, which it is). If the existing class name differs, match it; report if unclear.

**Test:** new `JournalView` scale test — render with a runtime-built grouped structure of >40 entries;
assert only a window of entry rows is in the DOM (e.g. `getAllByTestId("journal-entry").length` is
well below the total). Keep the existing JournalView tests unchanged (they run the original path).

**Verify:** `npx tsc --noEmit`; `npm test`.

---

## Task 4 — Virtualize AuthorDetail works + chapters (HIGH)

**File:** `src/views/AuthorDetailView.tsx` (works `.map()` + nested chapter `.map()` at ~324–446;
`collapsed: Set<number>` at ~208).

Recipe:
1. `const rows = useMemo(() => flattenAuthorDetail(works, collapsed), [works, collapsed]);`
2. Gate on **total chapter count across the author** (sum of `w.chapters.length`): if it exceeds
   `VIRTUALIZE_THRESHOLD`, render `<VirtualList items={rows} height={600}
   itemSize={(i)=> rows[i].kind === "work" ? ROW_H.adWork : ROW_H.adChapter} renderItem={...} />`;
   the `renderItem` reproduces the **existing** work-header (with its collapse toggle + expand/collapse-all
   wiring) and chapter-row JSX. Else render the **existing markup unchanged**.
3. **Collapse/expand still works** because toggling `collapsed` recomputes `rows`, the VirtualList
   `useEffect` calls `resetAfterIndex(0)`, and the list re-windows. Confirm the collapse toggle in the
   virtualized work-header updates the same `collapsed` state setter.
4. The "expand all" action that previously dumped thousands of chapter `<li>`s now produces a long
   flat `rows` array that the VirtualList windows — the original DOM-explosion is gone.

> Watch out: the existing rows may be `<ul>/<li>`. In the virtualized path they become `<div>` rows
> (VirtualList wraps each in a positioned div). Port the row CSS so a `<div className="chapter-row">`
> looks identical to the old `<li>`; the below-threshold path keeps the original `<ul>/<li>` so fixture
> screenshots don't shift. If porting the chapter-row styles to a div is non-trivial, report before
> guessing.

**Test:** new AuthorDetail scale test — a synthetic author with one work of 60 chapters; assert only a
window of chapter rows renders, and that toggling collapse on that work removes its chapter rows from
the flattened output (test the helper + a light render assertion). Existing tests unchanged.

**Verify:** `npx tsc --noEmit`; `npm test`.

---

## Task 5 — Home shelves: virtualize the vertical stack + cap items per shelf

**Files:** `src/views/HomeView.tsx` (shelf `.map()`s at ~83–142), `src/components/Shelf.tsx`
(items `.map()` at ~25–62).

Two independent changes:

**5a — Cap items per shelf (Shelf.tsx).** Add `export const CAP_SHELF_ITEMS = 20;`. In `Shelf`, render
at most `CAP_SHELF_ITEMS` items; if `items.length > CAP_SHELF_ITEMS`, append a lightweight
**"+N more"** affordance card/button at the end of the horizontal row (N = `items.length - CAP_SHELF_ITEMS`).
- The affordance should navigate to a natural existing destination if the shelf has one (e.g. a
  "more from <author>" shelf → that author's detail; a tag/collection shelf → the corresponding
  filtered Library/Discover). If a shelf has **no** natural target, render the count as a static
  "+N more" label (no dead button). Use the nav props HomeView already passes down; **do not invent
  new routes.** If no nav prop fits a given shelf type, fall back to the static label and report which
  shelf types lacked a target.
- A horizontal row of ≤20 cards is bounded → no horizontal-carousel virtualization needed (per owner
  decision 3).

**5b — Virtualize the vertical shelf stack (HomeView.tsx).** The number of shelves grows with listening
history. Gate on shelf count: if `shelves.length > VIRTUALIZE_THRESHOLD`, render the shelves through a
`<VirtualList items={shelves} itemSize={SHELF_ROW_HEIGHT} height={...} renderItem={(shelf)=> <Shelf .../>} />`
with a fixed `SHELF_ROW_HEIGHT` (measure a real shelf — header + one capped card-row; ~260px is the
starting estimate, **adjust to the real rendered height** so rows don't clip/overlap). Else render the
existing shelf `.map()` unchanged.
- Keep the non-shelf Home sections (dormant works, recommendations sliced to 6, recent listened) as
  they are — they're already bounded; just confirm each is capped (recommendations already `.slice(0,6)`).

**Test:** Shelf test asserting the "+N more" affordance appears only when `items.length > CAP_SHELF_ITEMS`
and exactly `CAP_SHELF_ITEMS` item cards render. A HomeView test is optional (shelf-stack virtualization
is covered by the VirtualList unit test); add one only if cheap.

**Verify:** `npx tsc --noEmit`; `npm test`.

---

## Task 6 — Bounded surfaces: caps + virtualize-above-threshold (proportionate)

These are already partly bounded; apply the lightest treatment that bounds the DOM. **For real
`<table>` surfaces, prefer cap + "show more" over react-window** (virtualizing `<tr>` inside a
positioned `<div>` breaks table layout). For `<div>`-list surfaces, use the threshold gate + VirtualList.

**6a — Search result buckets** (`src/views/LibraryView.tsx`, `SearchResultsPanel` ~225–273). Each bucket
(authors/works/chapters) is backend-capped at 50. Gate each bucket: `length > VIRTUALIZE_THRESHOLD ?
<VirtualList itemSize={ROW_HEIGHT_or_suitable} height={...}/> : existing map`. Convert that bucket's rows
to `<div>` rows in the virtualized branch only; keep the existing markup below threshold. (At 10k a
bucket hits its 50 cap > 40 → virtualizes.)

**6b — Collections** (`src/components/CollectionsView.tsx` ~20–29). Collection rows are typically few;
add a cap + "show more" only if the count can exceed ~40 (likely won't — confirm and, if it can't,
leave unchanged and note it). The nested `ScopedResults` it expands is handled in 6c.

**6c — ScopedResults card-grid** (`src/components/ScopedResults.tsx` ~28). Backend caps at 50. Add a
**"showing first 50 of N"** note when `results.works.length >= 50` (honest cap disclosure — the
decision log values not silently truncating). Card-grid virtualization (FixedSizeGrid) is **out of
scope** (50 cards is acceptable); the note is sufficient.

**6d — LabelManager tables** (`src/views/LabelManagerView.tsx` term rows ~462, tag rows ~712). These are
real `<table>`s with 500–2000 rows at scale. Apply **cap + "Show all N" / incremental "show more"**
(render first `PAGE = 100` rows, a button reveals the next page), **not** react-window (avoids the
table-in-div problem). Keep the table markup. Add `export const LABEL_TABLE_PAGE = 100;`.

**6e — Discovery facet chips** (`src/views/DiscoveryView.tsx` ~79). Cap chips per type to
`CAP_FACET_CHIPS = 24` with a per-type "show more/less" toggle. Chips aren't a scroll list, so caps
suffice.

**Tests:** add focused tests for the new caps/notes that are pure/cheap:
- ScopedResults shows the "showing first 50 of N" note when given 50 works with a larger total (if the
  total is available in the props; if not, show the note when `length >= 50` and test that).
- LabelManager "show more" reveals the next page (render >100 terms, assert 100 rows, click, assert
  more). Match the real component's data plumbing; report if it doesn't expose a clean seam.
- DiscoveryView caps chips at 24 with a working toggle.
Keep existing tests for these surfaces unchanged (fixture-scale stays under all caps).

**Verify:** `npx tsc --noEmit`; `npm test`.

---

## Task 7 — `m34` walkthrough (virtualized-journal scale proof) + registration

The default 43/44/47 fixtures are below every threshold, so virtualization won't engage in existing
walkthroughs (by design). Add a walkthrough that **runtime-seeds a large journal** (the m27 precedent:
journal notes/bookmarks are seedable at runtime via existing commands) to cross the threshold and prove
the virtualized journal renders + scrolls. AuthorDetail/label virtualization is proven by unit tests
(chapters can't be runtime-seeded without a backend write path, which is out of scope).

**File:** `src/harness/walkthroughs.ts`
- Add `"m34"` to the `walkthroughs` tuple (line ~51).
- Add `m34Steps(nav)` returning steps:
  1. `seed-journal` — seed ≥60 journal entries (reuse the m27 seeding helper/commands; if m27's seeder
     isn't reusable, replicate its idempotent runtime-seed pattern). Then open the Journal view.
  2. `journal-virtualized` — capture the virtualized journal (top of list).
  3. `journal-scrolled` — scroll the inner virtualized list (the react-window scroller, not the page)
     by ~1500px and capture again (proves windowing recycles rows). Use the existing scrolled-capture
     pattern noted for tall views; the scroll target is the VirtualList's inner `div` (react-window's
     outer element). If the existing harness scroll helper scrolls the page not the inner list, scroll
     the list element by query (e.g. the `.journal-list` container) — report if no clean selector.
  4. `library` — capture LibraryView (already virtualized; continuity/regression).
- Follow each capture with `await settle(); await imagesSettled();` before the screenshot (covers may
  load). Keep step **names stable**.

**File:** `src/harness/runner.test.ts`
- Add an `m34Steps` block asserting the step-name order:
  `["seed-journal","journal-virtualized","journal-scrolled","library"]`.

**Wire `m34` into the harness nav** wherever the other walkthroughs are dispatched (the switch/map that
turns a walkthrough name into its `*Steps(nav)` call — mirror how `m30`/`m27` are wired). Provide the
nav callbacks it needs (seed + showJournal + showLibrary) from the existing nav object.

**Verify:** `npx tsc --noEmit`; `npm test` (runner.test passes with the new block).

---

## Task 8 — Full verification + invariant audit (controller-run after subagents)

Run from the repo root (PowerShell tool, absolute-quoted dev-env where Rust is involved):

1. **Type + unit gates:** `npx tsc --noEmit` (clean) · `npm test` (all green — existing + new). Record
   the new vitest total (expect +N for the new tests; existing count must not DROP).
2. **Invariant audit (must all hold):**
   - `git diff --stat src-tauri/` → **EMPTY** (FE-only).
   - `git diff --stat package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock gen-fixture/Cargo.toml` → **EMPTY** (no new dep).
   - Confirm `db::LATEST` is still **13** (grep; unchanged).
   - Grep `src/` for any new `invoke(` write-style command — there should be none (read-only intact).
   - Confirm `fixture_scan` counts unchanged: the file `src-tauri/tests/fixture_scan.rs` is untouched
     (it's in the EMPTY src-tauri diff).
3. **Frozen build + screenshots:** `npm run build` THEN `cargo tauri build --debug` (PowerShell,
   dev-env). Then `tools\verify.ps1 -SkipBuild -Walkthrough m34` and a **regression** pass on the
   surfaces M34 touched at fixture scale: `-Walkthrough m12` (home), `journal`, and `m24` (author
   detail / now-playing surfaces) — these must look **unchanged** (below-threshold path). Do **not**
   `cargo test`/`tauri dev` between the frozen build and the screenshots.
4. **Screenshot verdict via a Sonnet subagent** (text verdict + paths; never load PNGs here). Acceptance:
   - `m34`: journal renders many entries, scrolling recycles rows (the scrolled shot shows different
     entries than the top shot) — proof virtualization works; LibraryView shot normal.
   - `m12`/`journal`/`m24`: **no visual regression** vs the shipped look (the below-threshold path is
     the same markup) — allow only expected baseline drift, flag anything that looks structurally
     different (e.g. row spacing changed → the div-row CSS port in Task 4/6 drifted).
5. If any gate fails, fix and re-run; the controller direct-reviews any borderline regression shot.

---

## Task breakdown for subagent dispatch (suggested)

- **Subagent A (foundation, serial first):** Task 1 (VirtualList) + Task 2 (flatten helpers) + their
  tests. These are self-contained, no view edits — must land first (others import them).
- **Subagent B (HIGH surfaces):** Task 3 (Journal) + Task 4 (AuthorDetail), depends on A.
- **Subagent C (Home + bounded):** Task 5 (Home) + Task 6 (search/collections/scoped/labels/discovery),
  depends on A.
- **Subagent D (harness):** Task 7 (m34 walkthrough + runner.test), depends on B (journal virtualized).
- **Controller:** Task 8 (build, screenshots, invariant audit, PR/CI/merge, ROADMAP update).

Each subagent: implement → `npx tsc --noEmit` → `npm test` (its scope green, nothing else broken) →
commit. Review by reading committed code. If a file:line or shape doesn't match this plan, **STOP and
report** — do not guess.

## Definition of done

- `VirtualList` + flatten helpers shipped with unit tests proving DOM windowing.
- All six surfaces bounded: Journal/AuthorDetail/Home-shelf-stack virtualized above threshold;
  Home-shelf-items/search/collections/scoped/labels/discovery capped (with honest "+N more" / "showing
  first N" affordances).
- **No regression at fixture scale** (existing tests + m12/journal/m24 screenshots unchanged).
- Invariants held: no new dep, FE-only (`src-tauri` diff empty), `db::LATEST` 13, read-only, fixtures
  43/44/47.
- `tsc` clean, `npm test` green (count not decreased), frozen-build `m34` + regression screenshots →
  Sonnet subagent verdict PASS.
- PR opened, CI `build-and-test` green, merged `--merge --delete-branch`, ROADMAP M34 row → ✅ Merged,
  decision log appended. **v8 (M30–M34) COMPLETE.**
