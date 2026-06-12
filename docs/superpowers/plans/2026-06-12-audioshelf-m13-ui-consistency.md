# M13 — UI Consistency & UX Refinement — Implementation Plan

> **Written for Sonnet execution.** Every path, symbol, and class/token name below was read from
> the live tree on 2026-06-12. If something doesn't match what you find (a renamed symbol, a moved
> line, a different shape), **STOP and report** rather than guessing. Run each task's verify step
> before moving on. Companion findings doc:
> [`docs/superpowers/specs/2026-06-12-audioshelf-ui-ux-review.md`](../specs/2026-06-12-audioshelf-ui-ux-review.md).

## Scope, constraints, and shape

This milestone is a **frontend-only** consistency + core-loop pass. It builds shared primitives,
fixes global visual defects, and removes core-loop friction across the post-M12 dark UI.

- **No Rust, no schema, no new crate deps, no `Cargo.lock` change.** "Play next chapter from a work
  card" is solved FE-only by fetching `getAuthorDetail(authorId)` and selecting the first unplayed
  chapter (the pattern `AuthorDetailView` already uses). `cargo test` must stay **47** green and is
  only a regression check.
- **Read-only on disk; fixtures stay 43/44/47.** No on-disk fixture or `fixture_scan.rs` change.
- **App ships the M12 token/CSS layer** (`src/styles/*.css`). Prefer existing tokens/classes; add
  tokens only where noted. The available tokens/classes are listed inline per task.
- **Gates:** `npx tsc --noEmit` · `npm test` (was 21 files; **do not let the count drop** — add
  tests for new primitives) · `cargo test` (regression, 47) · the **before/after `m12` screenshot
  matrix** (capture a baseline FIRST — Task 0).
- **Size note:** this is a large, cohesive pass. Execute tasks **in order**; each is independently
  verifiable and committable. If the single PR grows unwieldy, it is acceptable to split into two
  PRs at the Task 7/8 boundary (primitives+visual first, then the heavier core-loop+editing tasks) —
  but target one PR. Keep new component props **optional with defaults** so existing tests don't
  break (several view tests build props inline, not via `baseProps`).

Key facts from the live tree (rely on these; verify before editing):
- `src/components/ui.tsx` already exports `IconButton({icon, label, ...})` (renders
  `aria-label`+`title=label`), `Button({variant})`, `Card`, `ProgressBar({value,label?})`,
  `StatCard`, `EmptyState({title,children?,action?})`, `Notice({tone,role?})`.
- `src/components/Icon.tsx` `IconName` union includes: `home library discover rename settings menu
  chevronLeft chevronRight more play pause back15 back30 forward15 forward30 volume sleep search
  check tag expand collapse close refresh folder`. The overflow icon is **`more`** (three-dot SVG) —
  there is **no** raw-text `...`; `Menu` already uses `<IconButton icon="more">`. **No `info` or
  `plus` icon exists** (add if a task needs one).
- `src/components/Menu.tsx`: `Menu({label, items: {label,onSelect}[], forcedOpen?})`.
- `src/components/Cover.tsx`: `WorkArtwork({workId,title,size?,className?})`,
  `CreatorAvatar({authorId,name,size?,className?,decorative?})`, `Cover`, `Swatch`.
- `src/components/CreatorIdentity.tsx`: `CreatorIdentity({authorId,authorName,secondary?,size?,onOpen?})`
  (already passes `decorative` to the avatar).
- `src/components/WorkCard.tsx`: props `{workId,title,authorId,authorName,tags?,reason?,progress?,
  meta?,actionLabel?,onAction?,onOpenAuthor?,menuItems?,featured?,menuOpen?}`. Single CTA = a
  `Button--primary` with `actionLabel`; renders `<Menu>` when `menuItems` present.
