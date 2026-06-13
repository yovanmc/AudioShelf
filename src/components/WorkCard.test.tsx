import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkCard } from "./WorkCard";

describe("WorkCard", () => {
  it("shows creator, reason, tags, progress, and actions", async () => {
    const action = vi.fn();
    const menuAction = vi.fn();
    render(
      <WorkCard
        workId={1}
        title="Cool Story"
        authorId={2}
        authorName="Jane Doe"
        reason="Shares cozy"
        tags={["cozy"]}
        progress={50}
        actionLabel="Open"
        onAction={action}
        menuItems={[{ label: "More from Jane", onSelect: menuAction }]}
      />,
    );
    expect(screen.getByText("Cool Story")).toBeInTheDocument();
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Shares cozy")).toBeInTheDocument();
    expect(screen.getByText("cozy")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(action).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "More from Jane" }));
    expect(menuAction).toHaveBeenCalled();
  });

  it("renders a visually-hidden 'Played' label and check icon when playStatus is done", () => {
    render(
      <WorkCard
        workId={1}
        title="Finished Work"
        authorId={2}
        authorName="Jane Doe"
        playStatus="done"
      />,
    );
    // The visually-hidden SR label should be present
    expect(screen.getByText(/Played/)).toBeInTheDocument();
    // The icon SVG is aria-hidden, so we check the wrapper span is rendered
    // by asserting the visually-hidden text is in the DOM
    expect(document.querySelector(".work-card__status-icon")).toBeInTheDocument();
  });

  it("renders 'In progress' label when playStatus is in-progress", () => {
    render(
      <WorkCard
        workId={1}
        title="Ongoing Work"
        authorId={2}
        authorName="Jane Doe"
        playStatus="in-progress"
      />,
    );
    expect(screen.getByText(/In progress/)).toBeInTheDocument();
    expect(document.querySelector(".work-card__status-icon")).toBeInTheDocument();
  });

  it("renders 'Not started' label when playStatus is unstarted", () => {
    render(
      <WorkCard
        workId={1}
        title="New Work"
        authorId={2}
        authorName="Jane Doe"
        playStatus="unstarted"
      />,
    );
    expect(screen.getByText(/Not started/)).toBeInTheDocument();
    expect(document.querySelector(".work-card__status-icon")).toBeInTheDocument();
  });

  it("renders no status icon when playStatus is omitted", () => {
    render(
      <WorkCard
        workId={1}
        title="No Status Work"
        authorId={2}
        authorName="Jane Doe"
      />,
    );
    expect(document.querySelector(".work-card__status-icon")).not.toBeInTheDocument();
  });

  it("renders playStatus alongside reason text", () => {
    render(
      <WorkCard
        workId={1}
        title="Tagged Work"
        authorId={2}
        authorName="Jane Doe"
        reason="Shares cozy"
        playStatus="in-progress"
      />,
    );
    expect(screen.getByText("Shares cozy")).toBeInTheDocument();
    expect(screen.getByText(/In progress/)).toBeInTheDocument();
    expect(document.querySelector(".work-card__status-icon")).toBeInTheDocument();
  });
});
