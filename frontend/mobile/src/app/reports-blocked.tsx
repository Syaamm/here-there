import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ScaledText';
import { AcctCard, AcctScreen, StatusTag } from '@/components/AccountParts';
import { Btn, Empty, ErrorBanner, Spinner, Txt } from '@/components/ui';
import { del } from '@/lib/api';
import { useAction, useRefresh } from '@/lib/hooks';
import { localeTag, useT } from '@/lib/i18n';
import { PagedTail, useCursorList } from '@/lib/paged';
import { useTheme } from '@/lib/theme';

type AboutMe = { id: string; category: string; targetType: string; decidedAt: string | null; decision: string | null; canAppeal: boolean; appeal: { id: string; state: 'open' | 'upheld' | 'rejected'; decision: string | null } | null };
type Blocked = { userId: string; displayName?: string };
const STATE: Record<string, { label: string; tone: 'warn' | 'ok' | 'bad' }> = { open: { label: 'Waiting for a decision', tone: 'warn' }, upheld: { label: 'Accepted', tone: 'ok' }, rejected: { label: 'Decision stands', tone: 'bad' } };

/**
 * Two small sections on one page. Reports: reports about you where a moderator took a decision, what it was about and what was
 * decided (never who reported), with one request for a review. Blocked: the people you blocked, with Unblock.
 */
export default function ReportsAndBlocked() {
  const { t } = useT();
  const { c } = useTheme();
  const r = useRouter();
  const [tab, setTab] = useState<'reports' | 'blocked'>('reports');
  const reports = useCursorList<AboutMe>('/v1/me/reports-about-me', {}, 'me:reports-about-me');
  const blocks = useCursorList<Blocked>('/v1/blocks', {}, 'blocks');
  const unblock = useAction(() => void blocks.reload());
  const { refreshing, onRefresh } = useRefresh(() => Promise.all([reports.reload(), blocks.reload()]));
  const items = reports.data?.items ?? [];
  const people = blocks.data?.items ?? [];
  const tabs: ['reports' | 'blocked', string][] = [['reports', t('Reports')], ['blocked', t('Blocked')]];

  return (
    <AcctScreen title={t('Reports & blocked')} onRefresh={onRefresh} refreshing={refreshing}>
      <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: c.sand, borderRadius: 28, padding: 4, gap: 4 }}>
        {tabs.map(([v, label]) => {
          const on = tab === v;
          return (
            <Pressable key={v} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: on }} onPress={() => setTab(v)} style={{ flex: 1, minHeight: 44, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.surface : 'transparent', borderWidth: 1, borderColor: on ? c.line : 'transparent' }}>
              <Text style={{ color: on ? c.text : c.muted, fontWeight: on ? '600' : '500', fontSize: 14 }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      {tab === 'reports' ? (
        <>
          <Txt variant="muted">{t('Reports about you where a moderator took a decision. You can ask for a review once for each.')}</Txt>
          <ErrorBanner message={reports.error?.message} />
          {reports.loading && !reports.data && <Spinner />}
          {!reports.loading && items.length === 0 && <Empty title={t('Nothing to show')} />}
          {items.length > 0 ? (
            <AcctCard style={{ paddingVertical: 6, gap: 0 }}>
              {items.map((x, i) => (
                <View key={x.id} style={{ paddingVertical: 16, gap: 6, borderBottomWidth: i === items.length - 1 ? 0 : 1, borderBottomColor: c.line }}>
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    <Text style={{ color: c.text, fontSize: 15, lineHeight: 21, fontWeight: '500', flex: 1 }}>{x.category === 'host_no_show' ? t('Host did not show up') : x.category.replace(/_/g, ' ')} · {x.targetType}</Text>
                    {x.appeal ? <StatusTag label={t(STATE[x.appeal.state].label)} tone={STATE[x.appeal.state].tone} /> : null}
                  </View>
                  {x.decidedAt ? <Text style={{ color: c.muted, fontSize: 12, lineHeight: 17 }}>{t('Decided {date}', { date: new Date(x.decidedAt).toLocaleDateString(localeTag()) })}</Text> : null}
                  {x.decision ? <Text style={{ color: c.text, fontSize: 14, lineHeight: 20 }}>{x.decision}</Text> : null}
                  {x.appeal?.decision ? <Text style={{ color: c.muted, fontSize: 12, lineHeight: 17 }}>{t('Review: {text}', { text: x.appeal.decision })}</Text> : null}
                  {x.canAppeal ? <Btn title={t('Ask for a review')} variant="secondary" small onPress={() => r.push(`/appeal?kind=report&targetId=${x.id}` as never)} style={{ alignSelf: 'flex-start', marginTop: 4 }} /> : null}
                </View>
              ))}
            </AcctCard>
          ) : null}
          <PagedTail paged={reports} />
        </>
      ) : (
        <>
          <Txt variant="muted">{t('Blocking applies across HERE and THERE. Blocked people can\'t see or contact you, and you won\'t see them.')}</Txt>
          <ErrorBanner message={blocks.error?.message ?? unblock.error} />
          {blocks.loading && !blocks.data && <Spinner />}
          {!blocks.loading && people.length === 0 && <Empty title={t('You haven\'t blocked anyone.')} />}
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
