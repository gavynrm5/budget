import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  writeBatch,
  type DocumentReference,
  type Firestore
} from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { defaultPlanning, defaultSettings } from "../lib/defaults";
import { periodsBetween, resolveBudget } from "../lib/calc";
import { currentPeriodId } from "../lib/periods";
import { toISODate } from "../lib/periods";
import { tradesFromLegacy } from "../lib/portfolio";
import type { ExtraIncome, LegacyHolding, LineItem, PeriodBudget, Planning, Settings, SubCategory, Trade, Transaction, Transfer, WishItem, WishList } from "../lib/types";
import { legacyToList } from "../lib/wishlist";
import { useUI } from "./ui";

export interface Backup {
  app: "pay-period-budget";
  version: 1;
  exportedAt: string;
  settings: Settings;
  periods: PeriodBudget[];
  transactions: Transaction[];
  wishlist: WishItem[];
  planning: Planning;
  // Added with the portfolio page; missing in older backups.
  trades?: Trade[];
  /** First portfolio version, converted to trades on restore. */
  holdings?: LegacyHolding[];
  transfers?: Transfer[];
  extraIncome?: ExtraIncome[];
  wishLists?: WishList[];
}

interface DataContextValue {
  user: User | null;
  authReady: boolean;
  loaded: boolean;
  denied: boolean;
  settings: Settings;
  periods: Record<string, PeriodBudget>;
  transactions: Transaction[];
  wishlist: WishItem[];
  wishLists: WishList[];
  planning: Planning;
  trades: Trade[];
  transfers: Transfer[];
  extraIncome: ExtraIncome[];
  pending: boolean;
  online: boolean;
  newId: () => string;
  updateSettings: (patch: Partial<Settings>) => void;
  saveSubCategories: (subs: SubCategory[]) => void;
  savePeriod: (periodId: string, lineItems: LineItem[]) => void;
  saveTransaction: (tx: Transaction) => void;
  deleteTransaction: (id: string) => void;
  addTransactions: (txs: Transaction[], newSubs: SubCategory[]) => Promise<void>;
  saveWish: (w: WishItem) => void;
  deleteWish: (id: string) => void;
  saveWishList: (l: WishList) => void;
  deleteWishList: (id: string) => void;
  savePlanning: (p: Planning) => void;
  saveTrade: (t: Trade) => void;
  deleteTrade: (id: string) => void;
  saveTransfer: (t: Transfer) => void;
  deleteTransfer: (id: string) => void;
  saveExtraIncome: (x: ExtraIncome) => void;
  deleteExtraIncome: (id: string) => void;
  exportAll: () => Backup;
  replaceAll: (b: Backup) => Promise<void>;
}

const DataContext = createContext<DataContextValue | null>(null);

