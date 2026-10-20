import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { View } from 'react-native';
import { ActivityCard, TripCard } from '@/components/Cards';
import { TabHeader } from '@/components/TabHeader';
import { Avatar, Between, Btn, Card, Chip, Empty, ErrorBanner, Field, Grid, Pill, PillRow, Row, Screen, Spinner, Txt, useGo } from '@/components/ui';
import { get, patch, type Activity, type Trip } from '@/lib/api';
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
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<'activities' | 'trips' | 'saved'>(mode === 'here' ? 'activities' : 'trips');
  const stats = useLoad(() => get<{ stats: { activitiesHosted: number; activitiesJoined: number } }>(`/v1/users/${me!.id}`), [me?.id]);
  const acts = useLoad(() => get<MyActivities>('/v1/me/activities'), []);
  const trips = useLoad(() => get<MyTrips>('/v1/me/trips'), []);
  const favs = useLoad(() => get<{ items: Activity[] }>('/v1/me/favorites'), []);
  const { refreshing, onRefresh } = useRefresh(() => Promise.all([reload(), stats.reload(), acts.reload(), trips.reload(), favs.reload()]));

  if (!me?.profile) return <Spinner />;
  const p = me.profile;
  const v = me.eligibility;

  return (
    <Screen tabBar onRefresh={onRefresh} refreshing={refreshing}>
      <TabHeader subtitle={p.homeCity ? `${p.homeCity} · Around you` : undefined} />
      <Txt variant="h1" style={{ fontSize: 34, lineHeight: 40 }}>Your profile</Txt>

      <View style={{ alignItems: 'center', gap: 6 }}>
        <Avatar name={p.displayName} size={104} />
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

      {p.bio ? <Txt style={{ textAlign: 'center' }}>{p.bio}</Txt> : null}
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
      <Btn title={editing ? 'Close editor' : 'Edit profile'} variant="secondary" onPress={() => setEditing((e) => !e)} />
      {editing && <EditForm onDone={() => (setEditing(false), void reload())} />}
      <Btn title="Safety & privacy" variant="secondary" onPress={() => go('/safety')} />
      {/* HERE and THERE are one app: this flips between them */}
      <Btn title={mode === 'here' ? 'Switch to There ↗' : 'Switch to Here ↗'} onPress={() => switchMode(mode === 'here' ? 'there' : 'here')} />

      <PillRow>
        <Pill label="My activities" active={tab === 'activities'} onPress={() => setTab('activities')} />
        <Pill label="My trips" active={tab === 'trips'} onPress={() => setTab('trips')} />
        <Pill label="Saved" active={tab === 'saved'} onPress={() => setTab('saved')} />
      </PillRow>

      {tab === 'activities' && (
        <>
          {acts.data && acts.data.joined.length + acts.data.requests.length === 0 && <Empty title="No activities yet">Join or host an activity and it shows up here.</Empty>}
          <Grid>
          {acts.data?.joined.map((a) => (
            <View key={a.id} style={{ gap: 6 }}>
              <ActivityCard a={a} />
              <Row>
                <Chip label={a.role === 'host' ? 'You host this' : 'Going'} tone="ok" />
                {a.role === 'host' && <Btn title="Manage requests ›" variant="ghost" small onPress={() => go(`/host/${a.id}`)} />}
              </Row>
            </View>
          ))}
          {acts.data?.requests.map((r) => (
            <View key={r.requestId} style={{ gap: 6 }}>
              <ActivityCard a={r.activity} />
              <Chip label={r.state === 'requested' ? 'Request pending' : 'Not approved'} tone={r.state === 'declined' ? 'bad' : 'warn'} />
            </View>
          ))}
          </Grid>
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

      {tab === 'saved' && (
        <>
          {favs.data && favs.data.items.length === 0 && <Empty title="No saved activities">Use ⋯ on an activity to save it for later.</Empty>}
          <Grid>
            {favs.data?.items.map((a) => (
              <ActivityCard key={a.id} a={a} />
            ))}
          </Grid>
        </>
      )}

      <Btn title="Sign out" variant="ghost" onPress={() => logout()} />
    </Screen>
  );
}

function EditForm({ onDone }: { onDone: () => void }) {
  const { me } = useMe();
  const p = me!.profile!;
  const [f, setF] = useState({ displayName: p.displayName, homeCity: p.homeCity ?? '', languages: p.languages.join(', '), interests: p.interests.join(', '), bio: p.bio ?? '' });
  const act = useAction(onDone);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const submit = () =>
    act.run(() =>
      patch('/v1/me/profile', {
        displayName: f.displayName,
        homeCity: f.homeCity.trim() || null,
        languages: csv(f.languages),
        interests: csv(f.interests),
        bio: f.bio.trim() || null,
      }),
    );
  return (
    <Card style={{ gap: 12 }}>
      <ErrorBanner message={act.error} />
      <Field label="Display name" value={f.displayName} onChangeText={set('displayName')} maxLength={40} />
      <Field label="Home city (city only)" value={f.homeCity} onChangeText={set('homeCity')} maxLength={60} />
      <Field label="Languages" hint="Comma separated" value={f.languages} onChangeText={set('languages')} />
      <Field label="Interests" hint="Comma separated" value={f.interests} onChangeText={set('interests')} />
      <Field label="Bio" multiline value={f.bio} onChangeText={set('bio')} maxLength={300} />
      <Btn title="Save changes" onPress={submit} loading={act.busy} disabled={f.displayName.trim().length < 2} />
    </Card>
  );
}
