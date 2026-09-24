import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchHistory,
  fetchQuotes,
  MarketError,
  readHistoryCache,
  readQuoteCache,
  writeHistoryCache,
  writeQuoteCache,
  type CachedHistory,
  type CachedQuotes,
  type PricePoint
} from "../lib/marketData";
import { toISODate, todayISO } from "../lib/periods";
import type { Trade } from "../lib/types";

const QUOTE_STALE_MS = 60_000;
const RETRY_MS = 65_000; // the free plan's limit is per minute

/** How far back to load each stock: 5 years, or to its first trade if that is earlier. */
function neededStart(first: string | undefined): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 5);
  const fiveYears = toISODate(d);
  return first && first < fiveYears ? first : fiveYears;
}

/**
 * Live quotes for stocks still held and daily closes for every stock ever
 * traded. Both are cached on this device: quotes for a minute, past prices
 * for the day. Stays within Twelve Data's free limit by waiting a minute and
 * continuing when it is reached.
 */
export function useMarket(trades: Trade[], key: string, online: boolean) {
  const [quotes, setQuotes] = useState<CachedQuotes | null>(() => readQuoteCache());
  const [histories, setHistories] = useState<Record<string, CachedHistory | null>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ kind: MarketError["kind"]; message: string } | null>(null);
  const running = useRef(false);
  const again = useRef(false);
  const latestRun = useRef<(force?: boolean) => Promise<void>>();
  const retryTimer = useRef<ReturnType<typeof setTimeout>>();

  const { held: heldRaw, firstDates: firstRaw } = useMemo(() => {
    const shares: Record<string, number> = {};
    const first: Record<string, string> = {};
    for (const t of trades) {
      shares[t.symbol] = (shares[t.symbol] ?? 0) + (t.type === "buy" ? t.shares : -t.shares);
      if (!first[t.symbol] || t.date < first[t.symbol]) first[t.symbol] = t.date;
    }
    return { held: Object.keys(shares).filter((s) => shares[s] > 1e-6).sort(), firstDates: first };
  }, [trades]);
  // Stable values, so a sync that changes nothing relevant does not reload prices.
  const heldKey = heldRaw.join(",");
  const firstKey = JSON.stringify(Object.entries(firstRaw).sort());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const held = useMemo(() => heldRaw, [heldKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const firstDates = useMemo(() => firstRaw, [firstKey]);
  const allSymbols = useMemo(() => Object.keys(firstDates).sort(), [firstDates]);

  // Load cached past prices for every symbol as soon as it appears.
  useEffect(() => {
    setHistories((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const s of allSymbols) if (!(s in next)) { next[s] = readHistoryCache(s); changed = true; }
      return changed ? next : prev;
    });
  }, [allSymbols]);

  const run = useCallback(
    async (force = false) => {
      if (!key || !online) return;
      if (running.current) {
        again.current = true; // stocks changed mid-load: go again when this pass ends
        return;
      }
      running.current = true;
      clearTimeout(retryTimer.current);
      setLoading(true);
      setError(null);
      try {
        const cachedQuotes = readQuoteCache();
        const quotesStale = !cachedQuotes || Date.now() - cachedQuotes.fetchedAt > QUOTE_STALE_MS;
        const missingQuote = held.filter((s) => !(s in (cachedQuotes?.quotes ?? {})));
        if (held.length && (force || quotesStale || missingQuote.length)) {
          const fresh = await fetchQuotes(held, key);
          const next = { fetchedAt: Date.now(), quotes: { ...cachedQuotes?.quotes, ...fresh } };
          writeQuoteCache(next);
          setQuotes(next);
        }
        const today = todayISO();
        for (const s of allSymbols) {
          const start = neededStart(firstDates[s]);
          const c = readHistoryCache(s);
          if (c && c.fetchedOn === today && c.start <= start) continue;
          const points = await fetchHistory(s, start, key);
          const entry: CachedHistory = { fetchedOn: today, start, points };
          writeHistoryCache(s, entry);
          setHistories((h) => ({ ...h, [s]: entry }));
        }
      } catch (e) {
        const err = e instanceof MarketError ? e : new MarketError("network", "Could not load prices.");
        setError({ kind: err.kind, message: err.message });
        if (err.kind === "rate-limit" && !/tomorrow/.test(err.message)) {
          retryTimer.current = setTimeout(() => void latestRun.current?.(), RETRY_MS);
        }
      } finally {
        running.current = false;
        setLoading(false);
        if (again.current) {
          again.current = false;
          void latestRun.current?.();
        }
      }
    },
    [key, online, held, allSymbols, firstDates]
  );

  latestRun.current = run;
  useEffect(() => {
    void run();
    return () => clearTimeout(retryTimer.current);
  }, [run]);

  const priceHistory = useMemo(() => {
    const out: Record<string, PricePoint[] | null> = {};
    for (const [s, c] of Object.entries(histories)) out[s] = c?.points ?? null;
    return out;
  }, [histories]);

  const quoteMap = useMemo(() => quotes?.quotes ?? {}, [quotes]);

  return {
    quotes: quoteMap,
    fetchedAt: quotes?.fetchedAt ?? null,
    histories: priceHistory,
    /** Symbols whose past prices came back "not found". */
    unknownHistory: Object.entries(histories).filter(([, c]) => c && c.points === null).map(([s]) => s),
    loading,
    error,
    refresh: () => run(true)
  };
}
