import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiscoveryView } from "./DiscoveryView";
import type { DiscoveryWork } from "../lib/api";

const forYou: DiscoveryWork[] = [
  { workId: 1, baseTitle: "Night Walk", authorId: 2, authorName: "Sam Smith", unplayedCount: 2, sharedTags: ["cozy"] },
];

describe("DiscoveryView", () => {
  it("shows the For You suggestions", () => {
    render(<DiscoveryView forYou={forYou} allTags={["cozy", "calm"]} byTags={[]} onPickTags={() => {}} onOpenAuthor={() => {}} onBack={() => {}} />);
    expect(screen.getByText("Night Walk")).toBeInTheDocument();
    expect(screen.getByText(/Sam Smith/)).toBeInTheDocument();
  });

  it("requests by-tag discovery when tags are picked", async () => {
    const onPick = vi.fn();
    render(<DiscoveryView forYou={forYou} allTags={["cozy", "calm"]} byTags={[]} onPickTags={onPick} onOpenAuthor={() => {}} onBack={() => {}} />);
    await userEvent.click(screen.getByLabelText("Filter by tag cozy"));
    expect(onPick).toHaveBeenCalledWith(["cozy"]);
  });

  it("opens an author from a suggestion", async () => {
    const onOpen = vi.fn();
    render(<DiscoveryView forYou={forYou} allTags={["cozy"]} byTags={[]} onPickTags={() => {}} onOpenAuthor={onOpen} onBack={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Open Sam Smith" }));
    expect(onOpen).toHaveBeenCalledWith(2);
  });
});
