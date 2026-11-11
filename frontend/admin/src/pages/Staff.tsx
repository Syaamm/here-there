import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, get, PERMISSIONS, post, roleLabel, saveSession, setRefreshToken, setToken, type Permission, type Role, type Session } from '../api';
import { Select, useBackdropClose } from '../controls';
import { Avatar, Chip, Empty, errMsg, ErrorBanner, Icon, Loading, Page, Search, useAction, useLoad } from '../ui';

type Member = { id: string; email: string; displayName: string | null; photoUrl: string | null; role: Role; regionKey: string | null; permissions: Permission[]; state: string; mfaEnabled: boolean; mustChangePassword: boolean; createdAt: string };
type Place = { key: string; name: string; kind: string };
const MIN = 10; // the same minimum the server asks for

const ALL_PERMS = PERMISSIONS.map((p) => p.id);

/** Admin only: the console's accounts. Staff look after one area and use only the parts an admin allows. */
export function StaffPage({ me }: { me: Session }) {
  const list = useLoad(() => get<{ items: Member[] }>('/v1/admin/staff'), []);
  const places = useLoad(() => get<{ items: Place[] }>('/v1/admin/regions').catch(() => ({ items: [] as Place[] })), []);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [ownPassword, setOwnPassword] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const act = useAction(list.reload);

  const areas = (places.data?.items ?? []).filter((p) => p.kind !== 'global');
  const placeName = (key: string | null) => (key ? (places.data?.items.find((p) => p.key === key)?.name ?? key) : 'Everywhere');
  const rows = (list.data?.items ?? []).filter((m) => `${m.email} ${m.displayName ?? ''} ${roleLabel(m.role)}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <Page
      fill
      title="Staff"
      actions={
        <button className="btn primary" onClick={() => (setAdding(true), setSaved(null))}>
          <Icon name="plus" /> Add staff
        </button>
      }
    >
      <ErrorBanner message={list.error ?? act.error} onRetry={list.reload} />
      {saved && (
        <p className="banner" role="status">
          {saved}
          <button className="link" onClick={() => setSaved(null)}>
            Done
          </button>
        </p>
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
                      {m.email === me.email && (
                        <button className="btn small" onClick={() => setOwnPassword(true)}>
                          Change my password
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
          areas={areas}
          onClose={() => setAdding(false)}
          onSave={async ({ name, email, area, perms, password }) => {
            await post('/v1/admin/staff', { email, displayName: name, regionKey: area, permissions: perms, password });
            setSaved(`${email} was added. They sign in with the password you set.`);
            setAdding(false);
            list.reload();
          }}
        />
      )}
      {ownPassword && (
        <OwnPassword
          me={me}
          onClose={() => setOwnPassword(false)}
          onDone={() => {
            setOwnPassword(false);
            setSaved('Your password was changed.');
          }}
        />
      )}
      {editing && (
        <StaffDialog
          person={{ name: editing.displayName ?? editing.email, photo: editing.photoUrl }}
          areas={areas}
          start={{ area: editing.regionKey ?? '', perms: editing.permissions, email: editing.email }}
          onClose={() => setEditing(null)}
          onSave={async ({ area, perms, email, password }) => {
            await api('PATCH', `/v1/admin/staff/${editing.id}`, { regionKey: area, permissions: perms, ...(email && email !== editing.email && { email }), ...(password && { password }) });
            if (password || (email && email !== editing.email)) setSaved('Saved. Their sign-in details changed and they were signed out everywhere.');
            setEditing(null);
            list.reload();
          }}
        />
      )}
    </Page>
  );
}

type Draft = { name: string; email: string; area: string; perms: Permission[]; password: string };

/** Add a staff member (name, email, area, permissions) or change an existing one's area and permissions. */
function StaffDialog({ areas, start, person, onClose, onSave }: { areas: Place[]; person?: { name: string; photo: string | null }; start?: { area: string; perms: Permission[]; email: string }; onClose: () => void; onSave: (d: Draft) => Promise<void> }) {
  const ref = useRef<HTMLDialogElement>(null);
  const editing = !!start;
  const [name, setName] = useState('');
  const [email, setEmail] = useState(start?.email ?? '');
  const [password, setPassword] = useState('');
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
      await onSave({ name, email, area, perms, password });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const [show, setShow] = useState(false);
  const generate = () => {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const v = Array.from(crypto.getRandomValues(new Uint32Array(14)), (n) => chars[n % chars.length]).join('');
    setPassword(v);
    setShow(true);
  };
  const DESC: Record<Permission, string> = { reports: 'Read and decide reports and appeals', verification: 'See identity checks and download lists', users: 'Look people up, warn or suspend them', content: 'See activities and trips, remove them' };
  const shownName = editing ? (person?.name ?? email) : name || 'New staff member';
  const unchanged = editing && !password && email === start?.email && area === start?.area && perms.length === start?.perms.length && perms.every((x) => start?.perms.includes(x));
  return (
    <dialog ref={ref} className="dialog staff-dlg" onCancel={(e) => (e.preventDefault(), onClose())} aria-labelledby="staff-dlg" {...backdrop}>
      <form onSubmit={submit}>
        <header className="sd-head">
          <Avatar name={shownName} photo={person?.photo ?? null} />
          <div style={{ minWidth: 0 }}>
            <h2 id="staff-dlg">{editing ? 'Edit staff member' : 'Add staff member'}</h2>
            <p className="muted small" style={{ margin: 0 }}>
              {editing ? `${shownName} · ${start?.email}` : 'Choose their area, what they can use, and the password they sign in with.'}
            </p>
          </div>
        </header>
        <ErrorBanner message={error} />
        <section className="sd-sec">
          <h3>Sign-in details</h3>
          {!editing && (
            <label>
              Name
              <input required minLength={2} maxLength={40} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          )}
          <label>
            Email
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </label>
          <label>
            {editing ? 'New password' : 'Password'}
            <span className="sd-pass">
              <input type={show ? 'text' : 'password'} required={!editing} minLength={editing && !password ? undefined : MIN} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={editing ? 'Leave empty to keep their password' : `At least ${MIN} characters`} autoComplete="new-password" />
              <button type="button" className="btn small" onClick={() => setShow((v) => !v)} aria-pressed={show}>
                {show ? 'Hide' : 'Show'}
              </button>
              <button type="button" className="btn small" onClick={generate}>
                Generate
              </button>
            </span>
          </label>
          {editing && password && <p className="small muted">They are signed out everywhere when you save, and use the new password next time.</p>}
        </section>
        <section className="sd-sec">
          <h3>Area</h3>
          <Select required value={area} onChange={setArea} aria-label="Area">
            <option value="" disabled>
              Choose a city, region or country
            </option>
            {areas.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name} ({p.kind})
              </option>
            ))}
          </Select>
          {!area && <p className="small muted">They only see reports, people and plans from this area.</p>}
        </section>
        <section className="sd-sec">
          <h3>Can use</h3>
          <div className="sd-perms">
            {PERMISSIONS.map((p) => (
              <label key={p.id} className={perms.includes(p.id) ? 'sd-perm on' : 'sd-perm'}>
                <input type="checkbox" checked={perms.includes(p.id)} onChange={() => toggle(p.id)} />
                <span>
                  <strong>{p.label}</strong>
                  <small>{DESC[p.id]}</small>
                </span>
              </label>
            ))}
          </div>
        </section>
        <div className="row end sd-foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !area || !!unchanged}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add staff member'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** The admin changes their own password here: it asks for the current one, and this device stays signed in. */
function OwnPassword({ me, onClose, onDone }: { me: Session; onClose: () => void; onDone: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => ref.current?.showModal(), []);
  const backdrop = useBackdropClose(ref, onClose);
  const ready = !!current && next.length >= MIN && next !== current && next === again;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ token: string; refreshToken: string }>('/v1/me/password', { currentPassword: current, newPassword: next });
      const s: Session = { ...me, token: r.token, refreshToken: r.refreshToken };
      setToken(s.token);
      setRefreshToken(s.refreshToken ?? null);
      saveSession(s);
      onDone();
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  };
  return (
    <dialog ref={ref} className="dialog" onCancel={(e) => (e.preventDefault(), onClose())} aria-labelledby="own-pw" {...backdrop}>
      <form onSubmit={submit}>
        <h2 id="own-pw">Change my password</h2>
        <ErrorBanner message={error} />
        <label>
          Current password
          <input type="password" required autoFocus autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
        <label>
          New password
          <input type="password" required autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder={`At least ${MIN} characters`} />
        </label>
        <label>
          New password again
          <input type="password" required autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
        </label>
        {again && again !== next && <p className="small muted">The two new passwords are not the same.</p>}
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !ready}>
            {busy ? 'Saving…' : 'Change password'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
