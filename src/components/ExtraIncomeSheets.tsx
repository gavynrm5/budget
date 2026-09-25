import { useMemo, useState, type FormEvent } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { useData } from "../store/data";
import { useUI } from "../store/ui";
import { evaluate } from "../lib/expr";
import { fmt, round2, sum } from "../lib/money";
import { formatDate, periodName, periodOfDate, todayISO } from "../lib/periods";
import { computePeriod, resolveBudget, subName } from "../lib/calc";
import { CATEGORIES, CATEGORY_LABEL, type Allocation, type ExtraIncome } from "../lib/types";
import { AccountPicker, lastAccountId } from "./AccountPicker";
import { Sheet } from "./ui";

const SOURCES = ["Birthday", "Gambling win", "Gift", "Refund", "Side job", "Bonus"];

const parse = (s: string) => {
  try {
    return round2(evaluate(s));
  } catch {
    return NaN;
  }
};

/** Log money outside regular pay. Saving a new one goes straight to assigning it. */
export function ExtraIncomeSheet({ entry, defaultDate, onClose, onSaved }: { entry: ExtraIncome | null; defaultDate?: string; onClose: () => void; onSaved: (x: ExtraIncome) => void }) {
  const { settings, extraIncome, saveExtraIncome, deleteExtraIncome, newId } = useData();
  const { toast, deleteWithUndo } = useUI();
  const [amount, setAmount] = useState(entry ? entry.amount.toFixed(2) : "");
  const [source, setSource] = useState(entry?.source ?? "");
  const [date, setDate] = useState(entry?.date ?? defaultDate ?? todayISO());
  const [accountId, setAccountId] = useState<string | null>(entry ? entry.accountId : lastAccountId(settings.accounts.filter((a) => a.kind !== "credit")));
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [err, setErr] = useState<Record<string, string>>({});
  const past = useMemo(() => [...new Set([...SOURCES, ...extraIncome.map((x) => x.source).filter(Boolean)])], [extraIncome]);
  const allocated = entry ? sum(entry.allocations.map((a) => a.amount)) : 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const v = parse(amount);
    if (!(v > 0)) errs.amount = "Enter an amount more than $0.";
    else if (v < allocated) errs.amount = `${fmt(allocated)} of it is already assigned. Remove some assignments first, or enter at least that much.`;
    if (!source.trim()) errs.source = "Say where it came from, like Birthday.";
    if (!date) errs.date = "Pick a date.";
    setErr(errs);
    if (Object.keys(errs).length) return;
    const moved = entry && periodOfDate(entry.date) !== periodOfDate(date);
    const next: ExtraIncome = {
      id: entry?.id ?? newId(),
      amount: v,
      source: source.trim(),
      date,
      accountId,
      notes: notes.trim(),
      // Assignments belong to one pay period's budget; a new period starts fresh.
      allocations: moved ? [] : entry?.allocations ?? [],
      createdAt: entry?.createdAt
    };
    saveExtraIncome(next);
    toast({ message: `${fmt(v)} ${next.source} ${entry ? "updated" : "added"}`, detail: moved ? "It moved to a different pay period, so its assignments were cleared." : undefined, tone: "good" }, 3500);
    onSaved(next);
  };

  const remove = () => {
    if (!entry) return;
    const copy = entry;
    onClose();
    void deleteWithUndo({ what: `${fmt(copy.amount)} ${copy.source}`, message: `Delete ${fmt(copy.amount)} ${copy.source} and anything it was assigned to?`, remove: () => deleteExtraIncome(copy.id), restore: () => saveExtraIncome(copy) });
  };

  return (
    <Sheet
      title={entry ? "Edit extra income" : "Add extra income"}
      onClose={onClose}
      footer={
        <div className="flex items-center gap-2">
          {entry && <button type="button" className="btn-ghost text-bad" onClick={remove}><Trash2 size={17} aria-hidden /> Delete</button>}
          <button className="btn-outline ml-auto" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="extra-form">{entry ? "Save" : "Next: assign it"}</button>
        </div>
      }
    >
      <form id="extra-form" onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="extra-amount" className="label">Amount <span className="text-bad" aria-hidden>*</span></label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg text-muted">$</span>
            <input id="extra-amount" data-autofocus inputMode="decimal" autoComplete="off" className="input num h-14 pl-7 text-2xl font-semibold" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!err.amount} />
          </div>
          {err.amount && <p role="alert" className="mt-1 text-sm text-bad">{err.amount}</p>}
        </div>
        <fieldset>
          <legend className="label">From <span className="text-bad" aria-hidden>*</span></legend>
          <div className="mb-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Common sources">
            {past.slice(0, 8).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={source === s} onClick={() => setSource(s)}
                className={`min-h-[40px] rounded-full border px-3 text-sm font-medium ${source === s ? "border-primary bg-primary text-on-primary" : "border-line bg-surface hover:bg-surface-2"}`}>
                {s}
              </button>
            ))}
          </div>
          <label htmlFor="extra-source" className="sr-only">Source</label>
          <input id="extra-source" className="input" placeholder="Or type your own" value={source} onChange={(e) => setSource(e.target.value)} aria-invalid={!!err.source} />
          {err.source && <p role="alert" className="mt-1 text-sm text-bad">{err.source}</p>}
        </fieldset>
        <div>
          <label htmlFor="extra-date" className="label">Date</label>
          <input id="extra-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={!!err.date} />
          {date && <p className="mt-1 text-xs text-muted">Counts toward {periodName(periodOfDate(date), true)}</p>}
          {err.date && <p role="alert" className="mt-1 text-sm text-bad">{err.date}</p>}
        </div>
        <AccountPicker id="extra-account" label="Deposited to" accounts={settings.accounts} value={accountId} onChange={setAccountId} />
        <div>
          <label htmlFor="extra-notes" className="label">Notes</label>
          <input id="extra-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </form>
    </Sheet>
  );
}

