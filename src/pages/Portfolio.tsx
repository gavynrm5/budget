import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowDownRight, ArrowUpRight, ExternalLink, KeyRound, LineChart as LineChartIcon, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useData } from "../store/data";
import { useUI } from "../store/ui";
import { fmt, pct, round2 } from "../lib/money";
import { evaluate } from "../lib/expr";
import { toISODate, todayISO } from "../lib/periods";
import {
  computePortfolio,
  fetchQuote,
  historySince,
  isValidSymbol,
  normalizeSymbol,
  QuoteError,
  readQuoteCache,
  signed,
  writeQuoteCache,
  type CachedQuotes,
  type HoldingRow,
  type Quote
} from "../lib/portfolio";
import type { Holding } from "../lib/types";
import { LineChart } from "../components/LineChart";
import { EmptyState, PageHeader, Segmented, Sheet } from "../components/ui";

type Range = "1m" | "3m" | "1y" | "all";
const RANGES: { value: Range; label: string }[] = [
  { value: "1m", label: "1M" },
  { value: "3m", label: "3M" },
  { value: "1y", label: "1Y" },
  { value: "all", label: "All" }
];
const STALE_MS = 60_000;

function rangeStart(r: Range): string | null {
  if (r === "all") return null;
  const d = new Date();
  if (r === "1m") d.setMonth(d.getMonth() - 1);
  if (r === "3m") d.setMonth(d.getMonth() - 3);
  if (r === "1y") d.setFullYear(d.getFullYear() - 1);
  return toISODate(d);
}

const signedFmt = (n: number) => signed(n, fmt);
const signedPct = (n: number | null) => (n == null ? "-" : signed(n * 100, (v) => `${v.toFixed(2)}%`));

/** Gain or loss with an arrow and sign, so color is never the only cue. */
function Change({ value, pctValue, className = "" }: { value: number; pctValue?: number | null; className?: string }) {
  const r = round2(value);
  const tone = r > 0 ? "text-good" : r < 0 ? "text-bad" : "text-muted";
  const Icon = r < 0 ? ArrowDownRight : ArrowUpRight;
  return (
    <span className={`num inline-flex items-center gap-0.5 ${tone} ${className}`}>
      {r !== 0 && <Icon size={15} aria-hidden className="shrink-0" />}
      {signedFmt(value)}
      {pctValue !== undefined && <span className="ml-1 opacity-90">({signedPct(pctValue)})</span>}
    </span>
  );
}

