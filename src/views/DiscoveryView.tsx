import { useState } from "react";
import type { LabelType, DiscoveryWork } from "../lib/api";
import { WorkCard } from "../components/WorkCard";
import { Button, EmptyState, PageHeader, SectionHeading } from "../components/ui";

export const CAP_FACET_CHIPS = 24;

function WorkList({ works, onOpenAuthor, onPlayNext, emptyTitle = "Nothing to show yet", emptyBody = "Play some audio or add tags to build recommendations." }: { works: DiscoveryWork[]; onOpenAuthor: (id: number) => void; onPlayNext?: (workId: number, authorId: number) => void; emptyTitle?: string; emptyBody?: string }) {
  if (!works.length) return <EmptyState title={emptyTitle}>{emptyBody}</EmptyState>;
  return <div className="card-grid">{works.map((work) => (
    <WorkCard
      key={work.workId}
      workId={work.workId}
      title={work.baseTitle}
      authorId={work.authorId}
      authorName={work.authorName}
      reason={work.reason && work.reason.length > 0
        ? work.reason
        : work.sharedTags.length ? `Shares ${work.sharedTags.slice(0, 2).join(" and ")}` : "Mostly unplayed"}
      tags={work.sharedTags}
      meta={`${work.unplayedCount} unplayed`}
      actionLabel="View creator"
      onAction={() => onOpenAuthor(work.authorId)}
      onOpenAuthor={() => onOpenAuthor(work.authorId)}
      onPlay={onPlayNext ? () => onPlayNext(work.workId, work.authorId) : undefined}
    />
  ))}</div>;
}

export interface DiscoveryViewProps {
  /** Ordered list of label types (from listLabelTypes, sorted by sort field). */
  labelTypes: LabelType[];
  /**
   * Terms keyed by label type name. Each entry is an array of value+count pairs.
   * Values are displayed as toggle chips with "value · count".
   */
  termsByType: Record<string, { value: string; count: number }[]>;
  /** Currently-selected label pick across ALL types. `null` when nothing is selected. */
  picked: { facet: string; value: string } | null;
  /** Called when the user toggles a chip. If the same chip is already picked, passes `null` to deselect. */
  onPickMetadata: (facet: string, value: string) => void;
  /** Results for the currently-picked facet/value, driven by getDiscoveryByMetadata. */
  byMetadata: DiscoveryWork[];
  /** "For You" personalised works, driven by getDiscovery / getDiscoveryForYou. */
  forYou: DiscoveryWork[];
  onOpenAuthor: (id: number) => void;
  onBack?: () => void;
  onPlayNextOfWork?: (workId: number, authorId: number) => void;
  /** Opens Settings so the user can add their library folder. */
  onOpenSettings?: () => void;
}

export function DiscoveryView(props: DiscoveryViewProps) {
  const { labelTypes, termsByType, picked, onPickMetadata } = props;
  // Per-type "show more" toggle: true = show all chips, false (default) = cap at CAP_FACET_CHIPS
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Filter to types that have at least one term.
  const activeTypes = labelTypes
    .filter((lt) => (termsByType[lt.name] ?? []).length > 0)
    .sort((a, b) => a.sort - b.sort);

  // Un-indexed library: no label types with any terms at all.
  if (activeTypes.length === 0 && labelTypes.length === 0) {
    return (
      <main className="view discovery">
        <PageHeader eyebrow="Suggestions from your library" title="Discover" />
        <EmptyState
          title="Nothing to discover yet"
          action={props.onOpenSettings && <Button variant="primary" onClick={props.onOpenSettings}>Set up my library</Button>}
        >Once you've added your library and listened a little, this is where you'll find picks by mood, narrator, and the labels you create.</EmptyState>
      </main>
    );
  }

  return (
    <main className="view discovery">
      <PageHeader eyebrow="Suggestions from your library" title="Discover" />
      <section className="view-section">
        <SectionHeading title="Browse by label" />
        {activeTypes.length === 0 && (
          <EmptyState title="No labels yet">Add narrators, languages, moods, or other labels to your works to browse by them here.</EmptyState>
        )}
        {activeTypes.map((lt) => {
          const terms = termsByType[lt.name] ?? [];
          const isExpanded = expanded[lt.name] ?? false;
          const visibleTerms = terms.length > CAP_FACET_CHIPS && !isExpanded
            ? terms.slice(0, CAP_FACET_CHIPS)
            : terms;
          const overflow = terms.length - CAP_FACET_CHIPS;
          return (
            <div className="facet-row" key={lt.name}>
              <span className="facet-row__label">{lt.display}</span>
              <div className="toolbar card" style={{ padding: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {visibleTerms.map((t) => {
                  const on = picked?.facet === lt.name && picked?.value === t.value;
                  return (
                    <button
                      key={`${lt.name}:${t.value}`}
                      type="button"
                      className={`chip chip--toggle${on ? " chip--on" : ""}`}
                      aria-pressed={on}
                      onClick={() => onPickMetadata(lt.name, t.value)}
                    >
                      {t.value} <span className="muted">· {t.count}</span>
                    </button>
                  );
                })}
                {terms.length > CAP_FACET_CHIPS && (
                  <button
                    type="button"
                    className="chip chip--toggle"
                    onClick={() => setExpanded((prev) => ({ ...prev, [lt.name]: !isExpanded }))}
                    aria-label={isExpanded ? `Show fewer ${lt.display} chips` : `Show ${overflow} more ${lt.display} chips`}
                  >
                    {isExpanded ? "Show less" : `+${overflow} more`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {picked && (
          <WorkList
            works={props.byMetadata}
            onOpenAuthor={props.onOpenAuthor}
            onPlayNext={props.onPlayNextOfWork}
            emptyTitle="No works for that label"
            emptyBody="Nothing in your library matches that label yet."
          />
        )}
      </section>
      <section className="view-section">
        <SectionHeading title="For You" />
        <WorkList
          works={props.forYou}
          onOpenAuthor={props.onOpenAuthor}
          onPlayNext={props.onPlayNextOfWork}
          emptyTitle="Recommendations grow as you listen"
          emptyBody="Finish a chapter or add labels to your works, and personalised picks will appear here."
        />
      </section>
    </main>
  );
}
