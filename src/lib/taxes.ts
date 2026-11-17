import { txPeriod } from "./calc";
import type { PeriodBudget, Settings, SubCategory, Transaction } from "./types";

/** The starting tax sub-category: by its id, or by name if it was recreated. */
export function findTaxesSub(subs: SubCategory[]): SubCategory | undefined {
  return subs.find((s) => s.id === "taxes") ?? subs.find((s) => s.name.trim().toLowerCase() === "taxes / estimated");
}

export interface TaxesSplit {
  subCategories: SubCategory[];
  periods: PeriodBudget[];
  transactions: Transaction[];
}

/**
 * Moves "Taxes / Estimated" out of Savings into its own Taxes group, from
 * `fromPeriod` on. Earlier pay periods are left as they were, so their totals
 * don't change. Returns only what changed.
 */
export function splitTaxes(settings: Settings, periods: Record<string, PeriodBudget>, transactions: Transaction[], fromPeriod: string): TaxesSplit {
  const sub = findTaxesSub(settings.subCategories);
  if (!sub) return { subCategories: settings.subCategories, periods: [], transactions: [] };
  return {
    subCategories: settings.subCategories.map((s) => (s.id === sub.id ? { ...s, category: "Taxes" } : s)),
    periods: Object.values(periods)
      .filter((p) => p.id >= fromPeriod && p.lineItems.some((li) => li.subId === sub.id && li.category !== "Taxes"))
      .map((p) => ({ ...p, lineItems: p.lineItems.map((li) => (li.subId === sub.id ? { ...li, category: "Taxes" as const } : li)) })),
    transactions: transactions
      .filter((t) => t.subId === sub.id && t.category !== "Taxes" && txPeriod(t) >= fromPeriod)
      .map((t) => ({ ...t, category: "Taxes" as const }))
  };
}
