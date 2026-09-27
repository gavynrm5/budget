import { round2, sum } from "./money";
import { computePeriod, txPeriod, type LineCalc } from "./calc";
import { dayOfPeriod, daysInPeriod, periodName, shiftPeriod } from "./periods";
import { contributedIn, listSummary } from "./wishlist";
import type { ExtraIncome, PeriodBudget, Settings, Transaction, WishItem, WishList } from "./types";

/**
 * Spending facts for the current pay period, worked out on the device. The
 * AI only turns these into tips; every number in a tip comes from here.
 * Fixed bills and Savings & Debt lines are left out, as the user asked.
 */

export type Fact =
  | { kind: "over"; id: string; subId: string; name: string; spent: number; available: number; over: number }
  | { kind: "pace"; id: string; subId: string; name: string; spent: number; available: number; projected: number; overBy: number; perDayToStay: number; daysLeft: number }
  | { kind: "trend"; id: string; subId: string; name: string; direction: "up" | "down"; spentSoFar: number; usualByNow: number; changePct: number; periodsCompared: number }
  | { kind: "habit"; id: string; merchant: string; count: number; total: number; average: number; subName: string }
  | { kind: "subscriptions"; id: string; items: { name: string; amount: number }[]; perMonth: number }
  | { kind: "goal"; id: string; listName: string; left: number; savingPerPeriod: number; periodsAtCurrentPace: number | null; cut: number; cutFrom: string; periodsWithCut: number; periodsSooner: number | null };

export interface SpendRow {
  subId: string;
  name: string;
  spent: number;
  available: number;
  usualByNow: number | null;
}

export interface InsightsData {
  periodId: string;
  periodLabel: string;
  day: number;
  daysTotal: number;
  daysLeft: number;
  facts: Fact[];
  /** Variable spending this period by sub-category, biggest first. */
  spending: SpendRow[];
  /** Earlier periods with any spending that "usual" is based on. */
  history: string[];
}

export interface InsightsInput {
  periodId: string;
  today: string;
  periods: Record<string, PeriodBudget>;
  transactions: Transaction[];
  settings: Settings;
  extraIncome: ExtraIncome[];
  wishLists: WishList[];
  wishlist: WishItem[];
}

const norm = (s: string) => s.trim().toLowerCase();

