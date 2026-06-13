import { render, screen } from "@testing-library/react";
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
    onInsights: vi.fn(),
    onCollections: vi.fn(),
    density: "comfortable" as const,
    a11y: DEFAULT_A11Y,
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
    expect(screen.getByRole("button", { name: "Journal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Insights" })).toBeInTheDocument();
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
});
