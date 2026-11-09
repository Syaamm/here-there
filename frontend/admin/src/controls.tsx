import { Children, Fragment, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactElement, type ReactNode, type RefObject } from 'react';

/*
 * The console's own dropdown, date picker and "click outside to close" for pop-ups, so nothing falls back to the browser's grey
 * system look. Styles: controls.css (loaded in main.tsx). This file imports nothing from ui.tsx (ui.tsx imports it).
 */

const Chevron = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
);
const CheckMark = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

// ---------------------------------------------------------------- pop-ups close when the dark area around them is clicked
/**
 * For a <dialog> opened with showModal(): spread the result on it, and a click on the dark area outside closes it. The click
 * position is compared with the dialog's box (the dialog has padding, and a click on that padding also targets the dialog
 * itself). A press that starts inside and is released outside (selecting text) never closes it.
 */
export function useBackdropClose(ref: RefObject<HTMLDialogElement | null>, onClose: () => void) {
  const pressedOutside = useRef(false);
  const outside = useCallback(
    (e: ReactMouseEvent) => {
      const el = ref.current;
      if (!el || e.target !== el) return false; // a click on anything inside (a field, a menu that hangs outside the box) is not a backdrop click
      const r = el.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    },
    [ref],
  );
  return {
    onMouseDown: (e: ReactMouseEvent) => {
      pressedOutside.current = outside(e);
    },
    onClick: (e: ReactMouseEvent) => {
      const began = pressedOutside.current;
      pressedOutside.current = false;
      if (began && outside(e)) onClose();
    },
  };
}

// ---------------------------------------------------------------- shared: a floating panel under a button
type Placement = { top: number; left: number; width: number; maxHeight: number };
/** Where to put a panel that hangs under (or, with no room, over) `button`. Fixed to the window, so no container clips it. */
function usePlacement(open: boolean, button: RefObject<HTMLElement | null>, panel: RefObject<HTMLElement | null>, minWidth = 0) {
  const [place, setPlace] = useState<Placement | null>(null);
  useLayoutEffect(() => {
    if (!open || !button.current) return setPlace(null);
    const r = button.current.getBoundingClientRect();
    const h = panel.current?.offsetHeight ?? 0;
    const w = Math.max(r.width, minWidth);
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = h > below && above > below;
    const room = up ? above : below;
    setPlace({
      left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)),
      top: up ? Math.max(8, r.top - Math.min(h, room) - 6) : r.bottom + 6,
      width: w,
      maxHeight: Math.max(160, room),
    });
  }, [open, button, panel, minWidth]);
  return place;
}

/** Closes the panel on a click anywhere else, on Tab, on window resize and when the page behind it scrolls. */
function useDismiss(open: boolean, close: () => void, ...inside: RefObject<HTMLElement | null>[]) {
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !inside.some((r) => r.current?.contains(e.target as Node)) && close();
    const scrolled = (e: Event) => !inside.some((r) => r.current?.contains(e.target as Node)) && close();
    document.addEventListener('mousedown', away);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', scrolled, true);
    return () => {
      document.removeEventListener('mousedown', away);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', scrolled, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

// ---------------------------------------------------------------- dropdown
type Opt = { value: string; label: ReactNode; text: string; disabled: boolean };
const textOf = (n: ReactNode): string => Children.toArray(n).map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : '')).join('');

/** Reads <option value disabled>label</option> children (through fragments, `false` and arrays), like a native select does. */
function readOptions(children: ReactNode): Opt[] {
  const out: Opt[] = [];
  const walk = (nodes: ReactNode) => {
    Children.forEach(nodes, (c) => {
      if (!isValidElement(c)) return;
      const el = c as ReactElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>;
      if (el.type === Fragment) return walk(el.props.children);
      if (el.type !== 'option') return;
      const label = el.props.children;
      out.push({ value: String(el.props.value ?? textOf(label)), label, text: textOf(label), disabled: !!el.props.disabled });
    });
  };
  walk(children);
  return out;
}

/**
 * A dropdown in the console's look. Write it like a native select (options as <option> children), but onChange gets the chosen
 * value, not an event. Keyboard: Enter / Space / arrows open it; arrows, Home and End move; Enter or Space chooses; Escape closes;
 * typing a letter jumps to the next option starting with it.
 */
