import { useState, type FormEvent } from "react";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { useData } from "../store/data";
import { useUI } from "../store/ui";
import { evaluate } from "../lib/expr";
import { fmt, round2 } from "../lib/money";
import { formatDate, todayISO } from "../lib/periods";
import { accountLabel, isCredit } from "../lib/accounts";
import { ACCOUNT_KIND_LABEL, ACCOUNT_KINDS, type Account, type AccountKind, type Transfer } from "../lib/types";
import { AccountPicker } from "./AccountPicker";
import { Segmented, Sheet } from "./ui";

const parse = (s: string) => {
  try {
    return round2(evaluate(s));
  } catch {
    return NaN;
  }
};

/** Type in the real balance from the bank app. Everything logged after this moves it. */
export function SetBalanceSheet({ account, current, onClose }: { account: Account; current: number; onClose: () => void }) {
  const { settings, updateSettings } = useData();
  const { toast } = useUI();
  const credit = isCredit(account);
  const [text, setText] = useState(current.toFixed(2));
  const [err, setErr] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = parse(text);
    if (!Number.isFinite(v)) return setErr("Enter an amount like 1250.40. Use a minus sign for a negative balance.");
    updateSettings({ accounts: settings.accounts.map((a) => (a.id === account.id ? { ...a, balance: v, balanceSetAt: Date.now() } : a)) });
    toast({ message: `${accountLabel(account)} set to ${fmt(v)}`, tone: "good" }, 2500);
    onClose();
  };

  return (
    <Sheet
      title={`Set ${accountLabel(account)} balance`}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="bal-form">Save balance</button>
        </div>
      }
    >
      <form id="bal-form" onSubmit={submit} className="space-y-3" noValidate>
        <div>
          <label htmlFor="bal-amount" className="label">{credit ? "Amount you owe right now" : "Balance right now"}</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg text-muted">$</span>
            <input
              id="bal-amount"
              data-autofocus
              inputMode="decimal"
              autoComplete="off"
              className="input num h-14 pl-7 text-2xl font-semibold"
              value={text}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => { setText(e.target.value); setErr(""); }}
              aria-invalid={!!err}
            />
          </div>
          {err && <p role="alert" className="mt-1 text-sm text-bad">{err}</p>}
        </div>
        <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted">
          Copy this from your {credit ? "card" : "bank"} app. From now on, anything you log with this {credit ? "card" : "account"} updates it automatically. Entries you
          add later that are dated before today won't change it, since the {credit ? "card" : "bank"} already counted them.
        </p>
      </form>
    </Sheet>
  );
}

