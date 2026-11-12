import { Component, type ErrorInfo, type ReactNode } from "react";

const RELOADED_KEY = "reloaded-for-update";
// After a new version is published, a page the open app hasn't loaded yet may no longer exist on the server.
const isStaleChunk = (e: Error) => /dynamically imported module|Importing a module script failed|Loading chunk/i.test(e.message);

/**
 * Catches errors while drawing a screen, so one broken screen shows a message
 * with a way out instead of a blank app. When the cause is a page from an
 * older version that can no longer be fetched, it reloads once to pick up the
 * new version.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
    if (!isStaleChunk(error)) return;
    try {
      if (sessionStorage.getItem(RELOADED_KEY)) return; // already tried; show the message instead of looping
      sessionStorage.setItem(RELOADED_KEY, "1");
    } catch {
      return;
    }
    location.reload();
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    // Moving to another page clears the error.
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isStaleChunk(error);
    return (
      <div role="alert" className="card mx-auto mt-10 max-w-md p-6 text-center">
        <h1 className="text-xl">{stale ? "A new version is ready" : "Something went wrong on this screen"}</h1>
        <p className="mt-2 text-sm text-muted">
          {stale ? "Reload to finish updating." : "Your data is safe. Reload the app, or go to another page."}
        </p>
        {!stale && <p className="mt-2 break-words font-mono text-xs text-muted">{error.message}</p>}
        <button className="btn-primary mt-4" onClick={() => location.reload()}>Reload</button>
      </div>
    );
  }
}
