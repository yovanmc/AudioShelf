import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScanView } from "./ScanView";

describe("ScanView", () => {
  it("shows result counts when a scan result is present", () => {
    render(<ScanView result={{ authors: 3, works: 8, chapters: 20 }} />);
    expect(screen.getByText(/3 authors/)).toBeInTheDocument();
    expect(screen.getByText(/8 works/)).toBeInTheDocument();
    expect(screen.getByText(/20 chapters/)).toBeInTheDocument();
  });

  it("shows a scanning message when result is null", () => {
    render(<ScanView result={null} />);
    expect(screen.getByText(/scanning/i)).toBeInTheDocument();
  });
});
