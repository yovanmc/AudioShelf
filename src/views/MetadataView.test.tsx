import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MetadataView } from "./MetadataView";
import type { MetadataProposal } from "../lib/api";

const proposals: MetadataProposal[] = [
  {
    chapterId: 1,
    workId: 10,
    field: "title",
    current: "Book One",
    proposed: "The Real Title",
    source: "embedded",
  },
  {
    chapterId: 1,
    workId: 10,
    field: "order",
    current: "1",
    proposed: "3",
    source: "embedded",
  },
  {
    chapterId: 2,
    workId: 20,
    field: "tag",
    current: "",
    proposed: "fantasy",
    source: "embedded",
  },
];

describe("MetadataView", () => {
  it("renders proposals and shows count in the apply button", () => {
    render(
      <MetadataView
        proposals={proposals}
        result={null}
        onApply={() => {}}
        onReload={() => {}}
      />
    );
    expect(screen.getByText("Work title")).toBeInTheDocument();
    expect(screen.getByText("The Real Title")).toBeInTheDocument();
    expect(screen.getByText("fantasy")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Apply selected \(3\)/i })).toBeInTheDocument();
  });

  it("calls onApply with all proposals when all are checked by default", async () => {
    const onApply = vi.fn();
    render(
      <MetadataView
        proposals={proposals}
        result={null}
        onApply={onApply}
        onReload={() => {}}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /Apply selected/i }));
    expect(onApply).toHaveBeenCalledWith(proposals);
  });

  it("unchecking a row excludes it from onApply", async () => {
    const onApply = vi.fn();
    render(
      <MetadataView
        proposals={proposals}
        result={null}
        onApply={onApply}
        onReload={() => {}}
      />
    );
    // Uncheck the first checkbox (Work title proposal).
    const checkboxes = screen.getAllByRole("checkbox");
    await userEvent.click(checkboxes[0]);
    // Now only 2 are checked.
    expect(screen.getByRole("button", { name: /Apply selected \(2\)/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Apply selected \(2\)/i }));
    // onApply should NOT include the first proposal.
    const called = onApply.mock.calls[0][0] as MetadataProposal[];
    expect(called.length).toBe(2);
    expect(called.find((p) => p.field === "title")).toBeUndefined();
  });

  it("apply button is disabled when no proposals are checked", async () => {
    render(
      <MetadataView
        proposals={proposals}
        result={null}
        onApply={() => {}}
        onReload={() => {}}
      />
    );
    // Uncheck all.
    const checkboxes = screen.getAllByRole("checkbox");
    for (const cb of checkboxes) {
      await userEvent.click(cb);
    }
    expect(screen.getByRole("button", { name: /Apply selected \(0\)/i })).toBeDisabled();
  });

  it("shows empty state when no proposals", () => {
    render(
      <MetadataView proposals={[]} result={null} onApply={() => {}} onReload={() => {}} />
    );
    expect(
      screen.getByText(/No differences found between embedded tags and your library/i)
    ).toBeInTheDocument();
  });

  it("shows result notice after apply", () => {
    const onReload = vi.fn();
    render(
      <MetadataView
        proposals={proposals}
        result={{ applied: 3, skipped: 0 }}
        onApply={() => {}}
        onReload={onReload}
      />
    );
    expect(screen.getByText(/Applied 3 changes/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Apply selected/i })).toBeNull();
  });

  it("calls onReload when Refresh preview is clicked after result", async () => {
    const onReload = vi.fn();
    render(
      <MetadataView
        proposals={proposals}
        result={{ applied: 2, skipped: 1 }}
        onApply={() => {}}
        onReload={onReload}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /Refresh preview/i }));
    expect(onReload).toHaveBeenCalled();
  });
});
