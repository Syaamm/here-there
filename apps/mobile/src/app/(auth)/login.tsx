import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Banner, Btn, ErrorBanner, Field, Screen, Txt } from '@/components/ui';
import { post } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useAction } from '@/lib/hooks';

export default function Login() {
  const router = useRouter();
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
      if (pass) return signIn((await post<{ token: string }>('/v1/auth/mfa/verify', { mfaToken: pass, code: code.trim() })).token);
      const r = await post<{ token?: string; mfaRequired?: boolean; mfaToken?: string }>('/v1/auth/login', { email: email.trim(), password });
      if (r.mfaRequired && r.mfaToken) {
        setPass(r.mfaToken);
        setPassword('');
        return;
      }
      await signIn(r.token!);
    });

  return (
    <Screen maxWidth={520}>
      <Btn title="‹ Back" variant="ghost" small onPress={() => router.back()} style={{ alignSelf: 'flex-start' }} />
      <Txt variant="h1">Welcome back</Txt>
      {reset ? <Banner tone="ok">Your password has been changed. Log in with the new one.</Banner> : null}
      <ErrorBanner message={act.error ?? notice} />
      {pass ? (
        <>
          <Txt variant="muted">Open your authenticator app and type the 6-digit code for HERE &amp; THERE. Lost your phone? Use a recovery code instead.</Txt>
          <Field label="Code" value={code} onChangeText={setCode} autoCapitalize="none" autoComplete="one-time-code" textContentType="oneTimeCode" onSubmitEditing={submit} />
          <Btn title="Continue" onPress={submit} loading={act.busy} disabled={code.trim().length < 6} />
          <Btn title="Back" variant="ghost" onPress={() => { setPass(null); setCode(''); act.setError(null); }} />
        </>
      ) : (
        <>
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" onSubmitEditing={submit} />
          <Btn title="Log in" onPress={submit} loading={act.busy} disabled={!email || !password} />
        </>
      )}
      <Btn title="Forgot password?" variant="ghost" onPress={() => router.push('/forgot-password')} />
      <Btn title="New here? Create an account" variant="ghost" onPress={() => router.replace('/register')} />
    </Screen>
  );
}
