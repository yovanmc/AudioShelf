import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import { DEFAULT_A11Y } from "../lib/a11y";

function props(overrides = {}) {
  return {
    active: "home" as const,
    collapsed: false,
    onCollapsedChange: vi.fn(),
    onHome: vi.fn(),
    onLibrary: vi.fn(),
    onDiscovery: vi.fn(),
    onSettings: vi.fn(),
    onJournal: vi.fn(),
    onCollections: vi.fn(),
    onOpenPalette: vi.fn(),
    hasHistory: true,
    density: "comfortable" as const,
    a11y: DEFAULT_A11Y,
    children: <main>Page</main>,
    player: null,
    ...overrides,
  };
}

describe("AppShell", () => {
  it("hides the My listening group until there is listening history", () => {
    const { rerender } = render(<AppShell {...props({ hasHistory: false })} />);
    expect(screen.queryByText("My listening")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Journal" })).not.toBeInTheDocument();
    rerender(<AppShell {...props({ hasHistory: true })} />);
    expect(screen.getByText("My listening")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Journal" })).toBeInTheDocument();
  });

  it("shows destinations, active state, and Settings in the footer", () => {
    render(<AppShell {...props()} />);
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Library" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discover" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Journal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("Browse")).toBeInTheDocument();
    expect(screen.getByText("My listening")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rename" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import tags" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Narrators" })).not.toBeInTheDocument();
  });

  it("collapses and emits the new state", async () => {
    const onCollapsedChange = vi.fn();
    render(<AppShell {...props({ onCollapsedChange })} />);
    await userEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
  });

  it("clicking the Search affordance fires onOpenPalette", () => {
    const onOpenPalette = vi.fn();
    render(<AppShell {...props({ onOpenPalette })}><div /></AppShell>);
    fireEvent.click(screen.getByRole("button", { name: "Search (Ctrl+K)" }));
    expect(onOpenPalette).toHaveBeenCalled();
  });
});
