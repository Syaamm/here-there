import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Banner, Btn, ErrorBanner, Field, Screen, Txt } from '@/components/ui';
import { post } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

/** A suspended person cannot sign in, so they prove who they are here and write to the moderators. The answer comes by email. */
export default function AppealSuspension() {
  const router = useRouter();
  const { t, tn } = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const act = useAction(() => setSent(true));

  return (
    <Screen maxWidth={520}>
      <Btn title={t('‹ Back')} variant="ghost" small onPress={() => router.back()} style={{ alignSelf: 'flex-start' }} />
      <Txt variant="h1">{t('Appeal a suspension')}</Txt>
      {sent ? (
        <>
          <Banner tone="ok">{t('Sent. We will email you the answer.')}</Banner>
          <Btn title={t('Back to log in')} onPress={() => router.replace('/login')} />
        </>
      ) : (
        <>
          <Txt variant="muted">{t('One appeal every 30 days.')}</Txt>
          <ErrorBanner message={act.error} />
          <Field label={t('Email')} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
          <Field label={t('Password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
          <Field label={t('Your message')} value={message} onChangeText={setMessage} multiline maxLength={1000} />
          <Btn
            title={t('Send appeal')}
            loading={act.busy}
            disabled={!email || !password || message.trim().length < 10}
            onPress={() => void act.run(() => post('/v1/appeals/suspension', { email: email.trim(), password, message: message.trim() }))}
          />
        </>
      )}
    </Screen>
  );
}
