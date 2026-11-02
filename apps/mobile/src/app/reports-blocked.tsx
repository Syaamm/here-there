import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ScaledText';
import { Between, Btn, Card, Chip, Empty, ErrorBanner, Row, Screen, Spinner, Txt } from '@/components/ui';
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
    <Screen hasHeader onRefresh={onRefresh} refreshing={refreshing}>
      <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: c.sand, borderRadius: 12, padding: 3, gap: 3 }}>
        {tabs.map(([v, label]) => {
          const on = tab === v;
          return (
            <Pressable key={v} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: on }} onPress={() => setTab(v)} style={{ flex: 1, minHeight: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.surface : 'transparent', borderWidth: 1, borderColor: on ? c.line : 'transparent' }}>
              <Text style={{ color: on ? c.text : c.muted, fontWeight: on ? '800' : '600', fontSize: 13 }}>{label}</Text>
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
          {items.map((x) => (
            <Card key={x.id} style={{ padding: 14, borderRadius: 18, gap: 6 }}>
              <Row style={{ gap: 8, alignItems: 'center' }}>
                <Txt variant="h3" style={{ fontSize: 15, lineHeight: 20, flex: 1 }}>{x.category === 'host_no_show' ? t('Host did not show up') : x.category.replace(/_/g, ' ')} · {x.targetType}</Txt>
                {x.appeal ? <Chip label={t(STATE[x.appeal.state].label)} tone={STATE[x.appeal.state].tone} /> : null}
              </Row>
              {x.decidedAt ? <Txt variant="small">{t('Decided {date}', { date: new Date(x.decidedAt).toLocaleDateString(localeTag()) })}</Txt> : null}
              {x.decision ? <Txt>{x.decision}</Txt> : null}
              {x.appeal?.decision ? <Txt variant="small">{t('Review: {text}', { text: x.appeal.decision })}</Txt> : null}
              {x.canAppeal ? <Btn title={t('Ask for a review')} variant="secondary" small onPress={() => r.push(`/appeal?kind=report&targetId=${x.id}` as never)} /> : null}
            </Card>
          ))}
          <PagedTail paged={reports} />
        </>
      ) : (
        <>
          <Txt variant="muted">{t('Blocking applies across HERE and THERE. Blocked people can\'t see or contact you, and you won\'t see them.')}</Txt>
          <ErrorBanner message={blocks.error?.message ?? unblock.error} />
          {blocks.loading && !blocks.data && <Spinner />}
          {!blocks.loading && people.length === 0 && <Empty title={t('You haven\'t blocked anyone.')} />}
          {people.map((b) => (
            <Card key={b.userId} style={{ padding: 14, borderRadius: 18 }}>
              <Between>
                <Txt style={{ flex: 1 }}>{b.displayName ?? b.userId}</Txt>
                <Btn title={t('Unblock')} variant="secondary" small disabled={unblock.busy} onPress={() => unblock.run(() => del(`/v1/blocks/${b.userId}`))} />
              </Between>
            </Card>
          ))}
          <PagedTail paged={blocks} rows={1} />
        </>
      )}
    </Screen>
  );
}
