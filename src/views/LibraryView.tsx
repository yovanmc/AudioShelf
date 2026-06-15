import { useState } from "react";
import { FixedSizeList as List, type ListChildComponentProps } from "react-window";
import type { AuthorRow, SearchResults, ScopedResults, SavedSearch, LabelType } from "../lib/api";
import { summarizeAuthor } from "../lib/library";
import { CreatorAvatar, WorkArtwork } from "../components/Cover";
import { EmptyState, IconButton, PageHeader, TagGroup } from "../components/ui";
import { Icon } from "../components/Icon";
import { WorkCard } from "../components/WorkCard";
import { ScopedResults as ScopedResultsPanel } from "../components/ScopedResults";
import { SortFilterBar, type LabelFilter } from "./SortFilterBar";
import { filterAuthors, sortAuthors, type AuthorSort, type PlayedStatus } from "../lib/browse";
import { VirtualList, VIRTUALIZE_THRESHOLD } from "../components/VirtualList";

const SEARCH_AUTHOR_ROW_HEIGHT = 56;
const SEARCH_WORK_ROW_HEIGHT = 80;
const SEARCH_CHAPTER_ROW_HEIGHT = 64;
const SEARCH_BUCKET_HEIGHT = 400;

const ROW_HEIGHT = 72;
const LIST_HEIGHT = 600;

