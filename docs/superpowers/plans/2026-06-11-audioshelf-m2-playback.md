# AudioShelf — Milestone 2: Playback & Progress — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent now-playing player bar so the user can actually listen: load a chapter from the author view, play/pause, scrub, skip ±15s/±30s, adjust volume, and set a sleep timer; when a chapter reaches its end it is auto-marked played (and a play event is recorded), then playback stops (no auto-advance).

**Architecture:** A presentational `PlayerBar` (props + callbacks, fully unit-tested) plus pure playback helpers (`playback.ts`, unit-tested) plus the actual `<audio>` element wiring held in `App.tsx` (verified by the screenshot harness, since jsdom cannot run media). A new Rust command `mark_chapter_finished` atomically sets `chapters.played` and inserts a `play_events` row (the `play_events` table already exists from M1). A new `player` harness walkthrough screenshots the bar.

**Tech Stack:** React 18 + TypeScript, Tauri 2 (`convertFileSrc` + the WebView `<audio>` element — plays all M1 formats natively), rusqlite, Vitest.

**Reference (existing M1 code this builds on):**
- `src/lib/api.ts` — `ChapterRow { id, title, chapterNo, format, durationSecs, filePath, played }`, `fileUrl(p) = convertFileSrc(p)`, `setChapterPlayed`, `getAuthorDetail`, `getAuthors`, `captureWindow`, `finishWalkthrough`.
- `src/views/AuthorDetailView.tsx` — props `{ detail, onTogglePlayed, onBack }`; renders works → chapters (checkbox + title + duration).
- `src/App.tsx` — route state machine (`loading|scan|library|author`), `settle()` helper, harness bootstrap that calls `browseSteps(...)`.
- `src/harness/walkthroughs.ts` — `browseSteps(nav)`, `walkthroughs = ["browse"]`.
- `src-tauri/src/commands.rs` — `DbState`, `#[tauri::command]` fns, `pub` query helpers; `src-tauri/src/lib.rs` — `invoke_handler!` list and `pub mod testing`.
- `src-tauri/src/db.rs` — `play_events(id, chapter_id, played_at)` table already present. **No schema change needed.**

**Conventions (same as M1):** Windows; cargo via `cmd /c "tools\dev-env.cmd cargo ..."`, run in the FOREGROUND with a large timeout. Run `npm run build` before any cargo build. Commit per task; keep the human as author and append `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Each command's final step shows the exact commit message.

**Out of scope (later milestones):** author tags + discovery (M3); opt-in rename tool (M4); playback speed/pitch, auto-advance, queue, per-second resume (all permanently out of scope per the design spec).

---

## File Structure

- Create `src/player/playback.ts` — pure helpers: `clampSeek`, `formatTime`, skip-delta constants. (+ `playback.test.ts`)
- Create `src/player/PlayerBar.tsx` — presentational now-playing bar; all state + callbacks via props. (+ `PlayerBar.test.tsx`)
- Modify `src/views/AuthorDetailView.tsx` — add `onPlayChapter` prop + a per-chapter ▶ play button. (+ test update)
- Modify `src/lib/api.ts` — add `markChapterFinished` wrapper.
- Modify `src-tauri/src/commands.rs` — add `mark_chapter_finished` command + `pub(crate)` helper + test.
- Modify `src-tauri/src/lib.rs` — register `mark_chapter_finished`; export helper for tests.
- Modify `src/harness/walkthroughs.ts` — add `playerSteps` + extend `walkthroughs` list. (+ test update)
- Modify `src/App.tsx` — own the `<audio>` element + player state; render `PlayerBar`; wire `onPlayChapter`; on `ended` mark finished + refresh; dispatch the `player` walkthrough.
- Modify `src-tauri/tauri.conf.json` (final task) — restrict the asset-protocol scope to the library root at runtime (low-risk hardening with a documented fallback).
- Modify `README.md` (final task) — note playback shipped.

---

## Task 1: Rust `mark_chapter_finished` command

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the command + helper + test** to `src-tauri/src/commands.rs`.

Add this `#[tauri::command]` (next to the other commands):
```rust
#[tauri::command]
pub fn mark_chapter_finished(state: tauri::State<DbState>, chapter_id: i64, now_ms: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    mark_finished(&conn, chapter_id, now_ms).map_err(|e| e.to_string())
}
```

