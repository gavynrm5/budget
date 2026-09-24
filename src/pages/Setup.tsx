import { useState } from "react";
import { Copy, ShieldAlert, Wrench } from "lucide-react";
import { signOut } from "../lib/firebase";

/** Shown when src/config/firebase.ts still has placeholder values. */
export function NotConfigured() {
  return (
    <main className="mx-auto max-w-xl p-6 pt-16">
      <div className="card p-6">
        <Wrench className="mb-3 text-primary" aria-hidden />
        <h1 className="text-2xl">Almost there: connect Firebase</h1>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-muted">
          <li>Create a Firebase project and a Web app (see README, step 1).</li>
          <li>Open <code className="rounded bg-surface-2 px-1.5">src/config/firebase.ts</code> and paste the config values.</li>
          <li>Save the file. The dev server reloads, or rebuild and redeploy.</li>
        </ol>
      </div>
    </main>
  );
}

/** Shown when Firestore rules deny access, usually because the owner UID is not set yet. */
export function AccessDenied({ uid, email }: { uid: string; email: string | null }) {
  const [copied, setCopied] = useState(false);
  return (
    <main className="mx-auto max-w-xl p-6 pt-16">
      <div className="card p-6">
        <ShieldAlert className="mb-3 text-warn" aria-hidden />
        <h1 className="text-2xl">This account cannot read the data yet</h1>
        <p className="mt-2 text-muted">
          You are signed in as <strong className="text-ink">{email}</strong>, but the Firestore security rules only allow the owner's user ID. If this is you, paste this ID into the rules (README, step 4) and publish them.
        </p>
        <div className="mt-4 flex items-center gap-2">
          <code className="min-w-0 flex-1 select-all break-all rounded-lg bg-surface-2 px-3 py-2 text-sm">{uid}</code>
          <button
            className="icon-btn"
            aria-label="Copy user ID"
            onClick={() => navigator.clipboard.writeText(uid).then(() => setCopied(true)).catch(() => {})}
          >
            <Copy size={18} />
          </button>
        </div>
        {copied && <p className="mt-1 text-sm text-good" role="status">Copied</p>}
        <div className="mt-6 flex gap-2">
          <button className="btn-primary" onClick={() => location.reload()}>I updated the rules, reload</button>
          <button className="btn-outline" onClick={() => signOut()}>Use another account</button>
        </div>
      </div>
    </main>
  );
}
