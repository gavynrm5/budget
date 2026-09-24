import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { Category, Transaction } from "../lib/types";

export type Tone = "neutral" | "good" | "warn" | "bad";
export interface Toast {
  id: number;
  message: string;
  detail?: string;
  tone: Tone;
  action?: { label: string; run: () => void };
}

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  resolve: (ok: boolean) => void;
}

export interface TxSheetState {
  editing?: Transaction;
  preset?: { category?: Category; subId?: string; periodId?: string };
}

interface UIContextValue {
  toasts: Toast[];
  toast: (t: Omit<Toast, "id">, ms?: number) => void;
  dismiss: (id: number) => void;
  confirm: (title: string, message: string, confirmLabel?: string) => Promise<boolean>;
  confirmState: ConfirmState | null;
  /** Confirm, delete, then offer Undo for 5 seconds. */
  deleteWithUndo: (opts: { what: string; message?: string; remove: () => void; restore: () => void }) => Promise<void>;
  txSheet: TxSheetState | null;
  openTxSheet: (s?: TxSheetState) => void;
  closeTxSheet: () => void;
  moreOpen: boolean;
  setMoreOpen: (v: boolean) => void;
}

const UIContext = createContext<UIContextValue | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [txSheet, setTxSheet] = useState<TxSheetState | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);

  const toast = useCallback(
    (t: Omit<Toast, "id">, ms = 4000) => {
      const id = nextId.current++;
      setToasts((ts) => [...ts.slice(-2), { ...t, id }]);
      setTimeout(() => dismiss(id), ms);
    },
    [dismiss]
  );

  const confirm = useCallback(
    (title: string, message: string, confirmLabel = "Delete") =>
      new Promise<boolean>((resolve) => {
        setConfirmState({
          title,
          message,
          confirmLabel,
          resolve: (ok) => {
            setConfirmState(null);
            resolve(ok);
          }
        });
      }),
    []
  );

  const deleteWithUndo = useCallback<UIContextValue["deleteWithUndo"]>(
    async ({ what, message, remove, restore }) => {
      const ok = await confirm(`Delete ${what}?`, message ?? "You can undo this for a few seconds afterward.");
      if (!ok) return;
      remove();
      toast({ message: `Deleted ${what}`, tone: "neutral", action: { label: "Undo", run: restore } }, 5000);
    },
    [confirm, toast]
  );

  const value = useMemo<UIContextValue>(
    () => ({
      toasts,
      toast,
      dismiss,
      confirm,
      confirmState,
      deleteWithUndo,
      txSheet,
      openTxSheet: (s) => setTxSheet(s ?? {}),
      closeTxSheet: () => setTxSheet(null),
      moreOpen,
      setMoreOpen
    }),
    [toasts, toast, dismiss, confirm, confirmState, deleteWithUndo, txSheet, moreOpen]
  );

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useUI outside UIProvider");
  return ctx;
}
