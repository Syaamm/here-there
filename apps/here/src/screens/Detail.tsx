import { useState } from 'react';
import { del, get, post, type Activity } from '../api';
import { useMe } from '../auth';
import { CATS } from '../constants';
import { ReportSheet } from '../ReportSheet';
import { Chip, Empty, ErrorBanner, go, Menu, Spinner, TopBar, timeRange, useAction, useLoad } from '../ui';

/** Screen 05: activity detail. The join button reflects server-side state, never client guesses. */
export function Detail({ id }: { id: string }) {
  const { me } = useMe();
  const { data: a, error, loading, reload } = useLoad(() => get<Activity>(`/v1/activities/${id}`), [id]);
  const act = useAction(reload);
  const [report, setReport] = useState<'activity' | 'user' | null>(null);

  if (loading && !a) return <><TopBar title="Activity" /><Spinner /></>;
  if (error || !a)
    return (
      <>
        <TopBar title="Activity" />
        <Empty title="Activity not found">It may have been cancelled or is no longer available.</Empty>
      </>
    );

  const cat = CATS[a.category];
  const verified = me?.eligibility === 'verified';
  const req = a.myRequest?.state;
  const closed = ['in_progress', 'completed', 'cancelled', 'archived'].includes(a.status);

  const toggleFav = () => act.run(() => (a.favorited ? del(`/v1/activities/${id}/favorite`) : post(`/v1/activities/${id}/favorite`)));
  const menu = [
    { label: a.favorited ? 'Remove from saved' : 'Save for later', onSelect: toggleFav },
    ...(a.isHost
      ? []
      : [
          { label: 'Report this activity', onSelect: () => setReport('activity') },
          { label: `Report ${a.host.displayName}`, onSelect: () => setReport('user') },
          {
            label: `Block ${a.host.displayName}`,
            danger: true,
            onSelect: async () => {
              if (confirm(`Block ${a.host.displayName}? You will no longer see each other's activities, here or in THERE.`)) {
                await act.run(() => post('/v1/blocks', { userId: a.host.id }));
                go('/');
              }
            },
          },
        ]),
  ];

  return (
    <>
      <TopBar title={cat?.label ?? 'Activity'} right={<Menu items={menu} />} />
      <div className="row between wrap">
        <Chip>
          {cat?.emoji} {cat?.label ?? a.category}
        </Chip>
        <span className="muted small">{timeRange(a.startsAt, a.endsAt)}</span>
      </div>
      <h2 className="big">{a.title}</h2>
      <p className="muted">📍 {a.venueName}, {a.city} · Public meeting venue</p>

      {a.status === 'cancelled' && <p className="banner error">This activity was cancelled.</p>}
      {['in_progress', 'completed'].includes(a.status) && <p className="banner info">This activity has already started.</p>}
      <ErrorBanner message={act.error} />

      <div className="card row">
        <span className="avatar" aria-hidden="true">{a.host.displayName[0]?.toUpperCase()}</span>
        <div>
          <strong>
            {a.host.displayName} {a.host.verifiedAdult && <span title="Verified adult">✓</span>}
          </strong>
          <div className="muted small">{a.host.verifiedAdult ? 'Verified adult · Host' : 'Host'}</div>
        </div>
      </div>

      {a.description && (
        <>
          <h3>About the activity</h3>
          <p className="pre">{a.description}</p>
        </>
      )}

      <div className="card">
        <div className="row between">
          <div>
            <strong>
              {a.going} / {a.capacity} people going
            </strong>
            <div className="muted small">{a.spotsLeft === 0 ? 'No places left' : `${a.spotsLeft} ${a.spotsLeft === 1 ? 'place' : 'places'} available`}</div>
          </div>
          <div className="faces" aria-label="Participants">
            {a.participants?.slice(0, 5).map((p) => (
              <span key={p.id} className="avatar sm" title={p.displayName}>
                {p.displayName[0]?.toUpperCase()}
              </span>
            ))}
          </div>
        </div>
        {!!a.participants?.length && <p className="muted small">{a.participants.map((p) => p.displayName).join(', ')}</p>}
      </div>

      <p className="banner info">🛡 Your exact location is never shared. Group chat opens after host approval.</p>

      {/* --- primary action --- */}
      {a.isHost ? (
        <div className="stack">
          <a className="btn primary block" href={`#/host/${id}`}>
            Manage join requests
          </a>
          {a.conversationId && (
            <a className="btn block" href={`#/chat/${a.conversationId}`}>
              Open group chat
            </a>
          )}
          {a.status !== 'cancelled' && (
            <button
              className="btn danger block"
              disabled={act.busy}
              onClick={() => confirm('Cancel this activity? Everyone who joined will be notified.') && act.run(() => post(`/v1/activities/${id}/cancel`))}
            >
              Cancel activity
            </button>
          )}
        </div>
      ) : a.isMember ? (
        <div className="stack">
          <p className="banner ok">You're going. See you there!</p>
          {a.conversationId && (
            <a className="btn primary block" href={`#/chat/${a.conversationId}`}>
              Open group chat
            </a>
          )}
          <button className="btn block" disabled={act.busy} onClick={() => confirm('Leave this activity?') && act.run(() => post(`/v1/activities/${id}/leave`))}>
            Leave activity
          </button>
        </div>
      ) : req === 'requested' ? (
        <div className="stack">
          <p className="banner warn">Request sent. Waiting for the host to review it. Chat opens once you're approved.</p>
          <button className="btn block" disabled={act.busy} onClick={() => act.run(() => del(`/v1/activities/${id}/requests/mine`))}>
            Withdraw request
          </button>
        </div>
      ) : req === 'declined' ? (
        <p className="banner error">The host didn't approve this request.</p>
      ) : closed ? null : a.spotsLeft === 0 ? (
        <button className="btn block" disabled>
          This activity is full
        </button>
      ) : !verified ? (
        <a className="btn primary block" href="#/safety">
          Verify your identity to join
        </a>
      ) : (
        <a className="btn primary block" href={`#/join/${id}`}>
          Request to join
        </a>
      )}

      {report && <ReportSheet targetType={report} targetId={report === 'activity' ? a.id : a.host.id} onClose={() => setReport(null)} />}
    </>
  );
}
