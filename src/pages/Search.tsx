import { useMemo, useState } from "react";
import { Search as SearchIcon } from "lucide-react";
import { useData } from "../store/data";
import { useUI } from "../store/ui";
import { byPeriod, searchTransactions, totalOf, type SearchFilters } from "../lib/search";
import { accountLabel, activeAccounts } from "../lib/accounts";
import { fmt } from "../lib/money";
import { currentPeriodId, formatDate, periodRange, shiftPeriod, shortMonth, toISODate } from "../lib/periods";
import { CATEGORIES, CATEGORY_LABEL } from "../lib/types";
import { EmptyState, PageHeader } from "../components/ui";

type When = "all" | "period" | "3p" | "year";

function rangeFor(w: When): { from: string | null; to: string | null } {
  const cur = currentPeriodId();
  if (w === "period") return { from: periodRange(cur).start, to: null };
  if (w === "3p") return { from: periodRange(shiftPeriod(cur, -2)).start, to: null };
  if (w === "year") {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return { from: toISODate(d), to: null };
  }
  return { from: null, to: null };
}

export default function Search() {
  const { transactions, settings } = useData();
  const { openTxSheet } = useUI();
  const [text, setText] = useState("");
  const [when, setWhen] = useState<When>("all");
  const [category, setCategory] = useState<string>("all");
  const [accountId, setAccountId] = useState<string>("all");

  const filters: SearchFilters = { text, ...rangeFor(when), category, accountId };
  const active = text.trim() || when !== "all" || category !== "all" || accountId !== "all";
  const results = useMemo(
    () => (active ? searchTransactions(transactions, settings, filters) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transactions, settings, text, when, category, accountId]
  );
  const periods = byPeriod(results);
  const max = Math.max(1, ...periods.map((p) => p.total));
  const total = totalOf(results);
  const subName = (id: string) => settings.subCategories.find((s) => s.id === id)?.name ?? "";
  const acct = (id?: string | null) => {
    const a = id ? settings.accounts.find((x) => x.id === id) : undefined;
    return a ? accountLabel(a) : "";
  };

  return (
    <>
      <PageHeader title="Search" subtitle="Every transaction, across all pay periods" />
      <div className="card mb-4 p-4">
        <label htmlFor="q" className="sr-only">Search transactions</label>
        <div className="relative">
          <SearchIcon size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input id="q" type="search" data-autofocus autoFocus className="input h-12 pl-10 text-base" placeholder="Starbucks, Amazon, 42.18, groceries..." value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div>
            <label htmlFor="q-when" className="label">When</label>
            <select id="q-when" className="input" value={when} onChange={(e) => setWhen(e.target.value as When)}>
              <option value="all">All time</option>
              <option value="period">This pay period</option>
              <option value="3p">Last 3 pay periods</option>
              <option value="year">Last 12 months</option>
            </select>
          </div>
          <div>
            <label htmlFor="q-cat" className="label">Group</label>
            <select id="q-cat" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="all">All groups</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="q-acct" className="label">Paid with</label>
            <select id="q-acct" className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="all">Any account</option>
              <option value="none">Not set</option>
              {activeAccounts(settings.accounts).map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
            </select>
          </div>
        </div>
      </div>

      {!active ? (
        <div className="card">
          <EmptyState icon={<SearchIcon size={22} />} title="Search your spending">Type a store, a note, a sub-category, or an amount.</EmptyState>
        </div>
      ) : results.length === 0 ? (
        <p className="card p-6 text-center text-muted">No transactions match.</p>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <div className="card p-4"><p className="text-sm text-muted">Total</p><p className="num text-xl font-semibold">{fmt(total)}</p></div>
            <div className="card p-4"><p className="text-sm text-muted">Times</p><p className="num text-xl font-semibold">{results.length}</p></div>
            <div className="card p-4"><p className="text-sm text-muted">Average</p><p className="num text-xl font-semibold">{fmt(total / results.length)}</p></div>
          </div>

          {periods.length > 1 && (
            <section aria-labelledby="q-trend" className="card mb-4 p-4">
              <h2 id="q-trend" className="mb-3 text-sm font-medium text-muted">By pay period</h2>
              <div className="flex h-28 items-end gap-1.5 overflow-x-auto" role="list">
                {periods.map((p) => (
                  <div key={p.periodId} role="listitem" className="flex min-w-[34px] flex-1 flex-col items-center gap-1" aria-label={`${shortMonth(p.periodId)}: ${fmt(p.total)} over ${p.count}`}>
                    <span className="num text-[11px] text-muted" aria-hidden>{fmt(p.total).replace(/\.\d\d$/, "")}</span>
                    <div className="w-full max-w-[28px] rounded-t-md bg-primary" style={{ height: `${Math.max(4, (p.total / max) * 72)}px` }} aria-hidden />
                    <span className="text-[11px] text-muted" aria-hidden>{shortMonth(p.periodId)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <ul className="card divide-y divide-line/60">
            {results.slice(0, 300).map((t) => (
              <li key={t.id}>
                <button className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface-2/60" onClick={() => openTxSheet({ editing: t })} aria-label={`Edit ${t.description || "transaction"}, ${fmt(t.amount)}`}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{t.description || "No description"}</span>
                    <span className="block truncate text-xs text-muted">{[formatDate(t.date), subName(t.subId), acct(t.accountId), t.notes].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="num shrink-0 font-semibold">{fmt(t.amount)}</span>
                </button>
              </li>
            ))}
          </ul>
          {results.length > 300 && <p className="mt-2 text-center text-sm text-muted">Showing the newest 300 of {results.length}. Narrow the search to see the rest.</p>}
        </>
      )}
    </>
  );
}
