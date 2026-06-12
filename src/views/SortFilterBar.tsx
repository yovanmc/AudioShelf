import type { AuthorSort, PlayedStatus } from "../lib/browse";

export function SortFilterBar(props: {
  sort: AuthorSort;
  onSortChange: (s: AuthorSort) => void;
  filterTag: string | null;
  onFilterTagChange: (t: string | null) => void;
  filterStatus: PlayedStatus;
  onFilterStatusChange: (s: PlayedStatus) => void;
  allTags: string[];
}) {
  return (
    <div className="sort-filter-bar" style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
      <label>
        Status:{" "}
        <select
          aria-label="Filter by status"
          value={props.filterStatus}
          onChange={(e) => props.onFilterStatusChange(e.target.value as PlayedStatus)}
        >
          <option value="all">All</option>
          <option value="unplayed">Has unplayed</option>
          <option value="done">Fully played</option>
          <option value="unstarted">Not started</option>
        </select>
      </label>
    </div>
  );
}
