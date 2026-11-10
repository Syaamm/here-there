import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { AcctCard, AcctScreen } from '@/components/AccountParts';
import { ProofPhotos } from '@/components/ProofPhotos';
import { Btn, ErrorBanner, Field, Spinner, Txt, useGo } from '@/components/ui';
import { useTheme } from '@/lib/theme';
import { post, type MyAppeal } from '@/lib/api';
import { useAction, useRefresh } from '@/lib/hooks';
import { useCursorList } from '@/lib/paged';
import { useT } from '@/lib/i18n';

const ASK: Record<string, { title: string; hint: string }> = {
  verification: { title: 'Ask for a review of your identity check', hint: 'Tell us what went wrong.' },
  removal: { title: 'Ask for a review of the removal', hint: 'Tell us why it was fine.' },
  warning: { title: 'Ask for a review of the warning', hint: 'Tell us your side.' },
  message: { title: 'Ask for a review of the removed message', hint: 'Tell us why it was fine.' },
  report: { title: 'Ask for a review of the report decision', hint: 'Tell us your side.' },
};

/** Asking staff to look at a decision again, and what became of earlier requests. One request per decision. */
export default function Appeal() {
  const { t } = useT();
  const { c } = useTheme();
  const { kind, targetType, targetId, reason, aboutType, aboutId, aboutTitle } = useLocalSearchParams<{ kind?: string; targetType?: string; targetId?: string; reason?: string; aboutType?: string; aboutId?: string; aboutTitle?: string }>();
  const go = useGo();
  const mine = useCursorList<MyAppeal>('/v1/me/appeals', {}, 'me:appeals');
  const { refreshing, onRefresh } = useRefresh(() => mine.reload());
  const [text, setText] = useState('');
  const [proofs, setProofs] = useState<string[]>([]); // photos added as proof (a screenshot of the chat, say)
  const [proofKey, setProofKey] = useState(0);
  const router = useRouter();
  const send = useAction(() => {
    router.replace('/reports-blocked' as never); // the request shows there as Appealed, Waiting for decision
    setText('');
    setProofs([]);
    setProofKey((k) => k + 1); // the photo picker starts empty again
    void mine.reload();
  });
  const ask = kind ? ASK[kind] : undefined;
  const items = mine.data?.items ?? [];
  const hasOpen = items.some((a) => a.state === 'open');
  // each decision can be reviewed once, whatever the answer was: no form again for a problem that already has a request
  const already = !!kind && !!targetId && items.some((a) => a.kind === kind && a.targetId === targetId);

  return (
    <AcctScreen title={t('Ask for a review')} onRefresh={onRefresh} refreshing={refreshing}>
      <ErrorBanner message={mine.error?.message} />
      {/* opened from a warning or a removed message: first what the moderator wrote, then the way to ask for a review */}
      {reason && (kind === 'warning' || kind === 'message') ? (
        <AcctCard style={{ gap: 8 }}>
          <Txt variant="label" color={c.muted}>{kind === 'warning' ? t('A moderator warned you') : t('A moderator removed your message')}</Txt>
          <Txt variant="h3">{t('What the moderator said')}</Txt>
          <View style={{ borderLeftWidth: 3, borderLeftColor: c.danger, paddingLeft: 12, paddingVertical: 4 }}>
            <Txt style={{ fontSize: 15, lineHeight: 22 }}>{reason}</Txt>
          </View>
          {aboutId && aboutTitle ? (
            <>
              <Txt variant="label" color={c.muted}>{t('About this activity')}</Txt>
              <Txt style={{ fontSize: 15, lineHeight: 22, fontWeight: '600' }}>{aboutTitle}</Txt>
              <Btn title={aboutType === 'trip' ? t('View trip') : t('View activity')} variant="secondary" small onPress={() => go(aboutType === 'trip' ? `/trip/${aboutId}` : `/activity/${aboutId}`)} />
            </>
          ) : null}
          {!already ? <Txt variant="small" color={c.muted}>{t('If you think this is a mistake, ask for a review below. Another member of staff will look at it.')}</Txt> : null}
        </AcctCard>
      ) : null}
      {ask && already ? (
        <AcctCard style={{ gap: 6 }}>
          <Txt variant="h3">{t('Already reviewed')}</Txt>
          <Txt variant="muted">{t('You already asked for a review of this. Each decision can be reviewed once, whatever the answer was.')}</Txt>
        </AcctCard>
      ) : null}
      {ask && !hasOpen && !already ? (
        <AcctCard style={{ gap: 10 }}>
          <Txt variant="h3">{t(ask.title)}</Txt>
          <Txt variant="muted">{t(ask.hint)}</Txt>
          <ErrorBanner message={send.error} />
          <Field label={t('Your message')} value={text} onChangeText={setText} multiline maxLength={1000} />
          <ProofPhotos key={proofKey} onChange={setProofs} />
          <Btn
            title={t('Send')}
            loading={send.busy}
            disabled={text.trim().length < 10}
            onPress={() => void send.run(() => post('/v1/me/appeals', { ...(kind === 'removal' ? { kind, targetType, targetId, message: text.trim() } : kind === 'verification' ? { kind, message: text.trim() } : { kind, targetId, message: text.trim() }), ...(proofs.length ? { proofIds: proofs } : {}) }))}
          />
        </AcctCard>
      ) : null}
      {mine.loading && !mine.data && <Spinner />}
    </AcctScreen>
  );
}
