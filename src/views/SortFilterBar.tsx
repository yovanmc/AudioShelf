import { useState } from "react";
import type { AuthorSort } from "../lib/browse";
import type { LabelType } from "../lib/api";
import { Select } from "../components/Select";
import type { SelectOption } from "../components/Select";

const SORT_OPTIONS: SelectOption<string>[] = [
  { value: "az", label: "A–Z" },
  { value: "length", label: "Length (longest)" },
  { value: "played", label: "Played %" },
];

/** A label filter selection: the facet (label type name) and value. */
export interface LabelFilter {
  facet: string;
  value: string;
}

export function SortFilterBar(props: {
  sort: AuthorSort;
  onSortChange: (s: AuthorSort) => void;
  /** @deprecated use labelFilter + onLabelFilterChange; kept for backward compat */
  filterTag?: string | null;
  /** @deprecated use labelFilter + onLabelFilterChange; kept for backward compat */
  onFilterTagChange?: (t: string | null) => void;
  /** @deprecated use labelTypes + termsByType; kept for backward compat */
  allTags?: string[];
  /** Unified label types (ordered). When provided, enables two-select type→value UI. */
  labelTypes?: LabelType[];
  /**
   * Map from label-type name → [{value, count}].
   * When provided alongside labelTypes, populates the value select for the chosen type.
   */
  termsByType?: Record<string, { value: string; count: number }[]>;
  /** Active label filter (type + value), or null for "all". */
  labelFilter?: LabelFilter | null;
  onLabelFilterChange?: (filter: LabelFilter | null) => void;
}) {
  // Unified mode: labelTypes + termsByType + onLabelFilterChange are all present.
  const unified =
    props.labelTypes !== undefined &&
    props.termsByType !== undefined &&
    props.onLabelFilterChange !== undefined;

  if (unified) {
    return (
      <SortFilterBarUnified
        sort={props.sort}
        onSortChange={props.onSortChange}
        labelTypes={props.labelTypes!}
        termsByType={props.termsByType!}
        labelFilter={props.labelFilter ?? null}
        onLabelFilterChange={props.onLabelFilterChange!}
      />
    );
  }

  // Legacy mode: single tag select (backward compat — existing tests keep passing)
  const allTags = props.allTags ?? [];
  const tagOptions: SelectOption<string>[] = [
    { value: "", label: "All tags" },
    ...allTags.map((t) => ({ value: t, label: t })),
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
        onChange={(v) => props.onFilterTagChange?.(v === "" ? null : v)}
      />
    </div>
  );
}

// ---- Unified two-select UI ----

function SortFilterBarUnified(props: {
  sort: AuthorSort;
  onSortChange: (s: AuthorSort) => void;
  labelTypes: LabelType[];
  termsByType: Record<string, { value: string; count: number }[]>;
  labelFilter: LabelFilter | null;
  onLabelFilterChange: (filter: LabelFilter | null) => void;
}) {
  const { labelTypes, termsByType, labelFilter, onLabelFilterChange } = props;

  // Local state tracks the type the user has selected, even before they pick a value.
  // This avoids the type select resetting when no value has been chosen yet.
  const [pendingType, setPendingType] = useState<string>(labelFilter?.facet ?? "");

  // Sync pendingType when the active filter changes externally (e.g. cleared by parent).
  const effectiveType = labelFilter ? labelFilter.facet : pendingType;

  const typeOptions: SelectOption<string>[] = [
    { value: "", label: "All labels" },
    ...labelTypes.map((lt) => ({ value: lt.name, label: lt.display })),
  ];

  const valuesForType: { value: string; count: number }[] =
    effectiveType ? (termsByType[effectiveType] ?? []) : [];

  const valueOptions: SelectOption<string>[] = [
    { value: "", label: effectiveType ? "All values" : "— pick a type first —" },
    ...valuesForType.map((v) => ({
      value: v.value,
      label: v.count > 0 ? `${v.value} (${v.count})` : v.value,
    })),
  ];

  const selectedValue = labelFilter?.value ?? "";

  const handleTypeChange = (newType: string) => {
    setPendingType(newType);
    // Clear any active filter when type changes.
    onLabelFilterChange(null);
  };

  const handleValueChange = (newValue: string) => {
    if (!newValue || !effectiveType) {
      onLabelFilterChange(null);
    } else {
      onLabelFilterChange({ facet: effectiveType, value: newValue });
    }
  };

  return (
    <div className="sort-filter-bar toolbar card" style={{ padding: 12 }}>
      <Select<string>
        label="Sort authors"
        value={props.sort}
        options={SORT_OPTIONS}
        onChange={(v) => props.onSortChange(v as AuthorSort)}
      />
      <Select<string>
        label="Filter by label type"
        value={effectiveType}
        options={typeOptions}
        onChange={handleTypeChange}
      />
      <Select<string>
        label="Filter by label value"
        value={selectedValue}
        options={valueOptions}
        onChange={handleValueChange}
      />
    </div>
  );
}
