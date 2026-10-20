import { useState } from 'react';
import { View } from 'react-native';
import { post } from '@/lib/api';
import { REPORT_CATEGORIES } from '@/lib/constants';
import { useAction } from '@/lib/hooks';
import { Btn, ErrorBanner, Field, Pill, Sheet, Txt } from './ui';

/** Report a user, activity, trip or message. Reports land in the staff moderation queue. */
export function ReportSheet({ target, onClose }: { target: { type: 'user' | 'activity' | 'trip' | 'message'; id: string } | null; onClose: () => void }) {
  const [category, setCategory] = useState('harassment');
  const [details, setDetails] = useState('');
  const [sent, setSent] = useState(false);
  const act = useAction();

  const close = () => {
    setSent(false);
    setDetails('');
    act.setError(null);
    onClose();
  };
  const submit = async () => {
    if (!target) return;
    const r = await act.run(() => post('/v1/reports', { targetType: target.type, targetId: target.id, category, details: details.trim() || undefined }));
    if (r) setSent(true);
  };

  return (
    <Sheet visible={!!target} title="Report" onClose={close}>
      {sent ? (
        <>
          <Txt>Thanks. Our moderation team will review this. If you are in immediate danger, contact local emergency services (112 in the EU).</Txt>
          <Btn title="Done" onPress={close} />
        </>
      ) : (
        <>
          <ErrorBanner message={act.error} />
          <Txt variant="label">What is the problem?</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {REPORT_CATEGORIES.map(([v, l]) => (
              <Pill key={v} label={l} active={category === v} onPress={() => setCategory(v)} />
            ))}
          </View>
          <Field label="Details (optional)" multiline maxLength={1000} value={details} onChangeText={setDetails} />
          <Txt variant="small">False or repeated reports may limit your account.</Txt>
          <Btn title="Send report" onPress={submit} loading={act.busy} />
          <Btn title="Cancel" variant="ghost" onPress={close} />
        </>
      )}
    </Sheet>
  );
}
