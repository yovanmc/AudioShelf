import { describe, it, expect } from "vitest";
import { clampIndex } from "./CommandPalette";

describe("clampIndex", () => {
  it("wraps around both ends", () => {
    expect(clampIndex(-1, 3)).toBe(2);
    expect(clampIndex(3, 3)).toBe(0);
    expect(clampIndex(1, 3)).toBe(1);
  });
  it("returns 0 for empty", () => {
    expect(clampIndex(0, 0)).toBe(0);
  });
});
