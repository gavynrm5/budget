import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, ExternalLink, KeyRound, Pencil, Trash2 } from "lucide-react";
import { useData } from "../store/data";
import { useUI } from "../store/ui";
import { fmt, round2 } from "../lib/money";
import { evaluate } from "../lib/expr";
import { formatDate, toISODate, todayISO } from "../lib/periods";
import { fetchQuotes, MarketError } from "../lib/marketData";
import { findOversell, isValidSymbol, normalizeSymbol, sharesOn, signed, sortTrades } from "../lib/portfolio";
import type { Trade, TradeType } from "../lib/types";
import { Segmented, Sheet } from "./ui";

export type Range = "1m" | "3m" | "1y" | "5y" | "all";
export const RANGE_LABEL: Record<Range, string> = { "1m": "1M", "3m": "3M", "1y": "1Y", "5y": "5Y", all: "All" };

export function rangeStart(r: Range): string | null {
  if (r === "all") return null;
  const d = new Date();
  if (r === "1m") d.setMonth(d.getMonth() - 1);
  if (r === "3m") d.setMonth(d.getMonth() - 3);
  if (r === "1y") d.setFullYear(d.getFullYear() - 1);
  if (r === "5y") d.setFullYear(d.getFullYear() - 5);
  return toISODate(d);
}

export const signedFmt = (n: number) => signed(n, fmt);
export const signedPct = (n: number | null) => (n == null ? "-" : signed(n * 100, (v) => `${v.toFixed(2)}%`));

export function toneOf(n: number) {
  const r = round2(n);
  return r > 0 ? "text-good" : r < 0 ? "text-bad" : "text-muted";
}

