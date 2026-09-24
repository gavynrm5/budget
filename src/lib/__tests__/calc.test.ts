import { describe, expect, it } from "vitest";
import { applyFixedExpenses, computePeriod, statusFor, subsForCategory, txPeriod } from "../calc";
import { defaultSettings, seedLineItems } from "../defaults";
import { evaluate } from "../expr";
import { daysInPeriod, periodOfDate, periodRangeLabel, shiftPeriod } from "../periods";
import { evaluatePlan } from "../planning";
import { normalizeDate } from "../csv";
import type { LineItem, PeriodBudget, Transaction } from "../types";

const s = defaultSettings();
const tx = (p: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36),
  date: "2026-03-20",
  amount: 10,
  category: "Essentials",
  subId: "groceries",
  description: "",
  notes: "",
  ...p
});

describe("periods", () => {
  it("uses the 15th to 14th rule", () => {
    expect(periodOfDate("2026-03-15")).toBe("2026-03");
    expect(periodOfDate("2026-04-14")).toBe("2026-03");
    expect(periodOfDate("2026-04-15")).toBe("2026-04");
    expect(periodOfDate("2027-01-14")).toBe("2026-12");
    expect(periodOfDate("2027-01-03")).toBe("2026-12");
  });
  it("labels and rolls forward across years", () => {
    expect(periodRangeLabel("2026-03")).toBe("Mar 15 to Apr 14, 2026");
    expect(periodRangeLabel("2026-12")).toBe("Dec 15, 2026 to Jan 14, 2027");
    expect(shiftPeriod("2026-12", 1)).toBe("2027-01");
    expect(shiftPeriod("2026-01", -1)).toBe("2025-12");
    expect(daysInPeriod("2026-03")).toBe(31);
  });
});

describe("amount math", () => {
  it("evaluates simple expressions", () => {
    expect(evaluate("29.76+5.83")).toBeCloseTo(35.59, 10);
    expect(evaluate("$1,200.50 - 200.5")).toBe(1000);
    expect(evaluate("(10+5)*2/3")).toBe(10);
    expect(() => evaluate("2+")).toThrow();
    expect(() => evaluate("alert(1)")).toThrow();
  });
});

describe("period calculations", () => {
  const periods: Record<string, PeriodBudget> = { "2026-03": { id: "2026-03", lineItems: seedLineItems(s) } };

  it("seeds fixed expenses and income", () => {
    const c = computePeriod("2026-03", periods, [], s);
    expect(c.income).toBe(4000);
    expect(c.groups.Essentials.budgeted).toBe(2120); // 1500 + 350 + 150 + 120
    expect(c.groups.Essentials.targetAmount).toBe(2000); // 50% of 4000
    expect(c.unallocated).toBe(1880);
  });

  it("computes line, group and total figures", () => {
    const items = periods["2026-03"].lineItems.map((li) => (li.subId === "groceries" ? { ...li, budgeted: 400 } : li));
    const ps = { "2026-03": { id: "2026-03", lineItems: items } };
    const txs = [
      tx({ amount: 35.59 }),
      tx({ amount: 364.41 }),
      tx({ amount: 50, subId: "gas" }),
      tx({ amount: 12.34, date: "2026-04-15" }) // next period
    ];
    const c = computePeriod("2026-03", ps, txs, s);
    const g = c.groups.Essentials.lines.find((l) => l.item.subId === "groceries")!;
    expect(g.spent).toBe(400);
    expect(g.remaining).toBe(0);
    expect(g.pctUsed).toBe(1);
    expect(g.status).toBe("near");
    const gas = c.groups.Essentials.lines.find((l) => l.item.subId === "gas")!;
    expect(gas.pctUsed).toBeNull(); // budgeted 0 shows "-"
    expect(c.groups.Essentials.spent).toBe(450);
    expect(c.totalSpent).toBe(450);
    expect(c.leftFromIncome).toBe(3550); // 4000 - 450
  });

  it("sums group spent by category, not by sub-category", () => {
    // Taxes placed under Essentials for this period, but a transaction tagged Savings / Taxes
    const items = periods["2026-03"].lineItems.map((li) => (li.subId === "taxes" ? { ...li, category: "Essentials" as const, budgeted: 100 } : li));
    const ps = { "2026-03": { id: "2026-03", lineItems: items } };
    const c = computePeriod("2026-03", ps, [tx({ amount: 80, category: "Savings", subId: "taxes" })], s);
    const line = c.groups.Essentials.lines.find((l) => l.item.subId === "taxes")!;
    expect(line.spent).toBe(80);
    expect(c.groups.Essentials.spent).toBe(0);
    expect(c.groups.Savings.spent).toBe(80);
  });

  it("honors manual period override", () => {
    const t = tx({ date: "2026-04-12", periodOverride: "2026-04" });
    expect(txPeriod(t)).toBe("2026-04");
    expect(computePeriod("2026-04", periods, [t], s).totalSpent).toBe(10);
    expect(computePeriod("2026-03", periods, [t], s).totalSpent).toBe(0);
  });

  it("copies the previous period for unsaved periods", () => {
    const c = computePeriod("2026-07", periods, [], s);
    expect(c.virtual).toBe(true);
    expect(c.totalBudgeted).toBe(2120);
  });

  it("status thresholds", () => {
    expect(statusFor(1.01)).toBe("over");
    expect(statusFor(1)).toBe("near");
    expect(statusFor(0.86)).toBe("near");
    expect(statusFor(0.85)).toBe("ok");
  });

  it("filters sub-categories by the period's placement", () => {
    const items = periods["2026-03"].lineItems.map((li) => (li.subId === "taxes" ? { ...li, category: "Essentials" as const } : li));
    expect(subsForCategory("Essentials", items, s.subCategories).map((x) => x.id)).toContain("taxes");
    expect(subsForCategory("Savings", items, s.subCategories).map((x) => x.id)).not.toContain("taxes");
  });
});

