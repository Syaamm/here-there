import { createPortal } from 'react-dom';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { ApiError, BASE, getImage } from './api';
import { Select, useBackdropClose } from './controls';

// ---------------------------------------------------------------- data loading
/**
 * The last answer of every list or page this session, so going back to a page shows it at once (no loading skeleton, no
 * second entrance animation) while it is fetched again quietly. Keyed by what is loaded and its inputs. Emptied on sign-out.
 */
const loadCache = new Map<string, unknown>();
export const clearLoadCache = () => loadCache.clear();
/**
 * When a list or page was last shown from memory. A page drawn in the same moment (the same render) opened from memory: it
 * keeps its content's entrance animations off for as long as it is on screen (Page, `.page-body.from-cache`), so a page seen
 * before simply fades in as one. (Switching them off only for a moment made every animation play again when it ended.)
 */
let cacheHitAt = -Infinity;
const markFromCache = () => void (cacheHitAt = performance.now());
export const openedFromCache = () => performance.now() - cacheHitAt < 120;

/** pollMs: look again every so often while the page is open and visible, so new entries appear without a manual refresh. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[], pollMs?: number) {
  const key = fn.toString() + '|' + JSON.stringify(deps);
  const [data, setData] = useState<T | null>(() => {
    const hit = loadCache.get(key) as T | undefined;
    if (hit === undefined) return null;
    markFromCache();
    return hit;
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  // inputs changed (a filter, a date range): show what was loaded for them before, if anything, while asking again
  const lastKey = useRef(key);
  if (lastKey.current !== key) {
    lastKey.current = key;
    const hit = loadCache.get(key) as T | undefined;
    if (hit !== undefined && hit !== data) setData(hit);
  }

  /** Loads again; the promise settles when the answer is on screen (a Refresh button waits for it). Never rejects. */
  const reload = useCallback(() => {
    const id = ++seq.current;
    setLoading(true);
    return fn()
      .then((d) => {
        if (loadCache.size > 80) loadCache.delete(loadCache.keys().next().value as string);
        loadCache.set(key, d);
        if (id === seq.current) (setData(d), setError(null));
      })
      .catch((e) => void (id === seq.current && setError(errMsg(e))))
      .finally(() => id === seq.current && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => void reload(), [reload]);
  useEffect(() => {
    if (!pollMs) return;
    const t = setInterval(() => !document.hidden && reload(), pollMs);
    return () => clearInterval(t);
  }, [reload, pollMs]);
  return { data, error, loading, reload };
}

/**
 * A list that goes on past its first page. `first` is the page the screen already loads (and keeps fresh); "Load more"
 * fetches the pages after it with the cursor the server sent and adds them below. `reset` drops the extra pages (after an
 * action, so rows that just changed are read again); a new `resetKey` (a different filter) does the same.
 */
export function useMore<I extends { id: string }>(first: { items: I[]; nextCursor?: string | null } | null, fetchPage: (cursor: string) => Promise<{ items: I[]; nextCursor?: string | null }>, resetKey: string) {
  const [extra, setExtra] = useState<I[]>([]);
  const [tail, setTail] = useState<string | null | undefined>(undefined); // undefined: nothing extra loaded yet
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reset = useCallback(() => (setExtra([]), setTail(undefined), setError(null)), []);
  useEffect(reset, [resetKey, reset]);
  const cursor = tail === undefined ? (first?.nextCursor ?? null) : tail;
  const seen = new Set((first?.items ?? []).map((i) => i.id));
  const items = [...(first?.items ?? []), ...extra.filter((i) => !seen.has(i.id))];
  const loadMore = async () => {
    if (!cursor || busy) return;
    setBusy(true);
    try {
      const r = await fetchPage(cursor);
      setExtra((x) => [...x, ...r.items]);
      setTail(r.nextCursor ?? null);
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const more = cursor ? (
    <div className="row end" style={{ marginTop: 12 }}>
      {error && <span className="small muted">{error}</span>}
      <button className="btn" disabled={busy} onClick={loadMore}>
        {busy ? 'Loading…' : 'Load more'}
      </button>
    </div>
  ) : null;
  return { items, hasMore: !!cursor, more, reset };
}

// ---------------------------------------------------------------- numbers that count
const lessMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
/**
 * A number that counts up to its value when it first shows, and counts on from the old value when it changes (after a
 * refresh), over about half a second. With "reduce motion" switched on it simply shows the number.
 */
export function CountUp({ value, ms = 650 }: { value: number; ms?: number }) {
  // a page opened from memory shows its numbers as they are (they counted up the first time)
  const [shown, setShown] = useState(() => (lessMotion() || openedFromCache() ? value : 0));
  const now = useRef(shown);
  useEffect(() => {
    if (lessMotion()) {
      now.current = value;
      setShown(value);
      return;
    }
    const from = now.current;
    if (from === value) return;
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const v = Math.round(from + (value - from) * (1 - Math.pow(1 - k, 3))); // eases out: fast first, settling at the end
      now.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return <>{shown.toLocaleString()}</>;
}

// ---------------------------------------------------------------- where you are, kept in the address
// The address is `/admin/section/tab?name=value` (no "#"): the part after "?" holds what is open on the page (the selected report
// or person, the filter), so reloading the page comes back to exactly the same place. Written with replaceState: Back still
// moves between pages, not between every row clicked.
export const urlParam = (name: string) => new URLSearchParams(window.location.search).get(name);
export function setUrlParam(name: string, value: string | null) {
  const params = new URLSearchParams(window.location.search);
  if (value) params.set(name, value);
  else params.delete(name);
  const q = params.toString();
  try {
    window.history.replaceState(window.history.state, '', window.location.pathname + (q ? '?' + q : ''));
  } catch {
    /* history unavailable: the page still works, a reload just starts fresh */
  }
}
/** Like useState, but the value is kept in the address, so a page reload keeps it. */
export function useUrlParam<T extends string>(name: string, fallback: T | null = null) {
  const [value, setValue] = useState<T | null>(() => (urlParam(name) as T | null) ?? fallback);
  const set = useCallback(
    (next: T | null) => {
      setValue(next);
      setUrlParam(name, next === fallback ? null : next);
    },
    [name, fallback],
  );
  return [value, set] as const;
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
type Ask = { title: string; label: string; confirm: string; required: boolean; choices?: [string, string][]; choiceLabel?: string; resolve: (v: string | null) => void };
let openAsk: ((a: Ask) => void) | null = null;

/** Promise-based replacement for window.prompt. Resolves null when cancelled. */
export function askText(title: string, opts: { label?: string; confirm?: string; required?: boolean; choices?: [string, string][]; choiceLabel?: string } = {}) {
  return new Promise<string | null>((resolve) => {
    if (!openAsk) return resolve(null);
    openAsk({ title, label: opts.label ?? 'Reason', confirm: opts.confirm ?? 'Confirm', required: opts.required ?? true, choices: opts.choices, choiceLabel: opts.choiceLabel, resolve });
  });
}

/** Like askText, but the person must also pick one of `choices`. Resolves null when cancelled. */
export async function askChoiceText(title: string, choices: [string, string][], opts: { label?: string; confirm?: string; choiceLabel?: string; required?: boolean } = {}) {
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
  const backdrop = useBackdropClose(ref, () => close(null)); // a click on the dark area closes it, like Cancel

  if (!ask) return null;
  return (
    <dialog ref={ref} className="dialog" onCancel={(e) => (e.preventDefault(), close(null))} aria-labelledby="dlg-title" {...backdrop}>
      {/* the label defaults to "Reason" (it is kept in the audit log either way) */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!tooShort) close(ask.choices ? `${choice}|${value.trim()}` : value.trim());
        }}
      >
        <h2 id="dlg-title">{ask.title}</h2>
        {ask.choices && (
          <label>
            {ask.choiceLabel ?? 'Reason'}
            <Select value={choice} onChange={setChoice}>
              {ask.choices.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
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
/**
 * Set by the shell for sections with tabs (Reports, Users, Team, Settings): the section's title wins over the page's own,
 * and the tab bar is drawn under the heading.
 */
export const PageMeta = createContext<{ eyebrow?: string; title?: string; tabs?: ReactNode }>({});

/**
 * The heading and tab bar of a section with tabs (Reports: Reports / Appeals / Attendance), built ONCE for the section. Moving
 * between its tabs swaps only the page underneath: the heading and the tabs stay exactly where they are. Each tab's own page
 * (Page below) sees it and then draws only its body, sending its action buttons up into the heading's right side.
 */
const FrameContext = createContext<{ slot: HTMLElement | null } | null>(null);
export function PageFrame({ eyebrow, title, tabs, children }: { eyebrow?: string; title: string; tabs?: ReactNode; children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const value = useMemo(() => ({ slot }), [slot]);
  return (
    <section className="page">
      <header className="page-head">
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h1>{title}</h1>
        </div>
        <div className="row wrap" ref={setSlot} />
      </header>
      {tabs}
      <FrameContext.Provider value={value}>{children}</FrameContext.Provider>
    </section>
  );
}

/** Every page: the small group label, the title, optional actions on the right, then the body. `sub` is accepted but not shown. */
export function Page({ title, actions, children, fill }: { title: string; sub?: ReactNode; actions?: ReactNode; children: ReactNode; fill?: boolean }) {
  const meta = useContext(PageMeta);
  const frame = useContext(FrameContext);
  // decided once, when the page appears: opened from memory = shown as it is, no second round of entrance animations
  const [cached] = useState(openedFromCache);
  // inside a section's frame: the heading and tabs are already on screen, so only the body is drawn (and the actions are sent up)
  if (frame)
    return (
      <>
        {frame.slot && actions ? createPortal(actions, frame.slot) : null}
        <div className={`page-body${fill ? ' fill' : ''}${cached ? ' from-cache' : ''}`}>{children}</div>
      </>
    );
  return (
    <section className="page">
      <header className="page-head">
        <div>
          {meta.eyebrow && <p className="eyebrow">{meta.eyebrow}</p>}
          <h1>{meta.title ?? title}</h1>
        </div>
        <div className="row wrap">{actions}</div>
      </header>
      {meta.tabs}
      <div className={`page-body${fill ? ' fill' : ''}${cached ? ' from-cache' : ''}`}>{children}</div>
    </section>
  );
}

/**
 * A Refresh button that shows it worked: the arrows turn while the page's data is fetched again (never the whole page),
 * then "Updated" with the time. `busy` is for the page, to dim its content meanwhile (useRefresh below).
 */
export function useRefresh(load: () => Promise<unknown>) {
  const [busy, setBusy] = useState(false);
  const [at, setAt] = useState<Date | null>(null);
  const [fresh, setFresh] = useState(false); // "Updated" stands out for a moment, then stays as a quiet time
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    // at least a short turn of the arrows, so a fast answer is still seen to happen
    await Promise.all([load(), new Promise((r) => setTimeout(r, 600))]);
    setBusy(false);
    setAt(new Date());
    setFresh(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setFresh(false), 2500);
  };
  return { busy, at, fresh, run };
}

export function RefreshButton({ r }: { r: ReturnType<typeof useRefresh> }) {
  // 12-hour clock, hours and minutes only (e.g. 2:32 PM)
  const time = r.at?.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return (
    <span className="refresh">
      <span className={r.fresh ? 'refresh-note fresh' : 'refresh-note'} role="status" aria-live="polite">
        {r.busy ? 'Refreshing…' : r.at ? (
          <>
            {r.fresh && <Icon name="check" />}
            Updated {time}
          </>
        ) : null}
      </span>
      <button className={r.busy ? 'icon-btn refresh-btn busy' : 'icon-btn refresh-btn'} onClick={() => void r.run()} disabled={r.busy} aria-label="Refresh" title="Refresh">
        <Icon name="refresh" />
      </button>
    </span>
  );
}

/** Underlined tabs, e.g. Reports / Appeals / No-shows. */
export function Tabs<T extends string>({ options, value, onChange, label }: { options: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="page-tabs" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={value === o.id} className={value === o.id ? 'tab active' : 'tab'} onClick={() => onChange(o.id)}>
          {o.label}
          {!!o.count && <span className="count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export const ErrorBanner = ({ message, onRetry }: { message: string | null; onRetry?: () => void }) =>
  message ? (
    <p role="alert" className="banner error">
      {message}
      {onRetry && (
        <button type="button" className="link" onClick={onRetry}>
          Try again
        </button>
      )}
    </p>
  ) : null;

/** The same empty state on every page: what is missing, and optionally what to do about it. */
export const Empty = ({ children, title }: { children: ReactNode; title?: string }) => (
  <div className="state">
    {title && <strong>{title}</strong>}
    <p>{children}</p>
  </div>
);

/** The same loading state on every page. `rows` > 0 draws grey placeholder lines instead of a spinner. */
export const Loading = ({ label = 'Loading…', rows = 0 }: { label?: string; rows?: number }) =>
  rows > 0 ? (
    <div className="skeleton" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <i key={i} />
      ))}
    </div>
  ) : (
    <div className="state" role="status">
      <span className="spinner" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );

/**
 * Status chips always carry a text label. Tones: ok = green, dark = needs attention (urgent, overdue, suspended),
 * line = waiting (outlined), plain = everything else. The old names still work: warn -> line, bad -> dark, info -> plain.
 */
export type Tone = 'ok' | 'dark' | 'line' | 'plain' | 'warn' | 'bad' | 'info';
/** The proof photos sent with an appeal or a dispute (a screenshot of a chat, say). Click one to open it full size in a new tab. */
export function ProofImages({ ids }: { ids?: string[] }) {
  const [urls, setUrls] = useState<(string | null)[]>([]);
  useEffect(() => {
    let alive = true;
    const made: string[] = [];
    setUrls([]);
    (ids ?? []).forEach((id, i) =>
      getImage(`/v1/proofs/${id}`)
        .then((u) => {
          if (!alive) return URL.revokeObjectURL(u);
          made.push(u);
          setUrls((list) => Object.assign([...list], { [i]: u }));
        })
        .catch(() => alive && setUrls((list) => Object.assign([...list], { [i]: null }))),
    );
    return () => {
      alive = false;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [(ids ?? []).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ids?.length) return null;
  return (
    <div className="proofs">
      <span className="small muted">Photos sent as proof ({ids.length})</span>
      <div className="proof-row">
        {ids.map((id, i) =>
          urls[i] ? (
            <a key={id} href={urls[i]!} target="_blank" rel="noreferrer" title="Open full size">
              <img src={urls[i]!} alt={`Proof photo ${i + 1}`} />
            </a>
          ) : (
            <span key={id} className="proof-ph small muted">
              {urls[i] === null ? 'Could not load' : 'Loading…'}
            </span>
          ),
        )}
      </div>
    </div>
  );
}

export function Chip({ value, tone, icon }: { value: string; tone?: Tone; icon?: IconName }) {
  const t = { warn: 'line', bad: 'dark', info: 'plain' }[tone as string] ?? tone ?? toneFor(value);
  return (
    <span className={`chip ${t}`}>
      {icon && <Icon name={icon} />}
      {value.replace(/_/g, ' ')}
    </span>
  );
}
function toneFor(v: string): Tone {
  if (['active', 'verified', 'resolved', 'published', 'approved', 'completed', 'confirmed'].includes(v)) return 'ok';
  if (['pending', 'open', 'in_review', 'full', 'planning', 'unverified'].includes(v)) return 'line';
  if (['suspended', 'banned', 'urgent', 'physical_safety', 'immediate_danger', 'underage'].includes(v)) return 'dark';
  return 'plain';
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
  back: 'M19 12H5M11 6l-6 6 6 6',
  panelLeft: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM9 5v14',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  copy: 'M9 9h11v11H9zM5 15V5a1 1 0 0 1 1-1h10',
  plane: 'M21 3L3 10.5l7 3 3 7zM10 13.5L21 3',
  plus: 'M12 5v14M5 12h14',
  menu: 'M4 7h16M4 12h16M4 17h16',
  userPlus: 'M15 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19 8v6M16 11h6',
  bell: 'M6 9a6 6 0 1 1 12 0c0 5 2 6 2 7H4c0-1 2-2 2-7zM10 20a2 2 0 0 0 4 0',
  key: 'M21 2l-2 2m-7.6 7.6a5 5 0 1 1-7 7 5 5 0 0 1 7-7zM11.4 11.6L15.5 7.5M18 5l3 3-3 3-3-3',
  settings: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M18 16v4',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  eye: 'M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18M10.6 6.2A9.9 9.9 0 0 1 12 6c5 0 8.5 4.2 9.5 6a11 11 0 0 1-2.6 3.1M6.3 7.6A11 11 0 0 0 2.5 12c1 1.8 4.5 6 9.5 6 1.5 0 2.8-.4 4-1M9.9 9.9a3 3 0 0 0 4.2 4.2',
} as const;
export type IconName = keyof typeof ICONS;
export const Icon = ({ name }: { name: IconName }) => (
  <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d={ICONS[name]} />
  </svg>
);

/** The person's picture when they have one (the small 96 / 192 pixel versions keep lists light), otherwise their first letter. */
export function Avatar({ name, size, photo }: { name?: string | null; size?: 'sm' | 'lg' | 'xl'; photo?: string | null }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photo]);
  const px = size === 'xl' ? 192 : 96;
  const src = photo && !failed ? BASE + (photo.includes('/photo') ? photo.replace(/([?&])v=/, `$1s=${px}&v=`) : photo) : null;
  return (
    <span className={`avatar ${size ?? ''} ${src ? 'photo' : ''}`} aria-hidden="true">
      {src ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} /> : (name?.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

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
  const ref = useRef<HTMLDivElement>(null);
  // the green pill slides to the chosen option (measured, so it fits any label and wraps with the row)
  const [pill, setPill] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [moves, setMoves] = useState(false); // no slide on the very first show
  const measure = useCallback(() => {
    const el = ref.current?.querySelector<HTMLElement>('.seg.active');
    setPill(el ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : null);
  }, []);
  useLayoutEffect(measure, [measure, value, options.map((o) => `${o.id}${o.label}${o.count ?? ''}`).join('|')]);
  useEffect(() => {
    const t = setTimeout(() => setMoves(true), 50);
    const ro = typeof ResizeObserver !== 'undefined' && ref.current ? new ResizeObserver(measure) : null;
    if (ro && ref.current) ro.observe(ref.current);
    return () => {
      clearTimeout(t);
      ro?.disconnect();
    };
  }, [measure]);
  return (
    <div ref={ref} className={pill ? (moves ? 'segmented has-pill moves' : 'segmented has-pill') : 'segmented'} role="group" aria-label={label}>
      {pill && <span className="seg-pill" aria-hidden="true" style={{ width: pill.w, height: pill.h, transform: `translate(${pill.x}px, ${pill.y}px)` }} />}
      {options.map((o) => (
        <button key={o.id} type="button" className={value === o.id ? 'seg active' : 'seg'} aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
          {!!o.count && <span className="count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

type MenuItem = { label: string; danger?: boolean; onSelect: () => void };

/**
 * A button that opens a small menu. The menu is placed with `position: fixed` next to the button, so a scrolling card
 * never clips it; it closes on Escape, on a click elsewhere, and when anything scrolls. Arrow keys move through it.
 */
export function PopMenu({ trigger, label, items, header, align = 'end', buttonClass = 'icon-btn' }: { trigger: ReactNode; label: string; items: MenuItem[]; header?: ReactNode; align?: 'start' | 'end'; buttonClass?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const close = (refocus = false) => (setOpen(false), refocus && btn.current?.focus());
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const w = list.current?.offsetWidth ?? 220;
    const h = list.current?.offsetHeight ?? 200;
    const left = Math.max(8, Math.min(align === 'end' ? r.right - w : r.left, window.innerWidth - w - 8));
    const top = r.bottom + 6 + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : r.bottom + 6;
    setPos({ top, left });
    list.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [open, align]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && !list.current?.contains(e.target as Node) && setOpen(false);
    const gone = () => setOpen(false);
    document.addEventListener('mousedown', away);
    window.addEventListener('resize', gone);
    window.addEventListener('scroll', gone, true);
    return () => {
      document.removeEventListener('mousedown', away);
      window.removeEventListener('resize', gone);
      window.removeEventListener('scroll', gone, true);
    };
  }, [open]);
  const keys = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') return (e.preventDefault(), close(true));
    if (e.key === 'Tab') return setOpen(false);
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const all = [...(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
  };
  if (items.length === 0) return null;
  return (
    <span className="menu-wrap" ref={wrap}>
      <button ref={btn} className={buttonClass} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => (setPos(null), setOpen(!open))}>
        {trigger}
      </button>
      {open && (
        <div ref={list} className="menu" role="menu" onKeyDown={keys} style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: 'hidden' }}>
          {header && <div className="menu-info">{header}</div>}
          {items.map((i) => (
            <button key={i.label} role="menuitem" className={i.danger ? 'danger' : ''} onClick={() => (close(true), i.onSelect())}>
              {i.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/** The "..." button on a row, with its actions in a small menu. */
export const RowMenu = ({ label, items }: { label: string; items: MenuItem[] }) => <PopMenu label={label} items={items} trigger={<Icon name="more" />} />;

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
        {from + 1}–{from + shown.length} of {items.length}
      </span>
      {items.length > size && (
        <div className="row">
          <button className="btn small" disabled={p === 0} onClick={() => setPage(p - 1)}>
            Previous
          </button>
          <button className="btn small" disabled={p === last} onClick={() => setPage(p + 1)}>
            Next
          </button>
        </div>
      )}
    </div>
  );
  return { shown, foot };
}

/** "Page 1 / 10" with Previous / Next, for lists the server pages by number (one small page is read at a time). */
export function PageBar({ page, pages, total, noun, onPage, busy }: { page: number; pages: number; total: number; noun: [string, string]; onPage: (p: number) => void; busy?: boolean }) {
  return (
    <div className="table-foot">
      <span className="muted small">
        {total} {total === 1 ? noun[0] : noun[1]}
      </span>
      {pages > 1 && (
        <div className="row">
          <button className="btn small" disabled={page <= 1 || busy} onClick={() => onPage(page - 1)} aria-label="Previous page">
            Previous
          </button>
          <span className="small" aria-live="polite">
            Page {page} / {pages}
          </span>
          <button className="btn small" disabled={page >= pages || busy} onClick={() => onPage(page + 1)} aria-label="Next page">
            Next
          </button>
        </div>
      )}
    </div>
  );
}
