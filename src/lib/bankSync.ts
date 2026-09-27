import { round2 } from "./money";
import { merchantKey } from "./insights";
import type { Account, BankAccountKind, BankLink, BankTx, Category, Settings, Transaction } from "./types";

/** The shape the bank sync worker returns (a trimmed Plaid transaction). */
export interface PlaidTx {
  transaction_id: string;
  account_id: string;
  amount: number; // positive = money out, negative = money in
  date: string;
  authorized_date: string | null;
  name: string;
  merchant_name: string | null;
  pending: boolean;
  personal_finance_category: { primary: string; detailed: string } | null;
}

export interface PlaidAccountInfo {
  id: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
  balances: { current: number | null; available: number | null; limit: number | null };
}

export interface SyncResponse {
  added: PlaidTx[];
  modified: PlaidTx[];
  removed: string[];
  nextCursor: string;
  accounts: PlaidAccountInfo[];
  status: string | null;
}

export function bankKind(a: Pick<PlaidAccountInfo, "type" | "subtype">): BankAccountKind {
  if (a.type === "credit") return "credit";
  if (a.type === "depository") return a.subtype === "savings" || a.subtype === "money market" || a.subtype === "cd" ? "savings" : "checking";
  return "other";
}

/** A purchase, money coming in, or money moving between the user's own accounts (card payments, transfers). */
export function classify(t: Pick<PlaidTx, "amount" | "personal_finance_category">): BankTx["kind"] {
  const p = t.personal_finance_category?.primary ?? "";
  const d = t.personal_finance_category?.detailed ?? "";
  if (p === "TRANSFER_IN" || p === "TRANSFER_OUT" || d === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT") return "transfer";
  if (p === "INCOME" || t.amount < 0) return "income";
  return "spending";
}

export const describe = (t: Pick<PlaidTx, "merchant_name" | "name">) => (t.merchant_name || t.name || "Bank transaction").trim();

/** Plaid's category to one of the starting sub-categories, if the user still has it. */
const PFC_TO_SUB: [RegExp, string][] = [
  [/^FOOD_AND_DRINK_GROCERIES/, "groceries"],
  [/^FOOD_AND_DRINK/, "dining"],
  [/^TRANSPORTATION_GAS/, "gas"],
  [/^TRANSPORTATION/, "gas"],
  [/^RENT_AND_UTILITIES_RENT/, "rent"],
  [/^RENT_AND_UTILITIES/, "utilities"],
  [/^LOAN_PAYMENTS_CAR_PAYMENT/, "car-payment"],
  [/^GENERAL_SERVICES_INSURANCE/, "insurance"],
  [/^ENTERTAINMENT/, "subscriptions"],
  [/^GENERAL_SERVICES_(STREAMING|SUBSCRIPTION)/, "subscriptions"],
  [/^PERSONAL_CARE/, "personal-care"],
  [/^(GENERAL_MERCHANDISE|TRAVEL|HOME_IMPROVEMENT)/, "travel-shopping"]
];

export interface Suggestion {
  category: Category;
  subId: string;
  from: "history" | "bank";
}

/** Your own last choice for the same place first; otherwise the bank's category. */
export function suggest(bt: Pick<BankTx, "description" | "pfcDetailed">, transactions: Transaction[], settings: Settings): Suggestion | null {
  const active = (id: string) => settings.subCategories.find((s) => s.id === id && !s.archived);
  const key = merchantKey(bt.description);
  if (key) {
    const past = transactions
      .filter((t) => merchantKey(t.description) === key && active(t.subId))
      .sort((a, b) => (b.date + (b.createdAt ?? 0)).localeCompare(a.date + (a.createdAt ?? 0)))[0];
    if (past) return { category: past.category, subId: past.subId, from: "history" };
  }
  for (const [re, subId] of PFC_TO_SUB) {
    const sub = re.test(bt.pfcDetailed) ? active(subId) : undefined;
    if (sub) return { category: sub.category, subId: sub.id, from: "bank" };
  }
  return null;
}

const dayDiff = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

/** A hand-logged transaction that is probably this same purchase: same amount, within 3 days, no other card set. */
export function findDuplicate(bt: Pick<BankTx, "amount" | "date" | "accountId">, transactions: Transaction[], taken: Set<string>): Transaction | null {
  const candidates = transactions.filter(
    (t) => !taken.has(t.id) && Math.abs(t.amount - bt.amount) < 0.01 && dayDiff(t.date, bt.date) <= 3 && (!t.accountId || t.accountId === bt.accountId)
  );
  return candidates.sort((a, b) => dayDiff(a.date, bt.date) - dayDiff(b.date, bt.date))[0] ?? null;
}

export interface SyncPlan {
  upserts: BankTx[];
  deletes: string[];
  link: BankLink;
  accounts: Account[];
}

/**
 * What to save after a sync: new bank transactions to review (posted, on or
 * after the import date, from accounts being tracked), updates to ones not
 * reviewed yet, removals, the new cursor, and balances straight from the bank.
 */
export function planSync(res: SyncResponse, link: BankLink, existing: Map<string, BankTx>, accounts: Account[], now: number): SyncPlan {
  const tracked = new Map(link.accounts.filter((a) => a.accountId).map((a) => [a.plaidId, a.accountId as string]));
  const upserts: BankTx[] = [];
  const deletes: string[] = [];
  const toBankTx = (t: PlaidTx, prev?: BankTx): BankTx => ({
    id: t.transaction_id,
    linkId: link.id,
    plaidAccountId: t.account_id,
    accountId: tracked.get(t.account_id) ?? null,
    date: t.date,
    amount: round2(Math.abs(t.amount)),
    direction: t.amount < 0 ? "in" : "out",
    description: describe(t),
    pfcPrimary: t.personal_finance_category?.primary ?? "",
    pfcDetailed: t.personal_finance_category?.detailed ?? "",
    kind: classify(t),
    status: prev?.status ?? "new",
    ...(prev?.txId ? { txId: prev.txId } : {}),
    createdAt: prev?.createdAt ?? now
  });
  const wanted = (t: PlaidTx) => !t.pending && t.date >= link.importFrom && tracked.has(t.account_id) && t.amount !== 0;

  for (const t of res.added) {
    const prev = existing.get(t.transaction_id);
    if (prev && prev.status !== "new") continue; // already handled
    if (wanted(t)) upserts.push(toBankTx(t, prev));
  }
  for (const t of res.modified) {
    const prev = existing.get(t.transaction_id);
    if (prev && prev.status === "new") upserts.push(toBankTx(t, prev));
  }
  for (const id of res.removed) {
    const prev = existing.get(id);
    if (!prev) continue;
    if (prev.status === "new") deletes.push(id);
    else upserts.push({ ...prev, removedByBank: true });
  }

  // Balances come from the bank for connected accounts. For cards, "current" is what's owed.
  const byPlaid = new Map(res.accounts.map((a) => [a.id, a]));
  const nextAccounts = accounts.map((a) => {
    const entry = link.accounts.find((x) => x.accountId === a.id);
    const current = entry ? byPlaid.get(entry.plaidId)?.balances.current : null;
    return current != null ? { ...a, balance: round2(current), balanceSetAt: now, linkId: link.id } : a;
  });

  return {
    upserts,
    deletes,
    link: { ...link, cursor: res.nextCursor, lastSyncAt: now, status: "ok", statusMessage: "" },
    accounts: nextAccounts
  };
}
