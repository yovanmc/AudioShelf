# M11 — Personal Home (Continue + Stats) — Implementation Plan

> **Written for Sonnet execution.** Every file path, signature, and code block below was
> read from the live tree on 2026-06-12. If something doesn't match what you find
> (a renamed symbol, a moved line, a different shape), **STOP and report** rather than
> guess. Run the verification command at the end of every task before moving on.

## Goal

Add a new **default `home` route** — the app's personal landing surface — combining two
sections held together on one screen:

1. **Jump back in** (continue-listening, *author/creator-centric*): recently-played
   authors, each resumed at the **next unplayed chapter** (chapter granularity, **no
   per-second offset** — fits the "a chapter at a time / stop after each" model).
2. **Your listening** (stats/history): total time listened, chapters finished, a day
   streak, and recent play history.

Library is **demoted** from the root to a button reachable from Home (and Home is
reachable from Library via a new Home button).

## Hard constraints (do not violate)

- **No schema migration.** Everything derives from existing tables (`play_events`,
  `chapters.played`, `chapters.duration_secs`, `works`, `authors`, `settings`). Do **not**
  touch `SCHEMA_V1` in `src-tauri/src/db.rs`.
- **No new crate deps** → **no `Cargo.lock` churn**. Streak/time math uses `std` only
  (no `chrono`). Re-check `git status` before the PR; if `Cargo.lock` changed, investigate.
- **Read-only on disk.** The only writes remain SQLite rows (`play_events`/`settings`).
- **Fixture counts stay 43/44/47.** Do **not** edit on-disk fixtures or
  `src-tauri/tests/fixture_scan.rs`. The `home` walkthrough seeds play-events **at runtime**.
- App ships **no stylesheet** — all layout is inline `style={}` objects. Do not add CSS.

## Data shapes (the contract)

Backend `query_home(now_ms, tz_offset_minutes) -> HomeData`:

```
HomeData {
  continueListening: ContinueItem[]   // most-recently-played author first, max 8
  stats: ListeningStats
}
ContinueItem {
  authorId, authorName, workId, workTitle,
  nextChapter: ChapterRow,            // full row → FE can play it directly
  remainingUnplayed,                  // unplayed chapters left in that work
  lastPlayedAt                        // ms epoch → "2 days ago"
}
ListeningStats {
  totalSecs,                          // SUM(duration_secs) over played chapters
  chaptersFinished,                   // COUNT(chapters WHERE played=1)
  streakDays,                         // consecutive local days w/ activity, ending today/yesterday
  recent: RecentItem[]                // latest 10 play_events, newest first
}
RecentItem { chapterId, chapterTitle, workTitle, authorName, playedAt }
```

**Continue-listening selection** (per recent author, deterministic):
1. Candidate work = the author's **most-recently-played** work.
2. `nextChapter` = lowest-`chapter_no` **unplayed** chapter in the candidate work.
3. If the candidate work has no unplayed chapter → fall back to the author's **first active
   work (by `sort_key`)** that still has an unplayed chapter; `nextChapter` = its lowest
   unplayed chapter.
4. If the author has **no** unplayed chapter anywhere → **omit** them (nothing to resume).

**Streak**: convert each `play_events.played_at` (ms) to a local calendar-day index using
`tz_offset_minutes` (JS `Date.prototype.getTimezoneOffset()` = `UTC - local` in minutes).
The streak is the run of consecutive days ending at the most recent active day — but only
"live" if that day is **today or yesterday** (otherwise 0).

---

## Task 1 — Backend: response structs (`model.rs`)

**File:** `C:\Agent Projects\AudioShelf\src-tauri\src\model.rs`

Append at the end of the file (after `SearchResults`, matching the existing
`#[derive(Serialize, Debug, PartialEq)] #[serde(rename_all = "camelCase")]` pattern):

```rust
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContinueItem {
    pub author_id: i64,
    pub author_name: String,
    pub work_id: i64,
    pub work_title: String,
    pub next_chapter: ChapterRow,
    pub remaining_unplayed: i64,
    pub last_played_at: i64,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecentItem {
    pub chapter_id: i64,
    pub chapter_title: String,
    pub work_title: String,
    pub author_name: String,
    pub played_at: i64,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ListeningStats {
    pub total_secs: i64,
    pub chapters_finished: i64,
    pub streak_days: i64,
    pub recent: Vec<RecentItem>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HomeData {
    pub continue_listening: Vec<ContinueItem>,
    pub stats: ListeningStats,
}
```

**Verify:** `cmd /c "tools\dev-env.cmd cargo build -v minimal --manifest-path src-tauri\Cargo.toml"` compiles (warnings about unused structs are expected until Task 2).

---

