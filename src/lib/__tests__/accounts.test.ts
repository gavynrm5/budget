import { describe, expect, it } from "vitest";
import { accountLabel, computeBalances, nextDue, utilization } from "../accounts";
import { computePeriod } from "../calc";
import { defaultAccounts, defaultSettings, seedLineItems } from "../defaults";
import { matchAccount } from "../importExport";
import type { Account, ExtraIncome, PeriodBudget, Transaction, Transfer } from "../types";

const accts = defaultAccounts();
const byId = (id: string) => accts.find((a) => a.id === id)!;
const LOCAL = "acct-local-checking";
const MAIN = "acct-main-card";
const SAVINGS = "acct-savings";
const setAt = new Date(2026, 8, 20, 12).getTime(); // Sep 20, 2026, noon local
const after = setAt + 60_000;

const tx = (p: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36),
  date: "2026-09-21",
  amount: 10,
  category: "Wants",
  subId: "dining",
  description: "",
  notes: "",
  createdAt: after,
  ...p
});

describe("account labels", () => {
  it("adds the kind unless the name already says it", () => {
    expect(accts.map(accountLabel)).toEqual(["Local checking", "National checking", "Savings", "Local card", "Student card", "Main card"]);
  });
  it("matches CSV values by label, or by a unique nickname", () => {
    expect(matchAccount("main card", accts)?.id).toBe(MAIN);
    expect(matchAccount("Student", accts)?.id).toBe("acct-student-card");
    expect(matchAccount("Local", accts)).toBeNull(); // checking or card?
    expect(matchAccount("Local checking", accts)?.id).toBe(LOCAL);
  });
});

describe("balances", () => {
  const withSet = (a: Account, balance: number): Account => ({ ...a, balance, balanceSetAt: setAt });
  const accounts = [withSet(byId(LOCAL), 1000), withSet(byId(MAIN), 200), withSet(byId(SAVINGS), 5000)];

  it("spending lowers checking and raises what a card owes", () => {
    const b = computeBalances(accounts, [tx({ accountId: LOCAL, amount: 40 }), tx({ accountId: MAIN, amount: 25.5 })], [], []);
    expect(b[LOCAL]).toBe(960);
    expect(b[MAIN]).toBe(225.5);
  });

  it("a card payment lowers both checking and the card; a move to savings shifts cash", () => {
    const tr = (fromId: string, toId: string, amount: number): Transfer => ({ id: fromId + toId, fromId, toId, amount, date: "2026-09-22", notes: "", createdAt: after });
    const b = computeBalances(accounts, [], [tr(LOCAL, MAIN, 150), tr(LOCAL, SAVINGS, 300)], []);
    expect(b[LOCAL]).toBe(550);
    expect(b[MAIN]).toBe(50);
    expect(b[SAVINGS]).toBe(5300);
  });

  it("extra income adds to the account it went into", () => {
    const x: ExtraIncome = { id: "x", date: "2026-09-22", amount: 200, source: "Birthday", accountId: LOCAL, notes: "", allocations: [], createdAt: after };
    expect(computeBalances(accounts, [], [], [x])[LOCAL]).toBe(1200);
  });

  it("ignores entries logged before the balance was set, or dated before that day", () => {
    const b = computeBalances(
      accounts,
      [
        tx({ accountId: LOCAL, amount: 40, createdAt: setAt - 1 }), // logged before: already in the balance
        tx({ accountId: LOCAL, amount: 30, date: "2026-09-10" }), // backfilled old purchase
        tx({ accountId: LOCAL, amount: 5, date: "2026-09-20" }), // same day, logged after: counts
        tx({ accountId: null, amount: 99 }) // no account
      ],
      [],
      []
    );
    expect(b[LOCAL]).toBe(995);
  });
});

describe("cards", () => {
  it("shows usage of the limit", () => {
    expect(utilization({ ...byId(MAIN), creditLimit: 2000 }, 500)).toBe(0.25);
    expect(utilization(byId(MAIN), 500)).toBeNull();
    expect(utilization({ ...byId(MAIN), creditLimit: 2000 }, -50)).toBe(0);
  });
  it("finds the next due date, using the last day of short months", () => {
    expect(nextDue(5, "2026-09-23")).toEqual({ date: "2026-10-05", days: 12 });
    expect(nextDue(23, "2026-09-23")).toEqual({ date: "2026-09-23", days: 0 });
    expect(nextDue(31, "2026-09-10")).toEqual({ date: "2026-09-30", days: 20 });
    expect(nextDue(15, "2026-12-20")).toEqual({ date: "2027-01-15", days: 26 });
  });
});

describe("extra income in the budget", () => {
  const s = defaultSettings();
  const periods: Record<string, PeriodBudget> = { "2026-09": { id: "2026-09", lineItems: seedLineItems(s) } };
  const dining = seedLineItems(s).find((li) => li.subId === "dining")!;
  const withDining = { "2026-09": { id: "2026-09", lineItems: seedLineItems(s).map((li) => (li.id === dining.id ? { ...li, budgeted: 100 } : li)) } };
  const extra = (allocations: ExtraIncome["allocations"], date = "2026-09-20"): ExtraIncome => ({ id: "x", date, amount: 250, source: "Birthday", accountId: null, notes: "", allocations });

  it("covers an over-budget line and shows the rest as unassigned", () => {
    const txs = [tx({ subId: "dining", amount: 160 })];
    const before = computePeriod("2026-09", withDining, txs, s);
    const line = () => before.groups.Wants.lines.find((l) => l.item.subId === "dining")!;
    expect(line().remaining).toBe(-60);
    expect(line().status).toBe("over");

    const c = computePeriod("2026-09", withDining, txs, s, [extra([{ subId: "dining", amount: 60 }])]);
    const l = c.groups.Wants.lines.find((x) => x.item.subId === "dining")!;
    expect(l.extra).toBe(60);
    expect(l.available).toBe(160);
    expect(l.remaining).toBe(0);
    expect(l.status).toBe("near"); // 100% used: at the limit, no longer over
    expect(c.groups.Wants.extra).toBe(60);
    expect(c.extraIncome).toBe(250);
    expect(c.extraAllocated).toBe(60);
    expect(c.extraUnallocated).toBe(190);
  });

  it("adds to left-from-income but not to planned budget or slack", () => {
    const base = computePeriod("2026-09", periods, [], s);
    const c = computePeriod("2026-09", periods, [], s, [extra([{ subId: "dining", amount: 100 }])]);
    expect(c.totalBudgeted).toBe(base.totalBudgeted);
    expect(c.unallocated).toBe(base.unallocated);
    expect(c.leftFromIncome).toBe(base.leftFromIncome + 250);
    expect(c.totalRemaining).toBe(base.totalRemaining + 100);
  });

  it("belongs to the pay period of its date", () => {
    const c = computePeriod("2026-09", periods, [], s, [extra([], "2026-09-14")]); // Aug 15 to Sep 14 period
    expect(c.extraIncome).toBe(0);
    expect(computePeriod("2026-08", periods, [], s, [extra([], "2026-09-14")]).extraIncome).toBe(250);
  });
});
