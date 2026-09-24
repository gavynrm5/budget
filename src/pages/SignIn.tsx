import { useState } from "react";
import { signInWithGoogle } from "../lib/firebase";

export default function SignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const go = async () => {
    setBusy(true);
    setError("");
    try {
      await signInWithGoogle();
    } catch (e) {
      const code = (e as { code?: string }).code ?? "";
      setError(
        code === "auth/unauthorized-domain"
          ? "This web address is not on the Firebase authorized domains list. Add it in Firebase console > Authentication > Settings > Authorized domains."
          : code === "auth/network-request-failed"
            ? "No connection. Sign in once while online; after that the app works offline."
            : `Sign-in failed (${code || (e as Error).message}). Try again.`
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm text-center">
        <img src="./icons/favicon.svg" alt="" className="mx-auto mb-6 h-16 w-16" />
        <h1 className="text-3xl">Pay Period Budget</h1>
        <p className="mt-2 text-muted">Your budget, 15th to 14th, on every device.</p>
        <button className="btn-outline mt-8 w-full py-3 text-base" onClick={go} disabled={busy} aria-busy={busy}>
          <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
            <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
          </svg>
          {busy ? "Opening Google..." : "Sign in with Google"}
        </button>
        {error && <p role="alert" className="mt-4 text-sm text-bad">{error}</p>}
      </div>
    </main>
  );
}
