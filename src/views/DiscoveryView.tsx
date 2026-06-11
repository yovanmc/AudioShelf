import { useState } from "react";
import type { DiscoveryWork } from "../lib/api";

function WorkList(props: { works: DiscoveryWork[]; onOpenAuthor: (id: number) => void }) {
  if (props.works.length === 0) return <p className="discovery-empty">Nothing to suggest yet.</p>;
  return (
    <ul className="discovery-list">
      {props.works.map((w) => (
        <li key={w.workId}>
          <span className="discovery-title">{w.baseTitle}</span>
          {" — "}
          <button aria-label={`Open ${w.authorName}`} onClick={() => props.onOpenAuthor(w.authorId)}>{w.authorName}</button>
          {" · "}
          <span className="discovery-meta">{w.unplayedCount} unplayed{w.sharedTags.length > 0 ? ` · ${w.sharedTags.join(", ")}` : ""}</span>
        </li>
      ))}
    </ul>
  );
}

export function DiscoveryView(props: {
  forYou: DiscoveryWork[];
  allTags: string[];
  byTags: DiscoveryWork[];
  onPickTags: (tags: string[]) => void;
  onOpenAuthor: (id: number) => void;
  onBack: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);

  function toggleTag(tag: string) {
    const next = picked.includes(tag) ? picked.filter((t) => t !== tag) : [...picked, tag];
    setPicked(next);
    props.onPickTags(next);
  }

  return (
    <div className="discovery">
      <button onClick={props.onBack}>← Library</button>
      <h1>Discover</h1>

      <section>
        <h2>For you</h2>
        <WorkList works={props.forYou} onOpenAuthor={props.onOpenAuthor} />
      </section>

      <section>
        <h2>Pick a tag</h2>
        <div className="tag-picker">
          {props.allTags.map((t) => (
            <label key={t} aria-label={`Filter by tag ${t}`}>
              <input type="checkbox" checked={picked.includes(t)} onChange={() => toggleTag(t)} /> {t}
            </label>
          ))}
        </div>
        {picked.length > 0 && <WorkList works={props.byTags} onOpenAuthor={props.onOpenAuthor} />}
      </section>
    </div>
  );
}
