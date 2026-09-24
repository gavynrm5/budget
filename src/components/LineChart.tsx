import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { fmt } from "../lib/money";
import { formatDate } from "../lib/periods";

export interface LinePoint {
  date: string; // YYYY-MM-DD
  value: number;
  cost?: number;
}

export interface ChartMarker {
  date: string;
  kind: "buy" | "sell";
  text: string; // e.g. "Bought 2 at $412.50"
}

/**
 * A value line over time with an optional dashed second line (amount paid)
 * and buy/sell markers. The series differ by shape as well as color: solid vs
 * dashed lines, up vs down triangles. Hover, tap, or use the arrow keys to
 * read exact values for a day.
 */
export function LineChart({
  data,
  title,
  actions,
  valueLabel = "Value",
  costLabel,
  markers = []
}: {
  data: LinePoint[];
  title: string;
  actions?: ReactNode;
  valueLabel?: string;
  costLabel?: string;
  markers?: ChartMarker[];
}) {
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
  const pad = { top: 14, right: 12, bottom: 24, left: 56 };
  const innerW = width - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const hasCost = !!costLabel && data.some((d) => d.cost != null);

  const values = data.flatMap((d) => (hasCost && d.cost != null ? [d.value, d.cost] : [d.value]));
  const rawMin = values.length ? Math.min(...values) : 0;
  const rawMax = values.length ? Math.max(...values) : 1;
  const span = rawMax - rawMin || Math.max(1, rawMax * 0.1);
  const lo = Math.max(0, rawMin - span * 0.1);
  const hi = rawMax + span * 0.1;

  const x = (i: number) => pad.left + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => pad.top + (1 - (v - lo) / (hi - lo)) * innerH;
  const path = (get: (d: LinePoint) => number) => data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(get(d)).toFixed(1)}`).join("");
  const area = data.length > 1 ? `${path((d) => d.value)}L${x(data.length - 1)},${pad.top + innerH}L${x(0)},${pad.top + innerH}Z` : "";
  const ticks = [0, 0.5, 1].map((t) => lo + (hi - lo) * t);
  const labelIdx = data.length <= 1 ? [0] : [0, Math.floor((data.length - 1) / 2), data.length - 1];

  // Each marker sits on the first charted day on or after its date.
  const placed = useMemo(() => {
    const byIdx = new Map<number, ChartMarker[]>();
    if (!data.length) return byIdx;
    for (const m of markers) {
      if (m.date < data[0].date || m.date > data[data.length - 1].date) continue;
      let lo2 = 0;
      let hi2 = data.length - 1;
      while (lo2 < hi2) {
        const mid = (lo2 + hi2) >> 1;
        if (data[mid].date < m.date) lo2 = mid + 1;
        else hi2 = mid;
      }
      byIdx.set(lo2, [...(byIdx.get(lo2) ?? []), m]);
    }
    return byIdx;
  }, [data, markers]);

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
    const step = e.shiftKey ? Math.max(1, Math.round(data.length / 20)) : 1;
    if (e.key === "ArrowLeft") { e.preventDefault(); setActive(Math.max(0, cur - step)); }
    if (e.key === "ArrowRight") { e.preventDefault(); setActive(Math.min(data.length - 1, cur + step)); }
    if (e.key === "Home") { e.preventDefault(); setActive(0); }
    if (e.key === "End") { e.preventDefault(); setActive(data.length - 1); }
  };

  const a = active != null ? data[active] : null;
  const activeMarkers = active != null ? placed.get(active) ?? [] : [];
  const last = data[data.length - 1];
  const first = data[0];
  const summary = last
    ? `From ${formatDate(first.date)} to ${formatDate(last.date)}. Latest ${valueLabel.toLowerCase()} ${fmt(last.value)}${hasCost && last.cost != null ? `, ${costLabel!.toLowerCase()} ${fmt(last.cost)}` : ""}.${markers.length ? ` ${markers.length} trades marked.` : ""}`
    : "No data yet.";

  return (
    <figure className="card p-4 sm:p-5">
      <figcaption className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{title}</span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded bg-primary" aria-hidden /> {valueLabel}
          </span>
          {hasCost && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-4 border-t-2 border-dashed border-muted" aria-hidden /> {costLabel}
            </span>
          )}
          {markers.length > 0 && (
            <>
              <span className="inline-flex items-center gap-1.5"><Triangle kind="buy" /> Buy</span>
              <span className="inline-flex items-center gap-1.5"><Triangle kind="sell" /> Sell</span>
            </>
          )}
          {actions}
        </span>
      </figcaption>
      <div ref={wrap} className="relative">
        <svg
          width={width}
          height={H}
          className="block touch-pan-y rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
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
              <text x={pad.left - 8} y={y(t)} dy="0.35em" textAnchor="end" className="num fill-muted text-[11px]">{compact(t, hi)}</text>
            </g>
          ))}
          {labelIdx.map((i) => data[i] && (
            <text key={i} x={x(i)} y={H - 6} textAnchor={data.length <= 1 ? "middle" : i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"} className="fill-muted text-[11px]" aria-hidden>
              {shortDate(data[i].date, data[0]?.date, data[data.length - 1]?.date)}
            </text>
          ))}
          {area && <path d={area} className="fill-primary" fillOpacity={0.1} aria-hidden />}
          {data.length > 1 && (
            <>
              {hasCost && <path d={path((d) => d.cost ?? d.value)} fill="none" className="stroke-muted" strokeWidth={1.5} strokeDasharray="5 4" aria-hidden />}
              <path d={path((d) => d.value)} fill="none" className="stroke-primary" strokeWidth={2} strokeLinejoin="round" aria-hidden />
            </>
          )}
          {data.length === 1 && <circle cx={x(0)} cy={y(data[0].value)} r={4} className="fill-primary" aria-hidden />}
          {[...placed.entries()].map(([i, ms]) => {
            const kind = ms.some((m) => m.kind === "sell") && !ms.some((m) => m.kind === "buy") ? "sell" : "buy";
            const cx = x(i);
            const cy = y(data[i].value);
            const d = kind === "buy" ? `M${cx},${cy + 6} l-5.5,9 h11 z` : `M${cx},${cy - 6} l-5.5,-9 h11 z`;
            return <path key={i} d={d} className={kind === "buy" ? "fill-good stroke-surface" : "fill-bad stroke-surface"} strokeWidth={1.5} aria-hidden />;
          })}
          {a && active != null && (
            <g aria-hidden>
              <line x1={x(active)} x2={x(active)} y1={pad.top} y2={pad.top + innerH} className="stroke-muted" strokeOpacity={0.5} />
              {hasCost && a.cost != null && <circle cx={x(active)} cy={y(a.cost)} r={3.5} className="fill-surface stroke-muted" strokeWidth={1.5} />}
              <circle cx={x(active)} cy={y(a.value)} r={4.5} className="fill-primary stroke-surface" strokeWidth={2} />
            </g>
          )}
        </svg>
        {a && active != null && (
          <div
            className="num pointer-events-none absolute top-0 z-10 max-w-[220px] rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-lg"
            style={{ left: Math.min(Math.max(0, x(active) - 80), width - 200) }}
            role="status"
          >
            <strong className="block text-ink">{formatDate(a.date)}</strong>
            {valueLabel} {fmt(a.value)}
            {hasCost && a.cost != null && <><br />{costLabel} {fmt(a.cost)}</>}
            {activeMarkers.map((m, k) => (
              <span key={k} className={`mt-0.5 flex items-center gap-1 ${m.kind === "buy" ? "text-good" : "text-bad"}`}>
                <Triangle kind={m.kind} /> {m.text}
              </span>
            ))}
          </div>
        )}
      </div>
    </figure>
  );
}

function Triangle({ kind }: { kind: "buy" | "sell" }) {
  return (
    <svg width="10" height="9" viewBox="0 0 10 9" aria-hidden className="shrink-0">
      <path d={kind === "buy" ? "M5 0 L10 9 H0 Z" : "M5 9 L10 0 H0 Z"} className={kind === "buy" ? "fill-good" : "fill-bad"} />
    </svg>
  );
}

function shortDate(iso: string, first?: string, last?: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  // Spans over about a year read better as "Mar 2024".
  const long = first && last && Number(last.slice(0, 4)) * 12 + Number(last.slice(5, 7)) - (Number(first.slice(0, 4)) * 12 + Number(first.slice(5, 7))) > 11;
  return date.toLocaleDateString("en-US", long ? { month: "short", year: "numeric" } : { month: "short", day: "numeric" });
}

function compact(v: number, top: number) {
  if (v >= 1_000_000) return `$${+(v / 1_000_000).toFixed(2)}M`;
  if (v >= 10_000) return `$${+(v / 1000).toFixed(1)}k`;
  if (top < 20) return `$${v.toFixed(2)}`;
  return `$${Math.round(v).toLocaleString("en-US")}`;
}
