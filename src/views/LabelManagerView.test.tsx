import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LabelManagerView, type LabelManagerViewProps } from "./LabelManagerView";
import type { LabelType, MetaTerm, TagStat } from "../lib/api";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NARRATOR_TYPE: LabelType = { name: "narrator", display: "Narrator", builtin: true, sort: 0 };
const LANGUAGE_TYPE: LabelType = { name: "language", display: "Language", builtin: true, sort: 1 };
const MOOD_TYPE: LabelType = { name: "mood", display: "Mood", builtin: false, sort: 2 };
const TAG_TYPE: LabelType = { name: "tag", display: "Tag", builtin: true, sort: 3 };

const TERM_JANE: MetaTerm = { id: 1, facet: "narrator", value: "Jane Roe", chapterCount: 3, authorCount: 0 };
const TERM_COZY: MetaTerm = { id: 2, facet: "mood", value: "cozy", chapterCount: 1, authorCount: 0 };
const TERM_EN: MetaTerm = { id: 3, facet: "language", value: "English", chapterCount: 5, authorCount: 2 };

const TAG_COZY: TagStat = { tag: "cozy", workCount: 3, chapterCount: 1, authorCount: 2 };
const TAG_MYSTERY: TagStat = { tag: "mystery", workCount: 1, chapterCount: 0, authorCount: 1 };

