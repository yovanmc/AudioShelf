import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SortFilterBar } from "./SortFilterBar";
import type { AuthorSort, PlayedStatus } from "../lib/browse";

function baseProps(over: Partial<React.ComponentProps<typeof SortFilterBar>> = {}) {
  return {
    sort: "az" as AuthorSort,
    onSortChange: vi.fn(),
    filterTag: null as string | null,
    onFilterTagChange: vi.fn(),
    filterStatus: "all" as PlayedStatus,
    onFilterStatusChange: vi.fn(),
    allTags: [],
    ...over,
  };
}

describe("SortFilterBar", () => {
  it("renders all three selects", () => {
    render(<SortFilterBar {...baseProps()} />);
    expect(screen.getByRole("combobox", { name: "Sort authors" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Filter by tag" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Filter by status" })).toBeInTheDocument();
  });

  it("sort select has expected options", () => {
    render(<SortFilterBar {...baseProps()} />);
    const sort = screen.getByRole("combobox", { name: "Sort authors" });
    expect(sort).toHaveValue("az");
    expect(screen.getByRole("option", { name: "A–Z" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Length (longest)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Played %" })).toBeInTheDocument();
  });

  it("status select has expected options", () => {
    render(<SortFilterBar {...baseProps()} />);
    expect(screen.getByRole("option", { name: "All" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Has unplayed" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Fully played" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Not started" })).toBeInTheDocument();
  });

  it("tag select shows 'All tags' plus provided tags", () => {
    render(<SortFilterBar {...baseProps({ allTags: ["fiction", "nonfiction"] })} />);
    expect(screen.getByRole("option", { name: "All tags" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "fiction" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "nonfiction" })).toBeInTheDocument();
  });

  it("changing sort fires onSortChange with 'length'", async () => {
    const onSortChange = vi.fn();
    render(<SortFilterBar {...baseProps({ onSortChange })} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Sort authors" }), "length");
    expect(onSortChange).toHaveBeenCalledWith("length");
  });

  it("selecting a tag fires onFilterTagChange with that tag", async () => {
    const onFilterTagChange = vi.fn();
    render(<SortFilterBar {...baseProps({ onFilterTagChange, allTags: ["fantasy"] })} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Filter by tag" }), "fantasy");
    expect(onFilterTagChange).toHaveBeenCalledWith("fantasy");
  });

  it("selecting 'All tags' fires onFilterTagChange with null", async () => {
    const onFilterTagChange = vi.fn();
    render(
      <SortFilterBar {...baseProps({ onFilterTagChange, filterTag: "fantasy", allTags: ["fantasy"] })} />,
    );
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Filter by tag" }), "");
    expect(onFilterTagChange).toHaveBeenCalledWith(null);
  });

  it("changing status fires onFilterStatusChange with 'unplayed'", async () => {
    const onFilterStatusChange = vi.fn();
    render(<SortFilterBar {...baseProps({ onFilterStatusChange })} />);
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Filter by status" }),
      "unplayed",
    );
    expect(onFilterStatusChange).toHaveBeenCalledWith("unplayed");
  });
});
