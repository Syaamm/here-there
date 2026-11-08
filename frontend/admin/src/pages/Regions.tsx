import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, can, get, post, type Session } from '../api';
import { Empty, ErrorBanner, Icon, Loading, Page, RowMenu, useAction, useLoad, Chip } from '../ui';

type Place = {
  key: string;
  name: string;
  kind: 'global' | 'country' | 'region' | 'city';
  parentKey: string | null;
  cityKey: string | null;
  hereMonths: number | null;
  thereMonths: number | null;
  effective: { here: number; hereFrom: string | null; there: number; thereFrom: string | null };
  children: number;
  staff: number;
  canEdit: boolean;
  canDelete: boolean;
};
type Range = { min: number; max: number };
type Reply = { scope: { key: string; name: string; kind: string } | null; defaults: { here: number; there: number }; ranges: { here: Range; there: Range }; items: Place[] };
type Unassigned = { items: { cityKey: string; uses: number }[] };
type Which = 'hereMonths' | 'thereMonths';

const months = (n: number) => `${n} mo`;
const called = (p?: { kind: string; name: string }) => (!p || p.kind === 'global' ? 'whole service' : p.name);
const title = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
const options = (r: Range) => Array.from({ length: r.max - r.min + 1 }, (_, i) => r.min + i);

