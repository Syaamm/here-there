import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Alert, Linking, Platform, Pressable, View } from 'react-native';
import { AuthButton } from '@/components/AuthForm';
import { AccountRow, GroupLabel, PillChoice, RoundCard } from '@/components/ProfileParts';
import { Text } from '@/components/ScaledText';
import { Avatar, Btn, ErrorBanner, Row, Screen, useGo } from '@/components/ui';
import { post } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useVerifyGate } from '@/lib/verifyGate';
import { confirmAsync } from '@/lib/confirm';
import { useAction } from '@/lib/hooks';
import { LANGS, useLang, useT } from '@/lib/i18n';
import { enablePush, pushState, testPush, type PushState } from '@/lib/push';
import { TEXT_SIZES, useTextSize } from '@/lib/scale';
import { useTheme } from '@/lib/theme';
import { useReportsBadge } from '@/lib/reportsSeen';

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
  const verification = v === 'verified' ? t('Verified adult') : v === 'pending' ? t('Check in review') : v === 'rejected' ? t('Not approved, you can try again') : v === 'expired' || v === 'reverification_required' ? t('Verify again to keep joining and chatting') : t('Identity not verified');
  const guest = me?.role === 'guest';
  const gate = useVerifyGate();
  const newReports = useReportsBadge(); // something new on Reports & Blocked: a red dot on its row

  const signOutEverywhere = async () => {
    if (!(await confirmAsync(t('Sign out of every device?'), t('Every phone and browser signed in to your account is signed out now, this one too. Use it if a phone is lost or you think someone else got in.'), t('Sign out everywhere'), true))) return;
    const done = await act.run(() => post('/v1/me/sessions/logout-all'));
    if (done) void logout(''); // nothing is said afterwards: the person chose this
  };

  const signOut = async () => {
    if (await confirmAsync(t('Sign out?'), t('You can sign back in any time. Your plans and chats stay as they are.'), t('Sign out'), true)) void logout();
  };

  // the account rows, in the order of the design; the last one drops its hairline
  const rows: { key: string; icon: React.ComponentProps<typeof Ionicons>['name']; title: string; subtitle?: string; to: string }[] = [
    { key: 'verify', icon: 'shield-checkmark-outline', title: t('Identity verification'), subtitle: verification, to: '/verify' },
    ...(!me?.emailVerified && !guest ? [{ key: 'confirm', icon: 'mail-outline' as const, title: t('Confirm your email'), to: '/onboarding' }] : []),
    ...(!guest
      ? [
          { key: 'email', icon: 'mail-outline' as const, title: t('Change email address'), to: '/change-email' },
          { key: 'reports', icon: 'clipboard-outline' as const, title: t('Reports & Blocked'), to: '/reports-blocked' },
          { key: 'password', icon: 'key-outline' as const, title: t('Change password'), to: '/change-password' },
          { key: 'data', icon: 'download-outline' as const, title: t('Your data'), to: '/my-data' },
        ]
      : []),
  ];

  return (
    <Screen>
      <ErrorBanner message={act.error} />

      <GroupLabel>{t('Account')}</GroupLabel>
      <Pressable accessibilityRole="button" accessibilityLabel={guest ? gate.title('edit') : t('Edit profile')} onPress={() => (guest ? void gate.ask('edit') : go('/edit-profile'))} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
        <RoundCard style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 20 }}>
          <Avatar name={me?.profile?.displayName} uri={me?.profile?.photoUrl} size={46} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text numberOfLines={1} style={{ color: c.text, fontSize: 16, lineHeight: 21, fontWeight: '500' }}>
              {me?.profile?.displayName}
              {v === 'verified' ? <Text style={{ color: '#2F80ED' }}>{'  '}<Ionicons name="checkmark-circle" size={15} color="#2F80ED" /></Text> : null}
            </Text>
            <Text numberOfLines={2} style={{ color: c.muted, fontSize: 12, lineHeight: 16 }}>{`${me?.profile?.homeCity ?? t('No city set')} · ${verification}`}</Text>
          </View>
          {guest ? <Ionicons name="alert-circle" size={24} color="#D4930F" /> : <Ionicons name="create-outline" size={22} color={c.text} />}
        </RoundCard>
      </Pressable>

      <GroupLabel>{t('Account & Security')}</GroupLabel>
      <RoundCard>
        {rows.map((r, i) => (
          <AccountRow key={r.key} icon={r.icon} title={r.title} subtitle={r.subtitle} dot={r.key === 'reports' && newReports > 0} onPress={() => go(r.to)} last={i === rows.length - 1} />
        ))}
      </RoundCard>

      <GroupLabel>{t('Notifications')}</GroupLabel>
      <RoundCard>
        <AccountRow icon="options-outline" title={t('Notification preferences')} subtitle={t('Choose alerts and quiet hours')} onPress={() => go('/notification-settings')} />
        <AccountRow
          icon="notifications-outline"
          title={t('Alerts on this device')}
          subtitle={push === 'granted' ? t('On · Open phone settings') : push === 'denied' ? t('Blocked · Open phone settings to allow') : push === 'unsupported' ? t('Not available here') : t('Off')}
          last={Platform.OS === 'web'}
          // tapping the row opens this app's notification settings on the phone (sound, banners, lock screen, or allowing them again)
          onPress={push === 'unsupported' || Platform.OS === 'web' ? undefined : () => void Linking.openSettings()}
          right={
            push === 'default' ? (
              <Btn title={t('Turn on')} small onPress={() => void enablePush().then(setPush)} />
            ) : push === 'unsupported' ? undefined : (
              <Row style={{ gap: 6, alignItems: 'center' }}>
                {push === 'granted' ? <Ionicons name="checkmark-circle" size={22} color={c.green} /> : null}
                <Ionicons name="open-outline" size={18} color={c.muted} />
              </Row>
            )
          }
        />
        {Platform.OS === 'web' ? null : (
          <AccountRow
            icon="paper-plane-outline"
            title={t('Send a test push')}
            subtitle={t('Checks this phone, the server and Firebase')}
            last
            onPress={() => void testPush().then((report) => Alert.alert(t('Push test'), report))}
          />
        )}
      </RoundCard>

      <GroupLabel>{t('Language')}</GroupLabel>
      <PillChoice options={LANGS as unknown as [string, string][]} value={lang as string} onChange={(x) => setLang(x as typeof lang)} label={t('Language')} />

      <GroupLabel>{t('Text size')}</GroupLabel>
      <PillChoice options={TEXT_SIZES.map(([k, l]) => [k, t(l)] as [string, string])} value={size as string} onChange={(x) => setSize(x as typeof size)} label={t('Text size')} labelFor={(l) => t('{label} text', { label: l })} />

      <GroupLabel>{t('Safety & privacy')}</GroupLabel>
      <RoundCard>
        <AccountRow icon="lock-closed-outline" title={t('Safety & privacy')} onPress={() => go('/safety')} />
        <AccountRow icon="eye-off-outline" title={t('What others can see')} subtitle={t('Only your name, photo, city and badge')} last />
      </RoundCard>

      <GroupLabel>{t('About')}</GroupLabel>
      <RoundCard>
        <AccountRow icon="information-circle-outline" title="LAMIS" subtitle={t('Version {v}', { v: Constants.expoConfig?.version ?? '0.1.0' })} last />
      </RoundCard>

      <AuthButton title={t('Sign out')} onPress={() => void signOut()} />
      {!guest ? <Btn title={t('Sign out of every device')} variant="ghost" onPress={() => void signOutEverywhere()} /> : null}
    </Screen>
  );
}
