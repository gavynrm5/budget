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
}

export type WishStatus = "Idea" | "Want" | "Ordered" | "Delivered";
export const WISH_STATUSES: WishStatus[] = ["Idea", "Want", "Ordered", "Delivered"];

export interface WishItem {
  id: string;
  item: string;
  category: string;
  room: string;
  status: WishStatus;
  price: number;
  qty: number | null; // null means 1
  link: string;
  notes: string;
  order: number;
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