/** Groups "STARBUCKS #1234" and "Starbucks" together. */
export function merchantKey(desc: string): string {
  return norm(desc).replace(/[#*]\s*\d+/g, "").replace(/\d{3,}/g, "").replace(/[^a-z& ]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Sub-categories tips never cover: fixed bills (matched by name) and anything under Savings & Debt. */
export function excludedSubs(settings: Settings): Set<string> {
  const fixed = new Set(settings.fixedExpenses.map((f) => norm(f.name)));
  return new Set(settings.subCategories.filter((s) => s.category === "Savings" || fixed.has(norm(s.name))).map((s) => s.id));
}

export function buildInsights(input: InsightsInput): InsightsData {
  const { periodId, today, periods, transactions, settings, extraIncome, wishLists, wishlist } = input;
  const skip = excludedSubs(settings);
  const variable = (t: Transaction) => !skip.has(t.subId) && t.category !== "Savings";
  const daysTotal = daysInPeriod(periodId);
  const day = Math.max(1, Math.min(daysTotal, dayOfPeriod(periodId, today)));
  const daysLeft = daysTotal - day;
  const elapsed = day / daysTotal;
  const calc = computePeriod(periodId, periods, transactions, settings, extraIncome);
  const lines: LineCalc[] = Object.values(calc.groups).flatMap((g) => g.lines).filter((l) => !skip.has(l.item.subId) && l.item.category !== "Savings");
  const subName = (id: string) => settings.subCategories.find((s) => s.id === id)?.name ?? "Other";
  const facts: Fact[] = [];

  // Up to 3 earlier periods that have spending, looking back at most 6.
  const history: string[] = [];
  for (let p = shiftPeriod(periodId, -1), i = 0; i < 6 && history.length < 3; p = shiftPeriod(p, -1), i++) {
    if (transactions.some((t) => txPeriod(t) === p)) history.push(p);
  }
  /** Average spent on a sub in earlier periods by the same day of the period. */
  const usualByDay = (subId: string, byDay: number): number | null => {
    if (!history.length) return null;
    const per = history.map((p) =>
      sum(transactions.filter((t) => t.subId === subId && txPeriod(t) === p && dayOfPeriod(p, t.date) <= byDay).map((t) => t.amount))
    );
    return round2(sum(per) / history.length);
  };

  // Repeating charges (subscriptions): the same place and about the same amount in 2 or more of the last 3 periods.
  const recent = [periodId, ...history.slice(0, 2)];
  const recurring = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (!variable(t) || !recent.includes(txPeriod(t)) || t.amount > 100) continue;
    const k = merchantKey(t.description);
    if (k) recurring.set(k, [...(recurring.get(k) ?? []), t]);
  }
  const subs = [...recurring.values()]
    .filter((list) => {
      const inPeriods = new Set(list.map(txPeriod));
      const amounts = list.map((t) => t.amount);
      // Subscriptions bill once a period, for about the same amount, on about the same day of the month.
      const days = list.map((t) => Number(t.date.slice(8, 10)));
      const spread = Math.max(...days) - Math.min(...days);
      return (
        inPeriods.size >= 2 &&
        list.length === inPeriods.size &&
        Math.max(...amounts) <= Math.min(...amounts) * 1.15 &&
        (spread <= 4 || spread >= 27) // allows month-end wraparound like the 30th then the 1st
      );
    })
    .map((list) => ({ name: list[list.length - 1].description.trim(), amount: list.sort((a, b) => b.date.localeCompare(a.date))[0].amount }))
    .sort((a, b) => b.amount - a.amount);
  const recurringKeys = new Set(subs.map((x) => merchantKey(x.name)));
  const isRecurring = (t: Transaction) => recurringKeys.has(merchantKey(t.description));

  // Over budget already, or on pace to be. Repeating charges count once; only everyday spending is projected.
  for (const l of lines) {
    if (l.available <= 0) continue;
    if (l.spent > l.available) {
      facts.push({ kind: "over", id: `over:${l.item.subId}`, subId: l.item.subId, name: l.name, spent: l.spent, available: l.available, over: round2(l.spent - l.available) });
      continue;
    }
    if (day < 3 || l.spent <= 0) continue; // too early to call a pace
    const lineTx = calc.transactions.filter((t) => t.subId === l.item.subId);
    const fixedPart = sum(lineTx.filter(isRecurring).map((t) => t.amount));
    const projected = round2(fixedPart + (l.spent - fixedPart) / elapsed);
    const overBy = round2(projected - l.available);
    if (projected > l.available * 1.1 && overBy >= 15) {
      facts.push({
        kind: "pace",
        id: `pace:${l.item.subId}`,
        subId: l.item.subId,
        name: l.name,
        spent: l.spent,
        available: l.available,
        projected,
        overBy,
        perDayToStay: round2(daysLeft > 0 ? (l.available - l.spent) / daysLeft : 0),
        daysLeft
      });
    }
  }

  // Compared with the usual by this point in the period.
  const txs = calc.transactions.filter(variable);
  const bySub = new Map<string, number>();
  txs.forEach((t) => bySub.set(t.subId, (bySub.get(t.subId) ?? 0) + t.amount));
  const allSubs = new Set([...bySub.keys(), ...lines.map((l) => l.item.subId)]);
  const spending: SpendRow[] = [];
  for (const subId of allSubs) {
    const spent = round2(bySub.get(subId) ?? 0);
    const usual = usualByDay(subId, day);
    const line = lines.find((l) => l.item.subId === subId);
    if (spent > 0 || (usual ?? 0) > 0) spending.push({ subId, name: subName(subId), spent, available: line?.available ?? 0, usualByNow: usual });
    if (usual == null) continue;
    if (spent >= 25 && spent > usual * 1.3 && spent - usual >= 20) {
      facts.push({ kind: "trend", id: `trend-up:${subId}`, subId, name: subName(subId), direction: "up", spentSoFar: spent, usualByNow: usual, changePct: usual > 0 ? Math.round(((spent - usual) / usual) * 100) : 100, periodsCompared: history.length });
    } else if (usual >= 50 && spent < usual * 0.7) {
      facts.push({ kind: "trend", id: `trend-down:${subId}`, subId, name: subName(subId), direction: "down", spentSoFar: spent, usualByNow: usual, changePct: Math.round(((spent - usual) / usual) * 100), periodsCompared: history.length });
    }
  }
  spending.sort((a, b) => b.spent - a.spent);

  // Repeat purchases at the same place this period.
  const byMerchant = new Map<string, Transaction[]>();
  for (const t of txs) {
    const k = merchantKey(t.description);
    if (k) byMerchant.set(k, [...(byMerchant.get(k) ?? []), t]);
  }
  [...byMerchant.values()]
    .filter((list) => list.length >= 3)
    .map((list) => ({ list, total: sum(list.map((t) => t.amount)) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 3)
    .forEach(({ list, total }) =>
      facts.push({
        kind: "habit",
        id: `habit:${merchantKey(list[0].description)}`,
        merchant: list[list.length - 1].description.trim(),
        count: list.length,
        total,
        average: round2(total / list.length),
        subName: subName(list[0].subId)
      })
    );

  if (subs.length >= 2 || sum(subs.map((s) => s.amount)) >= 20) {
    facts.push({ kind: "subscriptions", id: `subs:${subs.map((s) => merchantKey(s.name)).sort().join(",")}`, items: subs, perMonth: sum(subs.map((s) => s.amount)) });
  }

  // How a small cut would speed up each goal. Pay periods here are monthly.
  const discretionary = [...facts.filter((f): f is Extract<Fact, { kind: "pace" | "over" }> => f.kind === "pace" || f.kind === "over")];
  const topWant = spending.find((s) => settings.subCategories.find((x) => x.id === s.subId)?.category === "Wants" && (s.usualByNow ?? s.spent) > 0);
  for (const l of wishLists) {
    const s = listSummary(l, wishlist, transactions, periodId);
    if (s.left <= 0) continue;
    const lastThree = [shiftPeriod(periodId, -1), shiftPeriod(periodId, -2), shiftPeriod(periodId, -3)];
    const fundLine = l.subId ? Object.values(calc.groups).flatMap((g) => g.lines).find((x) => x.item.subId === l.subId) : undefined;
    const rate = round2(Math.max(sum(lastThree.map((p) => contributedIn(l, transactions, p))) / 3, fundLine?.item.budgeted ?? 0));
    const source = discretionary[0] ?? null;
    const base = source ? ("overBy" in source ? source.overBy : source.over) : topWant ? topWant.spent * 0.15 : 0;
    const cut = Math.max(20, Math.round(base / 5) * 5);
    const cutFrom = source ? source.name : topWant?.name ?? "dining and shopping";
    const periodsNow = rate > 0 ? Math.ceil(s.left / rate) : null;
    const periodsWithCut = Math.ceil(s.left / (rate + cut));
    facts.push({
      kind: "goal",
      id: `goal:${l.id}`,
      listName: l.name,
      left: s.left,
      savingPerPeriod: rate,
      periodsAtCurrentPace: periodsNow,
      cut,
      cutFrom,
      periodsWithCut,
      periodsSooner: periodsNow == null ? null : periodsNow - periodsWithCut
    });
  }

  return { periodId, periodLabel: periodName(periodId, true), day, daysTotal, daysLeft, facts, spending, history };
}

const PRIORITY: Record<Fact["kind"], number> = { over: 0, pace: 1, trend: 2, habit: 3, goal: 4, subscriptions: 5 };
export const sortFacts = (facts: Fact[]) =>
  [...facts].sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] + (a.kind === "trend" && a.direction === "down" ? 10 : 0) - (b.kind === "trend" && b.direction === "down" ? 10 : 0));

export type TipTone = "warning" | "nudge" | "praise";

export interface Tip {
  id: string;
  factIds: string[];
  title: string;
  body: string;
  tone: TipTone;
  /** Rough dollars a period this could save, when it applies. */
  savings: number | null;
}

const $ = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const monthsText = (n: number) => `${n} ${n === 1 ? "month" : "months"}`;

/** Tips saved for a pay period, so they aren't regenerated (and paid for) on every visit. */
export interface InsightsCache {
  periodId: string;
  /** factsKey() of the facts the tips were written from. */
  key: string;
  generatedAt: number;
  source: "ai" | "rules";
  tips: Tip[];
  /** Fact ids the user dismissed with "Got it" this period. */
  dismissed: string[];
}

/** Plain tips straight from the facts, used without an AI key or when the AI call fails. */
export function ruleTips(facts: Fact[]): Tip[] {
  return sortFacts(facts).map((f) => tipFor(f)).map((t) => ({ ...t, savings: t.savings != null ? Math.round(t.savings) : null }));
}

function tipFor(f: Fact): Tip {
  {
    switch (f.kind) {
      case "over":
        return { id: f.id, factIds: [f.id], tone: "warning", savings: f.over, title: `${f.name} is ${$(f.over)} over`, body: `You've spent ${$(f.spent)} of ${$(f.available)}. Hold off here for the rest of the period, or cover it with extra income.` };
      case "pace":
        return { id: f.id, factIds: [f.id], tone: "warning", savings: f.overBy, title: `${f.name} is on pace to go over`, body: `At this rate it reaches about ${$(f.projected)} by the end of the period, ${$(f.overBy)} over. Keep it under ${$(f.perDayToStay)} a day for the next ${f.daysLeft} days to stay on budget.` };
      case "trend":
        return f.direction === "up"
          ? { id: f.id, factIds: [f.id], tone: "nudge", savings: round2(f.spentSoFar - f.usualByNow), title: `${f.name} is up ${f.changePct}%`, body: `${$(f.spentSoFar)} so far, compared with about ${$(f.usualByNow)} by this point usually.` }
          : { id: f.id, factIds: [f.id], tone: "praise", savings: null, title: `${f.name} is down ${Math.abs(f.changePct)}%`, body: `${$(f.spentSoFar)} so far versus about ${$(f.usualByNow)} usually by now. Nice work.` };
      case "habit":
        return { id: f.id, factIds: [f.id], tone: "nudge", savings: round2(f.total / 2), title: `${f.count} trips to ${f.merchant}`, body: `${$(f.total)} this period, about ${$(f.average)} each. Cutting that in half would save around ${$(f.total / 2)}.` };
      case "subscriptions":
        return { id: f.id, factIds: [f.id], tone: "nudge", savings: null, title: `${f.items.length} repeating charges, ${$(f.perMonth)} a month`, body: `${f.items.map((i) => `${i.name} ${$(i.amount)}`).join(", ")}. Worth checking you still use each one.` };
      case "goal":
        return {
          id: f.id,
          factIds: [f.id],
          tone: "nudge",
          savings: f.cut,
          title: `Reach ${f.listName} sooner`,
          body:
            f.periodsSooner != null && f.periodsSooner > 0
              ? `Moving ${$(f.cut)} a month from ${f.cutFrom} into it gets you there in ${monthsText(f.periodsWithCut)} instead of ${monthsText(f.periodsAtCurrentPace!)}.`
              : `${$(f.left)} to go. Setting aside ${$(f.cut)} a month from ${f.cutFrom} would get you there in about ${monthsText(f.periodsWithCut)}.`
        };
    }
  }
}

/** A short fingerprint of the facts, so tips are only rewritten when something changed. */
export function factsKey(data: InsightsData): string {
  const s = JSON.stringify(data.facts.map((f) => [f.id, Math.round(("spent" in f ? f.spent : "total" in f ? f.total : "left" in f ? f.left : "perMonth" in f ? f.perMonth : 0) / 10)]));
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `${data.periodId}:${(h >>> 0).toString(36)}`;
}
