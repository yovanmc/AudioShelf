import { WorkCard } from "./WorkCard";
import { CreatorIdentity } from "./CreatorIdentity";
import { SectionHeading } from "./ui";
import type { HomeShelf, ShelfItem } from "../lib/shelves";

export function Shelf({
  shelf, items, onOpenAuthor, onPlayNextOfWork,
}: {
  shelf: HomeShelf;
  items: ShelfItem[];
  onOpenAuthor: (id: number) => void;
  onPlayNextOfWork?: (workId: number, authorId: number) => void;
}) {
  if (items.length === 0) return null; // empty shelves render nothing
  return (
    <section className="view-section shelf" aria-label={shelf.title}>
      <SectionHeading title={shelf.title} />
      <div className="card-row">
        {items.map((item) =>
          item.kind === "work" ? (
            <WorkCard
              key={`w${item.workId}`}
              workId={item.workId}
              title={item.title}
              authorId={item.authorId}
              authorName={item.authorName}
              tags={item.tags}
              meta={item.unplayedCount > 0 ? `${item.unplayedCount} unplayed` : "All played"}
              onOpenAuthor={() => onOpenAuthor(item.authorId)}
              onPlay={onPlayNextOfWork ? () => onPlayNextOfWork(item.workId, item.authorId) : undefined}
            />
          ) : item.kind === "dormant" ? (
            <WorkCard
              key={`d${item.workId}`}
              workId={item.workId}
              title={item.title}
              authorId={item.authorId}
              authorName={item.authorName}
              progress={Math.round(item.playedFraction * 100)}
              meta={`${Math.round(item.playedFraction * 100)}% played`}
              onOpenAuthor={() => onOpenAuthor(item.authorId)}
              onPlay={onPlayNextOfWork ? () => onPlayNextOfWork(item.workId, item.authorId) : undefined}
            />
          ) : (
            <div key={`c${item.authorId}`} className="shelf-creator card">
              <CreatorIdentity
                authorId={item.authorId}
                authorName={item.authorName}
                secondary={`${item.workCount} works · ${item.unplayedCount} unplayed`}
                onOpen={() => onOpenAuthor(item.authorId)}
              />
            </div>
          ),
        )}
      </div>
    </section>
  );
}
