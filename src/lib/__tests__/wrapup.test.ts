import { describe, expect, it } from "vitest";
import { buildWrapUp, nextPeriodStart, periodEnd } from "../wrapup";
import { netWorthChange, netWorthNow } from "../netWorth";
import { byPeriod, searchTransactions, type SearchFilters } from "../search";
import { defaultAccounts, defaultSettings, seedLineItems } from "../defaults";
import type { NetWorthPoint, PeriodBudget, Trade, Transaction, WishList, WrapUp } from "../types";

const s = defaultSettings(); // $4,000 income; rent 1500, car 350, insurance 150, utilities 120 prefilled
let n = 0;
const tx = (date: string, amount: number, subId: string, category: Transaction["category"], description = "", p: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`, date, amount, subId, category, description, notes: "", ...p
});
const lines = seedLineItems(s).map((li) => (li.subId === "dining" ? { ...li, budgeted: 200 } : li.subId === "groceries" ? { ...li, budgeted: 400 } : li));
const periods: Record<string, PeriodBudget> = { "2026-09": { id: "2026-09", lineItems: lines } };

describe("wrap-up", () => {
  const txs = [
    tx("2026-09-15", 1500, "rent", "Essentials", "Landlord"),
    tx("2026-09-20", 260, "dining", "Wants", "Restaurants"),
    tx("2026-09-22", 310, "groceries", "Essentials", "Kroger"),
    tx("2026-08-20", 1700, "rent", "Essentials") // previous period
  ];

  it("works out leftover, overs, unders, and the comparison with last period", () => {
    const w = buildWrapUp("2026-09", periods, txs, s, [], [], [], null);
    expect(w.spent).toBe(2070);
    expect(w.leftover).toBe(1930); // 4000 - 2070
    expect(w.leftToMove).toBe(1930);
    expect(w.over).toEqual([{ name: "Restaurants & Dining Out", over: 60 }]);
    expect(w.under).toEqual([{ name: "Groceries", under: 90 }]);
    expect(w.topSpending.map((t) => t.name)).toEqual(["Groceries", "Restaurants & Dining Out"]); // rent is a fixed bill, left out
    expect(w.vsPrevious).toMatchObject({ spent: 1700, change: 370 });
  });

  it("counts extra income, and savings moves lower the leftover while carries are tracked separately", () => {
    const moved = [...txs, tx("2026-10-14", 500, "emergency", "Savings", "Leftover from September", { periodOverride: "2026-09" })];
    const wrap: WrapUp = { id: "2026-09", moves: [{ kind: "carry", amount: 400, refId: "x", at: 1 }], completedAt: null };
    const extra = [{ id: "e", date: "2026-09-25", amount: 200, source: "Birthday", accountId: null, notes: "", allocations: [] }];
    const w = buildWrapUp("2026-09", periods, moved, s, extra, [], [], wrap);
    expect(w.extraIncome).toBe(200);
    expect(w.leftover).toBe(1630); // 4000 + 200 - 2570
    expect(w.leftToMove).toBe(1230); // minus the 400 carried
    expect(w.vsPrevious?.change).toBe(370); // the $500 saved isn't counted as spending more
  });

  it("reports goal contributions and net worth change within the period", () => {
    const fund = { id: "fund", name: "Furniture fund", category: "Savings" as const, order: 99, archived: false };
    const list: WishList = { id: "L", name: "Furniture", order: 0, subId: "fund", startingSaved: 0, goalAmount: null, targetDate: null, fields: [] };
    const nw = (id: string, total: number): NetWorthPoint => ({ id, cash: total, owed: 0, investments: 0, total, investmentsEstimated: false });
    const w = buildWrapUp("2026-09", periods, [...txs, tx("2026-09-30", 150, "fund", "Savings")], { ...s, subCategories: [...s.subCategories, fund] }, [], [list], [nw("2026-09-10", 1), nw("2026-09-16", 5000), nw("2026-10-10", 5600)], null);
    expect(w.savedToGoals).toEqual([{ name: "Furniture", amount: 150 }]);
    expect(w.netWorth).toEqual({ start: 5000, end: 5600, change: 600 });
  });

  it("dates moves at the period's end and carries at the next period's start", () => {
    expect(periodEnd("2026-09")).toBe("2026-10-14");
    expect(nextPeriodStart("2026-09")).toBe("2026-10-15");
    expect(nextPeriodStart("2026-12")).toBe("2027-01-15");
  });
});

describe("net worth", () => {
  const accts = defaultAccounts().map((a) =>
    a.id === "acct-local-checking" ? { ...a, balance: 2000, balanceSetAt: 1 } : a.id === "acct-savings" ? { ...a, balance: 5000, balanceSetAt: 1 } : a.id === "acct-main-card" ? { ...a, balance: 800, balanceSetAt: 1 } : a
  );
  const trades: Trade[] = [{ id: "v", symbol: "VOO", type: "buy", date: "2026-01-02", shares: 2, price: 500, notes: "" }];

  it("adds cash, subtracts card balances, and values stocks at the latest price", () => {
    const p = netWorthNow("2026-09-27", accts, [], [], [], trades, { VOO: { name: "", price: 600, change: 0, prevClose: 600, marketOpen: false, time: 0 } }, true);
    expect(p).toMatchObject({ cash: 7000, owed: 800, investments: 1200, total: 7400, investmentsEstimated: false });
  });

  it("falls back to what was paid without a recent price, and says so", () => {
    const p = netWorthNow("2026-09-27", accts, [], [], [], trades, {}, false);
    expect(p).toMatchObject({ investments: 1000, total: 7200, investmentsEstimated: true });
  });

  it("measures change from a start date to the latest point", () => {
    const pts = [{ id: "2026-09-01", total: 7000 }, { id: "2026-09-20", total: 7400 }, { id: "2026-08-01", total: 6500 }] as NetWorthPoint[];
    expect(netWorthChange(pts, "2026-08-15")).toMatchObject({ change: 400 });
    expect(netWorthChange(pts, "2026-09-25")).toBeNull();
  });
});

describe("search", () => {
  const all = [
    tx("2026-09-20", 42.18, "dining", "Wants", "Olive Garden", { notes: "Birthday dinner" }),
    tx("2026-09-10", 6.5, "dining", "Wants", "Starbucks", { accountId: "acct-main-card" }),
    tx("2026-08-12", 7.25, "dining", "Wants", "STARBUCKS #22"),
    tx("2026-08-20", 88.4, "groceries", "Essentials", "Kroger")
  ];
  const f = (p: Partial<SearchFilters>): SearchFilters => ({ text: "", from: null, to: null, category: "all", accountId: "all", ...p });

  it("matches every word across description, notes, and sub-category", () => {
    expect(searchTransactions(all, s, f({ text: "starbucks" })).map((t) => t.amount)).toEqual([6.5, 7.25]);
    expect(searchTransactions(all, s, f({ text: "birthday" })).map((t) => t.description)).toEqual(["Olive Garden"]);
    expect(searchTransactions(all, s, f({ text: "groceries" })).map((t) => t.description)).toEqual(["Kroger"]);
    expect(searchTransactions(all, s, f({ text: "olive dinner" })).length).toBe(1);
  });

  it("finds amounts, and filters by date, group, and card", () => {
    expect(searchTransactions(all, s, f({ text: "$42.18" })).map((t) => t.description)).toEqual(["Olive Garden"]);
    expect(searchTransactions(all, s, f({ text: "starbucks", from: "2026-09-01" })).length).toBe(1);
    expect(searchTransactions(all, s, f({ category: "Essentials" })).map((t) => t.description)).toEqual(["Kroger"]);
    expect(searchTransactions(all, s, f({ text: "starbucks", accountId: "none" })).map((t) => t.amount)).toEqual([7.25]);
  });

  it("totals results by pay period", () => {
    expect(byPeriod(searchTransactions(all, s, f({ text: "starbucks" })))).toEqual([
      { periodId: "2026-07", total: 7.25, count: 1 },
      { periodId: "2026-08", total: 6.5, count: 1 }
    ]);
  });
});
