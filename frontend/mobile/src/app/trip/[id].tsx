import Ionicons from '@expo/vector-icons/Ionicons';
import { SkeletonDetail } from '@/components/Skeleton';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AskAgain } from '@/components/AskAgain';
import { FloatingButton, Hero } from '@/components/Hero';
import { Menu } from '@/components/Menu';
import { HostNoShowSheet, hostNoShowOpen } from '@/components/HostNoShowSheet';
import { ReportSheet } from '@/components/ReportSheet';
import { InfoRow } from '@/components/ActivityParts';
import { Text } from '@/components/ScaledText';
import { TripGoingGrid, TripHostCard } from '@/components/TripParts';
import { Banner, BottomBar, Btn, Chip, Empty, ErrorBanner, Row, Screen, Txt, useGo } from '@/components/ui';
import { del, get, post, type Trip } from '@/lib/api';
import { shareLink } from '@/lib/shareLink';
import { useMe } from '@/lib/auth';
import { TRIP_PHOTOS, tripStyle } from '@/components/Cards';
import { FLEX } from '@/lib/constants';
import { confirmAsync } from '@/lib/confirm';
import { dateSpan, money } from '@/lib/format';
import { useAction, useLoad, useRefresh } from '@/lib/hooks';
import { statusTop, useLayout } from '@/lib/layout';
import { useEnterMode, useTheme } from '@/lib/theme';
import { useT } from '@/lib/i18n';
import { ReadMore } from '@/components/ReadMore';

