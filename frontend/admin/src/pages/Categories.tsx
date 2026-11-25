import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, BASE, get, post } from '../api';
import { useBackdropClose } from '../controls';
import { askConfirm, Chip, Empty, ErrorBanner, Icon, Loading, Switch, useAction, useLoad } from '../ui';

type Kind = 'here' | 'there';
type Category = { id: string; kind: Kind; key: string; label: string; emoji: string; color: string; imageUrl: string | null; position: number; active: boolean; uses: number };

const KINDS: { id: Kind; label: string; noun: string; use: string }[] = [
  { id: 'here', label: 'Activity', noun: 'activity', use: 'activities' },
  { id: 'there', label: 'Travel', noun: 'travel', use: 'trips' },
];

/** The picture of a category as the app shows it (a round crop). With none, a plain stand-in: a person for HERE (like a profile with no photo), a plane for THERE. */
function Pic({ src, kind, size = 40 }: { src?: string | null; kind: Kind; size?: number }) {
  if (src) {
    // an address from the server is relative to it; a picture just chosen is already a full address
    const full = /^(blob:|https?:)/.test(src) ? src : BASE + src;
    return <img src={full} alt="" width={size} height={size} style={{ borderRadius: '50%', objectFit: 'cover', flex: 'none' }} />;
  }
  return (
    <span aria-hidden="true" style={{ width: size, height: size, borderRadius: '50%', background: '#e4e1d8', color: '#a9a595', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flex: 'none', verticalAlign: 'middle' }}>
      {kind === 'there' ? (
        <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} fill="currentColor"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" /></svg>
      ) : (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" style={{ overflow: 'hidden' }}><circle cx="12" cy="9.2" r="4.1" /><path d="M-4 30c0-9.5 6-14 16-14s16 4.5 16 14z" /></svg>
      )}
    </span>
  );
}

/** The categories people choose from: for a HERE activity, and for a THERE trip. Turning one off hides it from new plans; older plans keep it. */
export function CategoriesPanel({ kind, limit }: { kind: Kind; limit?: ReactNode }) {
  const { data, error, loading, reload } = useLoad(() => get<{ items: Category[] }>('/v1/admin/categories'), []);
  const act = useAction(reload);
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const info = KINDS.find((k) => k.id === kind)!;
  const items = (data?.items ?? []).filter((c) => c.kind === kind).sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));

  const remove = async (c: Category) => {
    if (await askConfirm(`Remove ${c.label}?`, 'People will no longer be able to choose it.', 'Remove')) act.run(async () => (await api('DELETE', `/v1/admin/categories/${c.id}`), setEditing(null)));
  };

  const title = kind === 'here' ? 'Here' : 'There';
  const blurb = kind === 'here' ? 'Activities: local plans for today or this week.' : 'Trips: getaways and longer trips away.';
  return (
    <section className="card set-panel" aria-label={title}>
      <header className="set-panel-head">
        <h2>{title}</h2>
        <span className="muted small">{blurb}</span>
      </header>
      {limit}
      <ErrorBanner message={error ?? act.error} onRetry={reload} />
      <div className="set-panel-sub">
        <div>
          <strong>{kind === 'here' ? 'Activity categories' : 'Travel styles'}</strong>
          <span className="muted small">{kind === 'here' ? 'What a host picks when creating an activity, and what people filter by on Home and the map.' : 'The travel styles a trip can carry, and what people filter trips by. Choosing one is optional.'}</span>
        </div>
        <button className="btn small primary" onClick={() => (act.clear(), setEditing('new'))}>
          <Icon name="plus" />
          Add
        </button>
      </div>
      {loading && !data && <Loading rows={5} />}
      {data && items.length === 0 && <Empty>No {info.noun} categories yet.</Empty>}
      {data && items.length > 0 && (
        <div className="table-wrap">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th style={{ width: 120 }}>Status</th>
                  <th className="end" aria-label="Actions" style={{ width: 150 }} />
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} style={c.active ? undefined : { opacity: 0.6 }}>
                    <td>
                      <div className="row" style={{ alignItems: 'center', gap: 12, flexWrap: 'nowrap' }}>
                        <Pic src={c.imageUrl} kind={c.kind} size={32} />
                        <span className="strong">{c.label}</span>
                      </div>
                    </td>
                    <td>
                      <Switch on={c.active} label={`${c.label} is ${c.active ? 'on' : 'off'}`} disabled={act.busy} onChange={(v) => act.run(() => api('PATCH', `/v1/admin/categories/${c.id}`, { active: v }))} />
                    </td>
                    <td className="end">
                      <div className="cell-actions">
                        <button className="btn small" onClick={() => (act.clear(), setEditing(c))}>Edit</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {editing && (
        <CategoryForm
          kind={kind}
          category={editing === 'new' ? null : editing}
          busy={act.busy}
          error={act.error}
          onClose={() => setEditing(null)}
          onRemove={editing === 'new' ? undefined : () => remove(editing)}
          onSave={(body, file, removePicture) =>
            act.run(async () => {
              let id: string;
              if (editing === 'new') id = (await post<{ id: string }>('/v1/admin/categories', { kind, ...body })).id;
              else {
                await api('PATCH', `/v1/admin/categories/${editing.id}`, body);
                id = editing.id;
              }
              if (file) await api('PUT', `/v1/admin/categories/${id}/image`, file);
              else if (removePicture) await api('DELETE', `/v1/admin/categories/${id}/image`);
              setEditing(null);
            })
          }
        />
      )}
    </section>
  );
}

