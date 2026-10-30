import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ScaledText';
import { Btn, Card, ErrorBanner, ListRow, Screen, Txt, useGo } from '@/components/ui';
import { post } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { confirmAsync } from '@/lib/confirm';
import { useAction } from '@/lib/hooks';
import { LANGS, useLang, useT } from '@/lib/i18n';
import { enablePush, pushState, type PushState } from '@/lib/push';
import { TEXT_SIZES, useTextSize } from '@/lib/scale';
import { useTheme } from '@/lib/theme';

/** Small caps label above a group of settings. */
function Label({ children }: { children: string }) {
  const { c } = useTheme();
  return <Text accessibilityRole="header" style={{ color: c.muted, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.9, marginTop: 4 }}>{children.toUpperCase()}</Text>;
}

/** Everything about the app itself, in one place: account, notifications, language, text size, safety and privacy, sign out. */
export default function Settings() {
  const { me, logout } = useMe();
  const { c } = useTheme();
  const go = useGo();
  const [push, setPush] = useState<PushState>('unsupported');
  const act = useAction();
  const { size, setSize } = useTextSize();
  const { lang, setLang } = useLang();
  const { t } = useT();
  useEffect(() => {
    void pushState().then(setPush);
  }, []);

  const v = me?.eligibility;
  const verification = v === 'verified' ? t('Verified adult') : v === 'pending' ? t('Check in review') : v === 'rejected' ? t('Not approved, you can try again') : v === 'expired' || v === 'reverification_required' ? t('Verify again to keep joining and chatting') : t('Not verified yet');

  const signOutEverywhere = async () => {
    if (!(await confirmAsync(t('Sign out of every device?'), t('Every phone and browser signed in to your account is signed out now, this one too. Use it if a phone is lost or you think someone else got in.'), t('Sign out everywhere'), true))) return;
    const done = await act.run(() => post('/v1/me/sessions/logout-all'));
    if (done) void logout('You were signed out of every device. Log in again.');
  };

  const signOut = async () => {
    if (await confirmAsync(t('Sign out?'), t('You can sign back in any time. Your plans and chats stay as they are.'), t('Sign out'), true)) void logout();
  };

  return (
    <Screen hasHeader>
      <ErrorBanner message={act.error} />

      <Label>{t('Account')}</Label>
      <Card style={{ padding: 12, borderRadius: 18, gap: 0 }}>
        <ListRow icon="person-outline" title={t('Edit profile')} onPress={() => go('/edit-profile')} right={<Ionicons name="chevron-forward" size={16} color={c.muted} />} />
        <ListRow icon="shield-checkmark-outline" title={t('Identity verification')} subtitle={verification} onPress={() => go('/verify')} right={<Ionicons name="chevron-forward" size={16} color={c.muted} />} />
        {!me?.emailVerified ? <ListRow icon="mail-outline" title={t('Confirm your email')} onPress={() => go('/onboarding')} right={<Ionicons name="chevron-forward" size={16} color={c.muted} />} /> : null}
        {me?.role !== 'guest' ? <ListRow icon="mail-outline" title={t('Change email address')} onPress={() => go('/change-email')} right={<Ionicons name="chevron-forward" size={16} color={c.muted} />} /> : null}
        {me?.role !== 'guest' ? <ListRow icon="key-outline" title={t('Change password')} onPress={() => go('/change-password')} right={<Ionicons name="chevron-forward" size={16} color={c.muted} />} last={me?.role === 'guest'} /> : null}
        {me?.role !== 'guest' ? <ListRow icon="flag-outline" title={t('My reports')} onPress={() => go('/my-reports')} right={<Ionicons name="chevron-forward" size={16} color={c.muted} />} /> : null}
        {me?.role !== 'guest' ? <ListRow icon="chatbox-ellipses-outline" title={t('Reviews of decisions')} onPress={() => go('/appeal')} right={<Ionicons name="chevron-forward" size={16} color={c.muted} />} /> : null}
        {me?.role !== 'guest' ? <ListRow icon="download-outline" title={t('Your data')} onPress={() => go('/my-data')} right={<Ionicons name="chevron-forward" size={16} color={c.muted} />} last /> : null}
      </Card>

      <Label>{t('Notifications')}</Label>
      <Card style={{ padding: 12, borderRadius: 18, gap: 8 }}>
        <ListRow icon="options-outline" title={t('What reaches you')} subtitle={t('Choose alerts and quiet hours')} onPress={() => go('/notification-settings')} right={<Ionicons name="chevron-forward" size={16} color={c.muted} />} />
        <ListRow
          icon="notifications-outline"
          title={t('Alerts on this device')}
          subtitle={push === 'granted' ? t('On') : push === 'denied' ? t('Blocked in your phone settings') : push === 'unsupported' ? t('Not available here') : t('Off')}
          last
          right={push === 'default' ? <Btn title={t('Turn on')} small onPress={() => void enablePush().then(setPush)} /> : push === 'granted' ? <Ionicons name="checkmark-circle" size={20} color={c.green} /> : undefined}
        />
      </Card>

      <Label>{t('Language')}</Label>
      <Card style={{ padding: 14, borderRadius: 18, gap: 12 }}>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('Language')} style={{ flexDirection: 'row', backgroundColor: c.sand, borderRadius: 12, padding: 3, gap: 3 }}>
          {LANGS.map(([v, label]) => {
            const on = lang === v;
            return (
              <Pressable key={v} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ selected: on }} onPress={() => setLang(v)} style={{ flex: 1, minHeight: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.surface : 'transparent', borderWidth: 1, borderColor: on ? c.line : 'transparent' }}>
                <Text style={{ color: on ? c.text : c.muted, fontWeight: on ? '800' : '600', fontSize: 13 }}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Label>{t('Text size')}</Label>
      <Card style={{ padding: 14, borderRadius: 18, gap: 12 }}>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('Text size')} style={{ flexDirection: 'row', backgroundColor: c.sand, borderRadius: 12, padding: 3, gap: 3 }}>
          {TEXT_SIZES.map(([v, label]) => {
            const on = size === v;
            return (
              <Pressable key={v} accessibilityRole="radio" accessibilityLabel={t('{label} text', { label: t(label) })} accessibilityState={{ selected: on }} onPress={() => setSize(v)} style={{ flex: 1, minHeight: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.surface : 'transparent', borderWidth: 1, borderColor: on ? c.line : 'transparent' }}>
                <Text style={{ color: on ? c.text : c.muted, fontWeight: on ? '800' : '600', fontSize: 13 }}>{t(label)}</Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Label>{t('Safety & privacy')}</Label>
      <Card style={{ padding: 12, borderRadius: 18, gap: 0 }}>
        <ListRow icon="lock-closed-outline" title={t('Safety & privacy')} onPress={() => go('/safety')} right={<Ionicons name="chevron-forward" size={16} color={c.muted} />} />
        <ListRow icon="eye-off-outline" title={t('What others can see')} subtitle={t('Only your name, photo, city and badge')} last />
      </Card>

      <Label>{t('About')}</Label>
      <Card style={{ padding: 12, borderRadius: 18, gap: 0 }}>
        <ListRow icon="information-circle-outline" title="HERE & THERE" subtitle={t('Version {v}', { v: Constants.expoConfig?.version ?? '0.1.0' })} last />
      </Card>

      <Btn title={t('Sign out')} variant="secondary" onPress={() => void signOut()} />
      {me?.role !== 'guest' ? <Btn title={t('Sign out of every device')} variant="ghost" onPress={() => void signOutEverywhere()} /> : null}
    </Screen>
  );
}
