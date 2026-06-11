import type { AuthorDetail, ChapterRow } from "../lib/api";
import { TagEditor } from "./TagEditor";

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function AuthorDetailView(props: {
  detail: AuthorDetail;
  onTogglePlayed: (chapterId: number, played: boolean) => void;
  onPlayChapter: (chapter: ChapterRow) => void;
  onSetTags: (tags: string[]) => void;
  allTags: string[];
  onBack: () => void;
}) {
  const { detail } = props;
  return (
    <div className="author-detail">
      <button onClick={props.onBack}>← Library</button>
      <h1>{detail.name}</h1>
      <TagEditor tags={detail.tags} allTags={props.allTags} onChange={props.onSetTags} />
      {detail.works.map((w) => (
        <section key={w.id} className="work">
          <h2><span className="work-title">{w.baseTitle}{" "}({w.chapters.length})</span></h2>
          <ul>
            {w.chapters.map((c) => (
              <li key={c.id} data-played={c.played ? "true" : "false"}>
                <button aria-label={`Play '${c.title}'`} onClick={() => props.onPlayChapter(c)}>▶</button>
                <label aria-label={`Mark '${c.title}' played`}>
                  <input
                    type="checkbox"
                    checked={c.played}
                    onChange={(e) => props.onTogglePlayed(c.id, e.target.checked)}
                  />
                </label>
                <span className="chapter-title">{c.title}</span>{" — "}
                <span className="chapter-duration">{formatDuration(c.durationSecs)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