/**
 * Assign an extra income entry to budget lines in its pay period. Over-budget
 * lines are offered first with a one-tap Cover; any other sub-category can get
 * any amount. A sub with no line this period gets one added at $0.
 */
export function AllocateSheet({ entry, onClose }: { entry: ExtraIncome; onClose: () => void }) {
  const data = useData();
  const { settings, periods, transactions, extraIncome } = data;
  const { toast } = useUI();
  const periodId = periodOfDate(entry.date);
  const [allocs, setAllocs] = useState<Allocation[]>(entry.allocations);
  const [pickSub, setPickSub] = useState("");
  const [pickAmount, setPickAmount] = useState("");
  const [err, setErr] = useState("");

  // The period as it would look with this entry's draft assignments.
  const calc = useMemo(() => {
    const others = extraIncome.filter((x) => x.id !== entry.id);
    return computePeriod(periodId, periods, transactions, settings, [...others, { ...entry, allocations: allocs }]);
  }, [periodId, periods, transactions, settings, extraIncome, entry, allocs]);
  const assigned = round2(sum(allocs.map((a) => a.amount)));
  const left = round2(entry.amount - assigned);
  const over = CATEGORIES.flatMap((c) => calc.groups[c].lines).filter((l) => l.remaining < 0);
  const lineSubs = new Set(resolveBudget(periodId, periods, settings).lineItems.map((li) => li.subId));
  const subChoices = CATEGORIES.map((c) => ({
    category: c,
    subs: settings.subCategories.filter((s) => !s.archived && s.category === c).sort((a, b) => a.order - b.order)
  }));

  const merge = (list: Allocation[], subId: string, amount: number): Allocation[] => {
    const i = list.findIndex((a) => a.subId === subId);
    if (i < 0) return [...list, { subId, amount }];
    const next = [...list];
    next[i] = { subId, amount: round2(next[i].amount + amount) };
    return next;
  };

  const add = (subId: string, amount: number) => {
    const v = round2(Math.min(amount, left));
    if (v > 0) setAllocs((list) => merge(list, subId, v));
  };

  /** The sub and amount picked under "Put some into". A blank amount means all that's left. */
  const picked = (): { subId: string; amount: number } | { error: string } | null => {
    if (!pickSub) return pickAmount.trim() ? { error: "Pick a sub-category for that amount." } : null;
    const v = pickAmount.trim() ? parse(pickAmount) : left;
    if (!(v > 0)) return { error: left <= 0 ? "Everything is already assigned." : "Enter an amount more than $0." };
    if (v > left) return { error: `Only ${fmt(left)} is left to assign.` };
    return { subId: pickSub, amount: v };
  };

  const addPicked = () => {
    const p = picked();
    if (!p) return setErr("Pick a sub-category.");
    if ("error" in p) return setErr(p.error);
    add(p.subId, p.amount);
    setPickSub("");
    setPickAmount("");
    setErr("");
  };

  const save = () => {
    // Include a sub and amount that were picked but not added yet, so Save never drops them.
    const p = picked();
    if (p && "error" in p) return setErr(p.error);
    const final = (p ? merge(allocs, p.subId, p.amount) : allocs).filter((a) => a.amount > 0);
    const total = round2(sum(final.map((a) => a.amount)));
    // Make sure every sub that gets money has a line this period.
    const { lineItems } = resolveBudget(periodId, periods, settings);
    const missing = final.filter((a) => !lineItems.some((li) => li.subId === a.subId));
    if (missing.length) {
      data.savePeriod(periodId, [
        ...lineItems,
        ...missing.map((a) => ({ id: data.newId(), subId: a.subId, category: settings.subCategories.find((s) => s.id === a.subId)?.category ?? "Wants", budgeted: 0 }))
      ]);
    }
    data.saveExtraIncome({ ...entry, allocations: final });
    const rest = round2(entry.amount - total);
    toast(
      total
        ? { message: `Assigned ${fmt(total)} of ${entry.source}`, detail: rest > 0 ? `${fmt(rest)} left to assign later` : undefined, tone: "good" }
        : { message: `Nothing assigned from ${entry.source}`, detail: "Use Cover, or pick a sub-category, then Save.", tone: "warn" },
      4000
    );
    onClose();
  };

  return (
    <Sheet
      title={`Assign ${fmt(entry.amount)} ${entry.source}`}
      onClose={onClose}
      wide
      footer={
        <div className="flex items-center gap-2">
          <p className="num text-sm text-muted" aria-live="polite">
            <strong className="text-ink">{fmt(left)}</strong> left to assign
          </p>
          <button className="btn-outline ml-auto" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save}>Save</button>
        </div>
      }
    >
      <div className="space-y-5">
        <p className="text-sm text-muted">
          {formatDate(entry.date)}, in {periodName(periodId, true)}. Money you assign raises what's available on that line this period. Anything left stays here to assign later.
        </p>

        <section aria-labelledby="over-h">
          <h3 id="over-h" className="mb-2 font-semibold">Over budget</h3>
          {over.length === 0 ? (
            <p className="rounded-xl bg-good/10 px-3 py-2 text-sm text-good">Nothing is over budget in {periodName(periodId)}.</p>
          ) : (
            <ul className="grid gap-2">
              {over.map((l) => {
                const cover = round2(Math.min(-l.remaining, left));
                return (
                  <li key={l.item.id} className="flex items-center justify-between gap-3 rounded-xl border border-bad/30 bg-bad/5 px-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{l.name}</span>
                      <span className="num text-sm text-bad">Over by {fmt(-l.remaining)}</span>
                    </span>
                    <button className="btn-primary min-h-[40px] shrink-0 px-3 text-sm" disabled={cover <= 0} onClick={() => add(l.item.subId, cover)}>
                      Cover {fmt(cover)}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="put-h">
          <h3 id="put-h" className="mb-2 font-semibold">Put some into</h3>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[180px] flex-1">
              <label htmlFor="alloc-sub" className="label">Sub-category</label>
              <select id="alloc-sub" className="input" value={pickSub} onChange={(e) => { setPickSub(e.target.value); setErr(""); }}>
                <option value="">Choose...</option>
                {subChoices.map((g) => (
                  <optgroup key={g.category} label={CATEGORY_LABEL[g.category]}>
                    {g.subs.map((s) => <option key={s.id} value={s.id}>{s.name}{lineSubs.has(s.id) ? "" : " (adds a line)"}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="w-32">
              <label htmlFor="alloc-amount" className="label">Amount</label>
              <input id="alloc-amount" inputMode="decimal" className="input num" placeholder={left.toFixed(2)} value={pickAmount} onChange={(e) => { setPickAmount(e.target.value); setErr(""); }} />
            </div>
            <button type="button" className="btn-outline" onClick={addPicked} disabled={left <= 0}>
              <Plus size={16} aria-hidden /> Add
            </button>
          </div>
          {err && <p role="alert" className="mt-1 text-sm text-bad">{err}</p>}
          <p className="mt-1 text-xs text-muted">
            Blank amount puts in everything that's left. Save includes what you picked here, so Add is only needed to split it across several.
            For a brand new sub-category (like Fun money), create it in Settings or with Add line on the budget first.
          </p>
        </section>

        <section aria-labelledby="assigned-h">
          <h3 id="assigned-h" className="mb-2 font-semibold">Assigned</h3>
          {allocs.length === 0 ? (
            <p className="text-sm text-muted">Nothing yet.</p>
          ) : (
            <ul className="divide-y divide-line/60 rounded-xl border border-line">
              {allocs.map((a) => (
                <li key={a.subId} className="flex items-center justify-between gap-2 py-1 pl-3 pr-1">
                  <span className="truncate">{subName(settings.subCategories, a.subId)}</span>
                  <span className="flex items-center gap-1">
                    <span className="num font-medium">{fmt(a.amount)}</span>
                    <button className="icon-btn hover:text-bad" onClick={() => setAllocs((l) => l.filter((x) => x.subId !== a.subId))} aria-label={`Remove ${subName(settings.subCategories, a.subId)}`}>
                      <X size={16} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Sheet>
  );
}
