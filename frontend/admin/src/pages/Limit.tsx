import { useState } from 'react';
import { api, can, get, type Session } from '../api';
import { Select } from '../controls';
import { Chip, ErrorBanner, Loading, useAction, useLoad } from '../ui';

type Range = { min: number; max: number };
type Place = {
  key: string;
  kind: string;
  hereMonths: number | null;
  thereMonths: number | null;
  areaKm: number | null;
  effective: { here: number; there: number; area: number };
};
type Reply = { ranges: { here: Range; there: Range; area: Range }; items: Place[] };
type Which = 'hereMonths' | 'thereMonths' | 'areaKm';

const months = (n: number) => `${n} ${n === 1 ? 'month' : 'months'}`;
const kms = (n: number) => `${n} km`;
/** Radius choices: every 5 km up to 100, plus 1, 2, 3 and 10 for small towns (the current value is always offered too). */
const KM_CHOICES = [1, 2, 3, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100];

/** One common value (the same for everyone, no city or region has its own): a dropdown with Save / Cancel. */
function OneLimit({ title, text, label, which, current, choices, show, editable, data, onSaved, manual, range, unit }: {
  title: string;
  text: string;
  label: string;
  which: Which;
  current: number;
  choices: number[];
  show: (n: number) => string;
  editable: boolean;
  data: Reply;
  onSaved: () => void;
  /** typed in by hand (a whole number within the range) instead of picked from a list */
  manual?: boolean;
  range?: Range;
  unit?: string;
}) {
  const act = useAction(onSaved);
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const root = data.items.find((p) => p.kind === 'global') ?? null;
  const value = draft ?? String(current);
  const typed = Number(value);
  const bad = !!manual && (value.trim() === '' || !Number.isInteger(typed) || (range ? typed < range.min || typed > range.max : typed < 1));
  const problem = manual && draft !== null && bad ? (range ? `Enter a whole number from ${range.min} to ${range.max}.` : 'Enter a whole number.') : null;
  const dirty = draft !== null && draft !== String(current);
  const options = [...new Set([...choices, current])].sort((a, b) => a - b);

  const save = () =>
    act.run(async () => {
      if (!root || bad) return;
      // under the hood it is the value on the top place; a city that still had its own value would override it, so those are cleared
      await api('PATCH', `/v1/admin/regions/${root.key}`, { [which]: Number(value) });
      const own = data.items.filter((p) => p.kind !== 'global' && p[which] !== null);
      await Promise.all(own.map((p) => api('PATCH', `/v1/admin/regions/${p.key}`, { [which]: null })));
      setDraft(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    });

  return (
    <div className="set-limit">
      <div className="set-limit-text">
        <strong>{title}</strong>
        <span className="muted small">{text}</span>
        {(act.error || problem) && <span className="small" style={{ color: 'var(--bad-fg)' }}>{act.error ?? problem}</span>}
      </div>
      <div className="set-limit-set">
        {editable && manual ? (
          <span className="limit-manual">
            <input type="text" inputMode="numeric" aria-label={label} aria-invalid={problem ? true : undefined} value={value} disabled={act.busy} onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} onKeyDown={(e) => e.key === 'Enter' && dirty && !bad && save()} style={{ width: 72 }} />
            <span className="muted small">{unit ?? ''}</span>
          </span>
        ) : editable ? (
          <Select compact aria-label={label} value={value} onChange={setDraft} disabled={act.busy}>
            {options.map((n) => (
              <option key={n} value={n}>
                {show(n)}
              </option>
            ))}
          </Select>
        ) : (
          <strong>{show(current)}</strong>
        )}
        {dirty ? (
          <div className="cell-actions">
            <button className="btn small" onClick={() => setDraft(null)} disabled={act.busy}>
              Cancel
            </button>
            <button className="btn small primary" onClick={save} disabled={act.busy || bad}>
              {act.busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        ) : (
          saved && <Chip value="Saved" tone="ok" icon="check" />
        )}
      </div>
    </div>
  );
}

/**
 * The common limits inside the Here / There card. Here (activities): how many months ahead one can be planned, and the radius
 * around a city that counts as nearby (25 km unless changed). There (trips): how many months ahead. Each is one value for
 * everyone; no city or region has a value of its own.
 */
export function LimitCard({ me, side }: { me: Session; side: 'here' | 'there' }) {
  const { data, error, loading, reload } = useLoad(() => get<Reply>('/v1/admin/regions'), []);
  const root = data?.items.find((p) => p.kind === 'global') ?? null;
  const editable = can.admin(me.role);
  const noun = side === 'here' ? 'activities' : 'trips';
  const range = data?.ranges[side];
  const monthChoices = range ? Array.from({ length: range.max - range.min + 1 }, (_, i) => range.min + i) : [];
  const kmRange = data?.ranges.area;
  const kmChoices = kmRange ? KM_CHOICES.filter((n) => n >= kmRange.min && n <= kmRange.max) : KM_CHOICES;

  return (
    <>
      <ErrorBanner message={error} onRetry={reload} />
      {loading && !data && <Loading rows={1} />}
      {data && root && (
        <>
          <OneLimit
            title="Planning window"
            text={`How far ahead ${noun} can be planned. One limit for everyone.`}
            label={`How far ahead ${noun} can be planned`}
            which={side === 'here' ? 'hereMonths' : 'thereMonths'}
            current={side === 'here' ? root.effective.here : root.effective.there}
            choices={monthChoices}
            manual
            range={range}
            unit="months"
            show={months}
            editable={editable}
            data={data}
            onSaved={reload}
          />
          {side === 'here' && (
            <OneLimit
              title="Radius"
              text="How far around a city counts as nearby for activities. One distance for everyone."
              label="Radius around a city"
              which="areaKm"
              current={root.effective.area}
              choices={kmChoices}
              manual
              range={kmRange}
              unit="km"
              show={kms}
              editable={editable}
              data={data}
              onSaved={reload}
            />
          )}
        </>
      )}
    </>
  );
}
