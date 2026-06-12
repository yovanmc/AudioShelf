import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
      tags: [],
      chapters: [
        { id: 100, title: "Cool Story", chapterNo: 1, format: "mp3", durationSecs: 65, filePath: "x/Cool Story.mp3", played: false, tags: [] },
        { id: 101, title: "Cool Story 2 the sequel", chapterNo: 2, format: "mp3", durationSecs: 130, filePath: "x/Cool Story 2 the sequel.mp3", played: true, tags: [] },
      ],
    },
  ],
};

const noop = () => {};

describe("AuthorDetailView", () => {
  it("renders works, chapters, and a played marker", () => {
    render(<AuthorDetailView detail={detail} onTogglePlayed={noop} onPlayChapter={noop} onSetTags={noop} onSetGrouping={noop} onClearGrouping={noop} onSetWorkTags={noop} onSetChapterTags={noop} allTags={[]} onBack={noop} />);
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Cool Story")).toBeInTheDocument();
    const ch2 = screen.getByText("Cool Story 2 the sequel").closest("li")!;
    expect(ch2).toHaveAttribute("data-played", "true");
  });

  it("toggles played when the checkbox is clicked", async () => {
    const onToggle = vi.fn();
    render(<AuthorDetailView detail={detail} onTogglePlayed={onToggle} onPlayChapter={noop} onSetTags={noop} onSetGrouping={noop} onClearGrouping={noop} onSetWorkTags={noop} onSetChapterTags={noop} allTags={[]} onBack={noop} />);
    await userEvent.click(screen.getByLabelText("Mark 'Cool Story' played"));
    expect(onToggle).toHaveBeenCalledWith(100, true);
  });

  it("plays a chapter when its play button is clicked", async () => {
    const onPlay = vi.fn();
    render(<AuthorDetailView detail={detail} onTogglePlayed={noop} onPlayChapter={onPlay} onSetTags={noop} onSetGrouping={noop} onClearGrouping={noop} onSetWorkTags={noop} onSetChapterTags={noop} allTags={[]} onBack={noop} />);
    await userEvent.click(screen.getByRole("button", { name: "Play 'Cool Story'" }));
    expect(onPlay).toHaveBeenCalledWith(detail.works[0].chapters[0]);
  });

  it("renders the tag editor and reports tag changes", async () => {
    const onSetTags = vi.fn();
    const withTags = { ...detail, tags: ["cozy"] };
    render(<AuthorDetailView detail={withTags} onTogglePlayed={noop} onPlayChapter={noop} onSetTags={onSetTags} onSetGrouping={noop} onClearGrouping={noop} onSetWorkTags={noop} onSetChapterTags={noop} allTags={["cozy", "calm"]} onBack={noop} />);
    expect(screen.getByText("cozy")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Remove tag cozy"));
    expect(onSetTags).toHaveBeenCalledWith([]);
  });

  it("submits a grouping override with the typed work title and chapter number", async () => {
    const onSetGrouping = vi.fn();
    render(
      <AuthorDetailView
        detail={detail}
        onTogglePlayed={noop}
        onPlayChapter={noop}
        onSetTags={noop}
        onSetGrouping={onSetGrouping}
        onClearGrouping={noop}
        onSetWorkTags={noop}
        onSetChapterTags={noop}
        allTags={[]}
        onBack={noop}
      />,
    );
    const firstChapter = detail.works[0].chapters[0];
    const workInput = screen.getByLabelText(`Work title for '${firstChapter.title}'`);
    await userEvent.clear(workInput);
    await userEvent.type(workInput, "Merged Work");
    await userEvent.click(screen.getByLabelText(`Save grouping for '${firstChapter.title}'`));
    expect(onSetGrouping).toHaveBeenCalledWith(firstChapter.id, "Merged Work", firstChapter.chapterNo);
  });

  it("clears a grouping override via Reset", async () => {
    const onClearGrouping = vi.fn();
    render(
      <AuthorDetailView
        detail={detail}
        onTogglePlayed={noop}
        onPlayChapter={noop}
        onSetTags={noop}
        onSetGrouping={noop}
        onClearGrouping={onClearGrouping}
        onSetWorkTags={noop}
        onSetChapterTags={noop}
        allTags={[]}
        onBack={noop}
      />,
    );
    const firstChapter = detail.works[0].chapters[0];
    await userEvent.click(screen.getByLabelText(`Reset grouping for '${firstChapter.title}'`));
    expect(onClearGrouping).toHaveBeenCalledWith(firstChapter.id);
  });

  it("work tag editor shows work tags and calls onSetWorkTags on change", async () => {
    const onSetWorkTags = vi.fn();
    const detailWithWorkTag: AuthorDetail = {
      ...detail,
      works: [{
        ...detail.works[0],
        tags: ["mystery"],
        chapters: detail.works[0].chapters,
      }],
    };
    const { container } = render(
      <AuthorDetailView
        detail={detailWithWorkTag}
        onTogglePlayed={noop}
        onPlayChapter={noop}
        onSetTags={noop}
        onSetGrouping={noop}
        onClearGrouping={noop}
        onSetWorkTags={onSetWorkTags}
        onSetChapterTags={noop}
        allTags={["mystery", "epic"]}
        onBack={noop}
      />,
    );
    // "mystery" appears as a work tag chip.
    expect(screen.getByText("mystery")).toBeInTheDocument();
    // Remove the "mystery" tag from the work editor (scoped to .work-tags div).
    const workTagsDiv = container.querySelector(".work-tags")!;
    await userEvent.click(within(workTagsDiv as HTMLElement).getByLabelText("Remove tag mystery"));
    expect(onSetWorkTags).toHaveBeenCalledWith(10, []);
  });

  it("chapter tag toggle button is present; open-by-default when chapter has tags", () => {
    const detailWithChapterTag: AuthorDetail = {
      ...detail,
      works: [{
        ...detail.works[0],
        tags: [],
        chapters: [
          { ...detail.works[0].chapters[0], tags: ["intro"] },
          { ...detail.works[0].chapters[1], tags: [] },
        ],
      }],
    };
    render(
      <AuthorDetailView
        detail={detailWithChapterTag}
        onTogglePlayed={noop}
        onPlayChapter={noop}
        onSetTags={noop}
        onSetGrouping={noop}
        onClearGrouping={noop}
        onSetWorkTags={noop}
        onSetChapterTags={noop}
        allTags={["intro"]}
        onBack={noop}
      />,
    );
    // Toggle button for the tagged chapter.
    expect(screen.getByLabelText("Toggle tags for 'Cool Story'")).toBeInTheDocument();
    // Editor is open by default because the chapter has a tag — "intro" chip is visible.
    expect(screen.getByText("intro")).toBeInTheDocument();
  });

  it("clicking the chapter tag toggle hides the editor", async () => {
    const detailWithChapterTag: AuthorDetail = {
      ...detail,
      works: [{
        ...detail.works[0],
        tags: [],
        chapters: [
          { ...detail.works[0].chapters[0], tags: ["intro"] },
          { ...detail.works[0].chapters[1], tags: [] },
        ],
      }],
    };
    render(
      <AuthorDetailView
        detail={detailWithChapterTag}
        onTogglePlayed={noop}
        onPlayChapter={noop}
        onSetTags={noop}
        onSetGrouping={noop}
        onClearGrouping={noop}
        onSetWorkTags={noop}
        onSetChapterTags={noop}
        allTags={["intro"]}
        onBack={noop}
      />,
    );
    const toggleBtn = screen.getByLabelText("Toggle tags for 'Cool Story'");
    // Editor starts open (chapter has "intro" tag).
    expect(screen.getByText("intro")).toBeInTheDocument();
    // Click toggle to hide.
    await userEvent.click(toggleBtn);
    expect(screen.queryByText("intro")).not.toBeInTheDocument();
  });

  it("removing a chapter tag calls onSetChapterTags", async () => {
    const onSetChapterTags = vi.fn();
    const detailWithChapterTag: AuthorDetail = {
      ...detail,
      works: [{
        ...detail.works[0],
        tags: [],
        chapters: [
          { ...detail.works[0].chapters[0], tags: ["intro"] },
          { ...detail.works[0].chapters[1], tags: [] },
        ],
      }],
    };
    render(
      <AuthorDetailView
        detail={detailWithChapterTag}
        onTogglePlayed={noop}
        onPlayChapter={noop}
        onSetTags={noop}
        onSetGrouping={noop}
        onClearGrouping={noop}
        onSetWorkTags={noop}
        onSetChapterTags={onSetChapterTags}
        allTags={["intro"]}
        onBack={noop}
      />,
    );
    // The chapter editor is open (chapter has "intro" tag), remove it.
    await userEvent.click(screen.getByLabelText("Remove tag intro"));
    expect(onSetChapterTags).toHaveBeenCalledWith(100, []);
  });
});
