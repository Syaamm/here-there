import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * Chart pieces for the dashboard, drawn as plain SVG (no chart library). Colours are fixed per series so a series
 * never changes colour when another is hidden. The three series colours were checked on the dark card surface:
 * lightness band, chroma, colour-blind separation and 3:1 contrast all pass.
 *
 * Charts fill the space their card gives them (they measure it), so the whole dashboard can fit one screen.
 */
export const SERIES = { mint: '#36ad7a', orange: '#de7030', blue: '#5888d8' } as const;

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
export function Sparkline({ values, color = SERIES.mint, label }: { values: number[]; color?: string; label: string }) {
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

/** The same numbers as a table, for anyone who cannot use the chart (screen readers, copy and paste). It replaces the chart in the same space. */
function DataTable({ days, series }: { days: string[]; series: { label: string; values: number[] }[] }) {
  return (
    <div className="table-scroll data-table">
      <table>
        <thead>
          <tr>
            <th>Day</th>
            {series.map((s) => (
              <th key={s.label}>{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((d, i) => (
            <tr key={d}>
              <td>{day(d)}</td>
              {series.map((s) => (
                <td key={s.label}>{s.values[i]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ViewToggle({ table, onToggle }: { table: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="link view-toggle" aria-pressed={table} onClick={onToggle}>
      {table ? 'View as chart' : 'View as table'}
    </button>
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
  const [table, setTable] = useState(false);
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
      <div className="chart chart-fill" ref={ref} onPointerMove={(e) => !table && move(e.clientX)} onPointerLeave={() => setAt(null)}>
        {table ? (
          <DataTable days={days} series={lines} />
        ) : (
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
        )}
      </div>
      <div className="legend" role="group" aria-label="Show or hide a series">
        {lines.map((l) => {
          const on = !off.has(l.key);
          return (
            <button
              key={l.key}
              type="button"
              className={on ? 'on' : ''}
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
              <i style={{ background: on ? l.color : 'transparent', borderColor: l.color }} />
              {l.label}
            </button>
          );
        })}
        <ViewToggle table={table} onToggle={() => (setTable(!table), setAt(null))} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- one bar per day
export function DayBars({ days, values, label, color = SERIES.mint, flag = SERIES.orange }: { days: string[]; values: number[]; label: string; color?: string; flag?: string }) {
  const { at, setAt } = useHover();
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...values);
  const avg = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  const high = Math.max(2, avg * 2); // a day well above the usual is shown in the second colour
  return (
    <div className="chart-box">
      <div className="chart bars chart-fill" onPointerLeave={() => setAt(null)}>
        {table ? (
          <DataTable days={days} series={[{ label, values }]} />
        ) : (
          <>
            <div className="bar-row" role="img" aria-label={`${label}. ${values.reduce((a, b) => a + b, 0)} in the last ${values.length} days.`}>
              {values.map((v, i) => (
                <div key={days[i]} className="bar-slot" onPointerEnter={() => setAt({ i, x: (i + 0.5) / values.length })}>
                  <i style={{ height: `${Math.max(v ? 6 : 2, (v / max) * 100)}%`, background: v >= high ? flag : color, opacity: v ? 1 : 0.28 }} />
                </div>
              ))}
            </div>
            {at && <Tip x={at.x} title={day(days[at.i])} rows={[{ color: values[at.i] >= high ? flag : color, label, value: values[at.i] }]} />}
          </>
        )}
      </div>
      <div className="legend">
        <span className="muted small">Orange days: well above usual</span>
        <ViewToggle table={table} onToggle={() => (setTable(!table), setAt(null))} />
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

/** A "more →" style heading row used by every card. */
export function CardHead({ id, title, right }: { id?: string; title: string; right?: ReactNode }) {
  return (
    <div className="dash-head">
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
