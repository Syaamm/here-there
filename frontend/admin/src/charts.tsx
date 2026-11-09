import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/** Chart pieces drawn as plain SVG, in the app palette: forest, green accent, neutral grey. */
export const SERIES = { forest: '#102f29', accent: '#4daa84', grey: '#9fb0a9' } as const;

const day = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** The size of an element, kept up to date as the window or the card changes. */
export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize((o) => (o.w === el.clientWidth && o.h === el.clientHeight ? o : { w: el.clientWidth, h: el.clientHeight }));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, ...size };
}

// ---------------------------------------------------------------- a row of thin bars that fills up (a share)
export function MiniBars({ value, label }: { value: number; label: string }) {
  const n = 36;
  const on = Math.round(Math.max(0, Math.min(1, value)) * n);
  return (
    <div className="minibars" role="img" aria-label={label}>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className={i < on ? 'on' : ''} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- a gradient meter with a marker
export function Meter({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="meter" role="img" aria-label={label}>
      <i className="meter-mark" style={{ left: `${v * 100}%` }} />
      <div className="meter-bar" />
    </div>
  );
}

// ---------------------------------------------------------------- a small trend line
export function Sparkline({ values, color = SERIES.accent, label }: { values: number[]; color?: string; label: string }) {
  const id = useId();
  const w = 160;
  const h = 40;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [(i / Math.max(1, values.length - 1)) * w, h - 3 - (v / max) * (h - 8)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w} ${h} L0 ${h} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ---------------------------------------------------------------- shared hover tooltip
function useHover() {
  const [at, setAt] = useState<{ i: number; x: number } | null>(null);
  return { at, setAt };
}
function Tip({ x, title, rows }: { x: number; title: string; rows: { color: string; label: string; value: number }[] }) {
  return (
    <div className="tip" style={{ left: `${x * 100}%`, transform: `translateX(${x > 0.7 ? '-105%' : '12px'})` }} role="status">
      <b>{title}</b>
      {rows.map((r) => (
        <div key={r.label}>
          <i style={{ background: r.color }} />
          {r.label}
          <span>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/** A round gap between axis lines (1, 2, 5, 10, 20...) that gives about four lines. */
const niceStep = (max: number) => {
  const raw = Math.max(1, max) / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const r = raw / p;
  return Math.max(1, (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * p);
};

// ---------------------------------------------------------------- lines over days, with a legend that also switches series
export type Line = { key: string; label: string; color: string; values: number[] };

export function LineChart({ days, lines, title }: { days: string[]; lines: Line[]; title: string }) {
  const [off, setOff] = useState<Set<string>>(new Set());
  const { at, setAt } = useHover();
  const { ref, w, h } = useSize<HTMLDivElement>();
  const W = Math.max(280, w);
  const H = Math.max(120, h);
  const m = { l: 34, r: 10, t: 12, b: 26 };
  const shown = lines.filter((l) => !off.has(l.key));
  const rawMax = Math.max(1, ...shown.flatMap((l) => l.values));
  const step = niceStep(rawMax);
  const max = Math.ceil(rawMax / step) * step;
  const x = (i: number) => m.l + (i / Math.max(1, days.length - 1)) * (W - m.l - m.r);
  const y = (v: number) => H - m.b - (v / max) * (H - m.t - m.b);
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const labelAt = [0, Math.floor((days.length - 1) / 2), days.length - 1];

  const move = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || !r.width) return;
    const px = clientX - r.left;
    const i = Math.round(((px - m.l) / (W - m.l - m.r)) * (days.length - 1));
    setAt({ i: Math.max(0, Math.min(days.length - 1, i)), x: px / r.width });
  };

  const summary = `${title}. ${lines.map((l) => `${l.label}: ${l.values.reduce((a, b) => a + b, 0)} in total`).join('; ')}.`;
  return (
    <div className="chart-box">
      <div className="chart chart-fill" ref={ref} onPointerMove={(e) => move(e.clientX)} onPointerLeave={() => setAt(null)}>
        <>
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className="grid" />
                  <text x={m.l - 8} y={y(t) + 4} textAnchor="end" className="axis">
                    {t}
                  </text>
                </g>
              ))}
              {labelAt.map((i) => (
                <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'} className="axis">
                  {day(days[i])}
                </text>
              ))}
              {shown.map((l) => (
                <path key={l.key} d={l.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')} fill="none" stroke={l.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              ))}
              {at && (
                <g>
                  <line x1={x(at.i)} x2={x(at.i)} y1={m.t} y2={H - m.b} className="cross" />
                  {shown.map((l) => (
                    <circle key={l.key} cx={x(at.i)} cy={y(l.values[at.i])} r="4.5" fill={l.color} className="ring" />
                  ))}
                </g>
              )}
            </svg>
            {at && <Tip x={at.x} title={day(days[at.i])} rows={shown.map((l) => ({ color: l.color, label: l.label, value: l.values[at.i] }))} />}
          </>
      </div>
      <div className="row wrap" style={{ marginTop: 8 }} role="group" aria-label="Show or hide a series">
        {lines.map((l) => {
          const on = !off.has(l.key);
          return (
            <button
              key={l.key}
              type="button"
              className={on ? 'btn small' : 'btn small ghost'}
              aria-pressed={on}
              onClick={() =>
                setOff((o) => {
                  const n = new Set(o);
                  if (n.has(l.key)) n.delete(l.key);
                  else if (shown.length > 1) n.add(l.key);
                  return n;
                })
              }
            >
              <i className="dot" style={{ background: on ? l.color : 'transparent', border: `2px solid ${l.color}` }} />
              {l.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- one bar per day, with a value axis and dates under it
export function DayBars({ days, values, label, color = SERIES.accent, flag = SERIES.forest }: { days: string[]; values: number[]; label: string; color?: string; flag?: string }) {
  const { at, setAt } = useHover();
  const { ref, w, h } = useSize<HTMLDivElement>();
  const W = Math.max(280, w);
  const H = Math.max(140, h);
  const m = { l: 30, r: 6, t: 10, b: 24 };
  const n = Math.max(1, values.length);
  const rawMax = Math.max(1, ...values);
  const step = niceStep(rawMax);
  const max = Math.ceil(rawMax / step) * step;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const slot = (W - m.l - m.r) / n;
  const bw = Math.max(2, Math.min(22, slot * 0.62));
  const x = (i: number) => m.l + i * slot + (slot - bw) / 2;
  const y = (v: number) => H - m.b - (v / max) * (H - m.t - m.b);
  // about one date label per 90 px, always the first and the last day
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - m.l) / 90))));
  const labelled = days.map((_, i) => i).filter((i) => i % every === 0 || i === n - 1).filter((i, k, a) => i === n - 1 || a[k + 1] === undefined || a[k + 1] - i >= every * 0.6);
  const avg = values.reduce((a, b) => a + b, 0) / n;
  const high = Math.max(2, avg * 2); // a day well above the usual is drawn darker

  const move = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || !r.width) return;
    const i = Math.floor((clientX - r.left - m.l) / slot);
    if (i < 0 || i >= n) return setAt(null);
    setAt({ i, x: (m.l + (i + 0.5) * slot) / W });
  };

  return (
    <div className="chart-box">
      <div className="chart chart-fill daybars" ref={ref} onPointerMove={(e) => move(e.clientX)} onPointerLeave={() => setAt(null)}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}. ${values.reduce((a, b) => a + b, 0)} in the last ${n} days.`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className="grid" />
              <text x={m.l - 8} y={y(t) + 4} textAnchor="end" className="axis">
                {t}
              </text>
            </g>
          ))}
          {at && <rect x={m.l + at.i * slot} y={m.t} width={slot} height={H - m.t - m.b} className="bar-hover" rx="4" />}
          {values.map((v, i) => {
            const top = y(v);
            const hgt = Math.max(v ? 3 : 1.5, H - m.b - top);
            return <rect key={days[i] ?? i} className="dbar" x={x(i)} y={H - m.b - hgt} width={bw} height={hgt} rx={Math.min(4, bw / 2)} fill={v >= high ? flag : color} opacity={v ? (at && at.i !== i ? 0.55 : 1) : 0.25} style={{ animationDelay: `${Math.min(i, 40) * 12}ms` }} />;
          })}
          {labelled.map((i) => (
            <text key={i} x={m.l + (i + 0.5) * slot} y={H - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="axis">
              {day(days[i])}
            </text>
          ))}
        </svg>
        {at && <Tip x={at.x} title={day(days[at.i])} rows={[{ color: values[at.i] >= high ? flag : color, label, value: values[at.i] }]} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- a stacked share bar with a list under it
export type Part = { key: string; label: string; value: number; color: string };

export function ShareBar({ parts, label }: { parts: Part[]; label: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div className="sharebar" role="img" aria-label={`${label}: ${parts.map((p) => `${p.label} ${p.value}`).join(', ')}`}>
      {total === 0 ? <i className="none" /> : parts.filter((p) => p.value > 0).map((p) => <i key={p.key} style={{ flexGrow: p.value, background: p.color }} title={`${p.label}: ${p.value}`} />)}
    </div>
  );
}

/** A card heading with something on the right. */
export function CardHead({ id, title, right }: { id?: string; title: string; right?: ReactNode }) {
  return (
    <div className="card-head">
      <h2 id={id}>{title}</h2>
      {right}
    </div>
  );
}

/** One KPI column: label, big value, and a small visual under it. */
export function Kpi({ label, value, note, children }: { label: string; value: ReactNode; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">
        {value}
        {note}
      </span>
      <div className="kpi-visual">{children}</div>
    </div>
  );
}
