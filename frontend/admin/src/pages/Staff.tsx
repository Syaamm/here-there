import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, get, PERMISSIONS, post, roleLabel, type Permission, type Role, type Session } from '../api';
import { Select, useBackdropClose } from '../controls';
import { Avatar, Chip, Empty, errMsg, ErrorBanner, Icon, Loading, Page, Search, useAction, useLoad } from '../ui';

type Member = { id: string; email: string; displayName: string | null; photoUrl: string | null; role: Role; regionKey: string | null; permissions: Permission[]; state: string; mfaEnabled: boolean; mustChangePassword: boolean; createdAt: string };
type Place = { key: string; name: string; kind: string };
type Made = { email: string; temporaryPassword: string };

const ALL_PERMS = PERMISSIONS.map((p) => p.id);

/** Admin only: the console's accounts. Staff look after one area and use only the parts an admin allows. */
export function StaffPage({ me }: { me: Session }) {
  const list = useLoad(() => get<{ items: Member[] }>('/v1/admin/staff'), []);
  const places = useLoad(() => get<{ items: Place[] }>('/v1/admin/regions').catch(() => ({ items: [] as Place[] })), []);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [made, setMade] = useState<Made | null>(null);
  const act = useAction(list.reload);

  const areas = (places.data?.items ?? []).filter((p) => p.kind !== 'global');
  const placeName = (key: string | null) => (key ? (places.data?.items.find((p) => p.key === key)?.name ?? key) : 'Everywhere');
  const rows = (list.data?.items ?? []).filter((m) => `${m.email} ${m.displayName ?? ''} ${roleLabel(m.role)}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <Page
      fill
      title="Staff"
      actions={
        <button className="btn primary" onClick={() => (setAdding(true), setMade(null))}>
          <Icon name="plus" /> Add staff
        </button>
      }
    >
      <ErrorBanner message={list.error ?? act.error} onRetry={list.reload} />
      {made && (
        <div className="card stack" role="status">
          <div className="row between wrap">
            <strong>{made.email} · temporary password (shown once)</strong>
            <button className="btn small ghost" onClick={() => setMade(null)}>
              Done
            </button>
          </div>
          <div className="row wrap">
            <code className="mono" style={{ fontSize: 'var(--fs-lg)' }}>
              {made.temporaryPassword}
            </code>
            <button className="btn small" onClick={() => navigator.clipboard?.writeText(made.temporaryPassword)}>
              <Icon name="copy" /> Copy
            </button>
          </div>
        </div>
      )}
      <div className="toolbar">
        <div className="grow">
          <Search label="Search staff" placeholder="Search" value={q} onChange={setQ} />
        </div>
      </div>
      {list.loading && !list.data && <Loading rows={5} />}
      {list.data && rows.length === 0 && <Empty>No accounts.</Empty>}
      {rows.length > 0 && (
        <div className="table-wrap">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Type</th>
                  <th>Area</th>
                  <th>Can use</th>
                  <th>Two-step</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <div className="person">
                        <Avatar name={m.displayName ?? m.email} photo={m.photoUrl} size="sm" />
                        <div style={{ minWidth: 0 }}>
                          <div className="name">
                            {m.displayName ?? m.email}
                            {m.email === me.email && <Chip value="You" tone="plain" />}
                            {m.mustChangePassword && <Chip value="New" tone="line" />}
                          </div>
                          <div className="sub">{m.email}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <Chip value={roleLabel(m.role)} tone={m.role === 'admin' ? 'dark' : 'plain'} />
                    </td>
                    <td>{m.role === 'admin' ? 'Everywhere' : m.regionKey ? placeName(m.regionKey) : <Chip value="No area" tone="warn" />}</td>
                    <td>
                      {m.role === 'admin' ? (
                        <span className="muted small">Everything</span>
                      ) : m.permissions.length === 0 ? (
                        <span className="muted small">Nothing</span>
                      ) : (
                        <div className="row wrap" style={{ gap: 4 }}>
                          {PERMISSIONS.filter((p) => m.permissions.includes(p.id)).map((p) => (
                            <Chip key={p.id} value={p.label} tone="ok" />
                          ))}
                        </div>
                      )}
                    </td>
                    <td>{m.mfaEnabled ? <Chip value="On" tone="ok" /> : <Chip value="Off" tone="line" />}</td>
                    <td className="end">
                      {m.role === 'staff' && (
                        <button className="btn small" onClick={() => setEditing(m)}>
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {adding && (
        <StaffDialog
          title="Add staff"
          areas={areas}
          onClose={() => setAdding(false)}
          onSave={async ({ name, email, area, perms }) => {
            const r = await post<Made>('/v1/admin/staff', { email, displayName: name, regionKey: area, permissions: perms });
            setMade(r);
            setAdding(false);
            list.reload();
          }}
        />
      )}
      {editing && (
        <StaffDialog
          title={`Edit ${editing.displayName ?? editing.email}`}
          areas={areas}
          start={{ area: editing.regionKey ?? '', perms: editing.permissions }}
          onClose={() => setEditing(null)}
          onSave={async ({ area, perms }) => {
            await api('PATCH', `/v1/admin/staff/${editing.id}`, { regionKey: area, permissions: perms });
            setEditing(null);
            list.reload();
          }}
        />
      )}
    </Page>
  );
}

type Draft = { name: string; email: string; area: string; perms: Permission[] };

/** Add a staff member (name, email, area, permissions) or change an existing one's area and permissions. */
function StaffDialog({ title, areas, start, onClose, onSave }: { title: string; areas: Place[]; start?: { area: string; perms: Permission[] }; onClose: () => void; onSave: (d: Draft) => Promise<void> }) {
  const ref = useRef<HTMLDialogElement>(null);
  const editing = !!start;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [area, setArea] = useState(start?.area ?? '');
  const [perms, setPerms] = useState<Permission[]>(start?.perms ?? ALL_PERMS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => ref.current?.showModal(), []);
  const backdrop = useBackdropClose(ref, onClose); // a click on the dark area closes it
  const toggle = (p: Permission) => setPerms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave({ name, email, area, perms });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="dialog" onCancel={(e) => (e.preventDefault(), onClose())} aria-labelledby="staff-dlg" {...backdrop}>
      <form onSubmit={submit}>
        <h2 id="staff-dlg">{title}</h2>
        <ErrorBanner message={error} />
        {!editing && (
          <>
            <label>
              Name
              <input required minLength={2} maxLength={40} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Email
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
          </>
        )}
        <label>
          Area
          <Select required value={area} onChange={setArea}>
            <option value="" disabled>
              Choose a city, region or country
            </option>
            {areas.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name} ({p.kind})
              </option>
            ))}
          </Select>
        </label>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          <legend style={{ fontWeight: 600, fontSize: 'var(--fs-md)', marginBottom: 6 }}>Can use</legend>
          {PERMISSIONS.map((p) => (
            <label key={p.id} className="check">
              <input type="checkbox" checked={perms.includes(p.id)} onChange={() => toggle(p.id)} />
              {p.label}
            </label>
          ))}
        </fieldset>
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !area}>
            {busy ? 'Saving…' : editing ? 'Save' : 'Create'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
