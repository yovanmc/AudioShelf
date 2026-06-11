import { useState } from "react";
import type { AuthorDetail, ChapterRow, WorkRow } from "../lib/api";
import { TagEditor } from "./TagEditor";

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function ChapterGroupingForm(props: {
  work: WorkRow;
  chapter: ChapterRow;
  onSetGrouping: (chapterId: number, baseTitle: string, chapterNo: number) => void;
  onClearGrouping: (chapterId: number) => void;
}) {
  const { work, chapter } = props;
  const [title, setTitle] = useState(work.baseTitle);
  const [no, setNo] = useState(String(chapter.chapterNo));
  return (
    <span className="chapter-grouping">
      {" · "}
      <input
        aria-label={`Work title for '${chapter.title}'`}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <input
        aria-label={`Chapter number for '${chapter.title}'`}
        type="number"
        value={no}
        onChange={(e) => setNo(e.target.value)}
      />
      <button
        aria-label={`Save grouping for '${chapter.title}'`}
        onClick={() => props.onSetGrouping(chapter.id, title.trim(), Number(no) || 1)}
      >
        Save grouping
      </button>
      <button
        aria-label={`Reset grouping for '${chapter.title}'`}
        onClick={() => props.onClearGrouping(chapter.id)}
      >
        Reset
      </button>
    </span>
  );
}

export function AuthorDetailView(props: {
  detail: AuthorDetail;
  onTogglePlayed: (chapterId: number, played: boolean) => void;
  onPlayChapter: (chapter: ChapterRow) => void;
  onSetTags: (tags: string[]) => void;
  onSetGrouping: (chapterId: number, baseTitle: string, chapterNo: number) => void;
  onClearGrouping: (chapterId: number) => void;
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
                <ChapterGroupingForm
                  work={w}
                  chapter={c}
                  onSetGrouping={props.onSetGrouping}
                  onClearGrouping={props.onClearGrouping}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