/** THERE · Trip detail. A proposal with an estimated budget. Never a booking, never a guaranteed departure. Laid out like an activity. */
export default function TripDetail() {
  const { t, tn } = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me, isGuest, logout } = useMe();
  const { c } = useTheme();
  useEnterMode('there'); // opened from a HERE alert, push or link: flip to THERE first
  const router = useRouter();
  const go = useGo();
  const insets = useSafeAreaInsets();
  const HERO = c.heroBlock;
  const { gutter } = useLayout();
  const [barH, setBarH] = useState(0); // the fixed bottom bar's measured height
  const { data: trip, error, loading, reload } = useLoad(() => get<Trip>(`/v1/trips/${id}`), [id], undefined, 'trip', { animate: true });
  const { refreshing, onRefresh } = useRefresh(reload); // pull down to refresh, like Home
  const act = useAction(reload);
  const [report, setReport] = useState<{ type: 'trip' | 'user'; id: string } | null>(null);
  const [noShow, setNoShow] = useState<'closed' | 'open' | 'confirm' | 'sent'>('closed'); // "the host did not show up": sheet closed, open, showing its thank-you, or sent and closed
  // the heart answers at once; the server confirms a moment later (a failed save puts it back)
  const [favNow, setFavNow] = useState<boolean | null>(null);
  useEffect(() => {
    if (favNow !== null && !!trip?.favorited === favNow) setFavNow(null); // the server has caught up
  }, [trip?.favorited, favNow]);

  if (loading && !trip)
    return (
      <Screen hero={<Hero plain color={HERO} emoji="✈️" />}>
        <SkeletonDetail />
      </Screen>
    );
  if (error || !trip)
    return (
      <Screen hero={<Hero plain color={HERO} emoji="✈️" />}>
        <Empty title={t('Trip not found')}>{t('It may have been cancelled or is no longer available.')}</Empty>
      </Screen>
    );

  const verified = me?.eligibility === 'verified';
  const app = trip.myApplication;
  const closed = ['cancelled', 'completed', 'archived'].includes(trip.status);
  const full = trip.status === 'full' || trip.spotsLeft === 0;
  // a cancelled trip, or one that has started, cannot be saved or shared (a saved one can still be taken out)
  const ahead = !closed && +new Date(trip.dateStart) > Date.now();
  // leaving is for a trip that has not started or is under way (its last day included), never one that is finished or called off
  // (the last day ends at midnight on the person's own clock; the old "+ 24 hours" ran on into the day after it)
  const lastDay = new Date(trip.dateEnd);
  lastDay.setHours(23, 59, 59, 999);
  const canLeave = !closed && +lastDay > Date.now();
  const fav = favNow ?? !!trip.favorited;

  const menu = trip.isHost || isGuest
    ? []
    : [
        { label: t('Report this trip'), onSelect: () => setReport({ type: 'trip', id: trip.id }) },
        // a person is reported from their profile (its ⋯ menu), not from their activity
        {
          label: t('Block {name}', { name: trip.host.displayName }),
          danger: true,
          onSelect: async () => {
            if (await confirmAsync(t('Block {name}?', { name: trip.host.displayName }), t("You won't see each other's trips or activities, in HERE or THERE."), t('Block'), true)) {
              await act.run(() => post('/v1/blocks', { userId: trip.host.id }));
              router.back();
            }
          },
        },
      ];

  // the link opens this trip in the app, or sends the person to the App Store / Google Play when they have not got it
  const share = () => void Share.share({ message: `${t('{title}, {dates}, from {city}', { title: trip.title, dates: dateSpan(trip.dateStart, trip.dateEnd), city: trip.originCity })}\n${shareLink('trip', trip.id)}` }).catch(() => undefined);
  const flex = FLEX.find(([v]) => v === trip.dateFlexibility)?.[1] ?? trip.dateFlexibility;

  const top = statusTop(insets.top) + 8;
  const PHOTO = 250 + top; // the picture's full height

  const style = tripStyle(trip);
  const photo = style ? TRIP_PHOTOS[style] : undefined; // the picture of the trip's travel style (trips have no photos of their own)
  const going = trip.participants ?? [];

  // The one main action sits in a bar fixed to the bottom; the lesser ones stay in the page.
  type Primary = { title: string; onPress?: () => void; variant?: 'secondary'; disabled?: boolean; loading?: boolean; caption?: string };
  let primary: Primary | null = null;
  if (!closed) {
    if (trip.isHost) primary = { title: t('Review applications'), onPress: () => go(`/review/${id}`) };
    else if (trip.isMember) primary = trip.conversationId ? { title: t('Open group chat'), onPress: () => go(`/chat/${trip.conversationId}`) } : null;
    else if (app && app.state === 'pending') primary = { title: t('Withdraw application'), variant: 'secondary', loading: act.busy, onPress: () => void act.run(() => del(`/v1/trips/${id}/applications/mine`)) };
    else if (app && ['declined', 'waitlisted'].includes(app.state)) primary = null;
    else if (full) primary = { title: t('This group is full'), disabled: true };
    else if (isGuest) primary = { title: t('Create an account to apply'), onPress: () => logout() };
    else if (!verified) primary = { title: t('Verify your identity to apply'), onPress: () => go('/verify') };
    else primary = { title: app ? t('Apply again') : t('Request to join'), onPress: () => go(`/apply/${id}`) };
  }

  return (
    <View style={{ flex: 1 }}>
      <Screen
        onRefresh={onRefresh}
        refreshing={refreshing}
        bottomRoom={primary ? barH : undefined}
        fixedHero={{ height: PHOTO, stop: top + 84, photo: <Hero plain round height={PHOTO} color={HERO} emoji="✈️" image={photo} /> }}
      >
        <Stack.Screen options={{ headerShown: false }} />

        <Row style={{ gap: 8, flexWrap: 'wrap' }}>
          <Chip label={t('Trip proposal')} tone="ok" />
          {trip.status === 'cancelled' ? <Chip label={t('Cancelled')} tone="bad" /> : trip.status === 'completed' ? <Chip label={t('Completed')} tone="neutral" /> : trip.status === 'confirmed' ? <Chip label={t('Confirmed')} tone="ok" /> : full ? <Chip label={t('Group full')} tone="warn" /> : <Chip label={tn(trip.spotsLeft, '{n} place open', '{n} places open')} tone="warn" />}
        </Row>
        <View style={{ gap: 10 }}>
          <Text accessibilityRole="header" style={{ color: c.text, fontSize: 24, lineHeight: 30, fontWeight: '600' }}>{trip.title}</Text>
          {trip.description ? (
            // "read more" when it really runs past three lines (bullet points too), not by its number of characters
            <ReadMore text={trip.description} style={{ color: c.muted, fontSize: 15, lineHeight: 27 }} />
          ) : null}
        </View>

        {trip.status === 'cancelled' && <Banner tone="bad">{t('This trip was cancelled.')}</Banner>}
        {trip.canAppealRemoval ? <Btn title={t('Ask for a review')} variant="secondary" onPress={() => go(`/appeal?kind=removal&targetType=trip&targetId=${id}`)} /> : null}
        <ErrorBanner message={act.error} />

        <TripHostCard name={trip.host.displayName} uri={trip.host.photoUrl} verified={!!trip.host.verifiedAdult} label={t('{name}, organizer. Open profile', { name: trip.host.displayName })} onPress={() => go(`/user/${trip.host.id}`)}>
          <Text style={{ color: c.text, fontSize: 16, lineHeight: 21, fontWeight: '500' }}>{t('Organized by {name}', { name: trip.host.displayName })}</Text>
          <Text style={{ color: c.muted, fontSize: 14, lineHeight: 18 }}>{trip.host.verifiedAdult ? t('Verified adult') : t('Organizer')}</Text>
        </TripHostCard>

        {/* where, when and how much */}
        <View style={{ gap: 22, paddingTop: 4 }}>
          <InfoRow icon="location-outline" title={trip.destination} sub={t('From {city}', { city: trip.originCity })} />
          <InfoRow icon="calendar-outline" title={dateSpan(trip.dateStart, trip.dateEnd)} sub={t(flex)} />
          <InfoRow icon="wallet-outline" title={`${money(trip.budget.min, trip.budget.currency)}–${money(trip.budget.max, trip.budget.currency)} ${t('per person')}`} sub={`${trip.budget.label}. ${trip.budget.scope}`} />
        </View>

        {trip.tags.length ? (
          <Row style={{ flexWrap: 'wrap', gap: 6 }}>
            {trip.tags.map((x) => (
              <Chip key={x} label={x} tone="neutral" />
            ))}
          </Row>
        ) : null}

        <View style={{ gap: 16 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text accessibilityRole="header" style={{ color: c.text, fontSize: 20, lineHeight: 26, fontWeight: '600' }}>{t("Who's going")}</Text>
            <Text style={{ color: full ? c.danger : c.green, fontSize: 14, fontWeight: '500' }}>
              {full ? t('Full') : tn(trip.spotsLeft, '{n} place left', '{n} places left')}
            </Text>
          </Row>
          <TripGoingGrid
            capacity={trip.maxCapacity}
            total={going.length}
            people={going.map((p) => ({ id: p.id, name: p.displayName, uri: p.photoUrl, host: p.role === 'organizer' || p.role === 'host' }))}
            a11y={`${t('{going} of {capacity} going', { going: trip.members, capacity: trip.maxCapacity })}. ${t('Going: {names}', { names: going.map((p) => p.displayName).join(', ') })}`}
          />
          <Text style={{ color: c.muted, fontSize: 13, lineHeight: 18 }}>{t('{going} of {capacity} going · goes ahead with {min}+', { going: trip.members, capacity: trip.maxCapacity, min: trip.minCapacity })}</Text>
        </View>

        <Row style={{ backgroundColor: c.accentSoft, borderRadius: 14, padding: 11, gap: 10, alignItems: 'flex-start' }}>
          <Ionicons name="lock-closed-outline" size={16} color={c.forest} />
          <Txt variant="small" style={{ flex: 1, color: c.text, lineHeight: 17 }}>{t('Your exact location stays private. The group chat and private plans open once the organizer approves your application.')}</Txt>
        </Row>

        {trip.datesState === 'proposed' && !closed ? (
          <View style={{ backgroundColor: c.accentSoft, borderRadius: 14, padding: 12, gap: 8 }}>
            <Txt variant="h3" style={{ fontSize: 14, lineHeight: 18 }}>{t('Final dates: {dates}', { dates: dateSpan(trip.dateStart, trip.dateEnd) })}</Txt>
            <Txt variant="small">{t('{n} of {total} travelers confirmed.', { n: trip.datesConfirmedCount ?? 0, total: trip.members })}</Txt>
            {(trip.participants ?? []).map((p) => (
              <Row key={p.id} style={{ gap: 8, alignItems: 'center' }}>
                <Ionicons name={p.datesConfirmed ? 'checkmark-circle' : 'time-outline'} size={18} color={p.datesConfirmed ? c.green : c.muted} />
                <Txt variant="small" style={{ flex: 1, color: c.text }}>{p.displayName}{p.role === 'organizer' || p.role === 'host' ? ` ${t('(organizer)')}` : ''}</Txt>
                <Txt variant="small">{p.datesConfirmed ? t('Confirmed') : t('Waiting')}</Txt>
              </Row>
            ))}
            {trip.isMember && !trip.myDatesConfirmed ? <Btn title={t('I can travel on these dates')} small loading={act.busy} onPress={() => void act.run(() => post(`/v1/trips/${id}/confirm-dates`))} /> : trip.myDatesConfirmed ? <Txt variant="small" bold color={c.green}>{t('You confirmed these dates ✓')}</Txt> : null}
          </View>
        ) : null}

        <Banner>{trip.disclaimer}</Banner>

        {/* the lesser actions; the main one is in the bar below */}
        {trip.isHost ? (
          <View style={{ gap: 10 }}>
            {trip.conversationId && <Btn title={t('Open group chat')} variant="secondary" onPress={() => go(`/chat/${trip.conversationId}`)} />}
            {trip.status !== 'cancelled' ? <Btn title={t('Trip Plan')} variant="secondary" onPress={() => go(`/trip-plan/${id}`)} /> : null}
            {trip.status !== 'cancelled' && new Date(trip.dateStart) <= new Date() ? <Btn title={t('Who came?')} variant="secondary" onPress={() => go(`/no-shows/trip/${id}`)} /> : null}
            {trip.status !== 'cancelled' && (
              <Btn title={t('Cancel trip')} variant="danger" loading={act.busy} onPress={async () => (await confirmAsync(t('Cancel this trip?'), t('Everyone in the group will be notified.'), t('Cancel trip'), true)) && void act.run(() => post(`/v1/trips/${id}/cancel`))} />
            )}
          </View>
        ) : trip.isMember ? (
          <View style={{ gap: 10 }}>
            <Banner tone="ok">{t("You're in the group.")}</Banner>
            <Btn title={t('Trip Plan')} variant="secondary" onPress={() => go(`/trip-plan/${id}`)} />
            {trip.isMember && !trip.isHost && trip.status !== 'cancelled' && hostNoShowOpen(trip.dateStart, trip.dateEnd) ? (noShow === 'sent' || noShow === 'confirm' ? <Txt variant="small" style={{ textAlign: 'center' }}>{t('You told us the host did not show up')}</Txt> : <Btn title={t('Host did not show up')} variant="secondary" onPress={() => setNoShow('open')} />) : null}
            {canLeave ? <Btn title={t('Leave trip')} variant="secondary" loading={act.busy} onPress={async () => (await confirmAsync(t('Leave this trip?'), undefined, t('Leave'))) && void act.run(() => post(`/v1/trips/${id}/leave`))} /> : null}
          </View>
        ) : app && app.state === 'pending' ? (
          <Banner tone="warn">{app.message}</Banner>
        ) : app && ['declined', 'waitlisted'].includes(app.state) ? (
          <View style={{ gap: 10 }}>
            <Banner tone={app.state === 'declined' ? 'bad' : 'warn'}>{app.message}</Banner>
            {app.canAppeal ? <AskAgain path={`/v1/trips/${id}`} who="organizer" onDone={reload} /> : null}
          </View>
        ) : null}
        <ReportSheet target={report} onClose={() => setReport(null)} />
        <HostNoShowSheet kind="trip" id={id} visible={noShow === 'open' || noShow === 'confirm'} onClose={() => setNoShow((v) => (v === 'confirm' || v === 'sent' ? 'sent' : 'closed'))} onSent={() => setNoShow('confirm')} />
      </Screen>

      {primary ? (
        <BottomBar onHeight={setBarH}>
          <Btn title={primary.title} variant={primary.variant} disabled={primary.disabled} loading={primary.loading} onPress={primary.onPress} />
          {primary.caption ? <Txt variant="small" style={{ textAlign: 'center' }}>{primary.caption}</Txt> : null}
        </BottomBar>
      ) : null}

      {/* fixed over the page: back on the left; share and more on the right */}
      <View pointerEvents="box-none" style={{ position: 'absolute', top, left: gutter, right: gutter, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <FloatingButton round size={38} fx="nudge" icon="chevron-back" label={t('Go back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {isGuest || !(ahead || fav) ? null : (
            <FloatingButton
              round
              size={38}
              fx="pop"
              icon={fav ? 'heart' : 'heart-outline'}
              color={fav ? '#FF6B6B' : '#fff'}
              label={fav ? t('Remove from favourites') : t('Add to favourites')}
              onPress={() => {
                const next = !fav;
                setFavNow(next);
                void act.run(() => (next ? post(`/v1/trips/${id}/favorite`) : del(`/v1/trips/${id}/favorite`))).then((r) => r === undefined && setFavNow(null));
              }}
            />
          )}
          {ahead ? <FloatingButton round size={38} icon="share-social-outline" label={t('Share this trip')} onPress={share} /> : null}
          {menu.length ? <Menu floating round size={38} items={menu} /> : null}
        </View>
      </View>
    </View>
  );
}
