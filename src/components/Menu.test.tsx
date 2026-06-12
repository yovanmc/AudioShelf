import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Menu } from "./Menu";

describe("Menu", () => {
  it("opens, chooses an item, and closes", async () => {
    const action = vi.fn();
    render(<Menu label="More actions" items={[{ label: "Open creator", onSelect: action }]} />);
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: "Open creator" }));
    expect(action).toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on Escape and restores trigger focus", async () => {
    render(<Menu label="More actions" items={[{ label: "Open creator", onSelect: vi.fn() }]} />);
    const trigger = screen.getByRole("button", { name: "More actions" });
    await userEvent.click(trigger);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
