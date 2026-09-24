import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { listSummary } from "../lib/wishlist";
import { Gift, Info, Pencil, Plus, Trash2 } from "lucide-react";
import { useData } from "../store/data";
import { useUI } from "../store/ui";
import { computePeriod, resolveBudget, type GroupCalc, type LineCalc } from "../lib/calc";
import { currentPeriodId, isValidPeriodId, periodName } from "../lib/periods";
import { fmt, pct } from "../lib/money";
import { CATEGORIES, CATEGORY_LABEL, type Category, type ExtraIncome, type LineItem, type PeriodBudget as PB } from "../lib/types";
import { accountLabel } from "../lib/accounts";
import { formatDate, periodRange, todayISO } from "../lib/periods";
import { AllocateSheet, ExtraIncomeSheet } from "../components/ExtraIncomeSheets";
import { PeriodSwitcher } from "../components/PeriodSwitcher";
import { TransactionList } from "../components/TransactionList";
import { MoneyInput } from "../components/MoneyInput";
import { Money, PageHeader, Sheet, StatusBadge } from "../components/ui";

export default function PeriodBudget() {
  const { periodId: raw } = useParams();
  const navigate = useNavigate();
  const periodId = raw && isValidPeriodId(raw) ? raw : currentPeriodId();
  const data = useData();
  const { settings, periods, transactions } = data;
  const { deleteWithUndo } = useUI();
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [adding, setAdding] = useState<Category | null>(null);
  const [extraSheet, setExtraSheet] = useState<{ kind: "edit"; entry: ExtraIncome | null } | { kind: "allocate"; entry: ExtraIncome } | null>(null);

  const base = useMemo(() => resolveBudget(periodId, periods, settings), [periodId, periods, settings]);

  // Apply unsaved keystrokes so every total recalculates while typing.
  const calc = useMemo(() => {
    const items = base.lineItems.map((li) => (li.id in drafts ? { ...li, budgeted: drafts[li.id] } : li));
    const patched: Record<string, PB> = { ...periods, [periodId]: { id: periodId, lineItems: items } };
    const c = computePeriod(periodId, patched, transactions, settings, data.extraIncome);
    return { ...c, virtual: base.virtual };
  }, [base, drafts, periods, periodId, transactions, settings, data.extraIncome]);

  // Saved amounts. The inputs compare against these, not the live drafts, so a
  // typed change is always seen as a change and saved.
  const saved = useMemo(() => new Map(base.lineItems.map((li) => [li.id, li.budgeted])), [base]);

  const save = (items: LineItem[]) => data.savePeriod(periodId, items);

  const setDraft = (id: string, v: number) =>
    setDrafts((d) => {
      const n = { ...d };
      if (v === saved.get(id)) delete n[id];
      else n[id] = v;
      return n;
    });

  const setBudget = (id: string, v: number) => {
    save(base.lineItems.map((li) => (li.id === id ? { ...li, budgeted: v } : li)));
    setDrafts((d) => {
      const n = { ...d };
      delete n[id];
      return n;
    });
  };

  const moveLine = (id: string, category: Category) => save(base.lineItems.map((li) => (li.id === id ? { ...li, category } : li)));

  const removeLine = (line: LineCalc) => {
    const before = base.lineItems;
    deleteWithUndo({
      what: `${line.name} line`,
      message: `This removes ${line.name} from the ${periodName(periodId)} budget only. Its transactions stay and still count toward the category total.`,
      remove: () => save(before.filter((li) => li.id !== line.item.id)),
      restore: () => save(before)
    });
  };

  const targetSum = CATEGORIES.reduce((a, c) => a + settings.targets[c], 0);

  // Lines that fund a wishlist goal show its progress.
  const goals = useMemo(() => {
    const m = new Map<string, GoalInfo>();
    for (const l of data.wishLists) {
      if (!l.subId) continue;
      const sm = listSummary(l, data.wishlist, transactions, currentPeriodId());
      m.set(l.subId, { listId: l.id, name: l.name, saved: sm.saved, goal: sm.goal, progress: sm.progress });
    }
    return m;
  }, [data.wishLists, data.wishlist, transactions]);

  return (
    <>
      <PageHeader
        title="Period Budget"
        actions={<PeriodSwitcher periodId={periodId} onChange={(id) => navigate(`/budget/${id}`, { replace: true })} />}
      />

      {/* Header: income and group targets */}
      <div className="card mb-5 grid grid-cols-2 gap-4 p-4 sm:grid-cols-4 sm:p-5">
        <div className="col-span-2 sm:col-span-1">
          <p className="text-sm text-muted">Income</p>
          <p className="num text-xl font-semibold">{fmt(calc.income)}</p>
        </div>
        {CATEGORIES.map((c) => (
          <div key={c}>
            <p className="text-sm text-muted">{CATEGORY_LABEL[c]} Target ({settings.targets[c]}%)</p>
            <p className="num text-xl font-semibold">{fmt(calc.groups[c].targetAmount)}</p>
          </div>
        ))}
        {targetSum !== 100 && (
          <p className="col-span-2 text-sm text-warn sm:col-span-4">
            <Info size={14} className="mr-1 inline" aria-hidden />
            Your saved targets are {CATEGORIES.map((c) => `${CATEGORY_LABEL[c]} ${settings.targets[c]}%`).join(" + ")} = {targetSum}%, not 100%. Adjust them in Settings.
          </p>
        )}
      </div>

      {calc.virtual && (
        <p className="mb-4 flex items-start gap-2 rounded-xl bg-primary/10 px-4 py-3 text-sm">
          <Info size={18} className="mt-0.5 shrink-0 text-primary" aria-hidden />
          No budget is saved for this period yet, so it shows a copy of the most recent one before it. Any edit saves it as this period's own budget.
        </p>
      )}

      <ExtraIncomeCard
        extras={calc.extras}
        total={calc.extraIncome}
        allocated={calc.extraAllocated}
        unallocated={calc.extraUnallocated}
        anyOver={CATEGORIES.some((c) => calc.groups[c].lines.some((l) => l.remaining < 0))}
        onAdd={() => setExtraSheet({ kind: "edit", entry: null })}
        onEdit={(x) => setExtraSheet({ kind: "edit", entry: x })}
        onAllocate={(x) => setExtraSheet({ kind: "allocate", entry: x })}
      />

      <div className="space-y-5">
        {CATEGORIES.map((c) => (
          <GroupSection
            key={c}
            group={calc.groups[c]}
            saved={saved}
            goals={goals}
            onLive={setDraft}
            onCommit={setBudget}
            onMove={moveLine}
            onRemove={removeLine}
            onAdd={() => setAdding(c)}
          />
        ))}

        {/* Grand total and slack */}
        <div className="card overflow-hidden">
          <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-5 sm:p-5">
            <Stat label="Total budgeted" value={<Money value={calc.totalBudgeted} />} />
            <Stat label="Total spent" value={<Money value={calc.totalSpent} />} />
            <Stat label="Remaining" value={<Money value={calc.totalRemaining} />} />
            <Stat label="% Used" value={<span className="num">{pct(calc.totalPctUsed)}</span>} extra={<StatusBadge status={calc.totalStatus} />} />
            <Stat
              label="Unallocated (slack)"
              value={<Money value={calc.unallocated} />}
              extra={calc.unallocated < 0 ? <span className="text-xs font-semibold text-bad">Over-allocated</span> : undefined}
            />
          </div>
        </div>
      </div>

      <section aria-labelledby="tx-h" className="mt-8">
        <h2 id="tx-h" className="mb-3 text-lg">Transactions in {periodName(periodId)}</h2>
        <TransactionList transactions={calc.transactions} periodId={periodId} />
      </section>

      {extraSheet?.kind === "edit" && (
        <ExtraIncomeSheet
          entry={extraSheet.entry}
          // New entries default to today when viewing the current period, else the period's first day.
          defaultDate={(() => { const r = periodRange(periodId); const t = todayISO(); return t >= r.start && t <= r.end ? t : r.start; })()}
          onClose={() => setExtraSheet(null)}
          onSaved={(x) => setExtraSheet(extraSheet.entry ? null : { kind: "allocate", entry: x })}
        />
      )}
      {extraSheet?.kind === "allocate" && <AllocateSheet entry={extraSheet.entry} onClose={() => setExtraSheet(null)} />}

      {adding && (
        <AddLineSheet
          category={adding}
          lineItems={base.lineItems}
          onClose={() => setAdding(null)}
          onAdd={(item) => {
            save([...base.lineItems, item]);
            setAdding(null);
          }}
        />
      )}
    </>
  );
}

