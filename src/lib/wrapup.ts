import { round2, sum } from "./money";
import { computePeriod, txPeriod, type LineCalc } from "./calc";
import { periodRange, shiftPeriod } from "./periods";
import { excludedSubs } from "./insights";
import { contributedIn } from "./wishlist";
import type { ExtraIncome, NetWorthPoint, PeriodBudget, Settings, Transaction, WishList, WrapUp } from "./types";

/** The numbers behind the end-of-period recap. */
export interface WrapUpData {
  periodId: string;
  income: number;
  extraIncome: number;
  spent: number;
  planned: number;
  /** Income and extra income minus everything spent, including what went to savings. */
  leftover: number;
  /** Leftover not yet carried into the next period. Moves into savings already lower `leftover`. */
  leftToMove: number;
  groups: { category: string; planned: number; spent: number }[];
  over: { name: string; over: number }[];
  under: { name: string; under: number }[];
  topSpending: { name: string; spent: number }[];
  /** Everyday spending (not savings) compared with the period before. */
  vsPrevious: { spent: number; change: number; pct: number | null } | null;
  savedToGoals: { name: string; amount: number }[];
  netWorth: { start: number; end: number; change: number } | null;
}

export function buildWrapUp(
  periodId: string,
  periods: Record<string, PeriodBudget>,
  transactions: Transaction[],
  settings: Settings,
  extraIncome: ExtraIncome[],
  wishLists: WishList[],
  netWorth: NetWorthPoint[],
  wrap: WrapUp | null
): WrapUpData {
  const calc = computePeriod(periodId, periods, transactions, settings, extraIncome);
  const skip = excludedSubs(settings);
  const lines: LineCalc[] = Object.values(calc.groups).flatMap((g) => g.lines);
  const variable = lines.filter((l) => !skip.has(l.item.subId));
  const leftover = round2(calc.income + calc.extraIncome - calc.totalSpent);
  const carried = sum((wrap?.moves ?? []).filter((m) => m.kind === "carry").map((m) => m.amount));

  const prevId = shiftPeriod(periodId, -1);
  // Savings aren't spending here, so moving leftover into savings never looks like overspending.
  const spentIn = (p: string) => sum(transactions.filter((t) => txPeriod(t) === p && t.category !== "Savings").map((t) => t.amount));
  const prevSpent = spentIn(prevId);
  const thisSpent = spentIn(periodId);
  const { start, end } = periodRange(periodId);
  const inPeriod = [...netWorth].filter((p) => p.id >= start && p.id <= end).sort((a, b) => a.id.localeCompare(b.id));

  return {
    periodId,
    income: calc.income,
    extraIncome: calc.extraIncome,
    spent: calc.totalSpent,
    planned: round2(calc.totalBudgeted + calc.extraAllocated),
    leftover,
    leftToMove: round2(Math.max(0, leftover - carried)),
    groups: Object.values(calc.groups).map((g) => ({ category: g.category, planned: round2(g.budgeted + g.extra), spent: g.spent })),
    over: variable.filter((l) => l.remaining < 0).map((l) => ({ name: l.name, over: round2(-l.remaining) })).sort((a, b) => b.over - a.over),
    under: variable
      .filter((l) => l.spent > 0 && l.remaining > 0)
      .map((l) => ({ name: l.name, under: l.remaining }))
      .sort((a, b) => b.under - a.under)
      .slice(0, 3),
    topSpending: variable
      .filter((l) => l.spent > 0)
      .map((l) => ({ name: l.name, spent: l.spent }))
      .sort((a, b) => b.spent - a.spent)
      .slice(0, 5),
    vsPrevious: prevSpent > 0 ? { spent: prevSpent, change: round2(thisSpent - prevSpent), pct: (thisSpent - prevSpent) / prevSpent } : null,
    savedToGoals: wishLists.map((l) => ({ name: l.name, amount: contributedIn(l, transactions, periodId) })).filter((g) => g.amount > 0),
    netWorth: inPeriod.length >= 2 ? { start: inPeriod[0].total, end: inPeriod[inPeriod.length - 1].total, change: round2(inPeriod[inPeriod.length - 1].total - inPeriod[0].total) } : null
  };
}

/** The last day of a period, where a move of its leftover into savings is dated. */
export const periodEnd = (periodId: string) => periodRange(periodId).end;
/** The first day of the next period, where carried-over leftover lands as extra income. */
export const nextPeriodStart = (periodId: string) => periodRange(shiftPeriod(periodId, 1)).start;
