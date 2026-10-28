import Ionicons from '@expo/vector-icons/Ionicons';
import { SkeletonDetail } from '@/components/Skeleton';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AskAgain } from '@/components/AskAgain';
import { FloatingButton, Hero } from '@/components/Hero';
import { Menu } from '@/components/Menu';
import { ReportSheet } from '@/components/ReportSheet';
import { Avatar, Banner, Btn, Chip, Empty, ErrorBanner, Row, Screen, Txt, useGo } from '@/components/ui';
import { del, get, post, type Trip } from '@/lib/api';
import { shareLink } from '@/lib/shareLink';
import { useMe } from '@/lib/auth';
import { FLEX } from '@/lib/constants';
import { confirmAsync } from '@/lib/confirm';
import { dateSpan, money } from '@/lib/format';
import { useAction, useLoad } from '@/lib/hooks';
import { statusTop, useLayout } from '@/lib/layout';
import { useTheme } from '@/lib/theme';
import { useT } from '@/lib/i18n';

/** THERE · Trip detail. A proposal with an estimated budget. Never a booking, never a guaranteed departure. Laid out like an activity. */
export default function TripDetail() {
  const { t, tn } = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me, isGuest, logout } = useMe();
  const { c } = useTheme();
  const router = useRouter();
  const go = useGo();
  const insets = useSafeAreaInsets();
  const HERO = c.heroBlock;
  const { gutter } = useLayout();
  const [expanded, setExpanded] = useState(false);
  const { data: trip, error, loading, reload } = useLoad(() => get<Trip>(`/v1/trips/${id}`), [id], undefined, 'trip', { animate: true });
  const act = useAction(reload);
  const [report, setReport] = useState<{ type: 'trip' | 'user'; id: string } | null>(null);
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
  const closed = ['cancelled', 'completed'].includes(trip.status);
  const full = trip.status === 'full' || trip.spotsLeft === 0;
  // a cancelled trip, or one that has started, cannot be saved or shared (a saved one can still be taken out)
  const ahead = !closed && +new Date(trip.dateStart) > Date.now();
  const fav = favNow ?? !!trip.favorited;

  const menu = trip.isHost || isGuest
    ? []
    : [
        { label: t('Report this trip'), onSelect: () => setReport({ type: 'trip', id: trip.id }) },
        { label: t('Report {name}', { name: trip.host.displayName }), onSelect: () => setReport({ type: 'user', id: trip.host.id }) },
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
  const longText = (trip.description?.length ?? 0) > 130;
  const flex = FLEX.find(([v]) => v === trip.dateFlexibility)?.[1] ?? trip.dateFlexibility;

  const top = statusTop(insets.top) + 8;
  const PHOTO = 250 + top; // the picture's full height
  const STRIP = top + 84; // what is left of it once collapsed: the button row plus the sheet's rounded edge

  // who is going: up to three faces, open places drawn as dashed rings, and a bar with one segment per place
  const going = trip.participants ?? [];
  const faces = going.slice(0, 3);
  const rings = Math.max(0, Math.min(3, trip.maxCapacity) - faces.length);
  const segs = Math.min(trip.maxCapacity, 12);
  const filled = Math.min(segs, Math.round((trip.members / Math.max(trip.maxCapacity, 1)) * segs));

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
        stickyHero={{
          scrolling: (
            <View style={{ height: PHOTO - STRIP, overflow: 'hidden' }}>
              <Hero plain round height={PHOTO} color={HERO} emoji="✈️" />
            </View>
          ),
          pinned: (
            <View style={{ height: STRIP, overflow: 'hidden', backgroundColor: c.bg }}>
              <View style={{ marginTop: -(PHOTO - STRIP) }}>
                <Hero plain round height={PHOTO} color={HERO} emoji="✈️" />
              </View>
              <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 28, backgroundColor: c.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28 }} />
            </View>
          ),
        }}
      >
        <Stack.Screen options={{ headerShown: false }} />

        <Row style={{ gap: 8, flexWrap: 'wrap' }}>
          <Chip label={t('Trip proposal')} tone="ok" />
          {trip.status === 'cancelled' ? <Chip label={t('Cancelled')} tone="bad" /> : trip.status === 'completed' ? <Chip label={t('Completed')} tone="neutral" /> : trip.status === 'confirmed' ? <Chip label={t('Confirmed')} tone="ok" /> : full ? <Chip label={t('Group full')} tone="warn" /> : <Chip label={tn(trip.spotsLeft, '{n} place open', '{n} places open')} tone="warn" />}
        </Row>
        <Txt variant="h1" style={{ fontSize: 22, lineHeight: 28 }}>{trip.title}</Txt>

        {trip.status === 'cancelled' && <Banner tone="bad">{t('This trip was cancelled.')}</Banner>}
        {trip.canAppealRemoval ? <Btn title={t('Ask for a review')} variant="secondary" onPress={() => go(`/appeal?kind=removal&targetType=trip&targetId=${id}`)} /> : null}
        <ErrorBanner message={act.error} />

        <Pressable accessibilityRole="button" accessibilityLabel={t('{name}, organizer. Open profile', { name: trip.host.displayName })} onPress={() => go(`/user/${trip.host.id}`)}>
          <Row style={{ gap: 14 }}>
            <Avatar name={trip.host.displayName} uri={trip.host.photoUrl} size={42} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="h3" style={{ fontSize: 14, lineHeight: 18 }}>{t('Organized by {name}', { name: trip.host.displayName })}</Txt>
              <Row style={{ gap: 6 }}>
                {trip.host.verifiedAdult ? <Ionicons name="shield-checkmark" size={13} color={c.green} /> : null}
                <Txt variant="small" style={{ flex: 1 }}>{trip.host.verifiedAdult ? t('Verified adult') : t('Organizer')}</Txt>
              </Row>
            </View>
          </Row>
        </Pressable>

        {/* when, from where and how much, in one card */}
        <View style={{ backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.line, overflow: 'hidden' }}>
          <Row style={{ gap: 12, padding: 12 }}>
            <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.sand, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="calendar-outline" size={18} color={c.forest} />
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Txt variant="h3" style={{ fontSize: 14, lineHeight: 18 }}>{dateSpan(trip.dateStart, trip.dateEnd)}</Txt>
              <Txt variant="muted">{t(flex)}</Txt>
            </View>
          </Row>
          <View style={{ height: 1, backgroundColor: c.line, marginHorizontal: 16 }} />
          <Row style={{ gap: 12, padding: 12 }}>
            <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="airplane-outline" size={18} color={c.forest} />
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Txt variant="h3" style={{ fontSize: 14, lineHeight: 18 }}>{t('From {city}', { city: trip.originCity })}</Txt>
            </View>
          </Row>
          <View style={{ height: 1, backgroundColor: c.line, marginHorizontal: 16 }} />
          <Row style={{ gap: 12, padding: 12 }}>
            <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.sand, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="wallet-outline" size={18} color={c.forest} />
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Txt variant="h3" style={{ fontSize: 14, lineHeight: 18 }}>{money(trip.budget.min, trip.budget.currency)}–{money(trip.budget.max, trip.budget.currency)} {t('per person')}</Txt>
              <Txt variant="muted">{trip.budget.label}. {trip.budget.scope}</Txt>
            </View>
          </Row>
        </View>

        {trip.tags.length ? (
          <Row style={{ flexWrap: 'wrap', gap: 6 }}>
            {trip.tags.map((x) => (
              <Chip key={x} label={x} tone="neutral" />
            ))}
          </Row>
        ) : null}

        {trip.description ? (
          <View style={{ gap: 4 }}>
            <Txt variant="muted" numberOfLines={expanded ? undefined : 3} style={{ lineHeight: 20 }}>
              {trip.description}
            </Txt>
            {longText ? (
              <Pressable accessibilityRole="button" accessibilityLabel={expanded ? t('Read less') : t('Read more')} onPress={() => setExpanded((v) => !v)} hitSlop={8}>
                <Txt bold color={c.green}>{expanded ? t('read less') : t('read more')}</Txt>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View style={{ gap: 12 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt variant="h2" accessibilityRole="header" style={{ fontSize: 16, lineHeight: 21 }}>{t("Who's going")}</Txt>
            <Txt variant="h3" style={{ fontSize: 12 }} color={full ? c.danger : c.green}>
              {full ? t('Full') : tn(trip.spotsLeft, '{n} place left', '{n} places left')}
            </Txt>
          </Row>
          <Row style={{ gap: 14 }}>
            <View accessible accessibilityLabel={t('Going: {names}', { names: going.map((p) => p.displayName).join(', ') })} style={{ flexDirection: 'row', alignItems: 'center' }}>
              {faces.map((p, i) => (
                <View key={p.id} style={{ marginLeft: i === 0 ? 0 : -10, borderRadius: 999, borderWidth: 2, borderColor: c.bg }}>
                  <Avatar name={p.displayName} uri={p.photoUrl} size={30} />
                </View>
              ))}
              {Array.from({ length: rings }).map((_, i) => (
                <View key={`r${i}`} accessibilityElementsHidden importantForAccessibility="no" style={{ marginLeft: faces.length + i === 0 ? 0 : -10, width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.muted, backgroundColor: c.bg }} />
              ))}
            </View>
            <View style={{ flex: 1, gap: 8 }}>
              <Txt variant="muted">{t('{going} of {capacity} going · goes ahead with {min}+', { going: trip.members, capacity: trip.maxCapacity, min: trip.minCapacity })}</Txt>
              <View accessibilityElementsHidden importantForAccessibility="no" style={{ flexDirection: 'row', gap: 4 }}>
                {Array.from({ length: segs }).map((_, i) => (
                  <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i < filled ? c.green : c.line }} />
                ))}
              </View>
            </View>
          </Row>
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
            <Btn title={t('Leave trip')} variant="secondary" loading={act.busy} onPress={async () => (await confirmAsync(t('Leave this trip?'), undefined, t('Leave'))) && void act.run(() => post(`/v1/trips/${id}/leave`))} />
          </View>
        ) : app && app.state === 'pending' ? (
          <Banner tone="warn">{app.message}</Banner>
        ) : app && ['declined', 'waitlisted'].includes(app.state) ? (
          <View style={{ gap: 10 }}>
            <Banner tone={app.state === 'declined' ? 'bad' : 'warn'}>{app.message}</Banner>
            {app.canAppeal ? <AskAgain path={`/v1/trips/${id}`} who="organizer" onDone={reload} /> : null}
          </View>
        ) : null}

        {/* room under the content for the fixed bar */}
        {primary ? <View style={{ height: 64 + insets.bottom }} /> : null}
        <ReportSheet target={report} onClose={() => setReport(null)} />
      </Screen>

      {primary ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: c.bg, borderTopWidth: 1, borderTopColor: c.line, paddingTop: 8, paddingBottom: insets.bottom + 8, paddingHorizontal: gutter, alignItems: 'center' }}>
          <View style={{ width: '100%', maxWidth: 760, gap: 6 }}>
            <Btn title={primary.title} variant={primary.variant} disabled={primary.disabled} loading={primary.loading} onPress={primary.onPress} />
            {primary.caption ? <Txt variant="small" style={{ textAlign: 'center' }}>{primary.caption}</Txt> : null}
          </View>
        </View>
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
