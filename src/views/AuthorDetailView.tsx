import { useState, useEffect } from "react";
import type { AuthorDetail, ChapterRow, ChapterJournal, DiscoveryWork, PlaybackContext, SeriesView, WorkRow } from "../lib/api";
import { TagEditor } from "./TagEditor";
import { MetadataEditor } from "../components/MetadataEditor";
import { CreatorAvatar, WorkArtwork } from "../components/Cover";
import { Button, Dialog, ProgressBar, SectionHeading, TagGroup } from "../components/ui";
import { WorkCard } from "../components/WorkCard";
import { Menu } from "../components/Menu";
import { Icon } from "../components/Icon";
import { formatDuration, formatLong } from "../lib/time";
import { sortWorks, type WorkSort } from "../lib/browse";
import { ChapterJournalDialog } from "./ChapterJournalDialog";

/** Compact inline "Where I left off" note field. */
function WorkReEntryField(props: {
  workId: number;
  value: string;
  onSave: (workId: number, note: string) => void;
}) {
  const [text, setText] = useState(props.value);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <span className="muted" style={{ fontSize: "0.82rem", whiteSpace: "nowrap" }}>Where I left off:</span>
      <input
        aria-label="Where I left off note"
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{ fontSize: "0.85rem", minWidth: 120, maxWidth: 240 }}
      />
      <button
        type="button"
        className="chip chip--toggle"
        aria-label="Save re-entry note"
        onClick={() => props.onSave(props.workId, text)}
      >
        Save
      </button>
    </span>
  );
}

/** Compact inline one-word rating field. */
function WorkRatingField(props: {
  workId: number;
  value: string;
  onSave: (workId: number, rating: string) => void;
}) {
  const [text, setText] = useState(props.value);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <span className="muted" style={{ fontSize: "0.82rem", whiteSpace: "nowrap" }}>Rating:</span>
      <input
        aria-label="Completion rating"
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{ fontSize: "0.85rem", width: 90 }}
        placeholder="one word…"
      />
      <button
        type="button"
        className="chip chip--toggle"
        aria-label="Save rating"
        onClick={() => props.onSave(props.workId, text)}
      >
        Save
      </button>
    </span>
  );
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

