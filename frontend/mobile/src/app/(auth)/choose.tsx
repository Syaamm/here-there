import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Image, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ScaledText';
import { useT } from '@/lib/i18n';
import { type Mode, useTheme } from '@/lib/theme';

const FOREST = '#102F29';
const IVORY = '#E9E5DD';
const PHOTO = require('../../../assets/choose/party.webp');

/** The two products as cards: HERE on forest green, THERE on ivory. Same photo, as in the design. */
const CARDS: { mode: Mode; name: string; fade: string; ink: string; button: 'outline' | 'solid'; dot: string }[] = [
  { mode: 'here', name: 'HERE', fade: FOREST, ink: '#fff', button: 'outline', dot: '#67A987' },
  { mode: 'there', name: 'THERE', fade: '#EEEBE1', ink: '#000', button: 'solid', dot: '#67A987' },
];

function ProductCard({ card, width, onPick }: { card: (typeof CARDS)[number]; width: number; onPick: () => void }) {
  const { t } = useT();
  const solid = card.button === 'solid';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t('Explore {name}', { name: card.name })} onPress={onPick} style={({ pressed }) => [{ width, height: 260, borderRadius: 33, overflow: 'hidden', backgroundColor: card.fade }, pressed && { opacity: 0.92 }]}>
      <Image source={PHOTO} resizeMode="cover" accessibilityLabel="" style={{ position: 'absolute', left: 0, top: -90, width, height: width * 1.249 }} />
      <LinearGradient pointerEvents="none" colors={[`${card.fade}00`, `${card.fade}CC`, card.fade]} locations={[0.18, 0.55, 0.78]} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
      <View style={{ position: 'absolute', left: 21, right: 21, bottom: 24, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <View style={{ flex: 1, paddingRight: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
            <Text style={{ color: card.ink, fontSize: 26, lineHeight: 32, fontWeight: '700', letterSpacing: -1 }}>{card.name}</Text>
            <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: card.dot, marginLeft: 5, marginBottom: 8 }} />
          </View>
          <Text style={{ color: card.ink, fontSize: 12, lineHeight: 19, marginTop: 4 }}>{t('Find people and activities happen. Nearby. Soon.')}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 46, borderRadius: 23, paddingLeft: 18, paddingRight: 6, backgroundColor: solid ? FOREST : 'rgba(217,217,217,0.18)', borderWidth: solid ? 0 : 1, borderColor: 'rgba(255,255,255,0.55)' }}>
          <Text style={{ color: '#fff', fontSize: 15.7 }}>{t('Explore')}</Text>
          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="arrow-forward" size={17} color="#000" style={{ transform: [{ rotate: '-45deg' }] }} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

/** After the intro: "Two ways to connect. One community." Pick HERE or THERE; the welcome page then opens in that product. */
export default function Choose() {
  const { t } = useT();
  const router = useRouter();
  const { setMode } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cardW = Math.min(width, 520) - 46;
  const pick = (m: Mode) => {
    setMode(m);
    router.replace('/welcome' as never);
  };
  return (
    <View style={{ flex: 1, backgroundColor: FOREST, alignItems: 'center' }}>
      <StatusBar style="light" />
      <View style={{ flex: 1, width: '100%', maxWidth: 520 }}>
        <View style={{ paddingTop: insets.top + 72, paddingBottom: 36, alignItems: 'center', gap: 20 }}>
          <View accessible accessibilityRole="header" accessibilityLabel="HERE / THERE" style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
            <Text style={{ color: '#fff', fontSize: 40, lineHeight: 46, fontWeight: '700', letterSpacing: -1.5 }}>HERE</Text>
            <View style={{ width: 13, height: 13, borderRadius: 7, backgroundColor: '#67A987', marginBottom: 9 }} />
            <Text style={{ color: '#fff', fontSize: 40, lineHeight: 46, fontWeight: '300' }}>/</Text>
            <Text style={{ color: '#fff', fontSize: 40, lineHeight: 46, fontWeight: '700', letterSpacing: -1.5 }}>THERE</Text>
            <View style={{ width: 13, height: 13, borderRadius: 7, backgroundColor: IVORY, marginBottom: 9 }} />
          </View>
          <Text style={{ color: '#fff', fontSize: 16, lineHeight: 25, textAlign: 'center' }}>{t('Two ways to connect.')}{'\n'}{t('One community.')}</Text>
        </View>
        <ScrollView style={{ flex: 1, backgroundColor: '#fff', borderTopLeftRadius: 40, borderTopRightRadius: 40 }} contentContainerStyle={{ alignItems: 'center', gap: 20, paddingTop: 40, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
          {CARDS.map((card) => (
            <ProductCard key={card.mode} card={card} width={cardW} onPick={() => pick(card.mode)} />
          ))}
        </ScrollView>
      </View>
    </View>
  );
}