function Stat({ label, value, extra }: { label: string; value: ReactNode; extra?: ReactNode }) {
  return (
    <div>
      <p className="text-sm text-muted">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
      {extra && <div className="mt-1">{extra}</div>}
    </div>
  );
}

function GroupSection({
  group,
  saved,
  goals,
  onLive,
  onCommit,
  onMove,
  onRemove,
  onAdd
}: {
  group: GroupCalc;
  saved: Map<string, number>;
  goals: Map<string, GoalInfo>;
  onLive: (id: string, v: number) => void;
  onCommit: (id: string, v: number) => void;
  onMove: (id: string, c: Category) => void;
  onRemove: (l: LineCalc) => void;
  onAdd: () => void;
}) {
  const title = CATEGORY_LABEL[group.category];
  const headId = `grp-${group.category}`;
  return (
    <section aria-labelledby={headId} className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
        <h2 id={headId} className="text-lg">{title}</h2>
        <p className="num text-sm text-muted">
          Target {fmt(group.targetAmount)}, budgeted <strong className={group.budgeted > group.targetAmount ? "text-warn" : "text-ink"}>{fmt(group.budgeted)}</strong>
        </p>
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full table-fixed">
          <caption className="sr-only">{title} budget lines</caption>
          <colgroup>
            <col className="w-[24%]" /><col className="w-[150px]" /><col className="w-[9%]" /><col className="w-[12%]" />
            <col className="w-[12%]" /><col className="w-[12%]" /><col className="w-[150px]" /><col className="w-[64px]" />
          </colgroup>
          <thead>
            <tr className="border-b border-line">
              <th className="th pl-5">Sub-category</th>
              <th className="th text-right">Budgeted</th>
              <th className="th text-right">Target %</th>
              <th className="th text-right">Spent</th>
              <th className="th text-right">Remaining</th>
              <th className="th text-right">% Used</th>
              <th className="th">Group</th>
              <th className="th pr-5"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {group.lines.map((l) => (
              <tr key={l.item.id} className="border-b border-line/60">
                <th scope="row" className="td truncate pl-5 text-left font-medium" title={l.name}>
                  {l.name}
                  <GoalNote goal={goals.get(l.item.subId)} />
                </th>
                <td className="td py-1.5">
                  <MoneyInput value={saved.get(l.item.id) ?? l.item.budgeted} label={`${l.name} budgeted`} onLive={(v) => onLive(l.item.id, v)} onCommit={(v) => onCommit(l.item.id, v)} />
                  {l.extra > 0 && <p className="num mt-0.5 text-right text-xs font-medium text-good">+{fmt(l.extra)} extra</p>}
                </td>
                <td className="td num text-right text-muted">{pct(l.targetPct)}</td>
                <td className="td text-right"><Money value={l.spent} /></td>
                <td className="td text-right"><Money value={l.remaining} /></td>
                <td className="td text-right">
                  <span className="inline-flex items-center justify-end gap-2">
                    <span className="num">{pct(l.pctUsed)}</span>
                    {l.pctUsed !== null && l.spent > 0 && <StatusBadge status={l.status} compact />}
                  </span>
                </td>
                <td className="td py-1.5">
                  <MoveSelect value={l.item.category} name={l.name} onChange={(c) => onMove(l.item.id, c)} />
                </td>
                <td className="td pr-5 text-right">
                  <button className="icon-btn hover:text-bad" onClick={() => onRemove(l)} aria-label={`Remove ${l.name} from this period`}>
                    <Trash2 size={17} />
                  </button>
                </td>
              </tr>
            ))}
            {group.unbudgeted.map((u) => (
              <tr key={u.subId} className="border-b border-line/60 text-muted">
                <th scope="row" className="td pl-5 text-left font-normal italic">{u.name} (no budget line)</th>
                <td className="td text-right">-</td>
                <td className="td text-right">-</td>
                <td className="td text-right"><Money value={u.spent} /></td>
                <td className="td" colSpan={4} />
              </tr>
            ))}
            <tr className="bg-surface-2/60 font-semibold">
              <th scope="row" className="td pl-5 text-left">{title} total</th>
              <td className="td text-right"><Money value={group.budgeted} /></td>
              <td className="td num text-right">{pct(group.targetPct)}</td>
              <td className="td text-right"><Money value={group.spent} /></td>
              <td className="td text-right"><Money value={group.remaining} /></td>
              <td className="td num text-right">{pct(group.pctUsed)}</td>
              <td className="td" colSpan={2}><StatusBadge status={group.status} /></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Phone rows */}
      <ul className="divide-y divide-line md:hidden">
        {group.lines.map((l) => (
          <li key={l.item.id} className="px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{l.name}</p>
                <GoalNote goal={goals.get(l.item.subId)} />
                <p className="num text-xs text-muted">{pct(l.targetPct)} of income</p>
              </div>
              <div className="w-[130px]">
                <MoneyInput value={saved.get(l.item.id) ?? l.item.budgeted} label={`${l.name} budgeted`} onLive={(v) => onLive(l.item.id, v)} onCommit={(v) => onCommit(l.item.id, v)} />
                {l.extra > 0 && <p className="num mt-0.5 text-right text-xs font-medium text-good">+{fmt(l.extra)} extra</p>}
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-sm">
              <span className="num text-muted">
                Spent <Money value={l.spent} className="text-ink" />, left <Money value={l.remaining} className="font-medium text-ink" />
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="num text-muted">{pct(l.pctUsed)}</span>
                {l.pctUsed !== null && l.spent > 0 && <StatusBadge status={l.status} compact />}
              </span>
            </div>
            <details className="mt-1">
              <summary className="min-h-[36px] py-2 text-sm text-primary">Move or remove</summary>
              <div className="flex items-center gap-2 pb-1">
                <MoveSelect value={l.item.category} name={l.name} onChange={(c) => onMove(l.item.id, c)} />
                <button className="btn-outline text-bad" onClick={() => onRemove(l)}>
                  <Trash2 size={16} aria-hidden /> Remove
                </button>
              </div>
            </details>
          </li>
        ))}
        {group.unbudgeted.map((u) => (
          <li key={u.subId} className="flex justify-between px-4 py-3 text-sm text-muted">
            <span className="italic">{u.name} (no budget line)</span>
            <Money value={u.spent} />
          </li>
        ))}
        <li className="bg-surface-2/60 px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold">{title} total</span>
            <StatusBadge status={group.status} />
          </div>
          <p className="num mt-1 text-sm text-muted">
            <Money value={group.spent} className="font-medium text-ink" /> of <Money value={group.budgeted} className="text-ink" />, {pct(group.pctUsed)} used,{" "}
            <Money value={group.remaining} className="font-medium text-ink" /> left
          </p>
        </li>
      </ul>

      <div className="border-t border-line px-2 py-1.5 sm:px-3">
        <button className="btn-ghost text-primary" onClick={onAdd}>
          <Plus size={18} aria-hidden /> Add line to {title}
        </button>
      </div>
    </section>
  );
}

