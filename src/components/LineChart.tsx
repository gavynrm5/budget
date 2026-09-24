import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { fmt } from "../lib/money";
import { formatDate } from "../lib/periods";

export interface LinePoint {
  date: string; // YYYY-MM-DD
  value: number;
  cost: number;
}

/**
 * Portfolio value over time. Value is a solid line with a soft fill and cost
 * basis is dashed, so the two series differ by shape as well as color.
 * Hover, tap, or use the arrow keys to read exact values for a day.
 */
export function LineChart({ data, title, actions }: { data: LinePoint[]; title: string; actions?: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = 220;
  const pad = { top: 12, right: 12, bottom: 24, left: 56 };
  const innerW = width - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const values = data.flatMap((d) => [d.value, d.cost]);
  const rawMin = values.length ? Math.min(...values) : 0;
  const rawMax = values.length ? Math.max(...values) : 1;
  const span = rawMax - rawMin || Math.max(1, rawMax * 0.1);
  const lo = Math.max(0, rawMin - span * 0.1);
  const hi = rawMax + span * 0.1;

  const x = (i: number) => pad.left + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => pad.top + (1 - (v - lo) / (hi - lo)) * innerH;
  const path = (key: "value" | "cost") => data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join("");
  const area = data.length > 1 ? `${path("value")}L${x(data.length - 1)},${pad.top + innerH}L${x(0)},${pad.top + innerH}Z` : "";
  const ticks = [0, 0.5, 1].map((t) => lo + (hi - lo) * t);
  const labelIdx = data.length <= 1 ? [0] : [0, Math.floor((data.length - 1) / 2), data.length - 1];

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!data.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - pad.left;
    const i = data.length <= 1 ? 0 : Math.round((px / innerW) * (data.length - 1));
    setActive(Math.max(0, Math.min(data.length - 1, i)));
  };
  const onKey = (e: KeyboardEvent) => {
    if (!data.length) return;
    const cur = active ?? data.length - 1;
    if (e.key === "ArrowLeft") { e.preventDefault(); setActive(Math.max(0, cur - 1)); }
    if (e.key === "ArrowRight") { e.preventDefault(); setActive(Math.min(data.length - 1, cur + 1)); }
    if (e.key === "Home") { e.preventDefault(); setActive(0); }
    if (e.key === "End") { e.preventDefault(); setActive(data.length - 1); }
  };

  const a = active != null ? data[active] : null;
  const last = data[data.length - 1];
  const summary = last ? `Latest ${formatDate(last.date)}: value ${fmt(last.value)}, cost ${fmt(last.cost)}.` : "No data yet.";

  return (
    <figure className="card p-4 sm:p-5">
      <figcaption className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{title}</span>
        <span className="flex flex-wrap items-center gap-4 text-sm text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded bg-primary" aria-hidden /> Value
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-4 border-t-2 border-dashed border-muted" aria-hidden /> Amount paid
          </span>
          {actions}
        </span>
      </figcaption>
      <div ref={wrap} className="relative">
        <svg
          width={width}
          height={H}
          className="block touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-lg"
          tabIndex={0}
          role="img"
          aria-label={`${title}. ${summary} Use left and right arrow keys to read each day.`}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
        >
          {ticks.map((t) => (
            <g key={t} aria-hidden>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} className="stroke-line" strokeOpacity={0.7} />
              <text x={pad.left - 8} y={y(t)} dy="0.35em" textAnchor="end" className="num fill-muted text-[11px]">{compact(t)}</text>
            </g>
          ))}
          {labelIdx.map((i) => data[i] && (
            <text key={i} x={x(i)} y={H - 6} textAnchor={data.length <= 1 ? "middle" : i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"} className="fill-muted text-[11px]" aria-hidden>
              {shortDate(data[i].date)}
            </text>
          ))}
          {area && <path d={area} className="fill-primary" fillOpacity={0.1} aria-hidden />}
          {data.length > 1 && (
            <>
              <path d={path("cost")} fill="none" className="stroke-muted" strokeWidth={1.5} strokeDasharray="5 4" aria-hidden />
              <path d={path("value")} fill="none" className="stroke-primary" strokeWidth={2} strokeLinejoin="round" aria-hidden />
            </>
          )}
          {data.length === 1 && <circle cx={x(0)} cy={y(data[0].value)} r={4} className="fill-primary" aria-hidden />}
          {a && active != null && (
            <g aria-hidden>
              <line x1={x(active)} x2={x(active)} y1={pad.top} y2={pad.top + innerH} className="stroke-muted" strokeOpacity={0.5} />
              <circle cx={x(active)} cy={y(a.cost)} r={3.5} className="fill-surface stroke-muted" strokeWidth={1.5} />
              <circle cx={x(active)} cy={y(a.value)} r={4.5} className="fill-primary stroke-surface" strokeWidth={2} />
            </g>
          )}
        </svg>
        {a && active != null && (
          <div
            className="num pointer-events-none absolute top-0 z-10 whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-lg"
            style={{ left: Math.min(Math.max(0, x(active) - 70), width - 150) }}
            role="status"
          >
            <strong className="block text-ink">{formatDate(a.date)}</strong>
            Value {fmt(a.value)}
            <br />
            Paid {fmt(a.cost)}
          </div>
        )}
      </div>
    </figure>
  );
}

function shortDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function compact(v: number) {
  if (v >= 1_000_000) return `$${+(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1000) return `$${+(v / 1000).toFixed(1)}k`;
  return `$${Math.round(v)}`;
}