## Task 2 — Backend: helpers + `query_home` command (`commands.rs`)

**File:** `C:\Agent Projects\AudioShelf\src-tauri\src\commands.rs`

**2a.** Extend the model import at the top (line 4). Add the four new types:

```rust
use crate::model::{AuthorDetail, AuthorHit, AuthorRow, ChapterHit, ChapterRow, ContinueItem, DiscoveryWork, HomeData, ListeningStats, MoreWork, RecentItem, RenameItem, RenameResult, ScanResult, SearchResults, UndoResult, WorkHit, WorkRow};
```

**2b.** Add these helpers in the "query helpers" region (anywhere after `recent_authors`
at line ~467 is fine; place them just before `discovery_for_you` or after
`more_from_author`). `OptionalExtension` is already imported (line 9).

```rust
/// Load a single chapter as a `ChapterRow` (title derived from raw_filename; tags included).
fn load_chapter_row(conn: &rusqlite::Connection, chapter_id: i64) -> rusqlite::Result<ChapterRow> {
    let mut row = conn.query_row(
        "SELECT id, raw_filename, chapter_no, format, duration_secs, file_path, played
         FROM chapters WHERE id=?1",
        params![chapter_id],
        |r| {
            let raw: String = r.get(1)?;
            let title = std::path::Path::new(&raw)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or(raw);
            Ok(ChapterRow {
                id: r.get(0)?,
                title,
                chapter_no: r.get(2)?,
                format: r.get(3)?,
                duration_secs: r.get(4)?,
                file_path: r.get(5)?,
                played: r.get::<_, i64>(6)? != 0,
                tags: Vec::new(),
            })
        },
    )?;
    let mut ct = conn.prepare("SELECT tag FROM chapter_tags WHERE chapter_id=?1 ORDER BY tag")?;
    row.tags = ct
        .query_map(params![chapter_id], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(row)
}

/// "Jump back in": for each recently-played author (most-recent first), the next unplayed
/// chapter to resume. Prefers the author's most-recently-played work, else their first
/// active work with an unplayed chapter. Authors with nothing unplayed are omitted.
pub(crate) fn home_continue(conn: &rusqlite::Connection, limit: usize) -> rusqlite::Result<Vec<ContinueItem>> {
    // Over-fetch: some recent authors may be fully played and get skipped.
    let authors = recent_authors(conn, limit.saturating_mul(2).max(limit))?;
    let mut out: Vec<ContinueItem> = Vec::new();
    for author_id in authors {
        if out.len() >= limit {
            break;
        }
        let author_name: String = conn.query_row(
            "SELECT COALESCE(display_name, folder_name) FROM authors WHERE id=?1",
            params![author_id],
            |r| r.get(0),
        )?;
        let last_played_at: i64 = conn.query_row(
            "SELECT MAX(pe.played_at) FROM play_events pe
             JOIN chapters c ON pe.chapter_id=c.id JOIN works w ON c.work_id=w.id
             WHERE w.author_id=?1",
            params![author_id],
            |r| r.get(0),
        )?;

        // Candidate work = the author's most-recently-played work.
        let candidate_work: Option<i64> = conn
            .query_row(
                "SELECT c.work_id FROM play_events pe
                 JOIN chapters c ON pe.chapter_id=c.id JOIN works w ON c.work_id=w.id
                 WHERE w.author_id=?1
                 GROUP BY c.work_id ORDER BY MAX(pe.played_at) DESC LIMIT 1",
                params![author_id],
                |r| r.get(0),
            )
            .optional()?;

        // Next unplayed chapter (id, work_id): prefer candidate work, else first active work.
        let next: Option<(i64, i64)> = {
            let in_candidate = match candidate_work {
                Some(wid) => conn
                    .query_row(
                        "SELECT id FROM chapters
                         WHERE work_id=?1 AND status='active' AND played=0
                         ORDER BY chapter_no ASC LIMIT 1",
                        params![wid],
                        |r| r.get::<_, i64>(0),
                    )
                    .optional()?
                    .map(|cid| (cid, wid)),
                None => None,
            };
            match in_candidate {
                Some(pair) => Some(pair),
                None => conn
                    .query_row(
                        "SELECT c.id, c.work_id FROM chapters c JOIN works w ON c.work_id=w.id
                         WHERE w.author_id=?1 AND w.status='active' AND c.status='active' AND c.played=0
                         ORDER BY w.sort_key ASC, c.chapter_no ASC LIMIT 1",
                        params![author_id],
                        |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
                    )
                    .optional()?,
            }
        };

        let (chapter_id, work_id) = match next {
            Some(p) => p,
            None => continue, // author fully played — nothing to resume
        };

        let work_title: String =
            conn.query_row("SELECT base_title FROM works WHERE id=?1", params![work_id], |r| r.get(0))?;
        let remaining_unplayed: i64 = conn.query_row(
            "SELECT count(*) FROM chapters WHERE work_id=?1 AND status='active' AND played=0",
            params![work_id],
            |r| r.get(0),
        )?;
        let next_chapter = load_chapter_row(conn, chapter_id)?;

        out.push(ContinueItem {
            author_id,
            author_name,
            work_id,
            work_title,
            next_chapter,
            remaining_unplayed,
            last_played_at,
        });
    }
    Ok(out)
}

/// Length of the current streak: consecutive local-day indices ending at the most recent
/// active day, counted only if that day is `today` or `today - 1` (else the streak is 0).
pub(crate) fn streak_len(days: &std::collections::BTreeSet<i64>, today: i64) -> i64 {
    let last = match days.iter().next_back() {
        Some(&d) => d,
        None => return 0,
    };
    if last < today - 1 {
        return 0; // most recent activity is 2+ days ago — streak broken
    }
    let mut count = 0i64;
    let mut d = last;
    while days.contains(&d) {
        count += 1;
        d -= 1;
    }
    count
}

/// "Your listening" stats. Totals come from the `played` flag (replays not double-counted);
/// streak + recent history come from `play_events`.
pub(crate) fn home_stats(
    conn: &rusqlite::Connection,
    now_ms: i64,
    tz_offset_minutes: i64,
    recent_limit: usize,
) -> rusqlite::Result<ListeningStats> {
    let chapters_finished: i64 = conn.query_row(
        "SELECT count(*) FROM chapters WHERE status='active' AND played=1",
        [],
        |r| r.get(0),
    )?;
    let total_secs: i64 = conn.query_row(
        "SELECT COALESCE(sum(duration_secs), 0) FROM chapters WHERE status='active' AND played=1",
        [],
        |r| r.get(0),
    )?;

    // Local calendar-day index. getTimezoneOffset() = (UTC - local) minutes ⇒ local = ms - off.
    let day = |ms: i64| (ms - tz_offset_minutes * 60_000).div_euclid(86_400_000);
    let mut days: std::collections::BTreeSet<i64> = std::collections::BTreeSet::new();
    {
        let mut s = conn.prepare("SELECT played_at FROM play_events")?;
        let mut q = s.query([])?;
        while let Some(r) = q.next()? {
            let ms: i64 = r.get(0)?;
            days.insert(day(ms));
        }
    }
    let streak_days = streak_len(&days, day(now_ms));

    let mut rstmt = conn.prepare(
        "SELECT c.id, c.raw_filename, w.base_title, COALESCE(a.display_name, a.folder_name), pe.played_at
         FROM play_events pe
         JOIN chapters c ON pe.chapter_id=c.id
         JOIN works w ON c.work_id=w.id
         JOIN authors a ON w.author_id=a.id
         ORDER BY pe.played_at DESC LIMIT ?1",
    )?;
    let recent: Vec<RecentItem> = rstmt
        .query_map(params![recent_limit as i64], |r| {
            let raw: String = r.get(1)?;
            let chapter_title = std::path::Path::new(&raw)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or(raw);
            Ok(RecentItem {
                chapter_id: r.get(0)?,
                chapter_title,
                work_title: r.get(2)?,
                author_name: r.get(3)?,
                played_at: r.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;

    Ok(ListeningStats { total_secs, chapters_finished, streak_days, recent })
}
```

