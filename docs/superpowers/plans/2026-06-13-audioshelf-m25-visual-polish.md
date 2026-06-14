# M25 — Visual Polish & Design-System Consistency (plan)

> **Written for Sonnet execution. If anything in a file does not match what this plan
> describes (line numbers drift, a selector is named differently, a struct has extra
> fields), STOP and report rather than guess.** Read the named file/region first, then
> apply the transform. This is the **capstone of v6**: it re-skins the final post-M24
> structure. It is **FE-only** — no Rust, no schema, no dependency, no capability change.

## Context & invariants (hard gates)

- **Project:** AudioShelf — Tauri 2 + React 18 + TypeScript + SQLite. Repo root: `C:\Agent Projects\AudioShelf`. Dark-first M12 design system; the app styles via `src/styles/{tokens,base,components,layout}.css` + inline styles in a few components.
- **FE-only diff gate (MUST hold):** `git diff --stat main -- src-tauri Cargo.toml Cargo.lock src-tauri/Cargo.toml src-tauri/Cargo.lock package.json package-lock.json src-tauri/gen/schemas/capabilities.json` must be **EMPTY** at the end. No Rust file changes, no schema migration (`LATEST` stays **9**), no new crate/npm dependency, no capability change.
- **Read-only-on-disk preserved:** this milestone adds **no** filesystem writes at all (pure FE styling/markup). Rename stays the sole audio-file mutation.
- **Fixtures stay 43 / 44 / 47** (`src-tauri/src/fixture_scan.rs` untouched; any new walkthrough state is seeded at runtime).
- **No new audio mutation, no behavioural/logic change to playback, scanning, or data.** This is styling, markup structure, and one new presentational primitive only. Do not alter any backend command, query, or playback handler logic.

### Owner decisions (already made — do not re-ask)

1. **VIS-1 cover-art placeholder = glyph + initials tile.** Color tile + a centered, low-opacity (~30%) music glyph *behind* the title initials. Applies to the **large** artwork slots only (see Task 2 size threshold); small inline name-swatches stay initials-only.
2. **Native `<select>` replacement = content selects only.** Build a styled `Select` primitive and replace the prominent **content** selects (player sleep ×2, Library sort + tag filter, Author Detail sorts). **Leave the Settings display/accessibility selects native** (theme / text-size / font / a11y — freshly polished in M20/M23, config-grade).

### Source of scope — the v6 backlog (VIS-1…VIS-9 + CL-8)

| ID | Sev | What | Task |
|----|-----|------|------|
| VIS-1 | High | Designed cover-art placeholders (glyph + initials tile) — highest-leverage visual change | T2 |
| VIS-2 | High | Accent-color discipline — `#218bff` does 4 jobs; reserve for interactive, move recommendation/affinity to success teal | T1 |
| VIS-3 | High/Med | Chip/pill legibility — ~16%-alpha pills read invisible; raise inactive to a legible fill, solid `--on` selected | T1 |
| VIS-4 | High/Med | Expanded-player redesign — two-column art/title (no avatar/title collision), styled controls, bookmark-row separators | T4, T5 |
| VIS-5 | Med | Heading/eyebrow consistency via `SectionHeading`; fix Discover eyebrow artifact | T9 |
| VIS-6 | Med | Replace remaining native `<select>`s (content) with the design-system control | T3, T4 |
| VIS-7 | Med | Author/creator header redesign — avatar+name+stats band → divider → tags/metadata; CTA top-right | T6 |
| VIS-8 | Med | Saved-search chip strip — single-row + "+N more" overflow, labelled distinct affordance | T7 |
| VIS-9 | Med | Rename-table polish — muted "no change", success-toned "already clean", reversibility as `Notice` not eyebrow | T8 |
| CL-8 | Low | Eyebrow audit — drop/upgrade redundant eyebrows so each adds context | T9 |

## Conventions / commands (from ROADMAP)

- **Cargo via the dev shell, FOREGROUND:** in the **Bash tool** use `cmd //c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml"` (note the **double slash** `//c` — Git-Bash MSYS rewrites a single `/c` to `C:/` and launches an interactive shell). Or use the **PowerShell tool**: `cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml"`.
- **FE gates:** `npx tsc --noEmit` · `npm test` (vitest: `vitest run`). FE test count is ~401 (across ~40 files) — expect it to rise as you add tests; never let it drop without explanation.
- **Verify (screenshots):** `tools\verify.ps1 -Walkthrough <name>`. **Frozen-build gotcha:** a plain `cargo build`/`cargo test`/`tauri dev` produces a **dev-mode exe** that loads `localhost:1420` and shows "localhost refused to connect" when launched without Vite. Only `cargo tauri build --debug` embeds the frozen `dist`. The `cargo test` gate **re-overwrites the exe in dev mode**, so: do the frozen build **after** the last `cargo test`, and run nothing that rebuilds between it and `verify.ps1 -SkipBuild`. Simplest: run `verify.ps1` for the **first** walkthrough WITHOUT `-SkipBuild` (it does its own frozen build), then the rest WITH `-SkipBuild`.
- **Commits:** repo identity `yovanmc <yovanmc@users.noreply.github.com>` (plain `git commit`, no `-c user.email=` override). Per workspace `AGENTS.md`, substantive Codex-generated commits append `Co-authored-by: Codex <noreply@openai.com>` after a blank line.
- **CI:** `build-and-test` on windows-latest. Merge `--merge --delete-branch` from main; FOREGROUND `gh pr checks <PR#> --watch`.

