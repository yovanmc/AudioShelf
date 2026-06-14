import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScanView } from "./ScanView";

describe("ScanView", () => {
  it("shows result counts when a scan result is present", () => {
    render(<ScanView result={{ authors: 3, works: 8, chapters: 20 }} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Creators")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("Works")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getByText("Chapters")).toBeInTheDocument();
  });

  it("shows a scanning message when result is null", () => {
    render(<ScanView result={null} />);
    expect(screen.getByText(/scanning/i)).toBeInTheDocument();
  });

  it("shows next-steps CTAs when a scan completes", () => {
    render(<ScanView result={{ authors: 3, works: 4, chapters: 7 }} onOpenLibrary={() => {}} onOpenHome={() => {}} />);
    expect(screen.getByText(/Library scanned/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Browse library/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Go to Home/i })).toBeInTheDocument();
  });
});
