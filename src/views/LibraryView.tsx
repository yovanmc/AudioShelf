import { FixedSizeList as List, type ListChildComponentProps } from "react-window";
import type { AuthorRow, SearchResults } from "../lib/api";
import { summarizeAuthor } from "../lib/library";
import { CreatorAvatar, WorkArtwork } from "../components/Cover";
import { CreatorIdentity } from "../components/CreatorIdentity";
import { EmptyState } from "../components/ui";
import { Icon } from "../components/Icon";
import { SortFilterBar } from "./SortFilterBar";
import { filterAuthors, sortAuthors, type AuthorSort, type PlayedStatus } from "../lib/browse";

const ROW_HEIGHT = 72;
const LIST_HEIGHT = 600;

export function LibraryView(props: {
  authors: AuthorRow[]; query: string; results: SearchResults | null; sort: AuthorSort;
  onSortChange: (sort: AuthorSort) => void; filterTag: string | null;
  onFilterTagChange: (tag: string | null) => void; filterStatus: PlayedStatus;
  onFilterStatusChange: (status: PlayedStatus) => void; allTags: string[];
  onQueryChange: (query: string) => void; onOpenAuthor: (id: number) => void;
  onOpenHome?: () => void; onOpenDiscovery?: () => void; onOpenRename?: () => void; onOpenSettings?: () => void;
}) {
  const searching = props.query.trim() !== "";
  const visible = filterAuthors(sortAuthors(props.authors, props.sort), { tag: props.filterTag, status: props.filterStatus });
  const Row = ({ index, style }: ListChildComponentProps) => {
    const author = visible[index];
    return (
      <div style={style}>
        <button className="list-row card" style={{ width: "100%", height: ROW_HEIGHT - 6, textAlign: "left" }} onClick={() => props.onOpenAuthor(author.id)}>
          <CreatorAvatar authorId={author.id} name={author.name} size={44} />
          <span style={{ minWidth: 0, flex: 1 }}>
            <strong className="author-name">{author.name}</strong>
            <span className="author-summary muted" style={{ display: "block" }}>{summarizeAuthor(author)}</span>
          </span>
          <span className="chips">{author.tags.slice(0, 2).map((tag) => <span className="chip" key={tag}>{tag}</span>)}</span>
          <Icon name="chevronRight" />
        </button>
      </div>
    );
  };
  return (
    <main className="view library">
      <header className="view-section"><div className="muted">All creators and audio</div><h1>Library</h1></header>
      <div className="toolbar">
        <label style={{ display: "flex", flex: 1, alignItems: "center", gap: 8 }}>
          <Icon name="search" />
          <span className="visually-hidden">Search library</span>
          <input style={{ width: "100%" }} aria-label="Search library" placeholder="Search authors, works, chapters" value={props.query} onChange={(event) => props.onQueryChange(event.target.value)} />
        </label>
      </div>
      {searching ? <SearchResultsPanel results={props.results} onOpenAuthor={props.onOpenAuthor} /> : (
        <>
          <SortFilterBar sort={props.sort} onSortChange={props.onSortChange} filterTag={props.filterTag} onFilterTagChange={props.onFilterTagChange} filterStatus={props.filterStatus} onFilterStatusChange={props.onFilterStatusChange} allTags={props.allTags} />
          {visible.length === 0
            ? <EmptyState title="No creators found">No authors match the current filters.</EmptyState>
            : <List height={LIST_HEIGHT} width="100%" itemCount={visible.length} itemSize={ROW_HEIGHT}>{Row}</List>}
        </>
      )}
    </main>
  );
}

function SearchResultsPanel({ results, onOpenAuthor }: { results: SearchResults | null; onOpenAuthor: (id: number) => void }) {
  if (!results) return <div className="card empty-state">Searching...</div>;
  if (!results.authors.length && !results.works.length && !results.chapters.length) return <EmptyState title="No matches.">Try another creator, title, chapter, or tag.</EmptyState>;
  return (
    <div className="search-results">
      {results.authors.length > 0 && <section className="view-section"><h2>Authors</h2><div className="card">
        {results.authors.map((author) => <button className="list-row" style={{ width: "100%", background: "none", border: 0 }} key={author.authorId} onClick={() => onOpenAuthor(author.authorId)}><CreatorAvatar authorId={author.authorId} name={author.authorName} size={40} /><strong>{author.authorName}</strong></button>)}
      </div></section>}
      {results.works.length > 0 && <section className="view-section"><h2>Works</h2><div className="card-grid">
        {results.works.map((work) => <button className="card work-card" style={{ textAlign: "left" }} key={work.workId} onClick={() => onOpenAuthor(work.authorId)}><WorkArtwork workId={work.workId} title={work.baseTitle} size={88} /><strong>{work.baseTitle}</strong><CreatorIdentity authorId={work.authorId} authorName={work.authorName} /></button>)}
      </div></section>}
      {results.chapters.length > 0 && <section className="view-section"><h2>Chapters</h2><div className="card">
        {results.chapters.map((chapter) => <button className="list-row" style={{ width: "100%", background: "none", border: 0, textAlign: "left" }} key={chapter.chapterId} onClick={() => onOpenAuthor(chapter.authorId)}><WorkArtwork workId={chapter.workId} title={chapter.baseTitle} size={48} /><span><strong>{chapter.title}</strong><span className="muted" style={{ display: "block" }}>{chapter.baseTitle} · {chapter.authorName}</span></span></button>)}
      </div></section>}
    </div>
  );
}