function baseProps(over: Partial<LabelManagerViewProps> = {}): LabelManagerViewProps {
  return {
    labelTypes: [NARRATOR_TYPE, LANGUAGE_TYPE, MOOD_TYPE],
    onCreateType: vi.fn(),
    onRenameType: vi.fn(),
    onDeleteType: vi.fn(),
    onReorderTypes: vi.fn(),
    terms: [TERM_JANE, TERM_COZY, TERM_EN],
    onCreateTerm: vi.fn(),
    onRenameTerm: vi.fn(),
    onDeleteTerm: vi.fn(),
    onMergeTerms: vi.fn(),
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Types section tests
// ---------------------------------------------------------------------------

describe("LabelManagerView — Types section", () => {
  it("renders all label types with their display names", () => {
    render(<LabelManagerView {...baseProps()} />);
    // Names appear in both the types table and the labels section headings — use getAllByText
    expect(screen.getAllByText("Narrator").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Language").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Mood").length).toBeGreaterThanOrEqual(1);
  });

  it("shows a built-in badge for built-in types", () => {
    render(<LabelManagerView {...baseProps()} />);
    const badges = screen.getAllByText("built-in");
    // narrator + language are built-in; mood is not
    expect(badges.length).toBeGreaterThanOrEqual(2);
  });

  it("delete button is disabled for built-in types", () => {
    render(<LabelManagerView {...baseProps()} />);
    // Find delete buttons for narrator row
    const rows = screen.getAllByRole("row");
    const narratorRow = rows.find((r) => within(r).queryByText("Narrator"));
    expect(narratorRow).toBeTruthy();
    if (narratorRow) {
      const deleteBtn = within(narratorRow).getByRole("button", { name: /delete/i });
      expect(deleteBtn).toBeDisabled();
    }
  });

  it("delete button is enabled for non-built-in types", () => {
    render(<LabelManagerView {...baseProps()} />);
    const rows = screen.getAllByRole("row");
    const moodRow = rows.find((r) => within(r).queryByText("Mood"));
    expect(moodRow).toBeTruthy();
    if (moodRow) {
      const deleteBtn = within(moodRow).getByRole("button", { name: /delete/i });
      expect(deleteBtn).not.toBeDisabled();
    }
  });

  it("calls onDeleteType with type name when delete clicked for non-built-in", async () => {
    const onDeleteType = vi.fn();
    render(<LabelManagerView {...baseProps({ onDeleteType })} />);
    const rows = screen.getAllByRole("row");
    const moodRow = rows.find((r) => within(r).queryByText("Mood"))!;
    await userEvent.click(within(moodRow).getByRole("button", { name: /delete/i }));
    expect(onDeleteType).toHaveBeenCalledWith("mood");
  });

  it("calls onCreateType when add-type form is submitted", () => {
    const onCreateType = vi.fn();
    render(<LabelManagerView {...baseProps({ onCreateType })} />);
    fireEvent.change(screen.getByLabelText(/new type key/i), { target: { value: "genre" } });
    fireEvent.change(screen.getByLabelText(/new type display name/i), { target: { value: "Genre" } });
    fireEvent.click(screen.getByRole("button", { name: /add type/i }));
    expect(onCreateType).toHaveBeenCalledWith("genre", "Genre");
  });

  it("calls onReorderTypes when move-up is clicked", async () => {
    const onReorderTypes = vi.fn();
    render(<LabelManagerView {...baseProps({ onReorderTypes })} />);
    // Mood is at index 2, click its move-up button
    const rows = screen.getAllByRole("row");
    const moodRow = rows.find((r) => within(r).queryByText("Mood"))!;
    const moveUpBtn = within(moodRow).getByRole("button", { name: /move mood up/i });
    await userEvent.click(moveUpBtn);
    expect(onReorderTypes).toHaveBeenCalled();
    // The call should swap mood with language (index 1 ↔ 2)
    const [resultNames] = onReorderTypes.mock.calls[0];
    expect(resultNames).toEqual(["narrator", "mood", "language"]);
  });

  it("first type move-up button is disabled", () => {
    render(<LabelManagerView {...baseProps()} />);
    const rows = screen.getAllByRole("row");
    const narratorRow = rows.find((r) => within(r).queryByText("Narrator"))!;
    const moveUpBtn = within(narratorRow).getByRole("button", { name: /move narrator up/i });
    expect(moveUpBtn).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Labels (terms) section tests
// ---------------------------------------------------------------------------

describe("LabelManagerView — Labels section", () => {
  it("renders term values grouped under their type headings", () => {
    render(<LabelManagerView {...baseProps()} />);
    expect(screen.getByText("Jane Roe")).toBeInTheDocument();
    expect(screen.getByText("cozy")).toBeInTheDocument();
    expect(screen.getByText("English")).toBeInTheDocument();
  });

  it("shows File and Creator counts for terms", () => {
    render(<LabelManagerView {...baseProps()} />);
    // TERM_EN: chapterCount=5, authorCount=2 — look for 5 and 2 in the language section
    const langSection = screen.getByRole("region", { name: /language/i });
    expect(within(langSection).getByText("5")).toBeInTheDocument();
    expect(within(langSection).getByText("2")).toBeInTheDocument();
  });

  it("calls onCreateTerm when add-label form is submitted for a facet", () => {
    const onCreateTerm = vi.fn();
    render(<LabelManagerView {...baseProps({ onCreateTerm })} />);
    fireEvent.change(screen.getByLabelText("New narrator value"), { target: { value: "John Doe" } });
    fireEvent.click(screen.getByText("Add narrator"));
    expect(onCreateTerm).toHaveBeenCalledWith("narrator", "John Doe");
  });

  it("calls onRenameTerm when term rename is saved", async () => {
    const onRenameTerm = vi.fn();
    render(<LabelManagerView {...baseProps({ onRenameTerm })} />);
    // Find the Jane Roe row
    const rows = screen.getAllByRole("row");
    const janeRow = rows.find((r) => within(r).queryByText("Jane Roe"))!;
    await userEvent.click(within(janeRow).getByRole("button", { name: /rename/i }));
    const input = within(janeRow).getByRole("textbox", { name: /rename jane roe/i });
    await userEvent.clear(input);
    await userEvent.type(input, "Jane Smith");
    await userEvent.click(within(janeRow).getByRole("button", { name: /save/i }));
    expect(onRenameTerm).toHaveBeenCalledWith(1, "Jane Smith");
  });

  it("calls onDeleteTerm when term delete is clicked", async () => {
    const onDeleteTerm = vi.fn();
    render(<LabelManagerView {...baseProps({ onDeleteTerm })} />);
    const rows = screen.getAllByRole("row");
    const janeRow = rows.find((r) => within(r).queryByText("Jane Roe"))!;
    await userEvent.click(within(janeRow).getByRole("button", { name: /delete/i }));
    expect(onDeleteTerm).toHaveBeenCalledWith(1);
  });

  it("calls onMergeTerms when multi-select merge is confirmed for terms", async () => {
    // Add two narrator terms to enable merge
    const extraTerm: MetaTerm = { id: 4, facet: "narrator", value: "John Smith", chapterCount: 0, authorCount: 0 };
    const onMergeTerms = vi.fn();
    render(
      <LabelManagerView
        {...baseProps({ onMergeTerms, terms: [TERM_JANE, extraTerm, TERM_COZY, TERM_EN] })}
      />,
    );
    // Select both narrators
    await userEvent.click(screen.getByRole("checkbox", { name: /select jane roe/i }));
    await userEvent.click(screen.getByRole("checkbox", { name: /select john smith/i }));

    // Merge button should appear
    const mergeBtn = screen.getByRole("button", { name: /merge 2/i });
    await userEvent.click(mergeBtn);

    // Dialog opens; confirm with default target
    const dialog = screen.getByRole("dialog", { name: /merge labels/i });
    await userEvent.click(within(dialog).getByRole("button", { name: /^merge$/i }));

    expect(onMergeTerms).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tag section tests (optional — only rendered when tag type + tags provided)
// ---------------------------------------------------------------------------

describe("LabelManagerView — Tag section", () => {
  function tagProps(over: Partial<LabelManagerViewProps> = {}): LabelManagerViewProps {
    return baseProps({
      labelTypes: [TAG_TYPE, NARRATOR_TYPE],
      terms: [TERM_JANE],
      tags: [TAG_COZY, TAG_MYSTERY],
      onRenameTag: vi.fn(),
      onMergeTag: vi.fn(),
      onSetTagAlias: vi.fn(),
      onClearTagAlias: vi.fn(),
      ...over,
    });
  }

  it("renders tag values when tag type is present with tags prop", () => {
    render(<LabelManagerView {...tagProps()} />);
    expect(screen.getByText("cozy")).toBeInTheDocument();
    expect(screen.getByText("mystery")).toBeInTheDocument();
  });

  it("calls onRenameTag when tag rename is submitted", async () => {
    const onRenameTag = vi.fn();
    render(<LabelManagerView {...tagProps({ onRenameTag })} />);
    const rows = screen.getAllByRole("row");
    const cozyRow = rows.find((r) => within(r).queryByText("cozy"))!;
    await userEvent.click(within(cozyRow).getByRole("button", { name: /rename/i }));
    const input = within(cozyRow).getByRole("textbox", { name: /rename cozy to/i });
    await userEvent.clear(input);
    await userEvent.type(input, "mellow");
    await userEvent.click(within(cozyRow).getByRole("button", { name: /^ok$/i }));
    expect(onRenameTag).toHaveBeenCalledWith("cozy", "mellow");
  });

  it("calls onMergeTag when two tags are selected and merge dialog is confirmed", async () => {
    const onMergeTag = vi.fn();
    render(<LabelManagerView {...tagProps({ onMergeTag })} />);
    await userEvent.click(screen.getByRole("checkbox", { name: /select cozy/i }));
    await userEvent.click(screen.getByRole("checkbox", { name: /select mystery/i }));
    await userEvent.click(screen.getByRole("button", { name: /merge 2 tags/i }));
    const dialog = screen.getByRole("dialog", { name: /merge tags/i });
    const select = within(dialog).getByRole("combobox", { name: /merge target/i });
    await userEvent.selectOptions(select, "cozy");
    await userEvent.click(within(dialog).getByRole("button", { name: /^merge$/i }));
    expect(onMergeTag).toHaveBeenCalledWith(
      expect.arrayContaining(["cozy", "mystery"]),
      "cozy",
    );
  });

  it("calls onSetTagAlias when alias form is submitted", async () => {
    const onSetTagAlias = vi.fn();
    render(<LabelManagerView {...tagProps({ onSetTagAlias })} />);
    const rows = screen.getAllByRole("row");
    const cozyRow = rows.find((r) => within(r).queryByText("cozy"))!;
    await userEvent.click(within(cozyRow).getByRole("button", { name: /add alias/i }));
    const input = within(cozyRow).getByRole("textbox", { name: /set cozy as alias of/i });
    await userEvent.type(input, "mellow");
    await userEvent.click(within(cozyRow).getByRole("button", { name: /^ok$/i }));
    expect(onSetTagAlias).toHaveBeenCalledWith("cozy", "mellow");
  });

  it("does not render tag section when tags prop is absent", () => {
    render(
      <LabelManagerView
        {...baseProps({ labelTypes: [TAG_TYPE], terms: [] })}
      />,
    );
    // Tag section (the <section aria-label="Tag">) should not be in DOM
    // since tags prop is undefined
    expect(screen.queryByRole("region", { name: /^tag$/i })).not.toBeInTheDocument();
  });
});
