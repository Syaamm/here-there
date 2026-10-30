import { useState, type FormEvent } from 'react';
import { api, can, get, post, type Session } from '../api';
import { Chip, Empty, ErrorBanner, Icon, Page, useAction, useLoad } from '../ui';

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
type Reply = { scope: { key: string; name: string; kind: string } | null; defaults: { here: number; there: number }; ranges: { here: { min: number; max: number }; there: { min: number; max: number } }; items: Place[] };
type Unassigned = { items: { cityKey: string; uses: number }[] };

const KIND: Record<Place['kind'], string> = { global: 'Whole service', country: 'Country', region: 'Region', city: 'City' };
const months = (n: number) => `${n} ${n === 1 ? 'month' : 'months'}`;
/** How a place is named in "Same as ...": the whole service reads as plain words, any other place by its name. */
const called = (p?: { kind: string; name: string }) => (!p || p.kind === 'global' ? 'whole service' : p.name);
const title = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());

/**
 * Where the planning limits are set. How far ahead an activity (HERE) or a trip (THERE) may be planned is set per place: the
 * whole service, a country, a region or a city. A place that sets nothing follows the place above it. An administrator who
 * looks after one area sees and changes only that area and what is under it.
 */
export function RegionsPage({ me }: { me: Session }) {
  const { data, error, loading, reload } = useLoad(() => get<Reply>('/v1/admin/regions'), []);
  const wholeService = !me.scope;
  const unassigned = useLoad(() => (wholeService ? get<Unassigned>('/v1/admin/regions/unassigned') : Promise.resolve<Unassigned>({ items: [] })), [wholeService]);
  const act = useAction(() => (reload(), unassigned.reload()));
  const admin = can.admin(me.role);
  const items = data?.items ?? [];
  const byKey = new Map(items.map((p) => [p.key, p]));
  // draw the places as a tree: each one right under the place it belongs to
  const depth = (p: Place) => {
    let d = 0;
    for (let at: Place | undefined = p; at?.parentKey && d < 6; at = byKey.get(at.parentKey)) d++;
    return d;
  };
  const order = (parent: string | null): Place[] => items.filter((p) => (p.parentKey && byKey.has(p.parentKey) ? p.parentKey : null) === parent).flatMap((p) => [p, ...order(p.key)]);
  const tree = order(null);

  const setMonths = (p: Place, which: 'hereMonths' | 'thereMonths', v: string) => act.run(() => api('PATCH', `/v1/admin/regions/${p.key}`, { [which]: v === '' ? null : Number(v) }));
  const remove = (p: Place) => {
    if (confirm(`Remove ${p.name}? Plans already made keep their dates; new ones follow the place above.`)) act.run(() => api('DELETE', `/v1/admin/regions/${p.key}`));
  };

  // adding a place
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'country' | 'region' | 'city'>('city');
  const [parent, setParent] = useState('');
  const [cityKey, setCityKey] = useState('');
  // which limit the new place sets: activities (HERE), trips (THERE) or both (whole service); the other follows the place above
  const [applies, setApplies] = useState<'here' | 'there' | 'both'>('both');
  const [hereM, setHereM] = useState('');
  const [thereM, setThereM] = useState('');
  const parents = items.filter((p) => p.canEdit || (me.scope && p.key === me.scope.key)).filter((p) => p.kind !== 'city' && (kind === 'country' ? p.kind === 'global' : true));
  const parentKey = parents.some((p) => p.key === parent) ? parent : (parents[0]?.key ?? '');
  const add = (e: FormEvent) => {
    e.preventDefault();
    act.run(async () => {
      await post('/v1/admin/regions', {
        name: name.trim(),
        kind,
        parentKey,
        ...(kind === 'city' && cityKey.trim() && { cityKey: cityKey.trim() }),
        ...(applies !== 'there' && hereM && { hereMonths: Number(hereM) }),
        ...(applies !== 'here' && thereM && { thereMonths: Number(thereM) }),
      });
      setName('');
      setCityKey('');
      setHereM('');
      setThereM('');
    });
  };
  const useCity = (key: string) => {
    setKind('city');
    setName(title(key));
    setCityKey(key);
    document.getElementById('place-name')?.focus();
  };

  const options = (range: { min: number; max: number }) => Array.from({ length: range.max - range.min + 1 }, (_, i) => range.min + i);

  return (
    <Page
      title="Places & limits"
      sub={me.scope ? `You look after ${me.scope.name}. Set how far ahead plans may be made there.` : 'How far ahead activities (HERE) and trips (THERE) may be planned, for each country, region and city. A place with nothing set follows the place above it.'}
    >
      <ErrorBanner message={error ?? act.error} />
      {loading && !data && <p className="muted">Loading…</p>}
      {data && (
        <p className="muted small" style={{ margin: 0 }}>
          Built-in defaults: activities {months(data.defaults.here)}, trips {months(data.defaults.there)}. An activity follows the limit of the city it is in; a trip follows the city it starts from.
        </p>
      )}
      {data && tree.length === 0 && <Empty>No places to show.</Empty>}
      {tree.length > 0 && (
        <div className="table-wrap">
          <div className="table-scroll">
            <table>
              <caption className="sr">Places and how far ahead plans may be made in each</caption>
              <thead>
                <tr>
                  <th>Place</th>
                  <th>Activities (HERE) up to</th>
                  <th>Trips (THERE) up to</th>
                  <th>Staff</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tree.map((p) => {
                  const above = p.parentKey ? byKey.get(p.parentKey) : undefined;
                  const editable = admin && p.canEdit;
                  const cell = (which: 'hereMonths' | 'thereMonths', eff: number, from: string | null, range: { min: number; max: number }, label: string) => {
                    const own = p[which];
                    return (
                      <td>
                        {editable ? (
                          <select aria-label={`${label} limit for ${p.name}`} value={own ?? ''} onChange={(e) => setMonths(p, which, e.target.value)} disabled={act.busy} style={{ minWidth: 150 }}>
                            {p.kind !== 'global' && <option value="">Same as {called(above)} ({months(eff)})</option>}
                            {options(range).map((n) => (
                              <option key={n} value={n}>
                                {months(n)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          months(eff)
                        )}
                        <div className="muted small">{own !== null ? 'set here' : from ? `from ${from}` : 'default'}</div>
                      </td>
                    );
                  };
                  return (
                    <tr key={p.key}>
                      <td>
                        <div style={{ paddingLeft: depth(p) * 18 }}>
                          <strong>{p.name}</strong> {p.kind !== 'global' && <Chip value={KIND[p.kind]} tone="plain" />}
                          {p.cityKey && p.cityKey !== p.name.toLowerCase() && <div className="muted small">plans filed as “{p.cityKey}”</div>}
                        </div>
                      </td>
                      {cell('hereMonths', p.effective.here, p.effective.hereFrom, data!.ranges.here, 'Activities')}
                      {cell('thereMonths', p.effective.there, p.effective.thereFrom, data!.ranges.there, 'Trips')}
                      <td>{p.staff > 0 ? `${p.staff}` : '–'}</td>
                      <td>
                        {admin && p.canDelete && (
                          <button className="btn small" onClick={() => remove(p)} disabled={act.busy} aria-label={`Remove ${p.name}`}>
                            Remove
                          </button>
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

      {admin && data && parents.length > 0 && (
        <form className="card" onSubmit={add} style={{ display: 'grid', gap: 10 }} aria-labelledby="add-place">
          <h2 id="add-place" style={{ margin: 0, fontSize: 16 }}>
            Add a place
          </h2>
          <div className="row wrap" style={{ alignItems: 'end' }}>
            <label>
              Kind
              <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} disabled={act.busy}>
                {wholeService && <option value="country">Country</option>}
                <option value="region">Region</option>
                <option value="city">City</option>
              </select>
            </label>
            <label>
              In
              <select value={applies} onChange={(e) => setApplies(e.target.value as typeof applies)} disabled={act.busy}>
                <option value="here">HERE</option>
                <option value="there">THERE</option>
                <option value="both">Whole service</option>
              </select>
            </label>
            <label>
              Part of
              <select value={parentKey} onChange={(e) => setParent(e.target.value)} disabled={act.busy}>
                {parents.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {applies !== 'there' && (
              <label>
                Activities up to
                <select value={hereM} onChange={(e) => setHereM(e.target.value)} disabled={act.busy}>
                  <option value="">Same as {called(items.find((p) => p.key === parentKey))}</option>
                  {options(data.ranges.here).map((n) => (
                    <option key={n} value={n}>
                      {months(n)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {applies !== 'here' && (
              <label>
                Trips up to
                <select value={thereM} onChange={(e) => setThereM(e.target.value)} disabled={act.busy}>
                  <option value="">Same as {called(items.find((p) => p.key === parentKey))}</option>
                  {options(data.ranges.there).map((n) => (
                    <option key={n} value={n}>
                      {months(n)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Name
              <input id="place-name" required minLength={2} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            {kind === 'city' && (
              <label>
                Plans are filed under
                <input placeholder={name.trim().toLowerCase() || 'the city name'} maxLength={60} value={cityKey} onChange={(e) => setCityKey(e.target.value.toLowerCase())} />
              </label>
            )}
            <button className="btn primary" disabled={act.busy || name.trim().length < 2 || !parentKey}>
              <Icon name="plus" /> Add
            </button>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            “In” says which limit this place sets: activities (HERE), trips (THERE) or both; the other follows the place it is part of. A city is matched by the name people type for it (for example “milan”). If people spell it two ways, add both as cities.
          </p>
        </form>
      )}

      {wholeService && unassigned.data && unassigned.data.items.length > 0 && (
        <section className="card" aria-labelledby="unassigned-h" style={{ display: 'grid', gap: 8 }}>
          <h2 id="unassigned-h" style={{ margin: 0, fontSize: 16 }}>
            Cities nobody covers yet
          </h2>
          <p className="muted small" style={{ margin: 0 }}>
            People have made plans in these cities, but no place has them, so they follow the whole service and no area admin can see them. Add each one under its country or region.
          </p>
          <ul className="row wrap" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {unassigned.data.items.map((u) => (
              <li key={u.cityKey}>
                <button type="button" className="btn small" onClick={() => useCity(u.cityKey)} disabled={!admin}>
                  {u.cityKey} · {u.uses}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Page>
  );
}
