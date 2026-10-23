import Ionicons from '@expo/vector-icons/Ionicons';
import { SkeletonDetail } from '@/components/Skeleton';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FloatingButton, Hero } from '@/components/Hero';
import { Menu } from '@/components/Menu';
import { ReportSheet } from '@/components/ReportSheet';
import { Avatar, Banner, Btn, Chip, Empty, ErrorBanner, Row, Screen, Txt, useGo } from '@/components/ui';
import { del, get, post, type Trip } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { FLEX } from '@/lib/constants';
import { confirmAsync } from '@/lib/confirm';
import { dateSpan, money } from '@/lib/format';
import { useAction, useLoad } from '@/lib/hooks';
import { statusTop, useLayout } from '@/lib/layout';
import { useTheme } from '@/lib/theme';

/** THERE · Trip detail. A proposal with an estimated budget. Never a booking, never a guaranteed departure. Laid out like an activity. */
export default function TripDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me, isGuest, logout } = useMe();
  const { c } = useTheme();
  const router = useRouter();
  const go = useGo();
  const insets = useSafeAreaInsets();
  const HERO = c.heroBlock;
  const { gutter } = useLayout();
  const [expanded, setExpanded] = useState(false);
  const { data: t, error, loading, reload } = useLoad(() => get<Trip>(`/v1/trips/${id}`), [id], undefined, 'trip', { animate: true });
  const act = useAction(reload);
  const [report, setReport] = useState<{ type: 'trip' | 'user'; id: string } | null>(null);

  if (loading && !t)
    return (
      <Screen hero={<Hero plain color={HERO} emoji="✈️" />}>
        <SkeletonDetail />
      </Screen>
    );
  if (error || !t)
    return (
      <Screen hero={<Hero plain color={HERO} emoji="✈️" />}>
        <Empty title="Trip not found">It may have been cancelled or is no longer available.</Empty>
      </Screen>
    );

  const verified = me?.eligibility === 'verified';
  const app = t.myApplication;
  const closed = ['cancelled', 'completed'].includes(t.status);
  const full = t.status === 'full' || t.spotsLeft === 0;

  const menu = t.isHost || isGuest
    ? []
    : [
        { label: 'Report this trip', onSelect: () => setReport({ type: 'trip', id: t.id }) },
        { label: `Report ${t.host.displayName}`, onSelect: () => setReport({ type: 'user', id: t.host.id }) },
        {
          label: `Block ${t.host.displayName}`,
          danger: true,
          onSelect: async () => {
            if (await confirmAsync(`Block ${t.host.displayName}?`, "You won't see each other's trips or activities, in HERE or THERE.", 'Block', true)) {
              await act.run(() => post('/v1/blocks', { userId: t.host.id }));
              router.back();
            }
          },
        },
      ];

  const share = () => void Share.share({ message: `${t.title}, ${dateSpan(t.dateStart, t.dateEnd)}, from ${t.originCity}` }).catch(() => undefined);
  const longText = (t.description?.length ?? 0) > 130;
  const flex = FLEX.find(([v]) => v === t.dateFlexibility)?.[1] ?? t.dateFlexibility;

  const top = statusTop(insets.top) + 8;
  const PHOTO = 250 + top; // the picture's full height
  const STRIP = top + 84; // what is left of it once collapsed: the button row plus the sheet's rounded edge

  // who is going: up to three faces, open places drawn as dashed rings, and a bar with one segment per place
  const going = t.participants ?? [];
  const faces = going.slice(0, 3);
  const rings = Math.max(0, Math.min(3, t.maxCapacity) - faces.length);
  const segs = Math.min(t.maxCapacity, 12);
  const filled = Math.min(segs, Math.round((t.members / Math.max(t.maxCapacity, 1)) * segs));

  // The one main action sits in a bar fixed to the bottom; the lesser ones stay in the page.
  type Primary = { title: string; onPress?: () => void; variant?: 'secondary'; disabled?: boolean; loading?: boolean; caption?: string };
  let primary: Primary | null = null;
  if (!closed) {
    if (t.isHost) primary = { title: 'Review applications', onPress: () => go(`/review/${id}`) };
    else if (t.isMember) primary = t.conversationId ? { title: 'Open group chat', onPress: () => go(`/chat/${t.conversationId}`) } : null;
    else if (app && app.state === 'pending') primary = { title: 'Withdraw application', variant: 'secondary', loading: act.busy, onPress: () => void act.run(() => del(`/v1/trips/${id}/applications/mine`)) };
    else if (app && ['declined', 'waitlisted'].includes(app.state)) primary = null;
    else if (full) primary = { title: 'This group is full', disabled: true };
    else if (isGuest) primary = { title: 'Create an account to apply', onPress: () => logout() };
    else if (!verified) primary = { title: 'Verify your identity to apply', onPress: () => go('/verify') };
    else primary = { title: app ? 'Apply again' : 'Request to join', onPress: () => go(`/apply/${id}`), caption: 'The organizer reviews every application' };
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
          <Chip label="Trip proposal" tone="ok" />
          {t.status === 'cancelled' ? <Chip label="Cancelled" tone="bad" /> : full ? <Chip label="Group full" tone="warn" /> : <Chip label={`${t.spotsLeft} places open`} tone="warn" />}
        </Row>
        <Txt variant="h1" style={{ fontSize: 22, lineHeight: 28 }}>{t.title}</Txt>

        {t.status === 'cancelled' && <Banner tone="bad">This trip was cancelled.</Banner>}
        <ErrorBanner message={act.error} />

        <Pressable accessibilityRole="button" accessibilityLabel={`${t.host.displayName}, organizer. Open profile`} onPress={() => go(`/user/${t.host.id}`)}>
          <Row style={{ gap: 14 }}>
            <Avatar name={t.host.displayName} uri={t.host.photoUrl} size={42} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="h3" style={{ fontSize: 14, lineHeight: 18 }}>Organized by {t.host.displayName}</Txt>
              <Row style={{ gap: 6 }}>
                {t.host.verifiedAdult ? <Ionicons name="shield-checkmark" size={13} color={c.green} /> : null}
                <Txt variant="small" style={{ flex: 1 }}>{t.host.verifiedAdult ? 'Verified adult' : 'Organizer'}</Txt>
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
              <Txt variant="h3" style={{ fontSize: 14, lineHeight: 18 }}>{dateSpan(t.dateStart, t.dateEnd)}</Txt>
              <Txt variant="muted">{flex}</Txt>
            </View>
          </Row>
          <View style={{ height: 1, backgroundColor: c.line, marginHorizontal: 16 }} />
          <Row style={{ gap: 12, padding: 12 }}>
            <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="airplane-outline" size={18} color={c.forest} />
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Txt variant="h3" style={{ fontSize: 14, lineHeight: 18 }}>From {t.originCity}</Txt>
              <Txt variant="muted">Others can leave from other cities</Txt>
            </View>
          </Row>
          <View style={{ height: 1, backgroundColor: c.line, marginHorizontal: 16 }} />
          <Row style={{ gap: 12, padding: 12 }}>
            <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.sand, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="wallet-outline" size={18} color={c.forest} />
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Txt variant="h3" style={{ fontSize: 14, lineHeight: 18 }}>{money(t.budget.min, t.budget.currency)}–{money(t.budget.max, t.budget.currency)} per person</Txt>
              <Txt variant="muted">{t.budget.label}. {t.budget.scope}</Txt>
            </View>
          </Row>
        </View>

        {t.tags.length ? (
          <Row style={{ flexWrap: 'wrap', gap: 6 }}>
            {t.tags.map((x) => (
              <Chip key={x} label={x} tone="neutral" />
            ))}
          </Row>
        ) : null}

        {t.description ? (
          <View style={{ gap: 4 }}>
            <Txt variant="muted" numberOfLines={expanded ? undefined : 3} style={{ lineHeight: 20 }}>
              {t.description}
            </Txt>
            {longText ? (
              <Pressable accessibilityRole="button" accessibilityLabel={expanded ? 'Read less' : 'Read more'} onPress={() => setExpanded((v) => !v)} hitSlop={8}>
                <Txt bold color={c.green}>{expanded ? 'read less' : 'read more'}</Txt>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View style={{ gap: 12 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt variant="h2" accessibilityRole="header" style={{ fontSize: 16, lineHeight: 21 }}>Who's going</Txt>
            <Txt variant="h3" style={{ fontSize: 12 }} color={full ? c.danger : c.green}>
              {full ? 'Full' : `${t.spotsLeft} ${t.spotsLeft === 1 ? 'place' : 'places'} left`}
            </Txt>
          </Row>
          <Row style={{ gap: 14 }}>
            <View accessible accessibilityLabel={`Going: ${going.map((p) => p.displayName).join(', ')}`} style={{ flexDirection: 'row', alignItems: 'center' }}>
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
              <Txt variant="muted">{t.members} of {t.maxCapacity} going · goes ahead with {t.minCapacity}+</Txt>
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
          <Txt variant="small" style={{ flex: 1, color: c.text, lineHeight: 17 }}>Your exact location stays private. The group chat and private plans open once the organizer approves your application.</Txt>
        </Row>

        {t.datesState === 'proposed' ? (
          <View style={{ backgroundColor: c.accentSoft, borderRadius: 14, padding: 12, gap: 8 }}>
            <Txt variant="h3" style={{ fontSize: 14, lineHeight: 18 }}>Final dates: {dateSpan(t.dateStart, t.dateEnd)}</Txt>
            <Txt variant="small">{t.datesConfirmedCount ?? 0} of {t.members} travelers confirmed. Everyone has to confirm for the dates to be final.</Txt>
            {t.isMember && !t.myDatesConfirmed ? <Btn title="I can travel on these dates" small loading={act.busy} onPress={() => void act.run(() => post(`/v1/trips/${id}/confirm-dates`))} /> : t.myDatesConfirmed ? <Txt variant="small" bold color={c.green}>You confirmed these dates ✓</Txt> : null}
          </View>
        ) : null}

        <Banner>{t.disclaimer}</Banner>

        {/* the lesser actions; the main one is in the bar below */}
        {t.isHost ? (
          <View style={{ gap: 10 }}>
            {t.conversationId && <Btn title="Open group chat" variant="secondary" onPress={() => go(`/chat/${t.conversationId}`)} />}
            {t.status !== 'cancelled' && (
              <Btn title="Cancel trip" variant="danger" loading={act.busy} onPress={async () => (await confirmAsync('Cancel this trip?', 'Everyone in the group will be notified.', 'Cancel trip', true)) && void act.run(() => post(`/v1/trips/${id}/cancel`))} />
            )}
          </View>
        ) : t.isMember ? (
          <View style={{ gap: 10 }}>
            <Banner tone="ok">You're in the group.</Banner>
            <Banner>Date polls and a shared itinerary are coming soon. For now, agree dates and plans in the group chat.</Banner>
            <Btn title="Leave trip" variant="secondary" loading={act.busy} onPress={async () => (await confirmAsync('Leave this trip?', undefined, 'Leave')) && void act.run(() => post(`/v1/trips/${id}/leave`))} />
          </View>
        ) : app && app.state === 'pending' ? (
          <Banner tone="warn">{app.message}. You can't see the group chat or private plans until you're approved.</Banner>
        ) : app && ['declined', 'waitlisted'].includes(app.state) ? (
          <Banner tone={app.state === 'declined' ? 'bad' : 'warn'}>{app.message}</Banner>
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
        <FloatingButton round size={38} fx="nudge" icon="chevron-back" label="Go back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <FloatingButton round size={38} icon="share-social-outline" label="Share this trip" onPress={share} />
          {menu.length ? <Menu floating round size={38} items={menu} /> : null}
        </View>
      </View>
    </View>
  );
}
