import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { LabelEditor } from "./LabelEditor";
import type { LabelType, MetaTag } from "../lib/api";

const labelTypes: LabelType[] = [
  { name: "tag", display: "Tag", builtin: true, sort: 0 },
  { name: "narrator", display: "Narrator", builtin: true, sort: 1 },
  { name: "mood", display: "Mood", builtin: true, sort: 2 },
];

const applied: MetaTag[] = [
  { termId: 1, facet: "tag", value: "cozy" },
  { termId: 2, facet: "narrator", value: "Jane Roe" },
];

describe("LabelEditor", () => {
  it("renders chips under the correct type row", () => {
    render(<LabelEditor applied={applied} labelTypes={labelTypes} onAdd={vi.fn()} onRemove={vi.fn()} />);
    // "cozy" is a tag-facet label
    expect(screen.getByText("cozy")).toBeInTheDocument();
    // "Jane Roe" is a narrator-facet label
    expect(screen.getByText("Jane Roe")).toBeInTheDocument();
  });

  it("renders a row for every label type", () => {
    render(<LabelEditor applied={[]} labelTypes={labelTypes} onAdd={vi.fn()} onRemove={vi.fn()} />);
    // Each type has an add-input with aria-label "Add <name> label"
    expect(screen.getByLabelText("Add tag label")).toBeInTheDocument();
    expect(screen.getByLabelText("Add narrator label")).toBeInTheDocument();
    expect(screen.getByLabelText("Add mood label")).toBeInTheDocument();
  });

  it("calls onAdd with (type, value) when the user types a value and presses Enter", () => {
    const onAdd = vi.fn();
    render(<LabelEditor applied={[]} labelTypes={labelTypes} onAdd={onAdd} onRemove={vi.fn()} />);
    const input = screen.getByLabelText("Add narrator label");
    fireEvent.change(input, { target: { value: "John Smith" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAdd).toHaveBeenCalledWith("narrator", "John Smith");
  });

  it("clears the input after a successful add", () => {
    render(<LabelEditor applied={[]} labelTypes={labelTypes} onAdd={vi.fn()} onRemove={vi.fn()} />);
    const input = screen.getByLabelText("Add mood label");
    fireEvent.change(input, { target: { value: "tense" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("does not call onAdd when the input is empty", () => {
    const onAdd = vi.fn();
    render(<LabelEditor applied={[]} labelTypes={labelTypes} onAdd={onAdd} onRemove={vi.fn()} />);
    const input = screen.getByLabelText("Add tag label");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("calls onRemove with the termId when a chip remove button is clicked", () => {
    const onRemove = vi.fn();
    render(<LabelEditor applied={applied} labelTypes={labelTypes} onAdd={vi.fn()} onRemove={onRemove} />);
    fireEvent.click(screen.getByLabelText("Remove Jane Roe"));
    expect(onRemove).toHaveBeenCalledWith(2);
  });

  it("renders the field-hint microcopy once", () => {
    const { container } = render(<LabelEditor applied={[]} labelTypes={labelTypes} onAdd={vi.fn()} onRemove={vi.fn()} />);
    expect(container.querySelectorAll(".field-hint")).toHaveLength(1);
  });

  it("renders suggestion datalist options when suggestions are provided", () => {
    const { container } = render(
      <LabelEditor applied={[]} labelTypes={labelTypes} suggestions={["English", "French"]} onAdd={vi.fn()} onRemove={vi.fn()} />,
    );
    const datalist = container.querySelector("datalist")!;
    const options = Array.from(datalist.querySelectorAll("option")).map((o) => o.value);
    expect(options).toContain("English");
    expect(options).toContain("French");
  });

  it("chips for each type appear under the correct row (spot-check facet segregation)", () => {
    const mixed: MetaTag[] = [
      { termId: 10, facet: "tag", value: "action" },
      { termId: 11, facet: "mood", value: "dark" },
    ];
    const { container } = render(<LabelEditor applied={mixed} labelTypes={labelTypes} onAdd={vi.fn()} onRemove={vi.fn()} />);
    const rows = container.querySelectorAll(".label-editor__row");
    // rows order: tag, narrator, mood
    const tagRow = rows[0];
    const moodRow = rows[2];
    expect(tagRow.textContent).toContain("action");
    expect(tagRow.textContent).not.toContain("dark");
    expect(moodRow.textContent).toContain("dark");
    expect(moodRow.textContent).not.toContain("action");
  });
});
