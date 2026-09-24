import { useMemo, useRef, useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { useUI } from "../store/ui";
import { useData } from "../store/data";
import { computePeriod, resolveBudget, subsForCategory, txPeriod } from "../lib/calc";
import { evaluate, isExpression } from "../lib/expr";
import { fmt, round2 } from "../lib/money";
import { STARTER_HINTS } from "../lib/defaults";
import { periodName, periodOfDate, periodRangeLabel, shiftPeriod, todayISO } from "../lib/periods";
import { CATEGORIES, CATEGORY_LABEL, type Category, type Transaction } from "../lib/types";
import { Sheet } from "./ui";
import { AccountPicker, lastAccountId, rememberAccount } from "./AccountPicker";

type Errors = Partial<Record<"amount" | "category" | "subId" | "date", string>>;

export function TransactionSheet() {
  const { txSheet, closeTxSheet, toast, deleteWithUndo } = useUI();
  const data = useData();
  const { settings, periods, transactions } = data;
  const editing = txSheet?.editing;
  const preset = txSheet?.preset;

  const [amountText, setAmountText] = useState(editing ? editing.expression || editing.amount.toFixed(2) : "");
  const [category, setCategory] = useState<Category | null>(editing?.category ?? preset?.category ?? null);
  const [subId, setSubId] = useState<string>(editing?.subId ?? preset?.subId ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [date, setDate] = useState(editing?.date ?? todayISO());
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [accountId, setAccountId] = useState<string | null>(editing ? editing.accountId ?? null : lastAccountId(settings.accounts));
  const [override, setOverride] = useState<string | null>(editing?.periodOverride ?? preset?.periodId ?? null);
  const [showPeriodPicker, setShowPeriodPicker] = useState(!!(editing?.periodOverride ?? preset?.periodId));
  const [errors, setErrors] = useState<Errors>({});
  const [showSuggest, setShowSuggest] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);

  const autoPeriod = date ? periodOfDate(date) : null;
  const periodId = override || autoPeriod || periodOfDate(todayISO());
  const lineItems = useMemo(() => resolveBudget(periodId, periods, settings).lineItems, [periodId, periods, settings]);
  const subOptions = useMemo(() => {
    if (!category) return [];
    const list = subsForCategory(category, lineItems, settings.subCategories);
    // Keep an edited transaction's own sub-category selectable even if it was archived or moved.
    const own = editing && editing.category === category ? settings.subCategories.find((s) => s.id === editing.subId) : undefined;
    return own && !list.some((s) => s.id === own.id) ? [...list, own] : list;
  }, [category, lineItems, settings.subCategories, editing]);

  // Live evaluation of the amount field.
  let amountValue: number | null = null;
  let amountErr: string | null = null;
  if (amountText.trim()) {
    try {
      amountValue = round2(evaluate(amountText));
    } catch (e) {
      amountErr = (e as Error).message;
    }
  }
  const hasMath = amountText.trim() !== "" && isExpression(amountText);

  // Recent descriptions with their last-used category and sub-category.
  const history = useMemo(() => {
    const map = new Map<string, { description: string; category: Category; subId: string; ts: number }>();
    STARTER_HINTS.forEach((h) => map.set(h.description.toLowerCase(), { ...h, ts: 0 }));
    [...transactions]
      .sort((a, b) => (a.date + (a.createdAt ?? 0)).localeCompare(b.date + (b.createdAt ?? 0)))
      .forEach((t) => {
        const d = t.description.trim();
        if (d) map.set(d.toLowerCase(), { description: d, category: t.category, subId: t.subId, ts: t.createdAt ?? Date.parse(t.date) });
      });
    return [...map.values()].sort((a, b) => b.ts - a.ts);
  }, [transactions]);

  const suggestions = useMemo(() => {
    const q = description.trim().toLowerCase();
    const list = q ? history.filter((h) => h.description.toLowerCase().includes(q) && h.description.toLowerCase() !== q) : history;
    return list.slice(0, 5);
  }, [description, history]);

  const subName = (id: string) => settings.subCategories.find((s) => s.id === id)?.name ?? "";

  function pickSuggestion(h: (typeof history)[number]) {
    setDescription(h.description);
    setCategory(h.category);
    setSubId(h.subId);
    setShowSuggest(false);
  }

  function chooseCategory(c: Category) {
    setCategory(c);
    const valid = subsForCategory(c, lineItems, settings.subCategories).some((s) => s.id === subId);
    if (!valid) setSubId("");
    setErrors((e) => ({ ...e, category: undefined }));
  }

  function insertOp(op: string) {
    setAmountText((t) => t + op);
    amountRef.current?.focus();
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Errors = {};
    if (!amountText.trim()) errs.amount = "Enter an amount.";
    else if (amountErr || amountValue === null) errs.amount = `That math does not work (${amountErr}). Try something like 29.76+5.83.`;
    else if (amountValue <= 0) errs.amount = "Amount must be greater than $0.00.";
    if (!category) errs.category = "Pick Essentials, Wants, or Savings.";
    else if (!subId) errs.subId = "Pick a sub-category.";
    else if (!subOptions.some((s) => s.id === subId)) errs.subId = `${subName(subId)} is not in ${CATEGORY_LABEL[category]}. Pick another.`;
    if (!date) errs.date = "Pick a date.";
    setErrors(errs);
    if (Object.keys(errs).length) {
      const first = (["amount", "category", "subId", "date"] as const).find((k) => errs[k]);
      document.getElementById(`tx-${first}`)?.focus();
      return;
    }

    const tx: Transaction = {
      id: editing?.id ?? data.newId(),
      date,
      amount: amountValue!,
      expression: hasMath ? amountText.replace(/\s+/g, "") : undefined,
      category: category!,
      subId,
      description: description.trim(),
      notes: notes.trim(),
      periodOverride: override && override !== autoPeriod ? override : null,
      createdAt: editing?.createdAt,
      accountId
    };
    data.saveTransaction(tx);
    if (!editing) rememberAccount(accountId);

    // Remaining for this sub-category, computed with the saved transaction included.
    const next = [...transactions.filter((t) => t.id !== tx.id), tx];
    const calc = computePeriod(txPeriod(tx), periods, next, settings, data.extraIncome);
    const line = Object.values(calc.groups).flatMap((g) => g.lines).find((l) => l.item.subId === tx.subId);
    const name = subName(tx.subId);
    let detail: string;
    let tone: "good" | "warn" | "bad" = "good";
    if (line) {
      tone = line.status === "over" ? "bad" : line.status === "near" ? "warn" : "good";
      detail = line.remaining >= 0 ? `${fmt(line.remaining)} left in ${name} for ${periodName(calc.periodId)}` : `${name} is over by ${fmt(-line.remaining)} for ${periodName(calc.periodId)}`;
    } else detail = `${name} has no budget line in ${periodName(calc.periodId)}`;
    toast({ message: `${editing ? "Updated" : "Saved"} ${fmt(tx.amount)}`, detail, tone }, 5000);
    closeTxSheet();
  }

  async function remove() {
    if (!editing) return;
    const copy = editing;
    closeTxSheet();
    await deleteWithUndo({
      what: `${fmt(copy.amount)} ${copy.description || "transaction"}`,
      remove: () => data.deleteTransaction(copy.id),
      restore: () => data.saveTransaction(copy)
    });
  }

  const periodChoices = [-3, -2, -1, 0, 1, 2].map((d) => shiftPeriod(autoPeriod ?? periodId, d));

  return (
    <Sheet
      title={editing ? "Edit transaction" : "Add transaction"}
      onClose={closeTxSheet}
      footer={
        <div className="flex items-center gap-2">
          {editing && (
            <button type="button" className="btn-ghost text-bad" onClick={remove}>
              <Trash2 size={18} aria-hidden /> Delete
            </button>
          )}
          <button type="button" className="btn-outline ml-auto" onClick={closeTxSheet}>
            Cancel
          </button>
          <button type="submit" form="tx-form" className="btn-primary min-w-[120px]">
            {editing ? "Save changes" : "Save"}
          </button>
        </div>
      }
    >
      <form id="tx-form" onSubmit={submit} noValidate className="space-y-5">
        {/* Amount */}
        <div>
          <label htmlFor="tx-amount" className="label">
            Amount <span aria-hidden className="text-bad">*</span>
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-semibold text-muted">$</span>
            <input
              id="tx-amount"
              ref={amountRef}
              data-autofocus
              inputMode="decimal"
              autoComplete="off"
              className="input num h-16 pl-9 text-3xl font-semibold"
              placeholder="0.00"
              value={amountText}
              onChange={(e) => {
                setAmountText(e.target.value);
                setErrors((er) => ({ ...er, amount: undefined }));
              }}
              aria-invalid={!!errors.amount}
              aria-describedby="tx-amount-help"
            />
          </div>
          <div className="mt-2 flex items-center gap-2">
            {["+", "-", "*", "/"].map((op) => (
              <button
                key={op}
                type="button"
                onClick={() => insertOp(op)}
                className="h-11 w-11 rounded-xl bg-surface-2 text-lg font-semibold text-ink"
                aria-label={{ "+": "Plus", "-": "Minus", "*": "Times", "/": "Divided by" }[op]}
              >
                {{ "+": "+", "-": "−", "*": "×", "/": "÷" }[op]}
              </button>
            ))}
            <p id="tx-amount-help" className="num ml-auto text-right text-sm text-muted" aria-live="polite">
              {hasMath && amountValue !== null ? <>= <strong className="text-ink">{fmt(amountValue)}</strong></> : "Math works: 29.76+5.83"}
            </p>
          </div>
          {errors.amount && <p role="alert" className="mt-1 text-sm text-bad">{errors.amount}</p>}
        </div>

        {/* Category */}
        <fieldset>
          <legend className="label">
            Category <span aria-hidden className="text-bad">*</span>
          </legend>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Category">
            {CATEGORIES.map((c, i) => (
              <button
                key={c}
                id={i === 0 ? "tx-category" : undefined}
                type="button"
                role="radio"
                aria-checked={category === c}
                onClick={() => chooseCategory(c)}
                className={`min-h-[56px] rounded-xl border-2 px-2 text-sm font-semibold transition-colors duration-150 ${
                  category === c ? "border-primary bg-primary/10 text-primary" : "border-line bg-surface text-ink hover:bg-surface-2"
                }`}
              >
                {CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
          {errors.category && <p role="alert" className="mt-1 text-sm text-bad">{errors.category}</p>}
        </fieldset>

        {/* Sub-category */}
        <fieldset>
          <legend className="label">
            Sub-category <span aria-hidden className="text-bad">*</span>
          </legend>
          {!category ? (
            <p className="rounded-xl bg-surface-2 px-3 py-3 text-sm text-muted">Pick a category first.</p>
          ) : (
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Sub-category">
              {subOptions.map((s, i) => (
                <button
                  key={s.id}
                  id={i === 0 ? "tx-subId" : undefined}
                  type="button"
                  role="radio"
                  aria-checked={subId === s.id}
                  onClick={() => {
                    setSubId(s.id);
                    setErrors((er) => ({ ...er, subId: undefined }));
                  }}
                  className={`min-h-[44px] rounded-full border px-3.5 text-sm font-medium transition-colors duration-150 ${
                    subId === s.id ? "border-primary bg-primary text-on-primary" : "border-line bg-surface hover:bg-surface-2"
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
          {errors.subId && <p role="alert" className="mt-1 text-sm text-bad">{errors.subId}</p>}
        </fieldset>

        <AccountPicker id="tx-account" label="Paid with" accounts={settings.accounts} value={accountId} onChange={setAccountId} />

        {/* Description with suggestions */}
        <div className="relative">
          <label htmlFor="tx-description" className="label">Description</label>
          <input
            id="tx-description"
            className="input"
            autoComplete="off"
            value={description}
            placeholder="Walmart, iCloud, Shell..."
            onChange={(e) => {
              setDescription(e.target.value);
              setShowSuggest(true);
            }}
            onFocus={() => setShowSuggest(true)}
            onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
            aria-autocomplete="list"
            aria-controls="tx-suggest"
          />
          {showSuggest && suggestions.length > 0 && (
            <ul id="tx-suggest" role="listbox" data-keep-focus className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
              {suggestions.map((h) => (
                <li key={h.description} role="option" aria-selected={false}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickSuggestion(h)}
                    className="flex min-h-[44px] w-full items-center justify-between gap-3 px-3 text-left hover:bg-surface-2"
                  >
                    <span className="font-medium">{h.description}</span>
                    <span className="truncate text-xs text-muted">
                      {CATEGORY_LABEL[h.category]} / {subName(h.subId)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Date and period */}
        <div>
          <label htmlFor="tx-date" className="label">Date</label>
          <input id="tx-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={!!errors.date} />
          {errors.date && <p role="alert" className="mt-1 text-sm text-bad">{errors.date}</p>}
          <div className="mt-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted">
                Counts toward <strong className="text-ink">{periodName(periodId, true)}</strong>
                {override && override !== autoPeriod && " (set manually)"}
              </span>
              <button type="button" className="min-h-[36px] rounded-lg px-2 font-medium text-primary" onClick={() => setShowPeriodPicker((v) => !v)} aria-expanded={showPeriodPicker}>
                {showPeriodPicker ? "Done" : "Change"}
              </button>
            </div>
            {showPeriodPicker && (
              <div className="mt-2">
                <label htmlFor="tx-period" className="sr-only">Pay period</label>
                <select
                  id="tx-period"
                  className="input"
                  value={periodId}
                  onChange={(e) => setOverride(e.target.value === autoPeriod ? null : e.target.value)}
                >
                  {periodChoices.map((p) => (
                    <option key={p} value={p}>
                      {periodName(p, true)} ({periodRangeLabel(p)}){p === autoPeriod ? ", from date" : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Notes */}
        <div>
          <label htmlFor="tx-notes" className="label">Notes</label>
          <textarea id="tx-notes" rows={2} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          {hasMath && <p className="mt-1 text-xs text-muted">The math you typed ({amountText.replace(/\s+/g, "")}) is saved with the transaction.</p>}
        </div>
      </form>
    </Sheet>
  );
}
