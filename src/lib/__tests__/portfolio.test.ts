import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPositions,
  computePortfolio,
  findOversell,
  isValidSymbol,
  LEGACY_NOTE,
  normalizeSymbol,
  portfolioSeries,
  sharesOn,
  signed,
  tradesFromLegacy
} from "../portfolio";
import { closeOn, fetchHistory, fetchQuotes, MarketError, type Quote } from "../marketData";
import { fmt } from "../money";
import type { Trade } from "../types";

let n = 0;
const t = (symbol: string, type: Trade["type"], date: string, shares: number, price: number): Trade => ({
  id: `t${++n}`,
  symbol,
  type,
  date,
  shares,
  price,
  notes: "",
  createdAt: n
});
const q = (price: number, change = 0): Quote => ({ name: "", price, change, prevClose: price - change, marketOpen: false, time: 0 });

describe("positions (average cost, like Robinhood)", () => {
  it("averages several buys of the same stock", () => {
    const p = buildPositions([t("VOO", "buy", "2025-01-10", 2, 400), t("VOO", "buy", "2025-06-01", 1, 490)]).VOO;
    expect(p.shares).toBe(3);
    expect(p.cost).toBe(1290);
    expect(p.avgCost).toBe(430);
    expect(p.realized).toBe(0);
  });

  it("books realized gain on a sale at the average cost", () => {
    const p = buildPositions([
      t("AAPL", "buy", "2025-01-10", 10, 150),
      t("AAPL", "buy", "2025-02-10", 10, 170),
      t("AAPL", "sell", "2025-03-10", 5, 200)
    ]).AAPL;
    expect(p.shares).toBe(15);
    expect(p.avgCost).toBe(160); // unchanged by a sale
    expect(p.cost).toBe(2400);
    expect(p.realized).toBe(200); // 5 x (200 - 160)
  });

  it("closes a position that is fully sold, keeping the realized gain", () => {
    const p = buildPositions([t("TSLA", "buy", "2025-01-10", 3, 300), t("TSLA", "sell", "2025-02-10", 3, 250)]).TSLA;
    expect(p.shares).toBe(0);
    expect(p.cost).toBe(0);
    expect(p.realized).toBe(-150);
  });

  it("processes trades by date, not by the order they were entered", () => {
    const p = buildPositions([t("VOO", "sell", "2025-03-01", 1, 500), t("VOO", "buy", "2025-01-01", 2, 400)]).VOO;
    expect(p.shares).toBe(1);
    expect(p.realized).toBe(100);
  });

  it("handles fractional shares without float drift", () => {
    const p = buildPositions([t("VOO", "buy", "2025-01-01", 0.1, 400), t("VOO", "buy", "2025-01-02", 0.2, 400), t("VOO", "sell", "2025-01-03", 0.3, 410)]).VOO;
    expect(p.shares).toBe(0);
    expect(p.realized).toBe(3);
  });
});

describe("sale checks", () => {
  const trades = [t("VOO", "buy", "2025-01-10", 2, 400), t("VOO", "sell", "2025-05-01", 1, 450)];
  it("counts shares held on a date", () => {
    expect(sharesOn(trades, "VOO", "2025-01-09")).toBe(0);
    expect(sharesOn(trades, "VOO", "2025-03-01")).toBe(2);
    expect(sharesOn(trades, "VOO", "2025-05-01")).toBe(1);
    expect(sharesOn(trades, "VOO", "2025-05-01", trades[1].id)).toBe(2);
  });
  it("finds a sale of more shares than were owned", () => {
    expect(findOversell(trades)).toBeNull();
    const bad = findOversell([...trades, t("VOO", "sell", "2025-06-01", 1.5, 460)]);
    expect(bad?.owned).toBe(1);
    // Removing the buy would leave the sale selling shares that were never bought.
    expect(findOversell([trades[1]])?.trade.id).toBe(trades[1].id);
  });
  it("lets a buy and a sale on the same day work either way they were entered", () => {
    expect(findOversell([t("VOO", "sell", "2025-01-10", 1, 410), t("VOO", "buy", "2025-01-10", 1, 400)])).toBeNull();
  });
});

describe("portfolio summary", () => {
  it("totals open positions and realized gains", () => {
    const trades = [
      t("VOO", "buy", "2025-01-10", 10, 400),
      t("AAPL", "buy", "2025-01-10", 5, 150),
      t("TSLA", "buy", "2025-01-10", 2, 300),
      t("TSLA", "sell", "2025-02-10", 2, 350)
    ];
    const s = computePortfolio(buildPositions(trades), { VOO: q(450, 5), AAPL: q(140, -2) });
    expect(s.value).toBe(5200); // 4500 + 700
    expect(s.cost).toBe(4750);
    expect(s.gain).toBe(450);
    expect(s.realized).toBe(100);
    expect(s.dayChange).toBe(40); // 10*5 + 5*-2
    expect(s.rows.map((r) => r.position.symbol)).toEqual(["VOO", "AAPL"]);
    expect(s.closed.map((p) => p.symbol)).toEqual(["TSLA"]);
    expect(s.rows[0].weight).toBeCloseTo(4500 / 5200, 10);
  });
  it("counts a stock with no price at what was paid", () => {
    const s = computePortfolio(buildPositions([t("ZZZZ", "buy", "2025-01-01", 3, 10)]), { ZZZZ: null });
    expect(s.value).toBe(30);
    expect(s.missing).toEqual(["ZZZZ"]);
  });
});

