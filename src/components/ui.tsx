import { useEffect, useRef, type ReactNode } from "react";
import { CircleAlert, CircleCheck, TriangleAlert, X } from "lucide-react";
import type { Status } from "../lib/calc";
import { fmt, pct } from "../lib/money";

export const STATUS_TEXT: Record<Status, string> = { over: "Over Budget", near: "Near Limit", ok: "On Track" };
const STATUS_CLASS: Record<Status, string> = {
  over: "bg-bad/10 text-bad",
  near: "bg-warn/15 text-warn",
  ok: "bg-good/10 text-good"
};
const STATUS_BAR: Record<Status, string> = { over: "bg-bad", near: "bg-warn", ok: "bg-good" };

export function StatusBadge({ status, compact = false }: { status: Status; compact?: boolean }) {
  const Icon = status === "over" ? CircleAlert : status === "near" ? TriangleAlert : CircleCheck;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLASS[status]}`}>
      <Icon size={14} aria-hidden />
      {compact ? <span className="sr-only">{STATUS_TEXT[status]}</span> : STATUS_TEXT[status]}
    </span>
  );
}

export function ProgressBar({ value, status, label }: { value: number | null; status: Status; label: string }) {
  const v = value ?? 0;
  const width = Math.max(0, Math.min(1, v)) * 100;
  return (
    <div
      className="relative h-2 w-full overflow-hidden rounded-full bg-surface-2"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      aria-valuetext={pct(value)}
    >
      <div className={`h-full rounded-full transition-[width] duration-300 ${STATUS_BAR[status]}`} style={{ width: `${width}%` }} />
    </div>
  );
}

/** Money value. Negative values are red and carry a minus sign, so color is never the only cue. */
export function Money({ value, className = "", colorNegative = true }: { value: number; className?: string; colorNegative?: boolean }) {
  return <span className={`num ${colorNegative && value < 0 ? "text-bad" : ""} ${className}`}>{fmt(value)}</span>;
}

export function SummaryCard({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: "bad" | "good" }) {
  return (
    <div className="card p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className={`num mt-1 text-xl font-semibold sm:text-2xl ${tone === "bad" ? "text-bad" : ""}`}>{fmt(value)}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-muted">{icon}</div>
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-muted">{children}</div>}
    </div>
  );
}

/** Bottom sheet on phones, centered dialog on larger screens. */
export function Sheet({
  title,
  onClose,
  children,
  footer,
  wide = false
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>("[data-autofocus]") ?? el?.querySelector<HTMLElement>("input,select,textarea,button");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && el) {
        const f = [...el.querySelectorAll<HTMLElement>("button,input,select,textarea,a[href],[tabindex]:not([tabindex='-1'])")].filter((n) => !n.hasAttribute("disabled"));
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-sheet flex items-end justify-center sm:items-center sm:p-6">
      <div className="anim-fade absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`anim-sheet sm:anim-pop relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-surface shadow-2xl sm:rounded-2xl ${wide ? "sm:max-w-2xl" : "sm:max-w-lg"}`}
      >
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-line sm:hidden" aria-hidden />
        <div className="flex items-center justify-between px-5 pb-2 pt-3 sm:pt-5">
          <h2 className="text-lg">{title}</h2>
          <button className="icon-btn -mr-2" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <div className="pb-safe border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl sm:text-3xl">{title}</h1>
        {subtitle && <div className="mt-0.5 text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-[40px] rounded-lg px-3 text-sm font-medium transition-colors duration-150 ${value === o.value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
