import { round2, sum } from "./money";
import type { Holding, PortfolioSnapshot } from "./types";

/**
 * Stock quotes come from Finnhub's free plan (https://finnhub.io), which
 * allows browser calls and 60 requests a minute. One request per holding.
 */
export interface Quote {
  price: number;
  change: number; // dollars since the previous close
  prevClose: number;
  time: number; // unix seconds of the last trade
}

export class QuoteError extends Error {
  constructor(
    public kind: "bad-key" | "rate-limit" | "network",
    message: string
  ) {
    super(message);
  }
}

/** Uppercase, trimmed ticker. Allows class shares like BRK.B. */
export function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export function isValidSymbol(s: string): boolean {
  return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s);
}

/** Current quote, or null when Finnhub does not know the symbol. */
export async function fetchQuote(symbol: string, key: string): Promise<Quote | null> {
  let res: Response;
  try {
    res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(key)}`);
  } catch {
    throw new QuoteError("network", "Could not reach the price service.");
  }
  if (res.status === 401 || res.status === 403) throw new QuoteError("bad-key", "The Finnhub API key was rejected.");
  if (res.status === 429) throw new QuoteError("rate-limit", "Too many price requests. Try again in a minute.");
  if (!res.ok) throw new QuoteError("network", `The price service returned an error (${res.status}).`);
  const q = (await res.json()) as { c?: number; d?: number | null; pc?: number; t?: number };
  // Unknown symbols come back as all zeros.
  if (!q.c && !q.pc) return null;
  return { price: q.c ?? 0, change: q.d ?? 0, prevClose: q.pc ?? 0, time: q.t ?? 0 };
}

/** Last fetched quotes, kept on this device so prices still show offline. */
const CACHE_KEY = "portfolio-quotes";
export interface CachedQuotes {
  fetchedAt: number;
  quotes: Record<string, Quote | null>;
}

export function readQuoteCache(): CachedQuotes | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CachedQuotes) : null;
  } catch {
    return null;
  }
}

export function writeQuoteCache(c: CachedQuotes) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {
    /* storage full or blocked; prices just won't survive a reload */
  }
}

export interface HoldingRow {
  holding: Holding;
  quote: Quote | null;
  cost: number;
  /** Market value. Falls back to cost when there is no price, so totals stay sane. */
  value: number;
  gain: number;
  gainPct: number | null;
  dayChange: number;
  dayChangePct: number | null;
  weight: number;
}

export interface PortfolioSummary {
  rows: HoldingRow[];
  cost: number;
  value: number;
  gain: number;
  gainPct: number | null;
  dayChange: number;
  dayChangePct: number | null;
  /** Holdings with no usable price. */
  missing: string[];
}

export function computePortfolio(holdings: Holding[], quotes: Record<string, Quote | null>): PortfolioSummary {
  const base = holdings.map((h) => {
    const quote = quotes[h.symbol] ?? null;
    const cost = round2(h.shares * h.avgCost);
    const value = quote ? round2(h.shares * quote.price) : cost;
    const dayChange = quote ? round2(h.shares * quote.change) : 0;
    const prevValue = value - dayChange;
    return {
      holding: h,
      quote,
      cost,
      value,
      gain: round2(value - cost),
      gainPct: quote && cost > 0 ? (value - cost) / cost : null,
      dayChange,
      dayChangePct: quote && prevValue > 0 ? dayChange / prevValue : null,
      weight: 0
    };
  });
  const value = sum(base.map((r) => r.value));
  const cost = sum(base.map((r) => r.cost));
  const dayChange = sum(base.map((r) => r.dayChange));
  const rows = base
    .map((r) => ({ ...r, weight: value > 0 ? r.value / value : 0 }))
    .sort((a, b) => b.value - a.value);
  return {
    rows,
    cost,
    value,
    gain: round2(value - cost),
    gainPct: cost > 0 ? (value - cost) / cost : null,
    dayChange,
    dayChangePct: value - dayChange > 0 ? dayChange / (value - dayChange) : null,
    missing: rows.filter((r) => !r.quote).map((r) => r.holding.symbol)
  };
}

/** Snapshots on or after `fromISO`, oldest first. */
export function historySince(history: PortfolioSnapshot[], fromISO: string | null): PortfolioSnapshot[] {
  return history.filter((s) => !fromISO || s.id >= fromISO).sort((a, b) => a.id.localeCompare(b.id));
}

/** "+$12.34" / "-$5.00": the sign is always shown so color is never the only cue. */
export function signed(n: number, format: (v: number) => string): string {
  const r = round2(n);
  if (r === 0) return format(0);
  return `${r > 0 ? "+" : "-"}${format(Math.abs(r))}`;
}
