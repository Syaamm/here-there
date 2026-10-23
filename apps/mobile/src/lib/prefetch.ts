import AsyncStorage from '@react-native-async-storage/async-storage';
import { get, type ConversationRef } from './api';
import { feedRange } from './feed';
import { primeCache } from './hooks';

/**
 * Right after sign-in (and each time the app opens) the pages people go to first are loaded quietly in the background and
 * put in the shared memory under the names the pages use. So the first visit to Messages, Profile or the home feed already
 * has its content: no loading blocks, nothing popping in. It never marks anything as read.
 */
export async function prefetchApp(me: { id: string; profile?: { homeCity?: string | null } | null }) {
  const city = (await AsyncStorage.getItem('ht_city').catch(() => null)) || me.profile?.homeCity || 'Milan';
  const [from, to] = feedRange();
  const feed = new URLSearchParams({ city, from: from.toISOString(), to: to.toISOString(), limit: '50' });

  const jobs: [string, unknown[], string][] = [
    ['inbox:notifs', [], '/v1/notifications'],
    ['inbox:convs', [], '/v1/me/conversations'],
    ['me:activities', [], '/v1/me/activities'],
    ['me:trips', [], '/v1/me/trips'],
    ['me:favs', [], '/v1/me/favorites'],
    ['me:stats', [me.id], `/v1/users/${me.id}`],
    ['feed:here', [city, ''], `/v1/activities?${feed}`],
    ['feed:there', [''], '/v1/trips?limit=50'],
  ];
  await Promise.all(jobs.map(([key, deps, url]) => get(url).then((d) => primeCache(key, deps, d)).catch(() => {})));

  // and the few chats most likely to be opened first, so a chat opens with its messages already there
  const convs = (await get<{ items: ConversationRef[] }>('/v1/me/conversations').catch(() => null))?.items ?? [];
  const recent = [...convs].sort((x, y) => (y.lastMessage ? +new Date(y.lastMessage.at) : 0) - (x.lastMessage ? +new Date(x.lastMessage.at) : 0)).slice(0, 4);
  await Promise.all(
    recent.flatMap((cv) => [
      get(`/v1/conversations/${cv.conversationId}/messages`).then((d) => primeCache('chat:msgs', [cv.conversationId], d)).catch(() => {}),
      get(`/v1/conversations/${cv.conversationId}/info`).then((d) => primeCache('chat:info', [cv.conversationId], d)).catch(() => {}),
    ]),
  );
}
