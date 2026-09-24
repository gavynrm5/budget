import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Copy, Download, FileUp, LogOut, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useData, type Backup } from "../store/data";
import { useUI } from "../store/ui";
import { signOut } from "../lib/firebase";
import { fmt, round2, sum } from "../lib/money";
import { RECOMMENDED_RANGES } from "../lib/defaults";
import { download } from "../lib/csv";
import { parseTransactionsCSV, SAMPLE_CSV, transactionsToCSV, wishlistToCSV, type CsvImportResult } from "../lib/importExport";
import { applyFixedExpenses, resolveBudget } from "../lib/calc";
import { currentPeriodId, isValidPeriodId, periodName } from "../lib/periods";
import { getTheme, setTheme, type ThemePref } from "../lib/theme";
import { CATEGORIES, CATEGORY_LABEL, type Category, type SubCategory } from "../lib/types";
import { MoneyInput } from "../components/MoneyInput";
import { PageHeader, Segmented, Sheet } from "../components/ui";

function Section({ id, title, desc, children }: { id: string; title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="card p-4 sm:p-6">
      <h2 id={id} className="text-lg">{title}</h2>
      {desc && <p className="mt-0.5 text-sm text-muted">{desc}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function Settings() {
  const data = useData();
  const { settings, updateSettings, user } = data;
  const { toast, confirm, deleteWithUndo } = useUI();
  const [theme, setThemeState] = useState<ThemePref>(getTheme());
  const [csvResult, setCsvResult] = useState<CsvImportResult | null>(null);
  const jsonRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);

  const income = round2(settings.takeHomeIncome + settings.otherIncome);
  const targetSum = CATEGORIES.reduce((a, c) => a + settings.targets[c], 0);
  const stamp = new Date().toISOString().slice(0, 10);

  // Sub-category helpers
  const subs = [...settings.subCategories].sort((a, b) => a.order - b.order);
  const saveSubs = (list: SubCategory[]) => data.saveSubCategories(list.map((s, i) => ({ ...s, order: i })));
  const patchSub = (id: string, patch: Partial<SubCategory>) => saveSubs(subs.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const moveSub = (sub: SubCategory, dir: -1 | 1) => {
    const same = subs.filter((s) => s.category === sub.category && !s.archived);
    const i = same.findIndex((s) => s.id === sub.id);
    const other = same[i + dir];
    if (!other) return;
    const list = [...subs];
    const a = list.findIndex((s) => s.id === sub.id);
    const b = list.findIndex((s) => s.id === other.id);
    [list[a], list[b]] = [list[b], list[a]];
    saveSubs(list);
  };
  const addSub = (category: Category) => saveSubs([...subs, { id: data.newId(), name: "New sub-category", category, order: subs.length, archived: false }]);

  // Fixed expenses
  const fixed = settings.fixedExpenses;
  const setFixed = (list: typeof fixed) => updateSettings({ fixedExpenses: list });

  const applyFixedToCurrent = async () => {
    const pid = currentPeriodId();
    const ok = await confirm(
      `Update ${periodName(pid)}?`,
      "Each fixed expense sets the budget line with the same name in the current period. A line that isn't there yet is added, and a new sub-category is created under Essentials if needed.",
      "Update"
    );
    if (!ok) return;
    const r = applyFixedExpenses(resolveBudget(pid, data.periods, settings).lineItems, fixed, settings.subCategories, data.newId);
    if (r.subCategories) data.saveSubCategories(r.subCategories);
    if (r.updated.length || r.added.length) data.savePeriod(pid, r.lineItems);
    const detail = [
      r.updated.length && `Updated ${r.updated.join(", ")}.`,
      r.added.length && `Added ${r.added.join(", ")}.`,
      r.unchanged.length && `Already set: ${r.unchanged.join(", ")}.`
    ].filter(Boolean).join(" ");
    toast({ message: r.updated.length || r.added.length ? `${periodName(pid)} updated` : `${periodName(pid)} already matches`, detail, tone: "good" }, 6000);
  };

  // Import and export
  const exportJSON = () => download(`budget-backup-${stamp}.json`, JSON.stringify(data.exportAll(), null, 2), "application/json");
  const exportTxCSV = () => download(`transactions-${stamp}.csv`, transactionsToCSV(data.transactions, settings.subCategories), "text/csv");
  const exportWishCSV = () => download(`wishlist-${stamp}.csv`, wishlistToCSV(data.wishlist), "text/csv");

  const onJSON = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const b = JSON.parse(await file.text()) as Backup;
      if (b.app !== "pay-period-budget" || !b.settings || !Array.isArray(b.transactions)) throw new Error("This is not a backup from this app.");
      const ok = await confirm(
        "Replace all data?",
        `This replaces everything with the backup from ${b.exportedAt?.slice(0, 10) ?? "an unknown date"} (${b.transactions.length} transactions, ${b.periods?.length ?? 0} periods, ${b.wishlist?.length ?? 0} wishlist items). Export a backup first if you might want today's data.`,
        "Replace everything"
      );
      if (!ok) return;
      await data.replaceAll({ ...b, periods: b.periods ?? [], wishlist: b.wishlist ?? [] });
      toast({ message: "Backup restored", tone: "good" });
    } catch (err) {
      toast({ message: "Could not read that file", detail: (err as Error).message, tone: "bad" }, 6000);
    }
  };

  const onCSV = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setCsvResult(parseTransactionsCSV(await file.text(), settings, data.newId));
  };

  const doCsvImport = async () => {
    if (!csvResult) return;
    await data.addTransactions(csvResult.ready, csvResult.newSubs);
    toast({ message: `Imported ${csvResult.ready.length} transactions`, detail: fmt(sum(csvResult.ready.map((t) => t.amount))), tone: "good" });
    setCsvResult(null);
  };

  const copyUid = async () => {
    try {
      await navigator.clipboard.writeText(user?.uid ?? "");
      toast({ message: "User ID copied", tone: "good" }, 2000);
    } catch {
      toast({ message: "Copy failed. Select the ID and copy it by hand.", tone: "warn" });
    }
  };

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Section id="s-income" title="Income" desc="Total monthly income drives every period.">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="s-take" className="label">Monthly take-home</label>
              <MoneyInput id="s-take" value={settings.takeHomeIncome} label="Monthly take-home income" onCommit={(v) => updateSettings({ takeHomeIncome: v })} />
            </div>
            <div>
              <label htmlFor="s-other" className="label">Other monthly income</label>
              <MoneyInput id="s-other" value={settings.otherIncome} label="Other monthly income" onCommit={(v) => updateSettings({ otherIncome: v })} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="s-note" className="label">Note</label>
              <input id="s-note" className="input" defaultValue={settings.takeHomeNote} onBlur={(e) => e.target.value !== settings.takeHomeNote && updateSettings({ takeHomeNote: e.target.value })} />
            </div>
          </div>
          <p className="mt-4 flex justify-between rounded-xl bg-surface-2 px-4 py-3">
            <span className="text-muted">Total monthly income</span>
            <strong className="num">{fmt(income)}</strong>
          </p>
        </Section>

        <Section id="s-targets" title="Allocation targets" desc="Percent of income for each group.">
          <div className="grid gap-3">
            {CATEGORIES.map((c) => (
              <div key={c} className="flex items-center gap-3">
                <label htmlFor={`t-${c}`} className="flex-1">
                  <span className="font-medium">{CATEGORY_LABEL[c]}</span>
                  <span className="block text-xs text-muted">Recommended {RECOMMENDED_RANGES[c]}. Target {fmt((income * settings.targets[c]) / 100)}</span>
                </label>
                <div className="relative w-28">
                  <input
                    id={`t-${c}`}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100}
                    step={1}
                    className="input num pr-8 text-right"
                    defaultValue={settings.targets[c]}
                    key={settings.targets[c]}
                    onBlur={(e) => {
                      const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                      if (v !== settings.targets[c]) updateSettings({ targets: { ...settings.targets, [c]: v } });
                    }}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted">%</span>
                </div>
              </div>
            ))}
          </div>
          <p className={`mt-4 flex items-center gap-2 rounded-xl px-4 py-3 text-sm ${targetSum === 100 ? "bg-good/10 text-good" : "bg-warn/15 text-warn"}`} role="status">
            {targetSum !== 100 && <TriangleAlert size={16} aria-hidden />}
            {targetSum === 100 ? "Targets add up to 100%." : `Targets add up to ${targetSum}%. ${100 - targetSum > 0 ? `${100 - targetSum}% of income has no target.` : `That is ${targetSum - 100}% more than your income.`}`}
          </p>
        </Section>

        <Section id="s-fixed" title="Fixed monthly expenses" desc="Prefilled into new budgets. Use Apply to put today's amounts into the current period's budget.">
          <ul className="grid gap-2">
            {fixed.map((f) => (
              <li key={f.id} className="flex items-center gap-2">
                <label htmlFor={`fx-n-${f.id}`} className="sr-only">Expense name</label>
                <input id={`fx-n-${f.id}`} className="input flex-1" defaultValue={f.name} onBlur={(e) => e.target.value !== f.name && setFixed(fixed.map((x) => (x.id === f.id ? { ...x, name: e.target.value } : x)))} />
                <div className="w-36"><MoneyInput value={f.amount} label={`${f.name} amount`} onCommit={(v) => setFixed(fixed.map((x) => (x.id === f.id ? { ...x, amount: v } : x)))} /></div>
                <button
                  className="icon-btn hover:text-bad"
                  aria-label={`Delete ${f.name}`}
                  onClick={() => deleteWithUndo({ what: f.name, remove: () => setFixed(fixed.filter((x) => x.id !== f.id)), restore: () => setFixed(fixed) })}
                >
                  <Trash2 size={17} />
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-outline" onClick={() => setFixed([...fixed, { id: data.newId(), name: "New expense", amount: 0 }])}><Plus size={16} aria-hidden /> Add expense</button>
            <button className="btn-ghost text-primary" onClick={applyFixedToCurrent}>Apply to {periodName(currentPeriodId())}</button>
          </div>
          <p className="mt-2 text-sm text-muted">Fixed total <strong className="num text-ink">{fmt(sum(fixed.map((f) => f.amount)))}</strong></p>
        </Section>

        <Section id="s-appearance" title="Appearance and tracking">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="font-medium" id="theme-l">Theme</span>
            <Segmented
              label="Theme"
              value={theme}
              onChange={(v) => { setTheme(v); setThemeState(v); }}
              options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]}
            />
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <label htmlFor="s-start" className="font-medium">
              First pay period
              <span className="block text-xs font-normal text-muted">Overviews start here. Period names follow the month they start in.</span>
            </label>
            <input
              id="s-start"
              type="month"
              className="input w-44"
              defaultValue={settings.startPeriod}
              onBlur={(e) => isValidPeriodId(e.target.value) && e.target.value !== settings.startPeriod && updateSettings({ startPeriod: e.target.value })}
            />
          </div>
        </Section>

        <div className="lg:col-span-2">
          <Section id="s-cats" title="Categories and sub-categories" desc="Rename, reorder, move to another default group, or archive. To place a line in a different group for just one period, use the Period Budget screen.">
            <div className="grid gap-6 lg:grid-cols-3">
              {CATEGORIES.map((c) => {
                const active = subs.filter((s) => s.category === c && !s.archived);
                const archived = subs.filter((s) => s.category === c && s.archived);
                return (
                  <div key={c}>
                    <h3 className="mb-2 font-semibold">{CATEGORY_LABEL[c]}</h3>
                    <ul className="grid gap-2">
                      {active.map((s, i) => (
                        <li key={s.id} className="rounded-xl border border-line p-2">
                          <label htmlFor={`sub-${s.id}`} className="sr-only">Name</label>
                          <input id={`sub-${s.id}`} className="input" defaultValue={s.name} key={s.name} onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && patchSub(s.id, { name: e.target.value.trim() })} />
                          <div className="mt-1 flex items-center gap-1">
                            <button className="icon-btn" disabled={i === 0} onClick={() => moveSub(s, -1)} aria-label={`Move ${s.name} up`}><ArrowUp size={17} /></button>
                            <button className="icon-btn" disabled={i === active.length - 1} onClick={() => moveSub(s, 1)} aria-label={`Move ${s.name} down`}><ArrowDown size={17} /></button>
                            <select aria-label={`Default group for ${s.name}`} className="input min-h-[40px] flex-1 py-1 text-sm" value={s.category} onChange={(e) => patchSub(s.id, { category: e.target.value as Category })}>
                              {CATEGORIES.map((x) => <option key={x} value={x}>{CATEGORY_LABEL[x]}</option>)}
                            </select>
                            <button className="icon-btn" onClick={() => patchSub(s.id, { archived: true })} aria-label={`Archive ${s.name}`} title="Archive"><Archive size={17} /></button>
                          </div>
                        </li>
                      ))}
                    </ul>
                    <button className="btn-ghost mt-2 text-primary" onClick={() => addSub(c)}><Plus size={16} aria-hidden /> Add sub-category</button>
                    {archived.length > 0 && (
                      <details className="mt-2">
                        <summary className="min-h-[36px] py-2 text-sm text-muted">Archived ({archived.length})</summary>
                        <ul className="grid gap-1">
                          {archived.map((s) => (
                            <li key={s.id} className="flex items-center justify-between rounded-lg bg-surface-2 pl-3">
                              <span className="text-sm text-muted">{s.name}</span>
                              <button className="icon-btn" onClick={() => patchSub(s.id, { archived: false })} aria-label={`Restore ${s.name}`}><ArchiveRestore size={17} /></button>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-4 text-sm text-muted">Archiving hides a sub-category from new entries. Past transactions and budgets keep it.</p>
          </Section>
        </div>

        <Section id="s-data" title="Backup and import" desc="Everything also syncs to your Firebase account. These files are for your own backups.">
          <div className="grid gap-2 sm:grid-cols-2">
            <button className="btn-outline" onClick={exportJSON}><Download size={16} aria-hidden /> Full backup (JSON)</button>
            <button className="btn-outline" onClick={exportTxCSV}><Download size={16} aria-hidden /> Transactions (CSV)</button>
            <button className="btn-outline" onClick={exportWishCSV}><Download size={16} aria-hidden /> Wishlist (CSV)</button>
            <button className="btn-outline" onClick={() => download("transactions-template.csv", SAMPLE_CSV, "text/csv")}><Download size={16} aria-hidden /> CSV template</button>
          </div>
          <div className="mt-4 grid gap-2 border-t border-line pt-4 sm:grid-cols-2">
            <button className="btn-outline" onClick={() => csvRef.current?.click()}><FileUp size={16} aria-hidden /> Import transactions CSV</button>
            <button className="btn-outline" onClick={() => jsonRef.current?.click()}><FileUp size={16} aria-hidden /> Restore JSON backup</button>
            <input ref={csvRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onCSV} />
            <input ref={jsonRef} type="file" accept=".json,application/json" className="hidden" onChange={onJSON} />
          </div>
          <p className="mt-2 text-xs text-muted">CSV columns: Date, Amount, Category, Sub-Category, Description, Notes. Imports add to what is already here.</p>
        </Section>

        <Section id="s-account" title="Account">
          <p className="text-sm text-muted">Signed in as</p>
          <p className="font-medium">{user?.email}</p>
          <p className="mt-3 text-sm text-muted">Your user ID (goes in firestore.rules)</p>
          <div className="mt-1 flex items-center gap-2">
            <code className="min-w-0 flex-1 select-all truncate rounded-lg bg-surface-2 px-3 py-2 text-sm">{user?.uid}</code>
            <button className="icon-btn" onClick={copyUid} aria-label="Copy user ID"><Copy size={17} /></button>
          </div>
          <div className="mt-6 border-t border-line pt-4">
            <button className="btn-outline text-bad" onClick={async () => (await confirm("Sign out?", "Your data stays in the cloud. Sign in again with the same Google account to see it.", "Sign out")) && signOut()}>
              <LogOut size={16} aria-hidden /> Sign out
            </button>
          </div>
        </Section>
      </div>

      {csvResult && (
        <Sheet
          title="Import transactions"
          onClose={() => setCsvResult(null)}
          footer={
            <div className="flex justify-end gap-2">
              <button className="btn-outline" onClick={() => setCsvResult(null)}>Cancel</button>
              <button className="btn-primary" disabled={!csvResult.ready.length} onClick={doCsvImport}>Import {csvResult.ready.length}</button>
            </div>
          }
        >
          <div className="space-y-3">
            <p><strong className="num">{csvResult.ready.length}</strong> rows are ready, totaling <strong className="num">{fmt(sum(csvResult.ready.map((t) => t.amount)))}</strong>.</p>
            {csvResult.newSubs.length > 0 && (
              <p className="text-sm text-muted">New sub-categories will be created: {csvResult.newSubs.map((s) => `${s.name} (${CATEGORY_LABEL[s.category]})`).join(", ")}.</p>
            )}
            {csvResult.errors.length > 0 && (
              <div className="rounded-xl bg-bad/10 p-3">
                <p className="mb-1 flex items-center gap-1.5 font-medium text-bad"><TriangleAlert size={16} aria-hidden /> {csvResult.errors.length} rows will be skipped</p>
                <ul className="max-h-48 overflow-y-auto text-sm">
                  {csvResult.errors.map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}
                </ul>
              </div>
            )}
          </div>
        </Sheet>
      )}
    </>
  );
}
