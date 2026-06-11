import { describe, it, expect, vi } from "vitest";
import { runSteps } from "./runner";
import type { Step } from "./types";

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
