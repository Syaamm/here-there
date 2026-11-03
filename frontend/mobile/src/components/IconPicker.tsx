import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, Pressable, View } from 'react-native';
import { Text } from '@/components/ScaledText';
import { Card } from '@/components/ui';
import type { AppIcon } from '@/lib/appIcon';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

const IMAGES: Record<AppIcon, number> = {
  here: require('../../assets/icon.png'),
  there: require('../../assets/icons/there/icon.png'),
};
const PIN = '#E7833A'; // the brand pin in the HERE wordmark

/** One tappable name. The chosen one is dark and strong; the other is quiet. */
function Name({ icon, on, onPress }: { icon: AppIcon; on: boolean; onPress: () => void }) {
  const { t } = useT();
  const { c } = useTheme();
  const quiet = '#A3ADA8';
  const ink = on ? c.text : quiet;
  const word = { color: ink, fontSize: 28, lineHeight: 34, fontWeight: '900' as const, letterSpacing: -0.6 };
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={t('{name} icon', { name: icon === 'here' ? 'HERE' : 'THERE' })}
      accessibilityState={{ selected: on }}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [{ minHeight: 44, justifyContent: 'center' }, pressed && { opacity: 0.7 }]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
        <Text style={word}>{icon === 'here' ? 'HERE' : 'THERE'}</Text>
        {icon === 'here' ? (
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ marginLeft: 1, marginBottom: 5, opacity: on ? 1 : 0.45 }}>
            <Ionicons name="location-sharp" size={17} color={PIN} />
          </View>
        ) : (
          <Text style={[word, { color: on ? c.green : quiet }]}>.</Text>
        )}
      </View>
    </Pressable>
  );
}

/**
 * Settings: which icon the app has on the home screen. The header shows the icon in use; tapping a name switches it.
 * `canSwitch` is false in Expo Go and the browser, which keep their own icon, so the note explains that.
 */
export function IconPicker({ icon, onPick, canSwitch }: { icon: AppIcon; onPick: (next: AppIcon) => void; canSwitch: boolean }) {
  const { t } = useT();
  const { c } = useTheme();
  return (
    <Card style={{ padding: 16, borderRadius: 18, gap: 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text accessibilityRole="header" style={{ color: c.text, fontSize: 16, fontWeight: '800' }}>{t('Home screen icon')}</Text>
          <Text style={{ color: c.muted, fontSize: 13 }}>{t('Tap a name to switch')}</Text>
        </View>
        <Image source={IMAGES[icon]} accessibilityIgnoresInvertColors accessibilityLabel={t('Current icon: {name}', { name: icon === 'here' ? 'HERE' : 'THERE' })} style={{ width: 36, height: 36, borderRadius: 10 }} />
      </View>

      <View accessibilityRole="radiogroup" accessibilityLabel={t('Home screen icon')} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 14, marginBottom: 12 }}>
        <Name icon="here" on={icon === 'here'} onPress={() => onPick('here')} />
        <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ color: '#C7CECA', fontSize: 28, fontWeight: '300' }}>/</Text>
        <Name icon="there" on={icon === 'there'} onPress={() => onPick('there')} />
      </View>

      <View style={{ height: 1, backgroundColor: c.line }} />
      <Text style={{ color: c.muted, fontSize: 13, marginVertical: 12 }}>{icon === 'here' ? t('Using HERE · the default icon') : t('Using THERE')}</Text>
      {!canSwitch ? (
        <>
          <View style={{ height: 1, backgroundColor: c.line }} />
          <Text style={{ color: c.muted, fontSize: 13, lineHeight: 19, marginTop: 12 }}>{t('Expo Go and browsers keep their own icon. Your pick applies in the installed app.')}</Text>
        </>
      ) : null}
    </Card>
  );
}
