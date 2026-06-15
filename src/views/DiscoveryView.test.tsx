import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiscoveryView, CAP_FACET_CHIPS } from "./DiscoveryView";
import type { LabelType, DiscoveryWork } from "../lib/api";

const forYou: DiscoveryWork[] = [
  { workId: 1, baseTitle: "Night Walk", authorId: 2, authorName: "Sam Smith", unplayedCount: 2, sharedTags: ["cozy"] },
];

const byMetadataWork: DiscoveryWork[] = [
  { workId: 5, baseTitle: "Area 51", authorId: 3, authorName: "Trap Author", unplayedCount: 1, sharedTags: ["cozy"] },
];

const labelTypes: LabelType[] = [
  { name: "narrator", display: "Narrator", builtin: true, sort: 0 },
  { name: "mood", display: "Mood", builtin: true, sort: 1 },
];

const termsByType: Record<string, { value: string; count: number }[]> = {
  narrator: [
    { value: "Jane Doe", count: 3 },
    { value: "John Smith", count: 1 },
  ],
  mood: [
    { value: "cozy", count: 2 },
  ],
};

const baseProps = {
  forYou,
  labelTypes,
  termsByType,
  picked: null as { facet: string; value: string } | null,
  onPickMetadata: () => {},
  byMetadata: [] as DiscoveryWork[],
  onOpenAuthor: () => {},
  onBack: () => {},
  onPlayNextOfWork: vi.fn(),
};

