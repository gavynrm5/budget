import { useState } from "react";
import { KeyRound, RefreshCw, Sparkles } from "lucide-react";
import { useData } from "../store/data";
import { useInsights } from "../store/insights";
import { fmt } from "../lib/money";
import { periodRangeLabel } from "../lib/periods";
import type { Fact } from "../lib/insights";
import { EmptyState, PageHeader } from "../components/ui";
import { ClaudeKeySheet, TipItem } from "../components/Tips";

export default function Insights() {
  const { online } = useData();
  const ins = useInsights();
  const [keyOpen, setKeyOpen] = useState(false);
  const { data } = ins;
  const habits = data.facts.filter((f): f is Extract<Fact, { kind: "habit" }> => f.kind === "habit");
  const subs = data.facts.find((f): f is Extract<Fact, { kind: "subscriptions" }> => f.kind === "subscriptions");
  const goals = data.facts.filter((f): f is Extract<Fact, { kind: "goal" }> => f.kind === "goal");
  const max = Math.max(1, ...data.spending.map((s) => Math.max(s.spent, s.available, s.usualByNow ?? 0)));
  const updated = ins.generatedAt ? new Date(ins.generatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;

  return (
    <>
      <PageHeader
        title="Insights"
        subtitle={`Day ${data.day} of ${data.daysTotal} · ${periodRangeLabel(data.periodId)}`}
        actions={
          <>
            <button className="icon-btn" onClick={() => setKeyOpen(true)} aria-label="AI tips settings" title="AI tips settings"><KeyRound size={19} /></button>
            {ins.hasKey && (
              <button className="btn-outline" onClick={() => void ins.refresh()} disabled={ins.loading || !online || !data.facts.length}>
                <RefreshCw size={17} aria-hidden className={ins.loading ? "motion-safe:animate-spin" : ""} /> {ins.loading ? "Writing..." : "Refresh tips"}
              </button>
            )}
          </>
        }
      />

      <section aria-labelledby="all-tips-h" className="card mb-5 px-4 pt-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="all-tips-h" className="flex items-center gap-2 text-lg"><Sparkles size={18} className="text-primary" aria-hidden /> Tips for this period</h2>
          <p className="text-xs text-muted" aria-live="polite">
            {ins.source === "ai" ? `Written by Claude${updated ? `, ${updated}` : ""}${ins.outdated ? ". Your spending changed since; refresh for new tips." : ""}` : "Basic tips"}
          </p>
        </div>
        {!ins.hasKey && (
          <p className="mt-2 rounded-xl bg-primary/5 px-3 py-2 text-sm">
            These come straight from the numbers. For friendlier, personal advice written by Claude,{" "}
            <button className="font-semibold text-primary underline" onClick={() => setKeyOpen(true)}>add an Anthropic API key</button>.
          </p>
        )}
        {ins.error && (
          <p role="alert" className="mt-2 rounded-xl bg-bad/10 px-3 py-2 text-sm text-bad">
            {ins.error.message} Showing basic tips for now.
            {ins.error.kind === "bad-key" && <button className="ml-1 font-semibold underline" onClick={() => setKeyOpen(true)}>Update key</button>}
          </p>
        )}
        {ins.loading && !ins.tips.length ? (
          <p className="py-6 text-center text-sm text-muted" role="status">Writing your tips...</p>
        ) : !data.facts.length ? (
          <EmptyState icon={<Sparkles size={22} />} title="Nothing to flag yet.">
            Tips show up as you log spending. {data.history.length === 0 && "Comparisons with your usual start after your first full pay period."}
          </EmptyState>
        ) : ins.tips.length ? (
          <ul className="divide-y divide-line/60">{ins.tips.map((t) => <TipItem key={t.id} tip={t} onDismiss={() => ins.dismiss(t)} />)}</ul>
        ) : (
          <p className="py-6 text-center text-sm text-muted">You've cleared every tip for this period.</p>
        )}
        {ins.hiddenCount > 0 && (
          <div className="border-t border-line/60 py-2 text-center">
            <button className="btn-ghost text-sm text-muted" onClick={ins.restoreAll}>Show {ins.hiddenCount} hidden {ins.hiddenCount === 1 ? "tip" : "tips"}</button>
          </div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section aria-labelledby="where-h" className="card p-4 sm:p-5 lg:col-span-2">
          <h2 id="where-h" className="text-lg">Where your money goes</h2>
          <p className="mb-3 text-sm text-muted">This period, not counting fixed bills or savings. The marker shows your usual by this point{data.history.length ? ` (last ${data.history.length} ${data.history.length === 1 ? "period" : "periods"})` : ""}.</p>
          {data.spending.length === 0 ? (
            <p className="text-sm text-muted">No spending logged yet this period.</p>
          ) : (
            <ul className="grid gap-3">
              {data.spending.map((s) => {
                const over = s.available > 0 && s.spent > s.available;
                return (
                  <li key={s.subId}>
                    <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                      <span className="font-medium">{s.name}</span>
                      <span className="num text-muted">
                        <strong className={over ? "text-bad" : "text-ink"}>{fmt(s.spent)}</strong>
                        {s.available > 0 && ` of ${fmt(s.available)}`}
                        {s.usualByNow != null && ` · usually ${fmt(s.usualByNow)} by now`}
                      </span>
                    </div>
                    <div className="relative h-2.5 rounded-full bg-surface-2" aria-hidden>
                      <div className={`h-full rounded-full ${over ? "bg-bad" : "bg-primary"}`} style={{ width: `${(s.spent / max) * 100}%` }} />
                      {s.available > 0 && <div className="absolute top-[-3px] h-4 w-0.5 rounded bg-ink/60" style={{ left: `calc(${(s.available / max) * 100}% - 1px)` }} title="Budget" />}
                      {s.usualByNow != null && s.usualByNow > 0 && <div className="absolute top-[-3px] h-4 w-0.5 rounded bg-warn" style={{ left: `calc(${(s.usualByNow / max) * 100}% - 1px)` }} title="Usual by now" />}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {data.spending.length > 0 && (
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-hidden>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded-full bg-primary" /> Spent</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 bg-ink/60" /> Budget</span>
              {data.history.length > 0 && <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 bg-warn" /> Usual by now</span>}
            </p>
          )}
        </section>

        <section aria-labelledby="habits-h" className="card p-4 sm:p-5">
          <h2 id="habits-h" className="mb-2 text-lg">Repeat purchases</h2>
          {habits.length === 0 ? (
            <p className="text-sm text-muted">No place shows up 3 or more times this period.</p>
          ) : (
            <ul className="divide-y divide-line/60 text-sm">
              {habits.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 py-2">
                  <span><span className="font-medium">{h.merchant}</span> <span className="text-muted">· {h.count} times, {h.subName}</span></span>
                  <span className="num font-medium">{fmt(h.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="subs-h" className="card p-4 sm:p-5">
          <h2 id="subs-h" className="mb-2 text-lg">Repeating charges</h2>
          {!subs ? (
            <p className="text-sm text-muted">None found yet. Charges that repeat each period at about the same amount show up here.</p>
          ) : (
            <>
              <ul className="divide-y divide-line/60 text-sm">
                {subs.items.map((s) => (
                  <li key={s.name} className="flex items-center justify-between gap-3 py-2"><span>{s.name}</span><span className="num">{fmt(s.amount)}</span></li>
                ))}
              </ul>
              <p className="num mt-2 text-sm font-medium">{fmt(subs.perMonth)} a month, {fmt(subs.perMonth * 12)} a year</p>
            </>
          )}
        </section>

        {goals.length > 0 && (
          <section aria-labelledby="goals-h" className="card p-4 sm:p-5 lg:col-span-2">
            <h2 id="goals-h" className="mb-2 text-lg">Goals</h2>
            <ul className="divide-y divide-line/60 text-sm">
              {goals.map((g) => (
                <li key={g.id} className="py-2">
                  <p className="font-medium">{g.listName} <span className="num font-normal text-muted">· {fmt(g.left)} to go</span></p>
                  <p className="text-muted">
                    {g.periodsAtCurrentPace != null
                      ? `At ${fmt(g.savingPerPeriod)} a month: about ${g.periodsAtCurrentPace} months. `
                      : "Nothing going in each month yet. "}
                    Adding {fmt(g.cut)} a month from {g.cutFrom}: about {g.periodsWithCut} months
                    {g.periodsSooner ? `, ${g.periodsSooner} sooner` : ""}.
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {keyOpen && <ClaudeKeySheet onClose={() => setKeyOpen(false)} />}
    </>
  );
}
