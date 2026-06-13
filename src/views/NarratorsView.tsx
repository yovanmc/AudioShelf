import type { MetaTerm, DiscoveryWork } from "../lib/api";
import { WorkCard } from "../components/WorkCard";
import { EmptyState, PageHeader, SectionHeading } from "../components/ui";

export function NarratorsView(props: {
  narrators: MetaTerm[];
  selected: string | null;
  works: DiscoveryWork[];
  onSelect: (value: string) => void;
  onOpenAuthor: (id: number) => void;
  onPlayNextOfWork?: (workId: number, authorId: number) => void;
}) {
  return (
    <main className="view narrators">
      <PageHeader eyebrow="Browse your library by who reads it" title="Narrators" />
      <section className="view-section">
        <SectionHeading title="Pick a narrator" />
        {props.narrators.length === 0 ? (
          <EmptyState title="No narrators yet">Add a narrator to any file or creator from its page, then browse here.</EmptyState>
        ) : (
          <div className="toolbar card" style={{ padding: 12 }}>
            {props.narrators.map((n) => {
              const on = props.selected === n.value;
              return (
                <button
                  key={n.id}
                  type="button"
                  className={`chip chip--toggle${on ? " chip--on" : ""}`}
                  aria-pressed={on}
                  onClick={() => props.onSelect(n.value)}
                >
                  {n.value} <span className="muted">· {n.chapterCount}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>
      {props.selected && (
        <section className="view-section">
          <SectionHeading title={`Read by ${props.selected}`} />
          {props.works.length === 0 ? (
            <EmptyState title="Nothing unplayed">No works with unplayed chapters for this narrator.</EmptyState>
          ) : (
            <div className="card-grid">
              {props.works.map((work) => (
                <WorkCard
                  key={work.workId}
                  workId={work.workId}
                  title={work.baseTitle}
                  authorId={work.authorId}
                  authorName={work.authorName}
                  reason={work.reason}
                  tags={work.sharedTags}
                  meta={`${work.unplayedCount} unplayed`}
                  actionLabel="View creator"
                  onAction={() => props.onOpenAuthor(work.authorId)}
                  onOpenAuthor={() => props.onOpenAuthor(work.authorId)}
                  onPlay={props.onPlayNextOfWork ? () => props.onPlayNextOfWork!(work.workId, work.authorId) : undefined}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
