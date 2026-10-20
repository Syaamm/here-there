import { useEffect, useState } from 'react';
import { Banner, Between, Btn, Card, ErrorBanner, Field, Txt } from '@/components/ui';
import { del, post } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useAction } from '@/lib/hooks';

/**
 * Optional mobile-number confirmation by SMS code (spec 3.1 step 2). Nothing in the app depends on it:
 * it only adds a second way to recover and reach you.
 */
export function PhoneVerifyCard({ compact }: { compact?: boolean }) {
  const { me, reload } = useMe();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const send = useAction();
  const verify = useAction();
  const remove = useAction(() => void reload());

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  if (me?.phoneVerified)
    return (
      <Card style={{ gap: 8 }}>
        <Between>
          <Txt variant="h3">📱 Mobile number</Txt>
          <Btn title="Remove" variant="ghost" small loading={remove.busy} onPress={() => remove.run(() => del('/v1/me/phone'))} />
        </Between>
        <Banner tone="ok">✓ Confirmed ({me.phone})</Banner>
      </Card>
    );

  const sendCode = async () => {
    const r = await send.run(() => post<{ devCode?: string }>('/v1/me/phone/send-code', { phone }));
    if (r) {
      setSent(true);
      setDevCode(r.devCode ?? null);
      setWait(30);
    }
  };
  const confirm = async () => {
    const r = await verify.run(() => post('/v1/me/phone/verify', { code }));
    if (r) {
      setSent(false);
      setCode('');
      await reload();
    }
  };

  return (
    <Card style={{ gap: 12 }}>
      <Txt variant="h3">📱 Add your mobile number {compact ? '(optional)' : ''}</Txt>
      <Txt variant="small">Optional. A second way to confirm it's you and to reach you. Nothing in the app needs it. Include the country code.</Txt>
      <ErrorBanner message={send.error ?? verify.error} />
      <Field label="Mobile number" placeholder="+39 333 123 4567" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" editable={!sent} />
      {!sent ? (
        <Btn title="Send code" variant="secondary" onPress={sendCode} loading={send.busy} disabled={phone.replace(/\D/g, '').length < 8} />
      ) : (
        <>
          {devCode ? <Banner tone="warn">Dev mode: no SMS service is connected, so your code is {devCode}.</Banner> : null}
          <Field label="6-digit code" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" textContentType="oneTimeCode" />
          {devCode ? <Btn title="Fill in the code" variant="secondary" small onPress={() => setCode(devCode)} /> : null}
          <Btn title="Confirm number" onPress={confirm} loading={verify.busy} disabled={code.length !== 6} />
          <Btn title={wait > 0 ? `Send a new code (${wait}s)` : 'Send a new code'} variant="ghost" onPress={sendCode} loading={send.busy} disabled={wait > 0} />
          <Btn title="Use a different number" variant="ghost" small onPress={() => (setSent(false), setCode(''))} />
        </>
      )}
    </Card>
  );
}
