import { get, type Session } from '../api';
import { ErrorBanner, Icon, Loading, useLoad } from '../ui';
import { AuthShell } from '../AuthShell';
import './PlacePicker.css';

type Place = { key: string; name: string; kind: 'global' | 'country' | 'region' | 'city'; parentKey: string | null };
const KIND: Record<Place['kind'], string> = { global: 'Whole service', country: 'Country', region: 'Region', city: 'City' };
/** A round badge with the first letters of the place's name. */
function Badge({ name, kind }: { name: string; kind: Place['kind'] }) {
  return (
    <i className={`pp-badge ${kind}`} aria-hidden="true">
      {name
        .replace(/[^A-Za-zÀ-ÿ ]/g, '')
        .split(/\s+/)
        .map((w) => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()}
    </i>
  );
}

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
  // the whole-service entry is the top of the tree: countries sit directly under it and are shown as the first level
  const isRoot = (p: Place) => !p.parentKey || !byKey.has(p.parentKey) || byKey.get(p.parentKey)!.kind === 'global';
  const roots = items.filter((p) => p.kind !== 'global' && isRoot(p));
  const kidsOf = (key: string) => items.filter((p) => p.kind !== 'global' && p.parentKey === key);
  const tree = items.filter((p) => p.kind !== 'global');
  const wholeService = !me.scope;
  const only = tree.length === 1 && !wholeService ? tree[0] : null; // a city with nothing under it: no choice to make

  // nothing to choose between: go straight in
  if (only) queueMicrotask(() => onPick(only.key, only.name));

  /** One place and, inside it, the places under it, drawn as a tree. */
  const place = (p: Place) => {
    const kids = kidsOf(p.key);
    return (
      <li key={p.key}>
        <button className="pp-place" onClick={() => onPick(p.key, p.name)}>
          <Badge name={p.name} kind={p.kind} />
          <span className="pp-text">
            <span className="pp-name">{!wholeService && p.key === me.scope?.key && p.kind !== 'city' ? `All of ${p.name}` : p.name}</span>
            <span className="pp-kind">{KIND[p.kind]}</span>
          </span>
          <span className="pp-arrow" aria-hidden="true">
            <Icon name="arrow" />
          </span>
        </button>
        {kids.length > 0 && <ul className="pp-children">{kids.map((k) => place(k))}</ul>}
      </li>
    );
  };

  return (
    <AuthShell headline="Where do you work today?" sub="Pick a place and the console shows only its people, plans and reports. You can switch any time from the sidebar.">
      <div className="pp-card" role="group" aria-labelledby="place-h">
        <div className="pp-head">
          <p className="pp-eyebrow">Your workspace</p>
          <h1 id="place-h" className="pp-title">
            Where do you want to work?
          </h1>
          <p className="pp-sub">Members, reports, activities, trips and identity checks will show only this place.</p>
        </div>
        <ErrorBanner message={error} />
        {loading && !data && <Loading rows={5} />}
        {data && (
          <ul className="pp-list">
            {wholeService && (
              <li>
                <button className="pp-place first" onClick={() => onPick('all', 'Whole service')}>
                  <i className="pp-badge global" aria-hidden="true">
                    <Icon name="layers" />
                  </i>
                  <span className="pp-text">
                    <span className="pp-name">Whole service</span>
                    <span className="pp-hint">Every country and city</span>
                  </span>
                  <span className="pp-arrow" aria-hidden="true">
                    <Icon name="arrow" />
                  </span>
                </button>
              </li>
            )}
            {wholeService && roots.length > 0 && <li className="pp-or" aria-hidden="true">or choose a place</li>}
            {roots.map((p) => place(p))}
            {tree.length === 0 && <li className="pp-empty">No places have been set up yet. Ask an administrator of the whole service to add them under Places &amp; limits.</li>}
          </ul>
        )}
        <button className="lg-link pp-out" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </AuthShell>
  );
}