function CategoryForm({ kind, category, busy, error, onClose, onRemove, onSave }: { kind: Kind; category: Category | null; busy: boolean; error: string | null; onClose: () => void; onRemove?: () => void; onSave: (body: Record<string, unknown>, file: File | null, removePicture: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  const backdrop = useBackdropClose(ref, onClose);
  const [label, setLabel] = useState(category?.label ?? '');
  const [emoji] = useState(category?.emoji ?? ''); // not asked any more: an old one is kept as it is
  const [file, setFile] = useState<File | null>(null);
  const [removed, setRemoved] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  // the chosen picture is shown before it is saved
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const choose = (f: File | undefined) => {
    setProblem(null);
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return setProblem('Use a JPEG, PNG or WebP picture.');
    if (f.size > 6 * 1024 * 1024) return setProblem('That picture is too large (6 MB at most).');
    setFile(f);
    setRemoved(false);
  };
  const shown = preview ?? (removed ? null : (category?.imageUrl ?? null));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave({ label: label.trim(), emoji: emoji.trim() }, file, removed && !file);
  };
  const word = kind === 'here' ? 'activity' : 'travel';
  return (
    <dialog ref={ref} className="dialog" aria-labelledby="cat-h" onCancel={(e) => (e.preventDefault(), onClose())} {...backdrop}>
      <form onSubmit={submit}>
        <h2 id="cat-h">{category ? `Edit ${category.label}` : `Add ${word} category`}</h2>
        <p className="muted small" style={{ margin: 0 }}>
          The app shows the picture on the category's chip and card. Renaming keeps every existing {kind === 'here' ? 'activity' : 'trip'} in it.
        </p>
        <ErrorBanner message={error ?? problem} />
        <div className="row" style={{ gap: 16, alignItems: 'center' }}>
          <Pic src={shown} kind={kind} size={88} />
          <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
            <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => (choose(e.target.files?.[0]), (e.target.value = ''))} />
            <button type="button" className="btn small" onClick={() => picker.current?.click()} disabled={busy}>
              {shown ? 'Change picture' : 'Choose picture'}
            </button>
            {shown && (
              <button type="button" className="btn small" onClick={() => (setFile(null), setRemoved(true))} disabled={busy}>
                Remove picture
              </button>
            )}
            <span className="muted small">JPEG, PNG or WebP, cropped to a square.</span>
          </div>
        </div>
        <label>
          Name
          <input required minLength={2} maxLength={24} value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
        </label>
        <div className="row end">
          {category && onRemove && category.uses === 0 && (
            <button type="button" className="btn danger" style={{ marginRight: 'auto' }} onClick={onRemove} disabled={busy}>
              Remove
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || label.trim().length < 2}>
            {busy ? 'Saving…' : category ? 'Save' : 'Add category'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

