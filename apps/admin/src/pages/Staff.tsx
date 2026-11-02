import { useState, type FormEvent } from 'react';
import { get, post, type Role, type Session } from '../api';
import './Staff.css';
import { Avatar, Chip, Empty, ErrorBanner, Icon, Loading, Page, Search, useAction, useLoad } from '../ui';

type Member = { id: string; email: string; displayName: string | null; photoUrl: string | null; role: Role; regionKey: string | null; state: string; mfaEnabled: boolean; createdAt: string };
type Place = { key: string; name: string; kind: string };
type Made = { email: string; role: string; temporaryPassword: string };

const ROLES: [string, string, string][] = [
  ['support', 'Support', 'Answers members and looks things up. Cannot suspend or decide reports.'],
  ['moderator', 'Moderator', 'Handles reports, suspensions and appeals.'],
  ['trust_lead', 'Trust lead', 'Everything a moderator does, plus identity checks and the audit log.'],
];

/** Only an administrator of the whole service sees this page: it makes support, moderator and trust-lead accounts. */
export function StaffPage({ me }: { me: Session }) {
  const list = useLoad(() => get<{ items: Member[] }>('/v1/admin/staff'), []);
  const places = useLoad(() => get<{ items: Place[] }>('/v1/admin/regions').catch(() => ({ items: [] as Place[] })), []);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [made, setMade] = useState<Made | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('moderator');
  const [area, setArea] = useState('');
  const act = useAction(list.reload);

  const create = (e: FormEvent) => {
    e.preventDefault();
    return act.run(async () => {
      const r = await post<Made>('/v1/admin/staff', { email, displayName: name, role, regionKey: area || null });
      setMade(r);
      setAdding(false);
      setEmail('');
      setName('');
      setArea('');
    });
  };
  const rows = (list.data?.items ?? []).filter((m) => `${m.email} ${m.displayName ?? ''} ${m.role}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <Page
      fill
      title="Staff"
      sub="Create support, moderator and trust-lead accounts. Each person connects an authenticator app the first time they sign in."
      actions={
        <button className="btn primary" onClick={() => (setAdding(!adding), setMade(null))}>
          <Icon name="plus" /> Add staff
        </button>
      }
    >
      <ErrorBanner message={list.error ?? act.error} onRetry={list.reload} />
      {made && (
        <div className="st-made" role="status">
          <h2 style={{ margin: 0 }}>Account created for {made.email}</h2>
          <p className="muted" style={{ margin: 0 }}>
            Give them this temporary password now. <strong>It will not be shown again.</strong> They sign in with it, then connect an authenticator app before anything else opens.
          </p>
          <div className="row wrap">
            <code className="mono" style={{ fontSize: '1.1rem', letterSpacing: 1 }}>
              {made.temporaryPassword}
            </code>
            <button className="btn small" onClick={() => navigator.clipboard?.writeText(made.temporaryPassword)}>
              <Icon name="copy" /> Copy
            </button>
            <button className="btn small" onClick={() => setMade(null)}>
              Done
            </button>
          </div>
        </div>
      )}
      {adding && (
        <form className="st-form" onSubmit={create}>
          <h2 style={{ margin: 0 }}>New staff account</h2>
          <div className="form-grid">
            <label>
              Name
              <input required minLength={2} maxLength={40} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Email
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label>
              Role
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                {ROLES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <span className="muted small">{ROLES.find(([v]) => v === role)?.[2]}</span>
            </label>
            <label>
              Looks after
              <select value={area} onChange={(e) => setArea(e.target.value)}>
                <option value="">The whole service</option>
                {(places.data?.items ?? [])
                  .filter((p) => p.kind !== 'global')
                  .map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.name} ({p.kind})
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <div className="row end" style={{ margin: 0 }}>
            <button type="button" className="btn" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button className="btn primary" disabled={act.busy}>
              {act.busy ? 'Creating…' : 'Create account'}
            </button>
          </div>
        </form>
      )}
      <div className="toolbar st-search">
        <Search label="Search staff" placeholder="Search by name, email or role" value={q} onChange={setQ} />
      </div>
      {list.loading && !list.data && <Loading rows={5} />}
      {list.data && rows.length === 0 && <Empty title="No staff match">Try a different search, or add a new account.</Empty>}
      {rows.length > 0 && (
        <div className="table-wrap st-table">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Role</th>
                  <th>Looks after</th>
                  <th>Two-step</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <div className="person">
                        <Avatar name={m.displayName ?? m.email} photo={m.photoUrl} size="lg" />
                        <div style={{ minWidth: 0 }}>
                          <div className="name">
                            {m.displayName ?? '(no name)'}
                            {m.email === me.email && <Chip value="You" tone="plain" />}
                          </div>
                          <div className="sub">{m.email}</div>
                        </div>
                      </div>
                    </td>
                    <td>{m.role.replace('_', ' ')}</td>
                    <td>{m.regionKey ?? 'Whole service'}</td>
                    <td>{m.mfaEnabled ? <Chip value="connected" tone="ok" icon="check" /> : <Chip value="not yet" tone="warn" />}</td>
                    <td>
                      <Chip value={m.state} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Page>
  );
}
