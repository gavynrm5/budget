import { describe, expect, it } from "vitest";
import { asUrl, contributedIn, fundSub, legacyToList, LEGACY_FUND_ID, LEGACY_LIST_ID, listSummary, safeImage } from "../wishlist";
import { defaultSettings } from "../defaults";
import type { Transaction, WishItem, WishList } from "../types";

const list = (p: Partial<WishList> = {}): WishList => ({
  id: "L",
  name: "Furniture",
  order: 0,
  subId: "fund",
  startingSaved: 100,
  goalAmount: null,
  targetDate: null,
  fields: [],
  ...p
});
const item = (p: Partial<WishItem>): WishItem => ({ id: Math.random().toString(36), listId: "L", item: "Chair", price: 100, qty: null, link: "", notes: "", order: 0, ...p });
const tx = (amount: number, date: string, subId = "fund"): Transaction => ({ id: date + amount, date, amount, category: "Savings", subId, description: "", notes: "" });

describe("list goal", () => {
  const items = [item({ price: 400 }), item({ price: 250, qty: 2, bought: true }), item({ listId: "other", price: 999 })];
  const txs = [tx(200, "2026-08-20"), tx(150, "2026-09-16"), tx(75, "2026-09-16", "groceries")];

  it("adds the starting amount to every contribution logged to the fund line", () => {
    const s = listSummary(list(), items, txs, "2026-09");
    expect(s.count).toBe(2);
    expect(s.itemsTotal).toBe(900);
    expect(s.goal).toBe(900);
    expect(s.contributions).toBe(350);
    expect(s.saved).toBe(450);
    expect(s.left).toBe(450);
    expect(s.progress).toBe(0.5);
    expect(s.boughtTotal).toBe(500);
    expect(s.boughtCount).toBe(1);
    expect(s.perPeriod).toBeNull();
  });

  it("uses a goal set by hand and works out the pace to a target date", () => {
    // Sep, Oct, Nov, Dec periods: Dec 20 falls in the Dec 15 to Jan 14 period.
    const s = listSummary(list({ goalAmount: 1250, targetDate: "2026-12-20" }), items, txs, "2026-09");
    expect(s.goal).toBe(1250);
    expect(s.left).toBe(800);
    expect(s.periodsLeft).toBe(4);
    expect(s.perPeriod).toBe(200);
  });

  it("asks for the whole rest when the target date has passed, and caps progress at 100%", () => {
    expect(listSummary(list({ targetDate: "2026-06-01" }), items, txs, "2026-09").perPeriod).toBe(450);
    expect(listSummary(list({ goalAmount: 300 }), items, txs, "2026-09").progress).toBe(1);
  });

  it("counts nothing when the list isn't tracked in the budget", () => {
    expect(listSummary(list({ subId: null }), items, txs, "2026-09").saved).toBe(100);
  });

  it("sums one pay period's contributions", () => {
    expect(contributedIn(list(), txs, "2026-09")).toBe(150);
    expect(contributedIn(list(), txs, "2026-08")).toBe(200);
  });

  it("names the fund line after the list", () => {
    expect(fundSub(" Japan trip ", defaultSettings().subCategories, "x")).toMatchObject({ id: "x", name: "Japan trip fund", category: "Savings", archived: false });
  });
});

describe("converting the first wishlist", () => {
  it("moves every item into a Furniture list with dropdowns from its old categories, rooms and status", () => {
    const s = { ...defaultSettings(), wishlistSaved: 600, wishlistCategories: ["Furniture", "Decor"], wishlistRooms: ["Living Room"] };
    const old = [
      item({ id: "a", listId: undefined, category: "Furniture", room: "Bedroom", status: "Ordered", order: 5 }),
      item({ id: "b", listId: undefined, category: "Lighting", room: "", status: "Idea", order: 2 })
    ];
    const { list: l, items, sub } = legacyToList(s, old);
    expect(l).toMatchObject({ id: LEGACY_LIST_ID, name: "Furniture", startingSaved: 600, subId: LEGACY_FUND_ID });
    expect(sub).toMatchObject({ id: LEGACY_FUND_ID, name: "Furniture fund", category: "Savings" });
    expect(l.fields.find((f) => f.name === "Category")?.options).toEqual(["Furniture", "Decor", "Lighting"]);
    expect(l.fields.find((f) => f.name === "Room")?.options).toEqual(["Living Room", "Bedroom"]);
    expect(items.map((w) => [w.id, w.order, w.bought])).toEqual([["b", 0, false], ["a", 1, true]]);
    expect(items[1].values).toEqual({ "f-category": "Furniture", "f-room": "Bedroom", "f-status": "Ordered" });
    expect(items.every((w) => w.listId === LEGACY_LIST_ID)).toBe(true);
  });
});

describe("links and images", () => {
  it("only renders https images and stored photos", () => {
    expect(safeImage("https://cdn.store.com/a.jpg")).toBe("https://cdn.store.com/a.jpg");
    expect(safeImage("data:image/jpeg;base64,AAAA")).toBe("data:image/jpeg;base64,AAAA");
    expect(safeImage("http://insecure.com/a.jpg")).toBeNull();
    expect(safeImage("javascript:alert(1)")).toBeNull();
    expect(safeImage("data:text/html;base64,AAAA")).toBeNull();
  });
  it("makes store links clickable", () => {
    expect(asUrl("wayfair.com/table")).toBe("https://wayfair.com/table");
    expect(asUrl("https://ikea.com")).toBe("https://ikea.com");
    expect(asUrl("javascript:alert(1)")).toBeNull();
    expect(asUrl("Wayfair")).toBeNull();
  });
});