export function formatShares(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

/** Gain or loss with an arrow and sign, so color is never the only cue. */
export function Change({ value, pctValue, className = "" }: { value: number; pctValue?: number | null; className?: string }) {
  const r = round2(value);
  const Icon = r < 0 ? ArrowDownRight : ArrowUpRight;
  return (
    <span className={`num inline-flex items-center gap-0.5 ${toneOf(value)} ${className}`}>
      {r !== 0 && <Icon size={15} aria-hidden className="shrink-0" />}
      {signedFmt(value)}
      {pctValue !== undefined && <span className="ml-1 opacity-90">({signedPct(pctValue)})</span>}
    </span>
  );
}

export function StatCard({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="card min-w-0 p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="num mt-1 text-lg font-semibold sm:text-2xl lg:text-xl xl:text-2xl">{children}</p>
      {hint && <p className="num text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function KeySetupCard({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="card mb-4 p-4 sm:p-5">
      <p className="font-semibold">Connect stock prices (free)</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>
          Create a free account at{" "}
          <a href="https://twelvedata.com/register" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
            twelvedata.com <ExternalLink size={13} aria-hidden /><span className="sr-only">(opens in a new tab)</span>
          </a>
          .
        </li>
        <li>Copy the API key from your Twelve Data dashboard (API Keys).</li>
        <li>Paste it here. It is saved with your budget data, which only you can read.</li>
      </ol>
      <button className="btn-primary mt-3" onClick={onOpen}>
        <KeyRound size={17} aria-hidden /> Add API key
      </button>
    </div>
  );
}

export function KeySheet({ current, onClose, onSave }: { current: string; onClose: () => void; onSave: (key: string) => void }) {
  const [value, setValue] = useState(current);
  const [err, setErr] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const k = value.trim();
    if (k) {
      setChecking(true);
      try {
        await fetchQuotes(["SPY"], k);
      } catch (x) {
        if (x instanceof MarketError && x.kind === "bad-key") {
          setErr("Twelve Data rejected that key. Copy it again from your Twelve Data dashboard.");
          return;
        }
        // Network trouble or rate limit: save it anyway and let the page retry.
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
          Live and past prices come from Twelve Data's free plan. Get a key at{" "}
          <a href="https://twelvedata.com/register" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
            twelvedata.com <ExternalLink size={13} aria-hidden /><span className="sr-only">(opens in a new tab)</span>
          </a>
          .
        </p>
        <div>
          <label htmlFor="k-key" className="label">Twelve Data API key</label>
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

export interface TradePreset {
  symbol?: string;
  type?: TradeType;
}

/** Add or edit one buy or sell. Checks that a sale never sells more shares than were owned. */
export function TradeSheet({ trade, preset, apiKey, onClose }: { trade: Trade | null; preset?: TradePreset; apiKey: string; onClose: () => void }) {
  const { trades, saveTrade, newId } = useData();
  const { toast } = useUI();
  const today = todayISO();
  const [f, setF] = useState({
    type: trade?.type ?? preset?.type ?? ("buy" as TradeType),
    symbol: trade?.symbol ?? preset?.symbol ?? "",
    date: trade?.date ?? today,
    shares: trade ? String(trade.shares) : "",
    price: trade ? String(trade.price) : "",
    notes: trade?.notes ?? ""
  });
  const [err, setErr] = useState<Record<string, string>>({});
  const [checking, setChecking] = useState(false);
  const set = (k: keyof typeof f, v: string) => { setF((p) => ({ ...p, [k]: v })); setErr((e) => ({ ...e, [k]: "" })); };

  const known = useMemo(() => [...new Set(trades.map((t) => t.symbol))].sort(), [trades]);
  const symbol = normalizeSymbol(f.symbol);
  const owned = symbol && f.date ? sharesOn(trades, symbol, f.date, trade?.id) : 0;
  const parse = (s: string) => { try { return evaluate(s); } catch { return NaN; } };
  const sharesN = parse(f.shares);
  const priceN = parse(f.price);
  const total = sharesN > 0 && priceN > 0 ? sharesN * priceN : 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!symbol) errs.symbol = "Enter a ticker, like VOO or AAPL.";
    else if (!isValidSymbol(symbol)) errs.symbol = "Tickers are letters and numbers, like VOO or BRK.B.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) errs.date = "Pick the date of the order.";
    else if (f.date > today) errs.date = "The date can't be in the future.";
    if (!(sharesN > 0)) errs.shares = "Enter the number of shares, like 10 or 0.5.";
    if (!(priceN >= 0) || f.price.trim() === "") errs.price = "Enter the price per share, like 412.50.";

    const next: Trade = {
      id: trade?.id ?? newId(),
      symbol,
      type: f.type,
      date: f.date,
      shares: Math.round(sharesN * 1e6) / 1e6,
      price: Math.round(priceN * 1e4) / 1e4,
      notes: f.notes.trim(),
      createdAt: trade?.createdAt
    };
    if (!Object.keys(errs).length) {
      const over = findOversell([...trades.filter((t) => t.id !== next.id), { ...next, createdAt: next.createdAt ?? Date.now() }]);
      if (over) {
        if (over.trade.id === next.id) errs.shares = `You only owned ${formatShares(over.owned)} ${over.trade.symbol} shares on ${formatDate(over.trade.date)}.`;
        else errs.shares = `This would leave your ${over.trade.symbol} sale on ${formatDate(over.trade.date)} selling more shares than you owned. Change that sale first.`;
      }
    }
    setErr(errs);
    if (Object.values(errs).some(Boolean)) return;

    // Check the ticker exists the first time it is used.
    if (apiKey && !known.includes(symbol)) {
      setChecking(true);
      try {
        const q = await fetchQuotes([symbol], apiKey);
        if (!q[symbol]) {
          setErr({ symbol: `Couldn't find ${symbol}. Check the ticker.` });
          return;
        }
      } catch {
        /* offline or rate limited: save anyway, prices load later */
      } finally {
        setChecking(false);
      }
    }

    saveTrade(next);
    toast({ message: `${f.type === "buy" ? "Buy" : "Sale"} of ${symbol} ${trade ? "updated" : "saved"}`, tone: "good" }, 2500);
    onClose();
  };

  const verb = f.type === "buy" ? "Buy" : "Sell";

  return (
    <Sheet
      title={trade ? `Edit ${trade.type === "buy" ? "buy" : "sale"}` : preset?.symbol ? `${verb} ${preset.symbol}` : "Add a trade"}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="trade-form" disabled={checking}>
            {checking ? "Checking ticker..." : trade ? "Save changes" : `Save ${f.type === "buy" ? "buy" : "sale"}`}
          </button>
        </div>
      }
    >
      <form id="trade-form" onSubmit={submit} className="grid grid-cols-2 gap-4" noValidate>
        <div className="col-span-2">
          <Segmented
            label="Buy or sell"
            value={f.type}
            onChange={(v) => set("type", v)}
            options={[{ value: "buy", label: "Bought" }, { value: "sell", label: "Sold" }]}
          />
        </div>
        <div>
          <label htmlFor="t-symbol" className="label">Ticker <span className="text-bad" aria-hidden>*</span></label>
          <input
            id="t-symbol"
            data-autofocus={!preset?.symbol && !trade ? true : undefined}
            list="t-symbol-list"
            className="input uppercase"
            placeholder="VOO"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            value={f.symbol}
            onChange={(e) => set("symbol", e.target.value)}
            aria-invalid={!!err.symbol}
          />
          <datalist id="t-symbol-list">{known.map((s) => <option key={s} value={s} />)}</datalist>
          {err.symbol && <p role="alert" className="mt-1 text-sm text-bad">{err.symbol}</p>}
        </div>
        <div>
          <label htmlFor="t-date" className="label">Date <span className="text-bad" aria-hidden>*</span></label>
          <input id="t-date" type="date" max={today} className="input" value={f.date} onChange={(e) => set("date", e.target.value)} aria-invalid={!!err.date}
            data-autofocus={preset?.symbol && !trade ? true : undefined} />
          {err.date && <p role="alert" className="mt-1 text-sm text-bad">{err.date}</p>}
        </div>
        <div>
          <label htmlFor="t-shares" className="label">Shares <span className="text-bad" aria-hidden>*</span></label>
          <input id="t-shares" inputMode="decimal" className="input num" placeholder="1.5" value={f.shares} onChange={(e) => set("shares", e.target.value)} aria-invalid={!!err.shares} aria-describedby="t-shares-help" />
          <p id="t-shares-help" className="mt-1 text-xs text-muted">
            {f.type === "sell" && symbol ? (
              <>
                You owned {formatShares(owned)} on this date.{" "}
                {owned > 0 && <button type="button" className="font-medium text-primary hover:underline" onClick={() => set("shares", String(owned))}>Sell all</button>}
              </>
            ) : (
              "Fractional shares are fine"
            )}
          </p>
          {err.shares && <p role="alert" className="mt-1 text-sm text-bad">{err.shares}</p>}
        </div>
        <div>
          <label htmlFor="t-price" className="label">Price per share <span className="text-bad" aria-hidden>*</span></label>
          <input id="t-price" inputMode="decimal" className="input num" placeholder="0.00" value={f.price} onChange={(e) => set("price", e.target.value)} aria-invalid={!!err.price} />
          {err.price && <p role="alert" className="mt-1 text-sm text-bad">{err.price}</p>}
        </div>
        <p className="col-span-2 -mt-1 text-sm text-muted" aria-live="polite">
          {total > 0 ? <>Total {f.type === "buy" ? "paid" : "received"}: <span className="num font-medium text-ink">{fmt(total)}</span></> : " "}
        </p>
        <div className="col-span-2">
          <label htmlFor="t-notes" className="label">Notes</label>
          <textarea id="t-notes" rows={2} className="input" placeholder="e.g. Roth IRA" value={f.notes} onChange={(e) => set("notes", e.target.value)} />
        </div>
        <p className="col-span-2 rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">
          In Robinhood: <strong>Account</strong> &gt; <strong>History</strong>, then tap an order. Use its date, shares, and the average price per share it was filled at.
        </p>
      </form>
    </Sheet>
  );
}

/** Trades, newest first, with edit and delete. */
export function TradeList({ trades, showSymbol, onEdit }: { trades: Trade[]; showSymbol: boolean; onEdit: (t: Trade) => void }) {
  const { trades: all, saveTrade, deleteTrade } = useData();
  const { deleteWithUndo, toast } = useUI();
  const rows = useMemo(() => sortTrades(trades).reverse(), [trades]);

  const remove = (t: Trade) => {
    const over = findOversell(all.filter((x) => x.id !== t.id));
    if (over) {
      toast({ message: "Can't delete this buy yet", detail: `Your ${over.trade.symbol} sale on ${formatDate(over.trade.date)} needs these shares. Edit or delete that sale first.`, tone: "bad" }, 6000);
      return;
    }
    const what = `${t.type === "buy" ? "buy" : "sale"} of ${formatShares(t.shares)} ${t.symbol}`;
    void deleteWithUndo({ what, message: `Delete the ${what} on ${formatDate(t.date)}?`, remove: () => deleteTrade(t.id), restore: () => saveTrade(t) });
  };

  if (!rows.length) return <p className="p-5 text-center text-sm text-muted">No trades yet.</p>;
  return (
    <ul className="divide-y divide-line/60">
      {rows.map((t) => (
        <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
          <span
            className={`inline-flex w-14 shrink-0 justify-center rounded-full py-0.5 text-xs font-semibold ${t.type === "buy" ? "bg-good/10 text-good" : "bg-bad/10 text-bad"}`}
          >
            {t.type === "buy" ? "Buy" : "Sell"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="num text-sm font-medium">
              {showSymbol && <span className="mr-1.5 font-semibold">{t.symbol}</span>}
              {formatShares(t.shares)} sh at {fmt(t.price)}
            </p>
            <p className="truncate text-xs text-muted" title={t.notes || undefined}>
              {formatDate(t.date)}
              {t.notes && ` · ${t.notes}`}
            </p>
          </div>
          <span className="num hidden text-sm sm:inline">{fmt(t.shares * t.price)}</span>
          <div className="flex shrink-0">
            <button className="icon-btn" onClick={() => onEdit(t)} aria-label={`Edit ${t.type} of ${t.symbol} on ${formatDate(t.date)}`}><Pencil size={17} /></button>
            <button className="icon-btn hover:text-bad" onClick={() => remove(t)} aria-label={`Delete ${t.type} of ${t.symbol} on ${formatDate(t.date)}`}><Trash2 size={17} /></button>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function tradeMarkerText(t: Trade, withSymbol: boolean) {
  return `${t.type === "buy" ? "Bought" : "Sold"} ${formatShares(t.shares)}${withSymbol ? ` ${t.symbol}` : ""} at ${fmt(t.price)}`;
}

export function RangePicker({ value, onChange, options }: { value: Range; onChange: (r: Range) => void; options: Range[] }) {
  return <Segmented label="Chart range" value={value} options={options.map((r) => ({ value: r, label: RANGE_LABEL[r] }))} onChange={onChange} />;
}
