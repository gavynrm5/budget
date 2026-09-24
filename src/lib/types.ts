export type Category = "Essentials" | "Wants" | "Savings";
export const CATEGORIES: Category[] = ["Essentials", "Wants", "Savings"];
export const CATEGORY_LABEL: Record<Category, string> = {
  Essentials: "Essentials",
  Wants: "Wants",
  Savings: "Savings & Debt"
};

/** A sub-category in the master list. `category` is its default group. */
export interface SubCategory {
  id: string;
  name: string;
  category: Category;
  order: number;
  archived: boolean;
}

export interface FixedExpense {
  id: string;
  name: string;
  amount: number;
}

export interface Settings {
  takeHomeIncome: number;
  takeHomeNote: string;
  otherIncome: number;
  targets: Record<Category, number>; // percent, e.g. 40
  fixedExpenses: FixedExpense[];
  subCategories: SubCategory[];
  wishlistSaved: number;
  wishlistCategories: string[];
  wishlistRooms: string[];
  /** First period shown in overviews, "YYYY-MM". */
  startPeriod: string;
  /** Free Twelve Data API key for stock prices. Empty until the user adds one. */
  twelveDataKey: string;
  /** Bank accounts and credit cards, by nickname only. */
  accounts: Account[];
}

export type AccountKind = "checking" | "savings" | "credit";
export const ACCOUNT_KINDS: AccountKind[] = ["checking", "savings", "credit"];
export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = { checking: "Checking", savings: "Savings", credit: "Credit card" };

/**
 * A bank account or credit card. Only a nickname is stored, never numbers or
 * bank names. The balance is the one the user last set (for a card, the
 * amount owed) plus everything logged after that.
 */
export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  order: number;
  archived: boolean;
  balance: number;
  /** When `balance` was set (ms). Entries logged after it, and dated that day or later, move the balance. */
  balanceSetAt: number;
  creditLimit: number | null;
  /** Day of the month a card payment is due, 1 to 31. */
  dueDay: number | null;
}

/** One budget line inside a period. Category can differ from the sub's default. */
export interface LineItem {
  id: string;
  subId: string;
  category: Category;
  budgeted: number;
}

export interface PeriodBudget {
  id: string; // "YYYY-MM" of the starting month
  lineItems: LineItem[];
}

export interface Transaction {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  expression?: string; // e.g. "29.76+5.83" when math was typed
  category: Category;
  subId: string;
  description: string;
  notes: string;
  periodOverride?: string | null; // "YYYY-MM" when manually set
  createdAt?: number;
  /** Account or card it was paid with. Missing or null means not set. */
  accountId?: string | null;
}

/** Money moved between two of the user's own accounts, like paying a card from checking. */
export interface Transfer {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  fromId: string;
  toId: string;
  notes: string;
  createdAt?: number;
}

/** Part of an extra income entry assigned to a sub-category's budget in its period. */
export interface Allocation {
  subId: string;
  amount: number;
}

/** Money outside regular pay, like a birthday gift or gambling winnings. */
export interface ExtraIncome {
  id: string;
  date: string; // YYYY-MM-DD; its pay period comes from this date
  amount: number;
  source: string;
  accountId: string | null;
  notes: string;
  allocations: Allocation[];
  createdAt?: number;
}

export type WishStatus = "Idea" | "Want" | "Ordered" | "Delivered";
export const WISH_STATUSES: WishStatus[] = ["Idea", "Want", "Ordered", "Delivered"];

export interface WishItem {
  id: string;
  /** The list (folder) it belongs to. Missing only on items from before lists existed. */
  listId?: string;
  item: string;
  price: number;
  qty: number | null; // null means 1
  link: string;
  notes: string;
  /** Position in its list, lowest first. */
  order: number;
  /** A photo (shrunk, stored as a data: URL) or an https image link. */
  image?: string;
  /** The item's choice for each of its list's dropdowns, by field id. */
  values?: Record<string, string>;
  bought?: boolean;
  // First version fields, only read when converting old items into a list.
  category?: string;
  room?: string;
  status?: WishStatus;
}

/** A dropdown the user defines on a list, like Room or Style, with its choices. */
export interface ListField {
  id: string;
  name: string;
  options: string[];
}

/** A wishlist folder with its own savings goal, like Furniture. */
export interface WishList {
  id: string;
  name: string;
  order: number;
  /** Sub-category whose transactions count as contributions, shown as a Period Budget line. */
  subId: string | null;
  /** Already saved before tracking started. */
  startingSaved: number;
  /** Goal amount when set by hand; otherwise the total of its items. */
  goalAmount: number | null;
  targetDate: string | null; // YYYY-MM-DD
  fields: ListField[];
  createdAt?: number;
}

export interface PlanLine {
  id: string;
  label: string;
  formula: string; // a number or a formula like "[Current CC] - 1800"
}

export interface Planning {
  lines: PlanLine[];
}

export type TradeType = "buy" | "sell";

/** One buy or sell of a stock or ETF, as shown in the brokerage's history. */
export interface Trade {
  id: string;
  symbol: string; // uppercase ticker, e.g. "VOO"
  type: TradeType;
  date: string; // YYYY-MM-DD
  shares: number;
  price: number; // per share
  notes: string;
  createdAt?: number;
}

/** First portfolio version: one line per stock. Only read to convert into trades. */
export interface LegacyHolding {
  id: string;
  symbol: string;
  shares: number;
  avgCost: number;
  notes: string;
  createdAt?: number;
}
