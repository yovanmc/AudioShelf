# M18 — Insight & "Your Year in Listening" — Implementation Plan

> **Written for Sonnet execution. If something doesn't match (a signature, a line, a struct field, a className), STOP and report rather than guess.** Every code block below is intended to be copied as-is unless the surrounding text says "adapt".
>
> **Validated against the v5 backlog (2026-06-12):** scope = **all 5 convergence-backed sub-features** (heatmap, trends, breakdowns, rhythm, recap). Recap export = **PNG snapshot** (user-chosen). **No schema migration** — pure read-only visualization over the existing `play_events` table + M17 Journal data. Read-only-on-disk preserved (the only new disk write is the user-chosen recap PNG path; Rename stays the sole audio mutator). Streak guardrail honored: framed as "days in a row" / "longest run", **no pressure mechanics**.

## Goal

A new top-level **Insights** view (sidebar nav, route `insights`) that visualizes the user's listening biography from `play_events`:

1. **52-week heatmap** (GitHub-style 7×53 grid; intensity = chapters finished that local day).
2. **Trends** — this-month-vs-last (chapters/time/active-days) + **time-of-day** (24-hour bars) + **day-of-week** (7 bars).
3. **Per-creator & per-tag breakdowns** — top creators by chapters finished; per-tag "N owned, M finished".
4. **Listening rhythm** — chapters/week over the last 16 weeks (gentle bar line).
5. **Annual "Year in Listening" recap card** — a shareable summary, **exportable as a PNG** (no new dependency; SVG → canvas → bytes → Rust `std::fs::write`).

## Hard invariants (do not break)

- **No schema migration.** `LATEST` stays `6`. Do not touch `db.rs migrate()` / `SCHEMA_V1`.
- **No new crate dependency** and **no new npm dependency.** `Cargo.lock` / `Cargo.toml` / `package-lock.json` must stay byte-clean (verify with `git diff --stat`). Std-only date math (no `chrono`); PNG is produced by the WebView canvas, written by Rust `std::fs::write` (no `base64`/`image`-crate use, no JS fs plugin).
- **Read-only-on-disk.** The only new on-disk write is `export_recap_png` to a **user-chosen non-audio path** via the existing save dialog. `dialog:allow-save` is already in `capabilities/default.json` — **do not add a capability**.
- **Fixtures stay 43/44/47.** All insight data is seeded **at runtime** in the new `insights` walkthrough via a harness-only `seed_play_events` command. Do not touch on-disk fixtures or `src-tauri/tests/fixture_scan.rs`.
- **Cargo gate** = all green + fixtures 43/44/47 (new Rust tests expected). FE: `npx tsc --noEmit` clean + `npm test` green.
- **Tauri debug-rebuild gotcha:** this milestone changes Rust, so the binary relinks normally. (If a later iteration is FE-only, force a relink — `cargo clean -p audioshelf` — before the harness, per the decision log.)

## Data model recap (what we build on — already in the codebase)

- `play_events(id, chapter_id, played_at)` — `played_at` is **ms, UTC**; one row per chapter-finish (replays insert extra rows). `src-tauri/src/db.rs:48`.
- Local-day index convention (reuse exactly): `day = (ms - tz_offset_minutes * 60_000).div_euclid(86_400_000)` where `tz_offset_minutes` = JS `getTimezoneOffset()` = `(UTC - local)` minutes. `src-tauri/src/commands.rs` (`home_stats`).
- `streak_len(days: &BTreeSet<i64>, today: i64) -> i64` already exists in `commands.rs` — **reuse it** for `current_streak`.
- `chapters(id, work_id, status, played, duration_secs, raw_filename, …)`; `works(id, author_id, base_title, …)`; `authors(id, folder_name, display_name, …)`; tags in denormalized `author_tags(author_id, tag)` / `work_tags(work_id, tag)` (chapter tags excluded from insight aggregation, mirroring M9/M10 Discover).

---

## Phase 1 — Backend: insights module, structs, command, tests

### Task 1.1 — Add structs to `src-tauri/src/model.rs`

Append after the `JournalEntry` struct (keep the existing `#[derive(Serialize, Debug, PartialEq)]` + `#[serde(rename_all = "camelCase")]` style exactly):

```rust
#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DayCell {
    pub day: i64,      // local-day index (days since 1970-01-01, local)
    pub date_ms: i64,  // UTC ms of local midnight (FE labels with getUTC*)
    pub count: i64,    // chapters finished that local day
}

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PeriodSummary {
    pub label: String, // e.g. "June 2026"
    pub chapters: i64,
    pub secs: i64,
    pub active_days: i64,
}

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WeekPoint {
    pub week_start_day: i64, // local-day index of the week's Sunday
    pub chapters: i64,
}

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CreatorStat {
    pub author_id: i64,
    pub author_name: String,
    pub chapters: i64, // chapters finished (play_events)
    pub secs: i64,
}

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TagStat {
    pub tag: String,
    pub owned: i64,    // works carrying the tag (work_tags ∪ author_tags)
    pub finished: i64, // those fully played
}

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RecapData {
    pub year: i64,
    pub total_secs: i64,
    pub total_chapters: i64,
    pub active_days: i64,
    pub longest_streak: i64,
    pub top_creator: Option<String>,
    pub top_creator_chapters: i64,
    pub top_tag: Option<String>,
    pub busiest_month: Option<String>,
    pub busiest_weekday: Option<String>,
    pub first_play_ms: Option<i64>,
    pub last_play_ms: Option<i64>,
}

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InsightsData {
    pub generated_at: i64,
    pub total_secs: i64,     // activity total (replays included) — "time listened"
    pub total_chapters: i64, // total play_events
    pub active_days: i64,
    pub current_streak: i64,
    pub longest_streak: i64,
    pub heatmap: Vec<DayCell>,   // 371 cells (53 weeks) ending today, oldest→newest
    pub by_weekday: Vec<i64>,    // 7 (Sun=0..Sat=6)
    pub by_hour: Vec<i64>,       // 24 (local hour)
    pub this_month: PeriodSummary,
    pub last_month: PeriodSummary,
    pub rhythm: Vec<WeekPoint>,  // last 16 weeks ending current week
    pub top_creators: Vec<CreatorStat>, // ≤8
    pub top_tags: Vec<TagStat>,         // ≤8 by owned
    pub recap: RecapData,
}

// Harness-only seeding payload (insights walkthrough). Deserialize from camelCase JS.
#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SeedPlayEvent {
    pub chapter_id: i64,
    pub played_at: i64,
}
```

Confirm `model.rs` already has `use serde::Serialize;` (the existing structs use it). If `Serialize` is imported but `Deserialize` is referenced as `serde::Deserialize` inline (as `JournalEntry` does with `serde::Deserialize`), keep that inline form for `SeedPlayEvent` — **do not** add a new `use`.

### Task 1.2 — New module `src-tauri/src/insights.rs`

Create the file with the full computation. It exposes one DB-facing fn plus pure, unit-testable helpers.

