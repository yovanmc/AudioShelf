import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Dialog, PageHeader, SectionHeading, TagGroup } from "./ui";

describe("SectionHeading", () => {
  it("renders title", () => {
    render(<SectionHeading title="My Section" />);
    expect(screen.getByRole("heading", { name: "My Section" })).toBeInTheDocument();
  });

  it("renders eyebrow when provided", () => {
    render(<SectionHeading eyebrow="Category" title="My Section" />);
    expect(screen.getByText("Category")).toBeInTheDocument();
  });

  it("omits eyebrow when not provided", () => {
    const { container } = render(<SectionHeading title="My Section" />);
    expect(container.querySelector(".eyebrow")).not.toBeInTheDocument();
  });
});

describe("TagGroup", () => {
  it("renders given tags", () => {
    render(<TagGroup tags={["cozy", "fantasy"]} />);
    expect(screen.getByText("cozy")).toBeInTheDocument();
    expect(screen.getByText("fantasy")).toBeInTheDocument();
  });

  it("respects max prop", () => {
    render(<TagGroup tags={["a", "b", "c", "d"]} max={2} />);
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
    expect(screen.queryByText("c")).not.toBeInTheDocument();
    expect(screen.queryByText("d")).not.toBeInTheDocument();
  });

  it("renders nothing when tags array is empty", () => {
    const { container } = render(<TagGroup tags={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("PageHeader", () => {
  it("renders eyebrow and title", () => {
    render(<PageHeader eyebrow="Your library" title="Home" />);
    expect(screen.getByText("Your library")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Home" })).toBeInTheDocument();
  });

  it("renders actions slot when provided", () => {
    render(<PageHeader eyebrow="Library" title="Browse" actions={<button>Filter</button>} />);
    expect(screen.getByRole("button", { name: "Filter" })).toBeInTheDocument();
  });
});

describe("Dialog", () => {
  it("renders children", () => {
    render(
      <Dialog label="Test dialog" onClose={vi.fn()}>
        <p>Dialog content</p>
      </Dialog>,
    );
    expect(screen.getByText("Dialog content")).toBeInTheDocument();
  });

  it("calls onClose when Escape is pressed", async () => {
    const onClose = vi.fn();
    render(
      <Dialog label="Settings" onClose={onClose}>
        <p>Content</p>
      </Dialog>,
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("close button is labeled 'Close <label>'", () => {
    render(
      <Dialog label="Edit chapter" onClose={vi.fn()}>
        <p>Content</p>
      </Dialog>,
    );
    expect(screen.getByRole("button", { name: "Close Edit chapter" })).toBeInTheDocument();
  });
});
