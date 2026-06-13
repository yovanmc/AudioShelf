import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MetadataManagerView } from "./MetadataManagerView";
import type { MetaTerm } from "../lib/api";

const terms: MetaTerm[] = [
  { id: 1, facet: "narrator", value: "Jane Roe", chapterCount: 3, authorCount: 0 },
  { id: 2, facet: "mood", value: "cozy", chapterCount: 1, authorCount: 0 },
];

describe("MetadataManagerView", () => {
  it("groups terms by facet and creates a new value", () => {
    const onCreate = vi.fn();
    render(
      <MetadataManagerView terms={terms} onCreate={onCreate} onRename={vi.fn()} onDelete={vi.fn()} onMerge={vi.fn()} />,
    );
    expect(screen.getByText("Jane Roe")).toBeInTheDocument();
    expect(screen.getByText("cozy")).toBeInTheDocument();
    // Headings for all three facets render even when empty (language has none).
    expect(screen.getByText(/Narrator/i)).toBeInTheDocument();
    expect(screen.getByText(/Language/i)).toBeInTheDocument();
    expect(screen.getByText(/Mood/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("New narrator value"), { target: { value: "John Doe" } });
    fireEvent.click(screen.getByText("Add narrator"));
    expect(onCreate).toHaveBeenCalledWith("narrator", "John Doe");
  });
});
