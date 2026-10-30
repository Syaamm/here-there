import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { Text } from '@/components/ScaledText';
import { Card, Empty, ErrorBanner, Screen, Spinner, Txt } from '@/components/ui';
import { get, put } from '@/lib/api';
import { errMsg, useLoad, useRefresh } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { showToast } from '@/lib/toast';

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

/** A time in 24h with a minus and a plus (15 minutes at a time). */
function TimeStep({ label, value, disabled, onChange }: { label: string; value: string; disabled: boolean; onChange: (v: string) => void }) {
  const { c } = useTheme();
  const { t } = useT();
  const btn = (name: 'remove' | 'add', delta: number, what: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={what}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={() => onChange(fromMin(toMin(value) + delta))}
      style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: c.accentSoft, opacity: disabled ? 0.45 : 1 }}
    >
      <Ionicons name={name} size={18} color={c.forest} />
    </Pressable>
  );
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 4 }}>
      <Txt variant="label" color={c.muted} style={{ fontSize: 11 }}>{label}</Txt>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {btn('remove', -STEP, t('Earlier, {label}', { label }))}
        <Text accessibilityLabel={`${label} ${value}`} style={{ color: c.text, fontWeight: '800', fontSize: 17, minWidth: 54, textAlign: 'center', opacity: disabled ? 0.5 : 1 }}>{value}</Text>
        {btn('add', STEP, t('Later, {label}', { label }))}
      </View>
    </View>
  );
}

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
      case 'people': return [t('People'), t('New followers and buddies')];
      default: return null;
    }
  };

  const toggle = (g: Group, on: boolean) => {
    if (!s) return;
    void save({ groups: { [g.key]: on } }, { ...s, groups: s.groups.map((x) => (x.key === g.key ? { ...x, push: on } : x)) });
  };
  const quiet = (p: Partial<Quiet>) => {
    if (!s) return;
    const q = { ...s.quietHours, ...p };
    void save({ quietHours: { enabled: q.enabled, start: q.start, end: q.end, timezone: deviceZone() ?? q.timezone } }, { ...s, quietHours: q });
  };

  return (
    <Screen hasHeader onRefresh={onRefresh} refreshing={refreshing}>
      <ErrorBanner message={load.error && !s ? load.error.message : null} />
      {load.loading && !s && <Spinner />}
      {!load.loading && !s && load.error ? <Empty title={t('Could not load your settings')} /> : null}
      {s ? (
        <>
          <Txt variant="small">{t('Choose which alerts also reach you as a notification on this phone.')}</Txt>
          <Card style={{ padding: 12, borderRadius: 18, gap: 0 }}>
            {s.groups.map((g) => {
              const [label, text] = textOf(g.key) ?? [g.label, g.text];
              return (
                <View key={g.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.line }}>
                  <View style={{ flex: 1 }}>
                    <Txt variant="h3" style={{ fontSize: 14, lineHeight: 19 }}>{label}</Txt>
                    <Txt variant="small" numberOfLines={2}>{text}</Txt>
                  </View>
                  <Switch
                    accessibilityLabel={label}
                    accessibilityHint={text}
                    value={g.push}
                    onValueChange={(v) => toggle(g, v)}
                    trackColor={{ true: c.green, false: c.line }}
                  />
                </View>
              );
            })}
            <View accessible accessibilityLabel={`${t('Important alerts')}. ${t('These always reach you')}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingVertical: 8 }}>
              <Ionicons name="lock-closed-outline" size={18} color={c.forest} />
              <View style={{ flex: 1 }}>
                <Txt variant="h3" style={{ fontSize: 14, lineHeight: 19 }}>{t('Important alerts')}</Txt>
                <Txt variant="small" numberOfLines={2}>{t('Safety, decisions about you and plan cancellations. These always reach you.')}</Txt>
              </View>
            </View>
          </Card>

          <Text accessibilityRole="header" style={{ color: c.muted, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.9, marginTop: 4 }}>{t('Quiet hours').toUpperCase()}</Text>
          <Card style={{ padding: 12, borderRadius: 18, gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
              <View style={{ flex: 1 }}>
                <Txt variant="h3" style={{ fontSize: 14, lineHeight: 19 }}>{t('Quiet hours')}</Txt>
                <Txt variant="small" numberOfLines={2}>{t('No notifications between these times, except important alerts')}</Txt>
              </View>
              <Switch accessibilityLabel={t('Quiet hours')} value={s.quietHours.enabled} onValueChange={(v) => quiet({ enabled: v })} trackColor={{ true: c.green, false: c.line }} />
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TimeStep label={t('From')} value={s.quietHours.start} disabled={!s.quietHours.enabled} onChange={(v) => quiet({ start: v })} />
              <TimeStep label={t('Until')} value={s.quietHours.end} disabled={!s.quietHours.enabled} onChange={(v) => quiet({ end: v })} />
            </View>
          </Card>

          <Txt variant="small" color={c.muted}>{t('Every alert is always kept in your Alerts list. These settings only decide which ones also reach you as a notification.')}</Txt>
        </>
      ) : null}
    </Screen>
  );
}
