import { auth } from "./firebase";
import type { PlaidAccountInfo, SyncResponse } from "./bankSync";

/** Calls to the user's bank sync worker, signed with their Firebase ID token. */

export class BankApiError extends Error {
  constructor(
    public kind: "setup" | "login-required" | "unauthorized" | "network" | "other",
    message: string
  ) {
    super(message);
  }
}

async function call<T>(baseUrl: string, path: string, body: Record<string, unknown>): Promise<T> {
  if (!baseUrl) throw new BankApiError("setup", "Bank sync isn't set up yet.");
  const user = auth?.currentUser;
  if (!user) throw new BankApiError("unauthorized", "Sign in again to use bank sync.");
  let res: Response;
  try {
    res = await fetch(`${baseUrl.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
      body: JSON.stringify(body)
    });
  } catch {
    throw new BankApiError("network", "Couldn't reach bank sync. Check your connection, and the address in bank sync setup.");
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok) {
    if (data.error === "login-required") throw new BankApiError("login-required", "Your bank needs you to sign in again.");
    if (res.status === 401 || res.status === 403) throw new BankApiError("unauthorized", data.message ?? "Bank sync didn't accept this account.");
    throw new BankApiError("other", data.message ?? `Bank sync returned an error (${res.status}).`);
  }
  return data;
}

export const bankApi = {
  linkToken: (url: string, itemId?: string) => call<{ linkToken: string }>(url, "/link-token", itemId ? { itemId } : {}).then((r) => r.linkToken),
  exchange: (url: string, publicToken: string) => call<{ itemId: string; accounts: PlaidAccountInfo[] }>(url, "/exchange", { publicToken }),
  sync: (url: string, itemId: string, cursor: string) => call<SyncResponse>(url, "/sync", { itemId, cursor }),
  remove: (url: string, itemId: string) => call<{ ok: boolean }>(url, "/remove", { itemId })
};

// ---- Plaid Link (the bank's secure connect window) ----

interface PlaidHandler {
  open: () => void;
  exit: (opts?: { force?: boolean }) => void;
  destroy: () => void;
}
interface PlaidLinkMetadata {
  institution: { name: string; institution_id: string } | null;
  accounts: { id: string; name: string; mask: string | null; type: string; subtype: string | null }[];
}
declare global {
  interface Window {
    Plaid?: {
      create: (opts: {
        token: string;
        onSuccess: (publicToken: string, metadata: PlaidLinkMetadata) => void;
        onExit?: (err: { error_code?: string; display_message?: string | null } | null) => void;
      }) => PlaidHandler;
    };
  }
}

let loading: Promise<void> | null = null;
function loadLink(): Promise<void> {
  if (window.Plaid) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new BankApiError("network", "Couldn't load the bank connect window."));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Opens Plaid Link. Resolves with the public token, or null if the user closed it. */
export async function openLink(linkToken: string): Promise<{ publicToken: string; metadata: PlaidLinkMetadata } | null> {
  await loadLink();
  return new Promise((resolve, reject) => {
    const handler = window.Plaid!.create({
      token: linkToken,
      onSuccess: (publicToken, metadata) => {
        handler.destroy();
        resolve({ publicToken, metadata });
      },
      onExit: (err) => {
        handler.destroy();
        if (err?.error_code) reject(new BankApiError("other", err.display_message || "The bank connection didn't finish."));
        else resolve(null);
      }
    });
    handler.open();
  });
}