describe("planning and csv", () => {
  it("resolves references and catches cycles", () => {
    const r = evaluatePlan([
      { id: "a", label: "Current CC", formula: "2500" },
      { id: "b", label: "Remaining Cash Flow", formula: "Current CC minus 1800".replace("Current CC", "[Current CC]") },
      { id: "c", label: "Loop", formula: "[Loop] + 1" }
    ]);
    expect(r.b).toEqual({ value: 700 });
    expect("error" in r.c).toBe(true);
  });
  it("normalizes dates", () => {
    expect(normalizeDate("3/5/2026")).toBe("2026-03-05");
    expect(normalizeDate("2026-02-30")).toBeNull();
  });
});

describe("applying fixed expenses", () => {
  let n = 0;
  const id = () => `new${++n}`;
  const items = seedLineItems(s);
  const line = (li: LineItem[], subId: string) => li.find((x) => x.subId === subId);

  it("updates lines by name, ignoring case and spaces", () => {
    const r = applyFixedExpenses(items, [{ id: "a", name: "  rent / mortgage ", amount: 1900 }], s.subCategories, id);
    expect(line(r.lineItems, "rent")?.budgeted).toBe(1900);
    expect(r.updated).toEqual(["Rent / Mortgage"]);
    expect(r.subCategories).toBeNull();
    expect(line(items, "rent")?.budgeted).toBe(1500); // input untouched
  });

  it("adds a line for a sub-category the period doesn't have", () => {
    const without = items.filter((li) => li.subId !== "insurance");
    const r = applyFixedExpenses(without, [{ id: "a", name: "Insurance", amount: 240 }], s.subCategories, id);
    expect(line(r.lineItems, "insurance")).toMatchObject({ category: "Essentials", budgeted: 240 });
    expect(r.added).toEqual(["Insurance"]);
  });

  it("creates a sub-category and line for a brand new expense", () => {
    const r = applyFixedExpenses(items, [{ id: "a", name: "Phone", amount: 85 }], s.subCategories, id);
    const sub = r.subCategories?.find((x) => x.name === "Phone");
    expect(sub).toMatchObject({ category: "Essentials", archived: false });
    expect(line(r.lineItems, sub!.id)?.budgeted).toBe(85);
    expect(r.added).toEqual(["Phone"]);
  });

  it("restores an archived sub-category instead of duplicating it", () => {
    const subs = s.subCategories.map((x) => (x.id === "utilities" ? { ...x, archived: true } : x));
    const r = applyFixedExpenses(items.filter((li) => li.subId !== "utilities"), [{ id: "a", name: "Utilities", amount: 160 }], subs, id);
    expect(r.subCategories?.find((x) => x.id === "utilities")?.archived).toBe(false);
    expect(r.subCategories?.filter((x) => x.name === "Utilities")).toHaveLength(1);
    expect(line(r.lineItems, "utilities")?.budgeted).toBe(160);
  });

  it("reports lines already at the right amount and skips blank names", () => {
    const r = applyFixedExpenses(items, [{ id: "a", name: "Car Payment", amount: 350 }, { id: "b", name: "  ", amount: 9 }], s.subCategories, id);
    expect(r.unchanged).toEqual(["Car Payment"]);
    expect(r.updated).toEqual([]);
    expect(r.added).toEqual([]);
  });
});
