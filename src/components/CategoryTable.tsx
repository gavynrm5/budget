import type { PeriodCalc } from "../lib/calc";
import { pct } from "../lib/money";
import { CATEGORIES, CATEGORY_LABEL } from "../lib/types";
import { Money, ProgressBar, StatusBadge } from "./ui";
import type { Status } from "../lib/calc";

interface Row {
  key: string;
  label: string;
  budgeted: number;
  spent: number;
  remaining: number;
  pctUsed: number;
  status: Status;
  total?: boolean;
}

export function CategoryTable({ calc }: { calc: PeriodCalc }) {
  const rows: Row[] = [
    ...CATEGORIES.map((c) => ({ key: c, label: CATEGORY_LABEL[c], ...calc.groups[c] })),
    {
      key: "total",
      label: "Total",
      budgeted: calc.totalBudgeted,
      spent: calc.totalSpent,
      remaining: calc.totalRemaining,
      pctUsed: calc.totalPctUsed,
      status: calc.totalStatus,
      total: true
    }
  ];

  return (
    <>
      {/* Desktop and tablet table */}
      <div className="card hidden overflow-x-auto md:block">
        <table className="w-full">
          <caption className="sr-only">Spending by category</caption>
          <thead className="border-b border-line">
            <tr>
              <th className="th pl-5">Category</th>
              <th className="th text-right">Budgeted</th>
              <th className="th text-right">Spent</th>
              <th className="th text-right">Remaining</th>
              <th className="th text-right">% Used</th>
              <th className="th w-[22%]">Progress</th>
              <th className="th pr-5">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={r.total ? "border-t-2 border-line font-semibold" : "border-b border-line/60 last:border-0"}>
                <th scope="row" className="td pl-5 text-left font-medium">{r.label}</th>
                <td className="td text-right"><Money value={r.budgeted} /></td>
                <td className="td text-right"><Money value={r.spent} /></td>
                <td className="td text-right"><Money value={r.remaining} /></td>
                <td className="td num text-right">{pct(r.pctUsed)}</td>
                <td className="td"><ProgressBar value={r.pctUsed} status={r.status} label={`${r.label} percent used`} /></td>
                <td className="td pr-5"><StatusBadge status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone: stacked cards */}
      <ul className="grid gap-3 md:hidden">
        {rows.map((r) => (
          <li key={r.key} className={`card p-4 ${r.total ? "border-2" : ""}`}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="font-semibold">{r.label}</h3>
              <StatusBadge status={r.status} />
            </div>
            <ProgressBar value={r.pctUsed} status={r.status} label={`${r.label} percent used`} />
            <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
              <div><dt className="text-muted">Spent</dt><dd><Money value={r.spent} className="font-medium" /></dd></div>
              <div><dt className="text-muted">of Budget</dt><dd><Money value={r.budgeted} /></dd></div>
              <div className="text-right"><dt className="text-muted">Left</dt><dd><Money value={r.remaining} className="font-medium" /></dd></div>
            </dl>
            <p className="num mt-1 text-right text-xs text-muted">{pct(r.pctUsed)} used</p>
          </li>
        ))}
      </ul>
    </>
  );
}