export function Select({
  value,
  onChange,
  children,
  disabled,
  required,
  placeholder,
  className,
  style,
  highlight,
  compact,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
  required?: boolean;
  /** shown while nothing is chosen (an option with an empty value, or none) */
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
  /** marks a value that is changed but not saved yet */
  highlight?: boolean;
  compact?: boolean;
  'aria-label'?: string;
}) {
  const opts = readOptions(children);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const id = useId();
  const chosen = opts.find((o) => o.value === value);
  const place = usePlacement(open, btn, panel, 170);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, wrap, panel);

  const show = () => {
    if (disabled) return;
    const i = opts.findIndex((o) => o.value === value && !o.disabled);
    setActive(i >= 0 ? i : Math.max(0, opts.findIndex((o) => !o.disabled)));
    setOpen(true);
  };
  const pick = (o: Opt) => {
    if (o.disabled) return;
    setOpen(false);
    if (o.value !== value) onChange(o.value);
    btn.current?.focus();
  };
  const step = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < opts.length; i += dir) if (!opts[i].disabled) return i;
    return from;
  };
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const keys = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) (e.preventDefault(), show());
      return;
    }
    if (e.key === 'Escape') return (e.preventDefault(), e.stopPropagation(), setOpen(false));
    if (e.key === 'Tab') return setOpen(false);
    if (e.key === 'ArrowDown') return (e.preventDefault(), setActive((a) => step(a, 1)));
    if (e.key === 'ArrowUp') return (e.preventDefault(), setActive((a) => step(a, -1)));
    if (e.key === 'Home') return (e.preventDefault(), setActive(step(-1, 1)));
    if (e.key === 'End') return (e.preventDefault(), setActive(step(opts.length, -1)));
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const o = opts[active];
      if (o) pick(o);
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase(), at: now };
      const from = typed.current.text.length > 1 ? active : active + 1;
      const hit = [...opts.keys()].map((_, k) => (from + k) % opts.length).find((i) => !opts[i].disabled && opts[i].text.toLowerCase().startsWith(typed.current.text));
      if (hit !== undefined) setActive(hit);
    }
  };

  return (
    <div ref={wrap} className={`select${compact ? ' compact' : ''}${className ? ' ' + className : ''}`} style={style}>
      <button
        ref={btn}
        type="button"
        className={`select-btn${highlight ? ' is-dirty' : ''}${open ? ' is-open' : ''}`}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={keys}
      >
        <span className={!chosen || (chosen.disabled && chosen.value === '') ? 'select-value placeholder' : 'select-value'}>{chosen && !(chosen.value === '' && placeholder) ? chosen.label : (placeholder ?? '')}</span>
        <Chevron className="select-chevron" />
      </button>
      {/* a hidden field carries `required`, so the form's own "please fill this in" still works */}
      {required && <input className="select-required" tabIndex={-1} aria-hidden="true" required value={value} onChange={() => undefined} />}
      {open && (
        <div
          ref={panel}
          id={id}
          role="listbox"
          className="select-list"
          style={place ? { left: place.left, top: place.top, minWidth: place.width, maxHeight: place.maxHeight } : { visibility: 'hidden' }}
          // inside a <label>, a click on the panel would otherwise "click the label" and reopen the list
          onClick={(e) => e.preventDefault()}
        >
          {opts.map((o, i) => (
            <div
              key={o.value + i}
              id={`${id}-${i}`}
              data-i={i}
              role="option"
              aria-selected={o.value === value}
              aria-disabled={o.disabled || undefined}
              className={`select-opt${i === active ? ' active' : ''}${o.value === value ? ' chosen' : ''}${o.disabled ? ' off' : ''}`}
              onMouseMove={() => !o.disabled && i !== active && setActive(i)}
              onMouseDown={(e) => e.preventDefault()} // keeps the focus on the button
              onClick={() => pick(o)}
            >
              <span className="select-opt-label">{o.label}</span>
              {o.value === value && !o.disabled && <CheckMark />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- date picker
const pad = (n: number) => String(n).padStart(2, '0');
const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s?: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 ? d : null;
};
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const addMonths = (d: Date, n: number) => {
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  return new Date(t.getFullYear(), t.getMonth(), Math.min(d.getDate(), new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()));
};
const shown = (d: Date | null) => (d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * A date field in the console's look: a button showing the date, and a calendar under it. The value is "YYYY-MM-DD" (or "" for
 * none), like a native date input. Days before `min` or after `max` cannot be chosen. Keyboard: arrows move by a day or a week,
 * Page Up / Page Down by a month, Home / End to the start / end of the week, Enter chooses, Escape closes.
 */
export function DateField({
  value,
  onChange,
  min,
  max,
  placeholder = 'Pick a date',
  compact,
  clearable = true,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  compact?: boolean;
  clearable?: boolean;
  'aria-label': string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const sel = parse(value);
  const lo = parse(min);
  const hi = parse(max);
  const today = new Date();
  const clamp = (d: Date) => (lo && d < lo ? lo : hi && d > hi ? hi : d);
  const [focusDay, setFocusDay] = useState<Date>(() => clamp(sel ?? today));
  const place = usePlacement(open, btn, panel, 296);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, wrap, panel);

  const show = () => {
    setFocusDay(clamp(sel ?? today));
    setOpen(true);
  };
  // the keyboard focus goes into the calendar when it opens, and follows the chosen day as it moves
  useEffect(() => {
    if (open && place) panel.current?.querySelector<HTMLButtonElement>('button[data-day][tabindex="0"]')?.focus({ preventScroll: true });
  }, [open, focusDay, !!place]); // eslint-disable-line react-hooks/exhaustive-deps
  const off = (d: Date) => !!((lo && d < lo) || (hi && d > hi));
  const pickDay = (d: Date) => {
    if (off(d)) return;
    setOpen(false);
    onChange(key(d));
    btn.current?.focus();
  };

  // the 6 weeks that cover the month in view, Monday first
  const first = new Date(focusDay.getFullYear(), focusDay.getMonth(), 1);
  const start = addDays(first, -((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));

  const move = (e: React.KeyboardEvent) => {
    const go = (d: Date) => (e.preventDefault(), setFocusDay(clamp(d)));
    if (e.key === 'Escape') return (e.preventDefault(), e.stopPropagation(), setOpen(false), btn.current?.focus());
    if (e.key === 'Tab') return setOpen(false);
    if (e.key === 'ArrowLeft') return go(addDays(focusDay, -1));
    if (e.key === 'ArrowRight') return go(addDays(focusDay, 1));
    if (e.key === 'ArrowUp') return go(addDays(focusDay, -7));
    if (e.key === 'ArrowDown') return go(addDays(focusDay, 7));
    if (e.key === 'PageUp') return go(addMonths(focusDay, e.shiftKey ? -12 : -1));
    if (e.key === 'PageDown') return go(addMonths(focusDay, e.shiftKey ? 12 : 1));
    if (e.key === 'Home') return go(addDays(focusDay, -((focusDay.getDay() + 6) % 7)));
    if (e.key === 'End') return go(addDays(focusDay, 6 - ((focusDay.getDay() + 6) % 7)));
  };

  const monthName = focusDay.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const prevOk = !lo || new Date(focusDay.getFullYear(), focusDay.getMonth(), 0) >= lo;
  const nextOk = !hi || new Date(focusDay.getFullYear(), focusDay.getMonth() + 1, 1) <= hi;

  return (
    <div ref={wrap} className={`select datefield${compact ? ' compact' : ''}`}>
      <button
        ref={btn}
        type="button"
        className={`select-btn${open ? ' is-open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`${ariaLabel}: ${sel ? shown(sel) : 'no date chosen'}`}
        onClick={() => (open ? setOpen(false) : show())}
      >
        <span className={sel ? 'select-value' : 'select-value placeholder'}>{sel ? shown(sel) : placeholder}</span>
        <svg className="select-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
        </svg>
      </button>
      {open && (
        <div
          ref={panel}
          id={id}
          role="dialog"
          aria-label={`${ariaLabel}: choose a date`}
          className="cal"
          style={place ? { left: place.left, top: place.top, width: place.width } : { visibility: 'hidden' }}
          onKeyDown={move}
          onClick={(e) => e.preventDefault()}
        >
          <div className="cal-head">
            <button type="button" className="cal-nav" aria-label="Previous month" disabled={!prevOk} onClick={() => setFocusDay(clamp(addMonths(focusDay, -1)))}>
              <Chevron className="cal-prev" />
            </button>
            <strong aria-live="polite">{monthName}</strong>
            <button type="button" className="cal-nav" aria-label="Next month" disabled={!nextOk} onClick={() => setFocusDay(clamp(addMonths(focusDay, 1)))}>
              <Chevron className="cal-next" />
            </button>
          </div>
          <div className="cal-grid" role="grid" aria-label={monthName}>
            {WEEKDAYS.map((w) => (
              <span key={w} className="cal-dow" role="columnheader">
                {w}
              </span>
            ))}
            {days.map((d) => {
              const inMonth = d.getMonth() === focusDay.getMonth();
              const isSel = !!sel && key(d) === key(sel);
              const isToday = key(d) === key(today);
              const isFocus = key(d) === key(focusDay);
              return (
                <button
                  key={key(d)}
                  type="button"
                  data-day={key(d)}
                  tabIndex={isFocus ? 0 : -1}
                  disabled={off(d)}
                  aria-pressed={isSel}
                  aria-current={isToday ? 'date' : undefined}
                  aria-label={d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                  className={`cal-day${inMonth ? '' : ' out'}${isSel ? ' sel' : ''}${isToday ? ' today' : ''}`}
                  onClick={() => pickDay(d)}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
          <div className="cal-foot">
            <button type="button" className="link small" disabled={off(today)} onClick={() => pickDay(today)}>
              Today
            </button>
            {clearable && sel && (
              <button
                type="button"
                className="link small"
                onClick={() => {
                  setOpen(false);
                  onChange('');
                  btn.current?.focus();
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
