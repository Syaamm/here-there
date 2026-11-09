import * as Updates from 'expo-updates';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text } from './ScaledText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

/**
 * "Update available -> Download -> Restart". Code-only changes reach phones as an update (OTA) instead of a new store build.
 * Checks once when the app opens. Does nothing in development, in a browser, or in a build without updates.
 */
export function UpdatePrompt() {
  const { t } = useT();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<'none' | 'available' | 'downloading' | 'failed'>('none');

  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;
    Updates.checkForUpdateAsync()
      .then((r) => r.isAvailable && setState('available'))
      .catch(() => {}); // offline or no update: stay quiet
  }, []);

  if (state === 'none') return null;

  const download = async () => {
    setState('downloading');
    try {
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    } catch {
      setState('failed');
    }
  };

  return (
    <View
      style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 90, backgroundColor: c.band, borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}
      accessibilityRole="alert"
    >
      <Text style={{ flex: 1, color: c.onBand, fontSize: 14 }}>
        {state === 'failed' ? t('Update failed. Try again.') : t('A new version is available.')}
      </Text>
      {state === 'downloading' ? (
        <ActivityIndicator color={c.onBand} />
      ) : (
        <Pressable onPress={download} accessibilityRole="button" hitSlop={8} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: c.onBand }}>
          <Text style={{ color: c.band, fontWeight: '600' }}>{t('Update')}</Text>
        </Pressable>
      )}
    </View>
  );
}
