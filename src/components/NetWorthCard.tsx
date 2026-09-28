import { useMemo, useState } from "react";
import { useData } from "../store/data";
import { useNetWorthToday } from "../store/netWorth";
import { fmt } from "../lib/money";
import { LineChart } from "./LineChart";
import { RangePicker, rangeStart, signedFmt, toneOf, type Range } from "./PortfolioParts";

/** Net worth now (cash minus card balances plus stocks) and its history. */
export function NetWorthCard() {
  const { netWorth } = useData();
  const today = useNetWorthToday();
  const [range, setRange] = useState<Range>("3m");

  // Saved days, with today replaced by the live figure.
  const points = useMemo(() => [...netWorth.filter((p) => p.id !== today.id), today].sort((a, b) => a.id.localeCompare(b.id)), [netWorth, today]);
  const from = rangeStart(range);
  const shown = points.filter((p) => !from || p.id >= from);
  const first = shown[0];
  const change = first && first.id !== today.id ? today.total - first.total : null;

  return (
    <section aria-labelledby="nw-h" className="mb-6">
      <div className="card mb-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="nw-h" className="text-sm font-normal text-muted">Net worth</h2>
            <p className={`num text-3xl font-semibold ${today.total < 0 ? "text-bad" : ""}`}>{fmt(today.total)}</p>
            {change != null && (
              <p className="num text-sm">
                <span className={toneOf(change)}>{signedFmt(change)}</span> <span className="text-muted">since {new Date(first.id + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
              </p>
            )}
          </div>
          <dl className="grid grid-cols-3 gap-x-5 gap-y-1 text-sm">
            <div><dt className="text-muted">Cash</dt><dd className="num font-medium">{fmt(today.cash)}</dd></div>
            <div><dt className="text-muted">Cards owed</dt><dd className="num font-medium">{fmt(today.owed)}</dd></div>
            <div>
              <dt className="text-muted">Stocks</dt>
              <dd className="num font-medium">{fmt(today.investments)}{today.investmentsEstimated && today.investments > 0 && <span className="text-muted" title="At what you paid; open Portfolio to load prices">*</span>}</dd>
            </div>
          </dl>
        </div>
        {today.investmentsEstimated && today.investments > 0 && <p className="mt-2 text-xs text-muted">* Stocks count at what you paid until Portfolio loads current prices.</p>}
      </div>
      {points.length >= 2 ? (
        <LineChart
          data={shown.map((p) => ({ date: p.id, value: p.total }))}
          title="Net worth over time"
          valueLabel="Net worth"
          actions={<RangePicker value={range} onChange={setRange} options={["1m", "3m", "1y", "all"]} />}
        />
      ) : (
        <p className="text-sm text-muted">The net worth chart fills in from here, one point a day. It starts once a balance is set or a bank is connected.</p>
      )}
    </section>
  );
}
