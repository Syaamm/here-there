import { get, type Session } from '../api';
import { Chip, ErrorBanner, useLoad } from '../ui';

type Place = { key: string; name: string; kind: 'global' | 'country' | 'region' | 'city'; parentKey: string | null };
const KIND: Record<Place['kind'], string> = { global: 'Whole service', country: 'Country', region: 'Region', city: 'City' };

/**
 * Shown right after signing in: which country, region or city do you want to work in? Everything the console lists
 * afterwards (members, reports, activities, trips, identity checks) is only for that place. Staff of the whole service may
 * also choose "Whole service"; staff who look after one area choose that area or a place inside it. A city with nothing
 * under it is chosen for them, so a city admin never sees this screen.
 */
export function PlacePicker({ me, onPick, onSignOut }: { me: Session; onPick: (key: string, name: string) => void; onSignOut: () => void }) {
  const { data, error, loading } = useLoad(() => get<{ items: Place[] }>('/v1/admin/regions'), []);
  const items = data?.items ?? [];
  const byKey = new Map(items.map((p) => [p.key, p]));
  const depth = (p: Place) => {
    let d = 0;
    for (let at: Place | undefined = p; at?.parentKey && byKey.has(at.parentKey) && d < 6; at = byKey.get(at.parentKey)) d++;
    return d;
  };
  const order = (parent: string | null): Place[] => items.filter((p) => (p.parentKey && byKey.has(p.parentKey) ? p.parentKey : null) === parent).flatMap((p) => [p, ...order(p.key)]);
  const tree = order(null).filter((p) => p.kind !== 'global');
  const wholeService = !me.scope;
  const only = tree.length === 1 && !wholeService ? tree[0] : null; // a city with nothing under it: no choice to make

  // nothing to choose between: go straight in
  if (only) queueMicrotask(() => onPick(only.key, only.name));

  return (
    <div className="login-wrap">
      <div className="login card" style={{ width: 'min(520px, 100%)', gap: 14 }} role="group" aria-labelledby="place-h">
        <div className="brand">
          HERE<span>.</span> / THERE<span>.</span>
          <small>Admin console</small>
        </div>
        <div>
          <h1 id="place-h" style={{ fontSize: '1.4rem' }}>
            Where do you want to work?
          </h1>
          <p className="muted small" style={{ margin: '6px 0 0' }}>
            Members, reports, activities, trips and identity checks will show only this place. You can change it any time from the sidebar.
          </p>
        </div>
        <ErrorBanner message={error} />
        {loading && !data && <p className="muted">Loading…</p>}
        {data && (
          <ul className="stack" style={{ maxHeight: '50vh', overflow: 'auto', gap: 8 }}>
            {wholeService && (
              <li>
                <button className="btn" style={{ width: '100%', justifyContent: 'space-between' }} onClick={() => onPick('all', 'Whole service')}>
                  <strong>Whole service</strong>
                  <span className="muted small">every country and city</span>
                </button>
              </li>
            )}
            {tree.map((p) => (
              <li key={p.key} style={{ paddingLeft: Math.max(0, depth(p) - (wholeService ? 1 : 0)) * 16 }}>
                <button className="btn" style={{ width: '100%', justifyContent: 'space-between' }} onClick={() => onPick(p.key, p.name)}>
                  <strong>{!wholeService && p.key === me.scope?.key && p.kind !== 'city' ? `All of ${p.name}` : p.name}</strong>
                  <Chip value={KIND[p.kind]} tone="plain" />
                </button>
              </li>
            ))}
            {tree.length === 0 && <li className="muted">No places have been set up yet. Ask an administrator of the whole service to add them under Places &amp; limits.</li>}
          </ul>
        )}
        <button className="btn small" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}
