import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, KeyRound, LineChart as LineChartIcon, Plus, RefreshCw } from "lucide-react";
import { useData } from "../store/data";
import { useUI } from "../store/ui";
import { useMarket } from "../store/market";
import { fmt, pct } from "../lib/money";
import { todayISO } from "../lib/periods";
import { buildPositions, computePortfolio, LEGACY_NOTE, portfolioSeries, type HoldingRow } from "../lib/portfolio";
import type { Trade } from "../lib/types";
import { LineChart } from "../components/LineChart";
import { EmptyState, PageHeader } from "../components/ui";
import {
  Change,
  formatShares,
  KeySetupCard,
  KeySheet,
  RangePicker,
  rangeStart,
  signedFmt,
  signedPct,
  StatCard,
  toneOf,
  TradeList,
  tradeMarkerText,
  TradeSheet,
  type Range,
  type TradePreset
} from "../components/PortfolioParts";

export default function Portfolio() {
  const { trades, settings, updateSettings, online } = useData();
  const { toast } = useUI();
  const key = settings.twelveDataKey;
  const market = useMarket(trades, key, online);
  const [range, setRange] = useState<Range>("all");
  const [editing, setEditing] = useState<{ trade: Trade | null; preset?: TradePreset } | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const positions = useMemo(() => buildPositions(trades), [trades]);
  const summary = useMemo(() => computePortfolio(positions, market.quotes), [positions, market.quotes]);
  const series = useMemo(() => portfolioSeries(trades, market.histories, market.quotes, todayISO()), [trades, market.histories, market.quotes]);
  const from = rangeStart(range);
  const chartData = useMemo(() => (from ? series.filter((p) => p.date >= from) : series), [series, from]);
  const markers = useMemo(() => trades.map((t) => ({ date: t.date, kind: t.type, text: tradeMarkerText(t, true) })), [trades]);
  const legacy = trades.filter((t) => t.notes.includes(LEGACY_NOTE));
  const recent = useMemo(() => [...trades].sort((a, b) => b.date.localeCompare(a.date)).slice(0, showAll ? undefined : 8), [trades, showAll]);

  const needsKey = !key;
  const anyOpen = summary.rows.length > 0;
  const openMarket = Object.values(market.quotes).some((q) => q?.marketOpen);
  const updated = market.fetchedAt ? new Date(market.fetchedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : null;

  return (
    <>
      <PageHeader
        title="Portfolio"
        subtitle={
          <span className="text-sm">
            {updated && anyOpen ? `Updated ${updated} · Market ${openMarket ? "open" : "closed"}` : "Stocks and ETFs"}
            {!online && " · Offline, showing saved prices"}
          </span>
        }
        actions={
          <>
            <button className="icon-btn" onClick={() => setKeyOpen(true)} aria-label="Price data settings" title="Price data settings">
              <KeyRound size={19} />
            </button>
            {!needsKey && trades.length > 0 && (
              <button className="btn-outline" onClick={() => market.refresh()} disabled={market.loading || !online} aria-label="Refresh prices">
                <RefreshCw size={17} aria-hidden className={market.loading ? "motion-safe:animate-spin" : ""} />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            )}
            <button className="btn-primary" onClick={() => setEditing({ trade: null })}>
              <Plus size={18} aria-hidden /> Add trade
            </button>
          </>
        }
      />

      {needsKey && <KeySetupCard onOpen={() => setKeyOpen(true)} />}

      {market.error && (
        <div
          role={market.error.kind === "rate-limit" ? "status" : "alert"}
          className={`mb-4 rounded-2xl border px-4 py-3 text-sm ${market.error.kind === "rate-limit" ? "border-warn/40 bg-warn/10 text-warn" : "border-bad/40 bg-bad/10 text-bad"}`}
        >
          {market.error.message}
          {market.error.kind === "bad-key" && (
            <button className="ml-2 font-semibold underline" onClick={() => setKeyOpen(true)}>Update key</button>
          )}
        </div>
      )}

      {legacy.length > 0 && (
        <div role="status" className="mb-4 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          <p className="font-medium">Your earlier entries are now trades</p>
          <p className="mt-0.5 text-muted">
            {legacy.map((t) => t.symbol).join(" and ")} {legacy.length === 1 ? "was" : "were"} turned into a buy dated the day you added it. For an
            accurate history, edit the date, or delete it and add each order from your Robinhood history.
          </p>
        </div>
      )}

      {summary.missing.length > 0 && !needsKey && !market.loading && market.fetchedAt && (
        <div role="status" className="mb-4 rounded-2xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
          No price found for {summary.missing.join(", ")}. Check the ticker. Until then it counts at the price you paid.
        </div>
      )}

      {trades.length === 0 ? (
        <div className="card">
          <EmptyState icon={<LineChartIcon size={22} />} title="No trades yet.">
            Add each buy from your Robinhood history: the date, how many shares, and the price per share. Add sales the same way.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Market value">{fmt(summary.value)}</StatCard>
            <StatCard
              label="Gain / loss"
              hint={
                <>
                  {signedPct(summary.gainPct)} on what you hold
                  {summary.realized !== 0 && <span className="block">Plus <span className={toneOf(summary.realized)}>{signedFmt(summary.realized)}</span> from sales</span>}
                </>
              }
            >
              <Change value={summary.gain} />
            </StatCard>
            <StatCard label="Today" hint={`${signedPct(summary.dayChangePct)} since last close`}>
              <Change value={summary.dayChange} />
            </StatCard>
            <StatCard label="Invested" hint={`In ${summary.rows.length} ${summary.rows.length === 1 ? "stock" : "stocks"}`}>
              {fmt(summary.cost)}
            </StatCard>
          </div>

          <div className="mb-4">
            <LineChart
              data={chartData}
              title="Value over time"
              costLabel="Invested"
              markers={markers}
              actions={<RangePicker value={range} onChange={setRange} options={["1m", "3m", "1y", "all"]} />}
            />
            {needsKey && <p className="mt-2 text-xs text-muted">Add a price key to fill in daily values between your trades.</p>}
          </div>

          {anyOpen && <HoldingsTable rows={summary.rows} />}

          {summary.rows.length > 1 && <Allocation rows={summary.rows} />}

          {summary.closed.length > 0 && (
            <section aria-labelledby="closed-h" className="card mb-4 p-4 sm:p-5">
              <h2 id="closed-h" className="mb-2 font-semibold">Sold positions</h2>
              <ul className="divide-y divide-line/60">
                {summary.closed.map((p) => (
                  <li key={p.symbol}>
                    <Link to={`/portfolio/${encodeURIComponent(p.symbol)}`} className="flex min-h-[44px] items-center justify-between gap-3 py-2 hover:text-primary">
                      <span className="font-semibold">{p.symbol}</span>
                      <span className="flex items-center gap-2 text-sm">
                        <span className="text-muted">Realized</span> <Change value={p.realized} />
                        <ChevronRight size={16} aria-hidden className="text-muted" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="activity-h" className="card">
            <div className="flex items-center justify-between px-4 pt-4 sm:px-5">
              <h2 id="activity-h" className="font-semibold">Activity</h2>
              <span className="text-sm text-muted">{trades.length} {trades.length === 1 ? "trade" : "trades"}</span>
            </div>
            <TradeList trades={recent} showSymbol onEdit={(t) => setEditing({ trade: t })} />
            {trades.length > 8 && (
              <div className="border-t border-line/60 p-2 text-center">
                <button className="btn-ghost text-sm" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? "Show fewer" : `Show all ${trades.length}`}
                </button>
              </div>
            )}
          </section>

          <p className="mt-4 text-xs text-muted">Prices from Twelve Data. They can be delayed and are for tracking only. Gains use average cost, like Robinhood.</p>
        </>
      )}

      {editing && <TradeSheet trade={editing.trade} preset={editing.preset} apiKey={key} onClose={() => setEditing(null)} />}
      {keyOpen && (
        <KeySheet
          current={key}
          onClose={() => setKeyOpen(false)}
          onSave={(k) => {
            updateSettings({ twelveDataKey: k });
            toast({ message: k ? "Price key saved" : "Price key removed", tone: "good" }, 2500);
          }}
        />
      )}
    </>
  );
}

function HoldingsTable({ rows }: { rows: HoldingRow[] }) {
  const navigate = useNavigate();
  const open = (sym: string) => navigate(`/portfolio/${encodeURIComponent(sym)}`);
  return (
    <>
      <div className="card mb-4 hidden overflow-x-auto md:block">
        <table className="w-full">
          <caption className="sr-only">Stocks you own. Select one for its price history and trades.</caption>
          <thead className="border-b border-line">
            <tr>
              <th className="th pl-5">Stock</th>
              <th className="th text-right">Shares</th>
              <th className="th text-right">Avg cost</th>
              <th className="th text-right">Price</th>
              <th className="th hidden text-right lg:table-cell">Today</th>
              <th className="th text-right">Value</th>
              <th className="th text-right">Gain / loss</th>
              <th className="th hidden text-right xl:table-cell">Weight</th>
              <th className="th pr-5"><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const p = r.position;
              return (
                <tr key={p.symbol} className="cursor-pointer border-b border-line/60 transition-colors last:border-0 hover:bg-surface-2/60" onClick={() => open(p.symbol)}>
                  <th scope="row" className="td pl-5 text-left">
                    <Link to={`/portfolio/${encodeURIComponent(p.symbol)}`} className="font-semibold hover:text-primary" onClick={(e) => e.stopPropagation()}>
                      {p.symbol}
                    </Link>
                    {r.quote?.name && <span className="block max-w-[14rem] truncate text-xs font-normal text-muted">{r.quote.name}</span>}
                  </th>
                  <td className="td num text-right">{formatShares(p.shares)}</td>
                  <td className="td num text-right">{fmt(p.avgCost)}</td>
                  <td className="td num text-right">{r.quote ? fmt(r.quote.price) : <span className="text-muted">-</span>}</td>
                  <td className="td hidden text-right text-sm lg:table-cell">{r.quote ? <span className={`num ${toneOf(r.dayChange)}`}>{signedPct(r.dayChangePct)}</span> : <span className="text-muted">-</span>}</td>
                  <td className="td num text-right font-medium">{fmt(r.value)}</td>
                  <td className="td text-right">{r.quote ? <Change value={r.gain} pctValue={r.gainPct} className="text-sm" /> : <span className="text-muted">-</span>}</td>
                  <td className="td num hidden text-right text-sm text-muted xl:table-cell">{pct(r.weight)}</td>
                  <td className="td pr-5 text-right"><ChevronRight size={18} aria-hidden className="inline text-muted" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="mb-4 grid gap-3 md:hidden">
        {rows.map((r) => {
          const p = r.position;
          return (
            <li key={p.symbol}>
              <Link to={`/portfolio/${encodeURIComponent(p.symbol)}`} className="card block p-4 transition-colors active:bg-surface-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{p.symbol}</p>
                    <p className="num text-sm text-muted">{formatShares(p.shares)} sh · avg {fmt(p.avgCost)}</p>
                  </div>
                  <div className="text-right">
                    <p className="num font-semibold">{fmt(r.value)}</p>
                    {r.quote && <p className="num text-sm text-muted">{fmt(r.quote.price)} <span className={toneOf(r.dayChange)}>{signedPct(r.dayChangePct)}</span></p>}
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  {r.quote ? <Change value={r.gain} pctValue={r.gainPct} className="text-sm" /> : <span className="text-sm text-muted">No price yet</span>}
                  <ChevronRight size={18} aria-hidden className="text-muted" />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Allocation({ rows }: { rows: HoldingRow[] }) {
  return (
    <section aria-labelledby="alloc-h" className="card mb-4 p-4 sm:p-5">
      <h2 id="alloc-h" className="mb-3 font-semibold">Allocation</h2>
      <ul className="grid gap-2.5">
        {rows.map((r) => (
          <li key={r.position.symbol} className="grid grid-cols-[4.5rem_1fr_3.5rem] items-center gap-3 text-sm">
            <span className="font-medium">{r.position.symbol}</span>
            <span className="h-2.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <span className="block h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${r.weight * 100}%` }} />
            </span>
            <span className="num text-right text-muted">{pct(r.weight)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
