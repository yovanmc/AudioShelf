# M28 — Visual Consistency II (VIS7-1…10)

> **Written for Sonnet execution. If something doesn't match what this plan describes (a selector/line moved, a value differs, a file isn't where it says) — STOP and report rather than guess.** This is a FE-only CSS/visual-polish milestone; precision matters more than speed.

## Context

AudioShelf — Windows desktop app (Tauri 2 + React 18 + TypeScript + SQLite). Repo root: `C:\Agent Projects\AudioShelf`. Dark-first M12 design system; **v7 "Discovery & Curation Coherence"** arc.

M28 is the **visual-consistency capstone of v7** — a systematic pass over the findings labelled **VIS7-1 … VIS7-10** in the [v7 backlog](../specs/2026-06-14-audioshelf-v7-discovery-curation-backlog.md). The dominant finding (flagged H by the visual lens): **after M25, ~16 structural borders still use the near-invisible weak `--color-border`** (dark `#26364a`) instead of one that reads. M25 already proved this on the creator-header divider — *"on the dark theme a `var(--color-border)` separator is near-invisible — use `--color-border-strong`."* M28 turns that one-off lesson into a **systemic border-strength rule** and cleans up the remaining secondary-text / chip / dialog / card / icon / avatar / expanded-player inconsistencies.

### The VIS7 findings (this milestone's full scope)

| ID | Sev | Finding | Task |
|----|-----|---------|------|
| VIS7-1 | H | Search input border uses near-invisible `--color-border` on dark | T2 |
| VIS7-2 | H | Data-table row dividers use weak `--color-border` — tables lose scannability | T2 |
| VIS7-10 | H | 12+ dividers still weak after M25; need a **border-strength context rule** | T1+T2 |
| VIS7-3 | M | Secondary-text opacity inconsistent (40–61%) across views | T3 |
| VIS7-4 | M | Icon/glyph sizing incoherent at grid scale (54% artwork glyph vs 20px button icons) | T7 |
| VIS7-5 | M | Chip-row gaps stutter (6px vs 8px) across saved-search/filter/default chips | T4 |
| VIS7-7 | M | `.dialog__context` too small relative to title; needs breathing room | T5 |
| VIS7-9 | M | Card hover-lift too subtle on dense grids | T6 |
| VIS7-6 | L | Author-avatar initials low-contrast on small badges | T8 |
| VIS7-8 | L | Expanded-player two-column gap excessive at mid widths | T9 |

### Invariants (HARD GATES — assert before PR)

