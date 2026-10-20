import { useState } from 'react';
import { can, get, post, STAFF, type Role, type Session } from '../api';
import { askChoiceText, askText, Chip, Empty, ErrorBanner, fmt, Page, useAction, useLoad } from '../ui';

type U = { id: string; email: string; role: Role; state: string; eligibility: string; emailVerified: boolean; adultVerified: boolean; phoneVerified: boolean; verifiedUntil: string | null; reverifyReason: string | null; lastRejectionReason: string | null; displayName?: string; homeCity?: string; createdAt: string };
type Detail = {
  id: string;
  email: string;
  stats: { reportsAgainst: number; hosted: number; joined: number };
  history: { id: string; action: string; createdAt: string; metadata: string | null }[];
  verifications: { id: string; eligibility: string; createdAt: string }[];
};

export function UsersPage({ me }: { me: Session }) {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [state, setState] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const users = useLoad(
    () => get<{ items: U[] }>(`/v1/admin/users?${new URLSearchParams({ ...(term && { q: term }), ...(state && { state }) })}`),
    [term, state],
  );
  const act = useAction(users.reload);

  const suspend = async (u: U) => {
    const reason = await askText(`Suspend ${u.displayName ?? u.email}?`, { confirm: 'Suspend' });
    if (reason) act.run(() => post(`/v1/admin/users/${u.id}/suspend`, { reason }));
  };
  const restore = async (u: U) => {
    const reason = await askText(`Restore ${u.displayName ?? u.email}?`, { confirm: 'Restore' });
    if (reason) act.run(() => post(`/v1/admin/users/${u.id}/restore`, { reason }));
  };
  // A new identity check is needed only for expiry (automatic), a security concern, suspected fraud, or the provider's say-so.
  const reverify = async (u: U) => {
    const r = await askChoiceText(
      `Require ${u.displayName ?? u.email} to verify again?`,
      [['security', 'Security concern'], ['fraud_suspected', 'Suspected fraud'], ['other', 'Other']],
      { label: 'What happened? (kept in the audit log, not shown to the user)', confirm: 'Require re-verification' },
    );
    if (r) act.run(() => post(`/v1/admin/users/${u.id}/require-reverification`, { reason: r.choice, note: r.text }));
  };
  const reset = async (u: U) => {
    const note = await askText(`Let ${u.displayName ?? u.email} try verification again?`, { label: 'Why? (kept in the audit log)', confirm: 'Allow another attempt' });
    if (note) act.run(() => post(`/v1/admin/users/${u.id}/reset-verification`, { note }));
  };
  const overturn = async (u: U) => {
    const note = await askText(`Approve ${u.displayName ?? u.email} after review?`, { label: 'What did you check? You are confirming this person is a genuine adult. (kept in the audit log)', confirm: 'Approve' });
    if (note) act.run(() => post(`/v1/admin/users/${u.id}/overturn-rejection`, { note }));
  };
  const setRole = (u: U, role: string) => {
    if (role !== u.role && confirm(`Change role of ${u.email} to "${role}"?`)) act.run(() => post(`/v1/admin/users/${u.id}/role`, { role }));
    else users.reload();
  };

  return (
    <Page title="Users">
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setTerm(q.trim());
        }}
      >
        <label className="grow">
          <span className="sr">Search users</span>
          <input type="search" placeholder="Search by email, name or user ID" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label>
          <span className="sr">State</span>
          <select value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">All states</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
        </label>
        <button className="btn primary">Search</button>
      </form>
      <ErrorBanner message={users.error ?? act.error} />
      {users.data?.items.length === 0 && <Empty>No users match.</Empty>}
      {!!users.data?.items.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>State</th>
                <th>Identity</th>
                <th>Joined</th>
                <th>
                  <span className="sr">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.data.items.map((u) => (
                <UserRow key={u.id} u={u} me={me} open={open === u.id} onToggle={() => setOpen(open === u.id ? null : u.id)} onSuspend={suspend} onRestore={restore} onRole={setRole} onReverify={reverify} onReset={reset} onOverturn={overturn} busy={act.busy} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}

function UserRow(p: { u: U; me: Session; open: boolean; onToggle: () => void; onSuspend: (u: U) => void; onRestore: (u: U) => void; onRole: (u: U, r: string) => void; onReverify: (u: U) => void; onReset: (u: U) => void; onOverturn: (u: U) => void; busy: boolean }) {
  const { u, me } = p;
  // moderators cannot touch staff accounts; the server enforces this too
  const canActOn = can.moderate(me.role) && (u.role === 'user' || me.role === 'admin') && u.email !== me.email;
  return (
    <>
      <tr>
        <td>
          <button className="link" onClick={p.onToggle} aria-expanded={p.open}>
            {u.displayName ?? '(no name)'}
          </button>
          <div className="muted small">{u.email}</div>
        </td>
        <td>
          {can.admin(me.role) && u.email !== me.email ? (
            <select aria-label={`Role for ${u.email}`} value={u.role} onChange={(e) => p.onRole(u, e.target.value)} disabled={p.busy}>
              {(['user', ...STAFF] as Role[]).map((r) => (
                <option key={r} value={r}>
                  {r.replace('_', ' ')}
                </option>
              ))}
            </select>
          ) : (
            u.role.replace('_', ' ')
          )}
        </td>
        <td>
          <Chip value={u.state} />
        </td>
        <td>
          <Chip value={u.eligibility} />
          <div className="muted small">
            Email {u.emailVerified ? '✓' : '✗'} · Adult {u.adultVerified ? '✓' : '✗'} · Mobile {u.phoneVerified ? '✓' : '–'}
          </div>
          {u.eligibility === 'verified' && u.verifiedUntil && <div className="muted small">Valid until {new Date(u.verifiedUntil).toLocaleDateString()}</div>}
          {u.reverifyReason && u.eligibility !== 'verified' && <div className="muted small">Re-check: {u.reverifyReason.replace(/_/g, ' ')}</div>}
          {u.eligibility === 'rejected' && <div className="muted small">Rejected: {(u.lastRejectionReason ?? 'other').replace(/_/g, ' ')}</div>}
        </td>
        <td className="nowrap">{fmt(u.createdAt)}</td>
        <td className="end">
          {can.trust(me.role) && u.role === 'user' && u.state === 'active' && ['verified', 'pending'].includes(u.eligibility) && (
            <>
              <button className="btn" onClick={() => p.onReverify(u)} disabled={p.busy}>
                Require re-verification
              </button>{' '}
            </>
          )}
          {/* a rejection or a stuck check can be reopened or, as an appeal, overturned by a reviewer */}
          {can.trust(me.role) && u.role === 'user' && ['rejected', 'pending', 'reverification_required'].includes(u.eligibility) && (
            <>
              <button className="btn" onClick={() => p.onReset(u)} disabled={p.busy}>
                Allow another attempt
              </button>{' '}
            </>
          )}
          {can.trust(me.role) && u.role === 'user' && u.eligibility === 'rejected' && !['superseded', 'cancelled'].includes(u.lastRejectionReason ?? '') && (
            <>
              <button className="btn primary" onClick={() => p.onOverturn(u)} disabled={p.busy || (u.lastRejectionReason === 'underage' && !can.admin(me.role))} title={u.lastRejectionReason === 'underage' && !can.admin(me.role) ? 'Only an admin can overturn an under-18 rejection' : undefined}>
                Approve after review
              </button>{' '}
            </>
          )}
          {canActOn &&
            (u.state === 'suspended' ? (
              <button className="btn" onClick={() => p.onRestore(u)} disabled={p.busy}>
                Restore
              </button>
            ) : (
              <button className="btn danger" onClick={() => p.onSuspend(u)} disabled={p.busy}>
                Suspend
              </button>
            ))}
        </td>
      </tr>
      {p.open && (
        <tr className="detail-row">
          <td colSpan={6}>
            <UserDetail id={u.id} />
          </td>
        </tr>
      )}
    </>
  );
}

function UserDetail({ id }: { id: string }) {
  const { data, error, loading } = useLoad(() => get<Detail>(`/v1/admin/users/${id}`), [id]);
  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <ErrorBanner message={error} />;
  if (!data) return null;
  return (
    <div className="detail">
      <dl className="facts">
        <div>
          <dt>Reports against</dt>
          <dd>{data.stats.reportsAgainst}</dd>
        </div>
        <div>
          <dt>Hosted</dt>
          <dd>{data.stats.hosted}</dd>
        </div>
        <div>
          <dt>Joined</dt>
          <dd>{data.stats.joined}</dd>
        </div>
        <div>
          <dt>User ID</dt>
          <dd className="mono">{data.id}</dd>
        </div>
      </dl>
      <h3>Recent staff actions on this account</h3>
      {data.history.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <ul className="plain">
          {data.history.map((h) => (
            <li key={h.id}>
              <span className="mono">{h.action}</span> <span className="muted">{fmt(h.createdAt)}</span>
              {h.metadata && <span className="muted small"> {h.metadata}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