**2c.** Add the Tauri command (place it near `get_discovery`, e.g. after
`get_more_from_author` at line ~520):

```rust
#[tauri::command]
pub fn query_home(state: tauri::State<DbState>, now_ms: i64, tz_offset_minutes: i64) -> Result<HomeData, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let continue_listening = home_continue(&conn, 8).map_err(|e| e.to_string())?;
    let stats = home_stats(&conn, now_ms, tz_offset_minutes, 10).map_err(|e| e.to_string())?;
    Ok(HomeData { continue_listening, stats })
}
```

**Verify:** `cmd /c "tools\dev-env.cmd cargo build -v minimal --manifest-path src-tauri\Cargo.toml"` — must compile clean.

---

## Task 3 — Backend: register the command (`lib.rs`)

**File:** `C:\Agent Projects\AudioShelf\src-tauri\src\lib.rs`

In the `tauri::generate_handler![ ... ]` list, add `commands::query_home,` immediately
after `commands::get_more_from_author,`:

```rust
        commands::get_more_from_author,
        commands::query_home,
        commands::preview_renames,
```

**Verify:** `cmd /c "tools\dev-env.cmd cargo build -v minimal --manifest-path src-tauri\Cargo.toml"`.

---

## Task 4 — Backend tests (`commands.rs` test module)

