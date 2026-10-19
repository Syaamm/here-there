import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, get, post } from '../api';
import { useMe } from '../auth';
import { ReportSheet } from '../ReportSheet';
import { Empty, ErrorBanner, go, Menu, Spinner, TopBar, useAction, useLoad } from '../ui';
import type { Notif } from './Inbox';

type Msg = { id: string; body: string; createdAt: string; sender: { id: string; displayName: string } };
type Conv = { items: { conversationId: string; scope: string; scopeId: string; title: string }[] };

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
function dayLabel(iso: string) {
  const d = new Date(iso);
  const day0 = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day0(new Date()) - day0(d)) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Screen 07: activity chat. Access is decided by the server from live membership on every call. */
export function Chat({ id }: { id: string }) {
  const { me } = useMe();
  const convs = useLoad(() => get<Conv>('/v1/me/conversations'), []);
  const msgs = useLoad(() => get<{ writable: boolean; items: Msg[] }>(`/v1/conversations/${id}/messages`), [id], 3000);
  const [text, setText] = useState('');
  const [reportMsg, setReportMsg] = useState<string | null>(null);
  const send = useAction(msgs.reload);
  const safety = useAction(msgs.reload);
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const conv = convs.data?.items.find((c) => c.conversationId === id);
  const count = msgs.data?.items.length ?? 0;
  const locked = msgs.error instanceof ApiError && msgs.error.code === 'NOT_A_MEMBER';

  // follow new messages only while the reader is already at the bottom
  const onScroll = () => {
    const el = list.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  useEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [count]);

  // opening (or staying in) the chat clears its "new message" alert
  useEffect(() => {
    if (locked || !msgs.data) return;
    get<{ items: Notif[] }>('/v1/notifications?unread=true')
      .then((n) => Promise.all(n.items.filter((x) => x.type === 'chat_message' && x.data?.conversationId === id).map((x) => post(`/v1/notifications/${x.id}/read`))))
      .catch(() => {});
  }, [id, count, locked, !!msgs.data]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    stick.current = true;
    const r = await send.run(() => post(`/v1/conversations/${id}/messages`, { body }));
    if (r) setText(''); // on failure the text stays so nothing is lost
  };

  const leave = async () => {
    if (conv && confirm('Leave this group? You will lose access to the chat.')) {
      await send.run(() => post(`/v1/activities/${conv.scopeId}/leave`));
      go('/inbox');
    }
  };

  const block = (m: Msg) => {
    if (confirm(`Block ${m.sender.displayName}? Their messages will be hidden from you and they can't contact you, here or in THERE.`)) safety.run(() => post('/v1/blocks', { userId: m.sender.id }));
  };

  if (locked)
    return (
      <>
        <TopBar title="Chat" />
        <Empty title="Chat is for approved members">Once the host approves your request, the group chat opens here.</Empty>
      </>
    );

  return (
    <div className="chat">
      <TopBar
        title={conv?.title ?? 'Group chat'}
        right={
          <Menu
            items={[
              ...(conv ? [{ label: 'View activity', onSelect: () => go(`/activity/${conv.scopeId}`) }] : []),
              { label: 'Safety tools', onSelect: () => go('/safety') },
              { label: 'Leave group', danger: true, onSelect: leave },
            ]}
          />
        }
      />
      <p className="banner info small">Only approved members can see this chat. Meet at the public venue, and report anything that feels wrong.</p>

      <div className="messages" ref={list} onScroll={onScroll} role="log" aria-live="polite" aria-label="Messages">
        {msgs.loading && !msgs.data && <Spinner />}
        {msgs.data?.items.length === 0 && <p className="muted center">No messages yet. Say hi 👋</p>}
        {msgs.data?.items.map((m, i, all) => {
          const mine = m.sender.id === me?.id;
          const newDay = i === 0 || dayLabel(all[i - 1].createdAt) !== dayLabel(m.createdAt);
          return (
            <Fragment key={m.id}>
              {newDay && <div className="day-sep">{dayLabel(m.createdAt)}</div>}
              <div className={mine ? 'msg mine' : 'msg'}>
                {!mine && <strong className="small">{m.sender.displayName}</strong>}
                <span>{m.body}</span>
                <span className="msg-meta">
                  {hhmm(m.createdAt)}
                  {!mine && (
                    <>
                      <button className="link small" onClick={() => setReportMsg(m.id)} aria-label={`Report message from ${m.sender.displayName}`}>
                        Report
                      </button>
                      <button className="link small" onClick={() => block(m)} aria-label={`Block ${m.sender.displayName}`}>
                        Block
                      </button>
                    </>
                  )}
                </span>
              </div>
            </Fragment>
          );
        })}
      </div>

      <ErrorBanner message={send.error ?? safety.error ?? (msgs.error && !locked ? msgs.error.message : null)} />
      {msgs.data && !msgs.data.writable ? (
        <p className="banner info">This conversation is closed. The activity was cancelled or archived.</p>
      ) : (
        <form className="composer" onSubmit={submit}>
          <label className="grow">
            <span className="sr">Write a message</span>
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="Write a message…" autoComplete="off" />
          </label>
          <button className="btn primary" disabled={send.busy || !text.trim()}>
            {send.busy ? 'Sending…' : 'Send'}
          </button>
        </form>
      )}
      {reportMsg && <ReportSheet targetType="message" targetId={reportMsg} onClose={() => setReportMsg(null)} />}
    </div>
  );
}
