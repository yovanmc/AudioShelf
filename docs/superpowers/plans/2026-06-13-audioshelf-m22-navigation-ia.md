# M22 — Navigation & IA Coherence (self-contained plan)

> **Written for Sonnet execution. If something doesn't match what you find in the code,
> STOP and report rather than guess.** This plan was authored from verbatim excerpts of the
> post-M21 build; line numbers may have drifted, so locate code by the quoted snippet, not the
> line number. Every quoted "current code" block below is real — match it before editing.

## What & why

AudioShelf accumulated 9 flat sidebar items + Settings over 21 milestones. A five-lens UX
review ([v6 backlog](../specs/2026-06-13-audioshelf-v6-ux-ui-backlog.md)) found navigation/IA
overload as the #1 problem across **all five lenses**. M22 makes the app legible at a glance:
group the sidebar, demote one-off admin tools (Rename, Import-metadata) into Settings, merge the
redundant **Narrators** route into **Discover**, section the Settings wall, and surface the two
invisible power features (Ctrl+K palette, scoped-search syntax).

This is the **foundation** of the v6 UX arc — it relocates surfaces that M23–M25 will build on.

## Invariants (HARD gate — verify before claiming done)

- **FE-only.** No Rust, no schema, no dependency. `git diff --stat main` for
  `src-tauri/**`, `Cargo.toml`, `Cargo.lock`, `package.json`, `package-lock.json` MUST be empty.
  `cargo test` must stay green and unchanged (it isn't touched, but it's still a gate).
- **Read-only-on-disk preserved** (no new filesystem writes; Rename stays the sole audio mutation).
- **Fixtures 43/44/47** unchanged (`fixture_scan.rs` untouched).
- **No feature deletion** — the Rename tool, the embedded-metadata importer, and narrator
  browsing all remain fully reachable; they just move. Narrator browsing is preserved inside
  Discover (with its chapter counts) before `NarratorsView` is deleted.
- Dark-first design system (M12) and all M20 a11y attributes/keyboard behavior preserved.

## Conventions / gates (run from repo root `C:\Agent Projects\AudioShelf`)

- Type check: `npx tsc --noEmit`
- FE tests (all): `npm test`  ·  single file: `npx vitest run src/components/AppShell.test.tsx`
- Rust tests (gate, unaffected):
  `cmd /c '"C:\Agent Projects\AudioShelf\tools\dev-env.cmd" cargo test --manifest-path "C:\Agent Projects\AudioShelf\src-tauri\Cargo.toml"'`
- Screenshot verify (FOREGROUND): `powershell -ExecutionPolicy Bypass -File ./tools/verify.ps1 -Walkthrough m12` and `… -Walkthrough m21`
- **Tauri dev-mode-exe gotcha:** a plain `cargo build`/`cargo test`/`tauri dev` builds an exe that
  loads `localhost:1420` and shows "localhost refused to connect" when launched without Vite.
  Only `npm run build` then `cargo tauri build --debug` (via `tools\dev-env.cmd`) embeds the frozen
  `dist`. The `cargo test` gate re-overwrites the exe in dev mode, so **re-do the frozen build
  before any `verify.ps1 -SkipBuild`** (or run verify without `-SkipBuild`).
- Commit each task separately, conventional style, repo's git identity
  (`yovanmc <yovanmc@users.noreply.github.com>` — never override `user.email`). Per workspace
  `AGENTS.md`, append `Co-authored-by: Codex <noreply@openai.com>` after a blank line on
  substantive commits.

## Pre-flight (do first)

1. `git switch -c m22-navigation-ia` (branch off up-to-date `main`).
2. Baseline green: `npx tsc --noEmit` && `npm test`. If red before any change, STOP and report.
3. Read these files in full once so edits land cleanly: `src/components/AppShell.tsx`,
   `src/App.tsx` (the `Route` type, `shellRoute`, the `routedView` switch, the `<AppShell …>`
   render, the `paletteOpen` state + Ctrl+K `useEffect`, the m21 walkthrough nav object),
   `src/views/DiscoveryView.tsx`, `src/views/NarratorsView.tsx`, `src/views/SettingsView.tsx`,
   `src/views/LibraryView.tsx`, `src/styles/layout.css`, `src/styles/components.css`,
   `src/components/AppShell.test.tsx`, `src/views/NarratorsView.test.tsx`,
   and (skim) `src/harness/runner.test.ts` + `src/harness/walkthroughs.ts`.