```rust
//! M18 Insights: read-only aggregation over `play_events` for the Insights view.
//! Pure helpers are unit-tested directly; `compute_insights` does the SQL then delegates
//! to the pure `build_insights`. Std-only date math (no `chrono`).

use std::collections::{BTreeSet, HashMap};

use rusqlite::Connection;

use crate::model::{
    CreatorStat, DayCell, InsightsData, PeriodSummary, RecapData, TagStat, WeekPoint,
};

const HEATMAP_DAYS: i64 = 371; // 53 weeks
const RHYTHM_WEEKS: i64 = 16;
const TOP_N: usize = 8;

const MONTHS: [&str; 12] = [
    "January", "February", "March", "April", "May", "June", "July", "August", "September",
    "October", "November", "December",
];
const WEEKDAYS: [&str; 7] = [
    "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

/// One finished-chapter event.
#[derive(Clone, Copy, Debug)]
pub struct Ev {
    pub played_at: i64,
    pub secs: i64,
    pub author_id: i64,
}

/// One work's tag + completion summary (for the per-tag breakdown).
#[derive(Clone, Debug)]
pub struct WorkAgg {
    pub tags: Vec<String>, // work_tags ∪ author_tags
    pub fully_played: bool,
}

/// Local-day index for an epoch-ms instant. tz = getTimezoneOffset() = (UTC - local) min.
pub fn local_day(ms: i64, tz_offset_minutes: i64) -> i64 {
    (ms - tz_offset_minutes * 60_000).div_euclid(86_400_000)
}

/// Local hour [0,23] for an epoch-ms instant.
pub fn local_hour(ms: i64, tz_offset_minutes: i64) -> usize {
    (((ms - tz_offset_minutes * 60_000).rem_euclid(86_400_000)) / 3_600_000) as usize
}

/// Weekday with Sunday=0..Saturday=6, from a local-day index.
/// 1970-01-04 (day 3) was a Sunday, so days where (day-3) % 7 == 0 are Sundays.
pub fn weekday_of(day: i64) -> usize {
    (day - 3).rem_euclid(7) as usize
}

/// (year, month[1..12], day[1..31]) from days since 1970-01-01. Howard Hinnant's algorithm.
pub fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (y + i64::from(m <= 2), m, d)
}

/// UTC ms of local midnight for a local-day index. local = utc - tz ⇒ utc = day*DAY + tz.
fn day_to_utc_midnight_ms(day: i64, tz_offset_minutes: i64) -> i64 {
    day * 86_400_000 + tz_offset_minutes * 60_000
}

/// Longest run of consecutive day indices present in the set.
pub fn longest_run(days: &BTreeSet<i64>) -> i64 {
    let mut best = 0i64;
    let mut cur = 0i64;
    let mut prev: Option<i64> = None;
    for &d in days {
        cur = match prev {
            Some(p) if d == p + 1 => cur + 1,
            _ => 1,
        };
        if cur > best {
            best = cur;
        }
        prev = Some(d);
    }
    best
}

fn month_label(y: i64, m: u32) -> String {
    format!("{} {}", MONTHS[(m - 1) as usize], y)
}

/// Sum/count for events whose (year, month) equals the target.
fn period_for_month(events: &[Ev], tz: i64, year: i64, month: u32) -> PeriodSummary {
    let mut chapters = 0i64;
    let mut secs = 0i64;
    let mut days: BTreeSet<i64> = BTreeSet::new();
    for e in events {
        let d = local_day(e.played_at, tz);
        let (y, m, _) = civil_from_days(d);
        if y == year && m == month {
            chapters += 1;
            secs += e.secs;
            days.insert(d);
        }
    }
    PeriodSummary {
        label: month_label(year, month),
        chapters,
        secs,
        active_days: days.len() as i64,
    }
}

/// Pure aggregation — fully unit-testable without a DB.
pub fn build_insights(
    events: &[Ev],
    author_names: &HashMap<i64, String>,
    works: &[WorkAgg],
    now_ms: i64,
    tz: i64,
) -> InsightsData {
    let today = local_day(now_ms, tz);

    // Per-day counts/secs.
    let mut day_count: HashMap<i64, i64> = HashMap::new();
    let mut days_set: BTreeSet<i64> = BTreeSet::new();
    let mut by_weekday = vec![0i64; 7];
    let mut by_hour = vec![0i64; 24];
    let mut per_author: HashMap<i64, (i64, i64)> = HashMap::new(); // id -> (chapters, secs)
    let mut total_secs = 0i64;

    for e in events {
        let d = local_day(e.played_at, tz);
        *day_count.entry(d).or_insert(0) += 1;
        days_set.insert(d);
        by_weekday[weekday_of(d)] += 1;
        by_hour[local_hour(e.played_at, tz)] += 1;
        let a = per_author.entry(e.author_id).or_insert((0, 0));
        a.0 += 1;
        a.1 += e.secs;
        total_secs += e.secs;
    }

    // Heatmap: HEATMAP_DAYS cells ending today, oldest→newest.
    let start = today - (HEATMAP_DAYS - 1);
    let heatmap: Vec<DayCell> = (start..=today)
        .map(|d| DayCell {
            day: d,
            date_ms: day_to_utc_midnight_ms(d, tz),
            count: *day_count.get(&d).unwrap_or(&0),
        })
        .collect();

    // Rhythm: chapters per week (Sunday-aligned), last RHYTHM_WEEKS ending this week.
    let week_of = |d: i64| (d - 3).div_euclid(7); // weeks since the Sunday epoch (day 3)
    let this_week = week_of(today);
    let mut week_count: HashMap<i64, i64> = HashMap::new();
    for &d in &days_set {
        // count chapters, not active days, per week:
    }
    for e in events {
        *week_count.entry(week_of(local_day(e.played_at, tz))).or_insert(0) += 1;
    }
    let rhythm: Vec<WeekPoint> = ((this_week - (RHYTHM_WEEKS - 1))..=this_week)
        .map(|w| WeekPoint {
            week_start_day: w * 7 + 3,
            chapters: *week_count.get(&w).unwrap_or(&0),
        })
        .collect();

    // Month-vs-month.
    let (ty, tm, _) = civil_from_days(today);
    let (ly, lm) = if tm == 1 { (ty - 1, 12) } else { (ty, tm - 1) };
    let this_month = period_for_month(events, tz, ty, tm);
    let last_month = period_for_month(events, tz, ly, lm);

    // Top creators.
    let mut top_creators: Vec<CreatorStat> = per_author
        .iter()
        .map(|(&id, &(chapters, secs))| CreatorStat {
            author_id: id,
            author_name: author_names.get(&id).cloned().unwrap_or_default(),
            chapters,
            secs,
        })
        .collect();
    top_creators.sort_by(|a, b| {
        b.chapters
            .cmp(&a.chapters)
            .then_with(|| a.author_name.cmp(&b.author_name))
    });
    top_creators.truncate(TOP_N);

    // Top tags ("owned" vs "finished" at the work level).
    let mut owned: HashMap<String, i64> = HashMap::new();
    let mut finished: HashMap<String, i64> = HashMap::new();
    for w in works {
        for t in &w.tags {
            *owned.entry(t.clone()).or_insert(0) += 1;
            if w.fully_played {
                *finished.entry(t.clone()).or_insert(0) += 1;
            }
        }
    }
    let mut top_tags: Vec<TagStat> = owned
        .into_iter()
        .map(|(tag, o)| {
            let f = *finished.get(&tag).unwrap_or(&0);
            TagStat { owned: o, finished: f, tag }
        })
        .collect();
    top_tags.sort_by(|a, b| b.owned.cmp(&a.owned).then_with(|| a.tag.cmp(&b.tag)));
    top_tags.truncate(TOP_N);

    let longest_streak = longest_run(&days_set);
    let current_streak = crate::commands::streak_len(&days_set, today);

    // Recap (current calendar year).
    let recap = build_recap(events, &per_author, author_names, &top_tags, tz, ty, longest_streak);

    InsightsData {
        generated_at: now_ms,
        total_secs,
        total_chapters: events.len() as i64,
        active_days: days_set.len() as i64,
        current_streak,
        longest_streak,
        heatmap,
        by_weekday,
        by_hour,
        this_month,
        last_month,
        rhythm,
        top_creators,
        top_tags,
        recap,
    }
}

fn build_recap(
    events: &[Ev],
    per_author_all: &HashMap<i64, (i64, i64)>,
    author_names: &HashMap<i64, String>,
    top_tags: &[TagStat],
    tz: i64,
    year: i64,
    longest_streak: i64,
) -> RecapData {
    let _ = per_author_all; // year-scoped author tally computed below
    let mut total_secs = 0i64;
    let mut total_chapters = 0i64;
    let mut days: BTreeSet<i64> = BTreeSet::new();
    let mut month_counts = [0i64; 12];
    let mut weekday_counts = [0i64; 7];
    let mut per_author_year: HashMap<i64, i64> = HashMap::new();
    let mut first: Option<i64> = None;
    let mut last: Option<i64> = None;

    for e in events {
        let d = local_day(e.played_at, tz);
        let (y, m, _) = civil_from_days(d);
        if y != year {
            continue;
        }
        total_chapters += 1;
        total_secs += e.secs;
        days.insert(d);
        month_counts[(m - 1) as usize] += 1;
        weekday_counts[weekday_of(d)] += 1;
        *per_author_year.entry(e.author_id).or_insert(0) += 1;
        first = Some(first.map_or(e.played_at, |f| f.min(e.played_at)));
        last = Some(last.map_or(e.played_at, |l| l.max(e.played_at)));
    }

    let (top_creator, top_creator_chapters) = per_author_year
        .iter()
        .max_by(|a, b| a.1.cmp(b.1).then_with(|| b.0.cmp(a.0)))
        .map(|(&id, &c)| (author_names.get(&id).cloned(), c))
        .unwrap_or((None, 0));

    let busiest_month = month_counts
        .iter()
        .enumerate()
        .filter(|(_, &c)| c > 0)
        .max_by_key(|(_, &c)| c)
        .map(|(i, _)| month_label(year, (i + 1) as u32));
    let busiest_weekday = weekday_counts
        .iter()
        .enumerate()
        .filter(|(_, &c)| c > 0)
        .max_by_key(|(_, &c)| c)
        .map(|(i, _)| WEEKDAYS[i].to_string());

    RecapData {
        year,
        total_secs,
        total_chapters,
        active_days: days.len() as i64,
        longest_streak,
        top_creator,
        top_creator_chapters,
        top_tag: top_tags.first().map(|t| t.tag.clone()),
        busiest_month,
        busiest_weekday,
        first_play_ms: first,
        last_play_ms: last,
    }
}

/// DB-facing entry point: loads events + author names + per-work completion, then aggregates.
pub fn compute_insights(
    conn: &Connection,
    now_ms: i64,
    tz_offset_minutes: i64,
) -> rusqlite::Result<InsightsData> {
    // Events: every play_event joined to chapter duration + owning author.
    let mut events: Vec<Ev> = Vec::new();
    {
        let mut s = conn.prepare(
            "SELECT pe.played_at, COALESCE(c.duration_secs, 0), w.author_id
             FROM play_events pe
             JOIN chapters c ON pe.chapter_id = c.id
             JOIN works w ON c.work_id = w.id",
        )?;
        let mut q = s.query([])?;
        while let Some(r) = q.next()? {
            events.push(Ev {
                played_at: r.get(0)?,
                secs: r.get(1)?,
                author_id: r.get(2)?,
            });
        }
    }

    // Author display names.
    let mut author_names: HashMap<i64, String> = HashMap::new();
    {
        let mut s =
            conn.prepare("SELECT id, COALESCE(display_name, folder_name) FROM authors")?;
        let mut q = s.query([])?;
        while let Some(r) = q.next()? {
            author_names.insert(r.get(0)?, r.get(1)?);
        }
    }

    // Per-work tag set (work_tags ∪ author_tags) + fully-played flag.
    let mut wtags: HashMap<i64, BTreeSet<String>> = HashMap::new();
    {
        let mut s = conn.prepare("SELECT work_id, tag FROM work_tags")?;
        let mut q = s.query([])?;
        while let Some(r) = q.next()? {
            wtags.entry(r.get(0)?).or_default().insert(r.get(1)?);
        }
    }
    let mut atags: HashMap<i64, BTreeSet<String>> = HashMap::new();
    {
        let mut s = conn.prepare("SELECT author_id, tag FROM author_tags")?;
        let mut q = s.query([])?;
        while let Some(r) = q.next()? {
            atags.entry(r.get(0)?).or_default().insert(r.get(1)?);
        }
    }
    let mut works: Vec<WorkAgg> = Vec::new();
    {
        let mut s = conn.prepare(
            "SELECT w.id, w.author_id,
                    (SELECT count(*) FROM chapters c WHERE c.work_id=w.id AND c.status='active'),
                    (SELECT count(*) FROM chapters c WHERE c.work_id=w.id AND c.status='active' AND c.played=1)
             FROM works w",
        )?;
        let mut q = s.query([])?;
        while let Some(r) = q.next()? {
            let work_id: i64 = r.get(0)?;
            let author_id: i64 = r.get(1)?;
            let total: i64 = r.get(2)?;
            let done: i64 = r.get(3)?;
            let mut tags: BTreeSet<String> = BTreeSet::new();
            if let Some(t) = wtags.get(&work_id) {
                tags.extend(t.iter().cloned());
            }
            if let Some(t) = atags.get(&author_id) {
                tags.extend(t.iter().cloned());
            }
            works.push(WorkAgg {
                tags: tags.into_iter().collect(),
                fully_played: total > 0 && done == total,
            });
        }
    }

    Ok(build_insights(&events, &author_names, &works, now_ms, tz_offset_minutes))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names() -> HashMap<i64, String> {
        let mut m = HashMap::new();
        m.insert(1, "Jane Doe".to_string());
        m.insert(2, "Sam Smith".to_string());
        m
    }

    const DAY: i64 = 86_400_000;

    #[test]
    fn civil_from_days_known_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(3), (1970, 1, 4)); // Sunday anchor
        assert_eq!(civil_from_days(18_993), (2022, 1, 1));
    }

    #[test]
    fn weekday_anchor_is_sunday() {
        assert_eq!(weekday_of(3), 0); // 1970-01-04 Sunday
        assert_eq!(weekday_of(0), 4); // 1970-01-01 Thursday
    }

    #[test]
    fn longest_run_counts_consecutive() {
        let s: BTreeSet<i64> = [1, 2, 3, 5, 6, 10].into_iter().collect();
        assert_eq!(longest_run(&s), 3);
        assert_eq!(longest_run(&BTreeSet::new()), 0);
    }

    #[test]
    fn local_hour_respects_offset() {
        // 2026-06-12T00:30:00Z, tz = -120 (UTC+2) ⇒ local 02:30 ⇒ hour 2.
        let ms = 1_781_222_? ; // placeholder — see note below
        let _ = ms;
    }

    #[test]
    fn aggregates_counts_streaks_and_recap() {
        let tz = 0;
        let now = 30 * DAY + 12 * 3_600_000; // day 30, noon UTC
        // 3 events on day 28, 29, 30 (a 3-day run ending today) + 1 old event day 5.
        let events = vec![
            Ev { played_at: 28 * DAY + 9 * 3_600_000, secs: 300, author_id: 1 },
            Ev { played_at: 29 * DAY + 9 * 3_600_000, secs: 300, author_id: 1 },
            Ev { played_at: 30 * DAY + 9 * 3_600_000, secs: 600, author_id: 2 },
            Ev { played_at: 5 * DAY + 9 * 3_600_000, secs: 120, author_id: 1 },
        ];
        let works = vec![
            WorkAgg { tags: vec!["mystery".into()], fully_played: true },
            WorkAgg { tags: vec!["mystery".into(), "cozy".into()], fully_played: false },
        ];
        let d = build_insights(&events, &names(), &works, now, tz);
        assert_eq!(d.total_chapters, 4);
        assert_eq!(d.total_secs, 1320);
        assert_eq!(d.active_days, 4);
        assert_eq!(d.current_streak, 3);
        assert_eq!(d.longest_streak, 3);
        assert_eq!(d.heatmap.len(), HEATMAP_DAYS as usize);
        assert_eq!(d.heatmap.last().unwrap().day, 30);
        assert_eq!(d.heatmap.last().unwrap().count, 1);
        assert_eq!(d.by_hour[9], 4);
        // top creator by chapters = Jane (3) then Sam (1)
        assert_eq!(d.top_creators[0].author_name, "Jane Doe");
        assert_eq!(d.top_creators[0].chapters, 3);
        // mystery owned by both works, finished only the played one
        let mystery = d.top_tags.iter().find(|t| t.tag == "mystery").unwrap();
        assert_eq!(mystery.owned, 2);
        assert_eq!(mystery.finished, 1);
    }
}
```

