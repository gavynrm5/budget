import { round2, sum } from "./money";
import { periodOfDate, shiftPeriod } from "./periods";
import { seedLineItems } from "./defaults";
import { CATEGORIES } from "./types";
import type { Category, LineItem, PeriodBudget, Settings, SubCategory, Transaction } from "./types";

export type Status = "over" | "near" | "ok";

export function statusFor(pctUsed: number | null): Status {
  if (pctUsed === null) return "ok";
  if (pctUsed > 1) return "over";
  if (pctUsed > 0.85) return "near";
  return "ok";
}

export function totalIncome(s: Settings): number {
  return round2(s.takeHomeIncome + s.otherIncome);
}

export function txPeriod(tx: Transaction): string {
  return tx.periodOverride || periodOfDate(tx.date);
}

/**
 * The budget for a period. If none is saved yet, it is a copy of the most
 * recent saved period before it (or the seed defaults), marked virtual.
 */
export function resolveBudget(
  periodId: string,
  periods: Record<string, PeriodBudget>,
  settings: Settings
): { lineItems: LineItem[]; virtual: boolean } {
  const saved = periods[periodId];
  if (saved) return { lineItems: saved.lineItems, virtual: false };
  const earlier = Object.keys(periods).filter((p) => p < periodId).sort();
  const source = earlier.length ? periods[earlier[earlier.length - 1]] : null;
  return { lineItems: source ? source.lineItems.map((li) => ({ ...li })) : seedLineItems(settings), virtual: true };
}

export interface LineCalc {
  item: LineItem;
  name: string;
  targetPct: number | null;
  spent: number;
  remaining: number;
  pctUsed: number | null; // null shows "-"
  status: Status;
}

export interface GroupCalc {
  category: Category;
  lines: LineCalc[];
  /** Spending in this group on sub-categories that have no line this period. */
  unbudgeted: { subId: string; name: string; spent: number }[];
  budgeted: number;
  targetPct: number | null;
  targetAmount: number;
  spent: number;
  remaining: number;
  pctUsed: number;
  status: Status;
}

export interface PeriodCalc {
  periodId: string;
  income: number;
  groups: Record<Category, GroupCalc>;
  totalBudgeted: number;
  totalSpent: number;
  totalRemaining: number;
  totalPctUsed: number;
  totalStatus: Status;
  unallocated: number;
  leftFromIncome: number;
  transactions: Transaction[];
  virtual: boolean;
}

export function subName(subs: SubCategory[], id: string): string {
  return subs.find((s) => s.id === id)?.name ?? "Unknown";
}

export function computePeriod(
  periodId: string,
  periods: Record<string, PeriodBudget>,
  transactions: Transaction[],
  settings: Settings
): PeriodCalc {
  const income = totalIncome(settings);
  const { lineItems, virtual } = resolveBudget(periodId, periods, settings);
  const txs = transactions.filter((t) => txPeriod(t) === periodId);

  const groups = {} as Record<Category, GroupCalc>;
  for (const category of CATEGORIES) {
    const items = lineItems.filter((li) => li.category === category);
    const lines: LineCalc[] = items.map((item) => {
      const spent = sum(txs.filter((t) => t.subId === item.subId).map((t) => t.amount));
      const pctUsed = item.budgeted === 0 ? null : spent / item.budgeted;
      return {
        item,
        name: subName(settings.subCategories, item.subId),
        targetPct: income === 0 ? null : item.budgeted / income,
        spent,
        remaining: round2(item.budgeted - spent),
        pctUsed,
        status: statusFor(pctUsed)
      };
    });
    const groupTx = txs.filter((t) => t.category === category);
    const budgeted = sum(items.map((i) => i.budgeted));
    const spent = sum(groupTx.map((t) => t.amount));
    const lineSubs = new Set(lineItems.map((li) => li.subId));
    const unbMap = new Map<string, number>();
    groupTx.filter((t) => !lineSubs.has(t.subId)).forEach((t) => unbMap.set(t.subId, (unbMap.get(t.subId) ?? 0) + t.amount));
    const pctUsed = budgeted === 0 ? 0 : spent / budgeted;
    groups[category] = {
      category,
      lines,
      unbudgeted: [...unbMap].map(([subId, v]) => ({ subId, name: subName(settings.subCategories, subId), spent: round2(v) })),
      budgeted,
      targetPct: income === 0 ? null : budgeted / income,
      targetAmount: round2((income * settings.targets[category]) / 100),
      spent,
      remaining: round2(budgeted - spent),
      pctUsed,
      status: statusFor(pctUsed)
    };
  }

  const totalBudgeted = sum(lineItems.map((li) => li.budgeted));
  const totalSpent = sum(txs.map((t) => t.amount));
  const totalPctUsed = totalBudgeted === 0 ? 0 : totalSpent / totalBudgeted;
  return {
    periodId,
    income,
    groups,
    totalBudgeted,
    totalSpent,
    totalRemaining: round2(totalBudgeted - totalSpent),
    totalPctUsed,
    totalStatus: statusFor(totalPctUsed),
    unallocated: round2(income - totalBudgeted),
    leftFromIncome: round2(income - totalSpent),
    transactions: txs,
    virtual
  };
}

/**
 * Sub-categories offered for a category in a given period: the period's own
 * lines placed in that category first, then other active subs whose default
 * category matches and are not placed elsewhere this period.
 */
export function subsForCategory(
  category: Category,
  lineItems: LineItem[],
  subs: SubCategory[]
): SubCategory[] {
  const byId = new Map(subs.map((s) => [s.id, s]));
  const placed = lineItems.filter((li) => li.category === category).map((li) => byId.get(li.subId)).filter(Boolean) as SubCategory[];
  const placedElsewhere = new Set(lineItems.filter((li) => li.category !== category).map((li) => li.subId));
  const placedHere = new Set(placed.map((s) => s.id));
  const rest = subs
    .filter((s) => !s.archived && s.category === category && !placedHere.has(s.id) && !placedElsewhere.has(s.id))
    .sort((a, b) => a.order - b.order);
  return [...placed, ...rest];
}

export function periodsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let p = from;
  while (p <= to) { out.push(p); p = shiftPeriod(p, 1); }
  return out;
}
