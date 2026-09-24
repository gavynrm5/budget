import { X } from "lucide-react";
import { useUI } from "../store/ui";

const TONE: Record<string, string> = {
  neutral: "border-line",
  good: "border-good/50",
  warn: "border-warn/60",
  bad: "border-bad/60"
};

export function Toasts() {
  const { toasts, dismiss } = useUI();
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(150px+env(safe-area-inset-bottom))] z-toast flex flex-col items-center gap-2 px-4 lg:bottom-6 lg:left-auto lg:right-6 lg:items-end"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`anim-toast pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl border-2 bg-surface px-4 py-3 shadow-xl ${TONE[t.tone]}`}
        >
          <div className="min-w-0 flex-1">
            <p className="font-medium">{t.message}</p>
            {t.detail && <p className="num text-sm text-muted">{t.detail}</p>}
          </div>
          {t.action && (
            <button
              className="min-h-[44px] rounded-lg px-3 font-semibold text-primary hover:bg-primary/10"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button className="icon-btn -mr-2 h-9 w-9" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