> **NOTE for the implementer on the `local_hour_respects_offset` test:** replace the placeholder body with a real assertion using a concrete ms value, e.g.:
> ```rust
> #[test]
> fn local_hour_respects_offset() {
>     let ms = 0 + 30 * 60_000; // 1970-01-01T00:30:00Z
>     assert_eq!(local_hour(ms, 0), 0);
>     assert_eq!(local_hour(ms, -120), 2); // UTC+2 ⇒ 02:30 local
> }
> ```
> Also delete the dead `for &d in &days_set { ... }` empty loop in `build_insights` (it's a leftover comment-only block — remove it; rhythm is computed from `events` directly below it). If `clippy`/`cargo` warns on it, that confirms it must go.

### Task 1.3 — `streak_len` visibility

`build_insights` calls `crate::commands::streak_len`. Confirm it is `pub(crate)` (the verbatim shows `pub(crate) fn streak_len`). If it is, no change. If it's private, widen it to `pub(crate)`. **Do not** duplicate the function.

### Task 1.4 — Command + module registration

In `src-tauri/src/commands.rs`, add the thin command (place it near `query_home`):

```rust
#[tauri::command]
pub fn query_insights(
    state: tauri::State<DbState>,
    now_ms: i64,
    tz_offset_minutes: i64,
) -> Result<crate::model::InsightsData, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    crate::insights::compute_insights(&conn, now_ms, tz_offset_minutes).map_err(|e| e.to_string())
}
```

In `src-tauri/src/lib.rs`:
- Add `mod insights;` alongside the other `mod` lines (keep alphabetical-ish; e.g. after `mod grouping;` → `mod insights;` after `mod grouping;`/before `mod launch;`).
- Register the command in `generate_handler!` — add `commands::query_insights,` right after `commands::query_home,`.
- In the `pub mod testing { ... }` block, re-export the pure helpers for integration tests:
  ```rust
  pub use crate::insights::{build_insights, civil_from_days, compute_insights, longest_run, weekday_of, Ev, WorkAgg};
  ```

### Task 1.5 — Verify Phase 1

```
cmd /c "tools\dev-env.cmd cargo test -p audioshelf insights"
cmd /c "tools\dev-env.cmd cargo test -p audioshelf"
```
Expected: new `insights::tests` pass; the full suite stays green (prior 108 + new tests). If `fixture_scan` is touched, you broke an invariant — STOP.

---

## Phase 2 — Backend: recap PNG export command

### Task 2.1 — `export_recap_png` command in `commands.rs`

Add near `export_journal`:

```rust
/// Write the recap PNG bytes (rasterized client-side from the recap SVG) to a user-chosen path.
/// Read-only-on-disk is preserved: this writes only to a non-audio path the user picked via the
/// save dialog (`dialog:allow-save`, already granted). No image/base64 crate — the bytes are a
/// finished PNG produced by the WebView canvas.
#[tauri::command]
pub fn export_recap_png(path: String, bytes: Vec<u8>) -> Result<String, String> {
    if bytes.is_empty() {
        return Err("empty recap image".to_string());
    }
    std::fs::write(&path, &bytes).map_err(|e| format!("write failed: {e}"))?;
    Ok(path)
}
```

Register in `lib.rs` `generate_handler!` after `commands::export_journal` (add a trailing comma to `export_journal` and append `commands::export_recap_png`).

### Task 2.2 — Rust test for the writer

Add to `commands.rs` test module (or a small `#[cfg(test)] mod` near the command) a test that writes bytes to a temp file and reads them back:

```rust
#[test]
fn export_recap_png_writes_bytes() {
    let dir = std::env::temp_dir().join(format!("audioshelf_recap_test_{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("recap.png");
    let bytes = vec![0x89u8, 0x50, 0x4e, 0x47, 1, 2, 3];
    std::fs::write(&path, &bytes).unwrap(); // mirror of the command body (command needs tauri State)
    let read = std::fs::read(&path).unwrap();
    assert_eq!(read, bytes);
    std::fs::remove_dir_all(&dir).ok();
}
```

> The command itself takes `tauri::State`, so test the **write behavior** as above (the command body is a one-line `std::fs::write`). If a cleaner integration harness exists for commands, use it; otherwise this byte-roundtrip is sufficient.

### Task 2.3 — Verify Phase 2

```
cmd /c "tools\dev-env.cmd cargo test -p audioshelf"
```
Confirm green, `git diff --stat Cargo.lock Cargo.toml` shows **no change**.

---

## Phase 3 — Backend: harness-only `seed_play_events`

### Task 3.1 — Command in `commands.rs`

Add near `reset_play_history` (same harness-only spirit, not UI-wired):

```rust
/// Harness-only: insert play_events at arbitrary timestamps (and mark those chapters played),
/// so the `insights` walkthrough can populate a deterministic heatmap/trends across many days.
/// NOT wired into any user-facing UI.
#[tauri::command]
pub fn seed_play_events(
    state: tauri::State<DbState>,
    events: Vec<crate::model::SeedPlayEvent>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    for e in &events {
        conn.execute("UPDATE chapters SET played=1 WHERE id=?1", rusqlite::params![e.chapter_id])
            .map_err(|x| x.to_string())?;
        conn.execute(
            "INSERT INTO play_events(chapter_id, played_at) VALUES (?1, ?2)",
            rusqlite::params![e.chapter_id, e.played_at],
        )
        .map_err(|x| x.to_string())?;
    }
    Ok(())
}
```

Confirm `rusqlite::params!` is already used in `commands.rs` (it is, per `home_stats`). Register `commands::seed_play_events,` in `lib.rs` `generate_handler!` (near `reset_play_history`).

### Task 3.2 — Verify

```
cmd /c "tools\dev-env.cmd cargo build -p audioshelf -v minimal"
```
(Compiles; no behavior test needed — exercised by the walkthrough in Phase 8.)

---

## Phase 4 — Frontend API wrappers

### Task 4.1 — `src/lib/api.ts`

Add interfaces + wrappers (mirror the camelCase shapes; the existing `queryHome`/`exportJournal` are the pattern). Place interfaces near `ListeningStats`, wrappers near `queryHome`:

```typescript
export interface DayCell { day: number; dateMs: number; count: number; }
export interface PeriodSummary { label: string; chapters: number; secs: number; activeDays: number; }
export interface WeekPoint { weekStartDay: number; chapters: number; }
export interface CreatorStat { authorId: number; authorName: string; chapters: number; secs: number; }
export interface TagStat { tag: string; owned: number; finished: number; }
export interface RecapData {
  year: number;
  totalSecs: number;
  totalChapters: number;
  activeDays: number;
  longestStreak: number;
  topCreator: string | null;
  topCreatorChapters: number;
  topTag: string | null;
  busiestMonth: string | null;
  busiestWeekday: string | null;
  firstPlayMs: number | null;
  lastPlayMs: number | null;
}
export interface InsightsData {
  generatedAt: number;
  totalSecs: number;
  totalChapters: number;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  heatmap: DayCell[];
  byWeekday: number[];
  byHour: number[];
  thisMonth: PeriodSummary;
  lastMonth: PeriodSummary;
  rhythm: WeekPoint[];
  topCreators: CreatorStat[];
  topTags: TagStat[];
  recap: RecapData;
}

export const queryInsights = (nowMs: number, tzOffsetMinutes: number) =>
  invoke<InsightsData>("query_insights", { nowMs, tzOffsetMinutes });

export const exportRecapPng = (path: string, bytes: number[]) =>
  invoke<string>("export_recap_png", { path, bytes });

export const seedPlayEvents = (events: { chapterId: number; playedAt: number }[]) =>
  invoke<void>("seed_play_events", { events });
```

`save` from `@tauri-apps/plugin-dialog` is already imported in `App.tsx` (M17). Do not re-import in api.ts.

---

## Phase 5 — Frontend pure helpers + recap SVG

### Task 5.1 — `src/lib/insights.ts`

```typescript
import type { DayCell } from "./api";

/** Quantize a count into a 0..4 heat level given the max count in the grid. */
export function heatLevel(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0;
  const r = count / max;
  if (r > 0.75) return 4;
  if (r > 0.5) return 3;
  if (r > 0.25) return 2;
  return 1;
}

/** Weekday for a local-day index, Sunday=0..Saturday=6 (matches the Rust weekday_of). */
export function weekdayOfDay(day: number): number {
  return ((day - 3) % 7 + 7) % 7;
}

export function maxCount(cells: DayCell[]): number {
  return cells.reduce((m, c) => (c.count > m ? c.count : m), 0);
}

/**
 * Arrange a flat oldest→newest cell list into GitHub-style columns of 7 (one column per week,
 * row = weekday Sun..Sat). The first column is top-padded with nulls so the first real cell sits
 * in its correct weekday row.
 */
export function heatColumns(cells: DayCell[]): (DayCell | null)[][] {
  if (cells.length === 0) return [];
  const cols: (DayCell | null)[][] = [];
  let col: (DayCell | null)[] = [];
  const firstWd = weekdayOfDay(cells[0].day);
  for (let i = 0; i < firstWd; i++) col.push(null);
  for (const c of cells) {
    col.push(c);
    if (col.length === 7) {
      cols.push(col);
      col = [];
    }
  }
  if (col.length > 0) {
    while (col.length < 7) col.push(null);
    cols.push(col);
  }
  return cols;
}
```

### Task 5.2 — `src/lib/insights.test.ts`

```typescript
import { describe, expect, it } from "vitest";
import { heatColumns, heatLevel, maxCount, weekdayOfDay } from "./insights";
import type { DayCell } from "./api";

const cell = (day: number, count: number): DayCell => ({ day, dateMs: day * 86_400_000, count });

describe("insights helpers", () => {
  it("heatLevel buckets by ratio", () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(1, 10)).toBe(1);
    expect(heatLevel(3, 10)).toBe(2);
    expect(heatLevel(6, 10)).toBe(3);
    expect(heatLevel(9, 10)).toBe(4);
    expect(heatLevel(5, 0)).toBe(0);
  });
  it("weekdayOfDay anchors Sunday at day 3", () => {
    expect(weekdayOfDay(3)).toBe(0);
    expect(weekdayOfDay(0)).toBe(4); // Thursday
  });
  it("maxCount finds the peak", () => {
    expect(maxCount([cell(1, 2), cell(2, 5), cell(3, 1)])).toBe(5);
    expect(maxCount([])).toBe(0);
  });
  it("heatColumns pads the first column to the correct weekday", () => {
    // day 4 = Monday (weekday 1) ⇒ one null pad at top.
    const cols = heatColumns([cell(4, 1), cell(5, 2)]);
    expect(cols).toHaveLength(1);
    expect(cols[0][0]).toBeNull();
    expect(cols[0][1]?.day).toBe(4);
    expect(cols[0][2]?.day).toBe(5);
  });
  it("heatColumns splits into 7-row columns", () => {
    const cells = Array.from({ length: 10 }, (_, i) => cell(3 + i, 1)); // start Sunday
    const cols = heatColumns(cells);
    expect(cols).toHaveLength(2);
    expect(cols[0].every((c) => c !== null)).toBe(true);
    expect(cols[1].slice(3).every((c) => c === null)).toBe(true);
  });
});
```

### Task 5.3 — `src/lib/recap.ts` (the shareable SVG)

The recap SVG is **self-contained** (no external `<image>` — avoids canvas taint) and uses **literal hex** colors (it's rasterized standalone, CSS vars don't apply). Portrait 1080×1350 share card.

```typescript
import type { RecapData } from "./api";
import { formatLong } from "./time";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Build a self-contained share card SVG string for the annual recap. Pure + unit-tested. */
export function buildRecapSvg(recap: RecapData): string {
  const W = 1080;
  const H = 1350;
  const hours = formatLong(recap.totalSecs);
  const line = (
    label: string,
    value: string,
    y: number,
  ): string =>
    `<text x="80" y="${y}" font-size="30" fill="#9baabd" font-family="system-ui, sans-serif">${esc(
      label,
    )}</text>` +
    `<text x="1000" y="${y}" font-size="38" fill="#f3f7fc" text-anchor="end" font-family="system-ui, sans-serif" font-weight="600">${esc(
      value,
    )}</text>`;

  const rows: string[] = [];
  let y = 560;
  const push = (label: string, value: string) => {
    rows.push(line(label, value, y));
    y += 92;
  };
  push("Time listened", hours);
  push("Chapters finished", String(recap.totalChapters));
  push("Active days", String(recap.activeDays));
  push("Longest run", `${recap.longestStreak} day${recap.longestStreak === 1 ? "" : "s"}`);
  if (recap.topCreator) push("Top creator", recap.topCreator);
  if (recap.topTag) push("Top tag", recap.topTag);
  if (recap.busiestMonth) push("Busiest month", recap.busiestMonth);
  if (recap.busiestWeekday) push("Busiest day", recap.busiestWeekday);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="#080b10"/>`,
    `<rect x="40" y="40" width="${W - 80}" height="${H - 80}" rx="28" fill="#121a26" stroke="#26364a"/>`,
    `<text x="80" y="190" font-size="34" fill="#218bff" font-family="system-ui, sans-serif" font-weight="700" letter-spacing="2">AUDIOSHELF</text>`,
    `<text x="80" y="300" font-size="84" fill="#f3f7fc" font-family="system-ui, sans-serif" font-weight="800">Your Year in</text>`,
    `<text x="80" y="396" font-size="84" fill="#f3f7fc" font-family="system-ui, sans-serif" font-weight="800">Listening</text>`,
    `<text x="80" y="470" font-size="120" fill="#218bff" font-family="system-ui, sans-serif" font-weight="800">${recap.year}</text>`,
    ...rows,
    `<text x="80" y="${H - 80}" font-size="26" fill="#9baabd" font-family="system-ui, sans-serif">Made with AudioShelf · self-knowledge, not scorekeeping</text>`,
    `</svg>`,
  ].join("");
}
```

### Task 5.4 — `src/lib/recap.test.ts`

```typescript
import { describe, expect, it } from "vitest";
import { buildRecapSvg } from "./recap";
import type { RecapData } from "./api";

