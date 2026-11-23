import { describe, expect, it } from "vitest";
import { findDuplicates } from "../importExport";
import type { Transaction } from "../types";

let n = 0;
const tx = (date: string, amount: number, description = ""): Transaction => ({
  id: `t${n++}`, date, amount, description, category: "Wants", subId: "dining", notes: ""
});

describe("findDuplicates", () => {
  it("skips rows with the same date and amount, whatever the description", () => {
    const logged = [tx("2026-11-18", 35.59, "Walmart")];
    const r = findDuplicates([tx("2026-11-18", 35.59, "WALMART #1234"), tx("2026-11-18", 12, "Shell")], logged);
    expect(r.duplicates).toHaveLength(1);
    expect(r.fresh.map((t) => t.description)).toEqual(["Shell"]);
  });
  it("lets each logged entry match only one row", () => {
    const r = findDuplicates([tx("2026-11-18", 5, "Coffee"), tx("2026-11-18", 5, "Coffee")], [tx("2026-11-18", 5, "Coffee")]);
    expect(r.duplicates).toHaveLength(1);
    expect(r.fresh).toHaveLength(1);
  });
  it("flags the same amount a few days apart as possible", () => {
    const r = findDuplicates([tx("2026-11-20", 48.1, "SHELL OIL")], [tx("2026-11-18", 48.1, "Shell")]);
    expect(r.possible).toHaveLength(1);
    expect(r.fresh).toHaveLength(0);
  });
  it("treats far-apart dates and different amounts as new", () => {
    const r = findDuplicates([tx("2026-11-25", 48.1), tx("2026-11-18", 48.11)], [tx("2026-11-18", 48.1)]);
    expect(r.fresh).toHaveLength(2);
  });
  it("gives exact matches first pick", () => {
    // The near row must not take the entry the exact row needs.
    const r = findDuplicates([tx("2026-11-19", 20), tx("2026-11-18", 20)], [tx("2026-11-18", 20)]);
    expect(r.duplicates.map((d) => d.row.date)).toEqual(["2026-11-18"]);
    expect(r.fresh.map((t) => t.date)).toEqual(["2026-11-19"]);
  });
});
