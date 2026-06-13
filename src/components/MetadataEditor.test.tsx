import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MetadataEditor } from "./MetadataEditor";
import type { MetaTag } from "../lib/api";

const applied: MetaTag[] = [{ termId: 1, facet: "narrator", value: "Jane Roe" }];

describe("MetadataEditor", () => {
  it("shows applied values and adds a new one", () => {
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    render(<MetadataEditor applied={applied} suggestions={["English"]} onAdd={onAdd} onRemove={onRemove} />);
    expect(screen.getByText("Jane Roe")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Add mood value"), { target: { value: "cozy" } });
    fireEvent.keyDown(screen.getByLabelText("Add mood value"), { key: "Enter" });
    expect(onAdd).toHaveBeenCalledWith("mood", "cozy");
  });

  it("removes an applied value", () => {
    const onRemove = vi.fn();
    render(<MetadataEditor applied={applied} suggestions={[]} onAdd={vi.fn()} onRemove={onRemove} />);
    fireEvent.click(screen.getByLabelText("Remove Jane Roe"));
    expect(onRemove).toHaveBeenCalledWith(1);
  });
});