export default function Portfolio() {
  const { holdings, portfolioHistory, settings, updateSettings, saveHolding, deleteHolding, saveSnapshot, online } = useData();
  const { toast, deleteWithUndo } = useUI();
  const key = settings.finnhubKey;
  const [cache, setCache] = useState<CachedQuotes | null>(() => readQuoteCache());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True once prices were fetched in this visit, so snapshots are never saved from old cached prices.
  const [fresh, setFresh] = useState(false);
  const [range, setRange] = useState<Range>("3m");
  const [editing, setEditing] = useState<Holding | "new" | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const inFlight = useRef(false);

  const symbols = useMemo(() => [...new Set(holdings.map((h) => h.symbol))].sort(), [holdings]);
  const quotes = cache?.quotes ?? {};

  const refresh = useCallback(
    async (only?: string[]) => {
      if (!key || inFlight.current) return;
      const list = only ?? symbols;
      if (!list.length) return;
      inFlight.current = true;
      setLoading(true);
      setError(null);
      try {
        const results = await Promise.all(list.map(async (s) => [s, await fetchQuote(s, key)] as const));
        setCache((prev) => {
          const next: CachedQuotes = { fetchedAt: Date.now(), quotes: { ...(only ? prev?.quotes : {}), ...Object.fromEntries(results) } };
          writeQuoteCache(next);
          return next;
        });
        setFresh(true);
      } catch (e) {
        const msg = e instanceof QuoteError ? e.message : "Could not load prices.";
        setError(msg);
        if (e instanceof QuoteError && e.kind === "bad-key") setKeyOpen(true);
      } finally {
        inFlight.current = false;
        setLoading(false);
      }
    },
    [key, symbols]
  );

  // Load prices when the page opens, and fetch any newly added symbol.
  useEffect(() => {
    if (!key || !online || !symbols.length) return;
    const unknown = symbols.filter((s) => !(s in quotes));
    const stale = !cache || Date.now() - cache.fetchedAt > STALE_MS;
    if (stale || !fresh) void refresh();
    else if (unknown.length) void refresh(unknown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, online, symbols.join(",")]);

  const summary = useMemo(() => computePortfolio(holdings, quotes), [holdings, quotes]);

  // Record today's totals for the history chart once live prices are in.
  useEffect(() => {
    if (!fresh || !holdings.length || summary.missing.length) return;
    const id = todayISO();
    const existing = portfolioHistory.find((s) => s.id === id);
    if (existing && existing.value === summary.value && existing.cost === summary.cost) return;
    saveSnapshot({ id, value: summary.value, cost: summary.cost });
  }, [fresh, holdings.length, summary.value, summary.cost, summary.missing.length, portfolioHistory, saveSnapshot]);

  const chartData = useMemo(
    () => historySince(portfolioHistory, rangeStart(range)).map((s) => ({ date: s.id, value: s.value, cost: s.cost })),
    [portfolioHistory, range]
  );

  const lastTrade = Math.max(0, ...Object.values(quotes).map((q) => q?.time ?? 0));
  const asOf = lastTrade
    ? new Date(lastTrade * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : null;

  const remove = (h: Holding) =>
    deleteWithUndo({ what: h.symbol, message: `Remove ${h.symbol} from your portfolio?`, remove: () => deleteHolding(h.id), restore: () => saveHolding(h) });

  const needsKey = !key;

  return (
    <>
      <PageHeader
        title="Portfolio"
        subtitle={
          <span className="text-sm">
            {asOf ? `Prices as of ${asOf}` : "Stocks and ETFs"}
            {cache && !loading && !online && " (offline, last saved prices)"}
          </span>
        }
        actions={
          <>
            <button className="icon-btn" onClick={() => setKeyOpen(true)} aria-label="Price data settings" title="Price data settings">
              <KeyRound size={19} />
            </button>
            {!needsKey && holdings.length > 0 && (
              <button className="btn-outline" onClick={() => refresh()} disabled={loading || !online} aria-label="Refresh prices">
                <RefreshCw size={17} aria-hidden className={loading ? "motion-safe:animate-spin" : ""} />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            )}
            <button className="btn-primary" onClick={() => setEditing("new")}>
              <Plus size={18} aria-hidden /> Add stock
            </button>
          </>
        }
      />

      {needsKey && <KeySetupCard onOpen={() => setKeyOpen(true)} />}

      {error && (
        <div role="alert" className="mb-4 rounded-2xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">
          {error}
        </div>
      )}

      {summary.missing.length > 0 && !needsKey && !loading && fresh && (
        <div role="status" className="mb-4 rounded-2xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
          No price found for {summary.missing.join(", ")}. Check the ticker. Until then it counts at the price you paid.
        </div>
      )}

      {holdings.length === 0 ? (
        <div className="card">
          <EmptyState icon={<LineChartIcon size={22} />} title="No stocks yet.">
            Add each stock or ETF you own with how many shares you have and the average price you paid.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="card p-4">
              <p className="text-sm text-muted">Market value</p>
              <p className="num mt-1 text-lg font-semibold sm:text-2xl lg:text-xl xl:text-2xl">{fmt(summary.value)}</p>
            </div>
            <div className="card p-4">
              <p className="text-sm text-muted">Total gain / loss</p>
              <p className="mt-1 text-lg font-semibold sm:text-2xl lg:text-xl xl:text-2xl"><Change value={summary.gain} /></p>
              <p className="num text-xs text-muted">{signedPct(summary.gainPct)} all time</p>
            </div>
            <div className="card p-4">
              <p className="text-sm text-muted">Today</p>
              <p className="mt-1 text-lg font-semibold sm:text-2xl lg:text-xl xl:text-2xl"><Change value={summary.dayChange} /></p>
              <p className="num text-xs text-muted">{signedPct(summary.dayChangePct)} since last close</p>
            </div>
            <div className="card p-4">
              <p className="text-sm text-muted">Amount paid</p>
              <p className="num mt-1 text-lg font-semibold sm:text-2xl lg:text-xl xl:text-2xl">{fmt(summary.cost)}</p>
              <p className="text-xs text-muted">{holdings.length} {holdings.length === 1 ? "holding" : "holdings"}</p>
            </div>
          </div>

          <div className="mb-4">
            {portfolioHistory.length === 0 ? (
              <div className="card p-5 text-sm text-muted">
                <p className="font-semibold text-ink">Value over time</p>
                <p className="mt-1">The chart starts today. Each day you open this page, it saves that day's total, and the line fills in from there.</p>
              </div>
            ) : (
              <>
                <LineChart
                  data={chartData}
                  title="Value over time"
                  actions={<Segmented label="Chart range" value={range} options={RANGES} onChange={setRange} />}
                />
                {portfolioHistory.length < 3 && (
                  <p className="mt-2 text-xs text-muted">The chart fills in as you open this page on more days.</p>
                )}
              </>
            )}
          </div>

          <HoldingsTable rows={summary.rows} onEdit={setEditing} onRemove={remove} />
          <Allocation rows={summary.rows} />
          <p className="mt-4 text-xs text-muted">
            Prices from Finnhub. They can be delayed and are for tracking only.
          </p>
        </>
      )}

      {editing && (
        <HoldingSheet
          holding={editing === "new" ? null : editing}
          apiKey={key}
          onClose={() => setEditing(null)}
          onSaved={(symbol, quote) => {
            if (quote !== undefined) {
              setCache((prev) => {
                const next: CachedQuotes = { fetchedAt: prev?.fetchedAt ?? Date.now(), quotes: { ...prev?.quotes, [symbol]: quote } };
                writeQuoteCache(next);
                return next;
              });
            }
          }}
        />
      )}
      {keyOpen && (
        <KeySheet
          current={key}
          onClose={() => setKeyOpen(false)}
          onSave={(k) => {
            updateSettings({ finnhubKey: k });
            setError(null);
            toast({ message: k ? "Price key saved" : "Price key removed", tone: "good" }, 2500);
          }}
        />
      )}
    </>
  );
}

function KeySetupCard({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="card mb-4 p-4 sm:p-5">
      <p className="font-semibold">Connect live prices (free)</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>
          Create a free account at{" "}
          <a href="https://finnhub.io/register" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
            finnhub.io <ExternalLink size={13} aria-hidden /><span className="sr-only">(opens in a new tab)</span>
          </a>
          .
        </li>
        <li>Copy the API key shown on your Finnhub dashboard.</li>
        <li>Paste it here. It is saved with your budget data, which only you can read.</li>
      </ol>
      <button className="btn-primary mt-3" onClick={onOpen}>
        <KeyRound size={17} aria-hidden /> Add API key
      </button>
    </div>
  );
}

function HoldingsTable({ rows, onEdit, onRemove }: { rows: HoldingRow[]; onEdit: (h: Holding) => void; onRemove: (h: Holding) => void }) {
  return (
    <>
      <div className="card mb-4 hidden overflow-x-auto md:block">
        <table className="w-full">
          <caption className="sr-only">Holdings</caption>
          <thead className="border-b border-line">
            <tr>
              <th className="th pl-5">Symbol</th>
              <th className="th text-right">Shares</th>
              <th className="th text-right">Avg paid</th>
              <th className="th text-right">Price</th>
              <th className="th hidden text-right lg:table-cell">Today</th>
              <th className="th text-right">Value</th>
              <th className="th text-right">Gain / loss</th>
              <th className="th hidden text-right xl:table-cell">Weight</th>
              <th className="th pr-5"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.holding.id} className="border-b border-line/60 last:border-0">
                <th scope="row" className="td pl-5 text-left font-semibold" title={r.holding.notes || undefined}>{r.holding.symbol}</th>
                <td className="td num text-right">{formatShares(r.holding.shares)}</td>
                <td className="td num text-right">{fmt(r.holding.avgCost)}</td>
                <td className="td num text-right">{r.quote ? fmt(r.quote.price) : <span className="text-muted">-</span>}</td>
                <td className="td hidden text-right text-sm lg:table-cell">{r.quote ? <span className={toneOf(r.dayChange)}>{signedPct(r.dayChangePct)}</span> : <span className="text-muted">-</span>}</td>
                <td className="td num text-right font-medium">{fmt(r.value)}</td>
                <td className="td text-right">
                  {r.quote ? <Change value={r.gain} pctValue={r.gainPct} className="text-sm" /> : <span className="text-muted">-</span>}
                </td>
                <td className="td num hidden text-right text-sm text-muted xl:table-cell">{pct(r.weight)}</td>
                <td className="td pr-5 text-right">
                  <button className="icon-btn" onClick={() => onEdit(r.holding)} aria-label={`Edit ${r.holding.symbol}`}><Pencil size={17} /></button>
                  <button className="icon-btn hover:text-bad" onClick={() => onRemove(r.holding)} aria-label={`Delete ${r.holding.symbol}`}><Trash2 size={17} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="mb-4 grid gap-3 md:hidden">
        {rows.map((r) => (
          <li key={r.holding.id} className="card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold">{r.holding.symbol}</p>
                <p className="num text-sm text-muted">
                  {formatShares(r.holding.shares)} sh at {fmt(r.holding.avgCost)}
                </p>
              </div>
              <div className="text-right">
                <p className="num font-semibold">{fmt(r.value)}</p>
                {r.quote && <p className="num text-sm text-muted">{fmt(r.quote.price)} <span className={toneOf(r.dayChange)}>{signedPct(r.dayChangePct)}</span></p>}
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between">
              {r.quote ? <Change value={r.gain} pctValue={r.gainPct} className="text-sm" /> : <span className="text-sm text-muted">No price yet</span>}
              <div>
                <button className="icon-btn" onClick={() => onEdit(r.holding)} aria-label={`Edit ${r.holding.symbol}`}><Pencil size={17} /></button>
                <button className="icon-btn hover:text-bad" onClick={() => onRemove(r.holding)} aria-label={`Delete ${r.holding.symbol}`}><Trash2 size={17} /></button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function Allocation({ rows }: { rows: HoldingRow[] }) {
  if (rows.length < 2) return null;
  return (
    <section aria-labelledby="alloc-h" className="card p-4 sm:p-5">
      <h2 id="alloc-h" className="mb-3 font-semibold">Allocation</h2>
      <ul className="grid gap-2.5">
        {rows.map((r) => (
          <li key={r.holding.id} className="grid grid-cols-[4.5rem_1fr_3.5rem] items-center gap-3 text-sm">
            <span className="font-medium">{r.holding.symbol}</span>
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

function HoldingSheet({
  holding,
  apiKey,
  onClose,
  onSaved
}: {
  holding: Holding | null;
  apiKey: string;
  onClose: () => void;
  onSaved: (symbol: string, quote?: Quote | null) => void;
}) {
  const { holdings, saveHolding, newId } = useData();
  const { toast } = useUI();
  const [f, setF] = useState({
    symbol: holding?.symbol ?? "",
    shares: holding ? String(holding.shares) : "",
    avgCost: holding ? holding.avgCost.toFixed(2) : "",
    notes: holding?.notes ?? ""
  });
  const [err, setErr] = useState<Record<string, string>>({});
  const [checking, setChecking] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const symbol = normalizeSymbol(f.symbol);
    if (!symbol) errs.symbol = "Enter a ticker, like VOO or AAPL.";
    else if (!isValidSymbol(symbol)) errs.symbol = "Tickers are letters and numbers, like VOO or BRK.B.";
    else if (holdings.some((h) => h.symbol === symbol && h.id !== holding?.id)) errs.symbol = `You already have ${symbol}. Edit that one instead.`;
    let shares = 0;
    try {
      shares = evaluate(f.shares);
      if (!(shares > 0)) errs.shares = "Shares must be more than 0.";
    } catch {
      errs.shares = "Enter a number of shares, like 10 or 2.5.";
    }
    let avgCost = 0;
    try {
      avgCost = round2(evaluate(f.avgCost));
      if (avgCost < 0) errs.avgCost = "Price cannot be negative.";
    } catch {
      errs.avgCost = "Enter the price per share, like 412.50.";
    }
    setErr(errs);
    if (Object.keys(errs).length) return;

    // Check the ticker exists before saving a new or renamed one.
    let quote: Quote | null | undefined;
    if (apiKey && symbol !== holding?.symbol) {
      setChecking(true);
      try {
        quote = await fetchQuote(symbol, apiKey);
        if (quote === null) {
          setErr({ symbol: `Couldn't find ${symbol}. Check the ticker.` });
          return;
        }
      } catch {
        quote = undefined; // offline or rate limited: save anyway, prices load later
      } finally {
        setChecking(false);
      }
    }

    saveHolding({
      id: holding?.id ?? newId(),
      symbol,
      shares: Math.round(shares * 1e6) / 1e6,
      avgCost,
      notes: f.notes.trim(),
      createdAt: holding?.createdAt
    });
    onSaved(symbol, quote);
    toast({ message: holding ? `${symbol} updated` : `${symbol} added`, tone: "good" }, 2500);
    onClose();
  };

  const shares = (() => { try { return evaluate(f.shares); } catch { return 0; } })();
  const cost = (() => { try { return evaluate(f.avgCost); } catch { return 0; } })();
  const total = shares > 0 && cost > 0 ? shares * cost : 0;

  return (
    <Sheet
      title={holding ? `Edit ${holding.symbol}` : "Add stock or ETF"}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="holding-form" disabled={checking}>
            {checking ? "Checking ticker..." : holding ? "Save changes" : "Add"}
          </button>
        </div>
      }
    >
      <form id="holding-form" onSubmit={submit} className="grid grid-cols-2 gap-4" noValidate>
        <div className="col-span-2">
          <label htmlFor="h-symbol" className="label">Ticker <span className="text-bad" aria-hidden>*</span></label>
          <input
            id="h-symbol"
            data-autofocus
            className="input uppercase"
            placeholder="VOO"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            value={f.symbol}
            onChange={(e) => set("symbol", e.target.value)}
            aria-invalid={!!err.symbol}
          />
          {err.symbol && <p role="alert" className="mt-1 text-sm text-bad">{err.symbol}</p>}
        </div>
        <div>
          <label htmlFor="h-shares" className="label">Shares <span className="text-bad" aria-hidden>*</span></label>
          <input id="h-shares" inputMode="decimal" className="input num" placeholder="10" value={f.shares} onChange={(e) => set("shares", e.target.value)} aria-invalid={!!err.shares} />
          {err.shares && <p role="alert" className="mt-1 text-sm text-bad">{err.shares}</p>}
        </div>
        <div>
          <label htmlFor="h-cost" className="label">Avg price paid <span className="text-bad" aria-hidden>*</span></label>
          <input id="h-cost" inputMode="decimal" className="input num" placeholder="0.00" value={f.avgCost} onChange={(e) => set("avgCost", e.target.value)} aria-invalid={!!err.avgCost} aria-describedby="h-cost-help" />
          <p id="h-cost-help" className="mt-1 text-xs text-muted">Per share</p>
          {err.avgCost && <p role="alert" className="mt-1 text-sm text-bad">{err.avgCost}</p>}
        </div>
        <p className="col-span-2 -mt-1 text-sm text-muted" aria-live="polite">
          {total > 0 ? <>Total paid: <span className="num font-medium text-ink">{fmt(total)}</span></> : " "}
        </p>
        <div className="col-span-2">
          <label htmlFor="h-notes" className="label">Notes</label>
          <textarea id="h-notes" rows={2} className="input" placeholder="e.g. Roth IRA" value={f.notes} onChange={(e) => set("notes", e.target.value)} />
        </div>
      </form>
    </Sheet>
  );
}

function KeySheet({ current, onClose, onSave }: { current: string; onClose: () => void; onSave: (key: string) => void }) {
  const [value, setValue] = useState(current);
  const [err, setErr] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const k = value.trim();
    if (k) {
      setChecking(true);
      try {
        await fetchQuote("SPY", k);
      } catch (x) {
        if (x instanceof QuoteError && x.kind === "bad-key") {
          setErr("Finnhub rejected that key. Copy it again from your Finnhub dashboard.");
          return;
        }
        // Network trouble: save it anyway and let the page retry.
      } finally {
        setChecking(false);
      }
    }
    onSave(k);
    onClose();
  };

  return (
    <Sheet
      title="Price data"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="key-form" disabled={checking}>{checking ? "Checking..." : "Save"}</button>
        </div>
      }
    >
      <form id="key-form" onSubmit={submit} className="grid gap-3" noValidate>
        <p className="text-sm text-muted">
          Live prices come from Finnhub's free plan. Get a key at{" "}
          <a href="https://finnhub.io/register" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
            finnhub.io <ExternalLink size={13} aria-hidden /><span className="sr-only">(opens in a new tab)</span>
          </a>
          .
        </p>
        <div>
          <label htmlFor="k-key" className="label">Finnhub API key</label>
          <input
            id="k-key"
            data-autofocus
            className="input font-mono text-sm"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={value}
            onChange={(e) => { setValue(e.target.value); setErr(null); }}
            aria-invalid={!!err}
          />
          {err && <p role="alert" className="mt-1 text-sm text-bad">{err}</p>}
          <p className="mt-1 text-xs text-muted">Leave blank and save to remove it.</p>
        </div>
      </form>
    </Sheet>
  );
}

function formatShares(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function toneOf(n: number) {
  const r = round2(n);
  return r > 0 ? "text-good" : r < 0 ? "text-bad" : "text-muted";
}
