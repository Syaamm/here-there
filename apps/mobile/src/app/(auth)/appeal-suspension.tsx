import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Banner, Btn, ErrorBanner, Field, Screen, Txt } from '@/components/ui';
import { post } from '@/lib/api';
import { useAction } from '@/lib/hooks';

/** A suspended person cannot sign in, so they prove who they are here and write to the moderators. The answer comes by email. */
export default function AppealSuspension() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const act = useAction(() => setSent(true));

  return (
    <Screen maxWidth={520}>
      <Btn title="‹ Back" variant="ghost" small onPress={() => router.back()} style={{ alignSelf: 'flex-start' }} />
      <Txt variant="h1">Appeal a suspension</Txt>
      {sent ? (
        <>
          <Banner tone="ok">Thank you. A moderator will look at this and we will email you the answer.</Banner>
          <Btn title="Back to log in" onPress={() => router.replace('/login')} />
        </>
      ) : (
        <>
          <Txt variant="muted">Enter your email and password so we know it is you, then tell the moderators why the suspension should be lifted. You can appeal once every 30 days.</Txt>
          <ErrorBanner message={act.error} />
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
          <Field label="Your message" value={message} onChangeText={setMessage} multiline maxLength={1000} />
          <Btn
            title="Send appeal"
            loading={act.busy}
            disabled={!email || !password || message.trim().length < 10}
            onPress={() => void act.run(() => post('/v1/appeals/suspension', { email: email.trim(), password, message: message.trim() }))}
          />
        </>
      )}
    </Screen>
  );
}
