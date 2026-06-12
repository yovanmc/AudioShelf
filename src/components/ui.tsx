import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
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
