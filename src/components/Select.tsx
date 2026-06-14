import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
}

export function Select<T extends string | number>({
  label,
  value,
  options,
  onChange,
  className = "",
}: {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  function close(restore = true) {
    setOpen(false);
    if (restore) queueMicrotask(() => trigger.current?.focus());
  }

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    const optionEls = [
      ...(root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []),
    ];
    if (!optionEls.length) return;
    const index = optionEls.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (event.key === "ArrowDown") next = (index + 1) % optionEls.length;
    if (event.key === "ArrowUp") next = (index - 1 + optionEls.length) % optionEls.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = optionEls.length - 1;
    if (next >= 0) {
      event.preventDefault();
      optionEls[next].focus();
    }
  }

  const currentLabel = options.find((o) => o.value === value)?.label ?? String(value);

  return (
    <span className={`select ${className}`} ref={root} onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        className="select__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
      >
        {currentLabel}
        <Icon name="chevron" className="select__chevron" aria-hidden />
      </button>
      {open && (
        <span className="menu__popover select__popover" role="listbox">
          {options.map((opt) => {
            const selected = opt.value === value;
            return (
              <button
                key={String(opt.value)}
                role="option"
                aria-selected={selected}
                className={`select__option${selected ? " select__option--on" : ""}`}
                onClick={() => {
                  onChange(opt.value);
                  close(true);
                }}
              >
                {selected ? (
                  <Icon name="check" className="select__option-check" aria-hidden />
                ) : (
                  <span className="select__option-check" aria-hidden />
                )}
                {opt.label}
              </button>
            );
          })}
        </span>
      )}
    </span>
  );
}
