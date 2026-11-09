import { useEffect, useRef, useState } from 'react';
import { get } from '../api';
import { useBackdropClose } from '../controls';
import { ErrorBanner, Icon, Loading, useLoad } from '../ui';

type Place = { key: string; name: string; kind: 'global' | 'country' | 'region' | 'city'; parentKey: string | null };

/** Admin of the whole service only: move the console to one country, region or city, or back to the whole service. */
export function PlaceSwitcher({ current, onPick, onClose }: { current: string; onPick: (key: string, name: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState('');
  const { data, error, loading } = useLoad(() => get<{ items: Place[] }>('/v1/admin/regions'), []);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const backdrop = useBackdropClose(ref, onClose); // a click on the dark area closes it
  const items = data?.items ?? [];
  const byKey = new Map(items.map((p) => [p.key, p]));
  const isRoot = (p: Place) => !p.parentKey || !byKey.has(p.parentKey) || byKey.get(p.parentKey)!.kind === 'global';
  const kidsOf = (key: string) => items.filter((p) => p.kind !== 'global' && p.parentKey === key);
  // the tree in reading order, with each place's depth
  const walk = (list: Place[], depth: number): { p: Place; depth: number }[] => list.flatMap((p) => [{ p, depth }, ...walk(kidsOf(p.key), depth + 1)]);
  const tree = walk(items.filter((p) => p.kind !== 'global' && isRoot(p)), 0);
  const term = q.trim().toLowerCase();
  const shown = term ? tree.filter(({ p }) => p.name.toLowerCase().includes(term)).map(({ p }) => ({ p, depth: 0 })) : tree;

  const row = (key: string, name: string, meta: string, depth = 0) => (
    <li key={key}>
      <button className={key === current ? 'list-item active' : 'list-item'} aria-current={key === current ? 'true' : undefined} style={{ paddingLeft: 14 + depth * 20 }} onClick={() => onPick(key, name)}>
        <span className="body">
          <span className="title">{name}</span>
          <span className="meta">{meta}</span>
        </span>
        {key === current && <Icon name="check" />}
      </button>
    </li>
  );

  return (
    <dialog ref={ref} className="dialog" aria-labelledby="place-h" onCancel={(e) => (e.preventDefault(), onClose())} {...backdrop}>
      <div className="dialog-body">
        <h2 id="place-h">Change place</h2>
        <label className="search">
          <span className="sr">Search places</span>
          <Icon name="search" />
          <input type="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </label>
        <ErrorBanner message={error} />
        {loading && !data ? (
          <Loading rows={4} />
        ) : (
          <div className="scroll-card" style={{ maxHeight: '55vh' }}>
            <div className="list-scroll">
              <ul className="items">
                {!term && row('all', 'Whole service', 'Everywhere')}
                {shown.map(({ p, depth }) => row(p.key, p.name, p.kind[0].toUpperCase() + p.kind.slice(1), depth))}
              </ul>
              {data && shown.length === 0 && <p className="state">{term ? 'No match.' : 'No places yet.'}</p>}
            </div>
          </div>
        )}
        <div className="row end">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}
