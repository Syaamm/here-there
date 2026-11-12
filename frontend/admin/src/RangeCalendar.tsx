import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './ui';
import './RangeCalendar.css';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (v: string) => (v ? new Date(`${v}T00:00:00`) : null);
const WEEK = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/**
 * One calendar to choose a first and a last day: click the first day, then the last. Clicking a day before the first one starts
 * again from it, so the first day is never after the last. Days after `max` (when given) cannot be chosen. A single click twice is one day.
 */
export function RangeCalendar({ anchor, from, to, max, onPick, onClose }: { anchor: HTMLElement | null; from: string; to: string; max?: string; onPick: (from: string, to: string) => void; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const [month, setMonth] = useState(() => {
    const d = parse(to) ?? new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [start, setStart] = useState<string | null>(null); // the first day, while the last is still to be chosen
  const [hover, setHover] = useState<string | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const w = panel.current?.offsetWidth ?? 308;
      setPos({ top: r.bottom + 8, left: Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [anchor, onClose]);

  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7; // Monday first
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => iso(new Date(month.getFullYear(), month.getMonth(), i + 1)))];
  const title = month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const atMax = !!max && iso(new Date(month.getFullYear(), month.getMonth() + 1, 1)) > max;

  // the span drawn on the grid: the chosen range, or the first day to wherever the pointer is
  const lo = start ?? from;
  const hi = start ? (hover && hover >= start ? hover : start) : to;

  const choose = (d: string) => {
    if (max && d > max) return;
    if (!start || d < start) return setStart(d);
    onPick(start, d);
  };

  return createPortal(
    <div ref={panel} className="rc" style={{ top: pos?.top ?? -999, left: pos?.left ?? -999 }} role="dialog" aria-label="Choose the first and the last day">
      <div className="rc-head">
        <button type="button" className="rc-nav" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">
          <span style={{ display: 'grid', transform: 'rotate(90deg)' }}>
            <Icon name="chevron" />
          </span>
        </button>
        <strong>{title}</strong>
        <button type="button" className="rc-nav" disabled={atMax} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">
          <span style={{ display: 'grid', transform: 'rotate(-90deg)' }}>
            <Icon name="chevron" />
          </span>
        </button>
      </div>
      <p className="rc-hint">{start ? 'Now choose the last day' : 'Choose the first day'}</p>
      <div className="rc-grid" onMouseLeave={() => setHover(null)}>
        {WEEK.map((w) => (
          <span key={w} className="rc-dow">
            {w}
          </span>
        ))}
        {cells.map((d, i) =>
          d ? (
            <button
              key={d}
              type="button"
              disabled={!!max && d > max}
              className={['rc-day', d >= lo && d <= hi ? 'in' : '', d === lo ? 'edge' : '', d === hi ? 'edge' : '', d === iso(new Date()) ? 'today' : ''].filter(Boolean).join(' ')}
              onMouseEnter={() => setHover(d)}
              onClick={() => choose(d)}
              aria-label={new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
            >
              {Number(d.slice(8))}
            </button>
          ) : (
            <span key={`e${i}`} />
          ),
        )}
      </div>
    </div>,
    document.body,
  );
}
