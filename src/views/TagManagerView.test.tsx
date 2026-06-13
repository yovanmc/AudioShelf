import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TagManagerView, type TagManagerViewProps } from "./TagManagerView";
import type { TagStat } from "../lib/api";

const COZY: TagStat = { tag: "cozy", workCount: 3, chapterCount: 1, authorCount: 2 };
const MYSTERY: TagStat = { tag: "mystery", workCount: 1, chapterCount: 0, authorCount: 1 };
const CALM: TagStat = { tag: "calm", workCount: 0, chapterCount: 2, authorCount: 0 };

function baseProps(over: Partial<TagManagerViewProps> = {}): TagManagerViewProps {
  return {
    tags: [COZY, MYSTERY, CALM],
    onRename: vi.fn(),
    onMerge: vi.fn(),
    onSetAlias: vi.fn(),
    onClearAlias: vi.fn(),
    ...over,
  };
}

describe("TagManagerView", () => {
  it("renders tag list with usage counts", () => {
    render(<TagManagerView {...baseProps()} />);
    // All three tags should be visible.
    expect(screen.getByText("cozy")).toBeInTheDocument();
    expect(screen.getByText("mystery")).toBeInTheDocument();
    expect(screen.getByText("calm")).toBeInTheDocument();
    // cozy: authorCount=2, workCount=3, chapterCount=1.
    // The table cells show raw numbers; just assert the cells exist in row.
    const rows = screen.getAllByRole("row");
    const cozyRow = rows.find((r) => within(r).queryByText("cozy"));
    expect(cozyRow).toBeTruthy();
    if (cozyRow) {
      expect(within(cozyRow).getByText("2")).toBeInTheDocument(); // authorCount
      expect(within(cozyRow).getByText("3")).toBeInTheDocument(); // workCount
      expect(within(cozyRow).getByText("1")).toBeInTheDocument(); // chapterCount
    }
  });

  it("shows empty state when tag list is empty", () => {
    render(<TagManagerView {...baseProps({ tags: [] })} />);
    expect(screen.getByText(/no tags yet/i)).toBeInTheDocument();
  });

  it("calls onRename when inline rename is submitted", async () => {
    const onRename = vi.fn();
    render(<TagManagerView {...baseProps({ onRename })} />);

    // Open inline rename for "cozy".
    const rows = screen.getAllByRole("row");
    const cozyRow = rows.find((r) => within(r).queryByText("cozy"))!;
    await userEvent.click(within(cozyRow).getByRole("button", { name: /rename/i }));

    // Input appears pre-filled with "cozy".
    const input = within(cozyRow).getByRole("textbox", { name: /rename cozy to/i });
    await userEvent.clear(input);
    await userEvent.type(input, "mellow");
    await userEvent.click(within(cozyRow).getByRole("button", { name: /^ok$/i }));

    expect(onRename).toHaveBeenCalledWith("cozy", "mellow");
  });

  it("does not call onRename when new value is same as old", async () => {
    const onRename = vi.fn();
    render(<TagManagerView {...baseProps({ onRename })} />);

    const rows = screen.getAllByRole("row");
    const cozyRow = rows.find((r) => within(r).queryByText("cozy"))!;
    await userEvent.click(within(cozyRow).getByRole("button", { name: /rename/i }));

    // Leave value unchanged and submit.
    await userEvent.click(within(cozyRow).getByRole("button", { name: /^ok$/i }));
    expect(onRename).not.toHaveBeenCalled();
  });

  it("calls onMerge when two tags are selected and merge dialog is confirmed", async () => {
    const onMerge = vi.fn();
    render(<TagManagerView {...baseProps({ onMerge })} />);

    // Select "cozy" and "mystery".
    await userEvent.click(screen.getByRole("checkbox", { name: /select cozy/i }));
    await userEvent.click(screen.getByRole("checkbox", { name: /select mystery/i }));

    // Merge button should appear.
    await userEvent.click(screen.getByRole("button", { name: /merge 2 tags/i }));

    // Dialog opens; select "cozy" as target and confirm.
    const dialog = screen.getByRole("dialog", { name: /merge tags/i });
    const select = within(dialog).getByRole("combobox", { name: /merge target/i });
    await userEvent.selectOptions(select, "cozy");
    await userEvent.click(within(dialog).getByRole("button", { name: /^merge$/i }));

    expect(onMerge).toHaveBeenCalledWith(
      expect.arrayContaining(["cozy", "mystery"]),
      "cozy",
    );
  });

  it("calls onSetAlias when alias form is submitted", async () => {
    const onSetAlias = vi.fn();
    render(<TagManagerView {...baseProps({ onSetAlias })} />);

    const rows = screen.getAllByRole("row");
    const cozyRow = rows.find((r) => within(r).queryByText("cozy"))!;
    await userEvent.click(within(cozyRow).getByRole("button", { name: /add alias/i }));

    const input = within(cozyRow).getByRole("textbox", { name: /set cozy as alias of/i });
    await userEvent.type(input, "mellow");
    await userEvent.click(within(cozyRow).getByRole("button", { name: /^ok$/i }));

    expect(onSetAlias).toHaveBeenCalledWith("cozy", "mellow");
  });
});
