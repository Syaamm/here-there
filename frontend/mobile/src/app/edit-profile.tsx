import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useNavigation, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, View } from 'react-native';
import { appAlert } from '@/components/AppDialog';
import { CityField } from '@/components/OnboardingParts';
import { AuthButton, AuthField } from '@/components/AuthForm';
import { SmallPill, TogglePill } from '@/components/ProfileParts';
import { Text } from '@/components/ScaledText';
import { Avatar, Banner, ErrorBanner, Row, Screen, Txt } from '@/components/ui';
import { del, patch, uploadPhoto } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { HERE_INTERESTS, LANGUAGES, THERE_INTERESTS } from '@/lib/constants';
import { useAction } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { showToast } from '@/lib/toast';

import { sc, sp, sph } from '@/lib/scale';
const BIO_MAX = 300;
const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** Edit your profile: picture, name, About, city, languages and interests. One profile for HERE and THERE. */
export default function EditProfile() {
  const { t } = useT();
  const { me, reload } = useMe();
  const { c, mode } = useTheme();
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
  const saved = useRef(false); // once saved, leaving needs no question
  const save = useAction(() => {
    saved.current = true;
    void reload();
    router.canGoBack() ? router.back() : router.replace('/profile');
  });
  const body = () => ({ displayName: f.displayName.trim(), homeCity: f.homeCity.trim() || null, bio: f.bio.trim() || null, languages: f.languages, interests: f.interests });

  // Unsaved edits: leaving is held until the person saves them or throws them away. Each way out is handled here directly:
  // the back button at the top asks first, Android's back button is caught, and the iPhone swipe back is switched off while
  // there are changes (a navigation "beforeRemove" listener alone did not fire for the back button here).
  const navigation = useNavigation() as unknown as { addListener: (ev: 'beforeRemove', cb: (e: { preventDefault: () => void; data: { action: unknown } }) => void) => () => void; dispatch: (action: never) => void };
  const start = useRef(JSON.stringify(f));
  const dirty = JSON.stringify(f) !== start.current;
  const leaving = useRef(false); // discarded (or saved): the way out is open
  const latest = useRef({ dirty, body });
  latest.current = { dirty, body };
  const leave = () => {
    leaving.current = true;
    router.canGoBack() ? router.back() : router.replace('/settings' as never);
  };
  const ask = () =>
    appAlert(t('Unsaved changes'), t('You changed your profile. Save the changes before leaving, or discard them?'), [
      { text: t('Keep editing'), style: 'cancel' },
      { text: t('Discard'), style: 'destructive', onPress: leave },
      { text: t('Save changes'), onPress: () => void save.run(() => patch('/v1/me/profile', latest.current.body())) },
    ]);
  const back = () => (latest.current.dirty && !saved.current ? ask() : leave());
  // Android's back button
  useEffect(() => {
    if (!dirty) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (saved.current || leaving.current) return false;
      ask();
      return true;
    });
    return () => sub.remove();
  }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  // and anything else that would take the page away (kept as a safety net)
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (saved.current || leaving.current || !latest.current.dirty) return;
        e.preventDefault();
        ask();
      }),
    [navigation], // eslint-disable-line react-hooks/exhaustive-deps
  );
  if (!p) return null;

  const pick = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7 });
    if (r.canceled || !r.assets[0]) return;
    const done = await photo.run(() => uploadPhoto(r.assets[0].uri));
    // who will see it, said once more the moment it is up
    if (done?.photoUrl) showToast(t('Photo saved. People in the activities and trips you join will see it.'), 'ok', 3200);
  };

  return (
    <Screen tabBar onBack={back}>
      <Stack.Screen options={{ gestureEnabled: !dirty }} />
      <View style={{ alignItems: 'center', gap: sp(26) }}>
        <Avatar name={f.displayName || p.displayName} uri={p.photoUrl} size={100} />
        <Row style={{ gap: sp(14) }}>
          <SmallPill filled title={p.photoUrl ? t('Change photo') : t('Add a photo')} onPress={pick} loading={photo.busy} />
          {p.photoUrl ? <SmallPill title={t('Remove')} onPress={() => photo.run(() => del('/v1/me/photo'))} disabled={photo.busy} /> : null}
        </Row>
        <ErrorBanner message={photo.error} />
        {/* who sees the photo, said plainly next to the photo buttons */}
        <View accessible style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp(8), paddingHorizontal: sph(14), paddingVertical: sp(10), borderRadius: sc(16), backgroundColor: c.accentSoft, maxWidth: sc(420) }}>
          <Ionicons name="eye-outline" size={sc(16)} color={c.forest} style={{ marginTop: 1 }} />
          <Txt variant="small" style={{ flex: 1, color: c.forest }}>{t('Your photo will be seen by people in the activities and trips you join. Never use an ID document.')}</Txt>
        </View>
      </View>

      <ErrorBanner message={save.error} />
      <View style={{ gap: sp(28), marginTop: sp(14) }}>
        <AuthField label={t('Display name')} placeholder={t('Enter your name')} value={f.displayName} onChangeText={(v) => setF((x) => ({ ...x, displayName: v }))} maxLength={40} autoComplete="name" textContentType="name" autoCapitalize="words" />
        <AuthField label={t('About you')} hint={`${f.bio.length}/${BIO_MAX}`} placeholder={t('A few words about you')} multiline value={f.bio} onChangeText={(v) => setF((x) => ({ ...x, bio: v.slice(0, BIO_MAX) }))} maxLength={BIO_MAX} style={{ minHeight: sc(96), borderRadius: sc(28), textAlignVertical: 'top', paddingTop: sp(14) }} />
        <View style={{ gap: sp(14) }}>
          <Text accessibilityRole="header" style={{ color: c.forest, fontSize: 16, lineHeight: 22, fontWeight: '600', paddingLeft: 2 }}>{t('Home city (city only)')}</Text>
          <CityField value={f.homeCity} onPick={(name) => setF((x) => ({ ...x, homeCity: name }))} />
        </View>
        <View style={{ gap: sp(14) }}>
          <Text accessibilityRole="header" style={{ color: c.forest, fontSize: 16, lineHeight: 22, fontWeight: '600', paddingLeft: 2 }}>{t('Languages')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp(10) }}>
            {LANGUAGES.map((l) => (
              <TogglePill key={l} label={t(l)} on={f.languages.includes(l)} onPress={() => setF((x) => ({ ...x, languages: toggle(x.languages, l) }))} />
            ))}
          </View>
        </View>
        <View style={{ gap: sp(14) }}>
          <Text accessibilityRole="header" style={{ color: c.forest, fontSize: 16, lineHeight: 22, fontWeight: '600', paddingLeft: 2 }}>{t('Interests')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp(10) }}>
            {(mode === 'there' ? THERE_INTERESTS : HERE_INTERESTS).map(([key, label]) => (
              <TogglePill key={key} label={t(label)} on={f.interests.includes(key)} onPress={() => setF((x) => ({ ...x, interests: toggle(x.interests, key) }))} />
            ))}
          </View>
        </View>
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
