import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkArtwork, Swatch } from "./Cover";

// Mock the api module so Artwork's cover fetch resolves to null (no cover).
vi.mock("../lib/api", () => ({
  getWorkCover: vi.fn().mockResolvedValue(null),
  getAuthorCover: vi.fn().mockResolvedValue(null),
  fileUrl: (p: string) => p,
}));

describe("Cover placeholder", () => {
  it("renders .artwork__glyph for a large work artwork (size >= 64)", () => {
    const { container } = render(
      <WorkArtwork workId={1} title="Brave New World" size={72} />,
    );
    expect(container.querySelector(".artwork__glyph")).toBeInTheDocument();
    expect(container.querySelector(".artwork__initials")).toBeInTheDocument();
  });

  it("does NOT render .artwork__glyph for a small work artwork (size < 64)", () => {
    const { container } = render(
      <WorkArtwork workId={2} title="Small Title" size={36} />,
    );
    expect(container.querySelector(".artwork__glyph")).not.toBeInTheDocument();
    expect(container.querySelector(".artwork__initials")).toBeInTheDocument();
  });

  it("does NOT render .artwork__glyph for a Swatch (initials-only at any size)", () => {
    const { container } = render(<Swatch name="Solo Author" size={28} />);
    expect(container.querySelector(".artwork__glyph")).not.toBeInTheDocument();
  });
});
