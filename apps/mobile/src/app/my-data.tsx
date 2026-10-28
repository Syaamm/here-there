import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { Banner, Btn, Card, ErrorBanner, ListRow, Screen, Txt, useGo } from '@/components/ui';
import { post } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { currentLang, useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

/** Your data: a copy of it, correcting it, and deleting the account. */
export default function MyData() {
  const go = useGo();
  const { t } = useT();
  const { c } = useTheme();
  const [done, setDone] = useState(false);
  const act = useAction();
  // the ZIP: the server gives a two-minute link; a browser downloads it, a phone opens it in the system browser (Save to Files)
  const download = async () => {
    setDone(false);
    const link = await act.run(() => post<{ url: string }>('/v1/me/export/zip-link', { lang: currentLang() }));
    if (!link) return;
    if (Platform.OS === 'web') {
      const doc = (globalThis as unknown as { document: Document }).document;
      const a = doc.createElement('a');
      a.href = link.url;
      a.click();
    } else {
      await WebBrowser.openBrowserAsync(link.url);
    }
    setDone(true);
  };
  const arrow = <Ionicons name="chevron-forward" size={16} color={c.muted} />;

  return (
    <Screen hasHeader>
      <ErrorBanner message={act.error} />
      {done ? <Banner tone="ok">{t('Ready. Keep the file safe.')}</Banner> : null}

      <Txt variant="label">{t('A copy of your data')}</Txt>
      <Card style={{ padding: 14, borderRadius: 18, gap: 10 }}>
        <Txt variant="small">{t("A ZIP with all the data we keep about you, as a file. Not included: your password and other people's private details. One copy a day.")}</Txt>
        <Btn title={t('Download my data (ZIP)')} onPress={download} loading={act.busy} />
      </Card>

      <Txt variant="label">{t('What we keep')}</Txt>
      <Card style={{ padding: 12, borderRadius: 18, gap: 0 }}>
        <ListRow icon="time-outline" title={t('How long we keep things')} subtitle={t('Chats, alerts, reports and more, and when they are deleted')} onPress={() => go('/retention')} right={arrow} last />
      </Card>

      <Txt variant="label">{t('Delete your account')}</Txt>
      <Card style={{ padding: 14, borderRadius: 18, gap: 10 }}>
        <Txt variant="small">{t('This erases your name, photo, bio, email, messages and identity details, and cannot be undone.')}</Txt>
        <Btn title={t('Delete my account…')} variant="danger" onPress={() => go('/delete-account')} />
      </Card>
    </Screen>
  );
}
