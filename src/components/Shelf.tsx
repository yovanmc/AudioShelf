import { WorkCard, type WorkPlayStatus } from "./WorkCard";
import { CreatorIdentity } from "./CreatorIdentity";
import { SectionHeading } from "./ui";
import type { HomeShelf, ShelfItem } from "../lib/shelves";

export const CAP_SHELF_ITEMS = 20;

function dormantStatus(playedFraction: number): WorkPlayStatus {
  if (playedFraction >= 1) return "done";
  if (playedFraction <= 0) return "unstarted";
  return "in-progress";
}

export function Shelf({
  shelf, items, onOpenAuthor, onPlayNextOfWork,
}: {
  shelf: HomeShelf;
  items: ShelfItem[];
  onOpenAuthor: (id: number) => void;
  onPlayNextOfWork?: (workId: number, authorId: number) => void;
}) {
  if (items.length === 0) return null; // empty shelves render nothing

  const visibleItems = items.slice(0, CAP_SHELF_ITEMS);
  const overflow = items.length - CAP_SHELF_ITEMS;

  // Determine whether the "+N more" affordance has a navigation target.
  // "creator" shelves have a natural target: the author detail page.
  // "tag", "status", and "dormant" shelves have no dedicated route, so
  // we render a static label only.
  const moreTarget: (() => void) | null =
    shelf.kind === "creator" && shelf.authorId != null
      ? () => onOpenAuthor(shelf.authorId!)
      : null;

  return (
    <section className="view-section shelf" aria-label={shelf.title}>
      <SectionHeading title={shelf.title} />
      <div className="card-row">
        {visibleItems.map((item) =>
          item.kind === "work" ? (
            <WorkCard
              key={`w${item.workId}`}
              workId={item.workId}
              title={item.title}
              authorId={item.authorId}
              authorName={item.authorName}
              tags={item.tags}
              meta={item.unplayedCount > 0 ? `${item.unplayedCount} unplayed` : "All played"}
              playStatus={item.unplayedCount === 0 ? "done" : "in-progress"}
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
              playStatus={dormantStatus(item.playedFraction)}
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
        {overflow > 0 && (
          moreTarget ? (
            <button
              type="button"
              className="shelf-more card"
              onClick={moreTarget}
              aria-label={`Show ${overflow} more`}
            >
              +{overflow} more
            </button>
          ) : (
            <div className="shelf-more card" aria-label={`${overflow} more not shown`}>
              +{overflow} more
            </div>
          )
        )}
      </div>
    </section>
  );
}
