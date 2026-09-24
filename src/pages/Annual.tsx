import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useData } from "../store/data";
import { computePeriod, type PeriodCalc } from "../lib/calc";
import { currentPeriodId, parseISO, periodRangeLabel, periodsForYear, shortMonth } from "../lib/periods";
import { sum } from "../lib/money";
import { BarChart } from "../components/BarChart";
import { EmptyState, Money, PageHeader } from "../components/ui";
import { CalendarRange } from "lucide-react";

type RowDef = { label: string; get: (c: PeriodCalc) => number; strong?: boolean; divider?: boolean };

const ROWS: RowDef[] = [
  { label: "Income", get: (c) => c.income, strong: true },
  { label: "Extra Income", get: (c) => c.extraIncome },
  { label: "Essentials Budget", get: (c) => c.groups.Essentials.budgeted, divider: true },
  { label: "Essentials Spent", get: (c) => c.groups.Essentials.spent },
  { label: "Wants Budget", get: (c) => c.groups.Wants.budgeted, divider: true },
  { label: "Wants Spent", get: (c) => c.groups.Wants.spent },
  { label: "Savings Budget", get: (c) => c.groups.Savings.budgeted, divider: true },
  { label: "Savings Spent", get: (c) => c.groups.Savings.spent },
  { label: "Total Budgeted", get: (c) => c.totalBudgeted, strong: true, divider: true },
  { label: "Total Spent", get: (c) => c.totalSpent, strong: true }
];

export default function Annual() {
  const { settings, periods, transactions, extraIncome } = useData();
  const navigate = useNavigate();
  const [year, setYear] = useState(() => parseISO(currentPeriodId() + "-01").y);
  const firstYear = parseISO(settings.startPeriod + "-01").y;

  const cols = useMemo(
    () => periodsForYear(year, settings.startPeriod).map((p) => computePeriod(p, periods, transactions, settings, extraIncome)),
    [year, periods, transactions, settings, extraIncome]
  );
  const current = currentPeriodId();

  return (
    <>
      <PageHeader
        title="Annual Overview"
        subtitle="Every pay period that starts in the year, 15th to 14th."
        actions={
          <div className="flex items-center gap-1">
            <button className="icon-btn" disabled={year <= firstYear} onClick={() => setYear(year - 1)} aria-label="Previous year">
              <ChevronLeft size={22} />
            </button>
            <span className="num min-w-[4ch] text-center text-lg font-semibold" aria-live="polite">{year}</span>
            <button className="icon-btn" onClick={() => setYear(year + 1)} aria-label="Next year">
              <ChevronRight size={22} />
            </button>
          </div>
        }
      />

      {cols.length === 0 ? (
        <div className="card">
          <EmptyState icon={<CalendarRange size={22} />} title={`No periods in ${year}`}>
            Tracking starts with the period set in Settings.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="card mb-6 overflow-x-auto">
            <table className="annual w-full border-separate border-spacing-0">
              <caption className="sr-only">Budgeted and spent by pay period for {year}. Scroll sideways to see all periods.</caption>
              <thead>
                <tr>
                  <th className="th sticky left-0 z-[1] border-b border-r border-line bg-surface pl-4">Row</th>
                  {cols.map((c) => (
                    <th key={c.periodId} scope="col" className={`th border-b border-line text-right ${c.periodId === current ? "bg-primary/5" : ""}`}>
                      <button className="min-h-[36px] hover:text-ink hover:underline" onClick={() => navigate(`/budget/${c.periodId}`)} title={periodRangeLabel(c.periodId)}>
                        {shortMonth(c.periodId)}
                      </button>
                    </th>
                  ))}
                  <th scope="col" className="th border-b border-l border-line pr-4 text-right text-ink">TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => {
                  const vals = cols.map(r.get);
                  return (
                    <tr key={r.label} className={r.strong ? "font-semibold" : ""}>
                      <th scope="row" className={`td sticky left-0 z-[1] border-r border-line bg-surface pl-4 text-left text-sm ${r.divider ? "border-t" : ""} ${r.strong ? "" : "font-normal text-muted"}`}>
                        {r.label}
                      </th>
                      {vals.map((v, i) => (
                        <td key={cols[i].periodId} className={`td text-right text-sm ${r.divider ? "border-t border-line" : ""} ${cols[i].periodId === current ? "bg-primary/5" : ""}`}>
                          <Money value={v} />
                        </td>
                      ))}
                      <td className={`td border-l border-line pr-4 text-right text-sm font-semibold ${r.divider ? "border-t" : ""}`}>
                        <Money value={sum(vals)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <BarChart
            title={`Budgeted vs spent, ${year}`}
            data={cols.map((c) => ({ label: shortMonth(c.periodId), budgeted: c.totalBudgeted, spent: c.totalSpent }))}
          />
        </>
      )}
    </>
  );
}
