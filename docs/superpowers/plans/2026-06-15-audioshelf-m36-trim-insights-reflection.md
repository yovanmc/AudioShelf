# M36 — Trim Insights & Reflection (deletion milestone)

> **Written for Sonnet execution. If something doesn't match this plan — a symbol is missing, a name differs, a grep finds an unexpected caller — STOP and report rather than guess.** This is a *removal* milestone; the safety rule is: delete only what this plan names, verify the KEEP boundary before each deletion, and let `cargo test` / `tsc` / `npm test` catch every dangling reference.

## Context

AudioShelf v9 ("Real-World Readiness") is being re-scoped into a **Simplification arc** — the owner audited the full feature surface (M1–M35) and chose to cut 11 peripheral features. M36 is the **first** of three stacked deletion milestones. It removes the **Insights / reflection** analytics cluster (M18 + M27 era). M37 (machinery/admin tools) and M38 (player & home) follow in later sessions.

**This milestone removes exactly three features:**
1. **Listening heatmap & trends / the "Insights" view** (M18) — 52-week heatmap, month/time-of-day/day-of-week trends, weekly rhythm, per-creator/per-tag breakdowns.
2. **Annual recap PNG export** (M18) — the "Year in Listening" SVG→canvas→PNG export.
3. **Reflection linking** (M27) — clicking a heatmap cell / rhythm week to open a filtered "Played · <range>" list, and the top-tag → Library pre-filter wiring.

### 🔴 MUST KEEP — do NOT remove (verify before deleting)
- The **journal / notes / bookmarks** feature itself (M17). Only the reflection *linking* (cross-navigation) goes.
- The **Discover "Reflections" reasons** ("Because you rated…" / "You came back to…"). These are produced by `discovery_for_you` in `commands.rs`, which reads the `works.completion_rating` and `works.re_entry_note` columns **directly** — NOT through the insights code. Those two columns, their v10 migration, and `discovery_for_you` STAY UNTOUCHED.
- `play_events`, all journal tables/columns, tags, Discover, Library, Home, Player.

### Invariants (hard gates — a violation means STOP)
- **No schema change.** Insights/recap/reflection-linking have **no dedicated tables or columns** — all derived from `play_events` + existing journal/rating columns. `db::LATEST` **stays 13**. Do **not** add a migration. Do **not** bump any `13` version assert.
- **No new dependency.** This is removal-only — `git diff --stat` of `Cargo.toml`/`Cargo.lock`/`package.json`/`package-lock.json` must be **EMPTY** (pure deletions only; if a dep becomes unused, leaving it is fine — do not touch manifests).
- **Read-only-on-disk preserved.** Removing a read+derive feature is strictly *more* read-only. No new `fs::` write paths.
- **Default fixtures `43/44/47` unchanged** — `src-tauri/src/fixture_scan.rs` and the gen-fixture are untouched.
- **Dark-first M12 design system** unchanged.

## Conventions (repeat of ROADMAP — follow exactly)
- **Build via the PowerShell tool**, not the Bash tool: `Set-Location` to the repo each call (cwd resets to `C:\Agent Zone` every call) then `& "C:\Agent Projects\AudioShelf\tools\dev-env.cmd" <cmd>`. The Bash-tool `cmd /c "tools\dev-env.cmd …"` form silently no-ops. `dev-env.cmd` prints a harmless `'vswhere.exe' is not recognized` line — MSVC linking still succeeds.
- Gates: `npx tsc --noEmit` · `npm test` · `cargo test` (via dev-env.cmd) · `tools\verify.ps1 -Walkthrough <name>` for screenshots.
- **Locate code by SYMBOL NAME, not the line numbers in this plan** — line numbers drift as deletions land. Use Grep for the fn/const/import/type names given here. After each deletion, the compiler/test run is the authoritative catch for anything missed.
- Commits: repo identity (`yovanmc <yovanmc@users.noreply.github.com>`), no `-c user.email` override. Per workspace `AGENTS.md`, substantive Codex-generated commits append `Co-authored-by: Codex <noreply@openai.com>` after a blank line.
- CI: `build-and-test` on windows-latest; merge `--merge --delete-branch` from main; FOREGROUND `gh pr checks <PR#> --watch` (sleep ~20s first).

