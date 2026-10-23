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
export function Page({ title, sub, actions, children }: { title: string; sub?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <header className="page-head">
        <div>
          <h1>{title}</h1>
          {sub && <p className="sub">{sub}</p>}
        </div>
        <div className="row wrap">{actions}</div>
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
export function Chip({ value, tone, icon }: { value: string; tone?: 'ok' | 'warn' | 'bad' | 'info' | 'plain'; icon?: IconName }) {
  const t = tone ?? toneFor(value);
  return (
    <span className={`chip ${t}`}>
      {icon && <Icon name={icon} />}
      {value.replace(/_/g, ' ')}
    </span>
  );
}
function toneFor(v: string): 'ok' | 'warn' | 'bad' | 'info' {
  if (['active', 'verified', 'resolved', 'published', 'approved', 'completed', 'confirmed'].includes(v)) return 'ok';
  if (['pending', 'open', 'in_review', 'full', 'planning', 'unverified'].includes(v)) return 'warn';
  if (['suspended', 'rejected', 'cancelled', 'physical_safety', 'underage', 'dismissed'].includes(v)) return 'bad';
  return 'info';
}

export const fmt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '-';

// ---------------------------------------------------------------- icons and small shared pieces
const ICONS = {
  overview: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
  shield: 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6zM9 12l2 2 4-4',
  flag: 'M5 21V4h12l-2 4 2 4H5',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  users: 'M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 20v-1.5a4 4 0 0 0-3-3.9M16 4.2a3.5 3.5 0 0 1 0 6.6',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  chevron: 'm6 9 6 6 6-6',
  refresh: 'M21 12a9 9 0 0 1-15.5 6.2M3 12A9 9 0 0 1 18.5 5.8M18 2v4h-4M6 22v-4h4',
  lock: 'M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5z',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7',
  alert: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  copy: 'M9 9h11v11H9zM5 15V5a1 1 0 0 1 1-1h10',
  plane: 'M21 3L3 10.5l7 3 3 7zM10 13.5L21 3',
  plus: 'M12 5v14M5 12h14',
} as const;
export type IconName = keyof typeof ICONS;
export const Icon = ({ name }: { name: IconName }) => (
  <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d={ICONS[name]} />
  </svg>
);

export const Avatar = ({ name, size }: { name?: string | null; size?: 'sm' | 'lg' }) => (
  <span className={`avatar ${size ?? ''}`} aria-hidden="true">
    {(name?.trim()[0] ?? '?').toUpperCase()}
  </span>
);

/** cmvgg3ymx000xyz86rh -> cmvgg3ymx000…86rh: ids stay recognisable without filling the row. */
export const shortId = (id?: string | null) => (!id ? 'system' : id.length > 18 ? `${id.slice(0, 12)}…${id.slice(-4)}` : id);

export const Search = ({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) => (
  <label className="search grow">
    <span className="sr">{label}</span>
    <Icon name="search" />
    <input type="search" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
  </label>
);

/** A row of buttons that acts like tabs, e.g. All / Active / Suspended. */
export function Segmented<T extends string>({ options, value, onChange, label }: { options: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" className={value === o.id ? 'seg active' : 'seg'} aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
          {!!o.count && <span className="count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** The "..." button on a row, with its actions in a small menu. */
export function RowMenu({ label, items }: { label: string; items: { label: string; danger?: boolean; onSelect: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  if (items.length === 0) return null;
  return (
    <span className="menu-wrap" ref={ref}>
      <button className="icon-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="more" />
      </button>
      {open && (
        <div className="menu" role="menu">
          {items.map((i) => (
            <button key={i.label} role="menuitem" className={i.danger ? 'danger' : ''} onClick={() => (setOpen(false), i.onSelect())}>
              {i.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/** Pages of 10 with "Showing 1-10 of 35" and Previous / Next. */
export function usePages<T>(items: T[], resetKey: string, size = 10) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [resetKey]);
  const last = Math.max(0, Math.ceil(items.length / size) - 1);
  const p = Math.min(page, last);
  const from = p * size;
  const shown = items.slice(from, from + size);
  const foot = items.length > 0 && (
    <div className="table-foot">
      <span className="muted small">
        Showing {from + 1}–{from + shown.length} of {items.length}
      </span>
      {items.length > size && (
        <div className="row">
          <button className="btn small" disabled={p === 0} onClick={() => setPage(p - 1)}>
            Previous
          </button>
          <button className="btn small primary" disabled={p === last} onClick={() => setPage(p + 1)}>
            Next
          </button>
        </div>
      )}
    </div>
  );
  return { shown, foot };
}
