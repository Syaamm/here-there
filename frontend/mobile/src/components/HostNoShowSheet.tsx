import { useState } from 'react';
import { Linking } from 'react-native';
import { ApiError, post } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { Btn, ErrorBanner, Field, Sheet, Txt } from './ui';

type Sent = { emergency: { number: string; text: string } };

/** True once the plan has been on for 30 minutes and for up to 72 hours after it ends: the window in which a member can say the host did not come. */
export const hostNoShowOpen = (startsAt: string, endsAt: string, now = Date.now()) => +new Date(startsAt) + 30 * 60_000 <= now && now <= +new Date(endsAt) + 72 * 3600_000;

/** "The host did not show up": an optional note, then a short confirmation with the emergency line. Goes to the moderators. */
export function HostNoShowSheet({ kind, id, visible, onClose, onSent }: { kind: 'activity' | 'trip'; id: string; visible: boolean; onClose: () => void; onSent: () => void }) {
  const { t } = useT();
  const [note, setNote] = useState('');
  const [sent, setSent] = useState<Sent | null>(null);
  const act = useAction();

  const friendly = (e: unknown): string | null => {
    if (!(e instanceof ApiError)) return null;
    if (e.code === 'HOST_ABSENT_TOO_EARLY') return t('It is too early to say this. Please wait until the plan has been on for 30 minutes.');
    if (e.code === 'HOST_ABSENT_WINDOW_CLOSED') return t('It is too late to say this about this plan.');
    if (e.code === 'PLAN_CANCELLED') return t('This plan was cancelled.');
    if (e.code === 'RATE_LIMITED') return t('Too many tries. Please wait a moment and try again.');
    return null;
  };
  const close = () => {
    act.setError(null);
    onClose();
    setTimeout(() => {
      setSent(null);
      setNote('');
    }, 300);
  };
  const submit = async () => {
    const path = kind === 'trip' ? `/v1/trips/${id}/host-no-show` : `/v1/activities/${id}/host-no-show`;
    act.setError(null);
    try {
      const r = await act.run(async () => {
        try {
          return await post<Sent>(path, { note: note.trim() || undefined });
        } catch (e) {
          const m = friendly(e);
          throw m ? new Error(m) : e;
        }
      });
      if (r) {
        setSent(r);
        onSent();
      }
    } catch {
      // the message is already shown in the sheet
    }
  };

  return (
    <Sheet visible={visible} title={t('Host did not show up')} onClose={close}>
      {sent ? (
        <>
          <Txt>{t('Thank you. A moderator will look at it within 24 hours.')}</Txt>
          <Txt variant="small">{sent.emergency.text}</Txt>
          <Btn title={t('Call {number}', { number: sent.emergency.number })} variant="danger" small onPress={() => void Linking.openURL(`tel:${sent.emergency.number}`)} />
          <Btn title={t('Done')} onPress={close} />
        </>
      ) : (
        <>
          <ErrorBanner message={act.error} />
          <Txt variant="small">{t('Tell us if the host never came. Only moderators see this.')}</Txt>
          <Field label={t('Note (optional)')} multiline maxLength={1000} value={note} onChangeText={setNote} />
          <Btn title={t('Send')} onPress={submit} loading={act.busy} />
          <Btn title={t('Cancel')} variant="ghost" onPress={close} />
        </>
      )}
    </Sheet>
  );
}
