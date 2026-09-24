/**
 * Stock prices from Twelve Data's free plan (https://twelvedata.com): live
 * quotes and daily closing prices, callable straight from the browser.
 * The free plan allows 8 credits a minute and 800 a day; each symbol in a
 * request costs 1 credit, so prices are cached on this device.
 */
const BASE = "https://api.twelvedata.com";

export interface Quote {
  name: string;
  price: number;
  change: number; // dollars since the previous close
  prevClose: number;
  marketOpen: boolean;
  time: number; // unix seconds of the last quote
}

/** One trading day: [YYYY-MM-DD, closing price]. Oldest first. */
export type PricePoint = [string, number];

export class MarketError extends Error {
  constructor(
    public kind: "bad-key" | "rate-limit" | "network",
    message: string
  ) {
    super(message);
  }
}

interface TdError {
  code?: number;
  message?: string;
  status?: string;
}

function isError(x: unknown): x is TdError {
  return !!x && typeof x === "object" && (x as TdError).status === "error";
}

/** Throws for problems that affect the whole request. Returns true for "symbol not found". */
function checkError(e: TdError): true {
  const msg = e.message ?? "";
  if (e.code === 401 || e.code === 403) {
    if (/grow|pro|plan|upgrade/i.test(msg)) return true; // symbol not on the free plan
    throw new MarketError("bad-key", "Twelve Data rejected the API key.");
  }
  if (e.code === 429) {
    throw new MarketError(
      "rate-limit",
      /day|daily/i.test(msg) ? "Used today's free price requests. Prices pick up again tomorrow." : "Too many price requests. Waiting a minute to load the rest."
    );
  }
  if (e.code === 400 || e.code === 404) return true;
  throw new MarketError("network", msg || "The price service returned an error.");
}

async function get(path: string, params: Record<string, string>, key: string): Promise<unknown> {
  const qs = new URLSearchParams({ ...params, apikey: key });
  let res: Response;
  try {
    res = await fetch(`${BASE}/${path}?${qs}`);
  } catch {
    throw new MarketError("network", "Could not reach the price service.");
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new MarketError("network", `The price service returned an error (${res.status}).`);
  }
  if (isError(body)) {
    // A top-level "not found" only happens for single-symbol requests.
    checkError(body);
    return null;
  }
  if (!res.ok) throw new MarketError("network", `The price service returned an error (${res.status}).`);
  return body;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function toQuote(q: Record<string, unknown>): Quote | null {
  const price = num(q.close);
  if (!price) return null;
  return {
    name: String(q.name ?? ""),
    price,
    change: num(q.change),
    prevClose: num(q.previous_close),
    marketOpen: q.is_market_open === true,
    time: num(q.last_quote_at) || num(q.timestamp)
  };
}

/** Latest quote for each symbol, null for symbols Twelve Data does not know. One request. */
export async function fetchQuotes(symbols: string[], key: string): Promise<Record<string, Quote | null>> {
  if (!symbols.length) return {};
  const body = await get("quote", { symbol: symbols.join(",") }, key);
  const out: Record<string, Quote | null> = Object.fromEntries(symbols.map((s) => [s, null]));
  if (!body) return out;
  // One symbol returns the quote itself; several return { SYMBOL: quote }.
  const bySymbol = (symbols.length === 1 ? { [symbols[0]]: body } : body) as Record<string, unknown>;
  for (const s of symbols) {
    const q = bySymbol[s];
    if (!q) continue;
    if (isError(q)) {
      checkError(q);
      continue;
    }
    out[s] = toQuote(q as Record<string, unknown>);
  }
  return out;
}

/** Daily closing prices from `start` (YYYY-MM-DD) through today, oldest first. Null if unknown. */
export async function fetchHistory(symbol: string, start: string, key: string): Promise<PricePoint[] | null> {
  const body = (await get("time_series", { symbol, interval: "1day", start_date: start, outputsize: "5000", order: "asc" }, key)) as {
    values?: { datetime: string; close: string }[];
  } | null;
  if (!body?.values) return null;
  return body.values.map((v) => [v.datetime.slice(0, 10), num(v.close)] as PricePoint).filter(([, c]) => c > 0);
}

// ---------- device cache ----------

export interface CachedQuotes {
  fetchedAt: number;
  quotes: Record<string, Quote | null>;
}

export interface CachedHistory {
  fetchedOn: string; // local date it was downloaded
  start: string;
  points: PricePoint[] | null; // null: symbol not found
}

function read<T>(k: string): T | null {
  try {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage full or blocked; prices just won't survive a reload */
  }
}

const QUOTES_KEY = "td-quotes";
const histKey = (symbol: string) => `td-history-${symbol}`;

export const readQuoteCache = () => read<CachedQuotes>(QUOTES_KEY);
export const writeQuoteCache = (c: CachedQuotes) => write(QUOTES_KEY, c);
export const readHistoryCache = (symbol: string) => read<CachedHistory>(histKey(symbol));
export const writeHistoryCache = (symbol: string, c: CachedHistory) => write(histKey(symbol), c);

/** Closing price on `date`, or the last close before it. Points must be oldest first. */
export function closeOn(points: PricePoint[] | null | undefined, date: string): number | null {
  if (!points?.length || points[0][0] > date) return null;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid][0] <= date) lo = mid;
    else hi = mid - 1;
  }
  return points[lo][1];
}