describe("DiscoveryView", () => {
  it("shows the For You suggestions", () => {
    render(<DiscoveryView {...baseProps} />);
    expect(screen.getByText("Night Walk")).toBeInTheDocument();
    expect(screen.getByText(/Sam Smith/)).toBeInTheDocument();
  });

  it("renders a row per label type that has terms", () => {
    render(<DiscoveryView {...baseProps} />);
    // Both type display names appear as row headings.
    expect(screen.getByText("Narrator")).toBeInTheDocument();
    expect(screen.getByText("Mood")).toBeInTheDocument();
  });

  it("renders chips with value and count for each term", () => {
    render(<DiscoveryView {...baseProps} />);
    // Chip text contains "Jane Doe · 3" (muted span may split but the textContent includes it).
    expect(screen.getByRole("button", { name: /Jane Doe/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /John Smith/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cozy/ })).toBeInTheDocument();
    // Count is in the button text.
    expect(screen.getByRole("button", { name: /Jane Doe/ }).textContent).toContain("3");
  });

  it("calls onPickMetadata with facet and value when a chip is clicked", async () => {
    const onPick = vi.fn();
    render(<DiscoveryView {...baseProps} onPickMetadata={onPick} />);
    await userEvent.click(screen.getByRole("button", { name: /Jane Doe/, pressed: false }));
    expect(onPick).toHaveBeenCalledWith("narrator", "Jane Doe");
  });

  it("calls onPickMetadata for a mood chip", async () => {
    const onPick = vi.fn();
    render(<DiscoveryView {...baseProps} onPickMetadata={onPick} />);
    await userEvent.click(screen.getByRole("button", { name: /cozy/, pressed: false }));
    expect(onPick).toHaveBeenCalledWith("mood", "cozy");
  });

  it("reflects controlled picked state — marks the active chip aria-pressed=true", () => {
    render(
      <DiscoveryView
        {...baseProps}
        picked={{ facet: "narrator", value: "Jane Doe" }}
        byMetadata={byMetadataWork}
      />,
    );
    const chip = screen.getByRole("button", { name: /Jane Doe/, pressed: true }) as HTMLButtonElement;
    expect(chip.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows byMetadata results when a pick is active", () => {
    render(
      <DiscoveryView
        {...baseProps}
        picked={{ facet: "narrator", value: "Jane Doe" }}
        byMetadata={byMetadataWork}
      />,
    );
    expect(screen.getByText("Area 51")).toBeInTheDocument();
  });

  it("hides byMetadata result list when nothing is picked", () => {
    render(<DiscoveryView {...baseProps} byMetadata={byMetadataWork} />);
    // "Area 51" should NOT appear because picked is null.
    expect(screen.queryByText("Area 51")).not.toBeInTheDocument();
  });

  it("skips types with no terms", () => {
    render(
      <DiscoveryView
        {...baseProps}
        termsByType={{ narrator: [{ value: "Jane Doe", count: 1 }], mood: [] }}
      />,
    );
    expect(screen.getByText("Narrator")).toBeInTheDocument();
    // Mood row should not be rendered since terms array is empty.
    expect(screen.queryByText("Mood")).not.toBeInTheDocument();
  });

  it("shows guiding empty state when library is un-indexed (no label types at all)", () => {
    render(<DiscoveryView {...baseProps} labelTypes={[]} termsByType={{}} />);
    expect(screen.getByText("Nothing to discover yet")).toBeInTheDocument();
    expect(screen.queryByText("No labels yet")).not.toBeInTheDocument();
  });

  it("shows No labels yet when types exist but none have terms", () => {
    const typesWithNoTerms: LabelType[] = [
      { name: "narrator", display: "Narrator", builtin: true, sort: 0 },
    ];
    render(<DiscoveryView {...baseProps} labelTypes={typesWithNoTerms} termsByType={{}} />);
    expect(screen.getByText("No labels yet")).toBeInTheDocument();
    expect(screen.queryByText("Nothing to discover yet")).not.toBeInTheDocument();
  });

  it("opens an author from a For You suggestion", async () => {
    const onOpen = vi.fn();
    render(<DiscoveryView {...baseProps} onOpenAuthor={onOpen} />);
    await userEvent.click(screen.getAllByRole("button", { name: "View creator" })[0]);
    expect(onOpen).toHaveBeenCalledWith(2);
  });

  it("triggers onPlayNextOfWork when Play is clicked on a For You card", async () => {
    const onPlayNext = vi.fn();
    render(<DiscoveryView {...baseProps} onPlayNextOfWork={onPlayNext} />);
    await userEvent.click(screen.getByRole("button", { name: "▶ Play" }));
    expect(onPlayNext).toHaveBeenCalledWith(1, 2);
  });

  // ---- M16 Task 11: Discover reasons ----
  it("shows the reason field from DiscoveryWork when it is non-empty", () => {
    const withReason: DiscoveryWork[] = [
      { workId: 1, baseTitle: "Night Walk", authorId: 2, authorName: "Sam Smith", unplayedCount: 2, sharedTags: ["cozy"], reason: "Shares cozy" },
    ];
    render(<DiscoveryView {...baseProps} forYou={withReason} />);
    expect(screen.getByText("Shares cozy")).toBeInTheDocument();
  });

  it("falls back to the computed reason when reason field is empty string", () => {
    const noReason: DiscoveryWork[] = [
      { workId: 1, baseTitle: "Night Walk", authorId: 2, authorName: "Sam Smith", unplayedCount: 2, sharedTags: ["cozy"], reason: "" },
    ];
    render(<DiscoveryView {...baseProps} forYou={noReason} />);
    // Falls back to computed "Shares cozy" from sharedTags.
    expect(screen.getByText("Shares cozy")).toBeInTheDocument();
  });

  // ---- M34 Task 6e: facet chip cap + toggle ----
  it("shows all chips when count is at or below CAP_FACET_CHIPS", () => {
    const TOTAL = CAP_FACET_CHIPS;
    const manyTerms = Array.from({ length: TOTAL }, (_, i) => ({ value: `Narrator${i}`, count: i + 1 }));
    render(
      <DiscoveryView
        {...baseProps}
        termsByType={{ narrator: manyTerms, mood: [] }}
      />,
    );
    // All chips should render; no "more" toggle
    expect(screen.getByRole("button", { name: /Narrator0/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Narrator23/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /more/i })).toBeNull();
  });

  it("caps chips at CAP_FACET_CHIPS and shows a '+N more' toggle when over the cap", () => {
    const TOTAL = CAP_FACET_CHIPS + 5;
    const manyTerms = Array.from({ length: TOTAL }, (_, i) => ({ value: `Mood${i}`, count: i + 1 }));
    render(
      <DiscoveryView
        {...baseProps}
        termsByType={{ narrator: [], mood: manyTerms }}
      />,
    );
    // First CAP_FACET_CHIPS chips visible
    expect(screen.getByRole("button", { name: /Mood0/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Mood23/ })).toBeInTheDocument();
    // Chip beyond cap NOT visible
    expect(screen.queryByRole("button", { name: /Mood24/ })).toBeNull();
    // The overflow toggle button exists (aria-label: "Show N more Mood chips")
    const overflow = TOTAL - CAP_FACET_CHIPS;
    expect(screen.getByRole("button", { name: new RegExp(`Show ${overflow} more`) })).toBeInTheDocument();
  });

  it("reveals all chips when the 'show more' toggle is clicked (show more/less)", async () => {
    const TOTAL = CAP_FACET_CHIPS + 3;
    const manyTerms = Array.from({ length: TOTAL }, (_, i) => ({ value: `Lang${i}`, count: 1 }));
    const langType: LabelType = { name: "language", display: "Language", builtin: true, sort: 2 };
    render(
      <DiscoveryView
        {...baseProps}
        labelTypes={[langType]}
        termsByType={{ language: manyTerms }}
      />,
    );
    const overflow = TOTAL - CAP_FACET_CHIPS;
    // Click the "show more" toggle (aria-label: "Show N more Language chips")
    await userEvent.click(screen.getByRole("button", { name: new RegExp(`Show ${overflow} more`) }));
    // All chips should now render
    expect(screen.getByRole("button", { name: /Lang0/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp(`Lang${TOTAL - 1}`) })).toBeInTheDocument();
    // Toggle now shows "Show less" (aria-label: "Show fewer Language chips")
    expect(screen.getByRole("button", { name: /show fewer/i })).toBeInTheDocument();
    // Click "Show less" to collapse
    await userEvent.click(screen.getByRole("button", { name: /show fewer/i }));
    // Overflow chip hidden again
    expect(screen.queryByRole("button", { name: new RegExp(`Lang${CAP_FACET_CHIPS}`) })).toBeNull();
  });
});
