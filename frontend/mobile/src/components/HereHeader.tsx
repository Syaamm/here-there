import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useMe } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { CityPicker } from './CityPicker';
import { Text } from './ScaledText';
import { Avatar } from './ui';

/** The dark green band HERE's pages start with (Figma "HOME"): the wordmark and tagline, the city, and your own photo. */
export const HERE_BAND = '#102F29';

export function HereHeader({ city, onPickCity }: { city: string; onPickCity: (c: string) => void }) {
  const { t } = useT();
  const router = useRouter();
  const { me } = useMe();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <View style={{ gap: 3 }}>
        <Text accessibilityRole="header" accessibilityLabel="HERE" style={{ color: '#fff', fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -1 }}>
          HERE<Text style={{ color: '#67A987' }}>.</Text>
        </Text>
        <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, lineHeight: 16 }}>{t('Be here. Be together.')}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <CityPicker city={city} onPick={onPickCity} onDark />
        <Pressable accessibilityRole="button" accessibilityLabel={t('Profile')} hitSlop={6} onPress={() => router.navigate('/profile' as never)}>
          <Avatar name={me?.profile?.displayName} uri={me?.profile?.photoUrl} size={36} />
        </Pressable>
      </View>
    </View>
  );
}