describe("value over time", () => {
  const trades = [t("VOO", "buy", "2025-01-02", 2, 100), t("VOO", "buy", "2025-01-06", 1, 106), t("VOO", "sell", "2025-01-08", 1, 110)];
  const hist = { VOO: [["2024-12-31", 99], ["2025-01-02", 101], ["2025-01-03", 103], ["2025-01-06", 105], ["2025-01-07", 108], ["2025-01-08", 111]] as [string, number][] };

  it("values shares held each day from the first trade", () => {
    const s = portfolioSeries(trades, hist, {}, "2025-01-09");
    expect(s.map((p) => p.date)).toEqual(["2025-01-02", "2025-01-03", "2025-01-06", "2025-01-07", "2025-01-08", "2025-01-09"]);
    expect(s[0]).toEqual({ date: "2025-01-02", value: 202, cost: 200 });
    expect(s[2]).toEqual({ date: "2025-01-06", value: 315, cost: 306 });
    expect(s[4]).toEqual({ date: "2025-01-08", value: 222, cost: 204 }); // sold 1 at avg 102
    expect(s[5].value).toBe(222); // no close yet: carries the last one
  });
  it("uses the live price for today", () => {
    const s = portfolioSeries(trades, hist, { VOO: q(120) }, "2025-01-09");
    expect(s[s.length - 1].value).toBe(240);
  });
  it("falls back to the trade price with no history", () => {
    expect(portfolioSeries([t("X", "buy", "2025-01-02", 2, 50)], {}, {}, "2025-01-05")).toEqual([
      { date: "2025-01-02", value: 100, cost: 100 },
      { date: "2025-01-05", value: 100, cost: 100 }
    ]);
  });
  it("finds the close on or before a date", () => {
    expect(closeOn(hist.VOO, "2025-01-04")).toBe(103);
    expect(closeOn(hist.VOO, "2024-12-01")).toBeNull();
    expect(closeOn(hist.VOO, "2030-01-01")).toBe(111);
  });
});

describe("converting first-version entries", () => {
  it("turns each holding into a dated buy", () => {
    const [tr] = tradesFromLegacy([{ id: "h1", symbol: "VOO", shares: 3, avgCost: 410, notes: "Roth", createdAt: 1 }], () => "2026-09-23");
    expect(tr).toMatchObject({ id: "h1", symbol: "VOO", type: "buy", date: "2026-09-23", shares: 3, price: 410 });
    expect(tr.notes).toContain("Roth");
    expect(tr.notes).toContain(LEGACY_NOTE);
  });
});

describe("symbols and formatting", () => {
  it("normalizes and validates tickers", () => {
    expect(normalizeSymbol(" brk.b ")).toBe("BRK.B");
    expect(isValidSymbol("BRK.B")).toBe(true);
    expect(isValidSymbol("1ABC")).toBe(false);
  });
  it("always shows the sign", () => {
    expect(signed(12.345, fmt)).toBe("+$12.35");
    expect(signed(-5, fmt)).toBe("-$5.00");
    expect(signed(0.001, fmt)).toBe("$0.00");
  });
});

describe("Twelve Data client", () => {
  afterEach(() => vi.unstubAllGlobals());
  const respond = (status: number, body: unknown) => {
    const f = vi.fn(async (_url: string) => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", f);
    return f;
  };
  const tdQuote = { symbol: "VOO", name: "Vanguard S&P 500 ETF", close: "548.2", previous_close: "545.1", change: "3.1", is_market_open: true, last_quote_at: 1790193540 };

  it("reads a single quote", async () => {
    const f = respond(200, tdQuote);
    const r = await fetchQuotes(["VOO"], "k");
    expect(r.VOO).toEqual({ name: "Vanguard S&P 500 ETF", price: 548.2, change: 3.1, prevClose: 545.1, marketOpen: true, time: 1790193540 });
    expect(f.mock.calls[0][0]).toContain("symbol=VOO");
  });
  it("reads several quotes in one request and marks unknown symbols", async () => {
    respond(200, { VOO: tdQuote, NOPE: { code: 404, message: "symbol not found", status: "error" } });
    const r = await fetchQuotes(["VOO", "NOPE"], "k");
    expect(r.VOO?.price).toBe(548.2);
    expect(r.NOPE).toBeNull();
  });
  it("returns null for a single unknown symbol", async () => {
    respond(200, { code: 404, message: "symbol not found", status: "error" });
    expect((await fetchQuotes(["NOPE"], "k")).NOPE).toBeNull();
  });
  it("reports a bad key and the rate limit", async () => {
    respond(401, { code: 401, message: "**apikey** parameter is incorrect", status: "error" });
    await expect(fetchQuotes(["VOO"], "bad")).rejects.toMatchObject({ kind: "bad-key" });
    respond(200, { code: 429, message: "You have run out of API credits for the current minute.", status: "error" });
    await expect(fetchQuotes(["VOO"], "k")).rejects.toBeInstanceOf(MarketError);
  });
  it("reads daily closes oldest first", async () => {
    const f = respond(200, { meta: {}, values: [{ datetime: "2025-01-02", close: "101.5" }, { datetime: "2025-01-03", close: "103" }], status: "ok" });
    expect(await fetchHistory("VOO", "2025-01-01", "k")).toEqual([["2025-01-02", 101.5], ["2025-01-03", 103]]);
    expect(f.mock.calls[0][0]).toContain("start_date=2025-01-01");
  });
});
