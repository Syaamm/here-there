import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Banner, Btn, ErrorBanner, Field, Screen, Txt } from '@/components/ui';
import { post } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

const MIN = 10;

/**
 * Forgotten password. Step 1: the email address, and a 6-digit code is sent to it. Step 2: the code and a new password.
 * The answer to step 1 is the same whether or not an account exists, so nobody can use this to find out who is here.
 */
export default function ForgotPassword() {
  const router = useRouter();
  const { t, tn } = useT();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<{ to: string; devCode?: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [wait, setWait] = useState(0); // seconds until another code can be asked for
  const ask = useAction();
  const reset = useAction();

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const send = async () => {
    const to = email.trim();
    const r = await ask.run(() => post<{ ok: boolean; devCode?: string }>('/v1/auth/password/forgot', { email: to }));
    if (r) {
      setSent({ to, devCode: r.devCode });
      setWait(30);
    }
  };

  const tooShort = password.length > 0 && password.length < MIN;
  const mismatch = again.length > 0 && again !== password;
  const ready = code.length === 6 && password.length >= MIN && again === password;
  const submit = async () => {
    if (!sent || !ready) return;
    const r = await reset.run(() => post('/v1/auth/password/reset', { email: sent.to, code, newPassword: password }));
    if (r) router.replace('/login?reset=1');
  };

  return (
    <Screen maxWidth={520}>
      <Btn title={t('‹ Back')} variant="ghost" small onPress={() => (router.canGoBack() ? router.back() : router.replace('/login'))} style={{ alignSelf: 'flex-start' }} />
      <Txt variant="h1">{t('Reset your password')}</Txt>

      {!sent ? (
        <>
          <ErrorBanner message={ask.error} />
          <Field label={t('Email')} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" onSubmitEditing={send} />
          <Btn title={t('Send the code')} onPress={send} loading={ask.busy} disabled={!email.trim()} />
        </>
      ) : (
        <>
          <Txt variant="muted">{t('If {email} has an account, we sent it a code.', { email: sent.to })}</Txt>
          {sent.devCode ? <Banner tone="warn">{t('Dev mode: your code is {code}.', { code: sent.devCode })}</Banner> : null}
          <ErrorBanner message={reset.error ?? ask.error} />
          <Field label={t('6-digit code')} value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" textContentType="oneTimeCode" />
          {sent.devCode ? <Btn title={t('Fill in the code')} variant="secondary" small onPress={() => setCode(sent.devCode!)} /> : null}
          <Field label={t('New password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" hint={t('At least {n} characters', { n: MIN })} error={tooShort ? t('Use at least {n} characters', { n: MIN }) : null} />
          <Field label={t('New password again')} value={again} onChangeText={setAgain} secureTextEntry autoComplete="new-password" textContentType="newPassword" error={mismatch ? t('The two passwords are not the same') : null} onSubmitEditing={submit} />
          <Btn title={t('Set new password')} onPress={submit} loading={reset.busy} disabled={!ready} />
          <Btn title={wait > 0 ? t('Send a new code ({s}s)', { s: wait }) : t('Send a new code')} variant="secondary" onPress={send} loading={ask.busy} disabled={wait > 0} />
          <Btn title={t('Use a different email')} variant="ghost" onPress={() => { setSent(null); setCode(''); ask.setError(null); reset.setError(null); }} />
        </>
      )}
    </Screen>
  );
}
