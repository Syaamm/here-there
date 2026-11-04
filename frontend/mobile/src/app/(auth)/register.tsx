import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { View } from 'react-native';
import { AuthBack, AuthButton, AuthCheck, AuthField, AuthHeading, AuthSwitch, type InputHandle } from '@/components/AuthForm';
import { Banner, Btn, ErrorBanner, Screen, Txt } from '@/components/ui';
import { post } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

/** 18+ confirmation is required here; identity verification comes later, before hosting or joining. */
export default function Register() {
  const router = useRouter();
  const { t } = useT();
  const { signIn } = useMe();
  const [f, setF] = useState({ displayName: '', email: '', password: '', homeCity: 'Milan' });
  const [adult, setAdult] = useState(false);
  const emailRef = useRef<InputHandle>(null);
  const pwRef = useRef<InputHandle>(null);
  const cityRef = useRef<InputHandle>(null);
  // step 2: the code from the email. `ticket` proves it is the same person who filled the form.
  const [pending, setPending] = useState<{ email: string; ticket: string } | null>(null);
  const [code, setCode] = useState('');
  const [sentAgain, setSentAgain] = useState(false);
  const act = useAction();
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  const valid = f.displayName.trim().length >= 2 && /\S+@\S+\.\S+/.test(f.email) && f.password.length >= 10 && adult;
  const submit = () =>
    act.run(async () => {
      // the answer is the same whether or not the address already has an account; the email says which
      const r = await post<{ email: string; ticket: string; devCode?: string }>('/v1/auth/register', {
        displayName: f.displayName.trim(),
        email: f.email.trim(),
        password: f.password,
        homeCity: f.homeCity.trim() || undefined,
        adultConfirmed: adult,
      });
      setPending({ email: r.email, ticket: r.ticket });
      setCode(r.devCode ?? ''); // development only: the API echoes the code so a phone can finish without a mail server
    });

  const confirm = () =>
    act.run(async () => {
      if (!pending) return;
      const r = await post<{ token: string; refreshToken?: string }>('/v1/auth/register/confirm', { email: pending.email, code: code.trim(), ticket: pending.ticket });
      // fresh: true sends the new user through onboarding (set up the profile) once
      await signIn(r, { fresh: true });
    });

  const again = () =>
    act.run(async () => {
      if (!pending) return;
      await post('/v1/auth/register/resend', { email: pending.email, ticket: pending.ticket });
      setSentAgain(true);
    });

  if (pending)
    return (
      <Screen maxWidth={520}>
        <AuthBack onPress={() => { setPending(null); setCode(''); setSentAgain(false); act.setError(null); }} />
        <View style={{ marginTop: 8 }}>
          <AuthHeading title={t('Check your email')} subtitle={t('We sent a 6-digit code to {email}. Enter it to finish creating your account.', { email: pending.email })} />
        </View>
        <ErrorBanner message={act.error} />
        {sentAgain ? <Banner tone="ok">{t('We sent a new code.')}</Banner> : null}
        <View style={{ gap: 18 }}>
          <AuthField label={t('Code')} placeholder={t('6-digit code')} value={code} onChangeText={setCode} keyboardType="number-pad" autoCapitalize="none" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} returnKeyType="go" onSubmitEditing={confirm} />
          <AuthButton title={t('Continue')} onPress={confirm} loading={act.busy} disabled={code.trim().length !== 6} />
          <Btn title={t('Send the code again')} variant="ghost" onPress={again} disabled={act.busy} />
        </View>
        <Txt variant="small">{t('Already have an account with this email? Check your inbox: we sent you a note, and you can log in or reset your password.')}</Txt>
      </Screen>
    );

  return (
    <Screen maxWidth={520}>
      <AuthBack onPress={() => router.back()} />
      <View style={{ marginTop: 8 }}>
        <AuthHeading title={t('Create your account')} subtitle={t('Join a space where real sparks happen.')} />
      </View>
      <ErrorBanner message={act.error} />
      <View style={{ gap: 18 }}>
        <AuthField label={t('Display name')} placeholder={t('Enter your name')} value={f.displayName} onChangeText={set('displayName')} maxLength={40} autoComplete="name" textContentType="name" autoCapitalize="words" returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => emailRef.current?.focus()} />
        <AuthField label={t('Email')} placeholder={t('Enter your email')} value={f.email} onChangeText={set('email')} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" inputRef={emailRef} returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => pwRef.current?.focus()} />
        <AuthField label={t('Password')} placeholder={t('Enter your password')} hint={t('At least {n} characters', { n: 10 })} value={f.password} onChangeText={set('password')} secureTextEntry autoComplete="new-password" textContentType="newPassword" inputRef={pwRef} returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => cityRef.current?.focus()} />
        <AuthField label={t('Home city')} placeholder={t('Enter your city')} hint={t('City only, never an address')} value={f.homeCity} onChangeText={set('homeCity')} maxLength={60} autoCapitalize="words" inputRef={cityRef} returnKeyType="done" />
        <AuthCheck checked={adult} onChange={setAdult} label={t('I confirm that I am 18 or older.')} />
        <AuthButton title={t('Create account')} onPress={submit} loading={act.busy} disabled={!valid} />
      </View>
      <Txt variant="small" style={{ textAlign: 'center' }}>{t("We'll email you a code. We never show your documents to anyone.")}</Txt>
      <AuthSwitch prompt={t('Already have an account?')} action={t('Log in')} onPress={() => router.replace('/login')} />
    </Screen>
  );
}
