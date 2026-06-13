import { describe, it, expect } from "vitest";
import { hasScopedTokens } from "./query";

describe("hasScopedTokens", () => {
  it("detects tag/duration/status prefixes", () => {
    expect(hasScopedTokens("tag:cozy")).toBe(true);
    expect(hasScopedTokens("duration:<15m")).toBe(true);
    expect(hasScopedTokens("status:unplayed")).toBe(true);
  });
  it("plain text is not scoped", () => {
    expect(hasScopedTokens("jane doe")).toBe(false);
    expect(hasScopedTokens("")).toBe(false);
  });
});
