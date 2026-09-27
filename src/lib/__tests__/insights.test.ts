import { describe, expect, it } from "vitest";
import { buildInsights, excludedSubs, factsKey, merchantKey, ruleTips, type Fact } from "../insights";
import { defaultSettings, seedLineItems } from "../defaults";
import type { PeriodBudget, Transaction, WishList } from "../types";

const s = defaultSettings();
const lines = seedLineItems(s).map((li) => (li.subId === "dining" ? { ...li, budgeted: 200 } : li.subId === "groceries" ? { ...li, budgeted: 400 } : li));
const periods: Record<string, PeriodBudget> = { "2026-09": { id: "2026-09", lineItems: lines } };
let n = 0;
const tx = (date: string, amount: number, subId = "dining", description = "", category: Transaction["category"] = "Wants"): Transaction => ({
  id: `t${++n}`, date, amount, subId, category, description, notes: ""
});
const run = (transactions: Transaction[], today = "2026-09-24", wishLists: WishList[] = []) =>
  buildInsights({ periodId: "2026-09", today, periods, transactions, settings: s, extraIncome: [], wishLists, wishlist: [] });
const find = <K extends Fact["kind"]>(facts: Fact[], kind: K) => facts.filter((f): f is Extract<Fact, { kind: K }> => f.kind === kind);

describe("what tips leave out", () => {
  it("skips fixed bills and every Savings & Debt sub", () => {
    const ex = excludedSubs(s);
    expect(["rent", "car-payment", "insurance", "utilities", "emergency", "debt"].every((id) => ex.has(id))).toBe(true);
    expect(ex.has("dining")).toBe(false);
    expect(ex.has("groceries")).toBe(false);
  });

  it("never flags rent even when it runs over", () => {
    const d = run([tx("2026-09-16", 5000, "rent", "Landlord", "Essentials")]);
    expect(d.facts.some((f) => "subId" in f && f.subId === "rent")).toBe(false);
  });
});

describe("pace and over budget", () => {
  it("projects the period's total and the daily amount that keeps it on budget", () => {
    // Day 10 of 30: $120 spent of $200 projects to $360.
    const d = run([tx("2026-09-16", 70, "dining", "Sushi"), tx("2026-09-20", 50, "dining", "Tacos")]);
    expect(d.day).toBe(10);
    const pace = find(d.facts, "pace")[0];
    expect(pace).toMatchObject({ subId: "dining", spent: 120, available: 200, projected: 360, overBy: 160, daysLeft: 20 });
    expect(pace.perDayToStay).toBe(4); // (200 - 120) / 20
  });

  it("counts repeating charges once instead of projecting them", () => {
    const subsLines = { "2026-09": { id: "2026-09", lineItems: seedLineItems(s).map((li) => (li.subId === "subscriptions" ? { ...li, budgeted: 40 } : li)) } };
    const netflix = [tx("2026-07-18", 15.99, "subscriptions", "Netflix"), tx("2026-08-18", 15.99, "subscriptions", "Netflix"), tx("2026-09-18", 15.99, "subscriptions", "Netflix")];
    const spotify = [tx("2026-08-20", 11.99, "subscriptions", "Spotify"), tx("2026-09-20", 11.99, "subscriptions", "Spotify")];
    const d = buildInsights({ periodId: "2026-09", today: "2026-09-24", periods: subsLines, transactions: [...netflix, ...spotify], settings: s, extraIncome: [], wishLists: [], wishlist: [] });
    expect(find(d.facts, "pace")).toHaveLength(0); // $27.98 of $40, and it won't repeat this period
  });

  it("waits a few days before calling a pace, but flags a line that is already over", () => {
    expect(find(run([tx("2026-09-15", 30)], "2026-09-16").facts, "pace")).toHaveLength(0);
    const over = find(run([tx("2026-09-15", 230)], "2026-09-16").facts, "over")[0];
    expect(over).toMatchObject({ subId: "dining", over: 30 });
  });
});

