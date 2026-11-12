import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Text } from '@/components/ScaledText';
import { AcctCard, AcctScreen, StatusTag } from '@/components/AccountParts';
import { SkeletonReportRow } from '@/components/Skeleton';
import { Btn, Empty, ErrorBanner, Spinner, Txt } from '@/components/ui';
import { del, post, type MyAppeal } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useAction, useRefresh } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { PagedTail, useCursorList } from '@/lib/paged';
import { keyOf, markSeen, needsDot, readSeen } from '@/lib/reportsSeen';
import { useTheme } from '@/lib/theme';
import { dateText } from '@/lib/format';

type AboutMe = { id: string; category: string; targetType: string; decidedAt: string | null; decision: string | null; canAppeal: boolean; appeal: { id: string; state: 'open' | 'upheld' | 'rejected'; decision: string | null } | null };
type Blocked = { userId: string; displayName?: string };
type Tone = 'warn' | 'ok' | 'bad' | 'neutral';
/** The conversation with a moderator about an open appeal, and a box to answer them. */
function AppealThread({ a, onSent }: { a: MyAppeal; onSent: () => void }) {
  const { c } = useTheme();
  const { t } = useT();
  const [text, setText] = useState('');
  const send = useAction();
  const thread = a.thread ?? [];
  if (thread.length === 0) return null;
  const lastFromStaff = thread[thread.length - 1].fromStaff;
  return (
    <View style={{ gap: 6, marginTop: 4 }}>
      {thread.map((m) => (
        <View key={m.id} style={{ alignSelf: m.fromStaff ? 'flex-start' : 'flex-end', maxWidth: '90%', backgroundColor: m.fromStaff ? c.accentSoft : c.accent, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12 }}>
          <Text style={{ color: m.fromStaff ? c.text : '#fff', fontSize: 14, lineHeight: 20 }}>{m.body}</Text>
        </View>
      ))}
      {a.state === 'open' && lastFromStaff ? (
        <>
          <TextInput value={text} onChangeText={setText} placeholder={t('Write your answer')} placeholderTextColor={c.muted} multiline maxLength={1000} accessibilityLabel={t('Your answer')} style={{ borderWidth: 1, borderColor: c.line, borderRadius: 12, padding: 12, minHeight: 48, color: c.text, fontSize: 15 }} />
          <ErrorBanner message={send.error} />
          <Btn title={t('Send answer')} small disabled={send.busy || text.trim().length < 2} onPress={() => send.run(async () => { await post(`/v1/me/appeals/${a.id}/reply`, { message: text.trim() }); setText(''); onSent(); })} style={{ alignSelf: 'flex-start' }} />
        </>
      ) : null}
    </View>
  );
}

/** how many of each list show before "See all" */
const PREVIEW = 3;

/** The status of a decision about you, as the chips say it: Warning (new, not asked for a review yet), Appealed + Waiting for decision, Accepted, Rejected. */
function statusOf(state: string): { chips: { label: string; tone: Tone }[] } {
  if (state === 'new') return { chips: [{ label: 'Warning', tone: 'bad' }] };
  if (state === 'open') return { chips: [{ label: 'Appealed', tone: 'neutral' }, { label: 'Waiting for decision', tone: 'warn' }] };
  if (state === 'upheld') return { chips: [{ label: 'Accepted', tone: 'ok' }] };
  if (state === 'rejected') return { chips: [{ label: 'Rejected', tone: 'bad' }] };
  return { chips: [] };
}

/** A small red dot: this is new since you last looked. */
function NewDot() {
  const { c } = useTheme();
  const { t } = useT();
  return <View accessible accessibilityLabel={t('New')} style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: c.danger }} />;
}

/**
 * Reports and Blocked on one page. Reports: the decisions about you (what it was about and what was decided, never who reported) with
 * their status, and the requests for a review you sent and what became of them. A red dot marks what is new. Blocked: the people you
 * blocked, with Unblock.
 */
