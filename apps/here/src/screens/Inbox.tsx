import { useState } from 'react';
import { get, post } from '../api';
import { Empty, ErrorBanner, Spinner, ago, go, useAction, useLoad } from '../ui';

export type Notif = { id: string; type: string; title: string; body: string; data: { activityId?: string; conversationId?: string } | null; readAt: string | null; createdAt: string };
type Tab = 'all' | 'requests' | 'activities' | 'chats';

const REQUEST_TYPES = ['join_request', 'request_approved', 'request_declined'];
const ICON: Record<string, string> = { chat_message: '💬', join_request: '🔔', request_approved: '✅', request_declined: '✖️', activity_changed: '🕒', activity_cancelled: '🚫', removed: '🚪', verification_result: '🪪' };

/** Screen 08: operational notifications and conversations. */
export function Inbox() {
  const [tab, setTab] = useState<Tab>('all');
  const notifs = useLoad(() => get<{ items: Notif[]; unreadCount: number }>('/v1/notifications'), [], 15_000);
  const convs = useLoad(() => get<{ items: { conversationId: string; scope: string; title: string }[] }>('/v1/me/conversations'), []);
  const act = useAction(notifs.reload);

  const items = (notifs.data?.items ?? []).filter((n) =>
    tab === 'requests' ? REQUEST_TYPES.includes(n.type) : tab === 'activities' ? !REQUEST_TYPES.includes(n.type) && n.type !== 'chat_message' : true,
  );
  // conversations that have an unread message alert
  const unreadChats = new Set((notifs.data?.items ?? []).filter((n) => n.type === 'chat_message' && !n.readAt).map((n) => n.data?.conversationId));

  const open = async (n: Notif) => {
    if (!n.readAt) await act.run(() => post(`/v1/notifications/${n.id}/read`));
    const id = n.data?.activityId;
    if (n.data?.conversationId) go(`/chat/${n.data.conversationId}`);
    else if (id) go(n.type === 'join_request' ? `/host/${id}` : `/activity/${id}`);
    else if (n.type === 'verification_result') go('/safety');
  };

  return (
    <>
      <div className="row between">
        <h2 className="big">Your inbox</h2>
        {!!notifs.data?.unreadCount && (
          <button className="link small" onClick={() => act.run(() => post('/v1/notifications/read-all'))}>
            Mark all read
          </button>
        )}
      </div>
      <div className="chips" role="tablist">
        {(['all', 'requests', 'activities', 'chats'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'pill active' : 'pill'} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <ErrorBanner message={act.error ?? notifs.error?.message} />

      {tab === 'chats' ? (
        <>
          {convs.loading && !convs.data && <Spinner />}
          {convs.data && convs.data.items.filter((c) => c.scope === 'activity').length === 0 && <Empty title="No group chats yet">Chats open once a host approves you.</Empty>}
          <div className="list">
            {convs.data?.items
              .filter((c) => c.scope === 'activity')
              .map((c) => (
                <a key={c.conversationId} href={`#/chat/${c.conversationId}`} className="list-row">
                  <span className="list-icon" aria-hidden="true">💬</span>
                  <span className="grow">
                    <strong>
                      {c.title} {unreadChats.has(c.conversationId) && <span className="new">New</span>}
                    </strong>
                    <span className="muted small block">Group chat</span>
                  </span>
                </a>
              ))}
          </div>
        </>
      ) : (
        <>
          {notifs.loading && !notifs.data && <Spinner />}
          {notifs.data && items.length === 0 && <Empty title="You're all caught up">Join requests, approvals and changes to your plans show up here.</Empty>}
          <div className="list">
            {items.map((n) => (
              <button key={n.id} className={n.readAt ? 'list-row' : 'list-row unread'} onClick={() => open(n)}>
                <span className="list-icon" aria-hidden="true">{ICON[n.type] ?? '🔔'}</span>
                <span className="grow">
                  <strong>
                    {n.title} {!n.readAt && <span className="new">New</span>}
                  </strong>
                  <span className="muted small block">{n.body}</span>
                </span>
                <span className="muted small">{ago(n.createdAt)}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <p className="banner info small">These alerts are in-app only for now. Push notifications and quiet hours aren't set up yet. Operational notices are never mixed with marketing.</p>
    </>
  );
}
