import { afterEach, describe, expect, it, vi } from "vitest";
import { computePortfolio, fetchQuote, historySince, isValidSymbol, normalizeSymbol, QuoteError, signed } from "../portfolio";
import { fmt } from "../money";
import type { Holding } from "../types";

const h = (symbol: string, shares: number, avgCost: number): Holding => ({ id: symbol, symbol, shares, avgCost, notes: "" });
const q = (price: number, change = 0) => ({ price, change, prevClose: price - change, time: 1_700_000_000 });

describe("portfolio math", () => {
  it("computes value, gain, today's change and weights", () => {
    const p = computePortfolio([h("VOO", 10, 400), h("AAPL", 5, 150)], { VOO: q(450, 5), AAPL: q(140, -2) });
    expect(p.value).toBe(5200); // 4500 + 700
    expect(p.cost).toBe(4750); // 4000 + 750
    expect(p.gain).toBe(450);
    expect(p.gainPct).toBeCloseTo(450 / 4750, 10);
    expect(p.dayChange).toBe(40); // 10*5 + 5*-2
    expect(p.dayChangePct).toBeCloseTo(40 / 5160, 10);
    expect(p.rows.map((r) => r.holding.symbol)).toEqual(["VOO", "AAPL"]); // biggest first
    expect(p.rows[0].weight).toBeCloseTo(4500 / 5200, 10);
    expect(p.rows[1].gain).toBe(-50);
    expect(p.missing).toEqual([]);
  });

  it("counts a holding with no price at what was paid", () => {
    const p = computePortfolio([h("VOO", 2, 100), h("ZZZZ", 3, 10)], { VOO: q(110), ZZZZ: null });
    expect(p.value).toBe(250); // 220 + 30 at cost
    expect(p.gain).toBe(20);
    expect(p.missing).toEqual(["ZZZZ"]);
    expect(p.rows.find((r) => r.holding.symbol === "ZZZZ")?.gainPct).toBeNull();
  });

  it("handles an empty portfolio and fractional shares", () => {
    expect(computePortfolio([], {}).gainPct).toBeNull();
    expect(computePortfolio([h("VTI", 0.123456, 250)], { VTI: q(300) }).value).toBe(37.04);
  });
});

describe("symbols and formatting", () => {
  it("normalizes and validates tickers", () => {
    expect(normalizeSymbol(" brk.b ")).toBe("BRK.B");
    expect(isValidSymbol("VOO")).toBe(true);
    expect(isValidSymbol("BRK.B")).toBe(true);
    expect(isValidSymbol("1ABC")).toBe(false);
    expect(isValidSymbol("")).toBe(false);
  });
  it("always shows the sign", () => {
    expect(signed(12.345, fmt)).toBe("+$12.35");
    expect(signed(-5, fmt)).toBe("-$5.00");
    expect(signed(0.001, fmt)).toBe("$0.00");
  });
  it("filters history by date, oldest first", () => {
    const hist = [{ id: "2026-09-10", value: 2, cost: 1 }, { id: "2026-08-01", value: 1, cost: 1 }];
    expect(historySince(hist, "2026-09-01").map((s) => s.id)).toEqual(["2026-09-10"]);
    expect(historySince(hist, null).map((s) => s.id)).toEqual(["2026-08-01", "2026-09-10"]);
  });
});

describe("fetchQuote", () => {
  afterEach(() => vi.unstubAllGlobals());
  const respond = (status: number, body: unknown) =>
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));

  it("maps Finnhub's quote fields", async () => {
    respond(200, { c: 450.5, d: 2.5, dp: 0.56, pc: 448, t: 1_700_000_000 });
    expect(await fetchQuote("VOO", "k")).toEqual({ price: 450.5, change: 2.5, prevClose: 448, time: 1_700_000_000 });
  });
  it("returns null for an unknown symbol", async () => {
    respond(200, { c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 });
    expect(await fetchQuote("NOPE", "k")).toBeNull();
  });
  it("reports a bad key and rate limits", async () => {
    respond(401, { error: "Invalid API key." });
    await expect(fetchQuote("VOO", "bad")).rejects.toMatchObject({ kind: "bad-key" });
    respond(429, {});
    await expect(fetchQuote("VOO", "k")).rejects.toBeInstanceOf(QuoteError);
  });
});
