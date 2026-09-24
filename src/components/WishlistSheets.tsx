import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ImagePlus, Link2, Plus, Trash2, Upload, X } from "lucide-react";
import { useData } from "../store/data";
import { useUI } from "../store/ui";
import { evaluate } from "../lib/expr";
import { fmt, round2 } from "../lib/money";
import { currentPeriodId } from "../lib/periods";
import { resolveBudget } from "../lib/calc";
import { shrinkImage } from "../lib/image";
import { asUrl, fundSub, safeImage } from "../lib/wishlist";
import type { ListField, WishItem, WishList } from "../lib/types";
import { Sheet } from "./ui";

const parseMoney = (s: string) => {
  if (!s.trim()) return 0;
  try {
    return round2(evaluate(s));
  } catch {
    return NaN;
  }
};

/** Create or edit a list: name, goal, target date, already saved, budget tracking, and its own dropdowns. */
export function ListSheet({ list, onClose, onCreated }: { list: WishList | null; onClose: () => void; onCreated?: (id: string) => void }) {
  const data = useData();
  const { settings, wishLists, wishlist } = data;
  const { toast, deleteWithUndo } = useUI();
  const [name, setName] = useState(list?.name ?? "");
  const [goal, setGoal] = useState(list?.goalAmount != null ? list.goalAmount.toFixed(2) : "");
  const [target, setTarget] = useState(list?.targetDate ?? "");
  const [saved, setSaved] = useState(list ? list.startingSaved.toFixed(2) : "");
  const [track, setTrack] = useState(list ? !!list.subId : true);
  const [fields, setFields] = useState<ListField[]>(list?.fields ?? []);
  const [newOpt, setNewOpt] = useState<Record<string, string>>({});
  const [err, setErr] = useState<Record<string, string>>({});
  const fundName = list?.subId ? settings.subCategories.find((s) => s.id === list.subId)?.name : null;

  const patchField = (id: string, patch: Partial<ListField>) => setFields((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const addOption = (f: ListField) => {
    const v = (newOpt[f.id] ?? "").trim();
    if (!v || f.options.some((o) => o.toLowerCase() === v.toLowerCase())) return;
    patchField(f.id, { options: [...f.options, v] });
    setNewOpt((o) => ({ ...o, [f.id]: "" }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const nm = name.trim();
    if (!nm) errs.name = "Name the list, like Furniture or Japan trip.";
    else if (wishLists.some((l) => l.id !== list?.id && l.name.toLowerCase() === nm.toLowerCase())) errs.name = `You already have a list called ${nm}.`;
    const goalV = goal.trim() ? parseMoney(goal) : null;
    if (goalV !== null && !(goalV >= 0)) errs.goal = "Enter an amount, or leave it blank to use the items' total.";
    const savedV = parseMoney(saved);
    if (!(savedV >= 0)) errs.saved = "Enter an amount like 600, or leave it blank.";
    const cleanFields = fields.map((f) => ({ ...f, name: f.name.trim() })).filter((f) => f.name);
    if (fields.some((f) => !f.name.trim() && f.options.length)) errs.fields = "Give every dropdown a name, or remove it.";
    setErr(errs);
    if (Object.keys(errs).length) return;

    const id = list?.id ?? data.newId();
    let subId = list?.subId ?? null;
    if (track && !subId) {
      // A "<name> fund" line under Savings; what's logged to it counts toward the goal.
      const sub = fundSub(nm, settings.subCategories, data.newId());
      subId = sub.id;
      data.saveSubCategories([...settings.subCategories, sub]);
      const pid = currentPeriodId();
      const { lineItems } = resolveBudget(pid, data.periods, settings);
      data.savePeriod(pid, [...lineItems, { id: data.newId(), subId: sub.id, category: "Savings", budgeted: 0 }]);
    }
    if (!track) subId = null;
    data.saveWishList({
      id,
      name: nm,
      order: list?.order ?? Math.max(-1, ...wishLists.map((l) => l.order)) + 1,
      subId,
      startingSaved: savedV,
      goalAmount: goalV,
      targetDate: target || null,
      fields: cleanFields,
      createdAt: list?.createdAt
    });
    toast({ message: list ? `${nm} updated` : `${nm} created`, detail: !list && track ? `Added a "${nm} fund" line under Savings in your budget.` : undefined, tone: "good" }, 4000);
    if (!list) onCreated?.(id);
    onClose();
  };

  const remove = () => {
    if (!list) return;
    const items = wishlist.filter((w) => w.listId === list.id);
    onClose();
    void deleteWithUndo({
      what: `${list.name} list`,
      message: `Delete ${list.name} and its ${items.length} ${items.length === 1 ? "item" : "items"}? Its budget line and contributions stay in your budget.`,
      remove: () => {
        items.forEach((w) => data.deleteWish(w.id));
        data.deleteWishList(list.id);
      },
      restore: () => {
        data.saveWishList(list);
        items.forEach((w) => data.saveWish(w));
      }
    });
  };

  return (
    <Sheet
      title={list ? `Edit ${list.name}` : "New list"}
      onClose={onClose}
      wide
      footer={
        <div className="flex items-center gap-2">
          {list && <button type="button" className="btn-ghost text-bad" onClick={remove}><Trash2 size={17} aria-hidden /> Delete list</button>}
          <button className="btn-outline ml-auto" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="list-form">{list ? "Save" : "Create list"}</button>
        </div>
      }
    >
      <form id="list-form" onSubmit={submit} className="grid grid-cols-2 gap-4" noValidate>
        <div className="col-span-2">
          <label htmlFor="l-name" className="label">Name <span className="text-bad" aria-hidden>*</span></label>
          <input id="l-name" data-autofocus className="input" placeholder="Furniture" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!err.name} />
          {err.name && <p role="alert" className="mt-1 text-sm text-bad">{err.name}</p>}
        </div>
        <div>
          <label htmlFor="l-goal" className="label">Goal amount</label>
          <input id="l-goal" inputMode="decimal" className="input num" placeholder="Items total" value={goal} onChange={(e) => setGoal(e.target.value)} aria-invalid={!!err.goal} aria-describedby="l-goal-help" />
          <p id="l-goal-help" className="mt-1 text-xs text-muted">Blank uses the total of the items</p>
          {err.goal && <p role="alert" className="mt-1 text-sm text-bad">{err.goal}</p>}
        </div>
        <div>
          <label htmlFor="l-target" className="label">Target date</label>
          <input id="l-target" type="date" className="input" value={target} onChange={(e) => setTarget(e.target.value)} />
        </div>
        <div>
          <label htmlFor="l-saved" className="label">Already saved</label>
          <input id="l-saved" inputMode="decimal" className="input num" placeholder="0.00" value={saved} onChange={(e) => setSaved(e.target.value)} aria-invalid={!!err.saved} />
          {err.saved && <p role="alert" className="mt-1 text-sm text-bad">{err.saved}</p>}
        </div>
        <div className="flex items-end">
          <label className="flex min-h-[44px] cursor-pointer items-start gap-2.5 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[rgb(var(--primary))]" checked={track} onChange={(e) => setTrack(e.target.checked)} />
            <span>
              Track in my budget
              <span className="block text-xs text-muted">{fundName ? `Contributions come from ${fundName}` : "Adds a fund line under Savings"}</span>
            </span>
          </label>
        </div>

        <fieldset className="col-span-2 rounded-2xl border border-line p-3">
          <legend className="px-1 text-sm font-medium">Dropdowns</legend>
          <p className="mb-3 text-xs text-muted">Your own dropdowns for this list, like Room or Style. You can also type a new choice while adding an item.</p>
          <ul className="grid gap-3">
            {fields.map((f) => (
              <li key={f.id} className="rounded-xl bg-surface-2 p-2.5">
                <div className="flex items-center gap-2">
                  <label htmlFor={`fld-${f.id}`} className="sr-only">Dropdown name</label>
                  <input id={`fld-${f.id}`} className="input min-h-[40px] flex-1 py-1.5" placeholder="Name, like Room" value={f.name} onChange={(e) => patchField(f.id, { name: e.target.value })} />
                  <button type="button" className="icon-btn hover:text-bad" onClick={() => setFields((fs) => fs.filter((x) => x.id !== f.id))} aria-label={`Remove the ${f.name || "new"} dropdown`}>
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {f.options.map((o) => (
                    <span key={o} className="inline-flex items-center gap-1 rounded-full bg-surface py-0.5 pl-2.5 pr-0.5 text-sm">
                      {o}
                      <button type="button" className="rounded-full p-1.5 text-muted hover:text-bad" onClick={() => patchField(f.id, { options: f.options.filter((x) => x !== o) })} aria-label={`Remove ${o}`}>
                        <X size={13} />
                      </button>
                    </span>
                  ))}
                  <span className="inline-flex items-center gap-1">
                    <label htmlFor={`opt-${f.id}`} className="sr-only">New choice for {f.name}</label>
                    <input
                      id={`opt-${f.id}`}
                      className="input min-h-[36px] w-36 py-1 text-sm"
                      placeholder="Add a choice"
                      value={newOpt[f.id] ?? ""}
                      onChange={(e) => setNewOpt((o) => ({ ...o, [f.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOption(f); } }}
                    />
                    <button type="button" className="icon-btn h-9 w-9" onClick={() => addOption(f)} aria-label={`Add choice to ${f.name}`}><Plus size={16} /></button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {err.fields && <p role="alert" className="mt-2 text-sm text-bad">{err.fields}</p>}
          <button type="button" className="btn-ghost mt-2 text-primary" onClick={() => setFields((fs) => [...fs, { id: data.newId(), name: "", options: [] }])}>
            <Plus size={16} aria-hidden /> Add dropdown
          </button>
        </fieldset>
      </form>
    </Sheet>
  );
}

/** Add or edit an item: name, price, quantity, link, photo or image link, the list's dropdowns, bought. */
export function ItemSheet({ list, item, onClose }: { list: WishList; item: WishItem | null; onClose: () => void }) {
  const data = useData();
  const { wishlist } = data;
  const { toast, deleteWithUndo } = useUI();
  const [f, setF] = useState({
    item: item?.item ?? "",
    price: item ? item.price.toFixed(2) : "",
    qty: item?.qty != null ? String(item.qty) : "",
    link: item?.link ?? "",
    notes: item?.notes ?? "",
    bought: item?.bought ?? false
  });
  const [values, setValues] = useState<Record<string, string>>(item?.values ?? {});
  const [image, setImage] = useState(item?.image ?? "");
  const [imageUrl, setImageUrl] = useState(item?.image && !item.image.startsWith("data:") ? item.image : "");
  const [imgBusy, setImgBusy] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof f, v: string | boolean) => { setF((p) => ({ ...p, [k]: v })); setErr((e) => ({ ...e, [k]: "" })); };
  const preview = safeImage(image);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImgBusy(true);
    try {
      setImage(await shrinkImage(file));
      setImageUrl("");
      setErr((x) => ({ ...x, image: "" }));
    } catch (x) {
      setErr((er) => ({ ...er, image: (x as Error).message }));
    } finally {
      setImgBusy(false);
    }
  };

  const applyImageUrl = () => {
    const u = imageUrl.trim();
    if (!u) return;
    if (!safeImage(u)) return setErr((er) => ({ ...er, image: "Use an image link that starts with https://" }));
    setImage(u);
    setErr((er) => ({ ...er, image: "" }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!f.item.trim()) errs.item = "Name the item.";
    const price = parseMoney(f.price);
    if (!(price >= 0)) errs.price = "Enter a price like 249.99.";
    let qty: number | null = null;
    if (f.qty.trim()) {
      qty = Number(f.qty);
      if (!Number.isFinite(qty) || qty <= 0) errs.qty = "Quantity must be more than 0, or blank for 1.";
    }
    if (f.link.trim() && !asUrl(f.link)) errs.link = "That doesn't look like a web address.";
    // An image link typed but not applied yet still counts.
    let img = image;
    if (imageUrl.trim() && imageUrl.trim() !== image) {
      if (safeImage(imageUrl.trim())) img = imageUrl.trim();
      else errs.image = "Use an image link that starts with https://";
    }
    setErr(errs);
    if (Object.values(errs).some(Boolean)) return;

    // Choices typed that the list doesn't have yet become new dropdown options.
    const clean: Record<string, string> = {};
    let fieldsChanged = false;
    const fields = list.fields.map((fl) => {
      const v = (values[fl.id] ?? "").trim();
      if (!v) return fl;
      const existing = fl.options.find((o) => o.toLowerCase() === v.toLowerCase());
      clean[fl.id] = existing ?? v;
      if (existing) return fl;
      fieldsChanged = true;
      return { ...fl, options: [...fl.options, v] };
    });
    if (fieldsChanged) data.saveWishList({ ...list, fields });

    const mine = wishlist.filter((w) => w.listId === list.id);
    const next: WishItem = {
      id: item?.id ?? data.newId(),
      listId: list.id,
      item: f.item.trim(),
      price,
      qty,
      link: f.link.trim(),
      notes: f.notes.trim(),
      order: item?.order ?? (mine.length ? Math.max(...mine.map((w) => w.order)) + 1 : 0),
      image: img || undefined,
      values: clean,
      bought: f.bought
    };
    data.saveWish(next);
    toast({ message: item ? "Item updated" : `Added to ${list.name}`, tone: "good" }, 2500);
    onClose();
  };

  const remove = () => {
    if (!item) return;
    const copy = item;
    onClose();
    void deleteWithUndo({ what: copy.item || "item", remove: () => data.deleteWish(copy.id), restore: () => data.saveWish(copy) });
  };

  const total = (() => {
    const p = parseMoney(f.price);
    const q = f.qty.trim() ? Number(f.qty) : 1;
    return p > 0 && q > 0 ? p * q : 0;
  })();

  return (
    <Sheet
      title={item ? "Edit item" : `Add to ${list.name}`}
      onClose={onClose}
      wide
      footer={
        <div className="flex items-center gap-2">
          {item && <button type="button" className="btn-ghost text-bad" onClick={remove}><Trash2 size={17} aria-hidden /> Delete</button>}
          <button className="btn-outline ml-auto" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="item-form" disabled={imgBusy}>{item ? "Save" : "Add item"}</button>
        </div>
      }
    >
      <form id="item-form" onSubmit={submit} className="grid grid-cols-2 gap-4" noValidate>
        <div className="col-span-2">
          <label htmlFor="i-name" className="label">Item <span className="text-bad" aria-hidden>*</span></label>
          <input id="i-name" data-autofocus className="input" placeholder="Walnut side table" value={f.item} onChange={(e) => set("item", e.target.value)} aria-invalid={!!err.item} />
          {err.item && <p role="alert" className="mt-1 text-sm text-bad">{err.item}</p>}
        </div>

        <div className="col-span-2">
          <span className="label" id="i-image-label">Image</span>
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-surface-2">
              {imgBusy ? (
                <span className="text-xs text-muted">Shrinking...</span>
              ) : preview ? (
                <img src={preview} alt="" className="h-full w-full object-cover" onError={() => setErr((x) => ({ ...x, image: "That image link didn't load. Check it, or upload a photo instead." }))} />
              ) : (
                <ImagePlus size={26} className="text-muted" aria-hidden />
              )}
            </div>
            <div className="min-w-[200px] flex-1 space-y-2">
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-outline min-h-[40px] px-3 text-sm" onClick={() => fileRef.current?.click()} aria-describedby="i-image-label">
                  <Upload size={16} aria-hidden /> Upload photo
                </button>
                {image && (
                  <button type="button" className="btn-ghost min-h-[40px] px-3 text-sm text-bad" onClick={() => { setImage(""); setImageUrl(""); }}>
                    <X size={16} aria-hidden /> Remove
                  </button>
                )}
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
              </div>
              <div className="flex gap-2">
                <label htmlFor="i-image-url" className="sr-only">Image link</label>
                <input id="i-image-url" className="input min-h-[40px] flex-1 py-1.5 text-sm" placeholder="Or paste an image link (https://...)" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} onBlur={applyImageUrl} />
              </div>
              <p className="text-xs text-muted">On a store's site, press and hold (or right-click) the product photo and choose Copy Image Address.</p>
            </div>
          </div>
          {err.image && <p role="alert" className="mt-1 text-sm text-bad">{err.image}</p>}
        </div>

        <div>
          <label htmlFor="i-price" className="label">Price</label>
          <input id="i-price" inputMode="decimal" className="input num" placeholder="0.00" value={f.price} onChange={(e) => set("price", e.target.value)} aria-invalid={!!err.price} />
          {err.price && <p role="alert" className="mt-1 text-sm text-bad">{err.price}</p>}
        </div>
        <div>
          <label htmlFor="i-qty" className="label">Qty</label>
          <input id="i-qty" inputMode="numeric" className="input num" placeholder="1" value={f.qty} onChange={(e) => set("qty", e.target.value)} aria-invalid={!!err.qty} />
          {err.qty && <p role="alert" className="mt-1 text-sm text-bad">{err.qty}</p>}
        </div>
        {total > 0 && <p className="num col-span-2 -mt-2 text-sm text-muted">Total <strong className="text-ink">{fmt(total)}</strong></p>}

        <div className="col-span-2">
          <label htmlFor="i-link" className="label">Link</label>
          <div className="relative">
            <Link2 size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
            <input id="i-link" inputMode="url" className="input pl-9" placeholder="https://store.com/product" value={f.link} onChange={(e) => set("link", e.target.value)} aria-invalid={!!err.link} />
          </div>
          {err.link && <p role="alert" className="mt-1 text-sm text-bad">{err.link}</p>}
        </div>

        {list.fields.map((fl) => (
          <div key={fl.id}>
            <label htmlFor={`i-f-${fl.id}`} className="label">{fl.name}</label>
            <input
              id={`i-f-${fl.id}`}
              list={`i-f-${fl.id}-opts`}
              className="input"
              placeholder={fl.options.length ? `Pick or type` : `Type one`}
              value={values[fl.id] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [fl.id]: e.target.value }))}
            />
            <datalist id={`i-f-${fl.id}-opts`}>{fl.options.map((o) => <option key={o} value={o} />)}</datalist>
          </div>
        ))}
        {list.fields.length === 0 && (
          <p className="col-span-2 text-xs text-muted">Want dropdowns like Room or Style? Add them with Edit list.</p>
        )}

        <div className="col-span-2">
          <label htmlFor="i-notes" className="label">Notes</label>
          <textarea id="i-notes" rows={2} className="input" value={f.notes} onChange={(e) => set("notes", e.target.value)} />
        </div>
        <label className="col-span-2 flex min-h-[44px] cursor-pointer items-center gap-2.5">
          <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--primary))]" checked={f.bought} onChange={(e) => set("bought", e.target.checked)} />
          <span className="font-medium">Bought</span>
        </label>
      </form>
    </Sheet>
  );
}
