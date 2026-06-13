import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChapterJournalDialog } from "./ChapterJournalDialog";
import type { ChapterRow, ChapterJournal } from "../lib/api";

const chapter: ChapterRow = {
  id: 10,
  title: "Chapter One",
  chapterNo: 1,
  format: "mp3",
  durationSecs: 300,
  filePath: "x/ch1.mp3",
  played: false,
  tags: [],
  userSummary: "My summary",
  takeaway: "My takeaway",
  isFavorite: false,
};

const seededJournal: ChapterJournal = {
  notes: [
    { id: 1, chapterId: 10, positionSecs: 12, body: "Interesting point here", createdAt: 1000 },
    { id: 2, chapterId: 10, positionSecs: 45, body: "Second note", createdAt: 2000 },
  ],
  bookmarks: [
    { id: 1, chapterId: 10, positionSecs: 30, label: "key idea", createdAt: 1500 },
  ],
};

const emptyJournal: ChapterJournal = { notes: [], bookmarks: [] };

function makeProps(overrides: Partial<Parameters<typeof ChapterJournalDialog>[0]> = {}) {
  return {
    chapter,
    journal: seededJournal,
    onClose: vi.fn(),
    onSetSummary: vi.fn(),
    onSetTakeaway: vi.fn(),
    onSetFavorite: vi.fn(),
    onAddNote: vi.fn(),
    onDeleteNote: vi.fn(),
    onAddBookmark: vi.fn(),
    onDeleteBookmark: vi.fn(),
    ...overrides,
  };
}

