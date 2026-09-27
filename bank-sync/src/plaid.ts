/**
 * Minimal Plaid client over fetch (Plaid's Node SDK depends on axios, which
 * doesn't suit Workers). Only read-only products are used: Transactions,
 * whose sync also returns current account balances.
 */

export interface PlaidEnv {
  PLAID_CLIENT_ID: string;
  PLAID_SECRET: string;
  PLAID_ENV: string; // "production" or "sandbox"
}

export class PlaidError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number
  ) {
    super(message);
  }
}

async function call<T>(env: PlaidEnv, path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://${env.PLAID_ENV}.plaid.com${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET, ...body })
  });
  const data = (await res.json()) as T & { error_code?: string; error_message?: string };
  if (!res.ok) throw new PlaidError(data.error_code ?? "UNKNOWN", data.error_message ?? `Plaid returned ${res.status}`, res.status);
  return data;
}

/** A Link token for connecting a new bank, or for fixing an existing connection (update mode). */
export async function linkToken(env: PlaidEnv, uid: string, accessToken?: string): Promise<string> {
  const body: Record<string, unknown> = {
    client_name: "Pay Period Budget",
    language: "en",
    country_codes: ["US"],
    user: { client_user_id: uid }
  };
  if (accessToken) body.access_token = accessToken; // update mode omits products
  else {
    body.products = ["transactions"];
    body.transactions = { days_requested: 90 };
  }
  return (await call<{ link_token: string }>(env, "/link/token/create", body)).link_token;
}

export async function exchange(env: PlaidEnv, publicToken: string): Promise<{ accessToken: string; itemId: string }> {
  const r = await call<{ access_token: string; item_id: string }>(env, "/item/public_token/exchange", { public_token: publicToken });
  return { accessToken: r.access_token, itemId: r.item_id };
}

export interface PlaidAccount {
  account_id: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
  balances: { current: number | null; available: number | null; limit: number | null };
}

export async function accounts(env: PlaidEnv, accessToken: string): Promise<PlaidAccount[]> {
  return (await call<{ accounts: PlaidAccount[] }>(env, "/accounts/get", { access_token: accessToken })).accounts;
}

export interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  amount: number; // positive = money out, negative = money in
  date: string;
  authorized_date: string | null;
  name: string;
  merchant_name: string | null;
  pending: boolean;
  pending_transaction_id: string | null;
  personal_finance_category: { primary: string; detailed: string } | null;
}

export interface SyncResult {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: string[];
  nextCursor: string;
  accounts: PlaidAccount[];
  status: string | null;
}

interface SyncPage {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: { transaction_id: string }[];
  next_cursor: string;
  has_more: boolean;
  accounts: PlaidAccount[];
  transactions_update_status?: string;
}

/**
 * Every update since `cursor`, following pages until has_more is false. If the
 * data changes mid-way, Plaid asks for the whole loop to restart from the first cursor.
 */
export async function syncAll(env: PlaidEnv, accessToken: string, cursor: string | null): Promise<SyncResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const out: SyncResult = { added: [], modified: [], removed: [], nextCursor: cursor ?? "", accounts: [], status: null };
    let next = cursor;
    try {
      for (let page = 0; page < 50; page++) {
        const body: Record<string, unknown> = { access_token: accessToken, count: 500 };
        if (next) body.cursor = next;
        const r = await call<SyncPage>(env, "/transactions/sync", body);
        out.added.push(...r.added.map(slim));
        out.modified.push(...r.modified.map(slim));
        out.removed.push(...r.removed.map((x) => x.transaction_id));
        out.accounts = r.accounts;
        out.status = r.transactions_update_status ?? null;
        out.nextCursor = r.next_cursor;
        next = r.next_cursor;
        if (!r.has_more) return out;
      }
      return out;
    } catch (e) {
      if (e instanceof PlaidError && e.code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION") continue;
      throw e;
    }
  }
  throw new PlaidError("SYNC_RETRY_EXHAUSTED", "Transactions kept changing during sync. Try again shortly.", 503);
}

/** Only the fields the app uses, so less data leaves the worker. */
function slim(t: PlaidTransaction): PlaidTransaction {
  return {
    transaction_id: t.transaction_id,
    account_id: t.account_id,
    amount: t.amount,
    date: t.date,
    authorized_date: t.authorized_date ?? null,
    name: t.name,
    merchant_name: t.merchant_name ?? null,
    pending: t.pending,
    pending_transaction_id: t.pending_transaction_id ?? null,
    personal_finance_category: t.personal_finance_category ? { primary: t.personal_finance_category.primary, detailed: t.personal_finance_category.detailed } : null
  };
}

export async function removeItem(env: PlaidEnv, accessToken: string): Promise<void> {
  await call(env, "/item/remove", { access_token: accessToken });
}
