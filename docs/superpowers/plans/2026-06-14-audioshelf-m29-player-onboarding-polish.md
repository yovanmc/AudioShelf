# M29 — Player & Onboarding Micro-Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Written for Sonnet execution. If something in the codebase does not match a quoted excerpt or line number below, STOP and report rather than guess** — the frontend evolves between milestones and a wrong-place edit is worse than a paused task.

**Goal:** Close v7 with a broad, FE-only micro-polish pass over the player and the first-run/onboarding experience — 22 backlog items (PL7-1…10, ON-1…9, IA7-4/5/9) — making the listening loop feel responsive and the first five minutes feel guided.

**Architecture:** Pure frontend. No Rust, no schema, no new dependency, no capability change. All work is in `src/` (React + TS + CSS). The only behavioral logic is small pure helpers (testable) and prop-gating; the rest is CSS, copy, and component wiring verified by the `m29` screenshot walkthrough. Two owner decisions are baked in: **(A) ship all 22 items broad**; **(B) gate the "My listening" sidebar group until listening history exists** (ON-1).

**Tech Stack:** Tauri 2 · React 18 · TypeScript · Vitest + Testing Library (FE tests) · the project screenshot harness (`tools/verify.ps1` + `src/harness/walkthroughs.ts`).

---

## Hard invariants (gate at the end — see Task 16)

These MUST hold or the milestone is wrong:

- **FE-only.** `git diff --stat main` of `src-tauri/`, `Cargo.toml`, `Cargo.lock`, `package.json`, `package-lock.json`, and `gen/schemas/*.json` / `capabilities.json` must be **EMPTY**. No Rust, no schema (`db::LATEST` stays **10**), no new dep, no capability change.
- **Read-only-on-disk.** Zero new `std::fs`/filesystem writes (there is no Rust change at all, so this is automatic — assert it via the empty diff).
- **Fixtures unchanged** at 43/44/47 (`src-tauri/.../fixture_scan.rs` untouched; all M29 walkthrough state seeded at runtime).
- **`cargo test` green & unchanged** (regression only — we touch no Rust).
- **Every new color/shadow token added to all 3 theme blocks** (default dark + `[data-theme="light"]` + high-contrast); theme-independent tokens (sizes/durations) added once in `:root`.
- **Dividers/separators that must read on dark use `var(--color-divider)`** (M25/M28 lesson: `--color-border` is near-invisible on the dark theme).

## House gotchas (every screenshot/build task)

- **Bash tool: use `cmd //c` (NOT `cmd /c`)** — Git-Bash/MSYS rewrites `/c` → `C:/` and launches an interactive shell that ignores the command. Cargo runs as: `cmd //c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml"`. (Or use the PowerShell tool.)
- **🔴 The frozen `cargo tauri build --debug` EXE EMBEDS the frontend.** `npm run build` alone does NOT update the running binary. After ANY FE change you MUST run **`npm run build` THEN `cargo tauri build --debug`** before `tools\verify.ps1 -SkipBuild`, OR run `verify.ps1` WITHOUT `-SkipBuild` (it does its own frozen build). Do NOT run `cargo test` / `cargo tauri dev` between the frozen build and a `-SkipBuild` capture — that re-creates a dev-mode exe ("localhost refused to connect").
- **No `getCurrentWindow().setSize()`** — not permitted under current capabilities; it no-ops/rejects. For tall views, **scroll** (`.app-main` is the scroll container, `overflow:auto`) — see existing m27 steps for the `scrollIntoView({block:'center'})` pattern.
- **`runner.test.ts` enumerates walkthrough step NAMES** — when adding the `m29` walkthrough, register the name and keep step names stable so the runner stays green.
- **Borderline contrast verdicts:** a single screenshot subagent is unreliable on thin rules / low-contrast glyphs (M25/M28 lesson). The controller direct-reviews any borderline scrubber/divider/cue PNG.

---

## File map (what each task touches)

| Area | Files |
|------|-------|
| Player scrubber | `src/player/PlayerBar.tsx`, `src/player/NowPlayingPanel.tsx`, `src/player/playback.ts`, `src/styles/components.css`, `src/styles/layout.css` |
| Player transport | `src/player/PlayerBar.tsx`, `src/player/NowPlayingPanel.tsx`, `src/styles/components.css` |
| Chapter-end UX | `src/player/NowPlayingPanel.tsx`, `src/styles/components.css` |
| Sleep timer | `src/player/PlayerBar.tsx`, `src/player/NowPlayingPanel.tsx`, `src/player/playback.ts` |
| Keyboard hints | `src/App.tsx` (read first), `src/player/NowPlayingPanel.tsx`, `src/components/Icon.tsx`, `src/styles/components.css` |
| Home headers/copy | `src/views/HomeView.tsx` |
| First-run sidebar gating | `src/App.tsx` (read first), `src/components/AppShell.tsx` |
| Collapsed sidebar | `src/components/AppShell.tsx`, `src/styles/layout.css` |
| Scan reassurance + CTA | `src/views/ScanView.tsx`, `src/App.tsx` (read first) |
| Discover empty state | `src/views/DiscoveryView.tsx` (read first) |
| Settings sub-nav / order / hints | `src/views/SettingsView.tsx` |
| Command palette sections | `src/components/CommandPalette.tsx` or wherever Ctrl+K renders (read first) |
| Harness | `src/harness/walkthroughs.ts`, `src/harness/runner.test.ts`, `src/App.tsx` (route the new walkthrough) |

---

## Task 1: Shared scaffolding — glyphs + tokens (additive)

Adds the small primitives later tasks depend on, so no later task has to touch `Icon.tsx`/token blocks mid-feature.

**Files:**
- Modify: `src/components/Icon.tsx` (glyph registry; current icons listed in the digest end with `…music`)
- Modify: `src/styles/components.css` (token additions, near the `:root`/theme blocks at the top)

- [ ] **Step 1: Read `src/components/Icon.tsx` fully** (≈62 lines). Confirm the `IconName` union (lines ~1–9) and the `glyphs` Record (lines ~13–53). Confirm which of `keyboard`, `flag`/`milestone` (chapter-boundary marker) glyphs are **absent**.

