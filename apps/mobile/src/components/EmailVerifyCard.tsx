import { useEffect, useState } from 'react';
import { Banner, Btn, Card, ErrorBanner, Field, Txt } from '@/components/ui';
import { post } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useAction } from '@/lib/hooks';

/** Confirms the user controls their email address with a 6-digit code (spec 3.1 step 2). */
export function EmailVerifyCard({ onVerified }: { onVerified?: () => void }) {
  const { me, reload, devCode, setDevCode } = useMe();
  const [code, setCode] = useState('');
  const [wait, setWait] = useState(0);
  const verify = useAction();
  const resend = useAction();

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  if (me?.emailVerified) return <Banner tone="ok">✓ Email confirmed ({me.email})</Banner>;

  const submit = async () => {
    const r = await verify.run(() => post('/v1/me/email/verify', { code }));
    if (r) {
      setDevCode(null);
      await reload();
      onVerified?.();
    }
  };
  const send = async () => {
    const r = await resend.run(() => post<{ devCode?: string }>('/v1/me/email/send-code'));
    if (r) {
      setDevCode(r.devCode ?? null);
      setWait(30);
    }
  };

  return (
    <Card style={{ gap: 12 }}>
      <Txt variant="h3">✉ Confirm your email</Txt>
      <Txt variant="small">We sent a 6-digit code to {me?.email}. It expires in 15 minutes. Check your spam folder if you can't see it.</Txt>
      {devCode ? (
        <Banner tone="warn">
          Dev mode: no mail server is connected, so your code is {devCode}. Real accounts get it by email.
        </Banner>
      ) : null}
      <ErrorBanner message={verify.error ?? resend.error} />
      <Field label="6-digit code" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" textContentType="oneTimeCode" onSubmitEditing={submit} />
      {devCode ? <Btn title="Fill in the code" variant="secondary" small onPress={() => setCode(devCode)} /> : null}
      <Btn title="Confirm email" onPress={submit} loading={verify.busy} disabled={code.length !== 6} />
      <Btn title={wait > 0 ? `Send a new code (${wait}s)` : 'Send a new code'} variant="secondary" onPress={send} loading={resend.busy} disabled={wait > 0} />
    </Card>
  );
}
