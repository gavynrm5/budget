import { useMemo, useState, type FormEvent } from "react";
import { ExternalLink, Pencil, Plus, Sofa, Trash2 } from "lucide-react";
import { useData } from "../store/data";
import { useUI } from "../store/ui";
import { fmt, round2, sum } from "../lib/money";
import { evaluate } from "../lib/expr";
import { WISH_STATUSES, type WishItem, type WishStatus } from "../lib/types";
import { MoneyInput } from "../components/MoneyInput";
import { EmptyState, Money, PageHeader, Sheet } from "../components/ui";

const STATUS_STYLE: Record<WishStatus, string> = {
  Idea: "bg-surface-2 text-muted border-line",
  Want: "bg-primary/10 text-primary border-primary/30",
  Ordered: "bg-warn/15 text-warn border-warn/40",
  Delivered: "bg-good/10 text-good border-good/40"
};

const total = (w: WishItem) => round2(w.price * (w.qty ?? 1));

function asUrl(link: string): string | null {
  const s = link.trim();
  if (!s || /\s/.test(s)) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(s)) return `https://${s}`;
  return null;
}

export default function Wishlist() {
  const { wishlist, settings, updateSettings, saveWish, deleteWish } = useData();
  const { deleteWithUndo } = useUI();
  const [room, setRoom] = useState("all");
  const [cat, setCat] = useState("all");
  const [status, setStatus] = useState<WishStatus | "all">("all");
  const [editing, setEditing] = useState<WishItem | "new" | null>(null);

  const rooms = useMemo(() => [...new Set([...settings.wishlistRooms, ...wishlist.map((w) => w.room).filter(Boolean)])], [settings.wishlistRooms, wishlist]);
  const cats = useMemo(() => [...new Set([...settings.wishlistCategories, ...wishlist.map((w) => w.category).filter(Boolean)])], [settings.wishlistCategories, wishlist]);

  const totalBudget = sum(wishlist.map(total));
  const totalSpent = sum(wishlist.filter((w) => w.status === "Ordered" || w.status === "Delivered").map(total));
  const saved = settings.wishlistSaved;
  const progress = totalBudget > 0 ? Math.min(1, saved / totalBudget) : 0;

  const rows = wishlist.filter((w) => (room === "all" || w.room === room) && (cat === "all" || w.category === cat) && (status === "all" || w.status === status));

  const cycle = (w: WishItem) => {
    const next = WISH_STATUSES[(WISH_STATUSES.indexOf(w.status) + 1) % WISH_STATUSES.length];
    saveWish({ ...w, status: next });
  };

  const remove = (w: WishItem) =>
    deleteWithUndo({ what: w.item || "item", remove: () => deleteWish(w.id), restore: () => saveWish(w) });

  const StatusPill = ({ w }: { w: WishItem }) => {
    const next = WISH_STATUSES[(WISH_STATUSES.indexOf(w.status) + 1) % WISH_STATUSES.length];
    return (
      <button
        onClick={() => cycle(w)}
        className={`inline-flex min-h-[36px] items-center rounded-full border px-3 text-xs font-semibold transition-colors duration-150 ${STATUS_STYLE[w.status]}`}
        aria-label={`Status ${w.status}. Tap to change to ${next}.`}
        title={`Tap to change to ${next}`}
      >
        {w.status}
      </button>
    );
  };

  const LinkCell = ({ link }: { link: string }) => {
    const url = asUrl(link);
    if (!link) return <span className="text-muted">-</span>;
    if (!url) return <span>{link}</span>;
    let host = link;
    try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* keep raw */ }
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[36px] items-center gap-1 text-primary hover:underline">
        {host} <ExternalLink size={13} aria-hidden /><span className="sr-only">(opens in a new tab)</span>
      </a>
    );
  };

  return (
    <>
      <PageHeader
        title="Wishlist"
        subtitle="Furniture and home goals"
        actions={<button className="btn-primary" onClick={() => setEditing("new")}><Plus size={18} aria-hidden /> Add item</button>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card p-4"><p className="text-sm text-muted">Total Items</p><p className="num mt-1 text-2xl font-semibold">{wishlist.length}</p></div>
        <div className="card p-4"><p className="text-sm text-muted">Total Budget</p><p className="num mt-1 text-2xl font-semibold">{fmt(totalBudget)}</p></div>
        <div className="card p-4"><p className="text-sm text-muted">Total Spent</p><p className="num mt-1 text-2xl font-semibold">{fmt(totalSpent)}</p><p className="text-xs text-muted">Ordered or delivered</p></div>
        <div className="card p-4">
          <label htmlFor="wl-saved" className="text-sm text-muted">Total Saved</label>
          <div className="mt-1"><MoneyInput id="wl-saved" value={saved} label="Total saved toward wishlist" onCommit={(v) => updateSettings({ wishlistSaved: v })} className="text-lg font-semibold" /></div>
        </div>
      </div>

      <div className="card mb-5 p-4">
        <div className="mb-2 flex justify-between text-sm">
          <span className="font-medium">Saved toward the goal</span>
          <span className="num text-muted">{fmt(saved)} of {fmt(totalBudget)}, {(progress * 100).toFixed(0)}%</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="Saved versus total budget" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-good transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2 sm:flex sm:gap-3">
        <div className="sm:w-48">
          <label htmlFor="wl-room" className="label">Room</label>
          <select id="wl-room" className="input" value={room} onChange={(e) => setRoom(e.target.value)}>
            <option value="all">All rooms</option>
            {rooms.map((r) => <option key={r}>{r}</option>)}
          </select>
        </div>
        <div className="sm:w-48">
          <label htmlFor="wl-cat" className="label">Category</label>
          <select id="wl-cat" className="input" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="all">All</option>
            {cats.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="sm:w-48">
          <label htmlFor="wl-status" className="label">Status</label>
          <select id="wl-status" className="input" value={status} onChange={(e) => setStatus(e.target.value as WishStatus | "all")}>
            <option value="all">All</option>
            {WISH_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {wishlist.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Sofa size={22} />} title="Your wishlist is empty.">Add the first piece you have your eye on.</EmptyState>
        </div>
      ) : rows.length === 0 ? (
        <p className="card p-6 text-center text-muted">Nothing matches these filters.</p>
      ) : (
        <>
          <div className="card hidden overflow-x-auto md:block">
            <table className="w-full">
              <caption className="sr-only">Wishlist items</caption>
              <thead className="border-b border-line">
                <tr>
                  <th className="th pl-5">Item</th><th className="th">Category</th><th className="th">Room</th><th className="th">Status</th>
                  <th className="th text-right">Price</th><th className="th text-right">Qty</th><th className="th text-right">Total</th><th className="th">Link</th>
                  <th className="th pr-5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((w) => (
                  <tr key={w.id} className="border-b border-line/60 last:border-0">
                    <th scope="row" className="td pl-5 text-left font-medium" title={w.notes || undefined}>{w.item}</th>
                    <td className="td text-sm">{w.category}</td>
                    <td className="td text-sm">{w.room}</td>
                    <td className="td"><StatusPill w={w} /></td>
                    <td className="td text-right"><Money value={w.price} /></td>
                    <td className="td num text-right">{w.qty ?? <span className="text-muted">1</span>}</td>
                    <td className="td text-right font-medium"><Money value={total(w)} /></td>
                    <td className="td text-sm"><LinkCell link={w.link} /></td>
                    <td className="td pr-5 text-right">
                      <button className="icon-btn" onClick={() => setEditing(w)} aria-label={`Edit ${w.item}`}><Pencil size={17} /></button>
                      <button className="icon-btn hover:text-bad" onClick={() => remove(w)} aria-label={`Delete ${w.item}`}><Trash2 size={17} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="grid gap-3 md:hidden">
            {rows.map((w) => (
              <li key={w.id} className="card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{w.item}</p>
                    <p className="text-sm text-muted">{[w.category, w.room].filter(Boolean).join(", ")}</p>
                  </div>
                  <StatusPill w={w} />
                </div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="num text-muted">{fmt(w.price)} x {w.qty ?? 1}</span>
                  <Money value={total(w)} className="text-base font-semibold" />
                </div>
                {w.notes && <p className="mt-1 text-sm text-muted">{w.notes}</p>}
                <div className="mt-2 flex items-center justify-between">
                  <LinkCell link={w.link} />
                  <div>
                    <button className="icon-btn" onClick={() => setEditing(w)} aria-label={`Edit ${w.item}`}><Pencil size={17} /></button>
                    <button className="icon-btn hover:text-bad" onClick={() => remove(w)} aria-label={`Delete ${w.item}`}><Trash2 size={17} /></button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {editing && <WishSheet item={editing === "new" ? null : editing} rooms={rooms} cats={cats} onClose={() => setEditing(null)} />}
    </>
  );
}

function WishSheet({ item, rooms, cats, onClose }: { item: WishItem | null; rooms: string[]; cats: string[]; onClose: () => void }) {
  const { saveWish, newId, wishlist, settings, updateSettings } = useData();
  const { toast } = useUI();
  const [f, setF] = useState({
    item: item?.item ?? "",
    category: item?.category ?? cats[0] ?? "",
    room: item?.room ?? "",
    status: item?.status ?? ("Idea" as WishStatus),
    price: item ? item.price.toFixed(2) : "",
    qty: item?.qty != null ? String(item.qty) : "",
    link: item?.link ?? "",
    notes: item?.notes ?? ""
  });
  const [err, setErr] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    let price = 0;
    if (!f.item.trim()) errs.item = "Name the item.";
    try { price = f.price.trim() ? round2(evaluate(f.price)) : 0; if (price < 0) errs.price = "Price cannot be negative."; } catch { errs.price = "Enter a price like 249.99."; }
    let qty: number | null = null;
    if (f.qty.trim()) {
      qty = Number(f.qty);
      if (!Number.isFinite(qty) || qty <= 0) errs.qty = "Quantity must be more than 0, or blank for 1.";
    }
    setErr(errs);
    if (Object.keys(errs).length) return;
    const category = f.category.trim();
    const room = f.room.trim();
    const patch: Partial<typeof settings> = {};
    if (category && !settings.wishlistCategories.includes(category)) patch.wishlistCategories = [...settings.wishlistCategories, category];
    if (room && !settings.wishlistRooms.includes(room)) patch.wishlistRooms = [...settings.wishlistRooms, room];
    if (Object.keys(patch).length) updateSettings(patch);
    saveWish({
      id: item?.id ?? newId(),
      item: f.item.trim(),
      category,
      room,
      status: f.status,
      price,
      qty,
      link: f.link.trim(),
      notes: f.notes.trim(),
      order: item?.order ?? (wishlist.length ? Math.max(...wishlist.map((w) => w.order)) + 1 : 0)
    });
    toast({ message: item ? "Item updated" : "Item added", tone: "good" }, 2500);
    onClose();
  };

  return (
    <Sheet
      title={item ? "Edit item" : "Add wishlist item"}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="wish-form">{item ? "Save changes" : "Add item"}</button>
        </div>
      }
    >
      <form id="wish-form" onSubmit={submit} className="grid grid-cols-2 gap-4" noValidate>
        <div className="col-span-2">
          <label htmlFor="w-item" className="label">Item <span className="text-bad" aria-hidden>*</span></label>
          <input id="w-item" className="input" value={f.item} onChange={(e) => set("item", e.target.value)} aria-invalid={!!err.item} />
          {err.item && <p role="alert" className="mt-1 text-sm text-bad">{err.item}</p>}
        </div>
        <div>
          <label htmlFor="w-cat" className="label">Category</label>
          <input id="w-cat" list="w-cat-list" className="input" value={f.category} onChange={(e) => set("category", e.target.value)} />
          <datalist id="w-cat-list">{cats.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <div>
          <label htmlFor="w-room" className="label">Room</label>
          <input id="w-room" list="w-room-list" className="input" value={f.room} onChange={(e) => set("room", e.target.value)} />
          <datalist id="w-room-list">{rooms.map((r) => <option key={r} value={r} />)}</datalist>
        </div>
        <fieldset className="col-span-2">
          <legend className="label">Status</legend>
          <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Status">
            {WISH_STATUSES.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={f.status === s} onClick={() => set("status", s)}
                className={`min-h-[44px] rounded-xl border text-sm font-medium ${f.status === s ? STATUS_STYLE[s] + " border-2" : "border-line"}`}>
                {s}
              </button>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="w-price" className="label">Price</label>
          <input id="w-price" inputMode="decimal" className="input num" placeholder="0.00" value={f.price} onChange={(e) => set("price", e.target.value)} aria-invalid={!!err.price} />
          {err.price && <p role="alert" className="mt-1 text-sm text-bad">{err.price}</p>}
        </div>
        <div>
          <label htmlFor="w-qty" className="label">Qty</label>
          <input id="w-qty" inputMode="numeric" className="input num" placeholder="1" value={f.qty} onChange={(e) => set("qty", e.target.value)} aria-invalid={!!err.qty} aria-describedby="w-qty-help" />
          <p id="w-qty-help" className="mt-1 text-xs text-muted">Blank means 1</p>
          {err.qty && <p role="alert" className="mt-1 text-sm text-bad">{err.qty}</p>}
        </div>
        <div className="col-span-2">
          <label htmlFor="w-link" className="label">Link or store</label>
          <input id="w-link" className="input" placeholder="https://... or Wayfair" value={f.link} onChange={(e) => set("link", e.target.value)} />
        </div>
        <div className="col-span-2">
          <label htmlFor="w-notes" className="label">Notes</label>
          <textarea id="w-notes" rows={2} className="input" value={f.notes} onChange={(e) => set("notes", e.target.value)} />
        </div>
      </form>
    </Sheet>
  );
}
