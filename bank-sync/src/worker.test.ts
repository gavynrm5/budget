import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import worker, { type Env } from "./index";
import { decrypt, encrypt } from "./crypto";

const PROJECT = "my-budget-test";
const OWNER = "owner-uid";
const ORIGIN = "https://gavynrm5.github.io";
const KEY = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

let privateKey: CryptoKey;
let jwk: JWK;
beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey as CryptoKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: "test-kid", alg: "RS256", use: "sig" };
});

const token = (sub = OWNER, aud = PROJECT) =>
  new SignJWT({ auth_time: Math.floor(Date.now() / 1000) - 10 })
    .setProtectedHeader({ alg: "RS256", kid: "test-kid" })
    .setIssuer(`https://securetoken.google.com/${aud}`)
    .setAudience(aud)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);

function kv() {
  const m = new Map<string, string>();
  return { store: m, ns: { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v), delete: async (k: string) => void m.delete(k) } as unknown as KVNamespace };
}

function env(tokens: KVNamespace): Env {
  return { TOKENS: tokens, TOKEN_KEY: KEY, FIREBASE_PROJECT_ID: PROJECT, OWNER_UID: OWNER, ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173`, PLAID_CLIENT_ID: "cid", PLAID_SECRET: "sec", PLAID_ENV: "sandbox" };
}

/** Routes fetch: Google keys, then Plaid endpoints to the given handlers. */
function mockFetch(plaid: Record<string, (body: Record<string, unknown>) => { status?: number; body: unknown }>) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("googleapis.com")) return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "content-type": "application/json" } });
    const path = new URL(url).pathname;
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ path, body });
    const h = plaid[path];
    if (!h) return new Response(JSON.stringify({ error_code: "NOT_MOCKED" }), { status: 500 });
    const r = h(body);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }));
  return calls;
}

const req = async (path: string, body: unknown, opts: { origin?: string; auth?: string | null } = {}) =>
  new Request(`https://bank-sync.example.workers.dev${path}`, {
    method: "POST",
    headers: {
      Origin: opts.origin ?? ORIGIN,
      "Content-Type": "application/json",
      ...(opts.auth === null ? {} : { Authorization: `Bearer ${opts.auth ?? (await token())}` })
    },
    body: JSON.stringify(body)
  });

afterEach(() => vi.unstubAllGlobals());

describe("token storage", () => {
  it("encrypts access tokens so KV alone doesn't reveal them", async () => {
    const stored = await encrypt("access-production-abc", KEY);
    expect(stored).not.toContain("access-production-abc");
    expect(await decrypt(stored, KEY)).toBe("access-production-abc");
    expect(await encrypt("same", KEY)).not.toBe(await encrypt("same", KEY)); // fresh IV each time
  });
});

describe("who can call it", () => {
  it("rejects other websites before doing anything", async () => {
    mockFetch({});
    const r = await worker.fetch(await req("/sync", {}, { origin: "https://evil.example" }), env(kv().ns));
    expect(r.status).toBe(403);
  });

  it("rejects missing tokens, other users, and tokens for another project", async () => {
    mockFetch({});
    const e = env(kv().ns);
    expect((await worker.fetch(await req("/link-token", {}, { auth: null }), e)).status).toBe(401);
    expect((await worker.fetch(await req("/link-token", {}, { auth: await token("someone-else") }), e)).status).toBe(401);
    expect((await worker.fetch(await req("/link-token", {}, { auth: await token(OWNER, "other-project") }), e)).status).toBe(401);
  });

  it("answers CORS preflight only for the app's origin", async () => {
    const r = await worker.fetch(new Request("https://x.workers.dev/sync", { method: "OPTIONS", headers: { Origin: ORIGIN } }), env(kv().ns));
    expect(r.status).toBe(204);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  });
});

describe("connecting a bank", () => {
  it("asks Plaid for transactions only, keyed to the owner", async () => {
    const calls = mockFetch({ "/link/token/create": () => ({ body: { link_token: "link-1" } }) });
    const r = await worker.fetch(await req("/link-token", {}), env(kv().ns));
    expect(await r.json()).toEqual({ linkToken: "link-1" });
    expect(calls[0].body).toMatchObject({ client_id: "cid", secret: "sec", products: ["transactions"], user: { client_user_id: OWNER }, country_codes: ["US"] });
  });

  it("stores the access token encrypted and returns only the account list", async () => {
    const store = kv();
    mockFetch({
      "/item/public_token/exchange": () => ({ body: { access_token: "access-xyz", item_id: "item-1" } }),
      "/accounts/get": () => ({ body: { accounts: [{ account_id: "a1", name: "Everyday Checking", mask: "1234", type: "depository", subtype: "checking", balances: { current: 900, available: 880, limit: null } }] } })
    });
    const r = await worker.fetch(await req("/exchange", { publicToken: "public-1" }), env(store.ns));
    const out = (await r.json()) as { itemId: string; accounts: { id: string }[] };
    expect(out.itemId).toBe("item-1");
    expect(out.accounts[0].id).toBe("a1");
    expect(JSON.stringify(out)).not.toContain("access-xyz");
    expect(store.store.get("item:item-1")).not.toContain("access-xyz");
  });
});

