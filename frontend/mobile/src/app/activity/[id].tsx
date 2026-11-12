import Ionicons from '@expo/vector-icons/Ionicons';
import { AskAgain } from '@/components/AskAgain';
import { ReliabilityChip } from '@/components/ReliabilityChip';
import { SkeletonDetail } from '@/components/Skeleton';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FloatingButton, Hero } from '@/components/Hero';
import { GoingGrid, HostCard, InfoRow } from '@/components/ActivityParts';
import { Text } from '@/components/ScaledText';
import { Menu } from '@/components/Menu';
import { HostNoShowSheet, hostNoShowOpen } from '@/components/HostNoShowSheet';
import { ReportSheet } from '@/components/ReportSheet';
import { Avatar, Banner, BottomBar, Btn, Chip, Empty, ErrorBanner, Row, Screen, Sheet, Txt, useGo } from '@/components/ui';
import { del, get, post, type Activity } from '@/lib/api';
import { shareLink } from '@/lib/shareLink';
import { useMe } from '@/lib/auth';
import { useVerifyGate } from '@/lib/verifyGate';
import { catColor, CATS } from '@/lib/constants';
import { confirmAsync } from '@/lib/confirm';
import { dayWord, hhmm } from '@/lib/format';
import { useAction, useLoad, useRefresh } from '@/lib/hooks';
import { statusTop, useLayout } from '@/lib/layout';
import { useEnterMode, useTheme } from '@/lib/theme';
import { t, tn, useT } from '@/lib/i18n';
import { ReadMore } from '@/components/ReadMore';

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
  return { text: dayWord(a.startsAt), tone: 'warn' };
}

