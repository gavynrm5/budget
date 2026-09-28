import { AuthError, requireOwner } from "./auth";
import { decrypt, encrypt } from "./crypto";
import { accounts, exchange, linkToken, PlaidError, removeItem, syncAll, type PlaidAccount, type PlaidEnv } from "./plaid";

/**
 * Bank sync for Pay Period Budget. Holds the Plaid secret and each bank
 * connection's access token (encrypted in KV), so neither ever reaches the
 * browser or the public repo. Read-only: it only uses Plaid Transactions.
 *
 *   POST /link-token {itemId?}         -> { linkToken }        new connection, or fix one
 *   POST /exchange   {publicToken}     -> { itemId, accounts }
 *   POST /sync       {itemId, cursor}  -> { added, modified, removed, nextCursor, accounts, status }
 *   POST /remove     {itemId}          -> { ok }
 */

export interface Env extends PlaidEnv {
  TOKENS: KVNamespace;
  TOKEN_KEY: string; // 32 random bytes, base64
  FIREBASE_PROJECT_ID: string;
  OWNER_UID: string;
  ALLOWED_ORIGINS: string; // comma separated
}

const json = (body: unknown, status: number, cors: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });

function corsFor(request: Request, env: Env): Record<string, string> | null {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
  if (!allowed.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

const itemKey = (itemId: string) => `item:${itemId}`;

async function accessTokenFor(env: Env, itemId: unknown): Promise<string> {
  if (typeof itemId !== "string" || !/^[\w-]{1,100}$/.test(itemId)) throw new PlaidError("BAD_REQUEST", "Missing connection id.", 400);
  const stored = await env.TOKENS.get(itemKey(itemId));
  if (!stored) throw new PlaidError("ITEM_NOT_FOUND", "That bank connection doesn't exist anymore. Connect it again.", 404);
  return decrypt(stored, env.TOKEN_KEY);
}

const publicAccounts = (list: PlaidAccount[]) =>
  list.map((a) => ({ id: a.account_id, name: a.name, mask: a.mask, type: a.type, subtype: a.subtype, balances: a.balances }));

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Refuse outdated TLS (1.0/1.1). Cloudflare reports the version each request arrived on.
    const tls = (request as Request & { cf?: { tlsVersion?: string } }).cf?.tlsVersion;
    if (tls === "TLSv1" || tls === "TLSv1.1") return new Response("TLS 1.2 or newer is required.", { status: 426 });
    const cors = corsFor(request, env);
    if (!cors) return new Response("Forbidden", { status: 403 });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "method-not-allowed" }, 405, cors);

    try {
      const uid = await requireOwner(request, env.FIREBASE_PROJECT_ID, env.OWNER_UID);
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const path = new URL(request.url).pathname;

      if (path === "/link-token") {
        const token = body.itemId ? await accessTokenFor(env, body.itemId) : undefined;
        return json({ linkToken: await linkToken(env, uid, token) }, 200, cors);
      }

      if (path === "/exchange") {
        if (typeof body.publicToken !== "string") return json({ error: "bad-request" }, 400, cors);
        const { accessToken, itemId } = await exchange(env, body.publicToken);
        await env.TOKENS.put(itemKey(itemId), await encrypt(accessToken, env.TOKEN_KEY));
        return json({ itemId, accounts: publicAccounts(await accounts(env, accessToken)) }, 200, cors);
      }

      if (path === "/sync") {
        const token = await accessTokenFor(env, body.itemId);
        const cursor = typeof body.cursor === "string" && body.cursor ? body.cursor : null;
        const r = await syncAll(env, token, cursor);
        return json({ ...r, accounts: publicAccounts(r.accounts) }, 200, cors);
      }

      if (path === "/remove") {
        const token = await accessTokenFor(env, body.itemId);
        try {
          await removeItem(env, token);
        } finally {
          await env.TOKENS.delete(itemKey(body.itemId as string));
        }
        return json({ ok: true }, 200, cors);
      }

      return json({ error: "not-found" }, 404, cors);
    } catch (e) {
      if (e instanceof AuthError) return json({ error: "unauthorized", message: e.message }, 401, cors);
      if (e instanceof PlaidError) {
        // The bank needs the user to sign in again: the app offers "Fix connection" (Link update mode).
        const code = e.code === "ITEM_LOGIN_REQUIRED" || e.code === "PENDING_EXPIRATION" ? "login-required" : e.code.toLowerCase();
        return json({ error: code, message: e.message }, e.status >= 400 && e.status < 600 ? e.status : 502, cors);
      }
      return json({ error: "server-error", message: "Something went wrong in bank sync." }, 500, cors);
    }
  }
};
