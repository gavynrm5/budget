import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Calculator, Pencil, ReceiptText, Trash2 } from "lucide-react";
import type { Transaction } from "../lib/types";
import { CATEGORIES, CATEGORY_LABEL, type Category } from "../lib/types";
import { formatDate, periodOfDate } from "../lib/periods";
import { useData } from "../store/data";
import { useUI } from "../store/ui";
import { fmt, sum } from "../lib/money";
import { EmptyState, Money } from "./ui";

type SortKey = "date" | "amount" | "description" | "sub";

export function TransactionList({ transactions, periodId }: { transactions: Transaction[]; periodId: string }) {
  const { settings, deleteTransaction, saveTransaction } = useData();
  const { openTxSheet, deleteWithUndo } = useUI();
  const [cat, setCat] = useState<Category | "all">("all");
  const [sub, setSub] = useState<string>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "date", dir: -1 });

  const subName = (id: string) => settings.subCategories.find((s) => s.id === id)?.name ?? "Unknown";

  const subChoices = useMemo(() => {
    const ids = new Set(transactions.filter((t) => cat === "all" || t.category === cat).map((t) => t.subId));
    return [...ids].map((id) => ({ id, name: subName(id) })).sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, cat, settings.subCategories]);

  const rows = useMemo(() => {
    const list = transactions.filter((t) => (cat === "all" || t.category === cat) && (sub === "all" || t.subId === sub));
    const val = (t: Transaction): string | number =>
      sort.key === "amount" ? t.amount : sort.key === "description" ? t.description.toLowerCase() : sort.key === "sub" ? subName(t.subId).toLowerCase() : t.date + String(t.createdAt ?? 0).padStart(15, "0");
    return [...list].sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * sort.dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, cat, sub, sort, settings.subCategories]);

  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === "date" || key === "amount" ? -1 : 1 }));

  const remove = (t: Transaction) =>
    deleteWithUndo({
      what: `${fmt(t.amount)} ${t.description || "transaction"}`,
      remove: () => deleteTransaction(t.id),
      restore: () => saveTransaction(t)
    });

  const SortHead = ({ k, label, right }: { k: SortKey; label: string; right?: boolean }) => (
    <th className={`th ${right ? "text-right" : ""}`} aria-sort={sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button className={`inline-flex min-h-[36px] items-center gap-1 hover:text-ink ${sort.key === k ? "text-ink" : ""}`} onClick={() => toggleSort(k)}>
        {label}
        {sort.key === k && (sort.dir === 1 ? <ArrowUp size={14} aria-hidden /> : <ArrowDown size={14} aria-hidden />)}
      </button>
    </th>
  );

  if (!transactions.length)
    return (
      <div className="card">
        <EmptyState icon={<ReceiptText size={22} />} title="No transactions yet this period.">
          <span className="lg:hidden">Tap + to add one.</span>
          <span className="hidden lg:inline">Press N or use Add transaction to log one.</span>
        </EmptyState>
      </div>
    );

  return (
    <div className="card">
      <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
        <div className="min-w-[150px] flex-1 sm:flex-none">
          <label htmlFor="flt-cat" className="label">Category</label>
          <select id="flt-cat" className="input" value={cat} onChange={(e) => { setCat(e.target.value as Category | "all"); setSub("all"); }}>
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </div>
        <div className="min-w-[150px] flex-1 sm:flex-none">
          <label htmlFor="flt-sub" className="label">Sub-category</label>
          <select id="flt-sub" className="input" value={sub} onChange={(e) => setSub(e.target.value)}>
            <option value="all">All sub-categories</option>
            {subChoices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="md:hidden">
          <label htmlFor="flt-sort" className="label">Sort</label>
          <select
            id="flt-sort"
            className="input"
            value={`${sort.key}:${sort.dir}`}
            onChange={(e) => { const [k, d] = e.target.value.split(":"); setSort({ key: k as SortKey, dir: Number(d) as 1 | -1 }); }}
          >
            <option value="date:-1">Newest first</option>
            <option value="date:1">Oldest first</option>
            <option value="amount:-1">Largest amount</option>
            <option value="amount:1">Smallest amount</option>
            <option value="description:1">Description A to Z</option>
          </select>
        </div>
        <p className="num ml-auto self-center text-sm text-muted">
          {rows.length} shown, <strong className="text-ink">{fmt(sum(rows.map((r) => r.amount)))}</strong>
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="p-6 text-center text-muted">Nothing matches these filters.</p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full">
              <caption className="sr-only">Transactions this period</caption>
              <thead className="border-b border-line">
                <tr>
                  <SortHead k="date" label="Date" />
                  <SortHead k="description" label="Description" />
                  <th className="th">Category</th>
                  <SortHead k="sub" label="Sub-category" />
                  <SortHead k="amount" label="Amount" right />
                  <th className="th"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className="border-b border-line/60 last:border-0 hover:bg-surface-2/50">
                    <td className="td num text-sm">
                      {formatDate(t.date)}
                      {periodOfDate(t.date) !== periodId && <span className="ml-1 text-xs text-muted">(moved)</span>}
                    </td>
                    <td className="td max-w-[260px] truncate" title={t.notes || undefined}>{t.description || <span className="text-muted">No description</span>}</td>
                    <td className="td text-sm text-muted">{CATEGORY_LABEL[t.category]}</td>
                    <td className="td text-sm">{subName(t.subId)}</td>
                    <td className="td text-right font-medium">
                      <span className="inline-flex items-center gap-1" title={t.expression ? `Typed as ${t.expression}` : undefined}>
                        {t.expression && <Calculator size={14} className="text-muted" aria-label={`Typed as ${t.expression}`} />}
                        <Money value={t.amount} />
                      </span>
                    </td>
                    <td className="td w-[100px] text-right">
                      <button className="icon-btn" onClick={() => openTxSheet({ editing: t })} aria-label={`Edit ${t.description || "transaction"}`}><Pencil size={17} /></button>
                      <button className="icon-btn hover:text-bad" onClick={() => remove(t)} aria-label={`Delete ${t.description || "transaction"}`}><Trash2 size={17} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phone list */}
          <ul className="divide-y divide-line md:hidden">
            {rows.map((t) => (
              <li key={t.id} className="flex items-center gap-2 pl-4 pr-2">
                <button className="flex min-h-[64px] min-w-0 flex-1 items-center gap-3 py-2 text-left" onClick={() => openTxSheet({ editing: t })} aria-label={`Edit ${t.description || "transaction"}, ${fmt(t.amount)}`}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{t.description || "No description"}</p>
                    <p className="truncate text-sm text-muted">{subName(t.subId)}, {formatDate(t.date)}</p>
                  </div>
                  <div className="text-right">
                    <Money value={t.amount} className="font-semibold" />
                    {t.expression && <p className="num text-xs text-muted">{t.expression}</p>}
                  </div>
                </button>
                <button className="icon-btn hover:text-bad" onClick={() => remove(t)} aria-label={`Delete ${t.description || "transaction"}`}><Trash2 size={17} /></button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
