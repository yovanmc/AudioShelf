import { describe, it, expect, vi } from "vitest";
import { runSteps } from "./runner";
import type { Step } from "./types";
import { m12Steps } from "./walkthroughs";

describe("runSteps", () => {
  it("runs every step in order and captures a numbered shot per step", async () => {
    const order: string[] = [];
    const steps: Step[] = [
      { name: "first", run: async () => { order.push("first"); } },
      { name: "second", run: async () => { order.push("second"); } },
    ];
    const shots: string[] = [];
    await runSteps(steps, "C:/shots", async (p) => { shots.push(p); });
    expect(order).toEqual(["first", "second"]);
    expect(shots).toEqual(["C:/shots/01-first.png", "C:/shots/02-second.png"]);
  });

  it("skips capture when shotsDir is null", async () => {
    const capture = vi.fn();
    await runSteps([{ name: "x", run: async () => {} }], null, capture);
    expect(capture).not.toHaveBeenCalled();
  });
});

describe("m12Steps", () => {
  it("captures the complete M12 interface in order", () => {
    const noop = async () => {};
    expect(m12Steps({
      showEmptyHome: noop, showHome: noop, collapseSidebar: noop, showLibrary: noop,
      showSearch: noop, showAuthorDetail: noop, showDiscovery: noop, showDiscoveryByTag: noop,
      showRename: noop, showSettings: noop, showPlayerCompact: noop, showPlayerExpanded: noop,
      showContextMenu: noop,
    }).map((step) => step.name)).toEqual([
      "home-empty", "home", "home-sidebar-collapsed", "library", "search",
      "author-detail", "discovery", "discovery-by-tag", "rename-preview",
      "settings", "player-compact", "player-expanded", "context-menu",
    ]);
  });
});
