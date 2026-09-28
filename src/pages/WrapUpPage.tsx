import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, PiggyBank, TrendingDown, TrendingUp } from "lucide-react";
import { useData } from "../store/data";
import { useUI } from "../store/ui";
import { buildWrapUp, nextPeriodStart, periodEnd } from "../lib/wrapup";
import { evaluate } from "../lib/expr";
import { fmt, pct, round2 } from "../lib/money";
import { currentPeriodId, isValidPeriodId, periodName, periodRangeLabel, shiftPeriod } from "../lib/periods";
import { CATEGORY_LABEL, type Category, type WrapUp } from "../lib/types";
import { PageHeader } from "../components/ui";
import { signedFmt, toneOf } from "../components/PortfolioParts";

export default function WrapUpPage() {
  const { periodId: raw } = useParams();
  const periodId = raw && isValidPeriodId(raw) ? raw : shiftPeriod(currentPeriodId(), -1);
  const data = useData();
  const { periods, transactions, settings, extraIncome, wishLists, netWorth, wrapUps } = data;
  const { toast } = useUI();
  const navigate = useNavigate();
  const wrap: WrapUp = wrapUps.find((w) => w.id === periodId) ?? { id: periodId, moves: [], completedAt: null };
  const w = useMemo(
    () => buildWrapUp(periodId, periods, transactions, settings, extraIncome, wishLists, netWorth, wrap),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [periodId, periods, transactions, settings, extraIncome, wishLists, netWorth, wrapUps]
  );
  const ended = periodId < currentPeriodId();
  const month = periodName(periodId);
  const next = periodName(shiftPeriod(periodId, 1));

  // Where leftover can go: wishlist goal funds first, then other savings lines, then the next period.
  const goalSubs = new Set(wishLists.map((l) => l.subId).filter(Boolean) as string[]);
  const destinations = [
    ...wishLists.filter((l) => l.subId && settings.subCategories.some((s) => s.id === l.subId && !s.archived)).map((l) => ({ value: `savings:${l.subId}`, label: `${l.name} goal` })),
    ...settings.subCategories.filter((s) => s.category === "Savings" && !s.archived && !goalSubs.has(s.id)).sort((a, b) => a.order - b.order).map((s) => ({ value: `savings:${s.id}`, label: s.name })),
    { value: "carry", label: `Carry into ${next} as extra income` }
  ];
  const [dest, setDest] = useState(destinations[0]?.value ?? "carry");
  const [amount, setAmount] = useState("");
  const [err, setErr] = useState("");

  const move = (e: FormEvent) => {
    e.preventDefault();
    let v = w.leftToMove;
    if (amount.trim()) {
      try { v = round2(evaluate(amount)); } catch { v = NaN; }
    }
    if (!(v > 0)) return setErr("Enter an amount more than $0.");
    if (v > w.leftToMove + 0.001) return setErr(`Only ${fmt(w.leftToMove)} is left to move.`);
    const id = data.newId();
    const now = Date.now();
    if (dest === "carry") {
      data.saveExtraIncome({ id, date: nextPeriodStart(periodId), amount: v, source: `Left over from ${month}`, accountId: null, notes: "", allocations: [] });
      data.saveWrapUp({ ...wrap, moves: [...wrap.moves, { kind: "carry", amount: v, refId: id, at: now }] });
      toast({ message: `${fmt(v)} carried into ${next}`, detail: "It shows as extra income there, ready to assign.", tone: "good" }, 4000);
    } else {
      const subId = dest.slice("savings:".length);
      data.saveTransaction({ id, date: periodEnd(periodId), amount: v, category: "Savings", subId, description: `Leftover from ${month}`, notes: "", periodOverride: periodId, accountId: null });
      data.saveWrapUp({ ...wrap, moves: [...wrap.moves, { kind: "savings", subId, amount: v, refId: id, at: now }] });
      toast({ message: `${fmt(v)} moved to ${destinations.find((d) => d.value === dest)?.label}`, tone: "good" }, 3000);
    }
    setAmount("");
    setErr("");
  };

  const finish = () => {
    data.saveWrapUp({ ...wrap, completedAt: Date.now() });
    toast({ message: `${month} wrapped up`, tone: "good" }, 2500);
    navigate("/");
  };

  const subName = (id?: string) => settings.subCategories.find((s) => s.id === id)?.name ?? "Savings";

  return (
    <>
      <Link to="/" className="mb-2 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-muted hover:text-ink"><ArrowLeft size={16} aria-hidden /> Dashboard</Link>
      <PageHeader title={`${month} wrap-up`} subtitle={periodRangeLabel(periodId)} />

      <section aria-label="Summary" className="card mb-5 p-5">
        <p className="text-sm text-muted">{w.leftover >= 0 ? "Left over" : "Spent more than came in"}</p>
        <p className={`num text-4xl font-semibold ${w.leftover < 0 ? "text-bad" : "text-good"}`}>{fmt(Math.abs(w.leftover))}</p>
        <p className="num mt-1 text-sm text-muted">
          {fmt(w.income)} income{w.extraIncome > 0 && ` + ${fmt(w.extraIncome)} extra`} − {fmt(w.spent)} spent (including savings)
        </p>
        {w.vsPrevious && (
          <p className="num mt-2 flex items-center gap-1.5 text-sm">
            {w.vsPrevious.change > 0 ? <TrendingUp size={16} className="text-bad" aria-hidden /> : <TrendingDown size={16} className="text-good" aria-hidden />}
            Everyday spending <span className={toneOf(-w.vsPrevious.change)}>{signedFmt(w.vsPrevious.change)}</span>
            {w.vsPrevious.pct != null && ` (${pct(Math.abs(w.vsPrevious.pct), 0)} ${w.vsPrevious.change > 0 ? "more" : "less"})`} than {periodName(shiftPeriod(periodId, -1))}
          </p>
        )}
        {w.netWorth && (
          <p className="num mt-1 text-sm">Net worth <span className={toneOf(w.netWorth.change)}>{signedFmt(w.netWorth.change)}</span> over the period, to {fmt(w.netWorth.end)}</p>
        )}
      </section>

      {ended && w.leftToMove > 0 && !wrap.completedAt && (
        <section aria-labelledby="move-h" className="card mb-5 p-4 sm:p-5">
          <h2 id="move-h" className="flex items-center gap-2 text-lg"><PiggyBank size={19} className="text-primary" aria-hidden /> Put {fmt(w.leftToMove)} to work</h2>
          <p className="mb-3 text-sm text-muted">Move some or all of it into a goal or savings line (recorded as a savings entry on {month}'s last day), or carry it into {next}.</p>
          <form onSubmit={move} className="flex flex-wrap items-end gap-2" noValidate>
            <div className="min-w-[200px] flex-1">
              <label htmlFor="wr-dest" className="label">Where to</label>
              <select id="wr-dest" className="input" value={dest} onChange={(e) => setDest(e.target.value)}>
                {destinations.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
            <div className="w-36">
              <label htmlFor="wr-amt" className="label">Amount</label>
              <input id="wr-amt" inputMode="decimal" className="input num" placeholder={w.leftToMove.toFixed(2)} value={amount} onChange={(e) => { setAmount(e.target.value); setErr(""); }} aria-invalid={!!err} />
            </div>
            <button className="btn-primary" type="submit">Move</button>
          </form>
          {err && <p role="alert" className="mt-1 text-sm text-bad">{err}</p>}
          <p className="mt-1 text-xs text-muted">Leave the amount blank to move all of it.</p>
        </section>
      )}
      {!ended && <p className="mb-5 rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">{month} isn't over yet. This is how it's looking so far; moving leftover opens once it ends.</p>}

      {wrap.moves.length > 0 && (
        <section aria-labelledby="moved-h" className="card mb-5 p-4 sm:p-5">
          <h2 id="moved-h" className="mb-2 text-lg">Moved</h2>
          <ul className="divide-y divide-line/60 text-sm">
            {wrap.moves.map((m) => (
              <li key={m.refId} className="flex justify-between gap-3 py-2">
                <span>{m.kind === "carry" ? `Carried into ${next}` : `To ${subName(m.subId)}`}</span>
                <span className="num font-medium">{fmt(m.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <section aria-labelledby="plan-h" className="card p-4 sm:p-5 lg:col-span-2">
          <h2 id="plan-h" className="mb-3 text-lg">Planned vs. spent</h2>
          <ul className="grid gap-3">
            {w.groups.map((g) => {
              const max = Math.max(g.planned, g.spent, 1);
              const over = g.spent > g.planned && g.planned > 0;
              return (
                <li key={g.category}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="font-medium">{CATEGORY_LABEL[g.category as Category]}</span>
                    <span className="num text-muted"><strong className={over ? "text-bad" : "text-ink"}>{fmt(g.spent)}</strong> of {fmt(g.planned)}</span>
                  </div>
                  <div className="relative h-2.5 rounded-full bg-surface-2" aria-hidden>
                    <div className={`h-full rounded-full ${over ? "bg-bad" : "bg-primary"}`} style={{ width: `${Math.min(1, g.spent / max) * 100}%` }} />
                    {g.planned > 0 && <div className="absolute top-[-3px] h-4 w-0.5 rounded bg-ink/60" style={{ left: `calc(${(g.planned / max) * 100}% - 1px)` }} />}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <ListCard id="over-h" title="Went over" empty="Nothing went over budget. Nice." items={w.over.map((o) => ({ name: o.name, value: fmt(o.over), tone: "text-bad" }))} />
        <ListCard id="under-h" title="Stayed under" empty="No lines finished under budget with spending." items={w.under.map((u) => ({ name: u.name, value: `${fmt(u.under)} left`, tone: "text-good" }))} />
        <ListCard id="top-h" title="Biggest spending" empty="No everyday spending logged." items={w.topSpending.map((t) => ({ name: t.name, value: fmt(t.spent) }))} note="Not counting fixed bills or savings." />
        <ListCard id="goals-h" title="Saved toward goals" empty="Nothing went to wishlist goals this period." items={w.savedToGoals.map((g) => ({ name: g.name, value: fmt(g.amount), tone: "text-good" }))} />
      </div>

      {ended && !wrap.completedAt && (
        <div className="mt-6 flex justify-center">
          <button className="btn-primary" onClick={finish}><CheckCircle2 size={18} aria-hidden /> Done with {month}</button>
        </div>
      )}
      {wrap.completedAt && <p className="mt-6 text-center text-sm text-muted">Wrapped up {new Date(wrap.completedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.</p>}
    </>
  );
}

function ListCard({ id, title, items, empty, note }: { id: string; title: string; items: { name: string; value: string; tone?: string }[]; empty: string; note?: string }) {
  return (
    <section aria-labelledby={id} className="card p-4 sm:p-5">
      <h2 id={id} className="mb-2 text-lg">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-line/60 text-sm">
          {items.map((i) => (
            <li key={i.name} className="flex justify-between gap-3 py-2">
              <span>{i.name}</span>
              <span className={`num font-medium ${i.tone ?? ""}`}>{i.value}</span>
            </li>
          ))}
        </ul>
      )}
      {note && <p className="mt-2 text-xs text-muted">{note}</p>}
    </section>
  );
}
