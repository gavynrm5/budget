import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Minus, Plus } from "lucide-react";
import { useData } from "../store/data";
import { useMarket } from "../store/market";
import { fmt, pct } from "../lib/money";
import { todayISO } from "../lib/periods";
import { buildPositions, computePortfolio, normalizeSymbol, portfolioSeries } from "../lib/portfolio";
import type { Trade } from "../lib/types";
import { LineChart, type LinePoint } from "../components/LineChart";
import { PageHeader, Segmented } from "../components/ui";
import {
  Change,
  formatShares,
  RangePicker,
  rangeStart,
  signedPct,
  StatCard,
  TradeList,
  tradeMarkerText,
  TradeSheet,
  type Range,
  type TradePreset
} from "../components/PortfolioParts";

type View = "price" | "position";

export default function Stock() {
  const symbol = normalizeSymbol(decodeURIComponent(useParams().symbol ?? ""));
  const { trades, settings, online } = useData();
  const key = settings.twelveDataKey;
  const market = useMarket(trades, key, online);
  const [range, setRange] = useState<Range>("1y");
  const [view, setView] = useState<View>("price");
  const [editing, setEditing] = useState<{ trade: Trade | null; preset?: TradePreset } | null>(null);

  const mine = useMemo(() => trades.filter((t) => t.symbol === symbol), [trades, symbol]);
  const position = useMemo(() => buildPositions(mine)[symbol], [mine, symbol]);
  const summary = useMemo(() => computePortfolio(buildPositions(trades), market.quotes), [trades, market.quotes]);
  const row = summary.rows.find((r) => r.position.symbol === symbol);
  const quote = market.quotes[symbol] ?? null;
  const history = market.histories[symbol];
  const today = todayISO();

  const priceData = useMemo<LinePoint[]>(() => {
    const pts: LinePoint[] = (history ?? []).map(([date, value]) => ({ date, value }));
    // Add today's live price when the daily closes don't include it yet.
    if (quote && (!pts.length || pts[pts.length - 1].date < today)) pts.push({ date: today, value: quote.price });
    return pts;
  }, [history, quote, today]);
  const positionData = useMemo(
    () => portfolioSeries(mine, { [symbol]: history }, market.quotes, today),
    [mine, symbol, history, market.quotes, today]
  );
  const from = rangeStart(range);
  const data = (view === "price" ? priceData : positionData).filter((p) => !from || p.date >= from);
  const markers = useMemo(() => mine.map((t) => ({ date: t.date, kind: t.type, text: tradeMarkerText(t, false) })), [mine]);

  const held = position?.shares ?? 0;
  const name = quote?.name;

  return (
    <>
      <Link to="/portfolio" className="mb-2 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft size={16} aria-hidden /> Portfolio
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-baseline gap-x-3">
            {symbol}
            {name && <span className="text-base font-normal text-muted sm:text-lg">{name}</span>}
          </span>
        }
        subtitle={
          quote ? (
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="num text-xl font-semibold text-ink">{fmt(quote.price)}</span>
              <Change value={quote.change} pctValue={quote.prevClose > 0 ? quote.change / quote.prevClose : null} className="text-sm" />
              <span className="text-sm">today · Market {quote.marketOpen ? "open" : "closed"}</span>
            </span>
          ) : key ? (
            <span className="text-sm">{market.loading ? "Loading price..." : "No live price"}</span>
          ) : (
            <span className="text-sm">Add a price key on the Portfolio page for live prices.</span>
          )
        }
        actions={
          <>
            <button className="btn-outline" onClick={() => setEditing({ trade: null, preset: { symbol, type: "sell" } })} disabled={held <= 0}>
              <Minus size={17} aria-hidden /> Sell
            </button>
            <button className="btn-primary" onClick={() => setEditing({ trade: null, preset: { symbol, type: "buy" } })}>
              <Plus size={18} aria-hidden /> Buy
            </button>
          </>
        }
      />

      {market.error && (
        <div role="status" className="mb-4 rounded-2xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">{market.error.message}</div>
      )}

      {!mine.length && (
        <p className="card mb-4 p-4 text-sm text-muted">You have no trades for {symbol} yet. Use Buy to add your first one.</p>
      )}

      {position && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Your shares" hint={held > 0 ? `Avg cost ${fmt(position.avgCost)}` : "All sold"}>
            {formatShares(held)}
          </StatCard>
          <StatCard label="Market value" hint={row ? `${pct(row.weight)} of your portfolio` : undefined}>
            {fmt(row?.value ?? 0)}
          </StatCard>
          <StatCard label="Gain / loss" hint={row?.quote ? `${signedPct(row.gainPct)} on ${fmt(position.cost)} invested` : held > 0 ? "Waiting for a price" : "Nothing held"}>
            {row?.quote ? <Change value={row.gain} /> : <span className="text-muted">-</span>}
          </StatCard>
          <StatCard label="From sales" hint={position.trades.some((t) => t.type === "sell") ? "Realized gain" : "No sales yet"}>
            <Change value={position.realized} />
          </StatCard>
        </div>
      )}

      <div className="mb-4">
        {view === "price" && !history?.length && !quote ? (
          <div className="card p-5 text-sm text-muted">
            <p className="font-semibold text-ink">Price history</p>
            <p className="mt-1">
              {!key
                ? "Add a Twelve Data key on the Portfolio page to see this stock's price history."
                : market.unknownHistory.includes(symbol)
                  ? `Twelve Data has no price history for ${symbol}.`
                  : "Loading price history..."}
            </p>
          </div>
        ) : (
          <LineChart
            data={data}
            title={view === "price" ? `${symbol} price` : `Your ${symbol} over time`}
            valueLabel={view === "price" ? "Price" : "Value"}
            costLabel={view === "position" ? "Invested" : undefined}
            markers={markers}
            actions={
              <>
                {mine.length > 0 && (
                  <Segmented label="Chart shows" value={view} onChange={setView} options={[{ value: "price", label: "Price" }, { value: "position", label: "My shares" }]} />
                )}
                <RangePicker value={range} onChange={setRange} options={view === "price" ? ["1m", "3m", "1y", "5y"] : ["1m", "3m", "1y", "all"]} />
              </>
            }
          />
        )}
      </div>

      {mine.length > 0 && (
        <section aria-labelledby="trades-h" className="card">
          <h2 id="trades-h" className="px-4 pt-4 font-semibold sm:px-5">Your {symbol} trades</h2>
          <TradeList trades={mine} showSymbol={false} onEdit={(t) => setEditing({ trade: t })} />
        </section>
      )}

      {editing && <TradeSheet trade={editing.trade} preset={editing.preset} apiKey={key} onClose={() => setEditing(null)} />}
    </>
  );
}
