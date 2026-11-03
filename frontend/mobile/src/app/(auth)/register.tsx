import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Banner, Btn, CheckRow, ErrorBanner, Field, Screen, Txt } from '@/components/ui';
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
        <Btn title={t('‹ Back')} variant="ghost" small onPress={() => { setPending(null); setCode(''); setSentAgain(false); act.setError(null); }} style={{ alignSelf: 'flex-start' }} />
        <Txt variant="h1">{t('Check your email')}</Txt>
        <Txt variant="muted">{t('We sent a 6-digit code to {email}. Enter it to finish creating your account.', { email: pending.email })}</Txt>
        <ErrorBanner message={act.error} />
        {sentAgain ? <Banner tone="ok">{t('We sent a new code.')}</Banner> : null}
        <Field label={t('Code')} value={code} onChangeText={setCode} keyboardType="number-pad" autoCapitalize="none" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} onSubmitEditing={confirm} />
        <Btn title={t('Continue')} onPress={confirm} loading={act.busy} disabled={code.trim().length !== 6} />
        <Btn title={t('Send the code again')} variant="ghost" onPress={again} disabled={act.busy} />
        <Txt variant="small">{t('Already have an account with this email? Check your inbox: we sent you a note, and you can log in or reset your password.')}</Txt>
      </Screen>
    );

  return (
    <Screen maxWidth={520}>
      <Btn title={t('‹ Back')} variant="ghost" small onPress={() => router.back()} style={{ alignSelf: 'flex-start' }} />
      <Txt variant="h1">{t('Create your account')}</Txt>
      <ErrorBanner message={act.error} />
      <Field label={t('Display name')} value={f.displayName} onChangeText={set('displayName')} maxLength={40} autoComplete="nickname" />
      <Field label={t('Email')} value={f.email} onChangeText={set('email')} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
      <Field label={t('Password')} hint={t('At least {n} characters', { n: 10 })} value={f.password} onChangeText={set('password')} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
      <Field label={t('Home city')} hint={t('City only, never an address')} value={f.homeCity} onChangeText={set('homeCity')} maxLength={60} />
      <CheckRow checked={adult} onChange={setAdult}>
        <Txt>{t('I confirm that I am 18 or older.')}</Txt>
      </CheckRow>
      <Btn title={t('Create account')} onPress={submit} loading={act.busy} disabled={!valid} />
      <Txt variant="small">
        {t("We'll email you a code. We never show your documents to anyone.")}
      </Txt>
      <Btn title={t('Already have an account? Log in')} variant="ghost" onPress={() => router.replace('/login')} />
    </Screen>
  );
}