/** HERE · Activity detail. The join button always reflects server-side state, never a client guess. */
export default function ActivityDetail() {
  const { t, tn } = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me, isGuest } = useMe();
  const gate = useVerifyGate();
  const { c, mode, switchMode } = useTheme();
  const router = useRouter();
  const go = useGo();
  const insets = useSafeAreaInsets();
  const { gutter } = useLayout();
  const [barH, setBarH] = useState(0); // the fixed bottom bar's measured height
  const [handing, setHanding] = useState(false); // the host's "hand over hosting" list of members
  // the heart answers at once; the server confirms a moment later (a failed save puts it back)
  const [favNow, setFavNow] = useState<boolean | null>(null);
  const { data: a, error, loading, reload } = useLoad(() => get<Activity>(`/v1/activities/${id}`), [id], undefined, 'activity', { animate: true });
  const { refreshing, onRefresh } = useRefresh(reload); // pull down to refresh, like Home
  const act = useAction(reload);
  const [report, setReport] = useState<{ type: 'activity' | 'user'; id: string } | null>(null);
  const [noShow, setNoShow] = useState<'closed' | 'open' | 'confirm' | 'sent'>('closed'); // "the host did not show up": sheet closed, open, showing its thank-you, or sent and closed
  useEnterMode('here'); // opened from a THERE alert, push or link: flip to HERE first
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
  const req = a.myRequest?.state;
  const closed = ['in_progress', 'completed', 'cancelled', 'archived'].includes(a.status);
  const over = a.status === 'completed' || a.status === 'archived';
  // a cancelled plan, or one that has started, cannot be saved or shared (a saved one can still be taken out)
  const ahead = !closed && +new Date(a.startsAt) > Date.now();
  // leaving is for a plan that has not started or is going on now, never one that is finished, called off or past its end
  // by the clock as well as by the status, which is only updated a little after the end (an activity with no end time counts as 4 hours long)
  const endedByClock = (a.endsAt ? +new Date(a.endsAt) : +new Date(a.startsAt) + 4 * 3600e3) < Date.now();
  const canLeave = !over && a.status !== 'cancelled' && !endedByClock;
  const started = a.status === 'in_progress' || +new Date(a.startsAt) <= Date.now();

  const canHandOver = a.isHost && !over && a.status !== 'cancelled' && !a.handover && (a.participants ?? []).some((p) => p.role !== 'host' && p.verifiedAdult);
  const menu = [
    ...(canHandOver ? [{ label: t('Hand over hosting'), onSelect: () => setHanding(true) }] : []),
    ...(ahead || a.favorited ? [{ label: a.favorited ? t('Remove from favourites') : t('Add to favourites'), onSelect: () => void act.run(() => (a.favorited ? del(`/v1/activities/${id}/favorite`) : post(`/v1/activities/${id}/favorite`))) }] : []),
    ...(a.isHost
      ? []
      : [
          { label: t('Report this activity'), onSelect: () => setReport({ type: 'activity', id: a.id }) },
          // a person is reported from their profile (its ⋯ menu), not from their activity
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
  const day = dayWord(a.startsAt);
  const timeText = `${day}, ${hhmm(a.startsAt)} – ${hhmm(a.endsAt)}`;
  const mins = Math.max(0, Math.round((+new Date(a.endsAt) - +new Date(a.startsAt)) / 60000));
  const length = mins >= 60 ? `${tn(Math.floor(mins / 60), '{n} hour', '{n} hours')}${mins % 60 ? ` ${t('{m} min', { m: mins % 60 })}` : ''}` : t('{m} min', { m: mins });
  // the map tab picks this activity's pin and zooms to its venue (it only exists in HERE, so flip there first)
  const showOnMap = () => {
    const go = () => router.navigate(`/discover?focus=${a.id}&t=${Date.now()}` as never);
    if (mode !== 'here') switchMode('here', go);
    else go();
  };
  // the link opens this activity in the app, or sends the person to the App Store / Google Play when they have not got it
  const share = () => void Share.share({ message: `${t('{title}, {time} at {venue}, {city}', { title: a.title, time: timeText, venue: a.venueName, city: a.city })}\n${shareLink('activity', a.id)}` }).catch(() => undefined);
  const soon = startsIn(a);

  const top = statusTop(insets.top) + 8;
  const PHOTO = 250 + top; // the picture's full height
  const fav = favNow ?? !!a.favorited;

  // who is going: up to three faces, open places drawn as dashed rings (one per open place, never more than four circles in all),
  // and a bar with one segment per place
  const going = a.participants ?? [];

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
    // not verified (a guest, or an account still to be checked): the button stays, says why, and explains on tap
    else if (a.spotsLeft === 0 && !gate.verified) primary = { title: gate.isGuest ? gate.title('join') : t('Get verified to join the waiting list'), onPress: () => void gate.ask('join') };
    else if (a.spotsLeft === 0) primary = { title: t('Join the waiting list'), onPress: () => go(`/join/${id}`) };
    else if (!gate.verified) primary = { title: gate.title('join'), onPress: () => void gate.ask('join') };
    else if (a.joinPolicy === 'instant') primary = { title: t('Join now'), onPress: () => go(`/join/${id}`) };
    else primary = { title: t('Request to join'), onPress: () => go(`/join/${id}`) };
  }

  return (
    <View style={{ flex: 1 }}>
      {/* The picture is cut in two: the upper part scrolls away with the page; the lower part (with the sheet's rounded top
          edge) scrolls up to the top and then stays there while the white section slides under it. The system's own sticky
          header does the pinning, so there is no scroll code running to lag behind. */}
      <Screen
        onRefresh={onRefresh}
        refreshing={refreshing}
        bottomRoom={primary ? barH : undefined}
        fixedHero={{ height: PHOTO, stop: top + 84, photo: <Hero plain round height={PHOTO} color={catColor(a.category)} category={a.category} emoji={cat?.emoji} /> }}
      >
        <Stack.Screen options={{ headerShown: false }} />

        <Row style={{ gap: 8, flexWrap: 'wrap' }}>
          <Chip label={cat ? t(cat.label) : a.category} tone="ok" />
          <Chip label={soon.text} tone={soon.tone} />
        </Row>
        <View style={{ gap: 10 }}>
          <Text accessibilityRole="header" style={{ color: c.text, fontSize: 24, lineHeight: 30, fontWeight: '600' }}>{a.title}</Text>
          {a.description ? (
            // "read more" when it really runs past three lines (bullet points too), not by its number of characters
            <ReadMore text={a.description} style={{ color: c.muted, fontSize: 15, lineHeight: 27 }} />
          ) : null}
        </View>

        {a.status === 'cancelled' && <Banner tone="bad">{t('This activity was cancelled.')}</Banner>}
        {a.canAppealRemoval ? <Btn title={t('Ask for a review')} variant="secondary" onPress={() => go(`/appeal?kind=removal&targetType=activity&targetId=${id}`)} /> : null}
        <ErrorBanner message={act.error} />

        <HostCard
          name={a.host.displayName}
          uri={a.host.photoUrl}
          verified={!!a.host.verifiedAdult}
          label={t('{name}, host. Open profile', { name: a.host.displayName })}
          onPress={() => go(`/user/${a.host.id}`)}
        >
          <Text style={{ color: c.text, fontSize: 16, lineHeight: 21, fontWeight: '500' }}>{t('Hosted by {name}', { name: a.host.displayName })}</Text>
          <Row style={{ gap: 6, flexWrap: 'wrap' }}>
            <ReliabilityChip r={a.hostReliability} />
            <Text style={{ color: c.muted, fontSize: 14, lineHeight: 18 }}>
              {[a.host.verifiedAdult ? t('Verified adult') : t('Host'), a.activitiesHosted ? tn(a.activitiesHosted, '{n} activity hosted', '{n} activities hosted') : ''].filter(Boolean).join(' · ')}
            </Text>
          </Row>
        </HostCard>

        {/* where and when; the place row opens the map on this activity */}
        <View style={{ gap: 22, paddingTop: 4 }}>
          <InfoRow
            icon="location-outline"
            title={`${a.venueName}, ${a.city}`}
            sub={t('Public meeting venue')}
            label={t('{venue}, {city}. Show on the map', { venue: a.venueName, city: a.city })}
            onPress={showOnMap}
            trailing={<Ionicons name="map-outline" size={18} color={c.green} />}
          />
          <InfoRow icon="time-outline" title={timeText} sub={length} />
        </View>

        {over ? (
          // finished: only who took part, for everyone (the host included). No requests, chat, join or leave.
          <View style={{ gap: 10 }}>
            {a.isMember && a.status !== 'cancelled' ? (
              <View style={{ backgroundColor: c.accentSoft, borderRadius: 14, padding: 12, gap: 8 }}>
                <Txt variant="h3" style={{ fontSize: 14, lineHeight: 18 }}>{a.myAttendance === 'attended' ? `✓ ${t('You said you were there')}` : a.myAttendance === 'no_show' ? t("You said you weren't there") : t('Were you there?')}</Txt>
                {/* one answer, final: once given, the buttons go and only the answer stays */}
                {a.myAttendance === 'attended' || a.myAttendance === 'no_show' ? (
                  <Txt variant="small">{t('Thanks. Your answer is saved and cannot be changed. The group sees whether you went.')}</Txt>
                ) : (
                  <>
                    <Txt variant="small">{t('One tap, and it cannot be changed after. The group sees whether you went. We never track your location.')}</Txt>
                    <Row style={{ gap: 8 }}>
                      <Btn title={t('Yes, I went')} small style={{ flex: 1 }} disabled={act.busy} onPress={() => void act.run(() => post(`/v1/activities/${id}/attendance`, { attended: true }))} />
                      <Btn title={t("No, I didn't")} small variant="secondary" style={{ flex: 1 }} disabled={act.busy} onPress={() => void act.run(() => post(`/v1/activities/${id}/attendance`, { attended: false }))} />
                    </Row>
                  </>
                )}
              </View>
            ) : null}
            {a.isHost && a.status !== 'cancelled' ? <Btn title={t('Who came?')} variant="secondary" onPress={() => go(`/no-shows/activity/${id}`)} /> : null}
            {a.isMember && !a.isHost && a.status !== 'cancelled' && hostNoShowOpen(a.startsAt, a.endsAt) ? (noShow === 'sent' || noShow === 'confirm' ? <Txt variant="small" style={{ textAlign: 'center' }}>{t('You told us the host did not show up')}</Txt> : <Btn title={t('Host did not show up')} variant="secondary" onPress={() => setNoShow('open')} />) : null}
            {/* who went, in three groups: the host and everyone who said yes, those who said no, and those who have not answered yet */}
            {(
              [
                ['attended', t('Attended ({n})', { n: going.filter((p) => p.role === 'host' || p.attendance === 'attended').length }), going.filter((p) => p.role === 'host' || p.attendance === 'attended'), 'checkmark-circle', c.green],
                ['no_show', t('Did not attend ({n})', { n: going.filter((p) => p.role !== 'host' && p.attendance === 'no_show').length }), going.filter((p) => p.role !== 'host' && p.attendance === 'no_show'), 'close-circle', c.danger],
                ['unknown', t('Not answered yet ({n})', { n: going.filter((p) => p.role !== 'host' && (!p.attendance || p.attendance === 'unknown')).length }), going.filter((p) => p.role !== 'host' && (!p.attendance || p.attendance === 'unknown')), 'help-circle-outline', c.muted],
              ] as const
            ).map(([k, title, people, icon, tint]) =>
              people.length === 0 ? null : (
                <View key={k} style={{ gap: 4, marginTop: 6 }}>
                  <Row style={{ gap: 8, alignItems: 'center' }}>
                    <Ionicons name={icon} size={18} color={tint} />
                    <Txt variant="h3" accessibilityRole="header" style={{ fontSize: 16 }}>{title}</Txt>
                  </Row>
                  {people.map((p) => (
                    <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={p.role === 'host' ? t('{name}, host. Open profile', { name: p.displayName }) : t('{name}. Open profile', { name: p.displayName })} onPress={() => go(`/user/${p.id}`)}>
                      <Row style={{ gap: 12, paddingVertical: 4, opacity: k === 'unknown' ? 0.65 : 1 }}>
                        <Avatar name={p.displayName} uri={p.photoUrl} size={40} />
                        <Txt variant="h3" style={{ flex: 1, fontSize: 15 }}>{p.displayName}</Txt>
                        {p.role === 'host' ? <Chip label={t('Host')} tone="info" /> : null}
                        {/* confirmed: a green tick beside the name */}
                        {k === 'attended' && p.role !== 'host' ? <Ionicons accessibilityLabel={t('Confirmed they went')} name="checkmark-circle" size={20} color={c.green} /> : k === 'no_show' ? <Ionicons accessibilityLabel={t('Said they did not go')} name="close-circle" size={20} color={c.danger} /> : null}
                      </Row>
                    </Pressable>
                  ))}
                </View>
              ),
            )}
          </View>
        ) : (
          <>
            <View style={{ gap: 16 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text accessibilityRole="header" style={{ color: c.text, fontSize: 20, lineHeight: 26, fontWeight: '600' }}>{t("Who's going")}</Text>
                <Text style={{ color: a.spotsLeft === 0 ? c.danger : c.green, fontSize: 14, fontWeight: '500' }}>
                  {a.spotsLeft === 0 ? t('Full') : tn(a.spotsLeft, '{n} spot left', '{n} spots left')}
                </Text>
              </Row>
              <GoingGrid
                onOpen={(uid) => go(`/user/${uid}`)}
                capacity={a.capacity}
                people={going.map((p) => ({ id: p.id, name: p.displayName, uri: p.photoUrl, host: p.role === 'host', friend: !!p.friend, answered: p.answered }))}
                a11y={`${t('{going} of {capacity} going', { going: a.going, capacity: a.capacity })}. ${t('Going: {names}', { names: going.map((p) => p.displayName).join(', ') })}`}
              />
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
                {canHandOver ? <Btn title={t('Hand over hosting')} variant="secondary" onPress={() => setHanding(true)} /> : null}
                {/* from the start on the host can end it: everyone going is told (alert and push) */}
                {started && !over && a.status !== 'cancelled' ? (
                  <Btn
                    title={t('Mark as completed')}
                    loading={act.busy}
                    onPress={async () => (await confirmAsync(t('Mark this activity as completed?'), t('It ends now and everyone going is told.'), t('Mark as completed'))) && void act.run(() => post(`/v1/activities/${id}/complete`))}
                  />
                ) : null}
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
                {a.isMember && !a.isHost && a.status !== 'cancelled' && hostNoShowOpen(a.startsAt, a.endsAt) ? (noShow === 'sent' || noShow === 'confirm' ? <Txt variant="small" style={{ textAlign: 'center' }}>{t('You told us the host did not show up')}</Txt> : <Btn title={t('Host did not show up')} variant="secondary" onPress={() => setNoShow('open')} />) : null}
                {canLeave ? <Btn title={t('Leave activity')} variant="secondary" loading={act.busy} onPress={async () => (await confirmAsync(t('Leave this activity?'), undefined, t('Leave'))) && void act.run(() => post(`/v1/activities/${id}/leave`))} /> : null}
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
        <ReportSheet target={report} onClose={() => setReport(null)} />
        <HostNoShowSheet kind="activity" id={id} visible={noShow === 'open' || noShow === 'confirm'} onClose={() => setNoShow((v) => (v === 'confirm' || v === 'sent' ? 'sent' : 'closed'))} onSent={() => setNoShow('confirm')} />
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
        <BottomBar onHeight={setBarH}>
          <Btn title={primary.title} variant={primary.variant} disabled={primary.disabled} loading={primary.loading} onPress={primary.onPress} />
          {primary.caption ? <Txt variant="small" style={{ textAlign: 'center' }}>{primary.caption}</Txt> : null}
        </BottomBar>
      ) : null}

      {/* fixed over the page: back on the left; favourite, share and more on the right */}
      <View pointerEvents="box-none" style={{ position: 'absolute', top, left: gutter, right: gutter, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <FloatingButton round size={44} fx="nudge" icon="chevron-back" label={t('Go back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {isGuest || !(ahead || fav) ? null : (
            <FloatingButton
              round
              size={44}
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
          {ahead ? <FloatingButton round size={44} icon="share-social-outline" label={t('Share this activity')} onPress={share} /> : null}
          {isGuest ? null : <Menu floating round size={44} items={menu} />}
        </View>
      </View>
    </View>
  );
}
