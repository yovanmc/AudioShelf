import type { DiscoveryWork } from "../lib/api";
import { WorkCard } from "../components/WorkCard";
import { EmptyState } from "../components/ui";

function WorkList({ works, onOpenAuthor }: { works: DiscoveryWork[]; onOpenAuthor: (id: number) => void }) {
  if (!works.length) return <EmptyState title="Nothing to suggest yet">Play some audio or add tags to build recommendations.</EmptyState>;
  return <div className="card-grid">{works.map((work) => (
    <WorkCard
      key={work.workId}
      workId={work.workId}
      title={work.baseTitle}
      authorId={work.authorId}
      authorName={work.authorName}
      reason={work.sharedTags.length ? `Shares ${work.sharedTags.slice(0, 2).join(" and ")}` : "Mostly unplayed"}
      tags={work.sharedTags}
      meta={`${work.unplayedCount} unplayed`}
      actionLabel="View creator"
      onAction={() => onOpenAuthor(work.authorId)}
      onOpenAuthor={() => onOpenAuthor(work.authorId)}
    />
  ))}</div>;
}

export function DiscoveryView(props: {
  forYou: DiscoveryWork[]; allTags: string[]; byTags: DiscoveryWork[]; picked: string[];
  onPickTags: (tags: string[]) => void; onOpenAuthor: (id: number) => void; onBack?: () => void;
}) {
  const toggleTag = (tag: string) => props.onPickTags(
    props.picked.includes(tag) ? props.picked.filter((item) => item !== tag) : [...props.picked, tag],
  );
  return (
    <main className="view discovery">
      <header className="view-section"><div className="muted">Tag and history powered</div><h1>Discover</h1></header>
      <section className="view-section"><h2>For You</h2><WorkList works={props.forYou} onOpenAuthor={props.onOpenAuthor} /></section>
      <section className="view-section">
        <h2>Pick a tag</h2>
        <div className="toolbar card" style={{ padding: 12 }}>
          {props.allTags.map((tag) => <label className="chip" key={tag} aria-label={`Filter by tag ${tag}`}><input type="checkbox" checked={props.picked.includes(tag)} onChange={() => toggleTag(tag)} /> {tag}</label>)}
        </div>
        {props.picked.length > 0 && <WorkList works={props.byTags} onOpenAuthor={props.onOpenAuthor} />}
      </section>
    </main>
  );
}
