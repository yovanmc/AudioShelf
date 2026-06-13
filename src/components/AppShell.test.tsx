import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

function props(overrides = {}) {
  return {
    active: "home" as const,
    collapsed: false,
    onCollapsedChange: vi.fn(),
    onHome: vi.fn(),
    onLibrary: vi.fn(),
    onDiscovery: vi.fn(),
    onRename: vi.fn(),
    onMetadata: vi.fn(),
    onSettings: vi.fn(),
    onJournal: vi.fn(),
    children: <main>Page</main>,
    player: null,
    ...overrides,
  };
}

describe("AppShell", () => {
  it("shows destinations, active state, and Settings in the footer", () => {
    render(<AppShell {...props()} />);
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Library" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discover" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import tags" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Journal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });

  it("collapses and emits the new state", async () => {
    const onCollapsedChange = vi.fn();
    render(<AppShell {...props({ onCollapsedChange })} />);
    await userEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
  });
});
