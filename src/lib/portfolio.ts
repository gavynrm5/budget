import { round2, sum } from "./money";
import { closeOn, type PricePoint, type Quote } from "./marketData";
import type { LegacyHolding, Trade } from "./types";

const EPS = 1e-6;
const roundShares = (n: number) => (Math.abs(n) < EPS ? 0 : Math.round(n * 1e6) / 1e6);

/** Uppercase, trimmed ticker. Allows class shares like BRK.B. */
export function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export function isValidSymbol(s: string): boolean {
  return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s);
}

/** Oldest first. On the same day, buys come before sells, then in the order they were entered. */
export function sortTrades(trades: Trade[]): Trade[] {
  return [...trades].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.type === b.type ? 0 : a.type === "buy" ? -1 : 1) ||
      (a.createdAt ?? 0) - (b.createdAt ?? 0)
  );
}

export interface Position {
  symbol: string;
  shares: number;
  /** What the shares still held cost, at average cost. */
  cost: number;
  avgCost: number;
  /** Gain locked in by sales. */
  realized: number;
  firstDate: string;
  trades: Trade[]; // oldest first
}

/**
 * Replays trades with the average cost method (what Robinhood shows):
 * a buy adds its cost, a sale removes shares at the current average cost
 * and books the difference from the sale price as realized gain.
 */
export function buildPositions(trades: Trade[]): Record<string, Position> {
  const out: Record<string, Position> = {};
  for (const t of sortTrades(trades)) {
    const p = (out[t.symbol] ??= { symbol: t.symbol, shares: 0, cost: 0, avgCost: 0, realized: 0, firstDate: t.date, trades: [] });
    p.trades.push(t);
    if (t.type === "buy") {
      p.shares = roundShares(p.shares + t.shares);
      p.cost += t.shares * t.price;
    } else {
      const avg = p.shares > 0 ? p.cost / p.shares : 0;
      const sold = Math.min(t.shares, p.shares);
      p.realized += sold * (t.price - avg);
      p.cost -= sold * avg;
      p.shares = roundShares(p.shares - sold);
    }
    if (p.shares === 0) p.cost = 0;
    p.avgCost = p.shares > 0 ? p.cost / p.shares : 0;
  }
  for (const p of Object.values(out)) {
    p.cost = round2(p.cost);
    p.realized = round2(p.realized);
  }
  return out;
}

/** Shares of `symbol` held at the end of `date`, optionally ignoring one trade (the one being edited). */
export function sharesOn(trades: Trade[], symbol: string, date: string, excludeId?: string): number {
  let n = 0;
  for (const t of trades) {
    if (t.symbol !== symbol || t.id === excludeId || t.date > date) continue;
    n += t.type === "buy" ? t.shares : -t.shares;
  }
  return roundShares(n);
}

/** The first sale that sells more shares than were owned at that point, if any. */
export function findOversell(trades: Trade[]): { trade: Trade; owned: number } | null {
  const held: Record<string, number> = {};
  for (const t of sortTrades(trades)) {
    const owned = held[t.symbol] ?? 0;
    if (t.type === "sell" && t.shares > owned + EPS) return { trade: t, owned: roundShares(owned) };
    held[t.symbol] = owned + (t.type === "buy" ? t.shares : -t.shares);
  }
  return null;
}

export interface HoldingRow {
  position: Position;
  quote: Quote | null;
  /** Market value. Falls back to cost when there is no price, so totals stay sane. */
  value: number;
  gain: number;
  gainPct: number | null;
  dayChange: number;
  dayChangePct: number | null;
  weight: number;
}

export interface PortfolioSummary {
  rows: HoldingRow[]; // open positions, biggest first
  closed: Position[]; // fully sold
  cost: number;
  value: number;
  gain: number;
  gainPct: number | null;
  realized: number;
  dayChange: number;
  dayChangePct: number | null;
  /** Open positions with no usable price. */
  missing: string[];
}

