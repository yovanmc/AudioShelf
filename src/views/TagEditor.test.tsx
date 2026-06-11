import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TagEditor } from "./TagEditor";

describe("TagEditor", () => {
  it("shows existing tags", () => {
    render(<TagEditor tags={["cozy", "thriller"]} allTags={["cozy", "thriller", "calm"]} onChange={() => {}} />);
    expect(screen.getByText("cozy")).toBeInTheDocument();
    expect(screen.getByText("thriller")).toBeInTheDocument();
  });

  it("adds a tag via the input", async () => {
    const onChange = vi.fn();
    render(<TagEditor tags={["cozy"]} allTags={["cozy", "calm"]} onChange={onChange} />);
    const input = screen.getByPlaceholderText("Add tag");
    await userEvent.type(input, "calm{enter}");
    expect(onChange).toHaveBeenCalledWith(["cozy", "calm"]);
  });

  it("does not add a duplicate or blank tag", async () => {
    const onChange = vi.fn();
    render(<TagEditor tags={["cozy"]} allTags={["cozy"]} onChange={onChange} />);
    const input = screen.getByPlaceholderText("Add tag");
    await userEvent.type(input, "cozy{enter}");
    await userEvent.type(input, "   {enter}");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("removes a tag", async () => {
    const onChange = vi.fn();
    render(<TagEditor tags={["cozy", "calm"]} allTags={["cozy", "calm"]} onChange={onChange} />);
    await userEvent.click(screen.getByLabelText("Remove tag cozy"));
    expect(onChange).toHaveBeenCalledWith(["calm"]);
  });
});
