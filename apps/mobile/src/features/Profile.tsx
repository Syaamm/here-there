import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { ActivityCard, TripCard } from '@/components/Cards';
import { ReliabilityChip } from '@/components/ReliabilityChip';
import { TabHeader } from '@/components/TabHeader';
import { Avatar, Between, Btn, Card, Chip, Empty, ErrorBanner, Field, Grid, Pill, PillRow, Row, Screen, Spinner, Txt, useGo } from '@/components/ui';
import { get, patch, type Activity, type MyActivitiesPage, type MyReliability, type MyTripRow, type MyTripsPage } from '@/lib/api';
import { myActivityItems } from '@/lib/myActivities';
import { useMe } from '@/lib/auth';
import { useAction, useLoad, useRefresh } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';


const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

/** Shared profile across HERE and THERE: one identity, one verification, one block list. */
export function Profile() {
  const { t } = useT();
  const { me, reload } = useMe();
  const { mode, switchMode, c } = useTheme();
  const go = useGo();
  const [tab, setTab] = useState<'activities' | 'trips' | 'favourites'>(mode === 'here' ? 'activities' : 'trips');
  const stats = useLoad(() => get<{ stats: { activitiesHosted: number; activitiesJoined: number } }>(`/v1/users/${me!.id}`), [me?.id], undefined, 'me:stats');
  // only the 3 newest of each list are fetched (the full lists are their own pages), with how many there are in all
  const acts = useLoad(() => get<MyActivitiesPage>('/v1/me/activities/page?tab=all&limit=3'), [], undefined, 'me:acts:recent');
  const trips = useLoad(() => get<MyTripsPage>('/v1/me/trips/page?limit=2'), [], undefined, 'me:trips');
  const conns = useLoad(() => get<{ counts: { following: number; followers: number; buddies: number } }>('/v1/me/connections?limit=1'), [], undefined, 'me:buddies2');
  const rel = useLoad(() => get<MyReliability>('/v1/me/reliability'), [], undefined, 'me:reliability');
  const favs = useLoad(() => get<{ items: Activity[]; total?: number }>('/v1/me/favorites?limit=3'), [], undefined, 'me:favs');
  const rows = acts.data?.items ?? [];
  const all = myActivityItems({
    joined: rows.filter((x): x is Extract<typeof x, { row: 'joined' }> => x.row === 'joined'),
    requests: rows.filter((x): x is Extract<typeof x, { row: 'request' }> => x.row === 'request'),
  });
  const actsTotal = acts.data ? acts.data.counts.mine + acts.data.counts.pending + acts.data.counts.rejected : 0;
  type TripItem = { key: string; joined: Extract<MyTripRow, { row: 'joined' }> } | { key: string; app: Extract<MyTripRow, { row: 'application' }> };
  const tripItems: TripItem[] = (trips.data?.items ?? []).map((x): TripItem => (x.row === 'joined' ? { key: x.id, joined: x } : { key: x.applicationId, app: x }));
  const tripsTotal = trips.data ? trips.data.counts.joined + trips.data.counts.applications : 0;
  const favItems = favs.data?.items ?? [];
  const favTotal = favs.data?.total ?? favItems.length;
  const TRIPS_SHOWN = 2; // trip cards are taller, so Profile shows 2 of them
  const SHOWN = 3; // Profile only shows the 3 most recent of each list; the full list is one tap away
  const { refreshing, onRefresh } = useRefresh(() => Promise.all([reload(), stats.reload(), conns.reload(), acts.reload(), trips.reload(), favs.reload(), rel.reload()]));

  if (!me?.profile) return <Spinner />;
  const p = me.profile;
  const v = me.eligibility;

  return (
    <Screen tabBar onRefresh={onRefresh} refreshing={refreshing} header={<TabHeader />}>
      <View style={{ alignItems: 'center', gap: 6 }}>
        <View>
          <Avatar name={p.displayName} uri={p.photoUrl} size={96} />
          <Pressable accessibilityRole="button" accessibilityLabel={t('Edit profile and photo')} hitSlop={8} onPress={() => go('/edit-profile')} style={{ position: 'absolute', right: -2, bottom: -2, width: 32, height: 32, borderRadius: 16, backgroundColor: c.forest, borderWidth: 2.5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="pencil" size={14} color="#fff" />
          </Pressable>
        </View>
        <Txt variant="h2" style={{ fontSize: 26 }}>{p.displayName} {v === 'verified' ? <Ionicons name="checkmark" size={22} color={c.green} /> : null}</Txt>
        <Txt variant="muted">{p.homeCity ?? t('No city set')} · {v === 'verified' ? t('Verified adult') : v === 'pending' ? t('Identity check pending') : v === 'expired' ? t('Verification expired') : v === 'reverification_required' ? t('Re-check needed') : t('Not verified yet')}</Txt>
      </View>

      {/* three figures separated by hairlines, as in the design */}
      <View style={{ flexDirection: 'row', paddingVertical: 8 }}>
        {[
          [stats.data?.stats.activitiesHosted, t('Hosted')],
          [stats.data?.stats.activitiesJoined, t('Joined')],
          [trips.data?.counts.joined, t('Trips')],
        ].map(([n, l], i) => (
          <View key={String(l)} style={{ flex: 1, alignItems: 'center', borderLeftWidth: i ? 1 : 0, borderLeftColor: c.line }}>
            <Txt variant="h2" style={{ fontSize: 28, lineHeight: 34 }}>{n ?? '–'}</Txt>
            <Txt variant="muted">{l}</Txt>
          </View>
        ))}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Buddies and followers: {buddies} Buddies, {following} following, {followers} followers', { buddies: conns.data?.counts.buddies ?? 0, following: conns.data?.counts.following ?? 0, followers: conns.data?.counts.followers ?? 0 })} onPress={() => go('/connections')} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 6 }}>
        <Ionicons name="people-outline" size={16} color={c.forest} />
        <Txt variant="small" style={{ color: c.forest }}>{conns.data ? t('{buddies} Buddies · {following} following · {followers} followers', { buddies: conns.data.counts.buddies, following: conns.data.counts.following, followers: conns.data.counts.followers }) : t('Buddies and followers')}</Txt>
        <Ionicons name="chevron-forward" size={14} color={c.muted} />
      </Pressable>
      <Txt variant="small" style={{ textAlign: 'center' }}>{t('No reviews yet.')}</Txt>

      <Txt variant="h3">{t('About')}</Txt>
      {p.bio ? <Txt style={{ lineHeight: 21 }}>{p.bio}</Txt> : <Txt variant="muted">{t('Add a short bio.')}</Txt>}
      <Txt variant="h3">{t('Interests')}</Txt>
      {p.interests.length ? (
        <Row style={{ flexWrap: 'wrap', gap: 6 }}>
          {p.interests.map((i) => (
            <Chip key={i} label={t(i)} tone="neutral" />
          ))}
        </Row>
      ) : (
        <Txt variant="muted">{t('Add your interests.')}</Txt>
      )}
      {p.languages.length > 0 && <Txt variant="small">{t('Languages: {list}', { list: p.languages.map((l) => t(l)).join(', ') })}</Txt>}

      {!me.emailVerified && <Btn title={t('Confirm your email')} variant="secondary" onPress={() => go('/onboarding')} />}
      {v !== 'verified' && (
        <Btn
          title={v === 'pending' ? t('Verification in review') : v === 'rejected' ? t('Try verification again') : v === 'expired' || v === 'reverification_required' ? t('Verify again to keep joining and chatting') : t('Get verified to join, host and chat')}
          onPress={() => go('/verify')}
        />
      )}
      {/* HERE and THERE are one app: this flips between them */}
      {rel.data ? (
        <Card onPress={() => go('/reliability')} accessibilityLabel={t('Your reliability level: {label}. See why', { label: rel.data.label })} style={{ padding: 14, borderRadius: 18, gap: 4 }}>
          <Between>
            <Row style={{ gap: 8, alignItems: 'center' }}>
              <Txt variant="h3">{t('Reliability')}</Txt>
              <ReliabilityChip r={{ level: rel.data.level, label: rel.data.label }} />
            </Row>
            <Ionicons name="chevron-forward" size={16} color={c.muted} />
          </Between>
        </Card>
      ) : null}
      {me.role !== 'guest' ? (
        <Card onPress={() => go('/travel-match')} accessibilityLabel={t('Travel buddies: find someone to travel with')} style={{ padding: 14, borderRadius: 18, gap: 4 }}>
          <Between>
            <Row style={{ gap: 8, alignItems: 'center' }}>
              <Txt variant="h3">{t('Travel buddies')}</Txt>
            </Row>
            <Ionicons name="chevron-forward" size={16} color={c.muted} />
          </Between>
        </Card>
      ) : null}
      <Btn title={mode === 'here' ? t('Switch to There ↗') : t('Switch to Here ↗')} onPress={() => switchMode(mode === 'here' ? 'there' : 'here')} />

      <PillRow>
        <Pill label={t('My activities')} active={tab === 'activities'} onPress={() => setTab('activities')} />
        <Pill label={t('My trips')} active={tab === 'trips'} onPress={() => setTab('trips')} />
        <Pill label={t('Favourites')} active={tab === 'favourites'} onPress={() => setTab('favourites')} />
      </PillRow>

      {tab === 'activities' && (
        <>
          {acts.data && actsTotal === 0 && <Empty title={t('No activities yet')} />}
          <Grid>
            {all.slice(0, SHOWN).map((x) => (
              <View key={x.key} style={{ gap: 6 }}>
                <ActivityCard a={x.activity} plain={x.kind === 'rejected'} />
                <Row>
                  <Chip label={x.label} tone={x.tone} />
                  {x.hostOf && <Btn title={t('Manage requests ›')} variant="ghost" small onPress={() => go(`/host/${x.activity.id}`)} />}
                </Row>
              </View>
            ))}
          </Grid>
          {actsTotal > SHOWN && <Btn title={t('More activities ({n} more)  ›', { n: actsTotal - SHOWN })} variant="secondary" onPress={() => go('/my-activities')} />}
        </>
      )}

      {tab === 'trips' && (
        <>
          {trips.data && tripsTotal === 0 && <Empty title={t('No trips yet')} />}
          <Grid>
            {tripItems.slice(0, TRIPS_SHOWN).map((x) =>
              'joined' in x ? (
                <View key={x.key} style={{ gap: 6 }}>
                  <TripCard t={x.joined} />
                  <Row>
                    <Chip label={x.joined.role === 'organizer' ? t('You organize this') : t('In the group')} tone="ok" />
                    {x.joined.role === 'organizer' && <Btn title={t('Review applications ›')} variant="ghost" small onPress={() => go(`/review/${x.joined.id}`)} />}
                  </Row>
                </View>
              ) : (
                <View key={x.key} style={{ gap: 6 }}>
                  <TripCard t={x.app.trip} />
                  <Chip label={x.app.state === 'pending' ? t('Pending organizer review') : x.app.state === 'waitlisted' ? t('Waitlisted') : t('Not approved')} tone={x.app.state === 'declined' ? 'bad' : 'warn'} />
                </View>
              ),
            )}
          </Grid>
          {tripsTotal > TRIPS_SHOWN && <Btn title={t('More trips ({n} more)  ›', { n: tripsTotal - TRIPS_SHOWN })} variant="secondary" onPress={() => go('/my-trips')} />}
        </>
      )}

      {tab === 'favourites' && (
        <>
          {favs.data && favs.data.items.length === 0 && <Empty title={t('No favourites yet')} />}
          <Grid>
            {favItems.slice(0, SHOWN).map((a) => (
              <ActivityCard key={a.id} a={a} />
            ))}
          </Grid>
          {favTotal > SHOWN && <Btn title={t('More favourites ({n} more)  ›', { n: favTotal - SHOWN })} variant="secondary" onPress={() => go('/favourites')} />}
        </>
      )}

      {/* the last thing on the page: account, notifications, language, safety & privacy and sign out all live in Settings */}
      <Card onPress={() => go('/settings')} accessibilityLabel={t('Settings')} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18 }}>
        <Image accessibilityIgnoresInvertColors source={require('../../assets/icon.png')} style={{ width: 38, height: 38, borderRadius: 10 }} />
        <View style={{ flex: 1, gap: 1 }}>
          <Txt variant="h3" style={{ fontSize: 14, lineHeight: 18 }}>{t('Settings')}</Txt>
        </View>
        <Ionicons name="chevron-forward" size={16} color={c.muted} />
      </Card>
    </Screen>
  );
}
