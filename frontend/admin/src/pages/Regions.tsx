import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, can, get, post, type Session } from '../api';
import { Select, useBackdropClose } from '../controls';
import { Empty, ErrorBanner, Icon, Loading, Page, PageBar, RowMenu, Search, useAction, useLoad, Chip } from '../ui';

type Place = {
  key: string;
  name: string;
  kind: 'global' | 'country' | 'region' | 'city';
  parentKey: string | null;
  cityKey: string | null;
  hereMonths: number | null;
  thereMonths: number | null;
  areaKm: number | null;
  effective: { here: number; hereFrom: string | null; there: number; thereFrom: string | null; area: number; areaFrom: string | null };
  children: number;
  staff: number;
  canEdit: boolean;
  canDelete: boolean;
};
type Range = { min: number; max: number };
type Reply = { scope: { key: string; name: string; kind: string } | null; defaults: { here: number; there: number; area: number }; ranges: { here: Range; there: Range; area: Range }; items: Place[] };
type Unassigned = { items: { cityKey: string; uses: number }[] };
type Which = 'hereMonths' | 'thereMonths' | 'areaKm';

const months = (n: number) => `${n} mo`;
const kms = (n: number) => `${n} km`;
/** Coverage choices: every 5 km up to 100, plus 1, 2, 3 and 10 for small towns. */
const AREA_CHOICES = [1, 2, 3, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100];
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
  const [adding, setAdding] = useState<string | null>(null); // null = closed; '' = blank; a city key = prefilled

  const [cq, setCq] = useState('');
  const cities = items.filter((p) => p.kind === 'city' && p.name.toLowerCase().includes(cq.trim().toLowerCase()));
  const root = items.find((p) => p.kind === 'global') ?? null;
  const [cityPage, setCityPage] = useState(1);
  useEffect(() => setCityPage(1), [cq]);
  const CITY_PAGE = 10;
  const cityPages = Math.max(1, Math.ceil(cities.length / CITY_PAGE));
  const shownCities = cities.slice((Math.min(cityPage, cityPages) - 1) * CITY_PAGE, Math.min(cityPage, cityPages) * CITY_PAGE);

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
  const customCities = items.filter((p) => p.kind === 'city' && (p.hereMonths !== null || p.thereMonths !== null || p.areaKm !== null)).length;
  const resetCities = () => {
    if (customCities === 0) return;
    if (confirm(`Make ${customCities} ${customCities === 1 ? 'city' : 'cities'} follow the default again? Their own values will be cleared.`)) act.run(() => api('POST', '/v1/admin/regions/reset-city-limits'));
  };
  const parents = items.filter((p) => p.canEdit || (me.scope && p.key === me.scope.key)).filter((p) => p.kind !== 'city');
  const uncovered = unassigned.data?.items ?? [];

  const limit = (p: Place, which: Which) => {
    if (!data) return null;
    const here = which === 'hereMonths';
    const area = which === 'areaKm';
    const eff = area ? p.effective.area : here ? p.effective.here : p.effective.there;
    const own = p[which];
    if (admin && p.canEdit)
      return (
        <div style={{ display: 'grid', gap: 4, justifyItems: 'start' }}>
        <Select aria-label={`${area ? 'Coverage distance' : here ? 'Activities limit' : 'Trips limit'} for ${p.name}`} value={drafts[p.key]?.[which] ?? String(own ?? eff)} onChange={(v) => draft(p, which, v)} disabled={act.busy} highlight={drafts[p.key]?.[which] !== undefined} style={{ width: 172 }}>
          {(area ? [...new Set([...AREA_CHOICES, eff])].sort((a, b) => a - b) : options(here ? data.ranges.here : data.ranges.there)).map((n) => (
            <option key={n} value={n}>
              {area ? kms(n) : months(n)}
            </option>
          ))}
        </Select>
        </div>
      );
    return (
      <span>
        <span className={own !== null ? 'strong' : ''}>{area ? kms(eff) : months(eff)}</span>
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
            Add city
          </button>
        )
      }
    >
      <ErrorBanner message={error ?? act.error} onRetry={reload} />
      {loading && !data && <Loading rows={5} />}
      {data && me.scope && (
        <div className="stats">
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
        <>
          {root && (
            <section className="card ret-default" aria-label="Default retention">
              <div>
                <h2 style={{ margin: 0 }}>Data retention</h2>
                <p className="muted small" style={{ margin: '4px 0 0' }}>How long activity and trip data are kept. Every city follows this default unless it has its own value.</p>
              </div>
              <div className="ret-default-set">
                <label>
                  <span className="label">Activities</span>
                  {limit(root, 'hereMonths')}
                </label>
                <label>
                  <span className="label">Trips</span>
                  {limit(root, 'thereMonths')}
                </label>
                <label>
                  <span className="label">Coverage around a city</span>
                  {limit(root, 'areaKm')}
                </label>
                {drafts[root.key] ? (
                  <div className="cell-actions">
                    <button className="btn small" onClick={() => cancel(root)} disabled={act.busy}>Cancel</button>
                    <button className="btn small primary" onClick={() => save(root)} disabled={act.busy}>{act.busy ? 'Saving…' : 'Save'}</button>
                  </div>
                ) : (
                  saved === root.key && <Chip value="Saved" tone="ok" icon="check" />
                )}
                {admin && (
                  <button className="btn ret-reset" onClick={resetCities} disabled={act.busy || customCities === 0} title="Clear every city's own value so all cities follow the default">
                    Reset all cities to the default
                    {customCities > 0 && <span className="ret-reset-n">{customCities}</span>}
                  </button>
                )}
              </div>
            </section>
          )}
          <div className="toolbar">
            <div className="grow">
              <Search label="Search cities" placeholder="Search cities" value={cq} onChange={setCq} />
            </div>
            <span className="ret-legend">
              <span><i className="ret-dot on" /> Custom value</span>
              <span><i className="ret-dot" /> Default value</span>
            </span>
          </div>
          {cities.length === 0 ? (
            <Empty>{cq ? 'No city matches.' : 'No cities yet.'}</Empty>
          ) : (
            <div className="table-wrap">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>City</th>
                      <th style={{ width: 380 }}>Activities</th>
                      <th style={{ width: 380 }}>Trips</th>
                      <th style={{ width: 220 }}>Coverage</th>
                      <th className="end" aria-label="Actions" style={{ width: 160 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {shownCities.map((p) => (
                      <tr key={p.key}>
                        <td>
                          <div className="row">
                            <span className="strong">{p.name}</span>
                            {p.staff > 0 && <span className="muted small">{p.staff} staff</span>}
                          </div>
                        </td>
                        <td>
                          <span className="ret-cell"><i className={p.hereMonths !== null || drafts[p.key]?.hereMonths !== undefined ? 'ret-dot on' : 'ret-dot'} />{limit(p, 'hereMonths')}</span>
                        </td>
                        <td>
                          <span className="ret-cell"><i className={p.thereMonths !== null || drafts[p.key]?.thereMonths !== undefined ? 'ret-dot on' : 'ret-dot'} />{limit(p, 'thereMonths')}</span>
                        </td>
                        <td>
                          <span className="ret-cell"><i className={p.areaKm !== null || drafts[p.key]?.areaKm !== undefined ? 'ret-dot on' : 'ret-dot'} />{limit(p, 'areaKm')}</span>
                        </td>
                        <td className="end">
                          {drafts[p.key] ? (
                            <div className="cell-actions">
                              <button className="btn small" onClick={() => cancel(p)} disabled={act.busy}>Cancel</button>
                              <button className="btn small primary" onClick={() => save(p)} disabled={act.busy}>{act.busy ? 'Saving…' : 'Save'}</button>
                            </div>
                          ) : saved === p.key ? (
                            <Chip value="Saved" tone="ok" icon="check" />
                          ) : (
                            admin && p.canDelete && <RowMenu
                              label={`More for ${p.name}`}
                              items={[
                                ...(p.hereMonths !== null ? [{ label: 'Use the default for activities', onSelect: () => act.run(() => api('PATCH', `/v1/admin/regions/${p.key}`, { hereMonths: null })) }] : []),
                                ...(p.thereMonths !== null ? [{ label: 'Use the default for trips', onSelect: () => act.run(() => api('PATCH', `/v1/admin/regions/${p.key}`, { thereMonths: null })) }] : []),
                                ...(p.areaKm !== null ? [{ label: 'Use the default coverage', onSelect: () => act.run(() => api('PATCH', `/v1/admin/regions/${p.key}`, { areaKm: null })) }] : []),
                                { label: 'Remove', danger: true, onSelect: () => remove(p) },
                              ]}
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <PageBar page={Math.min(cityPage, cityPages)} pages={cityPages} total={cities.length} noun={['city', 'cities']} onPage={setCityPage} />
            </div>
          )}
        </>
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
  const backdrop = useBackdropClose(ref, onClose); // a click on the dark area closes it
  const [name, setName] = useState(preset ? title(preset) : '');
  const [cityKey, setCityKey] = useState(preset);
  const [hereM, setHereM] = useState('');
  const [thereM, setThereM] = useState('');
  const [areaK, setAreaK] = useState('');
  // a new city sits directly under the default (a staff member's area: under that area)
  const parentPlace = all.find((p) => p.kind === 'global') ?? all[0];
  const parentKey = parentPlace?.key ?? '';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onAdd({
      name: name.trim(),
      kind: 'city',
      parentKey,
      ...(cityKey.trim() && { cityKey: cityKey.trim() }),
      ...(hereM && { hereMonths: Number(hereM) }),
      ...(thereM && { thereMonths: Number(thereM) }),
      ...(areaK && { areaKm: Number(areaK) }),
    });
  };
  const monthSelect = (value: string, set: (v: string) => void, range: Range, label: string) => (
    <label>
      {label}
      <Select value={value} onChange={set} disabled={busy}>
        <option value="">Same as the default ({months(label === 'Activities' ? data.defaults.here : data.defaults.there)})</option>
        {options(range).map((n) => (
          <option key={n} value={n}>
            {months(n)}
          </option>
        ))}
      </Select>
    </label>
  );
  return (
    <dialog ref={ref} className="dialog" aria-labelledby="add-place-h" onCancel={(e) => (e.preventDefault(), onClose())} {...backdrop}>
      <form onSubmit={submit}>
        <h2 id="add-place-h">Add city</h2>
        <p className="muted small" style={{ margin: 0 }}>A city follows the default retention unless you give it its own.</p>
        <ErrorBanner message={error} />
        <label>
          City name
          <input required minLength={2} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label>
          Other spellings
          <input placeholder={name.trim().toLowerCase() || 'florence, firenze'} maxLength={60} value={cityKey} onChange={(e) => setCityKey(e.target.value.toLowerCase())} />
        </label>
        <div className="grid-2">
          {monthSelect(hereM, setHereM, data.ranges.here, 'Activities')}
          {monthSelect(thereM, setThereM, data.ranges.there, 'Trips')}
        </div>
        <label>
          Coverage around the city
          <Select value={areaK} onChange={setAreaK} disabled={busy}>
            <option value="">Same as the default ({kms(data.defaults.area)})</option>
            {AREA_CHOICES.map((n) => (
              <option key={n} value={n}>
                {kms(n)}
              </option>
            ))}
          </Select>
        </label>
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || name.trim().length < 2 || !parentKey}>
            Add city
          </button>
        </div>
      </form>
    </dialog>
  );
}