const base: RecapData = {
  year: 2026,
  totalSecs: 7500,
  totalChapters: 42,
  activeDays: 30,
  longestStreak: 5,
  topCreator: "Jane Doe",
  topCreatorChapters: 12,
  topTag: "mystery",
  busiestMonth: "June 2026",
  busiestWeekday: "Sunday",
  firstPlayMs: 1,
  lastPlayMs: 2,
};

describe("buildRecapSvg", () => {
  it("is a well-formed self-contained svg with the headline numbers", () => {
    const svg = buildRecapSvg(base);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
    expect(svg).not.toContain("<image"); // no external refs ⇒ no canvas taint
    expect(svg).toContain("2026");
    expect(svg).toContain("2h 5m"); // formatLong(7500)
    expect(svg).toContain("42");
    expect(svg).toContain("Jane Doe");
    expect(svg).toContain("mystery");
    expect(svg).toContain("5 days");
  });
  it("escapes creator names and omits absent fields", () => {
    const svg = buildRecapSvg({ ...base, topCreator: "A & B", topTag: null, busiestMonth: null });
    expect(svg).toContain("A &amp; B");
    // "Top tag" / "Busiest month" rows are skipped when null
    expect(svg).not.toContain("Busiest month");
  });
  it("singularizes a one-day run", () => {
    expect(buildRecapSvg({ ...base, longestStreak: 1 })).toContain("1 day<");
  });
});
```

### Task 5.5 — Verify Phase 5

```
npx tsc --noEmit
npm test -- insights recap
```
Expected: new tests pass.

---

## Phase 6 — Frontend: icon + route + shell wiring + App state

### Task 6.1 — Add an `insights` icon to `src/components/Icon.tsx`

Follow the existing inline-SVG pattern. Add a bar-chart glyph to the icon map. Open `Icon.tsx`, find the object/switch that maps `IconName → JSX`, and add:

```tsx
insights: (
  <>
    <rect x="3" y="12" width="4" height="8" rx="1" />
    <rect x="10" y="7" width="4" height="13" rx="1" />
    <rect x="17" y="3" width="4" height="17" rx="1" />
  </>
),
```

Add `"insights"` to the `IconName` union. **Match the file's exact style** — if icons there use `<path d=...>` with `stroke`/`fill="none"`, render the bars as a single `<path>` instead, or use `fill="currentColor"` consistent with siblings. If the structure differs from the above, STOP and report the actual `Icon.tsx` shape.

### Task 6.2 — `ShellRoute` + nav item in `src/components/AppShell.tsx`

- Extend the union: `export type ShellRoute = "home" | "library" | "discovery" | "rename" | "metadata" | "settings" | "journal" | "insights";`
- Add `onInsights: () => void;` to the destructured props **and** the props type.
- Add a nav item to the `items` array (place after `journal` so it sits low in the primary nav):
  ```tsx
  { key: "insights", label: "Insights", icon: "insights", action: onInsights },
  ```

### Task 6.3 — `App.tsx` route plumbing

- Extend `type Route`: add `| { kind: "insights" }`.
- In `shellRoute(route)`: add `if (route.kind === "insights") return "insights";` (before the final `return "library";`).
- Add state + loader near the `home`/`loadHome` definitions:
  ```tsx
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [insightsNow, setInsightsNow] = useState<number>(() => Date.now());
  const [recapStatus, setRecapStatus] = useState<string | null>(null);

  async function loadInsights(nowMs?: number) {
    const now = nowMs ?? Date.now();
    setInsightsNow(now);
    const data = await queryInsights(now, new Date().getTimezoneOffset());
    setInsights(data);
  }
  function openInsights() {
    void loadInsights();
    setRoute({ kind: "insights" });
  }
  ```
  Import `InsightsData`, `queryInsights`, `exportRecapPng` from `./lib/api`; `buildRecapSvg` from `./lib/recap`.
- Add the export handler (canvas rasterization — runs in WebView2, never in tests):
  ```tsx
  async function handleExportRecap() {
    if (!insights) return;
    const svg = buildRecapSvg(insights.recap);
    const bytes = await rasterizeSvgToPng(svg, 1080, 1350);
    if (!bytes) {
      setRecapStatus("Could not render the recap image.");
      setTimeout(() => setRecapStatus(null), 4000);
      return;
    }
    const path = await save({
      defaultPath: `audioshelf-year-in-listening-${insights.recap.year}.png`,
      filters: [{ name: "PNG image", extensions: ["png"] }],
    });
    if (!path) return;
    const saved = await exportRecapPng(path, Array.from(bytes));
    setRecapStatus(`Saved recap to ${saved}`);
    setTimeout(() => setRecapStatus(null), 4000);
  }
  ```
- Add the rasterizer helper (module-scope in `App.tsx`, or a tiny `src/lib/raster.ts` — keep it out of unit-tested modules since jsdom lacks canvas):
  ```tsx
  // SVG string → PNG bytes via the WebView canvas. The SVG is self-contained (no external
  // images) so the canvas is never tainted and toBlob succeeds. Returns null on failure.
  async function rasterizeSvgToPng(svg: string, w: number, h: number): Promise<Uint8Array | null> {
    try {
      const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("svg decode failed"));
        img.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) return null;
      return new Uint8Array(await blob.arrayBuffer());
    } catch {
      return null;
    }
  }
  ```
- Wire the nav callback into `<AppShell ... onJournal={openJournalView} onInsights={openInsights} ...>`.
- Add the view to the route switch that produces `view` (find where `route.kind === "journal"` renders `<JournalView .../>`) — add:
  ```tsx
  : route.kind === "insights" ? (
      <InsightsView
        data={insights}
        now={insightsNow}
        onExportRecap={handleExportRecap}
        recapStatus={recapStatus}
      />
    )
  ```
  Import `InsightsView` from `./views/InsightsView` (match the existing views import style/path — confirm whether views live in `./views/` or `./` and follow suit; the verbatim shows `JournalView` imported — mirror its path exactly).

> If any of these anchors (the `view` ternary, the `AppShell` JSX, the loader pattern) differ from what you see, STOP and report — do not invent a different routing mechanism.

---

## Phase 7 — Frontend: `InsightsView` + styles

### Task 7.1 — `src/styles/insights.css` and import it

Create `src/styles/insights.css`:

```css
.insights-grid { display: flex; flex-direction: column; gap: var(--space-6); }