function stripId<T extends { id: string }>(o: T): Omit<T, "id"> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id: _id, ...rest } = o;
  return rest;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { toast } = useUI();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(!auth);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [periods, setPeriods] = useState<Record<string, PeriodBudget>>({});
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [wishlist, setWishlist] = useState<WishItem[]>([]);
  const [wishLists, setWishLists] = useState<WishList[]>([]);
  const wishServer = useRef({ items: false, lists: false });
  const wishMigratedRef = useRef(false);
  const [planning, setPlanning] = useState<Planning>(defaultPlanning);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [extraIncome, setExtraIncome] = useState<ExtraIncome[]>([]);
  // null until the server has answered, so offline starts never convert half-known data.
  const [legacyHoldings, setLegacyHoldings] = useState<LegacyHolding[] | null>(null);
  const migratedRef = useRef(false);
  const [loadedParts, setLoadedParts] = useState<Set<string>>(new Set());
  const [pendingParts, setPendingParts] = useState<Set<string>>(new Set());
  const [denied, setDenied] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const serverSeen = useRef({ settings: false, periods: false });
  const ensuredRef = useRef(false);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
  }, []);

  const uid = user?.uid;
  const base = useCallback((...path: string[]) => doc(db as Firestore, "users", uid as string, ...path), [uid]);
  const col = useCallback((name: string) => collection(db as Firestore, "users", uid as string, name), [uid]);

  // Fire-and-forget writes. With offline persistence the local cache updates
  // instantly and the promise only resolves once the server confirms, which
  // may be much later, so the UI never waits on it.
  const fire = useCallback(
    (p: Promise<unknown>) => {
      p.catch((err: { code?: string; message?: string }) => {
        if (err?.code === "permission-denied") setDenied(true);
        toast({ message: "Could not save to the cloud", detail: err?.message, tone: "bad" }, 6000);
      });
    },
    [toast]
  );

  useEffect(() => {
    if (!db || !uid) return;
    setLoadedParts(new Set());
    setDenied(false);
    ensuredRef.current = false;
    migratedRef.current = false;
    wishMigratedRef.current = false;
    wishServer.current = { items: false, lists: false };
    setLegacyHoldings(null);
    serverSeen.current = { settings: false, periods: false };
    const markLoaded = (k: string) => setLoadedParts((s) => (s.has(k) ? s : new Set(s).add(k)));
    const markPending = (k: string, v: boolean) =>
      setPendingParts((s) => {
        if (s.has(k) === v) return s;
        const n = new Set(s);
        if (v) n.add(k); else n.delete(k);
        return n;
      });
    const onErr = (err: { code?: string }) => {
      if (err.code === "permission-denied") setDenied(true);
    };
    const opts = { includeMetadataChanges: true };
    const unsubs = [
      onSnapshot(base("meta", "settings"), opts, (snap) => {
        markPending("settings", snap.metadata.hasPendingWrites);
        if (snap.exists()) {
          setSettings({ ...defaultSettings(), ...(snap.data() as Partial<Settings>) });
        } else if (!snap.metadata.fromCache) {
          // First run on a fresh account: seed defaults.
          const s = defaultSettings();
          setSettings(s);
          fire(setDoc(base("meta", "settings"), s));
        }
        if (!snap.metadata.fromCache) serverSeen.current.settings = true;
        markLoaded("settings");
      }, onErr),
      onSnapshot(base("meta", "planning"), opts, (snap) => {
        markPending("planning", snap.metadata.hasPendingWrites);
        if (snap.exists()) setPlanning({ lines: (snap.data() as Partial<Planning>).lines ?? [] });
        markLoaded("planning");
      }, onErr),
      onSnapshot(col("periods"), opts, (snap) => {
        markPending("periods", snap.metadata.hasPendingWrites);
        const map: Record<string, PeriodBudget> = {};
        snap.forEach((d) => { map[d.id] = { id: d.id, lineItems: (d.data().lineItems ?? []) as LineItem[] }; });
        setPeriods(map);
        if (!snap.metadata.fromCache) serverSeen.current.periods = true;
        markLoaded("periods");
      }, onErr),
      onSnapshot(col("transactions"), opts, (snap) => {
        markPending("transactions", snap.metadata.hasPendingWrites);
        setTransactions(snap.docs.map((d) => ({ ...(d.data() as Omit<Transaction, "id">), id: d.id })));
        markLoaded("transactions");
      }, onErr),
      onSnapshot(col("wishlist"), opts, (snap) => {
        markPending("wishlist", snap.metadata.hasPendingWrites);
        setWishlist(snap.docs.map((d) => ({ ...(d.data() as Omit<WishItem, "id">), id: d.id })).sort((a, b) => a.order - b.order));
        if (!snap.metadata.fromCache) wishServer.current.items = true;
        markLoaded("wishlist");
      }, onErr),
      onSnapshot(col("wishLists"), opts, (snap) => {
        markPending("wishLists", snap.metadata.hasPendingWrites);
        setWishLists(
          snap.docs
            .map((d) => {
              const l = d.data() as Omit<WishList, "id">;
              return { ...l, fields: l.fields ?? [], id: d.id };
            })
            .sort((a, b) => a.order - b.order)
        );
        if (!snap.metadata.fromCache) wishServer.current.lists = true;
        markLoaded("wishLists");
      }, onErr),
      onSnapshot(col("trades"), opts, (snap) => {
        markPending("trades", snap.metadata.hasPendingWrites);
        setTrades(snap.docs.map((d) => ({ ...(d.data() as Omit<Trade, "id">), id: d.id })));
        markLoaded("trades");
      }, onErr),
      onSnapshot(col("transfers"), opts, (snap) => {
        markPending("transfers", snap.metadata.hasPendingWrites);
        setTransfers(snap.docs.map((d) => ({ ...(d.data() as Omit<Transfer, "id">), id: d.id })));
        markLoaded("transfers");
      }, onErr),
      onSnapshot(col("extraIncome"), opts, (snap) => {
        markPending("extraIncome", snap.metadata.hasPendingWrites);
        setExtraIncome(snap.docs.map((d) => {
          const x = d.data() as Omit<ExtraIncome, "id">;
          return { ...x, allocations: x.allocations ?? [], id: d.id };
        }));
        markLoaded("extraIncome");
      }, onErr),
      // First portfolio version stored one line per stock. Read only to convert.
      onSnapshot(col("holdings"), (snap) => {
        if (!snap.metadata.fromCache) setLegacyHoldings(snap.docs.map((d) => ({ ...(d.data() as Omit<LegacyHolding, "id">), id: d.id })));
      }, onErr)
    ];
    return () => unsubs.forEach((u) => u());
  }, [uid, base, col, fire]);

  const loaded = loadedParts.size >= 9;

  // Roll periods forward: once server data is known, save a budget for every
  // period from the last saved one through the current period, each copied
  // from the one before it.
  useEffect(() => {
    if (!db || !uid || !loaded || ensuredRef.current) return;
    if (!serverSeen.current.settings || !serverSeen.current.periods) return;
    ensuredRef.current = true;
    const current = currentPeriodId();
    if (periods[current]) return;
    const saved = Object.keys(periods).sort();
    const last = saved.length ? saved[saved.length - 1] : null;
    const from = last && last < current ? last : current;
    const batch = writeBatch(db);
    const working = { ...periods };
    for (const p of periodsBetween(from, current)) {
      if (working[p]) continue;
      const { lineItems } = resolveBudget(p, working, settings);
      working[p] = { id: p, lineItems };
      batch.set(base("periods", p), { lineItems });
    }
    fire(batch.commit());
  }, [loaded, uid, periods, settings, base, fire]);

  // Convert first-version holdings into buy trades, and drop the old daily
  // snapshots, which the chart now rebuilds from trades and past prices.
  useEffect(() => {
    if (!db || !uid || !loaded || !legacyHoldings || migratedRef.current) return;
    migratedRef.current = true;
    const batch = writeBatch(db);
    let n = 0;
    for (const t of tradesFromLegacy(legacyHoldings, (ms) => toISODate(ms ? new Date(ms) : new Date()))) {
      batch.set(base("trades", t.id), stripId(t));
      batch.delete(base("holdings", t.id));
      n++;
    }
    getDocs(col("portfolioHistory"))
      .then((snap) => {
        snap.forEach((d) => { batch.delete(d.ref); n++; });
        if (n) fire(batch.commit());
      })
      .catch(() => { if (n) fire(batch.commit()); });
  }, [loaded, uid, legacyHoldings, base, col, fire]);

  // Move items from the first, single wishlist into a "Furniture" list with
  // its own budget line. Runs once, and only on data confirmed by the server.
  useEffect(() => {
    if (!db || !uid || !loaded || wishMigratedRef.current) return;
    if (!wishServer.current.items || !wishServer.current.lists || !serverSeen.current.settings) return;
    wishMigratedRef.current = true;
    const loose = wishlist.filter((w) => !w.listId);
    if (wishLists.length || (!loose.length && !settings.wishlistSaved)) return;
    const { list, items, sub } = legacyToList(settings, loose);
    const batch = writeBatch(db);
    batch.set(base("wishLists", list.id), stripId(list));
    items.forEach((w) => batch.set(base("wishlist", w.id), stripId(w)));
    if (!settings.subCategories.some((x) => x.id === sub.id)) {
      const subCategories = [...settings.subCategories, sub];
      setSettings((cur) => ({ ...cur, subCategories }));
      batch.set(base("meta", "settings"), { subCategories }, { merge: true });
    }
    const cur = periods[currentPeriodId()];
    if (cur && !cur.lineItems.some((li) => li.subId === sub.id)) {
      batch.set(base("periods", cur.id), { lineItems: [...cur.lineItems, { id: `li-${sub.id}`, subId: sub.id, category: "Savings", budgeted: 0 }] });
    }
    fire(batch.commit());
  }, [loaded, uid, wishlist, wishLists, settings, periods, base, fire]);

  const newId = useCallback(() => (db && uid ? doc(col("transactions")).id : Math.random().toString(36).slice(2)), [uid, col]);

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      setSettings((s) => ({ ...s, ...patch }));
      fire(setDoc(base("meta", "settings"), patch, { merge: true }));
    },
    [base, fire]
  );

  const saveSubCategories = useCallback((subs: SubCategory[]) => updateSettings({ subCategories: subs }), [updateSettings]);

  const savePeriod = useCallback(
    (periodId: string, lineItems: LineItem[]) => {
      setPeriods((p) => ({ ...p, [periodId]: { id: periodId, lineItems } }));
      fire(setDoc(base("periods", periodId), { lineItems }));
    },
    [base, fire]
  );

  const saveTransaction = useCallback(
    (tx: Transaction) => {
      const data = stripId({ ...tx, createdAt: tx.createdAt ?? Date.now() });
      fire(setDoc(base("transactions", tx.id), data));
    },
    [base, fire]
  );

  const deleteTransaction = useCallback((id: string) => fire(deleteDoc(base("transactions", id))), [base, fire]);

  const chunkedWrite = useCallback(
    async (ops: { ref: DocumentReference; data?: object }[]) => {
      if (!db) return;
      for (let i = 0; i < ops.length; i += 400) {
        const batch = writeBatch(db);
        ops.slice(i, i + 400).forEach((o) => (o.data ? batch.set(o.ref, o.data) : batch.delete(o.ref)));
        fire(batch.commit());
      }
    },
    [fire]
  );

  const addTransactions = useCallback(
    async (txs: Transaction[], newSubs: SubCategory[]) => {
      if (newSubs.length) updateSettings({ subCategories: [...settings.subCategories, ...newSubs] });
      await chunkedWrite(txs.map((t) => ({ ref: base("transactions", t.id), data: stripId({ ...t, createdAt: Date.now() }) })));
    },
    [chunkedWrite, base, settings.subCategories, updateSettings]
  );

  const saveWish = useCallback((w: WishItem) => fire(setDoc(base("wishlist", w.id), stripId(w))), [base, fire]);
  const deleteWish = useCallback((id: string) => fire(deleteDoc(base("wishlist", id))), [base, fire]);
  const saveWishList = useCallback(
    (l: WishList) => fire(setDoc(base("wishLists", l.id), stripId({ ...l, createdAt: l.createdAt ?? Date.now() }))),
    [base, fire]
  );
  const deleteWishList = useCallback((id: string) => fire(deleteDoc(base("wishLists", id))), [base, fire]);

  const savePlanning = useCallback(
    (p: Planning) => {
      setPlanning(p);
      fire(setDoc(base("meta", "planning"), p));
    },
    [base, fire]
  );

  const saveTrade = useCallback(
    (t: Trade) => fire(setDoc(base("trades", t.id), stripId({ ...t, createdAt: t.createdAt ?? Date.now() }))),
    [base, fire]
  );
  const deleteTrade = useCallback((id: string) => fire(deleteDoc(base("trades", id))), [base, fire]);

  const saveTransfer = useCallback(
    (t: Transfer) => fire(setDoc(base("transfers", t.id), stripId({ ...t, createdAt: t.createdAt ?? Date.now() }))),
    [base, fire]
  );
  const deleteTransfer = useCallback((id: string) => fire(deleteDoc(base("transfers", id))), [base, fire]);
  const saveExtraIncome = useCallback(
    (x: ExtraIncome) => fire(setDoc(base("extraIncome", x.id), stripId({ ...x, createdAt: x.createdAt ?? Date.now() }))),
    [base, fire]
  );
  const deleteExtraIncome = useCallback((id: string) => fire(deleteDoc(base("extraIncome", id))), [base, fire]);

  const exportAll = useCallback(
    (): Backup => ({
      app: "pay-period-budget",
      version: 1,
      exportedAt: new Date().toISOString(),
      settings,
      periods: Object.values(periods),
      transactions,
      wishlist,
      wishLists,
      planning,
      trades,
      transfers,
      extraIncome
    }),
    [settings, periods, transactions, wishlist, wishLists, planning, trades, transfers, extraIncome]
  );

  const replaceAll = useCallback(
    async (b: Backup) => {
      const ops: { ref: DocumentReference; data?: object }[] = [];
      transactions.forEach((t) => ops.push({ ref: base("transactions", t.id) }));
      wishlist.forEach((w) => ops.push({ ref: base("wishlist", w.id) }));
      Object.keys(periods).forEach((p) => ops.push({ ref: base("periods", p) }));
      // Older backups have no portfolio data; leave the current portfolio alone then.
      const restored = b.trades ?? (b.holdings ? tradesFromLegacy(b.holdings, (ms) => toISODate(ms ? new Date(ms) : new Date())) : null);
      if (restored) trades.forEach((t) => ops.push({ ref: base("trades", t.id) }));
      if (b.transfers) transfers.forEach((t) => ops.push({ ref: base("transfers", t.id) }));
      if (b.extraIncome) extraIncome.forEach((x) => ops.push({ ref: base("extraIncome", x.id) }));
      if (b.wishLists) wishLists.forEach((l) => ops.push({ ref: base("wishLists", l.id) }));
      ops.push({ ref: base("meta", "settings"), data: { ...defaultSettings(), ...b.settings } });
      ops.push({ ref: base("meta", "planning"), data: b.planning ?? defaultPlanning() });
      b.periods.forEach((p) => ops.push({ ref: base("periods", p.id), data: { lineItems: p.lineItems } }));
      b.transactions.forEach((t) => ops.push({ ref: base("transactions", t.id), data: stripId(t) }));
      b.wishlist.forEach((w) => ops.push({ ref: base("wishlist", w.id), data: stripId(w) }));
      restored?.forEach((t) => ops.push({ ref: base("trades", t.id), data: stripId(t) }));
      b.transfers?.forEach((t) => ops.push({ ref: base("transfers", t.id), data: stripId(t) }));
      b.extraIncome?.forEach((x) => ops.push({ ref: base("extraIncome", x.id), data: stripId(x) }));
      b.wishLists?.forEach((l) => ops.push({ ref: base("wishLists", l.id), data: stripId(l) }));
      // Deletes first, then sets, so a restored doc with the same id survives.
      const deletes = ops.filter((o) => !o.data);
      const sets = ops.filter((o) => o.data);
      await chunkedWrite([...deletes, ...sets]);
    },
    [transactions, wishlist, wishLists, periods, trades, transfers, extraIncome, base, chunkedWrite]
  );

  const value: DataContextValue = {
    user,
    authReady,
    loaded,
    denied,
    settings,
    periods,
    transactions,
    wishlist,
    wishLists,
    planning,
    trades,
    transfers,
    extraIncome,
    pending: pendingParts.size > 0,
    online,
    newId,
    updateSettings,
    saveSubCategories,
    savePeriod,
    saveTransaction,
    deleteTransaction,
    addTransactions,
    saveWish,
    deleteWish,
    saveWishList,
    deleteWishList,
    savePlanning,
    saveTrade,
    deleteTrade,
    saveTransfer,
    deleteTransfer,
    saveExtraIncome,
    deleteExtraIncome,
    exportAll,
    replaceAll
  };

  return <DataContext.Provider value={useMemo(() => value, Object.values(value))}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData outside DataProvider");
  return ctx;
}
