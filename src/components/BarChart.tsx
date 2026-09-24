import { useState } from "react";
import { fmt } from "../lib/money";

export interface BarDatum {
  label: string;
  budgeted: number;
  spent: number;
}

/**
 * Grouped bar chart (Budgeted vs Spent). Budgeted bars are outlined and
 * Spent bars are solid, so the two series differ by shape as well as color.
 * Each group is focusable and shows exact values.
 */
export function BarChart({ data, title }: { data: BarDatum[]; title: string }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...data.flatMap((d) => [d.budgeted, d.spent]));
  const nice = niceMax(max);
  const H = 220;
  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  return (
    <figure className="card p-4 sm:p-5">
      <figcaption className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{title}</span>
        <span className="flex items-center gap-4 text-sm text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm border-2 border-primary bg-primary/15" aria-hidden /> Budgeted
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm bg-good" aria-hidden /> Spent
          </span>
        </span>
      </figcaption>

      <div className="flex gap-2">
        <div className="num relative w-12 shrink-0 text-right text-xs text-muted" style={{ height: H }} aria-hidden>
          {gridLines.map((g) => (
            <span key={g} className="absolute right-0 -translate-y-1/2" style={{ top: `${(1 - g) * 100}%` }}>
              {compact(nice * g)}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto">
          <div className="relative" style={{ height: H, minWidth: data.length * 44 }}>
            {gridLines.map((g) => (
              <div key={g} className="absolute inset-x-0 border-t border-line/70" style={{ top: `${(1 - g) * 100}%` }} aria-hidden />
            ))}
            <div className="absolute inset-0 flex items-end">
              {data.map((d, i) => (
                <button
                  key={d.label}
                  className="group relative flex h-full flex-1 items-end justify-center gap-[3px] rounded-md px-1 focus-visible:bg-surface-2"
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  onClick={() => setActive(active === i ? null : i)}
                  aria-label={`${d.label}: budgeted ${fmt(d.budgeted)}, spent ${fmt(d.spent)}`}
                >
                  <span
                    className="w-full max-w-[18px] rounded-t-[4px] border-2 border-b-0 border-primary bg-primary/15 transition-[height] duration-300"
                    style={{ height: `${(d.budgeted / nice) * 100}%` }}
                  />
                  <span
                    className={`w-full max-w-[18px] rounded-t-[4px] transition-[height] duration-300 ${d.spent > d.budgeted && d.budgeted > 0 ? "bg-bad" : "bg-good"}`}
                    style={{ height: `${(d.spent / nice) * 100}%` }}
                  />
                  {active === i && (
                    <span className="num pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1.5 text-left text-xs shadow-lg">
                      <strong className="block text-ink">{d.label}</strong>
                      Budgeted {fmt(d.budgeted)}
                      <br />
                      Spent {fmt(d.spent)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-1 flex" style={{ minWidth: data.length * 44 }} aria-hidden>
            {data.map((d) => (
              <span key={d.label} className="flex-1 text-center text-xs text-muted">{d.label}</span>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}

function niceMax(v: number) {
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  return (steps.find((n) => f <= n) ?? 10) * exp;
}

function compact(v: number) {
  if (v >= 1000) return `$${+(v / 1000).toFixed(2)}k`;
  return `$${Math.round(v)}`;
}