function MoveSelect({ value, name, onChange }: { value: Category; name: string; onChange: (c: Category) => void }) {
  return (
    <select
      aria-label={`Group for ${name} this period`}
      className="input min-h-[40px] w-auto py-1 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value as Category)}
    >
      {CATEGORIES.map((c) => (
        <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
      ))}
    </select>
  );
}

function AddLineSheet({
  category,
  lineItems,
  onClose,
  onAdd
}: {
  category: Category;
  lineItems: LineItem[];
  onClose: () => void;
  onAdd: (item: LineItem) => void;
}) {
  const { settings, saveSubCategories, newId } = useData();
  const used = new Set(lineItems.map((li) => li.subId));
  const available = settings.subCategories.filter((s) => !s.archived && !used.has(s.id)).sort((a, b) => a.order - b.order);
  const [choice, setChoice] = useState<string>(available[0]?.id ?? "__new");
  const [newName, setNewName] = useState("");
  const [err, setErr] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    let subId = choice;
    if (choice === "__new") {
      const name = newName.trim();
      if (!name) return setErr("Give the new line a name, like Furniture.");
      const existing = settings.subCategories.find((s) => s.name.toLowerCase() === name.toLowerCase());
      if (existing && used.has(existing.id)) return setErr(`${existing.name} is already in this period.`);
      if (existing) subId = existing.id;
      else {
        subId = newId();
        const order = Math.max(0, ...settings.subCategories.map((s) => s.order)) + 1;
        saveSubCategories([...settings.subCategories, { id: subId, name, category, order, archived: false }]);
      }
    }
    onAdd({ id: newId(), subId, category, budgeted: 0 });
  };

  return (
    <Sheet
      title={`Add a line to ${CATEGORY_LABEL[category]}`}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="add-line">Add line</button>
        </div>
      }
    >
      <form id="add-line" onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="al-choice" className="label">Sub-category</label>
          <select id="al-choice" className="input" value={choice} onChange={(e) => { setChoice(e.target.value); setErr(""); }}>
            {available.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}{s.category !== category ? ` (usually ${CATEGORY_LABEL[s.category]})` : ""}
              </option>
            ))}
            <option value="__new">Create a new sub-category...</option>
          </select>
        </div>
        {choice === "__new" && (
          <div>
            <label htmlFor="al-name" className="label">New sub-category name</label>
            <input id="al-name" className="input" value={newName} onChange={(e) => { setNewName(e.target.value); setErr(""); }} placeholder="Furniture" />
          </div>
        )}
        {err && <p role="alert" className="text-sm text-bad">{err}</p>}
        <p className="text-sm text-muted">The line starts at $0.00. Set the amount right in the budget.</p>
      </form>
    </Sheet>
  );
}