---

## Task 1 — Group the sidebar; demote admin items; reorder

**Goal:** primary nav drops to 6 items in two labelled groups — **Browse** (Home, Library,
Discover) and **My listening** (Journal, Insights, Collections). Rename, Import-tags, and
Narrators leave the primary nav (their routes still exist; they move/merge in Tasks 3–4).

**`src/components/AppShell.tsx`:**

1. `ShellRoute` type — remove `"narrators"`. Keep `"rename"` and `"metadata"` (those routes still
   exist, just not as nav items). New type:
   ```typescript
   export type ShellRoute = "home" | "library" | "discovery" | "rename" | "metadata" | "settings" | "journal" | "insights" | "collections";
   ```
2. Props — remove `onRename`, `onMetadata`, `onNarrators`. (They are no longer nav actions.)
   Leave everything else. (Task 2 adds `onOpenPalette`.)
3. Replace the flat `items` array (currently `home, library, discovery, narrators, rename,
   metadata, journal, insights, collections`) with grouped structure:
   ```typescript
   type NavItem = { key: ShellRoute; label: string; icon: IconName; action: () => void };
   const groups: Array<{ label: string; items: NavItem[] }> = [
     { label: "Browse", items: [
       { key: "home", label: "Home", icon: "home", action: onHome },
       { key: "library", label: "Library", icon: "library", action: onLibrary },
       { key: "discovery", label: "Discover", icon: "discover", action: onDiscovery },
     ] },
     { label: "My listening", items: [
       { key: "journal", label: "Journal", icon: "journal", action: onJournal },
       { key: "insights", label: "Insights", icon: "insights", action: onInsights },
       { key: "collections", label: "Collections", icon: "collections", action: onCollections },
     ] },
   ];
   ```
4. Keep `navButton(item)` exactly as-is (the `aria-current`/icon/label markup is correct).
   Replace `<nav className="sidebar__nav">{items.map(navButton)}</nav>` with grouped render:
   ```tsx
   <nav className="sidebar__nav" aria-label="Primary navigation">
     {groups.map((g) => (
       <div className="sidebar__group" key={g.label}>
         <span className="sidebar__group-label">{g.label}</span>
         {g.items.map(navButton)}
       </div>
     ))}
   </nav>
   ```
   (Leave the brand header, `.sidebar__spacer`, and the separate Settings button untouched.)

**`src/App.tsx`:**

5. `shellRoute(route)` — remove the `narrators` line; map the demoted tool routes to Settings so
   the Settings item stays highlighted while in them:
   ```typescript
   function shellRoute(route: Route): ShellRoute {
     if (route.kind === "home") return "home";
     if (route.kind === "discovery") return "discovery";
     if (route.kind === "rename") return "settings";
     if (route.kind === "metadata") return "settings";
     if (route.kind === "settings") return "settings";
     if (route.kind === "journal") return "journal";
     if (route.kind === "insights") return "insights";
     if (route.kind === "collections") return "collections";
     return "library";
   }
   ```
6. In the `<AppShell …>` render, remove the `onRename={openRename}`, `onMetadata={openMetadata}`,
   and `onNarrators={openNarrators}` props (the handlers themselves stay — Tasks 3/4 reuse
   `openRename`/`openMetadata`; `openNarrators` is removed in Task 3).

**`src/styles/layout.css`** — add group styling and hide labels when collapsed:
```css
.sidebar__group { display: flex; flex-direction: column; gap: 5px; }
.sidebar__group + .sidebar__group { margin-top: var(--space-4); }
.sidebar__group-label {
  padding: 0 11px; margin-bottom: 2px; font-size: 0.7rem; font-weight: 700;
  letter-spacing: 0.06em; text-transform: uppercase; color: var(--color-text-muted);
}
.app-shell--collapsed .sidebar__group-label { display: none; }
.app-shell--collapsed .sidebar__group + .sidebar__group { margin-top: var(--space-3); }
```

