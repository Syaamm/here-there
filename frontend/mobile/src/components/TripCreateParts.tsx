import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Pressable, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { useT } from '@/lib/i18n';
import { sc } from '@/lib/scale';
import { useTheme } from '@/lib/theme';
import { AuthBack } from './AuthForm';
import { Text, TextInput } from './ScaledText';
import { pressed } from './ui';

/** Building blocks of the THERE "Create a Trip" wizard: the HERE wizard's look on the ivory page, with white pills. */

const WHITE = '#FFFFFF';

/** Back button, "Create a Trip" and the step's name in the middle, "Step n/4" and four bars under them. */
export function TripTop({ step, title, onBack, right }: { step: number; title: string; onBack: () => void; right?: ReactNode }) {
  const { t } = useT();
  const { c } = useTheme();
  return (
    <View style={{ gap: 10 }}>
      <View style={{ minHeight: 48, justifyContent: 'center' }}>
        <View style={{ position: 'absolute', left: 0, top: 0, zIndex: 1 }}>
          <AuthBack onPress={onBack} />
        </View>
        <View style={{ alignItems: 'center', gap: 6, paddingHorizontal: 52 }}>
          <Text style={{ color: c.text, fontSize: 13, lineHeight: 16 }}>{t('Create a Trip')}</Text>
          <Text accessibilityRole="header" style={{ color: c.text, fontSize: 15, lineHeight: 19, fontWeight: '500', textAlign: 'center' }}>{title}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 30 }}>
        <Text style={{ color: c.muted, fontSize: 12.7, lineHeight: 16 }}>{t('Step {n}/4', { n: step + 1 })}</Text>
        {right}
      </View>
      <View accessibilityRole="progressbar" accessibilityLabel={t('Step {n}/4', { n: step + 1 })} accessibilityValue={{ min: 1, max: 4, now: step + 1 }} style={{ flexDirection: 'row', gap: 7 }}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={{ flex: 1, height: 5, borderRadius: 65, backgroundColor: i <= step ? c.forest : WHITE }} />
        ))}
      </View>
    </View>
  );
}

/** The big step heading with its grey promise underneath. */
export function TripHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 10, marginTop: 6 }}>
      <Text accessibilityRole="header" style={{ color: c.text, fontSize: 24, lineHeight: 34, fontWeight: '600' }}>{title}</Text>
      {subtitle ? <Text style={{ color: c.muted, fontSize: 14, lineHeight: 24 }}>{subtitle}</Text> : null}
    </View>
  );
}

/** A section label in the form's dark text. */
export function TripLabel({ children, right, style }: { children: ReactNode; right?: string; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return (
    <View style={[{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, style]}>
      <Text accessibilityRole="header" style={{ color: c.text, fontSize: 14, lineHeight: 20, fontWeight: '500', paddingLeft: 3 }}>{children}</Text>
      {right ? <Text style={{ color: c.muted, fontSize: 12 }}>{right}</Text> : null}
    </View>
  );
}

/** A big white pill: small grey label above, the value (typed or shown) below. */
export function TripField({ label, children, onPress, a11y, invalid, style }: { label: string; children: ReactNode; onPress?: () => void; a11y?: string; invalid?: boolean; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  const box: StyleProp<ViewStyle> = [{ minHeight: sc(78), borderRadius: 40, backgroundColor: WHITE, borderWidth: invalid ? 1.2 : 0, borderColor: c.danger, paddingLeft: 32, paddingRight: 56, paddingVertical: 12, justifyContent: 'center', gap: 4 }, style];
  const body = (
    <>
      <Text style={{ color: c.muted, fontSize: 12, lineHeight: 16 }}>{label}</Text>
      {children}
    </>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y ?? label} onPress={onPress} style={({ pressed: p }) => [box, pressed(p)]}>{body}</Pressable>
  ) : (
    <View style={box}>{body}</View>
  );
}

/** The value text inside a TripField. */
export function TripValue({ children, placeholder }: { children?: string; placeholder?: string }) {
  const { c } = useTheme();
  return <Text numberOfLines={1} style={{ color: children ? c.text : c.muted, fontSize: 16, lineHeight: 22, fontWeight: '500' }}>{children || placeholder}</Text>;
}

/** The text input inside a TripField. */
export function TripInput({ label, style, ...rest }: TextInputProps & { label: string }) {
  const { c } = useTheme();
  return <TextInput accessibilityLabel={label} placeholderTextColor={c.placeholder} {...rest} style={[{ color: c.text, fontSize: 16, lineHeight: 22, fontWeight: '500', paddingVertical: 0, minHeight: 22, minWidth: 0 }, style]} />;
}

/** The dark round button between two stacked pills (swap, calendar). Sits on the right edge, half over each pill. */
export function TripRoundDark({ icon, label, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress?: () => void }) {
  const { c } = useTheme();
  const body = (
    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.forest, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={icon} size={20} color="#fff" />
    </View>
  );
  if (!onPress) return <View accessibilityElementsHidden importantForAccessibility="no">{body}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={6} onPress={onPress} style={({ pressed: p }) => [{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, pressed(p)]}>{body}</Pressable>
  );
}

/** A round-cornered one-line white pill for a number (the budget). */
export function TripAmount({ label, ...rest }: TextInputProps & { label: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, minHeight: sc(54), borderRadius: 32, backgroundColor: WHITE, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20 }}>
      <Text style={{ color: c.text, fontSize: 16, fontWeight: '500' }}>€</Text>
      <TripInput label={label} keyboardType="number-pad" {...rest} style={{ flex: 1 }} />
    </View>
  );
}

/** A pill choice: white, dark green and white text when picked. */
export function TripPill({ label, spoken, active, onPress, wide, icon }: { label: string; spoken?: string; active: boolean; onPress: () => void; wide?: boolean; icon?: React.ComponentProps<typeof Ionicons>['name'] }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken ?? label}
      accessibilityState={{ selected: active }}
      hitSlop={{ top: 4, bottom: 4 }}
      onPress={onPress}
      style={({ pressed: p }) => [{ minHeight: 44, minWidth: wide ? 96 : undefined, paddingHorizontal: 22, borderRadius: 32, backgroundColor: active ? c.forest : WHITE, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }, pressed(p)]}
    >
      {icon && active ? <Ionicons name={icon} size={15} color="#fff" /> : null}
      <Text style={{ color: active ? '#fff' : c.text, fontSize: 14, fontWeight: active ? '600' : '400' }}>{label}</Text>
    </Pressable>
  );
}

/** One white card with rounded corners (the guidelines notice, the review). */
export function TripCard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ backgroundColor: WHITE, borderRadius: 32, padding: 20, gap: 8 }, style]}>{children}</View>;
}

/** The white page-wide "Continue" hint: a big dark pill like the design. */
export const TRIP_WHITE = WHITE;