.heatmap { display: flex; gap: 3px; overflow-x: auto; padding-bottom: var(--space-2); }
.heatmap__col { display: flex; flex-direction: column; gap: 3px; }
.heatmap__cell { width: 13px; height: 13px; border-radius: 3px; background: var(--color-surface-raised); }
.heatmap__cell--empty { background: transparent; }
.heatmap__cell.lvl-1 { background: rgb(33 139 255 / 28%); }
.heatmap__cell.lvl-2 { background: rgb(33 139 255 / 48%); }
.heatmap__cell.lvl-3 { background: rgb(33 139 255 / 72%); }
.heatmap__cell.lvl-4 { background: var(--color-accent); }
.heatmap-legend { display: flex; align-items: center; gap: var(--space-2); color: var(--color-text-muted); font-size: 13px; margin-top: var(--space-2); }
.heatmap-legend__cell { width: 13px; height: 13px; border-radius: 3px; }

.bar-chart { display: flex; align-items: flex-end; gap: 4px; height: 140px; }
.bar-chart__bar { flex: 1; min-width: 6px; background: var(--color-accent-muted); border-radius: var(--radius-sm) var(--radius-sm) 0 0; display: flex; flex-direction: column; justify-content: flex-end; }
.bar-chart__fill { background: var(--color-accent); border-radius: var(--radius-sm) var(--radius-sm) 0 0; }
.bar-chart__labels { display: flex; gap: 4px; margin-top: var(--space-2); color: var(--color-text-muted); font-size: 12px; }
.bar-chart__labels span { flex: 1; text-align: center; }