## Current-state anchors (from the digest — verify before editing)

- **Tokens:** `src/styles/tokens.css` — `--color-accent: #218bff`, `--color-accent-hover: #49a2ff`, `--color-accent-soft: rgb(33 139 255 / 16%)`, `--color-accent-muted`, `--focus-ring: 0 0 0 3px rgb(33 139 255 / 38%)`. Theme-specific `--color-success` (dark `#39b8a0`, light `#1f8a73`). **There are multiple theme blocks** (default dark + `[data-theme="light"]` + high-contrast from M20) — any token you add must be added to **every** block that defines `--color-accent`.
- **Chips/badges:** `src/styles/components.css` — `.chip, .badge { …border: 1px solid var(--color-border); background: var(--color-accent-soft); color: var(--color-text-muted); }`, `.chip--meta { opacity: .85; border-style: dashed; }`, `.chip--toggle { cursor: pointer; }`, `.chip--on { background: var(--color-accent); color: #fff; }`. Also `.work-card__reason--affinity { color: var(--color-accent); }`, progress gradient `linear-gradient(90deg, var(--color-accent), #66c5ff)`, `.eyebrow`, `.section-heading`, `.menu`/`.menu__popover`/`.menu__item`.
- **Cover/placeholders:** `src/components/Cover.tsx` — `Swatch` (~L5–28, inline-styled, `background: colorFor(name)`, renders `initials(name)`), `Artwork` (~L30–60, `<span className="artwork …" style={{background: colorFor(name)}}>{path ? <img/> : initials(name)}</span>`), `Cover` (~L85–142). `colorFor`, `initials`, `fileUrl` come from `src/lib/avatar` (verify path). Exports `WorkArtwork`, `CreatorAvatar`, `CreatorIdentity`.
- **Menu primitive:** `src/components/Menu.tsx` — `Menu({label, items, forcedOpen})` triggered by an `IconButton icon="more"`; has keyboard nav + outside-close. **This is a "more actions" menu, not a value-showing select** — you will build a sibling `Select` (Task 3), reusing its popover CSS + keyboard pattern.
- **ui primitives:** `src/components/ui.tsx` — `PageHeader({eyebrow, title, actions})`, `SectionHeading({eyebrow?, title, actions?})`, plus `Button`, `Dialog`, `Card`, `Notice`, `ProgressBar`, `TagGroup`, `IconButton`.
- **Expanded player:** `src/player/NowPlayingPanel.tsx` — `<Dialog>` → `.now-playing__layout` with `<WorkArtwork size={360}/>` then a column holding `<div className="muted">Now playing</div>`, an `<h1>` work-title button, `<CreatorIdentity size={44}/>` (this sits tight under the h1 — the reported overlap), chapter line; native sleep `<select>` (~L103); "In this work" `<h2 className="eyebrow muted">` (~L130).
- **Compact player:** `src/player/PlayerBar.tsx` — native sleep `<select>` (~L81).
- **Author header:** `src/views/AuthorDetailView.tsx` — imports `CreatorAvatar`, `WorkArtwork`, `SectionHeading`, `TagGroup`; native `<select>`s (~L257, ~L332 — read to learn what they control, likely work-sort).
- **Sort/filter:** `src/views/SortFilterBar.tsx` — native sort `<select>` (~L14) + tag-filter `<select>` (~L26).
- **Saved searches:** `src/views/LibraryView.tsx` ~L121–141 — `.scoped-chips` row of `chip chip--toggle` buttons + `×` delete; no wrap/overflow handling.
- **Rename table:** `src/views/RenameView.tsx` ~L20–72 — `PageHeader eyebrow="Tidy up your file names — changes are reversible"`, a `Notice` for results, `table.rename-table.data-table` with `badge badge-ok` ("rename"), `badge badge-noop` ("already clean"), `badge badge-conflict`.
- **Discover eyebrow artifact:** `src/views/DiscoveryView.tsx` ~L41 eyebrow text.
- **Icon component:** find it (likely `src/components/Icon.tsx`). M18/M24 convention = local single-`<path>` SVG glyphs (volume/list added in M24). You will register `music` + `chevron` (Task 2 / Task 3) following the existing convention exactly.
- **Harness:** `src/harness/walkthroughs.ts:51` exports `walkthroughs = [… "m12","m16","journal","insights","m19","m20","m21","m24"]`; `m12Steps` (15 shots, ~L347), `m21Steps` (5, ~L302), `m24Steps` (7, ~L327). The `nav` object's methods are implemented in the harness app driver (find where `m24Steps` nav methods like `showNowPlaying` are wired — likely `src/harness/` or `src/main.tsx`/`App.tsx` harness branch).
- `package.json` test script: `"test": "vitest run"`.

