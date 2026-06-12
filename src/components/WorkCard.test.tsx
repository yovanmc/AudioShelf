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
});
