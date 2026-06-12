import { useEffect, useRef, useState } from "react";
import { IconButton } from "./ui";

export interface MenuItem { label: string; onSelect: () => void; }

export function Menu({ label, items, forcedOpen = false }: { label: string; items: MenuItem[]; forcedOpen?: boolean }) {
  const [open, setOpen] = useState(false);
  const visible = open || forcedOpen;
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  function close(restore = true) {
    setOpen(false);
    if (restore) queueMicrotask(() => trigger.current?.focus());
  }

  useEffect(() => {
    if (!visible) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [visible]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    const menuItems = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    if (!menuItems.length) return;
    const index = menuItems.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (event.key === "ArrowDown") next = (index + 1) % menuItems.length;
    if (event.key === "ArrowUp") next = (index - 1 + menuItems.length) % menuItems.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = menuItems.length - 1;
    if (next >= 0) {
      event.preventDefault();
      menuItems[next].focus();
    }
  }

  return (
    <span className="menu" ref={root} onKeyDown={onKeyDown}>
      <IconButton ref={trigger} icon="more" label={label} onClick={() => setOpen((value) => !value)} aria-expanded={visible} />
      {visible && (
        <span className="menu__popover" role="menu">
          {items.map((item) => (
            <button key={item.label} className="menu__item" role="menuitem" onClick={() => { item.onSelect(); close(false); }}>
              {item.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
