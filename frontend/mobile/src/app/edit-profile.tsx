import * as ImagePicker from 'expo-image-picker';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { AuthButton, AuthField } from '@/components/AuthForm';
import { PageTop, SmallPill, TogglePill } from '@/components/ProfileParts';
import { Text } from '@/components/ScaledText';
import { Avatar, Banner, ErrorBanner, Row, Screen, Txt } from '@/components/ui';
import { del, patch, uploadPhoto } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { INTERESTS, LANGUAGES } from '@/lib/constants';
import { useAction } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

const BIO_MAX = 300;
const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** Edit your profile: picture, name, About, city, languages and interests. One profile for HERE and THERE. */
export default function EditProfile() {
  const { t } = useT();
  const { me, reload } = useMe();
  const { c } = useTheme();
  const router = useRouter();
  const p = me?.profile;
  const [f, setF] = useState({
    displayName: p?.displayName ?? '',
    homeCity: p?.homeCity ?? '',
    bio: p?.bio ?? '',
    languages: p?.languages ?? [],
    interests: p?.interests ?? [],
  });
  const photo = useAction(() => void reload());
  const save = useAction(() => {
    void reload();
    router.canGoBack() ? router.back() : router.replace('/profile');
  });
  if (!p) return null;

  const pick = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7 });
    if (r.canceled || !r.assets[0]) return;
    await photo.run(() => uploadPhoto(r.assets[0].uri));
  };

  return (
    <Screen tabBar>
      <Stack.Screen options={{ headerShown: false }} />
      <PageTop title={t('Edit profile')} align="left" />
      <View style={{ alignItems: 'center', gap: 16 }}>
        <Avatar name={f.displayName || p.displayName} uri={p.photoUrl} size={100} />
        <Row style={{ gap: 14 }}>
          <SmallPill filled title={p.photoUrl ? t('Change photo') : t('Add a photo')} onPress={pick} loading={photo.busy} />
          {p.photoUrl ? <SmallPill title={t('Remove')} onPress={() => photo.run(() => del('/v1/me/photo'))} disabled={photo.busy} /> : null}
        </Row>
        <ErrorBanner message={photo.error} />
        <Txt variant="small" style={{ textAlign: 'center' }}>{t('Your photo is cropped to a square and shown to people on your activities and trips. Never use an ID document.')}</Txt>
      </View>

      <ErrorBanner message={save.error} />
      <AuthField label={t('Display name')} placeholder={t('Enter your name')} value={f.displayName} onChangeText={(v) => setF((x) => ({ ...x, displayName: v }))} maxLength={40} />
      <AuthField label={t('About you')} hint={`${f.bio.length}/${BIO_MAX}`} placeholder={t('A few words about you')} multiline value={f.bio} onChangeText={(v) => setF((x) => ({ ...x, bio: v.slice(0, BIO_MAX) }))} maxLength={BIO_MAX} style={{ minHeight: 96, borderRadius: 28, textAlignVertical: 'top', paddingTop: 14 }} />
      <AuthField label={t('Home city (city only)')} placeholder={t('Your city')} value={f.homeCity} onChangeText={(v) => setF((x) => ({ ...x, homeCity: v }))} maxLength={60} />

      <Text accessibilityRole="header" style={{ color: c.forest, fontSize: 13, lineHeight: 16, fontWeight: '600', paddingLeft: 2 }}>{t('Languages')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {LANGUAGES.map((l) => (
          <TogglePill key={l} label={t(l)} on={f.languages.includes(l)} onPress={() => setF((x) => ({ ...x, languages: toggle(x.languages, l) }))} />
        ))}
      </View>
      <Text accessibilityRole="header" style={{ color: c.forest, fontSize: 13, lineHeight: 16, fontWeight: '600', paddingLeft: 2 }}>{t('Interests')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {INTERESTS.map((i) => (
          <TogglePill key={i} label={t(i)} on={f.interests.includes(i)} onPress={() => setF((x) => ({ ...x, interests: toggle(x.interests, i) }))} />
        ))}
      </View>
      {f.bio.length >= BIO_MAX - 20 ? <Banner>{t('Keep it short: {n} characters left.', { n: BIO_MAX - f.bio.length })}</Banner> : null}

      <AuthButton
        title={t('Save changes')}
        loading={save.busy}
        disabled={f.displayName.trim().length < 2}
        onPress={() =>
          save.run(() =>
            patch('/v1/me/profile', {
              displayName: f.displayName.trim(),
              homeCity: f.homeCity.trim() || null,
              bio: f.bio.trim() || null,
              languages: f.languages,
              interests: f.interests,
            }),
          )
        }
      />
    </Screen>
  );
}
