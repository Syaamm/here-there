import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { AuthBack, AuthButton, AuthField, AuthHeading, AuthSwitch } from '@/components/AuthForm';
import { Banner, Btn, ErrorBanner, Screen } from '@/components/ui';
import { post } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

export default function Login() {
  const router = useRouter();
  const { t } = useT();
  const { mode } = useTheme();
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
      <AuthBack onPress={() => router.back()} />
      <View style={{ marginTop: mode === 'there' ? 64 : 24 }}>
        <AuthHeading title={t('Welcome back')} subtitle={pass ? t('Enter your 6-digit code or a recovery code.') : t('Join a space where real sparks happen.')} />
      </View>
      {reset ? <Banner tone="ok">{t('Password changed. Log in.')}</Banner> : null}
      <ErrorBanner message={act.error ?? notice} />
      {pass ? (
        <View style={{ gap: 18 }}>
          <AuthField label={t('Code')} placeholder={t('6-digit code')} value={code} onChangeText={setCode} autoCapitalize="none" autoComplete="one-time-code" textContentType="oneTimeCode" onSubmitEditing={submit} />
          <AuthButton title={t('Continue')} onPress={submit} loading={act.busy} disabled={code.trim().length < 6} />
          <Btn title={t('Back')} variant="ghost" onPress={() => { setPass(null); setCode(''); act.setError(null); }} />
        </View>
      ) : (
        <View style={{ gap: 18 }}>
          <AuthField label={t('Email')} placeholder={t('Enter your email')} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" />
          <AuthField label={t('Password')} placeholder={t('Enter your password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" onSubmitEditing={submit} />
          <Btn title={t('Forgot password?')} variant="ghost" small onPress={() => router.push('/forgot-password')} style={{ alignSelf: 'flex-end', marginTop: -10 }} />
          <AuthButton title={t('Log in')} onPress={submit} loading={act.busy} disabled={!email || !password} />
        </View>
      )}
      {act.error && /suspended/i.test(act.error) ? <Btn title={t('Appeal this suspension')} variant="secondary" onPress={() => router.push('/appeal-suspension')} /> : null}
      <AuthSwitch prompt={t("Don't have an account?")} action={t('Sign up')} onPress={() => router.replace('/register')} />
    </Screen>
  );
}