- **FE-only.** `git diff --stat main -- src-tauri Cargo.toml Cargo.lock package.json package-lock.json src-tauri/capabilities` MUST be **EMPTY**. No Rust, no schema, no capability, no dependency change.
- Schema stays `db::LATEST = 10` (untouched — we don't open db.rs).
- **No new dependency.** **Read-only-on-disk** (no new `std::fs` writes — there is no Rust change at all).
- Fixtures **43/44/47** (`fixture_scan.rs` untouched).
- Dark-first M12 token system preserved; **every token change is applied in ALL THREE theme blocks** (`:root` dark, `[data-theme="light"]`, `[data-theme="high-contrast"]`).

### Key files (verified at plan time)

- Tokens: `src/styles/tokens.css` — 3 theme blocks: `:root` (dark), `[data-theme="light"]`, `[data-theme="high-contrast"]`.
- `src/styles/base.css` — global element styles (form inputs at line ~22, `.muted` ~29).
- `src/styles/layout.css` — sidebar, search, lists, player-bar.
- `src/styles/components.css` — cards, chips, tables, dialog, palette, tabs, settings, now-playing, speed controls.
- Primitives: `src/components/ui.tsx` — `Card`, `Dialog`, `TagGroup`/chips, `SectionHeading`.
- Harness: `src/harness/walkthroughs.ts` (step defs + names list), `src/harness/runner.ts`, nav handlers in `src/App.tsx` (`settle()`, `imagesSettled()`).
- Verify: `tools/verify.ps1 -Walkthrough <name> [-SkipBuild]`.

### Current token values (tokens.css — verified)

| Token | dark `:root` | light | high-contrast |
|-------|-----|-----|-----|
| `--color-border` | `#26364a` | `#d3dde9` | `#ffffff` |
| `--color-border-strong` | `#36506d` | `#aebfd2` | `#ffffff` |
| `--color-text-muted` | `#9baabd` | `#56657a` | `#e6e6e6` |

There is **no** `--color-text-secondary` token — the single secondary tier is `--color-text-muted`. There is **no** `--color-divider` yet (T1 creates it).

---

## The border-strength rule (the design decision behind T1/T2)

VIS7-10 asks for a *"border-strength context rule,"* not a blind global swap. The rule:

> **Structural borders that must read as structure** — dividers, table rows, list rows, section separators, the resting border of cards/inputs/controls/overlays — use a new semantic token **`--color-divider`**. The raw **`--color-border`** is demoted to a reserved low-emphasis hairline (rarely used). **`--color-border-strong`** stays the explicit "emphasis" border (e.g. the work-card *hover* border).

`--color-divider` is defined **per theme** so each gets the right weight:
- **dark** → `var(--color-border-strong)` (the weak one is invisible here — this is the whole bug).
- **light** → `var(--color-border)` (the light weak border `#d3dde9` already reads; strong would be too heavy).
- **high-contrast** → `var(--color-border-strong)` (max contrast).

This is genuinely a *context* rule: the same semantic intent renders at the correct strength on every theme, and future code picks `--color-divider` for separators without re-deciding.

---

## Tasks

Execute serially with `superpowers:subagent-driven-development` (fresh Sonnet sub-implementer per task; controller reviews committed diff). Do **not** pause between tasks. After each task: `npx tsc --noEmit` must stay clean and `npm test` must stay green (no test should change behaviour from a CSS edit — if a test breaks, STOP).

### T1 — Token foundation (additive; no visual change yet)

**File:** `src/styles/tokens.css`. In **each** of the three theme blocks, add the new semantic tokens next to the existing border tokens. Add the documenting comment once, above the dark block's additions.

In `:root` (dark):
```css
/* Border-strength rule (M28/VIS7-10): structural separators, table rows,
   input/control/card resting borders use --color-divider (reads on every theme).
   --color-border is a reserved low-emphasis hairline; --color-border-strong is
   the explicit emphasis border (e.g. card hover). */
--color-divider: var(--color-border-strong);
--shadow-card-hover: 0 8px 24px rgb(0 0 0 / 45%);
--icon-sm: 16px;
--icon-md: 20px;
--icon-lg: 24px;
--chip-gap: 8px;
```
In `[data-theme="light"]`:
```css
--color-divider: var(--color-border);
--shadow-card-hover: 0 8px 24px rgb(15 23 42 / 18%);
```
In `[data-theme="high-contrast"]`:
```css
--color-divider: var(--color-border-strong);
--shadow-card-hover: 0 8px 24px rgb(0 0 0 / 60%);
```
(`--icon-sm/md/lg` and `--chip-gap` are theme-independent — define them once in `:root` only; do NOT duplicate in light/HC.)

**Verify the existing `--shadow-card` value first** (`grep -n "shadow-card" src/styles/tokens.css`) so `--shadow-card-hover` is a believable "lifted" version per theme; if the existing shadow differs materially from the assumed values above, scale the hover shadow proportionally and note it. **Expected:** tsc clean, all tests green, app renders identically (tokens defined but unused so far).

### T2 — Apply the border-strength rule (VIS7-1, VIS7-2, VIS7-10)

Replace `var(--color-border)` → `var(--color-divider)` at **exactly** these structural usages (verified line numbers; confirm the selector text matches before editing each):

**`src/styles/base.css`**
- L23 `input, select, textarea` → `border: 1px solid var(--color-divider);` (VIS7-1 native inputs)

**`src/styles/layout.css`**
- L4 `.sidebar` `border-inline-end`
- L29 `.sidebar__search` `border` (VIS7-1 main search)
- L35 `.sidebar__kbd` `border`
- L47 `.recent-row, .list-row` `border-bottom`
- L51 `.player-bar` `border-top`

**`src/styles/components.css`**
- L10 `.button--secondary` `border-color`
- L17 `.card` `border`
- L83 `.data-table th, .data-table td` `border-bottom` (VIS7-2)
- L95 `.player-bar__utility` `border-inline-start`
- L131 `.tab` `border`
- L135 `.palette` `border`
- L136 `.palette__input` `border-bottom`
- L158 `.bulk-bar` `border`
- L177 `.collection-row` `border`
- L211 `.settings-group__label` `border-bottom`
- L242 `.now-playing__list-row + .now-playing__list-row` `border-top`
- L260 `.speed-btn` `border: 1px solid var(--color-divider, #333);` (keep the `#333` fallback)
- L263 `.speed-seg__btn` `border: 1px solid var(--color-divider, #333);` (keep fallback)

Also update the `.sidebar__search:hover` rule (layout.css ~L31): its `border-color: var(--color-border-strong, var(--color-border))` is now redundant with the resting `--color-divider` on dark — leave it (still correct on light, where resting=weak and hover=strong is the intended emphasis). Do not change it.

**Do NOT touch** `--color-border-strong` direct usages (e.g. `.work-card:hover` border-color) — those are the emphasis tier, correct as-is.

**After editing, verify completeness:**
```
grep -rn "var(--color-border)" src/styles
```
The only remaining hits should be: (a) inside `tokens.css` (the `--color-divider` light-theme definition references it — expected), and (b) any *deliberate* decorative hairline you consciously left (there should be none from the list above). If a structural separator outside the list above still uses weak `--color-border`, flip it too and note it. **Expected:** every divider/table/input/card/control border now reads on dark; light theme weight unchanged.

### T3 — Secondary-text hierarchy (VIS7-3)

The inconsistency is ad-hoc `opacity` used to dim text instead of the `--color-text-muted` token. Audit and unify to **one** secondary tier.
```
grep -rn "opacity" src/styles
```
For every rule where `opacity` is used to **dim text** (a text element / label / sub-line — NOT a true fade/transition, NOT an overlay/scrim, NOT a disabled-state affordance, NOT the M25 artwork-placeholder glyph opacity), replace the `opacity: <x>` with `color: var(--color-text-muted)` and remove the opacity. Leave opacity where it's a genuine layering/animation effect. List each rule you changed vs. deliberately kept in the commit message.

Also confirm `.muted` (base.css ~L29) is `color: var(--color-text-muted)` (no opacity). **Expected:** all secondary text resolves to the single `--color-text-muted` tier; no view dims text by a one-off opacity. tsc/tests green.

### T4 — Chip spacing rhythm (VIS7-5)

```
grep -rn "\.chip\|chips\|chip-row\|gap:" src/styles | grep -i chip
```
Find every chip-row container that sets a gap (`.chips` is `gap: 6px` at components.css ~L51; saved-search / filter / facet chip rows may use 8px). Standardize **all** chip-row gaps to `var(--chip-gap)` (8px, from T1). Do not change non-chip flex gaps. **Expected:** uniform 8px rhythm across default/filter/saved-search/facet chip rows.

### T5 — Dialog context sizing (VIS7-7)

**File:** `src/styles/components.css`, the `.dialog__*` block (~L87–91).
- `.dialog__context`: change `font-size: 0.85rem` → `font-size: 0.9rem`; change `margin: 4px 0 0` → `margin: 8px 0 0`; ensure `color: var(--color-text-muted)` (add if absent).
- `.dialog__header`: change `margin: 0 0 4px` → `margin: 0 0 6px` for slightly more breathing room above the body.

Confirm the `Dialog` primitive in `src/components/ui.tsx` (~L69–113) still renders `.dialog__title` + `.dialog__context` unchanged — **CSS-only change, do not touch the component.** **Expected:** dialog context reads as a clear, comfortable subtitle under the title.

### T6 — Card hover (VIS7-9)

**File:** `src/styles/components.css`. Strengthen the card-grid hover so it registers on dense grids:
- `.work-card:hover` (~L21–26): change `transform: translateY(-3px)` → `translateY(-4px)`; add `box-shadow: var(--shadow-card-hover);` (keep existing `border-color: var(--color-border-strong)` and `background-color: var(--color-surface-raised)`); add a `transition` on `.work-card` for `transform/box-shadow/border-color/background-color` (~150ms ease) if one isn't already present.
- Apply the same hover treatment to any **other** hoverable card surfaces that currently lift only subtly — grep for `:hover` near `card`/`creator-card`/`collection-row`/`stat-card` and bring them to the same `--shadow-card-hover` + `translateY(-4px)` where they already lift. Do **not** add hover-lift to surfaces that currently have none (out of scope). **Expected:** clear, consistent hover affordance; no layout shift (transform only).

### T7 — Icon/glyph size coherence (VIS7-4)

Normalize **button/inline UI icon** sizes to the T1 scale (`--icon-sm/md/lg`). 
```
grep -rn "width:\s*[0-9]\+px\|height:\s*[0-9]\+px\|font-size" src/styles | grep -i "icon\|glyph\|svg"
```
Map the ad-hoc icon sizes to the nearest scale step (16/20/24) and replace with the token. **Leave the M25 artwork cover-placeholder music glyph alone** — it is intentionally a percentage of the tile (`size>=64` slots) so it scales with the cover; add a one-line CSS comment noting it is intentionally exempt from the icon scale. **If normalizing an icon size visibly breaks alignment in a component, STOP and report rather than forcing it.** **Expected:** UI button/inline icons resolve to a 3-step scale; artwork glyph documented as exempt.

### T8 — Avatar initials contrast (VIS7-6)

Find the small author-avatar / swatch initials rule (grep `swatch`, `avatar`, `initials` in `src/styles` and the `Swatch`/avatar component in `src/components`). On the **small** badge sizes the initials read low-contrast against the colored swatch. Raise contrast by ensuring the initials are solid `#fff` (or `--color-on-accent` if such a token exists) at a heavier weight (`font-weight: 700`) and, if still weak on light swatches, add a subtle `text-shadow: 0 1px 2px rgb(0 0 0 / 35%)`. Apply only to the initials text, only on the small sizes. **Expected:** initials legible on small avatars across themes.

### T9 — Expanded-player two-column gap (VIS7-8)

Find the M25 expanded-player two-column grid (grep `now-playing`, `expanded`, `grid-template-columns` in components.css). The column gap is excessive at mid widths. Replace a fixed large gap with a responsive `clamp(...)` (e.g. `gap: clamp(var(--space-4), 3vw, var(--space-6))` — match to the existing space scale; confirm `--space-*` values first). **Expected:** the two columns sit comfortably at mid widths without a cavernous gap; no change to the single-column/narrow layout.

### T10 — `m28` walkthrough

**File:** `src/harness/walkthroughs.ts`.
1. Add `"m28"` to the walkthrough **names** list (the array at ~L51).
2. Add an `m28Steps(nav)` factory mirroring the `m25Steps` shape:
```ts
export function m28Steps(nav: {
  showSearchAndSidebar: () => Promise<void>;
  showDataTable: () => Promise<void>;
  showDialogContext: () => Promise<void>;
  showChipRow: () => Promise<void>;
  showCardGrid: () => Promise<void>;
  showExpandedPlayer: () => Promise<void>;
}): Step[] {
  return [
    { name: "01-search-sidebar-borders", run: nav.showSearchAndSidebar },
    { name: "02-data-table-dividers", run: nav.showDataTable },
    { name: "03-dialog-context", run: nav.showDialogContext },
    { name: "04-chip-row-rhythm", run: nav.showChipRow },
    { name: "05-card-grid", run: nav.showCardGrid },
    { name: "06-expanded-player", run: nav.showExpandedPlayer },
  ];
}
```
3. Wire the six nav handlers in `src/App.tsx` following the existing `m25`/`m27` handler patterns (navigate to the relevant view → set any needed state → `await settle()` → `await imagesSettled()` where covers render). Reuse existing routes:
   - `showSearchAndSidebar`: library view, focus/show the sidebar search (the borders are the subject).
   - `showDataTable`: Rename view (`.data-table`).
   - `showDialogContext`: open any dialog that has a title+context (e.g. the chapter-journal dialog or now-playing) so `.dialog__context` is visible.
   - `showChipRow`: a view with a chip row (Discover labelled picker or author detail tags).
   - `showCardGrid`: a work-card grid (resting card border definition; hover isn't statically capturable — capture the resting state, verify hover by source).
   - `showExpandedPlayer`: expand the player to the two-column layout.
4. Add the `m28` case to the runner's walkthrough→steps mapping wherever `m25`/`m27` are mapped (search `m25Steps(` to find the dispatch site). Keep exported step **names** stable.

**Gate:** `npm test` — `runner.test.ts` must stay green (it enumerates the names list). tsc clean.

### T11 — Verify (controller-driven)

> 🔴 **Frozen-build rule (M27 lesson):** the `cargo tauri build --debug` EXE **embeds** the frontend. After ALL FE edits: run `npm run build` **THEN** `cargo tauri build --debug` before `verify.ps1 -SkipBuild` — or run `verify.ps1` WITHOUT `-SkipBuild`. `npm run build` alone does NOT update the running binary. Do not run `cargo test`/`tauri dev` between the frozen build and the capture (recreates a dev-mode "localhost refused" exe). `getCurrentWindow().setSize()` is not permitted — **scroll** for tall captures, never resize.

1. `npm run build` → `cargo tauri build --debug` (FOREGROUND, large timeout, via `cmd //c "tools\dev-env.cmd ..."` for cargo).
2. Capture: `tools\verify.ps1 -Walkthrough m28 -SkipBuild`, plus regression `-Walkthrough m25` and `-Walkthrough m12` (the broadest surface set).
3. Dispatch a **Sonnet subagent** to Read the `.shots/m28`, `.shots/m25`, `.shots/m12` PNGs and return a **text verdict** (PASS/FAIL + per-criterion observations + absolute paths). Acceptance criteria: search/input borders now visibly read on dark; table row dividers clearly separate rows; dialog context comfortably sized under the title; chip rows evenly spaced; card resting borders read; expanded-player columns sit comfortably; **no regression** on m25/m12 surfaces.
4. 🔴 **Border/contrast findings are exactly where a single subagent verdict is unreliable (M25 lesson).** For any border/secondary-text/glyph criterion the subagent marks borderline or FAIL, the **controller reviews that one PNG directly** before accepting/rejecting. Fix → rebuild → re-capture as needed.

### T12 — Gates + PR (controller-driven)

1. **Invariant gate:** `git diff --stat main -- src-tauri Cargo.toml Cargo.lock package.json package-lock.json src-tauri/capabilities` is **EMPTY**. If not, something non-FE crept in — STOP and fix.
2. `npx tsc --noEmit` clean · `npm test` green (≈486 baseline + any new walkthrough/regression tests; count only goes up) · `cargo test` green & **unchanged** (no Rust touched).
3. Commit per task with the repo identity (`yovanmc <yovanmc@users.noreply.github.com>`; no `-c user.email` override). If commits are Codex-generated, append `Co-authored-by: Codex <noreply@openai.com>` after a blank line (workspace AGENTS.md).
4. Push branch → open PR → sleep ~20s → FOREGROUND `gh pr checks <PR#> --watch` → merge `--merge --delete-branch` from main → sync main.
5. Update `ROADMAP.md` (flip M28 → ✅ Merged with PR #, one-line summary; append a decision-log entry with durable gotchas). Re-derive local main with `git reset --hard origin/main` before branching the docs update (M25 merge-commit gotcha).

---

## Done = 
All VIS7-1…10 addressed; border-strength rule (`--color-divider`) established and applied; FE-only invariant gate empty; tsc/npm test/cargo test green; m28 + m25 + m12 frozen-build screenshots verified (subagent text verdict + controller direct-review of border/contrast criteria); PR merged & CI green; ROADMAP updated.
