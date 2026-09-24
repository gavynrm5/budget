import { round2, sum } from "./money";
import { periodOfDate, shiftPeriod } from "./periods";
import { txPeriod } from "./calc";
import type { ListField, Settings, SubCategory, Transaction, WishItem, WishList } from "./types";

export const itemTotal = (w: WishItem) => round2(w.price * (w.qty ?? 1));

export interface ListSummary {
  count: number;
  itemsTotal: number;
  /** Goal set by hand, else the total of the items. */
  goal: number;
  /** Starting amount plus every contribution logged to the list's budget line. */
  saved: number;
  contributions: number;
  left: number;
  progress: number; // 0 to 1
  boughtTotal: number;
  boughtCount: number;
  /** Pay periods from now through the target date's period, counting this one. Null with no target date. */
  periodsLeft: number | null;
  /** What to put in each pay period to reach the goal by the target date. */
  perPeriod: number | null;
}

/** Contributions are transactions logged to the list's sub-category, in any period. */
export function listSummary(list: WishList, items: WishItem[], txs: Transaction[], currentPeriod: string): ListSummary {
  const mine = items.filter((w) => w.listId === list.id);
  const itemsTotal = sum(mine.map(itemTotal));
  const goal = list.goalAmount ?? itemsTotal;
  const contributions = list.subId ? sum(txs.filter((t) => t.subId === list.subId).map((t) => t.amount)) : 0;
  const saved = round2(list.startingSaved + contributions);
  const left = round2(Math.max(0, goal - saved));
  const bought = mine.filter((w) => w.bought);
  let periodsLeft: number | null = null;
  if (list.targetDate) {
    const end = periodOfDate(list.targetDate);
    periodsLeft = 0;
    for (let p = currentPeriod; p <= end; p = shiftPeriod(p, 1)) periodsLeft++;
  }
  return {
    count: mine.length,
    itemsTotal,
    goal,
    saved,
    contributions,
    left,
    progress: goal > 0 ? Math.min(1, saved / goal) : saved > 0 ? 1 : 0,
    boughtTotal: sum(bought.map(itemTotal)),
    boughtCount: bought.length,
    periodsLeft,
    perPeriod: periodsLeft == null ? null : round2(periodsLeft > 0 ? left / periodsLeft : left)
  };
}

/** Contributions to a list during one pay period. */
export function contributedIn(list: WishList, txs: Transaction[], periodId: string): number {
  return list.subId ? sum(txs.filter((t) => t.subId === list.subId && txPeriod(t) === periodId).map((t) => t.amount)) : 0;
}

/** A new "<name> fund" sub-category under Savings for a list's budget line. */
export function fundSub(name: string, subs: SubCategory[], id: string): SubCategory {
  return { id, name: `${name.trim()} fund`, category: "Savings", order: Math.max(-1, ...subs.map((s) => s.order)) + 1, archived: false };
}

export const LEGACY_LIST_ID = "list-furniture";
export const LEGACY_FUND_ID = "sub-furniture-fund";

/**
 * Turns the first wishlist (one flat list with categories, rooms, status and a
 * single saved amount) into a "Furniture" list. Categories, rooms and status
 * become the list's own dropdowns; Ordered and Delivered items count as bought.
 */
export function legacyToList(settings: Settings, items: WishItem[]): { list: WishList; items: WishItem[]; sub: SubCategory } {
  const uniq = (xs: (string | undefined)[]) => [...new Set(xs.map((x) => (x ?? "").trim()).filter(Boolean))];
  const fields: ListField[] = [
    { id: "f-category", name: "Category", options: uniq([...settings.wishlistCategories, ...items.map((w) => w.category)]) },
    { id: "f-room", name: "Room", options: uniq([...settings.wishlistRooms, ...items.map((w) => w.room)]) },
    { id: "f-status", name: "Status", options: ["Idea", "Want", "Ordered", "Delivered"] }
  ];
  const sub = settings.subCategories.find((s) => s.id === LEGACY_FUND_ID) ?? fundSub("Furniture", settings.subCategories, LEGACY_FUND_ID);
  const list: WishList = {
    id: LEGACY_LIST_ID,
    name: "Furniture",
    order: 0,
    subId: sub.id,
    startingSaved: settings.wishlistSaved ?? 0,
    goalAmount: null,
    targetDate: null,
    fields
  };
  const converted = [...items]
    .sort((a, b) => a.order - b.order)
    .map((w, i) => {
      const values: Record<string, string> = {};
      if (w.category) values["f-category"] = w.category;
      if (w.room) values["f-room"] = w.room;
      if (w.status) values["f-status"] = w.status;
      return { ...w, listId: list.id, order: i, values, bought: w.status === "Ordered" || w.status === "Delivered" };
    });
  return { list, items: converted, sub };
}

/** Accepts only https images or photos stored as data URLs, so nothing odd gets rendered. */
export function safeImage(src?: string): string | null {
  if (!src) return null;
  if (/^data:image\/(jpeg|png|webp|gif);base64,/.test(src)) return src;
  if (/^https:\/\/\S+$/i.test(src)) return src;
  return null;
}

/** A shop link made clickable: adds https:// to bare domains; rejects anything else. */
export function asUrl(link: string): string | null {
  const s = link.trim();
  if (!s || /\s/.test(s)) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(s)) return `https://${s}`;
  return null;
}
