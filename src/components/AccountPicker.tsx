import { CreditCard, Landmark, PiggyBank } from "lucide-react";
import { accountLabel, activeAccounts } from "../lib/accounts";
import type { Account, AccountKind } from "../lib/types";

export const ACCOUNT_ICON: Record<AccountKind, typeof Landmark> = { checking: Landmark, savings: PiggyBank, credit: CreditCard };

const LAST_KEY = "last-account";

/** The account used on the last new entry, remembered on this device. */
export function lastAccountId(accounts: Account[]): string | null {
  try {
    const id = localStorage.getItem(LAST_KEY);
    return id && accounts.some((a) => a.id === id && !a.archived) ? id : null;
  } catch {
    return null;
  }
}

export function rememberAccount(id: string | null) {
  try {
    if (id) localStorage.setItem(LAST_KEY, id);
  } catch {
    /* private mode */
  }
}

/** Tap-to-pick account chips. `allowNone` adds "Not set". Keeps an archived current choice selectable. */
export function AccountPicker({
  id,
  label,
  accounts,
  value,
  onChange,
  allowNone = true,
  exclude
}: {
  id: string;
  label: string;
  accounts: Account[];
  value: string | null;
  onChange: (id: string | null) => void;
  allowNone?: boolean;
  exclude?: string | null;
}) {
  const list = activeAccounts(accounts).filter((a) => a.id !== exclude);
  const current = value ? accounts.find((a) => a.id === value) : undefined;
  if (current && !list.some((a) => a.id === current.id)) list.push(current);
  const chip = (selected: boolean) =>
    `inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors duration-150 ${
      selected ? "border-primary bg-primary text-on-primary" : "border-line bg-surface hover:bg-surface-2"
    }`;
  return (
    <fieldset>
      <legend className="label">{label}</legend>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {allowNone && (
          <button id={`${id}-none`} type="button" role="radio" aria-checked={!value} onClick={() => onChange(null)} className={chip(!value)}>
            Not set
          </button>
        )}
        {list.map((a, i) => {
          const Icon = ACCOUNT_ICON[a.kind];
          return (
            <button
              key={a.id}
              id={!allowNone && i === 0 ? id : undefined}
              type="button"
              role="radio"
              aria-checked={value === a.id}
              onClick={() => onChange(a.id)}
              className={chip(value === a.id)}
            >
              <Icon size={15} aria-hidden /> {accountLabel(a)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
