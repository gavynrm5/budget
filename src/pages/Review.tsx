import { useMemo, useState } from "react";
import { ArrowDownLeft, ArrowLeftRight, Check, CheckCheck, Inbox, RefreshCw, X } from "lucide-react";
import { useData } from "../store/data";
import { useUI } from "../store/ui";
import { useBankSync } from "../store/bankSync";
import { findDuplicate, suggest } from "../lib/bankSync";
import { accountLabel } from "../lib/accounts";
import { fmt } from "../lib/money";
import { formatDate } from "../lib/periods";
import { CATEGORIES, CATEGORY_LABEL, type BankTx, type Transaction } from "../lib/types";
import { EmptyState, PageHeader } from "../components/ui";

export default function Review() {
  const data = useData();
  const { bankTx, transactions, settings } = data;
  const { toast } = useUI();
  const sync = useBankSync();
  const [picked, setPicked] = useState<Record<string, string>>({}); // bank tx id -> sub id
  const [showDup, setShowDup] = useState<Record<string, boolean>>({}); // "add anyway" chosen

  const pending = useMemo(() => bankTx.filter((t) => t.status === "new").sort((a, b) => b.date.localeCompare(a.date)), [bankTx]);
  const spending = pending.filter((t) => t.kind === "spending");
  const income = pending.filter((t) => t.kind === "income");
  const transfers = pending.filter((t) => t.kind === "transfer");

  // Hand-logged transactions already matched stay out of other matches.
  const plan = useMemo(() => {
    const taken = new Set(bankTx.filter((t) => t.txId).map((t) => t.txId as string));
    const out = new Map<string, { sub: ReturnType<typeof suggest>; dup: Transaction | null }>();
    for (const t of spending) {
      const dup = findDuplicate(t, transactions, taken);
      if (dup) taken.add(dup.id);
      out.set(t.id, { sub: suggest(t, transactions, settings), dup });
    }
    return out;
  }, [spending, bankTx, transactions, settings]);

  const subFor = (t: BankTx) => picked[t.id] ?? plan.get(t.id)?.sub?.subId ?? "";
  const acct = (id: string | null) => {
    const a = id ? settings.accounts.find((x) => x.id === id) : undefined;
    return a ? accountLabel(a) : "";
  };
  const subs = CATEGORIES.map((c) => ({ c, list: settings.subCategories.filter((s) => s.category === c && !s.archived).sort((a, b) => a.order - b.order) }));

  const add = (t: BankTx, subId: string) => {
    const sub = settings.subCategories.find((s) => s.id === subId);
    if (!sub) return;
    const id = data.newId();
    data.saveTransaction({ id, date: t.date, amount: t.amount, category: sub.category, subId, description: t.description, notes: "", periodOverride: null, accountId: t.accountId });
    data.saveBankTx({ ...t, status: "added", txId: id });
  };
  const same = (t: BankTx, dup: Transaction) => {
    if (!dup.accountId && t.accountId) data.saveTransaction({ ...dup, accountId: t.accountId });
    data.saveBankTx({ ...t, status: "linked", txId: dup.id });
  };
  const ignore = (t: BankTx) => data.saveBankTx({ ...t, status: "ignored" });
  const addIncome = (t: BankTx) => {
    const id = data.newId();
    data.saveExtraIncome({ id, date: t.date, amount: t.amount, source: t.description, accountId: t.accountId, notes: "", allocations: [] });
    data.saveBankTx({ ...t, status: "added", txId: id });
  };

  const ready = spending.filter((t) => subFor(t) && !(plan.get(t.id)?.dup && !showDup[t.id]));
  const addAll = () => {
    ready.forEach((t) => add(t, subFor(t)));
    toast({ message: `Added ${ready.length} ${ready.length === 1 ? "purchase" : "purchases"}`, tone: "good" }, 3000);
  };

  return (
    <>
      <PageHeader
        title="Review bank transactions"
        subtitle={pending.length ? `${pending.length} new from your banks` : "All caught up"}
        actions={
          <button className="btn-outline" onClick={() => void sync.syncAll()} disabled={sync.syncing}>
            <RefreshCw size={16} aria-hidden className={sync.syncing ? "motion-safe:animate-spin" : ""} /> {sync.syncing ? "Syncing..." : "Sync now"}
          </button>
        }
      />
      {sync.error && <p role="alert" className="mb-4 rounded-xl bg-bad/10 px-3 py-2 text-sm text-bad">{sync.error}</p>}

      {pending.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Inbox size={22} />} title="Nothing to review.">New purchases from your connected banks show up here, usually within a day.</EmptyState>
        </div>
      ) : (
        <div className="space-y-5">
          {spending.length > 0 && (
            <section aria-labelledby="rv-spend" className="card">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
                <h2 id="rv-spend" className="text-lg">Purchases <span className="text-muted">({spending.length})</span></h2>
                {ready.length > 0 && (
                  <button className="btn-primary min-h-[40px] px-3 text-sm" onClick={addAll}><CheckCheck size={16} aria-hidden /> Add {ready.length} with a category</button>
                )}
              </div>
              <ul className="divide-y divide-line/60">
                {spending.map((t) => {
                  const p = plan.get(t.id);
                  const dup = p?.dup && !showDup[t.id] ? p.dup : null;
                  const subId = subFor(t);
                  return (
                    <li key={t.id} className="px-4 py-3 sm:px-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium">{t.description}</p>
                          <p className="text-xs text-muted">{[formatDate(t.date), acct(t.accountId)].filter(Boolean).join(" · ")}</p>
                        </div>
                        <span className="num shrink-0 font-semibold">{fmt(t.amount)}</span>
                      </div>
                      {dup ? (
                        <div className="mt-2 rounded-xl bg-warn/10 px-3 py-2 text-sm">
                          <p>Looks like you already logged this: <strong>{dup.description || "a purchase"}</strong>, {fmt(dup.amount)} on {formatDate(dup.date)}.</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button className="btn-primary min-h-[36px] px-3 text-sm" onClick={() => same(t, dup)}><Check size={15} aria-hidden /> Same purchase</button>
                            <button className="btn-outline min-h-[36px] px-3 text-sm" onClick={() => setShowDup((x) => ({ ...x, [t.id]: true }))}>It's different</button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <label htmlFor={`rv-${t.id}`} className="sr-only">Sub-category for {t.description}</label>
                          <select id={`rv-${t.id}`} className={`input min-h-[40px] min-w-[180px] flex-1 py-1 text-sm ${subId ? "" : "border-warn"}`} value={subId} onChange={(e) => setPicked((x) => ({ ...x, [t.id]: e.target.value }))}>
                            <option value="">Pick a sub-category...</option>
                            {subs.map((g) => (
                              <optgroup key={g.c} label={CATEGORY_LABEL[g.c]}>
                                {g.list.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                              </optgroup>
                            ))}
                          </select>
                          <button className="btn-primary min-h-[40px] px-3 text-sm" disabled={!subId} onClick={() => add(t, subId)}><Check size={15} aria-hidden /> Add</button>
                          <button className="btn-ghost min-h-[40px] px-3 text-sm text-muted" onClick={() => ignore(t)}><X size={15} aria-hidden /> Ignore</button>
                        </div>
                      )}
                      {!dup && p?.sub?.from === "history" && !picked[t.id] && <p className="mt-1 text-xs text-muted">Picked from what you chose last time here.</p>}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {income.length > 0 && (
            <section aria-labelledby="rv-in" className="card">
              <div className="border-b border-line px-4 py-3 sm:px-5">
                <h2 id="rv-in" className="flex items-center gap-2 text-lg"><ArrowDownLeft size={18} className="text-good" aria-hidden /> Money in <span className="text-muted">({income.length})</span></h2>
                <p className="text-sm text-muted">Paychecks are already your regular income, so ignore those. Add gifts, winnings, or refunds as extra income.</p>
              </div>
              <ul className="divide-y divide-line/60">
                {income.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{t.description}</p>
                      <p className="text-xs text-muted">{[formatDate(t.date), acct(t.accountId)].filter(Boolean).join(" · ")}</p>
                    </div>
                    <span className="num font-semibold text-good">+{fmt(t.amount)}</span>
                    <div className="flex gap-2">
                      <button className="btn-outline min-h-[40px] px-3 text-sm" onClick={() => addIncome(t)}>Add as extra income</button>
                      <button className="btn-ghost min-h-[40px] px-3 text-sm text-muted" onClick={() => ignore(t)}><X size={15} aria-hidden /> Ignore</button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {transfers.length > 0 && (
            <section aria-labelledby="rv-xfer" className="card">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
                <div>
                  <h2 id="rv-xfer" className="flex items-center gap-2 text-lg"><ArrowLeftRight size={18} className="text-muted" aria-hidden /> Transfers and card payments <span className="text-muted">({transfers.length})</span></h2>
                  <p className="text-sm text-muted">Money moving between your own accounts isn't spending, and connected balances already include it.</p>
                </div>
                <button className="btn-outline min-h-[40px] px-3 text-sm" onClick={() => transfers.forEach(ignore)}>Clear all</button>
              </div>
              <ul className="divide-y divide-line/60">
                {transfers.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-sm sm:px-5">
                    <span className="min-w-0 flex-1 truncate">{t.description} <span className="text-muted">· {formatDate(t.date)}</span></span>
                    <span className="num">{t.direction === "in" ? "+" : "-"}{fmt(t.amount)}</span>
                    <button className="icon-btn" onClick={() => ignore(t)} aria-label={`Clear ${t.description}`}><X size={16} /></button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </>
  );
}
