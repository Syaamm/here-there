import { useEffect, useState } from 'react';
import { get } from './api';
import { AuthProvider, useMe } from './auth';
import { Chat } from './screens/Chat';
import { Create } from './screens/Create';
import { Detail } from './screens/Detail';
import { Explore } from './screens/Explore';
import { HostReview } from './screens/HostReview';
import { Inbox } from './screens/Inbox';
import { Join } from './screens/Join';
import { MapScreen } from './screens/MapScreen';
import { Profile } from './screens/Profile';
import { Safety } from './screens/Safety';
import { Welcome } from './screens/Welcome';
import { Spinner, useLoad } from './ui';

function useRoute() {
  const read = () => location.hash.replace(/^#/, '') || '/';
  const [path, setPath] = useState(read);
  useEffect(() => {
    const on = () => {
      setPath(read());
      window.scrollTo(0, 0);
    };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return path;
}

const TABS = [
  { path: '/', label: 'Explore', icon: '⌂' },
  { path: '/map', label: 'Map', icon: '◎' },
  { path: '/create', label: 'Create', icon: '＋' },
  { path: '/inbox', label: 'Inbox', icon: '✉' },
  { path: '/profile', label: 'Profile', icon: '☺' },
];

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}

function Shell() {
  const { me, ready } = useMe();
  const path = useRoute();

  if (!ready) return <div className="phone"><Spinner /></div>;
  if (!me) return <div className="phone plain"><Welcome /></div>;

  const [, a, b] = path.split('/');
  let screen;
  if (path === '/') screen = <Explore />;
  else if (path === '/map') screen = <MapScreen />;
  else if (path === '/create') screen = <Create />;
  else if (path === '/inbox') screen = <Inbox />;
  else if (path === '/profile') screen = <Profile />;
  else if (path === '/safety') screen = <Safety />;
  else if (a === 'activity' && b) screen = <Detail id={b} />;
  else if (a === 'join' && b) screen = <Join id={b} />;
  else if (a === 'host' && b) screen = <HostReview id={b} />;
  else if (a === 'chat' && b) screen = <Chat id={b} />;
  else screen = <Explore />;

  return (
    <div className="phone">
      <main className={a === 'chat' ? 'screen chat-screen' : 'screen'}>{screen}</main>
      <TabBar path={tabFor(path)} />
    </div>
  );
}

/** Which tab a screen belongs to, so sub-screens keep the right tab highlighted. */
function tabFor(path: string) {
  const a = path.split('/')[1];
  if (a === 'activity' || a === 'join') return '/';
  if (a === 'host' || a === 'safety') return '/profile';
  if (a === 'chat') return '/inbox';
  return path;
}

function TabBar({ path }: { path: string }) {
  const unread = useLoad(() => get<{ unreadCount: number }>('/v1/notifications?unread=true'), [], 30_000).data?.unreadCount ?? 0;
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((t) => (
        <a key={t.path} href={`#${t.path}`} className={`tab${path === t.path ? ' active' : ''}${t.path === '/create' ? ' fab' : ''}`} aria-current={path === t.path ? 'page' : undefined}>
          <span className="tab-icon" aria-hidden="true">{t.icon}</span>
          <span className="tab-label">{t.label}</span>
          {t.path === '/inbox' && unread > 0 && <span className="badge" aria-label={`${unread} unread`}>{unread > 9 ? '9+' : unread}</span>}
        </a>
      ))}
    </nav>
  );
}
