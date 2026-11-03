import { useState, type FormEvent } from 'react';
import './Regions.css';
import { api, can, get, post, type Session } from '../api';
import { Empty, ErrorBanner, Icon, Loading, Page, RowMenu, useAction, useLoad } from '../ui';

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
type Which = 'hereMonths' | 'thereMonths';

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
  const order = (parent: string | null): Place[] => items.filter((p) => (p.parentKey && byKey.has(p.parentKey) ? p.parentKey : null) === parent).flatMap((p) => [p, ...order(p.key)]);
  const depthBelow = (p: Place, top: Place) => {
    let d = 0;
    for (let at: Place | undefined = p; at && at.key !== top.key && d < 8; at = at.parentKey ? byKey.get(at.parentKey) : undefined) d++;
    return d;
  };
  const top = items.filter((p) => !(p.parentKey && byKey.has(p.parentKey)));
  const root = top.find((p) => p.kind === 'global');
  const groups = root ? items.filter((p) => p.parentKey === root.key) : top;
  const placeCount = items.filter((p) => p.kind !== 'global').length;
  const uncovered = unassigned.data?.items.length ?? 0;

  const setMonths = (p: Place, which: Which, v: string) => act.run(() => api('PATCH', `/v1/admin/regions/${p.key}`, { [which]: v === '' ? null : Number(v) }));
  const remove = (p: Place) => {
    if (confirm(`Remove ${p.name}? Plans already made keep their dates; new ones follow the place above.`)) act.run(() => api('DELETE', `/v1/admin/regions/${p.key}`));
  };

  // adding a place
  const [shut, setShut] = useState<Set<string>>(new Set()); // countries/regions folded away
  const toggle = (k: string) => setShut((x) => { const n = new Set(x); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'country' | 'region' | 'city'>('city');
  const [parent, setParent] = useState('');
  const [cityKey, setCityKey] = useState('');
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
        ...(hereM && { hereMonths: Number(hereM) }),
        ...(thereM && { thereMonths: Number(thereM) }),
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
  const parentPlace = items.find((p) => p.key === parentKey);
  const showAdd = admin && !!data && parents.length > 0;
  const showUncovered = wholeService && uncovered > 0;
  const hasSide = showAdd || showUncovered;

  /** One limit as a pill: filled when set at this place, dashed with "from X" when it comes from above. Admins change it through the select over the pill. */
  const pill = (p: Place, which: Which) => {
    if (!data) return null;
    const hereSide = which === 'hereMonths';
    const eff = hereSide ? p.effective.here : p.effective.there;
    const from = hereSide ? p.effective.hereFrom : p.effective.thereFrom;
    const range = hereSide ? data.ranges.here : data.ranges.there;
    const label = hereSide ? 'Activities' : 'Trips';
    const own = p[which];
    const editable = admin && p.canEdit;
    const above = p.parentKey ? byKey.get(p.parentKey) : undefined;
    return (
      <span className="rg-limit">
        <small>{hereSide ? 'HERE' : 'THERE'}</small>
        <span className="rg-cell">
          <span className={own !== null ? 'rg-pill set' : 'rg-pill inherited'}>
            {months(eff)}
            {editable && (
              <select aria-label={`${label} limit for ${p.name}`} value={own ?? ''} onChange={(e) => setMonths(p, which, e.target.value)} disabled={act.busy}>
                {p.kind !== 'global' && <option value="">Same as {called(above)} ({months(eff)})</option>}
                {options(range).map((n) => (
                  <option key={n} value={n}>
                    {months(n)}
                  </option>
                ))}
              </select>
            )}
          </span>
          {own === null && <span className="rg-from">{from ? `from ${from}` : 'from default'}</span>}
        </span>
      </span>
    );
  };
  const meta = (p: Place) => (
    <>
      {p.staff > 0 && <span className="rg-sub">{p.staff} staff</span>}
      {p.cityKey && p.cityKey !== p.name.toLowerCase() && <span className="rg-sub">plans filed as “{p.cityKey}”</span>}
    </>
  );
  const menu = (p: Place) => (admin && p.canDelete ? <RowMenu label={`More actions for ${p.name}`} items={[{ label: 'Remove place', danger: true, onSelect: () => remove(p) }]} /> : null);

  const tiles = data && (
    <div className="rg-tiles">
      <div className="rg-tile">
        <small>Places</small>
        <b>{placeCount}</b>
        <span>countries, regions and cities</span>
      </div>
      <div className="rg-tile">
        <small>Activities (HERE) default</small>
        <b>{months(data.defaults.here)}</b>
        <span>for anywhere not listed</span>
      </div>
      <div className="rg-tile">
        <small>Trips (THERE) default</small>
        <b>{months(data.defaults.there)}</b>
        <span>for anywhere not listed</span>
      </div>
      {wholeService ? (
        <button type="button" className={uncovered > 0 ? 'rg-tile warn' : 'rg-tile'} disabled={uncovered === 0} onClick={() => document.getElementById('rg-uncovered')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
          <small>Cities nobody covers</small>
          <b>{uncovered}</b>
          <span>{uncovered > 0 ? 'Add them under a country →' : 'Every city has a place'}</span>
        </button>
      ) : (
        <div className="rg-tile">
          <small>Your area</small>
          <b className="rg-tile-name">{me.scope?.name}</b>
          <span>{me.scope?.kind}</span>
        </div>
      )}
    </div>
  );

  return (
    <Page
      fill
      title="How far ahead people can plan"
      sub={me.scope ? `You look after ${me.scope.name}. Set how far ahead plans may be made there.` : 'Each place uses its own limit, or the one from the place above it. Activities follow the city they’re in; trips follow the city they start from.'}
      actions={
        <span className="rg-legend" aria-label="Legend">
          <span className="rg-pill set">2 mo</span> set here <span className="rg-pill inherited">1 mo</span> passed down
        </span>
      }
    >
      <ErrorBanner message={error ?? act.error} onRetry={reload} />
      {loading && !data && <Loading rows={5} />}
      {data && items.length === 0 && <Empty>No places to show.</Empty>}
      {tiles}
      {data && items.length > 0 && (
        <div className={hasSide ? 'rg-layout' : 'rg-layout solo'}>
          <div className="rg-main">
            <div className="rg-colhead" aria-hidden="true">
              <span>Place</span>
              <span>Activities (HERE) up to</span>
              <span>Trips (THERE) up to</span>
              <span />
            </div>
            {root && (
              <section className="rg-root" aria-label="Whole service">
                <div className="rg-root-name">
                  <strong>Whole service</strong>
                  <span className="rg-sub">Built-in default for anywhere not listed</span>
                </div>
                <div className="rg-pills">
                  {pill(root, 'hereMonths')}
                  {pill(root, 'thereMonths')}
                </div>
              </section>
            )}
            {groups.map((g) => {
              const kids = order(g.key);
              const closed = shut.has(g.key);
              return (
                <section key={g.key} className="rg-group" aria-label={g.name}>
                  <header className="rg-prow country">
                    <div className="rg-pname">
                      {kids.length > 0 ? (
                        <button type="button" className={closed ? 'rg-fold shut' : 'rg-fold'} onClick={() => toggle(g.key)} aria-expanded={!closed} aria-label={`${closed ? 'Show' : 'Hide'} places in ${g.name}`}>
                          <Icon name="chevron" />
                        </button>
                      ) : (
                        <span className="rg-fold none" />
                      )}
                      <strong>{g.name}</strong>
                      <span className="rg-kind">{g.kind}</span>
                      {meta(g)}
                    </div>
                    {pill(g, 'hereMonths')}
                    {pill(g, 'thereMonths')}
                    <span className="rg-menu">{menu(g)}</span>
                  </header>
                  {kids.length > 0 && !closed && (
                    <ul className="rg-kids">
                      {kids.map((p) => (
                        <li key={p.key} className={`rg-prow rg-krow level-${p.kind}`} style={{ paddingLeft: 20 + (depthBelow(p, g) - 1) * 28 }}>
                          <div className="rg-pname">
                            <strong>{p.name}</strong>
                            <span className="rg-kind">{p.kind}</span>
                            {meta(p)}
                          </div>
                          {pill(p, 'hereMonths')}
                          {pill(p, 'thereMonths')}
                          <span className="rg-menu">{menu(p)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>

          {hasSide && (
            <aside className="rg-side">
              {showAdd && data && (
                <form className="rg-add" onSubmit={add} aria-labelledby="add-place">
                  <h2 id="add-place">Add a place</h2>
                  <label>
                    <span>Kind</span>
                    <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} disabled={act.busy} aria-label="Kind of place">
                      {wholeService && <option value="country">Country</option>}
                      <option value="region">Region</option>
                      <option value="city">City</option>
                    </select>
                  </label>
                  <label>
                    <span>Name</span>
                    <input id="place-name" required minLength={2} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Florence" aria-label="Name" />
                  </label>
                  <label>
                    <span>Inside</span>
                    <select value={parentKey} onChange={(e) => setParent(e.target.value)} disabled={act.busy} aria-label="Part of">
                      {parents.map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.kind === 'global' ? 'Whole service' : p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="rg-two">
                    <label>
                      <span>Activities up to</span>
                      <select value={hereM} onChange={(e) => setHereM(e.target.value)} disabled={act.busy} aria-label="Activities up to">
                        <option value="">Same as {called(parentPlace)}</option>
                        {options(data.ranges.here).map((n) => (
                          <option key={n} value={n}>
                            {months(n)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Trips up to</span>
                      <select value={thereM} onChange={(e) => setThereM(e.target.value)} disabled={act.busy} aria-label="Trips up to">
                        <option value="">Same as {called(parentPlace)}</option>
                        {options(data.ranges.there).map((n) => (
                          <option key={n} value={n}>
                            {months(n)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {kind === 'city' && (
                    <label>
                      <span>People type it as · add each spelling</span>
                      <input placeholder={name.trim().toLowerCase() || 'florence, firenze'} maxLength={60} value={cityKey} onChange={(e) => setCityKey(e.target.value.toLowerCase())} />
                    </label>
                  )}
                  <button className="rg-submit" disabled={act.busy || name.trim().length < 2 || !parentKey}>
                    Add place
                  </button>
                </form>
              )}

              {showUncovered && unassigned.data && (
                <section className="rg-uncovered" id="rg-uncovered" aria-labelledby="unassigned-h">
                  <h2 id="unassigned-h">Cities nobody covers yet</h2>
                  <p>People have made plans in these cities, but no place has them, so they follow the whole service and no area admin can see them. Click one to add it under its country or region.</p>
                  <ul>
                    {unassigned.data.items.map((u) => (
                      <li key={u.cityKey}>
                        <button type="button" onClick={() => useCity(u.cityKey)} disabled={!admin}>
                          {u.cityKey} <b>{u.uses}</b>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </aside>
          )}
        </div>
      )}
    </Page>
  );
}
