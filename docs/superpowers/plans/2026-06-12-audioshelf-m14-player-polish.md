# M14 — Player & Now Playing Polish — Implementation Plan

> **Written for Sonnet execution.** Every path, symbol, and snippet below was read from the live
> tree on 2026-06-12 (post-M13). If something doesn't match (a renamed symbol, a moved line, a
> different shape), **STOP and report** rather than guessing. Run each task's verify step before
> moving on.

## Scope & constraints

Three feature additions to the player, building on M13's primitives (`Dialog`, `IconButton`
tooltips). **Frontend-only — no Rust, no schema, no new deps, no `Cargo.lock` change.** `cargo test`
stays **47** (regression only). Sibling chapters come from the existing `getAuthorDetail` (the
pattern `playNextChapterOfWork` already uses) — **no new backend command**. Read-only on disk;
fixtures stay 43/44/47.

Features:
1. **Cycling time label** — clicking the player timestamp cycles elapsed → time-left-in-chapter →
   % done (Libby). Shared mode across the compact PlayerBar and the expanded Now Playing panel.
2. **Chapters-in-this-work panel** — the expanded Now Playing lists the current work's sibling
   chapters (played dot, title, chapter no), current one highlighted, one-click jump. Reuses
   `playChapter`; no per-second offset.
3. **Expanded-panel feature refresh** — integrate the above cleanly into the M13 `Dialog` layout
   (scrollable chapter list, spacing).

