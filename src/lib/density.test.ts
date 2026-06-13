import { describe, it, expect } from "vitest";
import { parseDensity } from "./density";
describe("parseDensity", () => {
  it("defaults to comfortable on junk/null", () => {
    expect(parseDensity(null)).toBe("comfortable");
    expect(parseDensity("huge")).toBe("comfortable");
  });
  it("passes through valid values", () => {
    expect(parseDensity("compact")).toBe("compact");
    expect(parseDensity("spacious")).toBe("spacious");
  });
});
