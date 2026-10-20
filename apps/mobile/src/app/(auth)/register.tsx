import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Btn, CheckRow, ErrorBanner, Field, Screen, Txt } from '@/components/ui';
import { post } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useAction } from '@/lib/hooks';

/** 18+ confirmation is required here; identity verification comes later, before hosting or joining. */
export default function Register() {
  const router = useRouter();
  const { signIn } = useMe();
  const [f, setF] = useState({ displayName: '', email: '', password: '', homeCity: 'Milan' });
  const [adult, setAdult] = useState(false);
  const act = useAction();
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  const valid = f.displayName.trim().length >= 2 && /\S+@\S+\.\S+/.test(f.email) && f.password.length >= 10 && adult;
  const submit = () =>
    act.run(async () => {
      const r = await post<{ token: string; devCode?: string }>('/v1/auth/register', {
        displayName: f.displayName.trim(),
        email: f.email.trim(),
        password: f.password,
        homeCity: f.homeCity.trim() || undefined,
        adultConfirmed: adult,
      });
      // fresh: true sends the new user through onboarding (confirm email, set up profile) once
      await signIn(r.token, { fresh: true, devCode: r.devCode });
    });

  return (
    <Screen maxWidth={520}>
      <Btn title="‹ Back" variant="ghost" small onPress={() => router.back()} style={{ alignSelf: 'flex-start' }} />
      <Txt variant="h1">Create your account</Txt>
      <ErrorBanner message={act.error} />
      <Field label="Display name" value={f.displayName} onChangeText={set('displayName')} maxLength={40} autoComplete="nickname" />
      <Field label="Email" value={f.email} onChangeText={set('email')} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
      <Field label="Password" hint="At least 10 characters" value={f.password} onChangeText={set('password')} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
      <Field label="Home city" hint="City only, never an address" value={f.homeCity} onChangeText={set('homeCity')} maxLength={60} />
      <CheckRow checked={adult} onChange={setAdult}>
        <Txt>I confirm that I am 18 or older.</Txt>
      </CheckRow>
      <Btn title="Create account" onPress={submit} loading={act.busy} disabled={!valid} />
      <Txt variant="small">
        Next we'll email you a code to confirm your address. You can browse straight away. Before you join, host or chat you will verify your identity with a specialist provider. We never show your documents to anyone.
      </Txt>
      <Btn title="Already have an account? Log in" variant="ghost" onPress={() => router.replace('/login')} />
    </Screen>
  );
}
