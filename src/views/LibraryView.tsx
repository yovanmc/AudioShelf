import { FixedSizeList as List, type ListChildComponentProps } from "react-window";
import type { AuthorRow, SearchResults } from "../lib/api";
import { summarizeAuthor } from "../lib/library";
import { Cover } from "../components/Cover";
import { SortFilterBar } from "./SortFilterBar";
import { filterAuthors, sortAuthors, type AuthorSort, type PlayedStatus } from "../lib/browse";

const ROW_HEIGHT = 56;
const LIST_HEIGHT = 600;

export function LibraryView(props: {
  authors: AuthorRow[];
  query: string;
  results: SearchResults | null;
  sort: AuthorSort;
  onSortChange: (s: AuthorSort) => void;
  filterTag: string | null;
  onFilterTagChange: (t: string | null) => void;
  filterStatus: PlayedStatus;
  onFilterStatusChange: (s: PlayedStatus) => void;
  allTags: string[];
  onQueryChange: (q: string) => void;
  onOpenAuthor: (id: number) => void;
  onOpenHome: () => void;
  onOpenDiscovery: () => void;
  onOpenRename: () => void;
  onOpenSettings: () => void;
}) {
  const searching = props.query.trim() !== "";

  // Sort then filter the in-memory author list (M7 fetched all authors up front).
  const visible = filterAuthors(sortAuthors(props.authors, props.sort), {
    tag: props.filterTag,
    status: props.filterStatus,
  });

  // One virtualized author row. react-window supplies `style` for positioning;
  // it MUST be applied to the outer element.
  const Row = ({ index, style }: ListChildComponentProps) => {
    const a = visible[index];
    return (
      <div style={style}>
        <button
          onClick={() => props.onOpenAuthor(a.id)}
          style={{ display: "flex", alignItems: "center", width: "100%", textAlign: "left" }}
        >
          <Cover kind="author" id={a.id} name={a.name} />
          <span>
            <span className="author-name">{a.name}</span>
            {" — "}
            <span className="author-summary">{summarizeAuthor(a)}</span>
          </span>
        </button>
      </div>
    );
  };

  return (
    <div className="library">
      <button onClick={props.onOpenHome}>🏠 Home</button>
      <button onClick={props.onOpenDiscovery}>Discover</button>
      <button onClick={props.onOpenRename}>Rename tool</button>
      <button onClick={props.onOpenSettings}>Settings</button>
      <input
        placeholder="Search authors, works, chapters"
        value={props.query}
        onChange={(e) => props.onQueryChange(e.target.value)}
      />
      {searching ? (
        <SearchResultsPanel results={props.results} onOpenAuthor={props.onOpenAuthor} />
      ) : (
        <>
          <SortFilterBar
            sort={props.sort}
            onSortChange={props.onSortChange}
            filterTag={props.filterTag}
            onFilterTagChange={props.onFilterTagChange}
            filterStatus={props.filterStatus}
            onFilterStatusChange={props.onFilterStatusChange}
            allTags={props.allTags}
          />
          {visible.length === 0 ? (
            <p className="empty-filter">No authors match the current filter.</p>
          ) : (
            <List height={LIST_HEIGHT} width="100%" itemCount={visible.length} itemSize={ROW_HEIGHT}>
              {Row}
            </List>
          )}
        </>
      )}
    </div>
  );
}

function SearchResultsPanel(props: {
  results: SearchResults | null;
  onOpenAuthor: (id: number) => void;
}) {
  const r = props.results;
  if (!r) return <p>Searching…</p>;
  const empty = r.authors.length === 0 && r.works.length === 0 && r.chapters.length === 0;
  if (empty) return <p>No matches.</p>;
  return (
    <div className="search-results">
      {r.authors.length > 0 && (
        <section>
          <h3>Authors</h3>
          <ul>
            {r.authors.map((a) => (
              <li key={`a${a.authorId}`}>
                <button onClick={() => props.onOpenAuthor(a.authorId)}>
                  <Cover kind="author" id={a.authorId} name={a.authorName} />
                  {a.authorName}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {r.works.length > 0 && (
        <section>
          <h3>Works</h3>
          <ul>
            {r.works.map((w) => (
              <li key={`w${w.workId}`}>
                <button onClick={() => props.onOpenAuthor(w.authorId)}>
                  {w.baseTitle} <span className="muted">— {w.authorName}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {r.chapters.length > 0 && (
        <section>
          <h3>Chapters</h3>
          <ul>
            {r.chapters.map((c) => (
              <li key={`c${c.chapterId}`}>
                <button onClick={() => props.onOpenAuthor(c.authorId)}>
                  {c.title} <span className="muted">— {c.baseTitle} · {c.authorName}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