describe("compared with the usual", () => {
  const history = [
    tx("2026-08-16", 40, "groceries", "Walmart", "Essentials"), tx("2026-08-30", 40, "groceries", "Walmart", "Essentials"),
    tx("2026-07-16", 60, "groceries", "Walmart", "Essentials"), tx("2026-07-20", 10, "groceries", "Walmart", "Essentials")
  ];

  it("compares with earlier periods at the same point, not their full totals", () => {
    // By day 10 usually: Aug $40, Jul $70, so $55 on average.
    const d = run([...history, tx("2026-09-17", 90, "groceries", "Costco", "Essentials")]);
    const up = find(d.facts, "trend")[0];
    expect(d.history).toEqual(["2026-08", "2026-07"]);
    expect(up).toMatchObject({ direction: "up", spentSoFar: 90, usualByNow: 55, changePct: 64, periodsCompared: 2 });
  });

  it("notices when spending is down", () => {
    const more = [...history, tx("2026-08-17", 60, "groceries", "Costco", "Essentials")];
    const down = find(run([...more, tx("2026-09-17", 20, "groceries", "Aldi", "Essentials")]).facts, "trend")[0];
    expect(down.direction).toBe("down");
  });
});

describe("habits and subscriptions", () => {
  it("groups repeat visits even when store numbers differ", () => {
    expect(merchantKey("STARBUCKS #1234")).toBe("starbucks");
    expect(merchantKey("Starbucks 00981233")).toBe("starbucks");
    const d = run([tx("2026-09-16", 6.5, "dining", "Starbucks"), tx("2026-09-18", 7.25, "dining", "STARBUCKS #22"), tx("2026-09-21", 5.75, "dining", "starbucks")]);
    expect(find(d.facts, "habit")[0]).toMatchObject({ count: 3, total: 19.5, average: 6.5 });
  });

  it("finds charges that repeat each period at about the same amount", () => {
    const d = run([
      tx("2026-07-18", 15.99, "subscriptions", "Netflix"), tx("2026-08-18", 15.99, "subscriptions", "Netflix"), tx("2026-09-18", 17.99, "subscriptions", "Netflix"),
      tx("2026-08-20", 11.99, "subscriptions", "Spotify"), tx("2026-09-20", 11.99, "subscriptions", "Spotify"),
      tx("2026-08-22", 45, "dining", "Olive Garden"), tx("2026-09-22", 80, "dining", "Olive Garden"),
      tx("2026-08-16", 12.5, "dining", "Chipotle"), tx("2026-09-29", 12.5, "dining", "Chipotle") // same price, different days: not a subscription
    ]);
    const subs = find(d.facts, "subscriptions")[0];
    expect(subs.items.map((i) => i.name)).toEqual(["Netflix", "Spotify"]);
    expect(subs.perMonth).toBe(29.98);
  });
});

describe("goals", () => {
  it("shows how moving an overspend into a goal gets there sooner", () => {
    const fund = { id: "fund", name: "Furniture fund", category: "Savings" as const, order: 99, archived: false };
    const settings = { ...s, subCategories: [...s.subCategories, fund] };
    const list: WishList = { id: "L", name: "Furniture", order: 0, subId: "fund", startingSaved: 0, goalAmount: 1200, targetDate: null, fields: [] };
    const txs = [
      tx("2026-06-20", 100, "fund", "", "Savings"), tx("2026-07-20", 100, "fund", "", "Savings"), tx("2026-08-20", 100, "fund", "", "Savings"),
      tx("2026-09-16", 70, "dining", "Sushi"), tx("2026-09-20", 50, "dining", "Tacos")
    ];
    const d = buildInsights({ periodId: "2026-09", today: "2026-09-24", periods, transactions: txs, settings, extraIncome: [], wishLists: [list], wishlist: [] });
    // $900 left; $100 a month now = 9 months; overspend pace $160 -> cut $160 -> 900/260 = 4 months.
    expect(find(d.facts, "goal")[0]).toMatchObject({ listName: "Furniture", left: 900, savingPerPeriod: 100, periodsAtCurrentPace: 9, cut: 160, cutFrom: "Restaurants & Dining Out", periodsWithCut: 4, periodsSooner: 5 });
  });
});

