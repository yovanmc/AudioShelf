import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Select } from "./Select";
import type { SelectOption } from "./Select";

const options: SelectOption<string>[] = [
  { value: "az", label: "A–Z" },
  { value: "length", label: "Length" },
  { value: "played", label: "Played %" },
];

describe("Select", () => {
  it("renders the current option label in the trigger", () => {
    render(
      <Select label="Sort by" value="az" options={options} onChange={vi.fn()} />
    );
    const trigger = screen.getByRole("button", { name: "Sort by" });
    expect(trigger).toHaveTextContent("A–Z");
  });

  it("opens the listbox and shows all options on trigger click", async () => {
    render(
      <Select label="Sort by" value="az" options={options} onChange={vi.fn()} />
    );
    await userEvent.click(screen.getByRole("button", { name: "Sort by" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.getByRole("option", { name: /A–Z/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Length/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Played %/ })).toBeInTheDocument();
  });

  it("calls onChange with the option value and closes on click", async () => {
    const onChange = vi.fn();
    render(
      <Select label="Sort by" value="az" options={options} onChange={onChange} />
    );
    await userEvent.click(screen.getByRole("button", { name: "Sort by" }));
    await userEvent.click(screen.getByRole("option", { name: /Length/ }));
    expect(onChange).toHaveBeenCalledWith("length");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("marks the selected option with aria-selected and --on class", async () => {
    render(
      <Select label="Sort by" value="length" options={options} onChange={vi.fn()} />
    );
    await userEvent.click(screen.getByRole("button", { name: "Sort by" }));
    const selectedOption = screen.getByRole("option", { name: /Length/ });
    expect(selectedOption).toHaveAttribute("aria-selected", "true");
    expect(selectedOption).toHaveClass("select__option--on");
    // unselected options should not have aria-selected true
    const unselectedOption = screen.getByRole("option", { name: /A–Z/ });
    expect(unselectedOption).toHaveAttribute("aria-selected", "false");
    expect(unselectedOption).not.toHaveClass("select__option--on");
  });

  it("closes and returns focus to trigger on Escape", async () => {
    render(
      <Select label="Sort by" value="az" options={options} onChange={vi.fn()} />
    );
    const trigger = screen.getByRole("button", { name: "Sort by" });
    await userEvent.click(trigger);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