/** Add a new account or card, or edit one: nickname, limit, due day, archive, delete. */
export function AccountSheet({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const { settings, updateSettings, transactions, transfers, extraIncome, newId } = useData();
  const { toast, confirm } = useUI();
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? "credit");
  const [name, setName] = useState(account?.name ?? "");
  const [limit, setLimit] = useState(account?.creditLimit != null ? String(account.creditLimit) : "");
  const [due, setDue] = useState(account?.dueDay != null ? String(account.dueDay) : "");
  const [err, setErr] = useState<Record<string, string>>({});
  const credit = kind === "credit";
  const used =
    !!account &&
    (transactions.some((t) => t.accountId === account.id) ||
      transfers.some((t) => t.fromId === account.id || t.toId === account.id) ||
      extraIncome.some((x) => x.accountId === account.id));

  const save = (next: Account) => {
    const exists = settings.accounts.some((a) => a.id === next.id);
    updateSettings({ accounts: exists ? settings.accounts.map((a) => (a.id === next.id ? next : a)) : [...settings.accounts, next] });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const nick = name.trim();
    if (!nick) errs.name = "Give it a nickname, like Main or Travel.";
    else if (settings.accounts.some((a) => a.id !== account?.id && !a.archived && a.kind === kind && a.name.toLowerCase() === nick.toLowerCase()))
      errs.name = `You already have ${accountLabel({ name: nick, kind })}.`;
    let creditLimit: number | null = null;
    if (credit && limit.trim()) {
      creditLimit = parse(limit);
      if (!(creditLimit > 0)) errs.limit = "Enter the limit, like 5000, or leave it blank.";
    }
    let dueDay: number | null = null;
    if (credit && due.trim()) {
      dueDay = Number(due);
      if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) errs.due = "Enter a day from 1 to 31, or leave it blank.";
    }
    setErr(errs);
    if (Object.keys(errs).length) return;
    save({
      id: account?.id ?? newId(),
      name: nick,
      kind,
      order: account?.order ?? Math.max(-1, ...settings.accounts.map((a) => a.order)) + 1,
      archived: account?.archived ?? false,
      balance: account?.balance ?? 0,
      balanceSetAt: account?.balanceSetAt ?? Date.now(),
      creditLimit: credit ? creditLimit : null,
      dueDay: credit ? dueDay : null
    });
    toast({ message: account ? `${accountLabel({ name: nick, kind })} updated` : `${accountLabel({ name: nick, kind })} added`, tone: "good" }, 2500);
    onClose();
  };

  const toggleArchive = () => {
    if (!account) return;
    save({ ...account, archived: !account.archived });
    toast({ message: `${accountLabel(account)} ${account.archived ? "restored" : "archived"}`, tone: "good" }, 2500);
    onClose();
  };

  const remove = async () => {
    if (!account || used) return;
    if (!(await confirm(`Delete ${accountLabel(account)}?`, "It has nothing logged against it, so nothing else changes.", "Delete"))) return;
    updateSettings({ accounts: settings.accounts.filter((a) => a.id !== account.id) });
    onClose();
  };

  return (
    <Sheet
      title={account ? `Edit ${accountLabel(account)}` : "Add account or card"}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {account && (
            used ? (
              <button type="button" className="btn-ghost" onClick={toggleArchive}>
                {account.archived ? <ArchiveRestore size={17} aria-hidden /> : <Archive size={17} aria-hidden />} {account.archived ? "Restore" : "Archive"}
              </button>
            ) : (
              <button type="button" className="btn-ghost text-bad" onClick={remove}>
                <Trash2 size={17} aria-hidden /> Delete
              </button>
            )
          )}
          <button className="btn-outline ml-auto" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="acct-form">{account ? "Save" : "Add"}</button>
        </div>
      }
    >
      <form id="acct-form" onSubmit={submit} className="grid grid-cols-2 gap-4" noValidate>
        {!account && (
          <div className="col-span-2">
            <Segmented label="Type" value={kind} onChange={setKind} options={ACCOUNT_KINDS.map((k) => ({ value: k, label: ACCOUNT_KIND_LABEL[k] }))} />
          </div>
        )}
        <div className="col-span-2">
          <label htmlFor="acct-name" className="label">Nickname <span className="text-bad" aria-hidden>*</span></label>
          <input id="acct-name" data-autofocus className="input" placeholder={credit ? "Travel" : "Local"} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!err.name} aria-describedby="acct-name-help" />
          <p id="acct-name-help" className="mt-1 text-xs text-muted">Just a nickname. Never enter account or card numbers here.</p>
          {err.name && <p role="alert" className="mt-1 text-sm text-bad">{err.name}</p>}
        </div>
        {credit && (
          <>
            <div>
              <label htmlFor="acct-limit" className="label">Credit limit</label>
              <input id="acct-limit" inputMode="decimal" className="input num" placeholder="5000" value={limit} onChange={(e) => setLimit(e.target.value)} aria-invalid={!!err.limit} />
              {err.limit && <p role="alert" className="mt-1 text-sm text-bad">{err.limit}</p>}
            </div>
            <div>
              <label htmlFor="acct-due" className="label">Payment due day</label>
              <input id="acct-due" inputMode="numeric" className="input num" placeholder="e.g. 5" value={due} onChange={(e) => setDue(e.target.value)} aria-invalid={!!err.due} aria-describedby="acct-due-help" />
              <p id="acct-due-help" className="mt-1 text-xs text-muted">Day of the month</p>
              {err.due && <p role="alert" className="mt-1 text-sm text-bad">{err.due}</p>}
            </div>
          </>
        )}
        {account && used && (
          <p className="col-span-2 text-xs text-muted">This one has entries logged against it, so it can be archived but not deleted. Archived accounts keep their history.</p>
        )}
      </form>
    </Sheet>
  );
}

