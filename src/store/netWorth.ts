import { useEffect, useMemo, useRef } from "react";
import { useData } from "./data";
import { netWorthNow } from "../lib/netWorth";
import { readQuoteCache } from "../lib/marketData";
import { todayISO } from "../lib/periods";

const QUOTES_FRESH_MS = 3 * 24 * 60 * 60 * 1000;
const REWRITE_EVERY_MS = 10 * 60 * 1000;

/** Today's net worth, recomputed as data changes. */
export function useNetWorthToday() {
  const { settings, transactions, transfers, extraIncome, trades } = useData();
  return useMemo(() => {
    const cache = readQuoteCache();
    const fresh = !!cache && Date.now() - cache.fetchedAt < QUOTES_FRESH_MS;
    return netWorthNow(todayISO(), settings.accounts, transactions, transfers, extraIncome, trades, cache?.quotes ?? {}, fresh);
  }, [settings.accounts, transactions, transfers, extraIncome, trades]);
}

/**
 * Saves one net worth point per day for the history chart: when the day has
 * none yet, and again when it changes by a dollar or more (at most every few
 * minutes). Starts once any balance has been set or a stock is held.
 */
export function useNetWorthSnapshot() {
  const { loaded, settings, trades, netWorth, saveNetWorth } = useData();
  const today = useNetWorthToday();
  const lastWrite = useRef(0);
  const saved = netWorth.find((p) => p.id === today.id);
  const started = settings.accounts.some((a) => a.balanceSetAt > 0 || a.linkId) || trades.length > 0;

  useEffect(() => {
    if (!loaded || !started) return;
    const changed = !saved || Math.abs(saved.total - today.total) >= 1 || saved.investmentsEstimated !== today.investmentsEstimated;
    if (!changed || (saved && Date.now() - lastWrite.current < REWRITE_EVERY_MS)) return;
    lastWrite.current = Date.now();
    saveNetWorth(today);
  }, [loaded, started, saved, today, saveNetWorth]);
}
