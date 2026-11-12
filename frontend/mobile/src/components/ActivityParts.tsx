import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { useT } from '@/lib/i18n';
import { tap } from '@/lib/haptics';
import { sc } from '@/lib/scale';
import { useTheme } from '@/lib/theme';
import { AuthBack } from './AuthForm';
import { Text } from './ScaledText';
import { Avatar, pressed } from './ui';

/** Pieces shared by the activity detail, join and host screens (from the Figma design). */

/** Round back button, a title and a hairline under them (the host's "Manage Join Requests" header). */
export function ActivityHeader({ title, onBack }: { title: string; onBack: () => void }) {
  const { c } = useTheme();
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <AuthBack onPress={onBack} />
        <Text accessibilityRole="header" style={{ flex: 1, color: c.text, fontSize: 17, lineHeight: 22, fontWeight: '500' }}>{title}</Text>
      </View>
      <View style={{ height: 1, backgroundColor: c.line, marginTop: 10 }} />
    </View>
  );
}

/** A pill button: filled forest, or outlined. */
export function PillButton({ title, onPress, outline, disabled, loading, small, style, label }: { title: string; onPress: () => void; outline?: boolean; disabled?: boolean; loading?: boolean; small?: boolean; style?: StyleProp<ViewStyle>; label?: string }) {
  const { c } = useTheme();
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? title}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={() => {
        tap(outline ? 'Light' : 'Medium');
        onPress();
      }}
      style={({ pressed: p }) => [
        { minHeight: Math.max(44, sc(small ? 46 : 54)), borderRadius: 32, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, backgroundColor: outline ? c.surface : c.forest, borderWidth: 1, borderColor: outline ? c.line : c.forest, opacity: off ? 0.5 : 1 },
        style,
        !off && pressed(p),
      ]}
    >
      <Text style={{ color: outline ? c.text : '#fff', fontSize: small ? 13 : 14, fontWeight: '500', textAlign: 'center' }}>{loading ? '…' : title}</Text>
    </Pressable>
  );
}

/** The blue "verified" tick. */
export function VerifiedTick({ size = 16 }: { size?: number }) {
  return <Ionicons name="checkmark-circle" size={size} color="#2D81D4" />;
}

/** The soft card showing who hosts the activity. */
export function HostCard({ name, uri, verified, onPress, children, label }: { name: string; uri?: string | null; verified: boolean; onPress: () => void; children: ReactNode; label: string }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed: p }) => [{ borderRadius: 24, borderWidth: 1, borderColor: c.line, overflow: 'hidden' }, pressed(p)]}>
      <LinearGradient colors={[c.surface, c.sand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 16, padding: 18 }}>
        <View>
          <Avatar name={name} uri={uri} size={46} />
          {verified ? (
            <View style={{ position: 'absolute', right: -4, bottom: -2, backgroundColor: '#fff', borderRadius: 9, width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}>
              <VerifiedTick size={16} />
            </View>
          ) : null}
        </View>
        <View style={{ flex: 1, gap: 4 }}>{children}</View>
      </LinearGradient>
    </Pressable>
  );
}

/** An icon, a main line and a small line under it (place, time). */
export function InfoRow({ icon, title, sub, onPress, label, trailing }: { icon: React.ComponentProps<typeof Ionicons>['name']; title: string; sub: string; onPress?: () => void; label?: string; trailing?: ReactNode }) {
  const { c } = useTheme();
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14, minHeight: 44 }}>
      <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: 24, alignItems: 'center', paddingTop: 1 }}>
        <Ionicons name={icon} size={22} color={c.text} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ color: c.text, fontSize: 16, lineHeight: 21, fontWeight: '500' }}>{title}</Text>
        <Text style={{ color: c.muted, fontSize: 14, lineHeight: 18 }}>{sub}</Text>
      </View>
      {trailing}
    </View>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={label ?? title} onPress={onPress} style={({ pressed: p }) => pressed(p)}>
      {body}
    </Pressable>
  ) : (
    body
  );
}

type Slot = { id: string; name?: string; uri?: string | null; host?: boolean; /** a friend of the viewer: a small badge on the face */ friend?: boolean; /** after it ended: true has answered whether they were there (a check), false not yet (faded) */ answered?: boolean };

/**
 * "Who's going": every place of the activity, each a bar segment over a face (or an open circle). Up to five fill the width;
 * more scroll sideways, five at a time with the next one peeking in, the bar moving with its face, so the rest of the people
 * and the open places come into view as the row is scrolled.
 */