---

## Tasks (serial; one commit each)

> Style additions go in `src/styles/components.css` (component-scoped) and tokens in
> `src/styles/tokens.css`. The app uses semantic CSS classes + a few inline styles; prefer
> a class + CSS rule over new inline styles so themes/high-contrast keep working. After
> **every** task: `npx tsc --noEmit` and `npm test` must pass before you commit.

### Task 1 — Accent discipline (VIS-2) + chip legibility (VIS-3)

**Goal:** stop the accent doing 4 jobs (move recommendation/affinity to success teal), and make pills legible.

1. **Read `src/styles/tokens.css` fully.** For **every** theme block that defines `--color-accent` (default dark, `[data-theme="light"]`, and any high-contrast block), add chip tokens. Suggested values:
   - Dark block:
     ```css
     --color-chip-bg: rgb(255 255 255 / 9%);
     --color-chip-bg-hover: rgb(255 255 255 / 14%);
     --color-chip-border: rgb(255 255 255 / 16%);
     ```
   - Light block:
     ```css
     --color-chip-bg: rgb(0 0 0 / 6%);
     --color-chip-bg-hover: rgb(0 0 0 / 10%);
     --color-chip-border: rgb(0 0 0 / 14%);
     ```
   - High-contrast block: use opaque equivalents that respect its existing border/strong tokens (read what it already defines; e.g. `--color-chip-bg: var(--color-surface-raised)` + `--color-chip-border: var(--color-border-strong)`). Under `forced-colors` the OS overrides anyway — don't fight it.
