import { Component, type ReactNode } from 'react';

const KEY = 'ht_admin_crash_reload';

/**
 * If a screen ever fails to draw, React would otherwise leave the page completely white until the person reloads by hand.
 * This tries one automatic reload (a reload always works, it is the fix people were finding themselves), and if the same
 * thing fails again right after, shows a message with a button instead of a blank page.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error('The console failed to draw', error);
    try {
      const last = Number(sessionStorage.getItem(KEY) ?? 0);
      if (Date.now() - last > 15_000) {
        sessionStorage.setItem(KEY, String(Date.now()));
        window.location.reload();
      }
    } catch {
      /* storage unavailable: the message below is shown instead */
    }
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="crash" role="alert">
        <div>
          <h1>This page did not load</h1>
          <p>Something went wrong while drawing the console. Your work is safe. Reload to carry on.</p>
          <button className="btn primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
