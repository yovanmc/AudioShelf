import type { AuthorSort } from "../lib/browse";

export function SortFilterBar(props: {
  sort: AuthorSort;
  onSortChange: (s: AuthorSort) => void;
  filterTag: string | null;
  onFilterTagChange: (t: string | null) => void;
  allTags: string[];
}) {
  return (
    <div className="sort-filter-bar toolbar card" style={{ padding: 12 }}>
      <label>
        Sort:{" "}
        <select
          aria-label="Sort authors"
          value={props.sort}
          onChange={(e) => props.onSortChange(e.target.value as AuthorSort)}
        >
          <option value="az">A–Z</option>
          <option value="length">Length (longest)</option>
          <option value="played">Played %</option>
        </select>
      </label>
      <label>
        Tag:{" "}
        <select
          aria-label="Filter by tag"
          value={props.filterTag ?? ""}
          onChange={(e) => props.onFilterTagChange(e.target.value === "" ? null : e.target.value)}
        >
          <option value="">All tags</option>
          {props.allTags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
