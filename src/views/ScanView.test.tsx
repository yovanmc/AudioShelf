import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ScanView } from "./ScanView";

describe("ScanView", () => {
  it("shows the scan-diff summary on completion", () => {
    render(<ScanView result={{ authors: 3, works: 4, chapters: 7, added: 2, updated: 1, removed: 1, skipped: 3 }} />);
    expect(screen.getByText(/2 added · 1 updated · 1 removed · 3 unchanged/)).toBeInTheDocument();
  });
  it("shows progress + cancel while scanning", () => {
    const onCancel = vi.fn();
    render(<ScanView result={null} progress={{ authorsDone: 2, authorsTotal: 10, current: "Jane Doe", added: 1, updated: 0, skipped: 1 }} onCancel={onCancel} />);
    expect(screen.getByText(/2 \/ 10 creators/)).toBeInTheDocument();
    screen.getByText("Cancel scan").click();
    expect(onCancel).toHaveBeenCalled();
  });
  it("lists skipped errors when present", () => {
    render(<ScanView result={{ authors: 1, works: 1, chapters: 1, errors: [{ path: "C:/x/bad.mp3", reason: "denied" }] }} />);
    expect(screen.getByText(/1 item skipped/)).toBeInTheDocument();
  });
});
