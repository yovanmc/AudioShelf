import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export function Button({ variant = "secondary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  return <button className={`button button--${variant} ${className}`} {...props} />;
}

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }>(
  function IconButton({ icon, label, ...props }, ref) {
    return <button ref={ref} className="icon-button" aria-label={label} title={label} {...props}><Icon name={icon} /></button>;
  },
);

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`card ${className}`} {...props} />;
}

export function ProgressBar({ value, label = "Progress" }: { value: number; label?: string }) {
  const safe = Math.min(100, Math.max(0, value));
  return <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={safe}><div className="progress__value" style={{ width: `${safe}%` }} /></div>;
}

export function StatCard({ label, value }: { label: string; value: ReactNode }) {
  return <Card className="stat-card"><div className="stat-card__value">{value}</div><div className="stat-card__label">{label}</div></Card>;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <Card className="empty-state"><h2>{title}</h2>{children && <div className="muted">{children}</div>}{action && <div>{action}</div>}</Card>;
}

export function Notice({ children, tone = "info", role }: { children: ReactNode; tone?: "info" | "success" | "error"; role?: string }) {
  return <Card className={`notice notice--${tone}`} role={role}>{children}</Card>;
}

export function PageHeader({ eyebrow, title, actions }: { eyebrow: string; title: ReactNode; actions?: ReactNode }) {
  return (
    <header className="view-section page-header">
      <div className="page-header__copy">
        <div className="eyebrow muted">{eyebrow}</div>
        <h1>{title}</h1>
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}

export function SectionHeading({ eyebrow, title, actions }: { eyebrow?: string; title: ReactNode; actions?: ReactNode }) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow ? <div className="eyebrow muted">{eyebrow}</div> : null}
        <h2>{title}</h2>
      </div>
      {actions ?? null}
    </div>
  );
}

export function TagGroup({ tags, max, align }: { tags: string[]; max?: number; align?: "start" | "end" }) {
  if (!tags.length) return null;
  const shown = max ? tags.slice(0, max) : tags;
  return (
    <span className={`chips${align === "end" ? " chips--end" : ""}`}>
      {shown.map((t) => <span className="chip" key={t}>{t}</span>)}
    </span>
  );
}

export function Dialog({ label, onClose, className, children }: { label: string; onClose: () => void; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "Tab" && ref.current) {
        const focusable = Array.from(
          ref.current.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => !el.hasAttribute("disabled"));
        if (focusable.length === 0) { e.preventDefault(); return; }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
    };
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={`card dialog ${className ?? ""}`} role="dialog" aria-modal="true" aria-label={label}>
        <IconButton className="dialog__close" icon="close" label={`Close ${label}`} onClick={onClose} {...{ "data-autofocus": true }} />
        {children}
      </div>
    </div>
  );
}
