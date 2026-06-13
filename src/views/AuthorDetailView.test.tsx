import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthorDetailView } from "./AuthorDetailView";
import type { AuthorDetail, SeriesView } from "../lib/api";

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
    render(<AuthorDetailView detail={detail} onTogglePlayed={noop} onPlayChapter={noop} onSetTags={noop} onSetGrouping={noop} onClearGrouping={noop} onSetWorkTags={noop} onSetChapterTags={noop} allTags={[]} onBack={noop} workSort="az" onWorkSortChange={vi.fn()} />);
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Cool Story")).toBeInTheDocument();
    const ch2 = screen.getByText("Cool Story 2 the sequel").closest("li")!;
    expect(ch2).toHaveAttribute("data-played", "true");
  });

  it("toggles played when the checkbox is clicked", async () => {
    const onToggle = vi.fn();
    render(<AuthorDetailView detail={detail} onTogglePlayed={onToggle} onPlayChapter={noop} onSetTags={noop} onSetGrouping={noop} onClearGrouping={noop} onSetWorkTags={noop} onSetChapterTags={noop} allTags={[]} onBack={noop} workSort="az" onWorkSortChange={vi.fn()} />);
    await userEvent.click(screen.getByLabelText("Mark 'Cool Story' played"));
    expect(onToggle).toHaveBeenCalledWith(100, true);
  });

  it("plays a chapter when its play button is clicked", async () => {
    const onPlay = vi.fn();
    render(<AuthorDetailView detail={detail} onTogglePlayed={noop} onPlayChapter={onPlay} onSetTags={noop} onSetGrouping={noop} onClearGrouping={noop} onSetWorkTags={noop} onSetChapterTags={noop} allTags={[]} onBack={noop} workSort="az" onWorkSortChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Play 'Cool Story'" }));
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({
      chapter: detail.works[0].chapters[0],
      authorName: "Jane Doe",
      workTitle: "Cool Story",
    }));
  });

  it("renders the author tag editor and reports tag changes", async () => {
    const onSetTags = vi.fn();
    const withTags = { ...detail, tags: ["cozy"] };
    render(<AuthorDetailView detail={withTags} onTogglePlayed={noop} onPlayChapter={noop} onSetTags={onSetTags} onSetGrouping={noop} onClearGrouping={noop} onSetWorkTags={noop} onSetChapterTags={noop} allTags={["cozy", "calm"]} onBack={noop} workSort="az" onWorkSortChange={vi.fn()} />);
    expect(screen.getByText("cozy")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Remove tag cozy"));
    expect(onSetTags).toHaveBeenCalledWith([]);
  });

  it("submits a grouping override via the menu dialog", async () => {
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
        workSort="az"
        onWorkSortChange={vi.fn()}
      />,
    );
    const firstChapter = detail.works[0].chapters[0];
    // Open the chapter's more menu
    await userEvent.click(screen.getByRole("button", { name: `More options for '${firstChapter.title}'` }));
    // Click "Edit grouping" menu item
    await userEvent.click(screen.getByRole("menuitem", { name: "Edit grouping" }));
    // Dialog is now open — interact with the form
    const workInput = screen.getByLabelText(`Work title for '${firstChapter.title}'`);
    await userEvent.clear(workInput);
    await userEvent.type(workInput, "Merged Work");
    await userEvent.click(screen.getByLabelText(`Save grouping for '${firstChapter.title}'`));
    expect(onSetGrouping).toHaveBeenCalledWith(firstChapter.id, "Merged Work", firstChapter.chapterNo);
  });

  it("clears a grouping override via Reset in the dialog", async () => {
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
        workSort="az"
        onWorkSortChange={vi.fn()}
      />,
    );
    const firstChapter = detail.works[0].chapters[0];
    // Open the chapter's more menu
    await userEvent.click(screen.getByRole("button", { name: `More options for '${firstChapter.title}'` }));
    // Click "Edit grouping" menu item
    await userEvent.click(screen.getByRole("menuitem", { name: "Edit grouping" }));
    // Reset in the dialog
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
        workSort="az"
        onWorkSortChange={vi.fn()}
      />,
    );
    // "mystery" appears as a work tag chip.
    expect(screen.getByText("mystery")).toBeInTheDocument();
    // Remove the "mystery" tag from the work editor (scoped to .work-tags div).
    const workTagsDiv = container.querySelector(".work-tags")!;
    await userEvent.click(within(workTagsDiv as HTMLElement).getByLabelText("Remove tag mystery"));
    expect(onSetWorkTags).toHaveBeenCalledWith(10, []);
  });

  it("chapter with tags shows a read-only TagGroup chip in the browse row", () => {
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
        workSort="az"
        onWorkSortChange={vi.fn()}
      />,
    );
    // The "intro" chip is visible in the browse row (read-only TagGroup).
    expect(screen.getByText("intro")).toBeInTheDocument();
    // There is no toggle button — the old ChapterTags component is gone from the row.
    expect(screen.queryByLabelText("Toggle tags for 'Cool Story'")).not.toBeInTheDocument();
  });

  it("opens the Edit tags dialog and calls onSetChapterTags on remove", async () => {
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
        workSort="az"
        onWorkSortChange={vi.fn()}
      />,
    );
    // Open the chapter's more menu for the first chapter ("Cool Story")
    await userEvent.click(screen.getByRole("button", { name: "More options for 'Cool Story'" }));
    // Click "Edit tags" menu item
    await userEvent.click(screen.getByRole("menuitem", { name: "Edit tags" }));
    // Dialog is open — remove "intro" tag
    await userEvent.click(screen.getByLabelText("Remove tag intro"));
    expect(onSetChapterTags).toHaveBeenCalledWith(100, []);
  });

  it("Collapse all hides chapter items and button changes to Expand all; Expand all restores them", async () => {
    render(
      <AuthorDetailView
        detail={detail}
        onTogglePlayed={noop}
        onPlayChapter={noop}
        onSetTags={noop}
        onSetGrouping={noop}
        onClearGrouping={noop}
        onSetWorkTags={noop}
        onSetChapterTags={noop}
        allTags={[]}
        onBack={noop}
        workSort="az"
        onWorkSortChange={vi.fn()}
      />,
    );
    // Initially chapters are visible.
    expect(screen.getByText("Cool Story 2 the sequel")).toBeInTheDocument();
    // Click "Collapse all".
    await userEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    // Chapter items are now hidden.
    expect(screen.queryByText("Cool Story 2 the sequel")).not.toBeInTheDocument();
    // Button now reads "Expand all".
    expect(screen.getByRole("button", { name: "Expand all" })).toBeInTheDocument();
    // Click "Expand all" to restore.
    await userEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(screen.getByText("Cool Story 2 the sequel")).toBeInTheDocument();
  });

  it("per-work collapse toggle hides only that work's chapters", async () => {
    const twoWorkDetail: AuthorDetail = {
      id: 1,
      name: "Jane Doe",
      tags: [],
      works: [
        {
          id: 10,
          baseTitle: "Cool Story",
          tags: [],
          chapters: [
            { id: 100, title: "Cool Chapter A", chapterNo: 1, format: "mp3", durationSecs: 60, filePath: "x/a.mp3", played: false, tags: [] },
          ],
        },
        {
          id: 20,
          baseTitle: "Other Story",
          tags: [],
          chapters: [
            { id: 200, title: "Other Chapter B", chapterNo: 1, format: "mp3", durationSecs: 60, filePath: "x/b.mp3", played: false, tags: [] },
          ],
        },
      ],
    };
    render(
      <AuthorDetailView
        detail={twoWorkDetail}
        onTogglePlayed={noop}
        onPlayChapter={noop}
        onSetTags={noop}
        onSetGrouping={noop}
        onClearGrouping={noop}
        onSetWorkTags={noop}
        onSetChapterTags={noop}
        allTags={[]}
        onBack={noop}
        workSort="az"
        onWorkSortChange={vi.fn()}
      />,
    );
    // Both chapters visible initially.
    expect(screen.getByText("Cool Chapter A")).toBeInTheDocument();
    expect(screen.getByText("Other Chapter B")).toBeInTheDocument();
    // Collapse only "Cool Story".
    await userEvent.click(screen.getByLabelText("Collapse 'Cool Story'"));
    // Cool Story chapters hidden, Other Story chapters still visible.
    expect(screen.queryByText("Cool Chapter A")).not.toBeInTheDocument();
    expect(screen.getByText("Other Chapter B")).toBeInTheDocument();
  });

  it("changing Sort works to 'Length (longest)' reorders work sections", async () => {
    const onWorkSortChange = vi.fn();
    // Two works: "Bravo" has 300s total, "Alpha" has 60s total.
    // A–Z order: Alpha first. Length order: Bravo first.
    const twoWorkDetail: AuthorDetail = {
      id: 1,
      name: "Jane Doe",
      tags: [],
      works: [
        {
          id: 10,
          baseTitle: "Alpha",
          tags: [],
          chapters: [
            { id: 100, title: "Alpha Ch1", chapterNo: 1, format: "mp3", durationSecs: 60, filePath: "x/a.mp3", played: false, tags: [] },
          ],
        },
        {
          id: 20,
          baseTitle: "Bravo",
          tags: [],
          chapters: [
            { id: 200, title: "Bravo Ch1", chapterNo: 1, format: "mp3", durationSecs: 300, filePath: "x/b.mp3", played: false, tags: [] },
          ],
        },
      ],
    };
    const { rerender, container } = render(
      <AuthorDetailView
        detail={twoWorkDetail}
        onTogglePlayed={noop}
        onPlayChapter={noop}
        onSetTags={noop}
        onSetGrouping={noop}
        onClearGrouping={noop}
        onSetWorkTags={noop}
        onSetChapterTags={noop}
        allTags={[]}
        onBack={noop}
        workSort="az"
        onWorkSortChange={onWorkSortChange}
      />,
    );

    // A–Z: Alpha before Bravo — read work-title spans (text is "Alpha (1)", strip the count).
    const titlesBefore = Array.from(container.querySelectorAll(".work-title")).map((el) =>
      (el.textContent ?? "").replace(/\s*\(\d+\)\s*$/, "").trim(),
    );
    expect(titlesBefore[0]).toBe("Alpha");
    expect(titlesBefore[1]).toBe("Bravo");

    // Select "Length (longest)" — fires onWorkSortChange.
    await userEvent.selectOptions(screen.getByLabelText("Sort works"), "length");
    expect(onWorkSortChange).toHaveBeenCalledWith("length");

    // Rerender with new sort to simulate parent updating the prop.
    rerender(
      <AuthorDetailView
        detail={twoWorkDetail}
        onTogglePlayed={noop}
        onPlayChapter={noop}
        onSetTags={noop}
        onSetGrouping={noop}
        onClearGrouping={noop}
        onSetWorkTags={noop}
        onSetChapterTags={noop}
        allTags={[]}
        onBack={noop}
        workSort="length"
        onWorkSortChange={onWorkSortChange}
      />,
    );

    // Length: Bravo (300s) before Alpha (60s).
    const titlesAfter = Array.from(container.querySelectorAll(".work-title")).map((el) =>
      (el.textContent ?? "").replace(/\s*\(\d+\)\s*$/, "").trim(),
    );
    expect(titlesAfter[0]).toBe("Bravo");
    expect(titlesAfter[1]).toBe("Alpha");
  });

  it("toolbar shows the Works count label", () => {
    render(
      <AuthorDetailView
        detail={detail}
        onTogglePlayed={noop}
        onPlayChapter={noop}
        onSetTags={noop}
        onSetGrouping={noop}
        onClearGrouping={noop}
        onSetWorkTags={noop}
        onSetChapterTags={noop}
        allTags={[]}
        onBack={noop}
        workSort="az"
        onWorkSortChange={vi.fn()}
      />,
    );
    expect(screen.getByText(`Works (${detail.works.length})`)).toBeInTheDocument();
  });

  it("shows hours-formatted total in the author header for a multi-hour author", () => {
    const multiHourDetail: AuthorDetail = {
      id: 2,
      name: "Long Author",
      tags: [],
      works: [
        {
          id: 30,
          baseTitle: "Epic Series",
          tags: [],
          chapters: [
            // 2h 5m = 7500s
            { id: 300, title: "Part 1", chapterNo: 1, format: "mp3", durationSecs: 3600, filePath: "x/1.mp3", played: false, tags: [] },
            { id: 301, title: "Part 2", chapterNo: 2, format: "mp3", durationSecs: 3900, filePath: "x/2.mp3", played: false, tags: [] },
          ],
        },
      ],
    };
    render(<AuthorDetailView detail={multiHourDetail} onTogglePlayed={noop} onPlayChapter={noop} onSetTags={noop} onSetGrouping={noop} onClearGrouping={noop} onSetWorkTags={noop} onSetChapterTags={noop} allTags={[]} onBack={noop} workSort="az" onWorkSortChange={vi.fn()} />);
    // formatLong(7500) = "2h 5m" — header should contain "h "
    const header = screen.getByText(/works.*chapters.*h /);
    expect(header).toBeInTheDocument();
    expect(header.textContent).toContain("2h 5m");
  });

  it("shows per-work hours label in the work meta line", () => {
    const multiHourDetail: AuthorDetail = {
      id: 2,
      name: "Long Author",
      tags: [],
      works: [
        {
          id: 30,
          baseTitle: "Epic Series",
          tags: [],
          chapters: [
            { id: 300, title: "Part 1", chapterNo: 1, format: "mp3", durationSecs: 3600, filePath: "x/1.mp3", played: false, tags: [] },
            { id: 301, title: "Part 2", chapterNo: 2, format: "mp3", durationSecs: 3900, filePath: "x/2.mp3", played: false, tags: [] },
          ],
        },
      ],
    };
    render(<AuthorDetailView detail={multiHourDetail} onTogglePlayed={noop} onPlayChapter={noop} onSetTags={noop} onSetGrouping={noop} onClearGrouping={noop} onSetWorkTags={noop} onSetChapterTags={noop} allTags={[]} onBack={noop} workSort="az" onWorkSortChange={vi.fn()} />);
    // Per-work meta line: "2 chapters · 2 unplayed · 2h 5m"
    const workMeta = screen.getByText(/chapters.*unplayed.*2h 5m/);
    expect(workMeta).toBeInTheDocument();
  });

  it("closing the Edit grouping dialog via Escape dismisses it", async () => {
    render(
      <AuthorDetailView
        detail={detail}
        onTogglePlayed={noop}
        onPlayChapter={noop}
        onSetTags={noop}
        onSetGrouping={noop}
        onClearGrouping={noop}
        onSetWorkTags={noop}
        onSetChapterTags={noop}
        allTags={[]}
        onBack={noop}
        workSort="az"
        onWorkSortChange={vi.fn()}
      />,
    );
    const firstChapter = detail.works[0].chapters[0];
    await userEvent.click(screen.getByRole("button", { name: `More options for '${firstChapter.title}'` }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Edit grouping" }));
    // Dialog is open
    expect(screen.getByRole("dialog", { name: "Edit grouping" })).toBeInTheDocument();
    // Escape closes it
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Edit grouping" })).not.toBeInTheDocument();
  });

  // ---- series spine tests ----

  const seriesData: SeriesView[] = [
    {
      id: 1,
      title: "Cool Story",
      members: [
        { workId: 10, baseTitle: "Cool Story", position: 1, playedChapters: 2, totalChapters: 2 },
        { workId: 20, baseTitle: "Cool Story 2", position: 2, playedChapters: 0, totalChapters: 1 },
        { workId: 30, baseTitle: "Cool Story 3", position: 3, playedChapters: 0, totalChapters: 1 },
      ],
    },
  ];

  it("renders series section with ordered members and progress when series prop is provided", () => {
    render(
      <AuthorDetailView
        detail={detail}
        onTogglePlayed={noop}
        onPlayChapter={noop}
        onSetTags={noop}
        onSetGrouping={noop}
        onClearGrouping={noop}
        onSetWorkTags={noop}
        onSetChapterTags={noop}
        allTags={[]}
        onBack={noop}
        workSort="az"
        onWorkSortChange={vi.fn()}
        series={seriesData}
        onPlayNextOfWork={noop}
      />,
    );
    // Section heading is visible.
    expect(screen.getByText("Reading Order / Series")).toBeInTheDocument();
    // Series title is visible.
    expect(screen.getByText("Cool Story", { selector: ".series-title" })).toBeInTheDocument();
    // All three members appear with their position labels.
    expect(screen.getByText("1.")).toBeInTheDocument();
    expect(screen.getByText("2.")).toBeInTheDocument();
    expect(screen.getByText("3.")).toBeInTheDocument();
    // Member titles are visible (Cool Story 2 and Cool Story 3; Cool Story appears as both work and series title).
    expect(screen.getByText("Cool Story 2")).toBeInTheDocument();
    expect(screen.getByText("Cool Story 3")).toBeInTheDocument();
    // Progress fractions are visible.
    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(screen.getAllByText("0/1")).toHaveLength(2);
  });

  it("shows 'Continue the series' button for the first unfinished member and calls onPlayNextOfWork", async () => {
    const onPlayNextOfWork = vi.fn();
    render(
      <AuthorDetailView
        detail={detail}
        onTogglePlayed={noop}
        onPlayChapter={noop}
        onSetTags={noop}
        onSetGrouping={noop}
        onClearGrouping={noop}
        onSetWorkTags={noop}
        onSetChapterTags={noop}
        allTags={[]}
        onBack={noop}
        workSort="az"
        onWorkSortChange={vi.fn()}
        series={seriesData}
        onPlayNextOfWork={onPlayNextOfWork}
      />,
    );
    const btn = screen.getByRole("button", { name: "Continue the series Cool Story" });
    expect(btn).toBeInTheDocument();
    await userEvent.click(btn);
    // First unfinished member is workId=20 (playedChapters=0 < totalChapters=1).
    // authorId comes from detail.id = 1.
    expect(onPlayNextOfWork).toHaveBeenCalledWith(20, 1);
  });

  it("does not render series section when series prop is omitted (existing tests unbroken)", () => {
    render(
      <AuthorDetailView
        detail={detail}
        onTogglePlayed={noop}
        onPlayChapter={noop}
        onSetTags={noop}
        onSetGrouping={noop}
        onClearGrouping={noop}
        onSetWorkTags={noop}
        onSetChapterTags={noop}
        allTags={[]}
        onBack={noop}
        workSort="az"
        onWorkSortChange={vi.fn()}
      />,
    );
    expect(screen.queryByText("Reading Order / Series")).not.toBeInTheDocument();
  });

  it("does not render series section when series prop is empty array", () => {
    render(
      <AuthorDetailView
        detail={detail}
        onTogglePlayed={noop}
        onPlayChapter={noop}
        onSetTags={noop}
        onSetGrouping={noop}
        onClearGrouping={noop}
        onSetWorkTags={noop}
        onSetChapterTags={noop}
        allTags={[]}
        onBack={noop}
        workSort="az"
        onWorkSortChange={vi.fn()}
        series={[]}
      />,
    );
    expect(screen.queryByText("Reading Order / Series")).not.toBeInTheDocument();
  });
});
