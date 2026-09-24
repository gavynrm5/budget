import { evaluate } from "./expr";
import { normalizeDate, parseCSV, toCSV } from "./csv";
import { round2 } from "./money";
import { txPeriod } from "./calc";
import { accountLabel } from "./accounts";
import type { Account, Category, Settings, SubCategory, Transaction, WishItem } from "./types";

export const TX_HEADERS = ["Date", "Amount", "Category", "Sub-Category", "Description", "Notes"];

export function transactionsToCSV(txs: Transaction[], subs: SubCategory[], accounts: Account[] = []): string {
  const name = (id: string) => subs.find((s) => s.id === id)?.name ?? "";
  const acct = (id?: string | null) => {
    const a = id ? accounts.find((x) => x.id === id) : undefined;
    return a ? accountLabel(a) : "";
  };
  const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date));
  return toCSV(
    [...TX_HEADERS, "Paid With", "Period", "Typed As"],
    sorted.map((t) => [t.date, t.amount.toFixed(2), t.category, name(t.subId), t.description, t.notes, acct(t.accountId), txPeriod(t), t.expression ?? ""])
  );
}

/** Matches "Main card", "Local checking", or just "Main" when that nickname is unique. */
export function matchAccount(raw: string, accounts: Account[]): Account | null {
  const q = raw.trim().toLowerCase();
  if (!q) return null;
  const byLabel = accounts.find((a) => accountLabel(a).toLowerCase() === q);
  if (byLabel) return byLabel;
  const byName = accounts.filter((a) => a.name.toLowerCase() === q);
  return byName.length === 1 ? byName[0] : null;
}

export function wishlistToCSV(items: WishItem[]): string {
  return toCSV(
    ["Item", "Category", "Room", "Status", "Price", "Qty", "Total", "Link", "Notes"],
    items.map((w) => [w.item, w.category, w.room, w.status, w.price.toFixed(2), w.qty ?? "", (w.price * (w.qty ?? 1)).toFixed(2), w.link, w.notes])
  );
}

export function parseCategory(raw: string): Category | null {
  const s = raw.trim().toLowerCase();
  if (s.startsWith("essential")) return "Essentials";
  if (s.startsWith("want")) return "Wants";
  if (s.startsWith("saving") || s === "savings & debt" || s === "debt") return "Savings";
  return null;
}

export interface CsvImportResult {
  ready: Transaction[];
  newSubs: SubCategory[];
  errors: { row: number; message: string }[];
}

export function parseTransactionsCSV(text: string, settings: Settings, newId: () => string): CsvImportResult {
  const rows = parseCSV(text);
  const result: CsvImportResult = { ready: [], newSubs: [], errors: [] };
  if (!rows.length) {
    result.errors.push({ row: 0, message: "The file is empty." });
    return result;
  }
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s_-]+/g, ""));
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const idx = {
    date: col("date"),
    amount: col("amount"),
    category: col("category"),
    sub: col("subcategory", "sub"),
    description: col("description", "desc"),
    notes: col("notes", "note"),
    account: col("paidwith", "account", "card")
  };
  const missing = (["date", "amount", "category", "sub"] as const).filter((k) => idx[k] < 0);
  if (missing.length) {
    result.errors.push({ row: 1, message: `Missing column(s): ${missing.map((m) => ({ date: "Date", amount: "Amount", category: "Category", sub: "Sub-Category" })[m]).join(", ")}. Expected ${TX_HEADERS.join(", ")}.` });
    return result;
  }

  const subs = [...settings.subCategories];
  let order = Math.max(0, ...subs.map((s) => s.order)) + 1;

  rows.slice(1).forEach((r, i) => {
    const rowNo = i + 2;
    const get = (k: number) => (k >= 0 ? (r[k] ?? "").trim() : "");
    const date = normalizeDate(get(idx.date));
    if (!date) return result.errors.push({ row: rowNo, message: `Date "${get(idx.date)}" is not a valid date.` });
    let amount: number;
    const amountRaw = get(idx.amount);
    try {
      amount = round2(evaluate(amountRaw));
    } catch {
      return result.errors.push({ row: rowNo, message: `Amount "${amountRaw}" is not a number.` });
    }
    if (amount <= 0) return result.errors.push({ row: rowNo, message: "Amount must be greater than 0." });
    const category = parseCategory(get(idx.category));
    if (!category) return result.errors.push({ row: rowNo, message: `Category "${get(idx.category)}" must be Essentials, Wants, or Savings.` });
    const subNameRaw = get(idx.sub);
    if (!subNameRaw) return result.errors.push({ row: rowNo, message: "Sub-Category is empty." });
    let sub = subs.find((s) => s.name.toLowerCase() === subNameRaw.toLowerCase());
    if (!sub) {
      sub = { id: newId(), name: subNameRaw, category, order: order++, archived: false };
      subs.push(sub);
      result.newSubs.push(sub);
    }
    const accountRaw = get(idx.account);
    const account = matchAccount(accountRaw, settings.accounts);
    if (accountRaw && !account) return result.errors.push({ row: rowNo, message: `Paid With "${accountRaw}" doesn't match an account, like "Main card" or "Local checking".` });
    const isMath = /[+*/]/.test(amountRaw.replace(/^\$/, "")) || /\d\s*-\s*\d/.test(amountRaw);
    result.ready.push({
      id: newId(),
      date,
      amount,
      expression: isMath ? amountRaw.replace(/\s+/g, "") : undefined,
      category,
      subId: sub.id,
      description: get(idx.description),
      notes: get(idx.notes),
      periodOverride: null,
      accountId: account?.id ?? null
    });
  });
  return result;
}

export const SAMPLE_CSV = toCSV(TX_HEADERS, [
  ["2026-03-16", "35.59", "Essentials", "Groceries", "Walmart", "29.76+5.83"],
  ["2026-03-18", "2.99", "Wants", "Entertainment & Subscriptions", "iCloud", ""],
  ["3/20/2026", "48.10", "Essentials", "Gas / Transportation", "Shell", ""]
]);
