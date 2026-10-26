import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Banner, Btn, ErrorBanner, Field, Screen, Txt } from '@/components/ui';
import { post } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useAction } from '@/lib/hooks';

const MIN = 10;

/** Change your password while signed in. Your other devices are signed out; this one stays in. */
export default function ChangePassword() {
  const router = useRouter();
  const { signIn } = useMe();
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
          <Banner tone="ok">Your password has been changed. Any other device you were signed in on has been signed out, and we have emailed you a notice.</Banner>
          <Btn title="Done" onPress={() => (router.canGoBack() ? router.back() : router.replace('/settings'))} />
        </>
      ) : (
        <>
          <Txt variant="muted">Choose a new password. You will stay signed in here; every other device will be signed out.</Txt>
          <ErrorBanner message={act.error} />
          <Field label="Current password" value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" textContentType="password" />
          <Field label="New password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" hint={`At least ${MIN} characters`} error={tooShort ? `Use at least ${MIN} characters` : same ? 'Choose a password you are not using now' : null} />
          <Field label="New password again" value={again} onChangeText={setAgain} secureTextEntry autoComplete="new-password" textContentType="newPassword" error={mismatch ? 'The two passwords are not the same' : null} onSubmitEditing={submit} />
          <Btn title="Change password" onPress={submit} loading={act.busy} disabled={!ready} />
          <Txt variant="small">Forgot your current password? Sign out, then tap "Forgot password?" on the login screen.</Txt>
        </>
      )}
    </Screen>
  );
}
