import { useState } from 'react';
import { Linking, View } from 'react-native';
import { post } from '@/lib/api';
import { REPORT_CATEGORIES } from '@/lib/constants';
import { useAction } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { Btn, ErrorBanner, Field, Pill, Sheet, Txt } from './ui';

/** Report a user, activity, trip or message. Reports land in the staff moderation queue. */
export function ReportSheet({ target, onClose }: { target: { type: 'user' | 'activity' | 'trip' | 'message'; id: string; category?: string } | null; onClose: () => void }) {
  const { t } = useT();
  const [picked, setCategory] = useState('harassment');
  // a report can open on a reason chosen elsewhere ("Report as spam"), until the person picks another
  const [touched, setTouched] = useState(false);
  const category = touched ? picked : (target?.category ?? picked);
  const [details, setDetails] = useState('');
  const [sent, setSent] = useState<null | { expectedWithin: string; coverage: string; emergency: { number: string; text: string }; priority: string }>(null);
  const act = useAction();

  const close = () => {
    setTouched(false);
    setSent(null);
    setDetails('');
    act.setError(null);
    onClose();
  };
  const submit = async () => {
    if (!target) return;
    const r = await act.run(() => post<{ expectedWithin: string; coverage: string; emergency: { number: string; text: string }; priority: string }>('/v1/reports', { targetType: target.type, targetId: target.id, category, details: details.trim() || undefined }));
    if (r) setSent(r);
  };

  return (
    <Sheet visible={!!target} title={t('Report')} onClose={close}>
      {sent ? (
        <>
          <Txt>{t('Thanks. We will look at this within {time}.', { time: sent.expectedWithin })} {sent.coverage}</Txt>
          <Txt variant="small">{sent.emergency.text}</Txt>
          <Btn title={t('Call {number}', { number: sent.emergency.number })} variant="danger" onPress={() => void Linking.openURL(`tel:${sent.emergency.number}`)} />
          <Btn title={t('Done')} onPress={close} />
        </>
      ) : (
        <>
          <ErrorBanner message={act.error} />
          {/* the emergency path: a report is not an emergency service */}
          <View style={{ borderWidth: 1.5, borderColor: '#B3261E', borderRadius: 14, padding: 12, gap: 8 }}>
            <Txt variant="small" style={{ color: '#7A1A14', fontWeight: '700' }}>{t('In immediate danger? Call 112 first. Reports are read by moderators, not by the emergency services.')}</Txt>
            <Btn title={t('Call 112')} variant="danger" small onPress={() => void Linking.openURL('tel:112')} />
          </View>
          <Txt variant="label">{t('What is the problem?')}</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {REPORT_CATEGORIES.map(([v, l]) => (
              <Pill key={v} label={t(l)} active={category === v} onPress={() => (setTouched(true), setCategory(v))} />
            ))}
          </View>
          <Field label={t('Details (optional)')} multiline maxLength={1000} value={details} onChangeText={setDetails} />
          <Txt variant="small">{t('False or repeated reports may limit your account.')}</Txt>
          <Btn title={t('Send report')} onPress={submit} loading={act.busy} />
          <Btn title={t('Cancel')} variant="ghost" onPress={close} />
        </>
      )}
    </Sheet>
  );
}