Add this `pub(crate)` helper (next to the other query helpers):
```rust
/// Atomically mark a chapter played and record a play event at `now_ms`.
pub(crate) fn mark_finished(conn: &rusqlite::Connection, chapter_id: i64, now_ms: i64) -> rusqlite::Result<()> {
    conn.execute("UPDATE chapters SET played=1 WHERE id=?1", params![chapter_id])?;
    conn.execute(
        "INSERT INTO play_events(chapter_id, played_at) VALUES (?1, ?2)",
        params![chapter_id, now_ms],
    )?;
    Ok(())
}
```

Add this test inside the existing `#[cfg(test)] mod tests` block in `commands.rs`:
```rust
    #[test]
    fn finishing_a_chapter_marks_played_and_records_event() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("A").join("X.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();
        let detail = query_author_detail(&conn, query_authors(&conn).unwrap()[0].id).unwrap();
        let ch = detail.works[0].chapters[0].id;

        super::mark_finished(&conn, ch, 1_700_000_000_000).unwrap();

        let played: i64 = conn.query_row("SELECT played FROM chapters WHERE id=?1", params![ch], |r| r.get(0)).unwrap();
        assert_eq!(played, 1);
        let events: i64 = conn.query_row(
            "SELECT count(*) FROM play_events WHERE chapter_id=?1 AND played_at=1700000000000",
            params![ch],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(events, 1);
    }
```

- [ ] **Step 2: Register the command and export the helper.** In `src-tauri/src/lib.rs`, add `commands::mark_chapter_finished` to the `tauri::generate_handler![ ... ]` list (after `set_chapter_played`). No change to `pub mod testing` is required (the test uses `super::mark_finished` within the crate).

- [ ] **Step 3: Run the Rust tests (FOREGROUND).**

Run:
```powershell
cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml commands"
```
Expected: the existing command tests plus `finishing_a_chapter_marks_played_and_records_event` all pass.

- [ ] **Step 4: Build the full app to confirm the handler compiles (FOREGROUND).**

Run:
```powershell
cmd /c "tools\dev-env.cmd cargo build --manifest-path src-tauri\Cargo.toml"
```
Expected: compiles.

- [ ] **Step 5: Commit.**

```powershell
git add -A; git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "feat: mark_chapter_finished command (played flag + play event)"
```

---

## Task 2: Pure playback helpers

**Files:**
- Create: `src/player/playback.ts`
- Create: `src/player/playback.test.ts`

- [ ] **Step 1: Write the failing test** (`src/player/playback.test.ts`).

```ts
import { describe, it, expect } from "vitest";
import { clampSeek, formatTime, SKIP_BACK_LARGE, SKIP_FWD_LARGE, SKIP_BACK_SMALL, SKIP_FWD_SMALL } from "./playback";

describe("clampSeek", () => {
  it("adds the delta within bounds", () => {
    expect(clampSeek(30, 15, 120)).toBe(45);
    expect(clampSeek(30, -15, 120)).toBe(15);
  });
  it("clamps to 0 at the low end", () => {
    expect(clampSeek(10, -30, 120)).toBe(0);
  });
  it("clamps to duration at the high end", () => {
    expect(clampSeek(110, 30, 120)).toBe(120);
  });
  it("does not clamp high when duration is unknown (0)", () => {
    expect(clampSeek(110, 30, 0)).toBe(140);
  });
});

describe("formatTime", () => {
  it("formats minutes and zero-padded seconds", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(600)).toBe("10:00");
  });
  it("treats non-finite or negative as 0:00", () => {
    expect(formatTime(NaN)).toBe("0:00");
    expect(formatTime(-5)).toBe("0:00");
  });
});

describe("skip constants", () => {
  it("are the expected ±15/±30 values", () => {
    expect([SKIP_BACK_LARGE, SKIP_BACK_SMALL, SKIP_FWD_SMALL, SKIP_FWD_LARGE]).toEqual([-30, -15, 15, 30]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails.**

Run: `npm test -- playback`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** (`src/player/playback.ts`).

```ts
export const SKIP_BACK_LARGE = -30;
export const SKIP_BACK_SMALL = -15;
export const SKIP_FWD_SMALL = 15;
export const SKIP_FWD_LARGE = 30;

