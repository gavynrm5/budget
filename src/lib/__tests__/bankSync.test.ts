import { describe, expect, it } from "vitest";
import { bankKind, classify, findDuplicate, planSync, suggest, type PlaidTx, type SyncResponse } from "../bankSync";
import { computeBalances } from "../accounts";
import { defaultAccounts, defaultSettings } from "../defaults";
import type { BankLink, BankTx, Transaction } from "../types";

const s = defaultSettings();
const pfc = (primary: string, detailed = primary) => ({ primary, detailed });
const ptx = (p: Partial<PlaidTx>): PlaidTx => ({
  transaction_id: Math.random().toString(36).slice(2),
  account_id: "plaid-card",
  amount: 12.5,
  date: "2026-09-20",
  authorized_date: null,
  name: "STARBUCKS STORE 1234",
  merchant_name: "Starbucks",
  pending: false,
  personal_finance_category: pfc("FOOD_AND_DRINK", "FOOD_AND_DRINK_COFFEE"),
  ...p
});
const tx = (p: Partial<Transaction>): Transaction => ({ id: Math.random().toString(36), date: "2026-09-20", amount: 10, category: "Wants", subId: "dining", description: "", notes: "", ...p });

describe("reading bank transactions", () => {
  it("maps Plaid account types", () => {
    expect(bankKind({ type: "credit", subtype: "credit card" })).toBe("credit");
    expect(bankKind({ type: "depository", subtype: "checking" })).toBe("checking");
    expect(bankKind({ type: "depository", subtype: "savings" })).toBe("savings");
    expect(bankKind({ type: "investment", subtype: "401k" })).toBe("other");
  });

  it("tells purchases from money in and from moving money between own accounts", () => {
    expect(classify(ptx({}))).toBe("spending");
    expect(classify(ptx({ amount: -2400, personal_finance_category: pfc("INCOME", "INCOME_WAGES") }))).toBe("income");
    expect(classify(ptx({ amount: -25, personal_finance_category: pfc("GENERAL_MERCHANDISE") }))).toBe("income"); // a refund
    expect(classify(ptx({ amount: 500, personal_finance_category: pfc("LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT") }))).toBe("transfer");
    expect(classify(ptx({ amount: -500, personal_finance_category: pfc("TRANSFER_IN", "TRANSFER_IN_ACCOUNT_TRANSFER") }))).toBe("transfer");
  });
});

describe("category suggestions", () => {
  it("prefers what you picked last time at the same place", () => {
    const history = [tx({ description: "Starbucks", category: "Wants", subId: "misc-wants", date: "2026-09-01" }), tx({ description: "STARBUCKS #88", category: "Essentials", subId: "groceries", date: "2026-08-01" })];
    expect(suggest({ description: "Starbucks", pfcDetailed: "FOOD_AND_DRINK_COFFEE" }, history, s)).toEqual({ category: "Wants", subId: "misc-wants", from: "history" });
  });

  it("falls back to the bank's category, and skips subs you archived", () => {
    expect(suggest({ description: "Kroger", pfcDetailed: "FOOD_AND_DRINK_GROCERIES" }, [], s)).toEqual({ category: "Essentials", subId: "groceries", from: "bank" });
    expect(suggest({ description: "Shell", pfcDetailed: "TRANSPORTATION_GAS" }, [], s)?.subId).toBe("gas");
    const archived = { ...s, subCategories: s.subCategories.map((x) => (x.id === "dining" ? { ...x, archived: true } : x)) };
    expect(suggest({ description: "Chipotle", pfcDetailed: "FOOD_AND_DRINK_FAST_FOOD" }, [], archived)).toBeNull();
    expect(suggest({ description: "Mystery", pfcDetailed: "OTHER_OTHER" }, [], s)).toBeNull();
  });
});

