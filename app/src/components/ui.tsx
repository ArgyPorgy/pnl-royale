"use client";
import type { ButtonHTMLAttributes, ReactNode } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

type Variant = "primary" | "secondary" | "ghost" | "up" | "down";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-[#041318] hover:bg-accent-strong shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]",
  secondary: "bg-surface-2 text-fg border border-border hover:bg-surface-3 hover:border-border-strong",
  ghost: "text-muted hover:text-fg hover:bg-surface-2",
  up: "bg-up text-[#04140c] hover:bg-up-strong",
  down: "bg-down text-white hover:bg-down-strong",
};
const SIZE: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] rounded-lg gap-1.5",
  md: "h-10 px-4 text-sm rounded-xl gap-2",
  lg: "h-12 px-5 text-[15px] rounded-xl gap-2",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex select-none items-center justify-center font-semibold tracking-tight transition-colors duration-150",
        "disabled:cursor-not-allowed disabled:opacity-40",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
    >
      {children}
    </button>
  );
}

type Tone = "neutral" | "up" | "down" | "accent" | "warn";
const TONE: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted border-border",
  up: "bg-up/10 text-up border-up/25",
  down: "bg-down/10 text-down border-down/25",
  accent: "bg-accent/12 text-accent border-accent/30",
  warn: "bg-warn/10 text-warn border-warn/25",
};

export function Pill({ tone = "neutral", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cx("inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold tracking-wide", TONE[tone], className)}>
      {dot && <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Card({
  title,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx("rounded-[var(--radius-card)] border border-border bg-surface/95 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-faint">{title}</h2>
          {action}
        </header>
      )}
      <div className={cx("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  size = "md",
  className,
}: {
  options: { value: T; label: ReactNode; disabled?: boolean; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div className={cx("inline-flex rounded-xl border border-border bg-bg p-1", className)}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          title={o.title}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cx(
            "flex-1 whitespace-nowrap rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-35",
            size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3 text-[13px]",
            o.value === value ? "bg-surface-3 text-fg shadow-[0_0_0_1px_rgba(34,211,238,0.55)]" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="text-xs text-muted">{label}</div>
      <div className="num mt-1 text-[15px] text-fg">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-faint">{sub}</div>}
    </div>
  );
}

export function Row({ label, value, valueClass }: { label: ReactNode; value: ReactNode; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
      <span className="text-muted">{label}</span>
      <span className={cx("num text-right text-fg", valueClass)}>{value}</span>
    </div>
  );
}

export function Empty({
  icon,
  title,
  body,
  action,
  loading,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="grid place-items-center rounded-[var(--radius-card)] border border-border bg-surface px-6 py-16 text-center">
      {loading ? (
        <div className="mb-4 h-10 w-10 rounded-xl skeleton" />
      ) : (
        icon && <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl border border-accent/30 bg-accent/10 text-accent">{icon}</div>
      )}
      <div className="display text-2xl text-fg">{title}</div>
      {body && <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
