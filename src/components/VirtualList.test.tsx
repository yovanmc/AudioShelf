import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { VirtualList } from "./VirtualList";

describe("VirtualList", () => {
  it("fixed-size: renders only a windowed subset of 500 items (not all 500)", () => {
    render(
      <VirtualList
        items={Array.from({ length: 500 }, (_, i) => i)}
        itemSize={40}
        height={400}
        renderItem={(n) => <span data-testid="row">{n}</span>}
      />,
    );
    const rows = screen.getAllByTestId("row");
    // Virtualization must render some rows (overscan + visible window)
    expect(rows.length).toBeGreaterThan(0);
    // But far fewer than all 500 — windowing is working
    expect(rows.length).toBeLessThan(500);
  });

  it("variable-size: renders only a windowed subset and does not throw", () => {
    render(
      <VirtualList
        items={Array.from({ length: 500 }, (_, i) => i)}
        itemSize={(i) => (i % 2 ? 64 : 40)}
        height={400}
        renderItem={(n) => <span data-testid="vrow">{n}</span>}
      />,
    );
    const rows = screen.getAllByTestId("vrow");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(500);
  });
});