Gates: `npx tsc --noEmit` · `npm test` (was 141; add tests, don't let it drop) · `cargo test`
(47 regression) · before/after `player-compact` + `player-expanded` screenshots via a subagent
verdict.

Live-tree facts to rely on (verify before editing):
- `src/player/playback.ts` exports `formatTime(secs)→"m:ss"` (non-finite/neg → "0:00"),
  `clampSeek`, skip constants. **No** `formatTimeLeft`/`formatPercent` (add them).
- `PlayerBar.tsx`: `PlayerControls{isPlaying,currentTime,duration,volume,sleepMinutes,onToggle,
  onSeek,onSkip,onVolume,onSetSleep}`; `PlayerBarProps extends PlayerControls {context:
  PlaybackContext|null; onExpand; onOpenAuthor}`. Seek block (≈L53-57): left `<span>{formatTime
  (currentTime)}</span>` · `<input type=range aria-label="Seek">` · right `<span>{formatTime
  (duration)}</span>`. Exports `PlaybackButtons`.
- `NowPlayingPanel.tsx`: props `PlayerControls & {context: PlaybackContext; onClose; onOpenAuthor}`.
  Uses `<Dialog label="Now playing" onClose=…>`; right column ends with `<PlaybackButtons>`, a
  `.player-bar__seek` row, volume, sleep, and a stop-note `<p className="muted">` (≈L49). The
  chapters list slots in after the stop note (or between ProgressBar and PlaybackButtons).
- `PlaybackContext` (`src/lib/api.ts:73`): `{chapter:ChapterRow, authorId, authorName, workId,
  workTitle, workTotalChapters, workPlayedChapters}` — **no sibling-chapter array.**
  `ChapterRow{id,title,chapterNo,format,durationSecs,filePath,played,tags}`.
  `getAuthorDetail(id)→AuthorDetail{works:WorkRow{ id,baseTitle,tags,chapters:ChapterRow[] }[]}`.
- `App.tsx`: player state `current: PlaybackContext|null` (+ `currentRef`), `playerExpanded`,
  `isPlaying`, `currentTime`, `duration`, `volume`, `sleepMinutes`; `playChapter(context)` (caller
  supplies the full context); `playNextChapterOfWork(workId,authorId)` (≈L278); `<audio>` updates
  `currentTime` via `onTimeUpdate`, `duration` via `onLoadedMetadata`. Both `currentTime`/`duration`
  already flow to PlayerBar AND NowPlayingPanel. Expanded panel rendered when `current &&
  playerExpanded` (≈L805), opened via `onExpand={()=>setPlayerExpanded(true)}`.
- Tests: `PlayerBar.test.tsx` `props(overrides={})` (spreads overrides — safe to add props);
  `NowPlayingPanel.test.tsx` `props()` (NO overrides param — add one when introducing new props);
  both mock a `context` with `chapterNo:2, workTotalChapters:4`, no chapters array.
- Harness `m12Steps(nav)` includes `showPlayerCompact` (App ≈L429: plays `work.chapters[0]`, sets
  author route, `setPlayerExpanded(false)`) and `showPlayerExpanded` (`setPlayerExpanded(true)`).

---

## Task 1 — `playback.ts` helpers + tests

**File:** `src/player/playback.ts` — append:
```ts
/** Time remaining as "-m:ss" (e.g. "-1:30"); non-positive duration → "0:00". */
export function formatTimeLeft(currentTime: number, duration: number): string {
  if (!Number.isFinite(duration) || duration <= 0) return "0:00";
  const left = Math.max(0, duration - currentTime);
  return `-${formatTime(left)}`;
}

/** Whole-percent progress as "NN%"; non-positive duration → "0%". */
export function formatPercent(currentTime: number, duration: number): string {
  if (!Number.isFinite(duration) || duration <= 0) return "0%";
  const pct = Math.min(100, Math.max(0, Math.round((currentTime / duration) * 100)));
  return `${pct}%`;
}
```
(`formatTime` is already in this file — call it, don't reimplement.)

**File:** `src/player/playback.test.ts` — add a `describe` covering:
`formatTimeLeft(30,120)==="-1:30"`, `formatTimeLeft(0,120)==="-2:00"`, `formatTimeLeft(120,120)==="-0:00"`,
`formatTimeLeft(10,0)==="0:00"`; `formatPercent(30,120)==="25%"`, `formatPercent(0,120)==="0%"`,
`formatPercent(120,120)==="100%"`, `formatPercent(10,0)==="0%"`.

**Verify:** `npx tsc --noEmit` && `npm test`.

---

## Task 2 — Cycling time label (shared mode in App)

Lift the cycle mode to `App.tsx` so the compact bar and the expanded panel stay in sync.

**2a. App.tsx state + handler** (near the other player state, ≈L107-119):
```ts
type TimeLabelMode = "elapsed" | "remaining" | "percent";
const [timeLabelMode, setTimeLabelMode] = useState<TimeLabelMode>("elapsed");
const cycleTimeLabel = () =>
  setTimeLabelMode((m) => (m === "elapsed" ? "remaining" : m === "remaining" ? "percent" : "elapsed"));
```
Export the `TimeLabelMode` type (or define it in `playback.ts` and import in both PlayerBar and
NowPlayingPanel — pick one home; recommend `playback.ts` so the player components share it).

**2b. A shared label renderer** in `playback.ts`:
```ts
export type TimeLabelMode = "elapsed" | "remaining" | "percent";
export function timeLabel(mode: TimeLabelMode, currentTime: number, duration: number): string {
  if (mode === "remaining") return formatTimeLeft(currentTime, duration);
  if (mode === "percent") return formatPercent(currentTime, duration);
  return formatTime(currentTime);
}
```

**2c. PlayerBar.tsx** — add to `PlayerBarProps` (optional, defaulted): `timeLabelMode?: TimeLabelMode;
onCycleTimeLabel?: () => void;`. Replace the LEFT seek `<span>{formatTime(props.currentTime)}</span>`
with a clickable label (keep the right span as total duration):
```tsx
<button type="button" className="time-label" title="Toggle time display"
  onClick={props.onCycleTimeLabel}>
  {timeLabel(props.timeLabelMode ?? "elapsed", props.currentTime, props.duration)}
</button>
```
(If `onCycleTimeLabel` is undefined the button is inert — keeps tests that omit it working.)

**2d. NowPlayingPanel.tsx** — same: add `timeLabelMode?` + `onCycleTimeLabel?` to its props and
replace the left seek span identically.

**2e. App wiring** — pass `timeLabelMode={timeLabelMode} onCycleTimeLabel={cycleTimeLabel}` to BOTH
`<PlayerBar>` (≈L764) and `<NowPlayingPanel>` (≈L809).

**2f. CSS** (`src/styles/components.css`): `.time-label { background: none; border: 0; color: inherit;
font: inherit; cursor: pointer; padding: 0; }` and a `:focus-visible` ring (M13's global rule may
already cover `.button`; add `.time-label` to the focus selector list if needed).

**Tests** (`PlayerBar.test.tsx`): add `timeLabelMode: "elapsed"` and `onCycleTimeLabel: vi.fn()` to
`props()`; assert clicking the time label calls `onCycleTimeLabel`; render with mode `"remaining"`
→ shows `-1:30` (currentTime 30, duration 120) and `"percent"` → `25%`. (`NowPlayingPanel.test.tsx`
gets the same once Task 3 adds the overrides param.)

**Verify:** `npx tsc --noEmit` && `npm test`.

---

## Task 3 — Chapters-in-this-work panel

The expanded panel lists the current work's chapters with a one-click jump. App fetches the chapters
(keeping the panel a pure prop-driven component).

**3a. App.tsx — fetch the current work's chapters** when `current` changes:
```ts
const [currentWorkChapters, setCurrentWorkChapters] = useState<ChapterRow[]>([]);
useEffect(() => {
  const ctx = current;
  if (!ctx) { setCurrentWorkChapters([]); return; }
  let cancelled = false;
  void getAuthorDetail(ctx.authorId).then((d) => {
    if (cancelled) return;
    const work = d.works.find((w) => w.id === ctx.workId);
    setCurrentWorkChapters(work?.chapters ?? []);
  }).catch(() => { if (!cancelled) setCurrentWorkChapters([]); });
  return () => { cancelled = true; };
}, [current?.workId, current?.authorId]);
```
(Confirm `ChapterRow`/`useEffect` are imported. Keying on `workId`+`authorId` avoids refetch on
mere time updates. The list reflects played-state at open; refreshing it after `handleEnded` is
optional and out of scope — acceptable for v1.)

**3b. App.tsx — jump handler**:
```ts
function jumpToChapter(chapter: ChapterRow) {
  const ctx = currentRef.current;
  if (!ctx) return;
  const chapters = currentWorkChapters;
  playChapter({
    chapter, authorId: ctx.authorId, authorName: ctx.authorName,
    workId: ctx.workId, workTitle: ctx.workTitle,
    workTotalChapters: chapters.length || ctx.workTotalChapters,
    workPlayedChapters: chapters.filter((c) => c.played).length,
  });
}
```

**3c. App wiring** — pass to `<NowPlayingPanel>` (≈L809): `chapters={currentWorkChapters}
onJumpToChapter={jumpToChapter}`.

**3d. NowPlayingPanel.tsx** — add to props: `chapters?: ChapterRow[]; onJumpToChapter?: (c:
ChapterRow) => void;` (both optional, defaulted). After the stop-note `<p>` (≈L49), render the list
(only when there is more than one chapter):
```tsx
{props.chapters && props.chapters.length > 1 && (
  <section className="now-playing__chapters">
    <h2 className="eyebrow muted">In this work</h2>
    <ul className="chapter-jump-list">
      {props.chapters.map((c) => {
        const isCurrent = c.id === props.context.chapter.id;
        return (
          <li key={c.id}>
            <button type="button"
              className={`chapter-jump${isCurrent ? " chapter-jump--current" : ""}`}
              aria-current={isCurrent ? "true" : undefined}
              onClick={() => props.onJumpToChapter?.(c)}>
              <span className={`chapter-jump__dot${c.played ? " chapter-jump__dot--played" : ""}`} aria-hidden />
              <span className="chapter-jump__title">Ch {c.chapterNo} — {c.title}</span>
              {c.played ? <span className="muted">played</span> : null}
            </button>
          </li>
        );
      })}
    </ul>
  </section>
)}
```

**3e. CSS** (`src/styles/components.css`): style the list — a scrollable column so long works don't
blow out the dialog:
```css
.now-playing__chapters { margin-top: var(--space-4); }
.chapter-jump-list { list-style: none; margin: 0; padding: 0; max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.chapter-jump { display: flex; align-items: center; gap: var(--space-2); width: 100%; text-align: left; background: none; border: 0; color: inherit; font: inherit; padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); cursor: pointer; }
.chapter-jump:hover { background: var(--color-surface-hover); }
.chapter-jump--current { background: var(--color-accent-soft); }
.chapter-jump__title { flex: 1; }
.chapter-jump__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-border-strong); flex: none; }
.chapter-jump__dot--played { background: var(--color-accent); }
```

**3f. Tests** (`NowPlayingPanel.test.tsx`): change `props()` to `props(overrides = {})` returning
`{ ...defaults, chapters: [], onJumpToChapter: vi.fn(), timeLabelMode: "elapsed",
onCycleTimeLabel: vi.fn(), ...overrides }`. Add tests: renders the chapter list when given >1
chapter (with the current one marked `aria-current`); clicking a chapter calls `onJumpToChapter`
with that chapter; the list is absent for a single-chapter work. Add the cycling-label tests here too
(Task 2).

**Verify:** `npx tsc --noEmit` && `npm test`.

---

## Task 4 — Expanded-panel layout polish

Minor, CSS-only (the structural refresh shipped in M13; here just make the fuller panel breathe):
- Ensure the right column of `.now-playing__layout` stacks the new chapters section without
  overflowing the dialog (the `max-height`+scroll on `.chapter-jump-list` handles the common case;
  confirm the dialog still fits `90vh` — `.now-playing` already caps height per M13).
- Add a small divider/space above the chapters section if it reads cramped under the stop-note.
- Confirm the cycling `.time-label` is visually aligned with the right total-duration span in both
  the compact bar and the panel seek rows.

**Verify:** `npx tsc --noEmit` && `npm test`; eyeball happens in Task 6.

---

## Task 5 — Harness: show the new player states

**File:** `src/harness/walkthroughs.ts` + the App `m12` nav wiring.

The existing `player-compact` and `player-expanded` steps already populate `current` and open the
panel. With Task 3, `player-expanded` now shows the chapters list automatically (the App effect
fetches them). To make the chapters jump + a non-default time label visible in shots, add one step:

- Add `showPlayerChapters` to the `m12Steps` nav interface and, in the step array, a step named
  **`player-chapters`** AFTER `player-expanded`. Its App callback: ensure a multi-chapter work is the
  current one (the `showPlayerCompact` step plays `work.chapters[0]` of the first author — confirm
  the first fixture work has ≥2 chapters; if not, pick a work with ≥2 chapters when seeding), set
  `setPlayerExpanded(true)`, and call `cycleTimeLabel()` once so the shot shows the **remaining**
  (`-m:ss`) label (demonstrates the cycling feature in a static screenshot). Keep it self-contained.
- Update `runner.test.ts` (asserts `m12Steps` order/names) to include `player-chapters`.

If wiring a fully reliable multi-chapter selection into the harness proves fiddly, the minimum
acceptable version is: `player-expanded` shows the chapters list (Task 3 makes it automatic) and the
new step only toggles the time label — note whichever you did in your report.

**Verify:** `npx tsc --noEmit` && `npm test`.

---

## Task 6 — Gates + before/after screenshot verification

1. Capture the BEFORE baseline of the player shots FIRST is unnecessary here (M14 only changes the
   player; use the committed M13 `m12` shots as the conceptual "before" — OR capture a fresh
   `.shots-before` of `player-compact`/`player-expanded` before coding if you prefer a clean diff;
   not required). Run the gates:
   ```
   npx tsc --noEmit
   npm test
   cmd /c "tools\dev-env.cmd cargo test -v minimal --manifest-path src-tauri\Cargo.toml"   # 47, FE-only
   ```
2. Build + capture:
   ```
   npm run build
   powershell -ExecutionPolicy Bypass -File tools\verify.ps1 -Walkthrough m12
   powershell -ExecutionPolicy Bypass -File tools\verify.ps1 -Walkthrough player -SkipBuild
   ```
   Expected new/updated shots include `.shots\m12\11-player-compact.png`, `12-player-expanded.png`,
   and the new `…-player-chapters.png` (numbering follows the step order).
3. **Screenshot verification in a Sonnet subagent** (do NOT load PNGs into the controller). It reads
   the player shots and returns a text verdict against:
   - The compact bar's time label and the expanded panel's seek label are present; the
     `player-chapters` shot shows the **remaining** (`-m:ss`) or `%` label (cycling works).
   - The expanded Now Playing panel shows a **"In this work" chapters list** with played dots, the
     current chapter highlighted (`aria-current`), and tappable rows.
   - No layout breakage: the dialog still fits, the chapters list scrolls rather than overflowing,
     dark theme intact.
   - Regression: the `player` walkthrough (author detail + compact bar) still renders correctly.
4. Fix any FAIL and re-capture.

**Only if the user explicitly asks to see a shot** do you Read a PNG into the session.

---

## Definition of done

- `npx tsc --noEmit` clean; `npm test` green (was 141 — `playback.test.ts` + PlayerBar/NowPlaying
  tests added); `cargo test` 47 green (no Rust touched).
- Cycling time label works in both the compact bar and the expanded panel (shared mode); the
  expanded panel shows a tappable "In this work" chapters list (played dots, current highlighted)
  that jumps via `playChapter`.
- `git status`: no `Cargo.lock`/`db.rs`/fixture change; no committed screenshots.
- Subagent before/after verdict PASS; `player` walkthrough unregressed.

## PR

- Branch `m14-player-polish`; commit as `yovanmc <yovanmc@users.noreply.github.com>` + trailer
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` (no Codex trailer).
- Open PR; FOREGROUND `gh pr checks <PR#> --watch` (sleep ~20s first); merge from main
  `--merge --delete-branch`; sync main.
- **Update `ROADMAP.md` via a docs PR** (AudioShelf rule): flip M14 to ✅ Merged with the PR # +
  one-line summary; decision-log entry (FE-only; cycling label shared via App; chapters-in-work via
  `getAuthorDetail` reuse, no new Rust command).

## Notes / gotchas

- **Keep all new component props OPTIONAL with defaults** — `NowPlayingPanel.test.tsx`'s `props()`
  has no overrides param until Task 3 adds one; a new *required* prop breaks every player test.
- The chapters list reflects played-state **at panel-open**; it does not live-update when the
  current chapter finishes (acceptable — the panel reloads on next `current` change). Do NOT add a
  refresh into the hot `onTimeUpdate`/`handleEnded` path.
- No per-second offset — jumping to a chapter starts it at 0 (consistent with the app's model).
- FE-only debug-rebuild cache gotcha: if a screenshot run looks stale after FE edits, force a relink
  (`cmd /c "tools\dev-env.cmd cargo clean -p audioshelf"`) and re-run.
- Confirm the first fixture author's first work has ≥2 chapters for the `player-chapters` harness
  step; if not, select a multi-chapter work when seeding (STOP and report if none exists).
