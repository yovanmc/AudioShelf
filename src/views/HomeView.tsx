import type { HomeData, PlaybackContext } from "../lib/api";
import { WorkCard } from "../components/WorkCard";
import { Button, EmptyState, StatCard } from "../components/ui";
import { CreatorIdentity } from "../components/CreatorIdentity";
import { keepListeningPercent, recommendationPercent } from "../lib/home";
import { formatLong, formatRelative } from "../lib/time";

export function HomeView(props: {
  home: HomeData | null;
  nowMs: number;
  onPlay: (context: PlaybackContext) => void;
  onOpenAuthor: (id: number) => void;
  onOpenLibrary: () => void;
  featureMenuOpen?: boolean;
}) {
  if (!props.home) {
    return <div className="view"><div className="card empty-state">Loading your shelf...</div></div>;
  }
  const { keepListening, recommendations, stats } = props.home;
  const empty = !keepListening && recommendations.length === 0 && stats.recent.length === 0;
  const context: PlaybackContext | null = keepListening ? {
    chapter: keepListening.nextChapter,
    authorId: keepListening.authorId,
    authorName: keepListening.authorName,
    workId: keepListening.workId,
    workTitle: keepListening.workTitle,
    workTotalChapters: keepListening.totalChapters,
    workPlayedChapters: keepListening.playedChapters,
  } : null;
  return (
    <main className="view home">
      <header className="view-section">
        <div className="muted">Your personal audio library</div>
        <h1>Home</h1>
      </header>
      {empty && (
        <EmptyState title="Your shelf is ready" action={<Button variant="primary" onClick={props.onOpenLibrary}>Browse your library</Button>}>
          Nothing played yet. Start a chapter and AudioShelf will build your listening dashboard.
        </EmptyState>
      )}
      {keepListening && context && (
        <section className="view-section">
          <div className="section-heading"><div><div className="muted">Continue where you left off</div><h2>Keep listening to {keepListening.authorName}</h2></div></div>
          <WorkCard
            featured
            workId={keepListening.workId}
            title={keepListening.workTitle}
            authorId={keepListening.authorId}
            authorName={keepListening.authorName}
            progress={keepListeningPercent(keepListening)}
            meta={`Next: Chapter ${keepListening.nextChapter.chapterNo}, ${keepListening.nextChapter.title} · ${keepListening.remainingUnplayed} left · ${formatRelative(keepListening.lastPlayedAt, props.nowMs)}`}
            actionLabel="Keep listening"
            onAction={() => props.onPlay(context)}
            onOpenAuthor={() => props.onOpenAuthor(keepListening.authorId)}
            menuItems={[{ label: "View creator", onSelect: () => props.onOpenAuthor(keepListening.authorId) }]}
            menuOpen={props.featureMenuOpen}
          />
        </section>
      )}
      {recommendations.length > 0 && (
        <section className="view-section">
          <div className="section-heading"><div><div className="muted">Based on your library and listening</div><h2>You May Like</h2></div></div>
          <div className="card-grid">
            {recommendations.slice(0, 6).map((work) => (
              <WorkCard
                key={work.workId}
                workId={work.workId}
                title={work.baseTitle}
                authorId={work.authorId}
                authorName={work.authorName}
                reason={work.reason}
                tags={work.matchedTags.length ? work.matchedTags : work.tags}
                progress={recommendationPercent(work)}
                meta={`${work.unplayedCount} of ${work.totalChapters} chapters unplayed`}
                actionLabel="View creator"
                onAction={() => props.onOpenAuthor(work.authorId)}
                onOpenAuthor={() => props.onOpenAuthor(work.authorId)}
              />
            ))}
          </div>
        </section>
      )}
      {stats.recent.length > 0 && (
        <section className="view-section">
          <h2>Recently listened</h2>
          <ul className="recent-list card">
            {stats.recent.map((item, index) => (
              <li className="recent-row" key={`${item.chapterId}-${index}`}>
                <CreatorIdentity authorId={item.authorId} authorName={item.authorName} size={36} onOpen={() => props.onOpenAuthor(item.authorId)} />
                <div><strong>{item.chapterTitle}</strong><div className="muted">{item.workTitle} · {formatRelative(item.playedAt, props.nowMs)}</div></div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="view-section">
        <h2>Your listening</h2>
        <div className="stats-grid">
          <StatCard label="Total time" value={formatLong(stats.totalSecs)} />
          <StatCard label="Chapters finished" value={stats.chaptersFinished} />
          <StatCard label="Current streak" value={`${stats.streakDays} day${stats.streakDays === 1 ? "" : "s"}`} />
        </div>
      </section>
    </main>
  );
}
