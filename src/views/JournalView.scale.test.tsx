/**
 * M34 scale test for JournalView — verifies the virtualized path engages when
 * filtered.length > VIRTUALIZE_THRESHOLD (40) and only a window of entry rows
 * is present in the DOM at a time.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JournalView } from "./JournalView";
import type { JournalEntry, JournalResults } from "../lib/api";
import { VIRTUALIZE_THRESHOLD } from "../components/VirtualList";

/** Build a JournalResults with `count` note entries across a single author+work. */
function makeJournal(count: number): JournalResults {
  const entries: JournalEntry[] = Array.from({ length: count }, (_, i) => ({
    kind: "note" as const,
    authorId: 1,
    authorName: "Scale Author",
    workId: 10,
    workTitle: "Scale Work",
    chapterId: i + 1,
    chapterTitle: `Chapter ${i + 1}`,
    positionSecs: i * 30,
    body: `Note body ${i + 1}`,
    createdAt: i,
  }));
  return { entries };
}

describe("JournalView scale (M34)", () => {
  it("renders all entry rows below threshold (non-virtualized path)", () => {
    const count = VIRTUALIZE_THRESHOLD; // exactly at threshold — NOT above, so original path
    render(
      <JournalView
        journal={makeJournal(count)}
        exportStatus={null}
        onSearch={vi.fn()}
        onExport={vi.fn()}
      />,
    );
    // All entries rendered in the DOM on the original path.
    const rows = screen.getAllByTestId("journal-entry");
    expect(rows).toHaveLength(count);
  });

  it("virtualizes above threshold: only a window of entry rows is in the DOM", () => {
    const total = VIRTUALIZE_THRESHOLD + 20; // 60 entries — well above threshold
    render(
      <JournalView
        journal={makeJournal(total)}
        exportStatus={null}
        onSearch={vi.fn()}
        onExport={vi.fn()}
      />,
    );
    // With VirtualList the DOM contains only the windowed subset + overscan,
    // not all `total` entry rows.
    const rows = screen.getAllByTestId("journal-entry");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(total);
  });
});
