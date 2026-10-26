import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Platform, Share } from 'react-native';
import { Banner, Btn, Card, ErrorBanner, ListRow, Screen, Txt, useGo } from '@/components/ui';
import { get } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';

/** Hands the file to the person: a download in a browser, the share sheet (Save to Files, Mail, Copy...) on a phone. */
async function deliver(data: unknown) {
  const json = JSON.stringify(data, null, 2);
  const name = `herethere-my-data-${new Date().toISOString().slice(0, 10)}.json`;
  if (Platform.OS === 'web') {
    const doc = (globalThis as unknown as { document: Document }).document;
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = doc.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  await Share.share({ message: json, title: name });
}

/** Your data: a copy of it, correcting it, and deleting the account. */
export default function MyData() {
  const go = useGo();
  const { c } = useTheme();
  const [done, setDone] = useState(false);
  const act = useAction();
  const download = async () => {
    setDone(false);
    const data = await act.run(() => get('/v1/me/export'));
    if (data) {
      await deliver(data);
      setDone(true);
    }
  };
  const arrow = <Ionicons name="chevron-forward" size={16} color={c.muted} />;

  return (
    <Screen hasHeader>
      <Txt variant="muted">It is your data. Take a copy, correct it, or have it erased.</Txt>
      <ErrorBanner message={act.error} />
      {done ? <Banner tone="ok">Your data is ready. Keep the file somewhere safe: it holds your messages and details.</Banner> : null}

      <Txt variant="label">A copy of your data</Txt>
      <Card style={{ padding: 14, borderRadius: 18, gap: 10 }}>
        <Txt variant="small">One file with your account, profile, plans and trips, requests, favourites, who you follow and block, the messages you sent, your alerts, the reports you filed, and your identity-check history. Not included: your password, and other people's private details.</Txt>
        <Btn title="Download my data" onPress={download} loading={act.busy} />
        <Txt variant="small">You can ask for it up to three times a day.</Txt>
      </Card>

      <Txt variant="label">What we keep</Txt>
      <Card style={{ padding: 12, borderRadius: 18, gap: 0 }}>
        <ListRow icon="time-outline" title="How long we keep things" subtitle="Chats, alerts, reports and more, and when they are deleted" onPress={() => go('/retention')} right={arrow} last />
      </Card>

      <Txt variant="label">Delete your account</Txt>
      <Card style={{ padding: 14, borderRadius: 18, gap: 10 }}>
        <Txt variant="small">This erases your name, photo, bio, email, messages and identity details, and cannot be undone.</Txt>
        <Btn title="Delete my account…" variant="danger" onPress={() => go('/delete-account')} />
      </Card>
    </Screen>
  );
}
