import { describe, it, expect } from "vitest";
import { parseA11yPrefs, a11yDataAttrs, DEFAULT_A11Y } from "./a11y";

describe("parseA11yPrefs", () => {
  it("returns default on null", () => {
    expect(parseA11yPrefs(null)).toEqual(DEFAULT_A11Y);
  });

  it("returns default on bad JSON", () => {
    expect(parseA11yPrefs("not-json")).toEqual(DEFAULT_A11Y);
    expect(parseA11yPrefs("{bad}")).toEqual(DEFAULT_A11Y);
  });

  it("falls back to defaults for unknown theme and size", () => {
    const raw = JSON.stringify({ theme: "rainbow", textSize: "gigantic", dyslexiaFont: false, reducedMotion: false });
    expect(parseA11yPrefs(raw)).toEqual(DEFAULT_A11Y);
  });

  it("round-trips valid values", () => {
    const prefs = { theme: "light" as const, textSize: "large" as const, dyslexiaFont: true, reducedMotion: true };
    expect(parseA11yPrefs(JSON.stringify(prefs))).toEqual(prefs);
  });

  it("round-trips high-contrast and xlarge", () => {
    const prefs = { theme: "high-contrast" as const, textSize: "xlarge" as const, dyslexiaFont: false, reducedMotion: false };
    expect(parseA11yPrefs(JSON.stringify(prefs))).toEqual(prefs);
  });
});

describe("a11yDataAttrs", () => {
  it("returns empty object for dark theme, normal size, no flags", () => {
    expect(a11yDataAttrs(DEFAULT_A11Y)).toEqual({});
  });

  it("returns all four keys for non-default values", () => {
    const prefs = { theme: "light" as const, textSize: "large" as const, dyslexiaFont: true, reducedMotion: true };
    expect(a11yDataAttrs(prefs)).toEqual({
      "data-theme": "light",
      "data-text-size": "large",
      "data-font": "dyslexia",
      "data-reduced-motion": "true",
    });
  });
});
