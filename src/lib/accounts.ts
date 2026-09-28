import { round2 } from "./money";
import { parseISO, toISODate } from "./periods";
import type { Account, ExtraIncome, Transaction, Transfer } from "./types";

/** "Local checking", "Main card", "Savings": the nickname plus its kind, unless the name already says it. */
export function accountLabel(a: Pick<Account, "name" | "kind">): string {
  const kind = a.kind === "credit" ? "card" : a.kind;
  return a.name.toLowerCase().includes(kind) ? a.name : `${a.name} ${kind}`;
}

export const isCredit = (a: Pick<Account, "kind">) => a.kind === "credit";

/** Only active accounts, in display order. */
export function activeAccounts(accounts: Account[]): Account[] {
  return accounts.filter((a) => !a.archived).sort((x, y) => x.order - y.order);
}

export interface AccountEntry {
  id: string;
  kind: "spending" | "income" | "transfer-in" | "transfer-out";
  date: string;
  text: string;
  /** Effect on the shown balance: + raises it. For a card, the balance is what is owed. */
  delta: number;
  /** False when it was logged before the balance was last set, so it's already included. */
  counted: boolean;
}

/**
 * Everything that touched an account, newest first, with its effect on the
 * balance. For bank accounts spending lowers the balance; for cards it raises
 * the amount owed, and a payment (transfer in) lowers it.
 */
export function accountEntries(
  account: Account,
  txs: Transaction[],
  transfers: Transfer[],
  extras: ExtraIncome[],
  subName: (id: string) => string,
  nameOf: (id: string) => string
): AccountEntry[] {
  const credit = isCredit(account);
  const setDay = toISODate(new Date(account.balanceSetAt));
  const counts = (date: string, createdAt?: number) => (createdAt ?? 0) > account.balanceSetAt && date >= setDay;
  const out: AccountEntry[] = [];
  for (const t of txs) {
    if (t.accountId !== account.id) continue;
    out.push({
      id: t.id,
      kind: "spending",
      date: t.date,
      text: t.description || subName(t.subId),
      delta: credit ? t.amount : -t.amount,
      counted: counts(t.date, t.createdAt)
    });
  }
  for (const x of extras) {
    if (x.accountId !== account.id) continue;
    out.push({ id: x.id, kind: "income", date: x.date, text: x.source || "Extra income", delta: credit ? -x.amount : x.amount, counted: counts(x.date, x.createdAt) });
  }
  for (const tr of transfers) {
    if (tr.fromId === account.id) {
      out.push({ id: tr.id + ":out", kind: "transfer-out", date: tr.date, text: `To ${nameOf(tr.toId)}`, delta: credit ? tr.amount : -tr.amount, counted: counts(tr.date, tr.createdAt) });
    }
    if (tr.toId === account.id) {
      out.push({ id: tr.id + ":in", kind: "transfer-in", date: tr.date, text: `From ${nameOf(tr.fromId)}`, delta: credit ? -tr.amount : tr.amount, counted: counts(tr.date, tr.createdAt) });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** Current balance of every account: the balance last set plus what was logged after it. */
export function computeBalances(accounts: Account[], txs: Transaction[], transfers: Transfer[], extras: ExtraIncome[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of accounts) {
    const entries = accountEntries(a, txs, transfers, extras, () => "", () => "");
    out[a.id] = round2(a.balance + entries.filter((e) => e.counted).reduce((s, e) => s + e.delta, 0));
  }
  return out;
}

/** Share of a card's limit in use, or null with no limit. */
export function utilization(a: Account, owed: number): number | null {
  return a.kind === "credit" && a.creditLimit && a.creditLimit > 0 ? Math.max(0, owed) / a.creditLimit : null;
}

/** The next time a card is due on `dueDay`, today counting as due. Short months use their last day. */
export function nextDue(dueDay: number, todayISO: string): { date: string; days: number } {
  const { y, m, d } = parseISO(todayISO);
  const on = (yy: number, mm: number) => new Date(yy, mm - 1, Math.min(dueDay, new Date(yy, mm, 0).getDate()));
  const today = new Date(y, m - 1, d);
  let due = on(y, m);
  if (due < today) due = on(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1);
  return { date: toISODate(due), days: Math.round((due.getTime() - today.getTime()) / 86_400_000) };
}
