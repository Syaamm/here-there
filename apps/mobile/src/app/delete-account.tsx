import { View } from 'react-native';
import { Banner, Btn, Card, ErrorBanner, Field, Screen, Txt, useGo } from '@/components/ui';
import { post } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { useState } from 'react';
import { useTheme } from '@/lib/theme';

const WHAT: string[] = [
  'Plans and trips you host that have not finished are cancelled, and the people in them are told.',
  'You leave the plans and trips you have joined, and your requests are withdrawn.',
  'Your name, photo, bio, email, phone number, favourites, who you follow and block, your messages and your identity details are erased.',
  'Safety reports about you, and any message someone reported, can be kept so the moderators can finish their work.',
  'You can sign up again with the same email later. It will be a brand new account.',
];

/** Delete the account. Asks for the password and the word DELETE; it cannot be undone. */
export default function DeleteAccount() {
  const { logout } = useMe();
  const go = useGo();
  const { c } = useTheme();
  const [password, setPassword] = useState('');
  const [word, setWord] = useState('');
  const act = useAction();
  const ready = !!password && word === 'DELETE';

  const submit = async () => {
    if (!ready) return;
    const r = await act.run(() => post('/v1/me/delete', { password, confirm: 'DELETE' }));
    if (r) logout(); // the account is gone: back to the welcome page
  };

  return (
    <Screen hasHeader maxWidth={520}>
      <Banner tone="bad">Deleting your account cannot be undone.</Banner>
      <Card style={{ padding: 14, borderRadius: 18, gap: 8 }}>
        <Txt variant="h3">What happens</Txt>
        {WHAT.map((t) => (
          <View key={t} style={{ flexDirection: 'row', gap: 8 }}>
            <Txt variant="small" color={c.muted}>•</Txt>
            <Txt variant="small" style={{ flex: 1 }}>{t}</Txt>
          </View>
        ))}
      </Card>
      <Btn title="Download a copy of my data first" variant="secondary" small onPress={() => go('/my-data')} />
      <ErrorBanner message={act.error} />
      <Field label="Your password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" />
      <Field label="Type DELETE to confirm" value={word} onChangeText={setWord} autoCapitalize="characters" autoCorrect={false} hint="Capital letters, exactly as shown" onSubmitEditing={submit} />
      <Btn title="Delete my account" variant="danger" onPress={submit} loading={act.busy} disabled={!ready} />
    </Screen>
  );
}