describe("syncing", () => {
  const txn = (id: string, amount = 12.5) => ({ transaction_id: id, account_id: "a1", amount, date: "2026-09-20", authorized_date: null, name: "STARBUCKS", merchant_name: "Starbucks", pending: false, pending_transaction_id: null, personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_COFFEE", confidence_level: "HIGH" }, location: { city: "x" } });

  async function withItem() {
    const store = kv();
    await store.ns.put("item:item-1", await encrypt("access-xyz", KEY));
    return store;
  }

  it("follows every page and returns the last cursor, with trimmed fields", async () => {
    const store = await withItem();
    const calls = mockFetch({
      "/transactions/sync": (b) =>
        b.cursor === "c1"
          ? { body: { added: [txn("t2")], modified: [], removed: [{ transaction_id: "t0" }], next_cursor: "c2", has_more: false, accounts: [], transactions_update_status: "HISTORICAL_UPDATE_COMPLETE" } }
          : { body: { added: [txn("t1")], modified: [], removed: [], next_cursor: "c1", has_more: true, accounts: [] } }
    });
    const r = await worker.fetch(await req("/sync", { itemId: "item-1", cursor: "" }), env(store.ns));
    const out = (await r.json()) as { added: { transaction_id: string }[]; removed: string[]; nextCursor: string };
    expect(out.added.map((t) => t.transaction_id)).toEqual(["t1", "t2"]);
    expect(out.removed).toEqual(["t0"]);
    expect(out.nextCursor).toBe("c2");
    expect(JSON.stringify(out)).not.toContain("location");
    expect(calls[0].body.access_token).toBe("access-xyz");
    expect(calls[0].body.cursor).toBeUndefined(); // first sync starts from the beginning
  });

  it("restarts from the first cursor when Plaid reports changes mid-sync", async () => {
    const store = await withItem();
    let n = 0;
    const calls = mockFetch({
      "/transactions/sync": (b) => {
        n++;
        if (n === 1) return { body: { added: [txn("t1")], modified: [], removed: [], next_cursor: "c-mid", has_more: true, accounts: [] } };
        if (n === 2) return { status: 400, body: { error_code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION", error_message: "retry" } };
        return { body: { added: b.cursor === "c-start" && n === 3 ? [txn("t1b")] : [txn("t2")], modified: [], removed: [], next_cursor: n === 3 ? "c-mid2" : "c-end", has_more: n === 3, accounts: [] } };
      }
    });
    const out = (await (await worker.fetch(await req("/sync", { itemId: "item-1", cursor: "c-start" }), env(store.ns))).json()) as { added: { transaction_id: string }[]; nextCursor: string };
    expect(calls.map((c) => c.body.cursor)).toEqual(["c-start", "c-mid", "c-start", "c-mid2"]);
    expect(out.added.map((t) => t.transaction_id)).toEqual(["t1b", "t2"]); // nothing from the abandoned pass
    expect(out.nextCursor).toBe("c-end");
  });

  it("tells the app when the bank needs a new login", async () => {
    const store = await withItem();
    mockFetch({ "/transactions/sync": () => ({ status: 400, body: { error_code: "ITEM_LOGIN_REQUIRED", error_message: "login" } }) });
    const r = await worker.fetch(await req("/sync", { itemId: "item-1", cursor: "c1" }), env(store.ns));
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: "login-required" });
  });

  it("removes the connection at Plaid and forgets the token", async () => {
    const store = await withItem();
    const calls = mockFetch({ "/item/remove": () => ({ body: { request_id: "r" } }) });
    const r = await worker.fetch(await req("/remove", { itemId: "item-1" }), env(store.ns));
    expect(r.status).toBe(200);
    expect(calls[0].path).toBe("/item/remove");
    expect(store.store.has("item:item-1")).toBe(false);
  });
});
