import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { AuthBack, AuthButton, AuthField, AuthHeading } from '@/components/AuthForm';
import { Banner, Btn, ErrorBanner, Screen } from '@/components/ui';
import { post } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { sp } from '@/lib/scale';

/**
 * The code page after "Continue with Apple / Google" for a new account: the API mailed a 6-digit code, and the account only
 * gets in once it is entered (the same confirmation as after a password sign-up, POST /auth/register/confirm).
 */
export default function VerifyEmail() {
  const router = useRouter();
  const { t } = useT();
  const { signIn } = useMe();
  const p = useLocalSearchParams<{ email?: string; ticket?: string; devCode?: string }>();
  const email = String(p.email ?? '');
  const ticket = String(p.ticket ?? '');
  const [code, setCode] = useState(p.devCode ? String(p.devCode) : ''); // development only: the API echoes the code
  const [sentAgain, setSentAgain] = useState(false);
  const act = useAction();

  const confirm = () =>
    act.run(async () => {
      const r = await post<{ token: string; refreshToken?: string }>('/v1/auth/register/confirm', { email, code: code.trim(), ticket });
      await signIn(r, { fresh: true }); // a new account goes through onboarding once
    });

  const again = () =>
    act.run(async () => {
      await post('/v1/auth/register/resend', { email, ticket });
      setSentAgain(true);
    });

  return (
    <Screen maxWidth={520}>
      <AuthBack onPress={() => router.back()} />
      <View style={{ marginTop: sp(8) }}>
        <AuthHeading title={t('Check your email')} subtitle={t('We sent a 6-digit code to {email}. Enter it to finish creating your account.', { email })} />
      </View>
      <ErrorBanner message={act.error} />
      {sentAgain ? <Banner tone="ok">{t('We sent a new code.')}</Banner> : null}
      <View style={{ gap: sp(18) }}>
        <AuthField label={t('Code')} placeholder={t('6-digit code')} value={code} onChangeText={setCode} keyboardType="number-pad" autoCapitalize="none" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} returnKeyType="go" onSubmitEditing={confirm} />
        <AuthButton title={t('Continue')} onPress={confirm} loading={act.busy} disabled={code.trim().length !== 6} />
        <Btn title={t('Send the code again')} variant="ghost" onPress={again} disabled={act.busy} />
      </View>
    </Screen>
  );
}
