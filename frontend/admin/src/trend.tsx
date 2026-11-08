import { useState } from 'react';
import { useSize } from './charts';
import './trend.css';

/** One line on the dashboard trend: its values per day, the total and the change against the period before (when known). */
export type Trend = { key: string; label: string; color: string; values: number[]; total: number; change?: number | null };

const shortDay = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const longDay = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** A round gap between axis lines (1, 2, 5, 10, 20...) that gives about three lines. */
const niceStep = (max: number) => {
  const raw = Math.max(1, max) / 3;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const r = raw / p;
  return Math.max(1, (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * p);
};

/** A smooth curve through the points that never overshoots them (monotone cubic), as an SVG path. */
function smooth(pts: [number, number][]) {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${pts[0][0]} ${pts[0][1]}`;
  const dx: number[] = [];
  const sl: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    sl.push((pts[i + 1][1] - pts[i][1]) / (dx[i] || 1));
  }
  const t = [sl[0]];
  for (let i = 1; i < n - 1; i++) t.push(sl[i - 1] * sl[i] <= 0 ? 0 : (sl[i - 1] + sl[i]) / 2);
  t.push(sl[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (sl[i] === 0) t[i] = t[i + 1] = 0;
    else {
      const a = t[i] / sl[i];
      const b = t[i + 1] / sl[i];
      const s = a * a + b * b;
      if (s > 9) {
        const k = 3 / Math.sqrt(s);
        t[i] = k * a * sl[i];
        t[i + 1] = k * b * sl[i];
      }
    }
  }
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${pts[i][0] + h} ${pts[i][1] + t[i] * h} ${pts[i + 1][0] - h} ${pts[i + 1][1] - t[i + 1] * h} ${pts[i + 1][0]} ${pts[i + 1][1]}`;
  }
  return d;
}

/** Pills to pick what to chart (total and change on each) over one smooth filled line with dates and a hover readout. */
export function TrendChart({ days, lines, title }: { days: string[]; lines: Trend[]; title: string }) {
  const [pick, setPick] = useState(lines[0]?.key);
  const [at, setAt] = useState<number | null>(null);
  const { ref, w, h } = useSize<HTMLDivElement>();
  const line = lines.find((l) => l.key === pick) ?? lines[0];
  const W = Math.max(280, w);
  const H = Math.max(180, h);
  const m = { l: 40, r: 18, t: 14, b: 32 };
  const n = Math.max(1, days.length);
  const values = days.map((_, i) => line?.values[i] ?? 0);
  const step = niceStep(Math.max(1, ...values));
  const max = Math.ceil(Math.max(1, ...values) / step) * step;
  const x = (i: number) => (n === 1 ? (m.l + W - m.r) / 2 : m.l + (i * (W - m.l - m.r)) / (n - 1));
  const y = (v: number) => H - m.b - (v / max) * (H - m.t - m.b);
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const pts = values.map((v, i) => [x(i), y(v)] as [number, number]);
  const path = smooth(pts);
  const area = n > 1 ? `${path} L${x(n - 1)} ${y(0)} L${x(0)} ${y(0)} Z` : '';
  // about one date every 90 px; the last day always, the one before it only when there is room
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - m.l - m.r) / 90))));
  const labelled = days.map((_, i) => i).filter((i) => (i % every === 0 && n - 1 - i >= every * 0.6) || i === n - 1);

  const move = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || !r.width) return;
    const i = n === 1 ? 0 : Math.round(((clientX - r.left - m.l) / (W - m.l - m.r)) * (n - 1));
    setAt(i < 0 || i >= n ? null : i);
  };
  const tipLeft = at == null ? 0 : x(at) / W;

  return (
    <div className="trend">
      <div className="trend-legend" role="group" aria-label="What to chart">
        {lines.map((l) => {
          const on = l.key === line?.key;
          return (
            <button key={l.key} type="button" className={on ? 'trend-key on' : 'trend-key'} aria-pressed={on} onClick={() => (setPick(l.key), setAt(null))} style={{ ['--c' as string]: l.color }}>
              <i className="trend-dot" />
              <span className="trend-name">{l.label}</span>
              <strong className="trend-total">{l.total.toLocaleString()}</strong>
              {l.change != null && <span className={l.change > 0 ? 'trend-change up' : 'trend-change'}>{`${l.change > 0 ? '+' : ''}${l.change}%`}</span>}
            </button>
          );
        })}
      </div>
      <div className="chart trend-plot" ref={ref} onPointerMove={(e) => move(e.clientX)} onPointerLeave={() => setAt(null)}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" data-days={n} aria-label={`${title}. ${line?.label}: ${line?.total}.`}>
          <defs>
            <linearGradient id="trend-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={line?.color} stopOpacity="0.18" />
              <stop offset="1" stopColor={line?.color} stopOpacity="0.04" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className="grid" />
              <text x={m.l - 10} y={y(t) + 4} textAnchor="end" className="axis">
                {t}
              </text>
            </g>
          ))}
          {labelled.map((i) => (
            <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="axis">
              {shortDay(days[i])}
            </text>
          ))}
          <g key={`${days[0]}|${n}|${line?.key}`} className="trend-draw">
            {area && <path d={area} fill="url(#trend-fill)" />}
            <path d={path} fill="none" stroke={line?.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            {n === 1 && <circle cx={pts[0][0]} cy={pts[0][1]} r="4" fill={line?.color} />}
          </g>
          {at != null && (
            <g>
              <line x1={x(at)} x2={x(at)} y1={m.t} y2={H - m.b} className="trend-guide" />
              <circle cx={x(at)} cy={y(values[at])} r="5" fill="#fff" stroke={line?.color} strokeWidth="2.5" />
            </g>
          )}
        </svg>
        {at != null && (
          <div className="tip" style={{ left: `${tipLeft * 100}%`, transform: `translateX(${tipLeft > 0.7 ? '-105%' : '12px'})` }} role="status">
            <b>{longDay(days[at])}</b>
            <div>
              <i style={{ background: line?.color }} />
              {line?.label}
              <span>{values[at]}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