**File:** `C:\Agent Projects\AudioShelf\src-tauri\src\commands.rs`, inside the existing
`#[cfg(test)] mod tests { ... }` block (it starts at line ~628; the helpers `touch`,
`open_in_memory`, `scan::scan_into`, `params!` are already in scope there).

Add these tests:

```rust
    #[test]
    fn streak_len_handles_runs_gaps_and_breaks() {
        use std::collections::BTreeSet;
        let today = 100i64;
        assert_eq!(streak_len(&BTreeSet::new(), today), 0, "no activity");
        assert_eq!(streak_len(&BTreeSet::from([100]), today), 1, "today only");
        assert_eq!(streak_len(&BTreeSet::from([99]), today), 1, "yesterday counts as live");
        assert_eq!(streak_len(&BTreeSet::from([100, 99, 98]), today), 3, "three-day run");
        assert_eq!(streak_len(&BTreeSet::from([100, 98]), today), 1, "gap stops the run");
        assert_eq!(streak_len(&BTreeSet::from([98]), today), 0, "2+ days ago is broken");
    }

    #[test]
    fn home_continue_resumes_next_unplayed_and_omits_finished_authors() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        // Alice: one 2-chapter work ("Tale", "Tale 2"); Bob: one single-chapter work.
        touch(&root.join("Alice").join("Tale.mp3"));
        touch(&root.join("Alice").join("Tale 2.mp3"));
        touch(&root.join("Bob").join("Saga.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();

        let ids: std::collections::HashMap<String, i64> =
            query_authors(&conn).unwrap().into_iter().map(|a| (a.name, a.id)).collect();
        let alice_detail = query_author_detail(&conn, ids["Alice"]).unwrap();
        let ch1 = alice_detail.works[0].chapters[0].id; // "Tale" (chapter_no 1)
        let bob_detail = query_author_detail(&conn, ids["Bob"]).unwrap();
        let saga = bob_detail.works[0].chapters[0].id;

        // Alice finishes ch1 (more recently); Bob finishes his only chapter (older).
        mark_finished(&conn, saga, 1_000).unwrap();
        mark_finished(&conn, ch1, 2_000).unwrap();

        let items = home_continue(&conn, 8).unwrap();
        // Bob is fully played → omitted. Only Alice remains, most-recent first.
        assert_eq!(items.len(), 1, "fully-played author omitted");
        let a = &items[0];
        assert_eq!(a.author_name, "Alice");
        assert_eq!(a.next_chapter.chapter_no, 2, "resume at the next unplayed chapter");
        assert_eq!(a.remaining_unplayed, 1);
        assert_eq!(a.last_played_at, 2_000);
    }

    #[test]
    fn home_stats_totals_streak_and_recent() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("Alice").join("Tale.mp3"));
        touch(&root.join("Alice").join("Tale 2.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();
        let aid = query_authors(&conn).unwrap()[0].id;
        // Fake files scan to 0s; seed known durations.
        conn.execute(
            "UPDATE chapters SET duration_secs=300 WHERE work_id IN (SELECT id FROM works WHERE author_id=?1)",
            params![aid],
        )
        .unwrap();
        let detail = query_author_detail(&conn, aid).unwrap();
        let ch1 = detail.works[0].chapters[0].id;
        let ch2 = detail.works[0].chapters[1].id;

        const DAY: i64 = 86_400_000;
        let now = 10 * DAY + 50_000_000; // arbitrary "today" inside day index 10 (tz=0)
        mark_finished(&conn, ch1, now - DAY).unwrap(); // yesterday
        mark_finished(&conn, ch2, now).unwrap();       // today

        let stats = home_stats(&conn, now, 0, 10).unwrap();
        assert_eq!(stats.chapters_finished, 2);
        assert_eq!(stats.total_secs, 600, "two 300s chapters");
        assert_eq!(stats.streak_days, 2, "today + yesterday");
        assert_eq!(stats.recent.len(), 2);
        assert!(stats.recent[0].played_at >= stats.recent[1].played_at, "newest first");
        assert_eq!(stats.recent[0].chapter_id, ch2);
    }
```

**Verify:** `cmd /c "tools\dev-env.cmd cargo test -v minimal --manifest-path src-tauri\Cargo.toml"` — all green (was 47 Rust tests; expect 50). If any of `home_continue`/`home_stats` fails on chapter ordering, STOP and report (grouping may differ from the assumption that "Tale"/"Tale 2" form one 2-chapter work).

---

## Task 5 — Frontend: API types + wrapper (`api.ts`)

**File:** `C:\Agent Projects\AudioShelf\src\lib\api.ts`

`invoke` is already imported. **5a.** Add these interfaces (place them after the existing
`DiscoveryWork` interface; `ChapterRow` is already declared in this file):

