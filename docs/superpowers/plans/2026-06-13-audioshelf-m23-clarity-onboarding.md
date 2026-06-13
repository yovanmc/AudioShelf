# M23 — Clarity & Onboarding (AudioShelf v6)

> **Written for Sonnet execution. If something doesn't match what this plan describes
> (a literal string, a line number, a prop signature), STOP and report rather than guess.**
> Line numbers drift; always confirm the literal `old_string` exists (grep for it) before an
> `Edit`. The work is a copy/clarity sweep — exact strings matter more than line numbers.

## Goal

Make AudioShelf's **first five minutes** and **everyday language** make sense to a non-technical
listener. Fix the confusing doubled welcome CTA, stop showing a broken-looking zeroed stats grid on
first run, give first-run users a reassuring "what happens next", rewrite developer-grade empty
states into "explain + next action", de-jargon user-facing copy ("canonical" → "standardized",
"scoped query" → "filter", "Metadata vocabulary" → "Narrator, Language & Mood"), give every dialog a
visible title + a one-line "where this appears" context note, and add point-of-use microcopy so a
user can tell **tags** vs **metadata (narrator/language/mood)** vs **smart collections** apart.

Source: the v6 UX/UI backlog, clarity/onboarding lens
([`docs/superpowers/specs/2026-06-13-audioshelf-v6-ux-ui-backlog.md`](../specs/2026-06-13-audioshelf-v6-ux-ui-backlog.md),
findings CL-1…CL-9).

## Invariants (HARD — verify before claiming done)

- **FE-only.** `git diff --stat main -- src-tauri Cargo.toml Cargo.lock src-tauri/Cargo.toml src-tauri/Cargo.lock package.json package-lock.json` must be **EMPTY**. No Rust, no schema migration (`LATEST` stays **8**), no new dependency. (`gen/schemas/capabilities.json` must NOT change — we add no capability.)
- **Read-only-on-disk** preserved — this milestone writes nothing new to disk at all (pure copy/markup/CSS in `src/`).
- **Fixtures stay 43/44/47.** Do NOT touch `src-tauri/.../fixture_scan.rs` or fixture seeding counts.
- **Dark-first M12 design system** — reuse existing tokens/`ui.tsx` primitives; no new color tokens.
- **`cargo test` count must be unchanged** (currently green; M22 left it untouched). We run it only as a regression gate.

## Re-audit corrections (do NOT redo work that already shipped)

Before starting, internalize these — the backlog predates M22, which already resolved two items:

1. **CL-7 (replace `window.prompt` "Save search as:") is ALREADY DONE by M22** (PR #54 notes:
   "`window.prompt("Save search as:")` → inline form"). **Verify, don't rebuild:** grep
   `src/` for `window.prompt(` and `window.alert(` / `window.confirm(`. If the save-search inline
   form is present and no user-facing `window.prompt` remains, **drop CL-7 from scope** and note it.
   If any stray native modal survives, replace it with an inline `ui.tsx` input following the M22
   pattern — but this is expected to be a no-op.
2. **CL-3 nav-gating is ALREADY HANDLED.** During first run the app renders a **standalone** view
   with **no `AppShell`/sidebar at all** — see `src/App.tsx` ~line 2423:
   `const standalone = route.kind === "loading" || route.kind === "scan" || (route.kind === "settings" && route.firstRun);`
   and the `{standalone ? <div className="standalone-view">{view}</div> : <AppShell …>}` branch.
   So there are **no nav destinations to gate** during onboarding. CL-3 reduces to **reassurance
   copy** on the first-run Settings screen and the Scan screen (Task 3). **Do not** add nav-disabling
   logic — it would be dead code.
3. **CL-8 (eyebrow audit) is Low priority.** Fold the one obvious redundant eyebrow fix into Task 3
   if trivial; otherwise leave it for M25 and note it. Do not expand scope chasing eyebrows.

## Files in scope (all under `src/`)

