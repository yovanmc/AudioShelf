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

  // ---- M16 Task 11: auto-tag suggestion chips ----
  it("renders suggestion chips when suggestions prop is provided", () => {
    render(<TagEditor tags={[]} allTags={[]} onChange={() => {}} suggestions={["thriller", "mystery"]} />);
    expect(screen.getByLabelText("Add suggested tag thriller")).toBeInTheDocument();
    expect(screen.getByLabelText("Add suggested tag mystery")).toBeInTheDocument();
  });

  it("clicking a suggestion chip calls onChange with the tag added", async () => {
    const onChange = vi.fn();
    render(<TagEditor tags={["cozy"]} allTags={[]} onChange={onChange} suggestions={["thriller"]} />);
    await userEvent.click(screen.getByLabelText("Add suggested tag thriller"));
    expect(onChange).toHaveBeenCalledWith(["cozy", "thriller"]);
  });

  it("does not render suggestions area when suggestions prop is omitted", () => {
    const { container } = render(<TagEditor tags={[]} allTags={[]} onChange={() => {}} />);
    expect(container.querySelector(".tag-suggestions")).toBeNull();
  });

  it("does not add a suggestion chip that is already in the existing tags", async () => {
    const onChange = vi.fn();
    render(<TagEditor tags={["cozy"]} allTags={[]} onChange={onChange} suggestions={["cozy"]} />);
    // "cozy" is already present, clicking the chip should not call onChange.
    await userEvent.click(screen.getByLabelText("Add suggested tag cozy"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
