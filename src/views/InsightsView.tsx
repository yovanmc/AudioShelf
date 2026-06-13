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