| File | What changes |
|---|---|
| `src/components/ui.tsx` | `Dialog` primitive gains optional visible `title` + `context` header (Task 1) |
| `src/styles/components.css` | `.dialog__header` / `.dialog__title` / `.dialog__context` styles (Task 1) |
| `src/views/HomeView.tsx` | Welcome CTA (CL-1); gate stats grid on first run (CL-2) |
| `src/views/SettingsView.tsx` | First-run reassurance (CL-3); de-jargon headings (CL-5); microcopy (CL-9) |
| `src/views/ScanView.tsx` | "What happens next" reassurance (CL-3) |
| `src/views/DiscoveryView.tsx` | Context-aware empty states (CL-4) |
| `src/views/JournalView.tsx` | Empty-state rewrite (CL-4) |
| `src/views/LibraryView.tsx` | Empty-state rewrites (CL-4) |
| `src/views/InsightsView.tsx` | Empty-state rewrite (CL-4) |
| `src/components/ScopedResults.tsx` | Empty-state rewrite (CL-4) |
| `src/views/CollectionsView.tsx` | Empty-state rewrite (CL-4) |
| `src/views/RenameView.tsx` | "canonical" → "standardized" (CL-5) |
| `src/views/TagManagerView.tsx` | "canonical" → "standardized" (CL-5) |
| `src/views/AuthorDetailView.tsx` | Dialog titles/context (CL-6); tags/metadata microcopy (CL-9) |
| `src/views/ChapterJournalDialog.tsx` | Dialog title/context (CL-6) |
| `src/components/BulkTagDialog.tsx` | Dialog title/context (CL-6) |
| `src/player/NowPlayingPanel.tsx` | Dialog title/context (CL-6) — only if it uses the `Dialog` primitive (confirm first) |
| Test files | Update copy assertions that change (Task 8) |

Execute tasks **in order** — Task 1 (the `Dialog` primitive) is a dependency of Task 6.

---

## Task 1 — `Dialog` primitive: optional visible title + context (CL-6 foundation)

Today `ui.tsx`'s `Dialog` renders **no visible title** — `label` is only the `aria-label` and the
close button's `"Close {label}"`. We add an optional visible header so dialogs read clearly, while
staying backward-compatible (existing call sites that pass only `label` keep working).

**`src/components/ui.tsx`** — replace the whole `Dialog` function (currently starting
`export function Dialog({ label, onClose, className, children }: …`). New version:

```tsx
export function Dialog({ label, title, context, onClose, className, children }: { label: string; title?: ReactNode; context?: ReactNode; onClose: () => void; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useRef(`dlg-${Math.random().toString(36).slice(2)}`).current;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "Tab" && ref.current) {
        const focusable = Array.from(
          ref.current.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => !el.hasAttribute("disabled"));
        if (focusable.length === 0) { e.preventDefault(); return; }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
    };
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={`card dialog ${className ?? ""}`} role="dialog" aria-modal="true" aria-label={title ? undefined : label} aria-labelledby={title ? titleId : undefined}>
        <IconButton className="dialog__close" icon="close" label={`Close ${label}`} onClick={onClose} {...{ "data-autofocus": true }} />
        {title && (
          <div className="dialog__header">
            <h2 className="dialog__title" id={titleId}>{title}</h2>
            {context && <p className="dialog__context muted">{context}</p>}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
```

Notes:
- `Math.random()` is fine in app code (the harness ban on `Math.random()` applies to **Workflow
  scripts**, not the React app). If you prefer, use React's `useId()` instead — import it from
  `react` and replace the `titleId` line with `const titleId = useId();`. Either is acceptable;
  `useId` is the cleaner choice — **prefer `useId()`** and add it to the existing `react` import.
- Backward compatible: call sites passing only `label` render exactly as before (no header,
  `aria-label={label}`).

**`src/styles/components.css`** — add (find the existing `.dialog` block and add nearby):

```css
.dialog__header { margin: 0 0 4px; padding-right: 32px; /* clear the close button */ }
.dialog__title { margin: 0; font-size: 1.05rem; }
.dialog__context { margin: 4px 0 0; font-size: 0.85rem; }
```

> If `.dialog` already applies top padding that the absolutely-positioned close button needs, the
> `padding-right` on `.dialog__header` is enough; do not change existing `.dialog` padding. Confirm
> by screenshot in verification that the title doesn't collide with the close button.

---

## Task 2 — Home first impression: welcome CTA + zeroed stats (CL-1, CL-2)

**`src/views/HomeView.tsx`.**

**CL-1 — fix the doubled welcome CTA.** Current (around line 55):

