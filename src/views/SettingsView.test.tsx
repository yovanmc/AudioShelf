import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsView } from "./SettingsView";
import type { HomeShelf } from "../lib/shelves";
import { DEFAULT_A11Y } from "../lib/a11y";

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
        a11y={DEFAULT_A11Y}
        onA11yChange={() => {}}
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
        a11y={DEFAULT_A11Y}
        onA11yChange={() => {}}
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
        a11y={DEFAULT_A11Y}
        onA11yChange={() => {}}
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
        a11y={DEFAULT_A11Y}
        onA11yChange={() => {}}
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
        a11y={DEFAULT_A11Y}
        onA11yChange={() => {}}
      />,
    );
    expect(screen.getByText(/cannot find the path/i)).toBeInTheDocument();
  });
});

function baseSettingsProps(over: Partial<React.ComponentProps<typeof SettingsView>> = {}) {
  return {
    root: "C:/Audio/Library",
    lastScan: null,
    scanError: null,
    busy: false,
    firstRun: false,
    onChooseFolder: vi.fn(),
    onRescan: vi.fn(),
    a11y: DEFAULT_A11Y,
    onA11yChange: vi.fn(),
    ...over,
  };
}

describe("SettingsView — Home shelves", () => {
  const shelf1: HomeShelf = { id: "s1_0", title: "Cozy Reads", kind: "tag", tag: "cozy" };
  const shelf2: HomeShelf = { id: "s2_1", title: "Not Started", kind: "status", status: "unstarted" };

  it("lists provided shelves with title and kind summary", () => {
    render(
      <SettingsView
        {...baseSettingsProps({
          shelves: [shelf1, shelf2],
          allTags: ["cozy"],
          authors: [],
        })}
      />,
    );
    expect(screen.getByText("Cozy Reads")).toBeInTheDocument();
    expect(screen.getByText(/Tag: cozy/)).toBeInTheDocument();
    expect(screen.getByText("Not Started")).toBeInTheDocument();
    expect(screen.getByText(/Status: Not started/)).toBeInTheDocument();
  });

  it("calls onRemoveShelf with the correct id when Remove is clicked", async () => {
    const onRemoveShelf = vi.fn();
    render(
      <SettingsView
        {...baseSettingsProps({
          shelves: [shelf1],
          allTags: ["cozy"],
          authors: [],
          onRemoveShelf,
        })}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /remove cozy reads/i }));
    expect(onRemoveShelf).toHaveBeenCalledWith("s1_0");
  });

  it("calls onMoveShelf with dir=1 for ▼ on first shelf", async () => {
    const onMoveShelf = vi.fn();
    render(
      <SettingsView
        {...baseSettingsProps({
          shelves: [shelf1, shelf2],
          allTags: ["cozy"],
          authors: [],
          onMoveShelf,
        })}
      />,
    );
    // ▼ on first shelf moves it down (dir=1)
    await userEvent.click(screen.getByRole("button", { name: /move cozy reads down/i }));
    expect(onMoveShelf).toHaveBeenCalledWith("s1_0", 1);
  });

  it("calls onMoveShelf with dir=-1 for ▲ on second shelf", async () => {
    const onMoveShelf = vi.fn();
    render(
      <SettingsView
        {...baseSettingsProps({
          shelves: [shelf1, shelf2],
          allTags: ["cozy"],
          authors: [],
          onMoveShelf,
        })}
      />,
    );
    // ▲ on second shelf moves it up (dir=-1)
    await userEvent.click(screen.getByRole("button", { name: /move not started up/i }));
    expect(onMoveShelf).toHaveBeenCalledWith("s2_1", -1);
  });

  it("calls onAddShelf with the assembled tag shelf when Add is clicked", async () => {
    const onAddShelf = vi.fn();
    render(
      <SettingsView
        {...baseSettingsProps({
          shelves: [],
          allTags: ["cozy", "mystery"],
          authors: [],
          onAddShelf,
        })}
      />,
    );
    // kind defaults to "tag", tag defaults to "cozy", title auto-fills
    await userEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    expect(onAddShelf).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "tag", tag: "cozy" }),
    );
  });

  it("calls onAddShelf with a status shelf when kind is set to status", async () => {
    const onAddShelf = vi.fn();
    render(
      <SettingsView
        {...baseSettingsProps({
          shelves: [],
          allTags: [],
          authors: [],
          onAddShelf,
        })}
      />,
    );
    const kindSelect = screen.getByRole("combobox", { name: /shelf kind/i });
    await userEvent.selectOptions(kindSelect, "status");
    await userEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    expect(onAddShelf).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "status" }),
    );
  });

  it("shows an empty-shelves message when no shelves are configured", () => {
    render(
      <SettingsView
        {...baseSettingsProps({ shelves: [], allTags: [], authors: [] })}
      />,
    );
    expect(screen.getByText(/no shelves yet/i)).toBeInTheDocument();
  });
});

