import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Avatar, Banner, Btn, ErrorBanner, Field, Pill, PillRow, Row, Screen, Txt } from '@/components/ui';
import { del, patch, uploadPhoto } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { INTERESTS, LANGUAGES } from '@/lib/constants';
import { useAction } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

const BIO_MAX = 300;
const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** Edit your profile: picture, name, About, city, languages and interests. One profile for HERE and THERE. */
export default function EditProfile() {
  const { t } = useT();
  const { me, reload } = useMe();
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
      <View style={{ alignItems: 'center', gap: 10 }}>
        <Avatar name={f.displayName || p.displayName} uri={p.photoUrl} size={112} />
        <Row style={{ gap: 8 }}>
          <Btn title={p.photoUrl ? t('Change photo') : t('Add a photo')} small onPress={pick} loading={photo.busy} />
          {p.photoUrl ? <Btn title={t('Remove')} small variant="secondary" onPress={() => photo.run(() => del('/v1/me/photo'))} disabled={photo.busy} /> : null}
        </Row>
        <ErrorBanner message={photo.error} />
        <Txt variant="small" style={{ textAlign: 'center' }}>{t('Your photo is cropped to a square and shown to people on your activities and trips. Never use an ID document.')}</Txt>
      </View>

      <ErrorBanner message={save.error} />
      <Field label={t('Display name')} value={f.displayName} onChangeText={(v) => setF((x) => ({ ...x, displayName: v }))} maxLength={40} />
      <View style={{ gap: 4 }}>
        <Field label={t('About you')} hint={`${f.bio.length}/${BIO_MAX}`} placeholder={t('A few words about you')} multiline value={f.bio} onChangeText={(v) => setF((x) => ({ ...x, bio: v.slice(0, BIO_MAX) }))} maxLength={BIO_MAX} />
      </View>
      <Field label={t('Home city (city only)')} value={f.homeCity} onChangeText={(v) => setF((x) => ({ ...x, homeCity: v }))} maxLength={60} />

      <Txt variant="label">{t('Languages')}</Txt>
      <PillRow>
        {LANGUAGES.map((l) => (
          <Pill key={l} label={t(l)} active={f.languages.includes(l)} onPress={() => setF((x) => ({ ...x, languages: toggle(x.languages, l) }))} />
        ))}
      </PillRow>
      <Txt variant="label">{t('Interests')}</Txt>
      <PillRow>
        {INTERESTS.map((i) => (
          <Pill key={i} label={t(i)} active={f.interests.includes(i)} onPress={() => setF((x) => ({ ...x, interests: toggle(x.interests, i) }))} />
        ))}
      </PillRow>
      {f.bio.length >= BIO_MAX - 20 ? <Banner>{t('Keep it short: {n} characters left.', { n: BIO_MAX - f.bio.length })}</Banner> : null}

      <Btn
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