```ts
export interface ContinueItem {
  authorId: number;
  authorName: string;
  workId: number;
  workTitle: string;
  nextChapter: ChapterRow;
  remainingUnplayed: number;
  lastPlayedAt: number;
}
export interface RecentItem {
  chapterId: number;
  chapterTitle: string;
  workTitle: string;
  authorName: string;
  playedAt: number;
}
export interface ListeningStats {
  totalSecs: number;
  chaptersFinished: number;
  streakDays: number;
  recent: RecentItem[];
}
export interface HomeData {
  continueListening: ContinueItem[];
  stats: ListeningStats;
}
```

**5b.** Add the wrapper next to `getDiscovery` / `getDiscoveryByTags`:

```ts
export const queryHome = (nowMs: number, tzOffsetMinutes: number) =>
  invoke<HomeData>("query_home", { nowMs, tzOffsetMinutes });
```

**Verify:** `npx tsc --noEmit` (run from `C:\Agent Projects\AudioShelf`).

---

## Task 6 — Frontend: time helpers (`time.ts`) + tests

**File:** `C:\Agent Projects\AudioShelf\src\lib\time.ts` — append:

```ts
/** Human total like "2h 5m", "5m", or "0m". */
export function formatLong(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Coarse "x ago" label from two epoch-ms timestamps (past → present). */
export function formatRelative(fromMs: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - fromMs);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
}
```

**New file:** `C:\Agent Projects\AudioShelf\src\lib\time.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { formatLong, formatRelative } from "./time";

describe("formatLong", () => {
  it("formats sub-hour and multi-hour totals", () => {
    expect(formatLong(0)).toBe("0m");
    expect(formatLong(300)).toBe("5m");
    expect(formatLong(3600)).toBe("1h 0m");
    expect(formatLong(7_530)).toBe("2h 5m");
  });
});

describe("formatRelative", () => {
  const now = 10_000_000_000;
  it("buckets by minute/hour/day/week", () => {
    expect(formatRelative(now, now)).toBe("just now");
    expect(formatRelative(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(formatRelative(now - 2 * 3_600_000, now)).toBe("2 hours ago");
    expect(formatRelative(now - 1 * 3_600_000, now)).toBe("1 hour ago");
    expect(formatRelative(now - 3 * 86_400_000, now)).toBe("3 days ago");
    expect(formatRelative(now - 14 * 86_400_000, now)).toBe("2 weeks ago");
  });
});
```

**Verify:** `npm test` (vitest) — new file green.

---

## Task 7 — Frontend: `HomeView.tsx` + test

**New file:** `C:\Agent Projects\AudioShelf\src\views\HomeView.tsx`

Match the existing view conventions: a props object (no `invoke` calls — App owns data),
inline `style={}` only, reuse `<Cover>`. The "Open author" + "Play" buttons call the passed
callbacks.

```tsx
import type { ChapterRow, HomeData } from "../lib/api";
import { Cover } from "../components/Cover";
import { formatLong, formatRelative } from "../lib/time";

export function HomeView(props: {
  home: HomeData | null;
  nowMs: number;
  onPlayChapter: (c: ChapterRow) => void;
  onOpenAuthor: (id: number) => void;
  onOpenLibrary: () => void;
  onOpenDiscovery: () => void;
  onOpenRename: () => void;
  onOpenSettings: () => void;
}) {
  const home = props.home;
  const nav = (
    <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
      <button onClick={props.onOpenLibrary}>Library</button>
      <button onClick={props.onOpenDiscovery}>Discover</button>
      <button onClick={props.onOpenRename}>Rename tool</button>
      <button onClick={props.onOpenSettings}>Settings</button>
    </div>
  );

  if (!home) {
    return (
      <div className="home">
        {nav}
        <p>Loading…</p>
      </div>
    );
  }

  const { continueListening, stats } = home;
  const isEmpty =
    continueListening.length === 0 && stats.chaptersFinished === 0 && stats.recent.length === 0;

  return (
    <div className="home">
      {nav}
      <h1>Home</h1>

      {isEmpty && (
        <p className="home-empty">
          Nothing played yet — open your <button onClick={props.onOpenLibrary}>Library</button> to
          start listening.
        </p>
      )}

      {continueListening.length > 0 && (
        <section className="jump-back-in">
          <h2>Jump back in</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {continueListening.map((it) => (
              <li
                key={it.workId}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}
              >
                <Cover kind="work" id={it.workId} name={it.workTitle} size={40} />
                <span style={{ flex: 1 }}>
                  <button onClick={() => props.onOpenAuthor(it.authorId)}>
                    <strong>{it.authorName}</strong>
                  </button>{" "}
                  — {it.workTitle}
                  <br />
                  <span className="muted">
                    Next: Ch {it.nextChapter.chapterNo} — {it.nextChapter.title} ·{" "}
                    {it.remainingUnplayed} left · {formatRelative(it.lastPlayedAt, props.nowMs)}
                  </span>
                </span>
                <button onClick={() => props.onPlayChapter(it.nextChapter)}>▶ Play</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="your-listening">
        <h2>Your listening</h2>
        <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
          <Tile label="Total time" value={formatLong(stats.totalSecs)} />
          <Tile label="Chapters finished" value={String(stats.chaptersFinished)} />
          <Tile label="Streak" value={`🔥 ${stats.streakDays} day${stats.streakDays === 1 ? "" : "s"}`} />
        </div>
        {stats.recent.length > 0 && (
          <>
            <h3>Recent</h3>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {stats.recent.map((r, i) => (
                <li key={`${r.chapterId}-${i}`} style={{ padding: "2px 0" }}>
                  {r.chapterTitle}{" "}
                  <span className="muted">
                    — {r.workTitle} · {r.authorName} · {formatRelative(r.playedAt, props.nowMs)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: "1px solid #ccc",
        borderRadius: 8,
        padding: "8px 12px",
        minWidth: 110,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
      <div className="muted" style={{ fontSize: 12 }}>
        {label}
      </div>
    </div>
  );
}
```

