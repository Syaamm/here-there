import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { ActivityCard, TripCard } from '@/components/Cards';
import { TabHeader } from '@/components/TabHeader';
import { Avatar, Between, Btn, Card, Chip, Empty, ErrorBanner, Field, Grid, Pill, PillRow, Row, Screen, Spinner, Txt, useGo } from '@/components/ui';
import { get, patch, type Activity, type Trip } from '@/lib/api';
import { myActivityItems } from '@/lib/myActivities';
import { useMe } from '@/lib/auth';
import { useAction, useLoad, useRefresh } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';

type MyActivities = { joined: (Activity & { role: string })[]; requests: { requestId: string; state: string; activity: Activity }[] };
type MyTrips = { joined: (Trip & { role: string })[]; applications: { applicationId: string; state: string; trip: Trip }[] };

const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

/** Shared profile across HERE and THERE: one identity, one verification, one block list. */
export function Profile() {
  const { me, reload, logout } = useMe();
  const { mode, switchMode, c } = useTheme();
  const go = useGo();
  const [tab, setTab] = useState<'activities' | 'trips' | 'favourites'>(mode === 'here' ? 'activities' : 'trips');
  const stats = useLoad(() => get<{ stats: { activitiesHosted: number; activitiesJoined: number } }>(`/v1/users/${me!.id}`), [me?.id]);
  const acts = useLoad(() => get<MyActivities>('/v1/me/activities'), []);
  const trips = useLoad(() => get<MyTrips>('/v1/me/trips'), []);
  const favs = useLoad(() => get<{ items: Activity[] }>('/v1/me/favorites'), []);
  const all = myActivityItems(acts.data);
  const { refreshing, onRefresh } = useRefresh(() => Promise.all([reload(), stats.reload(), acts.reload(), trips.reload(), favs.reload()]));

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
            {all.slice(0, 3).map((x) => (
              <View key={x.key} style={{ gap: 6 }}>
                <ActivityCard a={x.activity} plain={x.kind === 'rejected'} />
                <Row>
                  <Chip label={x.label} tone={x.tone} />
                  {x.hostOf && <Btn title="Manage requests ›" variant="ghost" small onPress={() => go(`/host/${x.activity.id}`)} />}
                </Row>
              </View>
            ))}
          </Grid>
          {all.length > 0 && <Btn title={all.length > 3 ? `View more (${all.length - 3})  ›` : 'View all  ›'} variant="secondary" onPress={() => go('/my-activities')} />}
        </>
      )}

      {tab === 'trips' && (
        <>
          {trips.data && trips.data.joined.length + trips.data.applications.length === 0 && <Empty title="No trips yet">Propose a trip or apply to one and it shows up here.</Empty>}
          <Grid>
          {trips.data?.joined.map((t) => (
            <View key={t.id} style={{ gap: 6 }}>
              <TripCard t={t} />
              <Row>
                <Chip label={t.role === 'organizer' ? 'You organize this' : 'In the group'} tone="ok" />
                {t.role === 'organizer' && <Btn title="Review applications ›" variant="ghost" small onPress={() => go(`/review/${t.id}`)} />}
              </Row>
            </View>
          ))}
          {trips.data?.applications.map((a) => (
            <View key={a.applicationId} style={{ gap: 6 }}>
              <TripCard t={a.trip} />
              <Chip label={a.state === 'pending' ? 'Pending organizer review' : a.state === 'waitlisted' ? 'Waitlisted' : 'Not approved'} tone={a.state === 'declined' ? 'bad' : 'warn'} />
            </View>
          ))}
          </Grid>
        </>
      )}

      {tab === 'favourites' && (
        <>
          {favs.data && favs.data.items.length === 0 && <Empty title="No favourites yet">Tap the heart on an activity to add it to your favourites.</Empty>}
          <Grid>
            {favs.data?.items.map((a) => (
              <ActivityCard key={a.id} a={a} />
            ))}
          </Grid>
        </>
      )}

      <Row style={{ justifyContent: 'center', gap: 8 }}>
        <Btn title="Safety & privacy" variant="ghost" small onPress={() => go('/safety')} />
        <Btn title="Sign out" variant="ghost" small onPress={() => logout()} />
      </Row>
    </Screen>
  );
}
