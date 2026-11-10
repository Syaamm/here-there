import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useMe } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { CityPicker } from './CityPicker';
import { Text } from './ScaledText';
import { Avatar } from './ui';
import { LamisWordmark } from './LamisWordmark';
import { CollapseAvatar, CollapseCity, CollapseLogo, CollapseTagline } from './CollapsePieces';

/** The dark green band HERE's pages start with (Figma "HOME"): the wordmark and tagline, the city, and your own photo. */
export const HERE_BAND = '#102F29';

export function HereHeader({ city, onPickCity }: { city: string; onPickCity: (c: string) => void }) {
  const { t } = useT();
  const router = useRouter();
  const { me } = useMe();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <View style={{ gap: 6 }}>
        <CollapseLogo>
          <LamisWordmark onDark height={28} />
        </CollapseLogo>
        <CollapseTagline>
          <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, lineHeight: 16 }}>{t('Be here. Go there.')}</Text>
        </CollapseTagline>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <CollapseCity>
          <CityPicker city={city} onPick={onPickCity} onDark />
        </CollapseCity>
        <CollapseAvatar>
          <Pressable accessibilityRole="button" accessibilityLabel={t('Profile')} hitSlop={6} onPress={() => router.navigate('/profile' as never)}>
            <Avatar name={me?.profile?.displayName} uri={me?.profile?.photoUrl} size={36} />
          </Pressable>
        </CollapseAvatar>
      </View>
    </View>
  );
}