describe("SettingsView — Library tools", () => {
  it("renders the Library tools button and fires its callback", () => {
    const onOpenRename = vi.fn();
    render(
      <SettingsView
        {...baseSettingsProps({ onOpenRename })}
      />,
    );
    const renameBtn = screen.getByRole("button", { name: "Standardize file names…" });
    expect(renameBtn).toBeInTheDocument();
    fireEvent.click(renameBtn);
    expect(onOpenRename).toHaveBeenCalledOnce();
  });

  it("does not render Library tools section on first run", () => {
    const onOpenRename = vi.fn();
    render(
      <SettingsView
        {...baseSettingsProps({ firstRun: true, onOpenRename })}
      />,
    );
    expect(screen.queryByRole("button", { name: "Standardize file names…" })).toBeNull();
  });
});

describe("SettingsView — Settings group headings", () => {
  it("shows Curation and Maintenance group headings on non-first-run", () => {
    render(<SettingsView {...baseSettingsProps()} />);
    // sub-nav also renders the same words as links — check for heading role specifically
    expect(screen.getByRole("heading", { name: "Curation" })).toBeInTheDocument();
  });

  it("does not show group headings on first run", () => {
    render(<SettingsView {...baseSettingsProps({ firstRun: true })} />);
    expect(screen.queryByText("Curation")).toBeNull();
  });
});

describe("SettingsView — Accessibility section", () => {
  it("renders the Accessibility section when onA11yChange is provided", () => {
    render(<SettingsView {...baseSettingsProps()} />);
    expect(screen.getByText(/^Accessibility$/i)).toBeInTheDocument();
  });

  it("shows theme buttons with the active theme pressed", () => {
    render(<SettingsView {...baseSettingsProps({ a11y: { ...DEFAULT_A11Y, theme: "light" } })} />);
    expect(screen.getByRole("button", { name: /^Light$/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Dark$/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onA11yChange with updated theme when a theme button is clicked", async () => {
    const onA11yChange = vi.fn();
    render(<SettingsView {...baseSettingsProps({ onA11yChange })} />);
    await userEvent.click(screen.getByRole("button", { name: /^Light$/ }));
    expect(onA11yChange).toHaveBeenCalledWith(expect.objectContaining({ theme: "light" }));
  });

  it("calls onA11yChange with updated textSize when a text size button is clicked", async () => {
    const onA11yChange = vi.fn();
    render(<SettingsView {...baseSettingsProps({ onA11yChange })} />);
    await userEvent.click(screen.getByRole("button", { name: /^Large$/ }));
    expect(onA11yChange).toHaveBeenCalledWith(expect.objectContaining({ textSize: "large" }));
  });

  it("calls onA11yChange toggling dyslexiaFont when the checkbox is clicked", async () => {
    const onA11yChange = vi.fn();
    render(<SettingsView {...baseSettingsProps({ onA11yChange })} />);
    await userEvent.click(screen.getByLabelText(/dyslexia-friendly font/i));
    expect(onA11yChange).toHaveBeenCalledWith(expect.objectContaining({ dyslexiaFont: true }));
  });

  it("calls onA11yChange toggling reducedMotion when the checkbox is clicked", async () => {
    const onA11yChange = vi.fn();
    render(<SettingsView {...baseSettingsProps({ onA11yChange })} />);
    await userEvent.click(screen.getByLabelText(/reduce motion/i));
    expect(onA11yChange).toHaveBeenCalledWith(expect.objectContaining({ reducedMotion: true }));
  });

  it("does not render the Accessibility section on first run", () => {
    render(<SettingsView {...baseSettingsProps({ firstRun: true })} />);
    expect(screen.queryByText(/^Accessibility$/i)).toBeNull();
  });
});