```tsx
{props.onOpenSettings && <Button variant="primary" onClick={props.onOpenSettings}>Choose your library / Go to Settings</Button>}
<Button variant="secondary" onClick={props.onOpenLibrary}>Browse library</Button>
```

Replace the primary button text only:

```tsx
{props.onOpenSettings && <Button variant="primary" onClick={props.onOpenSettings}>Set up my library</Button>}
<Button variant="secondary" onClick={props.onOpenLibrary}>Browse library</Button>
```

(One clear action verb; the secondary stays. Leave the surrounding `EmptyState` body line as-is —
"Your library is organized by creator → work → chapter…" is good plain language.)

**CL-2 — hide the zeroed stats grid on first run.** Currently the "Your listening" section (around
lines 146-153) renders **unconditionally**, so a first-run user sees `0m / 0 / 0 days`, which reads
as broken. Gate it behind `!noHistory` and show a gentle one-liner instead of a bare screen.

Replace:

```tsx
      <section className="view-section">
        <h2>Your listening</h2>
        <div className="stats-grid">
          <StatCard label="Total time" value={formatLong(stats.totalSecs)} />
          <StatCard label="Chapters finished" value={stats.chaptersFinished} />
          <StatCard label="Current streak" value={`${stats.streakDays} day${stats.streakDays === 1 ? "" : "s"}`} />
        </div>
      </section>
```

with:

```tsx
      {!noHistory && (
        <section className="view-section">
          <h2>Your listening</h2>
          <div className="stats-grid">
            <StatCard label="Total time" value={formatLong(stats.totalSecs)} />
            <StatCard label="Chapters finished" value={stats.chaptersFinished} />
            <StatCard label="Current streak" value={`${stats.streakDays} day${stats.streakDays === 1 ? "" : "s"}`} />
          </div>
        </section>
      )}
```

(`noHistory` already exists at line 36: `!keepListening && stats.recent.length === 0 &&
stats.chaptersFinished === 0`. On first run the welcome `EmptyState` already explains what to do, so
no placeholder is needed — hiding the broken-looking grid is the fix. The "Recently listened" and
"You May Like" sections are already correctly gated by `stats.recent.length > 0` / `!noHistory`.)

---

## Task 3 — First-run reassurance copy (CL-3)

Re-audit (above): nav-gating is already handled by the `standalone` render. This task is **copy only**.

**`src/views/SettingsView.tsx`** — the first-run intro (around lines 227-232). Current:

```tsx
      {firstRun && (
        <p className="muted">
          Choose the folder that holds your audio library
          (one subfolder per author) to get started.
        </p>
      )}
```

Replace with a two-line reassurance that says **what happens next** and that **files are never
modified** (true — read-only-on-disk is a core guarantee):

```tsx
      {firstRun && (
        <>
          <p className="muted">
            Choose the folder that holds your audio library — one subfolder per creator.
            AudioShelf reads your files to build your shelf; it never moves, renames, or
            changes them.
          </p>
          <p className="muted">
            Next, we'll scan the folder and group chapters into works automatically. You can
            fine-tune anything later.
          </p>
        </>
      )}
```

