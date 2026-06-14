import type { DormantWork, HomeData, PlaybackContext } from "../lib/api";
import { WorkCard, type WorkPlayStatus } from "../components/WorkCard";
import { Button, EmptyState, PageHeader, SectionHeading, StatCard } from "../components/ui";
import { CreatorIdentity } from "../components/CreatorIdentity";
import { Shelf } from "../components/Shelf";
import { keepListeningPercent, recommendationPercent } from "../lib/home";
import { formatLong, formatRelative } from "../lib/time";
import type { HomeShelf, ShelfItem } from "../lib/shelves";

function workPlayStatus(totalChapters: number, unplayedCount: number): WorkPlayStatus {
  if (unplayedCount === 0) return "done";
  if (unplayedCount >= totalChapters) return "unstarted";
  return "in-progress";
}

export function HomeView(props: {
  home: HomeData | null;
  nowMs: number;
  onPlay: (context: PlaybackContext) => void;
  onOpenAuthor: (id: number) => void;
  onOpenLibrary: () => void;
  onOpenSettings?: () => void;
  onPlayNextOfWork?: (workId: number, authorId: number) => void;
  featureMenuOpen?: boolean;
  shelves?: HomeShelf[];
  shelfItems?: Record<string, ShelfItem[]>;
  /** Dormant works for the "Forgotten" shelf — optional so existing tests don't break. */
  dormantWorks?: DormantWork[];
}) {
  if (!props.home) {
    return <div className="view"><div className="card empty-state">Loading your shelf...</div></div>;
  }
  const { keepListening, recommendations, stats } = props.home;

  // True first-run: nothing has ever been played
  const noHistory = !keepListening && stats.recent.length === 0 && stats.chaptersFinished === 0;

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
      <PageHeader eyebrow="Your personal audio library" title="Home" />
      {noHistory && (
        <EmptyState
          title="Welcome to AudioShelf"
          action={
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              {props.onOpenSettings && <Button variant="primary" onClick={props.onOpenSettings}>Set up my library</Button>}
              <Button variant="secondary" onClick={props.onOpenLibrary}>Browse library</Button>
            </div>
          }
        >
          Your library is organized by creator → work → chapter. Pick something to start — it plays one chapter, then stops.
        </EmptyState>
      )}
      {keepListening && context && (
        <section className="view-section">
          <SectionHeading eyebrow="Continue where you left off" title={`Keep listening to ${keepListening.authorName}`} />
          <WorkCard
            featured
            workId={keepListening.workId}
            title={keepListening.workTitle}
            authorId={keepListening.authorId}
            authorName={keepListening.authorName}
            progress={keepListeningPercent(keepListening)}
            meta={<><strong dir="auto">{keepListening.nextChapter.title}</strong><span className="muted">{` · Ch. ${keepListening.nextChapter.chapterNo} · ${keepListening.remainingUnplayed} left · ${formatRelative(keepListening.lastPlayedAt, props.nowMs)}`}</span></>}
            actionLabel={keepListening.playedChapters === 0 ? "Start listening" : "Keep listening"}
            onAction={() => props.onPlay(context)}
            onOpenAuthor={() => props.onOpenAuthor(keepListening.authorId)}
            menuItems={[{ label: "View creator", onSelect: () => props.onOpenAuthor(keepListening.authorId) }]}
            menuOpen={props.featureMenuOpen}
            playStatus="in-progress"
          />
        </section>
      )}
      {(props.shelves ?? []).map((shelf) => (
        <Shelf
          key={shelf.id}
          shelf={shelf}
          items={props.shelfItems?.[shelf.id] ?? []}
          onOpenAuthor={props.onOpenAuthor}
          onPlayNextOfWork={props.onPlayNextOfWork}
        />
      ))}
      {(props.dormantWorks ?? []).length > 0 && (
        <Shelf
          shelf={{ id: "__forgotten__", title: "Forgotten", kind: "dormant" }}
          items={(props.dormantWorks ?? []).map((w) => ({
            kind: "dormant" as const,
            workId: w.workId,
            title: w.baseTitle,
            authorId: w.authorId,
            authorName: w.authorName,
            playedFraction: w.playedFraction,
          }))}
          onOpenAuthor={props.onOpenAuthor}
          onPlayNextOfWork={props.onPlayNextOfWork}
        />
      )}
      {!noHistory && recommendations.length > 0 && (
        <section className="view-section">
          <SectionHeading eyebrow={keepListening ? "Based on your library and listening" : "From your library"} title="You May Like" />
          <div className="card-grid">
            {recommendations.slice(0, 6).map((work) => (
              <WorkCard
                key={work.workId}
                workId={work.workId}
                title={work.baseTitle}
                authorId={work.authorId}
                authorName={work.authorName}
                reason={work.reason}
                reasonTone="progress"
                tags={work.matchedTags.length ? work.matchedTags : work.tags}
                progress={recommendationPercent(work)}
                meta={`${work.unplayedCount} of ${work.totalChapters} chapters unplayed`}
                actionLabel="View creator"
                onAction={() => props.onOpenAuthor(work.authorId)}
                onOpenAuthor={() => props.onOpenAuthor(work.authorId)}
                onPlay={props.onPlayNextOfWork ? () => props.onPlayNextOfWork!(work.workId, work.authorId) : undefined}
                playStatus={workPlayStatus(work.totalChapters, work.unplayedCount)}
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
      {!noHistory && (
        <section className="view-section">
          <h2>Your listening</h2>
          <div className="stats-grid">
            <StatCard label="Total time" value={formatLong(stats.totalSecs)} />
            <StatCard label="Chapters finished" value={stats.chaptersFinished} />
            <StatCard label="Current streak" value={`${stats.streakDays} day${stats.streakDays === 1 ? "" : "s"}`} />
          </div>
        </section>
      )}
    </main>
  );
}
