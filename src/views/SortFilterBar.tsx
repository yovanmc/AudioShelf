import type { AuthorSort } from "../lib/browse";
import { Select } from "../components/Select";
import type { SelectOption } from "../components/Select";

const SORT_OPTIONS: SelectOption<string>[] = [
  { value: "az", label: "A–Z" },
  { value: "length", label: "Length (longest)" },
  { value: "played", label: "Played %" },
];

export function SortFilterBar(props: {
  sort: AuthorSort;
  onSortChange: (s: AuthorSort) => void;
  filterTag: string | null;
  onFilterTagChange: (t: string | null) => void;
  allTags: string[];
}) {
  const tagOptions: SelectOption<string>[] = [
    { value: "", label: "All tags" },
    ...props.allTags.map((t) => ({ value: t, label: t })),
  ];

  return (
    <div className="sort-filter-bar toolbar card" style={{ padding: 12 }}>
      <Select<string>
        label="Sort authors"
        value={props.sort}
        options={SORT_OPTIONS}
        onChange={(v) => props.onSortChange(v as AuthorSort)}
      />
      <Select<string>
        label="Filter by tag"
        value={props.filterTag ?? ""}
        options={tagOptions}
        onChange={(v) => props.onFilterTagChange(v === "" ? null : v)}
      />
    </div>
  );
}
