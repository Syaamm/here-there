import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Switch, View } from 'react-native';
import { Text } from '@/components/ScaledText';
import { AccountRow, RoundCard } from '@/components/ProfileParts';
import { Empty, ErrorBanner, Screen, Spinner, Txt } from '@/components/ui';
import { get, put } from '@/lib/api';
import { errMsg, useLoad, useRefresh } from '@/lib/hooks';
import { localeTag, useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { showToast } from '@/lib/toast';
import { timeText } from '@/lib/format';

import { sc, sp } from '@/lib/scale';
type Group = { key: string; label: string; text: string; push: boolean };
type Quiet = { enabled: boolean; start: string; end: string; timezone: string };
type Settings = { groups: Group[]; important: { label: string; text: string }; quietHours: Quiet; note: string };
type Patch = { groups?: Record<string, boolean>; quietHours?: { enabled: boolean; start?: string; end?: string; timezone?: string } };

const STEP = 15; // minutes per tap on a time
const toMin = (v: string) => {
  const [h, m] = v.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
const fromMin = (n: number) => {
  const x = ((n % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};
const deviceZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
};

/** "10:00 PM" or "22:00", as the phone shows times. */
const shown = (v: string) => {
  const m = toMin(v);
  const d = new Date(2000, 0, 1, Math.floor(m / 60), m % 60);
  return timeText(d);
};

/**
 * One time with a big minus and plus: a tap moves it 15 minutes, holding keeps it moving (faster the longer it is held), so
 * getting from 22:00 to 07:00 is one press, not thirty-six taps.
 */
function TimeStep({ label, value, disabled, onChange }: { label: string; value: string; disabled: boolean; onChange: (v: string) => void }) {
  const { c } = useTheme();
  const { t } = useT();
  const latest = useRef(value);
  latest.current = value;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  const step = (delta: number) => {
    const next = fromMin(toMin(latest.current) + delta);
    latest.current = next;
    onChange(next);
  };
  // pressed: one step now; held: after a moment it repeats, quicker and quicker (and in hours once it has run for a while)
  const hold = (delta: number) => {
    stop();
    step(delta);
    let n = 0;
    const again = () => {
      n++;
      step(n > 12 ? delta * 4 : delta);
      timer.current = setTimeout(again, n < 4 ? 220 : n < 12 ? 110 : 90);
    };
    timer.current = setTimeout(again, 420);
  };
  const btn = (name: 'remove' | 'add', delta: number, what: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={what}
      accessibilityHint={t('Hold to keep going')}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      onPressIn={() => hold(delta)}
      onPressOut={stop}
      style={({ pressed }) => [{ width: sc(52), height: sc(52), borderRadius: sc(26), alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, opacity: disabled ? 0.45 : 1 }, pressed && { transform: [{ scale: 0.94 }] }]}
    >
      <Ionicons name={name} size={sc(22)} color={c.forest} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(12), minHeight: sc(64) }}>
      <Txt variant="label" color={c.muted} style={{ width: sc(52), fontSize: 12 }}>{label}</Txt>
      {btn('remove', -STEP, t('Earlier, {label}', { label }))}
      <Text accessibilityRole="text" accessibilityLabel={`${label} ${shown(value)}`} style={{ flex: 1, color: c.text, fontWeight: '700', fontSize: 22, lineHeight: 28, textAlign: 'center', opacity: disabled ? 0.5 : 1 }}>{shown(value)}</Text>
      {btn('add', STEP, t('Later, {label}', { label }))}
    </View>
  );
}

const ICONS: Record<string, React.ComponentProps<typeof Ionicons>['name']> = { messages: 'chatbubble-ellipses-outline', requests: 'person-add-outline', reminders: 'alarm-outline', saved: 'bookmark-outline', people: 'people-outline' };

/** Which kinds of alert also arrive as a push on this phone, and quiet hours. Every change is saved at once. */
export default function NotificationSettings() {
  const { t } = useT();
  const { c } = useTheme();
  const load = useLoad(() => get<Settings>('/v1/me/notification-settings'), [], undefined, 'me:notification-settings');
  const { refreshing, onRefresh } = useRefresh(() => load.reload());
  // what is shown: the last answer from the server with the changes still on their way laid over it
  const [local, setLocal] = useState<Settings | null>(null);
  const s = local ?? load.data;

  const save = async (patch: Patch, next: Settings) => {
    const before = s;
    setLocal(next); // answers at once
    try {
      const fresh = await put<Settings>('/v1/me/notification-settings', patch);
      setLocal(fresh);
    } catch (e) {
      setLocal(before ?? null); // put it back
      showToast(errMsg(e), 'error');
    }
  };

  const textOf = (k: string): [string, string] | null => {
    switch (k) {
      case 'messages': return [t('Messages'), t('New messages in your group chats')];
      case 'requests': return [t('Requests'), t('Join requests and answers to yours')];
      case 'reminders': return [t('Reminders'), t('Plans starting soon and changes to them')];
      case 'saved': return [t('Saved plans'), t('When something changes in a plan you saved')];
      case 'people': return [t('People'), t('New followers and friends')];
      default: return null;
    }
  };

  const toggle = (g: Group, on: boolean) => {
    if (!s) return;
    void save({ groups: { [g.key]: on } }, { ...s, groups: s.groups.map((x) => (x.key === g.key ? { ...x, push: on } : x)) });
  };
  // Quiet hours: every tap shows at once; the server is told once the tapping stops (half a second), so quick taps or a held
  // button never lag, and an older answer coming back can never move the time back to an earlier value.
  const [q, setQ] = useState<Quiet | null>(null);
  const qTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (qTimer.current && clearTimeout(qTimer.current)), []);
  const quietNow = q ?? s?.quietHours;
  const quiet = (p: Partial<Quiet>) => {
    if (!s || !quietNow) return;
    const next = { ...quietNow, ...p };
    setQ(next);
    if (qTimer.current) clearTimeout(qTimer.current);
    qTimer.current = setTimeout(async () => {
      try {
        const fresh = await put<Settings>('/v1/me/notification-settings', { quietHours: { enabled: next.enabled, start: next.start, end: next.end, timezone: deviceZone() ?? next.timezone } });
        setLocal(fresh);
        setQ((cur) => (cur && JSON.stringify(cur) === JSON.stringify(next) ? null : cur)); // nothing newer typed meanwhile: the server's copy takes over
      } catch (e) {
        setQ(null);
        showToast(errMsg(e), 'error');
      }
    }, 500);
  };

  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      <ErrorBanner message={load.error && !s ? load.error.message : null} />
      {load.loading && !s && <Spinner />}
      {!load.loading && !s && load.error ? <Empty title={t('Could not load your settings')} /> : null}
      {s ? (
        <>
          <Txt variant="muted" style={{ paddingHorizontal: 2 }}>{t('Choose which alerts also reach you as a notification on this phone.')}</Txt>
          <RoundCard>
            {s.groups.map((g) => {
              const [label, text] = textOf(g.key) ?? [g.label, g.text];
              return (
                <AccountRow
                  key={g.key}
                  icon={ICONS[g.key] ?? 'notifications-outline'}
                  title={label}
                  subtitle={text}
                  right={<Switch accessibilityLabel={label} accessibilityHint={text} value={g.push} onValueChange={(v) => toggle(g, v)} trackColor={{ true: c.green, false: c.line }} thumbColor={Platform.OS === 'android' && !g.push ? c.muted : '#fff'} ios_backgroundColor={c.line} />}
                />
              );
            })}
            <View accessible accessibilityLabel={`${t('Important alerts')}. ${t('These always reach you')}`}>
              <AccountRow icon="lock-closed-outline" title={t('Important alerts')} subtitle={t('Safety, decisions about you and plan cancellations. These always reach you.')} last />
            </View>
          </RoundCard>

          <RoundCard style={{ gap: sp(10), paddingVertical: sp(18) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(10), minHeight: sc(44) }}>
              <View style={{ flex: 1 }}>
                <Text accessibilityRole="header" style={{ color: c.text, fontSize: 16, lineHeight: 21, fontWeight: '500' }}>{t('Quiet hours')}</Text>
                <Text numberOfLines={2} style={{ color: c.muted, fontSize: 12, lineHeight: 16 }}>{t('No notifications between these times, except important alerts')}</Text>
              </View>
              <Switch accessibilityLabel={t('Quiet hours')} value={quietNow!.enabled} onValueChange={(v) => quiet({ enabled: v })} trackColor={{ true: c.green, false: c.line }} thumbColor={Platform.OS === 'android' && !quietNow!.enabled ? c.muted : '#fff'} ios_backgroundColor={c.line} />
            </View>
            <View style={{ gap: sp(4) }}>
              <TimeStep label={t('From')} value={quietNow!.start} disabled={!quietNow!.enabled} onChange={(v) => quiet({ start: v })} />
              <TimeStep label={t('Until')} value={quietNow!.end} disabled={!quietNow!.enabled} onChange={(v) => quiet({ end: v })} />
            </View>
          </RoundCard>

          <Txt variant="small" color={c.muted}>{t('Every alert is always kept in your Alerts list. These settings only decide which ones also reach you as a notification.')}</Txt>
        </>
      ) : null}
    </Screen>
  );
}
