import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SortFilterBar } from "./SortFilterBar";
import type { AuthorSort } from "../lib/browse";
import type { LabelType } from "../lib/api";

function baseProps(over: Partial<React.ComponentProps<typeof SortFilterBar>> = {}) {
  return {
    sort: "az" as AuthorSort,
    onSortChange: vi.fn(),
    filterTag: null as string | null,
    onFilterTagChange: vi.fn(),
    allTags: [],
    ...over,
  };
}

describe("SortFilterBar", () => {
  it("renders sort and tag selects (status moved to tab bar in LibraryView)", () => {
    render(<SortFilterBar {...baseProps()} />);
    expect(screen.getByRole("button", { name: "Sort authors" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter by tag" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Filter by status" })).not.toBeInTheDocument();
  });

  it("sort select shows current option label", () => {
    render(<SortFilterBar {...baseProps()} />);
    const trigger = screen.getByRole("button", { name: "Sort authors" });
    expect(trigger).toHaveTextContent("A–Z");
  });

  it("sort select opens with expected options", async () => {
    render(<SortFilterBar {...baseProps()} />);
    await userEvent.click(screen.getByRole("button", { name: "Sort authors" }));
    expect(screen.getByRole("option", { name: "A–Z" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Length (longest)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Played %" })).toBeInTheDocument();
  });

  it("does not render status options (status filter moved to tab bar in LibraryView)", () => {
    render(<SortFilterBar {...baseProps()} />);
    expect(screen.queryByRole("option", { name: "Has unlistened chapters" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Fully played" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Not started" })).not.toBeInTheDocument();
  });

  it("tag select opens and shows 'All tags' plus provided tags", async () => {
    render(<SortFilterBar {...baseProps({ allTags: ["fiction", "nonfiction"] })} />);
    await userEvent.click(screen.getByRole("button", { name: "Filter by tag" }));
    expect(screen.getByRole("option", { name: "All tags" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "fiction" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "nonfiction" })).toBeInTheDocument();
  });

  it("changing sort fires onSortChange with 'length'", async () => {
    const onSortChange = vi.fn();
    render(<SortFilterBar {...baseProps({ onSortChange })} />);
    await userEvent.click(screen.getByRole("button", { name: "Sort authors" }));
    await userEvent.click(screen.getByRole("option", { name: "Length (longest)" }));
    expect(onSortChange).toHaveBeenCalledWith("length");
  });

  it("selecting a tag fires onFilterTagChange with that tag", async () => {
    const onFilterTagChange = vi.fn();
    render(<SortFilterBar {...baseProps({ onFilterTagChange, allTags: ["fantasy"] })} />);
    await userEvent.click(screen.getByRole("button", { name: "Filter by tag" }));
    await userEvent.click(screen.getByRole("option", { name: "fantasy" }));
    expect(onFilterTagChange).toHaveBeenCalledWith("fantasy");
  });

  it("selecting 'All tags' fires onFilterTagChange with null", async () => {
    const onFilterTagChange = vi.fn();
    render(
      <SortFilterBar {...baseProps({ onFilterTagChange, filterTag: "fantasy", allTags: ["fantasy"] })} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Filter by tag" }));
    await userEvent.click(screen.getByRole("option", { name: "All tags" }));
    expect(onFilterTagChange).toHaveBeenCalledWith(null);
  });

  it("only two select triggers are rendered (sort + tag)", () => {
    render(<SortFilterBar {...baseProps()} />);
    // The Select trigger buttons — one for sort, one for tag filter
    expect(screen.getByRole("button", { name: "Sort authors" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter by tag" })).toBeInTheDocument();
  });
});

// ---- Unified label type→value UI (M26) ----

const LABEL_TYPES: LabelType[] = [
  { name: "tag", display: "Tags", builtin: true, sort: 0 },
  { name: "narrator", display: "Narrator", builtin: true, sort: 1 },
];

const TERMS_BY_TYPE: Record<string, { value: string; count: number }[]> = {
  tag: [
    { value: "fiction", count: 3 },
    { value: "nonfiction", count: 1 },
  ],
  narrator: [{ value: "Jane Doe", count: 2 }],
};

function unifiedProps(over: Partial<React.ComponentProps<typeof SortFilterBar>> = {}) {
  return {
    sort: "az" as AuthorSort,
    onSortChange: vi.fn(),
    labelTypes: LABEL_TYPES,
    termsByType: TERMS_BY_TYPE,
    labelFilter: null as null | { facet: string; value: string },
    onLabelFilterChange: vi.fn(),
    ...over,
  };
}

describe("SortFilterBar — unified label mode", () => {
  it("renders three selects: sort, label type, label value", () => {
    render(<SortFilterBar {...unifiedProps()} />);
    expect(screen.getByRole("button", { name: "Sort authors" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter by label type" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter by label value" })).toBeInTheDocument();
  });

  it("does NOT render the legacy 'Filter by tag' button in unified mode", () => {
    render(<SortFilterBar {...unifiedProps()} />);
    expect(screen.queryByRole("button", { name: "Filter by tag" })).not.toBeInTheDocument();
  });

  it("type select shows 'All labels' + label type display names", async () => {
    render(<SortFilterBar {...unifiedProps()} />);
    await userEvent.click(screen.getByRole("button", { name: "Filter by label type" }));
    expect(screen.getByRole("option", { name: "All labels" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Tags" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Narrator" })).toBeInTheDocument();
  });

  it("value select shows '— pick a type first —' when no type is selected", async () => {
    render(<SortFilterBar {...unifiedProps()} />);
    await userEvent.click(screen.getByRole("button", { name: "Filter by label value" }));
    expect(screen.getByRole("option", { name: "— pick a type first —" })).toBeInTheDocument();
  });

  it("after picking a type, value select shows values for that type", async () => {
    const onLabelFilterChange = vi.fn();
    render(<SortFilterBar {...unifiedProps({ onLabelFilterChange })} />);
    // Pick "Tags" type
    await userEvent.click(screen.getByRole("button", { name: "Filter by label type" }));
    await userEvent.click(screen.getByRole("option", { name: "Tags" }));
    // Now open the value select
    await userEvent.click(screen.getByRole("button", { name: "Filter by label value" }));
    expect(screen.getByRole("option", { name: "All values" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "fiction (3)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "nonfiction (1)" })).toBeInTheDocument();
  });

  it("selecting a type calls onLabelFilterChange(null) to clear the active filter", async () => {
    const onLabelFilterChange = vi.fn();
    render(<SortFilterBar {...unifiedProps({ onLabelFilterChange, labelFilter: { facet: "tag", value: "fiction" } })} />);
    await userEvent.click(screen.getByRole("button", { name: "Filter by label type" }));
    await userEvent.click(screen.getByRole("option", { name: "Narrator" }));
    expect(onLabelFilterChange).toHaveBeenCalledWith(null);
  });

  it("selecting a value emits onLabelFilterChange({ facet, value })", async () => {
    const onLabelFilterChange = vi.fn();
    // Start with type already chosen via labelFilter
    render(
      <SortFilterBar
        {...unifiedProps({
          onLabelFilterChange,
          labelFilter: { facet: "tag", value: "" },
          termsByType: TERMS_BY_TYPE,
        })}
      />,
    );
    // The labelFilter has facet="tag" so value select shows tag values
    await userEvent.click(screen.getByRole("button", { name: "Filter by label value" }));
    await userEvent.click(screen.getByRole("option", { name: "fiction (3)" }));
    expect(onLabelFilterChange).toHaveBeenCalledWith({ facet: "tag", value: "fiction" });
  });

  it("selecting 'All labels' type calls onLabelFilterChange(null)", async () => {
    const onLabelFilterChange = vi.fn();
    render(
      <SortFilterBar
        {...unifiedProps({
          onLabelFilterChange,
          labelFilter: { facet: "tag", value: "fiction" },
        })}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Filter by label type" }));
    await userEvent.click(screen.getByRole("option", { name: "All labels" }));
    expect(onLabelFilterChange).toHaveBeenCalledWith(null);
  });

  it("sort still works in unified mode", async () => {
    const onSortChange = vi.fn();
    render(<SortFilterBar {...unifiedProps({ onSortChange })} />);
    await userEvent.click(screen.getByRole("button", { name: "Sort authors" }));
    await userEvent.click(screen.getByRole("option", { name: "Played %" }));
    expect(onSortChange).toHaveBeenCalledWith("played");
  });
});
