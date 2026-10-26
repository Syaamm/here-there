import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Banner, Btn, ErrorBanner, Field, Screen, Txt } from '@/components/ui';
import { post } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useAction } from '@/lib/hooks';

/** Change the email address. A code goes to the NEW address first; the old address is told once it has changed. */
export default function ChangeEmail() {
  const router = useRouter();
  const { me, reload } = useMe();
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState<{ to: string; devCode?: string } | null>(null);
  const [code, setCode] = useState('');
  const [wait, setWait] = useState(0);
  const [changedTo, setChangedTo] = useState<string | null>(null);
  const ask = useAction();
  const confirm = useAction();

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const send = async () => {
    const to = newEmail.trim();
    const r = await ask.run(() => post<{ ok: boolean; devCode?: string }>('/v1/me/email/change', { newEmail: to, password }));
    if (r) {
      setSent({ to, devCode: r.devCode });
      setWait(30);
    }
  };
  const submit = async () => {
    const r = await confirm.run(() => post<{ email: string }>('/v1/me/email/change/confirm', { code }));
    if (r) {
      await reload();
      setChangedTo(r.email);
    }
  };

  if (changedTo)
    return (
      <Screen hasHeader maxWidth={520}>
        <Banner tone="ok">Your email address is now {changedTo}. We have told your old address about the change.</Banner>
        <Btn title="Done" onPress={() => (router.canGoBack() ? router.back() : router.replace('/settings'))} />
      </Screen>
    );

  return (
    <Screen hasHeader maxWidth={520}>
      {!sent ? (
        <>
          <Txt variant="muted">Your email is {me?.email}. Enter the new address and your password, and we will send a code to the new address.</Txt>
          <ErrorBanner message={ask.error} />
          <Field label="New email" value={newEmail} onChangeText={setNewEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
          <Field label="Your password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" onSubmitEditing={send} />
          <Btn title="Send the code" onPress={send} loading={ask.busy} disabled={!newEmail.trim() || !password} />
        </>
      ) : (
        <>
          <Txt variant="muted">We sent a 6-digit code to {sent.to}. It expires in 15 minutes. Nothing changes until you enter it.</Txt>
          {sent.devCode ? <Banner tone="warn">Dev mode: no mail server is connected, so your code is {sent.devCode}. Real accounts get it by email.</Banner> : null}
          <ErrorBanner message={confirm.error ?? ask.error} />
          <Field label="6-digit code" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" textContentType="oneTimeCode" onSubmitEditing={submit} />
          {sent.devCode ? <Btn title="Fill in the code" variant="secondary" small onPress={() => setCode(sent.devCode!)} /> : null}
          <Btn title="Change my email" onPress={submit} loading={confirm.busy} disabled={code.length !== 6} />
          <Btn title={wait > 0 ? `Send a new code (${wait}s)` : 'Send a new code'} variant="secondary" onPress={send} loading={ask.busy} disabled={wait > 0} />
          <Btn title="Use a different address" variant="ghost" onPress={() => { setSent(null); setCode(''); ask.setError(null); confirm.setError(null); }} />
        </>
      )}
    </Screen>
  );
}