describe("rule tips", () => {
  it("writes one tip per fact, most urgent first, with plain numbers", () => {
    const d = run([tx("2026-09-16", 70, "dining", "Sushi"), tx("2026-09-20", 50, "dining", "Tacos"), tx("2026-09-16", 400, "groceries", "Costco", "Essentials"), tx("2026-09-17", 30, "groceries", "Aldi", "Essentials")]);
    const tips = ruleTips(d.facts);
    expect(tips[0].id).toBe("over:groceries");
    expect(tips[0].title).toBe("Groceries is $30 over");
    expect(tips[1].body).toContain("Keep it under $4 a day for the next 20 days");
    expect(tips.every((t) => t.factIds.length === 1)).toBe(true);
  });

  it("only changes the fingerprint when the facts meaningfully change", () => {
    const a = run([tx("2026-09-16", 120, "dining")]);
    const b = run([tx("2026-09-16", 121, "dining")]);
    const c = run([tx("2026-09-16", 180, "dining")]);
    expect(factsKey(a)).toBe(factsKey(b));
    expect(factsKey(a)).not.toBe(factsKey(c));
  });
});

describe("Claude tips request", () => {
  const facts = run([tx("2026-09-16", 70, "dining", "Sushi"), tx("2026-09-20", 50, "dining", "Tacos")]);
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "request-id": "req_test" } });
  const message = (text: string, stop_reason = "end_turn") => ({
    id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5", stop_reason, stop_sequence: null,
    content: [{ type: "text", text }], usage: { input_tokens: 900, output_tokens: 200 }
  });

  it("sends only the facts, with fallbacks and structured output, and keeps real fact ids", async () => {
    const { vi } = await import("vitest");
    let sent: { url: string; headers: Headers; body: Record<string, unknown> } | null = null;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      sent = { url, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) };
      return reply(message(JSON.stringify({ tips: [
        { factIds: ["pace:dining", "made-up"], title: "Dining is running hot", body: "Keep it to $4 a day.", tone: "warning", savings: 160.4 },
        { factIds: [], title: "Nice start", body: "You're logging everything.", tone: "praise", savings: null }
      ] })));
    }));
    const { aiTips } = await import("../aiTips");
    const tips = await aiTips(facts, "sk-ant-test");
    vi.unstubAllGlobals();

    expect(sent!.url).toContain("/v1/messages");
    expect(sent!.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(sent!.headers.get("x-api-key")).toBe("sk-ant-test");
    expect(sent!.body).toMatchObject({ model: "claude-opus-5", fallbacks: "default", thinking: { type: "adaptive" } });
    expect((sent!.body.output_config as { format: { type: string } }).format.type).toBe("json_schema");
    const content = JSON.stringify(sent!.body.messages);
    expect(content).toContain("pace:dining");
    expect(content).not.toMatch(/Sushi|Tacos/); // descriptions only appear inside repeat-purchase facts
    expect(tips[0]).toMatchObject({ id: "ai:pace:dining", factIds: ["pace:dining"], savings: 160 });
    expect(tips[1]).toMatchObject({ id: "ai:general-1", factIds: [], savings: null });
  });

  it("reports a bad key and a refusal clearly", async () => {
    const { vi } = await import("vitest");
    const { aiTips } = await import("../aiTips");
    vi.stubGlobal("fetch", vi.fn(async () => reply({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, 401)));
    await expect(aiTips(facts, "bad")).rejects.toMatchObject({ kind: "bad-key" });
    vi.stubGlobal("fetch", vi.fn(async () => reply({ ...message(""), content: [], stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: null } })));
    await expect(aiTips(facts, "k")).rejects.toMatchObject({ kind: "refused" });
    vi.unstubAllGlobals();
  });
});
