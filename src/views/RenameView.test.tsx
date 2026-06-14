import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RenameView } from "./RenameView";
import type { RenameItem } from "../lib/api";

const items: RenameItem[] = [
  { chapterId: 1, authorName: "Jane Doe", baseTitle: "Cool Story", fromName: "Cool Story 2 the sequel.mp3", toName: "Cool Story 2.mp3", status: "ok", conflictReason: null },
  { chapterId: 2, authorName: "Jane Doe", baseTitle: "Cool Story", fromName: "Cool Story.mp3", toName: "Cool Story.mp3", status: "noop", conflictReason: null },
  { chapterId: 3, authorName: "Jane Doe", baseTitle: "Tale", fromName: "Tale 2 part two.mp3", toName: "Tale 2.mp3", status: "conflict", conflictReason: "a file with the target name already exists" },
];

describe("RenameView", () => {
  it("shows the diff and only counts Ok items in the confirm button", () => {
    render(<RenameView items={items} result={null} onApply={() => {}} onUndo={() => {}} onBack={() => {}} onReload={() => {}} />);
    expect(screen.getByText("Cool Story 2 the sequel.mp3")).toBeInTheDocument();
    expect(screen.getByText("Cool Story 2.mp3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Rename 1 file/i })).toBeInTheDocument();
  });

  it("calls onApply with only Ok chapter ids", async () => {
    const onApply = vi.fn();
    render(<RenameView items={items} result={null} onApply={onApply} onUndo={() => {}} onBack={() => {}} onReload={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /Rename 1 file/i }));
    expect(onApply).toHaveBeenCalledWith([1]);
  });

  it("disables the confirm button when there are no Ok items", () => {
    const onlyNoop: RenameItem[] = [items[1]];
    render(<RenameView items={onlyNoop} result={null} onApply={() => {}} onUndo={() => {}} onBack={() => {}} onReload={() => {}} />);
    expect(screen.getByRole("button", { name: /Rename 0 files/i })).toBeDisabled();
  });

  it("after a result, shows the summary and an Undo button", async () => {
    const onUndo = vi.fn();
    render(<RenameView items={items} result={{ renamedCount: 1, failures: [], manifestPath: "m.jsonl" }} onApply={() => {}} onUndo={onUndo} onBack={() => {}} onReload={() => {}} />);
    expect(screen.getByText(/Renamed 1 file/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Undo/i }));
    expect(onUndo).toHaveBeenCalled();
  });

  it("renders badge labels for ok, noop, and conflict rows", () => {
    render(<RenameView items={items} result={null} onApply={() => {}} onUndo={() => {}} onBack={() => {}} onReload={() => {}} />);
    expect(screen.getByText("rename")).toBeInTheDocument();
    expect(screen.getByText("already clean")).toBeInTheDocument();
    expect(screen.getByText("conflict")).toBeInTheDocument();
  });

  it("renders the eyebrow as a short category label", () => {
    render(<RenameView items={items} result={null} onApply={() => {}} onUndo={() => {}} onBack={() => {}} onReload={() => {}} />);
    expect(screen.getByText("Library tools")).toBeInTheDocument();
  });
});