**Tests — `src/components/AppShell.test.tsx`:**

7. Remove `onRename`, `onMetadata`, `onNarrators` from the `props()` helper. Remove the two
   assertions that expect `"Rename"` and `"Import tags"` buttons (and any `"Narrators"` assertion).
   Add assertions that the group labels render and admin items don't:
   ```typescript
   expect(screen.getByText("Browse")).toBeInTheDocument();
   expect(screen.getByText("My listening")).toBeInTheDocument();
   expect(screen.queryByRole("button", { name: "Rename" })).not.toBeInTheDocument();
   expect(screen.queryByRole("button", { name: "Import tags" })).not.toBeInTheDocument();
   expect(screen.queryByRole("button", { name: "Narrators" })).not.toBeInTheDocument();
   ```

**Gate:** `npx tsc --noEmit` && `npx vitest run src/components/AppShell.test.tsx`. Commit:
`feat(nav): group sidebar into Browse / My listening; demote admin items`.

---

## Task 2 — Surface the Ctrl+K command palette

**Goal:** a visible search affordance in the sidebar with a `Ctrl+K` badge (the palette is
currently invisible).

**`src/components/AppShell.tsx`:**

1. Add prop `onOpenPalette: () => void` to the props destructure + type.
2. Render a search button as the FIRST child inside `<nav className="sidebar__nav">` (above the
   groups):
   ```tsx
   <button className="sidebar__search" aria-label="Search (Ctrl+K)" title="Search (Ctrl+K)" onClick={onOpenPalette}>
     <Icon name="search" />
     <span className="sidebar__label">Search</span>
     <kbd className="sidebar__kbd" aria-hidden="true">Ctrl K</kbd>
   </button>
   ```

**`src/App.tsx`:** pass `onOpenPalette={() => setPaletteOpen(true)}` to `<AppShell …>`.
(The existing Ctrl+K `useEffect` and `paletteOpen` state are unchanged — this just adds a
click entry point.)

**`src/styles/layout.css`** — style the search button to match nav items but stand slightly apart:
```css
.sidebar__search {
  display: flex; width: 100%; align-items: center; gap: var(--space-3);
  border: 1px solid var(--color-border); border-radius: var(--radius-sm);
  padding: 10px 11px; margin-bottom: var(--space-4); background: var(--color-surface);
  color: var(--color-text-muted); font-weight: 650; text-align: start;
}
.sidebar__search:hover { color: var(--color-text); border-color: var(--color-border-strong, var(--color-border)); }
.sidebar__kbd {
  margin-inline-start: auto; padding: 1px 6px; border: 1px solid var(--color-border);
  border-radius: 4px; font-size: 0.68rem; font-family: var(--font-sans, inherit); color: var(--color-text-muted);
}
.app-shell--collapsed .sidebar__search { justify-content: center; }
.app-shell--collapsed .sidebar__kbd { display: none; }
```

**Tests — `src/components/AppShell.test.tsx`:** add `onOpenPalette: vi.fn()` to `props()`; assert
the button exists and fires:
```typescript
const onOpenPalette = vi.fn();
render(<AppShell {...props({ onOpenPalette })}><div /></AppShell>);
fireEvent.click(screen.getByRole("button", { name: "Search (Ctrl+K)" }));
expect(onOpenPalette).toHaveBeenCalled();
```

**Gate:** `npx tsc --noEmit` && `npx vitest run src/components/AppShell.test.tsx`. Commit:
`feat(nav): surface Ctrl+K command palette with a sidebar search affordance`.

---

## Task 3 — Merge Narrators into Discover; remove the Narrators route

**Goal:** Discover becomes the single place to browse by narrator/language/mood. The standalone
Narrators route/view/nav are removed, but narrator browsing (incl. chapter counts) is preserved
inside Discover's facet section.

