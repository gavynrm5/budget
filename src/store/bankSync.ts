import { useCallback, useEffect, useState } from "react";
import { useData } from "./data";
import { planSync } from "../lib/bankSync";
import { BankApiError, bankApi } from "../lib/bankApi";
import type { Account, BankLink } from "../lib/types";

const AUTO_EVERY_MS = 6 * 60 * 60 * 1000; // banks post new transactions a few times a day
let running: Promise<void> | null = null;
let autoTriedAt = 0;

/** Syncs every bank connection: new transactions to review and balances from the bank. */
export function useBankSync() {
  const data = useData();
  const { loaded, online, settings, bankLinks, bankTx, applyBankSync, saveBankLink } = data;
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = settings.bankSyncUrl;

  /** Syncs one connection starting from `accounts`, and returns the accounts with its new balances. */
  const syncLink = useCallback(
    async (link: BankLink, accounts: Account[] = settings.accounts): Promise<Account[]> => {
      try {
        const res = await bankApi.sync(url, link.id, link.cursor);
        const existing = new Map(bankTx.filter((t) => t.linkId === link.id).map((t) => [t.id, t]));
        const plan = planSync(res, link, existing, accounts, Date.now());
        await applyBankSync(plan);
        return plan.accounts;
      } catch (e) {
        const err = e instanceof BankApiError ? e : new BankApiError("other", "Bank sync failed.");
        if (err.kind === "login-required") saveBankLink({ ...link, status: "login-required", statusMessage: err.message });
        else if (err.kind === "other") saveBankLink({ ...link, status: "error", statusMessage: err.message });
        throw err;
      }
    },
    [url, bankTx, settings.accounts, applyBankSync, saveBankLink]
  );

  const syncAll = useCallback(async () => {
    if (!url || !bankLinks.length) return;
    if (running) return running;
    setSyncing(true);
    setError(null);
    running = (async () => {
      const problems: string[] = [];
      // One at a time: each sync saves new balances, and the next must start from them.
      let accounts = settings.accounts;
      for (const link of bankLinks.filter((l) => l.status !== "login-required")) {
        try {
          accounts = await syncLink(link, accounts);
        } catch (e) {
          problems.push(`${link.label}: ${(e as Error).message}`);
        }
      }
      if (problems.length) setError(problems.join(" "));
    })().finally(() => {
      running = null;
      setSyncing(false);
    });
    return running;
  }, [url, bankLinks, settings.accounts, syncLink]);

  // Sync on open when the last sync is more than a few hours old.
  useEffect(() => {
    if (!loaded || !online || !url || !bankLinks.length) return;
    const oldest = Math.min(...bankLinks.map((l) => l.lastSyncAt ?? 0));
    if (Date.now() - oldest < AUTO_EVERY_MS || Date.now() - autoTriedAt < AUTO_EVERY_MS) return;
    autoTriedAt = Date.now();
    void syncAll();
  }, [loaded, online, url, bankLinks, syncAll]);

  return { syncing, error, syncAll, syncLink, toReview: bankTx.filter((t) => t.status === "new").length };
}