export function GoingGrid({ people, capacity, a11y, onOpen }: { people: Slot[]; capacity: number; a11y: string; /** a tap on a face opens that person (their profile) */ onOpen?: (id: string) => void }) {
  const { t } = useT();
  const { c } = useTheme();
  const [width, setWidth] = useState(0);
  const [contentW, setContentW] = useState(0);
  const x = useRef(new Animated.Value(0)).current; // how far the row is scrolled, for the soft edges
  const slots = Math.max(1, capacity, people.length);
  const shown = people.slice(0, slots);
  const open = Math.max(0, slots - shown.length);
  const cells = [...shown.map((p) => ({ kind: 'person' as const, p })), ...Array.from({ length: open }, (_, i) => ({ kind: 'open' as const, p: { id: `o${i}` } as Slot }))];
  const GAP = 8;
  const EDGE = 28; // how wide the soft edges are
  const scrolls = slots > 5;
  const cellW = scrolls ? Math.max(58, (width - GAP * 5) / 5.4) : undefined; // five and a bit: the peeking sixth says "scroll"
  const cell = (x: (typeof cells)[number]) => (
    <View key={x.p.id} style={[{ alignItems: 'center', gap: 10 }, cellW ? { width: cellW } : { flex: 1 }]}>
      <View style={{ alignSelf: 'stretch', height: 4, borderRadius: 2, backgroundColor: x.kind === 'person' ? c.forest : c.line }} />
      <Pressable
        accessible={!!onOpen && x.kind === 'person'}
        accessibilityRole="button"
        accessibilityLabel={x.kind === 'person' ? `${t('Open the profile of {name}', { name: x.p.name ?? '' })}${x.p.friend ? `, ${t('Friend')}` : ''}${x.p.answered === true ? `, ${t('answered')}` : x.p.answered === false ? `, ${t('not answered yet')}` : ''}` : undefined}
        disabled={!onOpen || x.kind !== 'person'}
        onPress={() => onOpen?.(x.p.id)}
        style={({ pressed: p }) => [{ alignItems: 'center', gap: 5 }, p && { opacity: 0.7, transform: [{ scale: 0.96 }] }]}
      >
        {x.kind === 'person' ? (
          <View style={{ borderRadius: 999, borderWidth: 2, borderColor: x.p.host ? c.green : c.bg, opacity: x.p.answered === false ? 0.55 : 1 }}>
            <Avatar name={x.p.name} uri={x.p.uri} size={42} />
            {/* after it ended: a check on everyone who has answered whether they were there; the others are faded */}
            {x.p.answered ? (
              <View accessibilityElementsHidden importantForAccessibility="no" style={{ position: 'absolute', right: -3, top: -3, width: 20, height: 20, borderRadius: 10, backgroundColor: c.forest, borderWidth: 2, borderColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="checkmark" size={11} color="#fff" />
              </View>
            ) : null}
            {/* your friend: a small green badge with two people at the bottom right of the face */}
            {x.p.friend ? (
              <View accessibilityElementsHidden importantForAccessibility="no" style={{ position: 'absolute', right: -3, bottom: -3, width: 20, height: 20, borderRadius: 10, backgroundColor: c.green, borderWidth: 2, borderColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="people" size={10} color="#fff" />
              </View>
            ) : null}
          </View>
        ) : (
          <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: c.sand, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="person-add-outline" size={18} color={c.forest} />
          </View>
        )}
        <Text numberOfLines={1} style={{ color: c.muted, fontSize: 12, lineHeight: 15 }}>{x.kind === 'open' ? t('Open') : x.p.host ? t('Host') : x.p.friend ? `${(x.p.name ?? '').split(' ')[0]} · ${t('Friend')}` : (x.p.name ?? '').split(' ')[0]}</Text>
      </Pressable>
    </View>
  );
  return (
    <View accessible={!onOpen} accessibilityLabel={a11y} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {scrolls ? (
        width ? (
          <View>
            <Animated.ScrollView
              horizontal
              overScrollMode="never"
              nestedScrollEnabled
              showsHorizontalScrollIndicator={false}
              decelerationRate="fast"
              snapToInterval={(cellW ?? 0) + GAP}
              contentContainerStyle={{ gap: GAP }}
              onContentSizeChange={(w) => setContentW(w)}
              scrollEventThrottle={16}
              onScroll={Animated.event([{ nativeEvent: { contentOffset: { x } } }], { useNativeDriver: true })}
            >
              {cells.map(cell)}
            </Animated.ScrollView>
            {/* soft edges: people fade in and out at the sides instead of being cut off; the left one only once scrolled, the right one while there is more */}
            <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: EDGE, opacity: x.interpolate({ inputRange: [0, EDGE], outputRange: [0, 1], extrapolate: 'clamp' }) }}>
              <LinearGradient colors={[c.bg, c.fadeFrom]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ flex: 1 }} />
            </Animated.View>
            <Animated.View pointerEvents="none" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: EDGE, opacity: x.interpolate({ inputRange: [Math.max(0, contentW - width - EDGE), Math.max(1, contentW - width)], outputRange: [1, 0], extrapolate: 'clamp' }) }}>
              <LinearGradient colors={[c.fadeFrom, c.bg]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ flex: 1 }} />
            </Animated.View>
          </View>
        ) : null
      ) : (
        <View style={{ flexDirection: 'row', gap: GAP }}>{cells.map(cell)}</View>
      )}
    </View>
  );
}
