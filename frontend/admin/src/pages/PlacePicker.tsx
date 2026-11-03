import { useEffect, useRef } from 'react';
import { get } from '../api';
import { ErrorBanner, Icon, Loading, useLoad } from '../ui';
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
 * Only the administrator of the whole service has this, and only when they ask for it ("Switch" in the sidebar): nobody is
 * made to choose a place after signing in. It opens over the console, lists the whole service, then every country, region and
 * city as a tree, and one click moves the console there. Staff who look after one area never see it: the server already keeps
 * them inside their area.
 */
export function PlaceSwitcher({ current, onPick, onClose }: { current: string; onPick: (key: string, name: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { data, error, loading } = useLoad(() => get<{ items: Place[] }>('/v1/admin/regions'), []);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const items = data?.items ?? [];
  const byKey = new Map(items.map((p) => [p.key, p]));
  // the whole-service entry is the top of the tree: countries sit directly under it and are shown as the first level
  const isRoot = (p: Place) => !p.parentKey || !byKey.has(p.parentKey) || byKey.get(p.parentKey)!.kind === 'global';
  const roots = items.filter((p) => p.kind !== 'global' && isRoot(p));
  const kidsOf = (key: string) => items.filter((p) => p.kind !== 'global' && p.parentKey === key);
  const tree = items.filter((p) => p.kind !== 'global');

  /** One place and, inside it, the places under it, drawn as a tree. */
  const place = (p: Place) => {
    const kids = kidsOf(p.key);
    return (
      <li key={p.key}>
        <button className={p.key === current ? 'pp-place here' : 'pp-place'} aria-current={p.key === current ? 'true' : undefined} onClick={() => onPick(p.key, p.name)}>
          <Badge name={p.name} kind={p.kind} />
          <span className="pp-text">
            <span className="pp-name">{p.name}</span>
            <span className="pp-kind">{KIND[p.kind]}</span>
          </span>
          {p.key === current ? (
            <span className="pp-now">Here now</span>
          ) : (
            <span className="pp-arrow" aria-hidden="true">
              <Icon name="arrow" />
            </span>
          )}
        </button>
        {kids.length > 0 && <ul className="pp-children">{kids.map((k) => place(k))}</ul>}
      </li>
    );
  };

  return (
    <dialog ref={ref} className="pp-dialog" aria-labelledby="place-h" onCancel={(e) => (e.preventDefault(), onClose())} onClick={(e) => e.target === ref.current && onClose()}>
      <div className="pp-card">
        <div className="pp-head">
          <p className="pp-eyebrow">Switch place</p>
          <h1 id="place-h" className="pp-title">
            Where do you want to work?
          </h1>
          <p className="pp-sub">Members, reports, activities, trips and identity checks show only the place you pick. Whole service shows everything.</p>
        </div>
        <ErrorBanner message={error} />
        {loading && !data ? (
          <Loading rows={5} />
        ) : (
          <ul className="pp-list">
            <li>
              <button className={current === 'all' ? 'pp-place first here' : 'pp-place first'} aria-current={current === 'all' ? 'true' : undefined} onClick={() => onPick('all', 'Whole service')}>
                <i className="pp-badge global" aria-hidden="true">
                  <Icon name="layers" />
                </i>
                <span className="pp-text">
                  <span className="pp-name">Whole service</span>
                  <span className="pp-hint">Every country and city</span>
                </span>
                {current === 'all' ? (
                  <span className="pp-now">Here now</span>
                ) : (
                  <span className="pp-arrow" aria-hidden="true">
                    <Icon name="arrow" />
                  </span>
                )}
              </button>
            </li>
            {roots.length > 0 && (
              <li className="pp-or" aria-hidden="true">
                or choose a place
              </li>
            )}
            {roots.map((p) => place(p))}
            {data && tree.length === 0 && <li className="pp-empty">No places have been set up yet. Add them under Places &amp; limits.</li>}
          </ul>
        )}
        <button className="lg-link pp-out" onClick={onClose}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