describe("ChapterJournalDialog", () => {
  it("renders as a dialog with the chapter title", () => {
    render(<ChapterJournalDialog {...makeProps()} />);
    expect(screen.getByRole("dialog", { name: /Journal — Chapter One/ })).toBeInTheDocument();
  });

  it("renders seeded notes with their m:ss position and body", () => {
    render(<ChapterJournalDialog {...makeProps()} />);
    // note at 12s = "0:12"
    expect(screen.getByText("0:12")).toBeInTheDocument();
    expect(screen.getByText("Interesting point here")).toBeInTheDocument();
    // note at 45s = "0:45"
    expect(screen.getByText("0:45")).toBeInTheDocument();
    expect(screen.getByText("Second note")).toBeInTheDocument();
  });

  it("renders seeded bookmark with m:ss position and label", () => {
    render(<ChapterJournalDialog {...makeProps()} />);
    // bookmark at 30s = "0:30"
    expect(screen.getByText("0:30")).toBeInTheDocument();
    expect(screen.getByText("key idea")).toBeInTheDocument();
  });

  it("shows 'No notes yet' when journal has no notes", () => {
    render(<ChapterJournalDialog {...makeProps({ journal: emptyJournal })} />);
    expect(screen.getByText("No notes yet.")).toBeInTheDocument();
  });

  it("shows 'No bookmarks yet' when journal has no bookmarks", () => {
    render(<ChapterJournalDialog {...makeProps({ journal: emptyJournal })} />);
    expect(screen.getByText("No bookmarks yet.")).toBeInTheDocument();
  });

  it("summary textarea shows chapter.userSummary and Save fires onSetSummary with edited text", async () => {
    const onSetSummary = vi.fn();
    render(<ChapterJournalDialog {...makeProps({ onSetSummary })} />);
    const textarea = screen.getByLabelText("Chapter summary") as HTMLTextAreaElement;
    expect(textarea.value).toBe("My summary");
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "Updated summary");
    await userEvent.click(screen.getByRole("button", { name: "Save summary" }));
    expect(onSetSummary).toHaveBeenCalledWith(10, "Updated summary");
  });

  it("takeaway input shows chapter.takeaway and Save fires onSetTakeaway with edited text", async () => {
    const onSetTakeaway = vi.fn();
    render(<ChapterJournalDialog {...makeProps({ onSetTakeaway })} />);
    const input = screen.getByLabelText("Chapter takeaway") as HTMLInputElement;
    expect(input.value).toBe("My takeaway");
    await userEvent.clear(input);
    await userEvent.type(input, "Updated takeaway");
    await userEvent.click(screen.getByRole("button", { name: "Save takeaway" }));
    expect(onSetTakeaway).toHaveBeenCalledWith(10, "Updated takeaway");
  });

  it("favorite toggle reflects isFavorite=false (aria-pressed=false) and fires onSetFavorite(id, true) on click", async () => {
    const onSetFavorite = vi.fn();
    render(<ChapterJournalDialog {...makeProps({ onSetFavorite })} />);
    const btn = screen.getByRole("button", { name: "Mark as favorite" });
    expect(btn).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(btn);
    expect(onSetFavorite).toHaveBeenCalledWith(10, true);
  });

  it("favorite toggle reflects isFavorite=true (aria-pressed=true) and fires onSetFavorite(id, false) on click", async () => {
    const onSetFavorite = vi.fn();
    const favChapter: ChapterRow = { ...chapter, isFavorite: true };
    render(<ChapterJournalDialog {...makeProps({ chapter: favChapter, onSetFavorite })} />);
    const btn = screen.getByRole("button", { name: "Remove from favorites" });
    expect(btn).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(btn);
    expect(onSetFavorite).toHaveBeenCalledWith(10, false);
  });

  it("Add note fires onAddNote with chapterId, positionSecs, and body", async () => {
    const onAddNote = vi.fn();
    render(<ChapterJournalDialog {...makeProps({ onAddNote })} />);
    const posInput = screen.getByLabelText("Note position in seconds") as HTMLInputElement;
    const bodyInput = screen.getByLabelText("Note body") as HTMLInputElement;
    await userEvent.clear(posInput);
    await userEvent.type(posInput, "20");
    await userEvent.clear(bodyInput);
    await userEvent.type(bodyInput, "A new note");
    await userEvent.click(screen.getByRole("button", { name: "Add note" }));
    expect(onAddNote).toHaveBeenCalledWith(10, 20, "A new note");
  });

  it("Add note does not fire onAddNote when body is empty/whitespace", async () => {
    const onAddNote = vi.fn();
    render(<ChapterJournalDialog {...makeProps({ onAddNote })} />);
    await userEvent.click(screen.getByRole("button", { name: "Add note" }));
    expect(onAddNote).not.toHaveBeenCalled();
  });

  it("Add bookmark fires onAddBookmark with chapterId, positionSecs, and label", async () => {
    const onAddBookmark = vi.fn();
    render(<ChapterJournalDialog {...makeProps({ onAddBookmark })} />);
    const posInput = screen.getByLabelText("Bookmark position in seconds") as HTMLInputElement;
    const labelInput = screen.getByLabelText("Bookmark label") as HTMLInputElement;
    await userEvent.clear(posInput);
    await userEvent.type(posInput, "60");
    await userEvent.clear(labelInput);
    await userEvent.type(labelInput, "climax");
    await userEvent.click(screen.getByRole("button", { name: "Add bookmark" }));
    expect(onAddBookmark).toHaveBeenCalledWith(10, 60, "climax");
  });

  it("Delete note button fires onDeleteNote with the note id", async () => {
    const onDeleteNote = vi.fn();
    render(<ChapterJournalDialog {...makeProps({ onDeleteNote })} />);
    // First note is at 0:12
    await userEvent.click(screen.getByLabelText("Delete note at 0:12"));
    expect(onDeleteNote).toHaveBeenCalledWith(1);
  });

  it("Delete bookmark button fires onDeleteBookmark with the bookmark id", async () => {
    const onDeleteBookmark = vi.fn();
    render(<ChapterJournalDialog {...makeProps({ onDeleteBookmark })} />);
    await userEvent.click(screen.getByLabelText("Delete bookmark at 0:30"));
    expect(onDeleteBookmark).toHaveBeenCalledWith(1);
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<ChapterJournalDialog {...makeProps({ onClose })} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});

// ---- Work-level journal fields in AuthorDetailView ----
import { AuthorDetailView } from "./AuthorDetailView";
import type { AuthorDetail } from "../lib/api";

const workDetail: AuthorDetail = {
  id: 1,
  name: "Jane Doe",
  tags: [],
  works: [
    {
      id: 10,
      baseTitle: "Cool Story",
      tags: [],
      reEntryNote: "Chapter 3 was where I stopped",
      completionRating: "brilliant",
      chapterSort: "",
      chapters: [
        {
          id: 100, title: "Part One", chapterNo: 1, format: "mp3",
          durationSecs: 60, filePath: "x/1.mp3", played: false, tags: [],
          userSummary: "", takeaway: "", isFavorite: false,
        },
      ],
    },
  ],
};

const noop = () => {};

describe("AuthorDetailView — work-level journal fields", () => {
  it("renders re-entry note input with existing value and fires onSetWorkReEntryNote on save", async () => {
    const onSetWorkReEntryNote = vi.fn();
    render(
      <AuthorDetailView
        detail={workDetail}
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
        onSetWorkReEntryNote={onSetWorkReEntryNote}
        onSetWorkRating={noop}
      />,
    );
    const input = screen.getByLabelText("Where I left off note") as HTMLInputElement;
    expect(input.value).toBe("Chapter 3 was where I stopped");
    await userEvent.clear(input);
    await userEvent.type(input, "Actually chapter 5");
    await userEvent.click(screen.getByLabelText("Save re-entry note"));
    expect(onSetWorkReEntryNote).toHaveBeenCalledWith(10, "Actually chapter 5");
  });

  it("renders rating input with existing value and fires onSetWorkRating on save", async () => {
    const onSetWorkRating = vi.fn();
    render(
      <AuthorDetailView
        detail={workDetail}
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
        onSetWorkReEntryNote={noop}
        onSetWorkRating={onSetWorkRating}
      />,
    );
    const input = screen.getByLabelText("Completion rating") as HTMLInputElement;
    expect(input.value).toBe("brilliant");
    await userEvent.clear(input);
    await userEvent.type(input, "outstanding");
    await userEvent.click(screen.getByLabelText("Save rating"));
    expect(onSetWorkRating).toHaveBeenCalledWith(10, "outstanding");
  });

  it("does not render work-level journal fields when handlers are absent", () => {
    render(
      <AuthorDetailView
        detail={workDetail}
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
    expect(screen.queryByLabelText("Where I left off note")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Completion rating")).not.toBeInTheDocument();
  });
});
