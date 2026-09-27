import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Landmark, Link2, RefreshCw, Unlink, Wrench } from "lucide-react";
import { useData } from "../store/data";
import { useUI } from "../store/ui";
import { useBankSync } from "../store/bankSync";
import { BankApiError, bankApi, openLink } from "../lib/bankApi";
import { bankKind, type PlaidAccountInfo } from "../lib/bankSync";
import { accountLabel } from "../lib/accounts";
import { periodRange, currentPeriodId, shiftPeriod, toISODate, formatDate } from "../lib/periods";
import { ACCOUNT_KIND_LABEL, type Account, type AccountKind, type BankLink } from "../lib/types";
import { Sheet } from "./ui";

/** Bank sync on the Accounts page: set up, connect banks, sync, fix, disconnect. */
export function BankSyncCard() {
  const data = useData();
  const { settings, bankLinks, updateSettings } = data;
  const { toast, confirm } = useUI();
  const sync = useBankSync();
  const [busy, setBusy] = useState<string | null>(null);
  const [mapping, setMapping] = useState<{ itemId: string; accounts: PlaidAccountInfo[] } | null>(null);
  const [url, setUrl] = useState(settings.bankSyncUrl);
  const [urlErr, setUrlErr] = useState("");

  const fail = (e: unknown) => toast({ message: "Bank sync", detail: e instanceof Error ? e.message : "Something went wrong.", tone: "bad" }, 6000);

  const saveUrl = (e: FormEvent) => {
    e.preventDefault();
    const u = url.trim().replace(/\/+$/, "");
    if (!/^https:\/\/[\w.-]+\.workers\.dev$/i.test(u) && !/^https:\/\/[\w.-]+\.[a-z]{2,}$/i.test(u)) return setUrlErr("Paste the worker address, like https://budget-bank-sync.yourname.workers.dev");
    updateSettings({ bankSyncUrl: u });
    toast({ message: "Bank sync address saved", tone: "good" }, 2500);
  };

  const connect = async () => {
    setBusy("connect");
    try {
      const token = await bankApi.linkToken(settings.bankSyncUrl);
      const linked = await openLink(token);
      if (!linked) return;
      const { itemId, accounts } = await bankApi.exchange(settings.bankSyncUrl, linked.publicToken);
      setMapping({ itemId, accounts });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const fix = async (link: BankLink) => {
    setBusy(link.id);
    try {
      const token = await bankApi.linkToken(settings.bankSyncUrl, link.id);
      if (!(await openLink(token))) return;
      const fixed = { ...link, status: "ok" as const, statusMessage: "" };
      data.saveBankLink(fixed);
      await sync.syncLink(fixed);
      toast({ message: `${link.label} is working again`, tone: "good" }, 3000);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (link: BankLink) => {
    if (!(await confirm(`Disconnect ${link.label}?`, "The app stops getting transactions and balances from this bank. Everything you already added stays.", "Disconnect"))) return;
    setBusy(link.id);
    try {
      await bankApi.remove(settings.bankSyncUrl, link.id).catch((e) => {
        if (!(e instanceof BankApiError && e.kind === "other")) throw e; // already gone at Plaid is fine
      });
      data.deleteBankLink(link.id);
      // Keep the last bank balance as a regular, hand-updated balance from now on.
      updateSettings({ accounts: settings.accounts.map((a) => (a.linkId === link.id ? { ...a, linkId: null, balanceSetAt: Date.now() } : a)) });
      data.bankTx.filter((t) => t.linkId === link.id && t.status === "new").forEach((t) => data.saveBankTx({ ...t, status: "ignored" }));
      toast({ message: `${link.label} disconnected`, tone: "good" }, 3000);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  if (!settings.bankSyncUrl) {
    return (
      <section aria-labelledby="bank-h" className="card mb-6 p-4 sm:p-5">
        <h2 id="bank-h" className="flex items-center gap-2 text-lg"><Landmark size={18} className="text-primary" aria-hidden /> Bank sync</h2>
        <p className="mt-1 text-sm text-muted">Bring in purchases and balances from your banks automatically, through Plaid. It needs your bank sync worker set up first (see the README). Then paste its address here.</p>
        <form onSubmit={saveUrl} className="mt-3 flex flex-wrap items-start gap-2" noValidate>
          <div className="min-w-[240px] flex-1">
            <label htmlFor="bank-url" className="sr-only">Bank sync worker address</label>
            <input id="bank-url" className="input font-mono text-sm" placeholder="https://budget-bank-sync.yourname.workers.dev" value={url} onChange={(e) => { setUrl(e.target.value); setUrlErr(""); }} aria-invalid={!!urlErr} />
            {urlErr && <p role="alert" className="mt-1 text-sm text-bad">{urlErr}</p>}
          </div>
          <button className="btn-primary" type="submit">Save</button>
        </form>
      </section>
    );
  }

  return (
    <section aria-labelledby="bank-h" className="card mb-6 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="bank-h" className="flex items-center gap-2 text-lg"><Landmark size={18} className="text-primary" aria-hidden /> Bank sync</h2>
        <div className="flex flex-wrap gap-2">
          {bankLinks.length > 0 && (
            <button className="btn-outline" onClick={() => void sync.syncAll()} disabled={sync.syncing}>
              <RefreshCw size={16} aria-hidden className={sync.syncing ? "motion-safe:animate-spin" : ""} /> {sync.syncing ? "Syncing..." : "Sync now"}
            </button>
          )}
          <button className="btn-primary" onClick={connect} disabled={busy === "connect"}>
            <Link2 size={16} aria-hidden /> {busy === "connect" ? "Opening..." : "Connect a bank"}
          </button>
        </div>
      </div>
      {sync.error && <p role="alert" className="mt-2 rounded-xl bg-bad/10 px-3 py-2 text-sm text-bad">{sync.error}</p>}
      {sync.toReview > 0 && (
        <Link to="/review" className="mt-3 flex items-center justify-between rounded-xl bg-primary/10 px-3 py-2.5 text-sm font-medium text-primary hover:bg-primary/15">
          {sync.toReview} new bank {sync.toReview === 1 ? "transaction" : "transactions"} to review <span aria-hidden>→</span>
        </Link>
      )}
      {bankLinks.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No banks connected yet. Connecting is read-only: the app can see transactions and balances but can never move money.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line/60">
          {bankLinks.map((l) => {
            const names = l.accounts.map((x) => settings.accounts.find((a) => a.id === x.accountId)).filter(Boolean).map((a) => accountLabel(a!));
            return (
              <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {l.label}
                    {l.status !== "ok" && <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${l.status === "login-required" ? "bg-warn/15 text-warn" : "bg-bad/10 text-bad"}`}>{l.status === "login-required" ? "Needs sign-in" : "Error"}</span>}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {names.length ? names.join(", ") : "No accounts tracked"}
                    {" · "}
                    {l.lastSyncAt ? `Synced ${new Date(l.lastSyncAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Not synced yet"}
                  </p>
                  {l.status !== "ok" && l.statusMessage && <p className="text-xs text-muted">{l.statusMessage}</p>}
                </div>
                {l.status === "login-required" && (
                  <button className="btn-primary min-h-[40px] px-3 text-sm" onClick={() => fix(l)} disabled={busy === l.id}><Wrench size={15} aria-hidden /> Fix</button>
                )}
                <button className="btn-ghost min-h-[40px] px-3 text-sm text-muted" onClick={() => disconnect(l)} disabled={busy === l.id}><Unlink size={15} aria-hidden /> Disconnect</button>
              </li>
            );
          })}
        </ul>
      )}
      <details className="mt-2">
        <summary className="min-h-[36px] py-2 text-xs text-muted">Bank sync address</summary>
        <form onSubmit={saveUrl} className="flex flex-wrap gap-2 pb-1" noValidate>
          <label htmlFor="bank-url2" className="sr-only">Bank sync worker address</label>
          <input id="bank-url2" className="input min-w-[240px] flex-1 font-mono text-xs" value={url} onChange={(e) => { setUrl(e.target.value); setUrlErr(""); }} aria-invalid={!!urlErr} />
          <button className="btn-outline" type="submit">Save</button>
          {urlErr && <p role="alert" className="w-full text-sm text-bad">{urlErr}</p>}
        </form>
      </details>
      {mapping && (
        <MapAccountsSheet
          itemId={mapping.itemId}
          plaidAccounts={mapping.accounts}
          onCancel={async () => {
            // Each new connection counts toward Plaid's free limit, so don't drop one by accident.
            if (!(await confirm("Stop connecting this bank?", "The connection you just made is removed. Connecting again later counts as a new one toward Plaid's free limit of 10.", "Stop connecting"))) return;
            setMapping(null);
            await bankApi.remove(settings.bankSyncUrl, mapping.itemId).catch(() => undefined); // don't leave a connection nobody uses
          }}
          onDone={async (link, accounts) => {
            setMapping(null);
            try {
              await sync.syncLink(link, accounts);
              toast({ message: `${link.label} connected`, detail: "New transactions are ready to review.", tone: "good" }, 4000);
            } catch (e) {
              fail(e);
            }
          }}
        />
      )}
    </section>
  );
}

type Choice = { mode: "existing"; accountId: string } | { mode: "new"; name: string } | { mode: "skip" };

/**
 * After connecting: pick which of your accounts each bank account is. Bank and
 * account names are shown here only to tell them apart, and are never saved.
 */
function MapAccountsSheet({
  itemId,
  plaidAccounts,
  onCancel,
  onDone
}: {
  itemId: string;
  plaidAccounts: PlaidAccountInfo[];
  onCancel: () => void;
  onDone: (link: BankLink, accounts: Account[]) => void;
}) {
  const data = useData();
  const { settings, bankLinks } = data;
  const taken = new Set(bankLinks.flatMap((l) => l.accounts.map((a) => a.accountId)).filter(Boolean) as string[]);
  const periodStart = periodRange(currentPeriodId()).start;
  const threeBack = periodRange(shiftPeriod(currentPeriodId(), -2)).start;
  const [label, setLabel] = useState("");
  const [from, setFrom] = useState<"period" | "three" | "today">("period");
  const [err, setErr] = useState("");
  const [choices, setChoices] = useState<Record<string, Choice>>(() => {
    const used = new Set(taken);
    return Object.fromEntries(
      plaidAccounts.map((pa) => {
        const kind = bankKind(pa);
        const match = kind === "other" ? undefined : settings.accounts.find((a) => !a.archived && a.kind === kind && !used.has(a.id));
        if (match) used.add(match.id);
        return [pa.id, kind === "other" ? { mode: "skip" } : match ? { mode: "existing", accountId: match.id } : { mode: "new", name: "" }];
      })
    );
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const nick = label.trim();
    if (!nick) return setErr("Give this connection a nickname, like the one you use for its accounts.");
    const picked = Object.values(choices).filter((c) => c.mode === "existing").map((c) => (c as { accountId: string }).accountId);
    if (new Set(picked).size !== picked.length) return setErr("Two bank accounts point to the same account. Pick a different one for each.");
    if (Object.values(choices).some((c) => c.mode === "new" && !c.name.trim())) return setErr("Name each new account, or choose Don't track.");
    if (Object.values(choices).every((c) => c.mode === "skip")) return setErr("Track at least one account.");

    let accounts = [...settings.accounts];
    const linkAccounts: BankLink["accounts"] = plaidAccounts.map((pa) => {
      const c = choices[pa.id];
      const kind = bankKind(pa);
      if (c.mode === "skip") return { plaidId: pa.id, accountId: null, kind };
      if (c.mode === "existing") {
        accounts = accounts.map((a) => (a.id === c.accountId ? { ...a, linkId: itemId } : a));
        return { plaidId: pa.id, accountId: c.accountId, kind };
      }
      const acct: Account = {
        id: data.newId(),
        name: c.name.trim(),
        kind: kind as AccountKind,
        order: Math.max(-1, ...accounts.map((a) => a.order)) + 1,
        archived: false,
        balance: 0,
        balanceSetAt: Date.now(),
        creditLimit: pa.balances.limit ?? null,
        dueDay: null,
        linkId: itemId
      };
      accounts = [...accounts, acct];
      return { plaidId: pa.id, accountId: acct.id, kind };
    });
    // Cards: fill in the limit from the bank if none was set.
    accounts = accounts.map((a) => {
      const la = linkAccounts.find((x) => x.accountId === a.id);
      const limit = la ? plaidAccounts.find((p) => p.id === la.plaidId)?.balances.limit : null;
      return a.kind === "credit" && la && a.creditLimit == null && limit ? { ...a, creditLimit: limit } : a;
    });
    const link: BankLink = {
      id: itemId,
      label: nick,
      accounts: linkAccounts,
      cursor: "",
      importFrom: from === "period" ? periodStart : from === "three" ? threeBack : toISODate(new Date()),
      lastSyncAt: null,
      status: "ok"
    };
    data.updateSettings({ accounts });
    data.saveBankLink(link);
    onDone(link, accounts);
  };

  const kindOptions = (pa: PlaidAccountInfo) => settings.accounts.filter((a) => !a.archived && a.kind === bankKind(pa));

  return (
    <Sheet
      title="Match your accounts"
      onClose={onCancel}
      wide
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-outline" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" type="submit" form="map-form">Finish</button>
        </div>
      }
    >
      <form id="map-form" onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="map-label" className="label">Nickname for this connection</label>
          <input id="map-label" data-autofocus className="input" placeholder="Local, Main card, ..." value={label} onChange={(e) => { setLabel(e.target.value); setErr(""); }} />
          <p className="mt-1 text-xs text-muted">Only nicknames are saved. The bank's own names below are shown just so you can tell accounts apart.</p>
        </div>
        <ul className="grid gap-3">
          {plaidAccounts.map((pa) => {
            const c = choices[pa.id];
            const kind = bankKind(pa);
            const value = c.mode === "existing" ? c.accountId : c.mode;
            return (
              <li key={pa.id} className="rounded-xl border border-line p-3">
                <p className="font-medium">{pa.name}{pa.mask && <span className="text-muted"> ····{pa.mask}</span>}</p>
                <p className="text-xs text-muted">{kind === "other" ? "Not a bank account or card (not supported)" : ACCOUNT_KIND_LABEL[kind]}</p>
                {kind !== "other" && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <label htmlFor={`map-${pa.id}`} className="sr-only">Which of your accounts is {pa.name}</label>
                    <select
                      id={`map-${pa.id}`}
                      className="input min-w-[180px] flex-1"
                      value={value}
                      onChange={(e) => {
                        const v = e.target.value;
                        setErr("");
                        setChoices((cs) => ({ ...cs, [pa.id]: v === "new" ? { mode: "new", name: "" } : v === "skip" ? { mode: "skip" } : { mode: "existing", accountId: v } }));
                      }}
                    >
                      {kindOptions(pa).map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}{taken.has(a.id) ? " (already connected)" : ""}</option>)}
                      <option value="new">New account...</option>
                      <option value="skip">Don't track</option>
                    </select>
                    {c.mode === "new" && (
                      <input className="input min-w-[160px] flex-1" placeholder="Nickname" aria-label={`Nickname for ${pa.name}`} value={c.name} onChange={(e) => setChoices((cs) => ({ ...cs, [pa.id]: { mode: "new", name: e.target.value } }))} />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <fieldset>
          <legend className="label">Bring in transactions from</legend>
          <div className="grid gap-2 text-sm">
            {([
              ["period", `This pay period (since ${formatDate(periodStart)})`],
              ["three", `The last 3 pay periods (since ${formatDate(threeBack)})`],
              ["today", "Only new ones from today"]
            ] as const).map(([v, text]) => (
              <label key={v} className="flex min-h-[40px] cursor-pointer items-center gap-2.5">
                <input type="radio" name="from" className="h-4 w-4 accent-[rgb(var(--primary))]" checked={from === v} onChange={() => setFrom(v)} /> {text}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">Anything you already logged by hand is spotted during review, so it won't be counted twice.</p>
        </fieldset>
        {err && <p role="alert" className="text-sm text-bad">{err}</p>}
      </form>
    </Sheet>
  );
}
