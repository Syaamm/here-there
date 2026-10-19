import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from './api';

// ---------------------------------------------------------------- navigation (hash router)
export const go = (path: string) => {
  location.hash = '#' + path;
};
export const back = (fallback = '/') => (history.length > 1 ? history.back() : go(fallback));

// ---------------------------------------------------------------- data loading
export const errMsg = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong');

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[], pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const reload = useCallback(() => {
    const id = ++seq.current;
    setLoading(true);
    fn()
      .then((d) => id === seq.current && (setData(d), setError(null)))
      .catch((e) => id === seq.current && setError(e))
      .finally(() => id === seq.current && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(reload, [reload]);
  useEffect(() => {
    if (!pollMs) return;
    // don't poll while the tab is in the background
    const t = setInterval(() => document.visibilityState === 'visible' && reload(), pollMs);
    return () => clearInterval(t);
  }, [reload, pollMs]);
  return { data, error, loading, reload };
}

/** Runs a mutation, keeps the error for display, then runs `after`. */
export function useAction(after?: () => void) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async <T,>(fn: () => Promise<T>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      after?.();
      return r;
    } catch (e) {
      setError(errMsg(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { run, error, busy, setError };
}

// ---------------------------------------------------------------- formatting
export function when(iso: string) {
  const d = new Date(iso);
  const day0 = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day0(d) - day0(new Date())) / 864e5);
  const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diff === 0) return `Today ${t}`;
  if (diff === 1) return `Tomorrow ${t}`;
  return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${t}`;
}
export const timeRange = (a: string, b: string) => {
  const f = (x: string) => new Date(x).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${when(a)}–${f(b)}`;
};
export const ago = (iso: string) => {
  const m = Math.round((Date.now() - +new Date(iso)) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
};

// ---------------------------------------------------------------- building blocks
export function TopBar({ title, right, onBack }: { title: string; right?: ReactNode; onBack?: () => void }) {
  return (
    <header className="topbar">
      <button className="icon-btn" onClick={onBack ?? (() => back())} aria-label="Go back">
        ‹
      </button>
      <h1>{title}</h1>
      <div className="topbar-right">{right}</div>
    </header>
  );
}

export const ErrorBanner = ({ message }: { message?: string | null }) =>
  message ? (
    <p role="alert" className="banner error">
      {message}
    </p>
  ) : null;

export const Empty = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div className="empty">
    <strong>{title}</strong>
    {children && <p>{children}</p>}
  </div>
);

export const Spinner = ({ label = 'Loading…' }: { label?: string }) => (
  <p className="muted center" role="status">
    {label}
  </p>
);

export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'bad' }) {
  return <span className={`chip ${tone}`}>{children}</span>;
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="sheet-title"
      onCancel={(e) => (e.preventDefault(), onClose())}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <div className="sheet-body">
        <h2 id="sheet-title">{title}</h2>
        {children}
      </div>
    </dialog>
  );
}

/** Generic ··· action menu. */
export function Menu({ items }: { items: { label: string; onSelect: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="icon-btn" onClick={() => setOpen(true)} aria-label="More options" aria-haspopup="dialog">
        ⋯
      </button>
      {open && (
        <Sheet title="Options" onClose={() => setOpen(false)}>
          <div className="stack">
            {items.map((i) => (
              <button
                key={i.label}
                className={i.danger ? 'btn danger block' : 'btn block'}
                onClick={() => {
                  setOpen(false);
                  i.onSelect();
                }}
              >
                {i.label}
              </button>
            ))}
            <button className="btn ghost block" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
