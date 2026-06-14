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
    for e in events {
        *week_count.entry(week_of(local_day(e.played_at, tz))).or_insert(0) += 1;
    }
    let rhythm: Vec<WeekPoint> = ((this_week - (RHYTHM_WEEKS - 1))..=this_week)
        .map(|w| {
            let start_day = w * 7 + 3;
            WeekPoint {
                week_start_day: start_day,
                week_start_ms: day_to_utc_midnight_ms(start_day, tz),
                chapters: *week_count.get(&w).unwrap_or(&0),
            }
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
        let ms = 0 + 30 * 60_000; // 1970-01-01T00:30:00Z
        assert_eq!(local_hour(ms, 0), 0);
        assert_eq!(local_hour(ms, -120), 2); // UTC+2 ⇒ 02:30 local
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
