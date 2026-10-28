import Ionicons from '@expo/vector-icons/Ionicons';
import { AskAgain } from '@/components/AskAgain';
import { ReliabilityChip } from '@/components/ReliabilityChip';
import { SkeletonDetail } from '@/components/Skeleton';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FloatingButton, Hero } from '@/components/Hero';
import { Menu } from '@/components/Menu';
import { ReportSheet } from '@/components/ReportSheet';
import { Avatar, Banner, Btn, Chip, Empty, ErrorBanner, Row, Screen, Sheet, Txt, useGo } from '@/components/ui';
import { del, get, post, type Activity } from '@/lib/api';
import { shareLink } from '@/lib/shareLink';
import { useMe } from '@/lib/auth';
import { catColor, CATS } from '@/lib/constants';
import { confirmAsync } from '@/lib/confirm';
import { hhmm, when as whenLabel } from '@/lib/format';
import { useAction, useLoad } from '@/lib/hooks';
import { statusTop, useLayout } from '@/lib/layout';
import { useTheme } from '@/lib/theme';
import { t, tn, useT } from '@/lib/i18n';

/** "Starts in 40 min", "Starts in 3 hrs", "Tomorrow", ... and how it ended once it is over. */
function startsIn(a: Activity): { text: string; tone: 'info' | 'ok' | 'warn' | 'bad' | 'neutral' } {
  if (a.status === 'cancelled') return { text: t('Cancelled'), tone: 'bad' };
  if (a.status === 'completed' || a.status === 'archived') return { text: t('Ended'), tone: 'neutral' };
  const m = Math.round((+new Date(a.startsAt) - Date.now()) / 60000);
  if (a.status === 'in_progress' || m <= 0) return { text: t('Happening now'), tone: 'ok' };
  if (m < 60) return { text: t('Starts in {m} min', { m }), tone: 'warn' };
  if (m < 24 * 60) {
    const h = Math.round(m / 60);
    return { text: tn(h, 'Starts in {n} hr', 'Starts in {n} hrs'), tone: 'warn' };
  }
  return { text: whenLabel(a.startsAt).replace(/\s\d{1,2}:\d{2}.*$/, ''), tone: 'warn' };
}