- [ ] **Step 2: Add a `keyboard` glyph** (for the PL7-9 shortcuts affordance) if absent. Add `"keyboard"` to the `IconName` union and to `glyphs`. Use this single-path definition (matches the repo's single-`<path>` glyph pattern):

```ts
keyboard: { d: "M3 5h18a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm2 3v2h2V8H5Zm4 0v2h2V8H9Zm4 0v2h2V8h-2Zm4 0v2h2V8h-2ZM5 12v2h2v-2H5Zm4 0v2h6v-2H9Zm8 0v2h2v-2h-2Z" },
```

- [ ] **Step 3: Add CSS tokens** at the top theme blocks of `src/styles/components.css`. Theme-independent ones go in `:root` once; there are no new color tokens needed for M29 (reuse `--color-accent`, `--color-divider`, `--color-success`, `--color-text-muted`). Add to `:root`:

```css
:root {
  /* M29 */
  --scrubber-thumb: 14px;        /* always-visible thumb size */
  --scrubber-track-h: 6px;       /* visible filled track height */
  --transition-swap: 160ms ease; /* chapter-end button cross-fade (PL7-3) */
}
```

- [ ] **Step 4: Verify it compiles.** Run: `npx tsc --noEmit`
  Expected: no errors.

- [ ] **Step 5: Commit.**

```bash
git add src/components/Icon.tsx src/styles/components.css
git commit -m "M29 T1: add keyboard glyph + scrubber/transition tokens"
```

---

## Task 2: Scrubber always-visible thumb + scrubbing feedback (PL7-1, PL7-2)

Make the seek bar look interactive at rest (PL7-1) and give real-time feedback + chapter-boundary/resume cues while scrubbing (PL7-2).

**Current state (from digest):** native `<input type="range" class="seek-range">` in `PlayerBar.tsx:73–79`; the webkit thumb is `opacity:0` at rest and only reveals on `.player-bar__seek:hover` / `:focus-visible` (`components.css:254–258`). No live time bubble; no chapter-boundary or resume markers.

**Files:**
- Test: `src/player/playback.test.ts` (a formatting helper)
- Modify: `src/player/playback.ts`
- Modify: `src/player/PlayerBar.tsx`, `src/player/NowPlayingPanel.tsx`
- Modify: `src/styles/components.css`, `src/styles/layout.css`

- [ ] **Step 1: Write a failing test** for a scrub-preview formatter in `src/player/playback.test.ts`. (The repo already unit-tests `playback.ts` formatting per the M24 notes.)

```ts
import { describe, it, expect } from "vitest";
import { formatScrubPreview } from "./playback";

describe("formatScrubPreview", () => {
  it("renders elapsed / total at the hovered position", () => {
    expect(formatScrubPreview(65, 600)).toBe("1:05 / 10:00");
  });
  it("clamps to bounds and never shows negative", () => {
    expect(formatScrubPreview(-5, 600)).toBe("0:00 / 10:00");
    expect(formatScrubPreview(605, 600)).toBe("10:00 / 10:00");
  });
});
```

- [ ] **Step 2: Run it — verify it fails.** Run: `npx vitest run src/player/playback.test.ts`
  Expected: FAIL — `formatScrubPreview` is not exported.

- [ ] **Step 3: Implement `formatScrubPreview`** in `src/player/playback.ts`, reusing the existing time formatter (find the current `formatTime`/`fmt` export and reuse it — do NOT add a second formatter):

```ts
// reuse the existing exported time formatter in this file (e.g. formatTime).
export function formatScrubPreview(posSecs: number, totalSecs: number): string {
  const clamped = Math.max(0, Math.min(posSecs, totalSecs));
  return `${formatTime(clamped)} / ${formatTime(totalSecs)}`;
}
```

If the existing formatter has a different name, use that name and report the substitution in your task summary.

- [ ] **Step 4: Run the test — verify it passes.** Run: `npx vitest run src/player/playback.test.ts`
  Expected: PASS.

- [ ] **Step 5: Make the thumb always visible + a filled track (PL7-1).** Read `components.css:254–258` first, then replace the opacity-0/hover-reveal rules so the thumb is visible at rest with a clear filled portion. Apply to BOTH the compact `.player-bar__seek` and the expanded `.now-playing__layout .seek-range`:

```css
.seek-range { height: 22px; cursor: pointer; accent-color: var(--color-accent); }
.seek-range::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: var(--scrubber-thumb); height: var(--scrubber-thumb);
  border-radius: 50%; background: var(--color-accent);
  border: 2px solid var(--color-bg, #0c1620);
  opacity: 1; transition: transform .12s ease;
}
.seek-range:hover::-webkit-slider-thumb,
.seek-range:active::-webkit-slider-thumb { transform: scale(1.18); }
.seek-range:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 40%, transparent); }
/* keep accent-color as the cross-browser track fill */
```

Remove the now-dead `opacity:0` rest rule and the `.player-bar__seek:hover ... opacity:1` reveal rule. (If the `--color-bg` token name differs, read `tokens.css`/`components.css` `:root` and use the real page-background token.)

- [ ] **Step 6: Add a scrub-preview bubble + cue markers (PL7-2).** In `PlayerBar.tsx` (and the expanded panel in `NowPlayingPanel.tsx`), wrap the `<input class="seek-range">` in a positioned container that overlays (a) a small time bubble while dragging/hovering and (b) thin tick markers for the **resume point** (the chapter's `playback_position_secs` if > 0) and **chapter boundaries** where the data exists. Read the current PlayerBar JSX (`PlayerBar.tsx:73–79`) first; then transform to:

```tsx
// inside the seek container; `current`, `duration`, `resumeSecs` already in props/state.
<div className="seek-wrap">
  <input
    type="range" className="seek-range"
    min={0} max={duration || 0} value={current}
    onChange={onSeek}
    onPointerDown={() => setScrubbing(true)}
    onPointerUp={() => setScrubbing(false)}
    aria-label="Seek"
  />
  {duration > 0 && resumeSecs > 0 && resumeSecs < duration && (
    <span className="seek-cue seek-cue--resume" style={{ left: `${(resumeSecs / duration) * 100}%` }} title="Resume point" />
  )}
  {scrubbing && (
    <span className="seek-bubble" style={{ left: `${duration ? (current / duration) * 100 : 0}%` }}>
      {formatScrubPreview(current, duration)}
    </span>
  )}
</div>
```

Add the `scrubbing` boolean state (`const [scrubbing, setScrubbing] = useState(false)`). Wire `resumeSecs` from the chapter's `playbackPositionSecs` already in player props (M24). If a value isn't readily available in that component, pass it down from `App.tsx` — read first; do NOT invent a backend call.

- [ ] **Step 7: Style the bubble + cues** in `components.css`:

```css
.seek-wrap { position: relative; flex: 1; min-width: 90px; display: flex; align-items: center; }
.seek-wrap .seek-range { width: 100%; }
.seek-bubble {
  position: absolute; bottom: 26px; transform: translateX(-50%);
  background: var(--color-surface, #16222f); color: var(--color-text);
  border: 1px solid var(--color-divider); border-radius: 6px;
  padding: 2px 6px; font-size: .75rem; white-space: nowrap; pointer-events: none;
}
.seek-cue { position: absolute; top: 50%; width: 2px; height: 12px; transform: translate(-50%, -50%); pointer-events: none; border-radius: 1px; }
.seek-cue--resume { background: var(--color-success); }
.seek-cue--boundary { background: var(--color-divider); }
```

(If `--color-surface` doesn't exist, use the real card/popover surface token from `:root` — read first.)

- [ ] **Step 8: Update the layout container.** In `layout.css` the compact seek lives in a grid (`grid-template-columns: auto minmax(90px,1fr) auto`, line ~59). The `.seek-wrap` replaces the bare input in the middle column — confirm the grid still aligns (the wrap sets `flex:1`). Adjust the middle column to `1fr` if needed.

- [ ] **Step 9: tsc + tests.** Run: `npx tsc --noEmit && npx vitest run src/player/playback.test.ts`
  Expected: clean, PASS.

- [ ] **Step 10: Commit.**

```bash
git add src/player/playback.ts src/player/playback.test.ts src/player/PlayerBar.tsx src/player/NowPlayingPanel.tsx src/styles/components.css src/styles/layout.css
git commit -m "M29 T2: always-visible scrubber thumb + scrub-preview bubble & resume cue (PL7-1, PL7-2)"
```

---

## Task 3: Player transport consistency — speed, mute, mini-skip (PL7-4, PL7-6, PL7-5)

**Files:**
- Modify: `src/player/PlayerBar.tsx` (compact), `src/player/NowPlayingPanel.tsx` (expanded)
- Modify: `src/styles/components.css`

- [ ] **Step 1: Read both player components** to see the current speed control (compact = cycle button, expanded = segmented control per M24), the mute control (`audio.muted`, volume slider preserved per M24), and the compact transport row.

- [ ] **Step 2: Unify the speed active state (PL7-4).** Give the compact cycle button a visible current-speed pill matching the expanded segmented control's active styling. Use a shared `.speed-active` style:

```css
.speed-btn, .speed-seg__opt { font-variant-numeric: tabular-nums; }
.speed-btn[data-active="true"], .speed-seg__opt[aria-pressed="true"] {
  background: var(--color-chip-bg); color: var(--color-text);
  border-color: var(--color-accent);
}
```

In the compact button, render the active rate as `{speed}×` and set `data-active={speed !== 1}`. Keep the cycle behavior — only the visual active state changes. (If the existing class names differ, adapt to the real ones — read first.)

- [ ] **Step 3: Mute visibly zeroes the slider (PL7-6).** When `muted` is true, render the volume slider at value 0 (visually) while preserving the underlying volume for unmute. Read the current mute handler; transform the slider's displayed `value` to `muted ? 0 : volume` (keep the real `volume` state intact so unmute restores it). Update the mute icon to the `mute` glyph when muted, `volume` otherwise (both already in the registry).

- [ ] **Step 4: Add ±15/30s skip to the mini/compact player (PL7-5).** The compact `PlayerBar` currently has prev/next chapter only. Add skip buttons reusing the existing `back15`/`forward30` (or `back30`/`forward15`) glyphs and the same skip handlers the expanded panel uses. Read the expanded panel's skip handler names and reuse them (do NOT create new ones). Keep the compact row from overflowing — if space is tight, show **back15 / forward30** only (the two most-used), and document the choice in your summary.

- [ ] **Step 5: tsc.** Run: `npx tsc --noEmit`  Expected: clean.

- [ ] **Step 6: Commit.**

```bash
git add src/player/PlayerBar.tsx src/player/NowPlayingPanel.tsx src/styles/components.css
git commit -m "M29 T3: consistent speed active-state, mute zeros slider, mini-player skip (PL7-4/5/6)"
```

---

## Task 4: Chapter-end transition + play-next title (PL7-3, PL7-7)

**Current state (digest):** `NowPlayingPanel.tsx:128–141` renders the chapter-end actions. Non-last shows `<Button variant="primary">Play next chapter →</Button>` (no title). The buttons swap with no transition (PL7-3).

**Files:**
- Test: `src/player/playback.test.ts` (label helper)
- Modify: `src/player/playback.ts`, `src/player/NowPlayingPanel.tsx`, `src/styles/components.css`

- [ ] **Step 1: Write a failing test** for the play-next label helper:

```ts
import { nextChapterLabel } from "./playback";

describe("nextChapterLabel", () => {
  it("includes the upcoming chapter title", () => {
    expect(nextChapterLabel("Chapter 3 — The Cave")).toBe("Play next — Chapter 3 — The Cave");
  });
  it("falls back when no title is known", () => {
    expect(nextChapterLabel("")).toBe("Play next chapter");
    expect(nextChapterLabel(undefined)).toBe("Play next chapter");
  });
});
```

- [ ] **Step 2: Run — verify it fails.** Run: `npx vitest run src/player/playback.test.ts`  Expected: FAIL — `nextChapterLabel` not exported.

- [ ] **Step 3: Implement** in `playback.ts`:

```ts
export function nextChapterLabel(nextTitle?: string): string {
  const t = (nextTitle ?? "").trim();
  return t ? `Play next — ${t}` : "Play next chapter";
}
```

- [ ] **Step 4: Run — verify it passes.** Run: `npx vitest run src/player/playback.test.ts`  Expected: PASS.

- [ ] **Step 5: Use the label + add the transition (PL7-7, PL7-3).** In `NowPlayingPanel.tsx:128–141`, the panel already knows the next chapter (M24 elevates the next-chapter title, PL-5). Pass that title to `nextChapterLabel`:

```tsx
<Button variant="primary" onClick={props.onPlayNextChapter}>
  {nextChapterLabel(props.nextChapterTitle)} →
</Button>
```

(Read the panel's props — the next-chapter title prop from M24 may be named `nextChapterTitle`/`nextTitle`; use the real name and report it.) Wrap the `.np-endactions` block so the state swap cross-fades:

```css
.np-endactions { animation: np-endactions-in var(--transition-swap); }
@keyframes np-endactions-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .np-endactions { animation: none; } }
```

Re-trigger the animation on state change with a `key` on the block (e.g. `key={isLastChapter ? "last" : "next"}`).

- [ ] **Step 6: tsc + tests.** Run: `npx tsc --noEmit && npx vitest run src/player/playback.test.ts`  Expected: clean, PASS.

- [ ] **Step 7: Commit.**

```bash
git add src/player/playback.ts src/player/playback.test.ts src/player/NowPlayingPanel.tsx src/styles/components.css
git commit -m "M29 T4: play-next shows chapter title + chapter-end cross-fade (PL7-7, PL7-3)"
```

---

## Task 5: Sleep timer preview + countdown prominence (PL7-8, PL7-10)

**Current state (digest):** sleep options live in both `PlayerBar` and `NowPlayingPanel`; M24 added a 1s live countdown and an "End of chapter" option. PL7-8: "End of chapter" doesn't preview remaining minutes. PL7-10: the countdown is low-prominence.

**Files:**
- Test: `src/player/playback.test.ts`
- Modify: `src/player/playback.ts`, `src/player/PlayerBar.tsx`, `src/player/NowPlayingPanel.tsx`, `src/styles/components.css`

- [ ] **Step 1: Write a failing test** for an end-of-chapter preview helper:

```ts
import { endOfChapterPreview } from "./playback";

describe("endOfChapterPreview", () => {
  it("rounds up remaining minutes", () => {
    expect(endOfChapterPreview(600, 130)).toBe("End of chapter · ~8 min left");
  });
  it("shows <1 min near the end", () => {
    expect(endOfChapterPreview(600, 580)).toBe("End of chapter · <1 min left");
  });
});
```

- [ ] **Step 2: Run — verify it fails.** Run: `npx vitest run src/player/playback.test.ts`  Expected: FAIL.

- [ ] **Step 3: Implement** in `playback.ts`:

```ts
export function endOfChapterPreview(totalSecs: number, currentSecs: number): string {
  const remaining = Math.max(0, totalSecs - currentSecs);
  const mins = Math.ceil(remaining / 60);
  return remaining < 60 ? "End of chapter · <1 min left" : `End of chapter · ~${mins} min left`;
}
```

- [ ] **Step 4: Run — verify it passes.** Run: `npx vitest run src/player/playback.test.ts`  Expected: PASS.

- [ ] **Step 5: Use the preview in the "End of chapter" sleep option** (PL7-8). Read where the sleep options render. The "End of chapter" `<option>`/Select item label becomes `endOfChapterPreview(duration, current)` (recompute on render). NOTE the M24 gotcha: a native `<select>` popup is OS-rendered and won't screenshot — if these are native `<select>`s the change is source-verified, not screenshot-verified; if they use the M25 `Select` primitive, it will screenshot.

- [ ] **Step 6: Make the countdown prominent as it nears expiry (PL7-10).** When a sleep timer is active, render the running countdown with emphasis, and add an urgency state under ~60s:

```css
.sleep-countdown { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--color-text); }
.sleep-countdown--soon { color: var(--color-accent); animation: sleep-pulse 1s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .sleep-countdown--soon { animation: none; } }
@keyframes sleep-pulse { 0%,100% { opacity: 1; } 50% { opacity: .55; } }
```

Toggle `--soon` when `remainingSleepSecs <= 60`. Read the existing countdown element (M24 added it) and add the class — do NOT add a second timer.

- [ ] **Step 7: tsc + tests.** Run: `npx tsc --noEmit && npx vitest run src/player/playback.test.ts`  Expected: clean, PASS.

- [ ] **Step 8: Commit.**

```bash
git add src/player/playback.ts src/player/playback.test.ts src/player/PlayerBar.tsx src/player/NowPlayingPanel.tsx src/styles/components.css
git commit -m "M29 T5: sleep end-of-chapter preview + prominent expiring countdown (PL7-8, PL7-10)"
```

---

## Task 6: Keyboard-shortcut hints in the player (PL7-9)

**Files:**
- Read first: `src/App.tsx` (global keydown handler, if any) and `src/player/*`
- Modify: `src/player/NowPlayingPanel.tsx`, `src/components/ui.tsx` or wherever `Dialog` is (reuse), `src/styles/components.css`

- [ ] **Step 1: Determine whether keyboard shortcuts already exist.** Grep `App.tsx` and the player files for `keydown`/`onKeyDown`/`key === "ArrowLeft"`/`" "` (space). Report what exists. The Ctrl+K palette already has a global listener (M22) — find that pattern.
  - **If shortcuts already exist** (space=play/pause, ←/→=skip, etc.): this task is **hints only**.
  - **If none exist:** add a minimal, conservative set in the existing global keydown handler — Space = toggle play/pause, ← / → = skip back/forward (reuse the existing skip handlers from Task 3), **only when no text input is focused** (`document.activeElement` is not INPUT/TEXTAREA/SELECT/`[contenteditable]`). Do NOT hijack arrows when a slider/input is focused.

- [ ] **Step 2: Add a "Keyboard shortcuts" affordance** in the expanded `NowPlayingPanel`. A small ghost `IconButton icon="keyboard" label="Keyboard shortcuts"` that opens the existing `Dialog` primitive (title + context props from M23) listing the shortcuts:

```tsx
<Dialog label="Keyboard shortcuts" title="Keyboard shortcuts" context="Works when the player is focused and you're not typing in a field." onClose={() => setShowShortcuts(false)}>
  <ul className="shortcut-list">
    <li><kbd>Space</kbd><span>Play / pause</span></li>
    <li><kbd>←</kbd> <kbd>→</kbd><span>Skip back / forward</span></li>
    <li><kbd>Ctrl</kbd> <kbd>K</kbd><span>Command palette</span></li>
  </ul>
</Dialog>
```

Only list shortcuts that actually work (match Step 1's findings). Add `const [showShortcuts, setShowShortcuts] = useState(false)`.

- [ ] **Step 3: Style** in `components.css` (reuse the existing `kbd` styling from the M22 sidebar `Ctrl K` badge — grep `kbd` first; do NOT redefine if a `kbd` rule already exists):

```css
.shortcut-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.shortcut-list li { display: flex; align-items: center; gap: 10px; }
.shortcut-list span { color: var(--color-text-muted); }
```

- [ ] **Step 4: tsc.** Run: `npx tsc --noEmit`  Expected: clean.

- [ ] **Step 5: Commit.**

```bash
git add src/player/NowPlayingPanel.tsx src/App.tsx src/styles/components.css
git commit -m "M29 T6: player keyboard-shortcut hints dialog (PL7-9)"
```

---

## Task 7: Home shelf headers + de-jargon empty copy (ON-2, ON-5, ON-3)

**Current state (digest, `HomeView.tsx`):** `SectionHeading eyebrow="From your library" title="You May Like"` (L109); a raw `<h2>Recently listened</h2>` (L135) and `<h2>Your listening</h2>` (L148) bypass `SectionHeading`; empty-state body = `"Your library is organized by creator → work → chapter. Pick something to start — it plays one chapter, then stops."` (jargon, ON-3).

**Files:**
- Test: `src/views/HomeView.test.tsx` (copy regression — the repo does this, M23 CL-2)
- Modify: `src/views/HomeView.tsx`

- [ ] **Step 1: Write/extend a failing copy test** in `HomeView.test.tsx` asserting the warmer, jargon-free strings:

```tsx
it("uses warm, jargon-free shelf headers and empty copy", () => {
  // render empty-state Home (noHistory + no library, the first-run path)
  render(<HomeView /* ...empty-state props per existing test setup... */ />);
  expect(screen.getByText(/Welcome to AudioShelf/i)).toBeInTheDocument();
  // ON-3: no "creator → work → chapter" jargon
  expect(screen.queryByText(/creator → work → chapter/i)).not.toBeInTheDocument();
});
```

Model the render props on the existing `HomeView.test.tsx` setup (read it first; reuse its fixture props).

- [ ] **Step 2: Run — verify it fails** (the jargon string is still present). Run: `npx vitest run src/views/HomeView.test.tsx`  Expected: FAIL.

- [ ] **Step 3: Warmer shelf headers (ON-2/ON-5).** Update the recommendation shelf eyebrow/title to feel curated, and route the two raw `<h2>`s through `SectionHeading` for consistency:
  - L109 recommendations: `eyebrow={keepListening ? "Picked from what you've enjoyed" : "A few places to start"} title="You might like"` (sentence case title).
  - L135: `<SectionHeading title="Recently listened" />` (replace raw `<h2>`).
  - L148: `<SectionHeading title="Your listening" />` (replace raw `<h2>`).
  - Keep L65 "Continue where you left off" (already warm).

- [ ] **Step 4: De-jargon the empty state (ON-3).** Replace the body copy:

```tsx
>Pick something and press play — it plays one chapter, then stops so you choose what's next. Your shelves fill in as you listen.</EmptyState>
```

(Drops "creator → work → chapter".)

- [ ] **Step 5: Run — verify it passes.** Run: `npx vitest run src/views/HomeView.test.tsx`  Expected: PASS.

- [ ] **Step 6: tsc.** Run: `npx tsc --noEmit`  Expected: clean.

- [ ] **Step 7: Commit.**

```bash
git add src/views/HomeView.tsx src/views/HomeView.test.tsx
git commit -m "M29 T7: warmer Home shelf headers + jargon-free empty copy (ON-2/3/5)"
```

---

## Task 8: Gate "My listening" sidebar group until history exists (ON-1)

**Owner decision B:** hide the "My listening" group (Journal/Insights) until there is listening history, so first-run shows only **Browse**.

**Current state (digest, `AppShell.tsx:27–38`):** two groups — `Browse` (home/library/discovery/collections) and `My listening` (journal/insights). HomeView already receives a `noHistory` boolean (M23 CL-2).

**Files:**
- Test: `src/components/AppShell.test.tsx` (render gate)
- Modify: `src/components/AppShell.tsx`
- Modify: `src/App.tsx` (pass `hasHistory`)

- [ ] **Step 1: Write a failing test** in `AppShell.test.tsx`:

```tsx
it("hides the My listening group until there is listening history", () => {
  const { rerender } = render(<AppShell hasHistory={false} /* ...required props... */ />);
  expect(screen.queryByText("My listening")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Journal" })).not.toBeInTheDocument();
  rerender(<AppShell hasHistory={true} /* ...required props... */ />);
  expect(screen.getByText("My listening")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Journal" })).toBeInTheDocument();
});
```

Read `AppShell.tsx` first for the full required prop set and mirror it in the test (other AppShell tests show the shape).

- [ ] **Step 2: Run — verify it fails.** Run: `npx vitest run src/components/AppShell.test.tsx`  Expected: FAIL — `hasHistory` not a prop / group always renders.

- [ ] **Step 3: Add `hasHistory: boolean` to `AppShellProps`** and filter the groups before rendering. Read the groups array (L27–38), then:

```tsx
const allGroups = [ /* Browse group */, /* My listening group */ ];
const groups = props.hasHistory ? allGroups : allGroups.filter(g => g.label !== "My listening");
```

Render `groups` instead of the literal. (Keep Browse always visible.)

- [ ] **Step 4: Run — verify it passes.** Run: `npx vitest run src/components/AppShell.test.tsx`  Expected: PASS.

- [ ] **Step 5: Wire `hasHistory` from `App.tsx`.** Read `App.tsx` for the existing history signal (the same source HomeView's `noHistory` derives from — likely the recently-listened list / `play_events`-backed home payload). Compute `const hasHistory = !noHistory` (or equivalent) and pass `hasHistory={hasHistory}` to `<AppShell>`. **STOP and report** if there is no existing history boolean to reuse — do NOT add a new backend query.

- [ ] **Step 6: Update other AppShell test call sites** that now lack the required `hasHistory` prop (grep for `<AppShell` in tests) — pass `hasHistory={true}` so existing nav tests keep both groups.

- [ ] **Step 7: tsc + AppShell tests.** Run: `npx tsc --noEmit && npx vitest run src/components/AppShell.test.tsx`  Expected: clean, PASS.

- [ ] **Step 8: Commit.**

```bash
git add src/components/AppShell.tsx src/components/AppShell.test.tsx src/App.tsx
git commit -m "M29 T8: gate My listening sidebar group until history exists (ON-1)"
```

---

## Task 9: Collapsed-sidebar labels / tooltips (IA7-5)

**Current state (digest):** collapsed sidebar is icon-only; group headers + `.sidebar__label` are hidden via CSS (`layout.css:66`); items keep `title={item.label}` (hover-only) + `aria-label`. IA7-5: glyphs (Journal/Insights/Collections) are ambiguous icon-only.

**Decision (no owner input needed — pick the calm default):** keep the slim rail but render a **small caption label under each icon** when collapsed (always visible, not hover-only), so the rail stays narrow yet unambiguous. Keep the `title`/`aria-label` for the tooltip and a11y.

**Files:**
- Modify: `src/components/AppShell.tsx`, `src/styles/layout.css`

- [ ] **Step 1: Read `AppShell.tsx` nav-item render (L40–52) and `layout.css` collapsed rules (~L66).**

- [ ] **Step 2: Keep `.sidebar__label` rendered when collapsed**, but restyle it as a tiny caption rather than hiding it. In `layout.css`, replace the collapsed `display:none` on `.sidebar__label` with a compact caption style scoped to the collapsed sidebar:

```css
.sidebar.is-collapsed .sidebar__item { flex-direction: column; gap: 2px; height: auto; padding: 8px 0; }
.sidebar.is-collapsed .sidebar__label { display: block; font-size: .62rem; line-height: 1.1; color: var(--color-text-muted); }
.sidebar.is-collapsed .sidebar__group-label { display: none; } /* group headers still hidden when collapsed */
```

Use the real collapsed-state class name (read it — may be `.sidebar--collapsed` or a `data-collapsed` attr). If the markup hides labels by not rendering them (vs CSS), change it to always render `.sidebar__label` and let CSS control visibility.

- [ ] **Step 3: tsc.** Run: `npx tsc --noEmit`  Expected: clean.

- [ ] **Step 4: Commit.**

```bash
git add src/components/AppShell.tsx src/styles/layout.css
git commit -m "M29 T9: always-on caption labels under collapsed-sidebar icons (IA7-5)"
```

---

## Task 10: Scan reassurance + completion next-steps CTA (ON-7, ON-8)

**Current state (digest, `ScanView.tsx`):** in-progress copy already says "Your files are never changed — this just builds your shelf" (ON-7 mostly satisfied — verify + strengthen if thin). Completion shows `<h1>Library scanned</h1>` + a stats grid and **no next-steps CTA** (ON-8 — "first-run energy dies").

**Files:**
- Test: `src/views/ScanView.test.tsx` (create if absent; the repo unit-tests views)
- Modify: `src/views/ScanView.tsx`
- Read first: `src/App.tsx` (how `ScanView` is rendered / what nav callbacks exist)

- [ ] **Step 1: Read `ScanView.tsx` fully** and how `App.tsx` renders it on completion. Identify the existing nav callbacks available at that route (Home / Library openers).

- [ ] **Step 2: Add `onOpenHome`/`onOpenLibrary` props** to `ScanView` (optional, like HomeView's openers). Write a failing test asserting the completion CTA renders:

```tsx
it("shows next-steps CTAs when a scan completes", () => {
  render(<ScanView result={{ authors: 3, works: 4, chapters: 7 }} onOpenLibrary={() => {}} onOpenHome={() => {}} />);
  expect(screen.getByText(/Library scanned/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Browse library/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Go to Home/i })).toBeInTheDocument();
});
```

- [ ] **Step 3: Run — verify it fails.** Run: `npx vitest run src/views/ScanView.test.tsx`  Expected: FAIL.

- [ ] **Step 4: Add the CTA** under the stats grid in the completion branch:

```tsx
<div className="scan-cta" style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 16 }}>
  {props.onOpenLibrary && <Button variant="primary" onClick={props.onOpenLibrary}>Browse library</Button>}
  {props.onOpenHome && <Button variant="secondary" onClick={props.onOpenHome}>Go to Home</Button>}
</div>
```

- [ ] **Step 5: Strengthen the in-progress reassurance (ON-7)** — confirm the existing copy reads warmly; if it's terse, expand to: `"Reading your folders and grouping chapters into works. We never move, rename, or change your files — this just builds your shelf."` (matches the M23 first-run reassurance voice).

- [ ] **Step 6: Wire the openers in `App.tsx`** — pass the existing Home/Library nav callbacks to `<ScanView>`. Read first; reuse the same handlers the sidebar uses.

- [ ] **Step 7: Run — verify it passes.** Run: `npx vitest run src/views/ScanView.test.tsx`  Expected: PASS.

- [ ] **Step 8: tsc.** Run: `npx tsc --noEmit`  Expected: clean.

- [ ] **Step 9: Commit.**

```bash
git add src/views/ScanView.tsx src/views/ScanView.test.tsx src/App.tsx
git commit -m "M29 T10: scan-complete next-steps CTA + stronger scan reassurance (ON-8, ON-7)"
```

---

## Task 11: Empty-Discover state (ON-6)

**Current state (digest):** Discover "pick a tag" with no library indexed is empty-state debt. M23 already made `DiscoveryView`'s `WorkList` empty prop-driven (`emptyTitle`/`emptyBody`).

**Files:**
- Read first: `src/views/DiscoveryView.tsx`
- Modify: `src/views/DiscoveryView.tsx`

- [ ] **Step 1: Read `DiscoveryView.tsx`** — find the no-library / no-labels branch and the M23 `emptyTitle`/`emptyBody` props.

- [ ] **Step 2: Add a first-run-aware empty state.** When there are no labels/works to pick from at all (un-indexed library), show a guiding empty state instead of an empty picker:

```tsx
<EmptyState
  title="Nothing to discover yet"
  action={props.onOpenSettings && <Button variant="primary" onClick={props.onOpenSettings}>Set up my library</Button>}
>Once you've added your library and listened a little, this is where you'll find picks by mood, narrator, and the labels you create.</EmptyState>
```

Gate it on the existing "no library / no labels" signal (read the real prop — e.g. `labelTypes.length === 0` or a `hasLibrary` flag). Reuse `onOpenSettings` if the view already has it; otherwise thread it from `App.tsx` (read first).

- [ ] **Step 3: tsc + any existing Discovery test.** Run: `npx tsc --noEmit && npx vitest run src/views/DiscoveryView.test.tsx`  Expected: clean, PASS (update the test only if the empty copy is asserted).

- [ ] **Step 4: Commit.**

```bash
git add src/views/DiscoveryView.tsx
git commit -m "M29 T11: guiding empty-Discover state for un-indexed library (ON-6)"
```

---

## Task 12: Settings sub-nav + first-run order + actionable hints (IA7-4, ON-9, ON-4)

**Current state (digest, `SettingsView.tsx`):** four `.settings-group` dividers — `Library` (L243), `Display` (L287), `Curation` (L430), `Maintenance` (L468); one long scroll, no sub-nav (IA7-4). First-run "fine-tune anything later" gives no hint of what (ON-4). On first run, density/a11y can sit above library basics (ON-9).

**Files:**
- Modify: `src/views/SettingsView.tsx`, `src/styles/components.css`

- [ ] **Step 1: Read `SettingsView.tsx`** around the four group headers and the first-run copy block.

- [ ] **Step 2: Add an anchor sub-nav (IA7-4).** Render a sticky row of section links at the top of Settings that scroll to each group. Give each `<h2 className="settings-group">` an `id` (`library`/`display`/`curation`/`maintenance`) and render:

```tsx
<nav className="settings-subnav" aria-label="Settings sections">
  <a href="#settings-library">Library</a>
  <a href="#settings-display">Display</a>
  <a href="#settings-curation">Curation</a>
  <a href="#settings-maintenance">Maintenance</a>
</nav>
```

Add matching `id="settings-library"` etc. to each `<h2 className="settings-group">`. Use anchor links (no router change). Style:

```css
.settings-subnav { position: sticky; top: 0; z-index: 2; display: flex; gap: 8px; flex-wrap: wrap;
  padding: 8px 0; margin-bottom: 8px; background: var(--color-bg, #0c1620); border-bottom: 1px solid var(--color-divider); }
.settings-subnav a { font-size: .85rem; color: var(--color-text-muted); text-decoration: none; padding: 4px 8px; border-radius: 6px; }
.settings-subnav a:hover { color: var(--color-text); background: var(--color-chip-bg); }
```

(Use the real page-bg token from `:root`.)

- [ ] **Step 3: First-run order (ON-9).** Library must be the first group always (it already is at L243 — confirm). On first run, ensure Display/Maintenance don't visually precede Library. If the order is already Library-first, this is a no-op — **document it as verified, no change** (M28-style honest no-op). Do NOT reorder groups for the non-first-run case.

- [ ] **Step 4: Actionable first-run hint (ON-4).** Replace vague "fine-tune anything later" copy with a concrete pointer:

```tsx
You can change your library folder, switch themes, adjust text size, and manage labels here anytime.
```

(Read the exact current string and replace it; keep it inside the existing `firstRun &&` block.)

- [ ] **Step 5: tsc + Settings test.** Run: `npx tsc --noEmit && npx vitest run src/views/SettingsView.test.tsx`  Expected: clean, PASS (update copy assertions if the test pins the old "fine-tune" string).

- [ ] **Step 6: Commit.**

```bash
git add src/views/SettingsView.tsx src/styles/components.css
git commit -m "M29 T12: Settings anchor sub-nav + actionable first-run hint (IA7-4, ON-4, ON-9)"
```

---

## Task 13: Command-palette section headers (IA7-9)

**Current state (digest):** Ctrl+K palette is a flat Authors/Works/Chapters list — no section headers (IA7-9, L).

**Files:**
- Read first: the palette component (`src/components/CommandPalette.tsx` or grep for the Ctrl+K listener / palette JSX from M22)
- Test: the palette's existing test (if any), else a small pure-grouping helper test
- Modify: the palette component + `src/styles/components.css`

- [ ] **Step 1: Locate the palette.** Grep `palette`/`Ctrl` / the M22 `onOpenPalette` prop. Read the component that renders the results list and note the result item shape (it already distinguishes author/work/chapter — the `PaletteRanker` from VideoShelf is a different repo; here find the AudioShelf equivalent).

- [ ] **Step 2: Group results by kind with headers.** Where the flat result list is rendered, partition into Authors / Works / Chapters and render a non-interactive `.palette__section-label` before each non-empty group, preserving the existing ranking within each group. If there's a pure ranking/grouping function, add a unit test asserting grouped order; otherwise this is a render change verified by screenshot.

```tsx
{(["author","work","chapter"] as const).map(kind => {
  const items = results.filter(r => r.kind === kind);
  if (!items.length) return null;
  return (
    <div className="palette__section" key={kind}>
      <div className="palette__section-label">{kind === "author" ? "Authors" : kind === "work" ? "Works" : "Chapters"}</div>
      {items.map(/* existing item render */)}
    </div>
  );
})}
```

Adapt `r.kind` to the real discriminant field (read it). Keep keyboard up/down navigation working across groups (the headers are not focusable rows — ensure the active-index logic still indexes only result rows).

- [ ] **Step 3: Style** in `components.css`:

```css
.palette__section-label { font-size: .72rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
  color: var(--color-text-muted); padding: 8px 12px 4px; }
```

- [ ] **Step 4: tsc + palette test (if present).** Run: `npx tsc --noEmit && npx vitest run` (full FE suite to catch palette-nav regressions)
  Expected: clean, all green.

- [ ] **Step 5: Commit.**

```bash
git add src/components/*.tsx src/styles/components.css
git commit -m "M29 T13: section headers in the Ctrl+K command palette (IA7-9)"
```

---

## Task 14: `m29` screenshot walkthrough

**Files:**
- Modify: `src/harness/walkthroughs.ts` (register name + add `m29Steps`)
- Modify: `src/harness/runner.test.ts` (describe block + expected step names)
- Modify: `src/App.tsx` (route the `m29` walkthrough — read how m28 is routed)

- [ ] **Step 1: Register the name.** In `walkthroughs.ts:51`, append `"m29"` to the `walkthroughs` array (keep all existing names).

- [ ] **Step 2: Add `m29Steps`** following the existing `m28Steps` pattern (walkthroughs.ts ~466–489). The steps should drive each verifiable surface. Seed any needed state at runtime (idempotent — DB persists across runs, per the m27 lesson). Capture, in order:

```
01-scrubber-rest      → player visible, thumb showing at rest (PL7-1)
02-scrubber-cue       → a chapter with a resume point > 0; resume cue tick visible (PL7-2)
03-chapter-end        → expanded panel showing "Play next — <title> →" (PL7-7) + cross-fade block
04-transport          → compact bar showing speed pill + mute(zeroed) + mini-skip (PL7-4/5/6)
05-shortcuts          → keyboard-shortcuts dialog open (PL7-9)
06-home-empty         → first-run empty Home: warm copy, NO "creator → work → chapter" (ON-3), sidebar shows only Browse (ON-1)
07-home-shelves       → populated Home: warmer shelf headings (ON-2/5)
08-scan-complete      → ScanView completion with Browse/Home CTA (ON-8)
09-settings-subnav    → Settings top showing the sticky section sub-nav (IA7-4)
10-sidebar-collapsed  → collapsed sidebar with caption labels under icons (IA7-5)
11-palette-sections   → Ctrl+K palette with Authors/Works/Chapters headers (IA7-9)
```

For tall views, scroll the target into view (`scrollIntoView({block:'center'})`) — do NOT resize the window. For the first-run-only shots (06, 08), the standard fixture is pre-configured, so seed/drive a first-run-like state OR source-verify (per the M23 CL-3 lesson — first-run copy may be unreachable via the pre-configured fixture; if so, mark NA + source-confirm rather than forcing it).

- [ ] **Step 3: Add the runner describe block** in `runner.test.ts` after the m28 block, listing the exact step names above so the enumeration stays in sync.

- [ ] **Step 4: Route `m29` in `App.tsx`** exactly like `m28` (read the m28 routing line).

- [ ] **Step 5: tsc + runner test.** Run: `npx tsc --noEmit && npx vitest run src/harness/runner.test.ts`  Expected: clean, PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/harness/walkthroughs.ts src/harness/runner.test.ts src/App.tsx
git commit -m "M29 T14: add m29 screenshot walkthrough (11 steps)"
```

---

## Task 15: Full verification (gates + frozen build + subagent verdict)

**No new code** — this task runs the gates and captures screenshots.

- [ ] **Step 1: Type + unit gates.**
  Run: `npx tsc --noEmit`  → Expected: clean.
  Run: `npx vitest run`  → Expected: all FE tests green (count up from 487 by the tests added in T2/T4/T5/T7/T8/T10).

- [ ] **Step 2: Rust regression (must be unchanged).**
  Run: `cmd //c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml"`
  Expected: green, **same count as M28** (we touched no Rust).

- [ ] **Step 3: 🔴 Invariant diff gate.** Run:
  `git diff --stat main -- src-tauri Cargo.toml Cargo.lock package.json package-lock.json gen/schemas`
  Expected: **EMPTY output**. If anything appears, a task leaked outside the frontend — STOP and fix before proceeding.

- [ ] **Step 4: Frozen build + capture.** Run (PowerShell tool, or `cmd //c`):
  `npm run build` THEN `cargo tauri build --debug` (via `tools\dev-env.cmd`), THEN:
  `tools\verify.ps1 -Walkthrough m29 -SkipBuild`
  then capture the regression matrices against the same frozen exe (no `cargo`/`dev` in between):
  `tools\verify.ps1 -Walkthrough m12 -SkipBuild` · `-Walkthrough m24 -SkipBuild` · `-Walkthrough m25 -SkipBuild`
  Expected: PNGs under `.shots/m29/`, `.shots/m12/`, `.shots/m24/`, `.shots/m25/`.

- [ ] **Step 5: Subagent screenshot verdict.** Dispatch ONE Sonnet subagent to Read the `.shots/m29/*.png` (and spot-check m12/m24/m25 for regressions) and return a **text verdict** (PASS/FAIL per criterion + file paths). Criteria: scrubber thumb visible at rest; resume cue tick present; "Play next — <title>"; speed pill + zeroed-mute + mini-skip; shortcuts dialog; warm jargon-free empty Home with Browse-only sidebar; warmer shelf headings; scan-complete CTA; Settings sub-nav; collapsed-sidebar captions; palette section headers; M24/M25 player surfaces unregressed.

- [ ] **Step 6: Controller direct-review the borderline PNGs.** Per the M25/M28 lesson, the controller (NOT the subagent) directly reviews any low-contrast shot: `01-scrubber-rest`, `02-scrubber-cue`, `10-sidebar-collapsed` (thin captions/cue ticks/thumb on dark are exactly where a single subagent verdict is unreliable). Confirm or correct.

- [ ] **Step 7: Fix any FAIL, re-freeze-build, re-capture, re-verify.** Remember: after ANY FE fix, re-run `npm run build` + `cargo tauri build --debug` before the next `-SkipBuild` capture, or the stale exe shows no change.

- [ ] **Step 8: Commit** any verification-driven fixes (each as its own small commit).

---

## Task 16: PR → CI watch → merge → ROADMAP update

- [ ] **Step 1: Push the branch** (feature branch off `main`, e.g. `m29-player-onboarding-polish`).

- [ ] **Step 2: Open the PR** with a body summarizing the 22 items shipped (grouped PL7/ON/IA7), the held invariants (FE-only diff EMPTY, schema `LATEST`=10, no dep, read-only-on-disk, fixtures 43/44/47), and the gate results. End the body with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 3: FOREGROUND CI watch.** Sleep ~20s (dodge "no checks reported"), then:
  `gh pr checks <PR#> --watch`
  Expected: `build-and-test` (windows-latest) green.

- [ ] **Step 4: Merge from `main`** once green: `gh pr merge <PR#> --merge --delete-branch`, then sync local main: `git checkout main && git pull` (or `git reset --hard origin/main`).

- [ ] **Step 5: Update `ROADMAP.md`** — flip the M29 row to `✅ Merged` with the PR link and a one-line shipped summary; append an M29 decision-log entry (what shipped, gotchas hit, any NA/source-confirmed items). Commit on `main` (or a tiny docs branch + PR per the M25 ROADMAP-update gotcha note) and push.

- [ ] **Step 6: Ping the user** with the Phase-B handoff (see the roadmap skill's Handoff template) — v7 (M26–M29) is COMPLETE after this, so the next-session prompt is "scope the next version/milestone," naming the absolute ROADMAP path.

---

## Self-review (done by the plan author)

- **Spec coverage:** all 22 codes mapped — PL7-1/2 (T2), PL7-4/5/6 (T3), PL7-3/7 (T4), PL7-8/10 (T5), PL7-9 (T6); ON-2/3/5 (T7), ON-1 (T8), ON-7/8 (T10), ON-6 (T11), ON-4/9 (T12); IA7-5 (T9), IA7-4 (T12), IA7-9 (T13). ON-5 folded into ON-2 (duplicate, per spec). ✓
- **Placeholder scan:** every code step shows code; read-first transforms name the exact file:line and say STOP-if-mismatch rather than fabricate unseen code. ✓
- **Type consistency:** helper names used consistently — `formatScrubPreview`, `nextChapterLabel`, `endOfChapterPreview` (all in `playback.ts`), `hasHistory` prop (AppShell + App). ✓
- **Invariants:** FE-only diff gate is an explicit step (T15.3); schema stays 10; no dep; fixtures untouched. ✓
