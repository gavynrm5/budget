import { useEffect, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  CalendarRange,
  CloudOff,
  House,
  LineChart,
  ListChecks,
  MoreHorizontal,
  NotebookPen,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  Sofa
} from "lucide-react";
import { useUI } from "../store/ui";
import { useData } from "../store/data";
import { Sheet } from "./ui";
import { Toasts } from "./Toasts";
import { ConfirmDialog } from "./ConfirmDialog";
import { TransactionSheet } from "./TransactionSheet";

const NAV = [
  { to: "/", label: "Dashboard", short: "Home", icon: House, end: true },
  { to: "/budget", label: "Period Budget", short: "Budget", icon: ListChecks },
  { to: "/annual", label: "Annual Overview", short: "Year", icon: CalendarRange },
  { to: "/wishlist", label: "Wishlist", short: "Wishlist", icon: Sofa },
  { to: "/portfolio", label: "Portfolio", short: "Portfolio", icon: LineChart },
  { to: "/planning", label: "Planning", short: "Planning", icon: NotebookPen },
  { to: "/settings", label: "Settings", short: "Settings", icon: SettingsIcon }
];
const BOTTOM = NAV.slice(0, 4);
const MORE = NAV.slice(4);

function SyncStatus() {
  const { online, pending } = useData();
  if (!online)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-warn/15 px-2.5 py-1 text-xs font-medium text-warn" role="status">
        <CloudOff size={14} aria-hidden /> Offline, saved on this device
      </span>
    );
  if (pending)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted" role="status">
        <RefreshCw size={14} className="motion-safe:animate-spin" aria-hidden /> Syncing
      </span>
    );
  return null;
}

export function Layout({ children }: { children: ReactNode }) {
  const { openTxSheet, txSheet, moreOpen, setMoreOpen } = useUI();
  const location = useLocation();
  const navigate = useNavigate();

  // Keyboard shortcut on desktop: "n" opens a new transaction.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "n" && !e.metaKey && !e.ctrlKey && !e.altKey && !/INPUT|TEXTAREA|SELECT/.test(t.tagName) && !txSheet) {
        e.preventDefault();
        openTxSheet();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openTxSheet, txSheet]);

  // Many fields save when they lose focus. Safari (iPhone and Mac) keeps a text
  // field focused when a button, link, or empty space is tapped, so the save
  // would run late or never (for example, when a tab switches pages first).
  // Ending the edit on any tap outside the field makes it save first, like
  // other browsers. Also end it when the app goes to the background.
  // Elements marked data-keep-focus (like autocomplete lists) opt out.
  useEffect(() => {
    const endEdit = () => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) el.blur();
    };
    const onDown = (e: PointerEvent) => {
      const el = document.activeElement;
      const target = e.target as Element;
      if (!el || el === target || el.contains(target) || target.closest?.("[data-keep-focus]")) return;
      endEdit();
    };
    const onHide = () => document.visibilityState === "hidden" && endEdit();
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  // Move focus to main content on route change for screen reader users.
  useEffect(() => {
    document.getElementById("main")?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [location.pathname]);

  const moreActive = MORE.some((n) => location.pathname.startsWith(n.to));

  return (
    <div className="min-h-dvh lg:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-toast focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-surface px-3 py-5 lg:flex">
        <div className="mb-6 flex items-center gap-2.5 px-3">
          <img src="./icons/favicon.svg" alt="" className="h-8 w-8" />
          <span className="text-lg font-semibold">Pay Period Budget</span>
        </div>
        <button className="btn-primary mb-5 w-full" onClick={() => openTxSheet()}>
          <Plus size={18} aria-hidden /> Add transaction
          <kbd className="ml-auto rounded bg-on-primary/20 px-1.5 text-xs font-normal">N</kbd>
        </button>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex min-h-[44px] items-center gap-3 rounded-xl px-3 font-medium transition-colors duration-150 ${
                  isActive ? "bg-primary/10 text-primary" : "text-muted hover:bg-surface-2 hover:text-ink"
                }`
              }
            >
              <Icon size={20} aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto px-3">
          <SyncStatus />
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <div className="pt-safe sticky top-0 z-nav flex items-center justify-between border-b border-line bg-bg/90 px-4 py-2.5 backdrop-blur lg:hidden">
          <span className="flex items-center gap-2 font-semibold">
            <img src="./icons/favicon.svg" alt="" className="h-7 w-7" /> Budget
          </span>
          <SyncStatus />
        </div>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl px-4 pb-32 pt-5 outline-none sm:px-6 lg:px-10 lg:pb-12 lg:pt-8">
          {children}
        </main>
      </div>

      {/* Mobile floating add button */}
      <button
        onClick={() => openTxSheet()}
        aria-label="Add transaction"
        className="fixed bottom-[calc(84px+env(safe-area-inset-bottom))] right-4 z-fab flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-on-primary shadow-lg shadow-primary/30 transition-transform duration-150 active:scale-95 lg:hidden"
      >
        <Plus size={28} aria-hidden />
      </button>

      {/* Mobile bottom tabs */}
      <nav aria-label="Main" className="pb-safe fixed inset-x-0 bottom-0 z-nav border-t border-line bg-surface/95 backdrop-blur lg:hidden">
        <ul className="mx-auto grid max-w-lg grid-cols-5">
          {BOTTOM.map(({ to, short, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-xs font-medium ${isActive ? "text-primary" : "text-muted"}`
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-150 ${isActive ? "bg-primary/10" : ""}`}>
                      <Icon size={20} aria-hidden />
                    </span>
                    {short}
                  </>
                )}
              </NavLink>
            </li>
          ))}
          <li>
            <button
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              className={`flex min-h-[60px] w-full flex-col items-center justify-center gap-0.5 text-xs font-medium ${moreActive ? "text-primary" : "text-muted"}`}
            >
              <span className={`flex h-7 w-12 items-center justify-center rounded-full ${moreActive ? "bg-primary/10" : ""}`}>
                <MoreHorizontal size={20} aria-hidden />
              </span>
              More
            </button>
          </li>
        </ul>
      </nav>

      {moreOpen && (
        <Sheet title="More" onClose={() => setMoreOpen(false)}>
          <div className="grid gap-2 pb-4">
            {MORE.map(({ to, label, icon: Icon }) => (
              <button
                key={to}
                onClick={() => {
                  setMoreOpen(false);
                  navigate(to);
                }}
                className="flex min-h-[52px] items-center gap-3 rounded-xl bg-surface-2 px-4 text-left font-medium"
              >
                <Icon size={20} aria-hidden className="text-muted" /> {label}
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {txSheet && <TransactionSheet />}
      <ConfirmDialog />
      <Toasts />
    </div>
  );
}