export function LibraryView(props: {
  authors: AuthorRow[]; query: string; results: SearchResults | null; sort: AuthorSort;
  onSortChange: (sort: AuthorSort) => void; filterTag: string | null;
  onFilterTagChange: (tag: string | null) => void; filterStatus: PlayedStatus;
  onFilterStatusChange: (status: PlayedStatus) => void; allTags: string[];
  onQueryChange: (query: string) => void; onOpenAuthor: (id: number) => void;
  onOpenHome?: () => void; onOpenDiscovery?: () => void; onOpenRename?: () => void; onOpenSettings?: () => void;
  onPlayNextOfWork?: (workId: number, authorId: number) => void;
  onPlayAuthor?: (authorId: number) => void;
  /** Advanced scoped-search results (tag/duration/status tokens). */
  scopedResults?: ScopedResults | null;
  /** True when the current query contains scoped tokens. */
  scoped?: boolean;
  /** Saved searches for this library. */
  savedSearches?: SavedSearch[];
  onSaveSearch?: (name: string, query: string) => void;
  onRunSavedSearch?: (query: string) => void;
  onDeleteSavedSearch?: (id: number) => void;
  /** Multi-select mode (scoped results only). */
  selectMode?: boolean;
  onSelectModeChange?: (on: boolean) => void;
  selectedWorkIds?: number[];
  onToggleWork?: (workId: number) => void;
  // ---- M26: Unified label filter ----
  /** Ordered label types; when provided, enables unified type→value filter UI. */
  labelTypes?: LabelType[];
  /**
   * Map from label-type name → [{value, count}].
   * Populated by termsByType in App.tsx. Drives the value select in the unified UI.
   */
  termsByType?: Record<string, { value: string; count: number }[]>;
  /**
   * Active label filter (facet + value), or null for "all".
   * Scope: filtering against AuthorRow.tags is fully supported for the "tag" facet.
   * For non-tag facets, client-side filtering is not possible (AuthorRow only carries
   * tags[]); selections on non-tag types produce an empty list — use plain search
   * (narrator:, language:, mood:, etc.) for cross-facet filtering.
   */
  labelFilter?: LabelFilter | null;
  onLabelFilterChange?: (filter: LabelFilter | null) => void;
}) {
  const [showTips, setShowTips] = useState(false);
  const [savingSearch, setSavingSearch] = useState(false);
  const [saveName, setSaveName] = useState("");
  const searching = props.query.trim() !== "";

  // Derive the effective tag filter: unified labelFilter (tag facet only) takes
  // precedence over the legacy filterTag when both are present.
  // Non-tag facets cannot be filtered client-side (AuthorRow only has tags[]),
  // so a non-tag labelFilter yields no tag match → empty list (graceful degradation).
  const effectiveTagFilter: string | null = (() => {
    if (props.labelFilter) {
      return props.labelFilter.facet === "tag" ? props.labelFilter.value : "__no_match__";
    }
    return props.filterTag;
  })();

  const visible = filterAuthors(sortAuthors(props.authors, props.sort), {
    tag: effectiveTagFilter,
    status: props.filterStatus,
  });
  const Row = ({ index, style }: ListChildComponentProps) => {
    const author = visible[index];
    return (
      <div style={{ ...style, display: "flex", alignItems: "center", gap: 4 }}>
        <button className="list-row card" style={{ flex: 1, height: ROW_HEIGHT - 6, textAlign: "left" }} onClick={() => props.onOpenAuthor(author.id)}>
          <CreatorAvatar authorId={author.id} name={author.name} size={44} />
          <span style={{ minWidth: 0, flex: 1 }}>
            <strong className="author-name">{author.name}</strong>
            <span className="author-summary muted" style={{ display: "block" }}>{summarizeAuthor(author)}</span>
          </span>
          <TagGroup tags={author.tags} max={2} align="end" />
          <Icon name="chevronRight" />
        </button>
        {props.onPlayAuthor && (
          <IconButton
            icon="play"
            label={`Play next chapter for ${author.name}`}
            onClick={() => props.onPlayAuthor!(author.id)}
          />
        )}
      </div>
    );
  };
  return (
    <main className="view library">
      <PageHeader eyebrow={searching ? "Search results" : "All creators and audio"} title="Library" />
      <div className="toolbar">
        <label style={{ display: "flex", flex: 1, alignItems: "center", gap: 8 }}>
          <Icon name="search" />
          <span className="visually-hidden">Search library</span>
          <input style={{ width: "100%" }} aria-label="Search library" placeholder="Search authors, works, chapters" value={props.query} onChange={(event) => props.onQueryChange(event.target.value)} />
        </label>
        {props.scoped && props.onSaveSearch && (
          savingSearch ? (
            <form className="save-search" style={{ marginLeft: 8, display: "inline-flex", gap: 6 }}
              onSubmit={(e) => { e.preventDefault(); const n = saveName.trim(); if (n) { props.onSaveSearch!(n, props.query); setSavingSearch(false); setSaveName(""); } }}>
              <input autoFocus aria-label="Name this search" placeholder="Name this search"
                value={saveName} onChange={(e) => setSaveName(e.target.value)} />
              <button type="submit" className="button button--primary">Save</button>
              <button type="button" className="button button--ghost" onClick={() => { setSavingSearch(false); setSaveName(""); }}>Cancel</button>
            </form>
          ) : (
            <button className="button button--ghost" style={{ marginLeft: 8, whiteSpace: "nowrap" }} onClick={() => setSavingSearch(true)}>Save search</button>
          )
        )}
        {props.scoped && props.onSelectModeChange && (
          <button
            className={`button button--ghost${props.selectMode ? " button--active" : ""}`}
            style={{ marginLeft: 8, whiteSpace: "nowrap" }}
            onClick={() => props.onSelectModeChange!(!props.selectMode)}
          >
            {props.selectMode ? "Done" : "Select"}
          </button>
        )}
      </div>
      {!searching && (
        <div className="search-tips">
          <span className="muted" style={{ fontSize: "0.85em" }}>
            Search by name, or filter by tag, length, narrator, or play status.{" "}
            <button type="button" className="link-button" aria-expanded={showTips} onClick={() => setShowTips((v) => !v)}>
              {showTips ? "Hide tips" : "Search tips"}
            </button>
          </span>
          {showTips && (
            <ul className="search-tips__list muted">
              <li><code>tag:cozy</code> — only items tagged "cozy"</li>
              <li><code>duration:&lt;15m</code> — shorter than 15 min (also <code>&gt;</code>, and <code>m</code>/<code>h</code>)</li>
              <li><code>status:unplayed</code> — unplayed only (or <code>status:played</code>)</li>
              <li><code>narrator:Jane</code> — read by a narrator</li>
              <li>Press <kbd>Ctrl</kbd> <kbd>K</kbd> to jump to any creator, work, or chapter</li>
            </ul>
          )}
        </div>
      )}
      {props.savedSearches && props.savedSearches.length > 0 && (
        <div className="saved-search-strip">
          <span className="muted">Saved:</span>
          {props.savedSearches.map((s) => (
            <span key={s.id} className="saved-search-strip__item">
              <button className="chip chip--toggle" onClick={() => props.onRunSavedSearch && props.onRunSavedSearch(s.query)}>
                {s.name}
              </button>
              {props.onDeleteSavedSearch && (
                <button
                  className="saved-search-strip__del"
                  aria-label={`Delete saved search "${s.name}"`}
                  onClick={() => props.onDeleteSavedSearch!(s.id)}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {props.scoped && props.scopedResults ? (
        <ScopedResultsPanel
          results={props.scopedResults}
          onOpenAuthor={props.onOpenAuthor}
          selectMode={props.selectMode}
          selectedWorkIds={props.selectedWorkIds}
          onToggleWork={props.onToggleWork}
        />
      ) : searching ? <SearchResultsPanel results={props.results} onOpenAuthor={props.onOpenAuthor} onPlayNextOfWork={props.onPlayNextOfWork} /> : (
        <>
          <div className="tabs" role="tablist" aria-label="Played status">
            {([
              ["all", "All"], ["unplayed", "Has unplayed"], ["done", "Fully played"], ["unstarted", "Not started"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={props.filterStatus === value}
                className={`tab${props.filterStatus === value ? " tab--active" : ""}`}
                onClick={() => props.onFilterStatusChange(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {props.labelTypes && props.termsByType && props.onLabelFilterChange ? (
            <SortFilterBar
              sort={props.sort}
              onSortChange={props.onSortChange}
              labelTypes={props.labelTypes}
              termsByType={props.termsByType}
              labelFilter={props.labelFilter}
              onLabelFilterChange={props.onLabelFilterChange}
            />
          ) : (
            <SortFilterBar
              sort={props.sort}
              onSortChange={props.onSortChange}
              filterTag={props.filterTag}
              onFilterTagChange={props.onFilterTagChange}
              allTags={props.allTags}
            />
          )}
          {visible.length === 0
            ? <EmptyState title="No creators match those filters">Adjust or clear the filters above to see more of your library.</EmptyState>
            : <List height={LIST_HEIGHT} width="100%" itemCount={visible.length} itemSize={ROW_HEIGHT}>{Row}</List>}
        </>
      )}
    </main>
  );
}

function SearchResultsPanel({
  results,
  onOpenAuthor,
  onPlayNextOfWork,
}: {
  results: SearchResults | null;
  onOpenAuthor: (id: number) => void;
  onPlayNextOfWork?: (workId: number, authorId: number) => void;
}) {
  if (!results) return <div className="card empty-state">Searching...</div>;
  const hasAny = results.authors.length || results.works.length || results.chapters.length;
  if (!hasAny) return <EmptyState title="No matches for that search">Try another creator, title, chapter, or tag — or clear the search to browse everything.</EmptyState>;
  return (
    <div className="search-results">
      {results.authors.length > 0 && <section className="view-section"><h2>Authors</h2><div className="card">
        {results.authors.length > VIRTUALIZE_THRESHOLD ? (
          <VirtualList
            items={results.authors}
            itemSize={SEARCH_AUTHOR_ROW_HEIGHT}
            height={SEARCH_BUCKET_HEIGHT}
            renderItem={(author) => (
              <div
                className="list-row"
                style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
                onClick={() => onOpenAuthor(author.authorId)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onOpenAuthor(author.authorId); }}
              >
                <CreatorAvatar authorId={author.authorId} name={author.authorName} size={40} />
                <strong>{author.authorName}</strong>
              </div>
            )}
          />
        ) : (
          results.authors.map((author) => <button className="list-row" style={{ width: "100%", background: "none", border: 0 }} key={author.authorId} onClick={() => onOpenAuthor(author.authorId)}><CreatorAvatar authorId={author.authorId} name={author.authorName} size={40} /><strong>{author.authorName}</strong></button>)
        )}
      </div></section>}
      {results.works.length > 0 && <section className="view-section"><h2>Works</h2>
        {results.works.length > VIRTUALIZE_THRESHOLD ? (
          <VirtualList
            items={results.works}
            itemSize={SEARCH_WORK_ROW_HEIGHT}
            height={SEARCH_BUCKET_HEIGHT}
            renderItem={(work) => (
              <div style={{ padding: "4px 0" }}>
                <WorkCard
                  workId={work.workId}
                  title={work.baseTitle}
                  authorId={work.authorId}
                  authorName={work.authorName}
                  actionLabel="View creator"
                  onAction={() => onOpenAuthor(work.authorId)}
                  onOpenAuthor={() => onOpenAuthor(work.authorId)}
                  onPlay={onPlayNextOfWork ? () => onPlayNextOfWork(work.workId, work.authorId) : undefined}
                />
              </div>
            )}
          />
        ) : (
          <div className="card-grid">
            {results.works.map((work) => (
              <WorkCard
                key={work.workId}
                workId={work.workId}
                title={work.baseTitle}
                authorId={work.authorId}
                authorName={work.authorName}
                actionLabel="View creator"
                onAction={() => onOpenAuthor(work.authorId)}
                onOpenAuthor={() => onOpenAuthor(work.authorId)}
                onPlay={onPlayNextOfWork ? () => onPlayNextOfWork(work.workId, work.authorId) : undefined}
              />
            ))}
          </div>
        )}
      </section>}
      {results.chapters.length > 0 && <section className="view-section"><h2>Chapters</h2><div className="card">
        {results.chapters.length > VIRTUALIZE_THRESHOLD ? (
          <VirtualList
            items={results.chapters}
            itemSize={SEARCH_CHAPTER_ROW_HEIGHT}
            height={SEARCH_BUCKET_HEIGHT}
            renderItem={(chapter) => (
              <div
                className="list-row"
                style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", textAlign: "left" }}
                onClick={() => onPlayNextOfWork ? onPlayNextOfWork(chapter.workId, chapter.authorId) : onOpenAuthor(chapter.authorId)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { onPlayNextOfWork ? onPlayNextOfWork(chapter.workId, chapter.authorId) : onOpenAuthor(chapter.authorId); } }}
              >
                <Icon name="play" />
                <WorkArtwork workId={chapter.workId} title={chapter.baseTitle} size={48} />
                <span><strong>{chapter.title}</strong><span className="muted" style={{ display: "block" }}>{chapter.baseTitle} · {chapter.authorName}</span></span>
              </div>
            )}
          />
        ) : (
          results.chapters.map((chapter) => (
            <button
              className="list-row"
              style={{ width: "100%", background: "none", border: 0, textAlign: "left" }}
              key={chapter.chapterId}
              onClick={() => onPlayNextOfWork ? onPlayNextOfWork(chapter.workId, chapter.authorId) : onOpenAuthor(chapter.authorId)}
            >
              <Icon name="play" />
              <WorkArtwork workId={chapter.workId} title={chapter.baseTitle} size={48} />
              <span><strong>{chapter.title}</strong><span className="muted" style={{ display: "block" }}>{chapter.baseTitle} · {chapter.authorName}</span></span>
            </button>
          ))
        )}
      </div></section>}
    </div>
  );
}
