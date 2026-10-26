import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ScaledText';
import { IconPicker } from '@/components/IconPicker';
import { Btn, Card, ErrorBanner, ListRow, Screen, Txt, useGo } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { chooseIcon, canChangeIcon, savedIcon, type AppIcon } from '@/lib/appIcon';
import { confirmAsync } from '@/lib/confirm';
import { useAction } from '@/lib/hooks';
import { enablePush, pushState, type PushState } from '@/lib/push';
import { TEXT_SIZES, useTextSize } from '@/lib/scale';
import { useTheme } from '@/lib/theme';

/** Small caps label above a group of settings. */
function Label({ children }: { children: string }) {
  const { c } = useTheme();
  return <Text accessibilityRole="header" style={{ color: c.muted, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.9, marginTop: 4 }}>{children.toUpperCase()}</Text>;
}

/** Everything about the app itself, in one place: account, notifications, the icon, safety and privacy, sign out. */
export default function Settings() {
  const { me, logout } = useMe();
  const { c } = useTheme();
  const go = useGo();
  const [push, setPush] = useState<PushState>('unsupported');
  const [icon, setIcon] = useState<AppIcon>('here');
  const canSwitch = canChangeIcon();
  const act = useAction();
  const { size, setSize } = useTextSize();
  useEffect(() => {
    void pushState().then(setPush);
    void savedIcon().then(setIcon);
  }, []);

  const v = me?.eligibility;
  const verification = v === 'verified' ? 'Verified adult' : v === 'pending' ? 'Check in review' : v === 'rejected' ? 'Not approved, you can try again' : v === 'expired' || v === 'reverification_required' ? 'Verify again to keep joining and chatting' : 'Not verified yet';

  const pick = async (next: AppIcon) => {
    if (next === icon) return;
    setIcon(next); // the choice shows at once; the phone's own icon follows where it can
    const ok = await act.run(() => chooseIcon(next));
    if (ok === undefined) setIcon(icon); // it did not work: put it back
  };

  const signOut = async () => {
    if (await confirmAsync('Sign out?', 'You can sign back in any time. Your plans and chats stay as they are.', 'Sign out', true)) void logout();
  };

  return (
    <Screen hasHeader>
      <Txt variant="muted">Your account, alerts, app icon and safety, in one place.</Txt>
      <ErrorBanner message={act.error} />

      <Label>Account</Label>
      <Card style={{ padding: 12, borderRadius: 18, gap: 0 }}>
        <ListRow icon="person-outline" title="Edit profile" subtitle="Name, photo, city, bio and interests" onPress={() => go('/edit-profile')} right={<Ionicons name="chevron-forward" size={16} color={c.muted} />} />
        <ListRow icon="shield-checkmark-outline" title="Identity verification" subtitle={verification} onPress={() => go('/verify')} right={<Ionicons name="chevron-forward" size={16} color={c.muted} />} />
        {!me?.emailVerified ? <ListRow icon="mail-outline" title="Confirm your email" subtitle="Needed before identity verification" onPress={() => go('/onboarding')} right={<Ionicons name="chevron-forward" size={16} color={c.muted} />} /> : null}
        {me?.role !== 'guest' ? <ListRow icon="mail-outline" title="Change email address" subtitle="We send a code to the new address first" onPress={() => go('/change-email')} right={<Ionicons name="chevron-forward" size={16} color={c.muted} />} /> : null}
        {me?.role !== 'guest' ? <ListRow icon="key-outline" title="Change password" subtitle="Other devices are signed out when you change it" onPress={() => go('/change-password')} right={<Ionicons name="chevron-forward" size={16} color={c.muted} />} last={me?.role === 'guest'} /> : null}
        {me?.role !== 'guest' ? <ListRow icon="flag-outline" title="My reports" subtitle="What became of the reports you sent" onPress={() => go('/my-reports')} right={<Ionicons name="chevron-forward" size={16} color={c.muted} />} /> : null}
        {me?.role !== 'guest' ? <ListRow icon="chatbox-ellipses-outline" title="Reviews of decisions" subtitle="Ask us to look again, and see the answers" onPress={() => go('/appeal')} right={<Ionicons name="chevron-forward" size={16} color={c.muted} />} /> : null}
        {me?.role !== 'guest' ? <ListRow icon="download-outline" title="Your data" subtitle="Download a copy, or delete your account" onPress={() => go('/my-data')} right={<Ionicons name="chevron-forward" size={16} color={c.muted} />} last /> : null}
      </Card>

      <Label>Notifications</Label>
      <Card style={{ padding: 12, borderRadius: 18, gap: 8 }}>
        <ListRow
          icon="notifications-outline"
          title="Alerts on this device"
          subtitle={push === 'granted' ? 'On: requests, approvals and chat messages reach you here.' : push === 'denied' ? 'Blocked. Allow them in your phone or browser settings.' : push === 'unsupported' ? 'Not available in this app version or browser.' : 'Off: turn on to hear about requests and messages straight away.'}
          last
          right={push === 'default' ? <Btn title="Turn on" small onPress={() => void enablePush().then(setPush)} /> : push === 'granted' ? <Ionicons name="checkmark-circle" size={20} color={c.green} /> : undefined}
        />
      </Card>

      <Label>Text size</Label>
      <Card style={{ padding: 14, borderRadius: 18, gap: 12 }}>
        <View accessibilityRole="radiogroup" accessibilityLabel="Text size" style={{ flexDirection: 'row', backgroundColor: c.sand, borderRadius: 12, padding: 3, gap: 3 }}>
          {TEXT_SIZES.map(([v, label]) => {
            const on = size === v;
            return (
              <Pressable key={v} accessibilityRole="radio" accessibilityLabel={`${label} text`} accessibilityState={{ selected: on }} onPress={() => setSize(v)} style={{ flex: 1, minHeight: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.surface : 'transparent', borderWidth: 1, borderColor: on ? c.line : 'transparent' }}>
                <Text style={{ color: on ? c.text : c.muted, fontWeight: on ? '800' : '600', fontSize: 13 }}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Txt variant="small" style={{ color: c.text }}>Everything in the app follows this. The quick brown fox jumps over the lazy dog.</Txt>
      </Card>

      <Label>App icon</Label>
      <IconPicker icon={icon} onPick={(next) => void pick(next)} canSwitch={canSwitch} />

      <Label>Safety & privacy</Label>
      <Card style={{ padding: 12, borderRadius: 18, gap: 0 }}>
        <ListRow icon="lock-closed-outline" title="Safety & privacy" subtitle="Verification, blocked people, reporting and safety tips" onPress={() => go('/safety')} right={<Ionicons name="chevron-forward" size={16} color={c.muted} />} />
        <ListRow icon="eye-off-outline" title="What others can see" subtitle="Only your name, photo, city and badge. Never your documents or live location." last />
      </Card>

      <Label>About</Label>
      <Card style={{ padding: 12, borderRadius: 18, gap: 0 }}>
        <ListRow icon="information-circle-outline" title="HERE & THERE" subtitle={`Version ${Constants.expoConfig?.version ?? '0.1.0'} · Be here. Be together. Go there. Together.`} last />
      </Card>

      <Btn title="Sign out" variant="secondary" onPress={() => void signOut()} />
    </Screen>
  );
}