function ExtraIncomeCard({
  extras,
  total,
  allocated,
  unallocated,
  anyOver,
  onAdd,
  onEdit,
  onAllocate
}: {
  extras: ExtraIncome[];
  total: number;
  allocated: number;
  unallocated: number;
  anyOver: boolean;
  onAdd: () => void;
  onEdit: (x: ExtraIncome) => void;
  onAllocate: (x: ExtraIncome) => void;
}) {
  const { settings } = useData();
  const acct = (id: string | null) => {
    const a = id ? settings.accounts.find((x) => x.id === id) : undefined;
    return a ? accountLabel(a) : "";
  };
  if (!extras.length)
    return (
      <div className="card mb-5 flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
        <p className="flex items-center gap-2 text-sm text-muted"><Gift size={18} aria-hidden className="text-primary" /> Got money outside your paycheck this period?</p>
        <button className="btn-ghost text-primary" onClick={onAdd}><Plus size={17} aria-hidden /> Add extra income</button>
      </div>
    );
  const sorted = [...extras].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <section aria-labelledby="extra-h" className="card mb-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
        <h2 id="extra-h" className="flex items-center gap-2 text-lg"><Gift size={19} aria-hidden className="text-primary" /> Extra income</h2>
        <p className="num text-sm text-muted">
          <strong className="text-ink">{fmt(total)}</strong>, {fmt(allocated)} assigned
          {unallocated > 0 && <>, <strong className="text-primary">{fmt(unallocated)} left</strong></>}
        </p>
      </div>
      {unallocated > 0 && anyOver && (
        <p className="border-b border-line bg-warn/10 px-4 py-2 text-sm text-warn sm:px-5">Something is over budget. Use Assign to cover it with extra income.</p>
      )}
      <ul className="divide-y divide-line/60">
        {sorted.map((x) => {
          const used = x.allocations.reduce((s2, a) => s2 + a.amount, 0);
          const left = Math.round((x.amount - used) * 100) / 100;
          return (
            <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 sm:px-5">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{x.source} <span className="num font-semibold">{fmt(x.amount)}</span></p>
                <p className="truncate text-xs text-muted">
                  {[formatDate(x.date), acct(x.accountId) && `to ${acct(x.accountId)}`, left > 0 ? `${fmt(left)} not assigned` : "All assigned"].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="flex items-center">
                <button className={left > 0 ? "btn-primary min-h-[40px] px-3 text-sm" : "btn-outline min-h-[40px] px-3 text-sm"} onClick={() => onAllocate(x)}>Assign</button>
                <button className="icon-btn" onClick={() => onEdit(x)} aria-label={`Edit ${x.source}`}><Pencil size={16} /></button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-line px-2 py-1.5 sm:px-3">
        <button className="btn-ghost text-primary" onClick={onAdd}><Plus size={17} aria-hidden /> Add extra income</button>
      </div>
    </section>
  );
}

interface GoalInfo {
  listId: string;
  name: string;
  saved: number;
  goal: number;
  progress: number;
}

/** Under a fund line: how far along its wishlist goal is, linking to the list. */
function GoalNote({ goal }: { goal?: GoalInfo }) {
  if (!goal) return null;
  return (
    <Link
      to={`/wishlist/${goal.listId}`}
      className="mt-0.5 flex items-center gap-2 whitespace-normal text-xs font-normal text-muted hover:text-primary"
      aria-label={`${goal.name} goal: ${fmt(goal.saved)} of ${fmt(goal.goal)} saved. Open the list.`}
    >
      <span className="h-1.5 w-10 shrink-0 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <span className="block h-full rounded-full bg-primary" style={{ width: `${goal.progress * 100}%` }} />
      </span>
      <span className="num">{fmt(goal.saved)} of {fmt(goal.goal)} saved</span>
    </Link>
  );
}
