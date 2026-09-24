import type { Account, Category, LineItem, Planning, Settings, SubCategory } from "./types";

const DEFAULT_SUBS: Record<Category, [string, string][]> = {
  Essentials: [
    ["rent", "Rent / Mortgage"],
    ["groceries", "Groceries"],
    ["insurance", "Insurance"],
    ["gas", "Gas / Transportation"],
    ["utilities", "Utilities"],
    ["car-payment", "Car Payment"]
  ],
  Wants: [
    ["dining", "Restaurants & Dining Out"],
    ["subscriptions", "Entertainment & Subscriptions"],
    ["travel-shopping", "Travel & Shopping"],
    ["vape", "Vape / Tobacco"],
    ["personal-care", "Personal Care"],
    ["misc-wants", "Misc / Other Wants"]
  ],
  Savings: [
    ["emergency", "Emergency Fund"],
    ["taxes", "Taxes / Estimated"],
    ["investing", "Investing / Brokerage"],
    ["retirement", "Retirement (401k/IRA)"],
    ["debt", "Debt Repayment"],
    ["other-savings", "Other Savings Goal"]
  ]
};

export function defaultSubCategories(): SubCategory[] {
  const out: SubCategory[] = [];
  let order = 0;
  (Object.keys(DEFAULT_SUBS) as Category[]).forEach((category) => {
    DEFAULT_SUBS[category].forEach(([id, name]) => {
      out.push({ id, name, category, order: order++, archived: false });
    });
  });
  return out;
}

export function defaultSettings(): Settings {
  return {
    takeHomeIncome: 5482.0,
    takeHomeNote: "Net pay every 15th",
    otherIncome: 0,
    targets: { Essentials: 50, Wants: 30, Savings: 20 },
    fixedExpenses: [
      { id: "fx-rent", name: "Rent / Mortgage", amount: 1813.98 },
      { id: "fx-car", name: "Car Payment", amount: 500.0 },
      { id: "fx-ins", name: "Insurance", amount: 227.0 },
      { id: "fx-util", name: "Utilities", amount: 150.0 }
    ],
    subCategories: defaultSubCategories(),
    wishlistSaved: 600.0,
    wishlistCategories: ["Furniture", "Decor", "Lighting", "Other"],
    wishlistRooms: ["Living Room", "Bathroom"],
    startPeriod: "2026-03",
    twelveDataKey: "",
    accounts: defaultAccounts()
  };
}

/** The starting accounts. Fixed ids so they are the same on every device before first save. */
export function defaultAccounts(): Account[] {
  const a = (id: string, name: string, kind: Account["kind"], order: number): Account => ({
    id, name, kind, order, archived: false, balance: 0, balanceSetAt: 0, creditLimit: null, dueDay: null
  });
  return [
    a("acct-local-checking", "Local", "checking", 0),
    a("acct-national-checking", "National", "checking", 1),
    a("acct-savings", "Savings", "savings", 2),
    a("acct-local-card", "Local", "credit", 3),
    a("acct-student-card", "Student", "credit", 4),
    a("acct-main-card", "Main", "credit", 5)
  ];
}

export const RECOMMENDED_RANGES: Record<Category, string> = {
  Essentials: "40 to 50%",
  Wants: "20 to 30%",
  Savings: "20% or more"
};

/** Line items for a brand new budget: every active sub, fixed expenses prefilled. */
export function seedLineItems(settings: Settings): LineItem[] {
  const byName = new Map(settings.fixedExpenses.map((f) => [f.name.trim().toLowerCase(), f.amount]));
  return [...settings.subCategories]
    .filter((s) => !s.archived)
    .sort((a, b) => a.order - b.order)
    .map((s) => ({
      id: `li-${s.id}`,
      subId: s.id,
      category: s.category,
      budgeted: byName.get(s.name.trim().toLowerCase()) ?? 0
    }));
}

export function defaultPlanning(): Planning {
  return {
    lines: [
      { id: "p1", label: "Current CC", formula: "0" },
      { id: "p2", label: "Remaining Cash Flow", formula: "[Current CC] - 1800" }
    ]
  };
}

/** Description hints used until your own history takes over. */
export const STARTER_HINTS: { description: string; category: Category; subId: string }[] = [
  { description: "Walmart", category: "Essentials", subId: "groceries" },
  { description: "iCloud", category: "Wants", subId: "subscriptions" }
];
