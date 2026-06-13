import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiscoveryView } from "./DiscoveryView";
import type { DiscoveryWork } from "../lib/api";

const forYou: DiscoveryWork[] = [
  { workId: 1, baseTitle: "Night Walk", authorId: 2, authorName: "Sam Smith", unplayedCount: 2, sharedTags: ["cozy"] },
];

const byTagWork: DiscoveryWork[] = [
  { workId: 5, baseTitle: "Area 51", authorId: 3, authorName: "Trap Author", unplayedCount: 1, sharedTags: ["cozy"] },
];

describe("DiscoveryView", () => {
  it("shows the For You suggestions", () => {
    render(<DiscoveryView forYou={forYou} allTags={["cozy", "calm"]} byTags={[]} picked={[]} onPickTags={() => {}} onOpenAuthor={() => {}} onBack={() => {}} onPlayNextOfWork={vi.fn()} />);
    expect(screen.getByText("Night Walk")).toBeInTheDocument();
    expect(screen.getByText(/Sam Smith/)).toBeInTheDocument();
  });

  it("requests by-tag discovery when tags are picked", async () => {
    const onPick = vi.fn();
    render(<DiscoveryView forYou={forYou} allTags={["cozy", "calm"]} byTags={[]} picked={[]} onPickTags={onPick} onOpenAuthor={() => {}} onBack={() => {}} onPlayNextOfWork={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "cozy", pressed: false }));
    expect(onPick).toHaveBeenCalledWith(["cozy"]);
  });

  it("reflects the controlled picked state and renders by-tag results", () => {
    render(<DiscoveryView forYou={forYou} allTags={["cozy", "calm"]} byTags={byTagWork} picked={["cozy"]} onPickTags={() => {}} onOpenAuthor={() => {}} onBack={() => {}} onPlayNextOfWork={vi.fn()} />);
    expect((screen.getByRole("button", { name: "cozy", pressed: true }) as HTMLButtonElement).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Area 51")).toBeInTheDocument();
  });

  it("opens an author from a suggestion", async () => {
    const onOpen = vi.fn();
    render(<DiscoveryView forYou={forYou} allTags={["cozy"]} byTags={[]} picked={[]} onPickTags={() => {}} onOpenAuthor={onOpen} onBack={() => {}} onPlayNextOfWork={vi.fn()} />);
    await userEvent.click(screen.getAllByRole("button", { name: "View creator" })[0]);
    expect(onOpen).toHaveBeenCalledWith(2);
  });

  it("triggers onPlayNextOfWork when Play is clicked on a For You card", async () => {
    const onPlayNext = vi.fn();
    render(<DiscoveryView forYou={forYou} allTags={["cozy"]} byTags={[]} picked={[]} onPickTags={() => {}} onOpenAuthor={() => {}} onBack={() => {}} onPlayNextOfWork={onPlayNext} />);
    await userEvent.click(screen.getByRole("button", { name: "▶ Play" }));
    expect(onPlayNext).toHaveBeenCalledWith(1, 2);
  });

  // ---- M16 Task 11: Discover reasons ----
  it("shows the reason field from DiscoveryWork when it is non-empty", () => {
    const withReason: DiscoveryWork[] = [
      { workId: 1, baseTitle: "Night Walk", authorId: 2, authorName: "Sam Smith", unplayedCount: 2, sharedTags: ["cozy"], reason: "Shares cozy" },
    ];
    render(<DiscoveryView forYou={withReason} allTags={["cozy"]} byTags={[]} picked={[]} onPickTags={() => {}} onOpenAuthor={() => {}} onBack={() => {}} onPlayNextOfWork={vi.fn()} />);
    expect(screen.getByText("Shares cozy")).toBeInTheDocument();
  });

  it("falls back to the computed reason when reason field is empty string", () => {
    const noReason: DiscoveryWork[] = [
      { workId: 1, baseTitle: "Night Walk", authorId: 2, authorName: "Sam Smith", unplayedCount: 2, sharedTags: ["cozy"], reason: "" },
    ];
    render(<DiscoveryView forYou={noReason} allTags={["cozy"]} byTags={[]} picked={[]} onPickTags={() => {}} onOpenAuthor={() => {}} onBack={() => {}} onPlayNextOfWork={vi.fn()} />);
    // Falls back to computed "Shares cozy" from sharedTags.
    expect(screen.getByText("Shares cozy")).toBeInTheDocument();
  });
});