2. **`src/styles/components.css` — chips.** Change the base `.chip, .badge` rule:
   - `background: var(--color-chip-bg);` (was `--color-accent-soft`)
   - `color: var(--color-text);` (was `--color-text-muted` — muted-on-faint was the invisibility cause)
   - `border: 1px solid var(--color-chip-border);`
   - Add `.chip--toggle:hover, .chip--toggle:focus-visible { background: var(--color-chip-bg-hover); }`
   - Keep `.chip--on { background: var(--color-accent); border-color: var(--color-accent); color: #fff; }` (already solid — ensure `border-color` is set so the 1px border doesn't show the chip border token over accent).
   - `.chip--meta` stays dashed but must read clearly: keep `border-style: dashed; opacity: 1;` (drop the `.85` opacity that compounded with the faint fill) and use the same `--color-chip-bg`. If meta chips need to look distinct from tag chips, give them `border-color: var(--color-accent-muted)` instead of lowering opacity.
3. **Accent discipline.** Repoint **recommendation/affinity** decoration to teal:
   - `.work-card__reason--affinity { color: var(--color-success); }` (was `--color-accent`).
   - Grep `src/styles` and `src/` for other places the accent signals *recommendation/affinity/"for you"* (not interaction): e.g. any "reason" pill, discovery affinity marker. Repoint those to `--color-success`.
   - **Leave accent for interactive only:** primary buttons, focus ring, active-nav highlight, `.chip--on`, progress fill, links, the Ctrl+K search affordance. Do **not** change those.
4. **Tests:** add/extend a small unit test asserting the chip token wiring is sane is overkill for CSS; instead add a `WorkCard` (or wherever affinity renders) test only if one already exists and asserts the class — otherwise skip (CSS-only changes are verified by screenshots in Task 12). Ensure existing tests still pass.

**Commit:** `M25: accent-color discipline + legible chips/pills (VIS-2, VIS-3)`

### Task 2 — Designed cover-art placeholder (VIS-1)

**Goal:** large artwork fallbacks become a color tile + low-opacity music glyph behind title initials. Small inline name-swatches stay initials-only (a glyph at 28px is clutter).

1. **Register a `music` Icon glyph.** Read the Icon component (find it; e.g. `src/components/Icon.tsx`) and add a `music` glyph following the **exact** existing convention (same viewBox, same stroke-vs-fill style as neighbouring glyphs — match how `volume`/`list` were added in M24). Fallback single-path data if you need it:
   - Filled style: `d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"`
   - If glyphs are stroked (`fill="none" stroke="currentColor"`): a note path like `d="M9 18V5l12-2v13"` plus two small circles, or keep the filled path inside a `<path fill="currentColor">`. **Match the existing convention** — do not introduce a new render style.
2. **Add placeholder CSS** to `components.css`:
   ```css
   .artwork { position: relative; overflow: hidden; display: inline-flex; align-items: center; justify-content: center; }
   .artwork__glyph { position: absolute; inset: 0; margin: auto; width: 52%; height: 52%; opacity: .30; color: #fff; pointer-events: none; }
   .artwork__initials { position: relative; z-index: 1; color: #fff; font-weight: 700; }
   ```
   (If `.artwork` already sets `position`/`overflow`, don't duplicate — extend.)
3. **Edit `src/components/Cover.tsx`.** Read it first.
   - In the **`Artwork`** fallback branch (when there is no `path`), instead of bare `initials(name)`, render:
     ```tsx
     {path ? (
       <img src={fileUrl(path)} alt="" />
     ) : (
       <>
         {size >= 64 && <Icon name="music" className="artwork__glyph" aria-hidden />}
         <span className="artwork__initials" style={{ fontSize: Math.round(size * 0.32) }}>{initials(name)}</span>
       </>
     )}
     ```
     Import `Icon` from the Icon component. Keep the existing `background: colorFor(name)` inline style and `aria-label`. The `size >= 64` guard means list/grid covers get the glyph; tiny avatars don't.
   - **`Swatch`** (small inline, default size 28): **leave initials-only** (no glyph). Optionally wrap its initials in `.artwork__initials` for consistency, but do **not** add the glyph at this size.
   - **`Cover`** lazy-load fallback path: ensure when it falls back it routes through the same `Artwork`/glyph rendering (it likely renders `<Swatch>` or `<Artwork>` on fail — make the **large** fallback show the glyph; if `Cover` is used at large sizes with a `<Swatch>` fallback, switch that fallback to the glyph tile for `size >= 64`).
   - **No layout shift:** glyph is absolutely positioned; tile keeps the same box. Verify `WorkArtwork`/`CreatorAvatar` (which wrap `Artwork`) still pass their size through.
4. **Tests:** if `Cover.test.tsx` exists, add an assertion that a large work artwork with no cover renders `.artwork__glyph` and a small swatch does not. If no such test file, add a minimal one.

**Commit:** `M25: designed cover-art placeholder — glyph + initials tile (VIS-1)`

### Task 3 — Styled `Select` primitive (VIS-6 foundation)

**Goal:** a value-showing dropdown that matches the dark theme, to replace content `<select>`s. Reuse the `.menu__popover` look + `Menu`'s keyboard pattern.

1. **Register a `chevron` Icon glyph** (down-chevron for the trigger) if one doesn't already exist — match Icon convention. Fallback: stroked `d="M6 9l6 6 6-6"` (if glyphs are stroked) or filled triangle `d="M7 10l5 5 5-5z"` (if filled).
2. **New file `src/components/Select.tsx`.** Generic, controlled, pure. Signature:
   ```tsx
   export interface SelectOption<T extends string | number> { value: T; label: string; }
   export function Select<T extends string | number>(props: {
     label: string;                 // accessible name (aria-label on the trigger)
     value: T;
     options: SelectOption<T>[];
     onChange: (value: T) => void;
     className?: string;
   }): JSX.Element
   ```
   Behaviour (mirror `Menu.tsx`):
   - Trigger is a `<button className="select__trigger" aria-haspopup="listbox" aria-expanded={open}>` showing the **current option's label** + `<Icon name="chevron" className="select__chevron" aria-hidden />`. `aria-label={label}` for the accessible name.
   - Popover `<span className="menu__popover select__popover" role="listbox">` with one `<button role="option" aria-selected={opt.value===value} className="select__option">` per option; selected option gets a check mark (reuse an existing `check` glyph if present, else a `✓` span) and `.select__option--on`.
   - Keyboard: ArrowUp/ArrowDown move focus through options, Home/End jump, Enter/Space select + close, Escape close + return focus to trigger. Outside-click closes (copy the `ref`/`useEffect` outside-click pattern from `Menu.tsx`).
   - Selecting calls `onChange(opt.value)` then closes and returns focus to the trigger.
3. **CSS** in `components.css`:
   ```css
   .select { position: relative; display: inline-flex; }
   .select__trigger { display: inline-flex; align-items: center; gap: 6px; min-height: 32px;
     padding: 4px 10px; border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm);
     background: var(--color-surface-raised); color: var(--color-text); cursor: pointer; }
   .select__trigger:hover { background: var(--color-surface-hover); }
   .select__trigger:focus-visible { outline: none; box-shadow: var(--focus-ring); }
   .select__chevron { width: 14px; height: 14px; opacity: .7; }
   .select__popover { min-width: 160px; }              /* inherits .menu__popover */
   .select__option { width: 100%; display: flex; align-items: center; gap: 8px; border: 0;
     border-radius: 6px; padding: 8px 10px; background: none; color: var(--color-text); text-align: start; cursor: pointer; }
   .select__option:hover, .select__option:focus { background: var(--color-surface-hover); }
   .select__option--on { color: var(--color-accent); font-weight: 600; }
   ```
   (Verify `--radius-sm`, `--color-border-strong`, `--color-surface-raised`, `--color-surface-hover`, `--shadow-overlay` exist — they're used by `.menu__popover`. If `.select__popover` should get the shadow/border, it already inherits from `.menu__popover`.)
4. **Tests:** new `Select.test.tsx` — renders current label; opening shows options; clicking an option fires `onChange` with its value; selected option has `aria-selected`/`--on`; Escape closes. Keep it focused.

**Commit:** `M25: styled Select primitive (VIS-6 foundation)`

### Task 4 — Adopt `Select` in content surfaces (VIS-6)

Replace **only** these native `<select>`s with `<Select>`. **Read each file first** and map the existing `<option>`s to `SelectOption[]`, preserving values/labels and the onChange semantics exactly.

1. **`src/views/SortFilterBar.tsx`** (~L14 sort, ~L26 tag filter) — convert both. Sort options (A–Z / Length / Played %) and the tag filter become `Select`s. The tag filter likely has an "All tags" sentinel option — preserve it (value `""` or whatever it currently uses).
2. **`src/player/NowPlayingPanel.tsx`** (~L103 sleep) — convert. Options: Off (`""`), 15, 30, 60, `chapter` ("End of chapter"). The current value is derived `props.sleepAtChapterEnd ? "chapter" : (props.sleepMinutes ?? "")` and the onChange branches on `"chapter"` vs numeric vs `""`. Keep that exact logic — only swap the widget. Use `Select<string>` with string values and parse in `onChange`.
3. **`src/player/PlayerBar.tsx`** (~L81 sleep) — same conversion as NowPlayingPanel (same option set + handler). If the two share a handler shape, keep them consistent.
4. **`src/views/AuthorDetailView.tsx`** (~L257, ~L332) — read to learn what they control (likely work-sort and/or a per-section filter). Convert to `Select`, preserving values/labels/handlers.
5. **Do NOT touch** `src/views/SettingsView.tsx` selects (theme/text-size/font/a11y) or `src/views/TagManagerView.tsx` (~L141) or any `MetadataManagerView` select — out of scope per owner decision (config-grade native is acceptable; they were polished in M20/M23). If you find a content `<select>` not listed here, **STOP and report** rather than guessing whether it's in scope.
6. **Tests:** update any test that interacted with a now-replaced `<select>` (e.g. `fireEvent.change` on a select) to drive the new `Select` (open + click option). Keep coverage equivalent.

**Commit:** `M25: replace content native selects with styled Select (VIS-6)`

### Task 5 — Expanded-player redesign (VIS-4)

**Read `src/player/NowPlayingPanel.tsx` fully first.** Goal: kill the avatar/title overlap and tidy the controls.

1. **Two-column header.** Restructure `.now-playing__layout` so the large `<WorkArtwork size={360}/>` is one column and the text column (eyebrow "Now playing" → `<h1>` work title → creator → chapter line) is the other, with clear vertical spacing so `<CreatorIdentity>` no longer collides with the `<h1>`. Add/adjust CSS:
   ```css
   .now-playing__layout { display: grid; grid-template-columns: 360px 1fr; gap: var(--space-6); align-items: start; }
   .now-playing__title { margin: 0 0 var(--space-2); }            /* breathing room under h1 */
   .now-playing__creator { margin-top: var(--space-2); }
   @media (max-width: 720px) { .now-playing__layout { grid-template-columns: 1fr; } }
   ```
   Apply the classes to the existing nodes (give the `<h1>` `className="now-playing__title"`, wrap/space the `CreatorIdentity`). Preserve the work-title button behaviour (`onOpenAuthor`) and `dir="auto"`.
2. **Styled controls.** The sleep select is now a `<Select>` (Task 4). Ensure the speed control + mute + any other transport controls in the expanded panel read as a coherent row (reuse existing button classes; don't restyle M24 logic). If there is a raw uppercase **"CAPTURE"** label (VIS-4 mentions a raw label) near the bookmark/note capture action, rename it to a sentence-case word like **"Bookmark"** / **"Add note"** matching its action — copy-only, do not change the handler.
3. **Bookmark-row separators.** If the panel lists bookmarks/notes/chapters, add subtle row separators:
   ```css
   .now-playing__list-row + .now-playing__list-row { border-top: 1px solid var(--color-border); }
   ```
   Apply the class to the existing row element (find the "In this work" chapter list rows and/or bookmark rows). Keep `aria-current` on the active chapter.
4. **Eyebrow:** the "In this work" `<h2 className="eyebrow muted">` (~L130) is fine but route it through the `SectionHeading` pattern if cheap (Task 9 handles eyebrow consistency globally — you may defer this specific one to T9).
5. **Tests:** update `NowPlayingPanel` tests for any changed DOM (the select→Select swap, renamed label). Keep behaviour assertions intact.

**Commit:** `M25: expanded-player two-column redesign + tidy controls (VIS-4)`

### Task 6 — Creator/author header redesign (VIS-7)

**Read `src/views/AuthorDetailView.tsx`** around the header (the block rendering `CreatorAvatar` + name + counts + tags/metadata + any primary CTA). Goal: a clear identity band, a divider, then tags/metadata; primary CTA top-right.

1. Structure the header as: **row 1** = `CreatorAvatar` + (name as `<h1>`, a stats line like "N works · N% played · Xh") on the left, primary action (e.g. the main "Edit"/"Play" CTA) on the **right** (reuse `PageHeader actions` or a `.creator-header__actions` slot). **row 2 (below a divider)** = tags + metadata (`TagGroup` / metadata chips).
2. CSS:
   ```css
   .creator-header { display: flex; flex-direction: column; gap: var(--space-4); }
   .creator-header__band { display: flex; align-items: center; gap: var(--space-4); }
   .creator-header__band-text { flex: 1 1 auto; min-width: 0; }
   .creator-header__name { margin: 0; }
   .creator-header__stats { color: var(--color-text-muted); font-size: .9rem; margin-top: 2px; }
   .creator-header__actions { flex: 0 0 auto; }
   .creator-header__meta { padding-top: var(--space-4); border-top: 1px solid var(--color-border); }
   ```
3. Preserve all existing data, handlers, the `.field-hint` microcopy added in M23, the work list below, and accessibility (landmark/heading order — the name stays the page `<h1>`). Do **not** alter `query_author_detail` or any data flow — markup/CSS only.
4. **Tests:** update `AuthorDetailView.test.tsx` for the new structure (keep assertions on name, counts, tags, CTA presence).

**Commit:** `M25: creator header redesign — identity band + divider + tags (VIS-7)`

### Task 7 — Saved-search chip strip overflow (VIS-8)

**Edit `src/views/LibraryView.tsx`** (~L121–141, the `.scoped-chips` saved-searches row).

1. Make it a single horizontal row that **doesn't wrap-spill**: a scrollable strip with a clear "Saved:" label. Simple, robust approach — horizontal scroll with masked overflow:
   ```css
   .saved-search-strip { display: flex; align-items: center; gap: 6px; overflow-x: auto; padding-bottom: 2px;
     scrollbar-width: thin; }
   .saved-search-strip > .muted { flex: 0 0 auto; }
   .saved-search-strip .chip { flex: 0 0 auto; }
   ```
   Replace the inline-styled `.scoped-chips` wrapper with `className="saved-search-strip"`. Keep each saved search as a `chip chip--toggle` (now legible from Task 1) with its `×` delete affordance. The delete `×` should stay; give it a class instead of inline style if convenient (`.saved-search-strip__del`).
   - **Optional "+N more"** (only if straightforward): if there are more than, say, 6 saved searches, render the first 6 then a `chip` reading "+N more" that, on click, reveals the rest (toggle local state) — but a clean horizontal-scroll strip satisfies VIS-8; do the "+N more" only if it doesn't balloon the task. If you skip it, that's fine — the scroll strip is the acceptance bar.
2. Ensure the strip is labelled and distinct from the search input above it.
3. **Tests:** update `LibraryView.test.tsx` if it asserts the old wrapper class; assert the strip renders one chip per saved search and the run/delete handlers still fire.

**Commit:** `M25: saved-search chip strip — single-row overflow (VIS-8)`

### Task 8 — Rename-table polish (VIS-9)

**Edit `src/views/RenameView.tsx`** + badge CSS in `components.css`.

1. **Eyebrow → calmer.** The `PageHeader eyebrow="Tidy up your file names — changes are reversible"` overloads the eyebrow with reassurance. Shorten the eyebrow to a plain category label (e.g. `eyebrow="Library tools"` or `"Rename"`) and keep the **reversibility reassurance in the existing intro `Notice`/blurb** (it already says renames are reversible). Don't duplicate the message.
2. **Muted "no change" rows.** Rows with `status === "noop"` should read as visually de-emphasised:
   ```css
   .rename-row.rename-noop td { color: var(--color-text-muted); }
   ```
3. **Success-toned "already clean" badge.** `badge-noop` ("already clean") → success teal; `badge-ok` ("rename") stays an action tone; `badge-conflict` stays a warning/error tone. Add/adjust:
   ```css
   .badge-noop { background: rgb(57 184 160 / 18%); color: var(--color-success); border-color: rgb(57 184 160 / 35%); }
   .badge-ok { background: var(--color-chip-bg); color: var(--color-text); }
   .badge-conflict { background: rgb(220 80 80 / 18%); color: #ff9b9b; border-color: rgb(220 80 80 / 35%); }
   ```
   (Verify against existing badge rules — extend, don't duplicate; match whatever error/warn token the app already uses for conflict if one exists, e.g. `--color-danger`.)
4. **Tests:** update `RenameView.test.tsx` if it asserts the old eyebrow string; assert the three badge labels still render for ok/noop/conflict rows.

**Commit:** `M25: rename-table polish — muted no-change, teal already-clean (VIS-9)`

### Task 9 — Eyebrow / heading consistency (VIS-5 + CL-8)

**Goal:** every section heading uses the same pattern; drop eyebrows that merely restate the title; fix the Discover eyebrow artifact.

1. **Discover artifact.** Read `src/views/DiscoveryView.tsx` ~L41 and fix the eyebrow text (the backlog flags a stray cursor/typo artifact). Make it a clean, sentence-case context line.
2. **Audit eyebrows across views** (`HomeView`, `LibraryView`, `DiscoveryView`, `JournalView`, `RenameView` (done in T8), `InsightsView`, `CollectionsView`, `ScopedResults`, `NowPlayingPanel` "In this work"). For each:
   - If the eyebrow just restates the `<h1>`/`<h2>` (e.g. eyebrow "Library" above title "Library"), **drop the eyebrow** (CL-8) — it adds noise, not context.
   - If it adds genuine context, keep it but route it through the `SectionHeading`/`PageHeader` primitive (don't inline `<div className="eyebrow muted">` where a primitive exists). Standardise tone: sentence case, short, descriptive.
   - The `.eyebrow` style (uppercase, letter-spacing) stays; only usage is normalised.
3. Keep it surgical — this is a copy/markup pass, no behaviour change. Don't invent new eyebrows.
4. **Tests:** update any test asserting a removed/changed eyebrow string.

**Commit:** `M25: eyebrow/heading consistency pass (VIS-5, CL-8)`

### Task 10 — CSS consolidation + glyph registration check

1. Re-read your `components.css` additions; remove duplication, ensure new rules live near related ones, and confirm no token is referenced that isn't defined in **all** theme blocks (grep each new `var(--color-…)` you introduced).
2. Confirm both new Icon glyphs (`music`, `chevron`, and `check` if you added one) are registered once and render in light + dark + high-contrast (they use `currentColor`, so they should).
3. `npx tsc --noEmit` + `npm test` green.

**Commit:** `M25: CSS consolidation + glyph registration`

### Task 11 — `m25` walkthrough (verification states m12 can't show)

The **before/after `m12` 15-shot matrix is the primary visual regression check** (it already covers home, library, author-detail, discovery, expanded player, rename, settings — i.e. cover placeholders, chips, expanded player, creator header, rename all appear there). Add a small `m25` walkthrough only for states m12 doesn't capture.

1. **Read `src/harness/walkthroughs.ts`** and find where `m24Steps`' `nav` methods (e.g. `showNowPlaying`, `showSpeedCycled`) are implemented (the harness app driver). Mirror that wiring.
2. Add `"m25"` to the `walkthroughs` tuple (L51) and an `m25Steps(nav)` function with these shots:
   - `01-library-sort-open` — open the styled `Select` (Library sort) so the popover shows (proves the dark-themed dropdown). If driving an open-popover state in the harness is hard, capture the resting `Select` trigger instead and **log** that the open state is source-confirmed (don't silently drop).
   - `02-saved-searches` — Library with several saved searches seeded so the overflow strip is visible.
   - `03-cover-placeholders` — a view with multiple **large** placeholder artworks (Library grid or Home) so the new glyph tiles are visible at a glance. (May overlap m12 `library` — keep it if it frames the placeholders better, else rely on m12.)
3. Wire the matching `nav` methods in the harness driver, seeding saved-searches at runtime (do **not** touch `fixture_scan.rs`; fixtures stay 43/44/47). Follow exactly how m24 seeds runtime state.
4. If `runner.test.ts` (or similar) asserts the walkthrough list, update it. `npx tsc --noEmit` + `npm test` green.

**Commit:** `M25: m25 walkthrough (styled Select, saved-search strip, placeholders)`

### Task 12 — Verify & finish

1. **Gates:**
   - `npx tsc --noEmit` — clean.
   - `npm test` — all green (count ≥ prior 401 + your new tests).
   - `cmd //c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml"` (Bash) **or** PowerShell `cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml"` — must be **green and unchanged** (146 unit + integration). FE-only → Rust count must not move.
2. **FE-only diff gate (MUST be empty):**
   `git diff --stat main -- src-tauri Cargo.toml Cargo.lock package.json package-lock.json src-tauri/gen/schemas/capabilities.json` → **no output**. If anything shows, you changed something out of scope — STOP and report.
3. **Frozen build + screenshots** (respect the dev-mode-exe gotcha):
   - Run the **first** walkthrough WITHOUT `-SkipBuild` so it builds the frozen exe: `tools\verify.ps1 -Walkthrough m12`
   - Then, **without running any `cargo test`/`tauri dev` in between**, run the rest with `-SkipBuild`: `tools\verify.ps1 -Walkthrough m21 -SkipBuild`, `-Walkthrough m24 -SkipBuild`, `-Walkthrough m25 -SkipBuild`.
   - (If unsure the exe is fresh, just run each without `-SkipBuild`.)
4. **Screenshot verdict via a Sonnet subagent — never load PNGs into the controller.** Dispatch a Sonnet subagent to Read the `.shots/m25`, `.shots/m12`, `.shots/m21`, `.shots/m24` PNGs and return a **text verdict** (PASS/FAIL per criterion + the absolute paths it viewed). Acceptance criteria to hand the subagent:
   - **VIS-1:** large cover placeholders show a low-opacity music glyph behind initials (not a flat block); small inline swatches remain initials-only.
   - **VIS-2:** recommendation/affinity text reads teal, not blue; blue is only on interactive/active elements.
   - **VIS-3:** chips/pills are clearly visible (legible fill + border); selected chip is solid accent.
   - **VIS-4:** expanded player has a two-column art/title layout with **no** avatar/title overlap; sleep control is the styled dropdown; bookmark/chapter rows have separators.
   - **VIS-5/CL-8:** headings consistent; no redundant eyebrow restating its title; Discover eyebrow clean.
   - **VIS-6:** sort/tag-filter/sleep render as the dark-themed styled `Select` (no native OS dropdown chrome on the trigger).
   - **VIS-7:** author header = identity band → divider → tags/metadata, CTA top-right.
   - **VIS-8:** saved-search strip is a single tidy row (scroll/“+N more”), not a wrapped spill.
   - **VIS-9:** rename "no change" rows muted; "already clean" badge teal.
   - **No regression** across m12/m21/m24 (uniform sub-pixel AA/font drift is not a regression).
   - **Native-dropdown caveat:** a styled `Select`'s *open popover* is in-DOM and screenshottable; a native `<select>` popup (e.g. Settings, left native by design) is OS-rendered and won't appear — that's expected, not a FAIL.
5. **Push branch → PR → CI.** Branch name e.g. `m25-visual-polish`. Open PR; `gh pr checks <PR#> --watch` FOREGROUND (sleep ~20s first to dodge "no checks reported"); on green, merge `--merge --delete-branch` from main; sync main.
6. **Update `ROADMAP.md`:** flip M25 to `✅ Merged` with the PR # and a one-line shipped summary; append a decision-log entry (what shipped, invariants held, any verification-caught findings, durable gotchas). Commit + push.
7. **Ping the user** with the Phase-B handoff (see the workflow's ping template; name the next milestone — **M26 (Power, Calm — optional)** — with the absolute ROADMAP path).

---

## Notes for the executor

- **If a `<select>` you find isn't in Task 4's list, STOP and report** — do not guess whether it's in scope. Owner decision: content selects only; Settings/Tag/Metadata-manager natives stay.
- **Don't restyle a WPF/WPF-UI…** — N/A here (this is web/React). But the analogous rule holds: don't re-template the `Menu`/`Dialog` primitives for cosmetics; extend with new classes.
- **Every state must be diffed before/after.** Scrutinise the whole frame for contrast/chrome/spacing, not just the element you changed (a chip-token change touches every chip app-wide).
- **No new dependency.** `Select` is pure React. The music/chevron glyphs are local SVG paths in the existing Icon component — no icon package.
- **Per-task discipline:** `npx tsc --noEmit` + `npm test` before each commit; one logical commit per task.