---

## Task 1 — Backend (Rust) removal

**Goal:** delete `insights.rs` wholesale; remove the three commands and their helpers/tests from `commands.rs`; deregister them in `lib.rs`. End state: `cargo test` green with the expected lower test count, no dangling refs.

**Before deleting anything — verify the KEEP boundary:**
1. `Grep` for `insights` and `compute_insights` across `src-tauri/src/`. Confirm the ONLY callers of `crate::insights::*` are `query_insights` (the command) and the `testing` re-exports in `lib.rs`. **If `discovery_for_you` or any Discover/journal code calls into `insights.rs`, STOP and report** — the plan assumed it does not.
2. `Grep` for `completion_rating` and `re_entry_note` — confirm `discovery_for_you` reads these columns directly (it must keep working). Do not touch `discovery_for_you`, the columns, or the v10 migration.

**Then remove:**

1. **Delete the whole module file** `src-tauri/src/insights.rs` (entire file — `compute_insights`, `build_insights`, `build_recap`, all date-math helpers `civil_from_days`/`weekday_of`/`local_day`/`local_hour`/`longest_run`/etc., the `Ev`/`WorkAgg` structs, and its 6 `#[test]`s).

2. **`src-tauri/src/lib.rs`:**
   - Remove `mod insights;` (or `pub mod insights;`).
   - Remove the three registrations from `tauri::generate_handler!`: `commands::query_insights`, `commands::export_recap_png`, `commands::query_played_in_range`.
   - Remove the `insights::` re-exports from the `testing` module (`build_insights`, `civil_from_days`, `compute_insights`, `longest_run`, `weekday_of`, `Ev`, `WorkAgg`). Grep `testing` block for `insights` to find them all.

3. **`src-tauri/src/commands.rs`** — remove these fns + their structs + their tests (locate by name):
   - `query_insights` (command; delegates to `crate::insights::compute_insights`).
   - `export_recap_png` (command; writes pre-rasterized PNG bytes to disk) + its test `export_recap_png_writes_bytes`.
   - `query_played_in_range` (command) **and** its helper `played_in_range` (the `pub(crate) fn` that queries the time window) + the two tests `played_in_range_returns_only_in_window_works_deduped` and `played_in_range_returns_empty_when_no_events_in_window`.
   - The test `compute_insights_counts_rated_and_reentered_works` (it exercises `crate::insights::compute_insights`, which no longer exists). 🔴 This test only validated insights counting — the rating/re-entry logic for **Discover** lives in `discovery_for_you` and has its own coverage; deleting this test does NOT reduce Discover coverage. If, when you grep, this test instead calls `discovery_for_you`, STOP and report (rename/keep it).
   - Remove any now-unused `use` imports the compiler flags.

4. **Run** (PowerShell tool):
   ```
   Set-Location "C:\Agent Projects\AudioShelf"
   & "C:\Agent Projects\AudioShelf\tools\dev-env.cmd" cargo test
   ```
   Expect: green. The lib test count **drops by ~9** (6 in `insights.rs` + `export_recap_png_writes_bytes` + 2 `played_in_range` + `compute_insights_counts_rated_and_reentered_works` = 10, minus any miscount — let `cargo test` report the real number; a *drop* of ~9–10 is expected, not a regression). `fixture_scan` 43/44/47 still green. If the compiler flags a dangling `insights`/`query_insights`/`export_recap_png`/`query_played_in_range` reference anywhere, remove that reference (it belongs to this feature) — unless it's in Discover/journal/Library, in which case STOP.

**Commit:** `M36 Task 1: remove insights backend (heatmap/recap/played-range commands + insights.rs)`.

---

## Task 2 — Frontend (TS/React) removal

**Goal:** delete the Insights/recap/played-range views, their API wrappers + types, all App.tsx wiring, and the nav entry. End state: `npx tsc --noEmit` clean, `npm test` green at the expected lower count.

**Delete these files wholesale:**
- `src/views/InsightsView.tsx`
- `src/views/PlayedRangeView.tsx`
- `src/lib/recap.ts`
- `src/styles/insights.css`
- Test files: `src/lib/insights.test.ts`, `src/lib/recap.test.ts`, `src/views/InsightsView.test.tsx`, and `src/views/PlayedRangeView.test.tsx` **if it exists** (grep first).