describe("already logged by hand", () => {
  const bt = { amount: 42.18, date: "2026-09-20", accountId: "acct-main-card" };
  it("matches the same amount within 3 days when no other card was set", () => {
    const hand = tx({ id: "h1", amount: 42.18, date: "2026-09-18", accountId: null });
    expect(findDuplicate(bt, [hand], new Set())?.id).toBe("h1");
    expect(findDuplicate(bt, [tx({ amount: 42.18, date: "2026-09-12" })], new Set())).toBeNull(); // too far apart
    expect(findDuplicate(bt, [tx({ amount: 42.18, accountId: "acct-local-card" })], new Set())).toBeNull(); // different card
    expect(findDuplicate(bt, [hand], new Set(["h1"]))).toBeNull(); // already matched to another bank transaction
  });
});

describe("applying a sync", () => {
  const link: BankLink = {
    id: "item-1",
    label: "Card bank",
    accounts: [{ plaidId: "plaid-card", accountId: "acct-main-card", kind: "credit" }, { plaidId: "plaid-other", accountId: null, kind: "checking" }],
    cursor: "",
    importFrom: "2026-09-15",
    lastSyncAt: null,
    status: "ok"
  };
  const res = (p: Partial<SyncResponse>): SyncResponse => ({ added: [], modified: [], removed: [], nextCursor: "c2", accounts: [], status: null, ...p });

  it("queues posted purchases from tracked accounts on or after the import date", () => {
    const plan = planSync(
      res({
        added: [
          ptx({ transaction_id: "keep", amount: 12.5 }),
          ptx({ transaction_id: "pending", pending: true }),
          ptx({ transaction_id: "old", date: "2026-09-10" }),
          ptx({ transaction_id: "untracked", account_id: "plaid-other" }),
          ptx({ transaction_id: "refund", amount: -30, personal_finance_category: pfc("GENERAL_MERCHANDISE") })
        ]
      }),
      link,
      new Map(),
      defaultAccounts(),
      1000
    );
    expect(plan.upserts.map((u) => u.id)).toEqual(["keep", "refund"]);
    expect(plan.upserts[0]).toMatchObject({ accountId: "acct-main-card", amount: 12.5, direction: "out", kind: "spending", status: "new", description: "Starbucks" });
    expect(plan.upserts[1]).toMatchObject({ amount: 30, direction: "in", kind: "income" });
    expect(plan.link).toMatchObject({ cursor: "c2", lastSyncAt: 1000, status: "ok" });
  });

  it("leaves reviewed ones alone, updates unreviewed ones, and handles removals", () => {
    const reviewed = { id: "done", status: "added", txId: "t9" } as BankTx;
    const waiting = { id: "wait", status: "new", createdAt: 5 } as BankTx;
    const existing = new Map([["done", reviewed], ["wait", waiting], ["gone-new", { id: "gone-new", status: "new" } as BankTx], ["gone-added", { id: "gone-added", status: "added" } as BankTx]]);
    const plan = planSync(
      res({ added: [ptx({ transaction_id: "done" })], modified: [ptx({ transaction_id: "wait", amount: 13 }), ptx({ transaction_id: "done", amount: 99 })], removed: ["gone-new", "gone-added"] }),
      link,
      existing,
      defaultAccounts(),
      2000
    );
    expect(plan.upserts.find((u) => u.id === "wait")).toMatchObject({ amount: 13, createdAt: 5 });
    expect(plan.upserts.some((u) => u.id === "done")).toBe(false);
    expect(plan.deletes).toEqual(["gone-new"]);
    expect(plan.upserts.find((u) => u.id === "gone-added")).toMatchObject({ removedByBank: true, status: "added" });
  });

  it("takes balances straight from the bank for connected accounts", () => {
    const plan = planSync(res({ accounts: [{ id: "plaid-card", name: "x", mask: null, type: "credit", subtype: "credit card", balances: { current: 845.2, available: 4154.8, limit: 5000 } }] }), link, new Map(), defaultAccounts(), 3000);
    const main = plan.accounts.find((a) => a.id === "acct-main-card")!;
    expect(main).toMatchObject({ balance: 845.2, balanceSetAt: 3000, linkId: "item-1" });
    // Logging a purchase later doesn't change a bank-synced balance again.
    const later = [tx({ accountId: "acct-main-card", amount: 50, createdAt: 4000, date: "2026-12-01" })];
    expect(computeBalances(plan.accounts, later, [], [])["acct-main-card"]).toBe(845.2);
  });
});
