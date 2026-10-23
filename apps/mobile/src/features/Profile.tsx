import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { ActivityCard, TripCard } from '@/components/Cards';
import { TabHeader } from '@/components/TabHeader';
import { Avatar, Between, Btn, Card, Chip, Empty, ErrorBanner, Field, Grid, Pill, PillRow, Row, Screen, Spinner, Txt, useGo } from '@/components/ui';
import { get, patch, type Activity, type Trip } from '@/lib/api';
import { myActivityItems } from '@/lib/myActivities';
import { savedIcon, type AppIcon } from '@/lib/appIcon';
import { useMe } from '@/lib/auth';
import { useAction, useLoad, useRefresh } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';

type MyActivities = { joined: (Activity & { role: string })[]; requests: { requestId: string; state: string; activity: Activity }[] };
type MyTrips = { joined: (Trip & { role: string })[]; applications: { applicationId: string; state: string; trip: Trip }[] };

const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

/** Shared profile across HERE and THERE: one identity, one verification, one block list. */
export function Profile() {
  const { me, reload } = useMe();
  const { mode, switchMode, c } = useTheme();
  const go = useGo();
  const [tab, setTab] = useState<'activities' | 'trips' | 'favourites'>(mode === 'here' ? 'activities' : 'trips');
  const stats = useLoad(() => get<{ stats: { activitiesHosted: number; activitiesJoined: number } }>(`/v1/users/${me!.id}`), [me?.id], undefined, 'me:stats');
  const acts = useLoad(() => get<MyActivities>('/v1/me/activities'), [], undefined, 'me:activities');
  const trips = useLoad(() => get<MyTrips>('/v1/me/trips'), [], undefined, 'me:trips');
  const conns = useLoad(() => get<{ counts: { following: number; followers: number; buddies: number } }>('/v1/me/connections'), [], undefined, 'me:buddies2');
  const favs = useLoad(() => get<{ items: Activity[] }>('/v1/me/favorites'), [], undefined, 'me:favs');
  // the app icon chosen in Settings, shown on the Settings row
  const [icon, setIcon] = useState<AppIcon>('here');
  useFocusEffect(useCallback(() => void savedIcon().then(setIcon), []));
  const all = myActivityItems(acts.data);
  const tripItems = [...(trips.data?.joined ?? []).map((t) => ({ key: t.id, joined: t })), ...(trips.data?.applications ?? []).map((a) => ({ key: a.applicationId, app: a }))];
  const favItems = favs.data?.items ?? [];
  const TRIPS_SHOWN = 2; // trip cards are taller, so Profile shows 2 of them
  const SHOWN = 3; // Profile only shows the 3 most recent of each list; the full list is one tap away
  const { refreshing, onRefresh } = useRefresh(() => Promise.all([reload(), stats.reload(), conns.reload(), acts.reload(), trips.reload(), favs.reload()]));

  if (!me?.profile) return <Spinner />;
  const p = me.profile;
  const v = me.eligibility;

  return (
    <Screen tabBar onRefresh={onRefresh} refreshing={refreshing} header={<TabHeader />}>
      <View style={{ alignItems: 'center', gap: 6 }}>
        <View>
          <Avatar name={p.displayName} uri={p.photoUrl} size={96} />
          <Pressable accessibilityRole="button" accessibilityLabel="Edit profile and photo" hitSlop={8} onPress={() => go('/edit-profile')} style={{ position: 'absolute', right: -2, bottom: -2, width: 32, height: 32, borderRadius: 16, backgroundColor: c.forest, borderWidth: 2.5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="pencil" size={14} color="#fff" />
          </Pressable>
        </View>
        <Txt variant="h2" style={{ fontSize: 26 }}>{p.displayName} {v === 'verified' ? <Ionicons name="checkmark" size={22} color={c.green} /> : null}</Txt>
        <Txt variant="muted">{p.homeCity ?? 'No city set'} · {v === 'verified' ? 'Verified adult' : v === 'pending' ? 'Identity check pending' : v === 'expired' ? 'Verification expired' : v === 'reverification_required' ? 'Re-check needed' : 'Not verified yet'}</Txt>
      </View>

      {/* three figures separated by hairlines, as in the design */}
      <View style={{ flexDirection: 'row', paddingVertical: 8 }}>
        {[
          [stats.data?.stats.activitiesHosted, 'Hosted'],
          [stats.data?.stats.activitiesJoined, 'Joined'],
          [trips.data?.joined.length, 'Trips'],
        ].map(([n, l], i) => (
          <View key={String(l)} style={{ flex: 1, alignItems: 'center', borderLeftWidth: i ? 1 : 0, borderLeftColor: c.line }}>
            <Txt variant="h2" style={{ fontSize: 28, lineHeight: 34 }}>{n ?? '–'}</Txt>
            <Txt variant="muted">{l}</Txt>
          </View>
        ))}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Buddies and followers: ${conns.data?.counts.buddies ?? 0} buddies, ${conns.data?.counts.following ?? 0} following, ${conns.data?.counts.followers ?? 0} followers`} onPress={() => go('/connections')} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 6 }}>
        <Ionicons name="people-outline" size={16} color={c.forest} />
        <Txt variant="small" style={{ color: c.forest }}>{conns.data ? `${conns.data.counts.buddies} buddies · ${conns.data.counts.following} following · ${conns.data.counts.followers} followers` : 'Buddies and followers'}</Txt>
        <Ionicons name="chevron-forward" size={14} color={c.muted} />
      </Pressable>
      <Txt variant="small" style={{ textAlign: 'center' }}>No reviews yet. Feedback only comes from confirmed experiences.</Txt>

      <Txt variant="h3">About</Txt>
      {p.bio ? <Txt style={{ lineHeight: 21 }}>{p.bio}</Txt> : <Txt variant="muted">Tell people a little about yourself. It helps hosts say yes.</Txt>}
      <Txt variant="h3">Interests</Txt>
      {p.interests.length ? (
        <Row style={{ flexWrap: 'wrap', gap: 6 }}>
          {p.interests.map((i) => (
            <Chip key={i} label={i} tone="neutral" />
          ))}
        </Row>
      ) : (
        <Txt variant="muted">Add interests so people know what you enjoy.</Txt>
      )}
      {p.languages.length > 0 && <Txt variant="small">Languages: {p.languages.join(', ')}</Txt>}

      {!me.emailVerified && <Btn title="Confirm your email" variant="secondary" onPress={() => go('/onboarding')} />}
      {v !== 'verified' && (
        <Btn
          title={v === 'pending' ? 'Verification in review' : v === 'rejected' ? 'Try verification again' : v === 'expired' || v === 'reverification_required' ? 'Verify again to keep joining and chatting' : 'Get verified to join, host and chat'}
          onPress={() => go('/verify')}
        />
      )}
      {/* HERE and THERE are one app: this flips between them */}
      <Btn title={mode === 'here' ? 'Switch to There ↗' : 'Switch to Here ↗'} onPress={() => switchMode(mode === 'here' ? 'there' : 'here')} />

      <PillRow>
        <Pill label="My activities" active={tab === 'activities'} onPress={() => setTab('activities')} />
        <Pill label="My trips" active={tab === 'trips'} onPress={() => setTab('trips')} />
        <Pill label="Favourites" active={tab === 'favourites'} onPress={() => setTab('favourites')} />
      </PillRow>

      {tab === 'activities' && (
        <>
          {acts.data && all.length === 0 && <Empty title="No activities yet">Join or host an activity and it shows up here.</Empty>}
          <Grid>
            {all.slice(0, SHOWN).map((x) => (
              <View key={x.key} style={{ gap: 6 }}>
                <ActivityCard a={x.activity} plain={x.kind === 'rejected'} />
                <Row>
                  <Chip label={x.label} tone={x.tone} />
                  {x.hostOf && <Btn title="Manage requests ›" variant="ghost" small onPress={() => go(`/host/${x.activity.id}`)} />}
                </Row>
              </View>
            ))}
          </Grid>
          {all.length > SHOWN && <Btn title={`More activities (${all.length - SHOWN} more)  ›`} variant="secondary" onPress={() => go('/my-activities')} />}
        </>
      )}

      {tab === 'trips' && (
        <>
          {trips.data && trips.data.joined.length + trips.data.applications.length === 0 && <Empty title="No trips yet">Propose a trip or apply to one and it shows up here.</Empty>}
          <Grid>
            {tripItems.slice(0, TRIPS_SHOWN).map((x) =>
              'joined' in x ? (
                <View key={x.key} style={{ gap: 6 }}>
                  <TripCard t={x.joined} />
                  <Row>
                    <Chip label={x.joined.role === 'organizer' ? 'You organize this' : 'In the group'} tone="ok" />
                    {x.joined.role === 'organizer' && <Btn title="Review applications ›" variant="ghost" small onPress={() => go(`/review/${x.joined.id}`)} />}
                  </Row>
                </View>
              ) : (
                <View key={x.key} style={{ gap: 6 }}>
                  <TripCard t={x.app.trip} />
                  <Chip label={x.app.state === 'pending' ? 'Pending organizer review' : x.app.state === 'waitlisted' ? 'Waitlisted' : 'Not approved'} tone={x.app.state === 'declined' ? 'bad' : 'warn'} />
                </View>
              ),
            )}
          </Grid>
          {tripItems.length > TRIPS_SHOWN && <Btn title={`More trips (${tripItems.length - TRIPS_SHOWN} more)  ›`} variant="secondary" onPress={() => go('/my-trips')} />}
        </>
      )}

      {tab === 'favourites' && (
        <>
          {favs.data && favs.data.items.length === 0 && <Empty title="No favourites yet">Tap the heart on an activity to add it to your favourites.</Empty>}
          <Grid>
            {favItems.slice(0, SHOWN).map((a) => (
              <ActivityCard key={a.id} a={a} />
            ))}
          </Grid>
          {favItems.length > SHOWN && <Btn title={`More favourites (${favItems.length - SHOWN} more)  ›`} variant="secondary" onPress={() => go('/favourites')} />}
        </>
      )}

      {/* the last thing on the page: account, notifications, app icon, safety & privacy and sign out all live in Settings */}
      <Card onPress={() => go('/settings')} accessibilityLabel="Settings: account, notifications, app icon, safety and privacy, sign out" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18 }}>
        <Image accessibilityIgnoresInvertColors source={icon === 'there' ? require('../../assets/icons/there/icon.png') : require('../../assets/icon.png')} style={{ width: 38, height: 38, borderRadius: 10 }} />
        <View style={{ flex: 1, gap: 1 }}>
          <Txt variant="h3" style={{ fontSize: 14, lineHeight: 18 }}>Settings</Txt>
          <Txt variant="small">Account, alerts, app icon, safety & privacy, sign out</Txt>
        </View>
        <Ionicons name="chevron-forward" size={16} color={c.muted} />
      </Card>
    </Screen>
  );
}