export function computePortfolio(positions: Record<string, Position>, quotes: Record<string, Quote | null>): PortfolioSummary {
  const all = Object.values(positions);
  const open = all.filter((p) => p.shares > 0);
  const base = open.map((p) => {
    const quote = quotes[p.symbol] ?? null;
    const value = quote ? round2(p.shares * quote.price) : p.cost;
    const dayChange = quote ? round2(p.shares * quote.change) : 0;
    const prevValue = value - dayChange;
    return {
      position: p,
      quote,
      value,
      gain: round2(value - p.cost),
      gainPct: quote && p.cost > 0 ? (value - p.cost) / p.cost : null,
      dayChange,
      dayChangePct: quote && prevValue > 0 ? dayChange / prevValue : null,
      weight: 0
    };
  });
  const value = sum(base.map((r) => r.value));
  const cost = sum(base.map((r) => r.position.cost));
  const dayChange = sum(base.map((r) => r.dayChange));
  const rows = base.map((r) => ({ ...r, weight: value > 0 ? r.value / value : 0 })).sort((a, b) => b.value - a.value);
  return {
    rows,
    closed: all.filter((p) => p.shares === 0).sort((a, b) => a.symbol.localeCompare(b.symbol)),
    cost,
    value,
    gain: round2(value - cost),
    gainPct: cost > 0 ? (value - cost) / cost : null,
    realized: sum(all.map((p) => p.realized)),
    dayChange,
    dayChangePct: value - dayChange > 0 ? dayChange / (value - dayChange) : null,
    missing: rows.filter((r) => !r.quote).map((r) => r.position.symbol)
  };
}

export interface ValuePoint {
  date: string;
  value: number;
  cost: number;
}

/**
 * Portfolio value and amount invested at the close of every trading day from
 * the first trade through today. Today uses live quotes when there are any.
 * A day with no known close for a stock falls back to the last price paid.
 */
export function portfolioSeries(
  trades: Trade[],
  histories: Record<string, PricePoint[] | null | undefined>,
  quotes: Record<string, Quote | null>,
  today: string
): ValuePoint[] {
  const sorted = sortTrades(trades).filter((t) => t.date <= today);
  if (!sorted.length) return [];
  const first = sorted[0].date;
  const dates = new Set<string>([today, ...sorted.map((t) => t.date)]);
  for (const pts of Object.values(histories)) pts?.forEach(([d]) => d >= first && d <= today && dates.add(d));

  const held: Record<string, { shares: number; cost: number; lastPrice: number }> = {};
  const out: ValuePoint[] = [];
  let i = 0;
  for (const d of [...dates].sort()) {
    for (; i < sorted.length && sorted[i].date <= d; i++) {
      const t = sorted[i];
      const h = (held[t.symbol] ??= { shares: 0, cost: 0, lastPrice: t.price });
      h.lastPrice = t.price;
      if (t.type === "buy") {
        h.shares += t.shares;
        h.cost += t.shares * t.price;
      } else {
        const avg = h.shares > 0 ? h.cost / h.shares : 0;
        const sold = Math.min(t.shares, h.shares);
        h.cost -= sold * avg;
        h.shares -= sold;
        if (h.shares < EPS) { h.shares = 0; h.cost = 0; }
      }
    }
    let value = 0;
    let cost = 0;
    for (const [sym, h] of Object.entries(held)) {
      if (!h.shares) continue;
      const live = d === today ? quotes[sym]?.price : undefined;
      value += h.shares * (live ?? closeOn(histories[sym], d) ?? h.lastPrice);
      cost += h.cost;
    }
    out.push({ date: d, value: round2(value), cost: round2(cost) });
  }
  return out;
}

/** Marks trades converted from the first portfolio version, which had no dates. */
export const LEGACY_NOTE = "Moved from your first portfolio entry. Set the real date or replace it with your trades.";

/** Turns first-version holdings (one line per stock, no date) into buy trades. */
export function tradesFromLegacy(holdings: LegacyHolding[], dateOf: (ms?: number) => string): Trade[] {
  return holdings.map((h) => ({
    id: h.id,
    symbol: h.symbol,
    type: "buy",
    date: dateOf(h.createdAt),
    shares: h.shares,
    price: h.avgCost,
    notes: [h.notes, LEGACY_NOTE].filter(Boolean).join(" "),
    createdAt: h.createdAt
  }));
}

/** "+$12.34" / "-$5.00": the sign is always shown so color is never the only cue. */
export function signed(n: number, format: (v: number) => string): string {
  const r = round2(n);
  if (r === 0) return format(0);
  return `${r > 0 ? "+" : "-"}${format(Math.abs(r))}`;
}