/** How far ahead activities (HERE) and trips (THERE) may be planned, per place. A place without its own limit follows the one above. */
export function RegionsPage({ me }: { me: Session }) {
  const { data, error, loading, reload } = useLoad(() => get<Reply>('/v1/admin/regions'), []);
  const wholeService = !me.scope;
  const unassigned = useLoad(() => (wholeService ? get<Unassigned>('/v1/admin/regions/unassigned') : Promise.resolve<Unassigned>({ items: [] })), [wholeService]);
  const act = useAction(() => (reload(), unassigned.reload()));
  const admin = can.admin(me.role);
  const items = data?.items ?? [];
  const byKey = new Map(items.map((p) => [p.key, p]));
  const [shut, setShut] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<string | null>(null); // null = closed; '' = blank; a city key = prefilled

  // the places as a tree: each one right under the place it belongs to, skipping folded branches
  const order = (parent: string | null, depth: number): { p: Place; depth: number }[] =>
    items
      .filter((p) => (p.parentKey && byKey.has(p.parentKey) ? p.parentKey : null) === parent)
      .flatMap((p) => [{ p, depth }, ...(shut.has(p.key) ? [] : order(p.key, depth + 1))]);
  const rows = order(null, 0);
  const toggle = (k: string) =>
    setShut((x) => {
      const n = new Set(x);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  // a changed limit waits in the row until Save; Cancel puts it back
  const [drafts, setDrafts] = useState<Record<string, Partial<Record<Which, string>>>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const draft = (p: Place, which: Which, v: string) =>
    setDrafts((d) => {
      const own = p[which] === null ? '' : String(p[which]);
      const next = { ...d[p.key], [which]: v };
      if (v === own) delete next[which];
      const out = { ...d, [p.key]: next };
      if (Object.keys(next).length === 0) delete out[p.key];
      return out;
    });
  const cancel = (p: Place) => setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== p.key)));
  const save = (p: Place) => {
    const d = drafts[p.key];
    if (!d) return;
    const body = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v === '' ? null : Number(v)]));
    return act.run(async () => {
      await api('PATCH', `/v1/admin/regions/${p.key}`, body);
      cancel(p);
      setSaved(p.key);
      setTimeout(() => setSaved((k) => (k === p.key ? null : k)), 2500);
    });
  };
  const remove = (p: Place) => {
    if (confirm(`Remove ${p.name}?`)) act.run(() => api('DELETE', `/v1/admin/regions/${p.key}`));
  };
  const parents = items.filter((p) => p.canEdit || (me.scope && p.key === me.scope.key)).filter((p) => p.kind !== 'city');
  const uncovered = unassigned.data?.items ?? [];

  const limit = (p: Place, which: Which) => {
    if (!data) return null;
    const here = which === 'hereMonths';
    const eff = here ? p.effective.here : p.effective.there;
    const from = here ? p.effective.hereFrom : p.effective.thereFrom;
    const own = p[which];
    const inherited = own === null && p.kind !== 'global' && drafts[p.key]?.[which] === undefined;
    if (admin && p.canEdit)
      return (
        <div style={{ display: 'grid', gap: 3, justifyItems: 'start' }}>
        <select aria-label={`${here ? 'Activities' : 'Trips'} limit for ${p.name}`} value={drafts[p.key]?.[which] ?? (own === null ? '' : String(own))} onChange={(e) => draft(p, which, e.target.value)} disabled={act.busy} style={{ width: 'auto', minWidth: 130, ...(drafts[p.key]?.[which] !== undefined ? { borderColor: 'var(--accent)', boxShadow: '0 0 0 1px var(--accent)' } : {}) }}>
          {p.kind !== 'global' && <option value="">Inherit ({months(eff)})</option>}
          {options(here ? data.ranges.here : data.ranges.there).map((n) => (
            <option key={n} value={n}>
              {months(n)}
            </option>
          ))}
        </select>
        {inherited && <span className="muted small">Same as {from ?? 'Whole service'}</span>}
        </div>
      );
    return (
      <span>
        <span className={own !== null ? 'strong' : ''}>{months(eff)}</span>
        {own === null && p.kind !== 'global' && <span className="muted small"> · {from ?? 'default'}</span>}
      </span>
    );
  };

  return (
    <Page
      fill
      title="Places & limits"
      actions={
        admin &&
        parents.length > 0 && (
          <button className="btn primary" onClick={() => (act.clear(), setAdding(''))}>
            <Icon name="plus" />
            Add place
          </button>
        )
      }
    >
      <ErrorBanner message={error ?? act.error} onRetry={reload} />
      {loading && !data && <Loading rows={5} />}
      {data && (
        <div className="stats">
          <div className="stat">
            <span className="label">Places</span>
            <span className="value">{items.filter((p) => p.kind !== 'global').length}</span>
          </div>
          <div className="stat">
            <span className="label">HERE default</span>
            <span className="value">{months(data.defaults.here)}</span>
          </div>
          <div className="stat">
            <span className="label">THERE default</span>
            <span className="value">{months(data.defaults.there)}</span>
          </div>
          {me.scope && (
            <div className="stat">
              <span className="label">Your area</span>
              <span className="value clip">{me.scope.name}</span>
            </div>
          )}
        </div>
      )}
      {wholeService && uncovered.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>Uncovered cities</h2>
            <span className="muted small">{uncovered.length}</span>
          </div>
          <div className="row wrap">
            {uncovered.map((u) => (
              <button key={u.cityKey} type="button" className="btn small" disabled={!admin} onClick={() => (act.clear(), setAdding(u.cityKey))}>
                {title(u.cityKey)}
                <span className="muted">{u.uses}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {data && items.length === 0 && <Empty>No places.</Empty>}
      {data && items.length > 0 && (
        <div className="table-wrap">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Place</th>
                  <th style={{ width: 220 }}>Activities</th>
                  <th style={{ width: 220 }}>Trips</th>
                  <th className="end" aria-label="Actions" style={{ width: 200 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p, depth }) => {
                  const kids = items.some((k) => k.parentKey === p.key);
                  return (
                    <tr key={p.key}>
                      <td>
                        <div className="row" style={{ paddingLeft: depth * 20 }}>
                          {kids && p.kind !== 'global' ? (
                            <button type="button" className="icon-btn" onClick={() => toggle(p.key)} aria-expanded={!shut.has(p.key)} aria-label={`${shut.has(p.key) ? 'Show' : 'Hide'} places in ${p.name}`} style={{ minWidth: 26, minHeight: 26, padding: 2 }}>
                              <span style={{ display: 'grid', transform: shut.has(p.key) ? 'rotate(-90deg)' : undefined }}>
                                <Icon name="chevron" />
                              </span>
                            </button>
                          ) : (
                            <span style={{ width: 26, flex: 'none' }} />
                          )}
                          <span className="strong">{p.kind === 'global' ? 'Whole service' : p.name}</span>
                          {p.kind !== 'global' && <span className="chip">{p.kind}</span>}
                          {p.staff > 0 && <span className="muted small">{p.staff} staff</span>}
                        </div>
                      </td>
                      <td>{limit(p, 'hereMonths')}</td>
                      <td>{limit(p, 'thereMonths')}</td>
                      <td className="end" style={{ width: 200 }}>
                        {drafts[p.key] ? (
                          <div className="cell-actions">
                            <button className="btn small" onClick={() => cancel(p)} disabled={act.busy}>
                              Cancel
                            </button>
                            <button className="btn small primary" onClick={() => save(p)} disabled={act.busy}>
                              {act.busy ? 'Saving…' : 'Save'}
                            </button>
                          </div>
                        ) : saved === p.key ? (
                          <Chip value="Saved" tone="ok" icon="check" />
                        ) : (
                          admin && p.canDelete && <RowMenu label={`More for ${p.name}`} items={[{ label: 'Remove', danger: true, onSelect: () => remove(p) }]} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {adding !== null && data && (
        <AddPlace
          data={data}
          parents={parents}
          wholeService={wholeService}
          cityKey={adding}
          busy={act.busy}
          error={act.error}
          onClose={() => setAdding(null)}
          onAdd={(body) => act.run(async () => (await post('/v1/admin/regions', body), setAdding(null)))}
        />
      )}
    </Page>
  );
}

function AddPlace({ data, parents: all, wholeService, cityKey: preset, busy, error, onClose, onAdd }: { data: Reply; parents: Place[]; wholeService: boolean; cityKey: string; busy: boolean; error: string | null; onClose: () => void; onAdd: (body: Record<string, unknown>) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  const [kind, setKind] = useState<'country' | 'region' | 'city'>('city');
  const [name, setName] = useState(preset ? title(preset) : '');
  const [cityKey, setCityKey] = useState(preset);
  const [parent, setParent] = useState('');
  const [hereM, setHereM] = useState('');
  const [thereM, setThereM] = useState('');
  const parents = all.filter((p) => (kind === 'country' ? p.kind === 'global' : true));
  const parentKey = parents.some((p) => p.key === parent) ? parent : (parents[0]?.key ?? '');
  const parentPlace = parents.find((p) => p.key === parentKey);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onAdd({
      name: name.trim(),
      kind,
      parentKey,
      ...(kind === 'city' && cityKey.trim() && { cityKey: cityKey.trim() }),
      ...(hereM && { hereMonths: Number(hereM) }),
      ...(thereM && { thereMonths: Number(thereM) }),
    });
  };
  const monthSelect = (value: string, set: (v: string) => void, range: Range, label: string) => (
    <label>
      {label}
      <select value={value} onChange={(e) => set(e.target.value)} disabled={busy}>
        <option value="">Same as {called(parentPlace)}</option>
        {options(range).map((n) => (
          <option key={n} value={n}>
            {months(n)}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <dialog ref={ref} className="dialog" aria-labelledby="add-place-h" onCancel={(e) => (e.preventDefault(), onClose())}>
      <form onSubmit={submit}>
        <h2 id="add-place-h">Add place</h2>
        <ErrorBanner message={error} />
        <div className="grid-2">
          <label>
            Kind
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} disabled={busy}>
              {wholeService && <option value="country">Country</option>}
              <option value="region">Region</option>
              <option value="city">City</option>
            </select>
          </label>
          <label>
            Inside
            <select value={parentKey} onChange={(e) => setParent(e.target.value)} disabled={busy}>
              {parents.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.kind === 'global' ? 'Whole service' : p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Name
          <input required minLength={2} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        {kind === 'city' && (
          <label>
            Spellings
            <input placeholder={name.trim().toLowerCase() || 'florence, firenze'} maxLength={60} value={cityKey} onChange={(e) => setCityKey(e.target.value.toLowerCase())} />
          </label>
        )}
        <div className="grid-2">
          {monthSelect(hereM, setHereM, data.ranges.here, 'Activities')}
          {monthSelect(thereM, setThereM, data.ranges.there, 'Trips')}
        </div>
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || name.trim().length < 2 || !parentKey}>
            Add
          </button>
        </div>
      </form>
    </dialog>
  );
}
