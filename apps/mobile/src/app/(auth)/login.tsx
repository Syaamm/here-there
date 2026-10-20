import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Btn, ErrorBanner, Field, Screen, Txt } from '@/components/ui';
import { post } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useAction } from '@/lib/hooks';

export default function Login() {
  const router = useRouter();
  const { signIn, notice } = useMe();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const act = useAction();

  const submit = () => act.run(async () => signIn((await post<{ token: string }>('/v1/auth/login', { email: email.trim(), password })).token));

  return (
    <Screen maxWidth={520}>
      <Btn title="‹ Back" variant="ghost" small onPress={() => router.back()} style={{ alignSelf: 'flex-start' }} />
      <Txt variant="h1">Welcome back</Txt>
      <ErrorBanner message={act.error ?? notice} />
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" onSubmitEditing={submit} />
      <Btn title="Log in" onPress={submit} loading={act.busy} disabled={!email || !password} />
      <Btn title="New here? Create an account" variant="ghost" onPress={() => router.replace('/register')} />
    </Screen>
  );
}
