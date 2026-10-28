import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Banner, Btn, ErrorBanner, Field, Screen, Txt } from '@/components/ui';
import { post } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

const MIN = 10;

/** Change your password while signed in. Your other devices are signed out; this one stays in. */
export default function ChangePassword() {
  const router = useRouter();
  const { signIn } = useMe();
  const { t } = useT();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [done, setDone] = useState(false);
  const act = useAction();

  const tooShort = password.length > 0 && password.length < MIN;
  const mismatch = again.length > 0 && again !== password;
  const same = password.length > 0 && password === current;
  const ready = !!current && password.length >= MIN && again === password && !same;

  const submit = async () => {
    if (!ready) return;
    const r = await act.run(() => post<{ token: string }>('/v1/me/password', { currentPassword: current, newPassword: password }));
    if (r) {
      await signIn(r.token); // the old sign-in has just ended; this keeps the person in
      setCurrent('');
      setPassword('');
      setAgain('');
      setDone(true);
    }
  };

  return (
    <Screen hasHeader maxWidth={520}>
      {done ? (
        <>
          <Banner tone="ok">{t('Password changed. Other devices were signed out.')}</Banner>
          <Btn title={t('Done')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/settings'))} />
        </>
      ) : (
        <>
          <ErrorBanner message={act.error} />
          <Field label={t('Current password')} value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" textContentType="password" />
          <Field label={t('New password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" hint={t('At least {min} characters', { min: MIN })} error={tooShort ? t('Use at least {min} characters', { min: MIN }) : same ? t('Choose a password you are not using now') : null} />
          <Field label={t('New password again')} value={again} onChangeText={setAgain} secureTextEntry autoComplete="new-password" textContentType="newPassword" error={mismatch ? t('The two passwords are not the same') : null} onSubmitEditing={submit} />
          <Btn title={t('Change password')} onPress={submit} loading={act.busy} disabled={!ready} />
        </>
      )}
    </Screen>
  );
}
