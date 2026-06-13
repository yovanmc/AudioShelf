# M24 — The Listening Loop & Player

> **Written for Sonnet execution. If something doesn't match what you find in the code, STOP and report rather than guess.** Every file path, symbol, and line anchor below was captured from the live tree on 2026-06-13 (post‑M23, schema v8). Line numbers drift as you edit — anchor edits on the quoted *code*, not the line number.

## Context & invariants

AudioShelf is a Tauri 2 + React 18 + TS + SQLite (rusqlite) Windows app for short‑form spoken audio. M24 is the **listening‑loop & player** milestone of v6 (UX/UI coherence). It ships **all 10 player findings (PL‑1…PL‑10)** from the [v6 UX/UI backlog](../specs/2026-06-13-audioshelf-v6-ux-ui-backlog.md) **broad in one milestone**, plus the **owner‑approved fold‑in of per‑second mid‑chapter resume** (the first schema migration since M21).

**Owner decisions (2026-06-13, AskUserQuestion):**
1. **Fold in per‑second mid‑chapter resume** → additive schema **v9** (`chapters.playback_position_secs`). Resume position is *applied when a chapter loads* but never changes the no‑autoplay behavior (it only changes *where* a chapter starts, never *whether* playback begins on its own).
2. **All 10 PL findings, broad** (matches the M16–M21 pattern).

**Hard invariants (the "done" gate — verify before claiming complete):**
- **Schema v9 is purely ADDITIVE** on the M16 `run_step`/`user_version` runner (one `ALTER TABLE … ADD COLUMN`; `SCHEMA_V1` untouched; no FK‑off table rebuild).
- **No new crate / npm dep.** `git diff --stat main` of `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `package.json`, `package-lock.json` must be **empty**. (Playback speed persists via the existing `settings` table; resume via the new column; no charting/audio libs.)
- **Read‑only‑on‑disk preserved.** Every new write targets SQLite (settings rows / the new chapter column / play_events). Rename stays the sole audio‑file mutation. No file export added this milestone.
- **Fixtures stay 43/44/47.** All M24 state is seeded at runtime in the walkthrough; `fixture_scan.rs` untouched.
- Dark‑first M12 design system; no light/contrast regressions.
- **Non‑goals still hold: NO autoplay / up‑next auto‑advance.** Every "play next chapter" / end‑of‑work action is **user‑initiated** (a button), never automatic.

**Conventions (from ROADMAP.md):**
- Cargo via the Bash tool with **`cmd //c`** (Git‑Bash mangles `cmd /c` → use the double slash): `cmd //c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml"`. Or run via the PowerShell tool: `cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml"`.
- Gates: `npx tsc --noEmit` · `npm test` · `cargo test` · `tools\verify.ps1 -Walkthrough <name>`.
- `npm run build` before any `cargo tauri build`. The screenshot harness runs the **frozen** `cargo tauri build --debug` exe — a plain `cargo build`/`cargo test`/`tauri dev` re‑overwrites it into a **dev‑mode** exe that shows "localhost refused to connect". So: build frozen, capture, and do NOT run `cargo test`/`tauri dev` between the frozen build and `verify.ps1 -SkipBuild` (or just run `verify.ps1` without `-SkipBuild`, which does its own frozen build).
- Commits: repo identity `yovanmc <yovanmc@users.noreply.github.com>`; per workspace `AGENTS.md` append `Co-authored-by: Codex <noreply@openai.com>` after a blank line on substantive commits.
- CI `build-and-test` on windows‑latest; merge `--merge --delete-branch`; FOREGROUND `gh pr checks <PR#> --watch`.

**Execution order:** backend first (Rust, serialized on shared files), then the shared FE helpers, then App.tsx wiring, then the player components, then the three view tweaks, then CSS, then harness + verify. One commit per task. Do not pause between tasks.

---

## Task 1 — Schema v9: `chapters.playback_position_secs` + save/clear commands

**Goal:** Add the additive column, surface it on `ChapterRow`, add a `save_playback_position` command, and clear it when a chapter is finished. Bump `LATEST`→9 and update all hardcoded version asserts.

### 1a. `src-tauri/src/db.rs`

Bump the const:
```rust
pub(crate) const LATEST: i64 = 9;
```

Add the migration function next to `migration_v8_metadata` (model it on `migration_v3_metadata_source`):
```rust
fn migration_v9_playback_position(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "ALTER TABLE chapters ADD COLUMN playback_position_secs INTEGER NOT NULL DEFAULT 0;",
    )
}
```

Wire it into `migrate()` — insert **after** the `if current < 8 { … }` line and **before** the `INSERT OR REPLACE INTO settings(... 'schema_version' ...)` block:
```rust
    if current < 9 { run_step(conn, 9, migration_v9_playback_position)?; }
```

Wire it into `open_at_version()` — insert after the `if version >= 8 { … }` line:
```rust
    if version >= 9 { run_step(&conn, 9, migration_v9_playback_position)?; }
```

**Bump the hardcoded asserts** (all currently `8` → `9`). In `db.rs` tests, change each of these `assert_eq!(…, 8)` to `9`:
- `migrate_sets_user_version`, `migrate_from_v1_is_noop_when_current`, `legacy_db_with_v1_tables_user_version_0_upgrades`, `open_in_memory_has_v2_tables_and_user_version_8` (also rename → `…_user_version_9`), `upgrade_from_v1_to_v2`, `upgrade_from_v2`, `upgrade_from_v3`, `upgrade_from_v4`, `legacy_db_upgrades_through_v6`.
- **`open_at_version_8_reaches_latest`** (the `assert_eq!(v, LATEST)` now breaks because `open_at_version(8)` yields 8). Rename it to `open_at_version_9_reaches_latest`, call `open_at_version(9)`, assert `v == 9` and `v == LATEST`.
- Leave the *intermediate* asserts inside `migration_v8_adds_metadata_tables_and_is_additive` (which check v8 == 8 mid‑migration) unchanged — those assert a specific step, not LATEST.