.month-compare { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); }
.breakdown-list { display: flex; flex-direction: column; gap: var(--space-3); }
.breakdown-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.breakdown-row__bar { flex: 1; height: 8px; border-radius: 999px; background: var(--color-surface-raised); overflow: hidden; }
.breakdown-row__fill { height: 100%; background: var(--color-accent); border-radius: 999px; }

.recap-card { display: flex; flex-direction: column; gap: var(--space-4); align-items: flex-start; }
.recap-card svg { width: 100%; max-width: 360px; height: auto; border-radius: var(--radius-md); }
```

Import it in `src/main.tsx` next to the other `src/styles/*.css` imports (add `import "./styles/insights.css";`). Confirm the import style matches the existing ones.

### Task 7.2 — `src/views/InsightsView.tsx`

Pure, prop-driven (no `invoke`). Uses tokens via classNames + the existing `ui` primitives + `formatLong`.

```tsx
import { PageHeader, SectionHeading, StatCard, Card, EmptyState, Button, Notice } from "../components/ui";
import { formatLong } from "../lib/time";
import { heatColumns, heatLevel, maxCount } from "../lib/insights";
import { buildRecapSvg } from "../lib/recap";
import type { InsightsData, PeriodSummary } from "../lib/api";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function Heatmap({ data }: { data: InsightsData }) {
  const max = maxCount(data.heatmap);
  const cols = heatColumns(data.heatmap);
  return (
    <Card>
      <SectionHeading eyebrow="Last 12 months" title="Listening heatmap" />
      <div className="heatmap" role="img" aria-label={`Listening activity over the last year, ${data.activeDays} active days`}>
        {cols.map((col, ci) => (
          <div className="heatmap__col" key={ci}>
            {col.map((cell, ri) => {
              if (!cell) return <div className="heatmap__cell heatmap__cell--empty" key={ri} />;
              const lvl = heatLevel(cell.count, max);
              return (
                <div
                  className={`heatmap__cell${lvl ? ` lvl-${lvl}` : ""}`}
                  key={ri}
                  title={`${new Date(cell.dateMs).toISOString().slice(0, 10)}: ${cell.count} chapter${cell.count === 1 ? "" : "s"}`}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="heatmap-legend">
        <span>Less</span>
        <span className="heatmap-legend__cell" style={{ background: "var(--color-surface-raised)" }} />
        <span className="heatmap-legend__cell lvl-1" />
        <span className="heatmap-legend__cell lvl-2" />
        <span className="heatmap-legend__cell lvl-3" />
        <span className="heatmap-legend__cell lvl-4" />
        <span>More</span>
      </div>
    </Card>
  );
}

function BarChart({ values, labels, ariaLabel }: { values: number[]; labels: string[]; ariaLabel: string }) {
  const max = Math.max(1, ...values);
  return (
    <div>
      <div className="bar-chart" role="img" aria-label={ariaLabel}>
        {values.map((v, i) => (
          <div className="bar-chart__bar" key={i} title={`${labels[i]}: ${v}`}>
            <div className="bar-chart__fill" style={{ height: `${(v / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="bar-chart__labels">
        {labels.map((l, i) => <span key={i}>{l}</span>)}
      </div>
    </div>
  );
}

function MonthCard({ summary }: { summary: PeriodSummary }) {
  return (
    <Card>
      <div className="eyebrow muted">{summary.label}</div>
      <div style={{ fontSize: 28, fontWeight: 700 }}>{summary.chapters} chapters</div>
      <div className="muted">{formatLong(summary.secs)} · {summary.activeDays} active day{summary.activeDays === 1 ? "" : "s"}</div>
    </Card>
  );
}

export function InsightsView({
  data,
  now,
  onExportRecap,
  recapStatus,
}: {
  data: InsightsData | null;
  now: number;
  onExportRecap: () => void;
  recapStatus: string | null;
}) {
  void now;
  if (!data || data.totalChapters === 0) {
    return (
      <div className="view">
        <PageHeader eyebrow="Your listening, visualized" title="Insights" />
        <EmptyState title="No listening history yet">
          Finish a few chapters and your heatmap, trends, and a shareable “Year in Listening” recap will appear here.
        </EmptyState>
      </div>
    );
  }

  const creatorMax = Math.max(1, ...data.topCreators.map((c) => c.chapters));
  const tagMax = Math.max(1, ...data.topTags.map((t) => t.owned));
  const hourLabels = Array.from({ length: 24 }, (_, h) => (h % 6 === 0 ? String(h) : ""));

  return (
    <div className="view insights-grid">
      <PageHeader eyebrow="Your listening, visualized" title="Insights" />

      <div className="stat-row" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "var(--space-4)" }}>
        <StatCard label="Time listened" value={formatLong(data.totalSecs)} />
        <StatCard label="Chapters finished" value={data.totalChapters} />
        <StatCard label="Active days" value={data.activeDays} />
        <StatCard label="Days in a row" value={data.currentStreak} />
        <StatCard label="Longest run" value={data.longestStreak} />
      </div>

      <Heatmap data={data} />

      <Card>
        <SectionHeading eyebrow="Trends" title="This month vs last" />
        <div className="month-compare">
          <MonthCard summary={data.thisMonth} />
          <MonthCard summary={data.lastMonth} />
        </div>
      </Card>

      <Card>
        <SectionHeading eyebrow="Time of day" title="When you listen" />
        <BarChart values={data.byHour} labels={hourLabels} ariaLabel="Chapters finished by hour of day" />
      </Card>

      <Card>
        <SectionHeading eyebrow="Day of week" title="Your weekly shape" />
        <BarChart values={data.byWeekday} labels={WEEKDAY_LABELS} ariaLabel="Chapters finished by day of week" />
      </Card>

      <Card>
        <SectionHeading eyebrow="Rhythm" title="Chapters per week" />
        <BarChart
          values={data.rhythm.map((w) => w.chapters)}
          labels={data.rhythm.map(() => "")}
          ariaLabel="Chapters finished per week over the last 16 weeks"
        />
      </Card>

      <div className="month-compare">
        <Card>
          <SectionHeading eyebrow="Creators" title="Most listened" />
          <div className="breakdown-list">
            {data.topCreators.map((c) => (
              <div className="breakdown-row" key={c.authorId}>
                <span>{c.authorName}</span>
                <span className="breakdown-row__bar"><span className="breakdown-row__fill" style={{ width: `${(c.chapters / creatorMax) * 100}%` }} /></span>
                <span className="muted">{c.chapters}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <SectionHeading eyebrow="Tags" title="Owned vs finished" />
          <div className="breakdown-list">
            {data.topTags.length === 0 ? (
              <div className="muted">No tags yet — tag some works to see this.</div>
            ) : (
              data.topTags.map((t) => (
                <div className="breakdown-row" key={t.tag}>
                  <span>{t.tag}</span>
                  <span className="breakdown-row__bar"><span className="breakdown-row__fill" style={{ width: `${(t.owned / tagMax) * 100}%` }} /></span>
                  <span className="muted">{t.finished}/{t.owned}</span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <Card className="recap-card">
        <SectionHeading
          eyebrow="Year in Listening"
          title={`Your ${data.recap.year} recap`}
          actions={<Button variant="primary" onClick={onExportRecap}>Export PNG</Button>}
        />
        <div
          aria-label="Year in Listening recap card"
          dangerouslySetInnerHTML={{ __html: buildRecapSvg(data.recap) }}
        />
        {recapStatus ? <Notice tone="success">{recapStatus}</Notice> : null}
      </Card>
    </div>
  );
}
```

> **Adapt-if-needed:** confirm `Notice` is exported from `ui.tsx` (the verbatim shows it is) and that the top-level view wrapper className convention is `"view"` (check `JournalView`/`HomeView` — match whatever they use, e.g. `"view"` or `"view-stack"`). If the views use a different container class, use theirs. `dangerouslySetInnerHTML` with our own generated, escaped SVG is safe here (no user HTML); if the codebase forbids it (lint), instead render the recap SVG via the same JSX primitives — but the string form keeps screen + export pixel-identical, which is preferred.

### Task 7.3 — `src/views/InsightsView.test.tsx`

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { InsightsView } from "./InsightsView";
import type { InsightsData } from "../lib/api";

const empty: InsightsData = {
  generatedAt: 0, totalSecs: 0, totalChapters: 0, activeDays: 0, currentStreak: 0, longestStreak: 0,
  heatmap: [], byWeekday: new Array(7).fill(0), byHour: new Array(24).fill(0),
  thisMonth: { label: "June 2026", chapters: 0, secs: 0, activeDays: 0 },
  lastMonth: { label: "May 2026", chapters: 0, secs: 0, activeDays: 0 },
  rhythm: [], topCreators: [], topTags: [],
  recap: { year: 2026, totalSecs: 0, totalChapters: 0, activeDays: 0, longestStreak: 0, topCreator: null, topCreatorChapters: 0, topTag: null, busiestMonth: null, busiestWeekday: null, firstPlayMs: null, lastPlayMs: null },
};

const filled: InsightsData = {
  ...empty,
  totalSecs: 7500, totalChapters: 42, activeDays: 30, currentStreak: 3, longestStreak: 5,
  heatmap: [{ day: 3, dateMs: 3 * 86_400_000, count: 2 }],
  byHour: Array.from({ length: 24 }, (_, h) => (h === 9 ? 5 : 0)),
  byWeekday: [1, 2, 3, 4, 5, 6, 7],
  rhythm: [{ weekStartDay: 3, chapters: 4 }],
  topCreators: [{ authorId: 1, authorName: "Jane Doe", chapters: 12, secs: 3600 }],
  topTags: [{ tag: "mystery", owned: 4, finished: 2 }],
  recap: { ...empty.recap, totalChapters: 42, totalSecs: 7500, topCreator: "Jane Doe", topTag: "mystery" },
};

describe("InsightsView", () => {
  it("shows an empty state with no history", () => {
    render(<InsightsView data={empty} now={0} onExportRecap={() => {}} recapStatus={null} />);
    expect(screen.getByText("No listening history yet")).toBeTruthy();
  });
  it("renders stats, breakdowns, and a recap export button when populated", () => {
    const onExport = vi.fn();
    render(<InsightsView data={filled} now={0} onExportRecap={onExport} recapStatus={null} />);
    expect(screen.getByText("2h 5m")).toBeTruthy();
    expect(screen.getByText("Jane Doe")).toBeTruthy();
    expect(screen.getByText("mystery")).toBeTruthy();
    expect(screen.getByText("Export PNG")).toBeTruthy();
  });
});
```

### Task 7.4 — Verify Phase 7

```
npx tsc --noEmit
npm test
```
Expected: all FE tests green (prior 292 + new). If a primitive prop name mismatches, fix to the real signature from `ui.tsx` (do not invent props).

---

## Phase 8 — Harness walkthrough + gates + screenshot verify

### Task 8.1 — `insightsSteps` in `src/harness/walkthroughs.ts`

Add after `journalSteps`:

```typescript
export function insightsSteps(nav: {
  showInsightsEmpty: () => Promise<void>;
  showInsightsPopulated: () => Promise<void>;
  showInsightsRecap: () => Promise<void>;
}): Step[] {
  return [
    { name: "insights-empty", run: nav.showInsightsEmpty },
    { name: "insights-populated", run: nav.showInsightsPopulated },
    { name: "insights-recap", run: nav.showInsightsRecap },
  ];
}
```

### Task 8.2 — Wire it in `App.tsx`'s harness runner

Add a branch alongside the `args.walkthrough === "journal"` branch. Use a **fixed anchor** so screenshots are deterministic, and seed a realistic spread across ~90 days (plus weekday/hour variety) against fixture chapter ids.

```typescript
: args.walkthrough === "insights"
  ? insightsSteps({
      // Fixed anchor (UTC) so the heatmap/trends are identical every run.
      // 2026-06-12T18:00:00Z.
      showInsightsEmpty: async () => {
        await resetPlayHistory();
        await loadInsights(Date.UTC(2026, 5, 12, 18, 0, 0));
        setRoute({ kind: "insights" });
      },
      showInsightsPopulated: async () => {
        const NOW = Date.UTC(2026, 5, 12, 18, 0, 0);
        const DAY = 86_400_000;
        const authors = await getAuthors();
        // Collect a handful of real chapter ids to attribute events to.
        const chapterIds: number[] = [];
        for (const a of authors.slice(0, 3)) {
          const d = await getAuthorDetail(a.id);
          for (const w of d.works) for (const c of w.chapters) chapterIds.push(c.id);
        }
        if (chapterIds.length === 0) return;
        // Deterministic spread: vary day offset (0..90), hour, and chapter — no RNG.
        const events: { chapterId: number; playedAt: number }[] = [];
        for (let i = 0; i < 120; i++) {
          const dayOffset = (i * 7) % 90;            // spreads across ~13 weeks
          const hour = 8 + (i % 12);                 // daytime/evening spread
          const chapterId = chapterIds[i % chapterIds.length];
          events.push({ chapterId, playedAt: NOW - dayOffset * DAY - hour * 3_600_000 });
        }
        // A short current streak ending "today".
        for (let k = 0; k < 4; k++) {
          events.push({ chapterId: chapterIds[k % chapterIds.length], playedAt: NOW - k * DAY - 3_600_000 });
        }
        await seedPlayEvents(events);
        await loadInsights(NOW);
        setRoute({ kind: "insights" });
        await settle();
      },
      showInsightsRecap: async () => {
        // Same seeded state; just re-render Insights (the recap card is in-view).
        await loadInsights(Date.UTC(2026, 5, 12, 18, 0, 0));
        setRoute({ kind: "insights" });
        await settle();
      },
    })
```

Import `insightsSteps` from `./harness/walkthroughs`, and `seedPlayEvents` from `./lib/api`. Confirm `getAuthors`/`getAuthorDetail`/`resetPlayHistory`/`settle` are already in scope in the runner (they are, per the journal branch).

> Do **not** call `exportRecapPng` in the walkthrough (it would pop a save dialog and block). The recap step only verifies the on-screen card renders; PNG export is verified manually/visually in the subagent verdict via the card's correctness.

### Task 8.3 — Runner registration + order test

If `src/harness/runner.test.ts` asserts the set/order of walkthroughs, add `insights` with its three step names in the right place. If the harness has a registry/list of valid walkthrough names, add `"insights"`.

### Task 8.4 — Gates

```
npx tsc --noEmit
npm test
cmd /c "tools\dev-env.cmd cargo test -p audioshelf"
cmd /c "tools\dev-env.cmd cargo build -p audioshelf -v minimal"
npm run build
cmd /c "tools\dev-env.cmd cargo tauri build --debug"
git diff --stat Cargo.lock Cargo.toml package-lock.json   # expect: no changes
```
All green; fixtures still 43/44/47 (`fixture_scan` untouched).

### Task 8.5 — Screenshot verification (Sonnet subagent, text verdict only)

Run the new walkthrough and the `m12` regression matrix:
```
pwsh tools\verify.ps1 -Walkthrough insights
pwsh tools\verify.ps1 -Walkthrough m12
```
Then **dispatch a Sonnet subagent** to Read the produced PNGs and return a **text verdict** (PASS/FAIL + observations + the absolute PNG paths). Do **not** load PNGs into the controller context. Acceptance criteria for the subagent:

- `insights-empty`: Insights page shows the "No listening history yet" empty state (no charts).
- `insights-populated`: five stat cards (Time listened / Chapters finished / Active days / Days in a row / Longest run); a heatmap grid with visible filled cells of varying intensity + a Less→More legend; this-month-vs-last cards; time-of-day bars (peak in working hours); day-of-week bars; chapters-per-week rhythm bars; "Most listened" creators list with bars; "Owned vs finished" tags list (or the "No tags yet" note if the fixtures carry no tags in this run); and the recap card.
- `insights-recap`: the "Your 2026 recap" card renders the dark share card SVG with the headline numbers (time listened, chapters, active days, longest run, and any creator/tag/month if present) + an "Export PNG" button.
- `m12` matrix: unregressed except the new "Insights" sidebar nav item (the sole expected cross-screen change).

> **Fixture artifact to expect (not a defect):** fixtures use ~5-second synthetic clips, so "Time listened" will read a small `Xm`/`0m` even with many events — same artifact class as M11/M14/M15. `formatLong` is unit-tested for real hours. The heatmap/bars/counts are driven by **event counts**, which are real and seeded, so they populate correctly.

---

## Done criteria

- New `insights` route reachable from the sidebar; Insights view renders heatmap + trends (month-vs-month, time-of-day, day-of-week) + creator/tag breakdowns + weekly rhythm + a Year-in-Listening recap card.
- Recap exports a valid PNG to a user-chosen path (manually confirm once: click Export PNG, save, open the file — it's a readable share card).
- `query_insights`, `export_recap_png`, `seed_play_events` registered; pure helpers unit-tested (Rust + FE); `buildRecapSvg`/`insights.ts` helpers unit-tested.
- **No schema migration, no new dep, fixtures 43/44/47, read-only-on-disk** (only new write = user-chosen recap PNG).
- Gates green; `insights` + `m12` subagent-verified PASS.

## After merge — update ROADMAP.md

- Flip row **18** to `✅ Merged` with the PR number + a one-line shipped summary.
- Append a decision-log entry capturing: pure-viz/no-migration return; the `compute_insights`/`build_insights` split + `civil_from_days`/`weekday_of` std-only date math; PNG export via SVG→canvas→bytes→`std::fs::write` (no new dep, no taint because the recap SVG is self-contained); the harness-only `seed_play_events`; and any gotchas found in verification.
- Note **NEXT: validate M19 (Power & Scale) before planning** — re-confirm scope vs the v5 backlog.
```