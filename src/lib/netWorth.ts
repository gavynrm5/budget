import { round2, sum } from "./money";
import { computeBalances, isCredit } from "./accounts";
import { buildPositions } from "./portfolio";
import type { Quote } from "./marketData";
import type { Account, ExtraIncome, NetWorthPoint, Trade, Transaction, Transfer } from "./types";

/**
 * Net worth right now: cash in bank accounts, minus what's owed on cards, plus
 * stocks at their latest known price. Stocks without a recent price count at
 * what was paid, and the point is marked estimated.
 */
export function netWorthNow(
  day: string,
  accounts: Account[],
  txs: Transaction[],
  transfers: Transfer[],
  extras: ExtraIncome[],
  trades: Trade[],
  quotes: Record<string, Quote | null>,
  quotesFresh: boolean
): NetWorthPoint {
  const bal = computeBalances(accounts, txs, transfers, extras);
  const active = accounts.filter((a) => !a.archived);
  const cash = sum(active.filter((a) => !isCredit(a)).map((a) => bal[a.id] ?? 0));
  const owed = sum(active.filter(isCredit).map((a) => bal[a.id] ?? 0));
  let estimated = false;
  const investments = sum(
    Object.values(buildPositions(trades))
      .filter((p) => p.shares > 0)
      .map((p) => {
        const q = quotesFresh ? quotes[p.symbol] : null;
        if (!q) estimated = true;
        return round2(p.shares * (q?.price ?? p.avgCost));
      })
  );
  return { id: day, cash, owed, investments, total: round2(cash - owed + investments), investmentsEstimated: estimated };
}

/** Change between the first point on or after `from` and the latest point. */
export function netWorthChange(points: NetWorthPoint[], from: string): { start: NetWorthPoint; end: NetWorthPoint; change: number } | null {
  const sorted = [...points].sort((a, b) => a.id.localeCompare(b.id));
  const start = sorted.find((p) => p.id >= from);
  const end = sorted[sorted.length - 1];
  if (!start || !end || start.id === end.id) return null;
  return { start, end, change: round2(end.total - start.total) };
}
