import { round2, sum } from "./money";
import { txPeriod } from "./calc";
import type { Settings, Transaction } from "./types";

export interface SearchFilters {
  text: string;
  from: string | null; // YYYY-MM-DD
  to: string | null;
  category: string | "all";
  accountId: string | "all" | "none";
}

/**
 * Transactions matching every word typed, in the description, notes, or
 * sub-category name. A number matches the amount too ("42.18" or "$42").
 */
export function searchTransactions(txs: Transaction[], settings: Settings, f: SearchFilters): Transaction[] {
  const subName = new Map(settings.subCategories.map((s) => [s.id, s.name.toLowerCase()]));
  const words = f.text.toLowerCase().split(/\s+/).map((w) => w.replace(/^\$/, "")).filter(Boolean);
  return txs
    .filter((t) => {
      if (f.from && t.date < f.from) return false;
      if (f.to && t.date > f.to) return false;
      if (f.category !== "all" && t.category !== f.category) return false;
      if (f.accountId === "none" ? !!t.accountId : f.accountId !== "all" && t.accountId !== f.accountId) return false;
      const hay = `${t.description} ${t.notes} ${subName.get(t.subId) ?? ""}`.toLowerCase();
      return words.every((w) => {
        const n = Number(w.replace(/,/g, ""));
        if (w && Number.isFinite(n) && /^[\d.,]+$/.test(w)) return hay.includes(w) || Math.abs(t.amount - n) < 0.005 || Math.floor(t.amount) === n;
        return hay.includes(w);
      });
    })
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/** Totals per pay period for a result list, oldest first. */
export function byPeriod(txs: Transaction[]): { periodId: string; total: number; count: number }[] {
  const m = new Map<string, { total: number; count: number }>();
  for (const t of txs) {
    const p = txPeriod(t);
    const cur = m.get(p) ?? { total: 0, count: 0 };
    m.set(p, { total: cur.total + t.amount, count: cur.count + 1 });
  }
  return [...m.entries()].map(([periodId, v]) => ({ periodId, total: round2(v.total), count: v.count })).sort((a, b) => a.periodId.localeCompare(b.periodId));
}

export const totalOf = (txs: Transaction[]) => sum(txs.map((t) => t.amount));
