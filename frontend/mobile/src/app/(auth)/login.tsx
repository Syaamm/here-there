import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Banner, Btn, ErrorBanner, Field, Screen, Txt } from '@/components/ui';
import { post } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

export default function Login() {
  const router = useRouter();
  const { t, tn } = useT();
  const { reset } = useLocalSearchParams<{ reset?: string }>(); // arriving after a password reset
  const { signIn, notice } = useMe();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const act = useAction();

  // staff accounts with two-step sign-in: after the password, a code from their authenticator app
  const [pass, setPass] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const submit = () =>
    act.run(async () => {
      if (pass) return signIn(await post<{ token: string; refreshToken?: string }>('/v1/auth/mfa/verify', { mfaToken: pass, code: code.trim() }));
      const r = await post<{ token?: string; refreshToken?: string; mfaRequired?: boolean; mfaToken?: string }>('/v1/auth/login', { email: email.trim(), password });
      if (r.mfaRequired && r.mfaToken) {
        setPass(r.mfaToken);
        setPassword('');
        return;
      }
      await signIn({ token: r.token!, refreshToken: r.refreshToken });
    });

  return (
    <Screen maxWidth={520}>
      <Btn title={t('‹ Back')} variant="ghost" small onPress={() => router.back()} style={{ alignSelf: 'flex-start' }} />
      <Txt variant="h1">{t('Welcome back')}</Txt>
      {reset ? <Banner tone="ok">{t('Password changed. Log in.')}</Banner> : null}
      <ErrorBanner message={act.error ?? notice} />
      {pass ? (
        <>
          <Txt variant="muted">{t('Enter your 6-digit code or a recovery code.')}</Txt>
          <Field label={t('Code')} value={code} onChangeText={setCode} autoCapitalize="none" autoComplete="one-time-code" textContentType="oneTimeCode" onSubmitEditing={submit} />
          <Btn title={t('Continue')} onPress={submit} loading={act.busy} disabled={code.trim().length < 6} />
          <Btn title={t('Back')} variant="ghost" onPress={() => { setPass(null); setCode(''); act.setError(null); }} />
        </>
      ) : (
        <>
          <Field label={t('Email')} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" />
          <Field label={t('Password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" onSubmitEditing={submit} />
          <Btn title={t('Log in')} onPress={submit} loading={act.busy} disabled={!email || !password} />
        </>
      )}
      {act.error && /suspended/i.test(act.error) ? <Btn title={t('Appeal this suspension')} variant="secondary" onPress={() => router.push('/appeal-suspension')} /> : null}
      <Btn title={t('Forgot password?')} variant="ghost" onPress={() => router.push('/forgot-password')} />
      <Btn title={t('New here? Create an account')} variant="ghost" onPress={() => router.replace('/register')} />
    </Screen>
  );
}
