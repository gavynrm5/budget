import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Check, ExternalLink, Lightbulb, Sparkles, ThumbsUp, TriangleAlert } from "lucide-react";
import { useData } from "../store/data";
import { useUI } from "../store/ui";
import { useInsights } from "../store/insights";
import type { Tip, TipTone } from "../lib/insights";
import { Sheet } from "./ui";

const TONE: Record<TipTone, { icon: typeof Lightbulb; cls: string; label: string }> = {
  warning: { icon: TriangleAlert, cls: "bg-warn/15 text-warn", label: "Heads up" },
  nudge: { icon: Lightbulb, cls: "bg-primary/10 text-primary", label: "Tip" },
  praise: { icon: ThumbsUp, cls: "bg-good/10 text-good", label: "Nice" }
};

export function TipItem({ tip, onDismiss }: { tip: Tip; onDismiss: () => void }) {
  const t = TONE[tip.tone];
  const Icon = t.icon;
  return (
    <li className="flex gap-3 py-3">
      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${t.cls}`} aria-hidden>
        <Icon size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold"><span className="sr-only">{t.label}: </span>{tip.title}</p>
        <p className="mt-0.5 text-sm text-muted">{tip.body}</p>
        {tip.savings != null && <p className="num mt-1 text-xs font-medium text-good">Could save about ${tip.savings.toLocaleString("en-US")} this period</p>}
      </div>
      <button className="btn-ghost h-9 min-h-0 shrink-0 self-start px-2.5 text-sm text-muted" onClick={onDismiss} aria-label={`Got it, hide: ${tip.title}`}>
        <Check size={15} aria-hidden /> Got it
      </button>
    </li>
  );
}

/** Top tips on the Dashboard, linking to the full Insights page. */
export function TipsCard() {
  const ins = useInsights();
  const top = ins.tips.slice(0, 3);
  if (!ins.data.facts.length && !ins.loading) return null;
  return (
    <section aria-labelledby="tips-h" className="card mb-6 px-4 pt-3 sm:px-5">
      <div className="flex items-center justify-between gap-2">
        <h2 id="tips-h" className="flex items-center gap-2 text-lg">
          <Sparkles size={18} className="text-primary" aria-hidden /> Spending tips
        </h2>
        <Link to="/insights" className="inline-flex min-h-[40px] items-center text-sm font-medium text-primary hover:underline">See all</Link>
      </div>
      {ins.loading && !top.length ? (
        <p className="py-4 text-sm text-muted" role="status">Writing your tips...</p>
      ) : top.length ? (
        <ul className="divide-y divide-line/60">
          {top.map((t) => <TipItem key={t.id} tip={t} onDismiss={() => ins.dismiss(t)} />)}
        </ul>
      ) : (
        <p className="py-4 text-sm text-muted">You've cleared every tip for this period.</p>
      )}
    </section>
  );
}

/** Add or remove the Anthropic API key used for AI-written tips. */
export function ClaudeKeySheet({ onClose }: { onClose: () => void }) {
  const { settings, updateSettings } = useData();
  const { toast } = useUI();
  const [value, setValue] = useState(settings.anthropicKey);
  const [err, setErr] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const k = value.trim();
    if (k) {
      setChecking(true);
      try {
        const { checkKey } = await import("../lib/aiTips");
        await checkKey(k);
      } catch (x) {
        const kind = (x as { kind?: string }).kind;
        if (kind === "bad-key") {
          setErr("Anthropic rejected that key. Copy it again from the Claude Console.");
          return;
        }
        // Offline or a temporary error: save it anyway.
      } finally {
        setChecking(false);
      }
    }
    updateSettings({ anthropicKey: k });
    toast({ message: k ? "Claude key saved" : "Claude key removed", tone: "good" }, 2500);
    onClose();
  };

  return (
    <Sheet
      title="AI tips with Claude"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="claude-key-form" disabled={checking}>{checking ? "Checking..." : "Save"}</button>
        </div>
      }
    >
      <form id="claude-key-form" onSubmit={submit} className="space-y-3" noValidate>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>
            Sign in at{" "}
            <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
              console.anthropic.com <ExternalLink size={13} aria-hidden /><span className="sr-only">(opens in a new tab)</span>
            </a>{" "}
            and add a few dollars of credit.
          </li>
          <li>Under Settings, set a monthly spend limit (like $5) so costs can never surprise you.</li>
          <li>Create an API key and paste it here.</li>
        </ol>
        <div>
          <label htmlFor="claude-key" className="label">Anthropic API key</label>
          <input
            id="claude-key"
            data-autofocus
            className="input font-mono text-sm"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="sk-ant-..."
            value={value}
            onChange={(e) => { setValue(e.target.value); setErr(null); }}
            aria-invalid={!!err}
          />
          {err && <p role="alert" className="mt-1 text-sm text-bad">{err}</p>}
          <p className="mt-1 text-xs text-muted">Leave blank and save to remove it.</p>
        </div>
        <div className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">
          <p><strong className="text-ink">What's sent:</strong> this period's spending facts, category and store names, amounts, and goal names. Never account names, balances, notes, or anything else.</p>
          <p className="mt-1"><strong className="text-ink">Cost:</strong> each set of tips is a few cents. Tips are saved and only rewritten when your spending changes, at most about twice a day.</p>
          <p className="mt-1"><strong className="text-ink">Your key</strong> is stored with your budget data, which only your Google account can read, and is left out of backup files.</p>
        </div>
      </form>
    </Sheet>
  );
}