/** Add `delta` seconds to `current`, clamped to [0, duration]. Duration <= 0 means unknown (no upper clamp). */
export function clampSeek(current: number, delta: number, duration: number): number {
  const t = current + delta;
  if (t < 0) return 0;
  if (duration > 0 && t > duration) return duration;
  return t;
}

/** Format seconds as "m:ss". Non-finite or negative inputs render as "0:00". */
export function formatTime(secs: number): string {
  const v = isFinite(secs) && secs > 0 ? secs : 0;
  const m = Math.floor(v / 60);
  const s = Math.floor(v % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run it to confirm it passes.**

Run: `npm test -- playback`
Expected: PASS.

- [ ] **Step 5: Commit.**

```powershell
git add -A; git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "feat: pure playback helpers (seek clamp, time format, skip deltas)"
```

---

## Task 3: `PlayerBar` presentational component

**Files:**
- Create: `src/player/PlayerBar.tsx`
- Create: `src/player/PlayerBar.test.tsx`

The bar is pure presentation: it receives all state and emits callbacks. It renders nothing when no chapter is loaded.

- [ ] **Step 1: Write the failing test** (`src/player/PlayerBar.test.tsx`).

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlayerBar } from "./PlayerBar";

function props(overrides = {}) {
  return {
    title: "Cool Story",
    hasChapter: true,
    isPlaying: false,
    currentTime: 30,
    duration: 120,
    volume: 1,
    sleepMinutes: null as number | null,
    onToggle: vi.fn(),
    onSeek: vi.fn(),
    onSkip: vi.fn(),
    onVolume: vi.fn(),
    onSetSleep: vi.fn(),
    ...overrides,
  };
}

describe("PlayerBar", () => {
  it("renders nothing when no chapter is loaded", () => {
    const { container } = render(<PlayerBar {...props({ hasChapter: false })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the title and current/total time", () => {
    render(<PlayerBar {...props()} />);
    expect(screen.getByText("Cool Story")).toBeInTheDocument();
    expect(screen.getByText("0:30 / 2:00")).toBeInTheDocument();
  });

  it("toggles play/pause", async () => {
    const p = props();
    render(<PlayerBar {...p} />);
    await userEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(p.onToggle).toHaveBeenCalled();
  });

  it("emits the four skip deltas", async () => {
    const p = props();
    render(<PlayerBar {...p} />);
    await userEvent.click(screen.getByRole("button", { name: "Back 30 seconds" }));
    await userEvent.click(screen.getByRole("button", { name: "Back 15 seconds" }));
    await userEvent.click(screen.getByRole("button", { name: "Forward 15 seconds" }));
    await userEvent.click(screen.getByRole("button", { name: "Forward 30 seconds" }));
    expect(p.onSkip.mock.calls.map((c) => c[0])).toEqual([-30, -15, 15, 30]);
  });

  it("sets a sleep timer from the selector", async () => {
    const p = props();
    render(<PlayerBar {...p} />);
    await userEvent.selectOptions(screen.getByLabelText("Sleep timer"), "30");
    expect(p.onSetSleep).toHaveBeenCalledWith(30);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails.**

Run: `npm test -- PlayerBar`
Expected: FAIL (component not found).

- [ ] **Step 3: Implement** (`src/player/PlayerBar.tsx`).

```tsx
import { formatTime, SKIP_BACK_LARGE, SKIP_BACK_SMALL, SKIP_FWD_SMALL, SKIP_FWD_LARGE } from "./playback";

export interface PlayerBarProps {
  title: string;
  hasChapter: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  sleepMinutes: number | null;
  onToggle: () => void;
  onSeek: (secs: number) => void;
  onSkip: (delta: number) => void;
  onVolume: (v: number) => void;
  onSetSleep: (minutes: number | null) => void;
}

export function PlayerBar(props: PlayerBarProps) {
  if (!props.hasChapter) return null;
  const { currentTime, duration } = props;
  return (
    <div className="player-bar">
      <span className="player-title">{props.title}</span>
      <div className="player-controls">
        <button aria-label="Back 30 seconds" onClick={() => props.onSkip(SKIP_BACK_LARGE)}>«30</button>
        <button aria-label="Back 15 seconds" onClick={() => props.onSkip(SKIP_BACK_SMALL)}>«15</button>
        <button aria-label={props.isPlaying ? "Pause" : "Play"} onClick={props.onToggle}>
          {props.isPlaying ? "❚❚" : "▶"}
        </button>
        <button aria-label="Forward 15 seconds" onClick={() => props.onSkip(SKIP_FWD_SMALL)}>15»</button>
        <button aria-label="Forward 30 seconds" onClick={() => props.onSkip(SKIP_FWD_LARGE)}>30»</button>
      </div>
      <input
        className="player-seek"
        type="range"
        aria-label="Seek"
        min={0}
        max={duration > 0 ? duration : 0}
        value={currentTime > duration ? duration : currentTime}
        onChange={(e) => props.onSeek(Number(e.target.value))}
      />
      <span className="player-time">{formatTime(currentTime)} / {formatTime(duration)}</span>
      <input
        className="player-volume"
        type="range"
        aria-label="Volume"
        min={0}
        max={1}
        step={0.01}
        value={props.volume}
        onChange={(e) => props.onVolume(Number(e.target.value))}
      />
      <label className="player-sleep">
        Sleep
        <select
          aria-label="Sleep timer"
          value={props.sleepMinutes ?? ""}
          onChange={(e) => props.onSetSleep(e.target.value === "" ? null : Number(e.target.value))}
        >
          <option value="">Off</option>
          <option value="15">15 min</option>
          <option value="30">30 min</option>
          <option value="60">60 min</option>
        </select>
      </label>
    </div>
  );
}
```

- [ ] **Step 4: Run it to confirm it passes.**

Run: `npm test -- PlayerBar`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit.**

```powershell
git add -A; git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "feat: presentational now-playing PlayerBar"
```

---

## Task 4: `api.ts` — markChapterFinished wrapper

**Files:**
- Modify: `src/lib/api.ts`

- [ ] **Step 1: Add the wrapper.** After `setChapterPlayed` in `src/lib/api.ts`, add:

```ts
export const markChapterFinished = (chapterId: number, nowMs: number) =>
  invoke("mark_chapter_finished", { chapterId, nowMs });
```

- [ ] **Step 2: Type-check.**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit.**

```powershell
git add -A; git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "feat: markChapterFinished invoke wrapper"
```

---

## Task 5: AuthorDetailView — per-chapter play button

**Files:**
- Modify: `src/views/AuthorDetailView.tsx`
- Modify: `src/views/AuthorDetailView.test.tsx`

- [ ] **Step 1: Update the test** (`src/views/AuthorDetailView.test.tsx`). Replace the two existing render calls so the component receives the new `onPlayChapter` prop, and add a play-button test. The full updated file:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthorDetailView } from "./AuthorDetailView";
import type { AuthorDetail } from "../lib/api";

const detail: AuthorDetail = {
  id: 1,
  name: "Jane Doe",
  works: [
    {
      id: 10,
      baseTitle: "Cool Story",
      chapters: [
        { id: 100, title: "Cool Story", chapterNo: 1, format: "mp3", durationSecs: 65, filePath: "x/Cool Story.mp3", played: false },
        { id: 101, title: "Cool Story 2 the sequel", chapterNo: 2, format: "mp3", durationSecs: 130, filePath: "x/Cool Story 2 the sequel.mp3", played: true },
      ],
    },
  ],
};

describe("AuthorDetailView", () => {
  it("renders works, chapters, and a played marker", () => {
    render(<AuthorDetailView detail={detail} onTogglePlayed={() => {}} onPlayChapter={() => {}} onBack={() => {}} />);
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Cool Story")).toBeInTheDocument();
    const ch2 = screen.getByText("Cool Story 2 the sequel").closest("li")!;
    expect(ch2).toHaveAttribute("data-played", "true");
  });

  it("toggles played when the checkbox is clicked", async () => {
    const onToggle = vi.fn();
    render(<AuthorDetailView detail={detail} onTogglePlayed={onToggle} onPlayChapter={() => {}} onBack={() => {}} />);
    await userEvent.click(screen.getByLabelText("Mark 'Cool Story' played"));
    expect(onToggle).toHaveBeenCalledWith(100, true);
  });

  it("plays a chapter when its play button is clicked", async () => {
    const onPlay = vi.fn();
    render(<AuthorDetailView detail={detail} onTogglePlayed={() => {}} onPlayChapter={onPlay} onBack={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Play 'Cool Story'" }));
    expect(onPlay).toHaveBeenCalledWith(detail.works[0].chapters[0]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails.**

Run: `npm test -- AuthorDetailView`
Expected: FAIL (the third test can't find the Play button; `onPlayChapter` prop unused).

- [ ] **Step 3: Implement.** Update `src/views/AuthorDetailView.tsx` to accept `onPlayChapter` and render a ▶ button per chapter. Add the `ChapterRow` import and the prop; add the button before the chapter title. Full file:

```tsx
import type { AuthorDetail, ChapterRow } from "../lib/api";

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function AuthorDetailView(props: {
  detail: AuthorDetail;
  onTogglePlayed: (chapterId: number, played: boolean) => void;
  onPlayChapter: (chapter: ChapterRow) => void;
  onBack: () => void;
}) {
  const { detail } = props;
  return (
    <div className="author-detail">
      <button onClick={props.onBack}>← Library</button>
      <h1>{detail.name}</h1>
      {detail.works.map((w) => (
        <section key={w.id} className="work">
          <h2><span className="work-title">{w.baseTitle}{" "}({w.chapters.length})</span></h2>
          <ul>
            {w.chapters.map((c) => (
              <li key={c.id} data-played={c.played ? "true" : "false"}>
                <button aria-label={`Play '${c.title}'`} onClick={() => props.onPlayChapter(c)}>▶</button>
                <label aria-label={`Mark '${c.title}' played`}>
                  <input
                    type="checkbox"
                    checked={c.played}
                    onChange={(e) => props.onTogglePlayed(c.id, e.target.checked)}
                  />
                </label>
                <span className="chapter-title">{c.title}</span>{" — "}
                <span className="chapter-duration">{formatDuration(c.durationSecs)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run it to confirm it passes.**

Run: `npm test -- AuthorDetailView`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit.**

```powershell
git add -A; git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "feat: per-chapter play button in author detail"
```

---

## Task 6: Harness — `player` walkthrough

**Files:**
- Modify: `src/harness/walkthroughs.ts`

- [ ] **Step 1: Add `playerSteps` and extend the walkthrough list.** Update `src/harness/walkthroughs.ts` to its full new contents:

```ts
import type { Step } from "./types";

/**
 * Build the "browse" walkthrough. The caller supplies navigation callbacks so
 * this stays free of React/DOM imports (and unit-testable). Each step leaves the
 * app on a distinct screen so the screenshot after it is meaningful.
 */
export function browseSteps(nav: {
  showScanResult: () => Promise<void>;
  showLibrary: () => Promise<void>;
  openFirstAuthor: () => Promise<void>;
}): Step[] {
  return [
    { name: "scan-result", run: nav.showScanResult },
    { name: "library", run: nav.showLibrary },
    { name: "author-detail", run: nav.openFirstAuthor },
  ];
}

/**
 * Build the "player" walkthrough: open the first author, then start playback of
 * its first chapter so the now-playing bar is captured.
 */
export function playerSteps(nav: {
  openFirstAuthor: () => Promise<void>;
  playFirstChapter: () => Promise<void>;
}): Step[] {
  return [
    { name: "author-detail", run: nav.openFirstAuthor },
    { name: "player", run: nav.playFirstChapter },
  ];
}

export const walkthroughs = ["browse", "player"] as const;
export type WalkthroughName = (typeof walkthroughs)[number];
```

- [ ] **Step 2: Type-check + run the existing harness tests.**

Run: `npx tsc --noEmit; npm test -- runner`
Expected: tsc clean; the runner tests still pass (they don't reference `playerSteps`, so no change needed there).

- [ ] **Step 3: Commit.**

```powershell
git add -A; git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "feat: player harness walkthrough steps"
```

---

## Task 7: App.tsx — wire the audio element, player state, and PlayerBar

**Files:**
- Modify: `src/App.tsx`

This is the integration task: it owns the `<audio>` element and player state, renders the persistent `PlayerBar`, starts playback from the author view, auto-marks a finished chapter, and dispatches the `player` walkthrough. (jsdom can't run media, so this is verified by the harness in Task 8, not a unit test.)

- [ ] **Step 1: Replace `src/App.tsx`** with the following. It extends the M1 routing with player state and the audio wiring.

```tsx
import { useEffect, useRef, useState } from "react";
import {
  getLaunchArgs, scanLibrary, getAuthors, getAuthorDetail,
  setChapterPlayed, markChapterFinished, captureWindow, finishWalkthrough, fileUrl,
  type AuthorRow, type AuthorDetail, type ChapterRow, type ScanResult,
} from "./lib/api";
import { LibraryView } from "./views/LibraryView";
import { AuthorDetailView } from "./views/AuthorDetailView";
import { ScanView } from "./views/ScanView";
import { PlayerBar } from "./player/PlayerBar";
import { clampSeek } from "./player/playback";
import { runSteps } from "./harness/runner";
import { browseSteps, playerSteps } from "./harness/walkthroughs";

// Wait for React to commit and the browser to paint before a harness screenshot.
function settle(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 60))),
  );
}

type Route =
  | { kind: "loading" }
  | { kind: "scan" }
  | { kind: "library" }
  | { kind: "author" };

export default function App() {
  const [route, setRoute] = useState<Route>({ kind: "loading" });
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [authors, setAuthors] = useState<AuthorRow[]>([]);
  const [detail, setDetail] = useState<AuthorDetail | null>(null);

  // ---- player state ----
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sleepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailRef = useRef<AuthorDetail | null>(null);
  detailRef.current = detail;
  const [current, setCurrent] = useState<ChapterRow | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [sleepMinutes, setSleepMinutes] = useState<number | null>(null);

  async function loadAuthors() {
    setAuthors(await getAuthors());
  }

  async function openAuthor(id: number) {
    setDetail(await getAuthorDetail(id));
    setRoute({ kind: "author" });
  }

  async function togglePlayed(chapterId: number, played: boolean) {
    await setChapterPlayed(chapterId, played);
    if (detailRef.current) setDetail(await getAuthorDetail(detailRef.current.id));
    await loadAuthors();
  }

  function playChapter(c: ChapterRow) {
    setCurrent(c);
    const audio = audioRef.current;
    if (audio) {
      audio.src = fileUrl(c.filePath);
      audio.load();
      void audio.play().catch(() => { /* autoplay may be blocked; bar still shows */ });
    }
  }

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => {});
    else audio.pause();
  }

  function seek(secs: number) {
    if (audioRef.current) audioRef.current.currentTime = secs;
  }

  function skip(delta: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = clampSeek(audio.currentTime, delta, audio.duration || 0);
  }

  function setVolume(v: number) {
    if (audioRef.current) audioRef.current.volume = v;
    setVolumeState(v);
  }

  function setSleep(minutes: number | null) {
    if (sleepTimerRef.current) {
      clearTimeout(sleepTimerRef.current);
      sleepTimerRef.current = null;
    }
    setSleepMinutes(minutes);
    if (minutes) {
      sleepTimerRef.current = setTimeout(() => {
        audioRef.current?.pause();
        setSleepMinutes(null);
      }, minutes * 60_000);
    }
  }

  async function handleEnded() {
    setIsPlaying(false);
    const c = current;
    if (!c) return;
    await markChapterFinished(c.id, Date.now());
    if (detailRef.current) setDetail(await getAuthorDetail(detailRef.current.id));
    await loadAuthors();
    // Stop after each chapter — no auto-advance.
  }

  useEffect(() => {
    (async () => {
      const args = await getLaunchArgs();
      if (args.library) {
        setRoute({ kind: "scan" });
        const result = await scanLibrary(args.library);
        setScan(result);
        await loadAuthors();
      } else {
        await loadAuthors();
      }

      if (args.autostart && args.walkthrough) {
        const openFirstAuthor = async () => {
          const list = await getAuthors();
          if (list.length > 0) await openAuthor(list[0].id);
        };
        const steps =
          args.walkthrough === "player"
            ? playerSteps({
                openFirstAuthor,
                playFirstChapter: async () => {
                  const d = detailRef.current;
                  const first = d?.works[0]?.chapters[0];
                  if (first) playChapter(first);
                },
              })
            : browseSteps({
                showScanResult: async () => setRoute({ kind: "scan" }),
                showLibrary: async () => setRoute({ kind: "library" }),
                openFirstAuthor,
              });
        await runSteps(steps, args.shots, async (p) => { await settle(); await captureWindow(p); });
        await finishWalkthrough(args.doneSignal, args.exitWhenDone);
      } else {
        setRoute({ kind: "library" });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function routedView() {
    if (route.kind === "loading") return <div>Loading…</div>;
    if (route.kind === "scan") return <ScanView result={scan} />;
    if (route.kind === "author" && detail) {
      return (
        <AuthorDetailView
          detail={detail}
          onTogglePlayed={togglePlayed}
          onPlayChapter={playChapter}
          onBack={() => setRoute({ kind: "library" })}
        />
      );
    }
    return <LibraryView authors={authors} onOpenAuthor={openAuthor} />;
  }

  return (
    <div className="app">
      {routedView()}
      <audio
        ref={audioRef}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onEnded={handleEnded}
      />
      <PlayerBar
        title={current?.title ?? ""}
        hasChapter={current !== null}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        volume={volume}
        sleepMinutes={sleepMinutes}
        onToggle={toggle}
        onSeek={seek}
        onSkip={skip}
        onVolume={setVolume}
        onSetSleep={setSleep}
      />
    </div>
  );
}
```

- [ ] **Step 2: Type-check, run the full JS suite, and build.**

Run:
```powershell
npx tsc --noEmit; npm test; npm run build
```
Expected: tsc clean; all Vitest tests pass; `vite build` succeeds.

- [ ] **Step 3: Commit.**

```powershell
git add -A; git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "feat: wire audio element, player state, and persistent PlayerBar"
```

---

## Task 8: Visual self-verification (browse + player walkthroughs)

**Files:** none (verification task; fixes go to the relevant file if defects are found).

- [ ] **Step 1: Run the browse walkthrough** to confirm M1 screens still render after the App changes.

Run:
```powershell
powershell -ExecutionPolicy Bypass -File tools\verify.ps1 -Walkthrough browse
```
Expected: `WALKTHROUGH OK`; screenshots in `.shots\browse\`. Open `02-library.png` and `03-author-detail.png` and confirm the library list and author detail still render (the author detail now also shows a ▶ play button per chapter).

- [ ] **Step 2: Run the player walkthrough.**

Run:
```powershell
powershell -ExecutionPolicy Bypass -File tools\verify.ps1 -Walkthrough player
```
Expected: `WALKTHROUGH OK`; screenshots in `.shots\player\`: `01-author-detail.png` and `02-player.png`. Open `02-player.png` and confirm the now-playing **PlayerBar is visible** with the chapter title, play/pause + skip buttons, a seek bar, current/total time, a volume control, and the sleep-timer selector.

- [ ] **Step 3: Fix any UI defect discovered** (e.g. the bar not visible, controls missing, time wrong) in the relevant file, then re-run the affected walkthrough until clean. (Note: programmatic autoplay may be blocked in the WebView — the bar must still render in its paused state with the loaded chapter, which is what the screenshot verifies.)

- [ ] **Step 4: Commit** any fixes.

```powershell
git add -A; git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "fix: player UI defects found in visual verification"
```
(If no fixes were needed, skip this commit.)

---

## Task 9: Restrict the asset-protocol scope to the library root (hardening)

**Files:**
- Modify: `src-tauri/src/commands.rs` (or `lib.rs`) and `src-tauri/tauri.conf.json`

The M1 review flagged the asset-protocol scope as `["**"]`. Now that `<audio>` loads files via `convertFileSrc`, narrow it: keep the static scope empty and grant the scanned library root at runtime when scanning.

- [ ] **Step 1: Grant the library directory to the asset scope on scan.** In `scan_library` (commands.rs), after a successful scan, add the root to the asset protocol scope:

```rust
// At the top of scan_library, change the signature to take the app handle:
#[tauri::command]
pub fn scan_library(app: tauri::AppHandle, state: tauri::State<DbState>, root: String) -> Result<ScanResult, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let report = scan::scan_into(&conn, std::path::Path::new(&root)).map_err(|e| e.to_string())?;
    // Allow the WebView <audio> element to load files under the library root only.
    let _ = app.asset_protocol_scope().allow_directory(&root, true);
    Ok(report)
}
```

- [ ] **Step 2: Narrow the static scope.** In `src-tauri/tauri.conf.json`, change `assetProtocol.scope` from `["**"]` to `[]` (runtime grant covers the library root).

- [ ] **Step 3: Build + run the player walkthrough to confirm audio still loads (FOREGROUND).**

Run:
```powershell
cmd /c "tools\dev-env.cmd cargo build --manifest-path src-tauri\Cargo.toml"
powershell -ExecutionPolicy Bypass -File tools\verify.ps1 -Walkthrough player
```
Expected: build OK; `WALKTHROUGH OK`; `02-player.png` still shows the bar with the loaded chapter.

> **Fallback (documented):** If `asset_protocol_scope()`/`allow_directory` is unavailable or differs in this Tauri 2 version and audio fails to load, revert `tauri.conf.json` scope to `["**"]` and leave a `// TODO: narrow asset scope` note. This is acceptable for a local single-user tool; do not block the milestone on it. Record the outcome in the commit message.

- [ ] **Step 4: Commit.**

```powershell
git add -A; git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "harden: restrict asset-protocol scope to the scanned library root"
```

---

## Task 10: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the feature/roadmap sections** of `README.md` to reflect that playback shipped: the now-playing bar with play/pause, seek, skip ±15/30s, volume, and sleep timer; chapters auto-mark played on finish; playback stops after each chapter (no auto-advance). Move M2 from the roadmap's "planned" list to "shipped".

- [ ] **Step 2: Commit.**

```powershell
git add -A; git -c user.name="Yovan" -c user.email="yovanfly@gmail.com" commit -m "docs: README playback (M2) update"
```

---

## Self-Review (against the spec §9 — Playback)

- Play/pause + draggable seek bar with current/total time → PlayerBar (seek range, `formatTime` current/duration), Task 3. ✓
- Skip ±15s and ±30s → four skip buttons + `clampSeek`, Tasks 2–3. ✓
- Volume control → PlayerBar volume range + `setVolume`, Tasks 3,7. ✓
- Sleep timer (auto-stop after N min) → PlayerBar selector + `setSleep` timeout, Tasks 3,7. ✓
- Stops after each chapter; no auto-advance/queue → `handleEnded` marks finished and stops, Task 7. ✓
- No per-second resume → only played/unplayed tracked; no position persistence. ✓
- Auto-mark played on finish + manual toggle → `mark_chapter_finished` (Task 1) on `ended`; manual checkbox retained (Task 5). ✓
- Records a play event for discovery (M3 input) → `play_events` insert in `mark_finished`, Task 1. ✓
- No playback-speed/pitch → not implemented (out of scope). ✓
- Read-only guarantee preserved → only DB writes (played/play_events) + harness files; no audio-file writes. The asset-scope change (Task 9) is read access only. ✓

**Placeholder scan:** none — every code step has complete code; Task 9 has an explicit documented fallback, not a TODO-in-lieu-of-work.

**Type consistency:** `ChapterRow` (api.ts) is the type passed through `onPlayChapter` (AuthorDetailView, App) and `playChapter`; `markChapterFinished(chapterId, nowMs)` matches the Rust `mark_chapter_finished(chapter_id, now_ms)` (Tauri camel→snake); `PlayerBar` prop names match App's usage; `playerSteps`/`browseSteps` signatures match App's calls.
