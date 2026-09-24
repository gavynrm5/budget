import { useMemo, useState } from "react";
import { ArrowLeftRight, ChevronDown, Pencil, Plus } from "lucide-react";
import { useData } from "../store/data";
import { fmt, pct } from "../lib/money";
import { formatDate, toISODate, todayISO } from "../lib/periods";
import { accountEntries, accountLabel, activeAccounts, computeBalances, isCredit, nextDue, utilization } from "../lib/accounts";
import { ACCOUNT_KIND_LABEL, type Account, type Transfer } from "../lib/types";
import { ACCOUNT_ICON } from "../components/AccountPicker";
import { AccountSheet, SetBalanceSheet, TransferSheet } from "../components/AccountSheets";
import { Money, PageHeader, SummaryCard } from "../components/ui";

type Sheet =
  | { kind: "balance"; account: Account }
  | { kind: "edit"; account: Account | null }
  | { kind: "transfer"; transfer: Transfer | null; preset?: { fromId?: string; toId?: string } };

export default function Accounts() {
  const { settings, transactions, transfers, extraIncome } = useData();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const balances = useMemo(() => computeBalances(settings.accounts, transactions, transfers, extraIncome), [settings.accounts, transactions, transfers, extraIncome]);
  const active = activeAccounts(settings.accounts);
  const banks = active.filter((a) => !isCredit(a));
  const cards = active.filter(isCredit);
  const archived = settings.accounts.filter((a) => a.archived);
  const cash = banks.reduce((s, a) => s + balances[a.id], 0);
  const owed = cards.reduce((s, a) => s + balances[a.id], 0);
  const recentTransfers = useMemo(() => [...transfers].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 10), [transfers]);
  const nameOf = (id: string) => {
    const a = settings.accounts.find((x) => x.id === id);
    return a ? accountLabel(a) : "Deleted account";
  };

  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle="Nicknames only. Balances update from what you log."
        actions={
          <>
            <button className="btn-outline" onClick={() => setSheet({ kind: "transfer", transfer: null })}>
              <ArrowLeftRight size={17} aria-hidden /> Transfer
            </button>
            <button className="btn-primary" onClick={() => setSheet({ kind: "edit", account: null })}>
              <Plus size={18} aria-hidden /> <span className="hidden sm:inline">Add account</span><span className="sm:hidden">Add</span>
            </button>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <SummaryCard label="Cash" value={cash} hint="Checking and savings" />
        <SummaryCard label="Card balances" value={owed} hint="What you owe" />
        <div className="col-span-2 lg:col-span-1">
          <SummaryCard label="Net" value={cash - owed} hint="Cash minus card balances" tone={cash - owed < 0 ? "bad" : undefined} />
        </div>
      </div>

      <section aria-labelledby="banks-h" className="mb-6">
        <h2 id="banks-h" className="mb-3 text-lg">Bank accounts</h2>
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {banks.map((a) => (
            <AccountCard key={a.id} account={a} balance={balances[a.id]} onSet={() => setSheet({ kind: "balance", account: a })} onEdit={() => setSheet({ kind: "edit", account: a })} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="cards-h" className="mb-6">
        <h2 id="cards-h" className="mb-3 text-lg">Credit cards</h2>
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((a) => (
            <AccountCard
              key={a.id}
              account={a}
              balance={balances[a.id]}
              onSet={() => setSheet({ kind: "balance", account: a })}
              onEdit={() => setSheet({ kind: "edit", account: a })}
              onPay={() => setSheet({ kind: "transfer", transfer: null, preset: { toId: a.id } })}
            />
          ))}
        </ul>
      </section>

      <section aria-labelledby="xfer-h" className="card mb-6">
        <div className="flex items-center justify-between px-4 pt-4 sm:px-5">
          <h2 id="xfer-h" className="font-semibold">Transfers and card payments</h2>
          <button className="btn-ghost text-sm text-primary" onClick={() => setSheet({ kind: "transfer", transfer: null })}>
            <Plus size={16} aria-hidden /> Add
          </button>
        </div>
        {recentTransfers.length === 0 ? (
          <p className="px-5 pb-5 pt-2 text-sm text-muted">None yet. Log a card payment or a move to savings here, and both balances update.</p>
        ) : (
          <ul className="divide-y divide-line/60">
            {recentTransfers.map((t) => (
              <li key={t.id}>
                <button className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface-2/60 sm:px-5" onClick={() => setSheet({ kind: "transfer", transfer: t })}>
                  <ArrowLeftRight size={17} className="shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{nameOf(t.fromId)} to {nameOf(t.toId)}</span>
                    <span className="block truncate text-xs text-muted">{formatDate(t.date)}{t.notes && ` · ${t.notes}`}</span>
                  </span>
                  <Money value={t.amount} className="font-semibold" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {archived.length > 0 && (
        <section className="mb-6">
          <button className="btn-ghost text-sm text-muted" onClick={() => setShowArchived((v) => !v)} aria-expanded={showArchived}>
            <ChevronDown size={16} aria-hidden className={showArchived ? "rotate-180" : ""} /> Archived ({archived.length})
          </button>
          {showArchived && (
            <ul className="mt-2 grid gap-2">
              {archived.map((a) => (
                <li key={a.id} className="flex items-center justify-between rounded-xl bg-surface-2 py-1 pl-4 pr-1">
                  <span className="text-sm text-muted">{accountLabel(a)} · <Money value={balances[a.id]} /></span>
                  <button className="icon-btn" onClick={() => setSheet({ kind: "edit", account: a })} aria-label={`Edit ${accountLabel(a)}`}><Pencil size={16} /></button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {sheet?.kind === "balance" && <SetBalanceSheet account={sheet.account} current={balances[sheet.account.id]} onClose={() => setSheet(null)} />}
      {sheet?.kind === "edit" && <AccountSheet account={sheet.account} onClose={() => setSheet(null)} />}
      {sheet?.kind === "transfer" && <TransferSheet transfer={sheet.transfer} preset={sheet.preset} onClose={() => setSheet(null)} />}
    </>
  );
}

function AccountCard({ account, balance, onSet, onEdit, onPay }: { account: Account; balance: number; onSet: () => void; onEdit: () => void; onPay?: () => void }) {
  const { settings, transactions, transfers, extraIncome } = useData();
  const [open, setOpen] = useState(false);
  const Icon = ACCOUNT_ICON[account.kind];
  const credit = isCredit(account);
  const use = utilization(account, balance);
  const due = credit && account.dueDay ? nextDue(account.dueDay, todayISO()) : null;
  const useTone = use == null ? "" : use >= 0.5 ? "bg-bad" : use >= 0.3 ? "bg-warn" : "bg-good";
  const useText = use == null ? "" : use >= 0.5 ? "High" : use >= 0.3 ? "Getting high" : "Healthy";
  const subName = (id: string) => settings.subCategories.find((s) => s.id === id)?.name ?? "";
  const nameOf = (id: string) => {
    const a = settings.accounts.find((x) => x.id === id);
    return a ? accountLabel(a) : "Deleted account";
  };
  const entries = useMemo(
    () => (open ? accountEntries(account, transactions, transfers, extraIncome, subName, nameOf).slice(0, 15) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, account, transactions, transfers, extraIncome]
  );

  return (
    <li className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon size={18} aria-hidden /></span>
          <div className="min-w-0">
            <p className="truncate font-semibold">{account.name}</p>
            <p className="text-xs text-muted">{ACCOUNT_KIND_LABEL[account.kind]}</p>
          </div>
        </div>
        <button className="icon-btn -mr-2 -mt-1" onClick={onEdit} aria-label={`Edit ${accountLabel(account)}`}><Pencil size={16} /></button>
      </div>

      <p className="mt-3 text-xs text-muted">{credit ? "Balance owed" : "Balance"}</p>
      <p className="num text-2xl font-semibold"><Money value={balance} colorNegative={!credit} /></p>
      <p className="text-xs text-muted">
        {account.balanceSetAt ? `Set ${formatDate(toISODate(new Date(account.balanceSetAt)))}, updated from what you log since` : "Not set yet. Tap Set balance."}
      </p>

      {credit && (use != null || due) && (
        <div className="mt-3 space-y-2 border-t border-line pt-3 text-sm">
          {use != null && (
            <div>
              <div className="mb-1 flex justify-between">
                <span className="text-muted">Using {pct(use, 0)} of {fmt(account.creditLimit!)}</span>
                <span className="text-xs font-medium">{useText}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label={`${accountLabel(account)} credit used`} aria-valuenow={Math.round(use * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div className={`h-full rounded-full ${useTone}`} style={{ width: `${Math.min(1, use) * 100}%` }} />
              </div>
            </div>
          )}
          {due && (
            <p className={due.days <= 3 && balance > 0 ? "font-medium text-warn" : "text-muted"}>
              Due {formatDate(due.date)} ({due.days === 0 ? "today" : due.days === 1 ? "tomorrow" : `in ${due.days} days`})
            </p>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn-outline min-h-[40px] px-3 text-sm" onClick={onSet}>Set balance</button>
        {onPay && <button className="btn-outline min-h-[40px] px-3 text-sm" onClick={onPay}>Pay card</button>}
        <button className="btn-ghost min-h-[40px] px-3 text-sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          Activity <ChevronDown size={15} aria-hidden className={open ? "rotate-180" : ""} />
        </button>
      </div>

      {open && (
        entries.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nothing logged with this {credit ? "card" : "account"} yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line/60 text-sm">
            {entries.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0">
                  <span className="block truncate">{e.text}</span>
                  <span className="block text-xs text-muted">{formatDate(e.date)}{!e.counted && " · before balance was set"}</span>
                </span>
                <span className={`num shrink-0 ${e.counted ? "" : "text-muted line-through"}`}>{e.delta > 0 ? "+" : "-"}{fmt(Math.abs(e.delta))}</span>
              </li>
            ))}
          </ul>
        )
      )}
    </li>
  );
}
