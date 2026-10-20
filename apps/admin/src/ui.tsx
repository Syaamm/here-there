import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from './api';

// ---------------------------------------------------------------- data loading
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const reload = useCallback(() => {
    const id = ++seq.current;
    setLoading(true);
    fn()
      .then((d) => id === seq.current && (setData(d), setError(null)))
      .catch((e) => id === seq.current && setError(errMsg(e)))
      .finally(() => id === seq.current && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(reload, [reload]);
  return { data, error, loading, reload };
}

export const errMsg = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong');

/** Runs a mutation, surfaces errors, then refreshes. */
export function useAction(after: () => void) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      after();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return { run, error, busy, clear: () => setError(null) };
}

// ---------------------------------------------------------------- reason dialog
type Ask = { title: string; label: string; confirm: string; required: boolean; choices?: [string, string][]; resolve: (v: string | null) => void };
let openAsk: ((a: Ask) => void) | null = null;

/** Promise-based replacement for window.prompt. Resolves null when cancelled. */
export function askText(title: string, opts: { label?: string; confirm?: string; required?: boolean; choices?: [string, string][] } = {}) {
  return new Promise<string | null>((resolve) => {
    if (!openAsk) return resolve(null);
    openAsk({ title, label: opts.label ?? 'Reason (kept in the audit log)', confirm: opts.confirm ?? 'Confirm', required: opts.required ?? true, choices: opts.choices, resolve });
  });
}

/** Like askText, but the person must also pick one of `choices`. Resolves null when cancelled. */
export async function askChoiceText(title: string, choices: [string, string][], opts: { label?: string; confirm?: string } = {}) {
  const r = await askText(title, { ...opts, choices });
  if (r === null) return null;
  const i = r.indexOf('|');
  return { choice: r.slice(0, i), text: r.slice(i + 1) };
}

export function DialogHost() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [value, setValue] = useState('');
  const [choice, setChoice] = useState('');
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    openAsk = (a) => {
      setValue('');
      setChoice(a.choices?.[0]?.[0] ?? '');
      setAsk(a);
    };
    return () => {
      openAsk = null;
    };
  }, []);
  useEffect(() => {
    if (ask) ref.current?.showModal();
  }, [ask]);

  const close = (v: string | null) => {
    ref.current?.close();
    ask?.resolve(v);
    setAsk(null);
  };
  const tooShort = ask?.required && value.trim().length < 3;

  if (!ask) return null;
  return (
    <dialog ref={ref} className="dialog" onCancel={(e) => (e.preventDefault(), close(null))} aria-labelledby="dlg-title">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!tooShort) close(ask.choices ? `${choice}|${value.trim()}` : value.trim());
        }}
      >
        <h2 id="dlg-title">{ask.title}</h2>
        {ask.choices && (
          <label>
            Reason
            <select value={choice} onChange={(e) => setChoice(e.target.value)}>
              {ask.choices.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          {ask.label}
          <textarea autoFocus rows={3} value={value} onChange={(e) => setValue(e.target.value)} maxLength={500} />
        </label>
        <div className="row end">
          <button type="button" className="btn" onClick={() => close(null)}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={tooShort}>
            {ask.confirm}
          </button>
        </div>
      </form>
    </dialog>
  );
}

// ---------------------------------------------------------------- small pieces
export function Page({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <header className="page-head">
        <h1>{title}</h1>
        <div className="row">{actions}</div>
      </header>
      {children}
    </section>
  );
}

export const ErrorBanner = ({ message }: { message: string | null }) =>
  message ? (
    <p role="alert" className="banner error">
      {message}
    </p>
  ) : null;

export const Empty = ({ children }: { children: ReactNode }) => <p className="empty">{children}</p>;

/** Status chips always carry a text label, never colour alone. */
export function Chip({ value, tone }: { value: string; tone?: 'ok' | 'warn' | 'bad' | 'info' }) {
  const t = tone ?? toneFor(value);
  return <span className={`chip ${t}`}>{value.replace(/_/g, ' ')}</span>;
}
function toneFor(v: string): 'ok' | 'warn' | 'bad' | 'info' {
  if (['active', 'verified', 'resolved', 'published', 'approved', 'completed', 'confirmed'].includes(v)) return 'ok';
  if (['pending', 'open', 'in_review', 'full', 'planning', 'unverified'].includes(v)) return 'warn';
  if (['suspended', 'rejected', 'cancelled', 'physical_safety', 'underage', 'dismissed'].includes(v)) return 'bad';
  return 'info';
}

export const fmt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '-';
