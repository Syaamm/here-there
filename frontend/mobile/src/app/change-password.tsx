import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { AcctScreen } from '@/components/AccountParts';
import { AuthButton, AuthField, type InputHandle } from '@/components/AuthForm';
import { Banner, Btn, ErrorBanner } from '@/components/ui';
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
  const newRef = useRef<InputHandle>(null);
  const againRef = useRef<InputHandle>(null);
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
      await signIn(r); // the old sign-in has just ended; this keeps the person in
      setCurrent('');
      setPassword('');
      setAgain('');
      setDone(true);
    }
  };

  return (
    <AcctScreen title={t('Change password')}>
      {done ? (
        <>
          <Banner tone="ok">{t('Password changed. Other devices were signed out.')}</Banner>
          <Btn title={t('Done')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/settings'))} />
        </>
      ) : (
        <>
          <ErrorBanner message={act.error} />
          <AuthField label={t('Current password')} placeholder={t('Enter your current password')} value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" textContentType="password" returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => newRef.current?.focus()} />
          <AuthField label={t('New password')} placeholder={t('Enter your new password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" inputRef={newRef} returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => againRef.current?.focus()} hint={t('At least {min} characters', { min: MIN })} error={tooShort ? t('Use at least {min} characters', { min: MIN }) : same ? t('Choose a password you are not using now') : null} />
          <AuthField label={t('New password again')} placeholder={t('Enter your new password')} value={again} onChangeText={setAgain} secureTextEntry autoComplete="new-password" textContentType="newPassword" inputRef={againRef} returnKeyType="go" error={mismatch ? t('The two passwords are not the same') : null} onSubmitEditing={submit} />
          <AuthButton title={t('Change password')} onPress={submit} loading={act.busy} disabled={!ready} />
        </>
      )}
    </AcctScreen>
  );
}
