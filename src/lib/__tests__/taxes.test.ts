import { describe, expect, it } from "vitest";
import { afterTaxIncome, computePeriod, spendingTargetSum } from "../calc";
import { defaultSettings } from "../defaults";
import { restoredSettings } from "../backup";
import { parseCategory } from "../importExport";
import { findTaxesSub, splitTaxes } from "../taxes";
import type { PeriodBudget, Settings, Transaction } from "../types";

/** Settings as they were before Taxes was its own group: the taxes sub under Savings. */
function oldSettings(): Settings {
  const s = defaultSettings();
  return { ...s, subCategories: s.subCategories.map((x) => (x.id === "taxes" ? { ...x, category: "Savings" } : x)) };
}
const period = (id: string): PeriodBudget => ({
  id,
  lineItems: [
    { id: "li-taxes", subId: "taxes", category: "Savings", budgeted: 500 },
    { id: "li-groceries", subId: "groceries", category: "Essentials", budgeted: 400 }
  ]
});
const tx = (id: string, date: string, subId = "taxes"): Transaction => ({
  id, date, amount: 100, category: subId === "taxes" ? "Savings" : "Essentials", subId, description: "", notes: ""
});

describe("splitTaxes", () => {
  const periods = { "2026-10": period("2026-10"), "2026-11": period("2026-11"), "2026-12": period("2026-12") };
  const txs = [tx("old", "2026-10-20"), tx("now", "2026-11-20"), tx("later", "2026-12-20"), tx("food", "2026-11-20", "groceries")];
  const split = splitTaxes(oldSettings(), periods, txs, "2026-11");

  it("moves the taxes sub into the Taxes group", () => {
    expect(findTaxesSub(split.subCategories)?.category).toBe("Taxes");
  });
  it("moves only this period and later", () => {
    expect(split.periods.map((p) => p.id)).toEqual(["2026-11", "2026-12"]);
    expect(split.periods[0].lineItems.find((li) => li.subId === "taxes")?.category).toBe("Taxes");
    expect(split.periods[0].lineItems.find((li) => li.subId === "groceries")?.category).toBe("Essentials");
    expect(split.transactions.map((t) => t.id)).toEqual(["now", "later"]);
    expect(split.transactions.every((t) => t.category === "Taxes")).toBe(true);
  });
  it("does nothing when there is no taxes sub", () => {
    const s = oldSettings();
    const none = splitTaxes({ ...s, subCategories: s.subCategories.filter((x) => x.id !== "taxes") }, periods, txs, "2026-11");
    expect(none.periods).toEqual([]);
    expect(none.transactions).toEqual([]);
  });
  it("finds a renamed-id sub by its name", () => {
    expect(findTaxesSub([{ id: "x1", name: "Taxes / Estimated", category: "Savings", order: 0, archived: false }])?.id).toBe("x1");
  });
});

describe("after-tax targets", () => {
  const s: Settings = { ...defaultSettings(), takeHomeIncome: 4000, otherIncome: 0, targets: { Essentials: 50, Wants: 30, Savings: 20, Taxes: 25 } };

  it("takes taxes out of income first", () => {
    expect(afterTaxIncome(s)).toBe(3000);
    expect(spendingTargetSum(s)).toBe(100);
  });
  it("sets group targets and shares against the right base", () => {
    const p: PeriodBudget = { id: "2026-11", lineItems: [
      { id: "a", subId: "taxes", category: "Taxes", budgeted: 1000 },
      { id: "b", subId: "groceries", category: "Essentials", budgeted: 1500 }
    ] };
    const c = computePeriod("2026-11", { "2026-11": p }, [], s);
    expect(c.groups.Taxes.targetAmount).toBe(1000);
    expect(c.groups.Taxes.targetPct).toBe(0.25);
    expect(c.groups.Essentials.targetAmount).toBe(1500);
    expect(c.groups.Essentials.targetPct).toBe(0.5);
  });
  it("matches plain income when no taxes are set", () => {
    expect(afterTaxIncome({ ...s, targets: { ...s.targets, Taxes: 0 } })).toBe(4000);
  });
});

describe("older saved data", () => {
  it("fills in a missing Taxes target on restore", () => {
    const backup = { targets: { Essentials: 50, Wants: 30, Savings: 20 } } as unknown as Partial<Settings>;
    expect(restoredSettings(backup, defaultSettings()).targets.Taxes).toBe(0);
  });
  it("reads Taxes from a CSV", () => {
    expect(parseCategory("Taxes")).toBe("Taxes");
    expect(parseCategory("tax")).toBe("Taxes");
  });
});
