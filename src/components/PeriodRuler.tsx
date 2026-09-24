import type { PeriodCalc } from "../lib/calc";
import { dayOfPeriod, daysInPeriod, formatDate, parseISO, periodRange, todayISO } from "../lib/periods";
import { pct } from "../lib/money";

/**
 * The pay period drawn as a ruler from the 15th to the 14th, with today's
 * position and how much of the budget is already spent beneath it.
 */
export function PeriodRuler({ calc }: { calc: PeriodCalc }) {
  const id = calc.periodId;
  const total = daysInPeriod(id);
  const { start, end } = periodRange(id);
  const today = todayISO();
  const state = today < start ? "future" : today > end ? "past" : "now";
  const day = state === "now" ? dayOfPeriod(id, today) : state === "past" ? total : 0;
  const elapsed = day / total;
  const spentShare = calc.totalBudgeted > 0 ? calc.totalSpent / calc.totalBudgeted : 0;
  const ahead = state === "now" && spentShare > elapsed + 0.1;

  // Tick marks: one per day, taller at the 1st of the month.
  const s = parseISO(start);
  const ticks = Array.from({ length: total }, (_, i) => {
    const d = new Date(s.y, s.m - 1, s.d + i);
    return { i, date: d.getDate(), first: d.getDate() === 1 };
  });
  const firstIdx = ticks.find((t) => t.first)?.i ?? Math.floor(total / 2);
  const monthName = (iso: string) => formatDate(iso).split(" ")[0];

  let headline: string;
  if (state === "now") headline = `Day ${day} of ${total}`;
  else if (state === "past") headline = "This period has ended";
  else headline = `Starts ${formatDate(start)}`;

  return (
    <section aria-labelledby="ruler-h" className="card mb-5 p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="ruler-h" className="text-base font-semibold">{headline}</h2>
        <p className="text-sm text-muted">
          {state === "now" && (
            <>
              {pct(elapsed, 0)} of the period gone, <span className={`font-medium ${ahead ? "text-warn" : "text-ink"}`}>{pct(spentShare, 0)} of the budget spent</span>
              {ahead ? ". Spending is ahead of pace." : "."}
            </>
          )}
          {state === "past" && <>{pct(spentShare, 0)} of the budget was spent.</>}
          {state === "future" && <>Nothing to track yet. The budget is ready when it starts.</>}
        </p>
      </div>

      <div className="relative" aria-hidden>
        {/* Day ruler */}
        <div className="relative h-8">
          <div className="absolute inset-x-0 bottom-0 h-3 overflow-hidden rounded-md bg-surface-2">
            <div className="h-full bg-primary/25" style={{ width: `${elapsed * 100}%` }} />
          </div>
          <div className="absolute inset-x-0 bottom-0 flex h-full items-end">
            {ticks.map((t) => (
              <div key={t.i} className="flex h-full flex-1 items-end justify-center">
                <div className={`w-px ${t.first ? "h-6 bg-muted" : t.i % 5 === 0 ? "h-4 bg-line" : "h-3 bg-line/70"}`} />
              </div>
            ))}
          </div>
          {state === "now" && (
            <div className="absolute bottom-0 top-0 -ml-[1.5px] w-[3px] rounded-full bg-primary" style={{ left: `${((day - 0.5) / total) * 100}%` }} />
          )}
        </div>
        <div className="num relative mt-1 h-4 text-xs text-muted">
          <span className="absolute left-0">{monthName(start)} 15</span>
          <span className="absolute -translate-x-1/2" style={{ left: `${((firstIdx + 0.5) / total) * 100}%` }}>{monthName(end)} 1</span>
          <span className="absolute right-0">{monthName(end)} 14</span>
        </div>
        {/* Budget spent bar lined up under the ruler */}
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-surface-2">
          <div
            className={`h-full rounded-full ${calc.totalStatus === "over" ? "bg-bad" : calc.totalStatus === "near" ? "bg-warn" : "bg-good"}`}
            style={{ width: `${Math.min(1, spentShare) * 100}%` }}
          />
        </div>
      </div>
      <p className="sr-only">
        {headline}. {pct(elapsed, 0)} of the period has passed and {pct(spentShare, 0)} of the budget is spent.
      </p>
    </section>
  );
}