**Edit `src/lib/api.ts`** — remove:
- The wrappers `queryInsights`, `exportRecapPng`, `queryPlayedInRange`.
- The TS types used only by these: `DayCell`, `PeriodSummary`, `WeekPoint`, `CreatorStat`, `InsightTagStat`, `RecapData`, `InsightsData`. 🔴 Before deleting `InsightsData` (which contains `worksRated`/`worksReEntered`), `Grep` the FE for `worksRated`, `worksReEntered`, and `InsightsData` — confirm the only consumer is the now-deleted `InsightsView`. **If Discover or any kept view reads `InsightsData`, STOP** (the Discover "Reflections" reasons are expected to come from the discovery command payload, not from `InsightsData`).

**Edit `src/App.tsx`** — remove (locate by symbol):
- Imports: `InsightsView`, `PlayedRangeView`, `buildRecapSvg` (from `./lib/recap`), and `queryInsights`/`exportRecapPng`/`queryPlayedInRange` from the `lib/api` import. Keep any other symbols on those import lines.
- State: `insights`, `insightsNow`, `recapStatus` (the `useState`s feeding InsightsView).
- The route/view-type variants `{ kind: "insights" }` and `{ kind: "played-range"; … }`.
- The effect that loads insights (calls `queryInsights`).
- The `handleExportRecap` function (rasterizes the recap SVG → PNG → `exportRecapPng`).
- The render branches `route.kind === "insights"` (renders `<InsightsView>`) and `route.kind === "played-range"` (renders `<PlayedRangeView>`).
- Any `onInsights`/`onDrillRange` callbacks passed down. If an `insights.css` import exists in App.tsx (or a styles index like `src/styles/index.css` / `main.tsx`), remove it — grep `insights.css`.

**Edit `src/components/AppShell.tsx`** — remove:
- The nav item `{ key: "insights", label: "Insights", icon: "insights", action: onInsights }` from the "My listening" nav group.
- The `onInsights` prop from the AppShell props type and its usage. Update the App.tsx call site that passed `onInsights` accordingly (remove the prop). If removing it leaves the "My listening" group with a now-unused icon registration `"insights"`, leave the icon definition (harmless) unless the compiler flags it.

**Run** (PowerShell tool):
```
Set-Location "C:\Agent Projects\AudioShelf"
& "C:\Agent Projects\AudioShelf\tools\dev-env.cmd" npx tsc --noEmit
& "C:\Agent Projects\AudioShelf\tools\dev-env.cmd" npm test
```
Expect: `tsc` clean (TS will flag any missed reference — fix by removing it, it belongs to this feature). `npm test` green; vitest count **drops by ~21** (5 insights.test + 3 recap.test + 13 InsightsView.test + any PlayedRangeView tests). A drop is expected.

**Commit:** `M36 Task 2: remove Insights/recap/played-range views, API wrappers, App+AppShell wiring`.

---

## Task 3 — Walkthroughs & runner tests

**Goal:** deregister the `insights` walkthrough and prune reflection-linking steps from `m27`. End state: `npm test` green; the harness no longer references removed surfaces.

**Edit `src/harness/walkthroughs.ts`:**
- Remove `"insights"` from the `walkthroughs` array.
- Delete the `insightsSteps` function entirely and remove it from the steps export/registry map.
- In `m27Steps`, remove the reflection-linking steps — the nav params/steps named for `showInsightsReflections`, `showPlayedRange`, and `showInsightsTagToLibrary` (the heatmap-cell / played-range / tag-to-Library drill steps). Keep the journal-centric steps. Re-number/rename the remaining step output filenames so they're contiguous (e.g. `02-…`, `03-…`) — follow the existing naming pattern in the function. Do NOT remove journal/notes/bookmark steps.

**Edit `src/harness/runner.test.ts`:**
- Delete the `describe("insightsSteps", …)` block (its ~4 tests).
- Update the `m27Steps` assertions: drop expectations for the removed steps and match the new step count/names. If there's a global list assertion that enumerates all walkthrough names, remove `"insights"` from the expected set.