**New file:** `C:\Agent Projects\AudioShelf\src\views\HomeView.test.tsx`

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomeView } from "./HomeView";
import type { ChapterRow, HomeData } from "../lib/api";

const nextChapter: ChapterRow = {
  id: 7,
  title: "Tale 2",
  chapterNo: 2,
  format: "mp3",
  durationSecs: 300,
  filePath: "/lib/Alice/Tale 2.mp3",
  played: false,
  tags: [],
};

const home: HomeData = {
  continueListening: [
    {
      authorId: 1,
      authorName: "Alice",
      workId: 3,
      workTitle: "Tale",
      nextChapter,
      remainingUnplayed: 1,
      lastPlayedAt: 1_000,
    },
  ],
  stats: {
    totalSecs: 600,
    chaptersFinished: 2,
    streakDays: 2,
    recent: [
      { chapterId: 7, chapterTitle: "Tale 2", workTitle: "Tale", authorName: "Alice", playedAt: 2_000 },
    ],
  },
};

function baseProps(over: Partial<React.ComponentProps<typeof HomeView>> = {}) {
  return {
    home,
    nowMs: 3_000,
    onPlayChapter: vi.fn(),
    onOpenAuthor: vi.fn(),
    onOpenLibrary: vi.fn(),
    onOpenDiscovery: vi.fn(),
    onOpenRename: vi.fn(),
    onOpenSettings: vi.fn(),
    ...over,
  };
}

