import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { DateRangeSheet, lastPlanningDay, shortDay } from '@/components/DateRangeSheet';
import { ReliabilityChip } from '@/components/ReliabilityChip';
import { Avatar, Banner, Btn, Card, Chip, Empty, ErrorBanner, Field, Row, Screen, Spinner, Txt } from '@/components/ui';
import { del, get, post, put } from '@/lib/api';
import { useAction, useLoad, useRefresh } from '@/lib/hooks';
import { parseDay } from '@/lib/format';
import { t, useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

type Suggestion = {
  userId: string;
  displayName: string;
  photoUrl: string | null;
  homeCity: string | null;
  bio: string | null;
  reliability: { level: string; label: string } | null;
  destination: string;
  dateStart: string;
  dateEnd: string;
  overlapDays: number;
  sharedInterests: string[];
};
type Overview = { pref: { destination: string; dateStart: string; dateEnd: string } | null; suggestions: Suggestion[] };

const range = (a: string, b: string) => t('{from} to {to}', { from: shortDay(new Date(a)), to: shortDay(new Date(b)) });
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Travel buddies (opt-in). Say where and when you want to go, see other verified travelers going there around the same time,
 * and say yes or not now. A chat opens only when you BOTH say yes; nobody is told when you say yes.
 */
export default function TravelMatch() {
  const { t, tn } = useT();
  const r = useRouter();
  const { c } = useTheme();
  const o = useLoad(() => get<Overview>('/v1/me/travel-match'), [], undefined, 'me:travelmatch');
  const { refreshing, onRefresh } = useRefresh(() => o.reload());
  const [dest, setDest] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [calendar, setCalendar] = useState(false);
  const [editing, setEditing] = useState(false);
  const [matched, setMatched] = useState<{ name: string; conversationId: string } | null>(null);
  const save = useAction(() => {
    setEditing(false);
    void o.reload();
  });
  const act = useAction(() => void o.reload());

  const pref = o.data?.pref ?? null;
  const showForm = !pref || editing;
  const tomorrow = new Date();
  tomorrow.setHours(0, 0, 0, 0);
  const s = parseDay(start);
  const e = parseDay(end);
  const ready = dest.trim().length >= 2 && !!s && !!e;

  const startEdit = () => {
    if (pref) {
      setDest(pref.destination);
      setStart(dayKey(new Date(pref.dateStart)));
      setEnd(dayKey(new Date(pref.dateEnd)));
    }
    setEditing(true);
  };

  const answer = async (p: Suggestion, choice: 'yes' | 'pass') => {
    const res = await act.run(() => post<{ matched: boolean; conversationId?: string }>(`/v1/me/travel-match/people/${p.userId}`, { choice }));
    if (res?.matched && res.conversationId) setMatched({ name: p.displayName, conversationId: res.conversationId });
  };

  return (
    <View style={{ flex: 1 }}>
      <Screen hasHeader onRefresh={onRefresh} refreshing={refreshing}>
        <Txt variant="muted">{t('You appear to others only while this is on.')}</Txt>
        <ErrorBanner message={o.error?.message ?? act.error} />
        {o.loading && !o.data && <Spinner />}

        {matched ? (
          <View style={{ gap: 8 }}>
            <Banner tone="ok">{t('It is a match with {name}!', { name: matched.name })}</Banner>
            <Btn title={t('Open the chat')} onPress={() => r.push(`/chat/${matched.conversationId}` as never)} />
          </View>
        ) : null}

        {showForm ? (
          <Card style={{ padding: 14, borderRadius: 18, gap: 10 }}>
            <Txt variant="h3">{t('Where and when?')}</Txt>
            <ErrorBanner message={save.error} />
            <Field label={t('Destination')} placeholder={t('Lisbon')} value={dest} onChangeText={setDest} maxLength={100} />
            <Pressable accessibilityRole="button" accessibilityLabel={t('Choose your travel dates')} onPress={() => setCalendar(true)} style={{ borderWidth: 1.5, borderColor: c.line, borderRadius: 12, padding: 12, backgroundColor: c.surface }}>
              <Txt variant="label">{t('Dates')}</Txt>
              <Txt>{s && e ? range(s.toISOString(), e.toISOString()) : t('Choose your dates')}</Txt>
            </Pressable>
            <Txt variant="small">{t('We only show your first name, photo, home city and short bio, never your email, phone or exact location.')}</Txt>
            <Btn
              title={pref ? t('Save') : t('Turn on travel buddies')}
              loading={save.busy}
              disabled={!ready}
              onPress={() => void save.run(() => put('/v1/me/travel-match', { destination: dest.trim(), dateStart: s!.toISOString(), dateEnd: e!.toISOString() }))}
            />
            {editing ? <Btn title={t('Cancel')} variant="ghost" onPress={() => setEditing(false)} /> : null}
          </Card>
        ) : pref ? (
          <Card style={{ padding: 14, borderRadius: 18, gap: 6 }}>
            <Row style={{ gap: 8, alignItems: 'center' }}>
              <Chip label={t('On')} tone="ok" />
              <Txt variant="h3" style={{ flex: 1 }}>{pref.destination}</Txt>
            </Row>
            <Txt>{range(pref.dateStart, pref.dateEnd)}</Txt>
            <Row style={{ gap: 8 }}>
              <Btn title={t('Change')} variant="secondary" small onPress={startEdit} style={{ flex: 1 }} />
              <Btn title={t('Turn off')} variant="ghost" small onPress={() => void act.run(() => del('/v1/me/travel-match'))} />
            </Row>
          </Card>
        ) : null}

        {pref && !editing ? (
          <>
            <Txt variant="h2" style={{ fontSize: 20 }}>{t('Travelers going there')}</Txt>
            {o.data && o.data.suggestions.length === 0 ? <Empty title={t('No one yet')} /> : null}
            {(o.data?.suggestions ?? []).map((p) => (
              <Card key={p.userId} style={{ padding: 14, borderRadius: 18, gap: 8 }}>
                <Row style={{ gap: 10, alignItems: 'center' }}>
                  <Avatar name={p.displayName} uri={p.photoUrl ?? undefined} size={44} />
                  <View style={{ flex: 1 }}>
                    <Txt variant="h3" style={{ fontSize: 16, lineHeight: 22 }}>{p.displayName}</Txt>
                    <Txt variant="small">{[p.homeCity, t('Verified adult')].filter(Boolean).join(' · ')}</Txt>
                  </View>
                  {p.reliability ? <ReliabilityChip r={p.reliability as never} /> : null}
                </Row>
                {p.bio ? <Txt>{p.bio}</Txt> : null}
                <Txt variant="small">{`${p.destination}, ${range(p.dateStart, p.dateEnd)} · ${tn(p.overlapDays, '{n} day in common', '{n} days in common')}`}</Txt>
                {p.sharedInterests.length > 0 ? (
                  <Row style={{ flexWrap: 'wrap', gap: 6 }}>
                    {p.sharedInterests.map((i) => <Chip key={i} label={t(i)} tone="neutral" />)}
                  </Row>
                ) : null}
                <Row style={{ gap: 8 }}>
                  <Btn title={t('I would like to chat')} small loading={act.busy} onPress={() => void answer(p, 'yes')} style={{ flex: 2 }} />
                  <Btn title={t('Not now')} variant="secondary" small onPress={() => void answer(p, 'pass')} style={{ flex: 1 }} />
                </Row>
              </Card>
            ))}
            <Banner>{t('They are told nothing when you say yes. If they say yes to you as well, you both get a message and a private chat opens. Never send money or ID documents to someone you met here.')}</Banner>
          </>
        ) : null}
      </Screen>
      <DateRangeSheet
        visible={calendar}
        focus="start"
        start={start}
        end={end}
        min={tomorrow}
        max={lastPlanningDay()}
        onClose={() => setCalendar(false)}
        onDone={(a, b) => {
          setStart(a);
          setEnd(b);
          setCalendar(false);
        }}
      />
    </View>
  );
}