- Tokens (`tokens.css`): colors `--color-bg --color-sidebar --color-surface --color-surface-raised
  --color-surface-hover --color-border --color-border-strong --color-text --color-text-muted
  --color-accent --color-accent-hover --color-accent-soft --color-success --color-warning
  --color-danger`; `--focus-ring`; `--shadow-card --shadow-overlay`; `--space-1..7`;
  `--radius-sm/md/lg`; `--sidebar-expanded/collapsed`; `--player-height`; `--content-max`;
  `--motion-fast/normal/slow --ease-standard`. **No `--color-accent-muted`** (add it in Task 3).
- Layout classes: `.card-grid` uses `repeat(auto-fit, minmax(220px,1fr))`; `.now-playing` (the
  one-off modal) renders its close button as the first child (top-left); `.section-heading` exists
  but is used inline only in HomeView; **no `.eyebrow` class**.
- `src/lib/api.ts`: `getAuthorDetail(id)→AuthorDetail{works:WorkRow[]}`, `WorkRow{chapters:ChapterRow[]}`,
  `ChapterRow{id,title,chapterNo,...,played}`, `playChapter` is an App.tsx handler taking a
  `PlaybackContext{chapter,authorId,authorName,workId,workTitle,workTotalChapters,workPlayedChapters}`.
  `RecommendationWork`/`DiscoveryWork` carry only `workId/authorId/...` (no chapter rows).
- Harness: `walkthroughs.ts` array ends `... "tags","m12"`; `m12Steps(nav)` has 13 nav callbacks.
  `tools/verify.ps1 -Walkthrough <name> [-OutputRoot .shots] [-SkipBuild]` → shots in
  `<OutputRoot>/<name>/`.

---

## Task 0 — Capture the BEFORE baseline (do this FIRST, before any code change)

The milestone's gate is a before/after comparison, so capture the current state first.

