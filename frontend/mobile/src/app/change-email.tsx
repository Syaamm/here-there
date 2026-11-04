import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AcctScreen } from '@/components/AccountParts';
import { AuthButton, AuthField, type InputHandle } from '@/components/AuthForm';
import { Banner, Btn, ErrorBanner, Txt } from '@/components/ui';
import { post } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

/** Change the email address. A code goes to the NEW address first; the old address is told once it has changed. */
export default function ChangeEmail() {
  const router = useRouter();
  const { me, reload } = useMe();
  const { t } = useT();
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState<{ to: string; devCode?: string } | null>(null);
  const [code, setCode] = useState('');
  const [wait, setWait] = useState(0);
  const [changedTo, setChangedTo] = useState<string | null>(null);
  const pwRef = useRef<InputHandle>(null);
  const ask = useAction();
  const confirm = useAction();

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
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
      <AcctScreen title={t('Change email')}>
        <Banner tone="ok">{t('Email changed to {email}.', { email: changedTo })}</Banner>
        <Btn title={t('Done')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/settings'))} />
      </AcctScreen>
    );

  return (
    <AcctScreen title={t('Change email')}>
      {!sent ? (
        <>
          <Txt variant="muted">{t('Current email: {email}', { email: me?.email ?? '' })}</Txt>
          <ErrorBanner message={ask.error} />
          <AuthField label={t('New email')} placeholder={t('Enter your new email')} value={newEmail} onChangeText={setNewEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => pwRef.current?.focus()} />
          <AuthField label={t('Your password')} placeholder={t('Enter your password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" inputRef={pwRef} returnKeyType="go" onSubmitEditing={send} />
          <AuthButton title={t('Send the code')} onPress={send} loading={ask.busy} disabled={!newEmail.trim() || !password} />
        </>
      ) : (
        <>
          <Txt variant="muted">{t('Code sent to {to}.', { to: sent.to })}</Txt>
          {sent.devCode ? <Banner tone="warn">{t('Dev mode: your code is {code}.', { code: sent.devCode })}</Banner> : null}
          <ErrorBanner message={confirm.error ?? ask.error} />
          <AuthField label={t('6-digit code')} placeholder={t('6-digit code')} value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" textContentType="oneTimeCode" returnKeyType="go" onSubmitEditing={submit} />
          {sent.devCode ? <Btn title={t('Fill in the code')} variant="secondary" small onPress={() => setCode(sent.devCode!)} /> : null}
          <AuthButton title={t('Change my email')} onPress={submit} loading={confirm.busy} disabled={code.length !== 6} />
          <Btn title={wait > 0 ? t('Send a new code ({wait}s)', { wait }) : t('Send a new code')} variant="secondary" onPress={send} loading={ask.busy} disabled={wait > 0} />
          <Btn title={t('Use a different address')} variant="ghost" onPress={() => { setSent(null); setCode(''); ask.setError(null); confirm.setError(null); }} />
        </>
      )}
    </AcctScreen>
  );
}