**Add two new tests** in the `db.rs` test module (model them on `migration_v8_adds_metadata_tables_and_is_additive` + the existing `open_at_version_*` tests):
```rust
#[test]
fn migration_v9_adds_playback_position_and_is_additive() {
    let conn = open_at_version(8).unwrap();
    // v8 chapters has no playback_position_secs column.
    assert!(conn
        .prepare("SELECT playback_position_secs FROM chapters")
        .is_err());
    run_step(&conn, 9, migration_v9_playback_position).unwrap();
    // Now the column exists and defaults to 0.
    let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(v, 9);
    // Column is queryable (no rows is fine).
    conn.prepare("SELECT playback_position_secs FROM chapters").unwrap();
}

#[test]
fn open_at_version_9_reaches_latest() {
    let conn = open_at_version(9).unwrap();
    let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(v, 9);
    assert_eq!(v, LATEST);
}
```
> The `schema_creates_all_tables_including_transcripts` test asserts a **table** count (14). A new *column* does NOT add a table — leave that assert at 14. If it fails, STOP and report.

### 1b. `src-tauri/src/model.rs`

Add the field to `ChapterRow` (after `metadata`):
```rust
    pub metadata: Vec<MetaTag>,
    pub playback_position_secs: i64,
```

### 1c. `src-tauri/src/commands.rs`

**Both `ChapterRow` literal sites** must add the column to the SELECT and the struct literal. There are exactly two (grep‑verified): `query_author_detail` (the `SELECT id, raw_filename, … is_favorite FROM chapters WHERE work_id=?1 AND status='active'`) and `load_chapter_row` (`… FROM chapters WHERE id=?1`).

For **each** site: append `, playback_position_secs` to the SELECT column list (it becomes index 10), and add to the `ChapterRow { … }` literal:
```rust
                    metadata: Vec::new(),
                    playback_position_secs: r.get::<_, i64>(10).unwrap_or(0),
```
> In `load_chapter_row` the indices are identical (id=0 … is_favorite=9), so `playback_position_secs` is also index 10. Double‑check the column order matches the `r.get(N)` indices at each site.

**Clear position on finish** — in `mark_finished`, reset the column to 0 so a *finished* chapter never resumes mid‑way:
```rust
pub(crate) fn mark_finished(conn: &rusqlite::Connection, chapter_id: i64, now_ms: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE chapters SET played=1, playback_position_secs=0 WHERE id=?1",
        params![chapter_id],
    )?;
    conn.execute(
        "INSERT INTO play_events(chapter_id, played_at) VALUES (?1, ?2)",
        params![chapter_id, now_ms],
    )?;
    Ok(())
}
```

**Add the save command** (model on `mark_chapter_finished`). Clamp to ≥ 0:
```rust
#[tauri::command]
pub fn save_playback_position(state: tauri::State<DbState>, chapter_id: i64, secs: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let secs = secs.max(0);
    conn.execute(
        "UPDATE chapters SET playback_position_secs=?2 WHERE id=?1",
        params![chapter_id, secs],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}
```

### 1d. Register the command

In `src-tauri/src/lib.rs` (or wherever `tauri::generate_handler![…]` lists commands — grep `mark_chapter_finished` to find the list), add `save_playback_position` to the handler list. Mirror the existing entry exactly.

### 1e. Bump the `commands.rs` test asserts