type EditState = { chapterId: number; mode: "grouping" | "tags" | "journal" } | null;

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
  /** Persisted series for this author (empty = none detected yet). Optional so existing tests don't break. */
  series?: SeriesView[];
  /** Called when user wants to play the next unplayed chapter of a work in a series. */
  onPlayNextOfWork?: (workId: number, authorId: number) => void;
  /** "More like this" results keyed by work_id — optional; populated by App. */
  moreLikeThisMap?: Record<number, DiscoveryWork[]>;
  /** Called when user requests "More like this" for a work. */
  onRequestMoreLikeThis?: (workId: number) => void;
  /** Auto-tag suggestions keyed by work_id — optional; populated by App. */
  workTagSuggestions?: Record<number, string[]>;
  /** Called to open the author detail of another suggested work. */
  onOpenAuthor?: (authorId: number) => void;
  // ---- M17 journal props (all optional so existing tests stay unbroken) ----
  /** Journal data for the currently open chapter journal dialog. Fetched + supplied by App. */
  openJournal?: ChapterJournal | null;
  /** Called when the Journal dialog is opened so App can fetch the journal for the chapter. */
  onOpenJournal?: (chapterId: number) => void;
  /**
   * Harness-only: when set, programmatically opens the chapter journal dialog for this
   * chapter id (equivalent to clicking the Journal menu item). Used by the walkthrough
   * capture step so the dialog is rendered without mouse interaction.
   */
  openJournalForChapterId?: number;
  onSetChapterSummary?: (chapterId: number, text: string) => void;
  onSetChapterTakeaway?: (chapterId: number, text: string) => void;
  onSetChapterFavorite?: (chapterId: number, isFavorite: boolean) => void;
  onAddChapterNote?: (chapterId: number, positionSecs: number, body: string) => void;
  onDeleteChapterNote?: (noteId: number) => void;
  onAddBookmark?: (chapterId: number, positionSecs: number, label: string) => void;
  onDeleteBookmark?: (bookmarkId: number) => void;
  onSetWorkReEntryNote?: (workId: number, note: string) => void;
  onSetWorkRating?: (workId: number, rating: string) => void;
  onChapterSortChange?: (workId: number, sort: string) => void;
  // ---- M21 per-entity metadata editor props (all optional so existing tests stay unbroken) ----
  metaSuggestions?: string[];
  onAddChapterMeta?: (chapterId: number, facet: string, value: string) => void;
  onRemoveChapterMeta?: (chapterId: number, termId: number) => void;
  onAddAuthorMeta?: (authorId: number, facet: string, value: string) => void;
  onRemoveAuthorMeta?: (authorId: number, termId: number) => void;
  /**
   * Harness-only: when set, programmatically opens the per-chapter "Edit tags" dialog
   * (which hosts the MetadataEditor) for this chapter id. Used by the m21 walkthrough
   * step so the dialog is rendered without mouse interaction.
   */
  openTagsForChapterId?: number;
}) {
  const { detail, series = [], moreLikeThisMap = {}, workTagSuggestions = {} } = props;
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [editState, setEditState] = useState<EditState>(null);
  const [moreLikeThisWorkId, setMoreLikeThisWorkId] = useState<number | null>(null);

  // Harness support: open the journal dialog programmatically when openJournalForChapterId is set.
  useEffect(() => {
    if (props.openJournalForChapterId != null) {
      setEditState({ chapterId: props.openJournalForChapterId, mode: "journal" });
    }
  }, [props.openJournalForChapterId]);

  // Harness support: open the "Edit tags" dialog (which hosts the MetadataEditor) when
  // openTagsForChapterId is set. Mirrors the journal useEffect above.
  useEffect(() => {
    if (props.openTagsForChapterId != null) {
      setEditState({ chapterId: props.openTagsForChapterId, mode: "tags" });
    }
  }, [props.openTagsForChapterId]);
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
          <h1 dir="auto">{detail.name}</h1>
          <p className="muted">{works.length} works · {chapters.length} chapters · {formatLong(totalSecs)} · {progress}% played</p>
          <TagEditor tags={detail.tags} allTags={props.allTags} onChange={props.onSetTags} />
          {props.onAddAuthorMeta && props.onRemoveAuthorMeta && (
            <MetadataEditor
              applied={detail.metadata}
              suggestions={props.metaSuggestions ?? []}
              onAdd={(facet, value) => props.onAddAuthorMeta!(detail.id, facet, value)}
              onRemove={(termId) => props.onRemoveAuthorMeta!(detail.id, termId)}
            />
          )}
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
      <div role="tree" aria-label="Works and chapters">
      {works.map((w) => (
        <section key={w.id} className="work card view-section" style={{ padding: 20 }} role="treeitem" aria-expanded={!collapsed.has(w.id)} aria-level={1}>
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
              <h2 className="work-title" dir="auto">{w.baseTitle} ({w.chapters.length})</h2>
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
              suggestions={workTagSuggestions[w.id]}
            />
            {w.metadata.map((m) => (
              <span key={`m-${m.termId}`} className="chip chip--meta" title={m.facet}>{m.value}</span>
            ))}
            {props.onRequestMoreLikeThis && (
              <button
                type="button"
                className="chip chip--toggle"
                style={{ marginLeft: 8 }}
                aria-label={`More like ${w.baseTitle}`}
                onClick={() => { props.onRequestMoreLikeThis!(w.id); setMoreLikeThisWorkId(w.id); }}
              >More like this</button>
            )}
          </div>
          {(props.onSetWorkReEntryNote || props.onSetWorkRating) && (
            <div className="work-journal-meta" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginTop: 8 }}>
              {props.onSetWorkReEntryNote && (
                <WorkReEntryField
                  workId={w.id}
                  value={w.reEntryNote}
                  onSave={props.onSetWorkReEntryNote}
                />
              )}
              {props.onSetWorkRating && (
                <WorkRatingField
                  workId={w.id}
                  value={w.completionRating}
                  onSave={props.onSetWorkRating}
                />
              )}
            </div>
          )}
          {props.onChapterSortChange && (
            <div style={{ marginTop: 8 }}>
              <label style={{ fontSize: "0.85rem" }}>
                <span className="muted" style={{ marginRight: 6 }}>Chapter order:</span>
                <select
                  aria-label={`Chapter sort for ${w.baseTitle}`}
                  value={w.chapterSort}
                  onChange={(e) => props.onChapterSortChange!(w.id, e.target.value)}
                >
                  <option value="">Chapter order</option>
                  <option value="number_desc">Reverse order</option>
                  <option value="title_asc">Title A–Z</option>
                  <option value="title_desc">Title Z–A</option>
                  <option value="duration_asc">Shortest first</option>
                  <option value="duration_desc">Longest first</option>
                </select>
              </label>
            </div>
          )}
          {!collapsed.has(w.id) && (
          <ul className="recent-list" role="group">
            {w.chapters.map((c) => (
              <li className="recent-row" key={c.id} data-played={c.played ? "true" : "false"} role="treeitem" aria-level={2}>
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
                <span style={{ minWidth: 0, flex: 1 }}><span className="chapter-title" dir="auto">{c.title}</span><span className="chapter-duration muted" style={{ display: "block" }}>Chapter {c.chapterNo} · {formatDuration(c.durationSecs)}</span></span>
                <TagGroup tags={c.tags} />
                <Menu
                  label={`More options for '${c.title}'`}
                  items={[
                    { label: "Edit grouping", onSelect: () => setEditState({ chapterId: c.id, mode: "grouping" }) },
                    { label: "Edit tags", onSelect: () => setEditState({ chapterId: c.id, mode: "tags" }) },
                    { label: "Journal", onSelect: () => { setEditState({ chapterId: c.id, mode: "journal" }); props.onOpenJournal?.(c.id); } },
                  ]}
                />
              </li>
            ))}
          </ul>
          )}
        </section>
      ))}
      </div>
      {editState && editChapterInfo && editState.mode === "grouping" && (
        <Dialog label="Edit grouping" title="Edit grouping" context={`Chapter ${editChapterInfo.chapter.chapterNo ?? ""} — change which work this chapter belongs to`} onClose={() => setEditState(null)}>
          <ChapterGroupingForm
            work={editChapterInfo.work}
            chapter={editChapterInfo.chapter}
            onSetGrouping={(id, title, no) => { props.onSetGrouping(id, title, no); setEditState(null); }}
            onClearGrouping={(id) => { props.onClearGrouping(id); setEditState(null); }}
          />
        </Dialog>
      )}
      {editState && editChapterInfo && editState.mode === "tags" && (
        <Dialog label="Edit tags" title="Edit tags & metadata" context={`Tags, narrator, language, and mood for "${editChapterInfo.chapter.title}"`} onClose={() => setEditState(null)}>
          <TagEditor
            tags={editChapterInfo.chapter.tags}
            allTags={props.allTags}
            onChange={(t) => props.onSetChapterTags(editChapterInfo.chapter.id, t)}
          />
          {props.onAddChapterMeta && props.onRemoveChapterMeta && (
            <MetadataEditor
              applied={editChapterInfo.chapter.metadata}
              suggestions={props.metaSuggestions ?? []}
              onAdd={(facet, value) => props.onAddChapterMeta!(editChapterInfo.chapter.id, facet, value)}
              onRemove={(termId) => props.onRemoveChapterMeta!(editChapterInfo.chapter.id, termId)}
            />
          )}
        </Dialog>
      )}
      {editState && editChapterInfo && editState.mode === "journal" && props.openJournal && (
        <ChapterJournalDialog
          chapter={editChapterInfo.chapter}
          journal={props.openJournal}
          onClose={() => setEditState(null)}
          onSetSummary={props.onSetChapterSummary ?? (() => {})}
          onSetTakeaway={props.onSetChapterTakeaway ?? (() => {})}
          onSetFavorite={props.onSetChapterFavorite ?? (() => {})}
          onAddNote={props.onAddChapterNote ?? (() => {})}
          onDeleteNote={props.onDeleteChapterNote ?? (() => {})}
          onAddBookmark={props.onAddBookmark ?? (() => {})}
          onDeleteBookmark={props.onDeleteBookmark ?? (() => {})}
        />
      )}
      {series.length > 0 && (
        <section className="series-section view-section">
          <SectionHeading title="Reading Order / Series" />
          {series.map((s) => {
            // Find the first unfinished member (has unplayed chapters) in order.
            const nextUnfinished = s.members.find(
              (m) => m.playedChapters < m.totalChapters
            );
            return (
              <div key={s.id} className="series-spine card" style={{ padding: 16, marginBottom: 12 }}>
                <h3 className="series-title" style={{ marginBottom: 8 }}>{s.title}</h3>
                <ol className="series-members" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {s.members.map((m) => {
                    const memberProgress = m.totalChapters > 0
                      ? Math.round((m.playedChapters / m.totalChapters) * 100)
                      : 0;
                    return (
                      <li
                        key={m.workId}
                        className="series-member"
                        style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}
                      >
                        <span className="series-position muted" style={{ minWidth: 20 }}>
                          {m.position}.
                        </span>
                        <span className="series-member-title" style={{ flex: 1 }}>
                          {m.baseTitle}
                        </span>
                        <ProgressBar
                          value={memberProgress}
                          label={`${m.baseTitle} progress`}
                        />
                        <span className="muted series-member-progress" style={{ minWidth: 60, textAlign: "right" }}>
                          {m.playedChapters}/{m.totalChapters}
                        </span>
                      </li>
                    );
                  })}
                </ol>
                {nextUnfinished && props.onPlayNextOfWork && (
                  <Button
                    variant="primary"
                    onClick={() => props.onPlayNextOfWork!(nextUnfinished.workId, detail.id)}
                    aria-label={`Continue the series ${s.title}`}
                  >
                    Continue the series
                  </Button>
                )}
              </div>
            );
          })}
        </section>
      )}
      {moreLikeThisWorkId !== null && moreLikeThisMap[moreLikeThisWorkId] !== undefined && (
        <Dialog label="More like this" title="More like this" context={`Works similar to "${works.find((w) => w.id === moreLikeThisWorkId)?.baseTitle ?? "this work"}"`} onClose={() => setMoreLikeThisWorkId(null)}>
          <div style={{ padding: 8 }}>
            {moreLikeThisMap[moreLikeThisWorkId].length === 0
              ? <p className="muted">No similar works found in your library.</p>
              : <div className="card-grid">
                  {moreLikeThisMap[moreLikeThisWorkId].map((w) => (
                    <WorkCard
                      key={w.workId}
                      workId={w.workId}
                      title={w.baseTitle}
                      authorId={w.authorId}
                      authorName={w.authorName}
                      reason={w.reason && w.reason.length > 0 ? w.reason : undefined}
                      tags={w.sharedTags}
                      meta={`${w.unplayedCount} unplayed`}
                      actionLabel="View creator"
                      onAction={() => { setMoreLikeThisWorkId(null); props.onOpenAuthor?.(w.authorId); }}
                      onOpenAuthor={() => { setMoreLikeThisWorkId(null); props.onOpenAuthor?.(w.authorId); }}
                    />
                  ))}
                </div>
            }
          </div>
        </Dialog>
      )}
    </main>
  );
}