**Run** (PowerShell tool):
```
Set-Location "C:\Agent Projects\AudioShelf"
& "C:\Agent Projects\AudioShelf\tools\dev-env.cmd" npm test
```
Expect green. If a `runner.test.ts` assertion still names `insights`/`played-range`/a removed m27 step, update it to match reality (the harness must reflect the trimmed surface).

**Commit:** `M36 Task 3: deregister insights walkthrough + prune reflection-linking m27 steps`.

---

## Task 4 — Verify (controller-driven, after Tasks 1–3 merged into the branch)

This is controller + one screenshot subagent, not an implementer task. **No new walkthrough is authored** — M36 is a removal, so verification is a **regression pass** proving the neighbours still render and Discover still surfaces ratings.

1. **Frozen build** (never `cargo test`/`tauri dev` between build and verify — dev-mode "localhost refused"):
   ```
   Set-Location "C:\Agent Projects\AudioShelf"
   & "C:\Agent Projects\AudioShelf\tools\dev-env.cmd" npm run build
   & "C:\Agent Projects\AudioShelf\tools\dev-env.cmd" cargo tauri build --debug --no-bundle
   ```
2. **Regression walkthroughs** with `-SkipBuild` — capture surfaces that neighbour the removed code: the **Home** page (no Insights nav item, renders cleanly), **Discover** (the "Because you rated…/You came back to…" reasons still appear — proves the KEEP boundary held), **Journal** (`journal` walkthrough — notes/bookmarks intact, no reflection-linking affordances), and the trimmed **`m27`** walkthrough. Use the existing walkthrough names; pick the ones that render these surfaces.
   ```
   tools\verify.ps1 -Walkthrough m27 -SkipBuild
   tools\verify.ps1 -Walkthrough journal -SkipBuild
   # plus whichever walkthrough renders Home + Discover (e.g. m12 / discover) -SkipBuild
   ```
3. **Screenshot verdict via a Sonnet subagent** (never load PNGs into the controller): dispatch a subagent to Read the captured PNGs and return a **text verdict** — PASS/FAIL + observations + absolute paths. Acceptance: (a) no "Insights" entry in the "My listening" nav; (b) Discover still shows rating/re-entry reasons; (c) journal notes/bookmarks unchanged; (d) no console/asset errors; (e) no orphaned heatmap/recap UI anywhere. `.shots` is gitignored → the verify.ps1 pixel-diff flags everything "CHANGED" (stale-baseline drift) — the **visual verdict is the gate**, not the pixel diff.

## Invariant audit (controller, before PR)
Run and confirm all EMPTY/unchanged:
- `git diff --stat -- src-tauri/Cargo.toml src-tauri/Cargo.lock package.json package-lock.json` → **EMPTY**.
- `Grep db::LATEST` → still **13**; no `13`→`14` assert changes anywhere.
- `Grep -ri "insights\b|query_insights|export_recap_png|query_played_in_range|PlayedRangeView|buildRecapSvg|InsightsData" src src-tauri/src` → only expected residue (e.g. a kept icon registration), **zero** live code paths. Report any hit.
- `git diff --stat -- src-tauri/src/fixture_scan.rs` → **EMPTY** (fixtures 43/44/47 untouched).
- No new `fs::` write paths added (removal-only).

## PR & merge
Push the branch → open a PR (title `M36 — Trim Insights & Reflection`) summarizing the three removed features, the KEEP boundary, the no-schema-change invariant, and the test-count deltas → `gh pr checks <PR#> --watch` (FOREGROUND, sleep ~20s first) → merge `--merge --delete-branch` from main → sync main → update `ROADMAP.md` (flip M36 to ✅ Merged with PR # + a one-line summary; append a decision-log entry; note **NEXT: plan M37 — Trim Power-User Machinery**) → ping the handoff.

## Expected end state
- Three features gone; Insights nav item gone; Discover/journal/Library/Home/Player intact.
- `cargo test` green (~9–10 fewer lib tests), `tsc` clean, `npm test` green (~21 fewer vitest), CI green.
- `db::LATEST` = 13; dep manifests untouched; read-only intact; fixtures 43/44/47 untouched.
- Screenshot subagent verdict PASS.
