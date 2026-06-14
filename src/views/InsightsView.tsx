import { PageHeader, SectionHeading, StatCard, Card, EmptyState, Button, Notice } from "../components/ui";
import { Icon } from "../components/Icon";
import { formatLong } from "../lib/time";
import { heatColumns, heatLevel, maxCount } from "../lib/insights";
import { buildRecapSvg } from "../lib/recap";
import type { InsightsData, PeriodSummary, WeekPoint, InsightTagStat } from "../lib/api";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

/** Short human-readable day label from an epoch-ms value, e.g. "Tue, Jun 10". */
function formatDayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function Heatmap({
  data,
  onDrillRange,
}: {
  data: InsightsData;
  onDrillRange?: (startMs: number, endMs: number, label: string) => void;
}) {
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
              const title = `${new Date(cell.dateMs).toISOString().slice(0, 10)}: ${cell.count} chapter${cell.count === 1 ? "" : "s"}`;
              if (cell.count > 0 && onDrillRange) {
                return (
                  <button
                    type="button"
                    className={`heatmap__cell heatmap__cell--btn${lvl ? ` lvl-${lvl}` : ""}`}
                    key={ri}
                    title={title}
                    aria-label={`${title} — click to see played works`}
                    onClick={() => onDrillRange(cell.dateMs, cell.dateMs + 86_400_000, formatDayLabel(cell.dateMs))}
                  />
                );
              }
              return (
                <div
                  className={`heatmap__cell${lvl ? ` lvl-${lvl}` : ""}`}
                  key={ri}
                  title={title}
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

/** Rhythm bar chart — bars are clickable when onDrillRange is provided. */
function RhythmChart({
  rhythm,
  onDrillRange,
}: {
  rhythm: WeekPoint[];
  onDrillRange?: (startMs: number, endMs: number, label: string) => void;
}) {
  const max = Math.max(1, ...rhythm.map((w) => w.chapters));
  return (
    <div>
      <div className="bar-chart" role="img" aria-label="Chapters finished per week over the last 16 weeks">
        {rhythm.map((w, i) => {
          const label = `Week of ${formatDayLabel(w.weekStartMs)}`;
          const barTitle = `${label}: ${w.chapters}`;
          if (onDrillRange) {
            return (
              <button
                type="button"
                key={i}
                className="bar-chart__bar bar-chart__bar--btn"
                title={barTitle}
                aria-label={`${barTitle} — click to see played works`}
                onClick={() => onDrillRange(w.weekStartMs, w.weekStartMs + 7 * 86_400_000, label)}
              >
                <div className="bar-chart__fill" style={{ height: `${(w.chapters / max) * 100}%` }} />
              </button>
            );
          }
          return (
            <div className="bar-chart__bar" key={i} title={barTitle}>
              <div className="bar-chart__fill" style={{ height: `${(w.chapters / max) * 100}%` }} />
            </div>
          );
        })}
      </div>
      <div className="bar-chart__labels">
        {rhythm.map((_, i) => <span key={i} />)}
      </div>
    </div>
  );
}

/** Top-tag breakdown rows — rows are clickable when onFilterTag is provided. */
function TagBreakdown({
  topTags,
  tagMax,
  onFilterTag,
}: {
  topTags: InsightTagStat[];
  tagMax: number;
  onFilterTag?: (tag: string) => void;
}) {
  if (topTags.length === 0) {
    return <div className="muted">No tags yet — tag some works to see this.</div>;
  }
  return (
    <>
      {topTags.map((t) => {
        if (onFilterTag) {
          return (
            <button
              type="button"
              key={t.tag}
              className="breakdown-row breakdown-row--btn"
              onClick={() => onFilterTag(t.tag)}
              aria-label={`Filter library by tag "${t.tag}"`}
            >
              <span>{t.tag}</span>
              <span className="breakdown-row__bar"><span className="breakdown-row__fill" style={{ width: `${(t.owned / tagMax) * 100}%` }} /></span>
              <span className="muted">{t.finished}/{t.owned}</span>
            </button>
          );
        }
        return (
          <div className="breakdown-row" key={t.tag}>
            <span>{t.tag}</span>
            <span className="breakdown-row__bar"><span className="breakdown-row__fill" style={{ width: `${(t.owned / tagMax) * 100}%` }} /></span>
            <span className="muted">{t.finished}/{t.owned}</span>
          </div>
        );
      })}
    </>
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
  onBack,
  onDrillRange,
  onFilterTag,
}: {
  data: InsightsData | null;
  now: number;
  onExportRecap: () => void;
  recapStatus: string | null;
  onBack?: () => void;   // IA7-3
  onDrillRange?: (startMs: number, endMs: number, label: string) => void; // CUR-5
  onFilterTag?: (tag: string) => void;  // CUR-5 top-tag → library filter
}) {
  void now;
  if (!data || data.totalChapters === 0) {
    return (
      <div className="view">
        {onBack && (
          <Button variant="ghost" onClick={onBack}><Icon name="chevronLeft" /> Home</Button>
        )}
        <PageHeader eyebrow="Your listening, visualized" title="Insights" />
        <EmptyState title="No listening history yet">
          Finish a few chapters and your heatmap, trends, and a shareable "Year in Listening" recap will appear here.
        </EmptyState>
      </div>
    );
  }

  const creatorMax = Math.max(1, ...data.topCreators.map((c) => c.chapters));
  const tagMax = Math.max(1, ...data.topTags.map((t) => t.owned));
  const hourLabels = Array.from({ length: 24 }, (_, h) => (h % 6 === 0 ? String(h) : ""));

  return (
    <div className="view insights-grid">
      {onBack && (
        <Button variant="ghost" onClick={onBack}><Icon name="chevronLeft" /> Home</Button>
      )}
      <PageHeader eyebrow="Your listening, visualized" title="Insights" />

      <div className="stat-row" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "var(--space-4)" }}>
        <StatCard label="Time listened" value={formatLong(data.totalSecs)} />
        <StatCard label="Chapters finished" value={data.totalChapters} />
        <StatCard label="Active days" value={data.activeDays} />
        <StatCard label="Days in a row" value={data.currentStreak} />
        <StatCard label="Longest run" value={data.longestStreak} />
        <StatCard label="Reflections" value={`${data.worksRated} rated · ${data.worksReEntered} revisited`} />
      </div>

      <Heatmap data={data} onDrillRange={onDrillRange} />

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
        <RhythmChart rhythm={data.rhythm} onDrillRange={onDrillRange} />
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
            <TagBreakdown topTags={data.topTags} tagMax={tagMax} onFilterTag={onFilterTag} />
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
