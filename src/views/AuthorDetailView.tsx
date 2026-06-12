import { useState } from "react";
import type { AuthorDetail, ChapterRow, PlaybackContext, WorkRow } from "../lib/api";
import { TagEditor } from "./TagEditor";
import { CreatorAvatar, WorkArtwork } from "../components/Cover";
import { Button, Dialog, ProgressBar, TagGroup } from "../components/ui";
import { Menu } from "../components/Menu";
import { Icon } from "../components/Icon";
import { formatDuration, formatLong } from "../lib/time";
import { sortWorks, type WorkSort } from "../lib/browse";

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

type EditState = { chapterId: number; mode: "grouping" | "tags" } | null;

export function AuthorDetailView(props: {
  detail: AuthorDetail;
  onTogglePlayed: (chapterId: number, played: boolean) => void;
  onPlayChapter: (context: PlaybackContext) => void;
  onSetTags: (tags: string[]) => void;
  onSetGrouping: (chapterId: number, baseTitle: string, chapterNo: number) => void;
  onClearGrouping: (chapterId: number) => void;
  onSetWorkTags: (workId: number, tags: string[]) => void;
  onSetChapterTags: (chapterId: number, tags: string[]) => void;
  allTags: string[];
  onBack: () => void;
  workSort: WorkSort;
  onWorkSortChange: (s: WorkSort) => void;
}) {
  const { detail } = props;
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [editState, setEditState] = useState<EditState>(null);
  const works = sortWorks(detail.works, props.workSort);
  const allCollapsed = works.length > 0 && works.every((w) => collapsed.has(w.id));
  const toggleWork = (id: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => setCollapsed(new Set(works.map((w) => w.id)));
  const chapters = detail.works.flatMap((work) => work.chapters);
  const played = chapters.filter((chapter) => chapter.played).length;
  const totalSecs = chapters.reduce((sum, chapter) => sum + chapter.durationSecs, 0);
  const progress = chapters.length ? Math.round((played / chapters.length) * 100) : 0;
  const firstUnplayed = works
    .flatMap((work) => work.chapters.map((chapter) => ({ work, chapter })))
    .find(({ chapter }) => !chapter.played);

  // Find the chapter and work for the currently open dialog
  const editChapterInfo = editState
    ? (() => {
        for (const w of detail.works) {
          const c = w.chapters.find((ch) => ch.id === editState.chapterId);
          if (c) return { work: w, chapter: c };
        }
        return null;
      })()
    : null;

  return (
    <main className="view author-detail">
      <Button variant="ghost" onClick={props.onBack}><Icon name="chevronLeft" /> Library</Button>
      <section className="card view-section" style={{ display: "flex", gap: 24, alignItems: "center", padding: 24 }}>
        <CreatorAvatar authorId={detail.id} name={detail.name} size={112} />
        <div style={{ flex: 1 }}>
          <div className="muted">Creator</div>
          <h1>{detail.name}</h1>
          <p className="muted">{works.length} works · {chapters.length} chapters · {formatLong(totalSecs)} · {progress}% played</p>
          <TagEditor tags={detail.tags} allTags={props.allTags} onChange={props.onSetTags} />
          {firstUnplayed && <Button variant="primary" onClick={() => props.onPlayChapter({
            chapter: firstUnplayed.chapter,
            authorId: detail.id,
            authorName: detail.name,
            workId: firstUnplayed.work.id,
            workTitle: firstUnplayed.work.baseTitle,
            workTotalChapters: firstUnplayed.work.chapters.length,
            workPlayedChapters: firstUnplayed.work.chapters.filter((chapter) => chapter.played).length,
          })}>Keep listening</Button>}
        </div>
      </section>
      <div className="work-controls toolbar">
        <span className="muted">Works ({detail.works.length})</span>
        <label>
          Sort works:{" "}
          <select
            aria-label="Sort works"
            value={props.workSort}
            onChange={(e) => props.onWorkSortChange(e.target.value as WorkSort)}
          >
            <option value="az">A–Z</option>
            <option value="length">Length (longest)</option>
            <option value="played">Played %</option>
          </select>
        </label>
        <Button variant="secondary" onClick={allCollapsed ? expandAll : collapseAll}>
          {allCollapsed ? "Expand all" : "Collapse all"}
        </Button>
      </div>
      {works.map((w) => (
        <section key={w.id} className="work card view-section" style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button
              aria-label={`${collapsed.has(w.id) ? "Expand" : "Collapse"} '${w.baseTitle}'`}
              onClick={() => toggleWork(w.id)}
              className="icon-button"
            >
              <Icon name={collapsed.has(w.id) ? "chevronRight" : "collapse"} />
            </button>
            <WorkArtwork workId={w.id} title={w.baseTitle} size={72} />
            <div style={{ flex: 1 }}>
              <h2 className="work-title">{w.baseTitle} ({w.chapters.length})</h2>
              <div className="muted">{w.chapters.length} chapters · {w.chapters.filter((chapter) => !chapter.played).length} unplayed · {formatLong(w.chapters.reduce((s, c) => s + c.durationSecs, 0))}</div>
              <ProgressBar value={w.chapters.length ? Math.round((w.chapters.filter((chapter) => chapter.played).length / w.chapters.length) * 100) : 0} label={`${w.baseTitle} progress`} />
            </div>
          </div>
          <div className="work-tags">
            <span className="work-tags-label">Tags:</span>
            <TagEditor
              tags={w.tags}
              allTags={props.allTags}
              onChange={(t) => props.onSetWorkTags(w.id, t)}
            />
          </div>
          {!collapsed.has(w.id) && (
          <ul className="recent-list">
            {w.chapters.map((c) => (
              <li className="recent-row" key={c.id} data-played={c.played ? "true" : "false"}>
                <button className="icon-button" aria-label={`Play '${c.title}'`} onClick={() => props.onPlayChapter({
                  chapter: c,
                  authorId: detail.id,
                  authorName: detail.name,
                  workId: w.id,
                  workTitle: w.baseTitle,
                  workTotalChapters: w.chapters.length,
                  workPlayedChapters: w.chapters.filter((chapter) => chapter.played).length,
                })}><Icon name="play" /></button>
                <label aria-label={`Mark '${c.title}' played`}>
                  <input
                    type="checkbox"
                    checked={c.played}
                    onChange={(e) => props.onTogglePlayed(c.id, e.target.checked)}
                  />
                </label>
                <span style={{ minWidth: 0, flex: 1 }}><span className="chapter-title">{c.title}</span><span className="chapter-duration muted" style={{ display: "block" }}>Chapter {c.chapterNo} · {formatDuration(c.durationSecs)}</span></span>
                <TagGroup tags={c.tags} />
                <Menu
                  label={`More options for '${c.title}'`}
                  items={[
                    { label: "Edit grouping", onSelect: () => setEditState({ chapterId: c.id, mode: "grouping" }) },
                    { label: "Edit tags", onSelect: () => setEditState({ chapterId: c.id, mode: "tags" }) },
                  ]}
                />
              </li>
            ))}
          </ul>
          )}
        </section>
      ))}
      {editState && editChapterInfo && editState.mode === "grouping" && (
        <Dialog label="Edit grouping" onClose={() => setEditState(null)}>
          <ChapterGroupingForm
            work={editChapterInfo.work}
            chapter={editChapterInfo.chapter}
            onSetGrouping={(id, title, no) => { props.onSetGrouping(id, title, no); setEditState(null); }}
            onClearGrouping={(id) => { props.onClearGrouping(id); setEditState(null); }}
          />
        </Dialog>
      )}
      {editState && editChapterInfo && editState.mode === "tags" && (
        <Dialog label="Edit tags" onClose={() => setEditState(null)}>
          <TagEditor
            tags={editChapterInfo.chapter.tags}
            allTags={props.allTags}
            onChange={(t) => props.onSetChapterTags(editChapterInfo.chapter.id, t)}
          />
        </Dialog>
      )}
    </main>
  );
}