Change `assert_eq!(ver, 8)` / `assert_eq!(full_ver, 8)` → `9` in: the full‑open taxonomy test (`assert_eq!(ver, 8)`), `migration_v2_lacks_metadata_source_column_then_v3_adds_it`, and `migration_v3_lacks_series_then_v4_adds_them`. (Grep `, 8);` and ` 8);` in `commands.rs` test module to confirm you caught all three; do not touch reads that don't assert a literal.)

**Verify (Task 1):**
```
cmd //c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml"
```
Expect: all green, including the two new v9 tests. Then confirm additivity gate:
```
git -C "C:\Agent Projects\AudioShelf" diff --stat main -- src-tauri/Cargo.toml src-tauri/Cargo.lock
```
Expect: **empty** output.

---

## Task 2 — `src/player/playback.ts`: fix `−0:00`, add speed helpers

**Goal:** Fix PL‑9's `−0:00` bug and add the speed vocabulary used by PL‑1.

Replace the **entire file** with:
```ts
export const SKIP_BACK_LARGE = -30;
export const SKIP_BACK_SMALL = -15;
export const SKIP_FWD_SMALL = 15;
export const SKIP_FWD_LARGE = 30;

/** Selectable playback speeds (PL-1). 1 is normal. */
export const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;

/** Next speed in the cycle, wrapping back to the first. */
export function nextSpeed(current: number): number {
  const i = SPEEDS.findIndex((s) => s === current);
  return SPEEDS[(i + 1) % SPEEDS.length] ?? 1;
}

/** Format a speed multiplier, e.g. 1 → "1×", 1.25 → "1.25×". */
export function formatSpeed(v: number): string {
  return `${v}×`;
}

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

/** Time remaining as "-m:ss" (e.g. "-1:30"); non-positive duration OR zero remaining → "0:00" (never "-0:00"). */
export function formatTimeLeft(currentTime: number, duration: number): string {
  if (!Number.isFinite(duration) || duration <= 0) return "0:00";
  const left = Math.max(0, duration - currentTime);
  if (left < 1) return "0:00"; // PL-9: never render "-0:00"
  return `-${formatTime(left)}`;
}

/** Whole-percent progress as "NN%"; non-positive duration → "0%". */
export function formatPercent(currentTime: number, duration: number): string {
  if (!Number.isFinite(duration) || duration <= 0) return "0%";
  const pct = Math.min(100, Math.max(0, Math.round((currentTime / duration) * 100)));
  return `${pct}%`;
}

export type TimeLabelMode = "elapsed" | "remaining" | "percent";

export function timeLabel(mode: TimeLabelMode, currentTime: number, duration: number): string {
  if (mode === "remaining") return formatTimeLeft(currentTime, duration);
  if (mode === "percent") return formatPercent(currentTime, duration);
  return formatTime(currentTime);
}
```

**Add/extend unit tests** in `src/player/playback.test.ts` (create if absent; if it exists, append). Cover the PL‑9 regression explicitly:
```ts
import { describe, it, expect } from "vitest";
import { formatTimeLeft, nextSpeed, formatSpeed, SPEEDS } from "./playback";

describe("formatTimeLeft (PL-9 no -0:00)", () => {
  it("renders 0:00 (not -0:00) when at/after the end", () => {
    expect(formatTimeLeft(60, 60)).toBe("0:00");
    expect(formatTimeLeft(61, 60)).toBe("0:00");
    expect(formatTimeLeft(59.6, 60)).toBe("0:00"); // <1s left
  });
  it("renders negative remaining mid-chapter", () => {
    expect(formatTimeLeft(30, 90)).toBe("-1:00");
  });
});

describe("speed helpers (PL-1)", () => {
  it("cycles through SPEEDS and wraps", () => {
    expect(nextSpeed(0.75)).toBe(1);
    expect(nextSpeed(2)).toBe(SPEEDS[0]);
    expect(nextSpeed(999)).toBe(SPEEDS[0]); // unknown → first
  });
  it("formats a multiplier", () => {
    expect(formatSpeed(1.25)).toBe("1.25×");
  });
});
```

**Verify (Task 2):** `npx tsc --noEmit` and `npm test -- playback` both green.

---

## Task 3 — `src/lib/api.ts`: TS type + invoke wrapper

**Goal:** Mirror the new column on the TS side and add the save wrapper.

1. Find `export interface ChapterRow` (camelCase mirror) and add:
```ts
  playbackPositionSecs: number;
```
> If any TS test or harness constructs a `ChapterRow` object literal, this new required field will trip `tsc`. Grep `chapterNo:` across `src/` to find literal builders (harness fixtures, tests) and add `playbackPositionSecs: 0` to each. (Do NOT make the field optional — keep parity with the Rust struct.)

2. Add the invoke wrapper next to `markChapterFinished` (grep `markChapterFinished` in `api.ts` and copy its `invoke` shape exactly — same import, same error handling):
```ts
export async function savePlaybackPosition(chapterId: number, secs: number): Promise<void> {
  await invoke("save_playback_position", { chapterId, secs });
}
```
> Match the existing camelCase→snake arg convention used by sibling wrappers (Tauri maps `chapterId`→`chapter_id` automatically with the default; verify by how `markChapterFinished` passes `chapterId`/`nowMs`).

**Verify (Task 3):** `npx tsc --noEmit` green; `npm test` green.

---

## Task 4 — App.tsx: playback speed, mute, sleep countdown + end‑of‑chapter, per‑second resume, position saving

**Goal:** All the App‑level state/handlers the components need. Anchor each edit on the quoted current code.

### 4a. New state + refs (in the playback state block, near `const [timeLabelMode, …]`)
Add:
```tsx
  const [playbackSpeed, setPlaybackSpeedState] = useState(1);
  const playbackSpeedRef = useRef(1);
  playbackSpeedRef.current = playbackSpeed;
  const [muted, setMuted] = useState(false);
  const [sleepRemaining, setSleepRemaining] = useState<number | null>(null);
  const [sleepAtChapterEnd, setSleepAtChapterEnd] = useState(false);
  const sleepAtChapterEndRef = useRef(false);
  sleepAtChapterEndRef.current = sleepAtChapterEnd;
  const sleepIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPosSaveRef = useRef(0); // wall-clock ms of last persisted position
```

### 4b. Speed setter (mirror `setVolume`)
Add near `setVolume`:
```tsx
  function setPlaybackSpeed(v: number) {
    if (audioRef.current) audioRef.current.playbackRate = v;
    setPlaybackSpeedState(v);
    void setSetting("playback_speed", String(v));
  }
```

### 4c. Mute toggle (use `audio.muted`, preserve the volume slider)
Add near `setVolume`:
```tsx
  function toggleMute() {
    const audio = audioRef.current;
    const next = !muted;
    setMuted(next);
    if (audio) audio.muted = next;
  }
```

### 4d. Replace `setSleep` to add the countdown + "end of chapter" mode
Replace the current `setSleep` with:
```tsx
  function setSleep(minutes: number | null, atChapterEnd = false) {
    if (sleepTimerRef.current) { clearTimeout(sleepTimerRef.current); sleepTimerRef.current = null; }
    if (sleepIntervalRef.current) { clearInterval(sleepIntervalRef.current); sleepIntervalRef.current = null; }
    setSleepAtChapterEnd(atChapterEnd);
    if (atChapterEnd) { setSleepMinutes(null); setSleepRemaining(null); return; }
    setSleepMinutes(minutes);
    if (minutes) {
      const deadline = Date.now() + minutes * 60_000;
      setSleepRemaining(minutes * 60);
      sleepTimerRef.current = setTimeout(() => {
        audioRef.current?.pause();
        setSleepMinutes(null);
        setSleepRemaining(null);
        if (sleepIntervalRef.current) { clearInterval(sleepIntervalRef.current); sleepIntervalRef.current = null; }
      }, minutes * 60_000);
      sleepIntervalRef.current = setInterval(() => {
        const rem = Math.max(0, Math.round((deadline - Date.now()) / 1000));
        setSleepRemaining(rem);
        if (rem <= 0 && sleepIntervalRef.current) { clearInterval(sleepIntervalRef.current); sleepIntervalRef.current = null; }
      }, 1000);
    } else {
      setSleepRemaining(null);
    }
  }
```

### 4e. Per‑second resume in `playChapter`
Replace `playChapter` with (only the seek‑seed line is new; preserves bookmark precedence by not clobbering a pending bookmark seek):
```tsx
  function playChapter(context: PlaybackContext) {
    setCurrent(context);
    const audio = audioRef.current;
    if (audio) {
      // Per-second resume (M24): seed a resume seek only if no bookmark seek is already pending.
      const resumeAt = context.chapter.playbackPositionSecs;
      if (pendingSeekRef.current == null && resumeAt > 1) pendingSeekRef.current = resumeAt;
      audio.src = fileUrl(context.chapter.filePath);
      audio.load();
      void audio.play().catch(() => { /* autoplay may be blocked; bar still shows */ });
    }
  }
```

### 4f. Re‑apply speed on load (the `<audio>` `onLoadedMetadata` handler)
In the `onLoadedMetadata` handler, after `setDuration(...)` and the pending‑seek block, re‑apply the persisted rate (loading a new resource can reset `playbackRate`):
```tsx
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration || 0);
          if (pendingSeekRef.current != null) {
            try { e.currentTarget.currentTime = pendingSeekRef.current; } catch {}
            pendingSeekRef.current = null;
          }
          e.currentTarget.playbackRate = playbackSpeedRef.current;
          e.currentTarget.muted = muted;
        }}
```

### 4g. Save position throttled (`onTimeUpdate`) + on pause
In the `<audio>` `onTimeUpdate` handler, after `setCurrentTime(t)` and the mediaSession block, add a throttled save (every ~10s while a chapter is loaded and not yet finished):
```tsx
          const cur = currentRef.current;
          if (cur && t > 0 && Date.now() - lastPosSaveRef.current > 10_000) {
            lastPosSaveRef.current = Date.now();
            void savePlaybackPosition(cur.chapter.id, Math.floor(t));
          }
```
Change `onPause` to flush the latest position:
```tsx
        onPause={() => {
          setIsPlaying(false);
          const cur = currentRef.current;
          const audio = audioRef.current;
          if (cur && audio && audio.currentTime > 0) {
            void savePlaybackPosition(cur.chapter.id, Math.floor(audio.currentTime));
          }
        }}
```
> Import `savePlaybackPosition` from `./lib/api` (add to the existing api import line — grep `markChapterFinished` in App.tsx's import block).

### 4h. Disarm end‑of‑chapter sleep in `handleEnded`
At the top of `handleEnded`, after `setIsPlaying(false)`:
```tsx
    if (sleepAtChapterEndRef.current) {
      audioRef.current?.pause();
      setSleepAtChapterEnd(false);
    }
```
> `mark_finished` already zeroes `playback_position_secs` server‑side (Task 1c), so a finished chapter won't resume mid‑way. No FE reset needed.

### 4i. Load `playback_speed` on boot
In the settings load block (the `await getSetting("…")` cluster), add:
```tsx
      { const s = parseFloat((await getSetting("playback_speed")) ?? ""); setPlaybackSpeedState(Number.isFinite(s) && s > 0 ? s : 1); }
```

**Verify (Task 4):** `npx tsc --noEmit` green (component prop wiring in Tasks 5–6 will satisfy the new callbacks; if tsc complains about unused locals like `setPlaybackSpeed`/`toggleMute` before those tasks, that's expected — they're consumed at the render sites in Task 4j). 

### 4j. Pass the new props at the render sites
At `<PlayerBar … />` add:
```tsx
      playbackSpeed={playbackSpeed}
      onCycleSpeed={() => setPlaybackSpeed(nextSpeed(playbackSpeed))}
      muted={muted}
      onToggleMute={toggleMute}
      sleepRemaining={sleepRemaining}
      sleepAtChapterEnd={sleepAtChapterEnd}
      onOpenChapters={() => setPlayerExpanded(true)}
```
At `<NowPlayingPanel … />` add:
```tsx
      playbackSpeed={playbackSpeed}
      onSetSpeed={setPlaybackSpeed}
      muted={muted}
      onToggleMute={toggleMute}
      sleepRemaining={sleepRemaining}
      sleepAtChapterEnd={sleepAtChapterEnd}
      onPlayNextChapter={() => playNextChapterRef.current()}
      onMarkComplete={() => { const c = currentRef.current; if (c) void markChapterFinished(c.chapter.id, Date.now()).then(() => { void loadAuthors(); }); }}
      canPlayNext={(() => { const c = currentRef.current; return !!c && c.chapter.chapterNo < c.workTotalChapters; })()}
```
> Import `nextSpeed` from `./player/playback` (add to the existing playback import line). Keep the existing props on both sites.

**Verify (Task 4 final):** after Tasks 5–6, `npx tsc --noEmit` + `npm test` green.

---

## Task 5 — `src/player/PlayerBar.tsx`: speed, mute, sleep countdown, chapters button, scrubber, pop‑out

**Goal:** PL‑1 (speed), PL‑6 (chapters button), PL‑7 (countdown), PL‑8 (mute), PL‑9 (scrubber), PL‑10 (distinct expand).

Extend `PlayerControls` (add optional fields so existing call sites/tests don't break):
```ts
export interface PlayerControls {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  sleepMinutes: number | null;
  onToggle: () => void;
  onSeek: (secs: number) => void;
  onSkip: (delta: number) => void;
  onVolume: (value: number) => void;
  onSetSleep: (minutes: number | null, atChapterEnd?: boolean) => void;
  // M24 additions
  playbackSpeed?: number;
  muted?: boolean;
  onToggleMute?: () => void;
  sleepRemaining?: number | null;
  sleepAtChapterEnd?: boolean;
}
```
Extend `PlayerBarProps`:
```ts
export interface PlayerBarProps extends PlayerControls {
  context: PlaybackContext | null;
  onExpand: () => void;
  onOpenAuthor: (authorId: number) => void;
  timeLabelMode?: TimeLabelMode;
  onCycleTimeLabel?: () => void;
  onCycleSpeed?: () => void;     // M24 (PL-1)
  onOpenChapters?: () => void;   // M24 (PL-6)
}
```
Update the import to include the speed helper + formatTime:
```ts
import { formatTime, formatSpeed, timeLabel, type TimeLabelMode, SKIP_BACK_LARGE, SKIP_BACK_SMALL, SKIP_FWD_SMALL, SKIP_FWD_LARGE } from "./playback";
```

Rewrite the seek + utility regions of the rendered bar. Replace the `<div className="player-bar__seek">…</div>` and `<div className="player-bar__utility">…</div>` with:
```tsx
        <div className="player-bar__seek">
          <button type="button" className="time-label" title="Toggle time display" onClick={props.onCycleTimeLabel}>
            {timeLabel(props.timeLabelMode ?? "elapsed", props.currentTime, props.duration)}
          </button>
          <input className="seek-range" type="range" aria-label="Seek" min={0} max={props.duration > 0 ? props.duration : 0} value={Math.min(props.currentTime, props.duration)} onChange={(event) => props.onSeek(Number(event.target.value))} />
          <span>{formatTime(props.duration)}</span>
        </div>
      </div>
      <div className="player-bar__utility">
        {props.onCycleSpeed && (
          <button type="button" className="speed-btn" title="Playback speed" aria-label={`Playback speed ${formatSpeed(props.playbackSpeed ?? 1)}`} onClick={props.onCycleSpeed}>
            {formatSpeed(props.playbackSpeed ?? 1)}
          </button>
        )}
        {props.onToggleMute && (
          <IconButton icon={props.muted ? "mute" : "volume"} label={props.muted ? "Unmute" : "Mute"} onClick={props.onToggleMute} />
        )}
        <input className="volume-range" type="range" aria-label="Volume" min={0} max={1} step={.01} value={props.muted ? 0 : props.volume} onChange={(event) => props.onVolume(Number(event.target.value))} />
        <select aria-label="Sleep timer" value={props.sleepAtChapterEnd ? "chapter" : (props.sleepMinutes ?? "")} onChange={(event) => {
          const v = event.target.value;
          if (v === "chapter") props.onSetSleep(null, true);
          else props.onSetSleep(v ? Number(v) : null, false);
        }}>
          <option value="">Sleep off</option><option value="15">15 min</option><option value="30">30 min</option><option value="60">60 min</option><option value="chapter">End of chapter</option>
        </select>
        {(props.sleepRemaining != null || props.sleepAtChapterEnd) && (
          <span className="sleep-countdown muted" aria-live="polite">{props.sleepAtChapterEnd ? "until end" : formatTime(props.sleepRemaining ?? 0)}</span>
        )}
        {props.onOpenChapters && (
          <IconButton icon="list" label="Chapters" onClick={props.onOpenChapters} />
        )}
        <IconButton icon="expand" label="Expand now playing" onClick={props.onExpand} />
      </div>
```
> Keep the `<div>` nesting balanced — the first `</div>` above closes the controls/seek wrapper opened earlier; match the current structure. If the bracket balance is unclear, STOP and re‑read the current JSX before editing.

**Icons:** `mute`, `volume`, `list` must exist in `src/components/Icon.tsx`. Grep the `Icon` glyph map. If any is missing, add a `<path>` glyph following the existing M18 pattern (single `<path d="…" stroke="currentColor" fill="none">`). Suggested paths:
- `volume` (speaker): `M4 9v6h4l5 4V5L8 9H4z`
- `mute` (speaker + slash): `M4 9v6h4l5 4V5L8 9H4z M16 9l5 6 M21 9l-5 6`
- `list`: `M4 6h16 M4 12h16 M4 18h16`
> Use whatever glyph idiom the file already uses; the above are fallbacks. If `volume`/`list` already exist, reuse them.

**Verify (Task 5):** `npx tsc --noEmit` + `npm test` green.

---

## Task 6 — `src/player/NowPlayingPanel.tsx`: chapter‑end actions, speed segmented control, scannable chapter states, sleep, mute, pop‑out clarity

**Goal:** PL‑2 (end‑of‑chapter actions), PL‑1 (speed segmented control), PL‑4 (scannable chapter states), PL‑7, PL‑8, PL‑10.

Update the props type (add to the object type passed to `NowPlayingPanel`):
```ts
  onSetSpeed?: (v: number) => void;        // M24 PL-1
  onPlayNextChapter?: () => void;          // M24 PL-2
  onMarkComplete?: () => void;             // M24 PL-2
  canPlayNext?: boolean;                   // M24 PL-2
```
Update the imports:
```ts
import { formatTime, formatSpeed, timeLabel, type TimeLabelMode, SPEEDS } from "./playback";
```

**6a. Speed segmented control + mute** — replace the existing `<label>Volume …</label>` and `<label>Sleep …</label>` block (lines ~80‑81) with:
```tsx
          {props.onSetSpeed && (
            <div className="np-row" role="group" aria-label="Playback speed">
              <span className="np-row__label">Speed</span>
              <div className="speed-seg">
                {SPEEDS.map((s) => (
                  <button key={s} type="button"
                    className={`speed-seg__btn${(props.playbackSpeed ?? 1) === s ? " speed-seg__btn--active" : ""}`}
                    aria-pressed={(props.playbackSpeed ?? 1) === s}
                    onClick={() => props.onSetSpeed?.(s)}>{formatSpeed(s)}</button>
                ))}
              </div>
            </div>
          )}
          <div className="np-row">
            <span className="np-row__label">Volume</span>
            {props.onToggleMute && (
              <IconButton icon={props.muted ? "mute" : "volume"} label={props.muted ? "Unmute" : "Mute"} onClick={props.onToggleMute} />
            )}
            <input type="range" aria-label="Volume" min={0} max={1} step={.01} value={props.muted ? 0 : props.volume} onChange={(event) => props.onVolume(Number(event.target.value))} />
          </div>
          <div className="np-row">
            <span className="np-row__label">Sleep</span>
            <select aria-label="Sleep timer" value={props.sleepAtChapterEnd ? "chapter" : (props.sleepMinutes ?? "")} onChange={(event) => {
              const v = event.target.value;
              if (v === "chapter") props.onSetSleep(null, true);
              else props.onSetSleep(v ? Number(v) : null, false);
            }}>
              <option value="">Off</option><option value="15">15 min</option><option value="30">30 min</option><option value="60">60 min</option><option value="chapter">End of chapter</option>
            </select>
            {(props.sleepRemaining != null || props.sleepAtChapterEnd) && (
              <span className="sleep-countdown muted" aria-live="polite">{props.sleepAtChapterEnd ? "until end of chapter" : formatTime(props.sleepRemaining ?? 0)}</span>
            )}
          </div>
```

**6b. Chapter‑end actions (PL‑2)** — replace the `stopNote` paragraph (`<p className="muted" …>{stopNote}</p>`) with an explicit action row. Keep the contextual note but add the user‑initiated buttons:
```tsx
          <div className="np-endactions">
            {props.canPlayNext && props.onPlayNextChapter ? (
              <>
                <Button variant="primary" onClick={props.onPlayNextChapter}>Play next chapter →</Button>
                <p className="muted np-endactions__note">Plays this chapter, then stops. Tap to continue when you’re ready.</p>
              </>
            ) : (
              <>
                <Button variant="secondary" onClick={props.onMarkComplete}>Mark work complete</Button>
                <Button variant="secondary" onClick={() => props.onOpenAuthor(context.authorId)}>More by {context.authorName}</Button>
                <p className="muted np-endactions__note">Last chapter — playback stops at the end.</p>
              </>
            )}
          </div>
```
> You can delete the now‑unused `isLastChapter`/`stopNote` locals, OR keep `isLastChapter` if you prefer to drive `canPlayNext` locally. Since `canPlayNext` is now passed in, remove the dead locals to satisfy `noUnusedLocals`.

**6c. Scannable chapter states (PL‑4)** — in the "In this work" list, add an explicit "Now playing" marker on the current row and a clearer per‑row state label. Change the current row's title/label area:
```tsx
                        <span className="chapter-jump__title" dir="auto">Ch {c.chapterNo} — {c.title}</span>
                        {isCurrent
                          ? <span className="chapter-jump__state chapter-jump__state--current">Now playing</span>
                          : c.played
                            ? <span className="chapter-jump__state muted" aria-hidden="true">Played</span>
                            : <span className="chapter-jump__state chapter-jump__state--new">New</span>}
```
> Replace the existing trailing `{c.played ? <span className="muted" aria-hidden="true">played</span> : null}` with the block above. The played/unplayed dot icon stays (it carries the SR label).

**6d. Pop‑out clarity (PL‑10)** — change the pop‑out `IconButton` from `icon="expand"` to a distinct icon + clearer label, and render it inline with a text label:
```tsx
          {props.onPopOut && (
            <div style={{ marginTop: "var(--space-2)" }}>
              <Button variant="secondary" onClick={props.onPopOut}>Pop out mini player</Button>
            </div>
          )}
```
> This removes the ambiguity of two `expand`‑icon buttons. (If you prefer an icon, add a `popout` glyph `M14 4h6v6 M20 4l-8 8 M5 7v12h12v-5` and use `<IconButton icon="popout" …>`. The text Button is simpler and unambiguous — prefer it.)

**Verify (Task 6):** `npx tsc --noEmit` + `npm test` green. If `NowPlayingPanel.test.tsx` exists and asserts removed copy (e.g. the old "played" label), update those assertions to the new strings.

---

## Task 7 — Start vs Keep labels (PL‑3) + elevate next‑chapter title (PL‑5)

**Goal:** Derive the primary play‑button label from played count, and make the Home hero's next‑chapter title prominent.

**Read first:** `src/views/HomeView.tsx` and `src/views/AuthorDetailView.tsx` (locate the actual paths via `Glob src/**/HomeView.tsx`). Do NOT guess the current markup — read it.

**PL‑3:** Wherever a work/author has a primary "play / continue" button whose label is static (e.g. "Play", "Keep listening", "Play next chapter"), derive it:
```tsx
const startLabel = playedCount === 0 ? "Start listening" : "Keep listening";
```
where `playedCount` is the number of played chapters for that work/author (use the existing per‑row count the view already computes — e.g. `work.chapters.filter(c => c.played).length`, or an existing `playedChapters` field). Apply at the Home "Keep listening to [Creator]" hero CTA and the AuthorDetail per‑work play buttons. **Do not** change the no‑autoplay behavior — only the label.

**PL‑5:** In the Home hero, the *next chapter title* (the actual play target) is currently rendered as muted metadata. Promote it: give it a non‑muted, larger class (reuse an existing heading/`strong` style — e.g. wrap in `<strong dir="auto">` or a `.hero__next-title` class) so the chapter you're about to play is the visually dominant text under the work title. Keep the creator/work context but de‑emphasize relative to the next‑chapter title.

> Keep changes minimal and within the existing component structure. If the view computes nothing resembling a played count, compute it from the data already in props (chapters array). If neither exists, STOP and report what the view actually receives.

**Verify (Task 7):** `npx tsc --noEmit` + `npm test` green; update any HomeView/AuthorDetailView test copy assertions that change.

---

## Task 8 — Library row play affordance (PL‑6)

**Goal:** A play button on Library author rows that starts the author's next unplayed chapter (faster path to play).

**Read first:** `src/views/LibraryView.tsx` and how App passes a play handler to it. The M13/M15 work cards already implement "play next unplayed via `getAuthorDetail`→first‑unplayed→`playChapter`". Reuse that exact pattern.

Add an `onPlayAuthor?: (authorId: number) => void` prop to `LibraryView` and render a small play `IconButton` on each author row (use `icon="play"`). In `App.tsx`, implement the handler (model on the existing work‑card play‑next logic — grep `first-unplayed` / `getAuthorDetail` in App.tsx):
```tsx
  async function playAuthorNext(authorId: number) {
    const d = await getAuthorDetail(authorId);
    for (const w of d.works) {
      const ch = w.chapters.find((c) => !c.played) ?? w.chapters[0];
      if (ch) {
        playChapter({
          chapter: ch, authorId: d.id, authorName: d.name,
          workId: w.id, workTitle: w.baseTitle,
          workTotalChapters: w.chapters.length,
          workPlayedChapters: w.chapters.filter((c) => c.played).length,
        });
        return;
      }
    }
  }
```
Pass `onPlayAuthor={(id) => void playAuthorNext(id)}` to `<LibraryView />`.

> If an equivalent helper already exists in App.tsx (grep `find((c) => !c.played)`), reuse it instead of adding a duplicate.

**Verify (Task 8):** `npx tsc --noEmit` + `npm test` green.

---

## Task 9 — CSS (`src/styles/components.css`): scrubber hit‑area, speed control, mute, countdown, chapter states, end‑actions

**Goal:** PL‑9 scrubber hit‑area + the new controls, all in the M12 token system (dark‑first, use `--space-*`, `--color-*`, `--accent`/`#218bff` only for interactive emphasis per the v6 direction).

Append to `src/styles/components.css` (adjust selectors to the file's existing conventions; reuse existing tokens — grep for `--accent`, `--color-text`, `--color-bg-elev`):
```css
/* M24 — scrubber hit-area (PL-9) */
.seek-range { height: 22px; cursor: pointer; }
.seek-range::-webkit-slider-thumb { width: 14px; height: 14px; border-radius: 50%; opacity: 0; transition: opacity .12s; }
.player-bar__seek:hover .seek-range::-webkit-slider-thumb,
.now-playing__layout .seek-range:focus-visible::-webkit-slider-thumb { opacity: 1; }

/* M24 — speed (PL-1) */
.speed-btn { min-width: 3ch; padding: 2px 8px; border-radius: var(--radius-sm, 6px); background: var(--color-bg-elev, #1b1b1f); color: var(--color-text, #fff); border: 1px solid var(--color-border, #333); cursor: pointer; font-variant-numeric: tabular-nums; }
.speed-btn:hover { border-color: var(--accent, #218bff); }
.speed-seg { display: inline-flex; gap: 4px; }
.speed-seg__btn { padding: 2px 8px; border-radius: var(--radius-sm, 6px); background: transparent; color: var(--color-text-muted, #aaa); border: 1px solid var(--color-border, #333); cursor: pointer; font-variant-numeric: tabular-nums; }
.speed-seg__btn--active { background: var(--accent, #218bff); color: #fff; border-color: var(--accent, #218bff); }

/* M24 — Now Playing rows */
.np-row { display: flex; align-items: center; gap: var(--space-2, 8px); margin: var(--space-2, 8px) 0; flex-wrap: wrap; }
.np-row__label { min-width: 64px; color: var(--color-text-muted, #aaa); font-size: .9rem; }
.sleep-countdown { font-variant-numeric: tabular-nums; }

/* M24 — chapter-end actions (PL-2) */
.np-endactions { display: flex; gap: var(--space-2, 8px); flex-wrap: wrap; align-items: center; margin-top: var(--space-3, 12px); }
.np-endactions__note { flex-basis: 100%; font-size: .85rem; margin: 4px 0 0; }

/* M24 — scannable chapter states (PL-4) */
.chapter-jump__state { margin-left: auto; font-size: .8rem; }
.chapter-jump__state--current { color: var(--accent, #218bff); font-weight: 600; }
.chapter-jump__state--new { color: var(--color-text, #fff); }
.chapter-jump--current { background: color-mix(in srgb, var(--accent, #218bff) 14%, transparent); }
```
> If `components.css` isn't the right file (the M12 system split into `tokens/base/components/layout`), put player styles wherever the existing `.player-bar__*` / `.now-playing__*` rules live — grep `player-bar__seek`. Match the file's existing variable names; the fallbacks above are only used if a token is absent.

**Verify (Task 9):** `npm run build` succeeds (Vite compiles CSS).

---

## Task 10 — Harness: extend the player walkthrough; add an `m24` walkthrough

**Goal:** Screenshot coverage for the new player surfaces. Keep `m12`/`m21` as regression matrices.

**Read first:** `src/harness/walkthroughs.ts` (the `playerSteps`, `m12Steps`, and the `walkthroughs` array) and `src/App.tsx`'s big walkthrough `switch` (grep `args.walkthrough`) to see how a walkthrough drives state (e.g. `m20Steps`, `m21Steps`).

1. Add `"m24"` to the `walkthroughs` array.
2. Add an `m24Steps(...)` builder (model on `m21Steps`) that, against the seeded fixture, captures:
   - `01-player-compact` — compact bar with the speed button, mute, sleep dropdown visible (`setPlayerExpanded(false)`, a chapter playing).
   - `02-speed` — after cycling speed once (call the speed cycle so the button reads e.g. `1.25×`).
   - `03-now-playing` — expanded panel (`setPlayerExpanded(true)`) showing the speed segmented control, volume+mute row, sleep row.
   - `04-chapter-end-actions` — expanded panel on a **non‑last** chapter (shows "Play next chapter →") AND a separate capture on the **last** chapter (shows "Mark work complete" + "More by …"). Use two steps if cleaner (`04-next-action`, `05-last-action`).
   - `06-chapter-states` — the "In this work" list with current/played/new states visible.
   - `07-sleep-countdown` — set a sleep timer and capture the countdown label.
   - Reset transient UI between steps (the M20 lesson: a step that opens the panel must `setPlayerExpanded(false)` in a later step before non‑panel shots, and force‑reset sleep/speed so persisted state doesn't leak across runs).
3. Wire `m24Steps` into the App walkthrough switch exactly like `m21Steps` (same fixture, same `captureWindow` + settle/imagesSettled pattern). Import it in `runner.test.ts`'s import line if that file enumerates step builders (it imports `m12Steps … m21Steps`).
4. If `runner.test.ts` has a per‑walkthrough describe block, add a minimal one for `m24Steps` mirroring the others (it just asserts the steps produce filenames — no schema assertion exists in FE tests).

> Per‑second resume is hard to show in a single frame; instead prove it by a **unit/integration assertion**, not a screenshot: the Task 1 Rust tests already prove the column + clear‑on‑finish. Optionally add a small App‑level test that `playChapter` seeds `pendingSeekRef` from `playbackPositionSecs` — but if the harness makes that awkward, the Rust coverage + the `savePlaybackPosition` wrapper test suffice. Do not block on a resume screenshot.

**Verify (Task 10):** `npm test` green (runner tests).

---

## Task 11 — Full gates + frozen build + screenshot verification

Run, in order (foreground, large timeouts):

1. **TS + FE tests:**
```
npx tsc --noEmit
npm test
```
2. **Rust tests:**
```
cmd //c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml"
```
3. **Additive/no‑dep gate (must be empty):**
```
git -C "C:\Agent Projects\AudioShelf" diff --stat main -- src-tauri/Cargo.toml src-tauri/Cargo.lock package.json package-lock.json
```
4. **Frozen build + screenshots.** `npm run build` then run the walkthroughs via `tools\verify.ps1` WITHOUT `-SkipBuild` for the first (it does its own frozen `cargo tauri build --debug`), then `-SkipBuild` for the rest (no `cargo test`/`tauri dev` in between — that re‑creates a dev‑mode exe and you'll capture "localhost refused to connect"):
```
tools\verify.ps1 -Walkthrough m24
tools\verify.ps1 -Walkthrough m12 -SkipBuild
tools\verify.ps1 -Walkthrough m21 -SkipBuild
```
5. **Screenshot verdict via a Sonnet subagent** (never load PNGs into the controller). Dispatch a subagent to Read the `.shots/m24`, `.shots/m12`, `.shots/m21` PNGs and return a **text verdict** (PASS/FAIL + per‑shot observations + absolute paths) against these acceptance criteria:
   - PL‑1: compact bar shows a speed control; expanded panel shows the 0.75/1/1.25/1.5/2× segmented control with the active speed highlighted; cycling changes the label.
   - PL‑2: non‑last chapter shows an active "Play next chapter →"; last chapter shows "Mark work complete" + "More by [author]".
   - PL‑4: current chapter row reads "Now playing" with accent emphasis; played rows dimmed; unplayed marked "New".
   - PL‑7: sleep dropdown has an "End of chapter" option; a live countdown renders when a minute timer is set.
   - PL‑8: a mute speaker control is present and distinct from the seek bar.
   - PL‑9: no "−0:00" in the remaining‑time label at end of chapter; scrubber reads as a usable height.
   - PL‑10: the pop‑out control is labelled "Pop out mini player" (no duplicate expand‑icon ambiguity).
   - **Regression:** `m12` (15) + `m21` (5) unchanged except the intended player additions; no contrast/theme regressions.
   - **Verify‑don't‑perform:** designated‑shot false negatives are acceptable if the feature is present in another shot/source; note them, don't expand scope.

> **First‑run/seed gotcha (M23 lesson):** some criteria (last‑chapter actions; resume) require the seed to put the player on a specific chapter. Ensure the `m24` walkthrough seeds a multi‑chapter work and drives the player to a non‑last chapter for `04-next-action` and to the last chapter for `05-last-action`. If a criterion can't be reached by a screenshot (e.g. resume position), confirm it from source/tests and mark **NA**, not FAIL.

---

## Task 12 — Ship

1. Commit each task separately on a feature branch `m24-listening-loop-player` (repo identity; Codex co‑author trailer on substantive commits).
2. Push, open a PR titled **"M24 — The Listening Loop & Player"** with a body summarizing PL‑1…PL‑10 + schema v9 + per‑second resume, and the invariant checklist (no dep, additive v9, read‑only‑on‑disk, fixtures 43/44/47).
3. `sleep 20` then FOREGROUND `gh pr checks <PR#> --watch` until `build-and-test` is green.
4. Merge `--merge --delete-branch` from main; sync main.
5. **Update `ROADMAP.md`:** flip the M24 row to ✅ Merged with the PR link + one‑line summary; append a decision‑log entry (what shipped, the v9 migration, durable gotchas discovered). Commit + push.
6. **Ping** the handoff (PushNotification) with the paste‑ready next‑milestone prompt (M25 — Visual Polish & Design‑System Consistency).

---

## Acceptance checklist (the milestone is done when ALL hold)

- [ ] Schema **v9** additive; `cargo test` green incl. `migration_v9_adds_playback_position_and_is_additive` + `open_at_version_9_reaches_latest`; table count assert still 14.
- [ ] `git diff --stat main` of `Cargo.toml`/`Cargo.lock`/`package.json`/`package-lock.json` is **empty** (no new dep).
- [ ] Read‑only‑on‑disk: every new write hits SQLite (settings `playback_speed`, `chapters.playback_position_secs`, `play_events`). No file export added.
- [ ] Fixtures 43/44/47; `fixture_scan.rs` untouched.
- [ ] PL‑1…PL‑10 all implemented and screenshot‑verified (subagent text verdict PASS); per‑second resume covered by Rust tests + the save wrapper.
- [ ] `npx tsc --noEmit`, `npm test`, `cargo test` all green; CI `build-and-test` green; `m12`+`m21` regression matrices PASS.
- [ ] No autoplay introduced — every next‑chapter / continue action is a user‑initiated button.
- [ ] ROADMAP.md updated (row ✅ + decision‑log entry); handoff pinged.
