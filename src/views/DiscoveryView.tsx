import type { MetaTerm, DiscoveryWork } from "../lib/api";
import { WorkCard } from "../components/WorkCard";
import { EmptyState, PageHeader, SectionHeading } from "../components/ui";

function WorkList({ works, onOpenAuthor, onPlayNext }: { works: DiscoveryWork[]; onOpenAuthor: (id: number) => void; onPlayNext?: (workId: number, authorId: number) => void }) {
  if (!works.length) return <EmptyState title="Personalized picks — needs listening history">Play some audio or add tags to build recommendations.</EmptyState>;
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

export function DiscoveryView(props: {
  forYou: DiscoveryWork[]; allTags: string[]; byTags: DiscoveryWork[]; picked: string[];
  onPickTags: (tags: string[]) => void; onOpenAuthor: (id: number) => void; onBack?: () => void;
  onPlayNextOfWork?: (workId: number, authorId: number) => void;
  narratorTerms: MetaTerm[]; languageTerms: MetaTerm[]; moodTerms: MetaTerm[];
  pickedFacet: { facet: string; value: string } | null;
  byFacet: DiscoveryWork[];
  onPickFacet: (facet: string, value: string) => void;
}) {
  const toggleTag = (tag: string) => props.onPickTags(
    props.picked.includes(tag) ? props.picked.filter((item) => item !== tag) : [...props.picked, tag],
  );
  return (
    <main className="view discovery">
      <PageHeader eyebrow="Suggestions from your library" title="Discover" />
      <section className="view-section">
        <SectionHeading title="Pick a tag" />
        <div className="toolbar card" style={{ padding: 12 }}>
          {props.allTags.map((tag) => {
            const on = props.picked.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                className={`chip chip--toggle${on ? " chip--on" : ""}`}
                aria-pressed={on}
                onClick={() => toggleTag(tag)}
              >{tag}</button>
            );
          })}
        </div>
        {props.picked.length > 0 && <WorkList works={props.byTags} onOpenAuthor={props.onOpenAuthor} onPlayNext={props.onPlayNextOfWork} />}
      </section>
      <section className="view-section">
        <SectionHeading title="By narrator, language, or mood" />
        {([["narrator", props.narratorTerms], ["language", props.languageTerms], ["mood", props.moodTerms]] as const)
          .filter(([, terms]) => terms.length > 0)
          .map(([facet, terms]) => (
            <div className="facet-row" key={facet}>
              <span className="facet-row__label">{facet[0].toUpperCase() + facet.slice(1)}</span>
              <div className="toolbar card" style={{ padding: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {terms.map((t) => {
                  const on = props.pickedFacet?.facet === facet && props.pickedFacet?.value === t.value;
                  return (
                    <button key={`${facet}:${t.value}`} type="button"
                      className={`chip chip--toggle${on ? " chip--on" : ""}`} aria-pressed={on}
                      onClick={() => props.onPickFacet(facet, t.value)}>
                      {t.value} <span className="muted">· {t.chapterCount}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        {props.pickedFacet && <WorkList works={props.byFacet} onOpenAuthor={props.onOpenAuthor} onPlayNext={props.onPlayNextOfWork} />}
      </section>
      <section className="view-section">
        <SectionHeading title="For You" />
        <WorkList works={props.forYou} onOpenAuthor={props.onOpenAuthor} onPlayNext={props.onPlayNextOfWork} />
      </section>
    </main>
  );
}
