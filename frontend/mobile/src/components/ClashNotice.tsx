import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ScaledText';
import { Btn, Chip, ErrorBanner } from '@/components/ui';
import { del, get, post } from '@/lib/api';
import { useClock } from '@/lib/clock';
import { confirmAsync } from '@/lib/confirm';
import { hhmm, shortDate, when } from '@/lib/format';
import { useAction, useLoad } from '@/lib/hooks';
import { t as translate, useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

import { sc, sp, sph } from '@/lib/scale';
/**
 * One plan at a time (HERE and THERE together). The server refuses joining, applying, creating or moving a plan onto a
 * time that a plan holding you (hosted or accepted) already covers; this shows what is in the way before the person tries,
 * with when each plan ends and a live countdown, and the ways to free the time. Requests still waiting do not block:
 * the first one you are accepted into wins and the others are withdrawn by themselves.
 */
export type Clash = {
  kind: 'activity' | 'trip';
  id: string;
  title: string;
  startsAt: string;
  /** when it stops holding you: an activity's end, or the day after a trip's last day */
  endsAt: string;
  dateStart?: string;
  dateEnd?: string;
  role: 'host' | 'going' | 'organizer' | 'member' | 'requested' | 'waitlisted' | 'applied';
  firm: boolean;
  status: string;
};

/**
 * Your plans (HERE and THERE, holding you or still requested) that overlap [from, to). All of them, from now on, are loaded
 * ONCE (and again every minute or on reload), and the overlap is worked out here on the phone: moving the date, the time
 * wheels or the duration answers at once and is always about the time shown. (It used to ask the server again for every
 * change, which was slow over a slow connection and, while waiting, showed the previous time's answer.)
 * `exclude` is the plan being looked at (activity:<id> or trip:<id>).
 */
export function useClashes(from: string | Date | null | undefined, to: string | Date | null | undefined, exclude?: string, creating: 'activity' | 'trip' = 'activity') {
  const q = useLoad(
    () => get<{ items: Clash[] }>(`/v1/me/clashes?${new URLSearchParams({ from: new Date().toISOString(), to: new Date(Date.now() + 400 * 864e5).toISOString(), ...(exclude ? { exclude } : {}) })}`),
    [exclude],
    60_000,
    'me:clashes:all',
    { keep: true },
  );
  // a plan that ends while the page is open stops blocking at once, without waiting for the next answer
  const now = useClock(15_000);
  const f = from ? +new Date(from) : NaN;
  const tt = to ? +new Date(to) : NaN;
  const ok = !isNaN(f) && !isNaN(tt) && tt > f;
  const live = ok ? (q.data?.items ?? []).filter((x) => +new Date(x.startsAt) < tt && +new Date(x.endsAt) > Math.max(f, now)) : [];
  const firm = live.filter((x) => x.firm);
  // Creating an activity: only an ACTIVITY you host or joined stops you. A trip you are on is a warning (the server allows it), the person decides.
  // Creating a trip: any plan holding you on those days stops you (an activity or another trip).
  return { firm, blocking: firm.filter((x) => x.kind === 'activity' || creating === 'trip'), onTrip: firm.filter((x) => x.kind === 'trip'), pending: live.filter((x) => !x.firm), all: q.data?.items ?? [], reload: q.reload, now };
}

/**
 * The days that already have a plan holding you, for the calendars: 'activity' or 'trip' (an activity wins when both fall on one day).
 * Keyed "year-month-day" (month from 0), in the phone's own time.
 */
export function planDays(items: Clash[], now: number) {
  const marks: Record<string, 'activity' | 'trip'> = {};
  for (const x of items) {
    if (!x.firm || +new Date(x.endsAt) <= now) continue;
    let d = new Date(x.startsAt);
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const stop = +new Date(x.endsAt) - 1;
    for (let guard = 0; +d <= stop && guard < 100; guard++) {
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (x.kind === 'activity' || !marks[key]) marks[key] = x.kind;
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    }
  }
  return marks;
}

/** A request of yours withdrawn by the server because you just got into another plan at the same time (first accepted wins). */
export type Withdrawn = { kind: 'activity' | 'trip'; id: string; title: string };

/**
 * After joining or creating: if the server withdrew other requests of yours at the same time, say so right there (it also
 * stays in the alerts list). Resolves once the person has read it; at once when nothing was withdrawn.
 */
export async function tellWithdrawn(withdrawn: Withdrawn[] | undefined, title: string) {
  if (!withdrawn?.length) return;
  const t = translate;
  const list = withdrawn.map((x) => `"${x.title}"`).join(', ');
  const trips = withdrawn.every((x) => x.kind === 'trip');
  const text =
    withdrawn.length === 1
      ? trips
        ? t('Your application for {list} was withdrawn because it is on the same dates.', { list })
        : t('Your request for {list} was withdrawn because it is at the same time.', { list })
      : trips
        ? t('Your applications for {list} were withdrawn because they are on the same dates.', { list })
        : t('Your requests for {list} were withdrawn because they are at the same time.', { list });
  await confirmAsync(title, text, t('OK'));
}

/** "45 min", "2 h 10 min", "3 days" */
export function useDuration() {
  const { t, tn } = useT();
  return (ms: number) => {
    const min = Math.max(1, Math.ceil(ms / 60_000));
    if (min < 60) return t('{n} min', { n: min });
    if (min < 24 * 60) {
      const h = Math.floor(min / 60);
      const m = min % 60;
      return m ? t('{h} h {m} min', { h, m }) : t('{h} h', { h });
    }
    const d = Math.ceil(min / (24 * 60));
    return tn(d, '{n} day', '{n} days');
  };
}

const ROLE: Record<Clash['role'], string> = {
  host: 'You host this',
  going: 'Going',
  organizer: 'You organise this trip',
  member: 'On this trip',
  requested: 'Request pending',
  waitlisted: 'On the waiting list',
  applied: 'Application pending',
};

/** When the plan ends, and how long until then (or until it starts, when it has not started yet). */
function Timing({ x, now }: { x: Clash; now: number }) {
  const { t } = useT();
  const { c } = useTheme();
  const dur = useDuration();
  const started = +new Date(x.startsAt) <= now;
  const left = dur(+new Date(x.endsAt) - now);
  const line =
    x.kind === 'trip'
      ? started
        ? t('On the trip until {date} · ends in {left}', { date: shortDate(x.dateEnd ?? x.endsAt), left })
        : t('{from} to {to} · ends in {left}', { from: shortDate(x.dateStart ?? x.startsAt), to: shortDate(x.dateEnd ?? x.endsAt), left })
      : started
        ? t('On now, until {time} · ends in {left}', { time: hhmm(x.endsAt), left })
        : t('{from} to {to} · ends in {left}', { from: when(x.startsAt), to: hhmm(x.endsAt), left });
  return <Text style={{ color: c.muted, fontSize: 12, lineHeight: 18 }}>{line}</Text>;
}

/**
 * The warning, for joining (`join`), applying to a trip (`apply`) or creating at a chosen time (`create`).
 * Blocking plans come first with how to free the time; requests still waiting come after, as a note.
 */
export function ClashNotice({ firm, pending, now, mode, onChanged, creating = 'activity' }: { firm: Clash[]; pending: Clash[]; now: number; mode: 'join' | 'apply' | 'create'; onChanged: () => void; /** what is being created (mode 'create'): a trip is stopped by another trip too, an activity only warns about a trip */ creating?: 'activity' | 'trip' }) {
  const { t, tn } = useT();
  const { c } = useTheme();
  const act = useAction();
  const [busy, setBusy] = useState<string | null>(null);
  if (firm.length === 0 && pending.length === 0) return null;

  const free = async (x: Clash) => {
    const base = x.kind === 'activity' ? `/v1/activities/${x.id}` : `/v1/trips/${x.id}`;
    const started = +new Date(x.startsAt) <= now;
    if ((x.role === 'host' || x.role === 'organizer') && started) {
      // it has started: it is ended (not cancelled), and the group is told it ended
      const ok = await confirmAsync(
        t('End "{title}"?', { title: x.title }),
        x.kind === 'activity' ? t('It has started. Ending it closes it now, and everyone going is told it ended.') : t('It has started. Ending it closes the trip now, and everyone in the group is told it ended.'),
        x.kind === 'activity' ? t('End activity') : t('End trip'),
        true,
      );
      if (!ok) return;
    } else if (x.role === 'host' || x.role === 'organizer') {
      const ok = await confirmAsync(
        t('Cancel "{title}"?', { title: x.title }),
        x.kind === 'activity' ? t('You host it. Everyone who joined is told it is cancelled.') : t('You organise it. Everyone in the group is told it is cancelled.'),
        x.kind === 'activity' ? t('Cancel activity') : t('Cancel trip'),
        true,
      );
      if (!ok) return;
    } else if (x.firm) {
      const ok = await confirmAsync(t('Leave "{title}"?', { title: x.title }), t('You lose your place and the group chat.'), t('Leave'), true);
      if (!ok) return;
    }
    setBusy(`${x.kind}:${x.id}`);
    const done = await act.run(() =>
      x.role === 'host' || x.role === 'organizer'
        ? post(`${base}/${started ? (x.kind === 'activity' ? 'complete' : 'end') : 'cancel'}`)
        : x.firm
          ? post(`${base}/leave`)
          : del(x.kind === 'activity' ? `${base}/requests/mine` : `${base}/applications/mine`),
    );
    setBusy(null);
    if (done !== undefined) onChanged();
  };
  const action = (x: Clash) =>
    x.role === 'host' ? (+new Date(x.startsAt) <= now ? t('End this activity') : t('Cancel this activity')) : x.role === 'organizer' ? (+new Date(x.startsAt) <= now ? t('End this trip') : t('Cancel this trip')) : x.role === 'going' ? t('Leave this activity') : x.role === 'member' ? t('Leave this trip') : x.kind === 'trip' ? t('Withdraw application') : t('Withdraw request');

  // creating: a small card you read at a glance (an icon, the plan's name, when it is), the way to free the time, and for a trip a
  // plain warning. No chips, no countdown, no long text.
  if (mode === 'create') {
    const when1 = (x: Clash) => (x.kind === 'trip' ? `${t('Trip')} · ${shortDate(x.dateStart ?? x.startsAt)} – ${shortDate(x.dateEnd ?? x.endsAt)}` : `${t('Activity')} · ${when(x.startsAt)} – ${hhmm(x.endsAt)}`);
    const short = (x: Clash) => (x.role === 'host' || x.role === 'organizer' ? (+new Date(x.startsAt) <= now ? t('End') : t('Cancel')) : x.role === 'going' || x.role === 'member' ? t('Leave') : action(x));
    // what to do to go on: cancel the other plan if it has not started, end it if it has, leave it if you only joined
    const howTo = (x: Clash) =>
      x.role === 'going' || x.role === 'member' ? t('Leave it to publish this one.') : +new Date(x.startsAt) <= now ? t('It has started. End it to publish this one.') : t('It has not started. Cancel it to publish this one.');
    const cards = firm.map((x) => {
      const trip = x.kind === 'trip';
      const warnOnly = trip && creating === 'activity'; // an activity can still be published while you are on a trip
      const bg = warnOnly ? c.warnBg : c.badBg;
      const fg = warnOnly ? c.warnFg : c.badFg;
      const key = `${x.kind}:${x.id}`;
      return (
        <View key={key} accessibilityRole="alert" style={{ backgroundColor: bg, borderRadius: sc(18), padding: sp(12), gap: sp(8) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(12) }}>
            <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: sc(40), height: sc(40), borderRadius: sc(20), backgroundColor: 'rgba(255,255,255,0.7)', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name={trip ? 'airplane' : 'alert-circle'} size={sc(22)} color={fg} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text numberOfLines={1} style={{ color: fg, fontSize: 16, lineHeight: 21, fontWeight: '700' }}>{x.title}</Text>
              <Text numberOfLines={2} style={{ color: fg, fontSize: 12, lineHeight: 17 }}>{warnOnly ? when1(x) : `${t('Already busy then')} · ${when1(x)}`}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={action(x)}
              disabled={busy === key}
              hitSlop={8}
              onPress={() => void free(x)}
              style={({ pressed }) => [{ minHeight: sc(36), paddingHorizontal: sph(14), borderRadius: sc(18), backgroundColor: 'rgba(255,255,255,0.85)', alignItems: 'center', justifyContent: 'center', opacity: busy === key ? 0.5 : pressed ? 0.8 : 1 }]}
            >
              <Text style={{ color: fg, fontSize: 12, fontWeight: '700' }}>{busy === key ? '…' : short(x)}</Text>
            </Pressable>
          </View>
          {warnOnly ? <Text style={{ color: fg, fontSize: 12, lineHeight: 17 }}>{t('You are on a trip then. Go on only if you think you can still join or host.')}</Text> : <Text style={{ color: fg, fontSize: 12, lineHeight: 17 }}>{howTo(x)}</Text>}
        </View>
      );
    });
    return (
      <View style={{ gap: sp(8) }}>
        <ErrorBanner message={act.error} />
        {cards}
        {pending.length ? (
          <View style={{ backgroundColor: c.infoBg, borderRadius: sc(18), padding: sp(12), gap: sp(4) }}>
            <Text style={{ color: c.infoFg, fontSize: 12, fontWeight: '700' }}>{t('Also waiting for an answer at this time:')}</Text>
            {pending.map((x) => (
              <Text key={`${x.kind}:${x.id}`} numberOfLines={1} style={{ color: c.infoFg, fontSize: 12, lineHeight: 17 }}>{`${x.title} · ${when1(x)}`}</Text>
            ))}
            <Text style={{ color: c.infoFg, fontSize: 12, lineHeight: 17 }}>{t('Publishing withdraws these requests, since you will be busy then.')}</Text>
          </View>
        ) : null}
      </View>
    );
  }

  // joining or applying (creating is the compact card above)
  const head = firm.length ? (mode === 'apply' ? t("You can't apply to this trip yet") : t("You can't join this activity yet")) : t('You also asked to join something at this time');
  const body = firm.length
    ? tn(firm.length, 'You can only do this once the plan below has ended or been cancelled.', 'You can only do this once the {n} plans below have ended or been cancelled.')
    : t('That is fine. Whichever accepts you first wins, and your other requests at this time are withdrawn by themselves.');

  const row = (x: Clash) => (
    <View key={`${x.kind}:${x.id}`} style={{ gap: sp(6), paddingTop: sp(10), borderTopWidth: 1, borderTopColor: c.line }}>
      <Text style={{ color: c.text, fontSize: 16, lineHeight: 22, fontWeight: '600' }}>{x.title}</Text>
      <Timing x={x} now={now} />
      <View style={{ flexDirection: 'row', gap: sp(6), flexWrap: 'wrap' }}>
        <Chip label={t(ROLE[x.role])} tone={x.firm ? 'ok' : 'warn'} />
        {x.kind === 'trip' ? <Chip label={t('Trip')} tone="neutral" /> : null}
      </View>
      <Btn title={action(x)} small variant={x.firm ? 'secondary' : 'ghost'} loading={busy === `${x.kind}:${x.id}`} onPress={() => void free(x)} style={{ alignSelf: 'flex-start' }} />
    </View>
  );

  return (
    <View accessibilityRole={firm.length ? 'alert' : undefined} style={{ backgroundColor: firm.length ? c.warnBg : c.infoBg, borderRadius: sc(20), padding: sp(14), gap: sp(8) }}>
      <Text style={{ color: firm.length ? c.warnFg : c.infoFg, fontSize: 16, lineHeight: 22, fontWeight: '700' }}>{head}</Text>
      <Text style={{ color: firm.length ? c.warnFg : c.infoFg, fontSize: 16, lineHeight: 23 }}>{body}</Text>
      <ErrorBanner message={act.error} />
      {firm.map(row)}
      {firm.length && pending.length ? <Text style={{ color: c.muted, fontSize: 12, paddingTop: sp(6) }}>{t('Also waiting for an answer at this time:')}</Text> : null}
      {pending.map(row)}
    </View>
  );
}