export default function ReportsAndBlocked() {
  const { t } = useT();
  const { c } = useTheme();
  const r = useRouter();
  const { me } = useMe();
  const [tab, setTab] = useState<'reports' | 'blocked'>('reports');
  // Each section shows its first few; "See all" opens the whole list in place, and only then are the next pages fetched, as you scroll
  const [allReports, setAllReports] = useState(false);
  const [allRequests, setAllRequests] = useState(false);
  const reports = useCursorList<AboutMe>('/v1/me/reports-about-me', {}, 'me:reports-about-me', { pauseMore: !allReports });
  const appeals = useCursorList<MyAppeal>('/v1/me/appeals', {}, 'me:appeals', { pauseMore: !allRequests });
  const blocks = useCursorList<Blocked>('/v1/blocks', {}, 'blocks');
  const unblock = useAction(() => void blocks.reload());
  const { refreshing, onRefresh } = useRefresh(() => Promise.all([reports.reload(), appeals.reload(), blocks.reload()]));
  const items = reports.data?.items ?? [];
  const shownItems = allReports ? items : items.slice(0, PREVIEW);
  // a request about a report is shown on that report; the others (a warning, a removed message, a removal, an identity check) have their own list
  const requests = (appeals.data?.items ?? []).filter((a) => a.kind !== 'report');
  const shownRequests = allRequests ? requests : requests.slice(0, PREVIEW);
  const people = blocks.data?.items ?? [];
  const tabs: ['reports' | 'blocked', string][] = [['reports', t('Reports')], ['blocked', t('Blocked')]];

  // what you had already seen when this page opened (the dots show for the rest), and everything on the page is seen when you leave it
  const [seen, setSeen] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (me) void readSeen(me.id).then(setSeen);
  }, [me?.id]);
  const stateOfReport = (x: AboutMe) => (x.appeal ? x.appeal.state : x.canAppeal ? 'new' : 'decided');
  const allKeys = useRef<string[]>([]);
  allKeys.current = [...items.map((x) => keyOf('report', x.id, stateOfReport(x))), ...requests.map((a) => keyOf('appeal', a.id, a.state))];
  useFocusEffect(
    useCallback(
      () => () => {
        if (me) void markSeen(me.id, allKeys.current);
      },
      [me?.id],
    ),
  );
  const isNew = (key: string, state: string) => !!seen && needsDot(state) && !seen.has(key);

  const Row = ({ title, state, dot, last, children }: { title: string; state: string; dot: boolean; last: boolean; children?: React.ReactNode }) => (
    <View style={{ paddingVertical: 16, gap: 6, borderBottomWidth: last ? 0 : 1, borderBottomColor: c.line }}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        {dot ? <NewDot /> : null}
        <Text style={{ color: c.text, fontSize: 15, lineHeight: 21, fontWeight: '500', flex: 1 }}>{title}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        {statusOf(state).chips.map((s) => (
          <StatusTag key={s.label} label={t(s.label)} tone={s.tone === 'neutral' ? 'warn' : s.tone} />
        ))}
      </View>
      {children}
    </View>
  );

  return (
    <AcctScreen title={t('Reports & Blocked')} onRefresh={onRefresh} refreshing={refreshing}>
      <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: c.sand, borderRadius: 28, padding: 4, gap: 4 }}>
        {tabs.map(([v, label]) => {
          const on = tab === v;
          return (
            <Pressable key={v} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: on }} onPress={() => setTab(v)} style={{ flex: 1, minHeight: 44, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.surface : 'transparent' }}>
              <Text style={{ color: on ? c.text : c.muted, fontWeight: on ? '600' : '500', fontSize: 14 }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      {tab === 'reports' ? (
        <>
          <Txt variant="muted">{t('Decisions about you, and the reviews you asked for. You can ask for a review once for each decision.')}</Txt>
          <ErrorBanner message={reports.error?.message ?? appeals.error?.message} />
          {(reports.loading && !reports.data) || (appeals.loading && !appeals.data) ? (
            <AcctCard style={{ paddingVertical: 6, gap: 0 }}>
              <View accessibilityRole="progressbar" accessibilityLabel={t('Loading')}>
                <SkeletonReportRow />
                <SkeletonReportRow />
                <SkeletonReportRow last />
              </View>
            </AcctCard>
          ) : null}
          {reports.data && appeals.data && items.length === 0 && requests.length === 0 && (
            <Empty icon="shield-checkmark-outline" title={t('Nothing to show')}>{t('If a moderator decides something about you, or you ask for a review, it shows up here.')}</Empty>
          )}

          {items.length > 0 ? (
            <>
              <Txt variant="h3">{t('Decisions about you')}</Txt>
              <AcctCard style={{ paddingVertical: 6, gap: 0 }}>
                {shownItems.map((x, i) => {
                  const state = stateOfReport(x);
                  return (
                    <Row key={x.id} title={`${x.category === 'host_no_show' ? t('Host did not show up') : x.category.replace(/_/g, ' ')} · ${x.targetType}`} state={state} dot={isNew(keyOf('report', x.id, state), state)} last={i === shownItems.length - 1}>
                      {x.decidedAt ? <Text style={{ color: c.muted, fontSize: 12, lineHeight: 17 }}>{t('Decided {date}', { date: dateText(x.decidedAt) })}</Text> : null}
                      {x.decision ? <Text style={{ color: c.text, fontSize: 14, lineHeight: 20 }}>{x.decision}</Text> : null}
                      {x.appeal?.decision ? <Text style={{ color: c.muted, fontSize: 12, lineHeight: 17 }}>{t('Review: {text}', { text: x.appeal.decision })}</Text> : null}
                      {x.canAppeal ? <Btn title={t('Ask for a review')} variant="secondary" small onPress={() => r.push(`/appeal?kind=report&targetId=${x.id}` as never)} style={{ alignSelf: 'flex-start', marginTop: 4 }} /> : null}
                    </Row>
                  );
                })}
                {allReports && reports.hasMore ? (
                  <View accessibilityRole="progressbar" accessibilityLabel={t('Loading')}>
                    <SkeletonReportRow last />
                  </View>
                ) : null}
              </AcctCard>
              {items.length > PREVIEW || reports.hasMore ? <Btn title={allReports ? t('Show less') : t('See all')} variant="secondary" small onPress={() => setAllReports((v) => !v)} style={{ alignSelf: 'flex-start' }} /> : null}
            </>
          ) : null}

          {requests.length > 0 ? (
            <>
              <Txt variant="h3">{t('Your review requests')}</Txt>
              <AcctCard style={{ paddingVertical: 6, gap: 0 }}>
                {shownRequests.map((a, i) => (
                  <Row key={a.id} title={t(a.what.charAt(0).toUpperCase() + a.what.slice(1))} state={a.state} dot={isNew(keyOf('appeal', a.id, a.state), a.state)} last={i === shownRequests.length - 1}>
                    <Text style={{ color: c.muted, fontSize: 12, lineHeight: 17 }}>{t('Sent {date}', { date: dateText(a.createdAt) })}</Text>
                    {a.proofs?.length ? <Text style={{ color: c.muted, fontSize: 12, lineHeight: 17 }}>{a.proofs.length === 1 ? t('1 photo sent as proof') : t('{n} photos sent as proof', { n: a.proofs.length })}</Text> : null}
                    <AppealThread a={a} onSent={appeals.reload} />
                    {a.decision ? <Text style={{ color: c.text, fontSize: 14, lineHeight: 20 }}>{a.decision}</Text> : null}
                  </Row>
                ))}
                {allRequests && appeals.hasMore ? (
                  <View accessibilityRole="progressbar" accessibilityLabel={t('Loading')}>
                    <SkeletonReportRow last />
                  </View>
                ) : null}
              </AcctCard>
              {requests.length > PREVIEW || appeals.hasMore ? <Btn title={allRequests ? t('Show less') : t('See all')} variant="secondary" small onPress={() => setAllRequests((v) => !v)} style={{ alignSelf: 'flex-start' }} /> : null}
            </>
          ) : null}
        </>
      ) : (
        <>
          <Txt variant="muted">{t("Blocking applies across HERE and THERE. Blocked people can't see or contact you, and you won't see them.")}</Txt>
          <ErrorBanner message={blocks.error?.message ?? unblock.error} />
          {blocks.loading && !blocks.data && <Spinner />}
          {!blocks.loading && people.length === 0 && <Empty icon="ban-outline" title={t("You haven't blocked anyone.")} />}
          {people.length > 0 ? (
            <AcctCard style={{ paddingVertical: 6, gap: 0 }}>
              {people.map((b, i) => (
                <View key={b.userId} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 64, borderBottomWidth: i === people.length - 1 ? 0 : 1, borderBottomColor: c.line }}>
                  <Text style={{ flex: 1, color: c.text, fontSize: 16, fontWeight: '500' }}>{b.displayName ?? b.userId}</Text>
                  <Btn title={t('Unblock')} variant="secondary" small disabled={unblock.busy} onPress={() => unblock.run(() => del(`/v1/blocks/${b.userId}`))} />
                </View>
              ))}
            </AcctCard>
          ) : null}
          <PagedTail paged={blocks} rows={1} />
        </>
      )}
    </AcctScreen>
  );
}
