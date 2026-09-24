import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CalendarClock, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useData } from "../store/data";
import { computePeriod } from "../lib/calc";
import { currentPeriodId, formatDate, isValidPeriodId, parseISO, periodName, periodRangeLabel, periodsForYear, todayISO } from "../lib/periods";
import { accountLabel, activeAccounts, computeBalances, nextDue } from "../lib/accounts";
import { fmt, pct } from "../lib/money";
import { PeriodSwitcher } from "../components/PeriodSwitcher";
import { PeriodRuler } from "../components/PeriodRuler";
import { CategoryTable } from "../components/CategoryTable";
import { Money, PageHeader, StatusBadge, SummaryCard } from "../components/ui";

export default function Dashboard() {
  const { settings, periods, transactions, extraIncome, transfers } = useData();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const raw = params.get("p");
  const periodId = raw && isValidPeriodId(raw) ? raw : currentPeriodId();
  const setPeriod = (id: string) => setParams(id === currentPeriodId() ? {} : { p: id }, { replace: true });

  const calc = useMemo(() => computePeriod(periodId, periods, transactions, settings, extraIncome), [periodId, periods, transactions, settings, extraIncome]);
  const year = parseISO(periodId + "-01").y;
  const yearRows = useMemo(
    () => periodsForYear(year, settings.startPeriod).map((p) => computePeriod(p, periods, transactions, settings, extraIncome)),
    [year, periods, transactions, settings, extraIncome]
  );
  const current = currentPeriodId();

  // Cards with a balance due in the next week.
  const dueSoon = useMemo(() => {
    const bal = computeBalances(settings.accounts, transactions, transfers, extraIncome);
    const today = todayISO();
    return activeAccounts(settings.accounts)
      .filter((a) => a.kind === "credit" && a.dueDay && bal[a.id] > 0)
      .map((a) => ({ account: a, owed: bal[a.id], ...nextDue(a.dueDay!, today) }))
      .filter((d) => d.days <= 7)
      .sort((x, y) => x.days - y.days);
  }, [settings.accounts, transactions, transfers, extraIncome]);

  return (
    <>
      <PageHeader title="Dashboard" actions={<PeriodSwitcher periodId={periodId} onChange={setPeriod} />} />

      {dueSoon.length > 0 && (
        <section aria-label="Card payments due soon" className="mb-4 rounded-2xl border border-warn/40 bg-warn/10 px-4 py-3">
          <ul className="grid gap-1">
            {dueSoon.map((d) => (
              <li key={d.account.id} className="flex flex-wrap items-center gap-x-2 text-sm">
                <CalendarClock size={16} aria-hidden className="text-warn" />
                <strong>{accountLabel(d.account)}</strong>
                <span>due {d.days === 0 ? "today" : d.days === 1 ? "tomorrow" : `in ${d.days} days`} ({formatDate(d.date)})</span>
                <span className="num text-muted">· balance {fmt(d.owed)}</span>
              </li>
            ))}
          </ul>
          <Link to="/accounts" className="mt-1 inline-flex min-h-[36px] items-center text-sm font-medium text-primary hover:underline">Go to accounts</Link>
        </section>
      )}

      <PeriodRuler calc={calc} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Monthly Income" value={calc.income} hint={calc.extraIncome > 0 ? `Plus ${fmt(calc.extraIncome)} extra this period` : settings.takeHomeNote} />
        <SummaryCard label="Total Budgeted" value={calc.totalBudgeted} hint={calc.unallocated < 0 ? `Over-allocated by ${fmt(-calc.unallocated)}` : `${fmt(calc.unallocated)} unallocated`} />
        <SummaryCard label="Total Spent" value={calc.totalSpent} />
        <SummaryCard label="Left from Income" value={calc.leftFromIncome} tone={calc.leftFromIncome < 0 ? "bad" : undefined} hint={calc.extraIncome > 0 ? "Income and extra, minus spent" : "Income minus spent"} />
      </div>

      <section aria-labelledby="cat-h" className="mb-8">
        <h2 id="cat-h" className="mb-3 text-lg">By category</h2>
        <CategoryTable calc={calc} />
      </section>

      <section aria-labelledby="year-h">
        <h2 id="year-h" className="mb-3 text-lg">{year} at a glance</h2>
        {yearRows.length === 0 ? (
          <p className="text-muted">No periods in {year} yet. Your first period is set in Settings.</p>
        ) : (
          <>
            <div className="card hidden overflow-x-auto md:block">
              <table className="w-full">
                <caption className="sr-only">Every pay period in {year}. Select a row to open that period.</caption>
                <thead className="border-b border-line">
                  <tr>
                    <th className="th pl-5">Period</th>
                    <th className="th">Dates</th>
                    <th className="th text-right">Budgeted</th>
                    <th className="th text-right">Spent</th>
                    <th className="th text-right">Remaining</th>
                    <th className="th text-right">% Used</th>
                    <th className="th pr-5"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody>
                  {yearRows.map((r) => (
                    <tr
                      key={r.periodId}
                      onClick={() => navigate(`/budget/${r.periodId}`)}
                      className={`cursor-pointer border-b border-line/60 last:border-0 hover:bg-surface-2/60 ${r.periodId === current ? "bg-primary/5" : ""}`}
                    >
                      <th scope="row" className="td pl-5 text-left font-medium">
                        <button className="text-left hover:underline" onClick={(e) => { e.stopPropagation(); navigate(`/budget/${r.periodId}`); }}>
                          {periodName(r.periodId)}
                        </button>
                        {r.periodId === current && <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">Now</span>}
                      </th>
                      <td className="td num text-sm text-muted">{periodRangeLabel(r.periodId)}</td>
                      <td className="td text-right"><Money value={r.totalBudgeted} /></td>
                      <td className="td text-right"><Money value={r.totalSpent} /></td>
                      <td className="td text-right"><Money value={r.totalRemaining} /></td>
                      <td className="td text-right">
                        <span className="inline-flex items-center gap-2">
                          <span className="num">{pct(r.totalPctUsed)}</span>
                          {r.totalSpent > 0 && <StatusBadge status={r.totalStatus} compact />}
                        </span>
                      </td>
                      <td className="td pr-5 text-muted"><ChevronRight size={18} aria-hidden /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="grid gap-2 md:hidden">
              {yearRows.map((r) => (
                <li key={r.periodId}>
                  <button
                    onClick={() => navigate(`/budget/${r.periodId}`)}
                    className={`card flex min-h-[64px] w-full items-center gap-3 p-4 text-left ${r.periodId === current ? "border-primary/50" : ""}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {periodName(r.periodId)} {r.periodId === current && <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">Now</span>}
                      </p>
                      <p className="num text-xs text-muted">{periodRangeLabel(r.periodId)}</p>
                    </div>
                    <div className="num text-right text-sm">
                      <p><Money value={r.totalSpent} className="font-semibold" /> <span className="text-muted">of</span> <Money value={r.totalBudgeted} /></p>
                      <p className="text-muted">
                        <Money value={r.totalRemaining} /> left, {pct(r.totalPctUsed)}
                      </p>
                    </div>
                    <ChevronRight size={18} className="text-muted" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