**`src/views/DiscoveryView.tsx`** — upgrade the facet section so it groups chips under per-facet
sub-labels and shows counts (preserving what `NarratorsView` had). Change the three option props
from `string[]` to `MetaTerm[]` (import `MetaTerm` from the same module the others use — check
`NarratorsView.tsx`'s import for the path, typically `../lib/...` or `../types`):

1. Props: replace
   ```typescript
   narratorOptions: string[]; languageOptions: string[]; moodOptions: string[];
   ```
   with
   ```typescript
   narratorTerms: MetaTerm[]; languageTerms: MetaTerm[]; moodTerms: MetaTerm[];
   ```
2. Replace the facet-picker section body (the `[["narrator", props.narratorOptions], …].flatMap`
   block) with per-facet labelled rows:
   ```tsx
   <section className="view-section">
     <SectionHeading title="By narrator, language, or mood" />
     {([["narrator", props.narratorTerms], ["language", props.languageTerms], ["mood", props.moodTerms]] as const)
       .filter(([, terms]) => terms.length > 0)
       .map(([facet, terms]) => (
         <div className="facet-row" key={facet}>
           <span className="facet-row__label">{facet[0].toUpperCase() + facet.slice(1)}</span>
           <div className="toolbar card" style={{ padding: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
             {terms.map((t) => {
               const on = props.pickedFacet?.facet === facet && props.pickedFacet?.value === t.value;
               return (
                 <button key={`${facet}:${t.value}`} type="button"
                   className={`chip chip--toggle${on ? " chip--on" : ""}`} aria-pressed={on}
                   onClick={() => props.onPickFacet(facet, t.value)}>
                   {t.value} <span className="muted">· {t.chapterCount}</span>
                 </button>
               );
             })}
           </div>
         </div>
       ))}
     {props.pickedFacet && <WorkList works={props.byFacet} onOpenAuthor={props.onOpenAuthor} onPlayNext={props.onPlayNextOfWork} />}
   </section>
   ```
   (`MetaTerm` has `.value` and `.chapterCount` — confirm against `NarratorsView.tsx` which used
   `n.value` and `n.chapterCount`. If the count field is named differently, match the real field.)

**`src/App.tsx`:**

3. Where `narratorOptions`/`languageOptions`/`moodOptions` are computed (the
   `metaTerms.filter(...).map((t) => t.value)` memos), replace with term-array memos:
   ```typescript
   const narratorTerms = useMemo(() => metaTerms.filter((t) => t.facet === "narrator"), [metaTerms]);
   const languageTerms = useMemo(() => metaTerms.filter((t) => t.facet === "language"), [metaTerms]);
   const moodTerms = useMemo(() => metaTerms.filter((t) => t.facet === "mood"), [metaTerms]);
   ```
   (If a `narratorTerms` memo already exists for the old NarratorsView, reuse/rename rather than
   duplicate.) Update the `<DiscoveryView …>` render to pass `narratorTerms`/`languageTerms`/
   `moodTerms` instead of the `*Options` props.
4. Remove the Narrators route end-to-end:
   - `Route` union: remove `| { kind: "narrators" }`.
   - Remove `openNarrators`, `selectNarrator`, and the `selectedNarrator` / `narratorWorks` state
     (and any `setSelectedNarrator`/`setNarratorWorks`). Keep `getDiscoveryByMetadata` (Discover's
     `pickFacet` still uses it).
   - Remove the `if (route.kind === "narrators") { return <NarratorsView … /> }` branch in
     `routedView`.
   - Remove the `import { NarratorsView } …` line.
5. **Repoint the m21 walkthrough** so its `narrators-browse` step still produces a meaningful shot.
   In the m21 walkthrough nav object (the `showNarratorsBrowse` callback, currently
   `await loadMetaTerms(); setRoute({ kind: "narrators" });`), change the body to open Discover and
   select a narrator facet so the merged surface is captured:
   ```typescript
   showNarratorsBrowse: async () => {
     await openDiscovery();                 // loads metaTerms + sets route discovery
     const first = metaTermsRef.current?.find((t) => t.facet === "narrator")
       ?? (await loadMetaTerms(), undefined); // ensure terms loaded
     // pick the first narrator term so the facet results render:
     const narrator = /* the first narrator MetaTerm value available in scope */;
     if (narrator) await pickFacet("narrator", narrator);
   },
   ```
   Implement this with whatever in-scope accessor the harness setup already uses to read the
   loaded `metaTerms` (the surrounding harness callbacks show the pattern — e.g. they `await
   loadMetaTerms()` then read state). **Keep the step name `"narrators-browse"` unchanged** so
   `src/harness/runner.test.ts` (which asserts the step-name array) stays green. If you cannot
   cleanly read a narrator value in that scope, STOP and report — do not fabricate one.

**Delete files:** `src/views/NarratorsView.tsx` and `src/views/NarratorsView.test.tsx`.

**Tests:** if `src/views/DiscoveryView.test.tsx` exists and references `narratorOptions`/etc., update
it to the new `*Terms` props (pass `MetaTerm[]` fixtures with `value`+`chapterCount`+`facet`). Run
`npx vitest run src/harness/runner.test.ts` and confirm m21/m12 name arrays still pass (they should,
names unchanged).

**`src/styles/components.css`** — facet-row label styling:
```css
.facet-row { margin-bottom: var(--space-3); }
.facet-row__label { display: block; margin-bottom: 4px; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--color-text-muted); }
```

**Gate:** `npx tsc --noEmit` && `npm test`. Commit:
`refactor(nav): merge Narrators browse into Discover; remove the standalone route`.

---

## Task 4 — Demote Rename + Import-metadata into Settings → "Library tools"

**Goal:** the two one-off admin tools become a "Library tools" card in Settings; their full-screen
routes still work and now return to Settings.

**`src/views/SettingsView.tsx`:**

1. Add to the props interface:
   ```typescript
   onOpenRename?: () => void;
   onOpenMetadata?: () => void;
   ```
2. Insert a new Card **immediately after the "Library folder" `<Card>`** (before the density Card):
   ```tsx
   {!firstRun && (props.onOpenRename || props.onOpenMetadata) && (
     <Card style={{ padding: 24, marginTop: 16 }}>
       <h2>Library tools</h2>
       <p className="muted">Occasional maintenance. Nothing changes your audio files unless you preview and confirm.</p>
       <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
         {props.onOpenRename && <Button variant="secondary" onClick={props.onOpenRename}>Standardize file names…</Button>}
         {props.onOpenMetadata && <Button variant="secondary" onClick={props.onOpenMetadata}>Import metadata from files…</Button>}
       </div>
     </Card>
   )}
   ```
   (Ensure `Button` is imported from `../components/ui` — it likely already is; if not, add it.)

**`src/App.tsx`:**

3. Pass `onOpenRename={openRename}` and `onOpenMetadata={openMetadata}` to `<SettingsView …>`.
4. So the tools return to Settings (their only entry point now), pass `onBack={openSettings}` to
   both the `<RenameView …>` and `<MetadataView …>` renders in `routedView` (both components
   already accept an optional `onBack`). Confirm each renders a visible back affordance when
   `onBack` is provided; if one doesn't, add a `<Button variant="ghost" onClick={onBack}>← Back to
   Settings</Button>` in that view's header (small, in keeping with `PageHeader actions`).

**Tests:** existing `SettingsView.test.tsx` assertions stay valid (they don't check these). Add a
focused test: render `SettingsView` with `onOpenRename`/`onOpenMetadata` mocks + the
non-first-run required props, assert the two buttons render and fire. (Reuse the test's existing
non-first-run props pattern.)

**Gate:** `npx tsc --noEmit` && `npm test`. Commit:
`feat(settings): move Rename + Import-metadata into a Library tools section`.

---

## Task 5 — Section the Settings page into labelled groups

**Goal:** the 8–9 section single-scroll becomes scannable via group dividers. Layout-only; no data
change. Sections keep their current order; we only insert group headers.

**`src/views/SettingsView.tsx`** — insert group-heading elements (only when `!firstRun`) just
before the relevant Cards:
- Before the "Library folder" Card: `{!firstRun && <h2 className="settings-group">Library</h2>}`
  (the Library-tools Card from Task 4 sits under this group too).
- Before the "Library density" Card: `{!firstRun && <h2 className="settings-group">Display</h2>}`
- Before the "Tag manager" Card: `{!firstRun && <h2 className="settings-group">Curation</h2>}`
  (Tag manager, Metadata vocabulary, and Collections all fall under this group, in their current
  order.)
- Before the "Backup & maintenance" Card: `{!firstRun && <h2 className="settings-group">Maintenance</h2>}`

(These are intentionally distinct from each Card's own `<h2>`. Do not reorder or move any Card —
only insert the four group headers at the boundaries above.)

**`src/styles/components.css`:**
```css
.settings-group {
  margin: var(--space-5) 0 var(--space-2); padding-bottom: 4px;
  border-bottom: 1px solid var(--color-border);
  font-size: 0.8rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--color-text-muted);
}
.settings-group:first-of-type { margin-top: var(--space-3); }
```

**Tests:** add an assertion to `SettingsView.test.tsx` (non-first-run render) that
`screen.getByText("Curation")` and `screen.getByText("Maintenance")` are present. Confirm the
first-run render does NOT show them (first-run test already renders the minimal view).

**Gate:** `npx tsc --noEmit` && `npm test`. Commit:
`feat(settings): group sections under Library / Display / Curation / Maintenance`.

---

## Task 6 — Make scoped-search discoverable; replace the native save prompt

**Goal:** the raw `Try tag:cozy …` code hint becomes a collapsible, plain-language "Search tips"
affordance (also advertising Ctrl+K), and the jarring `window.prompt("Save search as:")` becomes
an inline field.

**`src/views/LibraryView.tsx`:**

1. Add local state near the top of the component:
   ```typescript
   const [showTips, setShowTips] = useState(false);
   const [savingSearch, setSavingSearch] = useState(false);
   const [saveName, setSaveName] = useState("");
   ```
   (Ensure `useState` is imported.)
2. Replace the existing `{!searching && (<p className="muted" …>Try <code>…</code></p>)}` block with:
   ```tsx
   {!searching && (
     <div className="search-tips">
       <span className="muted" style={{ fontSize: "0.85em" }}>
         Search by name, or filter by tag, length, narrator, or play status.{" "}
         <button type="button" className="link-button" aria-expanded={showTips} onClick={() => setShowTips((v) => !v)}>
           {showTips ? "Hide tips" : "Search tips"}
         </button>
       </span>
       {showTips && (
         <ul className="search-tips__list muted">
           <li><code>tag:cozy</code> — only items tagged “cozy”</li>
           <li><code>duration:&lt;15m</code> — shorter than 15 min (also <code>&gt;</code>, and <code>m</code>/<code>h</code>)</li>
           <li><code>status:unplayed</code> — unplayed only (or <code>status:played</code>)</li>
           <li><code>narrator:Jane</code> — read by a narrator</li>
           <li>Press <kbd>Ctrl</kbd> <kbd>K</kbd> to jump to any creator, work, or chapter</li>
         </ul>
       )}
     </div>
   )}
   ```
3. Replace the "Save search" button (the `window.prompt` block) with an inline form:
   ```tsx
   {props.scoped && props.onSaveSearch && (
     savingSearch ? (
       <form className="save-search" style={{ marginLeft: 8, display: "inline-flex", gap: 6 }}
         onSubmit={(e) => { e.preventDefault(); const n = saveName.trim(); if (n) { props.onSaveSearch!(n, props.query); setSavingSearch(false); setSaveName(""); } }}>
         <input autoFocus aria-label="Name this search" placeholder="Name this search"
           value={saveName} onChange={(e) => setSaveName(e.target.value)} />
         <button type="submit" className="button button--primary">Save</button>
         <button type="button" className="button button--ghost" onClick={() => { setSavingSearch(false); setSaveName(""); }}>Cancel</button>
       </form>
     ) : (
       <button className="button button--ghost" style={{ marginLeft: 8, whiteSpace: "nowrap" }} onClick={() => setSavingSearch(true)}>Save search</button>
     )
   )}
   ```

**`src/styles/components.css`:**
```css
.search-tips__list { margin: 6px 0 0; padding-inline-start: 18px; font-size: 0.82em; line-height: 1.7; }
.search-tips__list code { font-size: 0.95em; }
.link-button { background: none; border: none; padding: 0; color: var(--color-accent); font: inherit; cursor: pointer; text-decoration: underline; }
```

**Tests — `src/views/LibraryView.test.tsx`:** add a test that the inline save works without
`window.prompt`: render with `scoped` + `onSaveSearch` mock + a query, click "Save search", type a
name into the "Name this search" field, submit, assert `onSaveSearch` called with `(name, query)`.
Add a test that the "Search tips" toggle reveals the `tag:` example. (Don't mock `window.prompt`.)

**Gate:** `npx tsc --noEmit` && `npm test`. Commit:
`feat(library): discoverable search tips + inline save-search (no native prompt)`.

---

## Task 7 — Full verification

1. **Full gate:** `npx tsc --noEmit` && `npm test` (all green) && the `cargo test` command above
   (must be green AND unchanged from `main` — FE-only milestone).
2. **Invariant check:** `git diff --stat main -- src-tauri Cargo.toml Cargo.lock package.json package-lock.json`
   must be EMPTY. If anything shows, STOP and report.
3. **Frozen build then capture** (FOREGROUND, mind the dev-mode gotcha):
   `npm run build` → `cmd /c '"…\tools\dev-env.cmd" cargo tauri build --debug …'` (use the exact
   build invocation from `WORKFLOW-execution.md`), then
   `powershell -ExecutionPolicy Bypass -File ./tools/verify.ps1 -Walkthrough m12` and
   `… -Walkthrough m21`. Expect `WALKTHROUGH OK` + PNGs under `.shots/m12` and `.shots/m21`.
4. **Screenshot verdict via a Sonnet subagent** (do NOT load PNGs into the controller). Dispatch a
   subagent to Read the new `.shots/m12/*.png` and `.shots/m21/*.png` and return a TEXT verdict
   (PASS/FAIL + observations + the paths it viewed) against these acceptance criteria:
   - Sidebar shows two labelled groups (**Browse**, **My listening**) with 3 items each; a
     **Search** affordance with a **Ctrl K** badge sits above them; **no** Rename / Import tags /
     Narrators items in the sidebar; Settings remains pinned at the bottom. Collapsed shot
     (`04-home-sidebar-collapsed`) hides group + search labels cleanly (icons centered).
   - `11-settings` (`m12`) shows the new **Library tools** card (Standardize file names… / Import
     metadata from files…) and the group dividers (**Library / Display / Curation / Maintenance**).
   - `m21` `04` (narrators step) now shows **Discover** with the per-facet labelled chips
     (Narrator/Language/Mood, counts visible) and facet results — not a separate Narrators page.
   - `m12` `06-search` shows the plain-language hint + "Search tips" toggle (no raw code-only hint).
   - No regressions: home/library/discovery/author-detail/player shots render normally; dark theme
     + spacing intact.
5. If the verdict is PASS, proceed to PR. If FAIL, fix and re-verify (re-run the frozen build first).

---

## Done = all true

- [ ] Sidebar grouped (Browse / My listening), 6 primary items, Search+Ctrl K affordance, no
      Rename/Import-tags/Narrators in nav; Settings still bottom-pinned and active while in the tools.
- [ ] Narrators route/view/tests removed; narrator browsing (with counts) lives in Discover; m21
      `narrators-browse` step repointed and green.
- [ ] Rename + Import-metadata reachable from Settings → Library tools; their back returns to Settings.
- [ ] Settings sectioned into labelled groups.
- [ ] Scoped-search tips discoverable; save-search is an inline field (no `window.prompt`).
- [ ] `tsc` clean · `npm test` green · `cargo test` green & unchanged · FE-only diff (invariant check empty).
- [ ] `m12` + `m21` walkthroughs captured against a frozen build; subagent text verdict PASS.
- [ ] ROADMAP M22 row flipped to ✅ Merged with PR # + one-line summary; decision-log entry added.

## After merge — ROADMAP update

Flip the **M22** row to `✅ Merged` with the PR link and a one-line summary; add a decision-log
entry capturing: what shipped, the FE-only/no-dep/no-schema invariant result, the Narrators→Discover
merge decision, the "Import tags actually opened the M16 importer" clarification, and any gotchas.
Then ping for the next planning session (M23 — Clarity & Onboarding).
