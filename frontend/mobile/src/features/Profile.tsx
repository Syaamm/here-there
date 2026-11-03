import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { ActivityCard, TripCard } from '@/components/Cards';
import { ReliabilityChip } from '@/components/ReliabilityChip';
import { Text } from '@/components/ScaledText';
import { ModeSwitch } from '@/components/TabHeader';
import { useLayout } from '@/lib/layout';
import { Avatar, Between, Btn, Card, Chip, Empty, ErrorBanner, Field, Grid, Pill, PillRow, Row, Screen, Spinner, Txt, useGo } from '@/components/ui';
import { get, patch, type Activity, type MyActivitiesPage, type MyReliability, type MyTripRow, type MyTripsPage } from '@/lib/api';
import { myActivityItems } from '@/lib/myActivities';
import { useMe } from '@/lib/auth';
import { useAction, useLoad, useRefresh } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';


const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

/** THERE's HERE | THERE switch in the profile design: a white pill with the open side filled deep forest (it does what the header switch does). */
function ThereSwitch() {
  const { switchMode, c } = useTheme();
  const { t } = useT();
  const opts: ['here' | 'there', string][] = [['here', 'HERE'], ['there', 'THERE']];
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', borderRadius: 999, backgroundColor: '#fff', padding: 3, shadowColor: '#102F29', shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}>
      {opts.map(([m, label]) => {
        const on = m === 'there';
        return (
          <Pressable key={m} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t('Switch to {name}', { name: label })} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }} onPress={() => (on ? undefined : switchMode(m))} style={{ minHeight: 26, paddingHorizontal: 11, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.forest : 'transparent' }}>
            <Text style={{ color: on ? '#fff' : c.forest, fontWeight: on ? '700' : '500', fontSize: 11, letterSpacing: 0.5 }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Shared profile across HERE and THERE: one identity, one verification, one block list. */
export function Profile() {
  const { t } = useT();
  const { me, reload } = useMe();
  const { mode, switchMode, c } = useTheme();
  const go = useGo();
  const { gutter } = useLayout();
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
  const here = mode === 'here';
  const verifyText = v === 'verified' ? t('Verified adult') : v === 'pending' ? t('Identity check pending') : v === 'expired' ? t('Verification expired') : v === 'reverification_required' ? t('Re-check needed') : t('Not verified yet');
  const there = !here; // THERE: white cards on the ivory page, a sand wash, a white HERE | THERE pill
  const surf = there ? '#fff' : c.surface;
  const soft = { shadowColor: '#102F29', shadowOpacity: 0.1, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 3, backgroundColor: surf } as const;
  const rowCard = { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingHorizontal: 20, borderRadius: 24 } as const;
  const stat = [
    [stats.data?.stats.activitiesHosted, t('Hosted')],
    [stats.data?.stats.activitiesJoined, t('Joined')],
    [trips.data?.counts.joined, t('Trips')],
  ] as const;

  const buddiesRow = (
          <Pressable accessibilityRole="button" accessibilityLabel={t('Buddies and followers: {buddies} Buddies, {following} following, {followers} followers', { buddies: conns.data?.counts.buddies ?? 0, following: conns.data?.counts.following ?? 0, followers: conns.data?.counts.followers ?? 0 })} onPress={() => go('/connections')} style={[rowCard, soft]}>
            <Ionicons name="people-outline" size={22} color={c.forest} />
            <Text style={{ flex: 1, color: c.forest, fontSize: 14, lineHeight: 19, fontWeight: '500' }}>{conns.data ? t('{buddies} Buddies · {following} following · {followers} followers', { buddies: conns.data.counts.buddies, following: conns.data.counts.following, followers: conns.data.counts.followers }) : t('Buddies and followers')}</Text>
            <Ionicons name="chevron-forward" size={18} color={c.text} />
          </Pressable>
  );
  const reliabilityRow = (
          rel.data ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('Your reliability level: {label}. See why', { label: rel.data.label })} onPress={() => go('/reliability')} style={[rowCard, soft]}>
              <Ionicons name="shield-half-outline" size={22} color={c.forest} />
              <Text style={{ color: c.forest, fontSize: 16, lineHeight: 21, fontWeight: '600' }}>{t('Reliability')}</Text>
              <View style={{ flex: 1, alignItems: 'flex-start' }}><ReliabilityChip r={{ level: rel.data.level, label: rel.data.label }} /></View>
              <Ionicons name="chevron-forward" size={18} color={c.text} />
            </Pressable>
          ) : null
  );
  const travelRow = (
          me.role !== 'guest' ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('Travel buddies: find someone to travel with')} onPress={() => go('/travel-match')} style={[rowCard, soft]}>
              <Ionicons name="person-add-outline" size={22} color={c.forest} />
              <Text style={{ flex: 1, color: c.forest, fontSize: 16, lineHeight: 21, fontWeight: '600' }}>{t('Travel buddies')}</Text>
              <Ionicons name="chevron-forward" size={18} color={c.text} />
            </Pressable>
          ) : null
  );

  return (
    <Screen tabBar onRefresh={onRefresh} refreshing={refreshing}>
      <>
          {/* a soft mint wash behind the top of the page, then the switch and the settings gear (Figma "Profile") */}
          <LinearGradient pointerEvents="none" colors={there ? [c.bg, c.sand, c.bg] : ['#B7DBCF', '#FFFFFF']} locations={there ? [0, 0.65, 1] : undefined} style={{ position: 'absolute', top: -80, left: -gutter, right: -gutter, height: 400 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            {there ? <ThereSwitch /> : <ModeSwitch />}
            <Pressable accessibilityRole="button" accessibilityLabel={t('Settings')} hitSlop={6} onPress={() => go('/settings')} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: there ? c.forest : 'rgba(16,47,41,0.14)', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="settings-outline" size={22} color={there ? '#fff' : c.forest} />
            </Pressable>
          </View>
          <View style={{ alignItems: 'center', gap: 6, marginTop: -28 }}>
            <View>
              <Avatar name={p.displayName} uri={p.photoUrl} size={100} />
              <Pressable accessibilityRole="button" accessibilityLabel={t('Edit profile and photo')} hitSlop={8} onPress={() => go('/edit-profile')} style={{ position: 'absolute', right: -4, bottom: -2, width: 30, height: 30, borderRadius: 15, backgroundColor: c.forest, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="pencil" size={13} color="#fff" />
              </Pressable>
            </View>
            <Text accessibilityRole="header" style={{ color: c.text, fontSize: 24, lineHeight: 30, fontWeight: '600', marginTop: 6 }}>
              {p.displayName}
              {v === 'verified' ? <Text style={{ color: '#2F80ED' }}>{'  '}<Ionicons name="checkmark-circle" size={20} color="#2F80ED" /></Text> : null}
            </Text>
            <Text style={{ color: c.muted, fontSize: 14, lineHeight: 20 }}>{p.homeCity ?? t('No city set')} · {verifyText}</Text>
          </View>

          <View style={[{ flexDirection: 'row', borderRadius: 32, paddingVertical: 18, marginTop: 14 }, soft]}>
            {stat.map(([n, l], i) => (
              <View key={l} style={{ flex: 1, alignItems: 'center', gap: 2, borderLeftWidth: i ? 1 : 0, borderLeftColor: c.line }}>
                <Text style={{ color: c.text, fontSize: 24, lineHeight: 30, fontWeight: '600' }}>{n ?? '–'}</Text>
                <Text style={{ color: c.muted, fontSize: 12, lineHeight: 16 }}>{l}</Text>
              </View>
            ))}
          </View>
          <Text style={{ color: c.muted, fontSize: 12, lineHeight: 17, textAlign: 'center' }}>{t('No reviews yet.')}</Text>
          {there ? <>{reliabilityRow}{travelRow}{buddiesRow}</> : <>{buddiesRow}{reliabilityRow}{travelRow}</>}
          {!me.emailVerified ? (
            <Pressable accessibilityRole="button" onPress={() => go('/onboarding')} style={{ minHeight: 54, borderRadius: 32, borderWidth: 1, borderColor: c.line, backgroundColor: there ? '#fff' : undefined, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: c.text, fontSize: 15, fontWeight: '500' }}>{t('Confirm your email')}</Text>
            </Pressable>
          ) : null}
          {v !== 'verified' ? (
            <Pressable accessibilityRole="button" onPress={() => go('/verify')} style={{ minHeight: 54, borderRadius: 32, backgroundColor: c.forest, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 10 }}>
              <Text style={{ color: '#fff', fontSize: 15, lineHeight: 20, fontWeight: '500', textAlign: 'center' }}>{v === 'pending' ? t('Verification in review') : v === 'rejected' ? t('Try verification again') : v === 'expired' || v === 'reverification_required' ? t('Verify again to keep joining and chatting') : t('Get verified to join, host and chat')}</Text>
            </Pressable>
          ) : null}
      </>

      {there ? <>
      <Txt variant="h3">{t('Interests')}</Txt>
      {p.interests.length ? (
        <Row style={{ flexWrap: 'wrap', gap: 6 }}>
          {p.interests.map((i) => (
            there ? <View key={i} style={{ minHeight: 34, paddingHorizontal: 16, borderRadius: 17, borderWidth: 1, borderStyle: 'dashed', borderColor: c.muted, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: c.text, fontSize: 13, fontWeight: '500' }}>{t(i)}</Text></View> : <Chip key={i} label={t(i)} tone="neutral" />
          ))}
        </Row>
      ) : (
        <Txt variant="muted">{t('Add your interests.')}</Txt>
      )}
      <Txt variant="h3">{t('About')}</Txt>
      {p.bio ? <Txt style={{ lineHeight: 21 }}>{p.bio}</Txt> : <Txt variant="muted">{t('Add a short bio.')}</Txt>}
      </> : <>
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
      </>}
      {p.languages.length > 0 && <Txt variant="small">{t('Languages: {list}', { list: p.languages.map((l) => t(l)).join(', ') })}</Txt>}

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
    </Screen>
  );
}
