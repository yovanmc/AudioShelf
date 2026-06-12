import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsView } from "./SettingsView";

describe("SettingsView", () => {
  it("shows the current root and last scan counts when a library is set", () => {
    render(
      <SettingsView
        root="C:/Audio/Library"
        lastScan={{ authors: 3, works: 7, chapters: 21 }}
        scanError={null}
        busy={false}
        firstRun={false}
        onChooseFolder={vi.fn()}
        onRescan={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByText("C:/Audio/Library")).toBeInTheDocument();
    expect(screen.getByText(/3 authors/)).toBeInTheDocument();
    expect(screen.getByText(/21 chapters/)).toBeInTheDocument();
  });

  it("fires onChooseFolder when the choose button is clicked", async () => {
    const onChooseFolder = vi.fn();
    render(
      <SettingsView
        root="C:/Audio/Library"
        lastScan={null}
        scanError={null}
        busy={false}
        firstRun={false}
        onChooseFolder={onChooseFolder}
        onRescan={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /choose .*folder/i }));
    expect(onChooseFolder).toHaveBeenCalledOnce();
  });

  it("shows onboarding copy and hides re-scan/back on first run", () => {
    render(
      <SettingsView
        root={null}
        lastScan={null}
        scanError={null}
        busy={false}
        firstRun={true}
        onChooseFolder={vi.fn()}
        onRescan={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByText(/welcome to audioshelf/i)).toBeInTheDocument();
    // No library chosen yet → cannot re-scan, and no back target.
    expect(screen.queryByRole("button", { name: /re-scan/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /back to library/i })).toBeNull();
  });

  it("disables actions and shows a busy label while scanning", () => {
    render(
      <SettingsView
        root="C:/Audio/Library"
        lastScan={null}
        scanError={null}
        busy={true}
        firstRun={false}
        onChooseFolder={vi.fn()}
        onRescan={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByText(/scanning…/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /choose .*folder/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /re-scan/i })).toBeDisabled();
  });

  it("surfaces a scan error", () => {
    render(
      <SettingsView
        root="C:/Audio/Gone"
        lastScan={null}
        scanError="The system cannot find the path specified."
        busy={false}
        firstRun={false}
        onChooseFolder={vi.fn()}
        onRescan={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByText(/cannot find the path/i)).toBeInTheDocument();
  });
});
