/**
 * Unit tests for the playback keyboard shortcut Space-key guard.
 * The activatable check is tested here as a pure predicate matching
 * the inline logic in App.tsx's global keydown handler.
 */
import { describe, it, expect } from "vitest";

// Mirrors the inline guard in App.tsx — keep in sync if the handler changes.
function isActivatable(t: HTMLElement | null): boolean {
  if (!t) return false;
  const role = t.getAttribute("role");
  return (
    t.tagName === "BUTTON" ||
    t.tagName === "A" ||
    role === "button" ||
    role === "menuitem" ||
    role === "tab" ||
    role === "treeitem" ||
    role === "option"
  );
}

function makeEl(tag: string, attrs: Record<string, string> = {}): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

describe("Space-key activatable guard", () => {
  it("treats BUTTON as activatable", () => {
    expect(isActivatable(makeEl("button"))).toBe(true);
  });

  it("treats A as activatable", () => {
    expect(isActivatable(makeEl("a"))).toBe(true);
  });

  it("treats role=button as activatable", () => {
    expect(isActivatable(makeEl("div", { role: "button" }))).toBe(true);
  });

  it("treats role=menuitem as activatable", () => {
    expect(isActivatable(makeEl("li", { role: "menuitem" }))).toBe(true);
  });

  it("treats role=tab as activatable", () => {
    expect(isActivatable(makeEl("div", { role: "tab" }))).toBe(true);
  });

  it("treats role=treeitem as activatable", () => {
    expect(isActivatable(makeEl("div", { role: "treeitem" }))).toBe(true);
  });

  it("treats role=option as activatable", () => {
    expect(isActivatable(makeEl("li", { role: "option" }))).toBe(true);
  });

  it("does NOT treat BODY / DIV / SPAN as activatable", () => {
    expect(isActivatable(document.body)).toBe(false);
    expect(isActivatable(makeEl("div"))).toBe(false);
    expect(isActivatable(makeEl("span"))).toBe(false);
  });

  it("does NOT treat null as activatable", () => {
    expect(isActivatable(null)).toBe(false);
  });
});
