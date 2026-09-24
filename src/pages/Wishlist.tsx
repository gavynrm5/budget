import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowDown, ArrowLeft, ArrowUp, Check, ExternalLink, FolderPlus, ImageOff, PiggyBank, Plus, Settings2, Sofa } from "lucide-react";
import { useData } from "../store/data";
import { useUI } from "../store/ui";
import { fmt, pct } from "../lib/money";
import { currentPeriodId, formatDate } from "../lib/periods";
import { asUrl, itemTotal, listSummary, safeImage, type ListSummary } from "../lib/wishlist";
import type { WishItem, WishList } from "../lib/types";
import { EmptyState, PageHeader } from "../components/ui";
import { ItemSheet, ListSheet } from "../components/WishlistSheets";

export default function Wishlist() {
  const { listId } = useParams();
  return listId ? <ListPage listId={listId} /> : <Lists />;
}

function Progress({ value, label }: { value: number; label: string }) {
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label={label} aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${value * 100}%` }} />
    </div>
  );
}

function paceText(s: ListSummary, target: string | null) {
  if (!target) return null;
  if (s.left <= 0) return `Goal reached, target ${formatDate(target)}`;
  if (!s.periodsLeft) return `Target ${formatDate(target)} has passed, ${fmt(s.left)} to go`;
  return `${fmt(s.perPeriod ?? 0)} per pay period to reach it by ${formatDate(target)}`;
}

/** All lists with their goal progress. */
function Lists() {
  const { wishLists, wishlist, transactions } = useData();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const period = currentPeriodId();

  return (
    <>
      <PageHeader
        title="Wishlist"
        subtitle="Lists and savings goals"
        actions={<button className="btn-primary" onClick={() => setCreating(true)}><FolderPlus size={18} aria-hidden /> New list</button>}
      />
      {wishLists.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Sofa size={22} />} title="No lists yet.">
            Make a list for each goal, like Furniture or a trip, and add items with photos and links.
          </EmptyState>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {wishLists.map((l) => {
            const s = listSummary(l, wishlist, transactions, period);
            const thumbs = wishlist.filter((w) => w.listId === l.id && safeImage(w.image)).sort((a, b) => a.order - b.order).slice(0, 4);
            const pace = paceText(s, l.targetDate);
            return (
              <li key={l.id}>
                <Link to={`/wishlist/${l.id}`} className="card block h-full p-4 transition-colors hover:bg-surface-2/40">
                  {thumbs.length > 0 && (
                    <div className="mb-3 grid h-24 grid-cols-4 gap-1 overflow-hidden rounded-xl">
                      {thumbs.map((w) => <img key={w.id} src={safeImage(w.image)!} alt="" loading="lazy" className="h-24 w-full object-cover" />)}
                    </div>
                  )}
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 className="truncate text-lg">{l.name}</h2>
                    <span className="shrink-0 text-sm text-muted">{s.count} {s.count === 1 ? "item" : "items"}</span>
                  </div>
                  <p className="num mt-1 text-sm">
                    <strong>{fmt(s.saved)}</strong> <span className="text-muted">saved of {fmt(s.goal)}</span>
                  </p>
                  <div className="mt-2"><Progress value={s.progress} label={`${l.name} saved toward goal`} /></div>
                  {pace && <p className="mt-2 text-xs text-muted">{pace}</p>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {creating && <ListSheet list={null} onClose={() => setCreating(false)} onCreated={(id) => navigate(`/wishlist/${id}`)} />}
    </>
  );
}

type Show = "all" | "open" | "bought";

/** One list: goal, filters by its own dropdowns, and its items in priority order. */
function ListPage({ listId }: { listId: string }) {
  const { wishLists, wishlist, transactions, settings, saveWish } = useData();
  const { openTxSheet } = useUI();
  const list = wishLists.find((l) => l.id === listId);
  const [editingList, setEditingList] = useState(false);
  const [itemSheet, setItemSheet] = useState<WishItem | "new" | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [show, setShow] = useState<Show>("all");

  const items = useMemo(() => wishlist.filter((w) => w.listId === listId).sort((a, b) => a.order - b.order), [wishlist, listId]);
  if (!list) {
    return (
      <>
        <BackLink />
        <p className="card p-6 text-center text-muted">This list doesn't exist anymore.</p>
      </>
    );
  }
  const s = listSummary(list, wishlist, transactions, currentPeriodId());
  const pace = paceText(s, list.targetDate);
  const fund = list.subId ? settings.subCategories.find((x) => x.id === list.subId) : undefined;
  const rows = items.filter(
    (w) =>
      (show === "all" || (show === "bought" ? w.bought : !w.bought)) &&
      Object.entries(filters).every(([fid, v]) => !v || (w.values?.[fid] ?? "") === v)
  );
  const filtered = rows.length !== items.length;

  // Swap with the neighbor in the visible order, so moving works with filters on too.
  const move = (w: WishItem, dir: -1 | 1) => {
    const i = rows.findIndex((x) => x.id === w.id);
    const other = rows[i + dir];
    if (!other) return;
    saveWish({ ...w, order: other.order });
    saveWish({ ...other, order: w.order });
  };

  return (
    <>
      <BackLink />
      <PageHeader
        title={list.name}
        subtitle={`${s.count} ${s.count === 1 ? "item" : "items"}${s.boughtCount ? `, ${s.boughtCount} bought (${fmt(s.boughtTotal)})` : ""}`}
        actions={
          <>
            <button className="btn-outline" onClick={() => setEditingList(true)}><Settings2 size={17} aria-hidden /> <span className="hidden sm:inline">Edit list</span><span className="sm:hidden">Edit</span></button>
            <button className="btn-primary" onClick={() => setItemSheet("new")}><Plus size={18} aria-hidden /> Add item</button>
          </>
        }
      />

      <section aria-label="Goal" className="card mb-4 p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div><p className="text-sm text-muted">Goal</p><p className="num text-xl font-semibold">{fmt(s.goal)}</p><p className="text-xs text-muted">{list.goalAmount != null ? "Set by you" : "Total of items"}</p></div>
          <div><p className="text-sm text-muted">Saved</p><p className="num text-xl font-semibold">{fmt(s.saved)}</p><p className="text-xs text-muted">{pct(s.progress, 0)} of goal</p></div>
          <div><p className="text-sm text-muted">Left to save</p><p className="num text-xl font-semibold">{fmt(s.left)}</p></div>
          <div>
            <p className="text-sm text-muted">Per pay period</p>
            <p className="num text-xl font-semibold">{s.perPeriod != null ? fmt(s.perPeriod) : "-"}</p>
            <p className="text-xs text-muted">{list.targetDate ? `By ${formatDate(list.targetDate)}` : "Set a target date"}</p>
          </div>
        </div>
        <div className="mt-4"><Progress value={s.progress} label={`${list.name} saved toward goal`} /></div>
        {pace && <p className="mt-2 text-sm text-muted">{pace}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-3 text-sm">
          {fund ? (
            <>
              <span className="text-muted">
                {fmt(list.startingSaved)} to start + {fmt(s.contributions)} logged to <strong className="text-ink">{fund.name}</strong>
              </span>
              <button className="btn-ghost min-h-[40px] px-3 text-sm text-primary" onClick={() => openTxSheet({ preset: { category: fund.category, subId: fund.id } })}>
                <PiggyBank size={16} aria-hidden /> Add contribution
              </button>
            </>
          ) : (
            <span className="text-muted">Not tracked in your budget. Turn it on in Edit list to count contributions.</span>
          )}
        </div>
      </section>

      {items.length > 0 && (
        <div className="mb-4 flex flex-wrap items-end gap-2 sm:gap-3">
          <div className="min-w-[130px] flex-1 sm:flex-none">
            <label htmlFor="show" className="label">Show</label>
            <select id="show" className="input" value={show} onChange={(e) => setShow(e.target.value as Show)}>
              <option value="all">All items</option>
              <option value="open">Still to buy</option>
              <option value="bought">Bought</option>
            </select>
          </div>
          {list.fields.filter((f) => f.options.length).map((f) => (
            <div key={f.id} className="min-w-[130px] flex-1 sm:flex-none">
              <label htmlFor={`flt-${f.id}`} className="label">{f.name}</label>
              <select id={`flt-${f.id}`} className="input" value={filters[f.id] ?? ""} onChange={(e) => setFilters((x) => ({ ...x, [f.id]: e.target.value }))}>
                <option value="">All</option>
                {f.options.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
          ))}
          {filtered && <p className="num ml-auto self-center text-sm text-muted">{rows.length} shown, {fmt(rows.reduce((a, w) => a + itemTotal(w), 0))}</p>}
        </div>
      )}

      {items.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Sofa size={22} />} title={`${list.name} is empty.`}>Add the first item with a photo and a link.</EmptyState>
        </div>
      ) : rows.length === 0 ? (
        <p className="card p-6 text-center text-muted">Nothing matches these filters.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((w, i) => (
            <ItemCard key={w.id} item={w} list={list} first={i === 0} last={i === rows.length - 1} onEdit={() => setItemSheet(w)} onMove={(d) => move(w, d)} />
          ))}
        </ul>
      )}

      {editingList && <ListSheet list={list} onClose={() => setEditingList(false)} />}
      {itemSheet && <ItemSheet list={list} item={itemSheet === "new" ? null : itemSheet} onClose={() => setItemSheet(null)} />}
    </>
  );
}

function BackLink() {
  return (
    <Link to="/wishlist" className="mb-2 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
      <ArrowLeft size={16} aria-hidden /> All lists
    </Link>
  );
}

function ItemCard({ item, list, first, last, onEdit, onMove }: { item: WishItem; list: WishList; first: boolean; last: boolean; onEdit: () => void; onMove: (d: -1 | 1) => void }) {
  const { saveWish } = useData();
  const [broken, setBroken] = useState(false);
  const img = safeImage(item.image);
  const url = asUrl(item.link);
  const chips = list.fields.map((f) => item.values?.[f.id]).filter(Boolean) as string[];
  let host = "";
  if (url) {
    try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* keep blank */ }
  }

  return (
    <li className={`card flex flex-col overflow-hidden ${item.bought ? "opacity-75" : ""}`}>
      <button className="relative block aspect-[4/3] w-full bg-surface-2 text-left" onClick={onEdit} aria-label={`Edit ${item.item}`}>
        {img && !broken ? (
          <img src={img} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => setBroken(true)} />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-muted">{broken ? <ImageOff size={28} aria-hidden /> : <Sofa size={28} aria-hidden />}</span>
        )}
        {item.bought && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-good px-2 py-0.5 text-xs font-semibold text-white dark:text-bg">
            <Check size={13} aria-hidden /> Bought
          </span>
        )}
      </button>
      <div className="flex flex-1 flex-col p-3.5">
        <div className="flex items-start justify-between gap-2">
          <button className="min-w-0 text-left font-semibold hover:text-primary" onClick={onEdit}>{item.item}</button>
          <span className="num shrink-0 font-semibold">{fmt(itemTotal(item))}</span>
        </div>
        {(item.qty ?? 1) !== 1 && <p className="num text-xs text-muted">{fmt(item.price)} x {item.qty}</p>}
        {chips.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {chips.map((c, k) => <span key={k} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">{c}</span>)}
          </div>
        )}
        {item.notes && <p className="mt-1.5 line-clamp-2 text-sm text-muted">{item.notes}</p>}
        <div className="mt-auto flex items-center gap-1 pt-2">
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer" className="btn-outline min-h-[40px] min-w-0 px-3 text-sm">
              <ExternalLink size={15} aria-hidden /> <span className="truncate">{host || "Open"}</span><span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            <span className="text-xs text-muted">No link</span>
          )}
          <label className="ml-auto flex min-h-[40px] cursor-pointer items-center gap-1.5 px-1 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--primary))]" checked={!!item.bought} onChange={(e) => saveWish({ ...item, bought: e.target.checked })} />
            Bought
          </label>
          <button className="icon-btn h-10 w-10" disabled={first} onClick={() => onMove(-1)} aria-label={`Move ${item.item} up`}><ArrowUp size={16} /></button>
          <button className="icon-btn h-10 w-10" disabled={last} onClick={() => onMove(1)} aria-label={`Move ${item.item} down`}><ArrowDown size={16} /></button>
        </div>
      </div>
    </li>
  );
}