```
npm run build
powershell -ExecutionPolicy Bypass -File tools\verify.ps1 -Walkthrough m12 -OutputRoot .shots-before
```
Confirm `.shots-before\m12\` contains the 13 PNGs (`01-home-empty` … `13-context-menu`). Add
`.shots-before/` to `.gitignore` if not already ignored (check: `.shots-baseline/` is ignored;
add `.shots-before/` and `.shots-after/` next to it). Do **not** commit screenshots.

**Verify:** the 13 baseline PNGs exist. (No test run needed.)

---

## Task 1 — Shared primitives: `PageHeader`, `SectionHeading`, `TagGroup`, `Dialog`

**File:** `src/components/ui.tsx` (append; keep existing exports). Add four primitives + reuse the
existing token classes.

**1a. `PageHeader`** — the eyebrow+title every view repeats inline. Renders a `.view-section` header.
```tsx
export function PageHeader({ eyebrow, title, actions }: { eyebrow: string; title: ReactNode; actions?: ReactNode }) {
  return (
    <header className="view-section page-header">
      <div className="page-header__copy">
        <div className="eyebrow muted">{eyebrow}</div>
        <h1>{title}</h1>
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}
```

**1b. `SectionHeading`** — unify the body-level section titles (Home/Discovery use different weights
today). Reuse the existing `.section-heading` class.
```tsx
export function SectionHeading({ eyebrow, title, actions }: { eyebrow?: string; title: ReactNode; actions?: ReactNode }) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow ? <div className="eyebrow muted">{eyebrow}</div> : null}
        <h2>{title}</h2>
      </div>
      {actions ?? null}
    </div>
  );
}
```

**1c. `TagGroup`** — a uniform wrapper around tag pills (today three different inline layouts).
```tsx
export function TagGroup({ tags, max, align }: { tags: string[]; max?: number; align?: "start" | "end" }) {
  if (!tags.length) return null;
  const shown = max ? tags.slice(0, max) : tags;
  return (
    <span className={`chips${align === "end" ? " chips--end" : ""}`}>
      {shown.map((t) => <span className="chip" key={t}>{t}</span>)}
    </span>
  );
}
```

**1d. `Dialog`** — extract the modal pattern (currently one-off in `now-playing`). The close button
is positioned **top-right** by the primitive (fixes the orphaned top-left close).
```tsx
export function Dialog({ label, onClose, className, children }: { label: string; onClose: () => void; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={`card dialog ${className ?? ""}`} role="dialog" aria-modal="true" aria-label={label}>
        <IconButton className="dialog__close" icon="close" label={`Close ${label}`} onClick={onClose} data-autofocus />
        {children}
      </div>
    </div>
  );
}
```
(Confirm `useRef`/`useEffect` are imported in `ui.tsx`; add to the React import if missing. Confirm
`IconButton` accepts `className` — it does via `...ButtonHTMLAttributes`; if `data-autofocus`
trips types, spread it through.)

**1e. CSS** (`src/styles/components.css`): add
```css
.eyebrow { font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
.chips--end { margin-inline-start: auto; justify-content: flex-end; }
.dialog { position: relative; }
.dialog__close { position: absolute; top: var(--space-3); right: var(--space-3); }
```
Keep `.section-heading` as-is.

**New tests:** `src/components/ui.test.tsx` (new file) — render `SectionHeading` (title + eyebrow
visible), `TagGroup` (renders given tags, respects `max`, renders nothing when empty), `PageHeader`
(eyebrow + title), and `Dialog` (renders children, Escape calls `onClose`, the close button is
labeled `Close <label>`). Use `@testing-library/react` + `userEvent` like existing tests.

**Verify:** `npx tsc --noEmit` && `npm test`.

---

## Task 2 — Adopt `PageHeader` everywhere + standardize eyebrow copy

Replace each view's inline `<header className="view-section"><div className="muted">…</div><h1>…</h1></header>`
with `<PageHeader eyebrow=… title=… />`. Standardize the eyebrow to one orienting voice and fix the
two flagged strings:

- `HomeView.tsx` → `<PageHeader eyebrow="Your personal audio library" title="Home" />`.
- `LibraryView.tsx` → when `query` is empty: `eyebrow="All creators and audio"`; **when `query` is
  non-empty:** `eyebrow="Search results"` (stale-eyebrow fix). title `"Library"`.
- `DiscoveryView.tsx` → `eyebrow="Tag and history powered"` → keep but soften to
  `"Suggestions from your library"`; title `"Discover"`.
- `RenameView.tsx` → **de-jargon**: `eyebrow="Tidy up your file names — changes are reversible"`;
  title `"Rename tool"`.
- `SettingsView.tsx` → first-run `eyebrow="Welcome to AudioShelf"` title `"Choose your audio library"`;
  else `eyebrow="Library preferences"` title `"Settings"` (PageHeader, not the current bespoke header).
- `AuthorDetailView.tsx` does not use a page header (it has a back button + hero) — leave its header
  as-is, but see Task 8.

Also convert HomeView's two inline `.section-heading` blocks and Discovery's `<h2>` section titles to
`<SectionHeading>` (Task 4 covers Discovery ordering). Fix HomeView's "You May Like" eyebrow so it is
**not** shown in the zero-history case (Task 7 handles the empty logic; here just route it through
`SectionHeading eyebrow=…`).

Update any view test that asserted on the old header DOM (search tests for `"Previewed, conflict-aware"`
and the Settings welcome copy — update strings to match).

**Verify:** `npx tsc --noEmit` && `npm test`.

---

## Task 3 — Global visual fixes

All in CSS + tiny view tweaks. Each is small and precise:

**3a. Responsive card grid** (`layout.css`): change `.card-grid` from
`repeat(auto-fit, minmax(220px, 1fr))` to `repeat(auto-fill, minmax(180px, 1fr))` so it reflows to
more columns at wide widths.

**3b. Settings card max-width** (`layout.css` or `components.css`): constrain the settings cards —
add `.settings-root { max-width: 640px; }` (confirm the SettingsView wrapper class name; if it's not
`.settings-root`, add a `settings` class to the wrapping element and target that).

**3c. Artwork corner clip** (`components.css`): ensure artwork is clipped to its radius —
`.artwork { overflow: hidden; }` (and confirm `.work-card__art`/`.creator-avatar` inherit a radius;
add `border-radius: var(--radius-md)` to `.work-artwork` and `border-radius: 50%` to `.creator-avatar`
if not already present). This removes the white corner pixel.

**3d. Progress-bar contrast** (`tokens.css` + `components.css`): add token
`--color-accent-muted: rgb(33 139 255 / 55%);` and ensure `.progress` track uses a visible color
(`background: var(--color-surface-hover)`) and `.progress__value` uses `--color-accent`. The
continue-card progress must read as a bar, not a divider.

**3e. Card eyebrow variants** (`WorkCard.tsx` + CSS): the `reason` slot shows two data axes
("Mostly unplayed" = progress, "Shares cozy" = affinity) in identical accent styling. Add an optional
prop `reasonTone?: "progress" | "affinity"` (default `"affinity"`) → class
`work-card__reason--progress` / `--affinity`. CSS: progress tone uses `--color-text-muted`, affinity
tone uses `--color-accent`. Callers: Home recommendations pass `reasonTone="progress"` for
"Mostly unplayed"; Discovery passes `"affinity"`.

**3f. Rename status pill differentiation** (`RenameView.tsx` + CSS): give the actionable
`badge-ok` ("rename") a leading check/▶ and full accent. Since there is no `info`/`arrow` icon, use
the existing `check` icon inside the badge, or simply make `.badge-ok { background: var(--color-accent);
color: #fff; }` so it pops vs the muted `.badge-noop`. Prefer the color change (lowest risk).

**3g. Status-filter label** (`SortFilterBar.tsx`): rename the option text `"Has unplayed"` →
`"Has unlistened chapters"` (value `"unplayed"` unchanged). Update the SortFilterBar test asserting
that option text.

**Verify:** `npx tsc --noEmit` && `npm test`.

---

## Task 4 — Discovery: reorder + pill-toggle filter

**File:** `src/views/DiscoveryView.tsx`.

**4a. Reorder** so "Pick a tag" (the primary nav control) is **above** "For You".

**4b. Replace the native checkboxes** (`<label className="chip"><input type="checkbox">…`) with
pill-toggle buttons:
```tsx
{props.allTags.map((tag) => {
  const on = props.picked.includes(tag);
  return (
    <button
      key={tag}
      type="button"
      className={`chip chip--toggle${on ? " chip--on" : ""}`}
      aria-pressed={on}
      onClick={() => toggleTag(tag)}
    >{tag}</button>
  );
})}
```
CSS (`components.css`): `.chip--toggle { cursor: pointer; }` and
`.chip--on { background: var(--color-accent); color: #fff; }`.

**4c. Update `DiscoveryView.test.tsx`:** the old tests query
`getByRole("checkbox", { name: "Filter by tag cozy" })`. Change to
`getByRole("button", { name: "cozy", pressed: false })` and assert `aria-pressed` toggles. (There
are ~4 inline render calls; update each.)

**4d.** Use `SectionHeading` for the "Pick a tag" and "For You" titles (carry over from Task 2). Soften
the empty "For You" copy ("Personalized picks — needs listening history" instead of
"Nothing to suggest yet" when `forYou` is empty but the tag browser has content).

**Verify:** `npx tsc --noEmit` && `npm test`.

---

## Task 5 — One `WorkCard` (converge the Search results card)

**File:** `src/views/LibraryView.tsx` (`SearchResultsPanel`). Replace the bespoke
`<button className="card work-card">…` work result with the shared `<WorkCard>` (passing
`workId,title,authorId,authorName` and `onOpenAuthor`). Give chapter result rows a leading
`<Icon name="play">` affordance (Task 6 wires the actual play). Keep the existing results data shape;
only the rendering converges.

Update `LibraryView.test.tsx` if it asserts on the old search-card DOM.

**Verify:** `npx tsc --noEmit` && `npm test`.

---

## Task 6 — Core loop: "Play next chapter" from any work card

The biggest UX win. WorkCards in Home recommendations, Discovery (`forYou`/`byTags`), and Search work
results currently only offer "View creator". Add a **primary Play action** that plays the work's next
unplayed chapter, demoting "View creator" to a secondary link.

**6a. App.tsx helper** (FE-only, reuses existing commands):
```ts
async function playNextChapterOfWork(workId: number, authorId: number) {
  const detail = await getAuthorDetail(authorId);
  const work = detail.works.find((w) => w.id === workId);
  if (!work) return;
  const next = work.chapters.find((c) => !c.played) ?? work.chapters[0];
  if (!next) return;
  const total = work.chapters.length;
  const played = work.chapters.filter((c) => c.played).length;
  playChapter({
    chapter: next, authorId: detail.id, authorName: detail.name,
    workId: work.id, workTitle: work.baseTitle,
    workTotalChapters: total, workPlayedChapters: played,
  });
}
```
(Confirm `PlaybackContext` field names against `src/lib/api.ts` — `workTotalChapters`/
`workPlayedChapters`/`baseTitle` — and adjust if the live shape differs. If `playChapter` is async,
await it.)

**6b. WorkCard play slot** (`WorkCard.tsx`): add optional `onPlay?: () => void`. When present, render
a primary `<Button variant="primary">▶ Play</Button>` (or `<IconButton icon="play" label="Play next chapter">`
+ label) as the first action, and render the existing `actionLabel`/`onAction` ("View creator") as a
`Button variant="ghost"` secondary. When `onPlay` is absent, behavior is unchanged (keeps the featured
"Keep listening" card and any other callers working).

**6c. Wire callers:**
- `HomeView.tsx` recommendations: pass `onPlay={() => onPlayNextOfWork(rec.workId, rec.authorId)}` and
  keep `onOpenAuthor`. Add an `onPlayNextOfWork` prop to `HomeView` (App passes
  `playNextChapterOfWork`). Keep the featured Keep-listening card's existing direct play.
- `DiscoveryView.tsx` cards: add `onPlayNextOfWork` prop; pass `onPlay` per card.
- `LibraryView.tsx` search chapter rows: wire the play icon to play that specific chapter (it already
  has the chapter via results) — if the search result lacks full `ChapterRow`/work context, fall back
  to `playNextChapterOfWork(workId, authorId)`; otherwise build the context inline. Confirm the search
  result shape in `api.ts` and choose; if only ids are present, use the helper.

Update `HomeView.test.tsx`/`DiscoveryView.test.tsx` `baseProps`/inline props to include the new
optional callback (defaulted `vi.fn()`), and add one test asserting Play triggers the callback.

**Verify:** `npx tsc --noEmit` && `npm test`.

---

## Task 7 — First-run / empty Home

**File:** `HomeView.tsx`. Today the empty state only triggers when keepListening, recommendations,
**and** recent are all absent; recommendations (catalog-derived) otherwise show with the false eyebrow
"Based on your library and listening".

- Define `noHistory = !home.keepListening && home.stats.recent.length === 0 && home.stats.chaptersFinished === 0`.
- When `noHistory`: render a centered first-run `EmptyState` — title "Welcome to AudioShelf", a
  one-line mental model ("Your library is organized by creator → work → chapter. Pick something to
  start — it plays one chapter, then stops."), and a primary action **"Choose your library / Go to
  Settings"** (`action={<Button variant="primary" onClick={onOpenSettings}>…</Button>}`) plus a
  secondary "Browse library". **Suppress the "You May Like" grid** in this state (recommendations with
  zero history read as false personalization). Add an `onOpenSettings` prop to HomeView (App passes
  `openSettings` — confirm the handler name; if Settings is opened via `setRoute({kind:"settings",
  firstRun:false})`, pass a small `openSettings` closure from App).
- When there IS history but no in-progress work, keep showing recommendations but give the section a
  neutral eyebrow ("From your library") via `SectionHeading` rather than "Based on your library and
  listening".

Update `HomeView.test.tsx`: the empty-state test should assert the welcome + that "You May Like" is
NOT rendered; the populated test stays green.

**Verify:** `npx tsc --noEmit` && `npm test`.

---

## Task 8 — Isolate author-detail editing (use the new `Dialog`) + fixes

**File:** `AuthorDetailView.tsx`. The chapter row renders play + played-toggle + title +
(redundant) `CreatorIdentity` + an always-visible `ChapterGroupingForm` + `ChapterTags` editor — the
worst collision in the app.

- **Default chapter row = browse-only:** play button, played checkbox, title + duration, a tags
  summary (read-only `TagGroup` of the chapter's tags), and a single `<Menu>` (icon `more`) per
  chapter with items **"Edit grouping"** and **"Edit tags"**. Remove the redundant per-row
  `CreatorIdentity` (the author is in the hero).
- **Editing happens in a `Dialog`:** selecting "Edit grouping" / "Edit tags" opens the new `<Dialog>`
  containing the existing `ChapterGroupingForm` / `ChapterTags` (`TagEditor`) for that chapter. Keep
  the existing `onSetGrouping`/`onClearGrouping`/`onSetChapterTags` handlers; just relocate the forms
  into the dialog. Track which chapter+mode is open in local component state.
- **Work-level tags:** keep the work `TagEditor` visible under the work heading (it's not the
  collision source) but wrap its pills via `TagGroup` for consistency.
- **Toolbar:** add a left-aligned `Works ({detail.works.length})` label to the `.work-controls toolbar`
  so the Sort/Collapse controls have a clear scope.
- **TagEditor datalist id collision** (`TagEditor.tsx`): the hardcoded `id="all-tags"` /
  `list="all-tags"` collides when multiple editors mount. Make the id unique per instance:
  `const listId = useId();` (React 18) and use it for both `list=` and `<datalist id=`.

Update `AuthorDetailView.test.tsx` (≈10 inline renders): the grouping/tags forms are now behind the
menu/dialog — update tests to open the menu → click "Edit grouping"/"Edit tags" → assert the dialog
form, then save. Keep assertions on play/played-toggle as-is. This is the most test-churn task; budget
for it.

**Verify:** `npx tsc --noEmit` && `npm test`.

---

## Task 9 — Now Playing clarity + balance

**File:** `src/player/NowPlayingPanel.tsx` (and a touch of `PlayerBar.tsx`).

- **Reuse the new `Dialog`** for the Now Playing modal: replace the bespoke `.now-playing` close
  button (top-left, first child) with the `Dialog` primitive (close now top-right). Keep the
  `.now-playing__layout` grid as the dialog's children. Preserve `role="dialog"`/`aria-modal`/label
  (Dialog supplies them). Re-run the NowPlayingPanel tests; the close button is now labeled
  "Close Now playing" — update the test query if it asserted the old label.
- **Chapter-at-a-time clarity:** the panel has `context.chapter.chapterNo` and
  `context.workTotalChapters`. Render **"Chapter {chapterNo} of {workTotalChapters}"**, and below the
  controls a muted note: if `chapterNo >= workTotalChapters` → **"Last chapter — playback stops at the
  end."** else → **"Plays this chapter, then stops."** Add a tappable **work title** that calls
  `onOpenAuthor(context.authorId)` (link back to the work/creator). These fill the empty lower third.
- **PlayerBar.tsx:** add the same "Chapter X of Y" inline near the title (compact), and group the
  utility cluster (`volume · sleep · expand`) visually from the transport+seek (CSS gap/divider on
  `.player-bar__utility`). All transport `IconButton`s already carry `label` (→ `title` tooltip); no
  change needed there.

Update `NowPlayingPanel.test.tsx`/`PlayerBar.test.tsx` `props()` if needed (likely add nothing — data
already present). Add a test asserting "Chapter 1 of N" and the stop note render.

**Verify:** `npx tsc --noEmit` && `npm test`.

---

## Task 10 — Tooltip / focus polish (cheap, global)

- **Sidebar nav** (`AppShell.tsx`): the nav `<button className="sidebar__item">` currently sets
  `title` only when collapsed. Set `title={item.label}` **always** (harmless when expanded; helps the
  collapsed/expanded transition and any truncation).
- **Focus visibility** (`base.css`/`components.css`): ensure a visible focus ring globally —
  `:focus-visible { outline: none; box-shadow: var(--focus-ring); }` applied to `.button`,
  `.icon-button`, `.chip--toggle`, `.sidebar__item`, inputs, and `[role="menuitem"]` if not already.
  Confirm `--focus-ring` exists (it does).
- Audit that every `IconButton` usage passes a meaningful `label` (grep `IconButton` — the digest
  shows transport/expand/close/collapse already do).

**Verify:** `npx tsc --noEmit` && `npm test`.

---

## Task 11 — Apply `TagGroup` uniformly

Replace the inline `.chips`/`.chip` pill rows with `<TagGroup>` in: `LibraryView` author rows
(`align="end"`, `max={2}`), `WorkCard` (its tags slot), and `AuthorDetailView` read-only tag summaries.
Leave editable tag inputs (`TagEditor`) as-is. This is mechanical; ensure no visual regression (same
`.chip` styling).

**Verify:** `npx tsc --noEmit` && `npm test`.

---

## Task 12 — Harness: extend the `m12` walkthrough for the new states

**File:** `src/harness/walkthroughs.ts` + the App `m12` wiring.

The existing 13 `m12` steps still apply (the screens changed but the routes didn't). Add coverage for
the new interactions so before/after diffs capture them and regressions are caught:
- In the `author-detail` step (or a new `author-detail-edit` step), open a chapter's `more` menu and
  the **grouping `Dialog`** (set the local open-state via the harness, mirroring how
  `showContextMenu` drives `forcedOpen`). If wiring dialog state through the harness is heavy, at
  minimum keep `author-detail` showing the new browse-only row (the collision fix is visible without
  opening the dialog).
- Ensure `home-empty` now shows the **first-run welcome** (it should, given Task 7 + the
  `reset_play_history` already called in that step). Ensure `home` still shows recommendations with a
  **Play** action.
- Keep step names stable so baseline diffing aligns.

If you add a step, update `runner.test.ts` (it asserts `m12Steps` order) and the `m12Steps` nav type.

**Verify:** `npx tsc --noEmit` && `npm test`.

---

## Task 13 — Full gates + before/after screenshot verification + regression

1. Gates:
   ```
   npx tsc --noEmit
   npm test
   cmd /c "tools\dev-env.cmd cargo test -v minimal --manifest-path src-tauri\Cargo.toml"   # regression: 47 green, no Rust changed
   ```
2. Build + capture AFTER shots and the regression walkthroughs:
   ```
   npm run build
   powershell -ExecutionPolicy Bypass -File tools\verify.ps1 -Walkthrough m12
   # then, reusing the build, the existing walkthroughs:
   powershell -ExecutionPolicy Bypass -File tools\verify.ps1 -Walkthrough home -SkipBuild
   powershell -ExecutionPolicy Bypass -File tools\verify.ps1 -Walkthrough browse -SkipBuild
   powershell -ExecutionPolicy Bypass -File tools\verify.ps1 -Walkthrough player -SkipBuild
   powershell -ExecutionPolicy Bypass -File tools\verify.ps1 -Walkthrough discovery -SkipBuild
   powershell -ExecutionPolicy Bypass -File tools\verify.ps1 -Walkthrough rename -SkipBuild
   powershell -ExecutionPolicy Bypass -File tools\verify.ps1 -Walkthrough settings -SkipBuild
   powershell -ExecutionPolicy Bypass -File tools\verify.ps1 -Walkthrough tags -SkipBuild
   ```
3. **Screenshot verification happens in a Sonnet subagent** (do NOT load PNGs into the controller).
   Dispatch a subagent to Read `.shots-before\m12\*` vs `.shots\m12\*` pairwise and the regression
   shots, returning a **text verdict** against these acceptance criteria, plus the paths it viewed:
   - **Eyebrows** consistent across views; Rename no longer says "conflict-aware"; Library eyebrow
     reads "Search results" when searching.
   - **Home empty** = a real first-run welcome (no "You May Like" grid, no false eyebrow); **Home
     populated** shows a **Play** action on cards (not only "View creator").
   - **Discovery**: "Pick a tag" is now **above** "For You"; tags are **pill-toggles** (no native
     checkboxes).
   - **Author detail**: chapter rows are browse-only (no inline grouping/tag collision); editing opens
     in a **dialog**; toolbar shows "Works (N)".
   - **Now Playing**: close button **top-right**; shows "Chapter X of Y" + a stop note; no empty lower
     third.
   - **Visual**: card grid reflows wider; artwork corners clipped (no white pixel); progress bar
     visible; rename "rename" pill stands out.
   - **Regression**: browse/player/rename/settings/tags render correctly (dark theme intact, no broken
     layout). Pixel diffs will show CHANGED broadly (expected for a consistency pass) — judge by the
     criteria, not by diff magnitude.
4. Address any FAIL the subagent reports, then re-run the relevant capture.

**Only if the user explicitly asks to see a shot** do you Read a PNG into the session (use the paths
the subagent reported).

---

## Definition of done

- `npx tsc --noEmit` clean; `npm test` green (≥21 files; new `ui.test.tsx` added; updated view tests
  green); `cargo test` 47 green (no Rust touched).
- New primitives (`PageHeader`/`SectionHeading`/`TagGroup`/`Dialog`) exist and are adopted across
  views; the raw inline header/section/pill duplication is gone.
- Core loop: a **Play** action plays a work's next unplayed chapter from Home/Discovery/Search; the
  empty Home is a real first-run welcome; author-detail editing is isolated in a dialog; Now Playing
  shows chapter position + stop note with a top-right close; Discovery filter is pill-toggles above
  "For You".
- `git status`: **no `Cargo.lock`/`db.rs`/fixture/`fixture_scan.rs` change**; no committed screenshots.
- Before/after subagent verdict PASS on the criteria; existing walkthroughs unregressed.

## PR

- Branch `m13-ui-consistency`; commit as `yovanmc <yovanmc@users.noreply.github.com>` with trailer
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` (no Codex trailer).
- Open PR; FOREGROUND `gh pr checks <PR#> --watch` (sleep ~20s first); merge from main
  `--merge --delete-branch`; sync main.
- **Update `ROADMAP.md` via a docs PR** (AudioShelf rule — never direct-to-main): flip M13 to
  ✅ Merged with the PR # + a one-line summary; append a decision-log entry (FE-only consistency pass,
  shared primitives, play-from-card via `getAuthorDetail`, editing-in-dialog, no Rust/schema change).

## Notes / gotchas for the implementer

- **Keep new component props optional with defaults** — `AuthorDetailView`/`DiscoveryView`/
  `LibraryView`/`WorkCard` tests build props inline; a new *required* prop breaks every render call.
- The overflow control is already an `<IconButton icon="more">` (not raw text) — the visible-`...`
  finding is really a **contrast/size** matter; the Task 10 focus/visibility + ensuring `Menu` is
  always present on cards covers it. Don't chase a non-existent raw-text node.
- The frontend-only-change debug-rebuild cache gotcha applies: if a screenshot run looks stale after
  FE-only edits, force a relink `cmd /c "tools\dev-env.cmd cargo clean -p audioshelf"` and re-run.
- `playChapter`/`getAuthorDetail` field names: verify against `src/lib/api.ts` before writing Task 6
  (the digest lists `baseTitle`, `workTotalChapters`, `workPlayedChapters` — STOP and report if the
  live shape differs).
- If Task 8's test churn or the overall PR size becomes unwieldy, split at the Task 7/8 boundary into
  two PRs (both still flip M13 only when the whole milestone lands).