describe("HomeView", () => {
  it("renders continue-listening and stats", () => {
    render(<HomeView {...baseProps()} />);
    expect(screen.getByText("Jump back in")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText(/Next: Ch 2 — Tale 2/)).toBeInTheDocument();
    expect(screen.getByText("Total time")).toBeInTheDocument();
    expect(screen.getByText(/🔥 2 days/)).toBeInTheDocument();
  });

  it("plays the next chapter when Play is clicked", async () => {
    const onPlayChapter = vi.fn();
    render(<HomeView {...baseProps({ onPlayChapter })} />);
    await userEvent.click(screen.getByText("▶ Play"));
    expect(onPlayChapter).toHaveBeenCalledWith(nextChapter);
  });

  it("shows an empty state when nothing has been played", () => {
    const empty: HomeData = {
      continueListening: [],
      stats: { totalSecs: 0, chaptersFinished: 0, streakDays: 0, recent: [] },
    };
    render(<HomeView {...baseProps({ home: empty })} />);
    expect(screen.getByText(/Nothing played yet/)).toBeInTheDocument();
  });

  it("shows a loading state when home is null", () => {
    render(<HomeView {...baseProps({ home: null })} />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });
});
```

**Verify:** `npx tsc --noEmit` then `npm test`.

---

## Task 8 — Frontend: wire Home into `App.tsx` + demote Library

**File:** `C:\Agent Projects\AudioShelf\src\App.tsx`

**8a. Imports.** Add to the `./lib/api` import (line 2–11) the `queryHome` value and
`HomeData` type:

```ts
  getSetting, setSetting, pickFolder, searchLibrary, queryHome,
  type AuthorRow, type AuthorDetail, type ChapterRow, type ScanResult, type DiscoveryWork,
  type RenameItem, type RenameResult, type SearchResults, type HomeData,
```

Add the view + walkthrough imports:

```ts
import { HomeView } from "./views/HomeView";
```
and extend the harness import (line 21) with `homeSteps`:
```ts
import { browseSteps, playerSteps, discoverySteps, renameSteps, groupingSteps, settingsSteps, m7Steps, coversSteps, tagsSteps, homeSteps } from "./harness/walkthroughs";
```

**8b. Route type** (line 53): add the `home` variant as the first non-loading state:

```ts
type Route =
  | { kind: "loading" }
  | { kind: "scan" }
  | { kind: "home" }
  | { kind: "library" }
  | { kind: "author" }
  | { kind: "discovery" }
  | { kind: "rename" }
  | { kind: "settings"; firstRun: boolean };
```

**8c. State + loader.** After the player-state block (after line 104) add:

```ts
  const [home, setHome] = useState<HomeData | null>(null);
  const [homeNow, setHomeNow] = useState(0);

  async function loadHome() {
    const now = Date.now();
    setHomeNow(now);
    setHome(await queryHome(now, new Date().getTimezoneOffset()));
  }
  async function openHome() {
    await loadHome();
    setRoute({ kind: "home" });
  }
```

**8d. Land on Home instead of Library.**
- In `chooseFolder` (line 212) change `if (ok) setRoute({ kind: "library" });` to:
  ```ts
      if (ok) await openHome();
  ```
- In the bootstrap effect's non-autostart branch (line 475) change
  `setRoute({ kind: "library" });` to:
  ```ts
        await openHome();
  ```

**8e. Walkthrough branch.** In the `const steps = ...` ternary chain (starts line 330),
add the `home` branch **first**:

```ts
        const steps =
          args.walkthrough === "home"
            ? homeSteps({
                showEmptyHome: async () => {
                  await loadHome();
                  setRoute({ kind: "home" });
                },
                seedAndShow: async () => {
                  const list = await getAuthors();
                  if (list.length > 0) {
                    const d = await getAuthorDetail(list[0].id);
                    const chs = d.works.flatMap((w) => w.chapters);
                    const DAY = 86_400_000;
                    if (chs[0]) await markChapterFinished(chs[0].id, Date.now() - DAY);
                    if (chs[1]) await markChapterFinished(chs[1].id, Date.now());
                  }
                  await loadHome();
                  setRoute({ kind: "home" });
                },
              })
            : args.walkthrough === "player"
            ? playerSteps({ /* …existing… */ })
```
(Keep every existing branch exactly as-is; only prepend the `home` one.)

**8f. Render branch.** In `routedView()` (line 499), add a `home` branch right after the
`scan` branch (before `author`):

```ts
    if (route.kind === "home") {
      return (
        <HomeView
          home={home}
          nowMs={homeNow}
          onPlayChapter={playChapter}
          onOpenAuthor={openAuthor}
          onOpenLibrary={() => setRoute({ kind: "library" })}
          onOpenDiscovery={openDiscovery}
          onOpenRename={openRename}
          onOpenSettings={openSettings}
        />
      );
    }
```

**8g. Library → Home button.** Pass an `onOpenHome` to `LibraryView` in its render block
(line 560):

```ts
      <LibraryView
        authors={authors}
        // …existing props…
        allTags={allTags}
        onOpenHome={openHome}
      />
```

**Verify:** `npx tsc --noEmit` (will fail until Task 8h adds the prop to LibraryView).

**8h. LibraryView prop + button.**
**File:** `C:\Agent Projects\AudioShelf\src\views\LibraryView.tsx`
- Add to the props type (after `onOpenSettings: () => void;`, line 26):
  ```ts
    onOpenHome: () => void;
  ```
- Add a Home button as the first nav button (before `Discover`, line 59):
  ```tsx
      <button onClick={props.onOpenHome}>🏠 Home</button>
      <button onClick={props.onOpenDiscovery}>Discover</button>
  ```

**8i. Fix LibraryView test baseProps.**
**File:** `C:\Agent Projects\AudioShelf\src\views\LibraryView.test.tsx` — add
`onOpenHome: vi.fn(),` to the `baseProps()` object (next to `onOpenSettings: vi.fn(),`).

**Verify:** `npx tsc --noEmit` then `npm test` — all FE tests green (was 104; expect ~111
with the new HomeView + time tests).

---

## Task 9 — Harness: `home` walkthrough

**File:** `C:\Agent Projects\AudioShelf\src\harness\walkthroughs.ts`

**9a.** Add `"home"` to the `walkthroughs` array (line 36):

```ts
export const walkthroughs = ["home", "browse", "player", "discovery", "rename", "grouping", "settings", "m7", "covers", "tags"] as const;
```

**9b.** Add the factory (anywhere in the file, e.g. after `browseSteps`):

```ts
/**
 * Build the "home" walkthrough: the empty personal home (nothing played), then — after
 * seeding two finished chapters across two days at runtime — the populated home showing
 * "Jump back in" + a 2-day streak. Seeding is runtime-only, so on-disk fixtures are untouched.
 */
export function homeSteps(nav: {
  showEmptyHome: () => Promise<void>;
  seedAndShow: () => Promise<void>;
}): Step[] {
  return [
    { name: "home-empty", run: nav.showEmptyHome },
    { name: "home", run: nav.seedAndShow },
  ];
}
```

**Verify:** `npx tsc --noEmit` then `npm test` (walkthrough factories are unit-tested
elsewhere only if a test references them; tsc is the gate here).

---

## Task 10 — Build, run the `home` walkthrough, screenshot-verify

> Frontend changed but Rust also changed (Tasks 1–4), so the debug relink is automatic.
> If you ever re-run after a *frontend-only* tweak, force a relink first
> (`cmd /c "tools\dev-env.cmd cargo clean -p audioshelf"`) per the known cache-hit gotcha.

1. Full gates:
   ```
   npx tsc --noEmit
   npm test
   cmd /c "tools\dev-env.cmd cargo test -v minimal --manifest-path src-tauri\Cargo.toml"
   ```
2. Frontend build then screenshot harness (FOREGROUND, large timeout):
   ```
   npm run build
   powershell -ExecutionPolicy Bypass -File tools\verify.ps1 -Walkthrough home
   ```
   Expected shots in the run's shots dir: `01-home-empty.png`, `02-home.png`.
3. **Screenshot verification happens in a Sonnet subagent** (do NOT load PNGs into this
   session). Dispatch a subagent to Read the two PNGs and return a **text verdict** against
   these acceptance criteria, plus the absolute paths it viewed:
   - `01-home-empty.png`: Home is the visible screen; shows the nav row (🏠 Home / Library /
     Discover / Rename tool / Settings), an "Your listening" section with all-zero tiles
     (Total time 0m, Chapters finished 0, 🔥 0 days), and the "Nothing played yet" empty line.
     **No** "Jump back in" section.
   - `02-home.png`: a "Jump back in" section now appears with at least one author row showing
     "Next: Ch N — <title>" and a ▶ Play button; the stat tiles are non-zero (Total time > 0,
     Chapters finished ≥ 1, 🔥 streak ≥ 1); a "Recent" list lists the just-played chapter(s).
4. Regression: run `-Walkthrough browse` and `-Walkthrough player` and have the subagent
   confirm they are unchanged (Home wiring must not have broken Library/author/player).

**Only if the user explicitly asks to see a shot** do you Read the PNG into this session.

---

## Definition of done

- `npx tsc --noEmit` clean; `npm test` green (HomeView + time tests added);
  `cargo test` green (streak/continue/stats tests added, was 47 → ~50).
- `home` walkthrough produces `01-home-empty.png` + `02-home.png`; subagent verdict PASS
  on both; `browse`/`player` unregressed.
- `git status` shows **no `Cargo.lock` change**, no on-disk fixture change,
  `fixture_scan.rs` untouched, `db.rs` `SCHEMA_V1` untouched.
- Home is the default landing after scan/onboarding; Library reachable from Home and Home
  reachable from Library.

## PR

- Branch `m11-personal-home`; commit as `yovanmc <yovanmc@users.noreply.github.com>` with
  trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` (no Codex trailer).
- Open PR; FOREGROUND `gh pr checks <PR#> --watch` (sleep ~20s first); merge from main
  `--merge --delete-branch`; sync main.
- Update `ROADMAP.md`: flip M11 to ✅ Merged with the PR # + one-line summary; append a
  decision-log entry capturing the shipped design (chapter-granularity resume, streak via
  tz-offset day-bucketing, totals from `played` flag, no migration).

## Notes / gotchas for the implementer

- **`flatMap`** in the walkthrough relies on `Array.prototype.flatMap` (ES2019). The repo
  already targets a modern lib; if `tsc` flags it, use `d.works.reduce((acc, w) => acc.concat(w.chapters), [] as ChapterRow[])` instead.
- **Streak across days** in tests uses `tz_offset_minutes = 0` for determinism. The live app
  passes `new Date().getTimezoneOffset()`; in jsdom that's `0`, which is fine.
- **Stale home after playing from Home:** `handleEnded` refreshes author detail + author list
  but not `home`; the home surface reloads on next entry (`openHome`). Acceptable for v1 —
  do **not** add a home refresh inside `handleEnded` (keeps the play path cheap).
- If grouping makes "Tale"/"Tale 2" land in different works than assumed, the
  `home_continue` test's `chapter_no == 2` assertion will fail — STOP and report the actual
  grouping rather than weakening the test.
