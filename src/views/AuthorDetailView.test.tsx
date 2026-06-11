import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthorDetailView } from "./AuthorDetailView";
import type { AuthorDetail } from "../lib/api";

const detail: AuthorDetail = {
  id: 1,
  name: "Jane Doe",
  tags: [],
  works: [
    {
      id: 10,
      baseTitle: "Cool Story",
      chapters: [
        { id: 100, title: "Cool Story", chapterNo: 1, format: "mp3", durationSecs: 65, filePath: "x/Cool Story.mp3", played: false },
        { id: 101, title: "Cool Story 2 the sequel", chapterNo: 2, format: "mp3", durationSecs: 130, filePath: "x/Cool Story 2 the sequel.mp3", played: true },
      ],
    },
  ],
};

describe("AuthorDetailView", () => {
  it("renders works, chapters, and a played marker", () => {
    render(<AuthorDetailView detail={detail} onTogglePlayed={() => {}} onPlayChapter={() => {}} onSetTags={() => {}} allTags={[]} onBack={() => {}} />);
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Cool Story")).toBeInTheDocument();
    const ch2 = screen.getByText("Cool Story 2 the sequel").closest("li")!;
    expect(ch2).toHaveAttribute("data-played", "true");
  });

  it("toggles played when the checkbox is clicked", async () => {
    const onToggle = vi.fn();
    render(<AuthorDetailView detail={detail} onTogglePlayed={onToggle} onPlayChapter={() => {}} onSetTags={() => {}} allTags={[]} onBack={() => {}} />);
    await userEvent.click(screen.getByLabelText("Mark 'Cool Story' played"));
    expect(onToggle).toHaveBeenCalledWith(100, true);
  });

  it("plays a chapter when its play button is clicked", async () => {
    const onPlay = vi.fn();
    render(<AuthorDetailView detail={detail} onTogglePlayed={() => {}} onPlayChapter={onPlay} onSetTags={() => {}} allTags={[]} onBack={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Play 'Cool Story'" }));
    expect(onPlay).toHaveBeenCalledWith(detail.works[0].chapters[0]);
  });

  it("renders the tag editor and reports tag changes", async () => {
    const onSetTags = vi.fn();
    const withTags = { ...detail, tags: ["cozy"] };
    render(<AuthorDetailView detail={withTags} onTogglePlayed={() => {}} onPlayChapter={() => {}} onSetTags={onSetTags} allTags={["cozy", "calm"]} onBack={() => {}} />);
    expect(screen.getByText("cozy")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Remove tag cozy"));
    expect(onSetTags).toHaveBeenCalledWith([]);
  });
});
