import { describe, it, expect } from "vitest";
import { initials, colorFor } from "./avatar";

describe("avatar placeholders", () => {
  it("derives initials from one- and two-word names", () => {
    expect(initials("Jane Doe")).toBe("JD");
    expect(initials("Sam Smith")).toBe("SS");
    expect(initials("Cher")).toBe("CH");
    expect(initials("  ")).toBe("?");
    expect(initials("Ann Marie Q")).toBe("AQ"); // first + last word
  });

  it("produces a stable colour for the same name and an hsl() string", () => {
    expect(colorFor("Jane Doe")).toBe(colorFor("Jane Doe"));
    expect(colorFor("Jane Doe")).toMatch(/^hsl\(\d+ 55% 45%\)$/);
  });

  it("varies colour across different names (not all identical)", () => {
    const names = ["Jane Doe", "Sam Smith", "Trap Author", "Zz Sample Author 01"];
    const hues = new Set(names.map(colorFor));
    expect(hues.size).toBeGreaterThan(1);
  });
});