/** Money moved between two of your own accounts. Not spending, so it never touches the budget. */
export function TransferSheet({ transfer, preset, onClose }: { transfer: Transfer | null; preset?: { fromId?: string; toId?: string }; onClose: () => void }) {
  const { settings, saveTransfer, deleteTransfer, newId } = useData();
  const { toast, deleteWithUndo } = useUI();
  const [fromId, setFromId] = useState<string | null>(transfer?.fromId ?? preset?.fromId ?? null);
  const [toId, setToId] = useState<string | null>(transfer?.toId ?? preset?.toId ?? null);
  const [amount, setAmount] = useState(transfer ? transfer.amount.toFixed(2) : "");
  const [date, setDate] = useState(transfer?.date ?? todayISO());
  const [notes, setNotes] = useState(transfer?.notes ?? "");
  const [err, setErr] = useState<Record<string, string>>({});
  const nameOf = (id: string | null) => {
    const a = settings.accounts.find((x) => x.id === id);
    return a ? accountLabel(a) : "";
  };
  const to = settings.accounts.find((a) => a.id === toId);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const v = parse(amount);
    if (!fromId) errs.from = "Pick where the money came from.";
    if (!toId) errs.to = "Pick where it went.";
    else if (toId === fromId) errs.to = "Pick two different accounts.";
    if (!(v > 0)) errs.amount = "Enter an amount more than $0.";
    if (!date) errs.date = "Pick a date.";
    setErr(errs);
    if (Object.keys(errs).length) return;
    saveTransfer({ id: transfer?.id ?? newId(), fromId: fromId!, toId: toId!, amount: v, date, notes: notes.trim(), createdAt: transfer?.createdAt });
    toast({ message: `${fmt(v)} from ${nameOf(fromId)} to ${nameOf(toId)}`, tone: "good" }, 3000);
    onClose();
  };

  const remove = () => {
    if (!transfer) return;
    const copy = transfer;
    onClose();
    void deleteWithUndo({ what: `${fmt(copy.amount)} transfer`, message: `Delete the ${fmt(copy.amount)} transfer from ${nameOf(copy.fromId)} to ${nameOf(copy.toId)} on ${formatDate(copy.date)}?`, remove: () => deleteTransfer(copy.id), restore: () => saveTransfer(copy) });
  };

  return (
    <Sheet
      title={transfer ? "Edit transfer" : to && isCredit(to) ? "Pay a card" : "Transfer money"}
      onClose={onClose}
      footer={
        <div className="flex items-center gap-2">
          {transfer && (
            <button type="button" className="btn-ghost text-bad" onClick={remove}><Trash2 size={17} aria-hidden /> Delete</button>
          )}
          <button className="btn-outline ml-auto" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="xfer-form">Save</button>
        </div>
      }
    >
      <form id="xfer-form" onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="xfer-amount" className="label">Amount <span className="text-bad" aria-hidden>*</span></label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg text-muted">$</span>
            <input id="xfer-amount" data-autofocus inputMode="decimal" autoComplete="off" className="input num h-14 pl-7 text-2xl font-semibold" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!err.amount} />
          </div>
          {err.amount && <p role="alert" className="mt-1 text-sm text-bad">{err.amount}</p>}
        </div>
        <div>
          <AccountPicker id="xfer-from" label="From" accounts={settings.accounts} value={fromId} onChange={setFromId} allowNone={false} />
          {err.from && <p role="alert" className="mt-1 text-sm text-bad">{err.from}</p>}
        </div>
        <div>
          <AccountPicker id="xfer-to" label="To" accounts={settings.accounts} value={toId} onChange={setToId} allowNone={false} exclude={fromId} />
          {err.to && <p role="alert" className="mt-1 text-sm text-bad">{err.to}</p>}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="xfer-date" className="label">Date</label>
            <input id="xfer-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={!!err.date} />
            {err.date && <p role="alert" className="mt-1 text-sm text-bad">{err.date}</p>}
          </div>
          <div>
            <label htmlFor="xfer-notes" className="label">Notes</label>
            <input id="xfer-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">
          Transfers update both balances and don't count as spending in your budget. Paying a card from checking lowers both.
        </p>
      </form>
    </Sheet>
  );
}
