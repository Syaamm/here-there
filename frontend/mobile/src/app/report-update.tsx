import { useLocalSearchParams } from 'expo-router';
import { AcctCard, AcctScreen } from '@/components/AccountParts';
import { ErrorBanner, Spinner, Txt } from '@/components/ui';
import { useRefresh } from '@/lib/hooks';
import { useCursorList } from '@/lib/paged';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { sp } from '@/lib/scale';

type Mine = { id: string; category: string; targetType: string; status: string; outcome: string; createdAt: string };

/** The page a "your report was looked at" alert opens: what you reported, when, and where it stands. Never the moderator's notes. */
export default function ReportUpdate() {
  const { t } = useT();
  const { c } = useTheme();
  const { reportId } = useLocalSearchParams<{ reportId?: string }>();
  const mine = useCursorList<Mine>('/v1/me/reports', {}, 'me:reports');
  const { refreshing, onRefresh } = useRefresh(() => mine.reload());
  const items = mine.data?.items ?? [];
  const r = items.find((x) => x.id === reportId) ?? (reportId ? undefined : items[0]);
  const word = (s: string) => {
    const w = s.replace(/_/g, ' ');
    return w.charAt(0).toUpperCase() + w.slice(1);
  };
  const decided = r?.status === 'resolved' || r?.status === 'dismissed';

  return (
    <AcctScreen title={t('Your report')} onRefresh={onRefresh} refreshing={refreshing}>
      <ErrorBanner message={mine.error?.message} />
      {!r && !mine.data ? <Spinner /> : null}
      {!r && mine.data ? (
        <AcctCard style={{ gap: sp(6) }}>
          <Txt variant="h3">{t('Report not found')}</Txt>
          <Txt variant="muted">{t('We could not find this report any more.')}</Txt>
        </AcctCard>
      ) : null}
      {r ? (
        <AcctCard style={{ gap: sp(8) }}>
          <Txt variant="label" color={c.muted}>{t('What you reported')}</Txt>
          <Txt variant="h3">{t(word(r.category))}</Txt>
          <Txt variant="muted">{t('Sent {date}', { date: new Date(r.createdAt).toLocaleDateString() })}</Txt>
          <Txt variant="label" color={c.muted}>{t('Where it stands')}</Txt>
          <Txt style={{ fontSize: 16, lineHeight: 23, fontWeight: '600' }}>{t(r.outcome)}</Txt>
          {decided ? <Txt variant="small" color={c.muted}>{t('Thank you for telling us. The details of what a moderator decided stay private.')}</Txt> : null}
        </AcctCard>
      ) : null}
    </AcctScreen>
  );
}
