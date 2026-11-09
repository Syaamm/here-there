import { createContext, useContext, useState, type ReactNode } from 'react';
import { Icon } from './ui';
import './DayLog.css';

/** How many rows a day shows before "Show all". */
export const PREVIEW = 3;

type Ctx = { isOpen: (id: string) => boolean; toggle: (id: string) => void };
const DayCtx = createContext<Ctx>({ isOpen: () => false, toggle: () => {} });

const rel = (d: Date) => {
  const day = d.toDateString();
  if (day === new Date().toDateString()) return 'Today';
  if (day === new Date(Date.now() - 864e5).toDateString()) return 'Yesterday';
  if (day === new Date(Date.now() + 864e5).toDateString()) return 'Tomorrow';
  return d.toLocaleDateString('en-GB', { weekday: 'long' });
};
/** The calendar day an ISO time falls on, as a stable key ("2026-11-08"). */
export const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * One scrolling card of days (Audit log, Content). The header stays on top with the title, the count and Expand all /
 * Collapse all; each day keeps its date pinned on the left while its rows scroll past.
 */
export function DayLog({ title, count, label, children, footer }: { title: ReactNode; count: ReactNode; label: string; children: ReactNode; footer?: ReactNode }) {
  const [all, setAll] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const isOpen = (id: string) => overrides[id] ?? all;
  const toggle = (id: string) => setOverrides((o) => ({ ...o, [id]: !isOpen(id) }));
  const setEvery = (v: boolean) => (setAll(v), setOverrides({}));
  return (
    <DayCtx.Provider value={{ isOpen, toggle }}>
      <section className="au-scroll" aria-label={label}>
        <header className="au-head">
          <h2>{title}</h2>
          <div className="au-head-right">
            <button type="button" className="au-all" onClick={() => setEvery(!all)} aria-pressed={all}>
              <Icon name="chevron" />
              {all ? 'Collapse all' : 'Expand all'}
            </button>
            <span className="au-total">{count}</span>
          </div>
        </header>
        {children}
        {footer && <div className="au-more">{footer}</div>}
      </section>
    </DayCtx.Provider>
  );
}

/** One day: its date on the left, the first few rows, and the rest behind "Show all" (opens and closes smoothly). */
export function DayCard({ id, at, count, unit, rows }: { id: string; at: string; count: number; unit: [string, string]; rows: ReactNode[] }) {
  const { isOpen, toggle } = useContext(DayCtx);
  const d = new Date(at);
  const open = isOpen(id);
  const head = rows.slice(0, PREVIEW);
  const rest = rows.slice(PREVIEW);
  return (
    <article className="au-card" data-day={id} aria-label={d.toDateString()}>
      <header className="au-date">
        <span className="au-rel">{rel(d)}</span>
        <strong className="au-num">{d.getDate()}</strong>
        <span className="au-mon">{d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</span>
        <span className="au-count">
          {count} {count === 1 ? unit[0] : unit[1]}
        </span>
      </header>
      <div className="au-body">
        <ul className="au-rows">{head}</ul>
        {rest.length > 0 && (
          <>
            <div className={open ? 'au-extra open' : 'au-extra'} aria-hidden={!open} inert={!open}>
              <div className="au-extra-inner">
                <ul className="au-rows">{rest}</ul>
              </div>
            </div>
            <button type="button" className={open ? 'au-toggle open' : 'au-toggle'} aria-expanded={open} onClick={() => toggle(id)}>
              {open ? 'Show fewer' : `Show ${rest.length} more`}
              <Icon name="chevron" />
            </button>
          </>
        )}
      </div>
    </article>
  );
}