/** HERE · Activity detail. The join button always reflects server-side state, never a client guess. */
export default function ActivityDetail() {
  const { t, tn } = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me, isGuest, logout } = useMe();
  const { c, mode, switchMode } = useTheme();
  const router = useRouter();
  const go = useGo();
  const insets = useSafeAreaInsets();
  const { gutter } = useLayout();
  const [expanded, setExpanded] = useState(false);
  const [handing, setHanding] = useState(false); // the host's "hand over hosting" list of members
  // the heart answers at once; the server confirms a moment later (a failed save puts it back)
  const [favNow, setFavNow] = useState<boolean | null>(null);
  const { data: a, error, loading, reload } = useLoad(() => get<Activity>(`/v1/activities/${id}`), [id], undefined, 'activity', { animate: true });
  const act = useAction(reload);
  const [report, setReport] = useState<{ type: 'activity' | 'user'; id: string } | null>(null);
  useEffect(() => {
    if (favNow !== null && !!a?.favorited === favNow) setFavNow(null); // the server has caught up
  }, [a?.favorited, favNow]);

  if (loading && !a)
    return (
      <Screen hero={<Hero plain color="#D3EADD" />}>
        <SkeletonDetail />
      </Screen>
    );
  if (error || !a)
    return (
      <Screen hero={<Hero plain color="#D3EADD" />}>
        <Empty title={t('Activity not found')} />
      </Screen>
    );

  const cat = CATS[a.category];
  const verified = me?.eligibility === 'verified';
  const req = a.myRequest?.state;
  const closed = ['in_progress', 'completed', 'cancelled', 'archived'].includes(a.status);
  const over = a.status === 'completed' || a.status === 'archived';

  const canHandOver = a.isHost && !over && a.status !== 'cancelled' && !a.handover && (a.participants ?? []).some((p) => p.role !== 'host' && p.verifiedAdult);
  const menu = [
    ...(canHandOver ? [{ label: t('Hand over hosting'), onSelect: () => setHanding(true) }] : []),
    { label: a.favorited ? t('Remove from favourites') : t('Add to favourites'), onSelect: () => void act.run(() => (a.favorited ? del(`/v1/activities/${id}/favorite`) : post(`/v1/activities/${id}/favorite`))) },
    ...(a.isHost
      ? []
      : [
          { label: t('Report this activity'), onSelect: () => setReport({ type: 'activity', id: a.id }) },
          { label: t('Report {name}', { name: a.host.displayName }), onSelect: () => setReport({ type: 'user', id: a.host.id }) },
          {
            label: t('Block {name}', { name: a.host.displayName }),
            danger: true,
            onSelect: async () => {
              if (await confirmAsync(t('Block {name}?', { name: a.host.displayName }), t("You won't see each other's activities, in HERE or THERE."), t('Block'), true)) {
                await act.run(() => post('/v1/blocks', { userId: a.host.id }));
                router.back();
              }
            },
          },
        ]),
  ];

  // "Today, 01:05 PM – 03:05 PM" and how long it lasts
  const day = whenLabel(a.startsAt).replace(/\s\d{1,2}:\d{2}.*$/, '');
  const timeText = `${day}, ${hhmm(a.startsAt)} – ${hhmm(a.endsAt)}`;
  const mins = Math.max(0, Math.round((+new Date(a.endsAt) - +new Date(a.startsAt)) / 60000));
  const length = mins >= 60 ? `${tn(Math.floor(mins / 60), '{n} hour', '{n} hours')}${mins % 60 ? ` ${t('{m} min', { m: mins % 60 })}` : ''}` : t('{m} min', { m: mins });
  // the map tab picks this activity's pin and zooms to its venue (it only exists in HERE, so flip there first)
  const showOnMap = () => {
    if (mode !== 'here') switchMode('here');
    router.navigate(`/discover?focus=${a.id}&t=${Date.now()}` as never);
  };
  // the link opens this activity in the app, or sends the person to the App Store / Google Play when they have not got it
  const share = () => void Share.share({ message: `${t('{title}, {time} at {venue}, {city}', { title: a.title, time: timeText, venue: a.venueName, city: a.city })}\n${shareLink('activity', a.id)}` }).catch(() => undefined);
  const longText = (a.description?.length ?? 0) > 130;
  const soon = startsIn(a);

  const top = statusTop(insets.top) + 8;
  const PHOTO = 250 + top; // the picture's full height
  const STRIP = top + 84; // what is left of it once collapsed: the button row (44) plus the sheet's 28 px rounded edge and a little air, so the white stays below the buttons
  const fav = favNow ?? !!a.favorited;

  // who is going: up to three faces, open places drawn as dashed rings, and a bar with one segment per place
  const going = a.participants ?? [];
  const faces = going.slice(0, 3);
  const rings = Math.max(0, Math.min(3, a.capacity) - faces.length);
  const segs = Math.min(a.capacity, 12);
  const filled = Math.min(segs, Math.round((a.going / Math.max(a.capacity, 1)) * segs));

  // The one main action sits in a bar fixed to the bottom; the lesser ones stay in the page.
  type Primary = { title: string; onPress?: () => void; variant?: 'secondary'; disabled?: boolean; loading?: boolean; caption?: string };
  let primary: Primary | null = null;
  if (!over && a.status !== 'cancelled') {
    // once it has started, unanswered requests are closed for good: the host has nothing left to manage
    if (a.isHost) primary = a.status === 'in_progress' ? (a.conversationId ? { title: t('Open group chat'), onPress: () => go(`/chat/${a.conversationId}`) } : null) : { title: t('Manage join requests'), onPress: () => go(`/host/${id}`) };
    else if (a.isMember) primary = a.conversationId ? { title: t('Open group chat'), onPress: () => go(`/chat/${a.conversationId}`) } : null;
    else if (req === 'requested') primary = { title: t('Withdraw request'), variant: 'secondary', loading: act.busy, onPress: () => void act.run(() => del(`/v1/activities/${id}/requests/mine`)) };
    else if (req === 'waitlisted') primary = { title: t('Leave the waiting list'), variant: 'secondary', loading: act.busy, onPress: () => void act.run(() => del(`/v1/activities/${id}/requests/mine`)) };
    else if (req === 'declined' || closed) primary = null;
    else if (a.spotsLeft === 0 && isGuest) primary = { title: t('Create an account to join the waiting list'), onPress: () => logout() };
    else if (a.spotsLeft === 0 && !verified) primary = { title: t('Verify your identity to join the waiting list'), onPress: () => go('/verify') };
    else if (a.spotsLeft === 0) primary = { title: t('Join the waiting list'), onPress: () => go(`/join/${id}`) };
    else if (isGuest) primary = { title: t('Create an account to join'), onPress: () => logout() };
    else if (!verified) primary = { title: t('Verify your identity to join'), onPress: () => go('/verify') };
    else if (a.joinPolicy === 'instant') primary = { title: t('Join now'), onPress: () => go(`/join/${id}`) };
    else primary = { title: t('Request to join'), onPress: () => go(`/join/${id}`) };
  }

  return (
    <View style={{ flex: 1 }}>
      {/* The picture is cut in two: the upper part scrolls away with the page; the lower part (with the sheet's rounded top
          edge) scrolls up to the top and then stays there while the white section slides under it. The system's own sticky
          header does the pinning, so there is no scroll code running to lag behind. */}
      <Screen
        stickyHero={{
          scrolling: (
            <View style={{ height: PHOTO - STRIP, overflow: 'hidden' }}>
              <Hero plain round height={PHOTO} color={catColor(a.category)} category={a.category} emoji={cat?.emoji} />
            </View>
          ),
          pinned: (
            <View style={{ height: STRIP, overflow: 'hidden', backgroundColor: c.bg }}>
              <View style={{ marginTop: -(PHOTO - STRIP) }}>
                <Hero plain round height={PHOTO} color={catColor(a.category)} category={a.category} emoji={cat?.emoji} />
              </View>
              <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 28, backgroundColor: c.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28 }} />
            </View>
          ),
        }}
      >
        <Stack.Screen options={{ headerShown: false }} />

        <Row style={{ gap: 8, flexWrap: 'wrap' }}>
          <Chip label={cat ? t(cat.label) : a.category} tone="ok" />
          <Chip label={soon.text} tone={soon.tone} />
        </Row>
        <Txt variant="h1" style={{ fontSize: 22, lineHeight: 28 }}>{a.title}</Txt>

        {a.status === 'cancelled' && <Banner tone="bad">{t('This activity was cancelled.')}</Banner>}
        {a.canAppealRemoval ? <Btn title={t('Ask for a review')} variant="secondary" onPress={() => go(`/appeal?kind=removal&targetType=activity&targetId=${id}`)} /> : null}
        <ErrorBanner message={act.error} />

        <Pressable accessibilityRole="button" accessibilityLabel={t('{name}, host. Open profile', { name: a.host.displayName })} onPress={() => go(`/user/${a.host.id}`)}>
          <Row style={{ gap: 14 }}>
            <Avatar name={a.host.displayName} uri={a.host.photoUrl} size={42} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="h3" style={{ fontSize: 14, lineHeight: 18 }}>{t('Hosted by {name}', { name: a.host.displayName })}</Txt>
              <Row style={{ gap: 6 }}>
                {a.host.verifiedAdult ? <Ionicons name="shield-checkmark" size={13} color={c.green} /> : null}
                <ReliabilityChip r={a.hostReliability} />
                <Txt variant="small" style={{ flex: 1 }}>
                  {[a.host.verifiedAdult ? t('Verified adult') : t('Host'), a.activitiesHosted ? tn(a.activitiesHosted, '{n} activity hosted', '{n} activities hosted') : ''].filter(Boolean).join(' · ')}
                </Txt>
              </Row>
            </View>
          </Row>
        </Pressable>

        {/* when and where in one card; the venue row opens the map on this activity */}
        <View style={{ backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.line, overflow: 'hidden' }}>
          <Row style={{ gap: 12, padding: 12 }}>
            <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.sand, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="time-outline" size={18} color={c.forest} />
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Txt variant="h3" style={{ fontSize: 14, lineHeight: 18 }}>{timeText}</Txt>
              <Txt variant="muted">{length}</Txt>
            </View>
          </Row>
          <View style={{ height: 1, backgroundColor: c.line, marginHorizontal: 16 }} />
          <Pressable accessibilityRole="button" accessibilityLabel={t('{venue}, {city}. Show on the map', { venue: a.venueName, city: a.city })} onPress={showOnMap} style={({ pressed }) => [{ padding: 12 }, pressed && { backgroundColor: c.accentSoft }]}>
            <Row style={{ gap: 12 }}>
              <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="location-outline" size={18} color={c.forest} />
              </View>
              <View style={{ flex: 1, gap: 1 }}>
                <Txt variant="h3" style={{ fontSize: 14, lineHeight: 18 }}>{a.venueName}</Txt>
                <Txt variant="muted">{a.city} · {t('Public meeting venue')}</Txt>
              </View>
              <View style={{ alignItems: 'center', gap: 2 }}>
                <Ionicons name="map-outline" size={16} color={c.green} />
                <Txt variant="small" bold color={c.green}>{t('Map')}</Txt>
              </View>
            </Row>
          </Pressable>
        </View>

        {a.description ? (
          <View style={{ gap: 4 }}>
            <Txt variant="muted" numberOfLines={expanded ? undefined : 3} style={{ lineHeight: 20 }}>
              {a.description}
            </Txt>
            {longText ? (
              <Pressable accessibilityRole="button" accessibilityLabel={expanded ? t('Read less') : t('Read more')} onPress={() => setExpanded((v) => !v)} hitSlop={8}>
                <Txt bold color={c.green}>{expanded ? t('read less') : t('read more')}</Txt>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {over ? (
          // finished: only who took part, for everyone (the host included). No requests, chat, join or leave.
          <View style={{ gap: 10 }}>
            {a.isMember && a.status !== 'cancelled' ? (
              <View style={{ backgroundColor: c.accentSoft, borderRadius: 14, padding: 12, gap: 8 }}>
                <Txt variant="h3" style={{ fontSize: 14, lineHeight: 18 }}>{a.myAttendance === 'attended' ? t('You said you were there') : a.myAttendance === 'no_show' ? t("You said you weren't there") : t('Were you there?')}</Txt>
                <Txt variant="small">{t('Optional, and only you see your answer. It helps keep fake sign-ups out. We never track your location.')}</Txt>
                <Row style={{ gap: 8 }}>
                  <Btn title={t('Yes, I went')} small variant={a.myAttendance === 'attended' ? undefined : 'secondary'} style={{ flex: 1 }} loading={act.busy} onPress={() => void act.run(() => post(`/v1/activities/${id}/attendance`, { attended: true }))} />
                  <Btn title={t('No')} small variant={a.myAttendance === 'no_show' ? undefined : 'secondary'} style={{ flex: 1 }} loading={act.busy} onPress={() => void act.run(() => post(`/v1/activities/${id}/attendance`, { attended: false }))} />
                </Row>
              </View>
            ) : null}
            {a.isHost && a.status !== 'cancelled' ? <Btn title={t('Who came?')} variant="secondary" onPress={() => go(`/no-shows/activity/${id}`)} /> : null}
            <Txt variant="h2" accessibilityRole="header">{t('Members who took part ({n})', { n: going.length })}</Txt>
            {going.map((p) => (
              <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={p.role === 'host' ? t('{name}, host. Open profile', { name: p.displayName }) : t('{name}. Open profile', { name: p.displayName })} onPress={() => go(`/user/${p.id}`)}>
                <Row style={{ gap: 12, paddingVertical: 4 }}>
                  <Avatar name={p.displayName} uri={p.photoUrl} size={40} />
                  <Txt variant="h3" style={{ flex: 1, fontSize: 15 }}>{p.displayName}</Txt>
                  {p.role === 'host' ? <Chip label={t('Host')} tone="info" /> : null}
                </Row>
              </Pressable>
            ))}
          </View>
        ) : (
          <>
            <View style={{ gap: 12 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt variant="h2" accessibilityRole="header" style={{ fontSize: 16, lineHeight: 21 }}>{t("Who's going")}</Txt>
                <Txt variant="h3" style={{ fontSize: 12 }} color={a.spotsLeft === 0 ? c.danger : c.green}>
                  {a.spotsLeft === 0 ? t('Full') : tn(a.spotsLeft, '{n} spot left', '{n} spots left')}
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
                  <Txt variant="muted">{t('{going} of {capacity} going', { going: a.going, capacity: a.capacity })}</Txt>
                  <View accessibilityElementsHidden importantForAccessibility="no" style={{ flexDirection: 'row', gap: 4 }}>
                    {Array.from({ length: segs }).map((_, i) => (
                      <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i < filled ? c.green : c.line }} />
                    ))}
                  </View>
                </View>
              </Row>
            </View>

            {a.needsReconfirm ? (
              <View style={{ backgroundColor: c.warnBg, borderRadius: 14, padding: 12, gap: 8 }}>
                <Txt variant="h3" style={{ fontSize: 14, lineHeight: 18 }}>{t('The host changed the plan')}</Txt>
                <Btn title={t('Yes, I can still come')} small loading={act.busy} onPress={() => void act.run(() => post(`/v1/activities/${id}/reconfirm`))} />
              </View>
            ) : null}
            {a.handover?.toMe ? (
              <View style={{ backgroundColor: c.accentSoft, borderRadius: 14, padding: 12, gap: 8 }}>
                <Txt variant="h3" style={{ fontSize: 14, lineHeight: 18 }}>{t('The host asked you to take over hosting')}</Txt>
                <Row style={{ gap: 8 }}>
                  <Btn title={t('Accept')} small loading={act.busy} style={{ flex: 1 }} onPress={() => void act.run(() => post(`/v1/activities/${id}/handover/answer`, { accept: true }))} />
                  <Btn title={t('Decline')} small variant="secondary" style={{ flex: 1 }} onPress={() => void act.run(() => post(`/v1/activities/${id}/handover/answer`, { accept: false }))} />
                </Row>
              </View>
            ) : null}
            {a.isHost && a.handover && !a.handover.toMe ? (
              <Banner tone="warn">{t('Waiting for {name} to accept.', { name: a.handover.toName ?? t('a member') })}</Banner>
            ) : null}
            {a.isHost && a.handover && !a.handover.toMe ? <Btn title={t('Take the offer back')} variant="secondary" loading={act.busy} onPress={() => void act.run(() => del(`/v1/activities/${id}/handover`))} /> : null}

            <Row style={{ backgroundColor: c.accentSoft, borderRadius: 14, padding: 11, gap: 10, alignItems: 'flex-start' }}>
              <Ionicons name="lock-closed-outline" size={16} color={c.forest} />
              <Txt variant="small" style={{ flex: 1, color: c.text, lineHeight: 17 }}>{t('Your exact location stays private. The group chat opens once the host approves your request.')}</Txt>
            </Row>

            {/* the lesser actions; the main one is in the bar below */}
            {a.isHost ? (
              <View style={{ gap: 10 }}>
                {a.conversationId && a.status !== 'in_progress' && <Btn title={t('Open group chat')} variant="secondary" onPress={() => go(`/chat/${a.conversationId}`)} />}
                {a.status === 'in_progress' ? <Btn title={t('Who came?')} variant="secondary" onPress={() => go(`/no-shows/activity/${id}`)} /> : null}
                {a.status !== 'cancelled' && (
                  <Btn
                    title={t('Cancel activity')}
                    variant="danger"
                    loading={act.busy}
                    onPress={async () => (await confirmAsync(t('Cancel this activity?'), t('Everyone who joined will be notified.'), t('Cancel activity'), true)) && void act.run(() => post(`/v1/activities/${id}/cancel`))}
                  />
                )}
              </View>
            ) : a.isMember ? (
              <View style={{ gap: 10 }}>
                <Banner tone="ok">{t("You're going. See you there!")}</Banner>
                <Btn title={t('Leave activity')} variant="secondary" loading={act.busy} onPress={async () => (await confirmAsync(t('Leave this activity?'), undefined, t('Leave'))) && void act.run(() => post(`/v1/activities/${id}/leave`))} />
              </View>
            ) : req === 'requested' ? (
              <Banner tone="warn">{t('Request sent. Waiting for the host.')}</Banner>
            ) : req === 'waitlisted' ? (
              <Banner tone="warn">{t('You are number {n} on the waiting list.', { n: a.myRequest?.position ?? 1 })}</Banner>
            ) : req === 'declined' ? (
              <View style={{ gap: 10 }}>
                <Banner tone="bad">{t("The host didn't approve this request.")}</Banner>
                {a.myRequest?.canAppeal ? <AskAgain path={`/v1/activities/${id}`} who="host" onDone={reload} /> : null}
              </View>
            ) : null}
          </>
        )}

        {/* room under the content for the fixed bar */}
        {primary ? <View style={{ height: 64 + insets.bottom }} /> : null}
        <ReportSheet target={report} onClose={() => setReport(null)} />
        <Sheet visible={handing} title={t('Hand over hosting')} onClose={() => setHanding(false)}>
          {(a.participants ?? [])
            .filter((p) => p.role !== 'host' && p.verifiedAdult)
            .map((p) => (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                accessibilityLabel={t('Ask {name} to take over hosting', { name: p.displayName })}
                onPress={async () => {
                  setHanding(false);
                  await act.run(() => post(`/v1/activities/${id}/handover`, { userId: p.id }));
                }}
              >
                <Row style={{ gap: 12, paddingVertical: 6 }}>
                  <Avatar name={p.displayName} uri={p.photoUrl} size={38} />
                  <Txt variant="h3" style={{ flex: 1, fontSize: 15 }}>{p.displayName}</Txt>
                  <Ionicons name="chevron-forward" size={16} color={c.muted} />
                </Row>
              </Pressable>
            ))}
        </Sheet>
      </Screen>


      {primary ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: c.bg, borderTopWidth: 1, borderTopColor: c.line, paddingTop: 8, paddingBottom: insets.bottom + 8, paddingHorizontal: gutter, alignItems: 'center' }}>
          <View style={{ width: '100%', maxWidth: 760, gap: 6 }}>
            <Btn title={primary.title} variant={primary.variant} disabled={primary.disabled} loading={primary.loading} onPress={primary.onPress} />
            {primary.caption ? <Txt variant="small" style={{ textAlign: 'center' }}>{primary.caption}</Txt> : null}
          </View>
        </View>
      ) : null}

      {/* fixed over the page: back on the left; favourite, share and more on the right */}
      <View pointerEvents="box-none" style={{ position: 'absolute', top, left: gutter, right: gutter, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <FloatingButton round size={38} fx="nudge" icon="chevron-back" label={t('Go back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {isGuest ? null : (
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
                void act.run(() => (next ? post(`/v1/activities/${id}/favorite`) : del(`/v1/activities/${id}/favorite`))).then((r) => r === undefined && setFavNow(null));
              }}
            />
          )}
          <FloatingButton round size={38} icon="share-social-outline" label={t('Share this activity')} onPress={share} />
          {isGuest ? null : <Menu floating round size={38} items={menu} />}
        </View>
      </View>
    </View>
  );
}