> Confirm the surrounding JSX is a fragment-friendly spot (it's inside the `<main>` return). If the
> linter flags the fragment, the two `<p>` siblings can also be wrapped in a single `<div>` — either
> is fine.

**`src/views/ScanView.tsx`** — the scanning-in-progress copy (line 6). Current:

```tsx
    return <Card className="scan empty-state"><h1>Scanning library</h1><p className="muted">Reading creator folders and grouping chapters...</p></Card>;
```

Replace the `<p>` text to reassure (keep the `<h1>`):

```tsx
    return <Card className="scan empty-state"><h1>Scanning your library</h1><p className="muted">Reading your creator folders and grouping chapters into works. Your files are never changed — this just builds your shelf.</p></Card>;
```

(CL-8 fold-in, optional: leave existing eyebrows alone unless one obviously restates its title in a
view you're already editing — do not open other files for eyebrows.)

---

## Task 4 — Rewrite developer-grade empty states (CL-4)

Pattern for every empty state: **(1) plain-language explanation of why it's empty, (2) the next
action the user can take.** Confirm each literal `old_string` by grep before editing — line numbers
are from the evidence pass and may drift.

**`src/views/DiscoveryView.tsx`** — the shared `WorkList` empty state (line ~6) currently shows
"Personalized picks — needs listening history" for **all three** sections (Pick-a-tag, By-facet,
For-You), which is wrong for the tag/facet contexts. Make the empty message a prop so each context
gets the right words.

Change the `WorkList` signature + empty branch:

```tsx
function WorkList({ works, onOpenAuthor, onPlayNext, emptyTitle = "Nothing to show yet", emptyBody = "Play some audio or add tags to build recommendations." }: { works: DiscoveryWork[]; onOpenAuthor: (id: number) => void; onPlayNext?: (workId: number, authorId: number) => void; emptyTitle?: string; emptyBody?: string }) {
  if (!works.length) return <EmptyState title={emptyTitle}>{emptyBody}</EmptyState>;
```

Then pass context-specific copy at the three call sites:

- Pick-a-tag (line ~58):
  `<WorkList works={props.byTags} onOpenAuthor={props.onOpenAuthor} onPlayNext={props.onPlayNextOfWork} emptyTitle="No works with those tags" emptyBody="Nothing in your library matches the tags you picked. Try a different tag." />`
- By-facet (line ~81):
  `<WorkList works={props.byFacet} onOpenAuthor={props.onOpenAuthor} onPlayNext={props.onPlayNextOfWork} emptyTitle="No works for that pick" emptyBody="Nothing matches that narrator, language, or mood yet." />`
- For-You (line ~85):
  `<WorkList works={props.forYou} onOpenAuthor={props.onOpenAuthor} onPlayNext={props.onPlayNextOfWork} emptyTitle="Recommendations grow as you listen" emptyBody="Finish a chapter or add tags to your works, and personalized picks will appear here." />`

**`src/views/JournalView.tsx`** (line ~179). Current:

```tsx
<EmptyState title="Nothing in your journal yet">{entries.length === 0 ? "Open a chapter to add notes, bookmarks, summaries, and more." : "No entries match the current filter."}</EmptyState>
```

This one is already decent. Tighten the empty-library branch only (keep the filtered branch):

```tsx
<EmptyState title="Your journal is empty">{entries.length === 0 ? "While listening, open a chapter to jot a note, drop a bookmark, or save a takeaway — they'll collect here." : "No entries match the current filter. Clear the filter to see everything."}</EmptyState>
```

(If the test `JournalView.test.tsx` asserts the old title "Nothing in your journal yet", update it in
Task 8.)

**`src/views/LibraryView.tsx`** — two empty states.

- No search matches (line ~184). Current `title="No matches."` /
  `Try another creator, title, chapter, or tag.` → change title to plain sentence:
  `<EmptyState title="No matches for that search">Try another creator, title, chapter, or tag — or clear the search to browse everything.</EmptyState>`
- No creators after filter (line ~162). Current `title="No creators found"` /
  `No authors match the current filters.` →
  `<EmptyState title="No creators match those filters">Adjust or clear the filters above to see more of your library.</EmptyState>`

**`src/views/InsightsView.tsx`** (line ~89). Current title "No listening history yet" is fine; keep
it (it already explains + previews what appears). Only de-jargon if it contains any of the Task-5
terms (it does not). **Leave as-is** unless grep shows jargon.

**`src/components/ScopedResults.tsx`** (line ~44). Current:
`<p className="empty-note">No works match this search.</p>` →
`<p className="empty-note">No works match this filter. Try removing a condition.</p>`

**`src/views/CollectionsView.tsx`** (line ~19). Current:
`<p className="empty-note">No collections yet. Create one in Settings → Backup &amp; maintenance.</p>`
→ confirm where collections are actually created (M22 sectioned Settings; the Collections card lives
under a Settings section — grep `SettingsView.tsx` for the `<h2>Collections</h2>` card's section
header to get the correct breadcrumb). Then:
`<p className="empty-note">No collections yet. A collection is a saved filter that updates itself — create one in Settings.</p>`
(Use the precise "Settings → <section>" breadcrumb if you can confirm it; if unsure, the generic
"in Settings" is safer than a wrong path. **Do not guess the section name.**)

---

## Task 5 — Plain-language copy sweep (CL-5)

Grep first, then edit. Search `src/` (exclude `*.test.*` and comments) for each term and replace
only **user-facing** occurrences (JSX text, headings, `placeholder=`, `aria-label=` shown to users).
Do **not** rename internal variables, types, route keys, the `query.ts` DSL token names, or test
fixtures.

**`src/views/SettingsView.tsx`:**

- Line ~442 heading. `<h2>Metadata vocabulary</h2>` → `<h2>Narrator, Language &amp; Mood</h2>`.
  The helper line below (~443) "Create narrator, language, and mood values you can apply to files and
  creators." is good — keep it.
- Line ~624-627 Collections card. Current:
  ```tsx
  <h2>Collections</h2>
  <p className="muted">
    Saved smart filters — each collection runs a scoped query against your library and updates automatically.
  </p>
  ```
  →
  ```tsx
  <h2>Collections</h2>
  <p className="muted">
    A collection is a saved filter — it runs against your library and updates itself as your library changes.
  </p>
  ```
- The "New collection" form (~684-692) labels a field "Query" with placeholder
  `tag:cozy status:unplayed`. Relabel the visible label and `aria-label` from "Query" → "Filter",
  and keep the placeholder example (it teaches the syntax). I.e. `Query` text node → `Filter`,
  `aria-label="Collection query"` → `aria-label="Collection filter"`. (Leave the state variable
  `newQuery` and the backend `query` field names unchanged — internal only.)

**`src/views/RenameView.tsx`** (line ~25). `Preview canonical filenames below.` →
`Preview standardized filenames below.` (Confirm the exact surrounding sentence by grep; replace only
the word "canonical".)

**`src/views/TagManagerView.tsx`** (lines ~66, ~94). Replace user-facing "canonical":
- placeholder `canonical (blank = clear)` → `standardized name (blank = clear)`
- any visible text "canonical form automatically" → "standardized form automatically"

Then **grep the whole `src/` tree** (excluding tests + comments) for the remaining jargon to catch
stragglers and confirm none ship to users: `canonical`, `scoped query`, `scoped search` (as visible
copy — the M22 "Search tips" affordance is fine), `vocabulary`, `\bDSL\b`, `predicate`, `idempotent`,
`additive`, `schema`. For each visible hit not already covered, apply the plain-language equivalent
and note it in the completion summary. **If a term appears only in code/comments/tests, leave it.**

---

## Task 6 — Dialog titles & context (CL-6 application)

Now that Task 1 gave `Dialog` optional `title`/`context`, pass them at each call site. The `label`
prop stays (used for the close button's accessible name). Add `title` (visible heading) and a short
`context` line answering "what is this / where does it apply".

**`src/views/AuthorDetailView.tsx`:**

- Edit grouping dialog (line ~381):
  `<Dialog label="Edit grouping" title="Edit grouping" context={`Chapter ${editChapterInfo.chapter.chapterNo ?? ""} — change which work this chapter belongs to`} onClose={() => setEditState(null)}>`
  (Confirm the chapter-number field name on `editChapterInfo.chapter` by reading the nearby
  `ChapterGroupingForm` props / the `chapter` type; if `chapterNo` isn't present, use the chapter
  title instead: `context={`Reassign “${editChapterInfo.chapter.title}” to a different work`}`.)
- Edit tags dialog (line ~391):
  `<Dialog label="Edit tags" title="Edit tags & metadata" context={`Tags, narrator, language, and mood for “${editChapterInfo.chapter.title}”`} onClose={() => setEditState(null)}>`
  (This dialog holds both `TagEditor` and `MetadataEditor`, so the title says "& metadata".)
- "More like this" dialog (grep `label="More like this"` in this file): add
  `title="More like this"` and `context` naming the work it's based on (use the work title variable
  in scope at that call site — confirm it before referencing).

**`src/views/ChapterJournalDialog.tsx`** (line ~38). Current:
`<Dialog label={`Journal — ${chapter.title}`} onClose={props.onClose} className="chapter-journal-dialog">`
→ give it a visible title + context (and you can simplify `label` to a stable string since `title`
now carries the chapter name):
`<Dialog label="Chapter journal" title={`Journal — ${chapter.title}`} context="Notes, bookmarks, summary, and favorite for this chapter" onClose={props.onClose} className="chapter-journal-dialog">`
> The dialog's inner wrapper uses `padding: "40px 20px 20px"` to clear the absolutely-positioned
> close button. With the new `.dialog__header` rendering above the children, reduce that top padding
> if the header now provides the spacing — check the screenshot and adjust the inline `padding` to
> e.g. `"8px 20px 20px"` only if there's an obvious double gap. Otherwise leave it.

**`src/components/BulkTagDialog.tsx`** (grep `label="Bulk tag"`). Add
`title="Add tags to selected"` and `context={`Apply tags to ${count} selected works (existing tags are kept)`}` — confirm the
selected-count variable name in that component before referencing it; if none is in scope, use a
static `context="Tags you add here are applied to every selected work. Existing tags are kept."`.

**`src/player/NowPlayingPanel.tsx`** — **confirm first** whether it uses the shared `Dialog`
primitive (grep the file for `<Dialog`). The evidence pass listed `label="Now playing"`. If it uses
`Dialog`, add `title="Now playing"` (context optional — the panel's content is self-explanatory, so
a context line may be redundant; **skip context here** to avoid clutter). If it does **not** use the
`Dialog` primitive (it's a custom panel), **leave it untouched** and note that in the summary.

---

## Task 7 — Tags vs metadata vs collections microcopy (CL-9)

Add one-line, point-of-use microcopy so the three organizing concepts are distinguishable. Reuse the
existing `.muted` styling; keep each to a single short sentence.

**`src/views/AuthorDetailView.tsx`** — the author header (lines ~229-237) renders `TagEditor` then
`MetadataEditor` with no labels. Add a tiny labelled intro before each. Insert directly above the
`<TagEditor … />` at line ~229:

```tsx
          <p className="muted field-hint">Tags — your own free-form labels (e.g. “cozy”, “re-listen”).</p>
          <TagEditor tags={detail.tags} allTags={props.allTags} onChange={props.onSetTags} />
```

and directly above the `<MetadataEditor … />` block (inside the `props.onAddAuthorMeta && …` guard,
line ~230):

```tsx
          {props.onAddAuthorMeta && props.onRemoveAuthorMeta && (
            <>
              <p className="muted field-hint">Narrator, language &amp; mood — shared values you can browse and filter by in Discover.</p>
              <MetadataEditor
                applied={detail.metadata}
                suggestions={props.metaSuggestions ?? []}
                onAdd={(facet, value) => props.onAddAuthorMeta!(detail.id, facet, value)}
                onRemove={(termId) => props.onRemoveAuthorMeta!(detail.id, termId)}
              />
            </>
          )}
```

> The existing guard wraps a single `<MetadataEditor>`; wrap it + the new hint in a fragment as
> shown. Confirm the exact existing JSX before editing.

**`src/styles/components.css`** — add a small style so the hints sit tight above their editors:

```css
.field-hint { margin: 12px 0 4px; font-size: 0.8rem; }
```

**Collections** — the Settings Collections card description was already clarified in Task 5
("A collection is a saved filter…"), which is the point-of-use explanation. No further change needed.

---

## Task 8 — Update tests + verify

**Update copy assertions that changed.** Grep the test tree for any literal you changed and update
the expectation to the new copy. Known candidates (confirm by grep):

- `src/views/JournalView.test.tsx` — asserts `"Nothing in your journal yet"` → update to
  `"Your journal is empty"`.
- `src/views/HomeView.test.tsx` — if it asserts the welcome button text
  `"Choose your library / Go to Settings"` → update to `"Set up my library"`; if it asserts the
  stats grid renders on a no-history fixture, update to assert it's **absent** when `noHistory`.
- `src/views/SettingsView.test.tsx` — if it asserts `"Metadata vocabulary"` or the Collections
  "scoped query" copy → update to the new strings.
- `src/views/DiscoveryView.test.tsx` — if it asserts `"Personalized picks — needs listening history"`
  → update to the new context-specific empty titles.

Search broadly: `grep -rn "Choose your library\|Metadata vocabulary\|scoped query\|Personalized picks\|Nothing in your journal\|No matches\.\|canonical" src/**/*.test.*` and reconcile every hit.

**Add a regression-proof unit test** (small, optional but encouraged): in `HomeView.test.tsx`, assert
that with a no-history home payload the "Your listening" heading is **not** in the document, and with
a populated payload it **is**. This locks CL-2.

**Gates (run in order; all must pass):**

1. `npx tsc --noEmit` — clean.
2. `npm test` — all FE tests pass (count rises by any tests you added; no failures).
3. `cmd //c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml"` — **unchanged**
   green (regression only; we changed no Rust). *(Use `cmd //c` — see M22 gotcha: Git-Bash mangles
   `cmd /c`. From the PowerShell tool you can instead run `cmd /c "tools\dev-env.cmd cargo test …"`.)*
4. **Invariant diff gate:**
   `git diff --stat main -- src-tauri Cargo.toml Cargo.lock src-tauri/Cargo.toml src-tauri/Cargo.lock package.json package-lock.json gen/schemas/capabilities.json`
   must print **nothing**. If it shows changes, you broke the FE-only invariant — STOP and fix.

**Screenshot verification** (per the runbook — view PNGs in a Sonnet **subagent**, never load them
into the controller; the subagent returns a TEXT verdict + paths):

- Build the frozen exe once: run `tools\verify.ps1 -Walkthrough home` (no `-SkipBuild` — it does its
  own `cargo tauri build --debug` + fixture gen). This captures `home-empty` (first-run welcome +
  **no** stats grid) and `home` (populated).
- Then `tools\verify.ps1 -Walkthrough settings -SkipBuild` (first-run reassurance copy — confirm the
  settings walkthrough exercises `firstRun`; if it doesn't capture first-run, capture it via the
  existing first-run path or note the gap).
- Then `tools\verify.ps1 -Walkthrough m12 -SkipBuild` (15-shot regression — dialogs, empty states,
  Discover, Settings) and `tools\verify.ps1 -Walkthrough m21 -SkipBuild` (metadata editor dialog +
  Discover facets).
  > **Gotcha (M21/M22):** a plain `cargo test`/`tauri dev` re-overwrites `target/debug/audioshelf.exe`
  > in dev mode → "localhost refused to connect" screenshots. Run the Rust test gate (#3) **before**
  > the frozen build, OR re-run `verify.ps1` without `-SkipBuild` if any cargo command ran after the
  > build. Order: cargo test → `home` (builds frozen) → the `-SkipBuild` walkthroughs with no cargo
  > in between.
- Dispatch ONE Sonnet subagent to Read the produced PNGs and return a text verdict against these
  acceptance criteria:
  - **CL-1:** first-run Home shows a single clear "Set up my library" primary + "Browse library"
    secondary (no "/ Go to Settings" doubled label).
  - **CL-2:** first-run Home shows **no** "Your listening" stats grid (no `0m / 0 / 0 days`).
  - **CL-3:** first-run Settings shows the reassurance copy ("never moves, renames, or changes them"
    + "what happens next"); Scan screen shows the reassuring scan copy.
  - **CL-4:** Discover/Journal/Library empty states read as "explain + next action", not developer
    phrasing; the Discover tag/facet empties are context-specific (not "Personalized picks").
  - **CL-5:** Settings shows "Narrator, Language & Mood" (not "Metadata vocabulary"); Collections
    copy has no "scoped query"; Rename/Tag-manager show "standardized" not "canonical".
  - **CL-6:** dialogs (Edit tags & metadata, Chapter journal, Bulk tag) show a **visible title** + a
    one-line context note, with no collision against the close button.
  - **CL-9:** Author Detail shows the tags-vs-metadata one-line hints.
  - **Regression:** m12/m21 matrices otherwise unchanged (no layout breakage from the dialog header
    or the new hint lines).

Only surface a PNG to the user if they explicitly ask to see one.

---

## Definition of done

- All 9 findings addressed (CL-7 confirmed already-shipped and dropped; CL-8 folded or deferred with
  a note).
- `tsc` clean · `npm test` green (≥ prior count) · `cargo test` green & unchanged.
- Invariant diff gate empty (FE-only; no schema/dep/capability change; read-only-on-disk; fixtures
  43/44/47).
- `home` + `settings` + `m12` + `m21` walkthroughs subagent-verified PASS against a frozen
  `cargo tauri build --debug`.
- Branch pushed → PR opened → `gh pr checks <PR#> --watch` (foreground) green → merged `--merge
  --delete-branch` from main → main synced.
- `ROADMAP.md` M23 row flipped to ✅ Merged with PR # and a one-line summary; decision-log entry
  added (note the CL-7/CL-3 re-audit corrections and any jargon stragglers found).
```
