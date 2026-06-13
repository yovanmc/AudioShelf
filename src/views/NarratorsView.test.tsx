import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { NarratorsView } from "./NarratorsView";
import type { MetaTerm, DiscoveryWork } from "../lib/api";

const narrators: MetaTerm[] = [
  { id: 1, facet: "narrator", value: "Jane Roe", chapterCount: 3, authorCount: 0 },
];
const works: DiscoveryWork[] = [
  { workId: 7, baseTitle: "Cool Story", authorId: 2, authorName: "Jane Doe", unplayedCount: 2, sharedTags: ["Jane Roe"], reason: "Narrator: Jane Roe" },
];

describe("NarratorsView", () => {
  it("lists narrators and resolves works on click", () => {
    const onSelect = vi.fn();
    render(<NarratorsView narrators={narrators} selected={null} works={[]} onSelect={onSelect} onOpenAuthor={vi.fn()} onPlayNextOfWork={vi.fn()} />);
    fireEvent.click(screen.getByText("Jane Roe"));
    expect(onSelect).toHaveBeenCalledWith("Jane Roe");
  });

  it("renders resolved works for the selected narrator", () => {
    render(<NarratorsView narrators={narrators} selected="Jane Roe" works={works} onSelect={vi.fn()} onOpenAuthor={vi.fn()} onPlayNextOfWork={vi.fn()} />);
    expect(screen.getByText("Cool Story")).toBeInTheDocument();
  });
});
